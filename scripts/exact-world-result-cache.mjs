#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RESULT_MANIFEST = 'exact-world-cache.json';

function parseArgs(argv) {
  const options = { mode: 'key', maxAgeHours: 24 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--key') options.mode = 'key';
    else if (arg === '--seal') options.mode = 'seal';
    else if (arg === '--validate') options.mode = 'validate';
    else if (arg === '--runtime-manifest') options.runtimeManifest = argv[++i];
    else if (arg === '--planning-manifest') options.planningManifest = argv[++i];
    else if (arg === '--park') options.park = argv[++i];
    else if (arg === '--repo-sha') options.repoSha = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--fingerprint') options.fingerprint = argv[++i];
    else if (arg === '--max-age-hours') options.maxAgeHours = Number(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
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

async function findWorlds(root) {
  const worlds = [];
  async function walk(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mcworld')) worlds.push(full);
    }
  }
  await walk(root);
  return worlds.sort();
}

function selectedSettings(environment) {
  return Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) => key.startsWith('TPMAP_'))
      .filter(([key]) => !['TPMAP_SHARED_CACHE_DIR', 'TPMAP_PLANNING_PREFETCH_DIR'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

async function computeFingerprint(options, environment = process.env) {
  if (!options.runtimeManifest) throw new Error('--runtime-manifest is required for key mode');
  if (!options.park) throw new Error('--park is required for key mode');
  if (!options.repoSha) throw new Error('--repo-sha is required for key mode');
  const runtime = await readFile(path.resolve(options.runtimeManifest));
  const planning = options.planningManifest ? await readFile(path.resolve(options.planningManifest)) : Buffer.from('planning:not-applicable');
  const hash = createHash('sha256');
  hash.update('tpmap-exact-world-result-v1\0');
  hash.update(String(options.repoSha)); hash.update('\0');
  hash.update(String(options.park)); hash.update('\0');
  hash.update(JSON.stringify(selectedSettings(environment))); hash.update('\0');
  hash.update(runtime); hash.update('\0');
  hash.update(planning); hash.update('\0');
  return hash.digest('hex');
}

async function seal(options) {
  if (!options.output || !options.fingerprint || !options.park) throw new Error('--output, --fingerprint and --park are required for seal mode');
  const root = path.resolve(options.output);
  await mkdir(root, { recursive: true });
  const worlds = await findWorlds(root);
  if (worlds.length !== 1) throw new Error(`expected exactly one .mcworld to seal, found ${worlds.length}`);
  const world = worlds[0];
  const digest = await hashFile(world);
  const relative = path.relative(root, world).split(path.sep).join('/');
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    park: options.park,
    fingerprint: options.fingerprint,
    world: { path: relative, bytes: digest.bytes, sha256: digest.sha256 }
  };
  await writeFile(path.join(root, RESULT_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return { status: 'sealed', ...manifest.world, fingerprint: options.fingerprint };
}

async function validate(options) {
  if (!options.output || !options.fingerprint || !options.park) throw new Error('--output, --fingerprint and --park are required for validate mode');
  const root = path.resolve(options.output);
  const manifest = JSON.parse(await readFile(path.join(root, RESULT_MANIFEST), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('unsupported exact-world cache schema');
  if (manifest.park !== options.park) throw new Error(`exact-world cache park mismatch (${manifest.park || 'missing'} != ${options.park})`);
  if (manifest.fingerprint !== options.fingerprint) throw new Error('exact-world cache fingerprint mismatch');
  const generatedAt = Date.parse(manifest.generatedAt || '');
  if (!Number.isFinite(generatedAt)) throw new Error('exact-world cache timestamp is invalid');
  const ageHours = (Date.now() - generatedAt) / 3_600_000;
  if (ageHours < -0.25) throw new Error('exact-world cache timestamp is in the future');
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) throw new Error('max-age-hours must be positive');
  if (ageHours > options.maxAgeHours) throw new Error(`exact-world cache is stale (${ageHours.toFixed(2)}h > ${options.maxAgeHours}h)`);

  const relative = manifest.world?.path;
  if (!relative || path.isAbsolute(relative)) throw new Error('exact-world cache path must be relative');
  const world = path.resolve(root, relative);
  const rel = path.relative(root, world);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('exact-world cache path escapes output directory');
  const info = await stat(world);
  if (!info.isFile() || info.size !== Number(manifest.world.bytes)) throw new Error('exact-world cache byte count mismatch');
  const digest = await hashFile(world);
  if (digest.sha256 !== manifest.world.sha256) throw new Error('exact-world cache SHA-256 mismatch');
  return { status: 'valid', world, relative, bytes: digest.bytes, sha256: digest.sha256, ageHours };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-world-result-'));
  try {
    const runtime = path.join(root, 'runtime.json');
    const planning = path.join(root, 'planning.json');
    const output = path.join(root, 'out');
    await mkdir(output, { recursive: true });
    await writeFile(runtime, JSON.stringify({ generatedAt: 'stable', files: [{ path: 'a', sha256: '1' }] }));
    await writeFile(planning, JSON.stringify({ status: 'usable', entries: [{ url: 'x', sha256: '2' }] }));
    const environment = { TPMAP_ACCURACY: 'benchmark', TPMAP_WORLD_MARGIN: '32', TPMAP_SHARED_CACHE_DIR: '/ephemeral/a' };
    const keyA = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'abc' }, environment);
    const keyB = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'abc' }, { ...environment, TPMAP_SHARED_CACHE_DIR: '/ephemeral/b' });
    if (keyA !== keyB) throw new Error('ephemeral cache path changed exact-world fingerprint');
    const keyChanged = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'def' }, environment);
    if (keyChanged === keyA) throw new Error('repository change did not invalidate exact-world fingerprint');

    await writeFile(path.join(output, 'sample.mcworld'), Buffer.from('world-bytes'));
    await seal({ output, fingerprint: keyA, park: 'alton-towers' });
    const checked = await validate({ output, fingerprint: keyA, park: 'alton-towers', maxAgeHours: 24 });
    if (checked.status !== 'valid') throw new Error('sealed exact-world result did not validate');
    await writeFile(path.join(output, 'sample.mcworld'), Buffer.from('changed-world'));
    let rejected = false;
    try { await validate({ output, fingerprint: keyA, park: 'alton-towers', maxAgeHours: 24 }); } catch { rejected = true; }
    if (!rejected) throw new Error('modified exact-world result was not rejected');
    console.log('exact world result cache self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function publishOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await writeFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}

const options = parseArgs(process.argv);
try {
  if (options.selfTest) await selfTest();
  else if (options.mode === 'key') {
    const fingerprint = await computeFingerprint(options);
    console.log(JSON.stringify({ status: 'fingerprinted', fingerprint }));
    await publishOutput('fingerprint', fingerprint);
  } else if (options.mode === 'seal') {
    const result = await seal(options);
    console.log(JSON.stringify(result));
  } else {
    const result = await validate(options);
    console.log(JSON.stringify(result));
    await publishOutput('world', result.world);
    await publishOutput('sha256', result.sha256);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 2;
}
