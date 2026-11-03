"""CPU-only Thai story issue classification from autonomous teacher QA lessons.

This is NOT a generative model. It never rewrites the manuscript.
Owner delegates teaching to AI; acceptance means passed structural QA, not
human fact checking. Train/test are split by project. Promotion is gated.
"""
import hashlib
import json
import os
import math
import re
import time
import unicodedata
import uuid
from collections import Counter
from decimal import Decimal

LABELS = ("continuity", "clarity", "expand", "pacing", "keep")
PK = "learning#teacher-story-coherence"
MAX_ROWS = 600


def _resp(code, value):
    return {"statusCode": code, "headers": {"Content-Type": "application/json",
             "Cache-Control": "no-store"},
            "body": json.dumps(value, ensure_ascii=False, default=lambda x: float(x)
            if isinstance(x, Decimal) else str(x))}


def _table():
    import boto3
    import os
    name = os.getenv("TEACHER_FEEDBACK_TABLE")
    if not name:
        raise RuntimeError("TEACHER_FEEDBACK_TABLE missing")
    return boto3.resource("dynamodb").Table(name)


def _rows(table):
    from boto3.dynamodb.conditions import Key
    rows, cursor, seen = [], None, set()
    scanned = 0
    while scanned < MAX_ROWS:
        kwargs = {"KeyConditionExpression": Key("pk").eq(PK)
                  & Key("sk").begins_with("teach#"),
                  "Limit": min(100, MAX_ROWS - scanned),
                  "ConsistentRead": True,
                  "ScanIndexForward": False}
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor
        page = table.query(**kwargs)
        items = page.get("Items", [])
        scanned += len(items)
        for item in items:
            rec = item.get("record", {})
            if not isinstance(rec, dict):
                continue
            current = (item.get("status") == "teacher-qa-approved"
                       and rec.get("ownerDelegatedTraining") is True
                       and rec.get("trainingEligible") is True
                       and rec.get("source") == "teacher-owner-delegated-qa"
                       and isinstance(rec.get("qa"), dict)
                       and rec["qa"].get("structurePassed") is True)
            # User's newly granted blanket delegation also applies to prior
            # successfully saved AI-mother lessons. Revalidate their structure
            # instead of pretending they were human-reviewed or bypassing QA.
            legacy = (item.get("status") == "teacher-reviewed-unverified"
                      and rec.get("source") == "teacher-auto-unverified")
            if (not (current or legacy) or rec.get("issue") not in LABELS
                or not isinstance(rec.get("original"), str)
                or len(rec["original"]) < 4
                or not isinstance(rec.get("revised"), str)
                or not 4 <= len(rec["revised"]) <= 1200
                or not isinstance(rec.get("projectId"), str)
                or not isinstance(rec.get("teacherReason"), str)
                or len(rec["teacherReason"]) < 12):
                continue
            if (rec["issue"] == "keep") != (rec["original"] == rec.get("revised")):
                continue
            group_key = (rec["projectId"], rec.get("episodeId"), rec.get("sceneId"),
                         rec["original"])
            if group_key in seen:
                continue
            seen.add(group_key)
            rows.append(rec if current else {**rec, "ownerDelegatedTraining": True,
                "trainingEligible": True, "qa": {"structurePassed": True,
                 "legacyDelegated": True, "contentHumanVerified": False}})
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            break
    return rows


def _features(row):
    def norm(t):
        return re.sub(r"\s+", " ", unicodedata.normalize(
            "NFC", str(t or "")).strip().lower())[:900]
    original, previous, next_ = (norm(row.get("original")),
                                  norm(row.get("previous"))[-150:],
                                  norm(row.get("next"))[:150])
    t = Counter()
    for prefix, source, weight in (("t:", original, 2),
                                   ("p:", previous, 1), ("n:", next_, 1)):
        for n in (2, 3):
            for i in range(max(0, len(source)-n+1)):
                piece = source[i:i+n]
                if " " not in piece and "\n" not in piece:
                    t[prefix+str(n)+":"+piece] += weight
    for flag, enabled in (
        ("long", len(original) > 95), ("short", len(original) < 38),
        ("pronoun", bool(re.search(r"เขา|เธอ|มัน|สิ่งนั้น|ตรงนั้น|นี่|นั้น", original))),
        ("transition", bool(re.search(r"หลัง|เมื่อ|เพราะ|จึง|ก่อน|ระหว่าง|ทันที", original))),
        ("repeat", bool(re.search(r"(?:มาก){2}|(?:อย่าง){2}|(?:ที่){2}|ได้มีการ|เนื่องจากว่า", original))),
        ("quote", bool(re.search(r'[“”"‘’]', original))),
        ("context", bool(previous and next_)),
        ("pause", bool(re.search(r"…|\.{2,}|—", original))),
        ("urgency", bool(re.search(r"!|ช่วยด้วย|เร็วเข้า|อย่าเพิ่ง", original))),
        ("uncertainty", bool(re.search(r"ไม่แน่ใจ|ยังไม่รู้|ไม่ทราบ|อาจจะ|เหมือนว่า", original))),
        ("flashback", bool(re.search(r"ความทรงจำ|ย้อน|วัยเด็ก|เมื่อก่อน", original))),
        ("mystery", bool(re.search(r"เงา|ไร้ชื่อ|ปริศนา|ไม่มีคำอธิบาย", original)))):
        if enabled:
            t["f:"+flag] += 2
    return t


def _fit(rows):
    counts = {l: Counter() for l in LABELS}
    docs = Counter()
    for row in rows:
        counts[row["issue"]].update(_features(row))
        docs[row["issue"]] += 1
    # Bound DynamoDB item size and overfitting by top capped features.
    vocab = set()
    classes = {}
    for l in LABELS:
        terms = dict(counts[l].most_common(100))
        vocab.update(terms)
        classes[l] = {"docs": docs[l], "total": sum(terms.values()), "tokens": terms}
    return {"task": "thai-narrative-edit-diagnosis", "schema": 1,
            "labels": list(LABELS), "vocabSize": len(vocab),
            "classes": classes, "source": "teacher-owner-delegated-qa",
            "notHumanFactChecked": True}


def _predict(model, row):
    f = _features(row)
    classes, vocab = model["classes"], max(1, model["vocabSize"])
    n = sum(classes[l]["docs"] for l in LABELS)
    scores = {}
    for l in LABELS:
        cls = classes[l]
        score = math.log((cls["docs"]+1)/(n+len(LABELS)))
        denominator = cls["total"]+vocab
        for key, count in f.items():
            score += count * math.log((1+cls["tokens"].get(key, 0))/denominator)
        scores[l] = score
    return max(LABELS, key=lambda k: scores[k])


def _read(table, key):
    from boto3.dynamodb.conditions import Key
    rows = table.query(KeyConditionExpression=Key("pk").eq(PK)
                       & Key("sk").eq(key), Limit=1,
                       ConsistentRead=True).get("Items", [])
    return rows[0].get("model") if rows else None


def train():
    """Exactly one model promotion when the experimental AI Mother pool is on.

    Legacy training is unchanged when the pool flag is off. The bounded
    DynamoDB lease is longer than the Lambda's configured 90-second timeout.
    All entry points (cloud + explicit student training) share this lock.
    """
    table = _table()
    if os.getenv("TEACHER_ENABLE_IDLE_POOL") != "1":
        return _train_impl(table)
    now, token = int(time.time()), uuid.uuid4().hex
    key = {"pk": PK, "sk": "training-lock"}
    try:
        table.update_item(
            Key=key,
            UpdateExpression="SET ownerToken=:token, leaseUntil=:until, updatedAt=:now",
            ConditionExpression="attribute_not_exists(pk) OR leaseUntil < :now",
            ExpressionAttributeValues={":token": token, ":until": now + 150,
                                       ":now": now})
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return _resp(200, {"trained": False, "activated": False,
                               "status": "training-busy"})
        raise
    try:
        return _train_impl(table)
    finally:
        # A stale owner must never clear a newer training lease.
        try:
            table.update_item(
                Key=key, UpdateExpression="SET leaseUntil=:until",
                ConditionExpression="ownerToken=:token",
                ExpressionAttributeValues={":token": token, ":until": 0})
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise


def _train_impl(table):
    rows = _rows(table)
    groups = sorted(set(r["projectId"] for r in rows))
    labels = Counter(x["issue"] for x in rows)
    counts = {"rows": len(rows), "projects": len(groups),
              "labels": dict(labels), "minimumProjects": 5,
              "minimumRows": 60, "minimumPerIssue": 8}
    if (len(groups) < 5 or len(rows) < 60
            or any(labels[k] < 8 for k in LABELS)):
        return _resp(200, {"trained": False, "activated": False,
                            "status": "collecting-diverse-teacher-lessons",
                            "counts": counts})
    held = set(groups[4::5]) or {groups[-1]}
    train_rows = [r for r in rows if r["projectId"] not in held]
    test_rows = [r for r in rows if r["projectId"] in held]
    train_labels = Counter(r["issue"] for r in train_rows)
    test_labels = Counter(r["issue"] for r in test_rows)
    if any(train_labels[k] < 5 or test_labels[k] < 1 for k in LABELS):
        return _resp(200, {"trained": False, "activated": False,
                            "status": "insufficient-class-coverage-in-holdout",
                            "counts": counts})
    fingerprint = hashlib.sha256(json.dumps(sorted(
        (r["projectId"],r["sceneId"],r["original"],r["issue"]) for r in rows),
        ensure_ascii=False).encode("utf-8")).hexdigest()
    prior = _read(table, "last-training")
    if prior and prior.get("fingerprint") == fingerprint:
        return _resp(200, {"trained": False, "activated": bool(prior.get("activated")),
                            "status": "unchanged-dataset", "version": prior.get("version"),
                            "counts": counts, "metrics": prior.get("metrics")})
    trial = _fit(train_rows)
    correct = sum(_predict(trial, r) == r["issue"] for r in test_rows)
    accuracy = correct/len(test_rows)
    majority = max(test_labels.values())/len(test_rows)
    qa = accuracy >= .70 and accuracy > majority
    model = _fit(rows)
    model["version"] = str(int(time.time()))+"-"+uuid.uuid4().hex[:8]
    model["status"] = "active-advisory" if qa else "rejected-by-holdout-qa"
    model["fingerprint"] = fingerprint
    model["activated"] = qa
    model["metrics"] = {"accuracy": round(accuracy,4),
                        "majorityBaseline": round(majority,4),
                        "trainRows": len(train_rows), "testRows": len(test_rows),
                        "projects": len(groups), "qaPassed": qa,
                        "groupDisjoint": True, "humanReviewed": False}
    table.put_item(Item={"pk": PK, "sk": "model#"+model["version"],
                         "status": model["status"],
                         "model": json.loads(json.dumps(model), parse_float=Decimal),
                         "createdAt": int(time.time())})
    table.put_item(Item={"pk": PK, "sk": "last-training",
                         "model": json.loads(json.dumps({
                             "fingerprint": fingerprint, "version": model["version"],
                             "activated": qa, "metrics": model["metrics"]}), parse_float=Decimal),
                         "status": "training-summary", "createdAt": int(time.time())})
    if qa:
        table.put_item(Item={"pk": PK, "sk": "active-model", "status": "active-advisory",
                             "model": json.loads(json.dumps(model), parse_float=Decimal),
                             "createdAt": int(time.time())})
    return _resp(200, {"trained": True, "activated": qa,
                       "status": "active-advisory" if qa else "qa-rejected",
                       "version": model["version"], "metrics": model["metrics"],
                       "counts": counts})



def status():
    """Read-only training progress and model history; never trains on view."""
    from boto3.dynamodb.conditions import Key
    table = _table()
    lessons = _rows(table)
    counts = Counter(r["issue"] for r in lessons)
    projects = len(set(r["projectId"] for r in lessons))
    last = _read(table, "last-training")
    active = _read(table, "active-model")
    result = table.query(
        KeyConditionExpression=Key("pk").eq(PK) &
                               Key("sk").begins_with("model#"),
        Limit=10, ScanIndexForward=False)
    models = []
    for row in result.get("Items", []):
        m = row.get("model")
        if isinstance(m, dict) and m.get("version"):
            models.append({"version": m["version"],
                           "status": row.get("status") or m.get("status"),
                           "metrics": m.get("metrics", {}),
                           "createdAt": row.get("createdAt")})
    return _resp(200, {
        "task": "thai-narrative-edit-diagnosis",
        "counts": {"rows": len(lessons), "projects": projects, "labels": dict(counts),
                   "minimumRows": 60, "minimumProjects": 5, "minimumPerIssue": 8},
        "readyForTraining": len(lessons) >= 60 and projects >= 5
                            and all(counts[l] >= 8 for l in LABELS),
        "lastTraining": last, "activeVersion": active.get("version") if active else None,
        "models": models, "notGenerative": True
    })



def model():
    active = _read(_table(), "active-model")
    return _resp(200, {"active": active, "task": "thai-narrative-edit-diagnosis",
                       "notGenerative": True})
