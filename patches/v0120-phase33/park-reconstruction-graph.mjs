// TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1
// Typed intermediate representation between geospatial/planning evidence and
// Minecraft rasterization. Phase 33 is intentionally additive: it records the
// physical park scene and high-value relationships without changing compilation.

const SCHEMA_VERSION = 1;
const CELL_SIZE_M = 24;
const PHYSICAL_KINDS = new Set([
  "ride_track", "ride_support", "building", "path", "road", "bridge", "tunnel",
  "barrier", "structure", "water", "vegetation", "terrain_detail", "surface",
  "attraction", "amenity", "rail", "detail"
]);
const RELATION_PRIORITIES = Object.freeze({
  "supports-ride": 100,
  "bridge-crosses-water": 95,
  "path-connects-building": 85,
  "barrier-bounds-path": 80,
  "ride-near-building": 70,
  "path-interacts-ride": 65
});

export function buildParkReconstructionGraph({ parkName, map, sources = {}, accuracy = null, options = {} } = {}) {
  if (!map || !Array.isArray(map.features)) throw new Error("Phase 33 reconstruction graph requires map.features");
  const mode = String(options.planningWorldAuthority || "legacy").toLowerCase();
  if (mode === "planning-only") assertNoOsmWorldFeatures(map.features);

  const stats = {
    inputFeatures: map.features.length,
    physicalNodes: 0,
    evidenceOnlySkipped: 0,
    unsupportedSkipped: 0,
    geometryMissingSkipped: 0,
    nodesWithVerticalEvidence: 0,
    nodesWithGroundSample: 0,
    nodesWithMaterialEvidence: 0,
    planningGeometryNodes: 0,
    independentGeometryNodes: 0,
    relationships: 0,
    relationshipTypes: {}
  };

  const nodes = [];
  for (const feature of map.features) {
    const node = featureToNode(feature, sources, mode, stats);
    if (node) nodes.push(node);
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  stats.physicalNodes = nodes.length;

  const relationships = inferRelationships(nodes);
  relationships.sort(compareRelationship);
  stats.relationships = relationships.length;
  for (const relationship of relationships) {
    stats.relationshipTypes[relationship.type] = (stats.relationshipTypes[relationship.type] || 0) + 1;
  }

  const graph = {
    schemaVersion: SCHEMA_VERSION,
    marker: "TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1",
    parkName: parkName || map.geojson?.name || null,
    authorityMode: mode,
    coordinateSystem: {
      horizontal: "local-metre-projector",
      geographic: "WGS84",
      vertical: "metres",
      minecraftScale: "1 block = 1 metre"
    },
    sourceState: {
      planningAuthority: compactPlanningAuthority(map.sourceFusion?.planningAuthority),
      elevation: compactElevationSource(sources.elevation),
      accuracy: accuracy ? { score: accuracy.score ?? null, grade: accuracy.grade ?? null, exact3d: accuracy.exact3d ?? null } : null
    },
    nodes,
    relationships,
    summary: {
      ...stats,
      countsByType: countBy(nodes, (node) => node.type),
      countsByLifecycle: countBy(nodes, (node) => node.lifecycle.state),
      countsByGeometryAuthority: countBy(nodes, (node) => node.authority.geometry),
      relationshipPolicy: "deterministic-high-value-spatial-relations-v1"
    }
  };

  validateParkReconstructionGraph(graph, { requirePlanningOnlyClean: mode === "planning-only" });
  return graph;
}

export function validateParkReconstructionGraph(graph, options = {}) {
  if (graph?.schemaVersion !== SCHEMA_VERSION || graph?.marker !== "TPMAP_PHASE33_PARK_RECONSTRUCTION_GRAPH_V1") {
    throw new Error("Phase 33 reconstruction graph schema mismatch");
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relationships)) throw new Error("Phase 33 reconstruction graph arrays are missing");
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || ids.has(node.id)) throw new Error(`Phase 33 reconstruction graph duplicate/invalid node id: ${node?.id}`);
    ids.add(node.id);
    if (!node.geometry?.local || !node.geometry?.bounds || !node.geometry?.centroid) throw new Error(`Phase 33 node ${node.id} lacks normalized local geometry`);
    if (!node.authority?.geometry) throw new Error(`Phase 33 node ${node.id} lacks geometry authority`);
    if (options.requirePlanningOnlyClean && node.authority.osmDerived) throw new Error(`Phase 33 planning-only graph contains OSM-derived node ${node.id}`);
  }
  const relationIds = new Set();
  for (const relation of graph.relationships) {
    if (!relation?.id || relationIds.has(relation.id)) throw new Error(`Phase 33 duplicate/invalid relationship id: ${relation?.id}`);
    relationIds.add(relation.id);
    if (!ids.has(relation.from) || !ids.has(relation.to)) throw new Error(`Phase 33 relationship references a missing node: ${relation.id}`);
  }
  return graph;
}

function featureToNode(feature, sources, mode, stats) {
  if (!feature?.id) return null;
  const tags = feature.tags || {};
  if (tags.render_in_world === false || tags.render_in_world === "false" || tags.planning_exclude_from_world === true) {
    stats.evidenceOnlySkipped += 1;
    return null;
  }
  const type = reconstructionType(feature);
  if (!type) {
    stats.unsupportedSkipped += 1;
    return null;
  }
  const local = feature.localGeometry;
  if (!local?.type || !Array.isArray(local.coordinates)) {
    stats.geometryMissingSkipped += 1;
    return null;
  }
  const bounds = geometryBounds(local);
  const centroid = geometryCentroid(local, bounds);
  if (!bounds || !centroid) {
    stats.geometryMissingSkipped += 1;
    return null;
  }

  const geometryAuthority = geometryAuthorityFor(feature);
  const osmDerived = Boolean(osmDerivation(feature));
  if (mode === "planning-only" && osmDerived) throw new Error(`Phase 33 rejected OSM-derived world feature ${feature.id}`);
  if (geometryAuthority.startsWith("planning")) stats.planningGeometryNodes += 1;
  else stats.independentGeometryNodes += 1;

  const vertical = verticalModel(feature, centroid, sources.elevation);
  if (vertical.evidence.length) stats.nodesWithVerticalEvidence += 1;
  if (vertical.groundElevationM !== null) stats.nodesWithGroundSample += 1;
  const material = materialModel(feature);
  if (material.evidence.length) stats.nodesWithMaterialEvidence += 1;

  return {
    id: String(feature.id),
    sourceFeatureId: String(feature.id),
    name: feature.name || null,
    type,
    subtype: feature.subtype || null,
    geometry: {
      geographic: feature.geometry || null,
      local,
      bounds,
      centroid,
      dimension: geometryDimension(local),
      measure: geometryMeasure(local)
    },
    vertical,
    material,
    lifecycle: lifecycleModel(feature),
    semantics: semanticModel(feature),
    authority: {
      geometry: geometryAuthority,
      attributes: attributeAuthorityFor(feature),
      planningAuthoritative: isPlanningFeature(feature),
      osmDerived
    },
    evidence: evidenceModel(feature),
    confidence: confidenceModel(feature)
  };
}

function reconstructionType(feature) {
  const kind = String(feature.kind || "");
  const subtype = String(feature.subtype || "").toLowerCase();
  const tags = feature.tags || {};
  if (kind === "park_boundary") return null;
  if (kind === "ride_track") return "ride-track";
  if (kind === "ride_support") return "ride-support";
  if (kind === "building") return "building";
  if (kind === "path" || kind === "road") {
    if (truthy(tags.bridge) || subtype.includes("bridge") || subtype.includes("boardwalk")) return "bridge";
    if (truthy(tags.tunnel) || subtype.includes("tunnel") || subtype.includes("underpass")) return "tunnel";
    return kind === "road" ? "road" : "path";
  }
  if (kind === "water") return "water";
  if (kind === "vegetation") return "vegetation";
  if (kind === "barrier") return "barrier";
  if (kind === "structure") return "structure";
  if (kind === "terrain_detail") return "terrain-detail";
  if (kind === "surface") return "surface";
  if (kind === "attraction") return "attraction";
  if (kind === "rail") return "rail";
  if (kind === "amenity") return "amenity";
  if (kind === "detail") {
    if (String(tags.man_made || "").toLowerCase() === "support") return "ride-support";
    return "detail";
  }
  return PHYSICAL_KINDS.has(kind) ? kind.replaceAll("_", "-") : null;
}

function verticalModel(feature, centroid, elevation) {
  const vertical = feature.vertical || {};
  let groundElevationM = finiteOrNull(vertical.groundElevationM);
  let groundSource = vertical.groundElevationSource || null;
  if (groundElevationM === null && typeof elevation?.sampleLocal === "function") {
    const sampled = finiteOrNull(elevation.sampleLocal(centroid[0], centroid[1]));
    if (sampled !== null) {
      groundElevationM = sampled;
      groundSource = elevation.sourceKind || elevation.provider || "terrain-elevation-sampler";
    }
  }
  const statedElevationM = finiteOrNull(vertical.elevationM);
  const minHeightM = finiteOrNull(vertical.minHeightM) ?? 0;
  const heightM = finiteOrNull(vertical.heightM);
  const baseElevationM = statedElevationM ?? groundElevationM;
  const topElevationM = baseElevationM !== null && heightM !== null ? round3(baseElevationM + minHeightM + heightM) : null;
  const evidence = [];
  if (groundElevationM !== null) evidence.push({ property: "groundElevationM", value: round3(groundElevationM), source: groundSource || "terrain" });
  if (statedElevationM !== null) evidence.push({ property: "elevationM", value: statedElevationM, source: vertical.elevationSource || "feature-elevation" });
  if (heightM !== null) evidence.push({ property: "heightM", value: heightM, source: vertical.heightSource || "feature-height", confidence: finiteOrNull(vertical.heightConfidence) });
  if (finiteOrNull(feature.tags?.ffl_m) !== null) evidence.push({ property: "finishedFloorLevelM", value: Number(feature.tags.ffl_m), source: "planning-ffl" });
  if (finiteOrNull(feature.tags?.elevation_m) !== null) evidence.push({ property: "planningElevationM", value: Number(feature.tags.elevation_m), source: "planning-elevation" });
  return {
    groundElevationM: groundElevationM === null ? null : round3(groundElevationM),
    baseElevationM: baseElevationM === null ? null : round3(baseElevationM),
    explicitElevationM: statedElevationM,
    minHeightM,
    heightM,
    topElevationM,
    verticalRelationship: feature.tags?.planning_vertical_relationship || (truthy(feature.tags?.bridge) ? "bridge" : truthy(feature.tags?.tunnel) ? "tunnel" : "ground-associated"),
    verification: feature.verification?.vertical || "unknown",
    evidence
  };
}

function materialModel(feature) {
  const tags = feature.tags || {};
  const fidelity = feature.fidelity || {};
  const orthophoto = feature.orthophoto?.path || null;
  const candidates = [
    [tags.surface, "planning-or-feature-surface"],
    [tags.material, "planning-or-feature-material"],
    [tags.roof_material, "roof-material"],
    [fidelity.material, "fidelity-fusion"],
    [orthophoto?.material, "orthophoto-evidence"]
  ].filter(([value]) => value !== undefined && value !== null && value !== "");
  const evidence = candidates.map(([value, source]) => ({ value: String(value), source }));
  return {
    resolved: evidence[0]?.value || null,
    surface: tags.surface || null,
    pattern: tags.pattern || fidelity.pattern || orthophoto?.pattern || null,
    colour: tags.colour || tags.color || orthophoto?.colour || null,
    evidence
  };
}

function lifecycleModel(feature) {
  const state = String(feature.tags?.planning_feature_state || feature.tags?.feature_state || feature.tags?.state || "unspecified").toLowerCase();
  return {
    state,
    planningStatus: feature.tags?.planning_status || feature.source?.planningStatus || null,
    documentState: feature.tags?.document_state || feature.source?.documentState || null,
    temporalEvidence: [feature.source?.timestamp, feature.tags?.checked_at, feature.tags?.survey_date].filter(Boolean)
  };
}

function semanticModel(feature) {
  const tags = feature.tags || {};
  return {
    planningClass: tags.planning_feature_class || tags.planning_semantic_class || null,
    planningRole: tags.planning_vector_role || tags.planning_geometry_role || null,
    bridge: truthy(tags.bridge),
    tunnel: truthy(tags.tunnel),
    layer: finiteOrNull(tags.layer),
    widthM: finiteOrNull(tags.width),
    diameterM: finiteOrNull(tags.diameter_m),
    canopyDiameterM: finiteOrNull(tags.canopy_diameter_m)
  };
}

function evidenceModel(feature) {
  const source = feature.source || {};
  return {
    provider: source.provider || null,
    dataset: source.dataset || null,
    sourceUrl: source.sourceUrl || source.url || feature.tags?.source_url || null,
    documentId: source.documentId || feature.tags?.document_id || null,
    planningReference: feature.tags?.planning_reference || source.applicationReference || null,
    sourceHash: feature.tags?.document_sha256 || source.sha256 || source.sourceSha256 || null,
    geometryAuthority: geometryAuthorityFor(feature),
    attributeAuthority: attributeAuthorityFor(feature),
    verification: feature.verification || null
  };
}

function confidenceModel(feature) {
  const values = [
    feature.tags?.planning_confidence,
    feature.tags?.confidence,
    feature.tags?.semantic_confidence,
    feature.vertical?.heightConfidence,
    feature.fidelity?.confidence,
    feature.orthophoto?.path?.confidence
  ].map(finiteOrNull).filter((value) => value !== null);
  return {
    overall: values.length ? round3(Math.min(...values)) : null,
    geometry: finiteOrNull(feature.tags?.planning_confidence) ?? null,
    vertical: finiteOrNull(feature.vertical?.heightConfidence) ?? null,
    semantic: finiteOrNull(feature.tags?.semantic_confidence) ?? null,
    material: finiteOrNull(feature.orthophoto?.path?.confidence) ?? finiteOrNull(feature.fidelity?.confidence) ?? null
  };
}

function inferRelationships(nodes) {
  const byType = groupBy(nodes, (node) => node.type);
  const relationships = [];
  const seen = new Set();

  connectNearest({ from: byType.get("ride-support") || [], to: byType.get("ride-track") || [], maxDistanceM: 30, type: "supports-ride", relationships, seen });
  connectSpatial({ from: byType.get("bridge") || [], to: byType.get("water") || [], maxDistanceM: 3, type: "bridge-crosses-water", requireBoundsOverlap: true, relationships, seen });
  connectSpatial({ from: byType.get("building") || [], to: byType.get("path") || [], maxDistanceM: 12, type: "path-connects-building", reverse: true, relationships, seen });
  connectSpatial({ from: byType.get("barrier") || [], to: byType.get("path") || [], maxDistanceM: 5, type: "barrier-bounds-path", relationships, seen });
  connectSpatial({ from: byType.get("ride-track") || [], to: byType.get("building") || [], maxDistanceM: 10, type: "ride-near-building", relationships, seen });
  connectSpatial({ from: byType.get("path") || [], to: byType.get("ride-track") || [], maxDistanceM: 4, type: "path-interacts-ride", relationships, seen });
  return relationships;
}

function connectNearest({ from, to, maxDistanceM, type, relationships, seen }) {
  if (!from.length || !to.length) return;
  const index = makeCentroidIndex(to, Math.max(CELL_SIZE_M, maxDistanceM));
  for (const source of from) {
    const candidates = nearby(index, source.geometry.centroid, maxDistanceM);
    let best = null;
    for (const target of candidates) {
      if (target.id === source.id) continue;
      const distanceM = boundsDistance(source.geometry.bounds, target.geometry.bounds);
      if (distanceM > maxDistanceM) continue;
      if (!best || distanceM < best.distanceM || (distanceM === best.distanceM && target.id < best.target.id)) best = { target, distanceM };
    }
    if (best) addRelationship(relationships, seen, source, best.target, type, best.distanceM);
  }
}

function connectSpatial({ from, to, maxDistanceM, type, relationships, seen, reverse = false, requireBoundsOverlap = false }) {
  if (!from.length || !to.length) return;
  const index = makeCentroidIndex(to, Math.max(CELL_SIZE_M, maxDistanceM * 2));
  for (const source of from) {
    const candidates = nearby(index, source.geometry.centroid, Math.max(maxDistanceM, 16));
    for (const target of candidates) {
      if (target.id === source.id) continue;
      const distanceM = boundsDistance(source.geometry.bounds, target.geometry.bounds);
      if (requireBoundsOverlap && distanceM !== 0) continue;
      if (!requireBoundsOverlap && distanceM > maxDistanceM) continue;
      addRelationship(relationships, seen, reverse ? target : source, reverse ? source : target, type, distanceM);
    }
  }
}

function addRelationship(output, seen, from, to, type, distanceM) {
  const key = `${type}\0${from.id}\0${to.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push({
    id: `rel:${type}:${stablePairId(from.id, to.id)}`,
    type,
    from: from.id,
    to: to.id,
    priority: RELATION_PRIORITIES[type] || 50,
    distanceM: round3(distanceM),
    vertical: inferVerticalRelation(from, to),
    confidence: relationshipConfidence(from, to, distanceM, type)
  });
}

function inferVerticalRelation(a, b) {
  const aBase = a.vertical.baseElevationM, bBase = b.vertical.baseElevationM;
  if (aBase === null || bBase === null) return { status: "unresolved", relation: null, deltaM: null };
  const deltaM = round3(aBase - bBase);
  return { status: "resolved-from-current-evidence", relation: Math.abs(deltaM) < 0.75 ? "same-level" : deltaM > 0 ? "above" : "below", deltaM };
}

function relationshipConfidence(a, b, distanceM, type) {
  const aConfidence = a.confidence.overall ?? 0.8;
  const bConfidence = b.confidence.overall ?? 0.8;
  const scale = type === "supports-ride" ? 30 : type === "path-connects-building" ? 12 : 10;
  const proximity = Math.max(0.35, 1 - distanceM / Math.max(scale, 1));
  return round3(Math.min(aConfidence, bConfidence) * proximity);
}

function makeCentroidIndex(nodes, cellSize) {
  const cells = new Map();
  for (const node of nodes) {
    const [x, z] = node.geometry.centroid;
    const key = cellKey(x, z, cellSize);
    const bucket = cells.get(key) || [];
    bucket.push(node);
    cells.set(key, bucket);
  }
  for (const bucket of cells.values()) bucket.sort((a, b) => a.id.localeCompare(b.id));
  return { cells, cellSize };
}

function nearby(index, centroid, radiusM) {
  const [x, z] = centroid;
  const range = Math.max(1, Math.ceil(radiusM / index.cellSize));
  const cx = Math.floor(x / index.cellSize), cz = Math.floor(z / index.cellSize);
  const result = [];
  for (let dx = -range; dx <= range; dx += 1) {
    for (let dz = -range; dz <= range; dz += 1) {
      const bucket = index.cells.get(`${cx + dx}:${cz + dz}`);
      if (bucket) result.push(...bucket);
    }
  }
  return result;
}

function cellKey(x, z, cellSize) {
  return `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
}

function geometryBounds(geometry) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  visitCoordinates(geometry?.coordinates, (x, z) => {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  });
  return [minX, minZ, maxX, maxZ].every(Number.isFinite) ? { minX, minZ, maxX, maxZ } : null;
}

function geometryCentroid(geometry, bounds = geometryBounds(geometry)) {
  if (!bounds) return null;
  const points = [];
  visitCoordinates(geometry?.coordinates, (x, z) => points.push([x, z]));
  if (!points.length) return null;
  if (geometry.type === "Point") return points[0];
  const average = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [round3(average[0] / points.length), round3(average[1] / points.length)];
}

function geometryDimension(geometry) {
  if (["Point", "MultiPoint"].includes(geometry.type)) return 0;
  if (["LineString", "MultiLineString"].includes(geometry.type)) return 1;
  if (["Polygon", "MultiPolygon"].includes(geometry.type)) return 2;
  return null;
}

function geometryMeasure(geometry) {
  if (!geometry) return { lengthM: null, areaM2: null };
  if (geometry.type === "LineString") return { lengthM: round3(lineLength(geometry.coordinates)), areaM2: null };
  if (geometry.type === "MultiLineString") return { lengthM: round3(geometry.coordinates.reduce((sum, line) => sum + lineLength(line), 0)), areaM2: null };
  if (geometry.type === "Polygon") return { lengthM: null, areaM2: round3(polygonArea(geometry.coordinates)) };
  if (geometry.type === "MultiPolygon") return { lengthM: null, areaM2: round3(geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0)) };
  return { lengthM: null, areaM2: null };
}

function lineLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length || 0); i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

function polygonArea(rings) {
  if (!Array.isArray(rings) || !rings.length) return 0;
  const outer = Math.abs(ringArea(rings[0]));
  const holes = rings.slice(1).reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
  return Math.max(0, outer - holes);
}

function ringArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return area / 2;
}

function boundsDistance(a, b) {
  const dx = a.maxX < b.minX ? b.minX - a.maxX : b.maxX < a.minX ? a.minX - b.maxX : 0;
  const dz = a.maxZ < b.minZ ? b.minZ - a.maxZ : b.maxZ < a.minZ ? a.minZ - b.maxZ : 0;
  return Math.hypot(dx, dz);
}

function visitCoordinates(value, visit) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    visit(Number(value[0]), Number(value[1]));
    return;
  }
  for (const child of value) visitCoordinates(child, visit);
}

function geometryAuthorityFor(feature) {
  const source = feature.source || {}, tags = feature.tags || {};
  return String(source.geometryAuthority || tags.planning_geometry_authority || (isPlanningFeature(feature) ? "planning-data" : "independent-evidence"));
}

function attributeAuthorityFor(feature) {
  const source = feature.source || {}, tags = feature.tags || {};
  return String(source.attributeAuthority || tags.planning_attribute_authority || (isPlanningFeature(feature) ? "planning-data" : "independent-evidence"));
}

function isPlanningFeature(feature) {
  const tags = feature?.tags || {}, source = feature?.source || {};
  const provider = String(source.provider || "").toLowerCase();
  const dataset = String(source.dataset || tags.source_dataset || "").toLowerCase();
  return provider.includes("planning") || dataset.includes("planning") || tags.planning_authoritative === true || Boolean(tags.planning_reference || tags.planning_vector_role);
}

function assertNoOsmWorldFeatures(features) {
  const offender = features.find(osmDerivation);
  if (offender) throw new Error(`Phase 33 planning-only authority invariant failed: ${offender.id} is OSM-derived`);
}

function osmDerivation(feature) {
  const source = feature?.source || {}, provider = String(source.provider || "").toLowerCase(), id = String(feature?.id || "").toLowerCase();
  if (provider.includes("openstreetmap") || provider.includes("overture") || id.startsWith("osm:") || id.startsWith("overture:")) return true;
  const upstream = JSON.stringify(source.upstreamSources || source.sources || "").toLowerCase();
  return upstream.includes("openstreetmap") || upstream.includes('"osm"');
}

function compactPlanningAuthority(authority) {
  if (!authority) return null;
  return {
    world: authority.world ? {
      mode: authority.world.mode || null,
      status: authority.world.status || null,
      osmReferenceOnly: authority.world.osmReferenceOnly === true,
      zeroOsmWorldFeatures: authority.world.zeroOsmWorldFeatures === true,
      planningFeaturesRetained: authority.world.planningFeaturesRetained ?? null
    } : null,
    vector: authority.vector ? {
      considered: authority.vector.considered ?? null,
      gapFilled: authority.vector.gapFilled ?? null,
      osmOverridden: authority.vector.osmOverridden ?? null
    } : null
  };
}

function compactElevationSource(elevation) {
  if (!elevation) return null;
  return {
    sourceKind: elevation.sourceKind || null,
    resolutionM: finiteOrNull(elevation.resolutionM ?? elevation.resolution),
    surveyDate: elevation.survey?.newestSurveyDate || elevation.date || null,
    structureHeightStats: elevation.structureHeightStats || null
  };
}

function countBy(values, selector) {
  const result = {};
  for (const value of values) {
    const key = String(selector(value) || "unknown");
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function groupBy(values, selector) {
  const map = new Map();
  for (const value of values) {
    const key = selector(value);
    const bucket = map.get(key) || [];
    bucket.push(value);
    map.set(key, bucket);
  }
  return map;
}

function compareRelationship(a, b) {
  return b.priority - a.priority || a.type.localeCompare(b.type) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}

function stablePairId(a, b) {
  return `${safeId(a)}:${safeId(b)}`;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, 100);
}

function truthy(value) {
  return value !== undefined && value !== null && value !== false && String(value).toLowerCase() !== "no" && String(value).toLowerCase() !== "false" && String(value) !== "0";
}

function finiteOrNull(value) {
  const number = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(number) ? null : number;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
