# AI Mother Pool v1 — staging-only rollout

This change is intentionally **not enabled on existing AWS jobs** until reviewed and deployed.

## What is implemented

- Owner-only additional AI connections are encrypted per credential using AES-256-GCM in the existing teacher DynamoDB table. No six-key application cap in the new vault; AWS account limits, DynamoDB throughput and provider quotas still apply.
- Legacy SSM-based API keys stay untouched. New keys use DynamoDB only if `TEACHER_FEEDBACK_TABLE` and a stable `SESSION_SECRET` are present. Otherwise the old bounded SSM path continues.
- A new **opt-in** "idle mother" mode can borrow an unused *additional key* (connection IDs beginning `key-`) for the **next** 1–2-scene batch. All jobs still use the same immutable input and checkpoint/lesson cache.
- Key borrowing uses DynamoDB conditional leases, provider-level quota cooldown and an unchanged one-worker-per-job lease. A running scene is never transferred.
- Removing an owner-vault key while an unfinished pool job exists is blocked conservatively.
- Existing jobs without `poolMode` continue using their originally assigned provider and key, with unchanged ID/fingerprint.

## Critical limitations (do not oversell)

1. **This is cooperative sequential borrowing, not six workers editing one long story in parallel.** Within one story the old single job lease still serializes each training batch. No active scene is reassigned.
2. The context currently sent to a model is the scene's limited previous/next text (maximum 350 characters each) plus the teacher prompt and existing lesson memory. It is **not** full-book shared memory. Long-range continuity requires a separate, validated story memory design.
3. The model retraining/promotion flow is a separate legacy workflow. The pool does not add distributed training locks or guarantee concurrent promotions will not race. Do not launch large simultaneous rollouts until training promotion has been audited.
4. For safety the pool excludes `default-gemini`, `default-openrouter`, and `default-compatible` from borrowing. Those default keys retain legacy behavior. Pool mode only works when at least one **extra** key is connected.
5. Provider limits, AWS costs, API latency, Lambda/Step Functions quotas, and encrypted vault limits (DynamoDB and key rotation) remain. A second key on the same provider account may not increase capacity.
6. The existing browser picker accepts eight JSON files at a time and the worker accepts up to 350 scenes per job. These limits are **not** removed by this change.
7. Initial connection assignment is recorded for compatibility. When pooling is on, `lastConnectionId` reports the latest worker, not a permanent owner.

## Deployment checklist (manual approval required)

1. Merge only after `AI Teacher Studio QA` passes and AWS smoke tests are reviewed. Never change active production Lambda configuration from an unreviewed PR.
2. Verify the existing owner GitHub OAuth permission boundary and stable `SESSION_SECRET` in the configured AWS region. **Do not print secret values**. Rotating `SESSION_SECRET` without re-encrypting the vault makes those stored keys unreadable.
3. Deploy Lambda with the new `autodub/owner_key_vault.py` bundled, and apply the updated `autodub/setup-teacher.sh` IAM permissions to the existing table; it must allow GetItem, PutItem, UpdateItem and Query.
4. Test adding seven **test credentials** and verify listing, key resolution, removal, and isolation from member credentials. Do not publish genuine API keys to GitHub, log events or JSON.
5. Confirm `teacher.job.config.poolEnabled` is false by default. Existing jobs must continue normally.
6. After the owner explicitly approves the feature, enable `TEACHER_ENABLE_IDLE_POOL=1` in **Lambda environment variables** while preserving all existing variables. Use a controlled trial with two short stories and two extra keys. Disable with value `0` to revert to the legacy pinned-key path for subsequent batches.
7. Verify an idle connection takes the next unfinished batch, an occupied connection is not used concurrently, a paused job remains paused, and failure/retry retains original scene indices. Observe CloudWatch logs and DynamoDB checkpoints.
8. Test provider HTTP 429, timeouts, AWS worker retries, and deleting a connection while queued/running/paused work exists. Stop rollout if any checkpoint skips/duplicates or provider-billing anomalies appear.

## Rollback

- Switch Lambda `TEACHER_ENABLE_IDLE_POOL` to `0`: opted-in jobs use the original key on subsequent batches, maintaining the same job checkpoint and id.
- Old SSM credentials remain unchanged, so legacy connections can still be used.
- Do **not** delete the new vault table records; they are encrypted and can be retained safely for migration.
- Do not flip the toggle while requests are in flight; wait for Lambda invocations to finish before testing rollback.

The code and the GitHub PR alone do **not** provision or activate AWS resources.
