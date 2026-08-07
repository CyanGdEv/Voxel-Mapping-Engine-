#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The legacy council portal rejects modern HTTPS/TLS fingerprints on hosted
// runners. Normal production acquisition may search up to 500 drawing-bearing
// applications. A one-click world build has a different constraint: it must
// produce useful drawings inside a four-minute outer budget. Its bounded
// refresh therefore searches a small application window first, spends most of
// the time on attachment completion + targeted ride recovery, and still stamps
// the normal 500-application policy ceiling so the result can be incrementally
// superseded by the dedicated full evidence warmer.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const collector = path.join(scriptDirectory, "prefetch-planning-portal-http.mjs");
const fallbackCollector = path.join(scriptDirectory, "prefetch-planning-portal.mjs");
const attachmentCompleter = path.join(scriptDirectory, "complete-planning-prefetch-balanced.mjs");
const drawingApplicationFilter = path.join(scriptDirectory, "filter-planning-drawing-applications.mjs");
const rideEvidenceRecovery = path.join(scriptDirectory, "recover-alton-ride-evidence.mjs");
const requestedArgs = process.argv.slice(2);
const productionWorkflows = new Set([
  "Build Minecraft Theme Park World",
  "Build Minecraft Theme Park World (Resilient)",
  "Warm Theme Park Evidence Cache"
]);
const production = !requestedArgs.includes("--self-test") && productionWorkflows.has(process.env.GITHUB_WORKFLOW || "");
const boundedWorldRefresh = optionValue(requestedArgs, "--runner") === "linux-resilient-bounded-refresh";
const completionArgsSource = productionCaps(requestedArgs);
const collectorArgs = production ? collectorOnlyArgs(completionArgsSource, boundedWorldRefresh) : [...completionArgsSource];

if (requestedArgs.includes("--self-test")) {
  requireSuccess(collector, collectorArgs);
  selfTestProductionCaps();
  selfTestBoundedArgs();
  requireSuccess(attachmentCompleter, ["--self-test"]);
  requireSuccess(drawingApplicationFilter, ["--self-test"]);
  requireSuccess(rideEvidenceRecovery, ["--self-test"]);
  console.log("planning expanded search, bounded drawing-first refresh, balanced attachment, drawing-application filter, ride-evidence recovery, and internal fallback self-test passed");
} else {
  const output = optionValue(completionArgsSource, "--output") || "planning-prefetch-output";
  const collectorTimeoutMs = boundedWorldRefresh ? 55_000 : null;
  const collectorStatus = runNodeStatus(collector, collectorArgs, { timeoutMs: collectorTimeoutMs });
  let primaryReady = collectorStatus === 0 || (boundedWorldRefresh && existsSync(path.join(output, "manifest.json")));

  if (primaryReady) {
    const completionArgs = ["--directory", output];
    copyOption(completionArgsSource, completionArgs, "--max-applications");
    copyOption(completionArgsSource, completionArgs, "--max-documents");
    copyOption(completionArgsSource, completionArgs, "--max-mb");
    if (boundedWorldRefresh) applyBoundedCompletionCaps(completionArgs);
    const completionStatus = runNodeStatus(attachmentCompleter, completionArgs, { timeoutMs: boundedWorldRefresh ? 90_000 : null });
    // A timeout during bounded attachment completion can still leave a useful
    // manifest and downloaded drawings. Preserve that work and let the drawing
    // filter/recovery stages decide whether it is usable instead of restarting
    // the broad collector and losing the remaining budget.
    primaryReady = completionStatus === 0 || (boundedWorldRefresh && existsSync(path.join(output, "manifest.json")));
  }

  if (!primaryReady) {
    console.error("Expanded planning collection failed; running the bounded legacy collector before applying the same drawing and ride-recovery policy.");
    const fallbackArgs = [...completionArgsSource];
    if (boundedWorldRefresh) applyBoundedCompletionCaps(fallbackArgs);
    const fallbackStatus = runNodeStatus(fallbackCollector, fallbackArgs, { timeoutMs: boundedWorldRefresh ? 55_000 : null });
    if (fallbackStatus !== 0 && !existsSync(path.join(output, "manifest.json"))) process.exit(fallbackStatus || 1);
  }

  const filterArgs = ["--directory", output];
  // Keep the policy ceiling at 500 even when the bounded collector only had
  // time to inspect a smaller subset. retainedApplications records the actual
  // number, so this does not claim that 500 cases were downloaded.
  copyOption(completionArgsSource, filterArgs, "--max-applications");
  requireSuccess(drawingApplicationFilter, filterArgs, { timeoutMs: boundedWorldRefresh ? 15_000 : null });

  const recoveryArgs = ["--directory", output];
  copyOption(completionArgsSource, recoveryArgs, "--max-documents");
  copyOption(completionArgsSource, recoveryArgs, "--max-mb");
  if (boundedWorldRefresh) applyBoundedRecoveryCaps(recoveryArgs);
  requireSuccess(rideEvidenceRecovery, recoveryArgs, { timeoutMs: boundedWorldRefresh ? 80_000 : null });
}

function productionCaps(values, active = production) {
  if (!active) return [...values];
  const result = [...values];
  enforceMinimum(result, "--max-applications", 500);
  enforceMinimum(result, "--max-documents", 1200);
  enforceMinimum(result, "--max-mb", 150);
  return result;
}

function collectorOnlyArgs(values, bounded = false) {
  const result = [...values];
  // The collector performs discovery and only a tiny attachment probe. The
  // balanced stage owns the real document budget.
  if (bounded) setOption(result, "--max-applications", 24);
  setOption(result, "--max-documents", 1);
  setOption(result, "--max-mb", 25);
  return result;
}

function applyBoundedCompletionCaps(values) {
  setOption(values, "--max-applications", 24);
  setOption(values, "--max-documents", 120);
  setOption(values, "--max-mb", 60);
  return values;
}

function applyBoundedRecoveryCaps(values) {
  setOption(values, "--max-documents", 120);
  setOption(values, "--max-mb", 60);
  return values;
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

function selfTestBoundedArgs() {
  const productionArgs = productionCaps(["--runner", "linux-resilient-bounded-refresh", "--max-applications", "500", "--max-documents", "1200", "--max-mb", "150"], true);
  const discovery = collectorOnlyArgs(productionArgs, true);
  if (optionValue(discovery, "--max-applications") !== "24" || optionValue(discovery, "--max-documents") !== "1") throw new Error("bounded discovery caps self-test failed");
  const completion = applyBoundedCompletionCaps(["--max-applications", "500", "--max-documents", "1200", "--max-mb", "150"]);
  if (optionValue(completion, "--max-applications") !== "24" || optionValue(completion, "--max-documents") !== "120" || optionValue(completion, "--max-mb") !== "60") throw new Error("bounded completion caps self-test failed");
  const filter = ["--max-applications", optionValue(productionArgs, "--max-applications")];
  if (optionValue(filter, "--max-applications") !== "500") throw new Error("bounded filter must retain 500 application policy ceiling");
}

function runNodeStatus(script, childArgs, { timeoutMs = null } = {}) {
  const options = { stdio: "inherit", env: process.env };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) options.timeout = timeoutMs;
  const result = spawnSync(process.execPath, [script, ...childArgs], options);
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      console.error(`${path.basename(script)} exceeded bounded child timeout ${timeoutMs}ms`);
      return 124;
    }
    throw result.error;
  }
  if (result.signal) {
    console.error(`${path.basename(script)} terminated by ${result.signal}`);
    return 124;
  }
  return result.status ?? 1;
}
function requireSuccess(script, childArgs, options = {}) {
  const status = runNodeStatus(script, childArgs, options);
  if (status !== 0) process.exit(status);
}
function optionValue(values, name) { const index = values.indexOf(name); return index < 0 || index + 1 >= values.length ? null : values[index + 1]; }
function copyOption(source, target, name) { const value = optionValue(source, name); if (value !== null) target.push(name, value); }
