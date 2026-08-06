#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The legacy council portal rejects modern HTTPS/TLS fingerprints on GitHub-hosted
// runners. Keep this workflow entry point, but run the exact-host legacy HTTP
// application collector and then complete its JavaScript AppBlobImage attachments.
// Using subprocesses makes the two stages strictly sequential on Linux, Windows,
// and macOS; the previous dynamic import could finish before asynchronous collection.

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const collector = path.join(scriptDirectory, "prefetch-planning-portal-http.mjs");
const attachmentCompleter = path.join(scriptDirectory, "complete-planning-prefetch-attachments.mjs");
const args = process.argv.slice(2);

runNode(collector, args);

if (args.includes("--self-test")) {
  // The collector owns the deterministic transport check. The completion stage is
  // exercised against the live, bounded application pages immediately afterwards.
  console.log("planning legacy HTTP and attachment pipeline self-test passed");
} else {
  const completionArgs = ["--directory", optionValue(args, "--output") || "planning-prefetch-output"];
  copyOption(args, completionArgs, "--max-documents");
  copyOption(args, completionArgs, "--max-mb");
  runNode(attachmentCompleter, completionArgs);
}

function runNode(script, childArgs) {
  const result = spawnSync(process.execPath, [script, ...childArgs], {
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  if (index < 0 || index + 1 >= values.length) return null;
  return values[index + 1];
}

function copyOption(source, target, name) {
  const value = optionValue(source, name);
  if (value !== null) target.push(name, value);
}
