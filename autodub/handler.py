"""Story Studio Lambda — login and authenticated Thai narration.

POST {"action":"login","password":"..."} -> short-lived signed session token
POST {"action":"verify"} with Authorization: Bearer TOKEN
POST {"action":"synthesize","text":"...","voice":"...","rate":"+6%"} with Bearer TOKEN
Legacy x-dub-key works ONLY before the site password has been provisioned.
The public Function URL is not a secret. Never put SITE_PASSWORD_HASH or SESSION_SECRET in static files.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from collections import defaultdict

import edge_tts
import github_assets

KEY = os.environ.get("DUB_KEY", "")
PASSWORD_HASH = os.environ.get("SITE_PASSWORD_HASH", "")
PASSWORD_SALT = os.environ.get("SITE_PASSWORD_SALT", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
PBKDF2_ITERATIONS = 260_000
SESSION_SECONDS = 8 * 60 * 60
VOICES = {"th-TH-PremwadeeNeural", "th-TH-NiwatNeural"}
MAX_CHARS = 500
RATE_RE = re.compile(r"^[+-]\d{1,2}%$")
PITCH_RE = re.compile(r"^[+-]\d{1,2}Hz$")
# Warm-container login throttle, best effort only (use AWS WAF for strict cross-instance limits).
_ATTEMPTS = defaultdict(list)
_ASSET_SUBMISSIONS = defaultdict(list)


def _resp(code, obj):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(obj, ensure_ascii=False),
    }


def _parse(event):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        body = json.loads(raw)
        if isinstance(body, dict):
            return body
    except (ValueError, UnicodeError, TypeError):
        pass
    return None


def _b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _password_matches(password):
    if not PASSWORD_HASH or not PASSWORD_SALT:
        return False
    if not isinstance(password, str) or not (1 <= len(password) <= 256):
        return False
    try:
        salt = bytes.fromhex(PASSWORD_SALT)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
        return hmac.compare_digest(digest, bytes.fromhex(PASSWORD_HASH))
    except ValueError:
        return False


def _issue_session():
    now = int(time.time())
    payload = _b64(json.dumps({"iat": now, "exp": now + SESSION_SECONDS, "v": 1,
                                "nonce": secrets.token_hex(8)}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + signature, now + SESSION_SECONDS


def _check_session(value):
    if not SESSION_SECRET or not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        payload, signature = value.split(".")
        expected = _b64(hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return False
        item = json.loads(_unb64(payload))
        now = int(time.time())
        return (item.get("v") == 1 and isinstance(item.get("exp"), int) and
                isinstance(item.get("iat"), int) and
                now - 60 <= item["exp"] <= now + SESSION_SECONDS and
                item["iat"] <= now + 60 and item["exp"] > now)
    except (ValueError, TypeError, KeyError, UnicodeError):
        return False


async def _synth(text, voice, rate, pitch):
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    out = bytearray()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            out += chunk["data"]
    return bytes(out)


def handler(event, context):
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    body = _parse(event)
    if body is None:
        return _resp(400, {"error": "ข้อมูลที่ส่งมาอ่านไม่ได้"})
    action = str(body.get("action") or "synthesize")
    secured = bool(PASSWORD_HASH or PASSWORD_SALT or SESSION_SECRET)

    if secured:
        # Never fall back to the old reusable x-dub-key once website login is enabled.
        if not (PASSWORD_HASH and PASSWORD_SALT and SESSION_SECRET):
            return _resp(503, {"error": "ระบบเข้าสู่ระบบยังตั้งค่าไม่ครบ"})
        if action == "login":
            source = str((event.get("requestContext") or {}).get("http", {}).get("sourceIp") or "unknown")
            now = time.time()
            _ATTEMPTS[source] = [t for t in _ATTEMPTS[source] if now - t < 900]
            if len(_ATTEMPTS[source]) >= 8:
                return _resp(429, {"error": "ลองรหัสผ่านหลายครั้งเกินไป กรุณารอ 15 นาที"})
            if not _password_matches(body.get("password")):
                _ATTEMPTS[source].append(now)
                return _resp(401, {"error": "รหัสผ่านไม่ถูกต้อง"})
            _ATTEMPTS.pop(source, None)
            token, expiration = _issue_session()
            return _resp(200, {"token": token, "expiresAt": expiration})
        authorization = str(headers.get("authorization") or "")
        if not authorization.startswith("Bearer ") or not _check_session(authorization[7:]):
            return _resp(401, {"error": "กรุณาเข้าสู่ระบบใหม่"})
        if action == "verify":
            return _resp(200, {"ok": True})
    else:
        if action in ("login", "verify"):
            return _resp(503, {"error": "ยังไม่ได้ตั้งรหัสผ่านเว็บไซต์บน AWS"})
        sent = str(headers.get("x-dub-key", "")).encode("utf-8")
        if not KEY or not hmac.compare_digest(sent, KEY.encode("utf-8")):
            return _resp(401, {"error": "รหัสลับไม่ถูกต้อง"})

    if action == "proposeAsset":
        if not secured:
            return _resp(401, {"error": "ต้องเปิดระบบรหัสผ่านเว็บไซต์ก่อน"})
        if len(json.dumps(body, ensure_ascii=False)) > 16000:
            return _resp(413, {"error": "แบบรูปใหญ่เกินไป"})
        source = str((event.get("requestContext") or {}).get("http", {}).get("sourceIp") or "unknown")
        now = time.time()
        _ASSET_SUBMISSIONS[source] = [t for t in _ASSET_SUBMISSIONS[source] if now - t < 3600]
        if len(_ASSET_SUBMISSIONS[source]) >= 6:
            return _resp(429, {"error": "เสนอรูปได้ไม่เกิน 6 ครั้งต่อชั่วโมง"})
        try:
            proposal = github_assets.propose(body.get("asset"))
        except github_assets.AssetError as exc:
            return _resp(422, {"error": str(exc)})
        _ASSET_SUBMISSIONS[source].append(now)
        return _resp(200, proposal)
    if action != "synthesize":
        return _resp(400, {"error": "ไม่รู้จักคำสั่ง"})
    text = str(body.get("text", "")).strip()
    if not text:
        return _resp(400, {"error": "ไม่มีข้อความ"})
    if len(text) > MAX_CHARS:
        return _resp(400, {"error": "ข้อความยาวเกิน %d ตัวอักษร" % MAX_CHARS})
    voice = str(body.get("voice") or "th-TH-PremwadeeNeural")
    if voice not in VOICES:
        return _resp(400, {"error": "ไม่รู้จักเสียงนี้"})
    rate, pitch = str(body.get("rate") or "+0%"), str(body.get("pitch") or "+0Hz")
    if not RATE_RE.match(rate) or not PITCH_RE.match(pitch):
        return _resp(400, {"error": "รูปแบบ rate/pitch ไม่ถูกต้อง"})
    try:
        audio = asyncio.run(asyncio.wait_for(_synth(text, voice, rate, pitch), timeout=25))
    except Exception as exc:
        return _resp(502, {"error": "สร้างเสียงไม่สำเร็จ: %s" % type(exc).__name__})
    if not audio:
        return _resp(502, {"error": "บริการพากย์ไม่ส่งเสียงกลับมา"})
    return _resp(200, {"audio": base64.b64encode(audio).decode("ascii")})
