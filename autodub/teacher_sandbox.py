"""Owner-only isolated AI Mother rehearsal and durable report history.

Never call _auto_teach, cloud_jobs, story_auto_train, or student_learning here.
The rehearsal may call the configured provider, but cannot write real lessons
or activate a child model. Reports use a separate DynamoDB partition.
"""
import json
import os
import re
import time
import uuid
from decimal import Decimal

MAX_SCENES = 3
OWNER_ID = "225819900"
PK = "teacher-sandbox-report#" + OWNER_ID


def _resp(code, value):
    return {"statusCode": code, "headers": {"Content-Type": "application/json",
            "Cache-Control": "no-store"},
            "body": json.dumps(value, ensure_ascii=False,
                               default=lambda x: int(x) if isinstance(x, Decimal) and x % 1 == 0
                               else float(x) if isinstance(x, Decimal) else str(x))}


def _table():
    import boto3
    # Optional physical isolation. Without a dedicated table, the reserved
    # partition is logically isolated from production learning/model keys.
    name = os.getenv("TEACHER_SANDBOX_TABLE") or os.getenv("TEACHER_FEEDBACK_TABLE")
    if not name:
        raise RuntimeError("No sandbox-compatible DynamoDB table")
    return boto3.resource("dynamodb").Table(name)


def _safe_scenes(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_SCENES:
        raise ValueError("เลือกฉากทดสอบ 1–3 ฉาก")
    scenes, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("ข้อมูลฉากทดสอบไม่ถูกต้อง")
        scene_id = item.get("id")
        narration = item.get("text")
        if (not isinstance(scene_id, str) or not re.fullmatch(r"[\w-]{1,70}", scene_id)
                or scene_id in seen or not isinstance(narration, str)
                or not 4 <= len(narration.strip()) <= 1200):
            raise ValueError("ฉากซ้ำหรือบทพากย์ยาวเกินกำหนด")
        seen.add(scene_id)
        scenes.append({"id": scene_id, "text": narration.strip()})
    return scenes


def _run(body):
    import teacher
    import teacher_connections
    provider = str(body.get("provider") or "")
    connection = body.get("connectionId")
    if provider not in teacher.PROVIDERS or not isinstance(connection, str):
        return _resp(400, {"error": "กรุณาเลือก AI แม่ที่เชื่อมไว้"})
    try:
        scenes = _safe_scenes(body.get("scenes"))
    except ValueError as exc:
        return _resp(400, {"error": str(exc)})
    if not teacher_connections.resolve(teacher._settings(), provider, connection).get("key"):
        return _resp(409, {"error": "AI แม่ที่เลือกไม่พร้อม"})
    # No provider API secret or original system settings enter a report.
    context = json.dumps({"scenes": scenes}, ensure_ascii=False)
    request = ("Review these Thai narration scenes for editorial quality. "
               "Return one teachingLessons record per scene in the required JSON format. "
               "This is a DRY RUN: do not claim to save, train or approve anything.")
    response = teacher._chat({"provider": provider, "connectionId": connection,
                              "message": request, "context": context,
                              "history": [], "_internalMaxOutput": 1800},
                             teach_mode=True)
    status = response["statusCode"]
    payload = json.loads(response.get("body") or "{}")
    accepted_ids = {x["id"] for x in scenes}
    proposed = []
    if status == 200:
        for row in payload.get("teachingLessons", []):
            if (isinstance(row, dict) and row.get("sceneId") in accepted_ids
                    and isinstance(row.get("revised"), str)
                    and isinstance(row.get("reason"), str)):
                proposed.append({"sceneId": row["sceneId"],
                                 "issue": str(row.get("issue") or "")[:40],
                                 "revised": row["revised"][:1200],
                                 "reason": row["reason"][:600]})
    now = int(time.time())
    report_id = uuid.uuid4().hex
    record = {
        "reportId": report_id, "workspace": "sandbox", "mode": "teacher-dry-run",
        "createdAt": now, "provider": provider, "connectionId": connection,
        "statusCode": status, "state": "ok" if status == 200 else "provider-error",
        "scenes": scenes, "proposals": proposed,
        "reasonCode": str(payload.get("reasonCode") or "")[:100],
        "error": str(payload.get("error") or "")[:160] if status != 200 else "",
        "writesToProductionLessons": False, "trainedChildModel": False
    }
    try:
        _table().put_item(Item={"pk": PK, "sk": "report#" + str(now).zfill(12) +
                          "#" + report_id, "record": record, "createdAt": now},
                          ConditionExpression="attribute_not_exists(pk)")
    except Exception:
        # Report persistence is mandatory: never claim a successful sandbox
        # experiment if evidence could not be saved in durable storage.
        return _resp(503, {"error": "บันทึกผลทดสอบแยกบน AWS ไม่สำเร็จ กรุณาลองใหม่"})
    return _resp(200, {"report": record, "saved": True})


def _list():
    from boto3.dynamodb.conditions import Key
    page = _table().query(KeyConditionExpression=Key("pk").eq(PK)
                          & Key("sk").begins_with("report#"),
                          ScanIndexForward=False, Limit=20, ConsistentRead=True)
    summaries = []
    for item in page.get("Items", []):
        record = item.get("record")
        if not isinstance(record, dict):
            continue
        summaries.append({key: record.get(key) for key in
                          ("reportId", "createdAt", "provider", "connectionId",
                           "state", "statusCode", "reasonCode")})
    return _resp(200, {"workspace": "sandbox", "reports": summaries})


def _get(body):
    from boto3.dynamodb.conditions import Key
    report_id = body.get("reportId")
    if not isinstance(report_id, str) or not re.fullmatch(r"[0-9a-f]{32}", report_id):
        return _resp(400, {"error": "หมายเลขรายงานไม่ถูกต้อง"})
    # Querying within the owner sandbox partition only, never production data.
    response = _table().query(
        KeyConditionExpression=Key("pk").eq(PK) &
                               Key("sk").begins_with("report#"),
        ScanIndexForward=False, ConsistentRead=True, Limit=100)
    for item in response.get("Items", []):
        record = item.get("record")
        if isinstance(record, dict) and record.get("reportId") == report_id:
            return _resp(200, {"report": record})
    return _resp(404, {"error": "ไม่พบรายงานในรายการล่าสุด"})


def handle(action, body, owner):
    if str(owner) != OWNER_ID:
        return _resp(403, {"error": "พื้นที่ทดสอบสำหรับแอดมินเท่านั้น"})
    if action == "teacher.sandbox.run":
        return _run(body)
    if action == "teacher.sandbox.list":
        return _list()
    if action == "teacher.sandbox.get":
        return _get(body)
    return _resp(400, {"error": "ไม่รู้จักคำสั่งพื้นที่ทดสอบ"})
