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
const prefix = 'complete-chessington-jumanji-archive.impl.mjs.gz.b64.part-';
const parts = readdirSync(directory).filter((name) => name.startsWith(prefix)).sort();
if (!parts.length) throw new Error('Jumanji archive completer implementation bundle is missing');
const encoded = parts.map((name) => readFileSync(path.join(directory, name), 'utf8').replace(/\s+/g, '')).join('');
verify(encoded, '16d494bcfdeb09f0ecbbb663b56129b0c2c9036fb48d60a1e98f0edc348a871b', 'Jumanji archive completer bundle');
const compressed = Buffer.from(encoded, 'base64');
verify(compressed, '5196cde965b9924c06eafb988e131455b89c9a40edc00605698cc9aeec624cd3', 'Jumanji archive completer compressed source');
const decoded = gunzipSync(compressed);
verify(decoded, 'b2a59c56c4cef5c7a61a3e16ee1feec41b27f97a1d8247bcabacef5ef64dc9e6', 'Jumanji archive completer source');

const temporary = mkdtempSync(path.join(os.tmpdir(), 'tpmap-jumanji-plans-'));
const implementation = path.join(temporary, 'complete-chessington-jumanji-archive.impl.mjs');
writeFileSync(implementation, decoded);
try {
  const result = spawnSync(process.execPath, [implementation, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Jumanji archive completer terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function verify(value, expected, label) {
  const actual = createHash('sha256').update(value).digest('hex');
  if (actual !== expected) throw new Error(`${label} checksum mismatch: expected ${expected}, got ${actual}`);
}
