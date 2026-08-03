#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
BASE_SCRIPT="$ROOT/scripts/build-themepark-world-v0113.sh"
RUNTIME_SCRIPT="$RUNNER_TEMP/build-themepark-world-v0113-direct-runtime.sh"

[[ -f "$BASE_SCRIPT" ]] || { echo "Missing base v0.11.3 build driver." >&2; exit 2; }

python3 - "$BASE_SCRIPT" "$RUNTIME_SCRIPT" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
text = source.read_text(encoding="utf-8")

start_marker = 'SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.1_Aerial_Surface_Vegetation_Source.zip"'
end_marker = '\n(\n  cd "$GEN"'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Could not locate the legacy source-bootstrap section")

replacement = r'''SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.3_Path_Geometry_Phase1_Source.zip"
EXPECTED_SHA="4df978ef814084d2b7c72c13c11981ec377bb27baef22dacdc0c0249e7f0ae0b"
[[ -f "$SOURCE_ZIP" ]] || {
  echo "Missing ThemePark Map v0.11.3 source ZIP." | tee "$DIAG/source-error.txt" >&2
  exit 2
}
ACTUAL_SHA="$(sha256sum "$SOURCE_ZIP" | cut -d' ' -f1)"
printf 'expected=%s\nactual=%s\nsource=%s\n' "$EXPECTED_SHA" "$ACTUAL_SHA" "$(basename "$SOURCE_ZIP")" \
  | tee "$DIAG/source-checksum.txt"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || {
  echo "v0.11.3 source ZIP checksum mismatch." >&2
  exit 2
}

rm -rf "$GEN"
mkdir -p "$GEN"
unzip -q "$SOURCE_ZIP" -d "$GEN"

node --check "$GEN/src/lib/mcworld.mjs" 2>&1 | tee "$DIAG/source-syntax-check.log"
node --check "$GEN/src/lib/path-geometry.mjs" 2>&1 | tee -a "$DIAG/source-syntax-check.log"
node --input-type=module - "$GEN/package.json" <<'NODE' 2>&1 | tee "$DIAG/version-check.log"
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const pkg = JSON.parse(readFileSync(file, 'utf8'));
if (pkg.version !== '0.11.3') throw new Error(`Expected v0.11.3, got ${pkg.version}`);
console.log(`ThemePark Map source version ${pkg.version}`);
NODE
'''

target.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
target.chmod(0o755)
PY

bash -n "$RUNTIME_SCRIPT"
exec bash "$RUNTIME_SCRIPT"
