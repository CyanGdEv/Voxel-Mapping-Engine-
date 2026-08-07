#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MANIFEST = 'cache-manifest.json';

function parseArgs(argv) {
  const out = { maxAgeHours: 24, mode: 'validate', park: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') out.selfTest = true;
    else if (arg === '--seal') out.mode = 'seal';
    else if (arg === '--input') out.input = argv[++i];
    else if (arg === '--park') out.park = argv[++i];
    else if (arg === '--max-age-hours') out.maxAgeHours = Number(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

async function hashFile(filename) {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { bytes, sha256: hash.digest('hex') };
}

async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const relative = path.relative(root, full).split(path.sep).join('/');
        if (relative !== MANIFEST) files.push({ relative, full });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function seal(input, park) {
  const root = path.resolve(input);
  await mkdir(root, { recursive: true });
  const files = await listFiles(root);
  if (!files.length) throw new Error('runtime cache contains no source files');
  const entries = [];
  let totalBytes = 0;
  for (const file of files) {
    const digest = await hashFile(file.full);
    totalBytes += digest.bytes;
    entries.push({ path: file.relative, bytes: digest.bytes, sha256: digest.sha256 });
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    park,
    totalBytes,
    files: entries
  };
  await writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return { status: 'sealed', files: entries.length, totalBytes, park };
}

async function validate(input, park, maxAgeHours) {
  const root = path.resolve(input);
  const manifest = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('invalid runtime cache manifest schema');
  if (park && manifest.park !== park) throw new Error(`runtime cache park mismatch (${manifest.park || 'missing'} != ${park})`);
  const generatedAt = Date.parse(manifest.generatedAt || '');
  if (!Number.isFinite(generatedAt)) throw new Error('runtime cache timestamp is invalid');
  const ageHours = (Date.now() - generatedAt) / 3_600_000;
  if (ageHours < -0.25) throw new Error('runtime cache timestamp is in the future');
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('max-age-hours must be positive');
  if (ageHours > maxAgeHours) throw new Error(`runtime cache is stale (${ageHours.toFixed(2)}h > ${maxAgeHours}h)`);
  if (!manifest.files.length) throw new Error('runtime cache manifest contains no source files');

  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!entry?.path || path.isAbsolute(entry.path) || entry.path.includes('..')) throw new Error(`unsafe runtime cache path ${entry?.path}`);
    const full = path.resolve(root, entry.path);
    const relative = path.relative(root, full);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`runtime cache path escapes root: ${entry.path}`);
    const info = await stat(full);
    if (!info.isFile() || info.size !== entry.bytes) throw new Error(`runtime cache byte mismatch: ${entry.path}`);
    const digest = await hashFile(full);
    if (digest.sha256 !== entry.sha256) throw new Error(`runtime cache hash mismatch: ${entry.path}`);
    totalBytes += digest.bytes;
  }
  if (totalBytes !== Number(manifest.totalBytes)) throw new Error(`runtime cache total byte mismatch (${totalBytes} != ${manifest.totalBytes})`);
  return { status: 'valid', files: manifest.files.length, totalBytes, ageHours, park: manifest.park };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-runtime-cache-'));
  try {
    await mkdir(path.join(root, 'supplemental', 'wikidata'), { recursive: true });
    await writeFile(path.join(root, 'supplemental', 'wikidata', 'sample.json'), '{"ok":true}\n');
    const sealed = await seal(root, 'alton-towers');
    if (sealed.files !== 1) throw new Error(`self-test seal failed: ${JSON.stringify(sealed)}`);
    const checked = await validate(root, 'alton-towers', 24);
    if (checked.status !== 'valid' || checked.files !== 1) throw new Error(`self-test validation failed: ${JSON.stringify(checked)}`);
    await writeFile(path.join(root, 'supplemental', 'wikidata', 'sample.json'), '{"ok":false}\n');
    let rejected = false;
    try { await validate(root, 'alton-towers', 24); } catch { rejected = true; }
    if (!rejected) throw new Error('self-test failed to reject modified cache data');
    console.log('park runtime cache self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else {
    if (!options.input) throw new Error('--input is required');
    if (!options.park) throw new Error('--park is required');
    const result = options.mode === 'seal'
      ? await seal(options.input, options.park)
      : await validate(options.input, options.park, options.maxAgeHours);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
