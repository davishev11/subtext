#!/bin/bash
# Subtext test suite. Every change must pass it before it is shown to Daria.
#   scripts/test.sh          quick: logic tests + After Effects tests (~2 min)
#   scripts/test.sh full     + the panel clicked like a person, with a real transcription (~10 min)
# Writes tests/reports/<date>_<commit>/report.md (+ frames). Exit code 1 if anything failed.
# AE tests run only when After Effects has research/out/subtext-test.aep open (they add comps
# into its "Subtext autotest" folder and never touch other projects).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-quick}"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- extension tests || echo '+changes')"
RUN="$ROOT/tests/reports/$(date +%Y-%m-%d_%H%M)_${COMMIT//+/-}"
mkdir -p "$RUN"
J=()

# 1) logic (Node)
for t in "$ROOT"/tests/*.test.js; do
  name=$(basename "$t" .test.js); out="$RUN/unit_$name.json"
  log=$(node "$t" </dev/null 2>&1); code=$?
  last=$(echo "$log" | grep -v '^\s*$' | tail -1)
  if [ $code -eq 0 ]; then ok=true; else ok=false; last=$(echo "$log" | grep -m1 -E 'AssertionError|Error' ); fi
  python3 -I -c 'import json,sys; print(json.dumps({"test": "Logic: "+sys.argv[1], "results": [{"n": "all assertions in tests/"+sys.argv[1]+".test.js", "ok": sys.argv[2]=="true", "i": sys.argv[3]}]}))' "$name" "$ok" "$last" > "$out"
  J+=("$out")
done

# 2) After Effects
OPEN=$("$ROOT/research/ae_run.sh" <(echo 'app.project.file ? app.project.file.fsName : "unsaved"') 2>/dev/null)
if [ "$OPEN" = "$ROOT/research/out/subtext-test.aep" ]; then
  for t in "$ROOT"/tests/ae/*.jsx; do
    name=$(basename "$t" .jsx); [ "$name" = "_lib" ] && continue
    tmp="$RUN/.$name.jsx"; { echo "var OUTDIR = \"$RUN\";"; cat "$t"; } > "$tmp"
    AE_WAIT=3000 "$ROOT/tests/ae/run_one.sh" "$tmp" > "$RUN/ae_$name.json"; rm -f "$tmp"
    J+=("$RUN/ae_$name.json")
  done
else
  echo "{\"test\":\"After Effects\",\"results\":[{\"n\":\"AE tests need research/out/subtext-test.aep open in After Effects\",\"ok\":false,\"i\":\"open: $OPEN\"}]}" > "$RUN/ae_skipped.json"
  J+=("$RUN/ae_skipped.json")
fi

# 3) the panel, clicked like a person
if [ "$MODE" = "full" ]; then
  node "$ROOT/tests/ui/flow.js" > "$RUN/ui_flow.json" 2>"$RUN/ui_flow.log"
  J+=("$RUN/ui_flow.json")
fi

node "$ROOT/tests/report.js" "$RUN" "$MODE" "$COMMIT" "${J[@]}"
CODE=$?
# test comps are removed when everything passed; after a failure they stay for a look
if [ $CODE -eq 0 ] && [ "$OPEN" = "$ROOT/research/out/subtext-test.aep" ]; then
  echo 'cleanup(); app.project.save(); "ok"' > "$RUN/.cleanup.jsx"; "$ROOT/tests/ae/run_one.sh" "$RUN/.cleanup.jsx" >/dev/null; rm -f "$RUN/.cleanup.jsx"
  echo "Test comps removed."
elif [ $CODE -ne 0 ]; then echo "Test comps kept in the \"Subtext autotest\" folder for a look."; fi
exit $CODE
