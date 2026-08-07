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
// A final manifest pass keeps only applications proven to expose drawing or
// geometry documents, so the Alton Towers 500-application cap is spent on
// useful drawing-bearing cases rather than text-only planning records.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const collector = path.join(scriptDirectory, "prefetch-planning-portal-http.mjs");
const attachmentCompleter = path.join(scriptDirectory, "complete-planning-prefetch-balanced.mjs");
const drawingApplicationFilter = path.join(scriptDirectory, "filter-planning-drawing-applications.mjs");
const requestedArgs = process.argv.slice(2);
const productionWorkflows = new Set([
  "Build Minecraft Theme Park World",
  "Build Minecraft Theme Park World (Resilient)",
  "Warm Theme Park Evidence Cache"
]);
const production = !requestedArgs.includes("--self-test") && productionWorkflows.has(process.env.GITHUB_WORKFLOW || "");
const completionArgsSource = productionCaps(requestedArgs);
const collectorArgs = production ? collectorOnlyArgs(completionArgsSource) : [...completionArgsSource];

runNode(collector, collectorArgs);

if (requestedArgs.includes("--self-test")) {
  selfTestProductionCaps();
  runNode(attachmentCompleter, ["--self-test"]);
  runNode(drawingApplicationFilter, ["--self-test"]);
  console.log("planning expanded search, balanced attachment, and drawing-application filter self-test passed");
} else {
  const output = optionValue(completionArgsSource, "--output") || "planning-prefetch-output";
  const completionArgs = ["--directory", output];
  copyOption(completionArgsSource, completionArgs, "--max-applications");
  copyOption(completionArgsSource, completionArgs, "--max-documents");
  copyOption(completionArgsSource, completionArgs, "--max-mb");
  runNode(attachmentCompleter, completionArgs);

  const filterArgs = ["--directory", output];
  copyOption(completionArgsSource, filterArgs, "--max-applications");
  runNode(drawingApplicationFilter, filterArgs);
}

function productionCaps(values, active = production) {
  if (!active) return [...values];
  const result = [...values];
  enforceMinimum(result, "--max-applications", 500);
  enforceMinimum(result, "--max-documents", 1200);
  enforceMinimum(result, "--max-mb", 150);
  return result;
}

function collectorOnlyArgs(values) {
  const result = [...values];
  // The original collector is intentionally limited to a tiny attachment probe.
  // The balanced stage owns the real 150 MB download budget.
  setOption(result, "--max-documents", 1);
  setOption(result, "--max-mb", 25);
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

function selfTestProductionCaps() {
  const result = productionCaps(["--max-applications", "300", "--max-documents", "240", "--max-mb", "25"], true);
  if (optionValue(result, "--max-applications") !== "500") throw new Error("Alton production application cap self-test failed");
  if (optionValue(result, "--max-documents") !== "1200") throw new Error("Alton production document cap self-test failed");
  if (optionValue(result, "--max-mb") !== "150") throw new Error("Alton production byte cap self-test failed");
}

function runNode(script, childArgs) {
  const result = spawnSync(process.execPath, [script, ...childArgs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function copyOption(source, target, name) { const value = optionValue(source, name); if (value !== null) target.push(name, value); }
