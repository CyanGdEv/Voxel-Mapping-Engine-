// TPMAP_PHASE34_BUILDING_ROOF_PLANNING_CONSTRAINTS_V1
// Apply accepted planning elevation/section constraints to graph-owned building roof geometry.

const MAX_ASSOCIATION_M = 40;
const ANGLE_TOLERANCE_DEG = 12;
const ELEVATION_TOLERANCE_M = 0.75;

export function applyBuildingRoofPlanningConstraints(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.evidenceNodes)) throw new Error("Phase 34 roof planning constraints require reconstruction graph");
  const diagnostics = {
    marker: "TPMAP_PHASE34_BUILDING_ROOF_PLANNING_CONSTRAINTS_V1",
    buildingsVisited: 0,
    buildingsConstrained: 0,
    constraintsAccepted: 0,
    constraintsRejectedIdentity: 0,
    constraintsRejectedDistance: 0,
    conflicts: 0,
    ridgeOverrides: 0,
    eaveOverrides: 0,
    pitchOverrides: 0,
    directionOverrides: 0
  };
  const compact = [];
  for (const node of graph.nodes) {
    if (node.type !== "building") continue;
    diagnostics.buildingsVisited += 1;
    if (node.authority?.osmDerived) throw new Error(`Phase 34 roof constraints rejected OSM-derived building ${node.id}`);
    const result = constrainBuilding(node, graph.evidenceNodes, options, diagnostics);
    Object.defineProperty(node, "roofPlanningConstraints", { enumerable: false, configurable: true, value: result });
    compact.push(compactResult(result));
    if (result.status === "constrained") diagnostics.buildingsConstrained += 1;
  }
  graph.buildingRoofPlanningConstraints = compact;
  graph.summary = { ...(graph.summary || {}), buildingRoofPlanningConstraints: diagnostics };
  return diagnostics;
}

export function validateBuildingRoofPlanningConstraints(graph) {
  const d = graph?.summary?.buildingRoofPlanningConstraints;
  if (!d || d.marker !== "TPMAP_PHASE34_BUILDING_ROOF_PLANNING_CONSTRAINTS_V1") throw new Error("Phase 34 roof planning constraint diagnostics missing");
  for (const node of graph.nodes || []) {
    if (node.type !== "building") continue;
    const r = node.roofPlanningConstraints;
    if (!r) throw new Error(`Phase 34 building ${node.id} missing roof constraint state`);
    if (r.osmDerived) throw new Error(`Phase 34 building ${node.id} roof constraint state used OSM`);
    for (const c of r.accepted || []) if (!c.source || c.osmDerived) throw new Error(`Phase 34 building ${node.id} invalid accepted roof constraint`);
  }
  return graph;
}

function constrainBuilding(node, observations, options, diagnostics) {
  const maxDistance = finite(options.buildingRoofConstraintMaxDistanceM) ?? MAX_ASSOCIATION_M;
  const accepted = [];
  for (const obs of observations) {
    if (obs.authority?.osmDerived) continue;
    const constraint = parseConstraint(obs);
    if (!constraint) continue;
    if (!identityCompatible(node, obs)) { diagnostics.constraintsRejectedIdentity += 1; continue; }
    const dist = centroidDistance(node.geometry?.centroid, obs.geometry?.centroid);
    if (dist !== null && dist > maxDistance) { diagnostics.constraintsRejectedDistance += 1; continue; }
    accepted.push({ ...constraint, observationId: obs.id, distanceM: dist === null ? null : round3(dist), source: "planning-elevation-or-section", osmDerived: false });
  }
  diagnostics.constraintsAccepted += accepted.length;
  if (!accepted.length) return unresolved(node, "no-compatible-planning-roof-constraints");

  const selected = selectConstraints(accepted);
  const conflicts = [];
  const roof = node.buildingReconstruction?.roof || null;
  const planes = node.roofPlaneDecomposition?.planes || [];

  if (selected.ridgeElevationM !== null) {
    checkConflict(conflicts, "ridgeElevationM", roof?.ridgeElevationM, selected.ridgeElevationM, ELEVATION_TOLERANCE_M, "dsm-or-derived");
    if (roof) roof.ridgeElevationM = round3(selected.ridgeElevationM);
    for (const ridge of node.roofPlaneDecomposition?.ridges || []) ridge.elevationM = round3(selected.ridgeElevationM);
    if (node.buildingReconstruction) {
      node.buildingReconstruction.topElevationM = Math.max(node.buildingReconstruction.topElevationM ?? -Infinity, selected.ridgeElevationM);
      if (Number.isFinite(node.buildingReconstruction.baseElevationM)) node.buildingReconstruction.heightM = round3(node.buildingReconstruction.topElevationM - node.buildingReconstruction.baseElevationM);
    }
    diagnostics.ridgeOverrides += 1;
  }

  if (selected.eaveElevationM !== null) {
    checkConflict(conflicts, "eaveElevationM", roof?.eaveElevationM, selected.eaveElevationM, ELEVATION_TOLERANCE_M, "dsm-or-derived");
    if (roof) roof.eaveElevationM = round3(selected.eaveElevationM);
    for (const eave of node.roofPlaneDecomposition?.eaves || []) eave.elevationM = round3(selected.eaveElevationM);
    diagnostics.eaveOverrides += 1;
  }

  if (selected.pitchDeg !== null) {
    const existing = median(planes.map(p => p.slopeDeg));
    checkConflict(conflicts, "pitchDeg", existing, selected.pitchDeg, ANGLE_TOLERANCE_DEG, "dsm-plane-fit");
    for (const plane of planes) {
      plane.slopeDeg = round3(selected.pitchDeg);
      plane.authority = { ...(plane.authority || {}), slope: "planning-section" };
    }
    diagnostics.pitchOverrides += 1;
  }

  if (selected.ridgeDirectionDeg !== null) {
    checkAngularConflict(conflicts, "ridgeDirectionDeg", roof?.ridgeDirectionDeg, selected.ridgeDirectionDeg, ANGLE_TOLERANCE_DEG);
    if (roof) roof.ridgeDirectionDeg = round3(normalizeDeg(selected.ridgeDirectionDeg));
    const ridge = node.roofPlaneDecomposition?.ridges?.[0];
    if (ridge) rotateRidgeToDirection(ridge, node.geometry?.centroid, selected.ridgeDirectionDeg);
    diagnostics.directionOverrides += 1;
  }

  diagnostics.conflicts += conflicts.length;
  const result = {
    marker: "TPMAP_PHASE34_BUILDING_ROOF_PLANNING_CONSTRAINTS_V1",
    buildingId: node.id,
    status: "constrained",
    accepted,
    selected,
    conflicts,
    authority: "planning-data-over-independent-dsm-for-explicit-properties",
    osmDerived: false,
    policy: "explicit-planning-roof-properties-constrain-dsm-never-vice-versa"
  };
  if (node.buildingReconstruction) {
    node.buildingReconstruction.roofPlanningAuthority = selected;
    node.buildingReconstruction.roofPlanningConflicts = conflicts;
  }
  if (node.roofPlaneDecomposition) node.roofPlaneDecomposition.planningConstraints = selected;
  return result;
}

function parseConstraint(obs) {
  const role = String(obs.semantics?.planningRole || obs.semantics?.planningClass || obs.semantics?.label || obs.sourceFeature?.tags?.planning_role || "").toLowerCase();
  const tags = obs.sourceFeature?.tags || {};
  const explicit = obs.vertical?.explicitElevationM ?? obs.vertical?.baseElevationM ?? null;
  // Specific directional evidence must win before the generic "ridge" level
  // branch; otherwise "ridge direction" is misread as a 90 m elevation and
  // the roof keeps its old zero-degree bearing.
  if (role.includes("ridge direction") || role.includes("roof direction") || tags.roof_direction_deg != null) return valueConstraint("ridgeDirectionDeg", tags.roof_direction_deg ?? obs.semantics?.directionDeg ?? explicit);
  if (role.includes("ridge") || tags.roof_level_type === "ridge") return valueConstraint("ridgeElevationM", explicit ?? tags.ridge_elevation_m);
  if (role.includes("eave") || role.includes("eaves") || tags.roof_level_type === "eave") return valueConstraint("eaveElevationM", explicit ?? tags.eave_elevation_m);
  if (role.includes("roof pitch") || role === "pitch" || tags.roof_pitch_deg != null) return valueConstraint("pitchDeg", tags.roof_pitch_deg ?? obs.semantics?.valueDeg ?? explicit);
  if (role.includes("roof top") || role.includes("roof level") || tags.roof_elevation_m != null) return valueConstraint("ridgeElevationM", explicit ?? tags.roof_elevation_m);
  if (role.includes("section") && obs.semantics?.roofPitchDeg != null) return valueConstraint("pitchDeg", obs.semantics.roofPitchDeg);
  return null;
}

function valueConstraint(property, value) { const n = finite(value); return n === null ? null : { property, value: round3(n), confidence: 1 }; }
function selectConstraints(items) {
  const selected = { ridgeElevationM: null, eaveElevationM: null, pitchDeg: null, ridgeDirectionDeg: null };
  for (const property of Object.keys(selected)) {
    const values = items.filter(i => i.property === property).sort((a,b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || String(a.observationId).localeCompare(String(b.observationId)));
    if (values.length) selected[property] = values[0].value;
  }
  return selected;
}
function identityCompatible(node, obs) {
  const nh=node.evidence?.sourceHash, oh=obs.evidence?.sourceHash; if(nh&&oh) return nh===oh;
  const nr=node.evidence?.planningReference, or=obs.evidence?.planningReference; if(nr&&or) return nr===or;
  return Boolean(node.authority?.planningAuthoritative && obs.authority?.planningAuthoritative);
}
function centroidDistance(a,b){if(!Array.isArray(a)||!Array.isArray(b))return null;const ax=finite(a[0]),az=finite(a[1]),bx=finite(b[0]),bz=finite(b[1]);if([ax,az,bx,bz].some(v=>v===null))return null;return Math.hypot(ax-bx,az-bz);}
function checkConflict(out,property,existing,planned,tolerance,source){const e=finite(existing);if(e!==null&&Math.abs(e-planned)>tolerance)out.push({property,planningValue:round3(planned),existingValue:round3(e),difference:round3(planned-e),existingSource:source});}
function checkAngularConflict(out,property,existing,planned,tolerance){const e=finite(existing);if(e===null)return;const diff=angularDistance(e,planned);if(diff>tolerance)out.push({property,planningValue:round3(normalizeDeg(planned)),existingValue:round3(normalizeDeg(e)),difference:round3(diff),existingSource:"dsm-plane-fit"});}
function rotateRidgeToDirection(ridge,centroid,deg){if(!ridge||!Array.isArray(centroid)||!Array.isArray(ridge.start)||!Array.isArray(ridge.end))return;const len=Math.hypot(ridge.end[0]-ridge.start[0],ridge.end[1]-ridge.start[1]);if(!(len>0))return;const t=normalizeDeg(deg)*Math.PI/180,half=len/2,cx=centroid[0],cz=centroid[1];ridge.start=[round3(cx-Math.cos(t)*half),round3(cz-Math.sin(t)*half)];ridge.end=[round3(cx+Math.cos(t)*half),round3(cz+Math.sin(t)*half)];ridge.authority={...(ridge.authority||{}),direction:"planning-section"};}
function median(values){const v=values.map(finite).filter(v=>v!==null).sort((a,b)=>a-b);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function normalizeDeg(v){let n=Number(v)%360;if(n<0)n+=360;return n;} function angularDistance(a,b){const d=Math.abs(normalizeDeg(a)-normalizeDeg(b));return Math.min(d,360-d);}
function compactResult(r){return{buildingId:r.buildingId,status:r.status,selected:r.selected,conflictCount:r.conflicts?.length||0,acceptedCount:r.accepted?.length||0};}
function unresolved(node,reason){return{marker:"TPMAP_PHASE34_BUILDING_ROOF_PLANNING_CONSTRAINTS_V1",buildingId:node.id,status:"unresolved",reason,accepted:[],selected:{ridgeElevationM:null,eaveElevationM:null,pitchDeg:null,ridgeDirectionDeg:null},conflicts:[],authority:"planning-data-over-independent-dsm-for-explicit-properties",osmDerived:false,policy:"explicit-planning-roof-properties-constrain-dsm-never-vice-versa"};}
function finite(v){if(v===null||v===undefined||(typeof v==="string"&&v.trim()===""))return null;const n=Number(v);return Number.isFinite(n)?n:null;}function round3(v){return Math.round(Number(v)*1000)/1000;}