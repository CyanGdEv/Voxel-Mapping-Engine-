#!/usr/bin/env node
// TPMAP_PHASE30D_ROI_CONSENSUS_RUNTIME_INSTALLER
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
    marker: "TPMAP_PHASE30D_ROI_CONSENSUS_RUNTIME_V3"
  }));
}

export function transformGeoreference(source) {
  if (source.includes("TPMAP_PHASE30D_ROI_CONSENSUS_RUNTIME_V3")) return source;
  if (!source.includes("TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2")) {
    throw new Error("ROI/consensus runtime layer requires Phase 30D priority/performance v2");
  }
  if (!source.includes("TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING")) {
    throw new Error("ROI/consensus runtime layer requires bounded planning processing");
  }

  let output = replaceOnce(
    source,
    "const TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2 = true;",
    "const TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2 = true;\nconst TPMAP_PHASE30D_ROI_CONSENSUS_RUNTIME_V3 = true;",
    "ROI/consensus marker"
  );

  const telemetryStart = output.indexOf("  const rejectionReasons = {};");
  const consensusGate = output.indexOf("  if (config.automaticEnabled) {", telemetryStart);
  if (telemetryStart < 0 || consensusGate < 0) {
    throw new Error("pre-consensus telemetry anchors missing");
  }
  output = output.slice(0, telemetryStart) + output.slice(consensusGate);

  const consensusCall = `  if (config.automaticEnabled) {
    await applyAutomaticConsensus({ runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report });
  }`;
  output = replaceOnce(
    output,
    consensusCall,
    `${consensusCall}\n  emitPlanningGeoreferenceFinalTelemetry(report);`,
    "post-consensus final telemetry"
  );

  const helper = `function emitPlanningGeoreferenceFinalTelemetry(report) {
  const rejectionReasons = {};
  for (const item of report.documents) {
    if (item?.status === "accepted") continue;
    const reason = String(item?.reason || item?.status || "unknown");
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  }
  report.processing.rejectionReasons = Object.fromEntries(Object.entries(rejectionReasons).sort(([a], [b]) => a.localeCompare(b)));
  report.processing.finalAccepted = report.accepted;
  report.processing.finalRejected = report.rejected;
  console.error(\`TPMAP planning georeference rejection reasons: \${JSON.stringify(report.processing.rejectionReasons)}\`);
  console.error(\`TPMAP planning georeference complete: considered=\${report.documentsConsidered} accepted=\${report.accepted} rejected=\${report.rejected} errors=\${report.errors} cacheHits=\${report.processing.cacheHits} cacheMisses=\${report.processing.cacheMisses} consensusAccepted=\${report.methods.automaticConsensus || 0}\`);
}

`;
  output = replaceOnce(output, "async function applyAutomaticConsensus(", helper + "async function applyAutomaticConsensus(", "final telemetry helper");
  output = replaceJsFunction(output, "async function applyAutomaticConsensus(", parallelConsensusFunction());
  validateGeoreference(output);
  return output;
}

function parallelConsensusFunction() {
  return `async function applyAutomaticConsensus({ runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report }) {
  const candidates = report.documents.filter((document) => document.automaticCandidate);
  if (!candidates.length) {
    report.automaticConsensus = { status: "no-candidates", groups: [], finalization: { queued: 0, accepted: 0, errors: 0, concurrency: 0 } };
    return;
  }
  const consensus = automaticConsensusGroups(candidates, options);
  const acceptedIds = [...consensus.accepted];
  const finalizationConcurrency = planningProcessingConcurrency(options);
  report.automaticConsensus = {
    status: consensus.accepted.size ? "accepted" : "no-consensus",
    groups: consensus.evidence,
    minimumDocuments: consensus.minimumDocuments,
    minimumConfidence: consensus.minimumConfidence,
    maximumSeparationM: consensus.maxSeparationM,
    finalization: { queued: acceptedIds.length, accepted: 0, errors: 0, concurrency: finalizationConcurrency }
  };
  if (!acceptedIds.length) return;

  console.error(\`TPMAP planning consensus finalization: queued=\${acceptedIds.length} concurrency=\${finalizationConcurrency}\`);
  const outcomes = await mapConcurrent(acceptedIds, finalizationConcurrency, async (id) => {
    const index = report.documents.findIndex((entry) => entry.id === id);
    if (index < 0 || report.documents[index].status === "accepted") return { id, index, skipped: true };
    const sourceDocument = documents.find((entry) => entry.id === id);
    if (!sourceDocument) return { id, index, skipped: true };
    try {
      const sourceFile = await locateCachedDocument(cacheDirectory, sourceDocument);
      if (!sourceFile) return { id, index, skipped: true };
      const manifest = report.documents[index].automaticCandidate;
      const candidate = await normalizeManifestCandidate(manifest, sourceDocument);
      const validation = await validateControlPointCandidate(candidate, bbox, config);
      if (!validation.accepted) return { id, index, skipped: true };
      const derived = await warpPlanningPage(sourceFile, derivedDirectory, sourceDocument, candidate, validation, config);
      return {
        id,
        index,
        sourceDocument,
        result: {
          ...acceptedControlPointResult(sourceDocument, "automatic-linework-consensus", candidate, validation, derived),
          automaticConfidence: Number(manifest.confidence || 0),
          automaticQuality: manifest.quality || null
        }
      };
    } catch (error) {
      return { id, index, sourceDocument, error };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.error) {
      report.automaticConsensus.finalization.errors += 1;
      report.warnings.push(\`\${outcome.sourceDocument?.applicationReference || outcome.sourceDocument?.id || outcome.id}: automatic consensus finalization failed: \${outcome.error?.message || outcome.error}\`);
      if (config.failClosed) throw outcome.error;
      continue;
    }
    if (!outcome.result || outcome.index < 0) continue;
    report.documents[outcome.index] = outcome.result;
    report.rejected = Math.max(0, report.rejected - 1);
    report.accepted += 1;
    report.methods.automaticConsensus += 1;
    report.automaticConsensus.finalization.accepted += 1;
  }
  console.error(\`TPMAP planning consensus finalization complete: accepted=\${report.automaticConsensus.finalization.accepted} errors=\${report.automaticConsensus.finalization.errors}\`);
}`;
}

export function transformPython(source) {
  if (source.includes("TPMAP_PHASE30D_ROI_CANDIDATE_EVALUATION_V3")) return source;
  if (!source.includes("TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2")) {
    throw new Error("ROI candidate evaluation requires Phase 30D automatic-registration hotpath v2");
  }
  let output = replaceOnce(
    source,
    "# TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2",
    "# TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2\n# TPMAP_PHASE30D_ROI_CANDIDATE_EVALUATION_V3",
    "ROI candidate marker"
  );
  output = replacePythonFunction(output, "search_registration", roiSearchRegistration());
  output = replacePythonFunction(output, "evaluate_candidate", roiEvaluateCandidate());
  validatePython(output);
  return output;
}

function roiSearchRegistration() {
  return `def search_registration(crop_edges, anchor, crop_origin, image_shape, bbox, reference, reference_distance, source_edges, dpi, denominator, angles, location):
    ref_h, ref_w = reference.shape
    metres_x, metres_y = reference_metres_per_pixel(bbox, ref_w, ref_h)
    reference_metres = (metres_x + metres_y) / 2.0
    plan_metres_per_pixel = denominator * 0.0254 / dpi
    scale = plan_metres_per_pixel / reference_metres
    if not 0.006 <= scale <= 4.0:
        return []

    results = []
    for angle in angles:
        template, local_matrix, local_anchor = transformed_template(crop_edges, anchor, scale, angle)
        if template is None:
            continue
        th, tw = template.shape
        if th >= ref_h or tw >= ref_w:
            continue
        edge_count = int(template.sum())
        if edge_count < 70:
            continue

        offset_left = 0
        offset_top = 0
        distance_input = reference_distance
        if location is not None:
            rows, cols = ref_h - th + 1, ref_w - tw + 1
            cx, cy = location
            radius_x, radius_y = max(80, int(650 / metres_x)), max(80, int(650 / metres_y))
            left = max(0, int(cx - radius_x - tw / 2))
            right = min(cols, int(cx + radius_x - tw / 2))
            top = max(0, int(cy - radius_y - th / 2))
            bottom = min(rows, int(cy + radius_y - th / 2))
            if right <= left or bottom <= top:
                continue
            distance_input = reference_distance[top:bottom + th - 1, left:right + tw - 1]
            offset_left, offset_top = left, top

        cost = cv2.matchTemplate(distance_input, template.astype(np.float32), cv2.TM_CCORR) / max(1, edge_count)
        flat = cost.ravel()
        finite_count = int(np.isfinite(flat).sum())
        if not finite_count:
            continue
        take = min(8, finite_count)
        indices = np.argpartition(flat, take - 1)[:take]
        indices = indices[np.argsort(flat[indices])]
        used = []
        for index in indices:
            local_top, local_left = divmod(int(index), cost.shape[1])
            top, left = local_top + offset_top, local_left + offset_left
            anchor_ref = np.asarray([left + local_anchor[0], top + local_anchor[1]], dtype=np.float64)
            if any(np.linalg.norm(anchor_ref - prior) < 35 for prior in used):
                continue
            used.append(anchor_ref)
            matrix = local_matrix.copy()
            matrix[:, 2] += np.asarray([left, top], dtype=np.float64)
            candidate = evaluate_candidate(
                crop_edges, matrix, reference, reference_distance, source_edges, bbox, crop_origin, image_shape,
                denominator, angle, location, anchor_ref,
            )
            if candidate:
                results.append(candidate)
    return results`;
}

function roiEvaluateCandidate() {
  return `def evaluate_candidate(crop_edges, matrix, reference, reference_distance, source_edges, bbox, crop_origin, image_shape, denominator, angle, location, anchor_ref):
    ref_h, ref_w = reference.shape
    source_h, source_w = crop_edges.shape
    corners = np.asarray([[0.0, 0.0, 1.0], [source_w, 0.0, 1.0], [source_w, source_h, 1.0], [0.0, source_h, 1.0]], dtype=np.float64)
    projected = corners @ matrix.T
    padding = 8
    x0 = max(0, int(math.floor(float(projected[:, 0].min()))) - padding)
    y0 = max(0, int(math.floor(float(projected[:, 1].min()))) - padding)
    x1 = min(ref_w, int(math.ceil(float(projected[:, 0].max()))) + padding)
    y1 = min(ref_h, int(math.ceil(float(projected[:, 1].max()))) + padding)
    if x1 <= x0 or y1 <= y0:
        return None

    local_matrix = matrix.copy()
    local_matrix[:, 2] -= np.asarray([x0, y0], dtype=np.float64)
    roi_w, roi_h = x1 - x0, y1 - y0
    warped = cv2.warpAffine(source_edges, local_matrix, (roi_w, roi_h), flags=cv2.INTER_AREA)
    plan = (warped > 22).astype(np.uint8)
    if int(plan.sum()) < 80:
        return None
    footprint = cv2.warpAffine(np.ones(crop_edges.shape, dtype=np.uint8), local_matrix, (roi_w, roi_h), flags=cv2.INTER_NEAREST)
    reference_roi = reference[y0:y1, x0:x1]
    reference_distance_roi = reference_distance[y0:y1, x0:x1]
    plan_distance = cv2.distanceTransform((1 - plan).astype(np.uint8), cv2.DIST_L2, 3)
    plan_pixels = plan > 0
    reference_pixels = (reference_roi > 0) & (footprint > 0)
    if int(reference_pixels.sum()) < 50:
        return None
    precision = float(np.mean(reference_distance_roi[plan_pixels] <= 4.0))
    recall = float(np.mean(plan_distance[reference_pixels] <= 4.0))
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    location_offset = reference_offset_metres(anchor_ref, location, bbox, ref_w, ref_h) if location is not None else None
    prior = 0.0 if location_offset is None else max(-0.06, 0.05 - location_offset / 10000.0)
    return {
        "score": f1 + prior, "f1": f1, "precision": precision, "recall": recall,
        "angleDeg": float(angle), "scaleDenominator": int(denominator),
        "anchorReference": [float(anchor_ref[0]), float(anchor_ref[1])],
        "matrix": matrix.tolist(), "edgeCount": int(plan.sum()),
        "referenceEdgeCount": int(reference_pixels.sum()),
        "locationOffsetM": float(location_offset) if location_offset is not None else None,
        "cropOrigin": [int(crop_origin[0]), int(crop_origin[1])],
        "sourceImageWidth": int(image_shape[1]), "sourceImageHeight": int(image_shape[0]),
    }`;
}

function validateGeoreference(source) {
  for (const token of [
    "TPMAP_PHASE30D_ROI_CONSENSUS_RUNTIME_V3",
    "emitPlanningGeoreferenceFinalTelemetry(report)",
    "planning consensus finalization: queued=",
    "mapConcurrent(acceptedIds, finalizationConcurrency",
    "automaticConsensus.finalization",
    "consensusAccepted=",
    "warpPlanningPage"
  ]) if (!source.includes(token)) throw new Error(`ROI/consensus georeference validation missing: ${token}`);
  const call = source.indexOf("await applyAutomaticConsensus({ runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report });");
  const finalTelemetry = source.indexOf("emitPlanningGeoreferenceFinalTelemetry(report);");
  if (call < 0 || finalTelemetry < call) throw new Error("final georeference telemetry still precedes consensus");
  const consensusSource = extractJsFunction(source, "async function applyAutomaticConsensus(");
  if (!consensusSource.includes("mapConcurrent(acceptedIds, finalizationConcurrency")) throw new Error("consensus finalization remains serial");
}

function validatePython(source) {
  for (const token of [
    "TPMAP_PHASE30D_ROI_CANDIDATE_EVALUATION_V3",
    "distance_input = reference_distance[top:bottom + th - 1, left:right + tw - 1]",
    "local_matrix[:, 2] -= np.asarray([x0, y0]",
    "reference_distance_roi = reference_distance[y0:y1, x0:x1]",
    "roi_w, roi_h = x1 - x0, y1 - y0"
  ]) if (!source.includes(token)) throw new Error(`ROI automatic-registration validation missing: ${token}`);
  const candidate = extractPythonFunction(source, "evaluate_candidate");
  if (candidate.includes("(ref_w, ref_h)")) throw new Error("candidate evaluation still warps to full reference canvas");
  if (candidate.includes("reference_distance = cv2.distanceTransform")) throw new Error("candidate evaluation recomputes reference distance");
}

function replaceJsFunction(source, marker, replacement) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`JS function anchor missing: ${marker}`);
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error(`JS function anchor ambiguous: ${marker}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`JS function body start missing: ${marker}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(index + 1);
    }
  }
  throw new Error(`JS function body end missing: ${marker}`);
}

function extractJsFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`JS function missing: ${marker}`);
  const next = source.indexOf("\nfunction ", start + marker.length);
  const nextAsync = source.indexOf("\nasync function ", start + marker.length);
  const candidates = [next, nextAsync].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function replacePythonFunction(source, name, replacement) {
  const marker = `def ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Python function anchor missing: ${name}`);
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error(`Python function anchor ambiguous: ${name}`);
  const next = source.indexOf("\ndef ", start + marker.length);
  const end = next >= 0 ? next + 1 : source.length;
  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

function extractPythonFunction(source, name) {
  const marker = `def ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Python function missing: ${name}`);
  const next = source.indexOf("\ndef ", start + marker.length);
  return source.slice(start, next >= 0 ? next : source.length);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`anchor missing: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`anchor ambiguous: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function runSelfTest() {
  const georeferenceFixture = `const TPMAP_PHASE30D_BOUNDED_PLANNING_PROCESSING = true;
const TPMAP_PHASE30D_GEOREFERENCE_PRIORITY_PERFORMANCE_V2 = true;
async function demo(runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report) {
  const rejectionReasons = {};
  for (const item of report.documents) {
    if (item?.status === "accepted") continue;
    const reason = String(item?.reason || item?.status || "unknown");
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  }
  report.processing.rejectionReasons = Object.fromEntries(Object.entries(rejectionReasons).sort(([a], [b]) => a.localeCompare(b)));
  console.error(\`TPMAP planning georeference rejection reasons: \${JSON.stringify(report.processing.rejectionReasons)}\`);
  console.error(\`TPMAP planning georeference complete: considered=\${report.documentsConsidered} accepted=\${report.accepted} rejected=\${report.rejected} errors=\${report.errors} cacheHits=\${report.processing.cacheHits} cacheMisses=\${report.processing.cacheMisses}\`);
  if (config.automaticEnabled) {
    await applyAutomaticConsensus({ runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report });
  }
}
async function applyAutomaticConsensus({ runtime, options, config, bbox, documents, cacheDirectory, derivedDirectory, report }) {
  for (const id of []) { await warpPlanningPage(id); }
}
function planningProcessingConcurrency() { return 4; }
async function mapConcurrent(items, concurrency, worker) { return Promise.all(items.map(worker)); }
function automaticConsensusGroups() { return { accepted: new Set(), evidence: [], minimumDocuments: 2, minimumConfidence: .72, maxSeparationM: 140 }; }
async function locateCachedDocument() {}
async function normalizeManifestCandidate() {}
async function validateControlPointCandidate() { return { accepted: false }; }
async function warpPlanningPage() {}
function acceptedControlPointResult() {}
`;
  const transformedGeoref = transformGeoreference(georeferenceFixture);
  validateGeoreference(transformedGeoref);
  if (transformedGeoref.indexOf("emitPlanningGeoreferenceFinalTelemetry(report)") < transformedGeoref.indexOf("await applyAutomaticConsensus")) {
    throw new Error("telemetry did not move after consensus");
  }

  const pythonFixture = `# TPMAP_PHASE30D_AUTOREGISTRATION_HOTPATH_V2
import cv2
import numpy as np
import math
def search_registration(crop_edges, anchor, crop_origin, image_shape, bbox, reference, reference_distance, source_edges, dpi, denominator, angles, location):
    return []

def transformed_template(source, anchor, scale, angle):
    return None, None, None

def evaluate_candidate(crop_edges, matrix, reference, reference_distance, source_edges, bbox, crop_origin, image_shape, denominator, angle, location, anchor_ref):
    ref_h, ref_w = reference.shape
    warped = cv2.warpAffine(source_edges, matrix, (ref_w, ref_h))
    return None

def reference_metres_per_pixel(bbox, width, height):
    return 1, 1

def reference_offset_metres(point, location, bbox, width, height):
    return 0
`;
  const transformedPython = transformPython(pythonFixture);
  validatePython(transformedPython);
  console.log("Phase 30D ROI/consensus runtime self-test passed");
}
