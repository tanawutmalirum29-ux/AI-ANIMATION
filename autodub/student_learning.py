"""Human-approved Thai narration learning loop for Story Studio.

This is a tiny CPU-trained text classifier, not a generative language model.
Only signed-in studio users can call this module (via authenticated handler.py).
Do not automatically promote or apply model outputs to authored scripts.
"""
import hashlib
import json
import math
import os
import re
import time
import unicodedata
import uuid
from decimal import Decimal
from collections import Counter

LABELS = ("keep", "remove", "review")
PK = "learning#thai-repetition-intent"
MIN_ROWS = 60
MIN_GROUPS = 5
MAX_LESSONS = 500


def _resp(code, value):
    return {"statusCode": code, "headers": {
        "Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(value, ensure_ascii=False, default=lambda v: float(v) if isinstance(v, Decimal) else str(v))}


def _table():
    name = os.environ.get("TEACHER_FEEDBACK_TABLE", "")
    if not name:
        raise RuntimeError("TEACHER_FEEDBACK_TABLE missing")
    import boto3
    return boto3.resource("dynamodb").Table(name)


def _key():
    from boto3.dynamodb.conditions import Key
    return Key("pk").eq(PK)


def _valid_project(value):
    return isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{5,90}", value) is not None


def _normalized(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value).strip().lower())


def _tokens(text, context=None):
    """Python/JavaScript feature parity: overlapping Thai/English character bigrams
    with explicit context tags; no external dependencies or GPU.
    """
    source = _normalized(text)[:500]
    gram = ["g:" + source[i:i + 2] for i in range(max(0, len(source) - 1))
            if " " not in source[i:i + 2]]
    tags = []
    for key in ("mode", "emotion", "situation"):
        value = str((context or {}).get(key) or "").strip().lower()[:30]
        if value:
            tags.append("c:" + key + ":" + value)
    return gram + tags


def _get_lessons(max_rows=MAX_LESSONS):
    from boto3.dynamodb.conditions import Key
    table = _table()
    items, cursor = [], None
    while len(items) < max_rows:
        kwargs = {"KeyConditionExpression": _key() & Key("sk").begins_with("lesson#"),
                  "ScanIndexForward": False, "Limit": min(150, max_rows - len(items))}
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor
        result = table.query(**kwargs)
        items.extend(result.get("Items", []))
        cursor = result.get("LastEvaluatedKey")
        if not cursor:
            break
    return items[:max_rows]


def _add_lesson(body):
    project = body.get("projectId")
    record = body.get("lesson")
    if not _valid_project(project) or not isinstance(record, dict):
        return _resp(400, {"error": "ข้อมูลโปรเจกต์หรือบทเรียนไม่ถูกต้อง"})
    text = record.get("text")
    label = record.get("label")
    if not isinstance(text, str) or not 4 <= len(text.strip()) <= 1000 or label not in LABELS:
        return _resp(400, {"error": "ต้องมีบทไทยและคำตอบ keep / remove / review"})
    if record.get("reviewedByOwner") is not True:
        return _resp(400, {"error": "ต้องได้รับการอนุมัติจากผู้ใช้ก่อนสอน AI ลูก"})
    context = record.get("context") or {}
    if not isinstance(context, dict):
        return _resp(400, {"error": "รูปแบบบริบทไม่ถูกต้อง"})
    context = {key: str(context.get(key) or "")[:30] for key in ("mode", "emotion", "situation")}
    result = {
        "text": text.strip(), "label": label, "context": context, "projectId": project,
        "sceneId": str(record.get("sceneId") or "")[:90],
        "episodeId": str(record.get("episodeId") or "")[:90],
        "studentDecision": str(record.get("studentDecision") or "")[:30],
        "teacherReason": str(record.get("teacherReason") or "")[:700],
        "ownerReason": str(record.get("ownerReason") or "")[:700],
        "source": "user-reviewed",
    }
    when = int(time.time())
    ident = "lesson#" + str(when).zfill(12) + "#" + str(uuid.uuid4())
    _table().put_item(Item={"pk": PK, "sk": ident, "record": result,
                            "createdAt": when, "status": "approved-for-training"})
    return _resp(200, {"saved": True, "lessonId": ident,
                       "storage": "AWS DynamoDB", "trained": False})


def _lessons(body):
    """Bounded, newest-first DynamoDB pagination for the private Studio memory UI.

    Search/filter runs client-side on already loaded pages; no table-wide scans.
    The cursor is an opaque-ish sort key, not arbitrary DynamoDB access.
    """
    from boto3.dynamodb.conditions import Key
    limit = body.get("limit", 120)
    cursor = body.get("cursor")
    if type(limit) is not int or not 1 <= limit <= 150:
        return _resp(400, {"error": "limit ต้องเป็น 1–150"})
    if cursor is not None and (not isinstance(cursor, str) or
                               not re.fullmatch(r"lesson#[0-9]{12}#[0-9a-f-]{36}", cursor)):
        return _resp(400, {"error": "cursor ไม่ถูกต้อง"})
    options = {
        "KeyConditionExpression": _key() & Key("sk").begins_with("lesson#"),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if cursor:
        options["ExclusiveStartKey"] = {"pk": PK, "sk": cursor}
    result = _table().query(**options)
    rows = []
    for item in result.get("Items", []):
        record = item.get("record")
        if item.get("status") != "approved-for-training" or not isinstance(record, dict):
            continue
        rows.append({"id": item["sk"], "createdAt": item.get("createdAt"),
                     **record})
    last = result.get("LastEvaluatedKey") or {}
    next_cursor = last.get("sk") if last.get("pk") == PK else None
    return _resp(200, {"lessons": rows, "nextCursor": next_cursor,
                       "trained": False, "pageLimit": limit})


def _filtered_rows(items):
    seen = set()
    rows = []
    for item in reversed(items):
        r = item.get("record", {})
        if item.get("status") != "approved-for-training" or not isinstance(r, dict):
            continue
        text, project, label = r.get("text"), r.get("projectId"), r.get("label")
        if not isinstance(text, str) or not _valid_project(project) or label not in LABELS:
            continue
        key = (project, _normalized(text), json.dumps(r.get("context") or {}, sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        rows.append(r)
    return rows


def _fit(rows):
    counts = {label: Counter() for label in LABELS}
    n = Counter()
    for row in rows:
        label = row["label"]
        counts[label].update(_tokens(row["text"], row.get("context")))
        n[label] += 1
    selected = {label: dict(counts[label].most_common(240)) for label in LABELS}
    vocab = len(set().union(*(set(m) for m in selected.values())))
    return {"task": "thai-repetition-intent", "schema": 1,
            "labels": list(LABELS), "vocab": vocab,
            "classes": {label: {
                "examples": n[label],
                "total": sum(selected[label].values()),
                "tokens": selected[label]} for label in LABELS}}


def _predict(model, text, context):
    grams = Counter(_tokens(text, context))
    classes = model["classes"]
    N = sum(classes[label]["examples"] for label in LABELS)
    scores = {}
    for label in LABELS:
        group = classes[label]
        score = math.log((group["examples"] + 1) / (N + len(LABELS)))
        den = group["total"] + max(1, model["vocab"])
        for term, count in grams.items():
            score += count * math.log((group["tokens"].get(term, 0) + 1) / den)
        scores[label] = score
    winner = max(LABELS, key=lambda l: scores[l])
    return winner


def _training():
    rows = _filtered_rows(_get_lessons())
    groups = sorted({r["projectId"] for r in rows})
    per_class = Counter(row["label"] for row in rows)
    counts = {"rows": len(rows), "stories": len(groups),
              "labels": dict(per_class), "requirements": {
                  "minRows": MIN_ROWS, "minStories": MIN_GROUPS, "minEachLabel": 10}}
    if len(rows) < MIN_ROWS or len(groups) < MIN_GROUPS or any(per_class[k] < 10 for k in LABELS):
        return _resp(409, {"error": "ข้อมูลมนุษย์อนุมัติยังไม่พอสำหรับฝึก",
                           "trained": False, "counts": counts})
    # Group-disjoint holdout: never put scenes from the same story in both sets.
    test_groups = set(groups[4::5])
    if not test_groups:
        test_groups = {groups[-1]}
    train = [r for r in rows if r["projectId"] not in test_groups]
    test = [r for r in rows if r["projectId"] in test_groups]
    train_labels = Counter(r["label"] for r in train)
    test_labels = Counter(r["label"] for r in test)
    if any(train_labels[k] < 5 for k in LABELS) or any(test_labels[k] < 1 for k in LABELS):
        return _resp(409, {"error": "ชุดทดสอบข้ามเรื่องไม่ครอบคลุมทั้ง 3 คำตอบ",
                           "trained": False, "counts": counts,
                           "testStories": len(test_groups)})
    holdout = _fit(train)
    predictions = [_predict(holdout, r["text"], r.get("context")) for r in test]
    correct = sum(p == row["label"] for p, row in zip(predictions, test))
    majority = max(test_labels.values()) / len(test)
    accuracy = correct / len(test)
    qa_passed = accuracy >= 0.70 and accuracy > majority
    # Fit final weights only after the holdout has been scored.
    model = _fit(rows)
    model["version"] = str(int(time.time())) + "-" + uuid.uuid4().hex[:8]
    model["status"] = "candidate"
    model["metrics"] = {
        "trainRows": len(train), "testRows": len(test),
        "stories": len(groups), "accuracy": round(accuracy, 4),
        "majorityBaseline": round(majority, 4), "qaPassed": qa_passed}
    sk = "model#" + model["version"]
    _table().put_item(Item={"pk": PK, "sk": sk, "model": json.loads(json.dumps(model), parse_float=Decimal),
                            "createdAt": int(time.time()), "status": "candidate"})
    return _resp(200, {"trained": True, "activated": False,
                       "candidate": {"version": model["version"], "metrics": model["metrics"]},
                       "message": "ฝึกน้ำหนัก CPU แล้ว แต่ยังไม่ใช้จริงจนกว่าจะผ่าน QA และกดอนุมัติ"})


def _read_model(sk):
    from boto3.dynamodb.conditions import Key
    result = _table().query(
        KeyConditionExpression=_key() & Key("sk").eq(sk), Limit=1)
    items = result.get("Items") or []
    return items[0].get("model") if items else None


def _model(body):
    active = _read_model("active")
    version = body.get("version")
    candidate = None
    if isinstance(version, str) and re.fullmatch(r"[0-9]{8,12}-[a-f0-9]{8}", version):
        candidate = _read_model("model#" + version)
    return _resp(200, {"active": active, "candidate": candidate})


def _candidates():
    from boto3.dynamodb.conditions import Key
    result = _table().query(
        KeyConditionExpression=_key() & Key("sk").begins_with("model#"),
        ScanIndexForward=False, Limit=10)
    summaries = []
    for item in result.get("Items", []):
        model = item.get("model") or {}
        if model.get("version"):
            summaries.append({"version": model["version"],
                              "metrics": model.get("metrics", {}),
                              "status": model.get("status", "candidate")})
    return _resp(200, {"candidates": summaries})


def _activate(body):
    version = str(body.get("version") or "")
    if not re.fullmatch(r"[0-9]{8,12}-[a-f0-9]{8}", version) or body.get("approvedByOwner") is not True:
        return _resp(400, {"error": "ต้องระบุเวอร์ชันและยืนยันอนุมัติจากผู้ใช้"})
    candidate = _read_model("model#" + version)
    if not candidate or candidate.get("metrics", {}).get("qaPassed") is not True:
        return _resp(409, {"error": "โมเดลยังไม่ผ่าน QA จึงห้ามนำขึ้นใช้งาน"})
    model = {**candidate, "status": "active-advisory"}
    _table().put_item(Item={"pk": PK, "sk": "active", "model": model,
                            "status": "active-advisory", "createdAt": int(time.time())})
    return _resp(200, {"activated": True, "version": version,
                       "mode": "advisory-only-no-auto-script-edit"})


def handle(action, body):
    try:
        if action == "student.lesson":
            return _add_lesson(body)
        if action == "student.lessons":
            return _lessons(body)
        if action == "student.train":
            return _training()
        if action == "student.model":
            return _model(body)
        if action == "student.activate":
            return _activate(body)
        if action == "student.candidates":
            return _candidates()
    except Exception as exc:
        # Never leak raw text, storage contents, environment variables or API keys.
        return _resp(503, {"error": "AI Student service unavailable: " + type(exc).__name__})
    return _resp(400, {"error": "Unknown student action"})
