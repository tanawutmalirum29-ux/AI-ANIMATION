"""No-cloud unit QA for server-led auto-teaching.
Autonomous lessons are owner-delegated but not claimed to be human fact-checked.
"""
import json,os,sys,types,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import teacher

def unpack(x):
    return x["statusCode"],json.loads(x["body"])
class Key:
    def __init__(self,key):self.key=key
    def eq(self,value):return self
    def __and__(self,value):return self
class FakeTable:
    def __init__(self): self.rows={};self.queries=[];self.puts=[]
    def query(self,**kwargs):
        self.queries.append(kwargs)
        # Hash input is available in the expression only in true DynamoDB,
        # simulated sequential lookup here is enough for idempotency tests.
        return {"Items":list(self.rows.values())[:1]} if self.rows else {"Items":[]}
    def put_item(self,**kwargs):
        self.puts.append(kwargs)
        row=kwargs["Item"]
        self.rows[row["sk"]]=row
class FakeBoto:
    def __init__(self,table):self.table=table
    def resource(self,name):
        assert name=="dynamodb"
        return types.SimpleNamespace(Table=lambda name:self.table)

def response(rows):
    return teacher._response(200,{"reply":"ตรวจบทแล้ว",
       "teachingLessons":rows,"provider":"gemini","model":"mock-model"})

def scenes():
    return [{"id":"ep1-s1","episodeId":"ep1","text":"ฝนตกหนัก แล้วทุกคนกลับบ้านทันที",
             "previous":"ชาวบ้านเริ่มเก็บข้าวของ","next":"พวกเขาปิดประตูร้าน",
             "studentIssue":"continuity"}]
def lesson():
    return {"sceneId":"ep1-s1","issue":"continuity",
       "revised":"ฝนตกหนัก ชาวบ้านเก็บของก่อนกลับบ้าน",
       "reason":"ประโยคเดิมข้ามขั้นตอนเก็บของของชาวบ้าน"}

class AutoTeacherTests(unittest.TestCase):
    def install(self,table):
        fake=types.ModuleType("boto3")
        fake.resource=FakeBoto(table).resource
        conditions=types.ModuleType("boto3.dynamodb.conditions")
        conditions.Key=Key
        dynamodb=types.ModuleType("boto3.dynamodb")
        dynamodb.conditions=conditions
        return mock.patch.dict(sys.modules,{"boto3":fake,
                                             "boto3.dynamodb":dynamodb,
                                             "boto3.dynamodb.conditions":conditions})

    def test_auto_training_saves_delegated_qa_eligible_not_human_reviewed(self):
        table=FakeTable()
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",return_value=response([lesson()])) as call:
            code,res=unpack(teacher._auto_teach({
              "provider":"gemini","projectId":"story123","scenes":scenes()}))
        self.assertEqual(code,200)
        self.assertEqual(res["saved"],1)
        self.assertEqual(res["failed"],0)
        self.assertFalse(res["verifiedByOwner"])
        self.assertFalse(res["trainedWeights"])
        self.assertEqual(call.call_count,1)
        saved=list(table.rows.values())[0]
        self.assertEqual(saved["pk"],"learning#teacher-story-coherence")
        self.assertEqual(saved["status"],"teacher-qa-approved")
        self.assertTrue(saved["record"]["ownerDelegatedTraining"])
        self.assertTrue(saved["record"]["trainingEligible"])
        self.assertFalse(saved["record"]["reviewedByOwner"])
        self.assertFalse(saved["record"]["usedForWeightTraining"])
        self.assertIn("_internalMaxOutput",call.call_args.args[0])
        self.assertTrue(saved["sk"].startswith("teach#"))

    def test_story_evidence_is_bounded_and_identified_as_non_synopsis(self):
        table = FakeTable()
        anchors = [{"sceneId": "opening", "position": 1, "text": "ตั้งแต่ต้นเรื่องมีฝนตกและคนหนี"},
                   {"sceneId": "ending", "position": 80, "text": "ตอนท้ายทุกคนกลับมาเจอกัน"}]
        with self.install(table), mock.patch.dict(os.environ, {"TEACHER_FEEDBACK_TABLE": "test"}), \
             mock.patch.object(teacher, "_chat", return_value=response([lesson()])) as chat:
            code, result = unpack(teacher._auto_teach({
                "provider": "gemini", "projectId": "story123",
                "scenes": scenes(), "storyAnchors": anchors + [
                    {"sceneId": "fake", "position": 999, "text": "bad"}]}))
        self.assertEqual(code, 200)
        context = json.loads(chat.call_args.args[0]["context"])
        self.assertEqual(context["storyEvidenceSamples_not_complete_plot"], anchors)
        self.assertIn("not a verified synopsis", chat.call_args.args[0]["message"])
        self.assertEqual(result["saved"], 1)

    def test_repeat_batch_reuses_aws_memory_without_second_ai_call(self):
        table=FakeTable()
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",return_value=response([lesson()])) as call:
            request={"provider":"gemini","projectId":"story123","scenes":scenes()}
            first=unpack(teacher._auto_teach(request))
            second=unpack(teacher._auto_teach(request))
        self.assertEqual(first[1]["saved"],1)
        self.assertEqual(second[1]["saved"],0)
        self.assertEqual(second[1]["reused"],1)
        self.assertEqual(call.call_count,1)

    def test_bad_input_and_unusable_teacher_reply_are_not_saved(self):
        table=FakeTable()
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",return_value=response([
                  {**lesson(),"reason":"too short"}])):
            for payload in ({"scenes":[]},{"scenes":scenes()*4},
                            {"scenes":[{**scenes()[0],"text":"a"*1201}]},
                            {"scenes":[{**scenes()[0],"previous":"a"*351}]}):
                body={"provider":"gemini","projectId":"story123",**payload}
                self.assertEqual(unpack(teacher._auto_teach(body))[0],400)
            code,result=unpack(teacher._auto_teach({
             "provider":"gemini","projectId":"story123","scenes":scenes()}))
        self.assertEqual(code,422)
        self.assertEqual(result["reasonCode"],"TEACHER_LESSONS_RETRY_QUEUED")
        self.assertEqual(result["reasonCounts"]["missing_reason"],1)
        self.assertEqual(result["saved"],0)
        self.assertEqual(result["failed"],1)
        self.assertEqual(len([x for x in table.puts if x["Item"]["status"]=="teacher-qa-approved"]),0)
        self.assertEqual(len([x for x in table.puts if x["Item"]["status"]=="teacher-retry-queued"]),1)

    def test_reply_without_machine_readable_lessons_stops_and_explains(self):
        table=FakeTable()
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",return_value=response([])):
            code,result=unpack(teacher._auto_teach({
             "provider":"gemini","projectId":"story123","scenes":scenes()}))
        self.assertEqual(code,422)
        self.assertEqual(result["reasonCode"],"TEACHER_LESSONS_RETRY_QUEUED")
        self.assertEqual(result["failed"],1)
        self.assertEqual(len([r for r in table.rows.values() if r["status"]=="teacher-qa-approved"]),0)
        self.assertEqual(len([r for r in table.rows.values() if r["status"]=="teacher-retry-queued"]),1)

    def test_dedicated_teacher_system_instructs_machine_readable_thai_lessons(self):
        fixture=json.dumps({"teachingLessons":[lesson()]},ensure_ascii=False)
        candidate={"candidates":[{"content":{"parts":[{"text":fixture}]}}]}
        with mock.patch.object(teacher,"_settings",return_value={
                "gemini":{"key":"test_key_abcdefghijklmnop","model":"gemini-2.5-flash"}}),\
             mock.patch.object(teacher,"_post_json",return_value=candidate) as http:
            code,out=unpack(teacher._chat({
              "provider":"gemini","message":"Teach from narration",
              "context":"{}","_internalMaxOutput":3200},teach_mode=True))
        self.assertEqual(code,200)
        self.assertEqual(len(out["teachingLessons"]),1)
        payload=http.call_args.args[2]
        self.assertEqual(payload["generationConfig"]["maxOutputTokens"],3200)
        self.assertIn("teachingLessons",payload["systemInstruction"]["parts"][0]["text"])
        self.assertIn("keep",payload["systemInstruction"]["parts"][0]["text"])

    def test_ai_mother_repairs_invalid_lesson_without_user_intervention(self):
        table=FakeTable()
        wrong={**lesson(),"issue":"keep","revised":"ฝนตกหนัก ชาวบ้านกลับบ้าน"}
        correct={"sceneId":"ep1-s1","issue":"keep",
                 "revised":scenes()[0]["text"],
                 "reason":"บทเดิมสอดคล้องกับเหตุการณ์ จึงควรเก็บไว้ตามต้นฉบับ"}
        call_count=0
        def model_reply(*args,**kwargs):
            nonlocal call_count
            call_count+=1
            return response([wrong] if call_count==1 else [correct])
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",side_effect=model_reply):
            status,result=unpack(teacher._auto_teach({
               "provider":"gemini","projectId":"story123","scenes":scenes()}))
        self.assertEqual(status,200)
        self.assertEqual(result["saved"],1)
        self.assertEqual(result["failed"],0)
        self.assertEqual(call_count,2)
        item=[r for r in table.rows.values() if r["status"]=="teacher-qa-approved"][0]
        self.assertTrue(item["record"]["qa"]["structurePassed"])
        self.assertEqual(item["record"]["qa"]["repairAttempts"],2)
        self.assertTrue(item["record"]["ownerDelegatedTraining"])
        self.assertFalse(item["record"]["reviewedByOwner"])

    def test_failed_teacher_call_never_reports_saved(self):
        table=FakeTable()
        with self.install(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}),\
             mock.patch.object(teacher,"_chat",return_value=teacher._response(
                 429,{"error":"API quota exceeded"})):
            code,result=unpack(teacher._auto_teach({
             "provider":"gemini","projectId":"story123","scenes":scenes()}))
        self.assertEqual(code,429)
        self.assertEqual(len(table.rows),0)

    def test_extraction_allows_only_bounded_structured_teacher_lessons(self):
        data={"reply":"ผ่าน","ops":[],"teachingLessons":[
          {**lesson(),"reason":"ชัดเจนว่าต้องเชื่อมเหตุการณ์"},
          {"sceneId":"wrong","issue":"arbitrary","revised":"x","reason":"y"}]}
        out=teacher._extract_json(json.dumps(data,ensure_ascii=False))
        self.assertEqual(len(out["teachingLessons"]),1)
        self.assertEqual(out["teachingLessons"][0]["issue"],"continuity")

if __name__=="__main__":
    unittest.main()
