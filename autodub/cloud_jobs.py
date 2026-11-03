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
MAX_TRANSIENT_RETRIES = 6
# Only opt-in pool jobs use the following key-specific failure fallback.
# It does not broaden existing provider retry or legacy job semantics.
MAX_POOL_BAD_KEYS_PER_JOB = 128
POOL_KEY_FAILURES = frozenset(("TEACHER_PROVIDER_AUTH", "TEACHER_MODEL_UNAVAILABLE"))
TRANSIENT_PROVIDER_CODES = frozenset((
    "TEACHER_PROVIDER_TIMEOUT", "TEACHER_PROVIDER_NETWORK",
    "TEACHER_PROVIDER_UPSTREAM", "TEACHER_PROVIDER_BAD_RESPONSE"))
STATES = ("queued", "running", "paused", "needs-attention", "completed", "cancelled")
JOB_PREFIX = "teacher-job#"
INDEX_PREFIX = "teacher-job-index#"
PROVIDER_LOCK_PREFIX = "teacher-provider-lease#"
PROVIDER_QUOTA_PREFIX = "teacher-provider-quota#"


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


def pool_enabled():
    # Opt-in rollout: existing jobs remain pinned until explicitly enabled.
    return os.getenv("TEACHER_ENABLE_IDLE_POOL") == "1"


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
            "storyName": str(item.get("storyName") or "")[:100],
            "state": item["state"], "total": total, "completed": completed,
            "remaining": max(0, total - completed),
            "pass": int(item.get("pass", 0)) + 1,
            "saved": int(item.get("saved", 0)), "reused": int(item.get("reused", 0)),
            "createdAt": int(item["createdAt"]),
            "updatedAt": int(item["updatedAt"]),
            "error": str(item.get("lastError", ""))[:240],
            "provider": item["provider"],
            "connectionId": item.get("connectionId") or ("default-" + item["provider"]),
            "poolMode": bool(item.get("poolMode", False)),
            "lastConnectionId": item.get("lastConnectionId", ""),
            "unusableKeys": len(item.get("unusableConnections", [])),
            "trainingPending": bool(item.get("trainingPending", False)),
            "trainingAttempts": int(item.get("trainingAttempts", 0)),
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


def _story_anchors(scenes):
    """Bounded, immutable quotations of the owner's actual script.

    Evidence from across the submitted story travels with a pooled job so
    an idle mother has some beginning/middle/end context even when it has never
    worked on that story. This is NOT a generated full-story summary, and
    never claims to know events omitted by these excerpts.
    """
    n = len(scenes)
    if n == 0:
        return []
    count = min(7, n)
    indexes = sorted({round(i * (n - 1) / max(1, count - 1))
                      for i in range(count)})
    return [{"sceneId": scenes[i]["id"], "position": i + 1,
             "text": scenes[i]["text"][:110]} for i in indexes]


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
    use_pool = body.get("poolMode") is True
    if use_pool and not pool_enabled():
        return _resp(409, {"error": "ระบบแบ่งงาน AI แม่ยังไม่เปิดใช้บน AWS"})
    story_name = re.sub(r"[\x00-\x1f\x7f]", " ", str(body.get("storyName") or "")).strip()[:100]
    if not isinstance(project_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{5,90}", project_id):
        return _resp(400, {"error": "รหัสโปรเจกต์ไม่ถูกต้อง"})
    if provider not in ("gemini", "openrouter", "compatible"):
        return _resp(400, {"error": "AI Provider ไม่ถูกต้อง"})
    try:
        scenes = _validated_scenes(body.get("scenes"))
    except ValueError as exc:
        return _resp(400, {"error": str(exc)})
    import teacher
    import teacher_connections
    connection_id = body.get("connectionId") or ("default-" + provider)
    if connection_id == "default-" + provider:
        status = json.loads(teacher._status()["body"])
        ready = any(p["id"] == provider and p["ready"] for p in status["providers"])
    else:
        ready = teacher_connections.available(provider, connection_id)
    if not os.getenv("TEACHER_FEEDBACK_TABLE") or not ready:
        return _resp(409, {"error": "AI Key ที่เลือกไม่พร้อม กรุณาตรวจการเชื่อมต่อ"})
    if use_pool and not any(x.get("ready") and str(x.get("id", "")).startswith("key-")
                            for x in teacher_connections.listing()):
        return _resp(409, {"error": "โหมดช่วยงานต้องมี API แม่ที่เชื่อมเพิ่มเติมอย่างน้อย 1 คีย์"})
    # Preserve legacy job IDs and checkpoints for the original provider key.
    fingerprint = [str(owner), project_id, provider, scenes]
    if connection_id != "default-" + provider:
        fingerprint.append(connection_id)
    if use_pool:
        fingerprint.append("idle-pool-v1")
    digest = hashlib.sha256(json.dumps(
        fingerprint,
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
            "connectionId": connection_id, "storyName": story_name,
            "poolMode": use_pool,
            "storyAnchors": _story_anchors(scenes) if use_pool else [],
            "state": "queued", "generation": 0, "total": len(scenes),
            "work": list(range(len(scenes))), "position": 0, "pass": 0,
            "completedIndices": [], "failedIndices": [], "saved": 0, "reused": 0,
            "throttles": 0, "transientFailures": 0,
            "createdAt": now, "updatedAt": now,
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


def _list_jobs(body, owner):
    """Owner-indexed recent jobs, no scan or cross-owner exposure."""
    from boto3.dynamodb.conditions import Key
    table = _table()
    rows = table.query(
        KeyConditionExpression=Key("pk").eq(INDEX_PREFIX + str(owner)),
        ScanIndexForward=False, Limit=80).get("Items", [])
    seen, jobs = set(), []
    for row in rows:
        job_id = row.get("jobId")
        if job_id in seen or not isinstance(job_id, str):
            continue
        seen.add(job_id)
        item = _read(table, job_id)
        if item and str(item.get("ownerId")) == str(owner):
            jobs.append(_public(item))
        if len(jobs) >= 40:
            break
    return _resp(200, {"jobs": jobs, "source": "aws-dynamodb-owner-index",
                       "limit": 40})


def _connection_in_use(owner, connection_id):
    """Check every indexed job before deleting a scalable-vault key.

    Unlike the UI's 40-job listing, this is deliberately paginated and
    fail-closed on AWS errors. Paused and recoverable jobs also retain keys.
    """
    from boto3.dynamodb.conditions import Key
    table = _table()
    cursor, seen = None, set()
    while True:
        options = {"KeyConditionExpression": Key("pk").eq(INDEX_PREFIX + str(owner)),
                   "ConsistentRead": True, "Limit": 100}
        if cursor:
            options["ExclusiveStartKey"] = cursor
        page = table.query(**options)
        for ref in page.get("Items", []):
            job_id = ref.get("jobId")
            if not isinstance(job_id, str) or job_id in seen:
                continue
            seen.add(job_id)
            row = _read(table, job_id)
            if (row and row.get("ownerId") == str(owner)
                    and row.get("state") not in ("completed", "cancelled")
                    and (row.get("connectionId") == connection_id
                         or row.get("poolMode"))):
                # Any active pooled job may select this credential in its next
                # batch; do not revoke vault keys mid-run or mid-retry.
                return True
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            return False


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
            try:
                table.update_item(Key=_key(job_id),
                    UpdateExpression="SET #s=:s, updatedAt=:now",
                    ConditionExpression="#s=:expected AND generation=:expectedGen",
                    ExpressionAttributeNames={"#s": "state"},
                    ExpressionAttributeValues={":s": "paused", ":expected": state,
                                               ":expectedGen": int(item["generation"]),
                                               ":now": int(time.time())})
            except Exception as exc:
                if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
                return _resp(409, {"error": "งานเปลี่ยนสถานะระหว่างสั่งพัก กรุณารีเฟรช"})
        return _resp(200, {"job": _public(_read(table, job_id))})
    if action == "teacher.job.cancel":
        if state not in ("completed", "cancelled"):
            try:
                table.update_item(Key=_key(job_id),
                    UpdateExpression="SET #s=:s, updatedAt=:now",
                    ConditionExpression="#s=:expected AND generation=:expectedGen",
                    ExpressionAttributeNames={"#s": "state"},
                    ExpressionAttributeValues={":s": "cancelled", ":expected": state,
                                               ":expectedGen": int(item["generation"]),
                                               ":now": int(time.time())})
            except Exception as exc:
                if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
                return _resp(409, {"error": "งานเปลี่ยนสถานะระหว่างสั่งยกเลิก กรุณารีเฟรช"})
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
        try:
            table.update_item(Key=_key(job_id),
                UpdateExpression="SET #s=:s, generation=:g, #p=:p, leaseUntil=:z, lastError=:e, transientFailures=:f, trainingAttempts=:a, updatedAt=:now REMOVE executionArn",
                ConditionExpression="#s=:expected AND generation=:expectedGen",
                ExpressionAttributeNames={"#s": "state", "#p": "pass"},
                ExpressionAttributeValues={":s": "queued", ":g": generation,
                                           ":p": 0, ":z": 0, ":f": 0,
                                           ":e": "", ":a": 0, ":expected": state,
                                           ":expectedGen": int(item["generation"]),
                                           ":now": int(time.time())})
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            return _resp(409, {"error": "งานเปลี่ยนสถานะระหว่างสั่งทำต่อ กรุณารีเฟรช"})
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
                           "maxScenes": MAX_SCENES, "poolEnabled": pool_enabled()})
    if not enabled():
        return _resp(503, {"error": "ระบบ Background Jobs ยังไม่เปิดใช้งานบน AWS"})
    if action.startswith("teacher.job.upload."):
        import cloud_upload
        return cloud_upload.handle(action, body, owner)
    if action == "teacher.job.start":
        return _start(body, owner)
    if action == "teacher.job.find":
        return _find(body, owner)
    if action == "teacher.job.list":
        return _list_jobs(body, owner)
    return _control(action, body, owner)


def _save_progress(table, old, **updates):
    """Conditional commit: a paused or cancelled job cannot silently resume."""
    attrs = {":g": int(old["generation"]), ":running": "running"}
    names = {"#s": "state"}
    condition = "#s=:running AND generation=:g"
    if old.get("poolMode"):
        # An expired Lambda may never commit after another worker takes over.
        # The token is created by the successful DynamoDB lease acquisition.
        if not old.get("leaseOwner"):
            return False
        attrs[":owner"] = old["leaseOwner"]
        condition += " AND leaseOwner=:owner"
    sets = []
    for i, (field, value) in enumerate(updates.items()):
        name, placeholder = "#f" + str(i), ":v" + str(i)
        names[name] = field
        attrs[placeholder] = value
        sets.append(name + "=" + placeholder)
    try:
        table.update_item(Key=_key(old["jobId"]),
            UpdateExpression="SET " + ",".join(sets),
            ConditionExpression=condition,
            ExpressionAttributeNames=names, ExpressionAttributeValues=attrs)
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return False
    return True


def _provider_quota_wait(table, provider, now):
    """429 from any key may reflect a provider-wide account quota."""
    result = table.get_item(
        Key={"pk": PROVIDER_QUOTA_PREFIX + provider, "sk": "backoff"},
        ConsistentRead=True).get("Item", {})
    return max(0, int(result.get("until", 0)) - now)


def _provider_quota_block(table, provider, seconds=70):
    table.update_item(
        Key={"pk": PROVIDER_QUOTA_PREFIX + provider, "sk": "backoff"},
        UpdateExpression="SET #u=:until, updatedAt=:now",
        ExpressionAttributeNames={"#u": "until"},
        ExpressionAttributeValues={":until": int(time.time()) + seconds,
                                   ":now": int(time.time())})


def _provider_lock_key(provider):
    return {"pk": PROVIDER_LOCK_PREFIX + provider, "sk": "lease"}


def _try_provider_lock(table, provider, job_id, now):
    """Serialize AI inference across concurrent cloud jobs using existing IAM."""
    try:
        table.update_item(
            Key=_provider_lock_key(provider),
            UpdateExpression="SET ownerJob=:job, leaseUntil=:until, updatedAt=:now",
            ConditionExpression="attribute_not_exists(pk) OR leaseUntil < :now",
            ExpressionAttributeValues={
                ":job": job_id, ":until": now + 110, ":now": now})
        return True
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def _release_provider_lock(table, provider, job_id, cooldown=12):
    # No DeleteItem IAM permission needed. Enforce a small shared cooldown.
    try:
        table.update_item(
            Key=_provider_lock_key(provider),
            UpdateExpression="SET leaseUntil=:until, updatedAt=:now",
            ConditionExpression="ownerJob=:job",
            ExpressionAttributeValues={
                ":job": job_id, ":until": int(time.time()) + cooldown,
                ":now": int(time.time())})
    except Exception as exc:
        # A stale worker must never clear a successor's lease.
        if getattr(exc, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _borrow_idle_connection(table, item, now, excluded=()):
    """Claim an idle extra key without giving away already-running scenes.

    Iterate the entire owner pool, so a free key is not ignored just because
    it is beyond an arbitrary first-N window. Read provider cooldown once per
    provider, not once per key (important when 50+ keys share one provider).
    A failed conditional claim simply tries the next available credential.
    """
    import teacher_connections
    connections = [c for c in teacher_connections.listing()
                   if c.get("ready") and str(c.get("id", "")).startswith("key-")]
    excluded = set(excluded)
    if not connections or all(c["id"] in excluded for c in connections):
        return None, None
    candidates, provider_wait = [], {}
    shortest_wait = None
    for conn in connections:
        if conn["id"] in excluded:
            continue
        lock = table.get_item(Key=_provider_lock_key(conn["id"]),
                              ConsistentRead=True).get("Item", {})
        occupied = max(0, int(lock.get("leaseUntil", 0)) - now)
        provider = conn["provider"]
        if provider not in provider_wait:
            provider_wait[provider] = _provider_quota_wait(table, provider, now)
        quota_wait = provider_wait[provider]
        if occupied or quota_wait:
            # A credential is usable only after *both* waits expire.
            delay = max(occupied, quota_wait)
            shortest_wait = delay if shortest_wait is None else min(shortest_wait, delay)
            continue
        candidates.append((int(lock.get("updatedAt", 0)), conn["id"], conn))
    # Least recently used first, for fairer sharing across stories.
    candidates.sort(key=lambda x: (x[0], x[1]))
    for _, _, conn in candidates:
        if _try_provider_lock(table, conn["id"], item["jobId"], now):
            return conn, None
        # Another worker won the claim while we checked availability.
        shortest_wait = 20 if shortest_wait is None else min(shortest_wait, 20)
    return None, min(900, max(20, shortest_wait or 20))

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
    claim_token = uuid.uuid4().hex if item.get("poolMode") else None
    lease_values = {":g": generation, ":queued": "queued",
                    ":running": "running", ":lease": now + 150, ":now": now}
    update = "SET #s=:running, leaseUntil=:lease, updatedAt=:now"
    if claim_token:
        # The claim token fences late work from this job's older Lambda runs.
        update += ", leaseOwner=:owner"
        lease_values[":owner"] = claim_token
    try:
        table.update_item(Key=_key(job_id),
            UpdateExpression=update,
            ConditionExpression="generation=:g AND #s IN (:queued,:running) AND leaseUntil < :now",
            ExpressionAttributeNames={"#s": "state"},
            ExpressionAttributeValues=lease_values)
    except Exception as exc:
        if getattr(exc, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return {"next": True, "waitSeconds": 30, "state": "busy"}
        raise
    if claim_token:
        item = {**item, "leaseOwner": claim_token}
        # Internal only: this is never returned to the frontend/Step Functions.
        payload["_claimedWorkerLease"] = claim_token
    # boto3 reads every DynamoDB number as Decimal; list indices must be int.
    work, position = [int(x) for x in item["work"]], int(item["position"])
    lookahead = work[position:position + CHUNK_SIZE]
    if not lookahead:
        if item.get("trainingPending"):
            import story_auto_train
            try:
                trained = json.loads(story_auto_train.train()["body"])
            except Exception as exc:
                trained = {"status": "training-deferred",
                           "error": type(exc).__name__}
            attempts = int(item.get("trainingAttempts", 0)) + 1
            if (trained.get("status") in ("training-busy", "training-deferred")
                    or not trained.get("status")):
                if attempts < 8:
                    committed = _save_progress(
                        table, item, state="queued", leaseUntil=0,
                        trainingAttempts=attempts,
                        lastError="รอคิวฝึกโมเดล AI ลูกโดยไม่สอนฉากซ้ำ",
                        updatedAt=int(time.time()))
                    return {"next": bool(committed),
                            "state": "training-wait" if committed else "stopped",
                            "waitSeconds": min(180, 25 * attempts)}
                committed = _save_progress(table, item, state="needs-attention", leaseUntil=0,
                               trainingAttempts=attempts,
                               lastError="บทเรียนครบแล้ว แต่ขั้นฝึก AI ลูกไม่พร้อม กดทำต่อภายหลัง",
                               updatedAt=int(time.time()))
                if not committed:
                    return {"next": False, "state": "worker-claim-lost"}
                return {"next": False, "state": "needs-attention"}
            summary = {"status": str(trained.get("status", ""))[:90],
                       "activated": bool(trained.get("activated")),
                       "counts": trained.get("counts", {})}
            committed = _save_progress(
                table, item, state="completed", leaseUntil=0,
                trainingPending=False, trainingAttempts=0,
                trainingStatus=summary, lastError="", updatedAt=int(time.time()))
            return {"next": False,
                    "state": "completed" if committed else "stopped"}
        committed = _save_progress(table, item, state="completed", leaseUntil=0,
                       updatedAt=int(time.time()), lastError="")
        if not committed:
            return {"next": False, "state": "worker-claim-lost"}
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
        teaching_provider = item["provider"]
        teaching_connection = item.get("connectionId")
        credential_id = teaching_connection or teaching_provider
        # Keep the old execution path untouched unless an opted-in job is
        # running with the server-side pool feature enabled.
        if item.get("poolMode") and pool_enabled():
            choice, wait = _borrow_idle_connection(
                table, item, int(time.time()), item.get("unusableConnections", ()))
            if not choice:
                if wait is None:
                    committed = _save_progress(table, item, state="needs-attention", leaseUntil=0,
                                   lastError="ไม่มี API แม่ที่พร้อมและไม่เคยล้มเหลวในงานนี้ กรุณาตรวจคีย์",
                                   updatedAt=int(time.time()))
                    if not committed:
                        return {"next": False, "state": "worker-claim-lost"}
                    return {"next": False, "state": "needs-attention"}
                committed = _save_progress(table, item, state="queued", leaseUntil=0,
                               updatedAt=int(time.time()))
                if not committed:
                    return {"next": False, "state": "worker-claim-lost"}
                return {"next": True, "state": "pool-busy",
                        "waitSeconds": wait}
            teaching_provider = choice["provider"]
            teaching_connection = choice["id"]
            credential_id = teaching_connection
        else:
            quota_wait = _provider_quota_wait(table, teaching_provider, int(time.time()))
            if quota_wait:
                committed = _save_progress(table, item, state="queued", leaseUntil=0,
                               updatedAt=int(time.time()))
                if not committed:
                    return {"next": False, "state": "worker-claim-lost"}
                return {"next": True, "state": "provider-quota-wait",
                        "waitSeconds": min(900, max(20, quota_wait))}
            if not _try_provider_lock(table, credential_id, job_id, int(time.time())):
                committed = _save_progress(table, item, state="queued", leaseUntil=0,
                               updatedAt=int(time.time()))
                if not committed:
                    return {"next": False, "state": "worker-claim-lost"}
                return {"next": True, "state": "provider-busy", "waitSeconds": 20}
        cooldown = 12
        try:
            try:
                reply = teacher._auto_teach({
                    "projectId": item["projectId"],
                    "provider": teaching_provider,
                    "connectionId": teaching_connection,
                    "scenes": fresh,
                    "storyAnchors": item.get("storyAnchors", []) if
                        item.get("poolMode") and pool_enabled() else []})
            except TimeoutError:
                # Covers any legacy path that still emits socket.timeout.
                # The memory fast path will check stored lessons on retry.
                reply = _resp(503, {"reasonCode": "TEACHER_PROVIDER_TIMEOUT",
                                    "error": "AI provider ตอบช้า กำลังลองใหม่"})
            code, data = reply["statusCode"], json.loads(reply["body"])
            if code == 429:
                cooldown = 70
                _provider_quota_block(table, teaching_provider, cooldown)
            elif (item.get("poolMode") and pool_enabled()
                  and data.get("reasonCode") in POOL_KEY_FAILURES):
                # Do not burn the same invalid key across other jobs.
                cooldown = 3600 if data["reasonCode"] == "TEACHER_PROVIDER_AUTH" else 1800
        finally:
            _release_provider_lock(table, credential_id, job_id, cooldown)
    else:
        code, data = 200, {"saved": 0, "reused": 0, "lessons": []}
    if (fresh and item.get("poolMode") and pool_enabled()
            and data.get("reasonCode") in POOL_KEY_FAILURES):
        # This failure is about a credential/model, not the script.
        # Keep the exact scene index and try an independent key next.
        unusable = sorted(set(item.get("unusableConnections", [])) | {teaching_connection})
        import teacher_connections
        possible = [c["id"] for c in teacher_connections.listing()
                    if c.get("ready") and str(c.get("id", "")).startswith("key-")]
        if (len(unusable) >= MAX_POOL_BAD_KEYS_PER_JOB
                or not any(cid not in unusable for cid in possible)):
            committed = _save_progress(table, item, state="needs-attention", leaseUntil=0,
                           unusableConnections=unusable,
                           lastError="AI แม่ที่พร้อมทุกตัวใช้คีย์หรือโมเดลไม่ได้ กรุณาตรวจการเชื่อมต่อ",
                           updatedAt=int(time.time()))
            if not committed:
                return {"next": False, "state": "worker-claim-lost"}
            return {"next": False, "state": "needs-attention"}
        committed = _save_progress(table, item, state="queued", leaseUntil=0,
                       unusableConnections=unusable,
                       lastError="ข้ามคีย์/โมเดลที่ใช้ไม่ได้ และรอ AI แม่ตัวอื่น",
                       updatedAt=int(time.time()))
        if not committed:
            return {"next": False, "state": "worker-claim-lost"}
        return {"next": True, "state": "pool-key-fallback", "waitSeconds": 20}
    if code == 429:
        throttles = int(item.get("throttles", 0)) + 1
        if throttles >= 6:
            committed = _save_progress(table, item, state="needs-attention", throttles=throttles,
                           lastError="Provider จำกัดโควตาหลายครั้ง โปรดตรวจบัญชีและกดทำต่อ",
                           updatedAt=int(time.time()), leaseUntil=0)
            if not committed:
                return {"next": False, "state": "worker-claim-lost"}
            return {"next": False, "state": "needs-attention"}
        committed = _save_progress(table, item, state="queued", throttles=throttles,
                       lastError="Provider จำกัดโควตา กำลังรอทำต่อ",
                       updatedAt=int(time.time()), leaseUntil=0)
        if not committed:
            return {"next": False, "state": "worker-claim-lost"}
        return {"next": True, "state": "rate-limited",
                "waitSeconds": min(900, 60 * (2 ** (throttles - 1)))}
    # Provider timeouts and transient 5xx are NOT corrupted lessons.
    # Keep the exact position and checkpoint; delay using Step Functions
    # rather than repeatedly calling the model in the same Lambda invocation.
    if code in (502, 503, 504) and data.get("reasonCode") in TRANSIENT_PROVIDER_CODES:
        failures = int(item.get("transientFailures", 0)) + 1
        if failures >= MAX_TRANSIENT_RETRIES:
            committed = _save_progress(table, item, state="needs-attention", leaseUntil=0,
                           transientFailures=failures,
                           lastError="AI provider ขัดข้องชั่วคราวซ้ำหลายครั้ง; กดทำต่อเมื่อบริการกลับมา",
                           updatedAt=int(time.time()))
            if not committed:
                return {"next": False, "state": "worker-claim-lost"}
            return {"next": False, "state": "needs-attention"}
        delay = min(600, 25 * (2 ** (failures - 1)))
        committed = _save_progress(table, item, state="queued", leaseUntil=0,
                       transientFailures=failures,
                       lastError="AI provider ตอบช้า/ไม่พร้อม กำลังรอลองใหม่โดยไม่ข้ามฉาก",
                       updatedAt=int(time.time()))
        if not committed:
            return {"next": False, "state": "worker-claim-lost"}
        return {"next": True, "state": "provider-retry",
                "waitSeconds": delay}
    if code not in (200, 422):
        committed = _save_progress(table, item, state="needs-attention", leaseUntil=0,
                       lastError=str(data.get("error") or "AI provider ไม่พร้อม")[:200],
                       updatedAt=int(time.time()))
        if not committed:
            return {"next": False, "state": "worker-claim-lost"}
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
    if item.get("poolMode"):
        # A pause, cancel or newer lease can arrive while a model is replying.
        # Fail closed before publishing any results from the superseded worker.
        active = _read(table, job_id)
        if (not active or active.get("leaseOwner") != item.get("leaseOwner")
                or int(active.get("generation", -1)) != generation
                or active.get("state") != "running"
                or int(active.get("leaseUntil", 0)) < int(time.time())):
            return {"next": False, "state": "superseded-worker"}
    for index in selected:
        if index in accepted:
            key = {"pk": JOB_PREFIX + job_id, "sk": "result#%05d" % index}
            result = {**key, "index": index, "lesson": accepted[index]}
            if item.get("poolMode"):
                # No older/newer worker may overwrite a committed scene.
                try:
                    table.put_item(
                        Item=result, ConditionExpression="attribute_not_exists(pk)")
                except Exception as exc:
                    if (getattr(exc, "response", {}).get("Error", {}).get("Code")
                            != "ConditionalCheckFailedException"):
                        raise
                    previous = table.get_item(Key=key, ConsistentRead=True).get("Item")
                    old_lesson = previous.get("lesson", {}) if previous else {}
                    if (old_lesson.get("sceneId") != accepted[index].get("sceneId")
                            or old_lesson.get("original") != accepted[index].get("original")):
                        raise RuntimeError("Conflicting previously committed scene result")
            else:
                table.put_item(Item=result)
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
    # Pool jobs use a separate durable training phase. Their completed
    # scenes are checkpointed before contending for the global model lock.
    training_pending = state == "completed" and item.get("poolMode") and pool_enabled()
    if training_pending:
        state = "queued"
    committed = _save_progress(table, item, state=state, work=work, position=pos,
                   failedIndices=missed, completedIndices=sorted(completed),
                   saved=int(item.get("saved", 0)) + int(data.get("saved", 0)),
                   reused=int(item.get("reused", 0)) + int(data.get("reused", 0))
                          + sum(1 for scene in scenes if scene["id"] in remembered),
                   throttles=0, transientFailures=0, leaseUntil=0,
                   unusableConnections=[],
                   trainingPending=bool(training_pending),
                   lastConnectionId=teaching_connection if fresh else item.get("lastConnectionId", ""),
                   lastError="" if state != "needs-attention"
                       else "บางฉากยังไม่ผ่าน QA กดทำต่อเพื่อลองสอนเฉพาะฉากที่ค้าง",
                   **{"pass": run_pass},
                   updatedAt=int(time.time()))
    if not committed:
        return {"next": False, "state": "interrupted-by-owner"}
    if training_pending:
        return {"next": True, "state": "training-queued", "waitSeconds": 1}
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


def _safe_worker_error(exc):
    """Expose error code and AWS operation, never secrets or full AWS messages."""
    category = type(exc).__name__
    details = getattr(exc, "response", {})
    if not isinstance(details, dict):
        details = {}
    code = details.get("Error", {}).get("Code", "")
    operation = getattr(exc, "operation_name", "")
    if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_]{1,50}", code):
        category += " / " + code
    if isinstance(operation, str) and re.fullmatch(r"[A-Za-z]{2,40}", operation):
        category += " / " + operation
    return "AWS Worker: " + category


def worker(payload):
    # Reject caller-provided claims; only the live worker may set this token.
    payload.pop("_claimedWorkerLease", None)
    try:
        return _worker(payload)
    except Exception as exc:
        # AWS SDK network glitches can also be transient. Preserve the
        # checkpoint and let Step Functions retry them, but never loop forever.
        job_id = payload.get("jobId")
        transient = type(exc).__name__ in (
            "TimeoutError", "ReadTimeoutError", "ConnectTimeoutError",
            "EndpointConnectionError", "ConnectionError")
        if isinstance(job_id, str) and re.fullmatch(r"[a-f0-9]{32}", job_id):
            try:
                table = _table()
                current = _read(table, job_id)
                if current and current.get("generation") == payload.get("generation"):
                    if current.get("poolMode"):
                        claimed = payload.get("_claimedWorkerLease")
                        if (not claimed or claimed != current.get("leaseOwner")
                                or current.get("state") != "running"):
                            # Do not touch a job that is owned by a newer Lambda.
                            return {"next": current.get("state") in ("queued", "running"),
                                    "state": "worker-claim-lost", "waitSeconds": 30}
                    failures = int(current.get("transientFailures", 0)) + 1
                    if transient and failures < MAX_TRANSIENT_RETRIES:
                        committed = _save_progress(table, current, state="queued",
                                    leaseUntil=0, transientFailures=failures,
                                    lastError="AWS เครือข่ายตอบช้า กำลังรอทำต่อ",
                                    updatedAt=int(time.time()))
                        return {"next": bool(committed), "state": "network-retry",
                                "waitSeconds": min(600, 25 * (2 ** (failures - 1)))}
                    _save_progress(table, current, state="needs-attention", leaseUntil=0,
                                   transientFailures=failures if transient else int(current.get("transientFailures",0)),
                                   lastError=_safe_worker_error(exc),
                                   updatedAt=int(time.time()))
            except Exception:
                raise  # Let Step Functions retry actual AWS infrastructure errors.
        return {"next": False, "state": "needs-attention"}
