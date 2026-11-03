"""Owner-only extra AI connections stored with existing encrypted teacher settings.

Legacy provider defaults are preserved unchanged. No API key is ever returned
to the browser, written to DynamoDB, or added to Step Functions input.
"""
import json
import re
import uuid
import time

MAX_EXTRA_KEYS = 6
ADMIN_ID = "225819900"  # Immutable verified GitHub numeric ID, not login text.
MAX_SETTINGS_BYTES = 3700
ID_RE = re.compile(r"key-[a-f0-9]{16}\Z")


def _models_and_rules(provider, model, base):
    import teacher
    if provider not in teacher.PROVIDERS:
        raise ValueError("ไม่รองรับผู้ให้บริการนี้")
    model = str(model or teacher.MODELS[provider]).strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,128}", model):
        raise ValueError("ชื่อ Model ID ไม่ถูกต้อง")
    # Provider model selection is the owner's explicit choice. Do not
    # enforce price-tier-specific model names at this server boundary.
    base = str(base or "").strip()
    if provider == "compatible" and not teacher._host_allowed(base):
        raise ValueError("API URL ไม่อยู่ในรายชื่อที่ AWS อนุญาต")
    return model, base if provider == "compatible" else ""


def _entries(settings):
    entries = settings.get("extraConnections")
    return entries if isinstance(entries, dict) else {}


def _default_id(provider):
    return "default-" + provider


def _public(item_id, record):
    return {"id": item_id, "provider": record["provider"],
            "model": record.get("model", ""),
            "name": record.get("name", ""),
            "ready": bool(record.get("key")), "legacy": False,
            "createdAt": int(record.get("createdAt", 0)),
            "ownerGitHubId": str(record.get("ownerGitHubId") or ADMIN_ID)}


def listing(settings=None):
    import teacher
    if settings is None:
        settings = teacher._settings()
    result = []
    for provider in teacher.PROVIDERS:
        config = teacher._config(settings, provider)
        if config.get("key"):
            result.append({"id": _default_id(provider), "provider": provider,
                           "model": str(config.get("model") or teacher.MODELS[provider]),
                           "name": provider.upper() + " · หลัก",
                           "ready": True, "legacy": True,
                           "ownerGitHubId": ADMIN_ID, "createdAt": 0})
    for key, config in _entries(settings).items():
        if (ID_RE.fullmatch(str(key)) and isinstance(config, dict)
                and config.get("provider") in teacher.PROVIDERS):
            result.append(_public(key, config))
    import owner_key_vault
    if owner_key_vault.enabled():
        result.extend(owner_key_vault.listing())
    result.sort(key=lambda item: (0 if item.get("legacy") else 1,
                                  item.get("createdAt", 0), item["name"]))
    return result


def resolve(settings, provider, connection_id=None):
    """No fallback to another key if the selected connection has been removed."""
    import teacher
    if provider not in teacher.PROVIDERS:
        return {}
    if connection_id in (None, "", _default_id(provider)):
        return teacher._config(settings, provider)
    if not isinstance(connection_id, str) or not ID_RE.fullmatch(connection_id):
        return {}
    entry = _entries(settings).get(connection_id)
    if (not isinstance(entry, dict) or entry.get("provider") != provider
            or str(entry.get("ownerGitHubId") or ADMIN_ID) != ADMIN_ID):
        import owner_key_vault
        return owner_key_vault.resolve(provider, connection_id) if owner_key_vault.enabled() else {}
    return entry


def available(provider, connection_id=None):
    import teacher
    return bool(resolve(teacher._settings(), provider, connection_id).get("key"))


def add(body, owner=None):
    import teacher
    if str(owner or ADMIN_ID) != ADMIN_ID:
        return teacher._response(403, {"error": "เพิ่ม API Key ได้เฉพาะบัญชี GitHub แอดมิน"})
    import owner_key_vault
    if not (owner_key_vault.enabled() or teacher._secret_id()
            or teacher.os.getenv("TEACHER_SETTINGS_PARAMETER")):
        return teacher._response(503, {"error": "AWS ยังไม่พร้อมบันทึก API Key"})
    provider = str(body.get("provider") or "").lower()
    try:
        model, base = _models_and_rules(provider, body.get("model"), body.get("baseUrl"))
    except ValueError as exc:
        return teacher._response(400, {"error": str(exc)})
    key = body.get("apiKey")
    if (not isinstance(key, str) or len(key.strip()) != len(key)
            or not 12 <= len(key) <= 350):
        return teacher._response(400, {"error": "กรุณาใส่ API Key ที่ถูกต้อง"})
    settings = teacher._settings()
    entries = _entries(settings)
    if owner_key_vault.enabled():
        old_keys = [str(p.get("key")) for p in entries.values()
                    if isinstance(p, dict) and p.get("key")]
        old_keys.extend(str(teacher._config(settings, p).get("key")) for p in teacher.PROVIDERS
                        if teacher._config(settings, p).get("key"))
        try:
            connection = owner_key_vault.add(provider, model, base, key, old_keys)
        except ValueError as exc:
            if str(exc) == "duplicate-key":
                return teacher._response(409, {"error": "API Key นี้ถูกเชื่อมไว้แล้ว"})
            raise
        return teacher._response(200, {"ok": True, "connection": connection})
    if len(entries) >= MAX_EXTRA_KEYS:
        return teacher._response(409, {"error": "ยังไม่เปิดคลังคีย์ AWS แบบขยาย (ต้องมี DynamoDB และ SESSION_SECRET)"})
    # Duplicate keys under the same provider are not independent capacity.
    if any(teacher._config(settings, p).get("key") == key for p in teacher.PROVIDERS):
        return teacher._response(409, {"error": "API Key นี้เชื่อมเป็นคีย์หลักอยู่แล้ว"})
    if any(isinstance(x, dict) and x.get("key") == key for x in entries.values()):
        return teacher._response(409, {"error": "API Key นี้ถูกเชื่อมไว้แล้ว"})
    count = int(settings.get("extraConnectionSequence") or 0) + 1
    connection_id = "key-" + uuid.uuid4().hex[:16]
    model_short = model.rsplit("/", 1)[-1]
    name = provider.upper() + " · " + model_short[:36] + " · #" + str(count)
    record = {"provider": provider, "model": model, "baseUrl": base,
              "key": key, "name": name, "createdAt": int(time.time()),
              "ownerGitHubId": ADMIN_ID}
    settings["extraConnections"] = {**entries, connection_id: record}
    settings["extraConnectionSequence"] = count
    size = len(json.dumps(settings, ensure_ascii=False).encode("utf-8"))
    if size > MAX_SETTINGS_BYTES:
        return teacher._response(413, {"error": "พื้นที่เก็บคีย์ AWS ใกล้เต็ม กรุณาลบคีย์ที่ไม่ใช้ก่อน"})
    teacher._save_settings(settings)
    return teacher._response(200, {"ok": True, "connection": _public(connection_id, record)})


def remove(body, owner):
    import teacher
    connection_id = body.get("connectionId")
    if (not isinstance(connection_id, str) or not ID_RE.fullmatch(connection_id)
            or body.get("confirmRemove") is not True):
        return teacher._response(400, {"error": "กรุณายืนยันการลบการเชื่อมต่อ"})
    settings = teacher._settings()
    entries = _entries(settings)
    import owner_key_vault
    vault_connection = False
    if connection_id not in entries:
        if not owner_key_vault.enabled():
            return teacher._response(404, {"error": "ไม่พบการเชื่อมต่อ"})
        vault_connection = any(x["id"] == connection_id
                               for x in owner_key_vault.listing())
        if not vault_connection:
            return teacher._response(404, {"error": "ไม่พบการเชื่อมต่อ"})
    # An in-flight job must not have its key revoked mid-run.
    try:
        import cloud_jobs
        if vault_connection:
            busy = cloud_jobs._connection_in_use(owner, connection_id)
        else:
            jobs = json.loads(cloud_jobs._list_jobs({}, owner)["body"]).get("jobs", [])
            busy = any(x.get("connectionId") == connection_id and
                       x.get("state") in ("queued", "running") for x in jobs)
        if busy:
            return teacher._response(409, {"error": "มีงานสอนที่กำลังใช้คีย์นี้ กรุณาพักหรือรอให้จบก่อน"})
    except Exception:
        return teacher._response(503, {"error": "ตรวจงานที่กำลังใช้คีย์ไม่ได้ จึงยังไม่ลบ"})
    if vault_connection:
        if not owner_key_vault.remove(connection_id):
            return teacher._response(409, {"error": "การเชื่อมต่อนี้ถูกลบหรือเปลี่ยนสถานะแล้ว"})
    else:
        settings["extraConnections"] = {k: v for k, v in entries.items() if k != connection_id}
        teacher._save_settings(settings)
    return teacher._response(200, {"ok": True, "connectionId": connection_id, "deleted": True})


def handle(action, body, owner):
    import teacher
    if str(owner) != ADMIN_ID:
        return teacher._response(403, {"error": "บัญชีนี้ไม่มีสิทธิ์จัดการ API แม่"})
    if action == "teacher.connection.list":
        return teacher._response(200, {"ownerGitHubId": ADMIN_ID,
                                       "connections": listing(),
                                       "maxExtra": None if __import__("owner_key_vault").enabled() else MAX_EXTRA_KEYS,
                                       "distribution": "balanced-by-pending-scenes"})
    if action == "teacher.connection.add":
        return add(body, owner)
    if action == "teacher.connection.remove":
        return remove(body, owner)
    if action == "teacher.connection.test":
        conn_id = body.get("connectionId")
        matches = [x for x in listing() if x["id"] == conn_id]
        if not matches:
            return teacher._response(404, {"error": "ไม่พบการเชื่อมต่อ"})
        return teacher._model_test({"provider": matches[0]["provider"],
                                    "connectionId": conn_id})
    return teacher._response(400, {"error": "ไม่รู้จักคำสั่งการเชื่อมต่อ"})
