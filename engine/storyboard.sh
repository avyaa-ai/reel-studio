#!/usr/bin/env bash
# Reel Studio - storyboard for human approval (no full render needed).
#   bash engine/storyboard.sh specs/<id>.json
# Builds the composition, captures one still per beat, and writes
#   work/<id>/storyboard/contact-sheet.jpg   <- share this for approval
set -euo pipefail
SPEC="${1:?usage: bash engine/storyboard.sh specs/<id>.json}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HF="$ROOT/engine/node_modules/.bin/hyperframes"
ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$SPEC")"

node engine/build.mjs "$SPEC"
AT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).map(b=>b.at).join(","))' "work/$ID/storyboard.json")"
"$HF" snapshot "work/$ID" --at "$AT" --no-end -o "work/$ID/storyboard"
echo
echo "Storyboard: work/$ID/storyboard/contact-sheet.jpg  (one frame per beat, in order)"
echo "Send it for approval, then record the approval in the spec under approvals.storyboard."
