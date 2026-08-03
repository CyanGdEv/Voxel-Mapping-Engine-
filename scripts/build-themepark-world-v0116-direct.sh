#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(pwd)"
DIAG="$ROOT/ci-diagnostics"
GEN="$ROOT/generator"
OUT_REL="out/github-actions"
SOURCE_ZIP="$ROOT/ThemePark_Map_v0.11.5_Path_Phase2B_WholePark_Source.zip"
EXPECTED_SOURCE_SHA="d8c344c4e777264ea4597b8a154c064159f9a3daec6f4b894c272247f6ec1180"
PATCH_B64="$ROOT/patches/v0116-aerial-acquisition/v0116.patch.gz.b64"
EXPECTED_PATCH_B64_SHA="359abf50150470049941206350a0aa058a9ccb3c9b2139ddb0a51f0ff06107b9"
EXPECTED_PATCH_SHA="e8f4e5dcb58d429c0872d00a93e6a7841012985f3e50ec605f3020ca84eef7c3"
mkdir -p "$DIAG"

capture_source_audit() {
  local audit="$GEN/.tpmap-cache/automatic-sources/source-acquisition.json"
  [[ -f "$audit" ]] && cp "$audit" "$DIAG/source-acquisition.json" || true
}

on_error() {
  local status=$?
  capture_source_audit
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
PATH_SOURCE="${TPMAP_PATH_SOURCE:-aerial-required}"
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
    PATH_GEOMETRY_MODE="repair"
    ;;
  verified)
    ACCURACY_MODE="verified"
    TERRAIN_DETAIL_MODE="evidence"
    ALLOW_FALLBACK=false
    PATH_GEOMETRY_MODE="qa"
    ;;
  *) echo "Unknown accuracy: $ACCURACY" >&2; exit 2 ;;
esac

case "$PATH_SOURCE" in
  mapped-only|aerial-preferred|aerial-required) ;;
  *) echo "Unknown path source: $PATH_SOURCE" >&2; exit 2 ;;
esac

SAFE_NAME="$(printf '%s' "$PARK_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
printf 'park=%s\nbbox=%s\naccuracy=%s\npath_geometry=%s\npath_source=%s\nsource=v0.11.5-plus-v0.11.6-checksum-patch\n' \
  "$PARK_NAME" "$BBOX" "$ACCURACY_MODE" "$PATH_GEOMETRY_MODE" "$PATH_SOURCE" \
  | tee "$DIAG/parameters.txt"

[[ -f "$SOURCE_ZIP" ]] || { echo "Missing checksum-locked ThemePark Map v0.11.5 source ZIP." | tee "$DIAG/source-error.txt" >&2; exit 2; }
ACTUAL_SOURCE_SHA="$(sha256sum "$SOURCE_ZIP" | cut -d' ' -f1)"
printf 'expected=%s\nactual=%s\nsource=%s\n' "$EXPECTED_SOURCE_SHA" "$ACTUAL_SOURCE_SHA" "$(basename "$SOURCE_ZIP")" \
  | tee "$DIAG/source-checksum.txt"
[[ "$ACTUAL_SOURCE_SHA" == "$EXPECTED_SOURCE_SHA" ]] || { echo "v0.11.5 source ZIP checksum mismatch." >&2; exit 2; }

rm -rf "$GEN"
mkdir -p "$GEN"
unzip -q "$SOURCE_ZIP" -d "$GEN"

[[ -f "$PATCH_B64" ]] || { echo "Missing v0.11.6 source patch." | tee "$DIAG/patch-error.txt" >&2; exit 2; }
ACTUAL_PATCH_B64_SHA="$(sha256sum "$PATCH_B64" | cut -d' ' -f1)"
printf 'encoded_expected=%s\nencoded_actual=%s\n' "$EXPECTED_PATCH_B64_SHA" "$ACTUAL_PATCH_B64_SHA" \
  | tee "$DIAG/patch-checksum.txt"
[[ "$ACTUAL_PATCH_B64_SHA" == "$EXPECTED_PATCH_B64_SHA" ]] || { echo "v0.11.6 encoded patch checksum mismatch." >&2; exit 2; }
PATCH_FILE="$DIAG/v0116-aerial-acquisition.patch"
base64 -d "$PATCH_B64" | gzip -dc > "$PATCH_FILE"
ACTUAL_PATCH_SHA="$(sha256sum "$PATCH_FILE" | cut -d' ' -f1)"
printf 'decoded_expected=%s\ndecoded_actual=%s\n' "$EXPECTED_PATCH_SHA" "$ACTUAL_PATCH_SHA" \
  | tee -a "$DIAG/patch-checksum.txt"
[[ "$ACTUAL_PATCH_SHA" == "$EXPECTED_PATCH_SHA" ]] || { echo "v0.11.6 decoded patch checksum mismatch." >&2; exit 2; }
patch -d "$GEN" -p1 --batch --forward < "$PATCH_FILE" 2>&1 | tee "$DIAG/v0116-source-patch.log"

find "$GEN/src" "$GEN/scripts" "$GEN/test" -type f -name '*.mjs' -print0 \
  | xargs -0 -n1 node --check 2>&1 | tee "$DIAG/source-syntax-check.log"

node --input-type=module - "$GEN/package.json" <<'NODE' 2>&1 | tee "$DIAG/version-check.log"
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const pkg = JSON.parse(readFileSync(file, 'utf8'));
if (pkg.version !== '0.11.6') throw new Error(`Expected v0.11.6, got ${pkg.version}`);
console.log(`ThemePark Map source version ${pkg.version}`);
NODE

(
  cd "$GEN"
  npm ci --omit=dev --no-audit --no-fund 2>&1 | tee "$DIAG/npm-ci.log"
  node --test \
    test/appearance-vegetation.test.mjs \
    test/direct-world-palette-compatibility.test.mjs \
    test/path-geometry.test.mjs \
    test/path-topology-whole-park.test.mjs \
    test/source-broker.test.mjs \
    test/aerial-benchmark.test.mjs \
    test/aerial-acquisition-args.test.mjs \
    2>&1 | tee "$DIAG/compatibility-tests.log"
  node src/cli.mjs doctor 2>&1 | tee "$DIAG/doctor.log"
)

if [[ "$PATH_SOURCE" != mapped-only ]] && ! command -v gdal_translate >/dev/null 2>&1; then
  {
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends gdal-bin unzip
  } 2>&1 | tee "$DIAG/gdal-install.log"
fi

SOURCE_ARGS=(
  --path-source "$PATH_SOURCE"
  --source-profile open
  --source-failure-mode continue
  --no-auto-overture
  --no-auto-microsoft-buildings
)

IMAGERY_ARGS=(--orthophoto-mode off --path-discovery-mode off --aerial-terrain-mode off)
if [[ "$PATH_SOURCE" != mapped-only ]]; then
  IMAGERY_ARGS=(
    --orthophoto-mode evidence
    --orthophoto-min-coverage 0.95
    --orthophoto-coverage-grid-m 10
    --path-discovery-mode evidence
    --path-discovery-scope whole-park
    --path-discovery-independent-pixel-confidence 0.78
    --path-discovery-independent-min-confidence 0.86
    --path-discovery-independent-min-area-m2 28
    --path-discovery-independent-max-anchor-distance-m 42
    --aerial-benchmark-min-independent-candidates 1
    --aerial-terrain-mode evidence
    --aerial-terrain-grid-m 2
    --aerial-terrain-min-confidence 0.72
  )
fi

if [[ -n "${TPMAP_ORTHOPHOTO_URL:-}" ]]; then
  [[ -n "${TPMAP_ORTHOPHOTO_SOURCE:-}" && -n "${TPMAP_ORTHOPHOTO_LICENSE:-}" ]] || {
    echo "Orthophoto source and licence are required." >&2
    exit 2
  }
  mkdir -p "$GEN/data"
  curl --fail --location --retry 4 --retry-all-errors \
    --user-agent "ThemeParkMap/0.11.6 ($CONTACT)" \
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
  IMAGERY_ARGS+=(
    --orthophoto data/park-orthophoto.tif
    --orthophoto-source "$TPMAP_ORTHOPHOTO_SOURCE"
    --orthophoto-source-url "$TPMAP_ORTHOPHOTO_URL"
    --orthophoto-license "$TPMAP_ORTHOPHOTO_LICENSE"
  )
  [[ -n "${TPMAP_ORTHOPHOTO_DATE:-}" ]] && IMAGERY_ARGS+=(--orthophoto-date "$TPMAP_ORTHOPHOTO_DATE")
fi

run_attempt() {
  local label="$1" elevation="$2" overpass="$3" dsm="$4"
  local log="$DIAG/build-$label.log"
  rm -rf "$GEN/$OUT_REL"
  mkdir -p "$GEN/$OUT_REL"
  echo "strategy=$label elevation=$elevation overpass=$overpass dsm=$dsm path_source=$PATH_SOURCE" | tee "$log"

  local args=(
    build
    --park-name "$PARK_NAME"
    --bbox "$BBOX"
    --contact "$CONTACT"
    --overpass-url "$overpass"
    --elevation "$elevation"
    --buildings markers
    --path-terrain-mode conform
    --path-geometry-mode "$PATH_GEOMETRY_MODE"
    --path-snap-tolerance-m 3
    --path-snap-min-confidence 0.70
    --path-edge-mode off
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
    "${SOURCE_ARGS[@]}"
    "${IMAGERY_ARGS[@]}"
  )
  [[ "$dsm" == off ]] && args+=(--no-dsm)

  local status
  if (cd "$GEN" && node src/cli.mjs "${args[@]}") 2>&1 | tee -a "$log"; then
    status=0
  else
    status=${PIPESTATUS[0]}
  fi
  capture_source_audit
  echo "exit_status=$status" | tee -a "$log"
  [[ $status -eq 0 ]] || return "$status"

  MCWORLD="$(find "$GEN/$OUT_REL" -maxdepth 1 -type f -name '*_1to1.mcworld' -print -quit)"
  [[ -n "$MCWORLD" ]] || { echo "No .mcworld produced." | tee -a "$log"; return 3; }
  cp "$log" "$GEN/$OUT_REL/build.log"
  printf '{"strategy":"%s","elevation":"%s","overpass":"%s","dsm":"%s","pathSource":"%s"}\n' \
    "$label" "$elevation" "$overpass" "$dsm" "$PATH_SOURCE" > "$GEN/$OUT_REL/build-strategy.json"
  SUCCESS_STRATEGY="$label"
  return 0
}

PRIMARY="https://overpass-api.de/api/interpreter"
ALTERNATE="https://overpass.kumi.systems/api/interpreter"
SUCCESS_STRATEGY=""
MCWORLD=""

if run_attempt 01-ea-full-primary ea-lidar "$PRIMARY" on; then :
elif [[ "$PATH_SOURCE" == aerial-required ]]; then
  echo "Aerial-required mode refuses an OSM-only source fallback." >&2
  exit 2
elif ! $ALLOW_FALLBACK; then
  echo "Verified mode refuses source fallback." >&2
  exit 2
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
node --input-type=module - "$VALIDATION_PATH" "$SUCCESS_STRATEGY" "$(basename "$MCWORLD")" "$WORLD_SHA" "$WORLD_BYTES" "$PATH_SOURCE" <<'NODE'
import { writeFileSync } from 'node:fs';
const [, , output, strategy, filename, sha256, bytes, pathSource] = process.argv;
writeFileSync(output, JSON.stringify({
  schemaVersion: 3,
  status: 'passed',
  strategy,
  pathSource,
  world: { filename, sha256, bytes: Number(bytes) }
}, null, 2) + '\n');
NODE

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "mcworld=$MCWORLD" >> "$GITHUB_OUTPUT"
  echo "strategy=$SUCCESS_STRATEGY" >> "$GITHUB_OUTPUT"
  echo "safe_name=$SAFE_NAME" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then echo "MCWORLD=$MCWORLD" >> "$GITHUB_ENV"; fi

echo "Generated $(basename "$MCWORLD") using $SUCCESS_STRATEGY path_source=$PATH_SOURCE"
