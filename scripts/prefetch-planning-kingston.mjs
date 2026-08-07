#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const prefix = 'prefetch-planning-kingston.impl.mjs.gz.b64.part-';
const parts = readdirSync(directory).filter((name) => name.startsWith(prefix)).sort();
if (!parts.length) throw new Error('Kingston planning collector implementation bundle is missing');
const encoded = parts.map((name) => readFileSync(path.join(directory, name), 'utf8').replace(/\s+/g, '')).join('');
verify(encoded, '1f5a64db3a6e59a8f40f4c0de29bdfe227d055848a847b68227496e498d25d10', 'assembled Kingston planning bundle');
const compressed = Buffer.from(encoded, 'base64');
verify(compressed, '63946f357d6dfdee64cee1cf55d5ff4ffcc50e1b13f87e19d4836888119cd4d3', 'compressed Kingston planning implementation');
const decoded = gunzipSync(compressed);
verify(decoded, '126c2e94889d0c90d61ccb8c456d56fda03695990444ed19ec8cec84ce29e923', 'decoded Kingston planning implementation');

const requestedArgs = process.argv.slice(2);
const selfTest = requestedArgs.includes('--self-test');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'tpmap-kingston-planning-'));
const implementation = path.join(temporary, 'prefetch-planning-kingston.impl.mjs');
writeFileSync(implementation, decoded);
try {
  const result = spawnSync(process.execPath, [implementation, ...requestedArgs], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Kingston planning collector terminated by ${result.signal}`);
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

  const completer = path.join(directory, 'complete-chessington-jumanji-archive.mjs');
  if (selfTest) {
    runNode(completer, ['--self-test']);
  } else {
    runNode(completer, ['--directory', optionValue(requestedArgs, '--output') || 'planning-prefetch-output']);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function verify(value, expected, label) {
  const actual = createHash('sha256').update(value).digest('hex');
  if (actual !== expected) throw new Error(`${label} checksum mismatch: expected ${expected}, got ${actual}`);
}
