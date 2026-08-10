#!/usr/bin/env node
// TPMAP_PREPARED_GENERATOR_SEAL_V1
// Deterministically seals the prepared generator's executable/test surface.
// The manifest is written outside the generator and verified immediately before build.

import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  writeFile,
  readdir,
  readlink,
  mkdtemp,
  mkdir,
  rm
} from 'node:fs/promises';

const args = process.argv.slice(2);
const generatorIndex = args.indexOf('--generator');
const sealIndex = args.indexOf('--seal');
const generator = generatorIndex >= 0 ? path.resolve(args[generatorIndex + 1]) : null;
const sealFile = sealIndex >= 0 ? path.resolve(args[sealIndex + 1]) : null;
const verify = args.includes('--verify');
const selfTest = args.includes('--self-test');

const MARKER = 'TPMAP_PREPARED_GENERATOR_SEAL_V1';
const VERSION = 1;
const SEALED_DIRECTORIES = Object.freeze(['src', 'test']);
const OPTIONAL_ROOT_FILES = Object.freeze(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);

if (selfTest) await runSelfTest();
else if (!generator || !sealFile) throw new Error('--generator and --seal are required');
else if (verify) await verifySeal(generator, sealFile);
else await createSeal(generator, sealFile);

export async function createSeal(root, outputFile) {
  const manifest = await buildManifest(root);
  await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    status: 'sealed',
    marker: MARKER,
    algorithm: manifest.algorithm,
    files: manifest.fileCount,
    sha256: manifest.aggregateSha256,
    seal: outputFile
  }));
  return manifest;
}

export async function verifySeal(root, inputFile) {
  let expected;
  try {
    expected = JSON.parse(await readFile(inputFile, 'utf8'));
  } catch (error) {
    throw new Error(`Prepared generator seal missing or unreadable: ${inputFile}: ${error?.message || error}`);
  }
  validateManifestShape(expected);

  const actual = await buildManifest(root);
  if (actual.aggregateSha256 !== expected.aggregateSha256 || actual.fileCount !== expected.fileCount) {
    const drift = describeDrift(expected.entries, actual.entries);
    const details = drift.length ? ` drift=${drift.join(',')}` : '';
    throw new Error(
      `Prepared generator seal mismatch expected=${expected.aggregateSha256} actual=${actual.aggregateSha256}` + details
    );
  }

  // Aggregate equality is authoritative, but compare entries as a defensive check
  // against malformed or hand-edited seal manifests.
  const drift = describeDrift(expected.entries, actual.entries);
  if (drift.length) throw new Error(`Prepared generator seal entry mismatch drift=${drift.join(',')}`);

  console.log(JSON.stringify({
    status: 'verified',
    marker: MARKER,
    algorithm: actual.algorithm,
    files: actual.fileCount,
    sha256: actual.aggregateSha256,
    seal: inputFile
  }));
  return actual;
}

export async function buildManifest(root) {
  const resolvedRoot = path.resolve(root);
  const entries = [];

  for (const directory of SEALED_DIRECTORIES) {
    const absolute = path.join(resolvedRoot, directory);
    const info = await safeLstat(absolute);
    if (!info?.isDirectory()) throw new Error(`Prepared generator seal scope missing directory: ${directory}`);
    await collectEntries(resolvedRoot, absolute, entries);
  }

  const includedRootFiles = [];
  for (const filename of OPTIONAL_ROOT_FILES) {
    const absolute = path.join(resolvedRoot, filename);
    const info = await safeLstat(absolute);
    if (!info) continue;
    if (!info.isFile() && !info.isSymbolicLink()) {
      throw new Error(`Prepared generator seal root entry is not a file: ${filename}`);
    }
    includedRootFiles.push(filename);
    entries.push(await hashEntry(resolvedRoot, absolute, info));
  }

  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const aggregate = createHash('sha256');
  for (const entry of entries) {
    aggregate.update(entry.type);
    aggregate.update('\0');
    aggregate.update(entry.path);
    aggregate.update('\0');
    aggregate.update(String(entry.bytes));
    aggregate.update('\0');
    aggregate.update(entry.sha256);
    aggregate.update('\n');
  }

  return {
    version: VERSION,
    marker: MARKER,
    algorithm: 'sha256',
    sealedDirectories: [...SEALED_DIRECTORIES],
    includedRootFiles,
    fileCount: entries.length,
    aggregateSha256: aggregate.digest('hex'),
    entries
  };
}

async function collectEntries(root, directory, entries) {
  const names = (await readdir(directory)).sort((a, b) => a.localeCompare(b, 'en'));
  for (const name of names) {
    const absolute = path.join(directory, name);
    const info = await lstat(absolute);
    if (info.isDirectory()) await collectEntries(root, absolute, entries);
    else if (info.isFile() || info.isSymbolicLink()) entries.push(await hashEntry(root, absolute, info));
    else throw new Error(`Prepared generator seal encountered unsupported filesystem entry: ${relativePath(root, absolute)}`);
  }
}

async function hashEntry(root, absolute, info) {
  const relative = relativePath(root, absolute);
  if (info.isSymbolicLink()) {
    const target = await readlink(absolute);
    const bytes = Buffer.byteLength(target, 'utf8');
    return {
      path: relative,
      type: 'symlink',
      bytes,
      sha256: sha256(Buffer.from(target, 'utf8'))
    };
  }
  const content = await readFile(absolute);
  return {
    path: relative,
    type: 'file',
    bytes: content.byteLength,
    sha256: sha256(content)
  };
}

function relativePath(root, absolute) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../')) {
    throw new Error(`Prepared generator seal path escaped generator root: ${absolute}`);
  }
  return relative;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function safeLstat(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function validateManifestShape(manifest) {
  if (manifest?.version !== VERSION || manifest?.marker !== MARKER || manifest?.algorithm !== 'sha256') {
    throw new Error('Prepared generator seal manifest version/marker/algorithm is invalid');
  }
  if (!Array.isArray(manifest.entries) || !Number.isInteger(manifest.fileCount) || manifest.entries.length !== manifest.fileCount) {
    throw new Error('Prepared generator seal manifest entries are invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(String(manifest.aggregateSha256 || ''))) {
    throw new Error('Prepared generator seal manifest aggregate hash is invalid');
  }
}

function describeDrift(expectedEntries, actualEntries) {
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));
  const actual = new Map(actualEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort((a, b) => a.localeCompare(b, 'en'));
  const drift = [];
  for (const name of paths) {
    const before = expected.get(name);
    const after = actual.get(name);
    if (!before) drift.push(`added:${name}`);
    else if (!after) drift.push(`removed:${name}`);
    else if (before.type !== after.type || before.bytes !== after.bytes || before.sha256 !== after.sha256) drift.push(`changed:${name}`);
    if (drift.length >= 12) {
      drift.push('more:...');
      break;
    }
  }
  return drift;
}

async function runSelfTest() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tpmap-generator-seal-'));
  try {
    const generatorRoot = path.join(temp, 'generator');
    const seal = path.join(temp, 'prepared-generator-seal.json');
    await mkdir(path.join(generatorRoot, 'src', 'lib'), { recursive: true });
    await mkdir(path.join(generatorRoot, 'test'), { recursive: true });
    await writeFile(path.join(generatorRoot, 'src', 'cli.mjs'), 'export const cli = true;\n');
    await writeFile(path.join(generatorRoot, 'src', 'lib', 'pipeline.mjs'), 'export const pipeline = 1;\n');
    await writeFile(path.join(generatorRoot, 'test', 'pipeline.test.mjs'), 'export const test = true;\n');
    await writeFile(path.join(generatorRoot, 'package.json'), '{"type":"module"}\n');

    const first = await createSeal(generatorRoot, seal);
    const second = await buildManifest(generatorRoot);
    if (first.aggregateSha256 !== second.aggregateSha256) throw new Error('Prepared generator seal self-test is not deterministic');
    await verifySeal(generatorRoot, seal);

    await writeFile(path.join(generatorRoot, 'src', 'lib', 'pipeline.mjs'), 'export const pipeline = 2;\n');
    let rejected = false;
    try {
      await verifySeal(generatorRoot, seal);
    } catch (error) {
      rejected = String(error?.message || error).includes('changed:src/lib/pipeline.mjs');
    }
    if (!rejected) throw new Error('Prepared generator seal self-test failed to reject source mutation');

    console.log('Prepared generator seal self-test passed');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
