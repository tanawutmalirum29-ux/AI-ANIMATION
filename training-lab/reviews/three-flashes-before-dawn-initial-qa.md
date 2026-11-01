# Candidate QA — สามแสงก่อนรุ่งสาง

Source: user-uploaded `three_flashes_before_dawn(1).json` (2026-11-01). **The JSON source is not stored in this PR.** Do not treat this report as a complete training dataset.

## Static checks performed
- JSON parsed successfully.
- version: 1; episodes: 3; scenes: 18; characters: 3; locations: 5.
- Planned episode duration: 60 seconds each (180 seconds total).
- Every scene has nonempty voiceover; all scene IDs unique.
- All referenced character IDs, actor IDs, location IDs, and narrator voice profile IDs resolve.
- Subtitle cue ranges are within their scene durations.
- All scene audio fields are null; no real narration audio was measured.

## Important limitations
- The 60-second durations are author-supplied estimates, **not measured narration/playback durations**.
- No live Story Studio import, rendering, dubbing, or visual QA has been executed.
- Scene action, camera, actor rig pose support and subtitle rendering remain to be tested against current app.
- This sample is a **candidate**, not approved ground truth and not proof of trained model performance.

## Next steps
1. Import source JSON in Story Studio staging/test mode and check parser/runtime warnings.
2. Generate narrator audio and measure actual clip durations.
3. Compare predicted versus measured scene timing; audit long post-voice holds and unsafe split boundaries.
4. Capture human-reviewed corrections and record them as ground truth.
5. Only then promote the candidate into a versioned training dataset and use separate stories for evaluation.
