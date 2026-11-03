# AI Mother V2 — 12 production roles, safe migration

**Status (2026-11-03): role registry, safe read-only job plan, AI Mother context and sample contracts. This is NOT twelve trained AI models and not yet a complete text-to-SVG renderer.** V1 six-stage production still executes unchanged until the new workers are independently implemented and tested.

## Absolute preservation policy

Do not overwrite, delete, re-number or retrain from scratch the existing script-writing assistants, saved lessons, active CPU model weights, or the old six-stage production flow.

**Preserve existing script-review/teaching code:** `studio-script-ml.js`, `studio-story-foundation.js`, `studio-story-coach.js`, `studio-auto-teach.js`, `studio-student-learning.js`, `autodub/story_auto_train.py`, `autodub/student_learning.py`, `autodub/thai_editor.py`, `autodub/teacher.py`, all `training-lab/datasets/` and existing AWS DynamoDB lesson/checkpoint/model records. V2 adds new files; old classifications, lesson history, release gating and imports stay compatible.

The existing script specialist is **not** one interchangeable new worker: its review, repetition-intent, emotion, and CPU classifiers may assist AI-1/AI-2/AI-3/AI-11, without assuming it has become a generative text/visual model. AI Mother can suggest a correction but must never silently modify source voiceover.

## Positions

| V2 position | Output contract | Existing useful support |
|---|---|---|
| AI-1 Story Analyst | `story-beats` | Script ML / Story Foundation (advisory only) |
| AI-2 Continuity Keeper | `continuity-bible` | Story Continuity Coach |
| AI-3 Scene Director | `scene-breakdown` | Story-only adapter / Timing Auditor |
| AI-4 Storyboard Director | `shot-plan` | Shot ML (advisory) |
| AI-5 Environment Artist | `environment-svg` | Current SVG templates, incomplete |
| AI-6 Character Artist | `character-rig` | Current rig presets, incomplete |
| AI-7 Prop Artist | `prop-svg` | Existing prop templates, incomplete |
| AI-8 Layout Director | `layout-plan` | Existing composition rules |
| AI-9 Motion Director | `motion-keys` | Walk/run and event keyframe rules |
| AI-10 Audio Director | `audio-cues` | Existing Edge TTS and sound desk |
| AI-11 Timeline Editor | `timeline` | Current Timing Auditor |
| AI-12 Quality Inspector | `qa-report` | JSON visual QA; **not pixel/audio QA** |

The six original production IDs `composition/assets/motion/voice/timing/qa` remain unchanged in `studio-production-planner.js` and the AI Workspace. The independent Member AI 6-role catalog and its training/release restrictions also stay unchanged. **Never interpret the V2 AI-1 index as an alias of the old AI-1 stage**: V2 role IDs are namespaced by their descriptive IDs.

## AI Mother routing policy

1. Receive JSON, store original untouched, fingerprint scene narration, preserve full story sequence.
2. Ask AI-1/AI-2 to identify event beats and continuity across chapters. If low confidence: mark `needs-attention`; do not fabricate assets.
3. AI-3 slices at natural event boundaries, estimates speech/action overlap, targets 60 seconds per episode (soft max 65), and revises estimates after **measured** voice duration. Never truncate narration to force 65 seconds.
4. AI-4 plans shots. AI-5/6/7 generate *only supported* SVG/rig/prop assets with stable IDs and anchors; unsupported content is a dependency, not an imaginary completed image.
5. AI-8 and AI-9 create spatial and contact-aware motion plans with shared normalized/world coordinates; AI-10 creates real sound where a TTS provider is available.
6. AI-11 aligns subtitle cues and audio clips. Separate motion speed from speech speed. AI-12 checks JSON; acceptance of final video requires actual frames and audio.
7. On failure retry **the same scene/stage** using existing job checkpoints and provider backoff; never skip a scene, overwrite old lesson/model, or silently accept a malformed stage response.

Shared contracts must include `sceneId`, `episodeId`, `roleId`, `sourceHash`, `requires`, `outputType`, `status` and exact source narration. Existing handoffs must be saved before any dependent stage runs. The current `StoryProductionRoles.createPlan(project)` is **read-only** and returns `executable:false`; it makes no AWS/provider call and does not claim generated SVGs/videos.

## External AI JSON and role exercises

- `training-lab/EXTERNAL_WRITER_GUIDE_V2.json`: copy its `instructions` to an external author; to import, extract **only** `exampleImportable`, a valid Story-only JSON example with spatial/action notes.
- `training-lab/datasets/production-role-curriculum-v2.json`: twelve synthetic input/expected/acceptance examples; **test fixtures, NOT approved teaching data or trained weights**. Keep these separate from user-approved data and AWS model release pipelines.
- `training-lab/STORY_AUTHOR_PROMPT_TH.md`: full-animation author prompt remains valid; V2 Story-only guide simplifies text-first workflow.
- `docs/STORY_ONLY_JSON_TH.md`: current import limits and import workflow remain authoritative.

## Rollout checkpoints

1. Registry and Mother awareness + static validation (this PR).
2. Integrate V2 handoff executor with existing local six stages without changing V1 IDs; tests prove identical V1 exports and unchanged trained model state.
3. Implement event-based scene splitting, Story Graph and explicit transitions with reversible project edits.
4. Add independent SVG generation, validated asset/anchor interfaces and advanced motion; measure frame-level coverage.
5. Connect persistent cloud stage jobs with timeout/cost guardrails; verify audio/subtitle/full export and end-to-end MP4 QA on AWS.

**Deployment:** Changes to Lambda require normal AWS deployment; pushing code or approving this PR alone is not proof of Lambda rollout. Do not enable full auto-production before on-device and cloud tests pass.
