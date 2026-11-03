"""Read-only, evidence-aware conversation about AI-ANIMATION and AI children.

An external LLM never gains arbitrary repository/AWS access. Server prepares a
bounded, non-secret snapshot from a reviewed feature inventory and read-only
learning status; project overview is optional client-supplied data, labelled
accordingly. No chat response can trigger edits, deploy or training.
"""
import json
import os
import re
import time

# Curated from the product code. This is not a live GitHub search, and must
# be updated if the app changes. Treat missing features as unknown.
KNOWLEDGE_VERSION = "2026-11-03"
# Live repository evidence is opt-in and read-only for the authenticated owner.
FEATURES = [
    {"name": "Story Studio", "detail": "นำเข้า JSON เรื่อง/ฉากแล้วพรีวิวและแก้ไขโปรเจกต์อนิเมชัน"},
    {"name": "AI Mother", "detail": "เชื่อมผู้ให้บริการ Gemini/OpenRouter หรือ compatible ด้วยคีย์เจ้าของที่เก็บใน AWS; ตรวจบทและเสนอคำแก้"},
    {"name": "AI Child — Thai repetition", "detail": "เรียนรู้ตัวอย่างคำซ้ำ/เจตนาจากบทเรียนที่เจ้าของอนุมัติ; โมเดล CPU ให้คำแนะนำ ไม่ใช่ LLM แต่งเรื่อง"},
    {"name": "AI Child — narrative", "detail": "รับบทเรียนตรวจความต่อเนื่อง/ความชัด/จังหวะที่ AI แม่สอน, ผ่าน QA ก่อนใช้ฝึก CPU แบบจำแนกประเภท"},
    {"name": "Six production helpers", "detail": "จัดองค์ประกอบ, SVG, motion, voice, timing, QA; เป็นขั้นตอนงาน/บทบาท ไม่ใช่โมเดล LLM 6 ตัวที่ฝึกแยก"},
    {"name": "Cloud Background Jobs", "detail": "มีโค้ดสำหรับ Step Functions และ Checkpoint; ต้องติดตั้งบริการ AWS ครั้งแรกก่อนจึงใช้จริงได้"},
    {"name": "Export", "detail": "ส่งออกวิดีโอและ JSON ผ่านสตูดิโอ; เสียง/วิดีโอต้องทดสอบจากผลงานจริงก่อนยืนยันว่าไม่มีปัญหา"},
    {"name": "Member access", "detail": "GitHub OAuth แยกแอดมินออกจากสมาชิก; สมาชิกเรียกผู้ช่วย 6 บทบาทด้วย API Key ของตนเอง"},
]
BOUNDARIES = [
    "โมเดลที่ดึง API มายังไม่ถูกฝึกด้วยโค้ด AI-ANIMATION โดยอัตโนมัติ",
    "ไม่มีสิทธิ์อ่าน GitHub, AWS secrets, CloudWatch, วิดีโอ, อีเมล หรือไฟล์ทั้งหมดโดยตัวมันเอง",
    "ข้อมูลฟีเจอร์คือสรุปที่ดูแลไว้ในเซิร์ฟเวอร์ ไม่ใช่การสแกนโค้ด GitHub สด",
    "สถานะฝึกมาจากการอ่าน AWS จริง ณ เวลาขอ หากอ่านไม่สำเร็จต้องบอกว่ายังตรวจไม่ได้",
    "บทเรียนบันทึกแล้วไม่เท่ากับฝึกน้ำหนักเสร็จ; โมเดล CPU จำแนกประเภทไม่ใช่โมเดลเขียนบทอิสระ",
    "คำตอบในห้องนี้เป็นคำแนะนำเท่านั้น ไม่แก้ JSON ไม่ Deploy ไม่สั่งฝึก และไม่รับรองว่าแอปทำงานสำเร็จ",
]


def _response(code, body):
    import teacher
    return teacher._response(code, body)


def _aws_snapshot():
    """Read-only AWS measurements. Unavailable is never silently reported as zero."""
    try:
        import story_auto_train
        response = story_auto_train.status()
        if response.get("statusCode") != 200:
            raise RuntimeError("student status unavailable")
        raw = json.loads(response["body"])
        counts = raw.get("counts") or {}
        last = raw.get("lastTraining") or {}
        if not isinstance(last, dict):
            last = {}
        model = last.get("model") or {}
        if not isinstance(model, dict):
            model = {}
        return {"source": "aws-student-storyAutoStatus", "available": True,
                "labels": counts.get("labels", {}),
                "savedLessons": counts.get("rows"),
                "distinctProjects": counts.get("projects"),
                "requirements": {"minimumRows": counts.get("minimumRows"),
                                 "minimumProjects": counts.get("minimumProjects"),
                                 "minimumPerIssue": counts.get("minimumPerIssue")},
                "readyForTraining": raw.get("readyForTraining") is True,
                "activeVersion": raw.get("activeVersion"),
                "trainedGenerativeLLM": False,
                "lastTrainingStatus": last.get("status") or model.get("status"),
                "availableModelVersions": len(raw.get("models") or [])}
    except Exception:
        return {"source": "aws-student-storyAutoStatus", "available": False,
                "reason": "ยังอ่านสถานะ AI ลูกจาก AWS ไม่สำเร็จ"}


def _repetition_snapshot():
    """Only metadata: no training samples, model weights or lesson texts."""
    try:
        import student_learning
        response = student_learning._model({})
        if response.get("statusCode") != 200:
            raise RuntimeError("model unavailable")
        item = json.loads(response["body"]).get("active") or {}
        return {"source": "aws-student-model", "available": True,
                "activeVersion": str(item.get("version") or "")[:100] or None,
                "modelType": "CPU repetition-intent classifier, not a generative LLM"}
    except Exception:
        return {"source": "aws-student-model", "available": False,
                "reason": "ยังอ่านสถานะโมเดลคำซ้ำจาก AWS ไม่สำเร็จ"}


def _snapshot():
    import teacher
    providers = []
    try:
        status = json.loads(teacher._status()["body"])
        providers = [{"id": p["id"], "model": p.get("model", ""),
                      "ready": p.get("ready") is True}
                     for p in status.get("providers", [])
                     if p.get("id") in teacher.PROVIDERS]
    except Exception:
        pass
    return {"knowledgeVersion": KNOWLEDGE_VERSION,
            "knowledgeType": "curated-backend-manifest-not-live-repository-scan",
            "features": FEATURES, "boundaries": BOUNDARIES,
            "providers": providers, "narrativeChild": _aws_snapshot(),
            "repetitionChild": _repetition_snapshot(),
            "measuredAt": int(time.time())}


def _context(project):
    """Use strictly limited client project metadata; never trust it as authority."""
    if not isinstance(project, dict):
        return None
    safe = {}
    for key in ("title", "aspect", "selectedEpisode", "selectedScene", "mode"):
        val = project.get(key)
        if isinstance(val, str):
            safe[key] = val[:160]
    for key in ("episodeCount", "sceneCount"):
        n = project.get(key)
        if type(n) is int and 0 <= n <= 50000:
            safe[key] = n
    return safe


def handle(action, body):
    if action == "teacher.advisorStatus":
        return _response(200, {"snapshot": _snapshot()})
    if action != "teacher.advisorChat":
        return _response(400, {"error": "Unknown AI Mother advisor action"})
    message = body.get("message")
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 2500:
        return _response(400, {"error": "ข้อความต้องมี 1–2500 ตัวอักษร"})
    provider = body.get("provider")
    import teacher
    if provider not in teacher.PROVIDERS:
        return _response(400, {"error": "กรุณาเลือก AI Provider ที่รองรับ"})
    snapshot = _snapshot()
    evidence = {"verifiedAWS": {
        "narrativeChild": snapshot["narrativeChild"],
        "repetitionChild": snapshot["repetitionChild"],
        "providers": snapshot["providers"],
        "measuredAt": snapshot["measuredAt"]},
        "reviewedAppManifest": {
            "version": KNOWLEDGE_VERSION, "knowledgeVersion": KNOWLEDGE_VERSION,
            "features": FEATURES,
            "limitations": BOUNDARIES},
        "clientReportedProject": _context(body.get("project"))}
    context = json.dumps(evidence, ensure_ascii=False, separators=(",", ":"))
    result = teacher._chat({"provider": provider, "message": message,
                            "context": context, "history": body.get("history", []),
                            "_internalMaxOutput": 1400}, advisor_mode=True)
    if result["statusCode"] != 200:
        return result
    parsed = json.loads(result["body"])
    return _response(200, {"reply": str(parsed.get("reply") or "")[:4000],
                           "provider": parsed.get("provider"),
                           "model": parsed.get("model"),
                           "evidence": {"manifestVersion": KNOWLEDGE_VERSION,
                                        "narrativeAWS": snapshot["narrativeChild"]["available"],
                                        "repetitionAWS": snapshot["repetitionChild"]["available"],
                                        "projectContext": evidence["clientReportedProject"] is not None},
                           "applied": False, "trained": False})
