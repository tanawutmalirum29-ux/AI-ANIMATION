"""Thai editorial child v0.1: a *small, real* CPU text classifier.

Trained deterministically from original synthetic Thai narration exercises.
It identifies candidates for owner review; it is NOT a generative model, a
Thai dictionary, or a fully validated spelling corrector. No action applies
a revision to the source project. Member release v1 remains frozen.

New human-confirmed examples are retained for a future gated retrain; they are
NOT silently mixed into the frozen baseline or claimed as weight updates.
"""
import hashlib
import json
import math
import os
import re
import time
import unicodedata
import uuid
from collections import Counter
from functools import lru_cache

LABELS = ("typo", "awkward", "fluency", "intentional", "keep")
TRAINING_DATA = os.path.join(os.path.dirname(__file__), "thai_editor_starter_v1.json")
PK = "learning#thai-editor-owner-reviewed"
MAX_SCENES = 18

# Only obvious spelling slips; ambiguous colloquial language is not in this list.
# All corrections are suggestions requiring explicit approval.
SAFE_TYPO_PAIRS = (
    ("งสนนี้", "งานนี้"), ("คณุ", "คุณ"), ("โรงเรยน", "โรงเรียน"),
    ("ใม่", "ไม่"), ("รู็", "รู้"), ("เสยีง", "เสียง"),
    ("พรุ้งนี้", "พรุ่งนี้"), ("ถุก", "ถูก"), ("ไดั", "ได้"),
    ("เกดิ", "เกิด"), ("เครี่อง", "เครื่อง"), ("พยายม", "พยายาม"),
    ("แผนทึ่", "แผนที่"), ("ถนนลึ่น", "ถนนลื่น"),
    ("กฏหมาย", "กฎหมาย"), ("สบัด", "สะบัด"),
    ("ปฎิเสธ", "ปฏิเสธ"), ("สำคัน", "สำคัญ"),
    ("เหตการณ์", "เหตุการณ์"), ("สถาณการณ์", "สถานการณ์"),
    ("ลายเซ็นต์", "ลายเซ็น"), ("อนุญาติ", "อนุญาต"),
    ("ประสบการทำงาน", "ประสบการณ์ทำงาน"),
    ("เมืิ่อ", "เมื่อ"),
)
INTENTIONAL = re.compile(
    r"(?:\bเอ่อ\b|\bฮึก\b|เอ็ง|เว้ย|อ่ะ|อึก|โถเอ๋ย|"
    r"(?:ไม่|ช่วยด้วย|หยุด|แม่|พอ|จริง|อย่า|แย่แล้ว|ใช่|ยัง|รอ|ขอร้อง)[ \u00a0]+"
    r"(?:ไม่|ช่วยด้วย|หยุด|แม่|พอ|จริง|อย่า|แย่แล้ว|ใช่|ยัง|รอ|ขอร้อง)|"
    r"ฉัน[ \u00a0]+ฉัน|[.]{3,})"
)
ISSUE_LABELS = {
    "typo": "คำสะกดผิด", "awkward": "คำแปลกตามบริบท",
    "fluency": "ประโยคไม่เป็นธรรมชาติ",
    "intentional": "ภาษาหรือคำซ้ำที่ตั้งใจใช้",
    "keep": "ยังไม่พบเหตุผลชัดเจนให้แก้", "review": "ต้องตรวจด้วยบริบทเพิ่มเติม",
}


def _resp(code, obj):
    return {"statusCode": code, "headers": {"Content-Type": "application/json",
            "Cache-Control": "no-store"},
            "body": json.dumps(obj, ensure_ascii=False)}


def _normalize(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value or "")).strip().lower())


def _features(row):
    """Thai char n-grams + local causal context; small bounded CPU features."""
    features = Counter()
    for kind, raw, multiplier in (
            ("t", row.get("original", row.get("text", "")), 2),
            ("p", row.get("previous", ""), 1),
            ("n", row.get("next", ""), 1)):
        value = _normalize(raw)[:480 if kind == "t" else 90]
        for width in (2, 3):
            for i in range(max(0, len(value) - width + 1)):
                token = value[i:i + width]
                if " " not in token:
                    features[kind + str(width) + ":" + token] += multiplier
    text = _normalize(row.get("original", row.get("text", "")))
    for bad, _ in SAFE_TYPO_PAIRS:
        if bad in text:
            features["flag:known-typo"] += 5
            break
    if INTENTIONAL.search(text):
        features["flag:intentional-speech"] += 5
    if re.search(r"ได้ทำการ|ในเวลาขณะนี้|เพราะว่าเนื่องจาก|มีความรู้สึกว่า", text):
        features["flag:verbose"] += 5
    if re.search(r"เดินเดิน|ซ้ำซ้อน|กลับย้อนกลับ|เริ่มต้นทำการ", text):
        features["flag:repetition"] += 4
    if row.get("previous") and row.get("next"):
        features["flag:has-context"] += 1
    return features


def _fit(rows):
    counts = {label: Counter() for label in LABELS}
    docs = Counter()
    for row in rows:
        label = row["issue"]
        if label not in LABELS:
            continue
        docs[label] += 1
        counts[label].update(_features(row))
    classes, vocab = {}, set()
    for label in LABELS:
        tokens = dict(counts[label].most_common(240))
        vocab.update(tokens)
        classes[label] = {"docs": docs[label],
                          "tokens": tokens, "total": sum(tokens.values())}
    return {"classes": classes, "vocab": len(vocab),
            "labels": list(LABELS), "trainRows": sum(docs.values())}


def _predict(model, row):
    feats = _features(row)
    total_docs = max(1, sum(c["docs"] for c in model["classes"].values()))
    scores = {}
    for label in LABELS:
        cls = model["classes"][label]
        denom = cls["total"] + max(1, model["vocab"])
        score = math.log((cls["docs"] + 1) / (total_docs + len(LABELS)))
        for token, count in feats.items():
            score += count * math.log((cls["tokens"].get(token, 0) + 1) / denom)
        scores[label] = score
    ranked = sorted(scores, key=scores.get, reverse=True)
    return ranked[0], round(scores[ranked[0]] - scores[ranked[1]], 3)


@lru_cache(maxsize=1)
def _baseline():
    with open(TRAINING_DATA, encoding="utf-8") as f:
        dataset = json.load(f)
    rows = dataset["rows"]
    if len(rows) < 100 or set(x["issue"] for x in rows) != set(LABELS):
        raise ValueError("Insufficient Thai editor curriculum coverage")
    groups = set(dataset["split"]["holdoutGroups"])
    train = [x for x in rows if x["group"] not in groups]
    held = [x for x in rows if x["group"] in groups]
    if not train or not held or set(x["group"] for x in train) & set(x["group"] for x in held):
        raise ValueError("Story-group holdout is not independent")
    model = _fit(train)
    correct = sum(_predict(model, x)[0] == x["issue"] for x in held)
    majority = max(Counter(x["issue"] for x in held).values()) / len(held)
    source_hash = hashlib.sha256(json.dumps(rows, ensure_ascii=False,
                               sort_keys=True).encode()).hexdigest()
    model["version"] = "thai-editor-cpu-starter-v1-" + source_hash[:10]
    model["metrics"] = {
        "trainRows": len(train), "holdoutRows": len(held),
        "storyGroupsTrain": len({x["group"] for x in train}),
        "storyGroupsHoldout": len(groups),
        "holdoutAccuracy": round(correct / len(held), 3),
        "majorityBaseline": round(majority, 3),
        "holdoutIsSynthetic": True,
        "confidenceCalibrated": False,
        "externalRealWorldValidated": False,
        "baselineTrainedCPU": True,
    }
    return model


def _suggest(row, model):
    original = row["text"].strip()
    input_context = {"original": original, "previous": row.get("previous", ""),
                     "next": row.get("next", "")}
    prediction, margin = _predict(model, input_context)
    # Rules have higher priority than a small poorly calibrated model.
    label, revised, source = prediction, None, "experimental-cpu-naive-bayes"
    for wrong, right in SAFE_TYPO_PAIRS:
        if wrong in original:
            revised = original.replace(wrong, right)
            label, source = "typo", "conservative-lexical-rule"
            break
    else:
        if INTENTIONAL.search(original):
            label, source = "intentional", "conservative-preserve-rule"
        elif label not in ("intentional", "keep") and margin < 2:
            label = "review"
    reason = {
        "typo": "พบรูปสะกดที่อยู่ในชุดคำผิดตัวอย่าง โปรดตรวจเจตนาผู้เขียนก่อนรับ",
        "awkward": "รูปคำอาจไม่เข้ากับเหตุการณ์ ต้องอ่านเรื่องก่อนและหลังเพื่อตัดสิน",
        "fluency": "โครงสร้างประโยคอาจซ้ำซ้อนหรือขาดความลื่นไหล ควรเกลาโดยไม่เปลี่ยนใจความ",
        "intentional": "มีสัญญาณภาษาพูดหรือคำซ้ำเชิงอารมณ์ ควรรักษาความตั้งใจเดิม",
        "keep": "ยังไม่พบสัญญาณที่เพียงพอให้เปลี่ยนข้อความ",
        "review": "โมเดลตัวอย่างยังไม่แน่ใจว่าควรแก้หรือเก็บ ต้องใช้หลักฐานจากบริบทเพิ่มเติม",
    }[label]
    return {"sceneId": row["id"], "episodeId": row["episodeId"],
            "original": original, "suggested": revised if revised and revised != original else None,
            "issue": label, "issueName": ISSUE_LABELS[label], "reason": reason,
            "source": source, "modelMargin": margin,
            "confidenceCalibrated": False, "requiresHumanReview": True,
            "appliedToProject": False}


def _validated_scenes(body):
    scenes = body.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= MAX_SCENES:
        raise ValueError("กรุณาส่งบทครั้งละ 1–18 ฉาก")
    valid = []
    seen = set()
    for item in scenes:
        if not isinstance(item, dict):
            raise ValueError("ข้อมูลฉากไม่ถูกต้อง")
        scene_id = item.get("id")
        text = item.get("text")
        if (not isinstance(scene_id, str) or not 1 <= len(scene_id) <= 100
                or scene_id in seen or not isinstance(text, str)
                or not 4 <= len(text.strip()) <= 1200):
            raise ValueError("รหัสฉากหรือข้อความไม่ถูกต้อง")
        seen.add(scene_id)
        before, after = item.get("previous", ""), item.get("next", "")
        if any(not isinstance(v, str) or len(v) > 350 for v in (before, after)):
            raise ValueError("บริบทก่อนหรือหลังยาวเกิน 350 ตัวอักษร")
        valid.append({"id": scene_id, "text": text,
                      "episodeId": str(item.get("episodeId") or "")[:90],
                      "previous": before, "next": after})
    return valid


def _table():
    import boto3
    name = os.environ.get("TEACHER_FEEDBACK_TABLE")
    if not name:
        return None
    return boto3.resource("dynamodb").Table(name)


def status():
    model = _baseline()
    return _resp(200, {"task": "thai-script-editor-advisory",
                       "status": "starter-trained-experimental",
                       "version": model["version"],
                       "labels": list(LABELS),
                       "metrics": model["metrics"], "canAutoApply": False,
                       "trainedExternalLLMWeights": False,
                       "reviewedByOwner": False,
                       "trainingOrigin": "120 original synthetic examples / 12 story groups",
                       "note": "บทเรียนตัวอย่างเป็นข้อมูลสังเคราะห์ ไม่ใช่คำรับรองของผู้ใช้; โมเดล CPU ทดลองเท่านั้น"})


def review(body):
    try:
        scenes = _validated_scenes(body)
    except ValueError as exc:
        return _resp(400, {"error": str(exc)})
    model = _baseline()
    return _resp(200, {"task": "thai-script-editor-advisory",
                       "modelVersion": model["version"],
                       "trainedExternalLLMWeights": False,
                       "advisoryOnly": True, "suggestions": [_suggest(s, model) for s in scenes]})


def feedback(body):
    """Only explicit owner approval; no auto-apply and no silent weight update."""
    project = body.get("projectId")
    if not isinstance(project, str) or not re.fullmatch(r"[A-Za-z0-9_-]{5,90}", project):
        return _resp(400, {"error": "ยังไม่มีรหัสโปรเจกต์ที่ถูกต้อง"})
    lesson = body.get("lesson")
    if not isinstance(lesson, dict) or lesson.get("reviewedByOwner") is not True:
        return _resp(400, {"error": "ต้องให้เจ้าของยืนยันตัวอย่างก่อนบันทึก"})
    original = lesson.get("original")
    revised = lesson.get("revised")
    label = lesson.get("issue")
    if (label not in LABELS or not isinstance(original, str)
            or not isinstance(revised, str) or not 4 <= len(original) <= 1200
            or not 4 <= len(revised) <= 1200):
        return _resp(400, {"error": "ข้อมูลคำแก้ไขไม่ถูกต้อง"})
    if (label in ("keep", "intentional")) != (original == revised):
        return _resp(400, {"error": "คำที่ควรเก็บต้องเท่าต้นฉบับ คำที่ควรแก้ต้องต่างจากต้นฉบับ"})
    before, after = lesson.get("previous", ""), lesson.get("next", "")
    if any(not isinstance(x, str) or len(x) > 350 for x in (before, after)):
        return _resp(400, {"error": "ข้อความบริบทยาวเกินไป"})
    table = _table()
    if table is None:
        return _resp(503, {"error": "ยังไม่ตั้งค่า DynamoDB สำหรับเก็บบทเรียน"})
    ident = "lesson#" + str(int(time.time())).zfill(12) + "#" + uuid.uuid4().hex
    table.put_item(Item={"pk": PK, "sk": ident, "status": "owner-approved-pending-retrain",
                         "record": {"projectId": project, "sceneId": str(lesson.get("sceneId") or "")[:100],
                                    "original": original, "revised": revised,
                                    "previous": before, "next": after, "issue": label,
                                    "reviewedByOwner": True,
                                    "source": "owner-confirmed-editor-example",
                                    "usedForWeightTraining": False},
                         "createdAt": int(time.time())})
    return _resp(200, {"saved": True, "lessonId": ident,
                       "usedForWeightTraining": False,
                       "note": "บันทึกบทเรียนที่เจ้าของยืนยันไว้สำหรับการฝึกรอบถัดไป ไม่ได้ปรับน้ำหนักทันที"})


def handle(action, body):
    if action == "editor.status":
        return status()
    if action == "editor.review":
        return review(body)
    if action == "editor.feedback":
        return feedback(body)
    return _resp(400, {"error": "ไม่รู้จักคำสั่งบรรณาธิการ"})


if __name__ == "__main__":
    report = json.loads(status()["body"])
    print(json.dumps(report, ensure_ascii=False, indent=2))
