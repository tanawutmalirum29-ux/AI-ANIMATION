# Story Training Lab — Validation

## Run locally (Node 18+)
```sh
node training-lab/validate-story.cjs "your-story.json"
node training-lab/validate-story.test.cjs
```

Exit code 0 means **static structural checks passed**, not that the animation renders correctly. JSON can contain 60 seconds of declared scene duration while recorded narration lasts a different amount. This validator never estimates speech duration from text or fabricates audio measurements.

## Review gates
1. **Static QA:** valid JSON, unique scene/episode IDs, references, positive scene durations and valid subtitle cue bounds.
2. **Import QA:** import into Story Studio and check runtime warnings/unsupported poses.
3. **Narration QA:** generate/record narrator audio, measure actual duration, align captions and remove post-voice padding.
4. **Visual QA:** inspect actual scene playback for continuity, layering and camera problems.
5. **Human approval:** only approved corrections become training labels.

The original story is owned/approved by the user. Do not silently rewrite it. Never train/evaluate on scenes from the same story across different splits.
