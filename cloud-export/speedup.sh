#!/usr/bin/env bash
# One-time fast setup for an EXISTING AWS CodeBuild cloud render project.
# Run in AWS CloudShell from the repository after pulling main.
set -euo pipefail
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-southeast-2}}"
PROJECT="${STORY_STUDIO_RENDER_PROJECT:-story-studio-cloud-render}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [[ "$(aws codebuild batch-get-projects --region "$REGION" --names "$PROJECT" --query 'projects[0].name' --output text)" != "$PROJECT" ]]; then
 echo "Render project $PROJECT not found in $REGION. Run cloud-export/deploy.sh first." >&2
 exit 1
fi
python3 - "$ROOT/cloud-export/buildspec.yml" "$TMP" <<'PY'
import json,sys
spec=open(sys.argv[1],encoding="utf-8").read()
json.dump({"type":"NO_SOURCE","buildspec":spec},open(sys.argv[2],"w"))
PY
echo "Applying reuse-cache and faster Chromium bootstrap to existing CodeBuild project..."
aws codebuild update-project --region "$REGION" --name "$PROJECT" \
  --source "file://$TMP" \
  --cache '{"type":"LOCAL","modes":["LOCAL_CUSTOM_CACHE"]}' \
  --query 'project.[name,cache.type]' --output text
echo "Done. New render jobs use cached Playwright/Chromium when AWS reuses a build host."
echo "Local cache is best-effort. Existing running jobs remain unchanged."
