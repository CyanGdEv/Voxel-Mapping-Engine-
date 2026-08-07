#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MARKER = 'TPMAP_PHASE30A_AUTHORITY_INSTALLER_V2';

function parseArgs(argv) {
  const out = { selfTest: false, generator: null, validateOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') out.selfTest = true;
    else if (arg === '--generator') out.generator = argv[++i];
    else if (arg === '--validate-only') out.validateOnly = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

function replaceIfNeeded(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  if (!text.includes(oldText)) throw new Error(`Phase 30A transform anchor missing: ${label}`);
  return text.replace(oldText, newText);
}

function insertBefore(text, anchor, addition, label) {
  if (text.includes(addition.trim())) return text;
  const index = text.indexOf(anchor);
  if (index < 0) throw new Error(`Phase 30A insertion anchor missing: ${label}`);
  return text.slice(0, index) + addition + text.slice(index);
}

export function transformPlanningVectorFusion(text) {
  let out = text;
  out = replaceIfNeeded(
    out,
    'currentLayout: "Implemented, existing and as-built geometry may fill gaps. Approved-only geometry may repair a matching OSM feature but cannot create a missing feature in gated mode."',
    'currentLayout: "Accepted planning drawing geometry is the primary geometry authority after provenance, georeference, confidence and status gates. Approved, implemented, existing and as-built layouts may replace OSM and fill missing geometry; refused, withdrawn, superseded and unresolved proposals remain withheld."',
    'planning-vector-fusion currentLayout policy'
  );
  out = replaceIfNeeded(
    out,
    'authority: "Promotion is not acceptance. The existing planning-authority matcher still applies confidence, overlap, displacement and ambiguity gates before changing the normalized map."',
    'authority: "Promotion is not acceptance. Provenance, georeference, confidence and status gates still apply, but accepted planning drawing geometry supersedes conflicting OSM geometry and is retained even when OSM is equivalent."',
    'planning-vector-fusion authority policy'
  );
  out = replaceIfNeeded(
    out,
    'const authoritative = mode === "authoritative";',
    'const authoritative = !["off", "review"].includes(mode);',
    'approved planning authority state'
  );
  if (!out.includes('planning_authoritative: true')) {
    const anchor = '        planning_allow_gap_fill: state.gapFillAllowed,\n';
    if (!out.includes(anchor)) throw new Error('Phase 30A planning tag anchor missing');
    out = out.replace(anchor, `${anchor}        planning_authoritative: true,\n        planning_qa: true,\n        planning_qa_block: "minecraft:pink_wool",\n`);
  }
  return out;
}

export function transformSourceFusion(text) {
  let out = text;
  out = replaceIfNeeded(
    out,
    'planningAuthority: "planning geometry may fill gaps or replace OSM only after role, status, confidence, overlap and ambiguity gates"',
    'planningAuthority: "accepted planning drawing geometry is the primary geometry authority after provenance, georeference, confidence and status gates; it replaces compatible OSM geometry and fills missing geometry"',
    'source-fusion policy text'
  );

  if (!out.includes('feature.source.replacedSources = replaced.map')) {
    const functionStart = out.indexOf('function planningAuthorityMergeDecision(feature, existing, accepted, config)');
    if (functionStart < 0) throw new Error('Phase 30A planningAuthorityMergeDecision function missing');
    const start = out.indexOf('  const best = candidates[0];', functionStart);
    const end = out.indexOf('\n}\n\nfunction planningFeaturePolicy', start);
    if (start < 0 || end < 0) throw new Error('Phase 30A planningAuthorityMergeDecision replacement boundaries missing');
    const replacement = `  const best = candidates[0];\n  if (config.mode === "off" || !policy.overrideEligible) {\n    return { action: "conflict-withheld", accept: false, policy, targetId: best.candidate.id, metrics: best.metrics };\n  }\n\n  // Phase 30A authority: after the existing provenance/georeference/confidence/status\n  // gates have accepted a planning drawing, it is the geometry authority. Remove\n  // every materially compatible OSM candidate rather than preserving equivalent\n  // or ambiguous alternatives as the authoritative geometry.\n  const replaced = [];\n  for (const entry of candidates) {\n    const index = existing.indexOf(entry.candidate);\n    if (index < 0) continue;\n    existing.splice(index, 1);\n    replaced.push(entry);\n  }\n  if (!replaced.length) return { action: "conflict-withheld", accept: false, policy, targetId: best.candidate.id, metrics: best.metrics };\n\n  inheritMissingFeatureEvidence(feature, best.candidate);\n  feature.source.replaces = replaced.map((entry) => entry.candidate.id).join(",");\n  feature.source.replacedSource = compactReplacedSource(best.candidate);\n  feature.source.replacedSources = replaced.map((entry) => compactReplacedSource(entry.candidate));\n  feature.source.planningDecision = {\n    action: "override-osm",\n    confidence: policy.confidence,\n    status: policy.status,\n    role: policy.role,\n    equivalent: Boolean(best.metrics.equivalent),\n    replacedCount: replaced.length,\n    metrics: compactMatchMetrics(best.metrics)\n  };\n  feature.verification.plan = "planning-authority-override";\n  feature.tags.planning_override = "yes";\n  feature.tags.planning_authoritative = "yes";\n  return {\n    action: "override-osm", accept: true, policy,\n    targetId: best.candidate.id,\n    replacedTargetIds: replaced.map((entry) => entry.candidate.id),\n    metrics: best.metrics\n  };`;
    out = out.slice(0, start) + replacement + out.slice(end);
  }

  if (!out.includes('const explicitlyAuthoritative = booleanTag(tags.planning_authoritative);')) {
    const anchor = '  const roleAllows = ["authoritative-feature", "as-built", "implemented-layout", "approved-layout"].includes(role);\n';
    if (!out.includes(anchor)) throw new Error('Phase 30A planningFeaturePolicy role anchor missing');
    out = out.replace(anchor, `${anchor}  const explicitlyAuthoritative = booleanTag(tags.planning_authoritative);\n`);
  }
  out = replaceIfNeeded(
    out,
    '  const statusAllowed = !blocked && (currentAuthorityDataset || implemented || implementedStatus || approvedTargetRepair ||\n    (config.mode === "authoritative" && approvedStatus));',
    '  const statusAllowed = !blocked && (currentAuthorityDataset || implemented || implementedStatus || approvedTargetRepair ||\n    explicitlyAuthoritative || (config.mode === "authoritative" && approvedStatus));',
    'source-fusion status authority'
  );
  out = replaceIfNeeded(
    out,
    '  const overrideEligible = roleAllows && statusAllowed &&\n    (role !== "approved-layout" || implemented || implementedStatus || requiresExistingTarget || config.mode === "authoritative");\n  const gapFillEligible = roleAllows && statusAllowed && explicitGapFill && !requiresExistingTarget;',
    '  const overrideEligible = roleAllows && statusAllowed &&\n    (explicitlyAuthoritative || role !== "approved-layout" || implemented || implementedStatus || requiresExistingTarget || config.mode === "authoritative");\n  const gapFillEligible = roleAllows && statusAllowed && explicitGapFill &&\n    (explicitlyAuthoritative || !requiresExistingTarget);',
    'source-fusion override/gap-fill authority'
  );
  out = replaceIfNeeded(
    out,
    '    requiresExistingTarget, privateUseOnly, planningVectorDataset\n',
    '    requiresExistingTarget, privateUseOnly, planningVectorDataset, explicitlyAuthoritative\n',
    'source-fusion policy return'
  );
  return out;
}

export function transformRaster(text) {
  let out = text;
  const qaConstants = `const PLANNING_QA_BLOCK = "minecraft:pink_wool";\nconst PLANNING_QA_SURFACE_STYLE = {\n  schemaVersion: 1,\n  role: "planning-provenance-qa",\n  primaryBlock: PLANNING_QA_BLOCK,\n  secondaryBlock: PLANNING_QA_BLOCK,\n  pattern: "solid",\n  appearanceStatus: "planning-authority-pink-qa"\n};\n\n`;
  if (!out.includes('role: "planning-provenance-qa"')) {
    out = insertBefore(out, 'const BASE_SURFACE_STYLES', qaConstants, 'planning QA constants');
  }

  const replacements = [
    ['else if (feature.kind === "rail") add(3, x1, terrainY + 1, z, x2, terrainY + 1, z, "minecraft:iron_block");', 'else if (feature.kind === "rail") add(3, x1, terrainY + 1, z, x2, terrainY + 1, z, planningQaBlock(feature, "minecraft:iron_block"));', 'rail QA'],
    ['else if (feature.kind === "ride_support") add(3, x1, terrainY + 1, z, x2, terrainY + 3, z, "minecraft:iron_bars");', 'else if (feature.kind === "ride_support") add(3, x1, terrainY + 1, z, x2, terrainY + 3, z, planningQaBlock(feature, "minecraft:iron_bars"));', 'ride support QA'],
    ['add(3, x1, terrainY + 2, z, x2, terrainY + 2, z, "minecraft:orange_concrete");', 'add(3, x1, terrainY + 2, z, x2, terrainY + 2, z, planningQaBlock(feature, "minecraft:orange_concrete"));', 'flat ride QA'],
    ['add(3, x1, verifiedY, z, x2, verifiedY, z, "minecraft:red_concrete");', 'add(3, x1, verifiedY, z, x2, verifiedY, z, planningQaBlock(feature, "minecraft:red_concrete"));', 'vertical ride QA'],
    ['add(3, cell.x, terrainY + 1, cell.z, cell.x, deckY - 1, cell.z, "minecraft:iron_bars");', 'add(3, cell.x, terrainY + 1, cell.z, cell.x, deckY - 1, cell.z, planningQaBlock(feature, "minecraft:iron_bars"));', 'bridge support QA'],
    ['add(4, cell.x, roofY, cell.z, cell.x, roofY, cell.z, "minecraft:spruce_planks");', 'add(4, cell.x, roofY, cell.z, cell.x, roofY, cell.z, planningQaBlock(feature, "minecraft:spruce_planks"));', 'bridge roof QA'],
    ['emitVoxelRuns(add, 6, tunnelLining, "minecraft:tuff");', 'const planningQa = isPlanningQaFeature(feature);\n  emitVoxelRuns(add, 6, tunnelLining, planningQa ? PLANNING_QA_BLOCK : "minecraft:tuff");', 'ride tunnel QA declaration'],
    ['emitVoxelRuns(add, 8, portalVoxels, "minecraft:stone_bricks");', 'emitVoxelRuns(add, 8, portalVoxels, planningQa ? PLANNING_QA_BLOCK : "minecraft:stone_bricks");', 'ride portal QA'],
    ['emitVoxelRuns(add, 8, supportVoxels, "minecraft:iron_bars");', 'emitVoxelRuns(add, 8, supportVoxels, planningQa ? PLANNING_QA_BLOCK : "minecraft:iron_bars");', 'ride support voxel QA'],
    ['emitVoxelRuns(add, 8, supportFootingVoxels, "minecraft:yellow_concrete");', 'emitVoxelRuns(add, 8, supportFootingVoxels, planningQa ? PLANNING_QA_BLOCK : "minecraft:yellow_concrete");', 'ride footing QA'],
    ['add(9, voxel.x, voxel.y, voxel.z, voxel.x, voxel.y, voxel.z, voxel.block);', 'add(9, voxel.x, voxel.y, voxel.z, voxel.x, voxel.y, voxel.z, planningQa ? PLANNING_QA_BLOCK : voxel.block);', 'ride track voxel QA'],
    ['add(2, run.x1, run.value, z, run.x2, run.value, z, "minecraft:yellow_concrete");', 'add(2, run.x1, run.value, z, run.x2, run.value, z, planningQaBlock(feature, "minecraft:yellow_concrete"));', 'building footprint QA'],
    ['add(2, x, terrainY, z, x, terrainY, z, "minecraft:yellow_concrete");', 'add(2, x, terrainY, z, x, terrainY, z, planningQaBlock(feature, "minecraft:yellow_concrete"));', 'point building QA'],
    ['add(5, sign.x, terrainY, sign.z, sign.x, terrainY, sign.z, "minecraft:yellow_concrete");', 'add(5, sign.x, terrainY, sign.z, sign.x, terrainY, sign.z, planningQaBlock(feature, "minecraft:yellow_concrete"));', 'building sign QA']
  ];
  for (const [oldText, newText, label] of replacements) {
    if (!out.includes(newText) && out.includes(oldText)) out = out.replace(oldText, newText);
    else if (!out.includes(newText) && !out.includes(oldText)) throw new Error(`Phase 30A raster anchor missing: ${label}`);
  }

  if (!out.includes('if (isPlanningQaFeature(feature)) {\n        compilePlanningQaGeometry')) {
    const vegAnchor = '    if (feature.kind === "vegetation") {\n';
    if (!out.includes(vegAnchor)) throw new Error('Phase 30A vegetation QA anchor missing');
    out = out.replace(vegAnchor, `${vegAnchor}      if (isPlanningQaFeature(feature)) {\n        compilePlanningQaGeometry({ add, feature, mask, elevationY, minX, minZ, width, height });\n        continue;\n      }\n`);
    const terrainAnchor = '    if (feature.kind === "terrain_detail") {\n';
    if (!out.includes(terrainAnchor)) throw new Error('Phase 30A terrain-detail QA anchor missing');
    out = out.replace(terrainAnchor, `${terrainAnchor}      if (isPlanningQaFeature(feature)) {\n        compilePlanningQaGeometry({ add, feature, mask, elevationY, minX, minZ, width, height });\n        continue;\n      }\n`);
  }

  if (!out.includes('const block = isPlanningQaFeature(feature)')) {
    const oldBlock = `    const block = planOnly\n      ? "minecraft:orange_concrete"\n      : blockForSurfaceStyle(feature.surfaceStyle, cell.x, cell.z, seed);`;
    const newBlock = `    const block = isPlanningQaFeature(feature)\n      ? PLANNING_QA_BLOCK\n      : planOnly\n        ? "minecraft:orange_concrete"\n        : blockForSurfaceStyle(feature.surfaceStyle, cell.x, cell.z, seed);`;
    out = replaceIfNeeded(out, oldBlock, newBlock, 'bridge deck QA');
  }
  if (!out.includes('const railBlock = isPlanningQaFeature(feature)')) {
    const oldRail = `    const railBlock = ["boardwalk", "covered"].includes(evidence.structure)\n      ? "minecraft:oak_fence"\n      : "minecraft:iron_bars";`;
    const newRail = `    const railBlock = isPlanningQaFeature(feature)\n      ? PLANNING_QA_BLOCK\n      : ["boardwalk", "covered"].includes(evidence.structure)\n        ? "minecraft:oak_fence"\n        : "minecraft:iron_bars";`;
    out = replaceIfNeeded(out, oldRail, newRail, 'bridge rail QA');
  }
  if (!out.includes('const planningQa = isPlanningQaFeature(feature);\n  const code = planningQa')) {
    const oldCode = '  const code = accessCode ? registerSurfaceStyle(feature.surfaceStyle) : baseCode;';
    const newCode = `  const planningQa = isPlanningQaFeature(feature);\n  const code = planningQa\n    ? registerSurfaceStyle(PLANNING_QA_SURFACE_STYLE)\n    : accessCode ? registerSurfaceStyle(feature.surfaceStyle) : baseCode;`;
    out = replaceIfNeeded(out, oldCode, newCode, 'surface QA style');
  }

  const helperBlock = `function isPlanningQaFeature(feature) {\n  const tags = feature?.tags || {};\n  const dataset = String(feature?.source?.dataset || tags.source_dataset || "").toLowerCase();\n  return tags.planning_qa === true || String(tags.planning_qa).toLowerCase() === "true" ||\n    dataset === "planning-drawing-vector";\n}\n\nfunction planningQaBlock(feature, fallback) {\n  return isPlanningQaFeature(feature) ? PLANNING_QA_BLOCK : fallback;\n}\n\nfunction compilePlanningQaGeometry({ add, feature, mask, elevationY, minX, minZ, width, height }) {\n  let blocks = 0;\n  const place = (x, z, top = 1) => {\n    const index = cellIndex(x, z, minX, minZ, width, height);\n    if (index < 0 || !mask[index]) return;\n    const y = elevationY[index];\n    add(4, x, y + 1, z, x, y + top, z, PLANNING_QA_BLOCK);\n    blocks += top;\n  };\n  if (feature.localGeometry?.type === "Point") {\n    place(Math.round(feature.localGeometry.coordinates[0]), Math.round(feature.localGeometry.coordinates[1]), 3);\n    return blocks;\n  }\n  for (const line of lineStrings(feature.localGeometry)) {\n    for (const [x, z] of lineCells(line, 1)) place(x, z, 2);\n  }\n  for (const polygon of polygonParts(feature.localGeometry)) {\n    for (const [x1, x2, z] of polygonScanlineSpans(polygon)) {\n      for (let x = x1; x <= x2; x += 1) place(x, z, 1);\n    }\n  }\n  return blocks;\n}\n\n`;
  if (!out.includes('function isPlanningQaFeature(feature)')) {
    out = insertBefore(out, 'function buildingBlock(feature)', helperBlock, 'planning QA helper functions');
  }

  const guards = [
    ['function buildingBlock(feature) {\n', 'function buildingBlock(feature) {\n  if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;\n', 'building block QA'],
    ['function roofBlock(feature) {\n', 'function roofBlock(feature) {\n  if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;\n', 'roof block QA'],
    ['function buildingFloorBlock(feature) {\n', 'function buildingFloorBlock(feature) {\n  if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;\n', 'building floor QA'],
    ['function barrierBlock(feature) {\n', 'function barrierBlock(feature) {\n  if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;\n', 'barrier block QA'],
    ['function detailMarkerBlock(feature) {\n', 'function detailMarkerBlock(feature) {\n  if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;\n', 'detail marker QA']
  ];
  for (const [oldText, newText, label] of guards) {
    if (!out.includes(newText)) out = replaceIfNeeded(out, oldText, newText, label);
  }
  return out;
}

async function applyToGenerator(generator, validateOnly = false) {
  const root = path.resolve(generator);
  const files = {
    vectorFusion: path.join(root, 'src/lib/planning-vector-fusion.mjs'),
    sourceFusion: path.join(root, 'src/lib/source-fusion.mjs'),
    raster: path.join(root, 'src/lib/raster.mjs')
  };
  const original = {
    vectorFusion: await readFile(files.vectorFusion, 'utf8'),
    sourceFusion: await readFile(files.sourceFusion, 'utf8'),
    raster: await readFile(files.raster, 'utf8')
  };
  const transformed = {
    vectorFusion: transformPlanningVectorFusion(original.vectorFusion),
    sourceFusion: transformSourceFusion(original.sourceFusion),
    raster: transformRaster(original.raster)
  };
  validateTransformed(transformed);
  if (!validateOnly) {
    for (const key of Object.keys(files)) {
      if (transformed[key] !== original[key]) await writeFile(files[key], transformed[key], 'utf8');
    }
  }
  return {
    status: validateOnly ? 'validated' : 'installed',
    marker: MARKER,
    changed: Object.fromEntries(Object.keys(files).map((key) => [key, transformed[key] !== original[key]]))
  };
}

function validateTransformed(files) {
  const required = [
    [files.vectorFusion, 'planning_authoritative: true', 'planning-vector-fusion authoritative tag'],
    [files.vectorFusion, 'const authoritative = !["off", "review"].includes(mode);', 'approved planning gap-fill policy'],
    [files.sourceFusion, 'feature.source.replacedSources = replaced.map', 'multi-OSM replacement authority'],
    [files.sourceFusion, 'explicitlyAuthoritative || (config.mode === "authoritative" && approvedStatus)', 'source-fusion explicit authority'],
    [files.raster, 'role: "planning-provenance-qa"', 'pink QA surface style'],
    [files.raster, 'function compilePlanningQaGeometry', 'pink QA geometry compiler'],
    [files.raster, 'planningQa ? PLANNING_QA_BLOCK : voxel.block', 'ride-track pink QA'],
    [files.raster, 'if (isPlanningQaFeature(feature)) return PLANNING_QA_BLOCK;', 'shape pink QA']
  ];
  for (const [text, marker, label] of required) {
    if (!text.includes(marker)) throw new Error(`Phase 30A validation failed: ${label}`);
  }
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-phase30a-installer-'));
  try {
    const vectorFixture = `const x={currentLayout: "Implemented, existing and as-built geometry may fill gaps. Approved-only geometry may repair a matching OSM feature but cannot create a missing feature in gated mode.",authority: "Promotion is not acceptance. The existing planning-authority matcher still applies confidence, overlap, displacement and ambiguity gates before changing the normalized map."};\nfunction f(){const authoritative = mode === "authoritative"; return {\n        planning_allow_gap_fill: state.gapFillAllowed,\n};}`;
    const vector = transformPlanningVectorFusion(vectorFixture);
    if (!vector.includes('planning_authoritative: true') || !vector.includes('!["off", "review"]')) throw new Error('planning-vector-fusion self-test failed');

    const sourceFixture = `const p={planningAuthority: "planning geometry may fill gaps or replace OSM only after role, status, confidence, overlap and ambiguity gates"};\nfunction planningAuthorityMergeDecision(feature, existing, accepted, config) { const candidates=[]; const policy={};\n  const best = candidates[0];\n  const second = candidates[1];\n  if (second && second.metrics.score >= Math.max(config.minOverlap, best.metrics.score * 0.9)) { return { action: "ambiguous-withheld" }; }\n  if (best.metrics.equivalent) { return { action: "corroborated" }; }\n  if (config.mode === "off" || !policy.overrideEligible) { return { action: "conflict-withheld" }; }\n  const index = existing.indexOf(best.candidate); existing.splice(index,1); inheritMissingFeatureEvidence(feature,best.candidate); feature.source.replaces=best.candidate.id; return {action:"override-osm"};\n}\n\nfunction planningFeaturePolicy(){\n  const roleAllows = ["authoritative-feature", "as-built", "implemented-layout", "approved-layout"].includes(role);\n  const statusAllowed = !blocked && (currentAuthorityDataset || implemented || implementedStatus || approvedTargetRepair ||\n    (config.mode === "authoritative" && approvedStatus));\n  const overrideEligible = roleAllows && statusAllowed &&\n    (role !== "approved-layout" || implemented || implementedStatus || requiresExistingTarget || config.mode === "authoritative");\n  const gapFillEligible = roleAllows && statusAllowed && explicitGapFill && !requiresExistingTarget;\n  return {\n    requiresExistingTarget, privateUseOnly, planningVectorDataset\n  };\n}`;
    const source = transformSourceFusion(sourceFixture);
    if (!source.includes('replacedSources') || !source.includes('explicitlyAuthoritative')) throw new Error('source-fusion self-test failed');
    console.log('Phase 30A deterministic authority installer self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.generator) throw new Error('Usage: install-phase30a-authority.mjs --generator <generator-root> [--validate-only]');
    console.log(JSON.stringify(await applyToGenerator(options.generator, options.validateOnly)));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
