"""Durable owner-only AI Mother jobs. Step Functions waits between Lambda batches.
Data/checkpoints live in the existing teacher DynamoDB table, not in the browser.
No provider API key is ever copied into a job record or Step Functions state.
"""
import hashlib
import json
import os
import re
import time
import uuid
from decimal import Decimal

MAX_SCENES = 350
CHUNK_SIZE = 16
MAX_PASSES = 3
STATES = ("queued", "running", "paused", "needs-attention", "completed", "cancelled")
JOB_PREFIX = "teacher-job#"
INDEX_PREFIX = "teacher-job-index#"


def _json_number(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Invalid stored numeric value")
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError("Unsupported JSON value")


def _resp(code, data):
    return {"statusCode": code, "headers": {
        "Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(data, ensure_ascii=False, default=_json_number)}


def enabled():
    return bool(os.getenv("TEACHER_FEEDBACK_TABLE") and
                os.getenv("TEACHER_JOB_STATE_MACHINE_ARN"))


def _table():
    import boto3
    return boto3.resource("dynamodb").Table(os.environ["TEACHER_FEEDBACK_TABLE"])


def _key(job_id):
    return {"pk": JOB_PREFIX + job_id, "sk": "meta"}


def _read(table, job_id):
    return table.get_item(Key=_key(job_id), ConsistentRead=True).get("Item")


def _public(item):
    if not item:
        return None
    completed = len(item.get("completedIndices", []))
    total = int(item.get("total", 0))
    return {"jobId": item["jobId"], "projectId": item["projectId"],
            "state": item["state"], "total": total, "completed": completed,
            "remaining": max(0, total - completed),
            "pass": int(item.get("pass", 0)) + 1,
            "saved": int(item.get("saved", 0)), "reused": int(item.get("reused", 0)),
            "createdAt": int(item["createdAt"]),
            "updatedAt": int(item["updatedAt"]),
            "error": str(item.get("lastError", ""))[:240],
            "provider": item["provider"],
            "trainingStatus": item.get("trainingStatus"),
            "cloud": True}


def _validated_scenes(items):
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_SCENES:
        raise ValueError("ต้องมีบทพากย์ 1–350 ฉากต่อหนึ่งงาน")
    out, seen = [], set()
    for x in items:
        if not isinstance(x, dict):
            raise ValueError("ข้อมูลฉากไม่ถูกต้อง")
        sid, text = x.get("id"), x.get("text")
        if (not isinstance(sid, str) or not 1 <= len(sid) <= 100 or sid in seen
                or not isinstance(text, str) or not 4 <= len(text.strip()) <= 1200):
            raise ValueError("พบ Scene ID ซ้ำหรือบทพากย์ไม่ถูกต้อง")
        seen.add(sid)
        previous, next_ = x.get("previous", ""), x.get("next", "")
        if not isinstance(previous, str) or not isinstance(next_, str):
            raise ValueError("บริบทฉากต้องเป็นข้อความ")
        out.append({"id": sid, "episodeId": str(x.get("episodeId") or "")[:90],
                    "text": text.strip(), "previous": previous[:350],
                    "next": next_[:350], "studentIssue":
                    str(x.get("studentIssue") or "review")[:40]})
    # An entire project is NOT one DynamoDB item. Each input item holds 16
    # scenes, safely below DynamoDB's 400 KB per-item limit. Keep a bounded
    # aggregate cap beneath the synchronous Lambda request ceiling instead.
    if len(json.dumps(out, ensure_ascii=False).encode("utf-8")) > 4_000_000:
        raise ValueError("โปรเจกต์เกินขนาดรวม 4 MB กรุณาแบ่งเป็นหลายงาน")
    return out


def _launch(table, item):
    """One deterministic execution per job generation, safe on lost API responses."""
    import boto3
    arn = os.environ["TEACHER_JOB_STATE_MACHINE_ARN"]
    name = "teach-" + item["jobId"] + "-" + str(item["generation"])
    execution_arn = arn.replace(":stateMachine:", ":execution:") + ":" + name
    try:
        boto3.client("stepfunctions").start_execution(
            stateMachineArn=arn, name=name,
            input=json.dumps({"jobId": item["jobId"],
                              "generation": int(item["generation"])}))
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ExecutionAlreadyExists":
            raise
    table.update_item(Key=_key(item["jobId"]),
                      UpdateExpression="SET executionArn=:arn, updatedAt=:now",
                      ConditionExpression="generation=:gen",
                      ExpressionAttributeValues={
                          ":arn": execution_arn, ":gen": int(item["generation"]),
                          ":now": int(time.time())})
    return execution_arn


def _start(body, owner):
    if not enabled():
        return _resp(503, {"error": "Background Jobs ยังไม่ได้ติดตั้งบน AWS"})
    project_id = body.get("projectId")
    provider = body.get("provider")
    if not isinstance(project_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{5,90}", project_id):
        return _resp(400, {"error": "รหัสโปรเจกต์ไม่ถูกต้อง"})
    if provider not in ("gemini", "openrouter", "compatible"):
        return _resp(400, {"error": "AI Provider ไม่ถูกต้อง"})
    try:
        scenes = _validated_scenes(body.get("scenes"))
    except ValueError as exc:
        return _resp(400, {"error": str(exc)})
    import teacher
    status = json.loads(teacher._status()["body"])
    if not status.get("feedbackReady") or not any(
            p["id"] == provider and p["ready"] for p in status["providers"]):
        return _resp(409, {"error": "ยังไม่ได้เชื่อม API แม่หรือฐานข้อมูลบทเรียน"})
    digest = hashlib.sha256(json.dumps(
        [str(owner), project_id, provider, scenes],
        ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()[:32]
    table = _table()
    existing = _read(table, digest)
    if existing:
        if existing["ownerId"] != str(owner):
            return _resp(403, {"error": "ไม่อนุญาต"})
        if existing["state"] == "queued" and not existing.get("executionArn"):
            try:
                _launch(table, existing)
            except Exception:
                return _resp(503, {"error": "ยังเปิดคิว AWS ไม่สำเร็จ ลองกดเริ่มงานอีกครั้ง"})
        return _resp(200, {"job": _public(_read(table, digest)), "existing": True})
    now = int(time.time())
    pk = JOB_PREFIX + digest
    # Input chunks are immutable; only publish meta after all chunks were saved.
    for start in range(0, len(scenes), CHUNK_SIZE):
        table.put_item(Item={"pk": pk, "sk": "input#%05d" % (start // CHUNK_SIZE),
                             "scenes": scenes[start:start + CHUNK_SIZE]})
    item = {"pk": pk, "sk": "meta", "jobId": digest,
            "ownerId": str(owner), "projectId": project_id, "provider": provider,
            "state": "queued", "generation": 0, "total": len(scenes),
            "work": list(range(len(scenes))), "position": 0, "pass": 0,
            "completedIndices": [], "failedIndices": [], "saved": 0, "reused": 0,
            "throttles": 0, "createdAt": now, "updatedAt": now,
            "lastError": "", "leaseUntil": 0}
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(pk)")
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        item = _read(table, digest)
    table.put_item(Item={"pk": INDEX_PREFIX + str(owner),
                         "sk": "job#" + str(now).zfill(12) + "#" + digest,
                         "jobId": digest, "projectId": project_id, "createdAt": now})
    try:
        _launch(table, item)
    except Exception:
        return _resp(503, {"error": "บันทึกงานบน AWS แล้ว แต่เปิดคิวไม่สำเร็จ กดเริ่มอีกครั้งได้"})
    return _resp(200, {"job": _public(_read(table, digest)), "existing": False})


def _authorized_job(body, owner):
    job_id = body.get("jobId")
    if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
        return None, None
    table = _table()
    item = _read(table, job_id)
    if not item or item.get("ownerId") != str(owner):
        return table, None
    return table, item


def _find(body, owner):
    project_id = body.get("projectId")
    if not isinstance(project_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{5,90}", project_id):
        return _resp(400, {"error": "รหัสโปรเจกต์ไม่ถูกต้อง"})
    from boto3.dynamodb.conditions import Key
    table = _table()
    rows = table.query(KeyConditionExpression=Key("pk").eq(INDEX_PREFIX + str(owner)),
                       ScanIndexForward=False, Limit=40).get("Items", [])
    for row in rows:
        if row.get("projectId") == project_id:
            item = _read(table, row["jobId"])
            if item and item.get("ownerId") == str(owner):
                return _resp(200, {"job": _public(item)})
    return _resp(200, {"job": None})


def _control(action, body, owner):
    table, item = _authorized_job(body, owner)
    if not item:
        return _resp(404, {"error": "ไม่พบงานที่ได้รับอนุญาต"})
    job_id = item["jobId"]
    state = item["state"]
    if action == "teacher.job.status":
        return _resp(200, {"job": _public(item)})
    if action == "teacher.job.results":
        from boto3.dynamodb.conditions import Key
        cursor = body.get("cursor", 0)
        if type(cursor) is not int or cursor < 0 or cursor > MAX_SCENES:
            return _resp(400, {"error": "cursor ไม่ถูกต้อง"})
        opts = {"KeyConditionExpression": Key("pk").eq(JOB_PREFIX + job_id)
                & Key("sk").begins_with("result#"),
                "Limit": 40}
        if cursor:
            opts["ExclusiveStartKey"] = {"pk": JOB_PREFIX + job_id,
                                          "sk": "result#%05d" % (cursor - 1)}
        response = table.query(**opts)
        result = [{"index": int(x["index"]), "lesson": x["lesson"]}
                  for x in response.get("Items", [])]
        next_cursor = result[-1]["index"] + 1 if response.get("LastEvaluatedKey") and result else None
        return _resp(200, {"items": result, "nextCursor": next_cursor})
    if action == "teacher.job.pause":
        if state in ("queued", "running"):
            table.update_item(Key=_key(job_id),
                              UpdateExpression="SET #s=:s, updatedAt=:now",
                              ExpressionAttributeNames={"#s": "state"},
                              ExpressionAttributeValues={":s": "paused", ":now": int(time.time())})
        return _resp(200, {"job": _public(_read(table, job_id))})
    if action == "teacher.job.cancel":
        if state not in ("completed", "cancelled"):
            table.update_item(Key=_key(job_id),
                              UpdateExpression="SET #s=:s, updatedAt=:now",
                              ExpressionAttributeNames={"#s": "state"},
                              ExpressionAttributeValues={":s": "cancelled", ":now": int(time.time())})
            if item.get("executionArn"):
                try:
                    import boto3
                    boto3.client("stepfunctions").stop_execution(
                        executionArn=item["executionArn"], cause="Owner cancelled training job")
                except Exception:
                    pass  # The running Lambda will honor cancellation at its next checkpoint.
        return _resp(200, {"job": _public(_read(table, job_id))})
    if action == "teacher.job.resume":
        if state not in ("paused", "needs-attention", "queued"):
            return _resp(409, {"error": "งานนี้ไม่สามารถสั่งทำต่อได้"})
        if state == "queued" and item.get("executionArn"):
            return _resp(200, {"job": _public(item)})
        generation = int(item["generation"]) + (0 if state == "queued" else 1)
        table.update_item(Key=_key(job_id),
                          UpdateExpression="SET #s=:s, generation=:g, #p=:p, leaseUntil=:z, lastError=:e, updatedAt=:now REMOVE executionArn",
                          ExpressionAttributeNames={"#s": "state", "#p": "pass"},
                          ExpressionAttributeValues={":s": "queued", ":g": generation,
                                                     ":p": 0, ":z": 0, ":e": "", ":now": int(time.time())})
        current = _read(table, job_id)
        try:
            _launch(table, current)
        except Exception:
            return _resp(503, {"error": "เรียกคิว AWS ไม่สำเร็จ แต่สถานะงานยังอยู่"})
        return _resp(200, {"job": _public(_read(table, job_id))})
    return _resp(400, {"error": "ไม่รู้จักคำสั่งงาน"})


def handle(action, body, owner):
    if action == "teacher.job.config":
        return _resp(200, {"enabled": enabled(), "mode": "step-functions",
                           "maxScenes": MAX_SCENES})
    if not enabled():
        return _resp(503, {"error": "ระบบ Background Jobs ยังไม่เปิดใช้งานบน AWS"})
    if action.startswith("teacher.job.upload."):
        import cloud_upload
        return cloud_upload.handle(action, body, owner)
    if action == "teacher.job.start":
        return _start(body, owner)
    if action == "teacher.job.find":
        return _find(body, owner)
    return _control(action, body, owner)


def _save_progress(table, old, **updates):
    """Conditional commit: a paused or cancelled job cannot silently resume."""
    attrs = {":g": int(old["generation"]), ":running": "running"}
    names = {"#s": "state"}
    sets = []
    for i, (field, value) in enumerate(updates.items()):
        name, placeholder = "#f" + str(i), ":v" + str(i)
        names[name] = field
        attrs[placeholder] = value
        sets.append(name + "=" + placeholder)
    try:
        table.update_item(Key=_key(old["jobId"]),
            UpdateExpression="SET " + ",".join(sets),
            ConditionExpression="#s=:running AND generation=:g",
            ExpressionAttributeNames=names, ExpressionAttributeValues=attrs)
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return False
    return True


def _worker(payload):
    """One bounded worker: up to 16 cache hits and at most 2 fresh AI scenes."""
    job_id, generation = payload.get("jobId"), payload.get("generation")
    if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
        return {"next": False, "state": "invalid"}
    if type(generation) is not int:
        return {"next": False, "state": "invalid"}
    table = _table()
    item = _read(table, job_id)
    if not item or item.get("generation") != generation or item.get("state") not in ("queued", "running"):
        return {"next": False, "state": "stopped"}
    now = int(time.time())
    try:
        table.update_item(Key=_key(job_id),
            UpdateExpression="SET #s=:running, leaseUntil=:lease, updatedAt=:now",
            ConditionExpression="generation=:g AND #s IN (:queued,:running) AND leaseUntil < :now",
            ExpressionAttributeNames={"#s": "state"},
            ExpressionAttributeValues={":g": generation, ":queued": "queued",
              ":running": "running", ":lease": now + 150, ":now": now})
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return {"next": True, "waitSeconds": 30, "state": "busy"}
        raise
    # boto3 reads every DynamoDB number as Decimal; list indices must be int.
    work, position = [int(x) for x in item["work"]], int(item["position"])
    lookahead = work[position:position + CHUNK_SIZE]
    if not lookahead:
        _save_progress(table, item, state="completed", leaseUntil=0,
                       updatedAt=int(time.time()), lastError="")
        return {"next": False, "state": "completed"}
    chunk_cache = {}
    lookahead_scenes = []
    for index in lookahead:
        part = index // CHUNK_SIZE
        if part not in chunk_cache:
            record = table.get_item(Key={"pk": JOB_PREFIX + job_id,
                   "sk": "input#%05d" % part}, ConsistentRead=True)["Item"]
            chunk_cache[part] = record["scenes"]
        lookahead_scenes.append(chunk_cache[part][index % CHUNK_SIZE])
    import teacher
    # A single strong read finds all reusable lessons in the lookahead.
    # Only the first two misses need paid/rate-limited AI inference.
    remembered = teacher._cached_scene_records(table, item["projectId"], lookahead_scenes)
    selected, scenes, fresh = [], [], []
    for index, scene in zip(lookahead, lookahead_scenes):
        if scene["id"] not in remembered and len(fresh) >= 2:
            break
        selected.append(index)
        scenes.append(scene)
        if scene["id"] not in remembered:
            fresh.append(scene)
    if fresh:
        reply = teacher._auto_teach({"projectId": item["projectId"],
                                     "provider": item["provider"], "scenes": fresh})
        code, data = reply["statusCode"], json.loads(reply["body"])
    else:
        code, data = 200, {"saved": 0, "reused": 0, "lessons": []}
    if code == 429:
        throttles = int(item.get("throttles", 0)) + 1
        if throttles >= 6:
            _save_progress(table, item, state="needs-attention", throttles=throttles,
                           lastError="Provider จำกัดโควตาหลายครั้ง โปรดตรวจบัญชีและกดทำต่อ",
                           updatedAt=int(time.time()), leaseUntil=0)
            return {"next": False, "state": "needs-attention"}
        _save_progress(table, item, state="queued", throttles=throttles,
                       lastError="Provider จำกัดโควตา กำลังรอทำต่อ",
                       updatedAt=int(time.time()), leaseUntil=0)
        return {"next": True, "state": "rate-limited",
                "waitSeconds": min(900, 60 * (2 ** (throttles - 1)))}
    if code not in (200, 422):
        _save_progress(table, item, state="needs-attention", leaseUntil=0,
                       lastError=str(data.get("error") or "AI provider ไม่พร้อม")[:200],
                       updatedAt=int(time.time()))
        return {"next": False, "state": "needs-attention"}
    lessons = data.get("lessons", []) if code == 200 else []
    accepted = {
        index: remembered[scene["id"]]
        for index, scene in zip(selected, scenes) if scene["id"] in remembered
    }
    for lesson in lessons:
        if not isinstance(lesson, dict):
            continue
        for index, scene in zip(selected, scenes):
            if lesson.get("sceneId") == scene["id"] and lesson.get("original") == scene["text"]:
                accepted[index] = lesson
    completed = set(int(x) for x in item["completedIndices"])
    missed = list(item["failedIndices"])
    for index in selected:
        if index in accepted:
            table.put_item(Item={"pk": JOB_PREFIX + job_id,
                                 "sk": "result#%05d" % index,
                                 "index": index, "lesson": accepted[index]})
            completed.add(index)
        else:
            missed.append(index)
    pos = position + len(selected)
    run_pass = int(item["pass"])
    if pos >= len(work):
        if missed and run_pass + 1 < MAX_PASSES:
            work, pos, missed, run_pass = sorted(set(missed)), 0, [], run_pass + 1
            state = "queued"
        elif missed:
            work, pos, missed = sorted(set(missed)), 0, []
            state = "needs-attention"
        else:
            state = "completed"
    else:
        state = "queued"
    committed = _save_progress(table, item, state=state, work=work, position=pos,
                   failedIndices=missed, completedIndices=sorted(completed),
                   saved=int(item.get("saved", 0)) + int(data.get("saved", 0)),
                   reused=int(item.get("reused", 0)) + int(data.get("reused", 0))
                          + sum(1 for scene in scenes if scene["id"] in remembered),
                   throttles=0, leaseUntil=0,
                   lastError="" if state != "needs-attention"
                       else "บางฉากยังไม่ผ่าน QA กดทำต่อเพื่อลองสอนเฉพาะฉากที่ค้าง",
                   **{"pass": run_pass},
                   updatedAt=int(time.time()))
    if not committed:
        return {"next": False, "state": "interrupted-by-owner"}
    if state == "completed":
        # Match the old browser workflow: CPU advisory model trains only after
        # all lessons are confirmed. Cross-story QA still gates promotion.
        try:
            import story_auto_train
            training = json.loads(story_auto_train.train()["body"])
            summary = {"status": str(training.get("status", ""))[:90],
                       "activated": bool(training.get("activated")),
                       "counts": training.get("counts", {})}
        except Exception as exc:
            summary = {"status": "training-deferred",
                       "error": type(exc).__name__}
        table.update_item(Key=_key(job_id),
                          UpdateExpression="SET trainingStatus=:t",
                          ExpressionAttributeValues={":t": summary})
    return {"next": state == "queued", "state": state,
            "waitSeconds": 1 if not fresh else 12}


def worker(payload):
    try:
        return _worker(payload)
    except Exception as exc:
        # Persist a resumable failure instead of leaving a browser-less job stuck.
        job_id = payload.get("jobId")
        if isinstance(job_id, str) and re.fullmatch(r"[a-f0-9]{32}", job_id):
            try:
                table = _table()
                current = _read(table, job_id)
                if current and current.get("generation") == payload.get("generation"):
                    _save_progress(table, current, state="needs-attention", leaseUntil=0,
                                   lastError="AWS Worker: " + type(exc).__name__,
                                   updatedAt=int(time.time()))
            except Exception:
                raise  # Let Step Functions retry actual AWS infrastructure errors.
        return {"next": False, "state": "needs-attention"}
