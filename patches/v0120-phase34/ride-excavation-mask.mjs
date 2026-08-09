// TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1
// Convert verified ride/DTM cutting+tunnel interactions into deterministic 1 m excavation voxels.
// Unresolved samples and non-excavation states never produce cells.

const DEFAULT_HALF_WIDTH_M = 1.5;
const DEFAULT_HEADROOM_M = 2.0;
const DEFAULT_FLOOR_CLEARANCE_M = 0.75;
const DEFAULT_CUTTING_MARGIN_M = 0.25;
const MAX_MASK_CELLS = 2_000_000;

export function buildRideExcavationMask(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error("Phase 34 excavation mask requires reconstruction graph");
  const cfg = {
    halfWidthM: bounded(options.rideExcavationHalfWidthM, DEFAULT_HALF_WIDTH_M, 0.5, 8),
    headroomM: bounded(options.rideExcavationHeadroomM, DEFAULT_HEADROOM_M, 0.5, 8),
    floorClearanceM: bounded(options.rideExcavationFloorClearanceM, DEFAULT_FLOOR_CLEARANCE_M, 0, 4),
    cuttingMarginM: bounded(options.rideCuttingSurfaceMarginM, DEFAULT_CUTTING_MARGIN_M, 0, 2),
    maxCells: Math.max(1_000, Math.min(MAX_MASK_CELLS, Math.floor(Number(options.rideExcavationMaxCells) || MAX_MASK_CELLS)))
  };
  const cells = new Map();
  const spans = [];
  const diagnostics = {
    marker: "TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1",
    ridesVisited: 0,
    verifiedSamples: 0,
    rejectedSamples: 0,
    tunnelSamples: 0,
    cuttingSamples: 0,
    cells: 0,
    tunnelCells: 0,
    cuttingCells: 0,
    capped: false
  };

  for (const ride of graph.nodes) {
    if (ride.type !== "ride-track") continue;
    diagnostics.ridesVisited += 1;
    if (ride.authority?.osmDerived) throw new Error(`Phase 34 excavation mask rejected OSM-derived ride ${ride.id}`);
    const interaction = ride.terrainInteraction;
    if (!interaction?.samples?.length) continue;
    const rideCellsBefore = cells.size;
    for (const sample of interaction.samples) {
      if (!isVerifiedExcavationSample(sample)) {
        if (sample?.status === "cutting" || sample?.status === "tunnel") diagnostics.rejectedSamples += 1;
        continue;
      }
      diagnostics.verifiedSamples += 1;
      if (sample.status === "tunnel") diagnostics.tunnelSamples += 1;
      else diagnostics.cuttingSamples += 1;
      emitSampleCells(cells, sample, ride.id, cfg, diagnostics);
      if (cells.size > cfg.maxCells) {
        diagnostics.capped = true;
        throw new Error(`Phase 34 excavation mask exceeded safe cell cap ${cfg.maxCells}`);
      }
    }
    if (cells.size > rideCellsBefore) {
      for (const interval of interaction.excavationIntervals || []) {
        if (!interval?.excavationRequired || !["cutting", "tunnel"].includes(interval.status)) continue;
        if (!(Number(interval.endMeasureM) > Number(interval.startMeasureM))) continue;
        spans.push({
          rideId: ride.id,
          status: interval.status,
          startMeasureM: round3(interval.startMeasureM),
          endMeasureM: round3(interval.endMeasureM),
          minClearanceM: finite(interval.minClearanceM),
          maxClearanceM: finite(interval.maxClearanceM)
        });
      }
    }
  }

  const orderedCells = [...cells.values()].sort((a,b)=>a.x-b.x || a.z-b.z || a.y-b.y || a.mode.localeCompare(b.mode));
  diagnostics.cells = orderedCells.length;
  diagnostics.tunnelCells = orderedCells.filter(c=>c.mode === "tunnel").length;
  diagnostics.cuttingCells = orderedCells.filter(c=>c.mode === "cutting").length;
  const mask = {
    marker: "TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1",
    coordinateSystem: "local-metre-projector;1-cell=1-block",
    cells: orderedCells,
    spans,
    config: cfg,
    diagnostics,
    policy: "only-verified-cutting-or-tunnel-samples-can-remove-terrain;unresolved-is-no-op"
  };
  Object.defineProperty(graph, "rideExcavationMask", { enumerable: false, configurable: true, value: mask });
  graph.summary = { ...(graph.summary || {}), rideExcavationMask: diagnostics };
  return mask;
}

export function validateRideExcavationMask(graph) {
  const mask = graph?.rideExcavationMask;
  if (!mask || mask.marker !== "TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1") throw new Error("Phase 34 excavation mask missing");
  const seen = new Set();
  for (const cell of mask.cells || []) {
    for (const v of [cell.x, cell.y, cell.z]) if (!Number.isInteger(v)) throw new Error("Phase 34 excavation mask contains non-integer voxel coordinate");
    if (!["cutting","tunnel"].includes(cell.mode)) throw new Error(`Phase 34 excavation mask invalid mode ${cell.mode}`);
    if (!cell.rideId) throw new Error("Phase 34 excavation mask cell lacks ride identity");
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (seen.has(key)) throw new Error(`Phase 34 excavation mask duplicate voxel ${key}`);
    seen.add(key);
  }
  for (const ride of graph.nodes || []) {
    if (ride.type === "ride-track" && ride.authority?.osmDerived && (ride.terrainInteraction?.excavationIntervals || []).length) {
      throw new Error(`Phase 34 excavation mask contains OSM-derived ride intent ${ride.id}`);
    }
  }
  return mask;
}

function isVerifiedExcavationSample(sample) {
  if (!sample || !["cutting","tunnel"].includes(sample.status)) return false;
  return [sample.x,sample.y,sample.z,sample.groundY,sample.clearanceM].every(Number.isFinite);
}

function emitSampleCells(cells, sample, rideId, cfg, diagnostics) {
  const cx = Math.round(sample.x), cz = Math.round(sample.z);
  const minY = Math.floor(sample.y - cfg.floorClearanceM);
  const trackCeiling = Math.ceil(sample.y + cfg.headroomM);
  const maxY = sample.status === "cutting"
    ? Math.max(trackCeiling, Math.ceil(sample.groundY + cfg.cuttingMarginM))
    : trackCeiling;
  const radiusBlocks = Math.ceil(cfg.halfWidthM);
  for (let dx=-radiusBlocks; dx<=radiusBlocks; dx++) {
    for (let dz=-radiusBlocks; dz<=radiusBlocks; dz++) {
      const lateral = Math.hypot(dx,dz);
      if (lateral > cfg.halfWidthM + 0.35) continue;
      for (let y=minY; y<=maxY; y++) {
        if (sample.status === "tunnel") {
          const centerY = sample.y + (cfg.headroomM - cfg.floorClearanceM) / 2;
          const verticalRadius = Math.max(0.75, (cfg.headroomM + cfg.floorClearanceM) / 2 + 0.5);
          const norm = (lateral / Math.max(cfg.halfWidthM,0.5))**2 + ((y-centerY)/verticalRadius)**2;
          if (norm > 1.35) continue;
        }
        const key = `${cx+dx}:${y}:${cz+dz}`;
        const prior = cells.get(key);
        const next = { x:cx+dx, y, z:cz+dz, mode:sample.status, rideId, measureM:round3(sample.measureM) };
        if (!prior || (prior.mode === "cutting" && next.mode === "tunnel")) cells.set(key,next);
      }
    }
  }
}

function finite(v){const n=Number(v);return Number.isFinite(n)?round3(n):null;}
function bounded(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
function round3(v){return Math.round(Number(v)*1000)/1000;}
