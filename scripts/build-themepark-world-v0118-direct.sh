#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
DIAG="$ROOT/ci-diagnostics"
mkdir -p "$DIAG"

on_error() {
  local status=$?
  {
    echo "exit_status=$status"
    echo "line=${BASH_LINENO[0]:-unknown}"
    echo "command=${BASH_COMMAND:-unknown}"
  } > "$DIAG/fatal-error.log"
  exit "$status"
}
trap on_error ERR

BASE_SCRIPT="$ROOT/scripts/build-themepark-world-v0116-direct.sh"
PATCH_117_B64="$ROOT/patches/v0117-ea-wfs-namespace/v0117.patch.gz.b64"
PATCH_118_B64="$ROOT/patches/v0118-ea-coverage-metadata/v0118.patch.gz.b64"
PATCH_117_FILE="${RUNNER_TEMP:-/tmp}/v0117-ea-wfs-namespace.patch"
PATCH_118_FILE="${RUNNER_TEMP:-/tmp}/v0118-ea-coverage-metadata.patch"
RUNTIME_SCRIPT="${RUNNER_TEMP:-/tmp}/build-themepark-world-v0118-runtime.sh"
EXPECTED_117_B64_SHA="6317a7c50630da74eb196b6b025b30c20d18f79897a95d5d1a1d9607fba9c240"
EXPECTED_117_PATCH_SHA="505f3d2bb50024f78cba5c6217ba6ee6c3b46aeec45d387385186c1e7c9824b8"
EXPECTED_118_B64_SHA="df0f74cf212a15e6cea2acb24c19c632730d34235998852ed7c268a0d7823625"
EXPECTED_118_PATCH_SHA="cab5f8f13f424a4c2adf628c1ca4019e430bcd9dce732183d24ae324d2b757de"

[[ -f "$BASE_SCRIPT" ]] || { echo "Missing v0.11.6 build driver." >&2; exit 2; }
[[ -f "$PATCH_117_B64" ]] || { echo "Missing v0.11.7 namespace patch." >&2; exit 2; }
[[ -f "$PATCH_118_B64" ]] || { echo "Missing v0.11.8 coverage-metadata patch." >&2; exit 2; }

ACTUAL_117_B64_SHA="$(sha256sum "$PATCH_117_B64" | cut -d' ' -f1)"
ACTUAL_118_B64_SHA="$(sha256sum "$PATCH_118_B64" | cut -d' ' -f1)"
[[ "$ACTUAL_117_B64_SHA" == "$EXPECTED_117_B64_SHA" ]] || { echo "v0.11.7 encoded patch checksum mismatch." >&2; exit 2; }
[[ "$ACTUAL_118_B64_SHA" == "$EXPECTED_118_B64_SHA" ]] || { echo "v0.11.8 encoded patch checksum mismatch." >&2; exit 2; }
base64 -d "$PATCH_117_B64" | gzip -dc > "$PATCH_117_FILE"
base64 -d "$PATCH_118_B64" | gzip -dc > "$PATCH_118_FILE"
ACTUAL_117_PATCH_SHA="$(sha256sum "$PATCH_117_FILE" | cut -d' ' -f1)"
ACTUAL_118_PATCH_SHA="$(sha256sum "$PATCH_118_FILE" | cut -d' ' -f1)"
[[ "$ACTUAL_117_PATCH_SHA" == "$EXPECTED_117_PATCH_SHA" ]] || { echo "v0.11.7 decoded patch checksum mismatch." >&2; exit 2; }
[[ "$ACTUAL_118_PATCH_SHA" == "$EXPECTED_118_PATCH_SHA" ]] || { echo "v0.11.8 decoded patch checksum mismatch." >&2; exit 2; }

python3 - "$BASE_SCRIPT" "$RUNTIME_SCRIPT" "$PATCH_117_FILE" "$PATCH_118_FILE" \
  "$EXPECTED_117_B64_SHA" "$ACTUAL_117_B64_SHA" "$EXPECTED_117_PATCH_SHA" "$ACTUAL_117_PATCH_SHA" \
  "$EXPECTED_118_B64_SHA" "$ACTUAL_118_B64_SHA" "$EXPECTED_118_PATCH_SHA" "$ACTUAL_118_PATCH_SHA" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
patch117 = Path(sys.argv[3])
patch118 = Path(sys.argv[4])
checks = sys.argv[5:13]
text = source.read_text(encoding="utf-8")

replacements = {
    'SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.5_Path_Phase2B_WholePark_Source.zip"':
        'SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.6_Aerial_Acquisition_Phase2C_Source.zip"',
    'EXPECTED_SOURCE_SHA="d8c344c4e777264ea4597b8a154c064159f9a3daec6f4b894c272247f6ec1180"':
        'EXPECTED_SOURCE_SHA="ffa5d243762e1fb5eb8ee5ecf19cec8bc9169b02f1b9c264692f60044855dc12"',
    'source=v0.11.5-plus-v0.11.6-checksum-patch':
        'source=v0.11.8-ea-coverage-metadata-recovery',
    'Missing checksum-locked ThemePark Map v0.11.5 source ZIP.':
        'Missing checksum-locked ThemePark Map v0.11.6 source ZIP.',
    'v0.11.5 source ZIP checksum mismatch.':
        'v0.11.6 source ZIP checksum mismatch.',
    "if (pkg.version !== '0.11.6') throw new Error(`Expected v0.11.6, got ${pkg.version}`);":
        "if (pkg.version !== '0.11.8') throw new Error(`Expected v0.11.8, got ${pkg.version}`);",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"Could not locate expected launcher text: {old}")
    text = text.replace(old, new, 1)

start_marker = '[[ -f "$PATCH_B64" ]] || { echo "Missing v0.11.6 source patch."'
end_marker = 'patch -d "$GEN" -p1 --batch --forward < "$PATCH_FILE" 2>&1 | tee "$DIAG/v0116-source-patch.log"\n'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("Could not locate obsolete v0.11.6 patch bootstrap")
end += len(end_marker)
text = text[:start] + text[end:]

unzip_marker = 'unzip -q "$SOURCE_ZIP" -d "$GEN"\n'
if unzip_marker not in text:
    raise SystemExit("Could not locate source extraction marker")
(e117, a117, d117, ad117, e118, a118, d118, ad118) = checks
patch_commands = (
    unzip_marker
    + f'printf "encoded_expected=%s\\nencoded_actual=%s\\ndecoded_expected=%s\\ndecoded_actual=%s\\n" '
      f'"{e117}" "{a117}" "{d117}" "{ad117}" | tee "$DIAG/v0117-patch-checksum.txt"\n'
    + f'patch -d "$GEN" -p1 --batch --forward < "{patch117}" 2>&1 | tee "$DIAG/v0117-source-patch.log"\n'
    + f'printf "encoded_expected=%s\\nencoded_actual=%s\\ndecoded_expected=%s\\ndecoded_actual=%s\\n" '
      f'"{e118}" "{a118}" "{d118}" "{ad118}" | tee "$DIAG/v0118-patch-checksum.txt"\n'
    + f'patch -d "$GEN" -p1 --batch --forward < "{patch118}" 2>&1 | tee "$DIAG/v0118-source-patch.log"\n'
)
text = text.replace(unzip_marker, patch_commands, 1)

target.write_text(text, encoding="utf-8")
target.chmod(0o755)
PY

bash -n "$RUNTIME_SCRIPT"
exec bash "$RUNTIME_SCRIPT"
