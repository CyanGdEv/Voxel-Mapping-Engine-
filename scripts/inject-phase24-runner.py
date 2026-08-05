#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: inject-phase24-runner.py RUNNER")
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

phase24_marker = '''  node --test \\
    test/planning-georeference.test.mjs \\
    test/planning-vectorize.test.mjs \\
    test/planning-vector-fusion.test.mjs \\
'''
if phase24_marker not in text:
    raise SystemExit("Could not locate the Phase 23 compatibility boundary")

phase24_block = r'''  PHASE24_B64="$ROOT/patches/v0120-phase24/v0120-phase24-planning-portal-resilience.patch.gz.b64"
  PHASE24_PATCH="$ROOT/.phase24-planning-portal-resilience.patch"
  EXPECTED_PHASE24_BLOB="bfb917e3bf94a9dc221cc4ed520f6b13e84429c4"
  EXPECTED_PHASE24_PATCH_SHA="4e676c50435b661be8db460f66dc42f06e65d1fc56df53eef861c3690863786e"
  ACTUAL_PHASE24_BLOB="$(git hash-object "$PHASE24_B64")"
  printf 'bundle=%s\nexpected_blob=%s\nactual_blob=%s\n' \
    "$(basename "$PHASE24_B64")" "$EXPECTED_PHASE24_BLOB" "$ACTUAL_PHASE24_BLOB" \
    | tee "$DIAG/phase24-patch-checksum.txt"
  [[ "$ACTUAL_PHASE24_BLOB" == "$EXPECTED_PHASE24_BLOB" ]] || {
    echo "Phase 24 planning portal resilience bundle mismatch." | tee -a "$DIAG/source-error.txt" >&2
    exit 2
  }
  base64 --decode "$PHASE24_B64" | gzip -dc > "$PHASE24_PATCH"
  ACTUAL_PHASE24_PATCH_SHA="$(sha256sum "$PHASE24_PATCH" | cut -d' ' -f1)"
  printf 'patch_expected=%s\npatch_actual=%s\n' \
    "$EXPECTED_PHASE24_PATCH_SHA" "$ACTUAL_PHASE24_PATCH_SHA" \
    | tee -a "$DIAG/phase24-patch-checksum.txt"
  [[ "$ACTUAL_PHASE24_PATCH_SHA" == "$EXPECTED_PHASE24_PATCH_SHA" ]] || {
    echo "Phase 24 planning portal resilience patch checksum mismatch." | tee -a "$DIAG/source-error.txt" >&2
    exit 2
  }
  patch --batch --forward --fuzz=0 -d "$GEN" -p1 < "$PHASE24_PATCH" \
    2>&1 | tee "$DIAG/phase24-patch-apply.log"
  find "$GEN" -name '*.rej' -print -quit | grep -q . && {
    echo "Phase 24 produced a reject file." | tee -a "$DIAG/source-error.txt" >&2
    exit 2
  }
  find "$GEN/src" "$GEN/scripts" "$GEN/test" -type f -name '*.mjs' -print0 \
    | xargs -0 -n1 node --check 2>&1 | tee "$DIAG/phase24-syntax-check.log"
  node --test test/planning-documents.test.mjs \
    2>&1 | tee "$DIAG/phase24-planning-portal-tests.log"

'''
text = text.replace(phase24_marker, phase24_block + phase24_marker, 1)

source_marker = '''  --planning-document-min-score "${TPMAP_PLANNING_DOCUMENT_MIN_SCORE:-35}"
)'''
source_replacement = '''  --planning-document-min-score "${TPMAP_PLANNING_DOCUMENT_MIN_SCORE:-35}"
  --planning-coverage-policy "${TPMAP_PLANNING_COVERAGE_POLICY:-fail}"
  --planning-min-applications "${TPMAP_PLANNING_MIN_APPLICATIONS:-1}"
  --planning-min-documents "${TPMAP_PLANNING_MIN_DOCUMENTS:-1}"
  --planning-vector-fusion-mode "${TPMAP_PLANNING_VECTOR_FUSION_MODE:-private}"
  --planning-vector-fusion-min-confidence "${TPMAP_PLANNING_VECTOR_FUSION_MIN_CONFIDENCE:-0.78}"
  --planning-vector-fusion-max-rmse-m "${TPMAP_PLANNING_VECTOR_FUSION_MAX_RMSE_M:-2.5}"
  --planning-vector-fusion-min-length-m "${TPMAP_PLANNING_VECTOR_FUSION_MIN_LENGTH_M:-4}"
  --planning-vector-fusion-min-area-m2 "${TPMAP_PLANNING_VECTOR_FUSION_MIN_AREA_M2:-8}"
  --planning-vector-fusion-max-features "${TPMAP_PLANNING_VECTOR_FUSION_MAX_FEATURES:-5000}"
)'''
if source_marker not in text:
    raise SystemExit("Could not locate planning SOURCE_ARGS boundary")
text = text.replace(source_marker, source_replacement, 1)

config_marker = '''  > "$DIAG/planning-document-config.txt"
'''
config_replacement = '''  > "$DIAG/planning-document-config.txt"

printf 'coverage_policy=%s\nmin_live_applications=%s\nmin_downloaded_documents=%s\nvector_fusion_mode=%s\nvector_min_confidence=%s\nvector_max_rmse_m=%s\n' \
  "${TPMAP_PLANNING_COVERAGE_POLICY:-fail}" "${TPMAP_PLANNING_MIN_APPLICATIONS:-1}" \
  "${TPMAP_PLANNING_MIN_DOCUMENTS:-1}" "${TPMAP_PLANNING_VECTOR_FUSION_MODE:-private}" \
  "${TPMAP_PLANNING_VECTOR_FUSION_MIN_CONFIDENCE:-0.78}" "${TPMAP_PLANNING_VECTOR_FUSION_MAX_RMSE_M:-2.5}" \
  > "$DIAG/planning-private-coverage-config.txt"
'''
if config_marker not in text:
    raise SystemExit("Could not locate planning diagnostics boundary")
text = text.replace(config_marker, config_replacement, 1)
path.write_text(text, encoding="utf-8")
