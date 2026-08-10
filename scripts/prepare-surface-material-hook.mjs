#!/usr/bin/env node
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'TPMAP_SURFACE_MATERIAL_LIBRARY_V1';
const HOOK_MARKER = 'TPMAP_SURFACE_MATERIAL_HOOK_V2';
const DELEGATE_COMMENT = `// ${MARKER} integration delegated to src/lib/fidelity.mjs`;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBRARY = path.resolve(SCRIPT_DIR, '../patches/v0120-phase30/surface-material-library.mjs');

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--generator') options.generator = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function stripSurfaceIntegration(source) {
  let out = source
    .split(/\r?\n/)
    .filter((line) => !line.includes(MARKER) && !line.includes(HOOK_MARKER))
    .join('\n');

  out = out.replace(
    /^[ \t]*import\s*\{[^}\n]*\bblockForThemeParkSurfaceStyle\b[^}\n]*\}\s*from\s*["']\.\/surface-material-library\.mjs["'];?[^\n]*\n?/gm,
    ''
  );
  out = out.replace(
    /^[ \t]*const\s+themeParkSurfaceBlock\s*=\s*blockForThemeParkSurfaceStyle\([^;\n]*\);[ \t]*\n[ \t]*if\s*\(\s*themeParkSurfaceBlock\s*\)\s*return\s+themeParkSurfaceBlock;[ \t]*\n?/gm,
    ''
  );
  return out;
}

function locateSurfaceFunctions(source) {
  const expressions = [
    /\bfunction\s+blockForSurfaceStyle\s*\(([^)]*)\)\s*\{/gm,
    /\bconst\s+blockForSurfaceStyle\s*=\s*\(([^)]*)\)\s*=>\s*\{/gm
  ];
  const matches = [];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      matches.push({ index: match.index, text: match[0], args: match[1] });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function validateSurfaceSampler(source) {
  const imports = countMatches(
    source,
    /import\s*\{[^}\n]*\bblockForThemeParkSurfaceStyle\b[^}\n]*\bwithThemeParkMaterialHints\b[^}\n]*\}\s*from\s*["']\.\/surface-material-library\.mjs["']/g
  );
  const hooks = countMatches(source, /\bconst\s+themeParkSurfaceBlock\s*=\s*blockForThemeParkSurfaceStyle\s*\(/g);
  const hookReturns = countMatches(source, /\bif\s*\(\s*themeParkSurfaceBlock\s*\)\s*return\s+themeParkSurfaceBlock\s*;/g);
  const markerCount = countMatches(source, new RegExp(MARKER, 'g'));
  const hookMarkerCount = countMatches(source, new RegExp(HOOK_MARKER, 'g'));

  if (imports !== 1 || hooks !== 1 || hookReturns !== 1 || markerCount !== 1 || hookMarkerCount !== 1) {
    throw new Error(
      `Surface material integration postcondition failed imports=${imports} hooks=${hooks} hookReturns=${hookReturns} marker=${markerCount} hookMarker=${hookMarkerCount}`
    );
  }
  if (locateSurfaceFunctions(source).length !== 1) {
    throw new Error('Surface material integration requires exactly one blockForSurfaceStyle implementation');
  }
}

export function patchSurfaceSampler(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Surface sampler source must be non-empty text');

  let out = stripSurfaceIntegration(source);
  const functions = locateSurfaceFunctions(out);
  if (functions.length !== 1) {
    throw new Error(`Surface material prehook expected exactly one blockForSurfaceStyle implementation, found ${functions.length}`);
  }

  const importLine = `import { blockForThemeParkSurfaceStyle, withThemeParkMaterialHints } from "./surface-material-library.mjs"; // ${MARKER}`;
  const imports = [...out.matchAll(/^import[^\n]*;[ \t]*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const at = last.index + last[0].length;
    out = out.slice(0, at) + '\n' + importLine + out.slice(at);
  } else {
    out = importLine + '\n' + out;
  }

  const [fn] = locateSurfaceFunctions(out);
  const args = fn.args.split(',').map((value) => value.trim()).filter(Boolean);
  const names = ['style', 'x', 'z', 'seed'].map((fallback, index) => (args[index] || fallback).replace(/\s*=.*$/, '').trim() || fallback);
  const hook = `\n  // ${HOOK_MARKER}\n  const themeParkSurfaceBlock = blockForThemeParkSurfaceStyle(${names[0]}, ${names[1]}, ${names[2]}, ${names[3]});\n  if (themeParkSurfaceBlock) return themeParkSurfaceBlock;\n`;
  const bodyOpen = fn.index + fn.text.lastIndexOf('{') + 1;
  const bodyTail = out.slice(bodyOpen).replace(/^\r?\n/, '');
  out = out.slice(0, bodyOpen) + hook + bodyTail;

  out = out.replace(
    /registerSurfaceStyle\s*\(\s*feature\.surfaceStyle\s*\)/g,
    'registerSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature))'
  );
  out = out.replace(
    /blockForSurfaceStyle\s*\(\s*feature\.surfaceStyle\s*,/g,
    'blockForSurfaceStyle(withThemeParkMaterialHints(feature.surfaceStyle, feature),'
  );

  validateSurfaceSampler(out);
  return out;
}

async function fileExists(file) {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

async function ensureSurfaceLibrary(generator) {
  const target = path.join(generator, 'src/lib/surface-material-library.mjs');
  if (await fileExists(target)) return { target, bootstrapped: false };
  if (!(await fileExists(DEFAULT_LIBRARY))) {
    throw new Error(`Surface material prehook cannot bootstrap missing library: ${DEFAULT_LIBRARY}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(DEFAULT_LIBRARY, target);
  return { target, bootstrapped: true };
}

function delegatedRaster(source) {
  const clean = source
    .split(/\r?\n/)
    .filter((line) => !line.includes(MARKER))
    .join('\n')
    .trimEnd();
  return `${clean}\n\n${DELEGATE_COMMENT}\n`;
}

async function prepare(generatorRoot) {
  const generator = path.resolve(generatorRoot);
  const fidelity = path.join(generator, 'src/lib/fidelity.mjs');
  const raster = path.join(generator, 'src/lib/raster.mjs');

  const library = await ensureSurfaceLibrary(generator);
  const fidelitySource = await readFile(fidelity, 'utf8');
  const rasterSource = await readFile(raster, 'utf8');

  const fidelityCount = locateSurfaceFunctions(stripSurfaceIntegration(fidelitySource)).length;
  const rasterCount = locateSurfaceFunctions(stripSurfaceIntegration(rasterSource)).length;
  if (fidelityCount > 1 || rasterCount > 1) {
    throw new Error(`Surface material prehook found duplicate blockForSurfaceStyle implementations fidelity=${fidelityCount} raster=${rasterCount}`);
  }

  // Preserve the historical fidelity-first compatibility rule when both old
  // and new generator modules expose a sampler during an upstream transition.
  // We still require the selected module itself to have exactly one target.
  let integrationFile;
  let integrationPath;
  let integrationSource;
  if (fidelityCount === 1) [integrationFile, integrationPath, integrationSource] = ['src/lib/fidelity.mjs', fidelity, fidelitySource];
  else if (rasterCount === 1) [integrationFile, integrationPath, integrationSource] = ['src/lib/raster.mjs', raster, rasterSource];
  else throw new Error('Surface material prehook could not locate blockForSurfaceStyle in fidelity.mjs or raster.mjs');
  const patched = patchSurfaceSampler(integrationSource);
  if (patched !== integrationSource) await writeFile(integrationPath, patched, 'utf8');

  if (integrationFile === 'src/lib/fidelity.mjs') {
    const nextRaster = delegatedRaster(rasterSource);
    if (nextRaster !== rasterSource) await writeFile(raster, nextRaster, 'utf8');
  }

  const finalFidelity = await readFile(fidelity, 'utf8');
  const finalRaster = await readFile(raster, 'utf8');
  const finalIntegration = integrationFile === 'src/lib/fidelity.mjs' ? finalFidelity : finalRaster;
  validateSurfaceSampler(finalIntegration);

  if (integrationFile === 'src/lib/fidelity.mjs' && countMatches(finalRaster, new RegExp(MARKER, 'g')) !== 1) {
    throw new Error('Surface material raster delegation marker is missing or duplicated');
  }
  if (!(await fileExists(library.target))) throw new Error('Surface material library missing after prehook bootstrap');

  console.log(JSON.stringify({
    status: 'ready',
    integrationFile,
    legacyInstallerRasterGuard: finalRaster.includes(MARKER),
    libraryBootstrapped: library.bootstrapped
  }));
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-surface-prehook-'));
  try {
    const fidelity = `import x from "./x.mjs";\nexport function blockForSurfaceStyle ( style , x , z , seed = 0 ) { return style.primaryBlock; }\n`;
    const patched = patchSurfaceSampler(fidelity);
    if (!patched.includes(MARKER) || !patched.includes(HOOK_MARKER) || !patched.includes('blockForThemeParkSurfaceStyle(style, x, z, seed)')) {
      throw new Error('Surface prehook sampler test failed');
    }
    if (patchSurfaceSampler(patched) !== patched) throw new Error('Surface prehook is not idempotent');

    const partial = patched
      .replace(/^import[^\n]*surface-material-library\.mjs[^\n]*\n/m, `// ${MARKER}\n`)
      .replace(new RegExp(`^[ \\t]*// ${HOOK_MARKER}\\n`, 'm'), '');
    const repaired = patchSurfaceSampler(partial);
    validateSurfaceSampler(repaired);
    if (repaired !== patched) throw new Error('Surface prehook did not canonically repair partial integration');

    const duplicate = `${fidelity}\nfunction blockForSurfaceStyle(style,x,z,seed){ return null; }\n`;
    let duplicateRejected = false;
    try {
      patchSurfaceSampler(duplicate);
    } catch (error) {
      duplicateRejected = /exactly one/.test(String(error?.message));
    }
    if (!duplicateRejected) throw new Error('Surface prehook did not reject duplicate integration targets');

    const generator = path.join(root, 'generator');
    await mkdir(path.join(generator, 'src/lib'), { recursive: true });
    await writeFile(path.join(generator, 'src/lib/fidelity.mjs'), fidelity);
    await writeFile(path.join(generator, 'src/lib/raster.mjs'), 'export const raster = true;\n');
    await prepare(generator);
    const firstFidelity = await readFile(path.join(generator, 'src/lib/fidelity.mjs'), 'utf8');
    const firstRaster = await readFile(path.join(generator, 'src/lib/raster.mjs'), 'utf8');
    await prepare(generator);
    const secondFidelity = await readFile(path.join(generator, 'src/lib/fidelity.mjs'), 'utf8');
    const secondRaster = await readFile(path.join(generator, 'src/lib/raster.mjs'), 'utf8');
    if (firstFidelity !== secondFidelity || firstRaster !== secondRaster) {
      throw new Error('Surface prehook prepare operation is not byte-idempotent');
    }

    const finalLibrary = await readFile(path.join(generator, 'src/lib/surface-material-library.mjs'), 'utf8');
    if (!secondRaster.includes(DELEGATE_COMMENT)) throw new Error('Legacy raster guard marker was not installed');
    if (!finalLibrary.includes('THEMEPARK_SURFACE_MATERIAL_PRESETS')) throw new Error('Surface prehook library bootstrap failed');
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
