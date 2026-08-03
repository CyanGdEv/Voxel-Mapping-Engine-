#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
PATCH_DIR="$ROOT/patches/v0116-aerial-acquisition"
TARGET="$PATCH_DIR/v0116.patch.gz.b64"
EXPECTED_SHA="359abf50150470049941206350a0aa058a9ccb3c9b2139ddb0a51f0ff06107b9"
DIAG="$ROOT/ci-diagnostics"
mkdir -p "$DIAG"

PART_COUNT="$(find "$PATCH_DIR" -maxdepth 1 -type f -name 'part-*.b64' | wc -l | tr -d ' ')"
[[ "$PART_COUNT" == 6 ]] || {
  echo "Expected six v0.11.6 source-patch chunks, found $PART_COUNT." | tee "$DIAG/patch-error.txt" >&2
  exit 2
}

cat "$PATCH_DIR"/part-*.b64 > "$TARGET"
ACTUAL_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
printf 'expected=%s\nactual=%s\nparts=%s\n' "$EXPECTED_SHA" "$ACTUAL_SHA" "$PART_COUNT" \
  | tee "$DIAG/patch-chunk-assembly.txt"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || {
  echo "Assembled v0.11.6 source-patch checksum mismatch." >&2
  exit 2
}

exec bash "$ROOT/scripts/build-themepark-world-v0116-direct.sh"
