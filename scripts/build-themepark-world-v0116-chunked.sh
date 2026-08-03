#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
BASE_SCRIPT="$ROOT/scripts/build-themepark-world-v0116-direct.sh"
RUNTIME_SCRIPT="${RUNNER_TEMP:-/tmp}/build-themepark-world-v0116-standalone-runtime.sh"

[[ -f "$BASE_SCRIPT" ]] || {
  echo "Missing v0.11.6 build driver." >&2
  exit 2
}

python3 - "$BASE_SCRIPT" "$RUNTIME_SCRIPT" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
text = source.read_text(encoding="utf-8")

replacements = {
    'SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.5_Path_Phase2B_WholePark_Source.zip"':
        'SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.6_Aerial_Acquisition_Phase2C_Source.zip"',
    'EXPECTED_SOURCE_SHA="d8c344c4e777264ea4597b8a154c064159f9a3daec6f4b894c272247f6ec1180"':
        'EXPECTED_SOURCE_SHA="ffa5d243762e1fb5eb8ee5ecf19cec8bc9169b02f1b9c264692f60044855dc12"',
    'source=v0.11.5-plus-v0.11.6-checksum-patch':
        'source=v0.11.6-standalone-checksum-archive',
    'Missing checksum-locked ThemePark Map v0.11.5 source ZIP.':
        'Missing checksum-locked ThemePark Map v0.11.6 source ZIP.',
    'v0.11.5 source ZIP checksum mismatch.':
        'v0.11.6 source ZIP checksum mismatch.',
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"Could not locate expected v0.11.6 launcher text: {old}")
    text = text.replace(old, new, 1)

start_marker = '[[ -f "$PATCH_B64" ]] || { echo "Missing v0.11.6 source patch."'
end_marker = 'patch -d "$GEN" -p1 --batch --forward < "$PATCH_FILE" 2>&1 | tee "$DIAG/v0116-source-patch.log"\n'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Could not locate the obsolete v0.11.6 patch bootstrap")
end += len(end_marker)

standalone_block = "printf 'standalone_source=true\\npatch_applied=false\\n' | tee \"$DIAG/v0116-source-mode.txt\"\n"
text = text[:start] + standalone_block + text[end:]

target.write_text(text, encoding="utf-8")
target.chmod(0o755)
PY

bash -n "$RUNTIME_SCRIPT"
exec bash "$RUNTIME_SCRIPT"
