# Approved layout labels only

Collect ONLY human-reviewed .jsonl rows from AI Production → ML Lab. One row per approved example. The row must have exactly: `schema, task, approved, source, group, label, features`. No prompt text, user name, video, audio, notes, credentials or original story content.

Combine reviewed rows into `layout-spacing.jsonl` only if you explicitly consent to sharing those anonymous numeric labels on this **public repository**. Keep complete projects and private labels off GitHub. A model cannot train usefully from one story: wait until at least 60 genuine approved examples covering 5 distinct story groups with both labels.

A `keep` label is a verified good placement. `separate` comes from a verified manual correction that increases two characters' separation. The current schema does not train freehand SVG or natural-language understanding.

The repository does not contain genuine human-approved training examples yet. It must NOT be populated with synthetic demo samples under this directory.
