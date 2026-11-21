#!/bin/bash
# Runs one AE test file (tests/ae/<name>.jsx) with the shared helpers; prints its JSON result.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="${TMPDIR:-/tmp}/subtext_aetest_$$.jsx"
{ echo "var ROOT = \"$ROOT\";"; cat "$ROOT/tests/ae/_lib.jsx"; echo; cat "$1"; } > "$TMP"
"$ROOT/research/ae_run.sh" "$TMP"
rm -f "$TMP"
