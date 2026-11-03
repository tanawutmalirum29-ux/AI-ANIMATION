"""Member Release 1: ONLY actually trained internal CPU child models.

No BYOK, no server-hosted Gemini/OpenAI/OpenRouter, no outbound HTTP, no
training or database writes. The six original positions remain visible, but
a role with no applicable trained model is explicitly unavailable. Even a
saved old member key can never authorize external inference here.

The models are *classifiers*, not creative generative LLMs. All predictions
are advisory; no manuscript or stored lesson is modified.
"""
import json
import re

RELEASE_ID="member-six-v1"
ROLES={
 "composition":("AI-1 จัดองค์ประกอบ","ยังไม่มีโมเดลภาพ/องค์ประกอบที่ฝึกและเปิดใช้"),
 "assets":("AI-2 งาน SVG","ยังไม่มีโมเดล SVG ที่ฝึกและเปิดใช้"),
 "motion":("AI-3 โมชั่น","ยังไม่มีโมเดลโมชั่นที่ฝึกและเปิดใช้"),
 "voice":("AI-4 ตรวจบทพากย์","ใช้ AI ลูกบรรณาธิการภาษาไทย CPU ตรวจภาษาในบทพากย์ ไม่สังเคราะห์เสียง"),
 "structure":("AI-5 ตรวจโครงสร้างเรื่อง","ใช้โมเดลตรวจปัญหาบท CPU ที่ผ่าน QA และเปิดใช้เท่านั้น"),
 "qa":("AI-6 ตรวจบทและคุณภาพ","ใช้ AI ลูกบรรณาธิการภาษาไทย CPU ร่วมกับโมเดลอื่นที่เปิดใช้"),
}
BLOCKED_FIELDS=frozenset((
 "provider","apiKey","connectionId","baseUrl","model",
 "apiProvider","apiBaseUrl","token","secret","endpoint"))
NO_MODEL="ตำแหน่งนี้ยังไม่มีโมเดล AI ลูกที่ฝึกและเปิดใช้ได้จริง"
ISSUE_NAMES={
 "typo":"คำสะกดผิด","awkward":"คำแปลกตามบริบท",
 "fluency":"ประโยคยังไม่เป็นธรรมชาติ","intentional":"รักษาคำซ้ำหรือภาษาที่ตั้งใจใช้",
 "keep":"ยังไม่ควรแก้","review":"ต้องอ่านบริบทเพิ่มเติม",
 "continuity":"เหตุการณ์/ความต่อเนื่อง","clarity":"ความชัดเจนของภาษา",
 "expand":"เนื้อหาที่อาจต้องขยาย","pacing":"จังหวะเรื่อง",
 "remove":"คำซ้ำที่อาจตัดได้"
}

def _resp(code,obj):
    return {"statusCode":code,"headers":{
            "Content-Type":"application/json","Cache-Control":"no-store"},
            "body":json.dumps(obj,ensure_ascii=False,default=str)}

def _models():
    """Return only verified active learned CPU classifiers, never train here."""
    import thai_editor
    available={}
    try:
        baseline=thai_editor._baseline()
        available["thai-editor"]={"model":baseline,
            "version":baseline["version"],"status":"experimental-synthetic-starter",
            "source":"bundled-original-synthetic-CPU-weights"}
    except Exception:
        pass
    try:
        import story_auto_train
        candidate=story_auto_train._read(story_auto_train._table(),"active-model")
        if (isinstance(candidate,dict) and candidate.get("activated") is True
                and candidate.get("status")=="active-advisory"
                and candidate.get("metrics",{}).get("qaPassed") is True):
            available["narrative"]={"model":candidate,
                "version":str(candidate.get("version",""))[:100],
                "status":"active-advisory","source":"aws-qa-gated-cpu-weights"}
    except Exception:
        pass
    try:
        import student_learning
        candidate=student_learning._read_model("active")
        if (isinstance(candidate,dict) and candidate.get("status")=="active-advisory"
                and candidate.get("metrics",{}).get("qaPassed") is True):
            available["repetition"]={"model":candidate,
                "version":str(candidate.get("version",""))[:100],
                "status":"active-advisory","source":"aws-owner-approved-cpu-weights"}
    except Exception:
        pass
    return available

def _capability(role, available):
    if role in ("voice","qa"):
        return ["thai-editor"] if "thai-editor" in available else []
    if role=="structure":
        return ["narrative"] if "narrative" in available else []
    # Do not present an editorial language classifier as a trained SVG,
    # camera, composition or motion network.
    return []

def catalog():
    available=_models()
    return _resp(200,{
        "release":RELEASE_ID,"version":"1.0",
        "moduleCount":6,"modelType":"internal-cpu-classifiers-only",
        "externalAPIAllowed":False,"bringYourOwnKeyAllowed":False,
        "quotasEnabled":False,"trainedSeparateWeights":False,
        "autoUpgrades":False,"adminFeaturesAvailable":False,
        "trainedModelCount":len(available),
        "trainedModels":[{"id":k,"version":v["version"],
                          "status":v["status"],"source":v["source"]}
                         for k,v in available.items()],
        "modules":[{"id":k,"role":description[0],"capability":description[1],
                    "release":RELEASE_ID,"ready":bool(_capability(k,available)),
                    "modelIds":_capability(k,available),
                    "trainingRequired":not bool(_capability(k,available))}
                   for k,description in ROLES.items()]})

def _text_inputs(body):
    """Keep one to six brief narration excerpts; do not trust JSON commands."""
    message=body.get("message")
    context=body.get("context","")
    if (not isinstance(message,str) or not 1<=len(message.strip())<=2000
        or not isinstance(context,str) or len(context)>12000):
        raise ValueError("ข้อความหรือบริบทยาวเกินขนาดที่รองรับ")
    scenes=[]
    try:
        raw=json.loads(context)
    except (ValueError,TypeError):
        raw=None
    def visit(node):
        if len(scenes)>=6:
            return
        if isinstance(node,dict):
            text=node.get("voiceover") or node.get("text") or node.get("narration")
            if isinstance(text,str) and 4<=len(text.strip())<=1200:
                scenes.append(text.strip())
            else:
                for name in ("episodes","scenes","story","content"):
                    if name in node:
                        visit(node[name])
        elif isinstance(node,list):
            for child in node[:10]:
                visit(child)
                if len(scenes)>=6:
                    break
    visit(raw)
    if not scenes and 4<=len(context.strip())<=1200:
        scenes=[context.strip()]
    if not scenes and 4<=len(message.strip())<=1200:
        scenes=[message.strip()]
    return scenes

def run(body,user):
    if not isinstance(user,dict) or user.get("role") not in ("member","guest"):
        return _resp(403,{"error":"โมดูลรุ่น 1 สำหรับสมาชิกและผู้เยี่ยมชมเท่านั้น"})
    if any(k in body for k in BLOCKED_FIELDS):
        return _resp(403,{"error":"สมาชิกใช้เฉพาะ AI ลูกที่ฝึกในเว็บไซต์ ไม่รองรับ API ภายนอก"})
    if body.get("release") not in (None,RELEASE_ID):
        return _resp(409,{"error":"รองรับโมดูลรุ่น 1 เท่านั้น"})
    role=body.get("role")
    if role not in ROLES:
        return _resp(400,{"error":"เลือกหนึ่งใน 6 ตำแหน่งที่มีอยู่"})
    try:
        snippets=_text_inputs(body)
    except ValueError as exc:
        return _resp(400,{"error":str(exc)})
    if not snippets:
        return _resp(400,{"error":"โปรดใส่บทพากย์อย่างน้อยหนึ่งประโยค"})
    available=_models()
    linked=_capability(role,available)
    if not linked:
        return _resp(409,{"error":NO_MODEL,"role":role,"ready":False,
                          "requiresTraining":True,"externalAPIUsed":False})
    findings=[]
    import thai_editor
    import story_auto_train
    for idx,text in enumerate(snippets):
        obj={"sceneId":"member-%02d"%(idx+1),"text":text}
        report={"original":text,"sourceModels":[],"suggestions":[]}
        if role in ("voice","qa"):
            suggestion=thai_editor._suggest(
                {"id":obj["sceneId"],"episodeId":"","text":text,
                 "previous":snippets[idx-1] if idx else "",
                 "next":snippets[idx+1] if idx+1<len(snippets) else ""},
                available["thai-editor"]["model"])
            report["suggestions"].append({
                "issue":suggestion["issue"],
                "name":ISSUE_NAMES.get(suggestion["issue"],suggestion["issue"]),
                "suggested":suggestion["suggested"],
                "reason":suggestion["reason"],"requiresReview":True})
            report["sourceModels"].append("thai-editor")
        if role in ("structure","qa") and "narrative" in available:
            n=story_auto_train._predict(available["narrative"]["model"],{
                "original":text,
                "previous":snippets[idx-1] if idx else "",
                "next":snippets[idx+1] if idx+1<len(snippets) else ""})
            report["suggestions"].append({
                "issue":n,"name":ISSUE_NAMES.get(n,n),
                "suggested":None,
                "reason":"โมเดล CPU จำแนกประเภทปัญหาบท ไม่สามารถเขียนบทใหม่เอง",
                "requiresReview":True})
            report["sourceModels"].append("narrative")
        findings.append(report)
    descriptions=[]
    for item in findings:
        for suggestion in item["suggestions"]:
            phrase=(suggestion["name"]+": "+suggestion["reason"]+
                    (" · เสนอแก้: "+suggestion["suggested"] if suggestion["suggested"] else ""))
            descriptions.append(phrase[:600])
    return _resp(200,{
        "reply":"\n".join(descriptions[:9]) or "ยังไม่มีข้อเสนอ",
        "release":RELEASE_ID,"role":role,
        "source":"trained-local-CPU-only",
        "externalAPIUsed":False,"trainedSeparateWeightModels":False,
        "modelVersions":{key:available[key]["version"] for key in
                         {k for f in findings for k in f["sourceModels"]}},
        "findings":findings,
        "advisoryOnly":True,"appliedToProject":False,
        "warning":"โมเดลเหล่านี้ไม่ใช่ LLM เขียนบท; รุ่นสังเคราะห์ยังไม่ผ่านการยืนยันในงานจริง"})
