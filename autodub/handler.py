"""Lambda: ข้อความ -> mp3 (Edge TTS เสียงไทย) สำหรับปุ่ม "พากย์อัตโนมัติ" ใน Story Studio

POST JSON  {"text": "...", "voice": "th-TH-NiwatNeural", "rate": "+0%", "pitch": "+0Hz"}
Header     x-dub-key: <DUB_KEY>
ตอบกลับ    {"audio": "<base64 mp3>"}  หรือ {"error": "..."}
CORS ตั้งที่ Function URL (ดู deploy.sh) ไม่ต้องใส่ header CORS ในโค้ดนี้
"""
import asyncio
import base64
import hmac
import json
import os
import re

import edge_tts

KEY = os.environ.get("DUB_KEY", "")
VOICES = {"th-TH-PremwadeeNeural", "th-TH-NiwatNeural"}
MAX_CHARS = 500
RATE_RE = re.compile(r"^[+-]\d{1,2}%$")
PITCH_RE = re.compile(r"^[+-]\d{1,2}Hz$")


def _resp(code, obj):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


async def _synth(text, voice, rate, pitch):
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    out = bytearray()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            out += chunk["data"]
    return bytes(out)


def handler(event, context):
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    sent = str(headers.get("x-dub-key", "")).encode("utf-8")
    if not KEY or not hmac.compare_digest(sent, KEY.encode("utf-8")):
        return _resp(401, {"error": "รหัสลับไม่ถูกต้อง"})

    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        body = json.loads(raw)
    except Exception:
        return _resp(400, {"error": "ข้อมูลที่ส่งมาอ่านไม่ได้"})

    text = str(body.get("text", "")).strip()
    if not text:
        return _resp(400, {"error": "ไม่มีข้อความ"})
    if len(text) > MAX_CHARS:
        return _resp(400, {"error": "ข้อความยาวเกิน %d ตัวอักษร" % MAX_CHARS})

    voice = str(body.get("voice") or "th-TH-PremwadeeNeural")
    if voice not in VOICES:
        return _resp(400, {"error": "ไม่รู้จักเสียงนี้"})
    rate = str(body.get("rate") or "+0%")
    pitch = str(body.get("pitch") or "+0Hz")
    if not RATE_RE.match(rate) or not PITCH_RE.match(pitch):
        return _resp(400, {"error": "รูปแบบ rate/pitch ไม่ถูกต้อง"})

    try:
        audio = asyncio.run(asyncio.wait_for(_synth(text, voice, rate, pitch), timeout=25))
    except Exception as exc:  # Edge TTS ใช้ไม่ได้/ถูกบล็อก/หมดเวลา
        return _resp(502, {"error": "สร้างเสียงไม่สำเร็จ: %s" % type(exc).__name__})
    if not audio:
        return _resp(502, {"error": "Edge TTS ไม่ส่งเสียงกลับมา"})
    return _resp(200, {"audio": base64.b64encode(audio).decode("ascii")})
