#!/bin/bash
# Builds dist/Subtext-<version>.dmg: open it, drag the Subtext folder onto the Adobe extensions folder, done.
# Nothing in the DMG has to be run, so macOS has nothing to block (no Apple developer certificate needed).
# The panel itself makes a clean copy of whisper-cli on first use (see whisperBin in engine.js).
#   WHISPER_BIN  static arm64 whisper-cli (default: ~/claude_work/tools/build/whisper.cpp/build-static/bin/whisper-cli)
#   SIGN_DIR     folder with ZXPSignCmd and subtext-cert/{subtext.p12,password.txt}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$ROOT/extension/CSXS/manifest.xml")"
WHISPER_BIN="${WHISPER_BIN:-$HOME/claude_work/tools/build/whisper.cpp/build-static/bin/whisper-cli}"
SIGN_DIR="${SIGN_DIR:-$HOME/claude_work/tools/adobe-cep}"
STAGE="$ROOT/dist/stage/com.dariashevchenko.subtext"
OUT="$ROOT/dist/Subtext-$VERSION"

echo "→ tests"; node "$ROOT/tests/lines.test.js" | tail -1
rm -rf "$ROOT/dist"; mkdir -p "$STAGE" "$OUT"
echo "→ stage"
rsync -a --exclude '.DS_Store' --exclude 'bin/*' --exclude '.debug' "$ROOT/extension/" "$STAGE/"
mkdir -p "$STAGE/bin"; cp "$WHISPER_BIN" "$STAGE/bin/whisper-cli"; chmod 755 "$STAGE/bin/whisper-cli"
file "$STAGE/bin/whisper-cli" | grep -q arm64 || { echo "whisper-cli is not arm64"; exit 1; }
if otool -L "$STAGE/bin/whisper-cli" | grep -q /opt/homebrew; then echo "whisper-cli links Homebrew libraries"; exit 1; fi
if [ -n "$(find "$STAGE" -type l)" ]; then echo "symlinks break ZXP signatures"; exit 1; fi
echo "→ sign"
"$SIGN_DIR/ZXPSignCmd" -sign "$STAGE" "$OUT/Subtext.zxp" "$SIGN_DIR/subtext-cert/subtext.p12" "$(cat "$SIGN_DIR/subtext-cert/password.txt")" -tsa http://timestamp.digicert.com
"$SIGN_DIR/ZXPSignCmd" -verify "$OUT/Subtext.zxp" | tail -1
echo "→ dmg"
DMG_DIR="$ROOT/dist/dmg"; mkdir -p "$DMG_DIR/Subtext"
ditto -x -k "$OUT/Subtext.zxp" "$DMG_DIR/Subtext"          # the signed extension, as After Effects loads it
chmod 755 "$DMG_DIR/Subtext/bin/whisper-cli"
ln -s "/Library/Application Support/Adobe/CEP/extensions" "$DMG_DIR/Drag Subtext here"
cat > "$DMG_DIR/How to install.txt" <<TXT
Subtext $VERSION — auto captions for After Effects (macOS, Apple Silicon)

1. Quit After Effects.
2. Drag the "Subtext" folder onto "Drag Subtext here".
   macOS asks for your Mac password once: the folder goes to
   /Library/Application Support/Adobe/CEP/extensions
3. Open After Effects → Window → Extensions → Subtext.
4. On first launch the panel offers to download a speech model (≈1.5 GB, once).

To update: drag the new Subtext folder the same way and choose Replace.
To remove: delete the Subtext folder from that extensions folder.

Guide and source: https://github.com/davishev11/subtext
TXT
hdiutil create -volname "Subtext $VERSION" -srcfolder "$DMG_DIR" -ov -format UDZO "$ROOT/dist/Subtext-$VERSION.dmg" >/dev/null
rm -rf "$ROOT/dist/stage" "$DMG_DIR"
echo "✓ dist/Subtext-$VERSION.dmg ($(du -h "$ROOT/dist/Subtext-$VERSION.dmg" | cut -f1))"
