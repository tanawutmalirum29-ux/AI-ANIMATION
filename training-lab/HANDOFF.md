# AI-ANIMATION · Training handoff

## Goal / constraints

Continue improving the EXISTING Story Studio, not creating a new AI product.
No paid LLM API; no GPU requirement on the user's phone; do not assume Qwen or
LoRA can be served. Preserve the six production helpers and their existing
deterministic renderer, narration, timing, JSON schema and QA.

## Current verified status

- `studio-production-planner.js`: AI-1 layout, AI-2 constrained SVG templates,
  AI-3 basic motion use deterministic rules, not pretrained neural models.
- `studio-ai-workspace.js`: AI-4 narration, AI-5 timing and AI-6 structural QA.
- `studio-layout-ml.js`: opt-in numeric-only layout feedback and tiny inference
  adapter. No automatic model deployment.
- `training-lab/train-layout.py`: dependency-free CPU SGD adjusts weights
  **on synthetic demo examples**; human-approved mode is blocked until enough
  real reviewed records exist.
- `training-lab/datasets/approved/`: no real approved numeric data has been
  submitted as of 2026-11-01. Never invent approved labels or mix demo samples
  into this folder.
- `training-lab/prepare-layout-data.py`: manual JSONL assembly, deduplication,
  label conflict detection and readiness report. No automatic network upload.
- `.github/workflows/cpu-layout-ml.yml`: experimental training CI / manual run.
  It never pushes weights to production.

## Next training loop

1. In the web editor, open **AI Production → ML Lab** and explicitly approve
   genuinely good actor placements or human-corrected cramped placements.
2. Review each downloaded numeric JSONL file (no names, scripts or private text).
3. Combine sample files locally:
   `python3 training-lab/prepare-layout-data.py --input a.jsonl b.jsonl --out reviewed.jsonl`
4. Seek >=60 independent samples from >=5 distinct story groups, with both
   keep/separate labels and no duplicates. Structural readiness is not proof
   of quality. Hold out entire stories and verify real exported videos.
5. Only after informed consent to PUBLIC repository upload, supply reviewed
   numeric examples at `training-lab/datasets/approved/layout-spacing.jsonl`.
   Otherwise keep data private and use the trainer locally.
6. Run `python3 training-lab/train-layout.py --mode approved --data PATH --out MODEL`
   or the opt-in GitHub Action. Review holdout accuracy/macro-F1 versus baseline.
7. Human approval and an independent regression suite are required before
   any candidate serves as read-only advice. Never enable auto-edit without
   explicit approval and tested rollback.

## Work priorities

1. Collect genuinely approved labels and improve data quality, **not volume
   of repeated exports**.
2. Fix observed production/visual/audio regressions with tests and auditable
   evidence (see `training-lab/evaluations/`).
3. Promote CPU ML only if it improves unseen-story QA over deterministic rules.
4. Expand to motion/SVG advisory models once actor-layout learning is validated.
5. Retain LoRA/QLoRA solely as a future option if both GPU and inference budgets
   exist; an adapter alone cannot run without its base LLM.

Do not report fake training success, fabricate dataset examples, promise
continuous self-learning, or silently deploy model weights. Changes in GitHub
must be backed by actual commits, CI results, and measurable evaluation.


## Latest handoff — 2026-11-01, three exported episodes

Review: `training-lab/evaluations/three-flashes-nov1-exports-v4.json`.
The three MP4s have full AAC audio tracks and short <=1.22s low-level audio
regions, but visible actor overlap persists through episodes 2/3 and episode
1 has largely static shots. The current fix upgrades **deterministic** AI-1
composition to separate up to 3+ unanchored actors by a portrait-safe 24%
starting X gap while retaining basic toX travel displacement, explicit locks,
routes and intentional contact. This does **not** add approved training labels,
fine-tune any model, or guarantee the new render is free of overlap.
Do not touch story meaning or uploaded original JSON to hide engine faults.
Next inspect fresh exports after re-running the six-step producer; continue
implementing real prop/state transitions for blackout, notebook, wrench transfer
only against supported rendering primitives and regressions.


## Combined export follow-up (2026-11-01)

User provided a 117.407s compiled H.264/AAC export. Chapter divider cards
are intentional (2.5s each), with ~3.63s low-level audio intervals including
their surrounding quiet tails. Visible issues remain: static workshop pose,
actor crowding and occasional overlapping arms. See
`training-lab/evaluations/three-flashes-nov1-compiled-export.json`.

A concrete **filename** bug was confirmed: Thai combining marks were excluded
by a Unicode name sanitizer. `exportFilePrefix()` now retains Unicode marks
and all title-derived export names share this helper (individual episodes,
joined MP4, ZIP). The currently attached combined MP4 was renamed for download
without reencoding. Keep chapter dividers; further image/motion improvements
need correct labeled examples and independent visual QA. No neural weights
were trained from this export.


## Arrival-gap fix (2026-11-01)

AI-1 composition now also separates the ARRIVAL position of authored `toX`
travel (start gaps keep priority) and warns on crossing paths. See
`training-lab/evaluations/three-flashes-nov1-arrival-gap-fix.json`. s07 of the
uploaded story still needs human review (Moss stands on the run path). No ML
training was possible: zero approved labels.
