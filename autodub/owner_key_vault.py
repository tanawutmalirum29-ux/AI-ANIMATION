"""Owner-only scalable API vault, isolated from member keys and legacy SSM.

The existing teacher feedback table is reused. Each owner credential has its own
AES-256-GCM ciphertext row, so SSM's 4 KiB parameter limit does not limit
the number of connected mothers. SESSION_SECRET must remain stable.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
import time
import uuid

ADMIN_ID = "225819900"
PK = "teacher-owner-vault#" + ADMIN_ID
ID_RE = re.compile(r"key-[a-f0-9]{16}\Z")


def enabled():
    # Use the expanded vault whenever AWS storage and a stable server secret
    # exist; an explicit 0 remains a safe emergency opt-out.
    return bool(os.getenv("TEACHER_OWNER_VAULT_V2") != "0"
                and os.getenv("TEACHER_FEEDBACK_TABLE")
                and len(os.getenv("SESSION_SECRET", "")) >= 32)


def _table():
    if not enabled():
        raise RuntimeError("Owner vault requires the teacher table and stable session secret")
    import boto3
    return boto3.resource("dynamodb").Table(os.environ["TEACHER_FEEDBACK_TABLE"])


def _master_key():
    secret = os.environ["SESSION_SECRET"]
    return hashlib.sha256(("ai-animation-owner-vault:v1:" + secret).encode()).digest()


def _fingerprint(provider, key):
    return hmac.new(_master_key(), (provider + ":" + key).encode(),
                    hashlib.sha256).hexdigest()


def _aad(connection_id):
    return (ADMIN_ID + ":" + connection_id).encode()


def _encrypt(connection_id, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_master_key()).encrypt(nonce, key.encode(), _aad(connection_id))
    return base64.b64encode(nonce).decode(), base64.b64encode(encrypted).decode()


def _decrypt(connection_id, row):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        nonce = base64.b64decode(row["nonce"], validate=True)
        encrypted = base64.b64decode(row["encrypted"], validate=True)
        return AESGCM(_master_key()).decrypt(nonce, encrypted, _aad(connection_id)).decode()
    except Exception as exc:
        raise ValueError("Owner credential cannot be decrypted") from exc


def _rows():
    """All pages; no artificial count cap. Only the owner partition is queried."""
    from boto3.dynamodb.conditions import Key
    table = _table()
    values, cursor = [], None
    while True:
        kwargs = {"KeyConditionExpression": Key("pk").eq(PK), "Limit": 100}
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor
        response = table.query(**kwargs)
        values.extend(row for row in response.get("Items", [])
                      if row.get("status") == "active"
                      and ID_RE.fullmatch(str(row.get("id") or "")))
        cursor = response.get("LastEvaluatedKey")
        if not cursor:
            break
    return values


def _public(row):
    return {"id": row["id"], "provider": row["provider"],
            "model": row["model"], "name": row["name"],
            "ready": True, "legacy": False, "createdAt": int(row["createdAt"]),
            "ownerGitHubId": ADMIN_ID}


def listing():
    return [_public(row) for row in _rows()]


def aliases():
    """Read name overrides from isolated metadata rows, not secret fields."""
    from boto3.dynamodb.conditions import Key
    table = _table()
    result, cursor = {}, None
    while True:
        options = {
            "KeyConditionExpression": Key("pk").eq(PK)
                & Key("sk").begins_with("alias#"),
            "ConsistentRead": True, "Limit": 100}
        if cursor:
            options["ExclusiveStartKey"] = cursor
        page = table.query(**options)
        for row in page.get("Items", []):
            sk = str(row.get("sk") or "")
            alias = row.get("alias")
            if sk.startswith("alias#") and isinstance(alias, str) and alias:
                result[sk[6:]] = alias
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            return result


def set_alias(connection_id, alias):
    """Only cosmetic data is overwritten; credential material stays intact."""
    if (not isinstance(connection_id, str)
            or not (ID_RE.fullmatch(connection_id)
                    or connection_id in ("default-gemini", "default-openrouter",
                                         "default-compatible"))
            or not isinstance(alias, str)):
        raise ValueError("Invalid connection alias")
    _table().put_item(Item={
        "pk": PK, "sk": "alias#" + connection_id,
        "alias": alias, "updatedAt": int(time.time())})


def add(provider, model, base, key, legacy_keys=()):
    fingerprint = _fingerprint(provider, key)
    if any(hmac.compare_digest(fingerprint, _fingerprint(provider, old))
           for old in legacy_keys):
        raise ValueError("duplicate-key")
    if any(hmac.compare_digest(fingerprint, str(row.get("fingerprint") or ""))
           for row in _rows()):
        raise ValueError("duplicate-key")
    now = int(time.time())
    connection_id = "key-" + uuid.uuid4().hex[:16]
    nonce, encrypted = _encrypt(connection_id, key)
    row = {"pk": PK, "sk": "connection#" + connection_id,
           "id": connection_id, "provider": provider, "model": model,
           "baseUrl": base, "name": (provider.upper() + " · " +
              model.rsplit("/", 1)[-1][:36] + " · #" + connection_id[-6:]),
           "createdAt": now, "status": "active",
           "nonce": nonce, "encrypted": encrypted, "fingerprint": fingerprint}
    _table().put_item(Item=row, ConditionExpression="attribute_not_exists(pk)")
    return _public(row)


def resolve(provider, connection_id):
    if not isinstance(connection_id, str) or not ID_RE.fullmatch(connection_id):
        return {}
    row = _table().get_item(
        Key={"pk": PK, "sk": "connection#" + connection_id},
        ConsistentRead=True).get("Item")
    if not row or row.get("status") != "active" or row.get("provider") != provider:
        return {}
    return {"key": _decrypt(connection_id, row), "model": row["model"],
            "baseUrl": row.get("baseUrl", "")}


def remove(connection_id):
    if not isinstance(connection_id, str) or not ID_RE.fullmatch(connection_id):
        return False
    from botocore.exceptions import ClientError
    try:
        _table().update_item(
            Key={"pk": PK, "sk": "connection#" + connection_id},
            UpdateExpression="SET #status=:revoked, updatedAt=:now REMOVE encrypted, nonce, fingerprint",
            ConditionExpression="#status=:active",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":active": "active", ":revoked": "revoked", ":now": int(time.time())})
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise
    return True
