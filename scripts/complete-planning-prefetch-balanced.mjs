#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const directory = path.dirname(fileURLToPath(import.meta.url));
const prefix = "complete-planning-prefetch-balanced.impl.mjs.gz.b64.part-";
const parts = readdirSync(directory)
  .filter((name) => name.startsWith(prefix))
  .sort();

if (!parts.length) throw new Error("balanced planning completer implementation bundle is missing");
const encoded = parts.map((name) => readFileSync(path.join(directory, name), "utf8")).join("");
verify(encoded, "93fbc94b577cea42c4f62d0c452f156414f575de302895608e5c6b9ff66bfcf9", "assembled balanced planning bundle");
const decoded = gunzipSync(Buffer.from(encoded, "base64"));
verify(decoded, "1267499038af49bbed4648ac9518b7ae608a58d4a7d04709eabfb1a7d23d3fb0", "decoded balanced planning implementation");

const temporary = mkdtempSync(path.join(os.tmpdir(), "tpmap-balanced-planning-"));
const implementation = path.join(temporary, "complete-planning-prefetch-balanced.impl.mjs");
writeFileSync(implementation, decoded);
try {
  const result = spawnSync(process.execPath, [implementation, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`balanced planning completer terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function verify(value, expected, label) {
  const actual = createHash("sha256").update(value).digest("hex");
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch: expected ${expected}, got ${actual}`);
  }
}
