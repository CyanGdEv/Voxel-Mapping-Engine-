// TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1
// Apply graph-authorised cutting/tunnel voxels to the native Bedrock compilation
// as phase-7 minecraft:air operations. Empty masks are an exact object no-op.

const EXCAVATION_PHASE = 7;
const AIR = "minecraft:air";
const MAX_COMPILER_CELLS = 2_000_000;

export function applyRideExcavationToCompilation(compilation, mask) {
  const cells = Array.isArray(mask?.cells) ? mask.cells : [];
  if (cells.length === 0) return exactNoopDiagnostics();
  if (mask?.marker !== "TPMAP_PHASE34_RIDE_EXCAVATION_MASK_V1") {
    throw new Error("Phase 34 excavation compiler requires verified excavation mask");
  }
  if (cells.length > MAX_COMPILER_CELLS) {
    throw new Error(`Phase 34 excavation compiler exceeded safe cell cap ${MAX_COMPILER_CELLS}`);
  }
  validateCompilation(compilation);

  const datumM = Number(compilation.meta.elevationDatumM);
  if (!Number.isFinite(datumM)) throw new Error("Phase 34 excavation compiler requires finite elevation datum");

  const normalized = normalizeCells(cells, datumM);
  if (!normalized.length) return exactNoopDiagnostics();

  let airIndex = compilation.palette.indexOf(AIR);
  if (airIndex < 0) {
    airIndex = compilation.palette.length;
    compilation.palette.push(AIR);
  }

  const chunkByKey = new Map(compilation.chunks.map((chunk) => [`${chunk.x},${chunk.z}`, chunk]));
  const grouped = groupRuns(normalized);
  let operationsAdded = 0;

  for (const run of grouped.runs) {
    const key = `${run.chunkX},${run.chunkZ}`;
    let chunk = chunkByKey.get(key);
    if (!chunk) {
      chunk = { x: run.chunkX, z: run.chunkZ, o: [] };
      compilation.chunks.push(chunk);
      chunkByKey.set(key, chunk);
    }
    chunk.o.push([
      EXCAVATION_PHASE,
      run.x1, run.relativeY, run.z,
      run.x2, run.relativeY, run.z,
      airIndex
    ]);
    operationsAdded += 1;
  }

  for (const chunk of compilation.chunks) chunk.o.sort((a, b) => a[0] - b[0]);
  compilation.chunks.sort((a, b) => a.z - b.z || a.x - b.x);

  const diagnostics = {
    marker: "TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1",
    status: "applied",
    phase: EXCAVATION_PHASE,
    block: AIR,
    datumM,
    authorisedCells: normalized.length,
    emittedOperations: operationsAdded,
    touchedChunks: grouped.touchedChunks,
    tunnelCells: normalized.filter((cell) => cell.mode === "tunnel").length,
    cuttingCells: normalized.filter((cell) => cell.mode === "cutting").length,
    policy: "native-phase7-air-only-for-verified-mask-cells;track-phase9-remains-later"
  };

  compilation.meta.rideExcavationCompilation = diagnostics;
  const stats = compilation.stats || (compilation.stats = {});
  stats.rawOperations = finiteCount(stats.rawOperations) + operationsAdded;
  stats.operations = finiteCount(stats.operations) + operationsAdded;
  stats.estimatedBlocks = finiteCount(stats.estimatedBlocks) + normalized.length;
  stats.chunks = compilation.chunks.length;
  stats.phaseCounts = { ...(stats.phaseCounts || {}) };
  stats.phaseCounts[String(EXCAVATION_PHASE)] = finiteCount(stats.phaseCounts[String(EXCAVATION_PHASE)]) + operationsAdded;
  stats.rideExcavationCells = normalized.length;
  stats.rideExcavationOperations = operationsAdded;
  stats.rideExcavationTunnelCells = diagnostics.tunnelCells;
  stats.rideExcavationCuttingCells = diagnostics.cuttingCells;
  return diagnostics;
}

export function validateRideExcavationCompilation(compilation, diagnostics) {
  if (!diagnostics || diagnostics.marker !== "TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1") {
    throw new Error("Phase 34 excavation compilation diagnostics missing");
  }
  if (diagnostics.status === "no-op") return compilation;
  validateCompilation(compilation);
  const airIndex = compilation.palette.indexOf(AIR);
  if (airIndex < 0) throw new Error("Phase 34 excavation compilation missing air palette entry");
  let phase7AirBlocks = 0;
  for (const chunk of compilation.chunks) {
    for (const op of chunk.o) {
      if (op[0] !== EXCAVATION_PHASE || op[7] !== airIndex) continue;
      phase7AirBlocks += volume(op);
    }
  }
  if (phase7AirBlocks < diagnostics.authorisedCells) {
    throw new Error("Phase 34 excavation compilation lost authorised voxel removals");
  }
  return compilation;
}

function exactNoopDiagnostics() {
  return {
    marker: "TPMAP_PHASE34_RIDE_EXCAVATION_COMPILER_V1",
    status: "no-op",
    phase: EXCAVATION_PHASE,
    block: AIR,
    datumM: null,
    authorisedCells: 0,
    emittedOperations: 0,
    touchedChunks: 0,
    tunnelCells: 0,
    cuttingCells: 0,
    policy: "empty-mask-exact-no-op"
  };
}

function validateCompilation(compilation) {
  if (!compilation || typeof compilation !== "object") throw new Error("Phase 34 excavation compiler requires compilation object");
  if (!compilation.meta || !Array.isArray(compilation.palette) || !Array.isArray(compilation.chunks)) {
    throw new Error("Phase 34 excavation compiler rejected unsupported compilation schema");
  }
  if (!compilation.meta.bounds || !["minX","minZ","maxX","maxZ"].every((key) => Number.isFinite(Number(compilation.meta.bounds[key])))) {
    throw new Error("Phase 34 excavation compiler rejected compilation without finite raster bounds");
  }
  for (const chunk of compilation.chunks) {
    if (!Number.isInteger(chunk?.x) || !Number.isInteger(chunk?.z) || !Array.isArray(chunk?.o)) {
      throw new Error("Phase 34 excavation compiler rejected malformed chunk schema");
    }
    for (const op of chunk.o) {
      if (!Array.isArray(op) || op.length !== 8 || !op.slice(0, 7).every(Number.isFinite) || !Number.isInteger(op[7])) {
        throw new Error("Phase 34 excavation compiler rejected malformed native operation");
      }
      if (op[7] < 0 || op[7] >= compilation.palette.length) {
        throw new Error("Phase 34 excavation compiler rejected operation palette index");
      }
    }
  }
}

function normalizeCells(cells, datumM) {
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    if (!["cutting", "tunnel"].includes(cell?.mode)) throw new Error(`Phase 34 excavation compiler rejected mode ${cell?.mode}`);
    if (![cell.x, cell.y, cell.z].every(Number.isInteger)) throw new Error("Phase 34 excavation compiler requires integer mask voxels");
    const key = `${cell.x}:${cell.y}:${cell.z}`;
    if (seen.has(key)) throw new Error(`Phase 34 excavation compiler rejected duplicate mask voxel ${key}`);
    seen.add(key);
    out.push({
      x: cell.x,
      z: cell.z,
      absoluteY: cell.y,
      relativeY: Math.round(cell.y - datumM),
      mode: cell.mode
    });
  }
  return out.sort((a, b) => a.z - b.z || a.relativeY - b.relativeY || a.x - b.x || a.mode.localeCompare(b.mode));
}

function groupRuns(cells) {
  const buckets = new Map();
  const chunks = new Set();
  for (const cell of cells) {
    const chunkX = floorDiv(cell.x, 16), chunkZ = floorDiv(cell.z, 16);
    chunks.add(`${chunkX},${chunkZ}`);
    const key = `${chunkX}:${chunkZ}:${cell.relativeY}:${cell.z}`;
    if (!buckets.has(key)) buckets.set(key, { chunkX, chunkZ, relativeY: cell.relativeY, z: cell.z, xs: [] });
    buckets.get(key).xs.push(cell.x);
  }
  const runs = [];
  const ordered = [...buckets.values()].sort((a,b)=>a.chunkZ-b.chunkZ || a.chunkX-b.chunkX || a.z-b.z || a.relativeY-b.relativeY);
  for (const bucket of ordered) {
    const xs = bucket.xs.sort((a,b)=>a-b);
    let start = xs[0], previous = xs[0];
    for (let i = 1; i <= xs.length; i += 1) {
      const x = xs[i];
      if (x === previous + 1) { previous = x; continue; }
      runs.push({ ...bucket, xs: undefined, x1: start, x2: previous });
      start = x; previous = x;
    }
  }
  return { runs, touchedChunks: chunks.size };
}

function volume(op) {
  return (Math.abs(op[4]-op[1])+1) * (Math.abs(op[5]-op[2])+1) * (Math.abs(op[6]-op[3])+1);
}
function finiteCount(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function floorDiv(value, divisor) { return Math.floor(value / divisor); }
