#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MARKER = "TPMAP_PARK_LANDSCAPING_FIDELITY_V1";

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
  const importLine = `import { tryCompileParkLandscapingVegetation, tryCompileParkLandscapingTerrainDetail, compileParkLandscapingBarrierRun } from "./park-landscaping-fidelity.mjs"; // ${MARKER}`;
  const imports = [...out.matchAll(/^import[^\n]*;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1), at = last.index + last[0].length;
    out = out.slice(0, at) + "\n" + importLine + out.slice(at);
  } else out = importLine + "\n" + out;

  out = injectFunction(out, "compileVegetationFeature", `\n  const parkLandscapeVegetation = tryCompileParkLandscapingVegetation(arguments[0] || {});\n  if (parkLandscapeVegetation) return parkLandscapeVegetation;`);
  out = injectFunction(out, "compileMappedTerrainDetail", `\n  const parkLandscapeTerrain = tryCompileParkLandscapingTerrainDetail(arguments[0] || {});\n  if (parkLandscapeTerrain) return parkLandscapeTerrain;`);

  const sceneryBarrier = `const parkSceneryBarrier = compileParkBarrierRun({ add, feature, x1, x2, z, terrainY, seed: typeof seed === "undefined" ? 0 : seed });`;
  if (!out.includes(sceneryBarrier)) throw new Error("Park scenery barrier hook must be installed before landscaping fidelity");
  out = out.replace(sceneryBarrier, `const parkLandscapeBarrier = compileParkLandscapingBarrierRun({ add, feature, x1, x2, z, terrainY, seed: typeof seed === "undefined" ? 0 : seed });\n              const parkSceneryBarrier = parkLandscapeBarrier || compileParkBarrierRun({ add, feature, x1, x2, z, terrainY, seed: typeof seed === "undefined" ? 0 : seed });`);
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
  const fixture = `import { tryCompileParkVegetation, tryCompileParkTerrainDetail, compileParkBarrierRun } from "./park-scenery-fidelity.mjs"; // TPMAP_PARK_SCENERY_FIDELITY_V1\nfunction compileVegetationFeature(context) { const parkSceneryVegetation = tryCompileParkVegetation(arguments[0] || {}); if (parkSceneryVegetation) return parkSceneryVegetation; return {legacy:true}; }\nfunction compileMappedTerrainDetail(context) { const parkSceneryTerrain = tryCompileParkTerrainDetail(arguments[0] || {}); if (parkSceneryTerrain) return parkSceneryTerrain; return {legacy:true}; }\nfunction compileVerticalFeatures() { let seed=1,feature={kind:"barrier"},add=()=>{},x1=0,x2=2,z=0,terrainY=64; if (feature.kind === "barrier") { const parkSceneryBarrier = compileParkBarrierRun({ add, feature, x1, x2, z, terrainY, seed: typeof seed === "undefined" ? 0 : seed }); if (!parkSceneryBarrier) add(4,x1,terrainY+1,z,x2,terrainY+2,z,"minecraft:oak_fence"); } }\n`;
  const once = patchRaster(fixture), twice = patchRaster(once);
  if (once !== twice) throw new Error("landscaping installer is not idempotent");
  for (const required of [MARKER, "tryCompileParkLandscapingVegetation(arguments[0]", "tryCompileParkLandscapingTerrainDetail(arguments[0]", "parkLandscapeBarrier || compileParkBarrierRun"]) {
    if (!once.includes(required)) throw new Error(`landscaping installer missing ${required}`);
  }
  process.stdout.write("park_landscaping_installer_self_test=PASS\n");
}

async function install(args) {
  if (!args.generator || !args.library) throw new Error("--generator and --library are required");
  const generator = resolve(args.generator), sourceLibrary = resolve(args.library);
  const raster = resolve(generator, "src/lib/raster.mjs"), targetLibrary = resolve(generator, "src/lib/park-landscaping-fidelity.mjs");
  const before = await readFile(raster, "utf8"), after = patchRaster(before);
  await mkdir(dirname(targetLibrary), { recursive: true });
  await copyFile(sourceLibrary, targetLibrary);
  if (after !== before) await writeFile(raster, after, "utf8");
  const report = {
    schemaVersion: 1, marker: MARKER, layer: "park-landscaping-fidelity-v1", rasterPatched: after !== before,
    capabilities: ["flowerbeds", "ferns", "long-grass", "fallen-logs", "planter-edges", "retaining-walls", "kerbs", "terrain-aware-slab-stair-wall-edging"],
    excluded: ["benches", "drains", "lamps", "bins"]
  };
  if (args.diagnostics) {
    await mkdir(dirname(resolve(args.diagnostics)), { recursive: true });
    await writeFile(resolve(args.diagnostics), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  process.stdout.write(`park_landscaping_fidelity=park-landscaping-fidelity-v1\nraster_patched=${after !== before}\n`);
}

const args = parse(process.argv);
if (args.selfTest) await selfTest();
else await install(args);
