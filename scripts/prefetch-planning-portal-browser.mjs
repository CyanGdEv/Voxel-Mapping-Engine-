#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Park-specific planning acquisition dispatcher. Staffordshire Moorlands still
// uses the legacy-host collector + balanced attachment expansion for Alton.
// Chessington uses Kingston's Idox register plus the private-use historic-plan
// bridge because Kingston removes supporting documents after determination.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const staffordshireCollector = path.join(scriptDirectory, "prefetch-planning-portal-http.mjs");
const attachmentCompleter = path.join(scriptDirectory, "complete-planning-prefetch-balanced.mjs");
const kingstonCollector = path.join(scriptDirectory, "prefetch-planning-kingston.mjs");
const requestedArgs = process.argv.slice(2);
const selfTest = requestedArgs.includes("--self-test");
const preset = String(process.env.TPMAP_PRESET || "").trim().toLowerCase();
const production = !selfTest && /^Build Minecraft Theme Park World/.test(process.env.GITHUB_WORKFLOW || "");
const completionArgsSource = productionCaps(requestedArgs);

if (selfTest) {
  runNode(staffordshireCollector, ["--self-test"]);
  runNode(attachmentCompleter, ["--self-test"]);
  runNode(kingstonCollector, ["--self-test"]);
  console.log("planning park dispatch self-test passed for Staffordshire/Alton and Kingston/Chessington");
} else if (preset === "chessington") {
  runNode(kingstonCollector, completionArgsSource);
} else {
  const collectorArgs = production ? collectorOnlyArgs(completionArgsSource) : [...completionArgsSource];
  runNode(staffordshireCollector, collectorArgs);
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
  // The Staffordshire collector is intentionally limited to a tiny attachment
  // probe. Its balanced stage owns the real 150 MB download budget.
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

function runNode(script, childArgs) {
  const result = spawnSync(process.execPath, [script, ...childArgs], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(script)} terminated by ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function copyOption(source, target, name) { const value = optionValue(source, name); if (value !== null) target.push(name, value); }
