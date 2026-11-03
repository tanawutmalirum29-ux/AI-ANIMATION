"""Member v1 gateway for six fixed roles, not separately trained weight models.

Members can use one-time BYOK credentials or AES-GCM encrypted keys persisted
in DynamoDB under their verified GitHub numeric ID. Admin keys are separate.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
import time

ROLES={
 "composition":"AI-1 จัดองค์ประกอบ: วิเคราะห์ตำแหน่งตัวละคร/วัตถุ ฉากและความต่อเนื่อง ให้ข้อเสนอเป็นขั้นตอน",
 "assets":"AI-2 สร้าง SVG: อธิบายวัตถุที่ควรมี รูปทรง SVG มาตรฐานที่ปลอดภัยและลำดับภาพ ไม่สร้างโค้ดรันเอง",
 "motion":"AI-3 กำกับโมชั่น: ออกแบบ keyframe ท่าทาง การจับของและจังหวะเหตุการณ์ โดยไม่เปลี่ยนบทเอง",
 "voice":"AI-4 พากย์เสียง: เสนอการแบ่งวลีและอารมณ์การพากย์ที่สอดคล้องภาษาไทย ไม่อ้างว่าสร้างไฟล์เสียงจริง",
 "structure":"AI-5 จัดเวลา: แนะนำการแบ่งฉากและตอน 60–65 วินาที ไม่อ้างว่าวัดเวลาเสียงถ้าไม่มีไฟล์",
 "qa":"AI-6 ตรวจ QA: ตรวจข้อผิดพลาด JSON/ความต่อเนื่อง/เหตุผล ระบุสิ่งที่ต้องทดสอบจริง"
}
RELEASE_ID = "member-six-v1"
# First published product release: 6 fixed role prompts, NOT 6 fine-tuned LLMs.
# New AI Child classifier weights cannot silently change these 6 public roles.
RELEASE_CAPABILITIES = {
 "composition": "วิเคราะห์องค์ประกอบฉากและเสนอการจัดวางเท่านั้น",
 "assets": "ให้คำแนะนำโครงสร้าง SVG ไม่เรนเดอร์หรือส่งไฟล์",
 "motion": "เสนอคีย์เฟรมและท่าทาง ไม่สร้างวิดีโอ",
 "voice": "แนะนำอารมณ์และวรรคเสียง ไม่สร้างไฟล์พากย์",
 "structure": "วางจังหวะฉากและตอน ไม่วัดความยาวเสียงจริง",
 "qa": "ตรวจบทและ JSON จากข้อความที่แนบ ไม่ทดสอบวิดีโอจริง",
}
_ATTEMPTS=defaultdict(list)

def _resp(code,obj):
    return {"statusCode":code,"headers":{"Content-Type":"application/json",
            "Cache-Control":"no-store"},"body":json.dumps(obj,ensure_ascii=False)}

def catalog():
    return _resp(200, {
        "release": RELEASE_ID, "version": "1.0",
        "moduleCount": len(ROLES),
        "modelType": "six-fixed-specialist-prompts-using-member-provider",
        "trainedSeparateWeights": False,
        "autoUpgrades": False,
        "modules": [{"id": key, "role": ROLES[key],
                     "capability": RELEASE_CAPABILITIES[key],
                     "release": RELEASE_ID, "trainedWeights": False}
                    for key in ROLES],
        "adminFeaturesAvailable": False})


def run(body,user):
    if user.get("role") != "member":
        return _resp(403, {"error": "โหมดผู้ช่วย v1 สำหรับสมาชิกเท่านั้น"})
    if body.get("release") not in (None, RELEASE_ID):
        return _resp(409, {"error": "สมาชิกเปิดใช้งานได้เฉพาะโมดูลรุ่น 1"})
    role=body.get("role")
    if role not in ROLES:
        return _resp(400,{"error":"เลือก AI-1 ถึง AI-6 เท่านั้น"})
    provider=body.get("provider")
    connection_id=body.get("connectionId")
    key_stored=False
    if connection_id:
        import member_keys
        config = member_keys.resolve(user, connection_id)
        if not config:
            return _resp(404, {"error": "ไม่พบ API Key ที่ผูกกับบัญชี GitHub นี้"})
        provider=config["provider"]
        key=config["apiKey"]
        model_from_vault=config["model"]
        key_stored=True
    else:
        key=body.get("apiKey")
        model_from_vault=None
    if provider not in ("gemini","openrouter"):
        return _resp(400,{"error":"รองรับ Gemini หรือ OpenRouter เท่านั้น"})
    if not isinstance(key,str) or not 12<=len(key)<=400 or "\n" in key:
        return _resp(400,{"error":"กรุณาเชื่อม API Key ของบัญชีคุณ"})
    message=body.get("message")
    context=body.get("context","")
    if (not isinstance(message,str) or not 1<=len(message)<=2500 or
        not isinstance(context,str) or len(context)>9000):
        return _resp(400,{"error":"ข้อความหรือ JSON ยาวเกินขนาดที่รองรับ"})
    uid=user["sub"]
    current=time.time()
    _ATTEMPTS[uid]=[t for t in _ATTEMPTS[uid] if t>current-60]
    if len(_ATTEMPTS[uid])>=6:
        return _resp(429,{"error":"จำกัด 6 คำขอต่อนาทีต่อบัญชี"})
    _ATTEMPTS[uid].append(current)
    system=("คุณเป็น "+ROLES[role]+". ทำงานตามคำขอภายในข้อมูลที่ได้รับอย่างซื่อสัตย์ "
      "อย่าสร้างข้อเท็จจริงที่ไม่มีใน JSON. แสดงข้อเสนอเป็นภาษาไทย กระชับ มีเหตุผล "
      "คุณเป็นหนึ่งในหกบทบาทเฉพาะทางรุ่น 1.0 ที่กำหนดไว้เท่านั้น "
      "ห้ามอ้างว่าได้ฝึกน้ำหนักโมเดลนี้หรือเรียกใช้ระบบ AI แม่/โมเดลภายใน AWS. "
      "ขอบเขตตำแหน่งของคุณ: "+RELEASE_CAPABILITIES[role]+". "
      "คำตอบเป็นข้อเสนอ ไม่ใช่การเปลี่ยนไฟล์หรืองานจริง.")
    try:
        if provider=="openrouter":
            model=str(model_from_vault or body.get("model") or "openrouter/free")
            if model!="openrouter/free" and not (model.endswith(":free") and
                 re.fullmatch(r"[A-Za-z0-9._/-]{1,100}:free",model)):
                return _resp(400,{"error":"OpenRouter ผู้ใช้ทั่วไปอนุญาตเฉพาะรุ่นฟรี"})
            url="https://openrouter.ai/api/v1/chat/completions"
            payload={"model":model,"messages":[{"role":"system","content":system},
                     {"role":"user","content":message+"\nJSON/บริบท:\n"+context}],
                     "max_tokens":1250}
            headers={"Authorization":"Bearer "+key,"Content-Type":"application/json",
                     "Accept":"application/json","User-Agent":"StoryStudioMember/1.0"}
        else:
            model=str(model_from_vault or body.get("model") or "gemini-3.5-flash-lite")
            if model not in ("gemini-3.5-flash-lite","gemini-2.5-flash-lite","gemini-2.5-flash","gemini-3-flash"):
                return _resp(400,{"error":"Gemini model ไม่อยู่ในรุ่นที่อนุญาต กรุณาตรวจฟรีเทียร์"})
            url="https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent"
            payload={"systemInstruction":{"parts":[{"text":system}]},
                     "contents":[{"role":"user","parts":[{"text":message+"\nJSON/บริบท:\n"+context}]}],
                     "generationConfig":{"maxOutputTokens":1250}}
            headers={"x-goog-api-key":key,"Content-Type":"application/json",
                     "Accept":"application/json","User-Agent":"StoryStudioMember/1.0"}
        request=urllib.request.Request(url,json.dumps(payload,ensure_ascii=False).encode(),
                                       headers=headers,method="POST")
        with urllib.request.urlopen(request,timeout=21) as response:
            result=json.loads(response.read(160000).decode("utf-8"))
        if provider=="openrouter":
            content=result["choices"][0]["message"]["content"]
        else:
            content="".join(p.get("text","") for p in
                       result["candidates"][0]["content"]["parts"])
        if not isinstance(content,str) or not content.strip():
            return _resp(502,{"error":"AI ไม่ส่งคำตอบที่อ่านได้"})
        return _resp(200,{"reply":content[:10000],"provider":provider,
                          "model":model,"role":role,"keyStored":key_stored,
                          "release":RELEASE_ID,"trainedWeights":False})
    except urllib.error.HTTPError as exc:
        # Never expose upstream body: providers sometimes echo sensitive prompts.
        return _resp(502,{"error":"API ส่วนตัวตอบ HTTP "+str(exc.code)+
                           " · ตรวจรุ่นโมเดล สิทธิ์ หรือโควตาบัญชี"})
    except Exception:
        return _resp(502,{"error":"เรียก API ส่วนตัวไม่สำเร็จ โปรดตรวจเครือข่าย/โมเดล"})
