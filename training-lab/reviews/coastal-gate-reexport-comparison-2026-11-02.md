# Re-export comparison — Coastal Gate (2026-11-02)

**QA status: NO VISUAL CHANGE / NOT APPROVED FOR ML TRAINING**

Compared user-uploaded exported videos, not a repository test fixture:

| | Prior export | Latest export |
|---|---|---|
| Filename | ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1.mp4 | ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1(1).mp4 |
| Embedded creation timestamp (UTC) | 2026-11-02 00:15:00 | 2026-11-02 00:42:03 |
| Duration | 20.241667 s | 20.241667 s |
| Resolution | 512×910 | 512×910 |
| Decoded video frames | 606 | 606 |
| Same decoded video content | **606/606** | **606/606** |
| Decoded mono audio sample correlation | — | **0.999004** |
| PCM RMS audio difference relative to original | — | **-27.0 dB** |
| Silence at scene boundary 1 | 4.737–5.839s | same |
| Silence at scene boundary 2 | 9.830–10.950s | same |
| Silence at scene boundary 3 | 14.596–15.714s | same |
| Silence at end | 19.265–20.243s | same |

## Method / limitations

- Compared the **full sequence of decoded frame checksums**, rather than filenames or MP4 file hashes. Frame payloads and order match exactly for all 606 frames; this is stronger evidence than sampling screenshots.
- Decoded audio differs slightly (e.g. AAC re-encode or mix variation), but sounds are **not** shown to have improved by an audio correlation alone; all four measured silent intervals remain.
- Audio was examined via digital waveform, not full speech transcription or perceptual listening. Do not claim voice content/pronunciation is correct.
- This comparison verifies **no visible change**, not that the new app code is necessarily unchanged. The same old JSON can render identically even after app code changed if the relevant effects are not enabled.

## Still-open user-visible problems (all remain from first review)

1. **P0 — Gate identity and leak:** the gate reads as a barred building entrance, not an obvious working sluice with water levels on opposite sides and a visible pressure jet through its bottom. Scene s02.
2. **P0 — Story actions:** no legible market sellers responding, moving boxes or evacuating; Pim mostly runs/poses before an unchanged background. Scene s03.
3. **P0 — Flood effect:** large translucent blue band/overlay occludes the market instead of rising within the coastal street geometry; market was empty even before evacuation. Scene s04.
4. **P1 — Opening water level:** storm is present but progressive rise is not visibly established. Scene s01.
5. **P1 — Shot design:** repeated gate-and-market view, no meaningful leak close-up/market tracking/high-ground reveal; dark geometric panel in sky remains.
6. **P1 — Sound:** roughly 1.1s digital silence at each of three transitions, inconsistent with rain. Ending also ~0.98s silence.
7. **P1 — Thai captions:** visible and within frame, but phrase grouping should be improved; need real speech-to-cue validation before claiming precise sync.

## AI training gate

This latest upload **must not** be labeled as an improved/approved pair. The visual result is identical. Keep it as a **failed regression / re-export duplicate** in evaluations, not `training-lab/datasets/approved/`. Use the already documented original [review](./coastal-gate-video-review-2026-11-02.md) and its [structured evaluation](../evaluations/coastal-gate-video-review-2026-11-02.json) to implement fixes first, export **new visibly changed frames**, and obtain human approval before contributing examples to a training set.

**Next QA requirement:** after changes, verify at least one decoded frame differs at each intended scene beat; visually inspect whether the new pixels show the correct action. A nonmatching hash alone is **not** proof of improvement, and changing the video encoder must not count as model learning.

No videos, audio samples, or screenshots have been uploaded to the public repository in this review.
