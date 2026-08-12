// TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1
// Shared, deterministic structural-material recipes for Minecraft-native forms.
// Material chooses appearance; role chooses construction form. Stateful forms are
// represented as palette descriptors and rely on Phase 35 block-state transport.

const MARKER = "TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1";
export const STRUCTURAL_MATERIAL_PATTERN_MARKER = MARKER;

const RECIPES = Object.freeze({
  brick: recipe({
    body: weighted([["minecraft:brick_block",70],["minecraft:mud_bricks",15],["minecraft:cracked_stone_bricks",10],["minecraft:mossy_stone_bricks",5]]),
    wall: "minecraft:brick_wall", slab: "minecraft:brick_slab", stair: "minecraft:brick_stairs",
    railing: "minecraft:brick_wall", fence: "minecraft:brick_wall", pane: "minecraft:glass_pane",
    carpet: "minecraft:red_carpet", trapdoor: "minecraft:spruce_trapdoor"
  }),
  stone: recipe({
    body: weighted([["minecraft:stone_bricks",62],["minecraft:andesite",18],["minecraft:cobblestone",12],["minecraft:mossy_stone_bricks",8]]),
    wall: "minecraft:stone_brick_wall", slab: "minecraft:stone_brick_slab", stair: "minecraft:stone_brick_stairs",
    railing: "minecraft:stone_brick_wall", fence: "minecraft:stone_brick_wall", pane: "minecraft:glass_pane",
    carpet: "minecraft:gray_carpet", trapdoor: "minecraft:iron_trapdoor"
  }),
  sandstone: recipe({
    body: weighted([["minecraft:sandstone",60],["minecraft:cut_sandstone",25],["minecraft:smooth_sandstone",15]]),
    wall: "minecraft:sandstone_wall", slab: "minecraft:sandstone_slab", stair: "minecraft:sandstone_stairs",
    railing: "minecraft:sandstone_wall", fence: "minecraft:sandstone_wall", pane: "minecraft:glass_pane",
    carpet: "minecraft:white_carpet", trapdoor: "minecraft:birch_trapdoor"
  }),
  concrete: recipe({
    body: weighted([["minecraft:smooth_stone",62],["minecraft:light_gray_concrete",23],["minecraft:stone",15]]),
    wall: "minecraft:stone_brick_wall", slab: "minecraft:normal_stone_slab", stair: "minecraft:normal_stone_stairs",
    railing: "minecraft:iron_bars", fence: "minecraft:iron_bars", pane: "minecraft:glass_pane",
    carpet: "minecraft:light_gray_carpet", trapdoor: "minecraft:iron_trapdoor"
  }),
  timber: recipe({
    body: weighted([["minecraft:spruce_planks",68],["minecraft:dark_oak_planks",20],["minecraft:oak_planks",12]]),
    wall: "minecraft:spruce_fence", slab: "minecraft:spruce_slab", stair: "minecraft:spruce_stairs",
    railing: "minecraft:spruce_fence", fence: "minecraft:spruce_fence", pane: "minecraft:glass_pane",
    carpet: "minecraft:brown_carpet", trapdoor: "minecraft:spruce_trapdoor"
  }),
  metal: recipe({
    body: weighted([["minecraft:iron_block",70],["minecraft:polished_blackstone",30]]),
    wall: "minecraft:iron_bars", slab: null, stair: null,
    railing: "minecraft:iron_bars", fence: "minecraft:iron_bars", pane: "minecraft:glass_pane",
    carpet: "minecraft:black_carpet", trapdoor: "minecraft:iron_trapdoor"
  }),
  glass: recipe({
    body: weighted([["minecraft:glass",100]]),
    wall: "minecraft:glass_pane", slab: null, stair: null,
    railing: "minecraft:glass_pane", fence: "minecraft:glass_pane", pane: "minecraft:glass_pane",
    carpet: null, trapdoor: null
  }),
  carpet: recipe({
    body: weighted([["minecraft:gray_carpet",100]]),
    wall: null, slab: null, stair: null,
    railing: null, fence: null, pane: null,
    carpet: "minecraft:gray_carpet", trapdoor: null
  })
});

const MATERIAL_ALIASES = Object.freeze({
  brick:"brick", bricks:"brick", brickwork:"brick", masonry:"brick", old_brick:"brick", red_brick:"brick",
  stone:"stone", stonework:"stone", blockwork:"stone", cobble:"stone", cobblestone:"stone", andesite:"stone",
  sandstone:"sandstone", buff_stone:"sandstone", beige_stone:"sandstone",
  concrete:"concrete", cement:"concrete", precast:"concrete", rendered_concrete:"concrete",
  timber:"timber", wood:"timber", wooden:"timber", spruce:"timber", oak:"timber", decking:"timber",
  metal:"metal", steel:"metal", iron:"metal", aluminium:"metal", aluminum:"metal", railing:"metal", mesh:"metal",
  glass:"glass", glazing:"glass", glazed:"glass", transparent:"glass",
  carpet:"carpet", textile:"carpet", fabric:"carpet"
});
const SORTED_MATERIAL_ALIASES=Object.freeze(Object.entries(MATERIAL_ALIASES).sort((a,b)=>b[0].length-a[0].length||a[0].localeCompare(b[0])));

const ROLE_ALIASES = Object.freeze({
  body:"body", full:"body", full_block:"body", solid:"body", structural:"body",
  wall:"wall", thin_wall:"wall", boundary_wall:"wall",
  cap:"slab", coping:"slab", slab:"slab", ledge:"slab",
  stair:"stair", stairs:"stair", step:"stair", steps:"stair",
  railing:"railing", railings:"railing", bars:"railing", iron_bars:"railing", guardrail:"railing", balustrade:"railing",
  fence:"fence", fencing:"fence",
  pane:"pane", glass_pane:"pane", glazing:"pane", window:"pane",
  carpet:"carpet", overlay:"carpet", floor_covering:"carpet",
  trapdoor:"trapdoor", hatch:"trapdoor", grille:"trapdoor", access_panel:"trapdoor", panel:"trapdoor"
});

const COLOUR_BLOCKS = Object.freeze({
  pane: Object.freeze({
    black:"minecraft:black_stained_glass_pane", gray:"minecraft:gray_stained_glass_pane", grey:"minecraft:gray_stained_glass_pane",
    white:"minecraft:white_stained_glass_pane", red:"minecraft:red_stained_glass_pane", blue:"minecraft:blue_stained_glass_pane",
    green:"minecraft:green_stained_glass_pane", light_blue:"minecraft:light_blue_stained_glass_pane"
  }),
  carpet: Object.freeze({
    black:"minecraft:black_carpet", gray:"minecraft:gray_carpet", grey:"minecraft:gray_carpet", white:"minecraft:white_carpet",
    red:"minecraft:red_carpet", blue:"minecraft:blue_carpet", green:"minecraft:green_carpet", brown:"minecraft:brown_carpet",
    light_gray:"minecraft:light_gray_carpet", light_grey:"minecraft:light_gray_carpet"
  })
});

export const STRUCTURAL_PATTERN_BLOCK_IDS = Object.freeze([...new Set(
  Object.values(RECIPES).flatMap((r) => [
    ...r.body.map((entry) => entry.block), r.wall, r.slab, r.stair, r.railing, r.fence, r.pane, r.carpet, r.trapdoor
  ].filter(Boolean)).concat(Object.values(COLOUR_BLOCKS.pane), Object.values(COLOUR_BLOCKS.carpet))
)].sort());

export function structuralMaterialFamily(value, tags = {}) {
  const candidates = [value, tags.material, tags.wall_material, tags.fence_material, tags.surface_material, tags.building_material];
  for (const candidate of candidates) {
    const key = norm(candidate);
    if (!key) continue;
    if (MATERIAL_ALIASES[key]) return MATERIAL_ALIASES[key];
    for (const [alias, family] of SORTED_MATERIAL_ALIASES) if (key.includes(alias)) return family;
  }
  return null;
}

export function structuralBlockFor(input = {}) {
  const requested=input.material || input.family;
  const family = structuralMaterialFamily(requested, input.tags || {});
  if(requested && !family)throw new Error(`Unsupported structural material family: ${requested}`);
  const resolvedFamily=family||"stone";
  const role = ROLE_ALIASES[norm(input.role || "body")];
  if (!role) throw new Error(`Unsupported structural material role: ${input.role}`);
  const recipe = RECIPES[resolvedFamily];
  if (!recipe) throw new Error(`Unsupported structural material family: ${resolvedFamily}`);

  if (role === "body") return chooseWeighted(recipe.body, input);
  if (role === "pane") {
    if(!recipe.pane)throwUnsupportedForm(resolvedFamily,role);
    return colourOverride("pane", input.colour || input.color) || recipe.pane;
  }
  if (role === "carpet") {
    if(!recipe.carpet)throwUnsupportedForm(resolvedFamily,role);
    return colourOverride("carpet", input.colour || input.color) || recipe.carpet;
  }
  if (role === "stair") {
    if(!recipe.stair)throwUnsupportedForm(resolvedFamily,role);
    return { name: recipe.stair, states: { upside_down_bit: Boolean(input.upsideDown), weirdo_direction: stairDirection(input.orientation ?? input.direction) } };
  }
  if (role === "trapdoor") {
    if(!recipe.trapdoor)throwUnsupportedForm(resolvedFamily,role);
    return { name: recipe.trapdoor, states: { direction: boundedDirection(input.direction ?? input.orientation), open_bit: Boolean(input.open), upside_down_bit: Boolean(input.upsideDown) } };
  }
  const block=recipe[role];if(!block)throwUnsupportedForm(resolvedFamily,role);return block;
}

export function structuralPatternCapabilities() {
  return Object.freeze({
    marker: MARKER,
    deterministic: true,
    stateful: true,
    fullBlocks: true,
    walls: true,
    slabs: true,
    stairs: true,
    railings: true,
    fences: true,
    ironBars: true,
    glassPanes: true,
    carpets: true,
    trapdoors: true,
    failClosedUnsupportedForms:true,
    materialFamilies: Object.keys(RECIPES).length,
    registeredBlocks: STRUCTURAL_PATTERN_BLOCK_IDS.length
  });
}

export function structuralDescriptorKey(value) {
  return typeof value === "string" ? `s:${value}` : `o:${JSON.stringify(value)}`;
}

function recipe(value) { return Object.freeze(value); }
function weighted(entries) {
  const clean = entries.map(([block, weight]) => Object.freeze({ block, weight:Number(weight) })).filter((e) => e.weight > 0);
  const total = clean.reduce((n,e)=>n+e.weight,0);
  if (!clean.length || total <= 0) throw new Error("Structural material recipe has no weighted body blocks");
  return Object.freeze(clean.map((e) => Object.freeze({ block:e.block, weight:e.weight/total })));
}
function chooseWeighted(entries, input) {
  const r = hash01(`${input.seed ?? 0}:${input.featureId ?? ""}:${input.x ?? 0}:${input.y ?? 0}:${input.z ?? 0}`);
  let acc=0;
  for (const entry of entries) { acc += entry.weight; if (r <= acc + 1e-12) return entry.block; }
  return entries.at(-1).block;
}
function colourOverride(role, value) {
  const key=norm(value);
  if (!key) return null;
  const table=COLOUR_BLOCKS[role];
  if (table[key]) return table[key];
  for (const [name,block] of Object.entries(table).sort((a,b)=>b[0].length-a[0].length)) if (key.includes(name)) return block;
  return null;
}
function stairDirection(value) {
  if (Number.isInteger(Number(value))) return boundedDirection(value);
  const key=norm(value);
  return key==="east"?0:key==="west"?1:key==="south"?2:key==="north"?3:0;
}
function boundedDirection(value) { const n=Number(value); return Number.isInteger(n) ? ((n%4)+4)%4 : 0; }
function throwUnsupportedForm(family,role){throw new Error(`Structural material family ${family} does not support role ${role}`);}
function norm(value) { return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g,"_"); }
function hash01(text) { let h=2166136261; for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0)/4294967296; }
