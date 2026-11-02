# QA — Coastal Gate v5 (user export, 2026-11-02)

**Disposition: NO MATERIAL SCENE IMPROVEMENT / NOT APPROVED for model training.**

## Sources & method

Compared user-uploaded `ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1(5).mp4` against `ฝึก-AI-ประตูน้ำก่อนตลาดท่วม-1(3).mp4`. Source media remain in the user conversation, **not** copied to this public GitHub repository.

- Earlier: 512×910, ~29.94 fps, 606 video frames, 20.241667 s, ~10.56 MB.
- Latest: 540×960, 24 fps, 485 video frames, 20.285333 s, ~2.47 MB.
- Compared decoded video at shared timestamps, resizing the newer video to 512×910 for equivalent presentation. Sampled 99 timestamps at 0.2s intervals.
- Median mean absolute pixel difference in the upper 77% (excluding subtitle strip) ~0.842 / 255. Median fraction of pixels with any channel difference >18 in this region is ~0.066%. Some individual timestamp samples are larger because scene/animation/speech frames do not align exactly between frame rates.
- Full decoded mono 16kHz PCM audio: first 323,584 samples essentially identical between exports (Pearson r = **0.999999999965**, MAE ~7.7e-9). New export includes 683 additional PCM samples because video/container duration is ~0.0437s longer.
- Both files have a continuous non-digital-zero ambient bed. No audio improvement is evidenced by the newer encoding.
- Numerical differences do not establish bitwise frame identity; main narrative composition looks materially unchanged in the sampled actual frames.

## Observed latest MP4

1. **Scene s01 (0–~5.64s):** rainy market with several figures, but gate dominates the establishing pan and rising water gauge is still not legible as the narrated rising tide. Consider a wider market-plus-sea shot with water level gauge large enough to read.
2. **Scene s02 (~5.64–10.75s):** gate looks like a large industrial rolling shutter/door; a thin light-blue stream is visible near lower right but the upper and lower water levels, concrete water channel and water pressure remain visually ambiguous. Requires an intentional wide/context-to-detail cut.
3. **Scene s03 (~10.75–15.51s):** Pim runs and points toward background vendors. Merchants and crates are visible, but very small and stylized; the causal action (specific seller sees warning, picks up crate, relocates) is not clearly legible at standard portrait playback. Stage a human-scale 2-person shot and ensure hands/feet remain grounded.
4. **Scene s04 (~15.51–20.29s):** a large flat-edged translucent blue rectangular flood still spans high up the left portion of the market, resembling a vertical overlay rather than ground-constrained water. Three people appear on high ground at the extreme right at ~19.7s and some bodies crop at frame edge. Require water plane clipped to the street with occlusion and a camera shot that centers the safe group.
5. **Subtitles:** centered within portrait frame; several unnatural Thai phrase splits remain in the latest sampled frames, e.g. short fragments `ช่องด้าน`, `ถึงหน้า`, `คนหนีขึ้นที่ / สูงได้ทัน`. Layout must follow speech phrases and preserve safe-width while avoiding orphan fragments.
6. **Audio:** the downloaded audio is for practical purposes the *same mix* as the earlier export; ambience has already prevented digital zero at scene cuts, but the next pass must check transitions and narrator intelligibility by listening (not assessed here with word-level transcript).

## Engineering/ML consequences

- **Do not label v5 as a positive improvement** over v3 just because resolution/bitrate/fps differ.
- Treat as an **unchanged-content re-export** in QA history, not an approved ML training sample.
- Before another export, fix **(P0)** street-water geometry and occlusion, **(P0)** a prominent market interaction/action beat, **(P1)** a readable flood-control gate and rising tide, **(P1)** centered final safe-hill frame, and **(P1)** Thai subtitle phrase splitting.
- Verify pixel-level differences in the intended locations **and** visually inspect the actual new frame; altered codec alone is not QA success.
- Approval by user and distinct multi-story data are still required before any weight training or promotion.

This report documents the uploaded video. No production code was modified by this QA report.
