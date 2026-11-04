"""Multi-JSON jobs share one provider lease; owner can see only owned jobs."""
import json
import os
import sys
import time
import unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
sys.path.insert(0, os.path.dirname(__file__))
import cloud_jobs
import teacher
from test_cloud_jobs import Table, fixture


def read(reply):
    return reply["statusCode"], json.loads(reply["body"])


class MultiJSONTests(unittest.TestCase):
    def test_job_list_is_owner_scoped_and_uses_existing_index(self):
        table, jobid, scenes = fixture()
        other = {**table.rows[("teacher-job#" + jobid, "meta")],
                 "pk": "teacher-job#" + "b" * 32, "jobId": "b" * 32,
                 "ownerId": "someone-else"}
        table.put_item(Item=other)
        table.query = mock.Mock(return_value={"Items": [
            {"jobId": jobid}, {"jobId": "b" * 32}, {"jobId": jobid}]})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.dict(os.environ, {
                 "TEACHER_FEEDBACK_TABLE": "test",
                 "TEACHER_JOB_STATE_MACHINE_ARN": "arn:aws:states:a:b:stateMachine:test"}):
            code, result = read(cloud_jobs.handle("teacher.job.list", {}, "225819900"))
        self.assertEqual(code, 200)
        self.assertEqual(len(result["jobs"]), 1)
        self.assertEqual(result["jobs"][0]["jobId"], jobid)
        self.assertEqual(result["source"], "aws-dynamodb-owner-index")
        self.assertEqual(table.query.call_count, 1)

    def test_older_jobs_are_paginated_and_never_cross_owner_partition(self):
        table, jobid, _ = fixture()
        next_sk = "job#" + "1" * 12 + "#" + "b" * 32
        table.query = mock.Mock(side_effect=[
            {"Items": [{"jobId": jobid}],
             "LastEvaluatedKey": {
                 "pk": cloud_jobs.INDEX_PREFIX + "225819900", "sk": next_sk}},
            {"Items": [{"jobId": jobid}]}
        ])
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.dict(os.environ, {
                 "TEACHER_FEEDBACK_TABLE": "test",
                 "TEACHER_JOB_STATE_MACHINE_ARN": "arn:aws:states:a:b:stateMachine:test"}):
            code, page1 = read(cloud_jobs.handle("teacher.job.list", {}, "225819900"))
            code2, page2 = read(cloud_jobs.handle(
                "teacher.job.list", {"cursor": next_sk}, "225819900"))
            rejected, _ = read(cloud_jobs.handle(
                "teacher.job.list", {"cursor": "job#evil#other-owner"}, "225819900"))
        self.assertEqual(code, 200)
        self.assertEqual(page1["nextCursor"], next_sk)
        self.assertEqual(code2, 200)
        self.assertIsNone(page2["nextCursor"])
        self.assertEqual(rejected, 400)
        args = table.query.call_args_list[1].kwargs
        self.assertEqual(args["ExclusiveStartKey"],
                         {"pk": cloud_jobs.INDEX_PREFIX + "225819900", "sk": next_sk})
        self.assertEqual(args["Limit"], 40)

    def test_legacy_qa_job_recovers_once_without_restarting_completed_scenes(self):
        table, jobid, _ = fixture()
        row = table.rows[(cloud_jobs.JOB_PREFIX + jobid, "meta")]
        row.update(state="needs-attention", work=[1], position=0, **{
            "pass": 2, "completedIndices": [0],
            "lastError": cloud_jobs.QA_LEGACY_STALLED
        })
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(cloud_jobs, "_launch", return_value="test-execution") as launch, \
             mock.patch.dict(os.environ, {
                 "TEACHER_FEEDBACK_TABLE": "test",
                 "TEACHER_JOB_STATE_MACHINE_ARN": "arn:aws:states:a:b:stateMachine:test"}):
            self.assertTrue(cloud_jobs._public(row)["qaAutoRecoveryAvailable"])
            code, result = read(cloud_jobs.handle(
                "teacher.job.auto-recover-qa", {"jobId": jobid}, "225819900"))
            self.assertEqual(code, 200)
            self.assertTrue(result["autoRecovered"])
            self.assertFalse(result["job"]["qaAutoRecoveryAvailable"])
            self.assertEqual(result["job"]["remaining"], 1)
            code2, repeat = read(cloud_jobs.handle(
                "teacher.job.auto-recover-qa", {"jobId": jobid}, "225819900"))
            self.assertEqual(code2, 200)
            self.assertTrue(repeat["existing"], "idempotent user-agent retry")
            forbidden, _ = read(cloud_jobs.handle(
                "teacher.job.auto-recover-qa", {"jobId": jobid}, "unauthorized"))
            self.assertEqual(forbidden, 404)
        launch.assert_called_once()
        self.assertEqual(row["state"], "queued")
        self.assertEqual(row["work"], [1], "do not retrain accepted scene zero")
        self.assertEqual(row["completedIndices"], [0])
        self.assertEqual(row["qaAutoRevives"], 1)
        self.assertEqual(row["generation"], 1)

    def test_autonomous_qa_retries_only_missed_scenes_up_to_bounded_budget(self):
        table, jobid, _ = fixture()
        import teacher
        repeated = teacher._response(200, {
            "lessons": [], "saved": 0, "reused": 0, "failed": 2})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=repeated) as infer, \
             mock.patch.object(teacher, "_cached_scene_records", return_value={}), \
             mock.patch.object(cloud_jobs, "_try_provider_lock", return_value=True), \
             mock.patch.object(cloud_jobs, "_release_provider_lock"):
            for attempt in range(cloud_jobs.MAX_PASSES):
                result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
                row = table.rows[(cloud_jobs.JOB_PREFIX + jobid, "meta")]
                self.assertEqual(row["completedIndices"], [])
                self.assertEqual(row["work"], [0, 1])
                self.assertEqual(row["saved"], 0)
                if attempt < cloud_jobs.MAX_PASSES - 1:
                    self.assertEqual(result["state"], "qa-retry-wait")
                    self.assertTrue(result["next"])
                    self.assertGreaterEqual(result["waitSeconds"], 20)
                    self.assertGreater(row["nextRetryAt"], int(time.time()))
                    self.assertEqual(row["pass"], attempt + 1)
                else:
                    self.assertEqual(result["state"], "needs-attention")
                    self.assertFalse(result["next"])
                    self.assertFalse(cloud_jobs._public(row)["qaAutoRecoveryAvailable"])
                    self.assertIn("ครบ", row["lastError"])
        self.assertEqual(infer.call_count, cloud_jobs.MAX_PASSES)

    def test_all_rejected_lessons_503_are_autoretried_as_qa_not_provider_failure(self):
        table, jobid, _ = fixture()
        rejection = teacher._response(503, {
            "reasonCode": "TEACHER_LESSONS_RETRY_QUEUED",
            "error": "AI แม่ตรวจซ้ำแล้วแต่ยังไม่มีบทเรียนที่ผ่าน QA",
            "failed": 2})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=rejection) as called, \
             mock.patch.object(teacher, "_cached_scene_records", return_value={}), \
             mock.patch.object(cloud_jobs, "_try_provider_lock", return_value=True), \
             mock.patch.object(cloud_jobs, "_release_provider_lock"):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "qa-retry-wait")
        self.assertTrue(result["next"])
        row = table.rows[(cloud_jobs.JOB_PREFIX + jobid, "meta")]
        self.assertEqual(row["state"], "queued")
        self.assertEqual(row["position"], 0)
        self.assertEqual(row["work"], [0, 1])
        self.assertEqual(row["pass"], 1)
        self.assertEqual(row["completedIndices"], [])
        called.assert_called_once()

    def test_manual_pause_and_persistent_qa_error_are_not_silently_restarted(self):
        table, jobid, _ = fixture()
        row = table.rows[(cloud_jobs.JOB_PREFIX + jobid, "meta")]
        row.update(state="paused", lastError=cloud_jobs.QA_LEGACY_STALLED)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.dict(os.environ, {
                 "TEACHER_FEEDBACK_TABLE": "test",
                 "TEACHER_JOB_STATE_MACHINE_ARN": "arn:aws:states:a:b:stateMachine:test"}):
            code, _ = read(cloud_jobs.handle(
                "teacher.job.auto-recover-qa", {"jobId": jobid}, "225819900"))
            self.assertEqual(code, 409, "owner pause must be respected")
            row["state"] = "needs-attention"
            row["lastError"] = "AI แม่ไม่พร้อม ไม่ใช่ปัญหา QA"
            code, _ = read(cloud_jobs.handle(
                "teacher.job.auto-recover-qa", {"jobId": jobid}, "225819900"))
            self.assertEqual(code, 409)

    def test_busy_provider_waits_and_preserves_checkpoint_without_ai_call(self):
        table, jobid, scenes = fixture()
        table.put_item(Item={"pk": cloud_jobs.PROVIDER_LOCK_PREFIX + "gemini",
                             "sk": "lease", "ownerJob": "anotherjob",
                             "leaseUntil": int(time.time()) + 120,
                             "updatedAt": int(time.time())})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach",
                               side_effect=AssertionError("shared key is busy")) as call:
            outcome = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertTrue(outcome["next"])
        self.assertEqual(outcome["waitSeconds"], 20)
        self.assertEqual(outcome["state"], "provider-busy")
        call.assert_not_called()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(row["position"], 0)
        self.assertEqual(row["state"], "queued")
        self.assertEqual(row["leaseUntil"], 0)

    def test_one_provider_call_releases_with_cooldown(self):
        table, jobid, scenes = fixture()
        import story_auto_train
        lessons = [{"sceneId": sc["id"], "original": sc["text"],
                    "episodeId": sc["episodeId"], "revised": sc["text"],
                    "issue": "keep", "teacherReason": "บทไม่ขัดแย้ง"}
                   for sc in scenes]
        reply = teacher._response(200, {"lessons": lessons, "saved": 2, "reused": 0})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach", return_value=reply) as infer, \
             mock.patch.object(story_auto_train, "train", return_value={
                 "body": json.dumps({"status": "not-ready", "activated": False})}):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "completed")
        infer.assert_called_once()
        lock = table.rows[(cloud_jobs.PROVIDER_LOCK_PREFIX + "gemini", "lease")]
        self.assertEqual(lock["ownerJob"], jobid)
        self.assertGreater(lock["leaseUntil"], int(time.time()))
        self.assertLess(lock["leaseUntil"] - int(time.time()), 30)

    def test_model_rate_limit_uses_shared_long_cooldown(self):
        table, jobid, _ = fixture()
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(teacher, "_auto_teach",
                               return_value=teacher._response(429, {
                                   "error": "too many requests"})):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "rate-limited")
        self.assertEqual(result["waitSeconds"], 60)
        lock = table.rows[(cloud_jobs.PROVIDER_LOCK_PREFIX + "gemini", "lease")]
        self.assertGreaterEqual(lock["leaseUntil"] - int(time.time()), 60)

    def test_lease_cannot_be_released_by_another_worker(self):
        table, _, _ = fixture()
        key=cloud_jobs._provider_lock_key("gemini")
        self.assertTrue(cloud_jobs._try_provider_lock(table,"gemini","workerA",int(time.time())))
        # Wrong worker must not clear newer owner lease.
        cloud_jobs._release_provider_lock(table,"gemini","workerB")
        self.assertEqual(table.rows[(key["pk"], key["sk"])]["ownerJob"],"workerA")


if __name__ == "__main__":
    unittest.main()
