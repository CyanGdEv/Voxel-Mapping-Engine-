#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MARKER = 'TPMAP_SURFACE_MATERIAL_LIBRARY_V1';
const DELEGATE_COMMENT = `// ${MARKER} integration delegated to src/lib/fidelity.mjs`;

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--generator') options.generator = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

export function patchSurfaceSampler(source) {
  if (source.includes(MARKER) && source.includes('blockForThemeParkSurfaceStyle')) return source;
  let out = source;
  const importLine = `import { blockForThemeParkSurfaceStyle, withThemeParkMaterialHints } from "./surface-material-library.mjs"; // ${MARKER}`;
  const imports = [...out.matchAll(/^import[^\n]*;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const at = last.index + last[0].length;
    out = out.slice(0, at) + '\n' + importLine + out.slice(at);
  } else out = importLine + '\n' + out;

  const fn = /(function\s+blockForSurfaceStyle\s*\(([^)]*)\)\s*\{)/m.exec(out) || /(const\s+blockForSurfaceStyle\s*=\s*\(([^)]*)\)\s*=>\s*\{)/m.exec(out);
  if (!fn) throw new Error('Unable to locate blockForSurfaceStyle in surface sampler module');
  const args = fn[2].split(',').map((value) => value.trim()).filter(Boolean);
  const [style = 'style', x = 'x', z = 'z', seed = 'seed'] = args;
  const hook = `\n  const themeParkSurfaceBlock = blockForThemeParkSurfaceStyle(${style}, ${x}, ${z}, ${seed || '0'});\n  if (themeParkSurfaceBlock) return themeParkSurfaceBlock;`;
  out = out.slice(0, fn.index + fn[1].length) + hook + out.slice(fn.index + fn[1].length);
  out = out.replace(/registerSurfaceStyle\(feature\.surfaceStyle\)/g, 'registerSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature))');
  out = out.replace(/blockForSurfaceStyle\(feature\.surfaceStyle\s*,/g, 'blockForSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature),');
  return out;
}

async function prepare(generatorRoot) {
  const generator = path.resolve(generatorRoot);
  const fidelity = path.join(generator, 'src/lib/fidelity.mjs');
  const raster = path.join(generator, 'src/lib/raster.mjs');
  const fidelitySource = await readFile(fidelity, 'utf8');
  const rasterSource = await readFile(raster, 'utf8');

  let integrationFile;
  if (/\bblockForSurfaceStyle\b/.test(fidelitySource)) {
    const patched = patchSurfaceSampler(fidelitySource);
    if (patched !== fidelitySource) await writeFile(fidelity, patched, 'utf8');
    integrationFile = 'src/lib/fidelity.mjs';
    if (!rasterSource.includes(MARKER)) await writeFile(raster, `${rasterSource.trimEnd()}\n\n${DELEGATE_COMMENT}\n`, 'utf8');
  } else if (/\bblockForSurfaceStyle\b/.test(rasterSource)) {
    const patched = patchSurfaceSampler(rasterSource);
    if (patched !== rasterSource) await writeFile(raster, patched, 'utf8');
    integrationFile = 'src/lib/raster.mjs';
  } else if (fidelitySource.includes(MARKER) || rasterSource.includes(MARKER)) {
    integrationFile = fidelitySource.includes(MARKER) ? 'src/lib/fidelity.mjs' : 'src/lib/raster.mjs';
  } else {
    throw new Error('Surface material prehook could not locate blockForSurfaceStyle in fidelity.mjs or raster.mjs');
  }

  const finalFidelity = await readFile(fidelity, 'utf8');
  const finalRaster = await readFile(raster, 'utf8');
  if (!finalFidelity.includes(MARKER) && !finalRaster.includes(MARKER)) throw new Error('Surface material integration marker missing after prehook');
  console.log(JSON.stringify({ status: 'ready', integrationFile, legacyInstallerRasterGuard: finalRaster.includes(MARKER) }));
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-surface-prehook-'));
  try {
    const fidelity = `import x from "./x.mjs";\nexport function blockForSurfaceStyle(style,x,z,seed){return style.primaryBlock;}\n`;
    const patched = patchSurfaceSampler(fidelity);
    if (!patched.includes(MARKER) || !patched.includes('blockForThemeParkSurfaceStyle(style, x, z, seed)')) throw new Error('Surface prehook sampler test failed');
    if (patchSurfaceSampler(patched) !== patched) throw new Error('Surface prehook is not idempotent');
    const generator = path.join(root, 'generator');
    await writeFile(path.join(root, 'placeholder'), 'x');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.join(generator, 'src/lib'), { recursive: true }));
    await writeFile(path.join(generator, 'src/lib/fidelity.mjs'), fidelity);
    await writeFile(path.join(generator, 'src/lib/raster.mjs'), 'export const raster = true;\n');
    await prepare(generator);
    const finalRaster = await readFile(path.join(generator, 'src/lib/raster.mjs'), 'utf8');
    if (!finalRaster.includes(DELEGATE_COMMENT)) throw new Error('Legacy raster guard marker was not installed');
    console.log('Surface material fidelity prehook self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.generator) throw new Error('Usage: prepare-surface-material-hook.mjs --generator <generator-root>');
    await prepare(options.generator);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
