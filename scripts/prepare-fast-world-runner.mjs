#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SOURCE_ARCHIVE = 'ThemePark_Map_v0.12.0_Supplemental_Source_Fusion_Source.zip';
const START_MARKER = '[[ -f "$SOURCE_ZIP" ]] || {';
const END_MARKER = '\nSOURCE_ARGS=(';

function parseArgs(argv) {
  const options = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--self-test') options.selfTest = true;
    else if (argv[i] === '--input') options.input = argv[++i];
    else if (argv[i] === '--repo') options.repo = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

async function filesBelow(root, relative, predicate = () => true) {
  const base = path.join(root, relative);
  const out = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && predicate(full)) out.push(full);
    }
  }
  await walk(base);
  return out;
}

async function fingerprint(repoRoot) {
  const files = [path.join(repoRoot, SOURCE_ARCHIVE)];
  files.push(...await filesBelow(repoRoot, 'patches'));
  files.push(...await filesBelow(repoRoot, 'scripts', (filename) => path.basename(filename).startsWith('build-themepark-world-v0120-direct.sh.part-')));
  files.push(fileURLToPath(import.meta.url));

  const unique = [...new Set(files.map((filename) => path.resolve(filename)))].sort();
  const hash = createHash('sha256');
  hash.update('tpmap-prepared-generator-v1\0');
  hash.update(`${process.platform}\0${process.arch}\0${process.version}\0`);
  for (const filename of unique) {
    const relative = filename === fileURLToPath(import.meta.url)
      ? 'scripts/prepare-fast-world-runner.mjs'
      : path.relative(repoRoot, filename).split(path.sep).join('/');
    const bytes = await readFile(filename);
    hash.update(relative); hash.update('\0'); hash.update(bytes); hash.update('\0');
  }
  return hash.digest('hex');
}

function transform(text, digest) {
  if (text.includes('# BEGIN PREPARED GENERATOR CACHE V1')) return text;
  const start = text.indexOf(START_MARKER);
  if (start < 0) throw new Error('Could not locate generator preparation start marker');
  const end = text.indexOf(END_MARKER, start);
  if (end < 0) throw new Error('Could not locate generator preparation end marker');

  const prep = text.slice(start, end);
  const wrapper = `# BEGIN PREPARED GENERATOR CACHE V1\nPREPARED_GENERATOR_FINGERPRINT="${digest}"\nPREPARED_GENERATOR_CACHE_ROOT="\${TPMAP_SHARED_CACHE_DIR:-}/prepared-generator"\nPREPARED_GENERATOR_ARCHIVE="$PREPARED_GENERATOR_CACHE_ROOT/$PREPARED_GENERATOR_FINGERPRINT.tar.gz"\nPREPARED_GENERATOR_ATTESTATION="$PREPARED_GENERATOR_CACHE_ROOT/$PREPARED_GENERATOR_FINGERPRINT.sha256"\nPREPARED_GENERATOR_HIT=false\n\nif [[ -n "\${TPMAP_SHARED_CACHE_DIR:-}" \\\n      && -s "$PREPARED_GENERATOR_ARCHIVE" \\\n      && -f "$PREPARED_GENERATOR_ATTESTATION" \\\n      && "$(cat "$PREPARED_GENERATOR_ATTESTATION")" == "$PREPARED_GENERATOR_FINGERPRINT" ]]; then\n  rm -rf "$GEN"\n  mkdir -p "$GEN"\n  if tar -xzf "$PREPARED_GENERATOR_ARCHIVE" -C "$GEN" \\\n      && [[ -f "$GEN/.tpmap-prepared-generator-v1" ]] \\\n      && [[ "$(cat "$GEN/.tpmap-prepared-generator-v1")" == "$PREPARED_GENERATOR_FINGERPRINT" ]] \\\n      && [[ -f "$GEN/package.json" ]] \\\n      && [[ -d "$GEN/node_modules" ]]; then\n    PREPARED_GENERATOR_HIT=true\n    printf 'state=hit\\nfingerprint=%s\\narchive=%s\\n' \\\n      "$PREPARED_GENERATOR_FINGERPRINT" "$PREPARED_GENERATOR_ARCHIVE" \\\n      | tee "$DIAG/prepared-generator-cache.txt"\n  else\n    echo "Prepared generator cache extraction/attestation failed; rebuilding from checksum-locked source." \\\n      | tee "$DIAG/prepared-generator-cache.txt"\n    rm -rf "$GEN"\n  fi\nfi\n\nif [[ "$PREPARED_GENERATOR_HIT" != "true" ]]; then\n${prep}\n\n  printf '%s\\n' "$PREPARED_GENERATOR_FINGERPRINT" > "$GEN/.tpmap-prepared-generator-v1"\n  if [[ -n "\${TPMAP_SHARED_CACHE_DIR:-}" ]]; then\n    mkdir -p "$PREPARED_GENERATOR_CACHE_ROOT"\n    PREPARED_GENERATOR_TMP="$PREPARED_GENERATOR_ARCHIVE.tmp.$$"\n    tar -czf "$PREPARED_GENERATOR_TMP" \\\n      --exclude='./out' \\\n      --exclude='./.tpmap-cache' \\\n      --exclude='./data/mobile-inputs' \\\n      --exclude='./data/park-orthophoto.tif' \\\n      -C "$GEN" .\n    mv "$PREPARED_GENERATOR_TMP" "$PREPARED_GENERATOR_ARCHIVE"\n    printf '%s\\n' "$PREPARED_GENERATOR_FINGERPRINT" > "$PREPARED_GENERATOR_ATTESTATION"\n    printf 'state=created\\nfingerprint=%s\\narchive=%s\\n' \\\n      "$PREPARED_GENERATOR_FINGERPRINT" "$PREPARED_GENERATOR_ARCHIVE" \\\n      | tee "$DIAG/prepared-generator-cache.txt"\n    if [[ -n "\${GITHUB_ENV:-}" ]]; then\n      printf 'TPMAP_PREPARED_GENERATOR_CREATED=true\\n' >> "$GITHUB_ENV"\n    fi\n  fi\nfi\n\nunset PREPARED_GENERATOR_CACHE_ROOT PREPARED_GENERATOR_ARCHIVE PREPARED_GENERATOR_ATTESTATION PREPARED_GENERATOR_HIT PREPARED_GENERATOR_TMP\n# END PREPARED GENERATOR CACHE V1\n`;
  return text.slice(0, start) + wrapper + text.slice(end);
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), 'tpmap-fast-runner-'));
  try {
    await mkdir(path.join(root, 'patches', 'x'), { recursive: true });
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await writeFile(path.join(root, SOURCE_ARCHIVE), 'archive');
    await writeFile(path.join(root, 'patches', 'x', 'a.patch'), 'patch');
    await writeFile(path.join(root, 'scripts', 'build-themepark-world-v0120-direct.sh.part-00'), 'fragment');
    const sample = `#!/usr/bin/env bash\nGEN=x\n${START_MARKER}\n  exit 2\n}\necho prepare\n${END_MARKER}\n  --x y\n)\n`;
    const digest = createHash('sha256').update('self-test').digest('hex');
    const first = transform(sample, digest);
    const second = transform(first, digest);
    if (first !== second) throw new Error('transform is not idempotent');
    if (!first.includes('PREPARED_GENERATOR_HIT=false') || !first.includes('tar -xzf') || !first.includes('SOURCE_ARGS=(')) {
      throw new Error('prepared-generator wrapper was not injected correctly');
    }
    console.log('prepared generator runner transform self-test passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
if (options.selfTest) await selfTest();
else {
  if (!options.input) throw new Error('--input is required');
  const repo = path.resolve(options.repo || process.cwd());
  const input = path.resolve(options.input);
  const digest = await fingerprint(repo);
  const text = await readFile(input, 'utf8');
  await writeFile(input, transform(text, digest));
  console.log(JSON.stringify({ status: 'prepared-runner-enabled', fingerprint: digest }));
}
