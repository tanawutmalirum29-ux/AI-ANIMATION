# CPU-first ML Roadmap — AI-ANIMATION

**Current mode: experimental only / no production inference / no GPU or paid API.**

### Why

LoRA/QLoRA training uses a base language model during inference. A small adapter alone cannot turn a phone into an LLM server. Keep LoRA as a future research track. For now, let a CPU-sized statistical model offer bounded advice to the existing deterministic six-stage pipeline. It is not a general scene understanding or SVG-generating model.

### Implemented starter pipeline

1. Studio → AI Production → **ML Lab**: explicitly approve a valid actor-pair layout, or a recently manually corrected actor separation. Each click downloads **one** `.jsonl` example with eight normalized numeric features, project-group opaque ID and one human-approved label; NO voice, image, text, scene contents or automatic network upload.
2. Review the files before adding them to `training-lab/datasets/approved/layout-spacing.jsonl` in the **public** repository. Explicit manual upload is required; by default no human examples are stored here.
3. Run the GitHub Action **CPU Layout ML (experimental)** via `workflow_dispatch`. `mode=demo` uses deterministic synthetic samples ONLY to validate the training machinery. `mode=approved` requires real approved data with >=60 rows, >=5 distinct story groups, train >=35, holdout >=15 and both labels in each split.
4. Training uses a zero-dependency CPU SGD **logistic regression classifier** (not scikit-learn's SGDClassifier, and not LoRA). It actually adjusts numerical model weights, checks a group holdout split to avoid same-story leakage, and reports accuracy + macro-F1 compared to a fixed baseline. Only a model reaching at least 0.70 macro-F1, >= baseline + .02 and accuracy >= baseline gets status `candidate-review`.
5. Every workflow returns **an artifact to inspect**, never pushes model weights to `main`, never updates production, and never enables autonomous training. Synthetic/demo output is clearly labeled `demo-only`, training failures are `rejected`; both are barred from serving.
6. Later, only with user approval and real unseen-story QA, a verified candidate may be manually deployed as read-only advice via `studio-layout-ml.js`. Existing six-stage production always stays the default, with rollback and regression CI before any model affects edits.

### Exact bounded task

The first model estimates whether two existing character positions need additional separation. This is NOT a compositor, story writer, audio generator, SVG illustrator or general natural language model. Normalized features: x/y separation, aspect ratio, actor count, movement flag, declared interactions, locks, distance from edge. The model is tiny enough to evaluate in plain JavaScript on a low-powered device. Nothing runs in the background.

### Run

```sh
node tests/layout-ml-contract.test.cjs
python3 training-lab/test-layout-ml.py
python3 training-lab/train-layout.py --mode demo --out /tmp/layout-demo.json
# Approved mode is intentionally unavailable until real samples exist:
python3 training-lab/train-layout.py --mode approved \
  --data training-lab/datasets/approved/layout-spacing.jsonl \
  --out /tmp/layout-candidate.json
```

### Safe operating rules

- **Human review is mandatory.** A successful export is not automatic permission to train; an output from the current six rules is not valid ground truth unless a person approves it.
- **Privacy:** exported rows contain numeric fields and an opaque group key; do not auto-sync them. GitHub is public: upload only after reviewing rows and accepting that the data is shared.
- **Evaluation:** never randomly split rows from the same story between train and holdout. Record model/baseline performance from unseen story groups, not just training accuracy.
- **Release:** no model is promoted because an Action completes. Maintain explicit human approval, deterministic fallback and rollback. Do not silently relabel demo examples as real.
- **Cost:** GitHub standard runner on a PUBLIC repository can run this CPU job under the GitHub usage policy. Avoid GitHub GPU larger runners, hosted LLM inference and new AWS compute.
