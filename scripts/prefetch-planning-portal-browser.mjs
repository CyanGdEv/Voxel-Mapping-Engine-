#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

// Phase 28 keeps the broad discovery/downloader implementation in a locked,
// compressed payload so the existing public workflow entry point remains small.
// The payload is verified, expanded into an isolated temporary directory, run,
// and deleted. No generated code is retained in the repository workspace.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const payloadDirectory = path.join(scriptDirectory, "phase28-planning-prefetch");
const expectedPartHashes = [
  "21bb70d162e2b5b9afd06456f476bcd2a2e1e4cc78f23ba8b1b37bec37ccadfe",
  "891fd22c891bc383780c43c2cdc4a8112f157afa188b1d8ae2c04e69d6ec9e19",
  "658c10b8042caae68a25b40bb729c4b857d662edbd7025099b4d9a5cd08b5d6e",
  "4eee2afed05c37c7ecf9cfcbb186e931e2373bff79389a09a2f7ab42f180300f",
  "f59576d8be8920ad660f9242c8b260c1bbbd7225bbd06ac6f851adad7795789f"
];
const expectedBundleHash = "710465aeecdb1d9a83eda4c6a813c8b76e47434053d863d1d8910ef4f318be98";
const requestedArgs = process.argv.slice(2);
const args = productionCaps(requestedArgs);
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "vx-phase28-planning-"));

try {
  const sources = loadSources();
  for (const [name, source] of Object.entries(sources)) {
    if (!/^[A-Za-z0-9._-]+\.mjs$/.test(name) || typeof source !== "string") throw new Error("invalid Phase 28 planning payload entry");
    writeFileSync(path.join(temporaryDirectory, name), source, "utf8");
  }
  const collector = path.join(temporaryDirectory, "prefetch-planning-portal-http.mjs");
  const completer = path.join(temporaryDirectory, "complete-planning-prefetch-balanced.mjs");
  runNode(collector, args);
  if (requestedArgs.includes("--self-test")) {
    runNode(completer, ["--self-test"]);
    console.log("planning expanded search and balanced attachment pipeline self-test passed");
  } else {
    const completionArgs = ["--directory", optionValue(args, "--output") || "planning-prefetch-output"];
    copyOption(args, completionArgs, "--max-applications");
    copyOption(args, completionArgs, "--max-documents");
    copyOption(args, completionArgs, "--max-mb");
    completionArgs.push("--max-documents-per-application", process.env.TPMAP_PLANNING_DOCUMENT_MAX_PER_APPLICATION || "32");
    runNode(completer, completionArgs);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function loadSources() {
  const names = readdirSync(payloadDirectory)
    .filter((name) => /^phase28-planning-prefetch-scripts\.json\.gz\.b64\.part-[0-9a-z]+$/.test(name))
    .sort();
  if (names.length !== expectedPartHashes.length) throw new Error("Phase 28 planning payload part count mismatch");
  const parts = names.map((name, index) => {
    const data = readFileSync(path.join(payloadDirectory, name));
    if (sha256(data) !== expectedPartHashes[index]) throw new Error(`Phase 28 planning payload checksum mismatch: ${name}`);
    return data;
  });
  const bundle = Buffer.concat(parts);
  if (sha256(bundle) !== expectedBundleHash) throw new Error("Phase 28 planning payload bundle checksum mismatch");
  return JSON.parse(gunzipSync(Buffer.from(bundle.toString("ascii").replace(/\s+/g, ""), "base64")).toString("utf8"));
}

function productionCaps(values) {
  const production = process.env.GITHUB_WORKFLOW === "Build Minecraft Theme Park World"
    || process.env.TPMAP_EXPANDED_PLANNING_PREFETCH === "true";
  if (values.includes("--self-test") || !production) return [...values];
  const result = [...values];
  enforceMinimum(result, "--max-applications", 300);
  enforceMinimum(result, "--max-documents", 800);
  enforceMinimum(result, "--max-mb", 200);
  return result;
}
function enforceMinimum(values, name, minimum) {
  const index = values.indexOf(name);
  if (index < 0) values.push(name, String(minimum));
  else if (index + 1 < values.length && Number(values[index + 1]) < minimum) values[index + 1] = String(minimum);
}
function runNode(script, childArgs) {
  const result = spawnSync(process.execPath, [script, ...childArgs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function copyOption(source, target, name) { const value = optionValue(source, name); if (value !== null) target.push(name, value); }
