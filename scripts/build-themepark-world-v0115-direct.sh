#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
BASE_LAUNCHER="$ROOT/scripts/build-themepark-world-v0114-direct.sh"
PATCHED_LAUNCHER="$RUNNER_TEMP/build-themepark-world-v0115-launcher.sh"

[[ -f "$BASE_LAUNCHER" ]] || {
  echo "Missing v0.11.4 direct build launcher." >&2
  exit 2
}

python3 - "$BASE_LAUNCHER" "$PATCHED_LAUNCHER" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
text = source.read_text(encoding="utf-8")
needle = 'exec bash "$RUNTIME_SCRIPT"\n'
if needle not in text:
    raise SystemExit("Could not locate the v0.11.4 runtime launch point")

injection = r"""python3 - "$RUNTIME_SCRIPT" <<'PY_RUNTIME'
from pathlib import Path
import sys

runtime = Path(sys.argv[1])
text = runtime.read_text(encoding="utf-8")

syntax_marker = 'node --check "$GEN/src/lib/mcworld.mjs"'
if syntax_marker not in text:
    raise SystemExit("Could not locate the v0.11.4 source validation stage")

patch_block = r'''PATCH_B64="$ROOT/patches/v0115-path-phase2b/v0115.patch.gz.b64"
PATCH_FILE="$DIAG/v0115-path-phase2b.patch"
[[ -f "$PATCH_B64" ]] || { echo "Missing v0.11.5 source patch." >&2; exit 2; }
[[ "$(sha256sum "$PATCH_B64" | cut -d' ' -f1)" == "200039c67938281f5c2ba5e1278a3fc16a5a03b13d3fca8d1fef0cc33af8e650" ]] || {
  echo "v0.11.5 encoded patch checksum mismatch." >&2
  exit 2
}
base64 -d "$PATCH_B64" | gzip -dc > "$PATCH_FILE"
[[ "$(sha256sum "$PATCH_FILE" | cut -d' ' -f1)" == "28debe68a141cddd21dfa676f4c0d03f7a1728a7fb84d4dd4ebca8640ebd9de2" ]] || {
  echo "v0.11.5 decoded patch checksum mismatch." >&2
  exit 2
}
patch -d "$GEN" -p1 --batch --forward < "$PATCH_FILE" \
  2>&1 | tee "$DIAG/v0115-source-patch.log"

'''
text = text.replace(syntax_marker, patch_block + syntax_marker, 1)

text = text.replace("pkg.version !== '0.11.4'", "pkg.version !== '0.11.5'", 1)
text = text.replace('Expected v0.11.4, got', 'Expected v0.11.5, got', 1)
text = text.replace('ThemeParkMap/0.11.4', 'ThemeParkMap/0.11.5')

old_test = '    test/path-geometry.test.mjs \\\n'
new_test = old_test + '    test/path-topology-whole-park.test.mjs \\\n'
if old_test not in text:
    raise SystemExit("Could not locate the focused path test list")
text = text.replace(old_test, new_test, 1)

if '--path-edge-mode evidence' not in text:
    raise SystemExit("Could not locate the path edge build option")
text = text.replace(
    '--path-edge-mode evidence',
    '--path-edge-mode off\n'
    '    --path-discovery-scope whole-park\n'
    '    --path-discovery-independent-pixel-confidence 0.78\n'
    '    --path-discovery-independent-min-confidence 0.86\n'
    '    --path-discovery-independent-min-area-m2 28\n'
    '    --path-discovery-independent-max-anchor-distance-m 42',
    1,
)

runtime.write_text(text, encoding="utf-8")
PY_RUNTIME

bash -n "$RUNTIME_SCRIPT"
exec bash "$RUNTIME_SCRIPT"
"""

target.write_text(text.replace(needle, injection, 1), encoding="utf-8")
target.chmod(0o755)
PY

bash -n "$PATCHED_LAUNCHER"
exec bash "$PATCHED_LAUNCHER"
