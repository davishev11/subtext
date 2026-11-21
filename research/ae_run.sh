#!/bin/bash
# Run an ExtendScript snippet in After Effects and print what it returns.
# Usage: ae_run.sh file.jsx   (the snippet's last expression is the result)
# Each call has its own result file: a slow script that finishes after its caller gave up must never be
# read as the answer to the next call.
OUT="$(mktemp "${TMPDIR:-/tmp}/ae_run_out.XXXXXX")"; rm -f "$OUT"
WRAP="$OUT.jsx"
{ echo 'var __r; try { __r = (function(){'; echo 'return eval('; python3 -I -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' "$1"; echo '); })(); } catch(e) { __r = "ERROR: " + e.toString() + " line " + e.line; }'
  echo "var __f = new File('$OUT'); __f.encoding='UTF-8'; __f.open('w'); __f.write(String(__r)); __f.close();"; } > "$WRAP"
osascript -e "tell application \"Adobe After Effects 2026\" to DoScriptFile (POSIX file \"$WRAP\")" >/dev/null 2>&1
for i in $(seq 1 ${AE_WAIT:-600}); do [ -f "$OUT" ] && break; sleep 0.2; done
cat "$OUT" 2>/dev/null || echo "(no result after $(( ${AE_WAIT:-600} / 5 )) s — AE busy, or 'Allow Scripts to Write Files' is off)"
rm -f "$OUT" "$WRAP"
