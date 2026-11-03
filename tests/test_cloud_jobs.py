"""No-AWS regression suite for checkpointed cloud teacher jobs."""
import json, os, sys, unittest
from decimal import Decimal
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
import cloud_jobs


class Table:
    def __init__(self, rows):
        self.rows = {(r["pk"], r["sk"]): dict(r) for r in rows}
        self.calls = []
    def get_item(self, Key, **kwargs):
        return {"Item": dict(self.rows[(Key["pk"], Key["sk"])])} if (
            Key["pk"], Key["sk"]) in self.rows else {}
    def put_item(self, Item, **kwargs):
        self.rows[(Item["pk"], Item["sk"])] = dict(Item)
    def update_item(self, Key, UpdateExpression, ConditionExpression=None,
                    ExpressionAttributeNames=None, ExpressionAttributeValues=None,
                    **kwargs):
        row = self.rows[(Key["pk"], Key["sk"])]
        names = ExpressionAttributeNames or {}
        values = ExpressionAttributeValues or {}
        # Model conditional owner pause / generation and worker-lease semantics.
        if "generation=:g" in (ConditionExpression or ""):
            if row["generation"] != values[":g"]:
                raise AssertionError("stale generation")
        if "#s=:running" in (ConditionExpression or "") and row["state"] != "running":
            raise AssertionError("worker modified a paused job")
        if "leaseUntil < :now" in (ConditionExpression or "") and row["leaseUntil"] >= values[":now"]:
            raise AssertionError("lease not released")
        clause = UpdateExpression.split(" REMOVE ")[0].removeprefix("SET ")
        for part in clause.split(","):
            field, placeholder = part.strip().split("=")
            row[names.get(field, field)] = values[placeholder]
        if "REMOVE executionArn" in UpdateExpression:
            row.pop("executionArn", None)
        self.calls.append((Key, UpdateExpression))


def fixture():
    jobid = "a" * 32
    row = {"pk": "teacher-job#" + jobid, "sk": "meta",
           "jobId": jobid, "ownerId": "225819900", "projectId": "story123",
           "provider": "gemini", "state": "queued", "generation": 0,
           "total": 2, "work": [0, 1], "position": 0, "pass": 0,
           "completedIndices": [], "failedIndices": [], "saved": 0,
           "reused": 0, "throttles": 0, "createdAt": 1700000000,
           "updatedAt": 1700000000, "lastError": "", "leaseUntil": 0}
    scenes = [{"id": "s1", "episodeId": "ep1", "text": "คืนหนึ่งฝนตกที่ตลาด"},
              {"id": "s2", "episodeId": "ep1", "text": "ทุกคนกลับบ้านก่อนรุ่งสาง"}]
    for scene in scenes:
        scene.update(previous="", next="", studentIssue="keep")
    table = Table([row, {"pk": row["pk"], "sk": "input#00000", "scenes": scenes}])
    return table, jobid, scenes


class CloudJobTests(unittest.TestCase):
    def test_decimal_serialization_and_bounded_user_data(self):
        value = cloud_jobs._resp(200, {"a": Decimal("1"), "b": {"n": Decimal("0.75")}})
        self.assertEqual(json.loads(value["body"]), {"a": 1, "b": {"n": 0.75}})
        scenes = [{"id": "x", "text": "ประโยคที่ใช้สำหรับสอนบท"}]
        self.assertEqual(len(cloud_jobs._validated_scenes(scenes)), 1)
        for bad in ([*scenes, *scenes], [{"id": "bad", "text": ""}], []):
            with self.assertRaises(ValueError):
                cloud_jobs._validated_scenes(bad)

    def test_two_scenes_save_checkpoint_and_complete(self):
        table, jobid, scenes = fixture()
        # Match actual boto3 DynamoDB deserialization, not Python list literals.
        table.rows[("teacher-job#" + jobid, "meta")]["work"] = [Decimal("0"), Decimal("1")]
        lessons = [{"sceneId": x["id"], "episodeId": "ep1", "issue": "keep",
                    "original": x["text"], "revised": x["text"],
                    "teacherReason": "บทสอดคล้องกับบริบทไม่ควรแก้ไข"}
                   for x in scenes]
        import teacher, story_auto_train
        reply = teacher._response(200, {"saved": 2, "reused": 0, "failed": 0,
                                        "lessons": lessons})
        cpu_result = {"body": json.dumps({"status": "collecting-diverse-teacher-lessons",
                                         "activated": False, "counts": {"projects": 1}})}
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=reply) as called, \
             mock.patch.object(story_auto_train, "train", return_value=cpu_result) as trained:
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "completed")
        self.assertFalse(result["next"])
        self.assertEqual(called.call_count, 1)
        trained.assert_called_once()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(row["completedIndices"], [0, 1])
        self.assertEqual(row["saved"], 2)
        self.assertEqual(row["trainingStatus"]["status"],
                         "collecting-diverse-teacher-lessons")
        self.assertEqual(table.rows[("teacher-job#" + jobid, "result#00001")]["lesson"]["sceneId"], "s2")

    def test_paused_job_does_not_call_provider(self):
        table, jobid, scenes = fixture()
        table.rows[("teacher-job#" + jobid, "meta")]["state"] = "paused"
        import teacher
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach") as called:
            value = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertFalse(value["next"])
        called.assert_not_called()

    def test_rate_limit_waits_and_does_not_skip_a_scene(self):
        table, jobid, scenes = fixture()
        import teacher
        reply = teacher._response(429, {"error": "provider rate limit"})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=reply):
            value = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(value["waitSeconds"], 60)
        row = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(row["position"], 0)
        self.assertEqual(row["throttles"], 1)
        self.assertEqual(row["state"], "queued")

    def test_admin_owned_job_required_for_status(self):
        table, jobid, _ = fixture()
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.dict(os.environ, {
                 "TEACHER_FEEDBACK_TABLE": "test",
                 "TEACHER_JOB_STATE_MACHINE_ARN":
                     "arn:aws:states:ap-southeast-2:123:stateMachine:test"}):
            no = cloud_jobs.handle("teacher.job.status", {"jobId": jobid}, "999")
            yes = cloud_jobs.handle("teacher.job.status", {"jobId": jobid}, "225819900")
        self.assertEqual(no["statusCode"], 404)
        self.assertEqual(yes["statusCode"], 200)
        self.assertEqual(json.loads(yes["body"])["job"]["total"], 2)


if __name__ == "__main__":
    unittest.main()
