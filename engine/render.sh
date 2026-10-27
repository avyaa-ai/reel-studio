#!/usr/bin/env bash
# Reel Studio - render a spec to MP4 and score it.
#   bash engine/render.sh specs/<id>.json [draft|delivery]
# Steps: validate + build -> HyperFrames render -> quality score.
# Output: exports/<id>.mp4 and work/<id>/score.json (exit code 1 if NOT READY).
set -euo pipefail
SPEC="${1:?usage: bash engine/render.sh specs/<id>.json [draft|delivery]}"
QUALITY="${2:-delivery}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HF="$ROOT/engine/node_modules/.bin/hyperframes"
ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$SPEC")"

node engine/build.mjs "$SPEC"
"$HF" render "work/$ID" -o "exports/$ID.mp4" --fps 30 --quality "$QUALITY" --quiet
echo "Rendered exports/$ID.mp4"
python3 tools/score_video.py "exports/$ID.mp4" --json "work/$ID/score.json"
