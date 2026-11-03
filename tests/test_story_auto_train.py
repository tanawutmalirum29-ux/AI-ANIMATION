"""Verify no human approval is forged and CPU auto training uses real cross-project QA."""
import json,os,sys,types,unittest
from unittest import mock
sys.path.insert(0,os.path.join(os.path.dirname(__file__),"..","autodub"))
import story_auto_train as train

class Key:
    def __init__(self,*args):pass
    def eq(self,*args):return self
    def begins_with(self,*args):return self
    def __and__(self,*args):return self
class Table:
    def __init__(self,records):
        self.records=records
        self.saved=[]
    def query(self,**kwargs):
        # The requested partition is fixed by story_auto_train.PK.
        if kwargs.get("Limit")==1:return {"Items":[]}
        return {"Items":self.records}
    def put_item(self,Item):
        self.saved.append(Item)

def inject(table):
    fake=types.ModuleType("boto3")
    fake.resource=lambda service:types.SimpleNamespace(Table=lambda name:table)
    conditions=types.ModuleType("boto3.dynamodb.conditions");conditions.Key=Key
    dynamodb=types.ModuleType("boto3.dynamodb");dynamodb.conditions=conditions
    return mock.patch.dict(sys.modules,{"boto3":fake,
        "boto3.dynamodb":dynamodb,"boto3.dynamodb.conditions":conditions})

def rows(projects=5):
    issues=("continuity","clarity","expand","pacing","keep")
    patterns={
     "continuity":"เหตุการณ์ย้อนเวลาไม่สอดคล้องเดิม ",
     "clarity":"เขามันที่นี่ตรงนั้นไม่บอกใคร ",
     "expand":"จึงต้องเติมสะพานเชื่อมเหตุการณ์ ",
     "pacing":"ประโยคอ้อมค้อมและคำฟุ่มเฟือย ",
     "keep":"บทบรรยายต้นฉบับเหมาะสมแล้ว "
    }
    output=[]
    for p in range(projects):
        for issue in issues:
            for k in range(4):
                src=patterns[issue]*3+str(k)
                record={"projectId":"story"+str(p+1000),"sceneId":issue+str(k),
                        "episodeId":"ep"+str(k),
                        "issue":issue,"original":src,
                        "revised":src if issue=="keep" else src+"แก้แล้ว",
                        "previous":"เหตุการณ์ก่อนหน้า","next":"เหตุการณ์ถัดไป",
                        "teacherReason":"AI แม่อธิบายและตรวจสอบความสัมพันธ์ตามบริบท",
                        "source":"teacher-owner-delegated-qa",
                        "ownerDelegatedTraining":True,"trainingEligible":True,
                        "reviewedByOwner":False,"qa":{"structurePassed":True}}
                output.append({"pk":train.PK,"sk":"teach#%02d-%s-%02d"%(p,issue,k),
                               "status":"teacher-qa-approved","record":record})
    return output

class AutonomousStoryModelTests(unittest.TestCase):
    def test_one_story_cannot_promote_despite_many_lessons(self):
        table=Table(rows(projects=1))
        with inject(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            result=train.train()
        data=json.loads(result["body"])
        self.assertFalse(data["trained"])
        self.assertEqual(data["status"],"collecting-diverse-teacher-lessons")
        self.assertEqual(data["counts"]["projects"],1)
        self.assertEqual(table.saved,[])

    def test_owner_delegated_data_trains_cpu_and_auto_promotes_only_on_good_qa(self):
        table=Table(rows(projects=5))
        with inject(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            result=train.train()
        data=json.loads(result["body"])
        self.assertTrue(data["trained"])
        self.assertTrue(data["metrics"]["groupDisjoint"])
        self.assertFalse(data["metrics"]["humanReviewed"])
        self.assertGreaterEqual(data["metrics"]["accuracy"],.70)
        self.assertTrue(data["activated"])
        active=[r for r in table.saved if r["sk"]=="active-model"]
        self.assertEqual(len(active),1)
        model=active[0]["model"]
        self.assertEqual(model["task"],"thai-narrative-edit-diagnosis")
        self.assertTrue(model["metrics"]["qaPassed"])
        self.assertFalse(model["notHumanFactChecked"] is False)

    def test_pooled_training_lock_prevents_concurrent_promotion(self):
        class Conflict(Exception):
            response = {"Error": {"Code": "ConditionalCheckFailedException"}}
        table = Table(rows(projects=5))
        env = {"TEACHER_FEEDBACK_TABLE": "test", "TEACHER_ENABLE_IDLE_POOL": "1"}
        with inject(table), mock.patch.dict(os.environ, env), \
             mock.patch.object(table, "update_item", create=True,
                               side_effect=Conflict("already training")) as update:
            result = train.train()
        data = json.loads(result["body"])
        self.assertEqual(data["status"], "training-busy")
        self.assertFalse(data["activated"])
        self.assertEqual(table.saved, [])
        update.assert_called_once()

    def test_pooled_training_releases_its_own_lease_after_promotion(self):
        table = Table(rows(projects=5))
        env = {"TEACHER_FEEDBACK_TABLE": "test", "TEACHER_ENABLE_IDLE_POOL": "1"}
        with inject(table), mock.patch.dict(os.environ, env), \
             mock.patch.object(table, "update_item", create=True) as update:
            result = train.train()
        data = json.loads(result["body"])
        self.assertTrue(data["trained"])
        self.assertEqual(update.call_count, 2)
        claim, release = (x.kwargs for x in update.call_args_list)
        self.assertIn("attribute_not_exists(pk)", claim["ConditionExpression"])
        self.assertEqual(release["ConditionExpression"], "ownerToken=:token")
        self.assertEqual(claim["ExpressionAttributeValues"][":token"],
                         release["ExpressionAttributeValues"][":token"])

    def test_rejected_teacher_or_pending_entries_never_enter_training(self):
        records=rows(1)
        records[0]["status"]="teacher-retry-queued"
        records[1]["record"]["source"]="assistant-fabricated"
        records[2]["record"]["ownerDelegatedTraining"]=False
        table=Table(records)
        with inject(table),mock.patch.dict(os.environ,{"TEACHER_FEEDBACK_TABLE":"test"}):
            eligible=train._rows(table)
        self.assertEqual(len(eligible),len(records)-3)

if __name__=="__main__":unittest.main()
