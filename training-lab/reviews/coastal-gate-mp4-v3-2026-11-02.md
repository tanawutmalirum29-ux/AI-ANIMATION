# Coastal Gate — MP4 v3 visual/audio QA (2 Nov 2026)

**Source:** User-provided `ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1(2).mp4`, evaluated directly against preceding `ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1(1).mp4`. No video/media committed to the public repository.

**Review disposition: IMPROVED / NOT YET APPROVED AS POSITIVE ML TRAINING SAMPLE.** Comparing actual decoded video frames and PCM audio establishes change, but a changed video is not automatically a correct video.

## Verified measurements

- Both exports: 20.241667 s, 512×910, approximately 30 fps, 606 frames. No new filler duration.
- New: **0 of 606 decoded frames identical** to old, average absolute channel difference ~12.28 (8-bit units) and ~28.7% of pixels per frame change by >18 in at least one channel. Changes include intentional SVG/world geometry, though rain/encoding also contribute. Avoid interpreting the percentage as 'story quality score'.
- Old → new, by scene: 0–5.64s ~27.7%, 5.64–10.75s ~35.2%, 10.75–15.51s ~29.9%, 15.51–20.24s ~21.7% pixels with channel difference >18.
- Previous export: three ~1.06–1.08 s zero/near-zero digital-audio gaps at scene boundaries, and ~0.9s near-zero ending.
- New export: **none of these windows remain near-digital-zero** under the previous RMS thresholds of 0.0001, 0.001 or 0.004 (20ms window, mono 16kHz decoded analysis). Ambience now exists during cut gaps, though narrated speech still has ~1s pauses. New stereo channels are identical (dual mono); multichannel spatialization is not established.
- New/old audio Pearson correlation ~0.9695. This is consistent with mixed/additional signal, not by itself evidence of speech correctness. No forced transcript/pronunciation check was performed.

## Actual frames and remaining story defects

| Timestamp | Improved | Still needs work / acceptance |
| --- | --- | --- |
| 00:00–05:39 | Bigger, differentiated gate structure and more prominent circular hoist; camera pan changes visual framing from old clip | Night picture still reads largely as a **barred industrial door** rather than unmistakable sluice/channel; rising water gauge is not obvious enough in delivered frame. Scene begins gate-heavy while narration first establishes a populated market and rising sea. Make establishing shot clearly show water + stalls + people, then move to gate. |
| 05:39–10:45 | Hoist, leak at lower right and somewhat stronger water stream now visible; geometry does change | Pressure jet appears as thin light-blue spray near right edge; still insufficient picture of upstream/downstream level, depth and water-pressure origin. Pim stands near gate; no explicit inspect/point/reaction action tied to source. Use a clear detail crop, width of actual outlet and foaming turbulence. |
| 10:45–15:30 | Pim's run and raised/pointing arm is clearer and camera follows towards stalls | No **readable merchant acknowledgment or crate-lifting response** appears at normal 512×910 frame size. Background figures/boxes, if drawn, are too tiny or obscured; actor still visually dominates. Stage the alert as a two-person interaction and then a crate lift, not just Pim crossing past anonymous stalls. |
| 15:30–20:24 | Market area appears more distinctly; at ~19.8s tiny high-ground figures can be seen near **far-right** edge, so safe hill is no longer entirely absent | Water remains a broad flat translucent blue **vertical sheet over stalls** rather than an irregular horizontal flood plane confined to low street. High-ground group is small and cropped to edge; move camera or add a final close/reframe so people safe on hill can be recognized immediately. |
| Throughout | Frames changed substantially and rain/ambience have been revised | A very large, dark quadrilateral across the upper sky remains visible in several shots (roughly 02–04s and 12–19s). Find the exact SVG element/layer and remove or make physically explicable. Keep character/body proportions and floor contact under visual QA. |
| Subtitles | Text is within frame on sampled views; contrast generally sufficient | Orphan Thai words remain: ~1.5s lone “ตลาด” and near 19.8s lone “ทัน”. Avoid separating final short words from their parent clause; enforce balanced two-line layout based on Thai grapheme-aware phrase grouping and safe-width. |
| Audio | **Fixed digital-zero gaps** with a low-volume background bed in the exported PCM; explicit improvement | Still test subjective rain timbre, relative loudness to voice, fades/cut transitions and speech accuracy with human playback; zero digital silence no longer implies the atmosphere sounds realistic. |

## Next engineering acceptance

1. The flooded street's water surface must be represented as a shallow **horizontal** bounded plane and be masked by market stall geometry; never use a full-height overlay over stalls.
2. A merchant must visibly **look at Pim, acknowledge, pick up a crate and relocate uphill** within scene s03; viewable at standard 512×910 resolution.
3. Scene s04 must give >1 s of readable, unclipped **safe villagers on hill** rather than leaving them at the extreme right edge.
4. A viewer who has never read narration recognizes the gate as sluice machinery with water passing beneath it; establishing scene shows people, market and rising tide.
5. Eliminate large unexplained quadrilateral geometry from the sky by identifying actual source element (no blind overpainting).
6. Avoid orphan single-word Thai subtitle lines including “ตลาด” and “ทัน” in the output MP4.
7. Keep the successful new low-volume continuous audio bed while preserving clear voice and user-authored sound.

## Training decision

- Latest export is a **valid before/after regression comparison** and a candidate for *user review*.
- It is **not** an automatically approved machine-learning example: remaining causal actions and water/shot layout fail the visual acceptance criteria. Do not add it to `datasets/approved`, retrain weights, or promote models based solely on these samples.
- After an engineering pass and a demonstrably improved export, request human approval. Only then consider approved scene-action labels for training across multiple distinct stories.

**Evidence method:** ffprobe metadata, all 606 decoded RGB/BGR video frames compared and sampled visual inspection at 0.4–19.8s; both audio tracks decoded to stereo 16kHz floating-point PCM, 20ms windowed RMS, correlation and silence checks. Assessment of pronunciation, exact word-level sync and full-frame rig physics remains out of scope.
