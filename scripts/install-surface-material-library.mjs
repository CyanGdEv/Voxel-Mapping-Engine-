#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MARKER = "TPMAP_SURFACE_MATERIAL_LIBRARY_V1";

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
  let out = source;
  const importLine = `import { blockForThemeParkSurfaceStyle, withThemeParkMaterialHints } from "./surface-material-library.mjs"; // ${MARKER}`;
  const imports = [...out.matchAll(/^import[^\n]*;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const at = last.index + last[0].length;
    out = out.slice(0, at) + "\n" + importLine + out.slice(at);
  } else out = importLine + "\n" + out;

  const fn = /(function\s+blockForSurfaceStyle\s*\(([^)]*)\)\s*\{)/m.exec(out) || /(const\s+blockForSurfaceStyle\s*=\s*\(([^)]*)\)\s*=>\s*\{)/m.exec(out);
  if (!fn) throw new Error("Unable to locate blockForSurfaceStyle in src/lib/raster.mjs");
  const args = fn[2].split(",").map((v) => v.trim()).filter(Boolean);
  const [style = "style", x = "x", z = "z", seed = "seed"] = args;
  const hook = `\n  const themeParkSurfaceBlock = blockForThemeParkSurfaceStyle(${style}, ${x}, ${z}, ${seed || "0"});\n  if (themeParkSurfaceBlock) return themeParkSurfaceBlock;`;
  out = out.slice(0, fn.index + fn[1].length) + hook + out.slice(fn.index + fn[1].length);
  out = out.replace(/registerSurfaceStyle\(feature\.surfaceStyle\)/g, "registerSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature))");
  out = out.replace(/blockForSurfaceStyle\(feature\.surfaceStyle\s*,/g, "blockForSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature),");
  return out;
}

async function selfTest() {
  const fixture = `import x from "./x.mjs";\nfunction blockForSurfaceStyle(style, x, z, seed) { return style.primaryBlock; }\nfunction f(feature, accessCode, baseCode) { const code = accessCode ? registerSurfaceStyle(feature.surfaceStyle) : baseCode; return blockForSurfaceStyle(feature.surfaceStyle, 1, 2, 3); }\n`;
  const once = patchRaster(fixture), twice = patchRaster(once);
  if (once !== twice || !once.includes(MARKER) || !once.includes("withThemeParkMaterialHints(feature.surfaceStyle, feature)")) throw new Error("surface material raster transform self-test failed");
  process.stdout.write("surface_material_installer_self_test=PASS\n");
}

async function install(args) {
  if (!args.generator || !args.library) throw new Error("--generator and --library are required");
  const generator = resolve(args.generator), sourceLibrary = resolve(args.library);
  const raster = resolve(generator, "src/lib/raster.mjs"), targetLibrary = resolve(generator, "src/lib/surface-material-library.mjs");
  const before = await readFile(raster, "utf8"), after = patchRaster(before);
  await mkdir(dirname(targetLibrary), { recursive: true });
  await copyFile(sourceLibrary, targetLibrary);
  if (after !== before) await writeFile(raster, after, "utf8");
  if (args.diagnostics) {
    const report = { schemaVersion: 1, marker: MARKER, library: "themepark-surface-materials-v1", rasterPatched: after !== before, presets: 29 };
    await mkdir(dirname(resolve(args.diagnostics)), { recursive: true });
    await writeFile(resolve(args.diagnostics), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  process.stdout.write(`surface_material_library=themepark-surface-materials-v1\npresets=29\nraster_patched=${after !== before}\n`);
}

const args = parse(process.argv);
if (args.selfTest) await selfTest();
else await install(args);
