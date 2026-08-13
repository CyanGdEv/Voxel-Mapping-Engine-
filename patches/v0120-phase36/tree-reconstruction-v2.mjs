// TPMAP_PHASE36_TREE_RECONSTRUCTION_V2
// Converts resolved Phase 34 vegetation evidence into Minecraft tree topology.
// The compiler deliberately separates trunk, branches and foliage and keeps
// crowns porous; it never fabricates an exact species without source evidence.

export const TREE_RECONSTRUCTION_V2_MARKER = "TPMAP_PHASE36_TREE_RECONSTRUCTION_V2";

const DEFAULT_WOODLAND_SPACING_M = 7;
const MAX_TREES_PER_FEATURE = 96;
const MIN_TREE_HEIGHT_M = 3;
const MAX_TREE_HEIGHT_M = 45;

export function tryCompileTreeReconstructionV2(context = {}) {
  const feature = context?.feature;
  const add = context?.add;
  if (!feature || typeof add !== "function" || feature.kind !== "vegetation") return null;
  if (isPlanningQa(feature)) return null;

  const reconstruction = feature.vegetationReconstruction || feature.fidelity?.vegetationReconstruction || null;
  const treeEvidence = feature.fidelity?.tree || feature.fidelity?.vegetation || null;
  const geometry = context.geometry || feature.localGeometry || feature.geometry;
  if (!geometry) return null;

  const classification = String(reconstruction?.classification || classifyFeature(feature, geometry)).toLowerCase();
  if (!/tree|woodland|canopy/.test(classification)) return null;

  const maxModels = positiveInteger(
    context.remainingModels,
    context.maximumModels,
    context.maxModels,
    context.options?.maxVegetationModels,
    MAX_TREES_PER_FEATURE
  );
  const modelCap = Math.max(1, Math.min(MAX_TREES_PER_FEATURE, maxModels));
  const seed = Number.isFinite(Number(context.seed)) ? Number(context.seed) : 0;
  const positions = treePositions(geometry, classification, reconstruction, feature, seed, modelCap);
  if (!positions.length) return null;

  let blocks = 0, trunkBlocks = 0, branchBlocks = 0, leafBlocks = 0, models = 0;
  let inferredCrownModels = 0, observedHeightModels = 0, canopyAirGaps = 0;
  let maxLeafFillRatio = 0;

  for (let index = 0; index < positions.length; index += 1) {
    const [x, z] = positions[index];
    const terrainY = resolveTerrainY(context, x, z, reconstruction);
    if (!Number.isFinite(terrainY)) continue;

    const height = resolveHeightM(context, feature, reconstruction, treeEvidence, x, z, seed, index);
    if (!Number.isFinite(height) || height < MIN_TREE_HEIGHT_M) continue;
    const crown = resolveCrownDiameterM(feature, reconstruction, treeEvidence, height, classification, seed, x, z, index);
    if (!Number.isFinite(crown) || crown < 2) continue;
    if (!Number.isFinite(reconstruction?.crownDiameterM) && !Number.isFinite(treeEvidence?.crownDiameterM)) inferredCrownModels += 1;
    if (isObservedHeight(feature, reconstruction, treeEvidence, context, x, z)) observedHeightModels += 1;

    const style = resolveTreeStyle(feature);
    const result = style.form === "conifer"
      ? emitConiferTree({ add, x, y: terrainY, z, heightM: height, crownDiameterM: crown, style, seed, featureId: feature.id, modelIndex: index })
      : emitBroadleafTree({ add, x, y: terrainY, z, heightM: height, crownDiameterM: crown, style, seed, featureId: feature.id, modelIndex: index });

    if (!result || !result.blocks) continue;
    models += 1;
    blocks += result.blocks;
    trunkBlocks += result.trunkBlocks;
    branchBlocks += result.branchBlocks;
    leafBlocks += result.leafBlocks;
    canopyAirGaps += result.canopyAirGaps;
    maxLeafFillRatio = Math.max(maxLeafFillRatio, result.leafFillRatio);
  }

  if (!models) return null;
  return {
    marker: TREE_RECONSTRUCTION_V2_MARKER,
    modelClass: "evidence-tree-v2",
    topology: "trunk-primary-secondary-branches-layered-porous-crown",
    models,
    trees: models,
    treeModels: models,
    blocks,
    treeBlocks: blocks,
    trunkBlocks,
    branchBlocks,
    leafBlocks,
    shrubModels: 0,
    shrubBlocks: 0,
    inferredCrownModels,
    observedHeightModels,
    canopyAirGaps,
    maxLeafFillRatio: round3(maxLeafFillRatio),
    classification,
    evidenceDriven: true,
    exactSpeciesFabricated: false
  };
}

function emitBroadleafTree({ add, x, y, z, heightM, crownDiameterM, style, seed, featureId, modelIndex }) {
  const height = clamp(Math.round(heightM), 4, MAX_TREE_HEIGHT_M);
  const crownDiameter = clamp(Math.round(crownDiameterM), 3, Math.min(18, Math.max(4, Math.round(height * 0.9))));
  const radiusX = Math.max(2, Math.floor(crownDiameter / 2));
  const radiusZ = Math.max(2, Math.ceil(crownDiameter / 2));
  const crownDepth = clamp(Math.round(height * 0.48), 3, Math.max(4, Math.round(crownDiameter * 0.9)));
  const trunkHeight = clamp(Math.round(height * (0.50 + hash01(seed, x, z, `${featureId}:trunk:${modelIndex}`) * 0.12)), 3, height - 2);
  const trunkRadius = height >= 18 ? 1 : 0;
  const logVoxels = new Set();
  const leafVoxels = new Set();

  for (let dy = 1; dy <= trunkHeight; dy += 1) {
    for (let dx = -trunkRadius; dx <= trunkRadius; dx += 1) {
      for (let dz = -trunkRadius; dz <= trunkRadius; dz += 1) {
        if (trunkRadius && Math.abs(dx) + Math.abs(dz) > 1) continue;
        logVoxels.add(key(x + dx, y + dy, z + dz));
      }
    }
  }

  const branchBaseY = y + Math.max(3, trunkHeight - Math.round(crownDepth * 0.45));
  const branchCount = clamp(4 + Math.floor(hash01(seed, x, z, `${featureId}:branch-count:${modelIndex}`) * 3), 4, 6);
  const branchTips = [];
  for (let i = 0; i < branchCount; i += 1) {
    const jitter = (hash01(seed, x, z, `${featureId}:branch-angle:${modelIndex}:${i}`) - 0.5) * 0.55;
    const angle = (Math.PI * 2 * i / branchCount) + jitter;
    const reach = Math.max(2, Math.round((Math.min(radiusX, radiusZ) - 0.5) * (0.64 + 0.24 * hash01(seed, x, z, `${featureId}:branch-reach:${modelIndex}:${i}`))));
    const rise = 1 + Math.floor(hash01(seed, x, z, `${featureId}:branch-rise:${modelIndex}:${i}`) * Math.max(2, crownDepth * 0.38));
    const start = [x, branchBaseY + Math.floor(i % 2), z];
    const tip = [x + Math.round(Math.cos(angle) * reach), Math.min(y + height - 1, start[1] + rise), z + Math.round(Math.sin(angle) * reach)];
    for (const p of line3d(start, tip)) logVoxels.add(key(...p));
    branchTips.push(tip);

    // Secondary fork: short, offset branch close to the crown edge.
    if (reach >= 3) {
      const forkAngle = angle + (hash01(seed, x, z, `${featureId}:fork-side:${modelIndex}:${i}`) < 0.5 ? -0.55 : 0.55);
      const fork = [tip[0] + Math.round(Math.cos(forkAngle) * Math.max(1, reach * 0.35)), Math.min(y + height - 1, tip[1] + 1), tip[2] + Math.round(Math.sin(forkAngle) * Math.max(1, reach * 0.35))];
      for (const p of line3d(tip, fork)) logVoxels.add(key(...p));
      branchTips.push(fork);
    }
  }

  const crownCenterY = y + height - Math.ceil(crownDepth * 0.46);
  const ry = Math.max(2, crownDepth / 2);
  addPorousEllipsoid({ set: leafVoxels, cx: x, cy: crownCenterY, cz: z, rx: radiusX, ry, rz: radiusZ, seed, salt: `${featureId}:main-crown:${modelIndex}`, hollowBias: 0.18 });
  for (let i = 0; i < branchTips.length; i += 1) {
    const [bx, by, bz] = branchTips[i];
    const clusterR = Math.max(1.35, Math.min(2.7, crownDiameter / 5));
    addPorousEllipsoid({ set: leafVoxels, cx: bx, cy: by + 1, cz: bz, rx: clusterR, ry: Math.max(1.4, clusterR * 0.8), rz: clusterR, seed, salt: `${featureId}:branch-crown:${modelIndex}:${i}`, hollowBias: 0.24 });
  }
  // Open skylight/under-crown pockets stop the crown reading as a solid blob.
  carveAirPocket(leafVoxels, x, crownCenterY, z, Math.max(1, Math.floor(radiusX * 0.28)), Math.max(1, Math.floor(ry * 0.32)), seed, `${featureId}:air:${modelIndex}`);
  for (const log of logVoxels) leafVoxels.delete(log);

  const logRuns = emitVoxelRuns(add, 4, logVoxels, style.log);
  const leafRuns = emitVoxelRuns(add, 4, leafVoxels, style.leaves);
  const boundsVolume = voxelBoundsVolume(leafVoxels);
  const leafFillRatio = boundsVolume > 0 ? leafVoxels.size / boundsVolume : 0;
  return {
    blocks: logVoxels.size + leafVoxels.size,
    trunkBlocks: countTrunkVoxels(logVoxels, x, z, trunkRadius),
    branchBlocks: Math.max(0, logVoxels.size - countTrunkVoxels(logVoxels, x, z, trunkRadius)),
    leafBlocks: leafVoxels.size,
    canopyAirGaps: Math.max(0, boundsVolume - leafVoxels.size),
    leafFillRatio,
    writeRuns: logRuns + leafRuns
  };
}

function emitConiferTree({ add, x, y, z, heightM, crownDiameterM, style, seed, featureId, modelIndex }) {
  const height = clamp(Math.round(heightM), 4, MAX_TREE_HEIGHT_M);
  const crownRadius = clamp(Math.round(crownDiameterM / 2), 2, Math.min(8, Math.max(2, Math.floor(height * 0.34))));
  const trunkHeight = Math.max(3, height - 1);
  const logVoxels = new Set();
  const leafVoxels = new Set();
  for (let dy = 1; dy <= trunkHeight; dy += 1) logVoxels.add(key(x, y + dy, z));

  const crownStart = y + Math.max(2, Math.round(height * 0.26));
  const crownTop = y + height;
  let layer = 0;
  for (let yy = crownStart; yy <= crownTop; yy += 1, layer += 1) {
    const t = (yy - crownStart) / Math.max(1, crownTop - crownStart);
    let radius = Math.max(0, Math.round(crownRadius * (1 - t)));
    if (layer % 3 === 2 && radius > 1) radius -= 1; // visible tier gaps
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const d = Math.sqrt(dx * dx + dz * dz) / Math.max(1, radius);
        if (d > 1.05) continue;
        const edge = d > 0.68;
        const keep = edge ? 0.62 : 0.84;
        if (hash01(seed, x + dx, z + dz, `${featureId}:conifer:${modelIndex}:${yy}`) > keep) continue;
        leafVoxels.add(key(x + dx, yy, z + dz));
      }
    }
    if (radius >= 2 && layer % 2 === 0) {
      const angle = hash01(seed, x, z, `${featureId}:conifer-branch:${modelIndex}:${layer}`) * Math.PI * 2;
      const tip = [x + Math.round(Math.cos(angle) * radius), yy, z + Math.round(Math.sin(angle) * radius)];
      for (const p of line3d([x, yy, z], tip)) logVoxels.add(key(...p));
    }
  }
  for (const log of logVoxels) leafVoxels.delete(log);
  const logRuns = emitVoxelRuns(add, 4, logVoxels, style.log);
  const leafRuns = emitVoxelRuns(add, 4, leafVoxels, style.leaves);
  const boundsVolume = voxelBoundsVolume(leafVoxels);
  return {
    blocks: logVoxels.size + leafVoxels.size,
    trunkBlocks: trunkHeight,
    branchBlocks: Math.max(0, logVoxels.size - trunkHeight),
    leafBlocks: leafVoxels.size,
    canopyAirGaps: Math.max(0, boundsVolume - leafVoxels.size),
    leafFillRatio: boundsVolume > 0 ? leafVoxels.size / boundsVolume : 0,
    writeRuns: logRuns + leafRuns
  };
}

function addPorousEllipsoid({ set, cx, cy, cz, rx, ry, rz, seed, salt, hollowBias }) {
  const ix = Math.ceil(rx), iy = Math.ceil(ry), iz = Math.ceil(rz);
  for (let dy = -iy; dy <= iy; dy += 1) {
    for (let dz = -iz; dz <= iz; dz += 1) {
      for (let dx = -ix; dx <= ix; dx += 1) {
        const nx = dx / Math.max(0.8, rx), ny = dy / Math.max(0.8, ry), nz = dz / Math.max(0.8, rz);
        const d2 = nx * nx + ny * ny + nz * nz;
        if (d2 > 1.02) continue;
        const radial = Math.sqrt(d2);
        const keep = clamp(0.90 - radial * 0.22 - hollowBias * (1 - radial), 0.54, 0.90);
        if (hash01(seed, cx + dx, cz + dz, `${salt}:${cy + dy}`) > keep) continue;
        set.add(key(Math.round(cx + dx), Math.round(cy + dy), Math.round(cz + dz)));
      }
    }
  }
}

function carveAirPocket(set, cx, cy, cz, rx, ry, seed, salt) {
  const angle = hash01(seed, cx, cz, salt) * Math.PI * 2;
  const ox = Math.round(Math.cos(angle) * Math.max(1, rx));
  const oz = Math.round(Math.sin(angle) * Math.max(1, rx));
  for (let dy = -ry; dy <= ry; dy += 1) {
    for (let dz = -rx; dz <= rx; dz += 1) {
      for (let dx = -rx; dx <= rx; dx += 1) {
        if ((dx * dx + dz * dz) / Math.max(1, rx * rx) + (dy * dy) / Math.max(1, ry * ry) > 1) continue;
        set.delete(key(cx + ox + dx, cy + dy, cz + oz + dz));
      }
    }
  }
}

function treePositions(geometry, classification, reconstruction, feature, seed, cap) {
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) return [[Math.round(Number(geometry.coordinates[0])), Math.round(Number(geometry.coordinates[1]))]];
  const ring = polygonOuterRing(geometry);
  if (!ring) return [];
  const bounds = ringBounds(ring);
  if (!bounds) return [];
  if (classification === "individual-tree") {
    const c = polygonCentroid(ring);
    return c ? [[Math.round(c[0]), Math.round(c[1])]] : [];
  }

  const spacing = clamp(Number(feature?.tags?.tree_spacing_m) || Number(feature?.fidelity?.tree?.spacingM) || DEFAULT_WOODLAND_SPACING_M, 4, 12);
  const positions = [];
  const startX = Math.floor(bounds.minX / spacing) * spacing;
  const startZ = Math.floor(bounds.minZ / spacing) * spacing;
  for (let z = startZ; z <= bounds.maxZ && positions.length < cap; z += spacing) {
    for (let x = startX; x <= bounds.maxX && positions.length < cap; x += spacing) {
      const jx = (hash01(seed, x, z, `${feature.id}:wood-x`) - 0.5) * spacing * 0.55;
      const jz = (hash01(seed, x, z, `${feature.id}:wood-z`) - 0.5) * spacing * 0.55;
      const px = x + jx, pz = z + jz;
      if (!pointInPolygon([px, pz], ring)) continue;
      if (hash01(seed, px, pz, `${feature.id}:wood-density`) < 0.16) continue;
      positions.push([Math.round(px), Math.round(pz)]);
    }
  }
  if (!positions.length) {
    const c = polygonCentroid(ring);
    if (c) positions.push([Math.round(c[0]), Math.round(c[1])]);
  }
  return positions;
}

function resolveTerrainY(context, x, z, reconstruction) {
  if (typeof context.terrainY === "function") {
    const y = context.terrainY(x, z);
    if (Number.isFinite(y)) return Math.round(y);
  }
  const minX = Number(context.minX), minZ = Number(context.minZ), width = Number(context.width), height = Number(context.height);
  const elevationY = context.elevationY;
  if (Array.isArray(elevationY) || ArrayBuffer.isView(elevationY)) {
    const ix = Math.round(x - minX), iz = Math.round(z - minZ);
    if ([minX,minZ,width,height,ix,iz].every(Number.isFinite) && ix >= 0 && iz >= 0 && ix < width && iz < height) {
      const index = iz * width + ix;
      if ((!context.mask || context.mask[index]) && Number.isFinite(Number(elevationY[index]))) return Math.round(Number(elevationY[index]));
    }
  }
  const absolute = Number(reconstruction?.groundElevationM);
  const minDatum = Number(context.minDatum);
  if (Number.isFinite(absolute) && Number.isFinite(minDatum)) return Math.round(absolute - minDatum);
  return null;
}

function resolveHeightM(context, feature, reconstruction, treeEvidence, x, z, seed, index) {
  const explicit = firstFinite(
    reconstruction?.heightM,
    treeEvidence?.heightM,
    feature?.vertical?.heightM,
    feature?.tags?.tree_height_m,
    feature?.tags?.height_m
  );
  let measured = explicit;
  if (!Number.isFinite(measured) && typeof context.elevation?.sampleVegetationHeightLocal === "function") measured = Number(context.elevation.sampleVegetationHeightLocal(x, z));
  if (!Number.isFinite(measured) && typeof context.elevation?.samplePairLocal === "function") {
    const pair = context.elevation.samplePairLocal(x, z);
    if (Number.isFinite(pair?.surface) && Number.isFinite(pair?.terrain)) measured = pair.surface - pair.terrain;
  }
  if (!Number.isFinite(measured)) return null;
  const classification = String(reconstruction?.classification || "");
  const variation = /woodland|canopy/.test(classification)
    ? 0.80 + hash01(seed, x, z, `${feature.id}:height:${index}`) * 0.24
    : 1;
  return clamp(measured * variation, MIN_TREE_HEIGHT_M, MAX_TREE_HEIGHT_M);
}

function resolveCrownDiameterM(feature, reconstruction, treeEvidence, height, classification, seed, x, z, index) {
  const observed = firstFinite(
    reconstruction?.crownDiameterM,
    treeEvidence?.crownDiameterM,
    feature?.tags?.crown_diameter_m,
    feature?.tags?.crown_width_m
  );
  if (Number.isFinite(observed)) return clamp(observed, 2.5, 18);
  const ratio = /woodland|canopy/.test(classification) ? 0.38 : 0.48;
  const variation = 0.88 + hash01(seed, x, z, `${feature.id}:crown:${index}`) * 0.24;
  return clamp(height * ratio * variation, 3, 14);
}

function isObservedHeight(feature, reconstruction, treeEvidence, context, x, z) {
  if (Number.isFinite(Number(reconstruction?.heightM)) || Number.isFinite(Number(treeEvidence?.heightM)) || Number.isFinite(Number(feature?.tags?.tree_height_m)) || Number.isFinite(Number(feature?.tags?.height_m))) return true;
  if (typeof context.elevation?.sampleVegetationHeightLocal === "function") return Number.isFinite(Number(context.elevation.sampleVegetationHeightLocal(x, z)));
  return false;
}

function resolveTreeStyle(feature) {
  const tags = feature?.tags || {};
  const text = [tags.species, tags.genus, tags.tree_type, tags.leaf_type, tags.leaf_cycle, tags.vegetation, tags.natural, feature?.subkind, feature?.classification]
    .filter(Boolean).join(" ").toLowerCase();
  if (/spruce|pine|fir|cedar|yew|larch|conifer|needle/.test(text)) return { form: "conifer", log: "minecraft:spruce_log", leaves: "minecraft:spruce_leaves", evidence: text };
  if (/birch/.test(text)) return { form: "broadleaf", log: "minecraft:birch_log", leaves: "minecraft:birch_leaves", evidence: text };
  if (/dark oak/.test(text)) return { form: "broadleaf", log: "minecraft:dark_oak_log", leaves: "minecraft:dark_oak_leaves", evidence: text };
  return { form: "broadleaf", log: "minecraft:oak_log", leaves: "minecraft:oak_leaves", evidence: text || null };
}

function emitVoxelRuns(add, layer, set, block) {
  if (!set.size) return 0;
  const rows = new Map();
  for (const entry of set) {
    const [x,y,z] = parseKey(entry);
    const rowKey = `${y},${z}`;
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push(x);
  }
  let runs = 0;
  for (const [rowKey, xs] of rows) {
    xs.sort((a,b)=>a-b);
    const [y,z] = rowKey.split(",").map(Number);
    let start = xs[0], end = xs[0];
    for (let i = 1; i <= xs.length; i += 1) {
      const next = xs[i];
      if (i < xs.length && next <= end + 1) { end = next; continue; }
      add(layer, start, y, z, end, y, z, block);
      runs += 1;
      start = next; end = next;
    }
  }
  return runs;
}

function line3d(a, b) {
  const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
  const steps=Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz),1); const out=[];
  for(let i=0;i<=steps;i+=1){const t=i/steps;out.push([Math.round(a[0]+dx*t),Math.round(a[1]+dy*t),Math.round(a[2]+dz*t)]);}
  return out;
}
function countTrunkVoxels(set,x,z,r){let n=0;for(const v of set){const [vx,,vz]=parseKey(v);if(Math.abs(vx-x)<=r&&Math.abs(vz-z)<=r)n+=1;}return n;}
function voxelBoundsVolume(set){if(!set.size)return 0;let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;for(const v of set){const [x,y,z]=parseKey(v);minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);}return (maxX-minX+1)*(maxY-minY+1)*(maxZ-minZ+1);}
function polygonOuterRing(g){return g?.type==="Polygon"?g.coordinates?.[0]:g?.type==="MultiPolygon"?g.coordinates?.[0]?.[0]:null;}
function ringBounds(r){if(!Array.isArray(r)||r.length<4)return null;const xs=r.map(p=>Number(p[0])).filter(Number.isFinite),zs=r.map(p=>Number(p[1])).filter(Number.isFinite);if(!xs.length||!zs.length)return null;return{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};}
function polygonCentroid(r){const b=ringBounds(r);if(!b)return null;const c=[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2];if(pointInPolygon(c,r))return c;for(const p of r)if(Array.isArray(p)&&p.length>=2)return[Number(p[0]),Number(p[1])];return null;}
function pointInPolygon(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=Number(r[i][0]),zi=Number(r[i][1]),xj=Number(r[j][0]),zj=Number(r[j][1]);if(((zi>p[1])!==(zj>p[1]))&&(p[0]<(xj-xi)*(p[1]-zi)/(zj-zi+1e-12)+xi))inside=!inside;}return inside;}
function classifyFeature(feature,geometry){const t=[feature?.tags?.natural,feature?.tags?.landuse,feature?.tags?.landcover,feature?.tags?.vegetation,feature?.subkind,feature?.classification].filter(Boolean).join(" ").toLowerCase();if(geometry?.type==="Point"||/tree/.test(t))return"individual-tree";if(/wood|forest/.test(t))return"woodland";return"canopy-group";}
function isPlanningQa(feature){const t=feature?.tags||{};return t.planning_qa===true||String(t.planning_qa).toLowerCase()==="true";}
function positiveInteger(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return Math.floor(n);}return MAX_TREES_PER_FEATURE;}
function firstFinite(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n))return n;}return null;}
function key(x,y,z){return `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;}
function parseKey(value){return value.split(",").map(Number);}
function hash01(seed,x,z,salt){let h=2166136261>>>0;const text=`${seed}|${Math.round(Number(x)*1000)}|${Math.round(Number(z)*1000)}|${salt}`;for(let i=0;i<text.length;i+=1){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h/4294967295;}
function clamp(v,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
function round3(v){return Math.round(Number(v)*1000)/1000;}
