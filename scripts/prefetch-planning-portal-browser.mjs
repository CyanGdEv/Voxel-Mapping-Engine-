#!/usr/bin/env node
// Phase 28 validation marker: exact payload assembly is exercised in CI.
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
const expectedPartCount = 17;
const expectedNormalizedBase64Hash = "18d451ca6cc8fca850f5d2ec5d5f53b9390d1d9a99b4ee350947dfd9d41968d7";
const expectedCompressedHash = "6b26b76293d1df89fa58dad9268919b85cf05e38c8a6ef609a62bd68b3f368ce";
const expectedPayloadHash = "c5e3a7f55f415ef2e8a64d6dd82039e0fbb17b1bdd4ddbf3bd2cf94e8da44563";
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
    .filter((name) => /^phase28-planning-prefetch-scripts-v2\.json\.gz\.b64\.part-[0-9]+$/.test(name))
    .sort();
  if (names.length !== expectedPartCount) throw new Error("Phase 28 planning payload part count mismatch");
  const normalizedBase64 = names
    .map((name) => readFileSync(path.join(payloadDirectory, name), "utf8"))
    .join("")
    .replace(/\s+/g, "");
  if (sha256(normalizedBase64) !== expectedNormalizedBase64Hash) throw new Error("Phase 28 planning payload normalized bundle checksum mismatch");
  const compressed = Buffer.from(normalizedBase64, "base64");
  if (sha256(compressed) !== expectedCompressedHash) throw new Error("Phase 28 planning payload compressed checksum mismatch");
  const payload = gunzipSync(compressed);
  if (sha256(payload) !== expectedPayloadHash) throw new Error("Phase 28 planning payload source checksum mismatch");
  return JSON.parse(payload.toString("utf8"));
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
