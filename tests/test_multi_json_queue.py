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
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \\
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
