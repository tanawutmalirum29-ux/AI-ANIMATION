# Video feedback → AI quality coaching (2 Nov 2026)

## Scope and evidence

- Input: user-attached `22497.mp4` examined in the conversation; source media is **not** stored in this repository.
- Media metadata verified with ffprobe: **117.572 s**, H.264 **540×960**, **24 fps**, AAC audio stream. Presence of AAC is *not* proof that every line is audible.
- Visual and caption observations come from sampled frames and previous in-conversation review. Not a source-level SVG rig audit, exhaustive frame inspection, transcription, or verified post-fix export.
- This is **evaluation-only feedback**. No human-approved training labels, model-weight updates, cloud training or model promotion.

## Failure → expected agent behavior

| Priority | Failure observed / risk | Required action | Verification |
| --- | --- | --- | --- |
| P0 | Narration describes a bridge falling, toolbox sinking, rotating reflector, snapped belt or three flashes while the picture can remain generic | AI composition/SVG/motion produce matching **renderable** assets and *timed* action beats; no generic prop or actor walk as evidence; disclose unsupported actions rather than inventing them | JSON preflight `unverified-event` then review relevant exported frames |
| P0 | Actors overlap; an arm/hand can appear to pass through a body or prop | Preserve intentional contact; check shoulder–elbow–wrist anchors, front/back layer, floor contacts, held-asset ownership, silhouette spacing at **start and end** of motion | `actor-overlap` warns about cramped starts; rig correctness requires browser/export visual inspection |
| P0 | Captions show late, wrap into short orphan words or extend outside safe width | Align `subtitleCues` to **real** voice clip start and end, divide by spoken phrase, balance Thai grapheme groups and respect portrait safe area | `caption-voice-misalignment` checks clip and cue metadata; `caption-wrap` checks a known renderer limitation; listen and inspect pixels |
| P1 | Narration finishes well before a scene ends | Re-time only when a playable voice clip exists and story beat is not explicitly held; chapter-card gaps and dramatic pauses may be intentional | `StoryTimingAuditor` with clip coverage; never trim `[HOLD]` or authored keyframes |
| P1 | Rain/night scenes lack immersive environmental sound, or atmosphere cuts suddenly | Check ambient continuity and real output mix; sound design follows the *location* and action, not keyword volume | Listen to the exported video; do not claim audio quality from JSON |
| P1 | A circular placeholder resembles a sign instead of a reflector/lamp; setting looks unchanged while narration changes place | Prefer recognizable silhouettes, meaningful location assets and shot variations, not just decorative SVG and static character poses | Storyboard comparison plus actual MP4 samples; static presence is not enough |
| P1 | Repeated 'ตอนที่ N' on a chapter card or text off-center | Suppress duplicated chapter labels; test layout in real browser, particularly Thai canvas center alignment | `chapter-title-duplicate` check; Chromium pixel QA for alignment |
| P2 | Encode at 540×960 ~0.5 Mbps video may lose thin lines/captions | Offer a higher-resolution/high-bitrate export preset only once scenes and timing are corrected | Compare encoded exports, not theoretical settings |

## Story-to-Action contract for the internal agents

1. **Author retains narrative ownership.** The studio must never rewrite the submitted story or fabricate filler to reach 60 seconds.
2. For every causal line, identify `subject → verb → object → visible change → timed beat → corresponding sound`. Example: belt intact → belt snaps → mechanism stops / light extinguishes → substitute strap installed → motion / light resume.
3. Use supported scene properties (`actors`, `props`, `customAssets`, `cinematicFx`, `subtitleCues` and actual `audioClips`). `imagePrompt` is not a command executable by the SVG renderer.
4. Scene-specific object identity matters: an animated toolbox does **not** demonstrate a bridge collapse, and character movement does **not** demonstrate three lamp flashes.
5. If an event asset exists but has **no executable motion**, label it as insufficient for a narrated change. Do not silently invent animation on locked/manual assets.
6. A voice clip with usable duration and timed captions can support a **timing** warning; no waveform transcription / phonetic alignment has been performed. A cue arriving more than 0.75 s after first voice onset or ending over 0.85 s before last voice offset is a *review trigger*, not a proof of a broken MP4.
7. Use the manual MP4 review as the final gate: caption safe area, Thai line breaks, actor anatomy, compositing, shot continuity, soundscape, action visibility and actual audio words.

## What this change really trains

- Updates **role instructions** (`studio-ai-core.js`) and **deterministic pre-export quality rules** (`studio-visual-qa.js`).
- Adds regression cases to `tests/video-review-nov1.test.cjs` for unrelated/static assets, valid animated assets, generic walks, late captions, aligned captions and missing audio evidence.
- Does **not** fine-tune a neural model or guarantee that any existing MP4 is repaired. Producing a new clip and passing pixel/audio checks is still required.
- Do **not** add the user's video/audio or unapproved examples to `training-lab/datasets/approved/`.

## Follow-up acceptance for a new export

- Inspect at least the bridge/toolbox/belt/reflector/flashes/town ending beats in the newly exported MP4.
- Confirm Thai captions follow the actual voice onset and never clip at the right screen edge.
- Verify audible ambience behind narration, with no artificially injected filler.
- Confirm actor arm ordering and meaningful interaction with scene props.
- Report real test output and link the artifact; keep unresolved visual issues explicit.
