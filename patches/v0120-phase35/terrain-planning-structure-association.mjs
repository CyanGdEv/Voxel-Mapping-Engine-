// TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1
// Associate planning-authoritative retaining/cutting/embankment/terrace evidence
// with DTM-derived terrain structures. Proximity alone never promotes a generic
// fence/barrier into an engineered terrain structure.

const DEFAULT_MAX_DISTANCE_M = 8;
const SUPPORTED = new Set(["retaining-wall", "cutting", "embankment", "engineered-terrace"]);

export function associatePlanningTerrainStructures(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error("Phase 35 terrain planning association requires reconstruction graph");
  const morphology = graph.terrainMorphology;
  if (!morphology || morphology.marker !== "TPMAP_PHASE35_TERRAIN_MORPHOLOGY_V1") throw new Error("Phase 35 terrain planning association requires terrain morphology");

  const maxDistanceM = bounded(options.terrainPlanningAssociationDistanceM, DEFAULT_MAX_DISTANCE_M, 1, 30);
  const planning = graph.nodes
    .map(node => ({ node, role: planningTerrainRole(node) }))
    .filter(entry => entry.role && entry.node.authority?.planningAuthoritative && !entry.node.authority?.osmDerived);

  const diagnostics = {
    marker: "TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1",
    planningCandidates: planning.length,
    structuresVisited: morphology.structures?.length || 0,
    structuresAssociated: 0,
    naturalStructures: 0,
    retainingWalls: 0,
    cuttings: 0,
    embankments: 0,
    engineeredTerraces: 0,
    ambiguous: 0,
    maxDistanceM,
    policy: "planning-explicit-engineering-semantics-only;generic-barrier-proximity-never-promotes"
  };

  for (const structure of morphology.structures || []) {
    const matches = [];
    for (const entry of planning) {
      const distanceM = boundsDistance(structure.bounds, entry.node.geometry?.bounds);
      if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) continue;
      matches.push({
        nodeId: entry.node.id,
        sourceFeatureId: entry.node.sourceFeatureId,
        role: entry.role,
        distanceM: round3(distanceM),
        confidence: round3(entry.node.confidence?.overall ?? 0.8),
        planningReference: entry.node.evidence?.planningReference || null,
        sourceHash: entry.node.evidence?.sourceHash || null
      });
    }
    matches.sort((a,b)=>a.distanceM-b.distanceM || b.confidence-a.confidence || a.nodeId.localeCompare(b.nodeId));
    const best = matches[0] || null;
    const conflictingRoles = new Set(matches.filter(m => !best || m.distanceM <= best.distanceM + 1.5).map(m => m.role));
    const ambiguous = conflictingRoles.size > 1;
    if (ambiguous) diagnostics.ambiguous += 1;

    structure.planningAssociations = matches.slice(0, 8);
    structure.engineering = resolveEngineering(structure, best, ambiguous);
    if (best && !ambiguous) diagnostics.structuresAssociated += 1;
    else diagnostics.naturalStructures += 1;
    if (structure.engineering.classification === "retaining-wall") diagnostics.retainingWalls += 1;
    else if (structure.engineering.classification === "cutting") diagnostics.cuttings += 1;
    else if (structure.engineering.classification === "embankment") diagnostics.embankments += 1;
    else if (structure.engineering.classification === "engineered-terrace") diagnostics.engineeredTerraces += 1;
  }

  const result = {
    marker: diagnostics.marker,
    status: morphology.status === "resolved" ? "resolved" : "partial",
    diagnostics,
    structures: (morphology.structures || []).map(compactStructure)
  };
  Object.defineProperty(graph, "terrainPlanningAssociation", { enumerable:false, configurable:true, value:result });
  graph.summary = { ...(graph.summary || {}), terrainPlanningAssociation: diagnostics };
  return diagnostics;
}

export function validatePlanningTerrainStructures(graph) {
  const model = graph?.terrainPlanningAssociation;
  if (!model || model.marker !== "TPMAP_PHASE35_TERRAIN_PLANNING_ASSOCIATION_V1") throw new Error("Phase 35 terrain planning association missing");
  for (const structure of graph.terrainMorphology?.structures || []) {
    const engineering = structure.engineering;
    if (!engineering) throw new Error(`Phase 35 terrain structure ${structure.id} lacks engineering classification`);
    if (!["natural-rock-face","natural-steep-bank","natural-terrace-break", ...SUPPORTED].includes(engineering.classification)) throw new Error(`Phase 35 invalid terrain engineering class ${engineering.classification}`);
    if (engineering.planningNodeId) {
      const node = graph.nodes.find(n => n.id === engineering.planningNodeId);
      if (!node?.authority?.planningAuthoritative || node.authority?.osmDerived) throw new Error(`Phase 35 terrain structure ${structure.id} used invalid planning association`);
    }
  }
  return model;
}

function resolveEngineering(structure, best, ambiguous) {
  if (best && !ambiguous) {
    return {
      classification: best.role,
      source: "planning+dtm",
      planningNodeId: best.nodeId,
      planningReference: best.planningReference,
      distanceM: best.distanceM,
      confidence: best.confidence,
      compilerIntent: best.role === "retaining-wall" ? "explicit-retaining-wall"
        : best.role === "cutting" ? "engineered-cutting-face"
        : best.role === "embankment" ? "engineered-embankment-face"
        : "engineered-terrace-face"
    };
  }
  const classification = structure.type === "cliff-face" ? "natural-rock-face"
    : structure.type === "terrace-break" ? "natural-terrace-break" : "natural-steep-bank";
  return {
    classification,
    source: ambiguous ? "dtm-ambiguous-planning-needs-review" : "dtm-only",
    planningNodeId: null,
    planningReference: null,
    distanceM: null,
    confidence: ambiguous ? 0.5 : 0.75,
    compilerIntent: structure.type === "cliff-face" ? "explicit-vertical-rock-face"
      : structure.type === "terrace-break" ? "explicit-break-of-slope" : "steep-terrain-treatment"
  };
}

function planningTerrainRole(node) {
  if (node?.authority?.osmDerived || !node?.authority?.planningAuthoritative) return null;
  const feature = node.sourceFeature || {};
  const tags = feature.tags || {};
  if (truthy(tags.planning_exclude_from_world) || truthy(tags.construction_fence) || String(tags.lifecycle || "").toLowerCase().includes("temporary")) return null;
  const text = [
    node.type, node.subtype, node.name,
    tags.planning_feature_class, tags.planning_semantic_class, tags.man_made,
    tags.barrier, tags.structure, tags.terrain, tags.description, tags.material
  ].filter(Boolean).join(" ").toLowerCase().replaceAll("_", "-");
  if (/retaining[ -]?wall|retained[ -]?wall|revetment/.test(text)) return "retaining-wall";
  if (/\bcutting\b|cut[ -]?slope|excavated[ -]?bank/.test(text)) return "cutting";
  if (/\bembankment\b|earth[ -]?bank|fill[ -]?slope/.test(text)) return "embankment";
  if (/engineered[ -]?terrace|terraced[ -]?slope|earthwork[ -]?terrace/.test(text)) return "engineered-terrace";
  return null;
}

function boundsDistance(a,b) {
  if (!a || !b || ![a.minX,a.minZ,a.maxX,a.maxZ,b.minX,b.minZ,b.maxX,b.maxZ].every(Number.isFinite)) return null;
  const dx = a.maxX < b.minX ? b.minX-a.maxX : b.maxX < a.minX ? a.minX-b.maxX : 0;
  const dz = a.maxZ < b.minZ ? b.minZ-a.maxZ : b.maxZ < a.minZ ? a.minZ-b.maxZ : 0;
  return Math.hypot(dx,dz);
}
function compactStructure(s){return {id:s.id,type:s.type,bounds:s.bounds,engineering:s.engineering,planningAssociations:(s.planningAssociations||[]).slice(0,4)};}
function truthy(v){return v===true||v===1||String(v).toLowerCase()==="true"||String(v)==="1";}
function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
function round3(v){return Math.round(Number(v)*1000)/1000;}
