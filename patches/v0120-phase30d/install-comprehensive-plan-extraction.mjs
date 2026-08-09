#!/usr/bin/env node
// TPMAP_PHASE30D_COMPREHENSIVE_PLAN_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  COMPREHENSIVE_PLAN_CLASSES,
  classifyComprehensivePlanningLabel,
  comprehensivePointRole
} from "./planning-comprehensive-semantics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const generatorIndex = args.indexOf("--generator");
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const selfTest = args.includes("--self-test");
const validateOnly = args.includes("--validate-only");

if (selfTest) {
  runSelfTest();
} else if (!generator) {
  throw new Error("--generator is required");
} else {
  await install(generator, validateOnly);
}

async function install(root, validate) {
  const vectorFile = path.join(root, "src/lib/planning-vectorize.mjs");
  const fusionFile = path.join(root, "src/lib/planning-vector-fusion.mjs");
  const rasterFile = path.join(root, "src/lib/raster.mjs");
  const sourceFusionFile = path.join(root, "src/lib/source-fusion.mjs");
  const osmFile = path.join(root, "src/lib/osm.mjs");
  const argsFile = path.join(root, "src/lib/args.mjs");
  const georeferenceFile = path.join(root, "src/lib/planning-georeference.mjs");
  const moduleFile = path.join(root, "src/lib/planning-comprehensive-semantics.mjs");
  const rasterModuleFile = path.join(root, "src/lib/planning-raster-extraction.mjs");
  const worldAuthorityModuleFile = path.join(root, "src/lib/planning-world-authority.mjs");
  const pythonFile = path.join(root, "src/tools/planning_raster_vectorize.py");
  const testFile = path.join(root, "test/planning-comprehensive-semantics.test.mjs");
  const worldAuthorityTestFile = path.join(root, "test/planning-world-authority.test.mjs");
  const vectorFusionTestFile = path.join(root, "test/planning-vector-fusion.test.mjs");

  if (!validate) {
    await mkdir(path.dirname(pythonFile), { recursive: true });
    await writeFile(moduleFile, await readFile(path.join(here, "planning-comprehensive-semantics.mjs"), "utf8"));
    await writeFile(rasterModuleFile, await readFile(path.join(here, "planning-raster-extraction.mjs"), "utf8"));
    await writeFile(worldAuthorityModuleFile, await readFile(path.join(here, "planning-world-authority.mjs"), "utf8"));
    await writeFile(pythonFile, await readFile(path.join(here, "planning-raster-vectorize.py"), "utf8"));
    await writeFile(testFile, await readFile(path.join(here, "planning-comprehensive-semantics.test.mjs"), "utf8"));
    await writeFile(worldAuthorityTestFile, await readFile(path.join(here, "planning-world-authority.test.mjs"), "utf8"));

    const vectorSource = await readFile(vectorFile, "utf8");
    await writeFile(vectorFile, transformVectorize(vectorSource));
    const fusionSource = await readFile(fusionFile, "utf8");
    await writeFile(fusionFile, transformFusion(fusionSource));
    const georeferenceSource = await readFile(georeferenceFile, "utf8");
    await writeFile(georeferenceFile, transformGeoreference(georeferenceSource));
    const rasterSource = await readFile(rasterFile, "utf8");
    await writeFile(rasterFile, transformRaster(rasterSource));
    const sourceFusionSource = await readFile(sourceFusionFile, "utf8");
    await writeFile(sourceFusionFile, transformSourceFusion(sourceFusionSource));
    const osmSource = await readFile(osmFile, "utf8");
    await writeFile(osmFile, transformOsm(osmSource));
    const argsSource = await readFile(argsFile, "utf8");
    await writeFile(argsFile, transformArgs(argsSource));
    const vectorFusionTestSource = await readFile(vectorFusionTestFile, "utf8");
    await writeFile(vectorFusionTestFile, transformVectorFusionTest(vectorFusionTestSource));
  }

  await validateInstallation({
    vectorFile, fusionFile, rasterFile, sourceFusionFile, osmFile, argsFile, georeferenceFile,
    moduleFile, rasterModuleFile, worldAuthorityModuleFile, pythonFile, testFile, worldAuthorityTestFile,
    vectorFusionTestFile
  });
  console.log(JSON.stringify({ status: validate ? "validated" : "installed", marker: "TPMAP_PHASE30D_COMPREHENSIVE_PLAN_DATA" }));
}

export function transformVectorize(source) {
  if (source.includes("TPMAP_PHASE30D_COMPREHENSIVE_VECTOR_PIPELINE")) return source;
  let output = source;
  output = replaceOnce(output,
    'import { promisify } from "node:util";',
    'import { promisify } from "node:util";\n' +
    'import { classifyComprehensivePlanningLabel, comprehensiveSemanticGeometryRole, associateComprehensivePlanningLabel, comprehensivePointRole, mergePlanningSemanticAnchors } from "./planning-comprehensive-semantics.mjs";\n' +
    'import { extractRasterPlanningPage } from "./planning-raster-extraction.mjs";\n' +
    'const TPMAP_PHASE30D_COMPREHENSIVE_VECTOR_PIPELINE = true;',
    "Phase 30D imports");

  output = output
    .replace('integer(options.planningVectorizeMaxDocuments, 30, 1, 200)', 'integer(options.planningVectorizeMaxDocuments, 500, 1, 500)')
    .replace('integer(options.planningVectorizeMaxFeatures, 12_000, 1, 100_000)', 'integer(options.planningVectorizeMaxFeatures, 500_000, 1, 500_000)')
    .replace('integer(options.planningVectorizeMaxFeaturesPerDocument, 2_000, 1, 20_000)', 'integer(options.planningVectorizeMaxFeaturesPerDocument, 100_000, 1, 100_000)');
  output = output.replace(
    'const LINE_ROLES = new Set(["ride-layout", "access-plan", "terrain-or-drainage", "lighting-plan", "site-plan", "block-plan", "landscape-plan"]);',
    'const LINE_ROLES = new Set(["ride-layout", "access-plan", "terrain-or-drainage", "lighting-plan", "site-plan", "block-plan", "location-plan", "landscape-plan", "elevation", "section", "floor-plan"]);'
  );
  output = output.replace(
    'const POLYGON_ROLES = new Set(["site-plan", "block-plan", "landscape-plan", "ride-layout", "floor-plan", "terrain-or-drainage", "access-plan", "lighting-plan"]);',
    'const POLYGON_ROLES = new Set(["site-plan", "block-plan", "location-plan", "landscape-plan", "ride-layout", "floor-plan", "terrain-or-drainage", "access-plan", "lighting-plan", "elevation", "section"]);'
  );

  output = replaceOnce(output,
    '    byRole: {},\n    documents: [],',
    '    byRole: {},\n    excludedByReason: {},\n    documents: [],',
    "global exclusion diagnostics");
  output = replaceOnce(output,
    '      if (entry.document.mime !== "application/pdf") {\n        rejectDocument(report, entry, "raster-document-vectorization-not-enabled");\n        continue;\n      }',
    '      if (entry.document.mime !== "application/pdf" && !String(entry.document.mime || "").startsWith("image/")) {\n        rejectDocument(report, entry, "unsupported-planning-document-mime");\n        continue;\n      }',
    "raster document eligibility");
  output = replaceOnce(output,
    '      const svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n' +
    '      const parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n' +
    '      const semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);',
    '      let svg = "";\n' +
    '      let parsed = { width: 1, height: 1, viewBox: [0, 0, 1, 1], shapes: [] };\n' +
    '      let semantic = { anchors: [], source: "unavailable" };\n' +
    '      if (entry.document.mime === "application/pdf") {\n' +
    '        svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n' +
    '        parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n' +
    '        semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);\n' +
    '      }\n' +
    '      if (entry.document.mime !== "application/pdf" || parsed.shapes.length === 0) {\n' +
    '        const raster = await extractRasterPlanningPage({ filename: sourceFile, page: entry.georeference.page || 1, workDirectory, document: entry.document });\n' +
    '        const rasterParsed = parseSvgDrawing(raster.svg, { curveTolerance: config.curveTolerance });\n' +
    '        if (rasterParsed.shapes.length >= parsed.shapes.length) { svg = raster.svg; parsed = rasterParsed; }\n' +
    '        semantic = mergePlanningSemanticAnchors(semantic, raster.semantic);\n' +
    '      }',
    "vector plus raster extraction");
  output = replaceOnce(output,
    '      report.featuresWithheld += extracted.withheld + Math.max(0, extracted.features.length - acceptedFeatures.length);',
    '      report.featuresWithheld += extracted.withheld + Math.max(0, extracted.features.length - acceptedFeatures.length);\n' +
    '      for (const [reason, amount] of Object.entries(extracted.withheldReasons || {})) report.excludedByReason[reason] = (report.excludedByReason[reason] || 0) + amount;',
    "aggregate exclusion diagnostics");
  output = replaceOnce(output,
    '        semanticMatches: extracted.semanticMatches,\n        svgSha256: sha256Text(svg)',
    '        semanticMatches: extracted.semanticMatches,\n        withheldReasons: extracted.withheldReasons,\n        semanticSource: semantic.source,\n        svgSha256: sha256Text(svg)',
    "document semantic diagnostics");

  output = output.replace(
    /const tokenPattern = \/<\\\/\?g\\b\[\^>\]\*>\|<\(\?:path\|polyline\|polygon\|line\|rect\)\\b\[\^>\]\*\\\/\?\\s\*>\/gi;/,
    'const tokenPattern = /<\\/?g\\b[^>]*>|<(?:path|polyline|polygon|line|rect|circle|ellipse)\\b[^>]*\\/?\\s*>/gi;'
  );
  if (!output.includes('(?:path|polyline|polygon|line|rect|circle|ellipse)')) throw new Error("Phase 30D SVG shape token anchor missing");
  output = replaceOnce(output,
    '        strokeWidth: svgLength(style.strokeWidth, 1),\n        opacity:',
    '        strokeWidth: svgLength(style.strokeWidth, 1),\n        strokeDasharray: style.strokeDasharray || null,\n        sourceClass: attribute(attrs, "class") || null,\n        sourceId: attribute(attrs, "id") || null,\n        opacity:',
    "SVG style metadata");
  output = replaceOnce(output,
    '  if (name === "rect") {',
    '  if (name === "circle" || name === "ellipse") {\n' +
    '    const cx = Number(attribute(attrs, "cx") || 0), cy = Number(attribute(attrs, "cy") || 0);\n' +
    '    const rx = Number(attribute(attrs, name === "circle" ? "r" : "rx"));\n' +
    '    const ry = Number(attribute(attrs, name === "circle" ? "r" : "ry"));\n' +
    '    if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return [];\n' +
    '    const steps = Math.max(16, Math.min(96, Math.ceil(Math.PI * Math.max(rx, ry) / Math.max(0.5, tolerance))));\n' +
    '    const points = Array.from({ length: steps + 1 }, (_, index) => ({ x: cx + rx * Math.cos(index / steps * Math.PI * 2), y: cy + ry * Math.sin(index / steps * Math.PI * 2) }));\n' +
    '    return [{ points, closed: true, curved: true }];\n' +
    '  }\n' +
    '  if (name === "rect") {',
    "circle and ellipse extraction");
  output = output.replace(
    'for(const key of ["stroke","fill","stroke-width","opacity","display","visibility"])',
    'for(const key of ["stroke","fill","stroke-width","stroke-dasharray","opacity","display","visibility"])'
  );

  output = replaceFunction(output, "export function classifyPlanningSemanticLabel", 'export function classifyPlanningSemanticLabel(value) { return classifyComprehensivePlanningLabel(value); }');
  output = replaceFunction(output, "function semanticGeometryRole", 'function semanticGeometryRole(semantic, closed, shape = {}) { return comprehensiveSemanticGeometryRole(semantic, closed, shape); }');
  output = replaceFunction(output, "function semanticTags", 'function semanticTags(semantic) { return comprehensiveSemanticGeometryRole(semantic, false)?.tags || {}; }');
  output = replaceFunction(output, "function associateSemanticLabel", 'function associateSemanticLabel(shape, anchors, radius) { return associateComprehensivePlanningLabel(shape, anchors, radius); }');

  output = replaceOnce(output,
    '  const pagePoints = parsed.shapes.flatMap((shape) => shape.points.map((point) => transformAffine(pageToBng, point)));',
    '  const semanticPointAnchors = (semantic.anchors || []).filter((anchor) => comprehensivePointRole(anchor.semantic));\n' +
    '  const pagePoints = [\n' +
    '    ...parsed.shapes.flatMap((shape) => shape.points.map((point) => transformAffine(pageToBng, point))),\n' +
    '    ...semanticPointAnchors.map((anchor) => transformAffine(pageToBng, { x: anchor.cx, y: anchor.cy }))\n' +
    '  ];',
    "semantic point coordinate transform");
  output = output.replace(
    'semanticGeometryRole(semanticMatch.anchor.semantic, shape.closed)',
    'semanticGeometryRole(semanticMatch.anchor.semantic, shape.closed, shape)'
  );
  output = replaceOnce(output,
    '    if (SEMANTIC_SITE_PLAN_ROLES.has(entry.document.role) && !semanticRole) {',
    '    if (semanticRole?.excluded) {\n' +
    '      withheld += 1;\n' +
    '      count(withheldReasons, semanticRole.reason || "planning-semantic-excluded");\n' +
    '      continue;\n' +
    '    }\n' +
    '    if (SEMANTIC_SITE_PLAN_ROLES.has(entry.document.role) && !semanticRole) {',
    "construction fence extraction exclusion");
  output = replaceOnce(output,
    '        semantic_class: semanticMatch?.anchor?.semantic?.className || null,',
    '        semantic_class: semanticMatch?.anchor?.semantic?.className || null,\n' +
    '        planning_feature_class: semanticMatch?.anchor?.semantic?.featureClass || null,\n' +
    '        planning_feature_state: semanticMatch?.anchor?.semantic?.state || null,\n' +
    '        semantic_confidence: semanticMatch?.anchor?.ocrConfidence ?? (semanticMatch ? 1 : null),',
    "typed semantic properties");

  output = replaceOnce(output,
    '  return { features, withheld, withheldReasons, semanticMatches };',
    semanticPointInsertion() + '\n  return { features, withheld, withheldReasons, semanticMatches };',
    "semantic point candidates");

  validateVector(output);
  return output;
}

export function transformFusion(source) {
  if (source.includes("TPMAP_PHASE30D_COMPREHENSIVE_FUSION")) return source;
  let output = source.replace(
    'const SUPPORTED_VECTOR_ROLES = new Map([',
    'const TPMAP_PHASE30D_COMPREHENSIVE_FUSION = true;\nconst SUPPORTED_VECTOR_ROLES = new Map(['
  );
  output = output.replace(
    'integer(options.planningVectorFusionMaxFeatures, 5_000, 1, 100_000)',
    'integer(options.planningVectorFusionMaxFeatures, 500_000, 1, 500_000)'
  );
  output = replaceOnce(output,
    '  ["site-terrain-change-line-candidate", { kind: "terrain_detail", subtype: "planning-level-or-earthwork-line", geometry: "line", priority: 88 }]\n]);',
    '  ["site-terrain-change-line-candidate", { kind: "terrain_detail", subtype: "planning-level-or-earthwork-line", geometry: "line", priority: 88 }],\n' +
    '  ["site-ride-support-candidate", { kind: "ride_support", subtype: "planning-ride-support", geometry: "line", priority: 116 }],\n' +
    '  ["site-ride-support-footing-candidate", { kind: "ride_support", subtype: "planning-ride-support-footing", geometry: "area", priority: 117 }],\n' +
    '  ["site-ride-support-point-candidate", { kind: "ride_support", subtype: "planning-ride-support-point", geometry: "point", priority: 118 }],\n' +
    '  ["ride-elevation-point-candidate", { kind: "detail", subtype: "planning-ride-elevation", geometry: "point", priority: 114 }],\n' +
    '  ["site-building-level-point-candidate", { kind: "detail", subtype: "planning-building-level", geometry: "point", priority: 107 }],\n' +
    '  ["site-water-level-point-candidate", { kind: "detail", subtype: "planning-water-level", geometry: "point", priority: 104 }],\n' +
    '  ["site-tree-point-candidate", { kind: "vegetation", subtype: "planning-tree", geometry: "point", priority: 101 }],\n' +
    '  ["site-tree-canopy-candidate", { kind: "vegetation", subtype: "planning-tree-canopy", geometry: "area", priority: 100 }],\n' +
    '  ["site-terrain-level-point-candidate", { kind: "detail", subtype: "planning-terrain-level", geometry: "point", priority: 99 }]\n' +
    ']);',
    "comprehensive fusion roles");
  output = replaceOnce(output,
    '    rejectedRole: 0,',
    '    rejectedRole: 0,\n    rejectedExcluded: 0,',
    "fusion exclusion diagnostics");
  output = replaceOnce(output,
    '    const role = String(properties.geometry_role || "");\n    const mapping = SUPPORTED_VECTOR_ROLES.get(role);',
    '    const role = String(properties.geometry_role || "");\n' +
    '    if (properties.planning_exclude_from_world === true || properties.planning_exclusion_reason === "temporary-construction-fence") {\n' +
    '      evidence.rejectedExcluded += 1;\n' +
    '      recordDecision(evidence, candidate, { action: "withheld-explicit-exclusion", role, reason: properties.planning_exclusion_reason || "planning-excluded" });\n' +
    '      continue;\n' +
    '    }\n' +
    '    const mapping = SUPPORTED_VECTOR_ROLES.get(role);',
    "fusion exclusion defense");
  output = replaceFunction(output, "function sizeEligible", 'function sizeEligible(properties, geometryType, config) {\n  if (geometryType === "point") return true;\n  if (geometryType === "line") return Number(properties.length_m) >= config.minLineLengthM;\n  return Number(properties.area_m2) >= config.minAreaM2;\n}');
  output = replaceFunction(output, "function geometryMatches", 'function geometryMatches(geometry, expected) {\n  if (!geometry) return false;\n  if (expected === "point") return ["Point", "MultiPoint"].includes(geometry.type);\n  if (expected === "line") return ["LineString", "MultiLineString"].includes(geometry.type);\n  return ["Polygon", "MultiPolygon"].includes(geometry.type);\n}');
  output = replaceOnce(output,
    '        semantic_class: properties.semantic_class || null,',
    '        semantic_class: properties.semantic_class || null,\n' +
    '        planning_feature_class: properties.planning_feature_class || null,\n' +
    '        planning_feature_state: properties.planning_feature_state || null,\n' +
    '        semantic_confidence: numberOrNull(properties.semantic_confidence),',
    "fusion semantic metadata");
  output = replaceOnce(output,
    '        ...(properties.planning_terrain_change ? { planning_terrain_change: properties.planning_terrain_change } : {}),',
    '        ...(properties.planning_terrain_change ? { planning_terrain_change: properties.planning_terrain_change } : {}),\n' +
    '        ...(properties.water ? { water: properties.water } : {}),\n' +
    '        ...(properties.landcover ? { landcover: properties.landcover } : {}),\n' +
    '        ...(properties.building ? { building: properties.building } : {}),\n' +
    '        ...(properties.roller_coaster ? { roller_coaster: properties.roller_coaster } : {}),\n' +
    '        ...(properties.man_made ? { man_made: properties.man_made } : {}),\n' +
    '        ...(properties.planning_elevation_point_type ? { planning_elevation_point_type: properties.planning_elevation_point_type } : {}),\n' +
    '        ...(Number.isFinite(Number(properties.height_m)) ? { height: Number(properties.height_m) } : {}),\n' +
    '        ...(Number.isFinite(Number(properties.ffl_m)) ? { ffl_m: Number(properties.ffl_m) } : {}),\n' +
    '        ...(Number.isFinite(Number(properties.diameter_m)) ? { diameter_m: Number(properties.diameter_m) } : {}),\n' +
    '        ...(Number.isFinite(Number(properties.canopy_diameter_m)) ? { canopy_diameter_m: Number(properties.canopy_diameter_m) } : {}),',
    "fusion comprehensive tags");
  validateFusion(output);
  return output;
}

export function transformSourceFusion(source) {
  if (source.includes("TPMAP_PHASE30D_OSM_REFERENCE_ONLY_FUSION")) return source;
  let output = replaceOnce(source,
    'import { readJson, sha256, sha256File } from "./io.mjs";',
    'import { readJson, sha256, sha256File } from "./io.mjs";\n' +
    'import { applyPlanningWorldAuthority } from "./planning-world-authority.mjs";\n' +
    'const TPMAP_PHASE30D_OSM_REFERENCE_ONLY_FUSION = true;',
    "planning-only world authority import");
  output = replaceOnce(output,
    '  summary.acceptedFeatures = summary.overture.accepted + summary.publicData.accepted + summary.acquired.accepted;',
    '  const planningWorldAuthority = applyPlanningWorldAuthority(features, options);\n' +
    '  summary.planningAuthority.world = planningWorldAuthority;\n' +
    '  summary.policy.worldAuthority = planningWorldAuthority.osmReferenceOnly\n' +
    '    ? "Planning geometry and attributes are the world source of truth; OSM and OSM-derived Overture features are registration-only and are removed before rasterization."\n' +
    '    : "Legacy multi-source map fusion";\n' +
    '  summary.acceptedFeatures = summary.overture.accepted + summary.publicData.accepted + summary.acquired.accepted;',
    "planning-only world cutover");
  output = replaceFunction(output, "function inheritMissingFeatureEvidence", `function inheritMissingFeatureEvidence(planning, replaced) {
  // Planning is authoritative for both geometry and attributes. The OSM object
  // may be consulted to register/locate a drawing, but none of its name, tags,
  // dimensions, elevation or height may cross into the world feature.
  const planningVectorRole = String(planning.tags?.planning_vector_role || planning.source?.planningVectorSubtype || "");
  planning.source = {
    ...(planning.source || {}),
    geometryAuthority: "planning-data",
    attributeAuthority: "planning-data",
    osmReferenceOnly: true
  };
  planning.tags = {
    ...(planning.tags || {}),
    planning_geometry_authority: "planning-data",
    planning_attribute_authority: "planning-data"
  };
  if (planning.source?.dataset === "planning-drawing-vector" && /^site-/.test(planningVectorRole)) {
    planning.source.geometryAuthority = "planning-drawing";
    planning.source.attributeAuthority = "planning-drawing";
    planning.tags.planning_geometry_authority = "planning-drawing";
    planning.tags.planning_attribute_authority = "planning-drawing";
  }
}`);
  validateSourceFusion(output);
  return output;
}

export function transformOsm(source) {
  if (source.includes("TPMAP_PHASE30D_PLANNING_BOUNDARY_AUTHORITY") && source.includes("world.postOverride")) return source;
  let output = source;
  if (!output.includes("TPMAP_PHASE30D_PLANNING_BOUNDARY_AUTHORITY")) {
    output = replaceOnce(output,
      'import { fuseAdditionalMapSources } from "./source-fusion.mjs";',
      'import { fuseAdditionalMapSources } from "./source-fusion.mjs";\n' +
      'import { applyPlanningWorldAuthority, planningWorldBoundary } from "./planning-world-authority.mjs";\n' +
      'const TPMAP_PHASE30D_PLANNING_BOUNDARY_AUTHORITY = true;',
      "planning boundary authority import");
    output = replaceOnce(output,
      '  const boundary = selectBoundary(features, sources, projector);',
      '  const boundary = String(options.planningWorldAuthority || "legacy").toLowerCase() === "planning-only"\n' +
      '    ? planningWorldBoundary(features, sources.parkName)\n' +
      '    : selectBoundary(features, sources, projector);',
      "planning-only boundary selection");
  } else if (!output.includes("applyPlanningWorldAuthority, planningWorldBoundary")) {
    output = replaceOnce(output,
      'import { planningWorldBoundary } from "./planning-world-authority.mjs";',
      'import { applyPlanningWorldAuthority, planningWorldBoundary } from "./planning-world-authority.mjs";',
      "planning boundary authority import upgrade");
  }
  output = replaceOnce(output,
    '  const structureHeightStats = applyLidarBuildingHeights(features, sources.elevation);',
    '  // Apply the invariant again after user overrides so no late input can\n' +
    '  // reintroduce OSM or OSM-derived geometry into world compilation.\n' +
    '  if (String(options.planningWorldAuthority || "legacy").toLowerCase() === "planning-only") {\n' +
    '    const postOverride = applyPlanningWorldAuthority(features, options);\n' +
    '    sourceFusion.planningAuthority.world.postOverride = postOverride;\n' +
    '    sourceFusion.planningAuthority.world.zeroOsmWorldFeatures = postOverride.zeroOsmWorldFeatures;\n' +
    '  }\n' +
    '  const structureHeightStats = applyLidarBuildingHeights(features, sources.elevation);',
    "post-override OSM cutover");
  if (!output.includes("planningWorldBoundary(features, sources.parkName)") || !output.includes("world.postOverride")) {
    throw new Error("Phase 30D planning boundary/final OSM transform is incomplete");
  }
  return output;
}

export function transformArgs(source) {
  if (source.includes("TPMAP_PHASE30D_PLANNING_WORLD_AUTHORITY_ARG")) return source;
  let output = replaceOnce(source,
    '  "planning-datasets", "planning-data-url", "planning-geometry",',
    '  "planning-datasets", "planning-data-url", "planning-geometry", "planning-world-authority",\n' +
    '  // TPMAP_PHASE30D_PLANNING_WORLD_AUTHORITY_ARG',
    "planning world authority argument");
  output = replaceOnce(output,
    '  if (options.planningOverrideMode && !["off", "gated", "authoritative"].includes(options.planningOverrideMode)) {',
    '  if (options.planningWorldAuthority && !["legacy", "planning-only"].includes(options.planningWorldAuthority)) {\n' +
    '    throw new UserError("--planning-world-authority must be legacy or planning-only");\n' +
    '  }\n' +
    '  if (options.planningOverrideMode && !["off", "gated", "authoritative"].includes(options.planningOverrideMode)) {',
    "planning world authority validation");
  if (!output.includes("--planning-world-authority must be legacy or planning-only")) throw new Error("Phase 30D planning authority argument transform is incomplete");
  return output;
}

export function transformVectorFusionTest(source) {
  if (source.includes("TPMAP_PHASE30D_NO_OSM_ATTRIBUTE_INHERITANCE_TEST")) return source;
  return replaceOnce(source,
    '  assert.equal(existing[0].name, "Existing footpath");\n' +
    '  assert.equal(existing[0].tags.surface, "asphalt");\n' +
    '  assert.equal(existing[0].subtype, "footway");',
    '  // TPMAP_PHASE30D_NO_OSM_ATTRIBUTE_INHERITANCE_TEST\n' +
    '  assert.equal(existing[0].name, null);\n' +
    '  assert.equal(existing[0].tags.surface, undefined);\n' +
    '  assert.equal(existing[0].tags.highway, undefined);\n' +
    '  assert.equal(existing[0].subtype, "planning-access-path");\n' +
    '  assert.equal(existing[0].source.attributeAuthority, "planning-data");',
    "planning vector test rejects OSM attribute inheritance");
}

export function transformRaster(source) {
  if (source.includes("TPMAP_PHASE30D_RIDE_SUPPORT_POINTS")) return source;
  return replaceOnce(source,
    '      const lines = lineStrings(feature.localGeometry);',
    '      // TPMAP_PHASE30D_RIDE_SUPPORT_POINTS\n' +
    '      if (feature.kind === "ride_support" && feature.localGeometry?.type === "Point") {\n' +
    '        const [x, z] = feature.localGeometry.coordinates.map(Math.round);\n' +
    '        const index = cellIndex(x, z, minX, minZ, width, height);\n' +
    '        if (index >= 0 && mask[index]) {\n' +
    '          const terrainY = terrainAt(x, z, mask, elevationY, minX, minZ, width, height);\n' +
    '          const heightM = Math.max(1, Math.round(Number(feature.tags?.height || feature.tags?.height_m || 3)));\n' +
    '          add(3, x, terrainY + 1, z, x, terrainY + heightM, z, planningQaBlock(feature, "minecraft:iron_bars"));\n' +
    '        }\n' +
    '        continue;\n' +
    '      }\n' +
    '      const lines = lineStrings(feature.localGeometry);',
    "ride support point compilation");
}

export function transformGeoreference(source) {
  if (source.includes("TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE")) return source;
  let output = source.replace(
    'const DEFAULT_DPI = 240;',
    'const DEFAULT_DPI = 240;\nconst TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE = true;'
  );
  output = output.replace(
    'integer(options.planningGeoreferenceMaxDocuments, 40, 1, 250)',
    'integer(options.planningGeoreferenceMaxDocuments, 500, 1, 500)'
  );
  output = output.replaceAll('warpPdfPage(', 'warpPlanningPage(');
  output = replaceOnce(output,
    'async function warpPlanningPage(sourceFile, outputDirectory, document, candidate, validation, config) {\n' +
    '  const key = safeKey(document.sha256 || document.cacheKey || document.id);\n' +
    '  const prefix = path.join(outputDirectory, `${key}-p${candidate.page}`);\n' +
    '  const png = `${prefix}.png`, vrt = `${prefix}.vrt`, tif = `${prefix}.tif`;\n' +
    '  await execFileAsync("pdftoppm", [\n' +
    '    "-f", String(candidate.page), "-l", String(candidate.page), "-singlefile",\n' +
    '    "-r", String(config.dpi), "-png", sourceFile, prefix\n' +
    '  ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });\n' +
    '  const gcpArguments = [];\n' +
    '  for (const point of candidate.points) {\n' +
    '    gcpArguments.push("-gcp", String(point.x * config.dpi / 72), String(point.y * config.dpi / 72),',
    'async function warpPlanningPage(sourceFile, outputDirectory, document, candidate, validation, config) {\n' +
    '  const key = safeKey(document.sha256 || document.cacheKey || document.id);\n' +
    '  const prefix = path.join(outputDirectory, `${key}-p${candidate.page}`);\n' +
    '  const renderedPng = `${prefix}.png`, vrt = `${prefix}.vrt`, tif = `${prefix}.tif`;\n' +
    '  const imageInput = String(document.mime || "").startsWith("image/") ? sourceFile : renderedPng;\n' +
    '  const pointScale = imageInput === sourceFile ? 1 : config.dpi / 72;\n' +
    '  if (imageInput !== sourceFile) {\n' +
    '    await execFileAsync("pdftoppm", [\n' +
    '      "-f", String(candidate.page), "-l", String(candidate.page), "-singlefile",\n' +
    '      "-r", String(config.dpi), "-png", sourceFile, prefix\n' +
    '    ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });\n' +
    '  }\n' +
    '  const gcpArguments = [];\n' +
    '  for (const point of candidate.points) {\n' +
    '    gcpArguments.push("-gcp", String(point.x * pointScale), String(point.y * pointScale),',
    "raster-aware planning warp");
  output = output.replace('    "-of", "VRT", "-a_srs", candidate.crs, ...gcpArguments, png, vrt', '    "-of", "VRT", "-a_srs", candidate.crs, ...gcpArguments, imageInput, vrt');
  output = output.replace('  await rm(png, { force: true });\n  await rm(vrt, { force: true });', '  if (imageInput !== sourceFile) await rm(renderedPng, { force: true });\n  await rm(vrt, { force: true });');
  if (!output.includes("TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE") || !output.includes("pointScale")) {
    throw new Error("Phase 30D raster planning georeference transform is incomplete");
  }
  return output;
}

function semanticPointInsertion() {
  return `  for (const [pointIndex, anchor] of semanticPointAnchors.entries()) {
    const pointRole = comprehensivePointRole(anchor.semantic);
    if (!pointRole) continue;
    const bng = transformAffine(pageToBng, { x: anchor.cx, y: anchor.cy });
    const wgs84 = coordinateMap.get(coordinateKey(bng));
    if (!wgs84) { withheld += 1; count(withheldReasons, "semantic-point-transform-incomplete"); continue; }
    features.push({
      type: "Feature",
      id: \`planning-vector:\${safeKey(entry.document.id)}:semantic-point:\${pointIndex}\`,
      geometry: { type: "Point", coordinates: [wgs84.x, wgs84.y] },
      properties: {
        source_type: "planning-drawing-semantic-point",
        planning_reference: entry.document.applicationReference || entry.georeference.applicationReference || null,
        application_status: entry.document.applicationStatus || entry.georeference.applicationStatus || "unknown",
        document_id: entry.document.id,
        document_role: entry.document.role,
        document_state: entry.document.state || "unknown",
        document_sha256: entry.document.sha256 || entry.georeference.sourceSha256 || null,
        source_url: entry.document.url || entry.georeference.sourceUrl || null,
        page: entry.georeference.page || 1,
        extraction_method: semantic.source?.includes("tesseract") ? "raster-ocr-semantic-point" : "pdf-text-semantic-point",
        geometry_role: pointRole.role,
        confidence: Math.min(0.96, vectorConfidence(entry, { curved: false }, 0, 0) + 0.08),
        georeference_method: entry.georeference.method,
        georeference_rmse_m: entry.georeference.rmseM,
        length_m: 0,
        area_m2: 0,
        semantic_label: anchor.text || null,
        semantic_class: anchor.semantic.className,
        planning_feature_class: anchor.semantic.featureClass,
        planning_feature_state: anchor.semantic.state || null,
        semantic_confidence: anchor.ocrConfidence ?? 1,
        ...(pointRole.tags || {}),
        reuse_status: entry.document.reuseStatus || entry.georeference.reuseStatus || "unknown-not-for-redistribution",
        world_eligible: false,
        fusion_status: "awaiting-planning-authority-gates"
      }
    });
  }`;
}

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Phase 30D function anchor missing: ${signature}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`Phase 30D function opening brace missing: ${signature}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") { quote = character; continue; }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, start) + replacement + source.slice(index + 1);
    }
  }
  throw new Error(`Phase 30D function closing brace missing: ${signature}`);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Phase 30D anchor missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Phase 30D anchor ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function validateVector(source) {
  for (const token of [
    "TPMAP_PHASE30D_COMPREHENSIVE_VECTOR_PIPELINE", "extractRasterPlanningPage",
    "circle|ellipse", "semanticPointAnchors", "semanticRole.reason",
    "planning_feature_class", "excludedByReason"
  ]) if (!source.includes(token)) throw new Error(`Phase 30D vector pipeline lacks ${token}`);
}

function validateFusion(source) {
  for (const token of [
    "TPMAP_PHASE30D_COMPREHENSIVE_FUSION", "site-ride-support-point-candidate",
    "ride-elevation-point-candidate", "rejectedExcluded", "withheld-explicit-exclusion",
    'expected === "point"'
  ]) if (!source.includes(token)) throw new Error(`Phase 30D fusion pipeline lacks ${token}`);
}

function validateSourceFusion(source) {
  for (const token of [
    "TPMAP_PHASE30D_OSM_REFERENCE_ONLY_FUSION", "applyPlanningWorldAuthority",
    "planningAuthority.world", "osmReferenceOnly: true", "planning_attribute_authority"
  ]) if (!source.includes(token)) throw new Error(`Phase 30D source fusion lacks ${token}`);
  if (source.includes("retainedOsmTags")) throw new Error("Phase 30D source fusion still inherits OSM tags");
}

async function validateInstallation(files) {
  for (const filename of Object.values(files)) {
    const source = await readFile(filename, "utf8");
    if (!source.trim()) throw new Error(`Phase 30D installed file is empty: ${filename}`);
  }
  validateVector(await readFile(files.vectorFile, "utf8"));
  validateFusion(await readFile(files.fusionFile, "utf8"));
  validateSourceFusion(await readFile(files.sourceFusionFile, "utf8"));
  if (!(await readFile(files.rasterFile, "utf8")).includes("TPMAP_PHASE30D_RIDE_SUPPORT_POINTS")) throw new Error("Phase 30D raster support compiler is incomplete");
  if (!(await readFile(files.georeferenceFile, "utf8")).includes("TPMAP_PHASE30D_RASTER_PLANNING_GEOREFERENCE")) throw new Error("Phase 30D raster georeference is incomplete");
  const osmSource = await readFile(files.osmFile, "utf8");
  if (!osmSource.includes("TPMAP_PHASE30D_PLANNING_BOUNDARY_AUTHORITY") || !osmSource.includes("world.postOverride")) throw new Error("Phase 30D planning boundary/final OSM authority is incomplete");
  if (!(await readFile(files.argsFile, "utf8")).includes("TPMAP_PHASE30D_PLANNING_WORLD_AUTHORITY_ARG")) throw new Error("Phase 30D planning authority argument is incomplete");
  if (!(await readFile(files.worldAuthorityModuleFile, "utf8")).includes("TPMAP_PHASE30D_PLANNING_ONLY_WORLD_AUTHORITY")) throw new Error("Phase 30D planning-only authority module is incomplete");
  if (!(await readFile(files.vectorFusionTestFile, "utf8")).includes("TPMAP_PHASE30D_NO_OSM_ATTRIBUTE_INHERITANCE_TEST")) throw new Error("Phase 30D OSM attribute regression test is incomplete");
}

function runSelfTest() {
  const cases = [
    ["Temporary fencing to secure building site", "excluded-construction-fence", true],
    ["RED CONSTRUCTION FENCE", "excluded-construction-fence", true],
    ["2.4m permanent acoustic screen", "sound-screen", false],
    ["Ride track HP 118.450", "ride-elevation", false],
    ["Coaster support footing S12", "ride-support", false],
    ["FFL 102.350 station building", "building-level", false],
    ["Existing retained tree T12 canopy 8m", "tree", false],
    ["Tree protection area RPA", "tree-protection", false],
    ["Proposed resin bound pedestrian path 3m wide", "path", false],
    ["Rock face and boulders", "rock-edge", false],
    ["Existing stream water level 96.25", "water-level", false],
    ["Proposed spot level 105.40", "terrain-level", false]
  ];
  for (const [label, featureClass, excluded] of cases) {
    const result = classifyComprehensivePlanningLabel(label);
    if (result?.featureClass !== featureClass || Boolean(result?.excludeFromWorld) !== excluded) {
      throw new Error(`Phase 30D classification failed for ${label}: ${JSON.stringify(result)}`);
    }
  }
  const ridePoint = comprehensivePointRole(classifyComprehensivePlanningLabel("Ride track LP 97.25"));
  if (ridePoint?.role !== "ride-elevation-point-candidate") throw new Error("Phase 30D ride elevation point role is missing");
  if (COMPREHENSIVE_PLAN_CLASSES.length < 35) throw new Error("Phase 30D semantic class catalogue is incomplete");
  console.log(`Phase 30D comprehensive plan extraction self-test passed (${COMPREHENSIVE_PLAN_CLASSES.length} classes)`);
}
