#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RESULT_MANIFEST = 'exact-world-cache.json';
const PREPARED_MARKER = '# BEGIN PREPARED GENERATOR CACHE V1';
const SOURCE_START = '[[ -f "$SOURCE_ZIP" ]] || {';
const OUTPUT_ANCHOR = '\ncapture_reports\nif [[ -n "${GITHUB_OUTPUT:-}" ]]; then';

function parseArgs(argv) {
  const options = { mode: 'key', maxAgeHours: 24 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--key') options.mode = 'key';
    else if (arg === '--seal') options.mode = 'seal';
    else if (arg === '--validate') options.mode = 'validate';
    else if (arg === '--inject-runner') options.mode = 'inject-runner';
    else if (arg === '--runtime-manifest') options.runtimeManifest = argv[++i];
    else if (arg === '--planning-manifest') options.planningManifest = argv[++i];
    else if (arg === '--park') options.park = argv[++i];
    else if (arg === '--repo-sha') options.repoSha = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--input') options.input = argv[++i];
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

function stableRuntimeEvidence(buffer) {
  const manifest = JSON.parse(buffer.toString('utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('invalid runtime cache manifest for exact-world fingerprint');
  const files = manifest.files
    .filter((entry) => entry?.path)
    .filter((entry) => !entry.path.startsWith('prepared-generator/'))
    .filter((entry) => !entry.path.startsWith('world-results/'))
    .map((entry) => ({ path: entry.path, bytes: Number(entry.bytes), sha256: entry.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { schemaVersion: manifest.schemaVersion, park: manifest.park || null, files };
}

async function computeFingerprint(options, environment = process.env) {
  if (!options.runtimeManifest) throw new Error('--runtime-manifest is required for key mode');
  if (!options.park) throw new Error('--park is required for key mode');
  if (!options.repoSha) throw new Error('--repo-sha is required for key mode');
  const runtime = stableRuntimeEvidence(await readFile(path.resolve(options.runtimeManifest)));
  const planning = options.planningManifest ? await readFile(path.resolve(options.planningManifest)) : Buffer.from('planning:not-applicable');
  const hash = createHash('sha256');
  hash.update('tpmap-exact-world-result-v1\0');
  hash.update(String(options.repoSha)); hash.update('\0');
  hash.update(String(options.park)); hash.update('\0');
  hash.update(JSON.stringify(selectedSettings(environment))); hash.update('\0');
  hash.update(JSON.stringify(runtime)); hash.update('\0');
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

function restoreBlock() {
  return `\n# BEGIN PHASE 29H EXACT WORLD RESULT RESTORE\nEXACT_WORLD_FINGERPRINT=""\nif [[ -n "\${TPMAP_SHARED_CACHE_DIR:-}" \\\n      && -n "\${GITHUB_SHA:-}" \\\n      && -f "$TPMAP_SHARED_CACHE_DIR/cache-manifest.json" ]]; then\n  EXACT_WORLD_PLANNING_ARGS=()\n  if [[ -n "\${TPMAP_PLANNING_PREFETCH_DIR:-}" && -f "$TPMAP_PLANNING_PREFETCH_DIR/manifest.json" ]]; then\n    EXACT_WORLD_PLANNING_ARGS=(--planning-manifest "$TPMAP_PLANNING_PREFETCH_DIR/manifest.json")\n  fi\n  if EXACT_WORLD_KEY_JSON="$(node "$ROOT/scripts/exact-world-result-cache.mjs" --key --runtime-manifest "$TPMAP_SHARED_CACHE_DIR/cache-manifest.json" "\${EXACT_WORLD_PLANNING_ARGS[@]}" --park "$PRESET" --repo-sha "$GITHUB_SHA" 2>> "$DIAG/exact-world-cache.txt")"; then\n    EXACT_WORLD_FINGERPRINT="$(printf '%s' "$EXACT_WORLD_KEY_JSON" | sed -nE 's/.*"fingerprint":"([a-f0-9]+)".*/\\1/p')"\n  fi\n  if [[ "$EXACT_WORLD_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]]; then\n    EXACT_WORLD_RESULT_DIR="$TPMAP_SHARED_CACHE_DIR/world-results/$EXACT_WORLD_FINGERPRINT"\n    if node "$ROOT/scripts/exact-world-result-cache.mjs" --validate --output "$EXACT_WORLD_RESULT_DIR" --fingerprint "$EXACT_WORLD_FINGERPRINT" --park "$PRESET" --max-age-hours 24 >> "$DIAG/exact-world-cache.txt" 2>&1; then\n      rm -rf "$GEN/$OUT_REL"\n      mkdir -p "$GEN/$OUT_REL"\n      cp -a "$EXACT_WORLD_RESULT_DIR/." "$GEN/$OUT_REL/"\n      MCWORLD="$(find "$GEN/$OUT_REL" -maxdepth 1 -type f -name '*.mcworld' -print -quit)"\n      if [[ -n "$MCWORLD" ]] && unzip -t "$MCWORLD" >> "$DIAG/exact-world-cache.txt" 2>&1; then\n        EXACT_WORLD_ARCHIVE_LIST="$DIAG/exact-world-archive-list.txt"\n        unzip -Z1 "$MCWORLD" > "$EXACT_WORLD_ARCHIVE_LIST"\n        EXACT_WORLD_ARCHIVE_VALID=true\n        for required in level.dat levelname.txt db/CURRENT; do\n          grep -Fxq "$required" "$EXACT_WORLD_ARCHIVE_LIST" || EXACT_WORLD_ARCHIVE_VALID=false\n        done\n        if [[ "$EXACT_WORLD_ARCHIVE_VALID" == "true" ]]; then\n          SUCCESS_STRATEGY="exact-world-cache"\n          capture_reports\n          if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then\n            echo "mcworld=$MCWORLD" >> "$GITHUB_OUTPUT"\n            echo "strategy=$SUCCESS_STRATEGY" >> "$GITHUB_OUTPUT"\n            echo "safe_name=$SAFE_NAME" >> "$GITHUB_OUTPUT"\n          fi\n          if [[ -n "\${GITHUB_ENV:-}" ]]; then echo "MCWORLD=$MCWORLD" >> "$GITHUB_ENV"; fi\n          printf 'state=hit\\nfingerprint=%s\\nworld=%s\\n' "$EXACT_WORLD_FINGERPRINT" "$(basename "$MCWORLD")" >> "$DIAG/exact-world-cache.txt"\n          echo "Reused exact verified world $(basename "$MCWORLD")"\n          exit 0\n        fi\n      fi\n    fi\n  fi\nfi\nunset EXACT_WORLD_KEY_JSON EXACT_WORLD_PLANNING_ARGS EXACT_WORLD_RESULT_DIR EXACT_WORLD_ARCHIVE_LIST EXACT_WORLD_ARCHIVE_VALID\n# END PHASE 29H EXACT WORLD RESULT RESTORE\n`;
}

function storeBlock() {
  return `\n# BEGIN PHASE 29H EXACT WORLD RESULT STORE\nif [[ -n "\${TPMAP_SHARED_CACHE_DIR:-}" && -n "\${GITHUB_SHA:-}" && -f "$TPMAP_SHARED_CACHE_DIR/cache-manifest.json" ]]; then\n  EXACT_WORLD_PLANNING_ARGS=()\n  if [[ -n "\${TPMAP_PLANNING_PREFETCH_DIR:-}" && -f "$TPMAP_PLANNING_PREFETCH_DIR/manifest.json" ]]; then\n    EXACT_WORLD_PLANNING_ARGS=(--planning-manifest "$TPMAP_PLANNING_PREFETCH_DIR/manifest.json")\n  fi\n  if EXACT_WORLD_KEY_JSON="$(node "$ROOT/scripts/exact-world-result-cache.mjs" --key --runtime-manifest "$TPMAP_SHARED_CACHE_DIR/cache-manifest.json" "\${EXACT_WORLD_PLANNING_ARGS[@]}" --park "$PRESET" --repo-sha "$GITHUB_SHA" 2>> "$DIAG/exact-world-cache.txt")"; then\n    EXACT_WORLD_FINGERPRINT="$(printf '%s' "$EXACT_WORLD_KEY_JSON" | sed -nE 's/.*"fingerprint":"([a-f0-9]+)".*/\\1/p')"\n  fi\n  if [[ "$EXACT_WORLD_FINGERPRINT" =~ ^[a-f0-9]{64}$ ]]; then\n    EXACT_WORLD_RESULT_DIR="$TPMAP_SHARED_CACHE_DIR/world-results/$EXACT_WORLD_FINGERPRINT"\n    rm -rf "$EXACT_WORLD_RESULT_DIR"\n    mkdir -p "$EXACT_WORLD_RESULT_DIR"\n    cp -a "$GEN/$OUT_REL/." "$EXACT_WORLD_RESULT_DIR/"\n    node "$ROOT/scripts/exact-world-result-cache.mjs" --seal --output "$EXACT_WORLD_RESULT_DIR" --fingerprint "$EXACT_WORLD_FINGERPRINT" --park "$PRESET" >> "$DIAG/exact-world-cache.txt" 2>&1\n    if [[ -n "\${GITHUB_ENV:-}" ]]; then echo "TPMAP_PREPARED_GENERATOR_CREATED=true" >> "$GITHUB_ENV"; fi\n    printf 'state=stored\\nfingerprint=%s\\nworld=%s\\n' "$EXACT_WORLD_FINGERPRINT" "$(basename "$MCWORLD")" >> "$DIAG/exact-world-cache.txt"\n  fi\nfi\nunset EXACT_WORLD_KEY_JSON EXACT_WORLD_PLANNING_ARGS EXACT_WORLD_RESULT_DIR EXACT_WORLD_FINGERPRINT\n# END PHASE 29H EXACT WORLD RESULT STORE\n`;
}

export function transformRunner(text) {
  if (text.includes('# BEGIN PHASE 29H EXACT WORLD RESULT RESTORE') && text.includes('# BEGIN PHASE 29H EXACT WORLD RESULT STORE')) return { text, changed: false };
  const restoreIndex = text.includes(PREPARED_MARKER) ? text.indexOf(PREPARED_MARKER) : text.indexOf(SOURCE_START);
  if (restoreIndex < 0) throw new Error('Phase 29H: could not locate source/prepared-generator boundary');
  let output = text.slice(0, restoreIndex) + restoreBlock() + text.slice(restoreIndex);
  const outputIndex = output.lastIndexOf(OUTPUT_ANCHOR);
  if (outputIndex < 0) throw new Error('Phase 29H: could not locate final output boundary');
  output = output.slice(0, outputIndex) + storeBlock() + output.slice(outputIndex);
  return { text: output, changed: true };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-world-result-'));
  try {
    const runtime = path.join(root, 'runtime.json');
    const planning = path.join(root, 'planning.json');
    const output = path.join(root, 'out');
    await mkdir(output, { recursive: true });
    await writeFile(runtime, JSON.stringify({ schemaVersion: 1, park: 'alton-towers', files: [{ path: 'supplemental/a.json', bytes: 10, sha256: '1'.repeat(64) }, { path: 'prepared-generator/x.tar.gz', bytes: 20, sha256: '2'.repeat(64) }, { path: 'world-results/old/world.mcworld', bytes: 30, sha256: '3'.repeat(64) }] }));
    await writeFile(planning, JSON.stringify({ status: 'usable', entries: [{ url: 'x', sha256: '2' }] }));
    const environment = { TPMAP_ACCURACY: 'benchmark', TPMAP_WORLD_MARGIN: '32', TPMAP_SHARED_CACHE_DIR: '/ephemeral/a' };
    const keyA = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'abc' }, environment);
    const keyB = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'abc' }, { ...environment, TPMAP_SHARED_CACHE_DIR: '/ephemeral/b' });
    if (keyA !== keyB) throw new Error('ephemeral cache path changed exact-world fingerprint');
    const keyChanged = await computeFingerprint({ runtimeManifest: runtime, planningManifest: planning, park: 'alton-towers', repoSha: 'def' }, environment);
    if (keyChanged === keyA) throw new Error('repository change did not invalidate exact-world fingerprint');
    const runtimeChanged = path.join(root, 'runtime-changed.json');
    await writeFile(runtimeChanged, JSON.stringify({ schemaVersion: 1, park: 'alton-towers', files: [{ path: 'supplemental/a.json', bytes: 10, sha256: '1'.repeat(64) }, { path: 'world-results/new/world.mcworld', bytes: 999, sha256: 'f'.repeat(64) }] }));
    const keyNoCircularResult = await computeFingerprint({ runtimeManifest: runtimeChanged, planningManifest: planning, park: 'alton-towers', repoSha: 'abc' }, environment);
    if (keyNoCircularResult !== keyA) throw new Error('cached world/prepared-generator infrastructure changed evidence fingerprint');
    await writeFile(path.join(output, 'sample.mcworld'), Buffer.from('world-bytes'));
    await seal({ output, fingerprint: keyA, park: 'alton-towers' });
    const checked = await validate({ output, fingerprint: keyA, park: 'alton-towers', maxAgeHours: 24 });
    if (checked.status !== 'valid') throw new Error('sealed exact-world result did not validate');
    await writeFile(path.join(output, 'sample.mcworld'), Buffer.from('changed-world'));
    let rejected = false;
    try { await validate({ output, fingerprint: keyA, park: 'alton-towers', maxAgeHours: 24 }); } catch { rejected = true; }
    if (!rejected) throw new Error('modified exact-world result was not rejected');
    const runner = `#!/usr/bin/env bash\nROOT=x\nGEN=y\nOUT_REL=out\nPRESET=p\nSAFE_NAME=s\n${PREPARED_MARKER}\necho prepare\n${OUTPUT_ANCHOR}\n  echo x\nfi\n`;
    const transformed = transformRunner(runner);
    if (!transformed.changed || !transformed.text.includes('EXACT WORLD RESULT RESTORE') || !transformed.text.includes('EXACT WORLD RESULT STORE')) throw new Error('exact-world runner transform did not inject both boundaries');
    const second = transformRunner(transformed.text);
    if (second.changed || second.text !== transformed.text) throw new Error('exact-world runner transform is not idempotent');
    const runnerFile = path.join(root, 'runner.sh');
    await writeFile(runnerFile, transformed.text);
    const syntax = spawnSync('bash', ['-n', runnerFile], { encoding: 'utf8' });
    if (syntax.status !== 0) throw new Error(`exact-world transformed runner syntax failed: ${syntax.stderr || syntax.stdout}`);
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
  else if (options.mode === 'inject-runner') {
    if (!options.input) throw new Error('--input is required for inject-runner mode');
    const filename = path.resolve(options.input);
    const original = await readFile(filename, 'utf8');
    const transformed = transformRunner(original);
    if (transformed.changed) await writeFile(filename, transformed.text);
    console.log(JSON.stringify({ status: transformed.changed ? 'runner-patched' : 'runner-already-patched' }));
  } else if (options.mode === 'key') {
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
