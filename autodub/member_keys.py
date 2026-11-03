"""Per-GitHub-user encrypted personal AI-key vault in the existing AWS DynamoDB.

Only handlers with a VERIFIED GitHub OAuth session may call this module. The
numeric GitHub ID is ALWAYS taken from the signed session, never request JSON.
DynamoDB stores AES-256-GCM ciphertext (not API keys) and metadata. Keys survive
device changes but depend on the stable Lambda SESSION_SECRET for decryption.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid

MAX_KEYS = 6
PK_PREFIX = "member-api-vault#"
SUPPORTED = ("gemini", "openrouter")
MAX_MODEL_LENGTH = 120


def _resp(code, obj):
    return {"statusCode": code,
            "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(obj, ensure_ascii=False)}


def _identity(user):
    uid = user.get("sub") if isinstance(user, dict) else None
    if type(uid) is not int or uid <= 0 or user.get("role") != "member":
        raise PermissionError("Verified member GitHub session required")
    return str(uid)


def _table():
    table = os.getenv("TEACHER_FEEDBACK_TABLE")
    if not table:
        raise RuntimeError("Teacher feedback DynamoDB table not configured")
    import boto3
    return boto3.resource("dynamodb").Table(table)


def _master_key():
    secret = os.getenv("SESSION_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("SESSION_SECRET not configured")
    return hashlib.sha256(("ai-animation-member-vault:v1:" + secret).encode()).digest()


def _encrypt(uid, cid, api_key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    data = AESGCM(_master_key()).encrypt(nonce, api_key.encode(),
                                         (uid + ":" + cid).encode())
    return (base64.b64encode(nonce).decode(), base64.b64encode(data).decode())


def _decrypt(uid, cid, row):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        nonce = base64.b64decode(row["nonce"], validate=True)
        data = base64.b64decode(row["encrypted"], validate=True)
        return AESGCM(_master_key()).decrypt(nonce, data,
                                             (uid + ":" + cid).encode()).decode()
    except (KeyError, ValueError, UnicodeError) as exc:
        raise ValueError("Stored API key cannot be decrypted") from exc
    except Exception as exc:
        # Decryption failure is never reported with secret bytes.
        raise ValueError("Stored API key cannot be decrypted") from exc


def _fingerprint(uid, provider, api_key):
    return hmac.new(_master_key(), (uid + ":" + provider + ":" + api_key).encode(),
                    hashlib.sha256).hexdigest()


def _list_rows(table, uid):
    from boto3.dynamodb.conditions import Key
    reply = table.query(KeyConditionExpression=Key("pk").eq(PK_PREFIX + uid),
                        ScanIndexForward=True, Limit=40)
    return [x for x in reply.get("Items", []) if
            x.get("status") == "active" and
            isinstance(x.get("sk"), str) and x["sk"].startswith("key#")]


def _visible(row):
    return {"id": str(row["sk"])[4:], "provider": row["provider"],
            "model": row["model"], "name": row["name"],
            "createdAt": int(row.get("createdAt", 0)),
            "ready": True, "version": "member-v1"}


def list_keys(user):
    uid = _identity(user)
    rows = _list_rows(_table(), uid)
    return _resp(200, {"connections": [_visible(x) for x in rows],
                       "account": {"githubUserId": uid,
                                   "login": str(user.get("login") or "")[:80]},
                       "storage": "aws-dynamodb-encrypted-aes256gcm",
                       "maxConnections": MAX_KEYS})


def _model(provider, raw):
    model = str(raw or ("gemini-3.5-flash-lite" if provider == "gemini" else
                        "openrouter/free"))
    if len(model) > MAX_MODEL_LENGTH or not model:
        raise ValueError("ชื่อ Model ID ไม่ถูกต้อง")
    if provider == "gemini":
        if model not in ("gemini-3.5-flash-lite", "gemini-2.5-flash-lite",
                         "gemini-2.5-flash", "gemini-3-flash"):
            raise ValueError("Gemini รุ่นนี้ยังไม่เปิดให้สมาชิก v1")
    elif provider == "openrouter":
        if model != "openrouter/free" and not (
                model.endswith(":free") and
                re.fullmatch(r"[A-Za-z0-9._/-]{1,100}:free", model)):
            raise ValueError("สมาชิก v1 ใช้ OpenRouter เฉพาะโมเดลฟรี")
    else:
        raise ValueError("ไม่รองรับ AI Provider")
    return model


def add(body, user):
    uid = _identity(user)
    provider = body.get("provider")
    if provider not in SUPPORTED:
        return _resp(400, {"error": "กรุณาเลือก Gemini หรือ OpenRouter"})
    try:
        model = _model(provider, body.get("model"))
    except ValueError as exc:
        return _resp(400, {"error": str(exc)})
    key = body.get("apiKey")
    if (not isinstance(key, str) or not 12 <= len(key) <= 400 or
            key.strip() != key or any(c in key for c in ("\r", "\n", "\x00"))):
        return _resp(400, {"error": "API Key ไม่ถูกต้อง"})
    table = _table()
    rows = _list_rows(table, uid)
    if len(rows) >= MAX_KEYS:
        return _resp(409, {"error": "บัญชีนี้มี API Key ครบ 6 รายการแล้ว"})
    fingerprint = _fingerprint(uid, provider, key)
    if any(hmac.compare_digest(str(x.get("fingerprint", "")), fingerprint) for x in rows):
        return _resp(409, {"error": "API Key นี้ผูกกับบัญชี GitHub อยู่แล้ว"})
    number = max((int(x.get("sequence", 0)) for x in rows), default=0) + 1
    cid = uuid.uuid4().hex
    nonce, encrypted = _encrypt(uid, cid, key)
    title = ("Gemini" if provider == "gemini" else "OpenRouter") + " · " + model.split("/")[-1] + " · #" + str(number)
    row = {"pk": PK_PREFIX + uid, "sk": "key#" + cid,
           "provider": provider, "model": model, "name": title[:110],
           "nonce": nonce, "encrypted": encrypted, "fingerprint": fingerprint,
           "status": "active", "sequence": number, "createdAt": int(time.time())}
    table.put_item(Item=row, ConditionExpression="attribute_not_exists(pk)")
    return _resp(200, {"saved": True, "connection": _visible(row),
                       "accountId": uid})


def _item(table, uid, connection_id):
    if not isinstance(connection_id, str) or not re.fullmatch(r"[a-f0-9]{32}", connection_id):
        return None
    row = table.get_item(Key={"pk": PK_PREFIX + uid, "sk": "key#" + connection_id},
                         ConsistentRead=True).get("Item")
    return row if row and row.get("status") == "active" else None


def resolve(user, connection_id):
    """Return server-side secret only; never expose this helper through a route."""
    uid = _identity(user)
    row = _item(_table(), uid, connection_id)
    if not row:
        return None
    return {"apiKey": _decrypt(uid, connection_id, row),
            "provider": row["provider"], "model": row["model"]}


def remove(body, user):
    uid = _identity(user)
    cid = body.get("connectionId")
    if body.get("confirmRemove") is not True:
        return _resp(400, {"error": "กรุณายืนยันการลบ API Key"})
    table = _table()
    row = _item(table, uid, cid)
    if not row:
        return _resp(404, {"error": "ไม่พบ API Key ของบัญชีนี้"})
    # Existing Lambda IAM allows UpdateItem, but not DynamoDB DeleteItem.
    # Remove encrypted material, not only the UI listing.
    table.update_item(
        Key={"pk": PK_PREFIX + uid, "sk": "key#" + cid},
        UpdateExpression="SET #s=:revoked, updatedAt=:now REMOVE encrypted, nonce, fingerprint",
        ConditionExpression="#s=:active",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":revoked": "revoked", ":active": "active",
                                   ":now": int(time.time())})
    return _resp(200, {"deleted": True, "connectionId": cid})


def handle(action, body, user):
    try:
        if action == "member.keys.list":
            return list_keys(user)
        if action == "member.keys.add":
            return add(body, user)
        if action == "member.keys.remove":
            return remove(body, user)
        return _resp(400, {"error": "Unknown member vault action"})
    except PermissionError:
        return _resp(403, {"error": "สำหรับบัญชี GitHub สมาชิกที่ผ่านการยืนยันเท่านั้น"})
    except Exception as exc:
        return _resp(503, {"error": "คลังคีย์ AWS ไม่พร้อม: " + type(exc).__name__})
