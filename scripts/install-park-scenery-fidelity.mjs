#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MARKER = "TPMAP_PARK_SCENERY_FIDELITY_V1";

function parse(argv) {
  const out = { selfTest: false, generator: null, library: null, diagnostics: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--generator") out.generator = argv[++i];
    else if (arg === "--library") out.library = argv[++i];
    else if (arg === "--diagnostics") out.diagnostics = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function patchRaster(source) {
  if (source.includes(MARKER)) return source;
  let out = String(source);
  const importLine = `import { tryCompileParkVegetation, tryCompileParkTerrainDetail, compileParkBarrierRun } from "./park-scenery-fidelity.mjs"; // ${MARKER}`;
  const imports = [...out.matchAll(/^import[^\n]*;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1), at = last.index + last[0].length;
    out = out.slice(0, at) + "\n" + importLine + out.slice(at);
  } else out = importLine + "\n" + out;

  out = injectFunction(out, "compileVegetationFeature", `\n  const parkSceneryVegetation = tryCompileParkVegetation(arguments[0] || {});\n  if (parkSceneryVegetation) return parkSceneryVegetation;`);
  out = injectFunction(out, "compileMappedTerrainDetail", `\n  const parkSceneryTerrain = tryCompileParkTerrainDetail(arguments[0] || {});\n  if (parkSceneryTerrain) return parkSceneryTerrain;`);

  const barrier = /if\s*\(\s*feature\.kind\s*===\s*["']barrier["']\s*\)\s*add\(\s*4\s*,\s*x1\s*,\s*terrainY\s*\+\s*1\s*,\s*z\s*,\s*x2\s*,\s*terrainY\s*\+\s*2\s*,\s*z\s*,\s*barrierBlock\(feature\)\s*\)\s*;/m;
  if (!barrier.test(out)) throw new Error("Unable to locate generic barrier run in src/lib/raster.mjs");
  out = out.replace(barrier, `if (feature.kind === "barrier") {\n              const parkSceneryBarrier = compileParkBarrierRun({ add, feature, x1, x2, z, terrainY, seed: typeof seed === "undefined" ? 0 : seed });\n              if (!parkSceneryBarrier) add(4, x1, terrainY + 1, z, x2, terrainY + 2, z, barrierBlock(feature));\n            }`);
  return out;
}

function injectFunction(source, name, body) {
  const pattern = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`Unable to locate ${name} in src/lib/raster.mjs`);
  const at = match.index + match[0].length;
  return source.slice(0, at) + body + source.slice(at);
}

async function selfTest() {
  const fixture = `import x from "./x.mjs";\nfunction compileVegetationFeature(context) { return {legacy:true}; }\nfunction compileMappedTerrainDetail(context) { return {legacy:true}; }\nfunction barrierBlock(feature) { return "minecraft:oak_fence"; }\nfunction compileVerticalFeatures() { let seed=1,feature={kind:"barrier"},add=()=>{},x1=0,x2=2,z=0,terrainY=64; if (feature.kind === "barrier") add(4, x1, terrainY + 1, z, x2, terrainY + 2, z, barrierBlock(feature)); }\n`;
  const once = patchRaster(fixture), twice = patchRaster(once);
  if (once !== twice) throw new Error("scenery installer is not idempotent");
  for (const required of [MARKER, "tryCompileParkVegetation(arguments[0]", "tryCompileParkTerrainDetail(arguments[0]", "compileParkBarrierRun({ add, feature, x1, x2, z, terrainY"]) {
    if (!once.includes(required)) throw new Error(`scenery installer missing ${required}`);
  }
  process.stdout.write("park_scenery_installer_self_test=PASS\n");
}

async function install(args) {
  if (!args.generator || !args.library) throw new Error("--generator and --library are required");
  const generator = resolve(args.generator), sourceLibrary = resolve(args.library);
  const raster = resolve(generator, "src/lib/raster.mjs"), targetLibrary = resolve(generator, "src/lib/park-scenery-fidelity.mjs");
  const before = await readFile(raster, "utf8"), after = patchRaster(before);
  await mkdir(dirname(targetLibrary), { recursive: true });
  await copyFile(sourceLibrary, targetLibrary);
  if (after !== before) await writeFile(raster, after, "utf8");
  const report = { schemaVersion: 1, marker: MARKER, layer: "park-scenery-fidelity-v1", rasterPatched: after !== before,
    capabilities: ["species-aware-tree-shapes", "layered-canopies", "root-stairs-and-slabs", "high-fidelity-boulders", "wall-slab-stair-rock-edges", "typed-park-barriers", "hedges-and-planting"] };
  if (args.diagnostics) {
    await mkdir(dirname(resolve(args.diagnostics)), { recursive: true });
    await writeFile(resolve(args.diagnostics), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  process.stdout.write(`park_scenery_fidelity=park-scenery-fidelity-v1\nraster_patched=${after !== before}\n`);
}

const args = parse(process.argv);
if (args.selfTest) await selfTest();
else await install(args);
