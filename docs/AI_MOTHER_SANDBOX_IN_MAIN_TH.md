# AI Mother Sandbox inside main — safe owner-only rehearsal

## Purpose

This keeps **the AI Mother Pool code in the same GitHub `main` release**, but
provides a separate **admin-only rehearsal section** under the existing
"สอน AI ลูกจากหลาย JSON" page. API connections are resolved from the **same
owner AWS secrets** as production; **no API key re-entry** is required.

The first stage is a **dry-run** only. It submits 1–3 short Thai narration
scenes to one selected existing AI Mother. The model returns suggestions;
nothing is approved, rewritten in the real project, copied into the training
corpus, or used to train/activate a child model.

## Isolation boundary, exactly

- Reports are written under PK `teacher-sandbox-report#225819900` with
  `sk=report#<timestamp>#<uuid>`. The production training dataset uses
  `learning#teacher-story-coherence`; the sandbox never writes this PK.
- Default: **logical DynamoDB partition isolation in the existing teacher
  table**, so no extra AWS table is needed just to try the dry-run.
- Optional stronger storage isolation: provision a **separate DynamoDB table**
  with PK `pk`, SK `sk`, grant the Lambda role GetItem/PutItem/Query on that
  table and set `TEACHER_SANDBOX_TABLE` to its name. Do not copy teacher
  training rows or API secrets to that table.
- Production provider keys remain in SSM/Secrets Manager or owner vault;
  the model request is a real API call, and the sandbox may encounter
  provider rate limits like any other call.
- The route is permitted **only for the verified GitHub OAuth admin**,
  not members, guests, or a password-only session.
- The sandbox cannot invoke `teacher._auto_teach`, `cloud_jobs`,
  `story_auto_train`, or `student_learning`. Model weights and actual
  project scenes are untouched. Separate provider API **account quotas**
  are not promised.
- Every run is saved as a JSON report even when the provider returns 429;
  if DynamoDB cannot persist the report, the request returns an error
  rather than claiming the trial is saved.

## How the owner tests

1. On the deployed `main` website, sign in with the owner's GitHub account.
2. Open "สอน AI ลูกจากหลาย JSON" > "พื้นที่ทดลอง AI แม่".
3. Select one existing AI connection. Paste 1–3 trial narrations separated
   by a blank line. Click "ทดสอบและบันทึกรายงาน".
4. Inspect the provider outcome, proposed script edits, and status. The
   report remains on AWS as sandbox data.
5. Download the JSON report. Upload it in the ChatGPT conversation so the
   assistant can analyze the exact evidence; an external ChatGPT session
   cannot automatically read private DynamoDB rows.

## Explicitly not covered by this first stage

- **Not** full Step Functions failover/concurrency or a live 100-AI load test.
- **Not** actual autonomous training of the child model in isolation.
- **Not** a separate physical AWS database unless `TEACHER_SANDBOX_TABLE`
  has been provisioned and IAM configured.
- **Not** a guarantee that installing code on Lambda was successful.
  Verify the GitHub Deploy workflow and then run a controlled smoke test.

For fully isolated **end-to-end teacher job training tests**, provision a
separate Lambda function, Step Functions state machine, IAM role scope and
DynamoDB table. Reuse *read-only* references to existing owner API secrets,
but do not let sandbox writes reach production training keys or model locks.
Until that isolation exists, do **not** turn on a full-training "sandbox" mode.
