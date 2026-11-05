"""Owner-only AI Mother production routing and real Gemini speech synthesis.

No provider secret is sent to the client. Production proposals are bounded and
validated again in the browser's StudioAPI before any project edit.
"""
import base64
import io
import json
import re
import wave

ROLES = (
    "story-analyst", "continuity-keeper", "scene-director",
    "storyboard-director", "environment-artist", "character-artist",
    "prop-artist", "layout-director", "motion-director",
    "timeline-editor", "quality-inspector",
)
DURATION_ROLES = {"scene-director", "timeline-editor"}
SUBTITLE_ROLES = {"timeline-editor"}
TTS_MODELS = {
    "gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts",
}
TTS_VOICES = {"Kore", "Puck", "Aoede", "Charon", "Fenrir", "Leda", "Orus", "Zephyr"}


def _error(code, message):
    import teacher
    return teacher._response(code, {"error": message})


def _owner(owner):
    import teacher_connections
    return str(owner) == teacher_connections.ADMIN_ID


def _connection(body):
    import teacher
    import teacher_connections
    provider = body.get("provider")
    cid = body.get("connectionId")
    if provider not in teacher.PROVIDERS or not isinstance(cid, str):
        return None
    if not any(x["id"] == cid and x["provider"] == provider and x["ready"]
               for x in teacher_connections.listing()):
        return None
    cfg = teacher_connections.resolve(teacher._settings(), provider, cid)
    return cfg if cfg.get("key") else None


def _review(body):
    import teacher
    role = body.get("roleId")
    scenes = body.get("scenes")
    if role not in ROLES:
        return _error(400, "ไม่พบตำแหน่งผลิต AI แม่")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 3:
        return _error(400, "งาน AI แม่ต้องมี 1–3 ฉากต่อชุด")
    if not _connection(body):
        return _error(503, "AI แม่ที่เลือกไม่ได้เชื่อมต่อแล้ว")
    ids = set()
    cleaned = []
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("id"), str):
            return _error(400, "ข้อมูลฉากไม่ถูกต้อง")
        sid = scene["id"][:100]
        if not sid or sid in ids:
            return _error(400, "ฉากมี ID ว่างหรือซ้ำ")
        ids.add(sid)
        cleaned.append({
            "id": sid,
            "duration": scene.get("duration"),
            "voiceover": str(scene.get("voiceover") or "")[:650],
            "notes": str(scene.get("notes") or "")[:400],
            "camera": str(scene.get("camera") or "")[:250],
            "actors": str(scene.get("actors") or "")[:650],
            "assets": str(scene.get("assets") or "")[:300],
        })
    instruction = body.get("instruction") or ""
    if not isinstance(instruction, str) or len(instruction) > 500:
        return _error(400, "คำสั่งเสริมต้องไม่เกิน 500 ตัวอักษร")
    response = teacher._chat({
        "provider": body["provider"],
        "connectionId": body["connectionId"],
        "message": "Role: " + role + ". Review only the exact scene IDs supplied. "
                   "Focus on actionable production refinements. Owner direction: "
                   + (instruction or "Preserve story and manually locked elements."),
        "context": json.dumps({"scenes": cleaned}, ensure_ascii=False),
        "_internalMaxOutput": 2000,
    }, production_role=role)
    if response.get("statusCode") != 200:
        return response
    try:
        parsed = json.loads(response["body"])
    except (TypeError, ValueError):
        return _error(502, "AI แม่ส่งผลที่อ่านไม่ได้")
    allowed = {"notes"}
    if role in DURATION_ROLES:
        allowed.add("duration")
    if role in SUBTITLE_ROLES:
        allowed.add("subtitle")
    ops = []
    for op in parsed.get("ops", []):
        if op.get("id") not in ids:
            continue
        patch = {key: val for key, val in op["patch"].items() if key in allowed}
        if patch:
            ops.append({"op": "updateScene", "id": op["id"], "patch": patch})
    return teacher._response(200, {
        "ok": True, "roleId": role, "connectionId": body["connectionId"],
        "provider": parsed.get("provider"), "model": parsed.get("model"),
        "reply": str(parsed.get("reply") or "")[:1200], "ops": ops[:3],
        "applied": False, "limits": "Scene notes + validated timing/subtitles only",
    })


def _speech(body):
    """Gemini native TTS, not Edge TTS disguised as the selected mother."""
    import teacher
    from urllib.parse import quote
    cfg = _connection(body)
    if not cfg:
        return _error(503, "ไม่พบ AI แม่ที่เลือกสำหรับพากย์")
    if body.get("provider") != "gemini":
        return _error(422, "โมเดลนี้ไม่รองรับเสียงพูดโดยตรง เลือก AI แม่ Gemini TTS หรือพากย์ด้วยระบบ")
    model = body.get("ttsModel") or "gemini-3.8-flash-lite-tts"
    voice = body.get("voice") or "Kore"
    text = body.get("text")
    if model not in TTS_MODELS or voice not in TTS_VOICES:
        return _error(400, "โมเดล TTS หรือเสียงที่เลือกไม่รองรับ")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 175:
        return _error(400, "บทพากย์ต้องมี 1–175 ตัวอักษรต่อคลิป")
    interactions = model.startswith("gemini-3.8-") or model.startswith("gemini-3.1-")
    if interactions:
        # Gemini 3.8 REST returns WAV bytes in steps[].content[] with type=audio;
        # output_audio is an SDK convenience property, not a required REST field.
        endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        payload = {
            "model": model,
            "input": [{"type": "user_input", "content": [
                {"type": "text", "text": text.strip()}]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice}]},
        }
    else:
        # Older Gemini 2.5 TTS uses generateContent and returns inlineData PCM.
        endpoint = ("https://generativelanguage.googleapis.com/v1beta/models/"
                    + quote(model, safe="-._") + ":generateContent")
        payload = {
            "contents": [{"parts": [{"text": "Read this Thai narration naturally and faithfully, "
                                              "without adding any words: " + text.strip()}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        }
    # _post_json has a 180 KB response ceiling for normal chat; raw audio needs
    # a separately bounded response (Lambda's response limit still applies).
    import urllib.request
    import urllib.error
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=raw, method="POST", headers={
        "Content-Type": "application/json", "x-goog-api-key": cfg["key"]})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=26) as resp:
            result = json.loads(resp.read(4500000))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            return _error(422, "บัญชีหรือโมเดล Gemini TTS ยังไม่มีสิทธิ์ใช้งาน")
        if exc.code == 429:
            return _error(429, "AI แม่ถึงโควตาพากย์ กรุณาลองอีกครั้งภายหลัง")
        return _error(502, "Gemini TTS ไม่พร้อม (HTTP " + str(exc.code) + ")")
    except Exception:
        return _error(503, "เชื่อมต่อ Gemini TTS ไม่สำเร็จ")
    if interactions:
        # Raw REST schema: {"steps":[{"type":"model_output","content":[
        # {"type":"audio","data":"base64..."}]}]}; never treat JSON
        # reasoning or text as binary audio.
        parts = [part for step in result.get("steps", [])
                 if isinstance(step, dict) and step.get("type") == "model_output"
                 for part in step.get("content", [])
                 if isinstance(part, dict) and part.get("type") == "audio"]
        audio = next(({"data": x.get("data", ""),
                       "mimeType": x.get("mime_type", "audio/wav")}
                      for x in reversed(parts) if isinstance(x.get("data"), str)), None)
    else:
        parts = [part for candidate in result.get("candidates", [])
                 for entry in candidate.get("content", {}).get("parts", [])
                 for part in [entry.get("inlineData")] if isinstance(part, dict)]
        audio = next((x for x in parts if str(x.get("mimeType", "")).startswith("audio/")), None)
    if not audio:
        return _error(502, "AI แม่ไม่ได้ส่งไฟล์เสียงกลับมา")
    try:
        pcm = base64.b64decode(audio.get("data", ""), validate=True)
        if not pcm or len(pcm) > 2800000:
            return _error(502, "ไฟล์เสียง AI แม่ว่างหรือมีขนาดเกินกำหนด")
        rate_match = re.search(r"rate=(\d+)", str(audio.get("mimeType", "")))
        rate = int(rate_match.group(1)) if rate_match else 24000
        if rate < 8000 or rate > 48000:
            return _error(502, "รูปแบบเสียงของ AI แม่ไม่รองรับ")
        if pcm.startswith(b"RIFF"):
            wav = pcm
        else:
            buf = io.BytesIO()
            with wave.open(buf, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(rate)
                writer.writeframes(pcm)
            wav = buf.getvalue()
    except Exception:
        return _error(502, "แปลงเสียงของ AI แม่ไม่สำเร็จ")
    return teacher._response(200, {
        "audio": base64.b64encode(wav).decode("ascii"), "mimeType": "audio/wav",
        "engine": "gemini-tts", "connectionId": body["connectionId"], "model": model,
    })


def handle(action, body, owner):
    if not _owner(owner):
        return _error(403, "เฉพาะ GitHub แอดมินจึงจะสั่ง AI แม่ผลิตหรือพากย์ได้")
    if action == "teacher.production.review":
        return _review(body)
    if action == "teacher.production.speech":
        return _speech(body)
    return _error(400, "ไม่รู้จักคำสั่ง AI แม่")
