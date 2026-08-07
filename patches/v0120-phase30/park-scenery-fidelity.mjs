// ThemePark Map park scenery fidelity layer v1.
// Evidence-driven model shapes with deterministic Minecraft-native detailing.

const MARKER = "TPMAP_PARK_SCENERY_FIDELITY_V1";
export const PARK_SCENERY_FIDELITY_MARKER = MARKER;

const TREE_ARCHETYPES = Object.freeze({
  deciduous: { trunk: "minecraft:oak_log", leaves: ["minecraft:oak_leaves", "minecraft:azalea_leaves"], rootStair: "minecraft:oak_stairs", rootSlab: "minecraft:oak_slab", crown: "round" },
  birch: { trunk: "minecraft:birch_log", leaves: ["minecraft:birch_leaves", "minecraft:azalea_leaves"], rootStair: "minecraft:birch_stairs", rootSlab: "minecraft:birch_slab", crown: "oval" },
  conifer: { trunk: "minecraft:spruce_log", leaves: ["minecraft:spruce_leaves", "minecraft:moss_block"], rootStair: "minecraft:spruce_stairs", rootSlab: "minecraft:spruce_slab", crown: "conifer" },
  willow: { trunk: "minecraft:dark_oak_log", leaves: ["minecraft:oak_leaves", "minecraft:moss_block"], rootStair: "minecraft:dark_oak_stairs", rootSlab: "minecraft:dark_oak_slab", crown: "willow" },
  ornamental: { trunk: "minecraft:cherry_log", leaves: ["minecraft:cherry_leaves", "minecraft:flowering_azalea_leaves"], rootStair: "minecraft:cherry_stairs", rootSlab: "minecraft:cherry_slab", crown: "ornamental" }
});

const ROCK = Object.freeze({
  core: ["minecraft:stone", "minecraft:andesite", "minecraft:tuff", "minecraft:cobblestone"],
  edgeSlabs: ["minecraft:stone_block_slab", "minecraft:andesite_slab", "minecraft:tuff_slab", "minecraft:cobblestone_slab"],
  edgeStairs: ["minecraft:stone_stairs", "minecraft:andesite_stairs", "minecraft:tuff_stairs", "minecraft:cobblestone_stairs"],
  edgeWalls: ["minecraft:cobblestone_wall", "minecraft:andesite_wall", "minecraft:tuff_wall", "minecraft:mossy_cobblestone_wall"]
});

export function tryCompileParkVegetation(context = {}) {
  const feature = context?.feature;
  const add = context?.add;
  if (!feature || typeof add !== "function" || feature.kind !== "vegetation" || isPlanningQa(feature)) return null;
  const geom = feature.localGeometry || feature.geometry;
  if (!geom || geom.type !== "Point" || !Array.isArray(geom.coordinates)) return null;

  const modelClass = vegetationClass(feature, context.modelClass);
  if (!new Set(["tree", "shrub"]).has(modelClass)) return null;
  const [xRaw, zRaw] = geom.coordinates;
  const x = Math.round(Number(xRaw)), z = Math.round(Number(zRaw));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const y = terrainY(context, x, z);
  if (!Number.isFinite(y)) return null;

  if (modelClass === "shrub") {
    const blocks = compileShrub({ add, x, y, z, feature, seed: context.seed });
    return resultShape({ blocks, treeModels: 0, shrubModels: 1, modelClass: "shrub" });
  }

  const observedHeight = resolveHeight(feature, context, x, z);
  if (!Number.isFinite(observedHeight)) return null;
  const archetypeName = treeArchetype(feature);
  const archetype = TREE_ARCHETYPES[archetypeName];
  const height = clamp(Math.round(observedHeight), 4, 34);
  const blocks = compileTree({ add, x, y, z, height, archetype, archetypeName, feature, seed: context.seed });
  return resultShape({ blocks, treeModels: 1, shrubModels: 0, modelClass: "tree", heightM: height, archetype: archetypeName });
}

export function tryCompileParkTerrainDetail(context = {}) {
  const feature = context?.feature;
  const add = context?.add;
  if (!feature || typeof add !== "function" || feature.kind !== "terrain_detail" || isPlanningQa(feature)) return null;
  const geom = feature.localGeometry || feature.geometry;
  if (!geom || geom.type !== "Point" || !Array.isArray(geom.coordinates)) return null;
  const tags = feature.tags || {};
  const kind = norm(tags.natural || tags.geological || tags.terrain_detail || feature.subkind || feature.classification || "");
  if (!/(rock|stone|boulder|outcrop)/.test(kind)) return null;

  const x = Math.round(Number(geom.coordinates[0])), z = Math.round(Number(geom.coordinates[1]));
  const y = terrainY(context, x, z);
  if (![x, z, y].every(Number.isFinite)) return null;
  const dims = rockDimensions(feature);
  if (!dims.observed) return null;
  const blocks = compileBoulder({ add, x, y, z, ...dims, seed: context.seed, feature });
  return {
    ...resultShape({ blocks, modelClass: "rock" }),
    models: 1, rockModels: 1, rockBlocks: blocks, positionMarkers: 0, cliffBlocks: 0, inferredClusters: 0
  };
}

export function compileParkBarrierRun({ add, feature, x1, x2, z, terrainY: baseY, seed = 0 } = {}) {
  if (typeof add !== "function" || !feature || isPlanningQa(feature)) return false;
  const tags = feature.tags || {};
  const barrier = norm(tags.barrier || tags.fence_type || tags.wall || feature.subkind || "");
  const material = norm(tags.material || tags.fence_material || tags.wall_material || "");
  if (!barrier && !material) return false;
  const start = Math.min(Math.round(x1), Math.round(x2)), end = Math.max(Math.round(x1), Math.round(x2));
  const y = Math.round(baseY);

  if (barrier === "hedge" || material.includes("hedge")) {
    for (let x = start; x <= end; x++) {
      const leaf = hash01(seed, x, z, "hedge") < 0.14 ? "minecraft:flowering_azalea_leaves" : "minecraft:azalea_leaves";
      add(4, x, y + 1, z, x, y + (hash01(seed, x, z, "hedge-height") < 0.22 ? 2 : 1), z, leaf);
    }
    return true;
  }

  if (/(stone|masonry|wall|brick)/.test(`${barrier} ${material}`)) {
    const brick = /brick/.test(material) ? "minecraft:brick_wall" : /sandstone/.test(material) ? "minecraft:sandstone_wall" : "minecraft:stone_brick_wall";
    const cap = /brick/.test(material) ? "minecraft:brick_slab" : /sandstone/.test(material) ? "minecraft:sandstone_slab" : "minecraft:stone_brick_slab";
    for (let x = start; x <= end; x++) {
      add(4, x, y + 1, z, x, y + 1, z, brick);
      if ((x - start) % 3 !== 1) add(4, x, y + 2, z, x, y + 2, z, cap);
    }
    return true;
  }

  if (/(wood|timber|split_rail|post_and_rail)/.test(`${barrier} ${material}`)) {
    const spruce = /spruce|dark/.test(material);
    const fence = spruce ? "minecraft:spruce_fence" : "minecraft:oak_fence";
    const post = spruce ? "minecraft:spruce_log" : "minecraft:oak_log";
    for (let x = start; x <= end; x++) {
      add(4, x, y + 1, z, x, y + 1, z, fence);
      if ((x - start) % 3 === 0 || x === end) add(4, x, y + 1, z, x, y + 2, z, post);
    }
    return true;
  }

  if (/(metal|chain|mesh|railing|guard_rail|fence)/.test(`${barrier} ${material}`)) {
    add(4, start, y + 1, z, end, y + 2, z, "minecraft:iron_bars");
    for (let x = start; x <= end; x += 4) add(4, x, y + 1, z, x, y + 2, z, "minecraft:polished_blackstone_wall");
    return true;
  }

  return false;
}

export function sceneryShapeCapabilities() {
  return Object.freeze({ fullBlocks: true, slabs: true, stairs: true, walls: true, fences: true, deterministic: true, evidenceDriven: true });
}

function compileTree({ add, x, y, z, height, archetype, archetypeName, feature, seed }) {
  let blocks = 0;
  const place = (px, py, pz, block) => { add(4, px, py, pz, px, py, pz, block); blocks += 1; };
  const trunkH = archetypeName === "conifer" ? Math.max(3, Math.round(height * 0.62)) : Math.max(3, Math.round(height * 0.48));
  const thick = height >= 18;
  for (let dy = 1; dy <= trunkH; dy++) {
    place(x, y + dy, z, archetype.trunk);
    if (thick && dy <= Math.max(3, Math.floor(trunkH * 0.45))) {
      if (hash01(seed, x, z, `trunk-${dy}-x`) > 0.25) place(x + 1, y + dy, z, archetype.trunk);
      if (hash01(seed, x, z, `trunk-${dy}-z`) > 0.45) place(x, y + dy, z + 1, archetype.trunk);
    }
  }

  if (height >= 8) {
    for (const [dx, dz, salt] of [[1,0,"e"],[-1,0,"w"],[0,1,"s"],[0,-1,"n"]]) {
      if (hash01(seed, x + dx, z + dz, `root-${salt}`) > 0.18) place(x + dx, y + 1, z + dz, archetype.rootStair);
      if (height >= 15 && hash01(seed, x + dx, z + dz, `root-slab-${salt}`) > 0.5) place(x + dx * 2, y + 1, z + dz * 2, archetype.rootSlab);
    }
  }

  if (archetype.crown === "conifer") blocks += compileConiferCrown({ add, x, y: y + Math.max(3, Math.round(height * 0.25)), z, height, leaves: archetype.leaves, seed });
  else if (archetype.crown === "willow") blocks += compileWillowCrown({ add, x, y: y + trunkH, z, height, leaves: archetype.leaves, seed });
  else blocks += compileRoundedCrown({ add, x, y: y + trunkH, z, height, leaves: archetype.leaves, seed, profile: archetype.crown });

  if (height >= 11 && archetypeName !== "conifer") {
    const branchY = y + Math.max(3, trunkH - 1);
    for (const [dx,dz,salt] of [[1,0,"a"],[-1,0,"b"],[0,1,"c"],[0,-1,"d"]]) {
      if (hash01(seed, x, z, `branch-${salt}`) > 0.32) place(x + dx, branchY, z + dz, fenceForTrunk(archetype.trunk));
    }
  }
  return blocks;
}

function compileRoundedCrown({ add, x, y, z, height, leaves, seed, profile }) {
  let blocks = 0;
  const ry = clamp(Math.round(height * (profile === "oval" ? 0.28 : 0.24)), 2, 7);
  const rx = clamp(Math.round(height * (profile === "ornamental" ? 0.25 : 0.22)), 2, 6);
  const rz = clamp(rx + (hash01(seed,x,z,"crown-asym") > 0.5 ? 1 : 0), 2, 7);
  const cy = y + Math.max(1, Math.floor(ry * 0.35));
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx-1; dx <= rx+1; dx++) for (let dz = -rz-1; dz <= rz+1; dz++) {
    const wobble = (hash01(seed, x + dx, z + dz, `leaf-${dy}`) - 0.5) * 0.28;
    const d = (dx*dx)/(rx*rx) + (dz*dz)/(rz*rz) + (dy*dy)/(ry*ry);
    if (d > 1.02 + wobble || hash01(seed, x + dx, z + dz, `hole-${dy}`) < 0.055) continue;
    add(4, x + dx, cy + dy, z + dz, x + dx, cy + dy, z + dz, pick(leaves, seed, x + dx, z + dz, `crown-${dy}`)); blocks++;
  }
  return blocks;
}

function compileConiferCrown({ add, x, y, z, height, leaves, seed }) {
  let blocks = 0;
  const crownH = clamp(Math.round(height * 0.72), 4, 24);
  for (let level = 0; level < crownH; level++) {
    const t = level / Math.max(1, crownH - 1);
    let radius = Math.max(0, Math.round((1 - t) * clamp(height * 0.23, 2, 6)));
    if (level % 3 === 2) radius = Math.max(0, radius - 1);
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const manhattan = Math.abs(dx) + Math.abs(dz);
      if (manhattan > radius * 1.55 || hash01(seed, x + dx, z + dz, `pine-${level}`) < 0.08) continue;
      add(4, x + dx, y + level, z + dz, x + dx, y + level, z + dz, pick(leaves, seed, x + dx, z + dz, `pine-palette-${level}`)); blocks++;
    }
  }
  return blocks;
}

function compileWillowCrown({ add, x, y, z, height, leaves, seed }) {
  let blocks = compileRoundedCrown({ add, x, y, z, height, leaves, seed, profile: "round" });
  const r = clamp(Math.round(height * 0.22), 2, 6);
  const hang = clamp(Math.round(height * 0.22), 2, 5);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) < r - 1) continue;
    if (hash01(seed, x + dx, z + dz, "willow-drop") < 0.58) continue;
    const length = 1 + Math.floor(hash01(seed, x + dx, z + dz, "willow-length") * hang);
    for (let d = 0; d < length; d++) { add(4, x + dx, y - d, z + dz, x + dx, y - d, z + dz, pick(leaves, seed, x + dx, z + dz, `willow-${d}`)); blocks++; }
  }
  return blocks;
}

function compileShrub({ add, x, y, z, feature, seed }) {
  let blocks = 0;
  const flowering = /flower|rose|rhododendron|azalea/.test(norm(JSON.stringify(feature.tags || {})));
  const palette = flowering ? ["minecraft:flowering_azalea_leaves", "minecraft:azalea_leaves"] : ["minecraft:azalea_leaves", "minecraft:oak_leaves", "minecraft:moss_block"];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (Math.abs(dx) + Math.abs(dz) > 2 || hash01(seed, x + dx, z + dz, "shrub") < 0.14) continue;
    const h = (dx === 0 && dz === 0) ? 2 : 1;
    add(4, x + dx, y + 1, z + dz, x + dx, y + h, z + dz, pick(palette, seed, x + dx, z + dz, "shrub-palette")); blocks += h;
  }
  return blocks;
}

function compileBoulder({ add, x, y, z, widthM, depthM, heightM, seed }) {
  let blocks = 0;
  const rx = clamp(Math.ceil(widthM / 2), 1, 6), rz = clamp(Math.ceil(depthM / 2), 1, 6), ry = clamp(Math.ceil(heightM), 1, 5);
  for (let dy = 0; dy < ry; dy++) for (let dx = -rx; dx <= rx; dx++) for (let dz = -rz; dz <= rz; dz++) {
    const d = (dx*dx)/(rx*rx) + (dz*dz)/(rz*rz) + ((dy - ry*0.32)**2)/(Math.max(1,ry*0.72)**2);
    const rough = (hash01(seed, x + dx, z + dz, `rock-${dy}`) - 0.5) * 0.34;
    if (d > 1.05 + rough) continue;
    const edge = d > 0.68;
    let block;
    if (!edge) block = pick(ROCK.core, seed, x + dx, z + dz, `core-${dy}`);
    else {
      const selector = hash01(seed, x + dx, z + dz, `edge-${dy}`);
      if (dy === ry - 1 && selector < 0.42) block = pick(ROCK.edgeSlabs, seed, x + dx, z + dz, "slab");
      else if (selector < 0.38) block = pick(ROCK.edgeStairs, seed, x + dx, z + dz, "stair");
      else if (selector < 0.62) block = pick(ROCK.edgeWalls, seed, x + dx, z + dz, "wall");
      else block = pick(ROCK.core, seed, x + dx, z + dz, "edge-core");
    }
    add(4, x + dx, y + dy + 1, z + dz, x + dx, y + dy + 1, z + dz, block); blocks++;
  }
  return blocks;
}

function vegetationClass(feature, explicit) {
  const tags = feature.tags || {};
  const value = norm(explicit || tags.natural || tags.vegetation || tags.landuse || tags.leisure || "tree");
  return /(shrub|bush|scrub|flower)/.test(value) ? "shrub" : "tree";
}

function treeArchetype(feature) {
  const tags = feature.tags || {};
  const text = norm([tags.species, tags.genus, tags.taxonomy, tags.leaf_type, tags.leaf_cycle, tags.tree_type, tags.name].filter(Boolean).join(" "));
  if (/(spruce|pine|fir|cedar|conifer|needle)/.test(text)) return "conifer";
  if (/(birch|betula)/.test(text)) return "birch";
  if (/(willow|salix)/.test(text)) return "willow";
  if (/(cherry|prunus|ornamental|blossom)/.test(text)) return "ornamental";
  return "deciduous";
}

function resolveHeight(feature, context, x, z) {
  const candidates = [
    feature?.fidelity?.vegetation?.heightM, feature?.fidelity?.tree?.heightM, feature?.vertical?.heightM,
    feature?.heightM, feature?.tags?.height, recursiveNumber(feature?.fidelity, "heightM"), recursiveNumber(feature, "canopyHeightM")
  ];
  for (const value of candidates) { const n = numericMetres(value); if (Number.isFinite(n) && n >= 2.5 && n <= 70) return n; }
  if (typeof context?.elevation?.sampleVegetationHeightLocal === "function") {
    const measured = context.elevation.sampleVegetationHeightLocal(x, z); if (Number.isFinite(measured) && measured >= 2.5 && measured <= 70) return measured;
  }
  return null;
}

function rockDimensions(feature) {
  const tags = feature.tags || {};
  const widthM = firstNumber(feature?.fidelity?.terrainDetail?.widthM, feature?.fidelity?.rock?.widthM, tags.width, tags.diameter, feature?.widthM);
  const depthM = firstNumber(feature?.fidelity?.terrainDetail?.depthM, feature?.fidelity?.rock?.depthM, tags.length, tags.depth, widthM);
  const heightM = firstNumber(feature?.fidelity?.terrainDetail?.heightM, feature?.fidelity?.rock?.heightM, tags.height, feature?.heightM);
  const observed = Number.isFinite(widthM) || Number.isFinite(depthM) || Number.isFinite(heightM);
  return { widthM: clamp(widthM || 2.4, 1, 10), depthM: clamp(depthM || widthM || 2.2, 1, 10), heightM: clamp(heightM || Math.max(1, (widthM || 2.4) * 0.55), 1, 6), observed };
}

function terrainY(context, x, z) {
  if (typeof context.terrainAt === "function") { const y = context.terrainAt(x, z); if (Number.isFinite(y)) return Math.round(y); }
  const minX = Number(context.minX), minZ = Number(context.minZ), width = Number(context.width), height = Number(context.height);
  const elevationY = context.elevationY, mask = context.mask;
  if (Number.isFinite(minX) && Number.isFinite(minZ) && Number.isFinite(width) && Number.isFinite(height) && elevationY) {
    const ix = Math.round(x - minX), iz = Math.round(z - minZ);
    if (ix >= 0 && iz >= 0 && ix < width && iz < height) {
      const index = iz * width + ix;
      if ((!mask || mask[index]) && Number.isFinite(elevationY[index])) return Math.round(elevationY[index]);
    }
  }
  if (Number.isFinite(context.terrainY)) return Math.round(context.terrainY);
  return null;
}

function resultShape({ blocks = 0, treeModels = 0, shrubModels = 0, modelClass = null, heightM = null, archetype = null }) {
  return { blocks, blockCount: blocks, vegetationBlocks: blocks, treeBlocks: treeModels ? blocks : 0, shrubBlocks: shrubModels ? blocks : 0,
    models: treeModels + shrubModels || (modelClass ? 1 : 0), treeModels, shrubModels, trees: treeModels, shrubs: shrubModels,
    modelClass, heightM, archetype, compiled: true, enhancedScenery: true };
}

function fenceForTrunk(block) { return block.includes("spruce") ? "minecraft:spruce_fence" : block.includes("birch") ? "minecraft:birch_fence" : block.includes("dark_oak") ? "minecraft:dark_oak_fence" : block.includes("cherry") ? "minecraft:cherry_fence" : "minecraft:oak_fence"; }
function isPlanningQa(feature) { const tags = feature?.tags || {}; const dataset = norm(feature?.source?.dataset || tags.source_dataset || ""); return tags.planning_qa === true || norm(tags.planning_qa) === "true" || dataset === "planning-drawing-vector"; }
function numericMetres(v) { if (typeof v === "number") return v; const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; }
function firstNumber(...values) { for (const value of values) { const n = numericMetres(value); if (Number.isFinite(n) && n > 0) return n; } return null; }
function recursiveNumber(value, key, depth = 0) { if (!value || typeof value !== "object" || depth > 4) return null; if (key in value) { const n = numericMetres(value[key]); if (Number.isFinite(n)) return n; } for (const child of Object.values(value)) { const n = recursiveNumber(child, key, depth + 1); if (Number.isFinite(n)) return n; } return null; }
function pick(list, seed, x, z, salt) { return list[Math.min(list.length - 1, Math.floor(hash01(seed, x, z, salt) * list.length))]; }
function hash01(seed, x, z, salt = "") { const text = `${seed ?? 0}|${x}|${z}|${salt}`; let h = 2166136261 >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function norm(v) { return String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v))); }
