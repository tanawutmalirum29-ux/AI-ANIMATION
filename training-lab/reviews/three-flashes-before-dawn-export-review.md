# Export review — สามแสงก่อนรุ่งสาง (1 Nov 2026)

## Evidence / scope
- User supplied **the revised story JSON** (3 episodes, 18 scenes, 60 seconds authored per episode) and **3 exported MP4 videos**.
- The MP4 files have H.264 512×910 video and AAC 48 kHz stereo audio. Audio **tracks exist**; this is not a missing-audio-track incident.
- Export durations: 47.105s / 46.383s / 45.933s.
- `ffmpeg silencedetect=noise=-35dB:d=0.5` found six trailing low-level audio intervals per video, ~2.45–2.71s each. Complete time intervals and inferred scene boundaries are in `../evaluations/three-flashes-export-audit.json`.
- The source JSON has all 18 narration scripts, but every `scenes[].audioClips` is empty. We **cannot** infer real speech durations from the JSON alone.
- Visual review sampled **18 timestamps per exported episode**, giving 54 inspected frames in all, without claiming exhaustive frame-by-frame coverage.

## What the exported frames show
- The storm and harbor/workshop visual language is coherent, but most sampled frames contain repeated generic weather, buildings/railings and relatively static character poses rather than the specifically described story actions.
- The JSON repeatedly asks for mechanisms or large visual events in `imagePrompt` without an equivalent explicit scene-level object/action timeline. For example, **s08** says the bridge collapses and a toolbox drops, while `s08.props=[]` and `s08.sfx=[]`. We did not observe the collapse or falling toolbox in sampled episode-2 frames.
- **s11–s12** ask for the beacon lighting, rotating reflector, a snapped belt and a blackout, but again `s11/s12.props=[]` and `s11/s12.sfx=[]`; sampled frames did not clearly show this causal sequence.
- **s15** asks for three distinct lighthouse flashes, but `s15.props=[]` and `s15.sfx=[]`; sampled episode-3 frames did not demonstrate the promised three-count event. This is **not proof it never occurs** between sampled frames.
- Caption text is visible near the lower edge in some samples. Precise word-to-voice alignment remains unverified.

## Diagnosis (evidence vs inference)
1. **Measured:** repeated ~2.6s low-level trailing intervals are a strong target for the timing director. **Inference:** imported scene lengths survived audio placement, leaving unnecessary gap after narration.
2. **Measured:** source authoring targets 60s per episode, while exported results are ~46s. A target is not a guarantee. **Do not add silence, slow down speech unnaturally or invent scenes to reach 60s.**
3. **Measured:** narration text is present, video has audio, JSON does not embed clips. **Do not mark the voice engine as having lost all audio**; instead audit caption alignment and the repeated tails.
4. **Visual QA risk:** `imagePrompt` is a visual description, not an executable drawing or rig instruction. Without concrete props, actor interactions, animated effects or supplied art, a static 2D renderer cannot reproduce all events in prose.

## Corrective action implemented in this PR
- Shorter default **post-narration visual tails**, while honoring explicit `[HOLD]`, `[PAUSE]`, timed actor events and non-voice SFX.
- Automatic conservative tightening after successful TTS generation and after **จัดเฟรมคลิปพากย์เดิม**; this is reversible as part of the editor's undo history.
- **Safety gates:** no automatic shortening when any narration segment or subtitle clip is missing; manually recorded voices are left alone.
- Regression fixture/tests use measured export intervals but never commit the user's video/audio or the full story.
- Each change is deterministic audio-aware correction and regression learning, **not neural-network weight training**. Fine-tuning requires a suitable model, approved labels and independent stories for train/validation/test.

## Release and operator checklist
1. CI passes (static + browser smoke, including 18-scene pacing regression).
2. Re-open the original project JSON or, preferably, a backed-up Studio project that includes real generated voice clips. A JSON file with empty `audioClips` must be **dubbed first**; there is nothing to tighten.
3. In **เสียงพากย์ / Sound Desk**, turn on the Smart Director and run the auto narration OR **จัดเฟรมคลิปพากย์เดิม** on a project that already stores Auto Dub clips.
4. Inspect episode durations and captions, export all three episodes again and compare voice-end tails to this baseline. Shorter episodes are acceptable when the narration ends earlier.
5. Check storyboard visually, particularly **s08, s11–s12, s15**. If the actual props/actions are absent, create executable scene effects/interaction assets; timing adjustment alone cannot draw objects from the text.
6. Ask the owner to approve the new outputs before considering any examples ground-truth training labels.

## Boundaries
- No cloud retraining, fine-tuning, LoRA job or weight checkpoint ran.
- No end-to-end export of the revised site has been observed yet.
- No unsupported claim of 60–65s successful episode length or fully correct animation.
