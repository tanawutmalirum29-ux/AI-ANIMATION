"""Safe migration tests: scalable owner vault and opt-in idle teacher pooling."""
import json
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autodub"))
sys.path.insert(0, os.path.dirname(__file__))
import owner_key_vault as vault
import teacher_connections as connections
import cloud_jobs
import teacher
from test_cloud_jobs import Table, fixture


def read(reply):
    return reply["statusCode"], json.loads(reply["body"])


class VaultTable:
    def __init__(self):
        self.rows = {}

    def query(self, **kwargs):
        # All rows belong to the admin vault partition in this fake.
        data = [dict(x) for (pk, _), x in self.rows.items()
                if pk == vault.PK]
        data.sort(key=lambda x: x["sk"])
        cursor = kwargs.get("ExclusiveStartKey")
        if cursor:
            data = [x for x in data if x["sk"] > cursor["sk"]]
        page = data[:kwargs.get("Limit", 100)]
        result = {"Items": page}
        if len(data) > len(page):
            result["LastEvaluatedKey"] = {"pk": vault.PK, "sk": page[-1]["sk"]}
        return result

    def get_item(self, Key, **kwargs):
        row = self.rows.get((Key["pk"], Key["sk"]))
        return {"Item": dict(row)} if row else {}

    def put_item(self, Item, **kwargs):
        pk = (Item["pk"], Item["sk"])
        if pk in self.rows:
            raise AssertionError("duplicate id")
        self.rows[pk] = dict(Item)

    def update_item(self, Key, **kwargs):
        row = self.rows[(Key["pk"], Key["sk"])]
        assert row["status"] == "active"
        row["status"] = "revoked"
        for field in ("nonce", "encrypted", "fingerprint"):
            row.pop(field, None)


class OwnerVaultTests(unittest.TestCase):
    def setUp(self):
        self.db = VaultTable()
        self.env = mock.patch.dict(os.environ, {
            "TEACHER_FEEDBACK_TABLE": "test-teacher-table",
            "TEACHER_OWNER_VAULT_V2": "1",
            "SESSION_SECRET": "the-stable-lambda-session-secret-is-long-enough-0123456789"})
        self.env.start()
        self.table_patch = mock.patch.object(vault, "_table", return_value=self.db)
        self.table_patch.start()

    def tearDown(self):
        self.table_patch.stop()
        self.env.stop()

    def test_more_than_six_encrypted_keys_and_no_secrets_in_list(self):
        for i in range(9):
            result = vault.add("gemini", "gemini-3.5-flash-lite", "",
                               "long-owner-key-secret-" + str(i))
            self.assertTrue(result["id"].startswith("key-"))
        visible = vault.listing()
        self.assertEqual(len(visible), 9)
        for i in range(9):
            raw = "long-owner-key-secret-" + str(i)
            self.assertNotIn(raw, json.dumps(visible))
            self.assertNotIn(raw, json.dumps(list(self.db.rows.values())))
        first = visible[0]
        self.assertTrue(vault.resolve(first["provider"], first["id"])["key"].startswith("long-owner"))
        self.assertEqual(vault.resolve("openrouter", first["id"]), {})
        self.assertFalse(vault.resolve("gemini", "key-" + "0" * 16))
        with self.assertRaisesRegex(ValueError, "duplicate-key"):
            vault.add("gemini", "gemini-3.5-flash-lite", "", "long-owner-key-secret-0")

    def test_revoked_material_cannot_be_resolved(self):
        key = vault.add("gemini", "gemini-3.5-flash-lite", "", "long-owner-key-revoke")
        self.assertTrue(vault.remove(key["id"]))
        self.assertEqual(vault.resolve("gemini", key["id"]), {})
        row = self.db.rows[(vault.PK, "connection#" + key["id"])]
        self.assertNotIn("encrypted", row)
        self.assertNotIn("nonce", row)
        self.assertNotIn("fingerprint", row)

    def test_connection_module_uses_vault_and_keeps_legacy_ssm_untouched(self):
        settings = {"gemini": {"key": "legacy-long-key-secret-01234",
                                "model": "gemini-3.5-flash-lite"}}
        with mock.patch.object(teacher, "_settings", return_value=settings), \
             mock.patch.object(teacher, "_save_settings",
                               side_effect=AssertionError("must not rewrite old SSM")):
            for i in range(8):
                code, result = read(connections.add({
                    "provider": "gemini", "apiKey": "new-owner-key-secret-" + str(i),
                    "model": "gemini-3.5-flash-lite"}, connections.ADMIN_ID))
                self.assertEqual(code, 200, result)
            listed = connections.listing()
            self.assertEqual(len(listed), 9)
            self.assertEqual(len(settings), 1)
            added = next(x for x in listed if x["id"].startswith("key-"))
            self.assertTrue(connections.resolve(settings, added["provider"], added["id"])["key"])
            code, result = read(connections.handle(
                "teacher.connection.list", {}, connections.ADMIN_ID))
            self.assertEqual(code, 200)
            self.assertIsNone(result["maxExtra"])
            self.assertNotIn("new-owner-key-secret", json.dumps(result))
            with mock.patch.object(cloud_jobs, "_connection_in_use", return_value=False):
                code, _ = read(connections.remove({
                    "connectionId": added["id"], "confirmRemove": True}, connections.ADMIN_ID))
            self.assertEqual(code, 200)

    def test_key_cannot_be_removed_while_pool_has_unfinished_job(self):
        key = vault.add("gemini", "gemini-3.5-flash-lite", "", "pool-job-owner-key-secret")
        with mock.patch.object(teacher, "_settings", return_value={}), \
             mock.patch.object(cloud_jobs, "_connection_in_use", return_value=True):
            code, _ = read(connections.remove({
                "connectionId": key["id"], "confirmRemove": True}, connections.ADMIN_ID))
        self.assertEqual(code, 409)
        self.assertTrue(vault.resolve("gemini", key["id"])["key"])


class IdlePoolTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"TEACHER_ENABLE_IDLE_POOL": "1"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    @staticmethod
    def connections():
        return [{"id": "key-" + "b" * 16, "provider": "gemini", "ready": True},
                {"id": "key-" + "c" * 16, "provider": "openrouter", "ready": True}]

    def test_idle_teacher_borrows_other_story_without_losing_checkpoint(self):
        table, jobid, scenes = fixture()
        table.rows[("teacher-job#" + jobid, "meta")]["poolMode"] = True
        table.put_item(Item={"pk": cloud_jobs.PROVIDER_LOCK_PREFIX + "key-" + "b"*16,
                             "sk": "lease", "ownerJob": "other-job",
                             "leaseUntil": int(time.time()) + 100,
                             "updatedAt": int(time.time())})
        lessons = [{"sceneId": x["id"], "episodeId": "ep1",
                    "issue": "keep", "original": x["text"], "revised": x["text"],
                    "teacherReason": "ตรวจสอบบทแล้ว"} for x in scenes]
        import story_auto_train
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach", return_value=teacher._response(
                 200, {"lessons": lessons, "saved": 2, "reused": 0})) as work, \
             mock.patch.object(story_auto_train, "train", return_value={
                 "body": '{"status":"collecting","activated":false}'}):
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            self.assertEqual(first["state"], "training-queued")
            self.assertTrue(table.rows[("teacher-job#" + jobid, "meta")]["trainingPending"])
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "completed")
        args = work.call_args.args[0]
        self.assertEqual(args["connectionId"], "key-" + "c" * 16)
        self.assertEqual(args["provider"], "openrouter")
        self.assertEqual(table.rows[("teacher-job#" + jobid, "meta")]["completedIndices"], [0, 1])

    def test_two_idle_workers_cannot_claim_the_same_api_key(self):
        table, jobid, _ = fixture()
        first_job = {"jobId": jobid}
        second_job = {"jobId": "b" * 32}
        with mock.patch.object(connections, "listing", return_value=self.connections()):
            first, _ = cloud_jobs._borrow_idle_connection(table, first_job, int(time.time()))
            second, _ = cloud_jobs._borrow_idle_connection(table, second_job, int(time.time()))
            third, wait = cloud_jobs._borrow_idle_connection(
                table, {"jobId": "c" * 32}, int(time.time()))
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertNotEqual(first["id"], second["id"])
        self.assertIsNone(third)
        self.assertGreaterEqual(wait, 20)

    def test_story_anchors_cover_beginning_middle_and_end_without_fake_summary(self):
        scenes = [{"id": "sc%03d" % i, "text": "ตัวละครเติบโตขึ้นตามเวลา-" +
                   ("ทดสอบ" * 200)} for i in range(120)]
        anchors = cloud_jobs._story_anchors(scenes)
        self.assertEqual(len(anchors), 7)
        self.assertEqual(anchors[0]["sceneId"], "sc000")
        self.assertEqual(anchors[-1]["sceneId"], "sc119")
        self.assertTrue(all(len(a["text"]) <= 110 for a in anchors))
        self.assertEqual(cloud_jobs._story_anchors([]), [])

    def test_invalid_key_fails_over_to_another_mother_without_skipping_scenes(self):
        table, jobid, scenes = fixture()
        table.rows[("teacher-job#" + jobid, "meta")]["poolMode"] = True
        table.rows[("teacher-job#" + jobid, "meta")]["storyAnchors"] = cloud_jobs._story_anchors(scenes)
        unavailable = teacher._response(502, {
            "reasonCode": "TEACHER_PROVIDER_AUTH",
            "error": "provider authorization failed"})
        lessons = [{"sceneId": sc["id"], "episodeId": sc["episodeId"],
                    "original": sc["text"], "revised": sc["text"],
                    "issue": "keep", "teacherReason": "บทสอดคล้องกับเหตุการณ์เดิม"}
                   for sc in scenes]
        success = teacher._response(200, {"lessons": lessons, "saved": 2, "reused": 0})
        import story_auto_train
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach", side_effect=[
                 unavailable, success]) as teach_call, \
             mock.patch.object(story_auto_train, "train", return_value={
                 "body": '{"status":"collecting","activated":false}'}):
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            meta = table.rows[("teacher-job#" + jobid, "meta")]
            self.assertEqual(first["state"], "pool-key-fallback")
            self.assertEqual(meta["position"], 0)
            self.assertEqual(meta["completedIndices"], [])
            self.assertEqual(meta["unusableConnections"], ["key-" + "b"*16])
            blocked_key = table.rows[(cloud_jobs.PROVIDER_LOCK_PREFIX +
                                      "key-" + "b"*16, "lease")]
            self.assertGreater(blocked_key["leaseUntil"], int(time.time()) + 3000)
            second = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            self.assertEqual(second["state"], "training-queued")
            third = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(third["state"], "completed")
        self.assertEqual(teach_call.call_count, 2)
        self.assertEqual(teach_call.call_args.args[0]["storyAnchors"],
                         cloud_jobs._story_anchors(scenes))
        self.assertEqual(teach_call.call_args.args[0]["connectionId"],
                         "key-" + "c"*16)
        meta = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(meta["position"], 2)
        self.assertEqual(meta["completedIndices"], [0, 1])
        self.assertEqual(meta["unusableConnections"], [])

    def test_pool_training_lock_retries_without_reteaching_confirmed_scenes(self):
        table, jobid, scenes = fixture()
        table.rows[("teacher-job#" + jobid, "meta")].update({
            "poolMode": True, "trainingPending": True, "state": "queued",
            "position": 2, "completedIndices": [0, 1]})
        import story_auto_train
        outcomes = [
            {"body": '{"status":"training-busy","trained":false}'},
            {"body": '{"status":"collecting","activated":false}'}]
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(story_auto_train, "train", side_effect=outcomes) as train, \
             mock.patch.object(teacher, "_auto_teach",
                               side_effect=AssertionError("must not teach twice")) as teach:
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            self.assertEqual(first["state"], "training-wait")
            self.assertTrue(first["next"])
            self.assertEqual(table.rows[("teacher-job#" + jobid, "meta")]["position"], 2)
            second = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(second["state"], "completed")
        self.assertEqual(train.call_count, 2)
        teach.assert_not_called()
        self.assertEqual(table.rows[("teacher-job#" + jobid, "meta")]["trainingAttempts"], 0)

    def test_all_invalid_mothers_stop_and_preserve_checkpoint(self):
        table, jobid, _ = fixture()
        table.rows[("teacher-job#" + jobid, "meta")]["poolMode"] = True
        unavailable = teacher._response(404, {
            "reasonCode": "TEACHER_MODEL_UNAVAILABLE", "error": "model not found"})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach", return_value=unavailable) as work:
            first = cloud_jobs.worker({"jobId": jobid, "generation": 0})
            second = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(first["state"], "pool-key-fallback")
        self.assertEqual(second["state"], "needs-attention")
        self.assertEqual(work.call_count, 2)
        meta = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(meta["position"], 0)
        self.assertEqual(meta["completedIndices"], [])
        self.assertEqual(len(meta["unusableConnections"]), 2)

    def test_provider_quota_checked_once_per_provider(self):
        table, jobid, _ = fixture()
        two_same = [{"id": "key-" + "b"*16, "provider": "gemini", "ready": True},
                    {"id": "key-" + "c"*16, "provider": "gemini", "ready": True}]
        with mock.patch.object(connections, "listing", return_value=two_same), \
             mock.patch.object(cloud_jobs, "_provider_quota_wait", return_value=0) as quota:
            choice, wait = cloud_jobs._borrow_idle_connection(
                table, {"jobId": jobid}, int(time.time()))
        self.assertIsNotNone(choice)
        self.assertIsNone(wait)
        quota.assert_called_once()

    def test_stale_same_job_invocation_cannot_release_successor_api_lease(self):
        table, jobid, _ = fixture()
        only_one = [self.connections()[0]]
        now = int(time.time())
        with mock.patch.object(connections, "listing", return_value=only_one):
            first, _ = cloud_jobs._borrow_idle_connection(
                table, {"jobId": jobid, "leaseOwner": "old-invocation"}, now)
            self.assertIsNotNone(first)
            lock_key = cloud_jobs._provider_lock_key(first["id"])
            lock = table.rows[(lock_key["pk"], lock_key["sk"])]
            lock["leaseUntil"] = now - 1
            second, _ = cloud_jobs._borrow_idle_connection(
                table, {"jobId": jobid, "leaseOwner": "new-invocation"}, now)
            self.assertIsNotNone(second)
            self.assertEqual(lock["ownerJob"], "new-invocation")
            cloud_jobs._release_provider_lock(
                table, first["id"], "old-invocation", cooldown=12)
            self.assertEqual(lock["ownerJob"], "new-invocation")
            self.assertEqual(lock["leaseUntil"], now + 110)

    def test_stale_worker_token_cannot_overwrite_newer_checkpoint(self):
        table, jobid, _ = fixture()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        row.update({"poolMode": True, "state": "running",
                    "leaseOwner": "newer-lease", "leaseUntil": int(time.time()) + 100})
        old = {**row, "leaseOwner": "expired-older-lease"}
        self.assertFalse(cloud_jobs._save_progress(
            table, old, position=1, leaseUntil=0, state="queued"))
        self.assertEqual(row["position"], 0)
        self.assertEqual(row["leaseOwner"], "newer-lease")
        current = dict(row)
        self.assertTrue(cloud_jobs._save_progress(
            table, current, position=1, state="queued", leaseUntil=0))
        self.assertEqual(row["position"], 1)

    def test_superseded_pool_worker_cannot_publish_old_scene_result(self):
        table, jobid, scenes = fixture()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        row["poolMode"] = True
        lessons = [{"sceneId": x["id"], "episodeId": "ep1", "issue": "keep",
                    "original": x["text"], "revised": x["text"],
                    "teacherReason": "ตรวจแล้วไม่พบปัญหา"} for x in scenes]
        def supersede(_body):
            row["leaseOwner"] = "replacement-worker-token"
            return teacher._response(200, {"lessons": lessons,
                                           "saved": 2, "reused": 0})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach", side_effect=supersede):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "superseded-worker")
        self.assertEqual(row["completedIndices"], [])
        self.assertEqual(row["position"], 0)
        self.assertNotIn(("teacher-job#" + jobid, "result#00000"), table.rows)

    def test_stale_worker_exception_cannot_reset_new_worker_lease(self):
        table, jobid, scenes = fixture()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        row["poolMode"] = True
        def supersede_then_fail(_body):
            row["leaseOwner"] = "replacement-worker-token"
            raise TimeoutError("simulated network timeout")
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach", side_effect=supersede_then_fail):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "worker-claim-lost")
        self.assertEqual(row["leaseOwner"], "replacement-worker-token")
        self.assertEqual(row["state"], "running")
        self.assertEqual(row.get("transientFailures", 0), 0)
        self.assertEqual(row["position"], 0)

    def test_all_busy_does_not_call_teacher_or_advance_progress(self):
        table, jobid, scenes = fixture()
        table.rows[("teacher-job#" + jobid, "meta")]["poolMode"] = True
        for connection in self.connections():
            table.put_item(Item={"pk": cloud_jobs.PROVIDER_LOCK_PREFIX + connection["id"],
                                 "sk": "lease", "ownerJob": "other-job",
                                 "leaseUntil": int(time.time()) + 70,
                                 "updatedAt": int(time.time())})
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing", return_value=self.connections()), \
             mock.patch.object(teacher, "_auto_teach",
                               side_effect=AssertionError("no inference while busy")) as work:
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "pool-busy")
        work.assert_not_called()
        meta = table.rows[("teacher-job#" + jobid, "meta")]
        self.assertEqual(meta["position"], 0)
        self.assertEqual(meta["leaseUntil"], 0)

    def test_owner_pause_cannot_revert_job_completed_by_another_worker(self):
        table, jobid, _ = fixture()
        original_update = table.update_item
        def simulate_race(**kw):
            table.rows[("teacher-job#" + jobid, "meta")]["state"] = "completed"
            return original_update(**kw)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(table, "update_item", side_effect=simulate_race):
            status, output = read(cloud_jobs._control(
                "teacher.job.pause", {"jobId": jobid}, "225819900"))
        self.assertEqual(status, 409)
        self.assertEqual(table.rows[("teacher-job#" + jobid, "meta")]["state"], "completed")

    def test_owner_resume_cannot_restart_cancelled_job_after_race(self):
        table, jobid, _ = fixture()
        row = table.rows[("teacher-job#" + jobid, "meta")]
        row["state"] = "paused"
        original_update = table.update_item
        def simulate_race(**kw):
            row["state"] = "cancelled"
            return original_update(**kw)
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(table, "update_item", side_effect=simulate_race), \
             mock.patch.object(cloud_jobs, "_launch",
                               side_effect=AssertionError("cancelled should not launch")) as launch:
            status, _ = read(cloud_jobs._control(
                "teacher.job.resume", {"jobId": jobid}, "225819900"))
        self.assertEqual(status, 409)
        self.assertEqual(row["state"], "cancelled")
        self.assertEqual(row["generation"], 0)
        launch.assert_not_called()

    def test_non_opted_job_still_uses_original_key(self):
        table, jobid, scenes = fixture()
        lessons = [{"sceneId": x["id"], "episodeId": "ep1", "issue": "keep",
                    "original": x["text"], "revised": x["text"],
                    "teacherReason": "ตรวจสอบแล้ว"} for x in scenes]
        import story_auto_train
        with mock.patch.object(cloud_jobs, "_table", return_value=table), \
             mock.patch.object(connections, "listing",
                               side_effect=AssertionError("must not enter pool")) as listed, \
             mock.patch.object(teacher, "_auto_teach", return_value=teacher._response(
                 200, {"lessons": lessons, "saved": 2, "reused": 0})) as work, \
             mock.patch.object(story_auto_train, "train", return_value={
                 "body": '{"status":"collecting","activated":false}'}):
            result = cloud_jobs.worker({"jobId": jobid, "generation": 0})
        self.assertEqual(result["state"], "completed")
        self.assertEqual(work.call_args.args[0]["provider"], "gemini")
        listed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
