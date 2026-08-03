#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
DIAG="$ROOT/ci-diagnostics"
GEN="$ROOT/generator"
OUT_REL="out/github-actions"
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

PRESET="${TPMAP_PRESET:-alton-towers}"
ACCURACY="${TPMAP_ACCURACY:-benchmark}"
WORLD_MARGIN="${TPMAP_WORLD_MARGIN:-32}"
CONTACT="${TPMAP_CONTACT:-https://github.com/${GITHUB_REPOSITORY:-CyanGdEv/Voxel-Mapping-Engine-}}"

case "$PRESET" in
  alton-towers)
    PARK_NAME="Alton Towers Resort"
    BBOX="52.9810,-1.8970,52.9960,-1.8690"
    ;;
  chessington)
    PARK_NAME="Chessington World of Adventures"
    BBOX="51.3458,-0.3228,51.3535,-0.3133"
    ;;
  custom)
    PARK_NAME="${TPMAP_PARK_NAME:-}"
    BBOX="${TPMAP_BBOX:-}"
    [[ -n "$PARK_NAME" && -n "$BBOX" ]] || { echo "Custom builds require park_name and bbox." >&2; exit 2; }
    ;;
  *) echo "Unknown preset: $PRESET" >&2; exit 2 ;;
esac

case "$ACCURACY" in
  benchmark)
    ACCURACY_MODE="plausible"
    TERRAIN_DETAIL_MODE="plausible"
    ALLOW_FALLBACK=true
    ;;
  verified)
    ACCURACY_MODE="verified"
    TERRAIN_DETAIL_MODE="evidence"
    ALLOW_FALLBACK=false
    ;;
  *) echo "Unknown accuracy: $ACCURACY" >&2; exit 2 ;;
esac

SAFE_NAME="$(printf '%s' "$PARK_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
printf 'park=%s\nbbox=%s\naccuracy=%s\n' "$PARK_NAME" "$BBOX" "$ACCURACY_MODE" | tee "$DIAG/parameters.txt"

SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.1_Aerial_Surface_Vegetation_Source.zip"
EXPECTED_SHA="cdc31ca95010458ed967c37f735a6fbf723cae230c97b85deb9a7ee620370ba6"
[[ -f "$SOURCE_ZIP" ]] || { echo "Missing source ZIP." | tee "$DIAG/source-error.txt" >&2; exit 2; }
ACTUAL_SHA="$(sha256sum "$SOURCE_ZIP" | cut -d' ' -f1)"
printf 'expected=%s\nactual=%s\n' "$EXPECTED_SHA" "$ACTUAL_SHA" | tee "$DIAG/source-checksum.txt"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || { echo "Source ZIP checksum mismatch." >&2; exit 2; }

rm -rf "$GEN"
mkdir -p "$GEN"
unzip -q "$SOURCE_ZIP" -d "$GEN"
node "$ROOT/scripts/apply-v0112-direct-world-palette-fix.mjs" "$GEN" 2>&1 | tee "$DIAG/source-patch.log"
node --check "$GEN/src/lib/mcworld.mjs" 2>&1 | tee "$DIAG/source-syntax-check.log"

(
  cd "$GEN"
  npm ci --omit=dev --no-audit --no-fund 2>&1 | tee "$DIAG/npm-ci.log"
  node --test test/appearance-vegetation.test.mjs test/direct-world-palette-compatibility.test.mjs \
    2>&1 | tee "$DIAG/compatibility-tests.log"
  node src/cli.mjs doctor 2>&1 | tee "$DIAG/doctor.log"
)

IMAGERY_ARGS=(--orthophoto-mode off --path-discovery-mode off --aerial-terrain-mode off)
if [[ -n "${TPMAP_ORTHOPHOTO_URL:-}" ]]; then
  [[ -n "${TPMAP_ORTHOPHOTO_SOURCE:-}" && -n "${TPMAP_ORTHOPHOTO_LICENSE:-}" ]] || {
    echo "Orthophoto source and licence are required." >&2
    exit 2
  }
  if ! command -v gdalinfo >/dev/null 2>&1; then
    {
      sudo apt-get update
      sudo apt-get install -y --no-install-recommends gdal-bin
    } 2>&1 | tee "$DIAG/gdal-install.log"
  fi
  mkdir -p "$GEN/data"
  curl --fail --location --retry 4 --retry-all-errors \
    --user-agent "ThemeParkMap/0.11.2 ($CONTACT)" \
    "$TPMAP_ORTHOPHOTO_URL" -o "$GEN/data/park-orthophoto.tif" \
    2>&1 | tee "$DIAG/orthophoto-download.log"
  [[ -s "$GEN/data/park-orthophoto.tif" ]]
  if [[ -n "${TPMAP_ORTHOPHOTO_SHA256:-}" ]]; then
    [[ "$(sha256sum "$GEN/data/park-orthophoto.tif" | cut -d' ' -f1)" == "$TPMAP_ORTHOPHOTO_SHA256" ]] || {
      echo "Orthophoto checksum mismatch." >&2
      exit 2
    }
  fi
  gdalinfo "$GEN/data/park-orthophoto.tif" > "$DIAG/orthophoto-gdalinfo.txt"
  IMAGERY_ARGS=(
    --orthophoto data/park-orthophoto.tif
    --orthophoto-source "$TPMAP_ORTHOPHOTO_SOURCE"
    --orthophoto-source-url "$TPMAP_ORTHOPHOTO_URL"
    --orthophoto-license "$TPMAP_ORTHOPHOTO_LICENSE"
    --orthophoto-mode evidence
    --path-discovery-mode evidence
    --aerial-terrain-mode evidence
    --aerial-terrain-grid-m 2
    --aerial-terrain-min-confidence 0.72
  )
  [[ -n "${TPMAP_ORTHOPHOTO_DATE:-}" ]] && IMAGERY_ARGS+=(--orthophoto-date "$TPMAP_ORTHOPHOTO_DATE")
else
  echo "No orthophoto supplied; native GDAL/PDAL installation skipped." | tee "$DIAG/orthophoto.txt"
fi

run_attempt() {
  local label="$1" elevation="$2" overpass="$3" dsm="$4"
  local log="$DIAG/build-$label.log"
  rm -rf "$GEN/$OUT_REL"
  mkdir -p "$GEN/$OUT_REL"
  echo "strategy=$label elevation=$elevation overpass=$overpass dsm=$dsm" | tee "$log"

  local args=(
    build
    --park-name "$PARK_NAME"
    --bbox "$BBOX"
    --contact "$CONTACT"
    --overpass-url "$overpass"
    --elevation "$elevation"
    --buildings markers
    --path-terrain-mode conform
    --terrain-detail-mode "$TERRAIN_DETAIL_MODE"
    --tree-density-per-100m2 2.8
    --shrub-density-per-100m2 16
    --tree-line-spacing-m 3
    --vegetation-min-spacing-m 3
    --max-vegetation-models 30000
    --ride-profile-mode auto
    --ride-terrain-mode inferred
    --accuracy-mode "$ACCURACY_MODE"
    --palette realistic
    --world-margin "$WORLD_MARGIN"
    --allow-large-area
    --max-area-km2 12
    --max-cells 8000000
    --max-world-chunks 20000
    --no-addon
    --out "$OUT_REL"
    "${IMAGERY_ARGS[@]}"
  )
  [[ "$dsm" == off ]] && args+=(--no-dsm)

  local status
  if (cd "$GEN" && node src/cli.mjs "${args[@]}") 2>&1 | tee -a "$log"; then
    status=0
  else
    status=${PIPESTATUS[0]}
  fi
  echo "exit_status=$status" | tee -a "$log"
  [[ $status -eq 0 ]] || return $status

  MCWORLD="$(find "$GEN/$OUT_REL" -maxdepth 1 -type f -name '*_1to1.mcworld' -print -quit)"
  [[ -n "$MCWORLD" ]] || { echo "No .mcworld produced." | tee -a "$log"; return 3; }
  cp "$log" "$GEN/$OUT_REL/build.log"
  printf '{"strategy":"%s","elevation":"%s","overpass":"%s","dsm":"%s"}\n' \
    "$label" "$elevation" "$overpass" "$dsm" > "$GEN/$OUT_REL/build-strategy.json"
  SUCCESS_STRATEGY="$label"
  return 0
}

PRIMARY="https://overpass-api.de/api/interpreter"
ALTERNATE="https://overpass.kumi.systems/api/interpreter"
SUCCESS_STRATEGY=""
MCWORLD=""

if run_attempt 01-ea-full-primary ea-lidar "$PRIMARY" on; then :
elif ! $ALLOW_FALLBACK; then echo "Verified mode refuses source fallback." >&2; exit 2
elif run_attempt 02-ea-dtm-alternate ea-lidar "$ALTERNATE" off; then :
elif run_attempt 03-flat-alternate none "$ALTERNATE" off; then :
else echo "All build strategies failed." >&2; exit 2
fi

unzip -t "$MCWORLD" | tee "$DIAG/world-zip-validation.log"
ARCHIVE_LIST="$DIAG/world-archive-list.txt"
unzip -Z1 "$MCWORLD" > "$ARCHIVE_LIST"
for required in level.dat levelname.txt db/CURRENT; do
  grep -Fxq "$required" "$ARCHIVE_LIST" || { echo "Missing $required" >&2; exit 4; }
done
MANIFEST="$(unzip -p "$MCWORLD" db/CURRENT | tr -d '\r\n')"
[[ -n "$MANIFEST" ]] && grep -Fxq "db/$MANIFEST" "$ARCHIVE_LIST"

WORLD_SHA="$(sha256sum "$MCWORLD" | cut -d' ' -f1)"
WORLD_BYTES="$(stat -c '%s' "$MCWORLD")"
VALIDATION_PATH="$GEN/$OUT_REL/independent-validation.json"
node --input-type=module - "$VALIDATION_PATH" "$SUCCESS_STRATEGY" "$(basename "$MCWORLD")" "$WORLD_SHA" "$WORLD_BYTES" <<'NODE'
import { writeFileSync } from 'node:fs';
const [, , output, strategy, filename, sha256, bytes] = process.argv;
writeFileSync(output, JSON.stringify({
  schemaVersion: 2,
  status: 'passed',
  strategy,
  world: { filename, sha256, bytes: Number(bytes) }
}, null, 2) + '\n');
NODE

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "mcworld=$MCWORLD" >> "$GITHUB_OUTPUT"
  echo "strategy=$SUCCESS_STRATEGY" >> "$GITHUB_OUTPUT"
  echo "safe_name=$SAFE_NAME" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "MCWORLD=$MCWORLD" >> "$GITHUB_ENV"
fi

echo "Generated $(basename "$MCWORLD") using $SUCCESS_STRATEGY"
