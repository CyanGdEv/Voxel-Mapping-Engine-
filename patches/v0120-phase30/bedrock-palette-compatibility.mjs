#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const UNSUPPORTED = 'minecraft:polished_blackstone_wall';
const SUPPORTED = 'minecraft:iron_bars';

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--file') options.file = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

export function transformSceneryPalette(text) {
  const count = text.split(UNSUPPORTED).length - 1;
  if (count === 0) {
    if (text.includes(SUPPORTED)) return { text, changed: false, replacements: 0 };
    throw new Error(`Palette compatibility transform could not find ${UNSUPPORTED}`);
  }
  if (count !== 1) throw new Error(`Expected exactly one ${UNSUPPORTED} reference, found ${count}`);
  return {
    text: text.replace(UNSUPPORTED, SUPPORTED),
    changed: true,
    replacements: 1,
  };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-palette-compat-'));
  try {
    const sample = `export const x = "${UNSUPPORTED}";\nexport const y = "minecraft:iron_bars";\n`;
    const first = transformSceneryPalette(sample);
    if (!first.changed || first.replacements !== 1) throw new Error('Expected one palette replacement');
    if (first.text.includes(UNSUPPORTED)) throw new Error('Unsupported block survived transform');
    if (!first.text.includes(SUPPORTED)) throw new Error('Supported metal barrier block missing after transform');
    const second = transformSceneryPalette(first.text);
    if (second.changed || second.text !== first.text) throw new Error('Palette compatibility transform is not idempotent');
    const file = path.join(root, 'park-scenery-fidelity.mjs');
    await writeFile(file, sample);
    const transformed = transformSceneryPalette(await readFile(file, 'utf8'));
    await writeFile(file, transformed.text);
    if ((await readFile(file, 'utf8')).includes(UNSUPPORTED)) throw new Error('File transform left unsupported block behind');
    console.log('Bedrock scenery palette compatibility self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) {
    await selfTest();
  } else {
    if (!options.file) throw new Error('Usage: bedrock-palette-compatibility.mjs --file <park-scenery-fidelity.mjs>');
    const filename = path.resolve(options.file);
    const original = await readFile(filename, 'utf8');
    const transformed = transformSceneryPalette(original);
    if (transformed.changed) await writeFile(filename, transformed.text);
    const finalText = transformed.changed ? transformed.text : original;
    if (finalText.includes(UNSUPPORTED)) throw new Error(`Unsupported Bedrock palette block remains: ${UNSUPPORTED}`);
    console.log(JSON.stringify({
      status: transformed.changed ? 'patched' : 'already-patched',
      file: filename,
      replacements: transformed.replacements,
      removed: UNSUPPORTED,
      replacement: SUPPORTED,
    }));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
