#!/usr/bin/env node
// TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_INSTALLER
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes("--self-test");
const validateOnly = args.includes("--validate-only");

if (selfTest) runSelfTest();
else if (!generator) throw new Error("--generator is required");
else await install(generator, validateOnly);

async function install(root, validate) {
  const georeferenceFile = path.join(root, "src/lib/planning-georeference.mjs");
  const pythonFile = path.join(root, "src/tools/planning_auto_register.py");
  const georeferenceSource = await readFile(georeferenceFile, "utf8");
  const pythonSource = await readFile(pythonFile, "utf8");
  const transformedGeoreference = transformGeoreference(georeferenceSource);
  const transformedPython = transformPython(pythonSource);
  if (!validate) {
    if (transformedGeoreference !== georeferenceSource) await writeFile(georeferenceFile, transformedGeoreference);
    if (transformedPython !== pythonSource) await writeFile(pythonFile, transformedPython);
  }
  validateGeoreference(validate ? georeferenceSource : transformedGeoreference);
  validatePython(validate ? pythonSource : transformedPython);
  console.log(JSON.stringify({
    status: validate ? "validated" : "installed",
    marker: "TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2"
  }));
}

export function transformGeoreference(source) {
  if (source.includes("TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2")) return source;
  if (!source.includes("TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING")) {
    throw new Error("georeference priority/performance layer requires bounded Phase 30D planning processing");
  }
  let output = replaceOnce(
    source,
    "const TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING = true;",
    "const TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING = true;\nconst TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2 = true;",
    "priority/performance marker"
  );
  output = output.replaceAll("tpmap-planning-georeference-result-v1", "tpmap-planning-georeference-result-v2");
  output = output.replaceAll("planning-georeference-results-v1", "planning-georeference-results-v2");
  output = replaceFunction(output, "async function georeferenceOne(", priorityGeoreferenceFunction());

  const summary = '  console.error(`TPMAP planning georeference complete: considered=${report.documentsConsidered} accepted=${report.accepted} rejected=${report.rejected} errors=${report.errors} cacheHits=${report.processing.cacheHits} cacheMisses=${report.processing.cacheMisses}`);';
  output = replaceOnce(
    output,
    summary,
    `  const rejectionReasons = {};
  for (const item of report.documents) {
    if (item?.status === "accepted") continue;
    const reason = String(item?.reason || item?.status || "unknown");
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  }
  report.processing.rejectionReasons = Object.fromEntries(Object.entries(rejectionReasons).sort(([a], [b]) => a.localeCompare(b)));
  console.error(\`TPMAP planning georeference rejection reasons: \${JSON.stringify(report.processing.rejectionReasons)}\`);
${summary}`,
    "georeference rejection telemetry"
  );
  validateGeoreference(output);
  return output;
}

function priorityGeoreferenceFunction() {
  return `async function georeferenceOne({ runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit }) {
  const embedded = await inspectEmbeddedGeospatial(sourceFile, bbox, config);
  if (embedded.accepted) {
    const derived = await exportEmbeddedRaster(sourceFile, derivedDirectory, document, embedded, config);
    return baseDocumentResult(document, {
      status: "accepted",
      method: "embedded-geospatial",
      page: embedded.page || 1,
      crs: embedded.crs,
      extentWgs84: embedded.extentWgs84,
      extentAreaKm2: embedded.extentAreaKm2,
      geofenceOverlap: embedded.geofenceOverlap,
      controlPointCount: embedded.controlPointCount || 0,
      rmseM: null,
      derivedRasterSha256: derived.sha256,
      derivedRasterBytes: derived.bytes,
      worldEligible: false
    });
  }

  if (explicit) {
    const candidate = await normalizeManifestCandidate(explicit, document);
    const validation = await validateControlPointCandidate(candidate, bbox, config);
    if (!validation.accepted) {
      return baseDocumentResult(document, {
        status: "rejected",
        method: "explicit-control-points",
        reason: validation.reason,
        page: candidate.page,
        controlPointCount: candidate.points.length,
        rmseM: validation.rmseM ?? null
      });
    }
    const derived = await warpPlanningPage(sourceFile, derivedDirectory, document, candidate, validation, config);
    return acceptedControlPointResult(document, "explicit-control-points", candidate, validation, derived);
  }

  // Printed coordinate controls are stronger, deterministic evidence. Evaluate
  // them before heuristic linework matching so a weak visual candidate cannot
  // mask a valid grid/pair and so PDFs with coordinates avoid OpenCV entirely.
  let deterministicBest = null;
  let deterministicCandidateCount = 0;
  if (document.mime === "application/pdf") {
    const pages = await extractPdfCoordinatePages(sourceFile, config.maxPages);
    const candidates = [];
    for (const page of pages) {
      candidates.push(...coordinateGridCandidates(page));
      candidates.push(...coordinatePairCandidates(page));
    }
    deterministicCandidateCount = candidates.length;
    const evaluated = [];
    for (const candidate of candidates) {
      const validation = await validateControlPointCandidate(candidate, bbox, config);
      evaluated.push({ candidate, validation });
    }
    const accepted = evaluated
      .filter((entry) => entry.validation.accepted)
      .sort((a, b) => a.validation.rmseM - b.validation.rmseM || b.candidate.points.length - a.candidate.points.length)[0];
    if (accepted) {
      const derived = await warpPlanningPage(sourceFile, derivedDirectory, document, accepted.candidate, accepted.validation, config);
      return acceptedControlPointResult(document, accepted.candidate.method, accepted.candidate, accepted.validation, derived);
    }
    deterministicBest = evaluated
      .sort((a, b) => (a.validation.rmseM ?? Infinity) - (b.validation.rmseM ?? Infinity))[0] || null;
  }

  let automaticFailure = null;
  if (config.automaticEnabled && AUTOMATIC_ANCHOR_ROLES.has(document.role)) {
    const automatic = await automaticPlanningRegistration(runtime, options, document, sourceFile, bbox, config);
    automaticFailure = automatic?.reason || null;
    const manifest = automaticCandidateToManifest(automatic, document);
    if (manifest) {
      const candidate = await normalizeManifestCandidate(manifest, document);
      const validation = await validateControlPointCandidate(candidate, bbox, config);
      const automaticCandidate = {
        ...manifest,
        candidateLocation: automatic.candidateLocation || manifest.candidateLocation,
        confidence: automatic.confidence || manifest.confidence,
        quality: automatic.quality || manifest.quality
      };
      if (automatic.status === "accepted" && Number(automatic.confidence || 0) >= config.automaticMinConfidence && validation.accepted) {
        const derived = await warpPlanningPage(sourceFile, derivedDirectory, document, candidate, validation, config);
        return {
          ...acceptedControlPointResult(document, "automatic-linework-registration", candidate, validation, derived),
          automaticConfidence: Number(automatic.confidence || 0),
          automaticQuality: automatic.quality || null
        };
      }
      return baseDocumentResult(document, {
        status: "rejected",
        method: "automatic-linework-candidate",
        reason: validation.accepted ? (automatic.reason || "awaiting-cross-document-consensus") : validation.reason,
        page: candidate.page,
        controlPointCount: candidate.points.length,
        rmseM: validation.rmseM ?? null,
        candidateCount: deterministicCandidateCount,
        deterministicReason: deterministicBest?.validation?.reason || null,
        automaticCandidate
      });
    }
  }

  if (document.mime !== "application/pdf") {
    return baseDocumentResult(document, {
      status: "rejected",
      reason: automaticFailure || embedded.reason || "image-has-no-embedded-georeference-or-explicit-control-points"
    });
  }

  return baseDocumentResult(document, {
    status: "rejected",
    reason: deterministicBest?.validation?.reason || automaticFailure || embedded.reason || "no-safe-coordinate-controls-found",
    page: deterministicBest?.candidate?.page || null,
    controlPointCount: deterministicBest?.candidate?.points?.length || 0,
    rmseM: deterministicBest?.validation?.rmseM ?? null,
    candidateCount: deterministicCandidateCount
  });
}`;
}

export function transformPython(source) {
  if (source.includes("TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2")) return source;
  let output = replaceOnce(source, "import cv2\n", "import cv2\n# TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2\n", "OpenCV hotpath marker");
  output = replaceOnce(
    output,
    `    reference = render_reference(features, bbox, reference_size)
    if int(reference.sum()) < 300:
        return rejected("reference-linework-too-sparse")

    prepared = prepare_plan(image)`,
    `    reference = render_reference(features, bbox, reference_size)
    if int(reference.sum()) < 300:
        return rejected("reference-linework-too-sparse")
    # Invariant for every scale/angle/candidate in this document. The previous
    # implementation recomputed this in every scale and again in every candidate.
    reference_distance = cv2.distanceTransform((1 - reference).astype(np.uint8), cv2.DIST_L2, 3).astype(np.float32)

    prepared = prepare_plan(image)`,
    "reference distance precomputation"
  );
  output = replaceOnce(
    output,
    `    crop_edges, crop_origin, anchor, preparation = prepared

    dpi = finite(request.get("imageDpi")) or 144.0`,
    `    crop_edges, crop_origin, anchor, preparation = prepared
    source_edges = cv2.dilate((crop_edges * 255).astype(np.uint8), np.ones((2, 2), np.uint8), iterations=1)

    dpi = finite(request.get("imageDpi")) or 144.0`,
    "source edge precomputation"
  );
  output = replaceOnce(
    output,
    `            crop_edges, anchor, crop_origin, image.shape, bbox, reference,
            dpi, denominator, angles, location,
        ))`,
    `            crop_edges, anchor, crop_origin, image.shape, bbox, reference,
            reference_distance, source_edges, dpi, denominator, angles, location,
        ))`,
    "search registration invariant arguments"
  );
  output = replaceOnce(
    output,
    "def search_registration(crop_edges, anchor, crop_origin, image_shape, bbox, reference, dpi, denominator, angles, location):",
    "def search_registration(crop_edges, anchor, crop_origin, image_shape, bbox, reference, reference_distance, source_edges, dpi, denominator, angles, location):",
    "search registration signature"
  );
  output = replaceOnce(
    output,
    `    reference_distance = cv2.distanceTransform((1 - reference).astype(np.uint8), cv2.DIST_L2, 3).astype(np.float32)
    results = []`,
    "    results = []",
    "remove per-scale reference distance transform"
  );
  output = replaceOnce(
    output,
    `                crop_edges, matrix, reference, bbox, crop_origin, image_shape,
                denominator, angle, location, anchor_ref,
            )`,
    `                crop_edges, matrix, reference, reference_distance, source_edges, bbox, crop_origin, image_shape,
                denominator, angle, location, anchor_ref,
            )`,
    "candidate invariant arguments"
  );
  output = replaceOnce(
    output,
    `def evaluate_candidate(crop_edges, matrix, reference, bbox, crop_origin, image_shape, denominator, angle, location, anchor_ref):
    ref_h, ref_w = reference.shape
    source_edges = cv2.dilate((crop_edges * 255).astype(np.uint8), np.ones((2, 2), np.uint8), iterations=1)`,
    `def evaluate_candidate(crop_edges, matrix, reference, reference_distance, source_edges, bbox, crop_origin, image_shape, denominator, angle, location, anchor_ref):
    ref_h, ref_w = reference.shape`,
    "candidate signature and source edge reuse"
  );
  output = replaceOnce(
    output,
    `    reference_distance = cv2.distanceTransform((1 - reference).astype(np.uint8), cv2.DIST_L2, 3)
    plan_distance = cv2.distanceTransform((1 - plan).astype(np.uint8), cv2.DIST_L2, 3)`,
    "    plan_distance = cv2.distanceTransform((1 - plan).astype(np.uint8), cv2.DIST_L2, 3)",
    "remove per-candidate reference distance transform"
  );
  validatePython(output);
  return output;
}

function validateGeoreference(source) {
  for (const token of [
    "TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2",
    "tpmap-planning-georeference-result-v2",
    "planning-georeference-results-v2",
    "Printed coordinate controls are stronger",
    "deterministicCandidateCount",
    "automaticFailure",
    "TPMAP planning georeference rejection reasons"
  ]) if (!source.includes(token)) throw new Error(`georeference priority/performance validation missing: ${token}`);
  const functionSource = extractFunction(source, "async function georeferenceOne(");
  if (functionSource.indexOf("extractPdfCoordinatePages") > functionSource.indexOf("automaticPlanningRegistration")) {
    throw new Error("automatic linework still runs before deterministic coordinate evidence");
  }
  if (source.includes("tpmap-planning-georeference-result-v1") || source.includes("planning-georeference-results-v1")) {
    throw new Error("stale v1 georeference result cache remains after behavior change");
  }
}

function validatePython(source) {
  for (const token of [
    "TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2",
    "reference_distance, source_edges",
    "def evaluate_candidate(crop_edges, matrix, reference, reference_distance, source_edges",
    "source_edges = cv2.dilate"
  ]) if (!source.includes(token)) throw new Error(`automatic registration optimization missing: ${token}`);
  const referenceDistanceCount = (source.match(/reference_distance = cv2\.distanceTransform\(\(1 - reference\)/g) || []).length;
  const sourceEdgeCount = (source.match(/source_edges = cv2\.dilate/g) || []).length;
  if (referenceDistanceCount !== 1) throw new Error(`reference distance must be computed once per document, found ${referenceDistanceCount}`);
  if (sourceEdgeCount !== 1) throw new Error(`source edge dilation must be computed once per document, found ${sourceEdgeCount}`);
}

function replaceFunction(source, marker, replacement) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`function anchor missing: ${marker}`);
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error(`function anchor ambiguous: ${marker}`);
  const open = source.indexOf(") {", start);
  if (open < 0) throw new Error(`function body start missing: ${marker}`);
  let depth = 0;
  for (let index = open + 2; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(index + 1);
    }
  }
  throw new Error(`function body end missing: ${marker}`);
}

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf(") {", start);
  let depth = 0;
  for (let index = open + 2; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`georeference priority/performance anchor missing: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`georeference priority/performance anchor ambiguous: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function runSelfTest() {
  const georeferenceFixture = `const TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING = true;
const x = "tpmap-planning-georeference-result-v1";
const y = "planning-georeference-results-v1";
async function georeferenceOne({ runtime, options, config, bbox, document, sourceFile, derivedDirectory, explicit }) {
  if (config.automaticEnabled) await automaticPlanningRegistration(runtime, options, document, sourceFile, bbox, config);
  if (document.mime === "application/pdf") await extractPdfCoordinatePages(sourceFile, config.maxPages);
}
async function demo(report) {
  console.error(\`TPMAP planning georeference complete: considered=\${report.documentsConsidered} accepted=\${report.accepted} rejected=\${report.rejected} errors=\${report.errors} cacheHits=\${report.processing.cacheHits} cacheMisses=\${report.processing.cacheMisses}\`);
}`;
  const transformed = transformGeoreference(georeferenceFixture);
  validateGeoreference(transformed);
  if (transformGeoreference(transformed) !== transformed) throw new Error("georeference transform is not idempotent");

  const pythonFixture = `import cv2
import numpy as np
    reference = render_reference(features, bbox, reference_size)
    if int(reference.sum()) < 300:
        return rejected("reference-linework-too-sparse")

    prepared = prepare_plan(image)
    crop_edges, crop_origin, anchor, preparation = prepared

    dpi = finite(request.get("imageDpi")) or 144.0
            crop_edges, anchor, crop_origin, image.shape, bbox, reference,
            dpi, denominator, angles, location,
        ))
def search_registration(crop_edges, anchor, crop_origin, image_shape, bbox, reference, dpi, denominator, angles, location):
    reference_distance = cv2.distanceTransform((1 - reference).astype(np.uint8), cv2.DIST_L2, 3).astype(np.float32)
    results = []
                crop_edges, matrix, reference, bbox, crop_origin, image_shape,
                denominator, angle, location, anchor_ref,
            )
def evaluate_candidate(crop_edges, matrix, reference, bbox, crop_origin, image_shape, denominator, angle, location, anchor_ref):
    ref_h, ref_w = reference.shape
    source_edges = cv2.dilate((crop_edges * 255).astype(np.uint8), np.ones((2, 2), np.uint8), iterations=1)
    reference_distance = cv2.distanceTransform((1 - reference).astype(np.uint8), cv2.DIST_L2, 3)
    plan_distance = cv2.distanceTransform((1 - plan).astype(np.uint8), cv2.DIST_L2, 3)`;
  const transformedPython = transformPython(pythonFixture);
  validatePython(transformedPython);
  if (transformPython(transformedPython) !== transformedPython) throw new Error("Python transform is not idempotent");
  console.log("Phase 30D georeference priority/performance self-test passed");
}
