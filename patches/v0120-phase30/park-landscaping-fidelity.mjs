// ThemePark Map ground-level landscaping fidelity layer v1.
// Explicitly excludes benches, drains, lamps and bins.

export const PARK_LANDSCAPING_FIDELITY_MARKER = "TPMAP_PARK_LANDSCAPING_FIDELITY_V1";

const PLANTS = Object.freeze({
  flowerbed: ["minecraft:dandelion", "minecraft:poppy", "minecraft:cornflower", "minecraft:oxeye_daisy", "minecraft:allium", "minecraft:azure_bluet"],
  fern: ["minecraft:fern", "minecraft:tallgrass", "minecraft:fern", "minecraft:azalea"],
  grass: ["minecraft:tallgrass", "minecraft:tallgrass", "minecraft:fern", "minecraft:dandelion"],
  woodland: ["minecraft:fern", "minecraft:fern", "minecraft:tallgrass", "minecraft:azalea"],
  ornamental: ["minecraft:azalea", "minecraft:flowering_azalea", "minecraft:allium", "minecraft:oxeye_daisy"]
});

const SOILS = Object.freeze({
  flowerbed: ["minecraft:podzol", "minecraft:rooted_dirt", "minecraft:coarse_dirt", "minecraft:packed_mud"],
  woodland: ["minecraft:podzol", "minecraft:rooted_dirt", "minecraft:coarse_dirt", "minecraft:moss_block"],
  meadow: ["minecraft:grass_block", "minecraft:moss_block", "minecraft:grass_block", "minecraft:grass_block"],
  ornamental: ["minecraft:podzol", "minecraft:rooted_dirt", "minecraft:packed_mud", "minecraft:coarse_dirt"]
});

export function tryCompileParkLandscapingVegetation(context = {}) {
  const feature = context?.feature, add = context?.add;
  if (!feature || typeof add !== "function" || feature.kind !== "vegetation" || isPlanningQa(feature)) return null;
  const geometry = feature.localGeometry || feature.geometry;
  if (!geometry) return null;
  const profile = plantingProfile(feature);
  if (!profile) return null;

  if (["Polygon", "MultiPolygon"].includes(geometry.type)) {
    return compilePlantingArea({ ...context, feature, add, geometry, profile });
  }
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates) || !profile.pointPlant) return null;
  const x = Math.round(Number(geometry.coordinates[0])), z = Math.round(Number(geometry.coordinates[1]));
  const y = terrainY(context, x, z);
  if (![x,z,y].every(Number.isFinite)) return null;
  const plant = pick(profile.plants, context.seed, x, z, "point-groundcover");
  add(4, x, y + 1, z, x, y + 1, z, plant);
  return landscapingResult({ blocks: 1, modelClass: profile.id, landscapeCells: 1, groundPlants: 1 });
}

export function tryCompileParkLandscapingTerrainDetail(context = {}) {
  const feature = context?.feature, add = context?.add;
  if (!feature || typeof add !== "function" || feature.kind !== "terrain_detail" || isPlanningQa(feature)) return null;
  const geometry = feature.localGeometry || feature.geometry;
  if (!geometry) return null;
  const tags = feature.tags || {};
  const kind = norm(tags.natural || tags.geological || tags.terrain_detail || tags.man_made || feature.subkind || feature.classification || "");
  if (!/(fallen_tree|fallen_log|deadwood|dead_wood|log|windthrow)/.test(kind)) return null;
  return compileFallenLog({ ...context, feature, add, geometry });
}

export function compileParkLandscapingBarrierRun({ add, feature, x1, x2, z, terrainY: baseY, seed = 0 } = {}) {
  if (typeof add !== "function" || !feature || isPlanningQa(feature)) return false;
  const tags = feature.tags || {};
  const barrier = norm(tags.barrier || tags.fence_type || tags.wall || tags.man_made || feature.subkind || "");
  const material = norm(tags.material || tags.fence_material || tags.wall_material || tags.kerb || "");
  const text = `${barrier} ${material}`;
  const start = Math.min(Math.round(x1), Math.round(x2)), end = Math.max(Math.round(x1), Math.round(x2));
  const y = Math.round(baseY);

  if (/(kerb|curb)/.test(text)) {
    const slab = /sandstone|buff/.test(material) ? "minecraft:sandstone_slab" : /brick/.test(material) ? "minecraft:brick_slab" : "minecraft:smooth_stone_slab";
    for (let x = start; x <= end; x++) add(4, x, y + 1, z, x, y + 1, z, slab);
    return true;
  }

  if (/(planter|flower_bed_edge|planting_edge)/.test(text)) {
    const wall = /brick/.test(material) ? "minecraft:brick_wall" : /sandstone/.test(material) ? "minecraft:sandstone_wall" : "minecraft:stone_brick_wall";
    const slab = /brick/.test(material) ? "minecraft:brick_slab" : /sandstone/.test(material) ? "minecraft:sandstone_slab" : "minecraft:stone_brick_slab";
    for (let x = start; x <= end; x++) {
      add(4, x, y + 1, z, x, y + 1, z, wall);
      if ((x - start) % 4 !== 2) add(4, x, y + 2, z, x, y + 2, z, slab);
    }
    return true;
  }

  if (/(retaining_wall|retaining|revetment)/.test(text)) {
    const height = clamp(Math.round(firstNumber(tags.height, feature?.vertical?.heightM, feature?.heightM) || 1), 1, 6);
    const stone = /brick/.test(material) ? "minecraft:brick_block" : /sandstone/.test(material) ? "minecraft:sandstone" : "minecraft:stone_bricks";
    const wall = /brick/.test(material) ? "minecraft:brick_wall" : /sandstone/.test(material) ? "minecraft:sandstone_wall" : "minecraft:stone_brick_wall";
    const slab = /brick/.test(material) ? "minecraft:brick_slab" : /sandstone/.test(material) ? "minecraft:sandstone_slab" : "minecraft:stone_brick_slab";
    const stair = /brick/.test(material) ? "minecraft:brick_stairs" : /sandstone/.test(material) ? "minecraft:sandstone_stairs" : "minecraft:stone_brick_stairs";
    for (let x = start; x <= end; x++) {
      for (let dy = 1; dy < height; dy++) add(4, x, y + dy, z, x, y + dy, z, stone);
      const topY = y + Math.max(1, height);
      add(4, x, topY, z, x, topY, z, ((x === start || x === end) && height > 1) ? stair : wall);
      if ((x - start) % 3 !== 1) add(4, x, topY + 1, z, x, topY + 1, z, slab);
    }
    return true;
  }

  return false;
}

export function landscapingCapabilities() {
  return Object.freeze({
    flowerbeds: true, ferns: true, longGrass: true, fallenLogs: true, planterEdges: true, retainingWalls: true, kerbs: true,
    terrainAwareEdging: true, slabs: true, stairs: true, walls: true, deterministic: true, evidenceDriven: true,
    excludedStreetFurniture: ["benches", "drains", "lamps", "bins"]
  });
}

function compilePlantingArea({ add, feature, geometry, profile, seed, ...context }) {
  const ringsets = polygonRingSets(geometry);
  if (!ringsets.length) return null;
  const bounds = geometryBounds(ringsets);
  if (!bounds) return null;
  const maxCells = clamp(Number(context?.options?.maxLandscapeCellsPerFeature) || 8000, 500, 20000);
  const estimate = Math.max(1, (bounds.maxX - bounds.minX + 1) * (bounds.maxZ - bounds.minZ + 1));
  if (estimate > maxCells * 4) return null;

  const cells = [];
  for (let z = Math.floor(bounds.minZ); z <= Math.ceil(bounds.maxZ); z++) {
    for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX); x++) {
      if (!insideRingSets(x + 0.5, z + 0.5, ringsets)) continue;
      const y = terrainY(context, x, z);
      if (!Number.isFinite(y)) continue;
      cells.push({ x, y, z });
      if (cells.length > maxCells) return null;
    }
  }
  if (!cells.length) return null;

  const cellSet = new Set(cells.map((c) => `${c.x},${c.z}`));
  let blocks = 0, plants = 0, borderBlocks = 0;
  for (const cell of cells) {
    const soil = pick(profile.soils, seed, cell.x, cell.z, `soil-${profile.id}`);
    add(4, cell.x, cell.y, cell.z, cell.x, cell.y, cell.z, soil); blocks++;

    const edge = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) => !cellSet.has(`${cell.x + dx},${cell.z + dz}`));
    if (edge && profile.hardEdge) {
      const shaped = plantingBorderBlock(feature, context, cell, seed);
      add(4, cell.x, cell.y + 1, cell.z, cell.x, cell.y + 1, cell.z, shaped); blocks++; borderBlocks++;
      continue;
    }

    if (hash01(seed, cell.x, cell.z, `plant-density-${profile.id}`) > profile.density) continue;
    const plant = pick(profile.plants, seed, cell.x, cell.z, `plant-${profile.id}`);
    add(4, cell.x, cell.y + 1, cell.z, cell.x, cell.y + 1, cell.z, plant); blocks++; plants++;
  }

  return landscapingResult({ blocks, modelClass: profile.id, landscapeCells: cells.length, groundPlants: plants, borderBlocks });
}

function plantingBorderBlock(feature, context, cell, seed) {
  const material = norm(feature?.tags?.material || feature?.tags?.border_material || feature?.tags?.kerb || "");
  const neighboringY = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz]) => terrainY(context, cell.x + dx, cell.z + dz)).filter(Number.isFinite);
  const stepped = neighboringY.some((y) => Math.abs(y - cell.y) >= 1);
  if (/brick/.test(material)) return stepped ? "minecraft:brick_stairs" : "minecraft:brick_slab";
  if (/sandstone|buff/.test(material)) return stepped ? "minecraft:sandstone_stairs" : "minecraft:sandstone_slab";
  if (/wood|timber/.test(material)) return stepped ? "minecraft:spruce_stairs" : "minecraft:spruce_slab";
  if (hash01(seed, cell.x, cell.z, "planter-border-wall") < 0.16) return "minecraft:stone_brick_wall";
  return stepped ? "minecraft:stone_brick_stairs" : "minecraft:stone_brick_slab";
}

function compileFallenLog({ add, feature, geometry, seed, ...context }) {
  const tags = feature.tags || {};
  let cells = [];
  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    cells = polylineCells(geometry.coordinates);
  } else if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const length = firstNumber(feature?.fidelity?.terrainDetail?.lengthM, feature?.fidelity?.log?.lengthM, tags.length, tags.width, feature?.lengthM);
    if (!Number.isFinite(length) || length < 1) return null;
    const bearing = firstNumber(tags.direction, tags.bearing, tags.orientation);
    const angle = Number.isFinite(bearing) ? bearing * Math.PI / 180 : hash01(seed, geometry.coordinates[0], geometry.coordinates[1], "fallen-log-angle") * Math.PI * 2;
    const x1 = Math.round(Number(geometry.coordinates[0])), z1 = Math.round(Number(geometry.coordinates[1]));
    cells = lineCells2d(x1, z1, Math.round(x1 + Math.cos(angle) * clamp(length, 1, 18)), Math.round(z1 + Math.sin(angle) * clamp(length, 1, 18)));
  } else return null;
  if (!cells.length || cells.length > 64) return null;

  const diameter = firstNumber(feature?.fidelity?.terrainDetail?.diameterM, feature?.fidelity?.log?.diameterM, tags.diameter, tags.circumference ? numericMetres(tags.circumference) / Math.PI : null);
  const thick = Number.isFinite(diameter) && diameter >= 1.4;
  let blocks = 0;
  for (let i = 0; i < cells.length; i++) {
    const [x,z] = cells[i], y = terrainY(context, x, z);
    if (!Number.isFinite(y)) continue;
    const end = i === 0 || i === cells.length - 1;
    const mossy = hash01(seed, x, z, "fallen-log-moss") < 0.18;
    add(4, x, y + 1, z, x, y + 1, z, end ? "minecraft:spruce_stairs" : mossy ? "minecraft:moss_block" : "minecraft:spruce_planks"); blocks++;
    if (thick && i > 0 && i < cells.length - 1 && i % 2 === 0) { add(4, x, y + 2, z, x, y + 2, z, "minecraft:spruce_slab"); blocks++; }
  }
  if (!blocks) return null;
  return {
    ...landscapingResult({ blocks, modelClass: "fallen_log", fallenLogBlocks: blocks }),
    shrubBlocks: 0, shrubModels: 0, shrubs: 0,
    models: 1, rockModels: 1, rockBlocks: blocks, positionMarkers: 0, cliffBlocks: 0, inferredClusters: 0
  };
}

function plantingProfile(feature) {
  const tags = feature.tags || {};
  const text = norm([tags.landuse, tags.landcover, tags.natural, tags.vegetation, tags.leisure, tags.garden_type, tags["garden:type"], tags.flowerbed, tags.planting, tags.surface, tags.name, feature.subkind, feature.classification].filter(Boolean).join(" "));
  const hardEdge = /planter|raised_bed|raised_planter|edged|bordered/.test(text) || ["yes", "kerb", "wall"].includes(norm(tags.edging)) || Boolean(tags.border_material);
  if (/(flowerbed|flower_bed|flower_garden|ornamental|formal_garden|raised_bed|planter)/.test(text)) return { id: "flowerbed", soils: SOILS.flowerbed, plants: PLANTS.flowerbed, density: 0.56, hardEdge: hardEdge || /planter|raised/.test(text), pointPlant: true };
  if (/(fern|bracken)/.test(text)) return { id: "fern", soils: SOILS.woodland, plants: PLANTS.fern, density: 0.42, hardEdge: false, pointPlant: true };
  if (/(long_grass|tall_grass|meadow|grassland)/.test(text)) return { id: "long_grass", soils: SOILS.meadow, plants: PLANTS.grass, density: 0.38, hardEdge: false, pointPlant: true };
  if (/(shrubbery|shrub_bed|scrub|understory|undergrowth)/.test(text)) return { id: "shrubbery", soils: SOILS.woodland, plants: PLANTS.woodland, density: 0.34, hardEdge, pointPlant: false };
  if (/(garden|planting_bed|landscaping)/.test(text)) return { id: "ornamental_planting", soils: SOILS.ornamental, plants: PLANTS.ornamental, density: 0.40, hardEdge, pointPlant: false };
  return null;
}

function landscapingResult({ blocks = 0, modelClass = null, landscapeCells = 0, groundPlants = 0, borderBlocks = 0, fallenLogBlocks = 0 }) {
  return { blocks, blockCount: blocks, vegetationBlocks: blocks, treeBlocks: 0, shrubBlocks: blocks, models: 1, treeModels: 0, shrubModels: 1, trees: 0, shrubs: 1,
    modelClass, landscapeCells, groundPlants, borderBlocks, fallenLogBlocks, compiled: true, enhancedScenery: true, enhancedLandscaping: true };
}

function polygonRingSets(geometry) { if (geometry?.type === "Polygon") return [geometry.coordinates].filter(validPolygonCoords); if (geometry?.type === "MultiPolygon") return (geometry.coordinates || []).filter(validPolygonCoords); return []; }
function validPolygonCoords(coords) { return Array.isArray(coords) && Array.isArray(coords[0]) && coords[0].length >= 3; }
function geometryBounds(ringsets) { const points = ringsets.flat(2).filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))); if (!points.length) return null; const xs=points.map(p=>Number(p[0])), zs=points.map(p=>Number(p[1])); return { minX:Math.min(...xs), maxX:Math.max(...xs), minZ:Math.min(...zs), maxZ:Math.max(...zs) }; }
function insideRingSets(x,z,ringsets) { return ringsets.some((rings) => pointInRing(x,z,rings[0]) && !rings.slice(1).some((hole) => pointInRing(x,z,hole))); }
function pointInRing(x,z,ring) { let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=Number(ring[i][0]),zi=Number(ring[i][1]),xj=Number(ring[j][0]),zj=Number(ring[j][1]); const hit=((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/((zj-zi)||1e-9)+xi); if(hit) inside=!inside; } return inside; }
function polylineCells(coords) { const out=[],seen=new Set(); for(let i=1;i<coords.length;i++){ const a=coords[i-1],b=coords[i]; if(!Array.isArray(a)||!Array.isArray(b)) continue; for(const cell of lineCells2d(Math.round(Number(a[0])),Math.round(Number(a[1])),Math.round(Number(b[0])),Math.round(Number(b[1])))){ const key=`${cell[0]},${cell[1]}`; if(!seen.has(key)){seen.add(key);out.push(cell);} } } return out; }
function lineCells2d(x0,z0,x1,z1) { const out=[]; let dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dz=-Math.abs(z1-z0),sz=z0<z1?1:-1,err=dx+dz; while(true){ out.push([x0,z0]); if(x0===x1&&z0===z1) break; const e2=2*err; if(e2>=dz){err+=dz;x0+=sx;} if(e2<=dx){err+=dx;z0+=sz;} } return out; }
function terrainY(context,x,z) { if(typeof context.terrainAt==="function"){const y=context.terrainAt(x,z);if(Number.isFinite(y))return Math.round(y);} const minX=Number(context.minX),minZ=Number(context.minZ),width=Number(context.width),height=Number(context.height),elevationY=context.elevationY,mask=context.mask; if(Number.isFinite(minX)&&Number.isFinite(minZ)&&Number.isFinite(width)&&Number.isFinite(height)&&elevationY){const ix=Math.round(x-minX),iz=Math.round(z-minZ);if(ix>=0&&iz>=0&&ix<width&&iz<height){const index=iz*width+ix;if((!mask||mask[index])&&Number.isFinite(elevationY[index]))return Math.round(elevationY[index]);}} if(Number.isFinite(context.terrainY))return Math.round(context.terrainY); return null; }
function isPlanningQa(feature) { const tags=feature?.tags||{},dataset=norm(feature?.source?.dataset||tags.source_dataset||""); return tags.planning_qa===true||norm(tags.planning_qa)==="true"||dataset==="planning-drawing-vector"; }
function numericMetres(v) { if(typeof v==="number")return v; const m=String(v??"").match(/-?\d+(?:\.\d+)?/); return m?Number(m[0]):NaN; }
function firstNumber(...values) { for(const value of values){const n=numericMetres(value);if(Number.isFinite(n)&&n>0)return n;} return null; }
function pick(list,seed,x,z,salt) { return list[Math.min(list.length-1,Math.floor(hash01(seed,x,z,salt)*list.length))]; }
function hash01(seed,x,z,salt="") { const text=`${seed??0}|${x}|${z}|${salt}`; let h=2166136261>>>0; for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;} h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;return(h>>>0)/4294967296; }
function norm(v) { return String(v??"").trim().toLowerCase().replace(/[\s-]+/g,"_"); }
function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,Number(v))); }
