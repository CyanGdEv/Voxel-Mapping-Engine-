#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The legacy council portal rejects modern HTTPS/TLS fingerprints on hosted
// runners. The first stage gathers application pages from the exact official
// host. The balanced completion stage then expands address/pagination/related
// application discovery and distributes high-value attachment downloads across
// cases, preventing one large application from consuming the evidence budget.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const collector = path.join(scriptDirectory, "prefetch-planning-portal-http.mjs");
const attachmentCompleter = path.join(scriptDirectory, "complete-planning-prefetch-balanced.mjs");
const requestedArgs = process.argv.slice(2);
const production = !requestedArgs.includes("--self-test") && process.env.GITHUB_WORKFLOW === "Build Minecraft Theme Park World";
const completionArgsSource = productionCaps(requestedArgs);
const collectorArgs = production ? collectorOnlyArgs(completionArgsSource) : [...completionArgsSource];

runNode(collector, collectorArgs);

if (requestedArgs.includes("--self-test")) {
  runNode(attachmentCompleter, ["--self-test"]);
  console.log("planning expanded search and balanced attachment pipeline self-test passed");
} else {
  const completionArgs = ["--directory", optionValue(completionArgsSource, "--output") || "planning-prefetch-output"];
  copyOption(completionArgsSource, completionArgs, "--max-applications");
  copyOption(completionArgsSource, completionArgs, "--max-documents");
  copyOption(completionArgsSource, completionArgs, "--max-mb");
  runNode(attachmentCompleter, completionArgs);
}

function productionCaps(values) {
  if (!production) return [...values];
  const result = [...values];
  enforceMinimum(result, "--max-applications", 300);
  enforceMinimum(result, "--max-documents", 1200);
  enforceMinimum(result, "--max-mb", 150);
  return result;
}

function collectorOnlyArgs(values) {
  const result = [...values];
  // The original collector is intentionally limited to a tiny attachment probe.
  // The balanced stage owns the real 150 MB download budget.
  setOption(result, "--max-documents", 1);
  setOption(result, "--max-mb", 1);
  return result;
}

function enforceMinimum(values, name, minimum) {
  const index = values.indexOf(name);
  if (index < 0) values.push(name, String(minimum));
  else if (index + 1 < values.length && Number(values[index + 1]) < minimum) values[index + 1] = String(minimum);
}

function setOption(values, name, value) {
  const index = values.indexOf(name);
  if (index < 0) values.push(name, String(value));
  else if (index + 1 < values.length) values[index + 1] = String(value);
}

function runNode(script, childArgs) {
  const result = spawnSync(process.execPath, [script, ...childArgs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function copyOption(source, target, name) { const value = optionValue(source, name); if (value !== null) target.push(name, value); }
