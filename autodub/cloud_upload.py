"""Resumable, server-authorized upload of AI Mother training scenes.

A large project is never sent to Lambda in one request. Each chunk is an
immutable, checked DynamoDB item. We only call cloud_jobs._start AFTER every
part is present and the complete scene list passes validation. A lost response
is safe to retry; no model request happens during upload.
"""
import hashlib
import json
import re
import time

import cloud_jobs

UPLOAD_PREFIX = "teacher-upload#"
UPLOAD_INDEX_PREFIX = "teacher-upload-index#"
UPLOAD_ID_PATTERN = re.compile(r"[a-f0-9]{32}\Z")
MAX_UPLOAD_BYTES_PER_PART = 150_000


def _key(upload_id, part=None):
    return {"pk": UPLOAD_PREFIX + upload_id,
            "sk": "meta" if part is None else "part#%05d" % part}


def _get(table, key):
    return table.get_item(Key=key, ConsistentRead=True).get("Item")


def _upload_id(body):
    value = body.get("uploadId")
    return value if isinstance(value, str) and UPLOAD_ID_PATTERN.fullmatch(value) else None


def _upload_index(owner, project):
    return {"pk": UPLOAD_INDEX_PREFIX + str(owner), "sk": "project#" + project}


def _find_upload(body, owner):
    project = body.get("projectId")
    if not isinstance(project, str) or not re.fullmatch(r"[A-Za-z0-9_-]{5,90}", project):
        return cloud_jobs._resp(400, {"error": "รหัสโปรเจกต์ไม่ถูกต้อง"})
    table = cloud_jobs._table()
    row = _get(table, _upload_index(owner, project))
    if not row:
        return cloud_jobs._resp(200, {"upload": None})
    meta = _get(table, _key(row.get("uploadId", "")))
    if not meta or str(meta.get("ownerId")) != str(owner):
        return cloud_jobs._resp(200, {"upload": None})
    return cloud_jobs._resp(200, {"upload": {
        "uploadId": meta["pk"][len(UPLOAD_PREFIX):],
        "projectId": project,
        "provider": meta["provider"],
        "connectionId": meta.get("connectionId") or "default-" + meta["provider"],
        "totalScenes": int(meta["totalScenes"])}})


def _verified(table, body, owner):
    upload_id = _upload_id(body)
    if not upload_id:
        return None
    item = _get(table, _key(upload_id))
    if not item or str(item.get("ownerId")) != str(owner):
        return None
    return item


def _parts(table, upload_id, count):
    """Return successful immutable parts, even when the last response was lost."""
    return [i for i in range(count) if _get(table, _key(upload_id, i))]


def _prepare(body, owner):
    upload_id = _upload_id(body)
    project_id, provider = body.get("projectId"), body.get("provider")
    connection_id = body.get("connectionId") or ("default-" + str(provider))
    story_name = re.sub(r"[\x00-\x1f\x7f]", " ", str(body.get("storyName") or "")).strip()[:100]
    total = body.get("totalScenes")
    if not upload_id or not isinstance(project_id, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{5,90}", project_id):
        return cloud_jobs._resp(400, {"error": "ข้อมูลโปรเจกต์หรือรหัสอัปโหลดไม่ถูกต้อง"})
    if provider not in ("gemini", "openrouter", "compatible"):
        return cloud_jobs._resp(400, {"error": "เลือก AI Provider ไม่ถูกต้อง"})
    if type(total) is not int or not 1 <= total <= cloud_jobs.MAX_SCENES:
        return cloud_jobs._resp(400, {"error": "จำนวนฉากเกินขอบเขต 1–350"})
    import teacher
    import teacher_connections
    status = json.loads(teacher._status()["body"])
    if connection_id == "default-" + provider:
        ready = any(p["id"] == provider and p["ready"] for p in status.get("providers", []))
    else:
        ready = teacher_connections.available(provider, connection_id)
    if not status.get("feedbackReady") or not ready:
        return cloud_jobs._resp(409, {"error": "ยังไม่ได้เชื่อม API Key นี้หรือฐานข้อมูลบทเรียน"})
    count = (total + cloud_jobs.CHUNK_SIZE - 1) // cloud_jobs.CHUNK_SIZE
    table = cloud_jobs._table()
    item = _get(table, _key(upload_id))
    if item:
        if (str(item.get("ownerId")) != str(owner)
                or item.get("projectId") != project_id or item.get("provider") != provider
                or (item.get("connectionId") or "default-" + provider) != connection_id
                or int(item.get("totalScenes", -1)) != total
                or int(item.get("partCount", -1)) != count):
            return cloud_jobs._resp(409, {"error": "พบรหัสอัปโหลดที่มีข้อมูลไม่ตรงกัน"})
    else:
        item = {"pk": UPLOAD_PREFIX + upload_id, "sk": "meta",
                "ownerId": str(owner), "projectId": project_id,
                "provider": provider, "connectionId": connection_id,
                "storyName": story_name,
                "totalScenes": total, "partCount": count,
                "createdAt": int(time.time())}
        try:
            table.put_item(Item=item, ConditionExpression="attribute_not_exists(pk)")
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            item = _get(table, _key(upload_id))
            if not item or str(item.get("ownerId")) != str(owner):
                return cloud_jobs._resp(409, {"error": "รหัสอัปโหลดนี้ถูกใช้งานแล้ว"})
    index_key = _upload_index(owner, project_id)
    old_index = _get(table, index_key)
    if old_index and old_index.get("uploadId") != upload_id:
        return cloud_jobs._resp(409, {
            "error": "โปรเจกต์นี้มีการอัปโหลดค้างด้วยการเชื่อมต่อเดิม กรุณาใช้คีย์เดิม"})
    if not old_index:
        try:
            table.put_item(Item={**index_key, "uploadId": upload_id,
                                 "createdAt": int(time.time())},
                           ConditionExpression="attribute_not_exists(pk)")
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            existing = _get(table, index_key)
            if not existing or existing.get("uploadId") != upload_id:
                return cloud_jobs._resp(409, {"error": "มีอัปโหลดโปรเจกต์นี้จากการเชื่อมต่ออื่น"})
    return cloud_jobs._resp(200, {"uploadId": upload_id, "partCount": count,
                                  "uploadedParts": _parts(table, upload_id, count),
                                  "chunkSize": cloud_jobs.CHUNK_SIZE})


def _chunk(body, owner):
    upload_id = _upload_id(body)
    if not upload_id:
        return cloud_jobs._resp(400, {"error": "รหัสอัปโหลดไม่ถูกต้อง"})
    table = cloud_jobs._table()
    manifest = _verified(table, body, owner)
    if not manifest:
        return cloud_jobs._resp(404, {"error": "ไม่พบชุดอัปโหลดที่ได้รับอนุญาต"})
    part = body.get("partIndex")
    count = int(manifest["partCount"])
    if type(part) is not int or not 0 <= part < count:
        return cloud_jobs._resp(400, {"error": "ลำดับส่วนข้อมูลไม่ถูกต้อง"})
    raw = body.get("scenes")
    if not isinstance(raw, list):
        return cloud_jobs._resp(400, {"error": "รูปแบบข้อมูลฉากไม่ถูกต้อง"})
    expected = min(cloud_jobs.CHUNK_SIZE,
                   int(manifest["totalScenes"]) - part * cloud_jobs.CHUNK_SIZE)
    if len(raw) != expected:
        return cloud_jobs._resp(400, {"error": "จำนวนฉากในชุดไม่ตรงกับรายการทั้งหมด"})
    try:
        scenes = cloud_jobs._validated_scenes(raw)
    except ValueError as exc:
        return cloud_jobs._resp(400, {"error": str(exc)})
    serialized = json.dumps(scenes, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if len(serialized.encode("utf-8")) > MAX_UPLOAD_BYTES_PER_PART:
        return cloud_jobs._resp(413, {"error": "แต่ละชุดต้องมีขนาดไม่เกิน 150 KB"})
    fingerprint = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    key = _key(upload_id, part)
    old = _get(table, key)
    if old:
        if old.get("sha256") == fingerprint and old.get("scenes") == scenes:
            return cloud_jobs._resp(200, {"partIndex": part, "alreadyUploaded": True})
        return cloud_jobs._resp(409, {"error": "ข้อมูลชุดนี้เปลี่ยนไป กรุณาใช้โปรเจกต์เวอร์ชันเดียวกัน"})
    try:
        table.put_item(Item={**key, "sha256": fingerprint, "scenes": scenes},
                       ConditionExpression="attribute_not_exists(pk)")
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        old = _get(table, key)
        if not old or old.get("sha256") != fingerprint or old.get("scenes") != scenes:
            return cloud_jobs._resp(409, {"error": "พบข้อมูลชุดที่ไม่ตรงกัน"})
    return cloud_jobs._resp(200, {"partIndex": part, "alreadyUploaded": False})


def _commit(body, owner):
    upload_id = _upload_id(body)
    if not upload_id:
        return cloud_jobs._resp(400, {"error": "รหัสอัปโหลดไม่ถูกต้อง"})
    table = cloud_jobs._table()
    item = _verified(table, body, owner)
    if not item:
        return cloud_jobs._resp(404, {"error": "ไม่พบงานที่ได้รับอนุญาต"})
    count = int(item["partCount"])
    all_scenes, missing = [], []
    for idx in range(count):
        part = _get(table, _key(upload_id, idx))
        if not part:
            missing.append(idx)
        else:
            all_scenes.extend(part["scenes"])
    if missing:
        return cloud_jobs._resp(409, {"error": "ยังอัปโหลดไม่ครบทุกส่วน",
                                      "missingParts": missing})
    if len(all_scenes) != int(item["totalScenes"]):
        return cloud_jobs._resp(409, {"error": "จำนวนฉากรวมไม่ตรงกัน"})
    try:
        scenes = cloud_jobs._validated_scenes(all_scenes)
    except ValueError as exc:
        return cloud_jobs._resp(400, {"error": str(exc)})
    # On a retry _start derives the same content digest and returns the existing
    # job. A duplicate upload cannot cause two simultaneous teacher executions.
    return cloud_jobs._start({"projectId": item["projectId"],
                              "provider": item["provider"],
                              "connectionId": item.get("connectionId"),
                              "storyName": item.get("storyName", ""),
                              "scenes": scenes}, owner)


def handle(action, body, owner):
    if action == "teacher.job.upload.find":
        return _find_upload(body, owner)
    if action == "teacher.job.upload.prepare":
        return _prepare(body, owner)
    if action == "teacher.job.upload.chunk":
        return _chunk(body, owner)
    if action == "teacher.job.upload.commit":
        return _commit(body, owner)
    return cloud_jobs._resp(400, {"error": "ไม่รู้จักคำสั่งอัปโหลด"})
