// TPMAP_PHASE30D_PROCESSED_PLANNING_DERIVATIVE_CACHE
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = 1;
const NAMESPACE = "tpmap-planning-processed-derivative-v1";
const MAX_COMPRESSED_ENTRY_BYTES = 32 * 1024 * 1024;
const sourceDigestCache = new Map();
const behaviorDigestCache = new Map();

export async function cachedPlanningDerivative({
  filename,
  page = 1,
  document = {},
  kind,
  behaviorFiles = [],
  toolCommands = [],
  compute
}) {
  if (typeof compute !== "function") throw new Error("cachedPlanningDerivative requires a compute function");
  const cacheRoot = derivativeCacheRoot();
  if (!cacheRoot) return compute();

  let context = null;
  try {
    const sourceSha256 = await sha256FileOnce(filename);
    const behaviorDigest = await planningDerivativeBehaviorDigest({ kind, behaviorFiles, toolCommands });
    const mime = String(document?.mime || "");
    const normalizedPage = positiveInteger(page, 1);
    const key = planningProcessedDerivativeFingerprint({ sourceSha256, behaviorDigest, page: normalizedPage, mime, kind });
    context = {
      sourceSha256,
      behaviorDigest,
      page: normalizedPage,
      mime,
      kind: String(kind || "unknown"),
      key,
      filename: path.join(cacheRoot, safeKey(kind || "unknown"), key.slice(0, 2), `${key}.json.gz`)
    };
  } catch {
    // Cache identity must never become a generation dependency. Any inability to
    // prove the cache key falls through to the original expensive computation.
    return compute();
  }

  const hit = await readCachedDerivative(context);
  if (hit !== null) return hit;
  const result = await compute();
  await writeCachedDerivative(context, result);
  return result;
}

export function planningProcessedDerivativeFingerprint({ sourceSha256, behaviorDigest, page = 1, mime = "", kind = "" }) {
  if (!/^[a-f0-9]{64}$/.test(String(sourceSha256 || ""))) throw new Error("processed planning cache requires an exact source SHA-256");
  if (!/^[a-f0-9]{64}$/.test(String(behaviorDigest || ""))) throw new Error("processed planning cache requires an exact behavior SHA-256");
  if (!String(kind || "").trim()) throw new Error("processed planning cache requires a derivative kind");
  const hash = createHash("sha256");
  hash.update(NAMESPACE); hash.update("\0");
  hash.update(String(kind)); hash.update("\0");
  hash.update(String(sourceSha256)); hash.update("\0");
  hash.update(String(behaviorDigest)); hash.update("\0");
  hash.update(String(positiveInteger(page, 1))); hash.update("\0");
  hash.update(String(mime || "")); hash.update("\0");
  return hash.digest("hex");
}

async function planningDerivativeBehaviorDigest({ kind, behaviorFiles, toolCommands }) {
  const files = [...new Set((behaviorFiles || []).map(normalizeBehaviorFile))].sort();
  const tools = (toolCommands || []).map(([command, args = []]) => [String(command), [...args].map(String)]);
  const cacheKey = JSON.stringify({ kind: String(kind || ""), files, tools, platform: process.platform, arch: process.arch, node: process.version });
  let promise = behaviorDigestCache.get(cacheKey);
  if (!promise) {
    promise = computeBehaviorDigest({ kind, files, tools });
    behaviorDigestCache.set(cacheKey, promise);
  }
  return promise;
}

async function computeBehaviorDigest({ kind, files, tools }) {
  const hash = createHash("sha256");
  hash.update("tpmap-planning-processed-behavior-v1\0");
  hash.update(String(kind || "")); hash.update("\0");
  hash.update(`${process.platform}\0${process.arch}\0${process.version}\0`);
  for (const filename of files) {
    const bytes = await readFile(filename);
    hash.update(path.basename(filename)); hash.update("\0");
    hash.update(bytes); hash.update("\0");
  }
  for (const [command, args] of tools) {
    hash.update(command); hash.update("\0");
    hash.update(JSON.stringify(args)); hash.update("\0");
    hash.update(await commandSignature(command, args)); hash.update("\0");
  }
  return hash.digest("hex");
}

async function commandSignature(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8"
    });
    return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  } catch (error) {
    return `unavailable:${error?.code || error?.message || "unknown"}`;
  }
}

function derivativeCacheRoot() {
  const explicit = String(process.env.TPMAP_PLANNING_DERIVATIVE_CACHE_DIR || "").trim();
  if (explicit) return path.resolve(explicit, "native-pdf-v1");
  const shared = String(process.env.TPMAP_SHARED_CACHE_DIR || "").trim();
  if (!shared) return null;
  // Deterministic derivatives are cache infrastructure, not independent source
  // evidence. The prepared-generator subtree is already excluded from the exact
  // finished-world evidence fingerprint while remaining SHA-sealed by the shared
  // runtime cache manifest.
  return path.resolve(shared, "prepared-generator", "planning-native-pdf-derivatives-v1");
}

async function readCachedDerivative(context) {
  let compressed = null;
  try {
    compressed = await readFile(context.filename);
    if (!compressed.length || compressed.length > MAX_COMPRESSED_ENTRY_BYTES) throw new Error("invalid compressed derivative size");
    const payload = JSON.parse(gunzipSync(compressed).toString("utf8"));
    if (payload?.schemaVersion !== SCHEMA_VERSION || payload?.namespace !== NAMESPACE) throw new Error("processed planning cache schema mismatch");
    for (const field of ["key", "sourceSha256", "behaviorDigest", "mime", "kind"]) {
      if (String(payload?.[field] ?? "") !== String(context[field] ?? "")) throw new Error(`processed planning cache ${field} mismatch`);
    }
    if (Number(payload.page) !== context.page) throw new Error("processed planning cache page mismatch");
    const serialized = JSON.stringify(payload.result);
    if (sha256Text(serialized) !== payload.resultSha256) throw new Error("processed planning cache result hash mismatch");
    return payload.result;
  } catch {
    if (compressed) await rm(context.filename, { force: true }).catch(() => {});
    return null;
  }
}

async function writeCachedDerivative(context, result) {
  let temporary = null;
  try {
    const serialized = JSON.stringify(result);
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      namespace: NAMESPACE,
      key: context.key,
      sourceSha256: context.sourceSha256,
      behaviorDigest: context.behaviorDigest,
      page: context.page,
      mime: context.mime,
      kind: context.kind,
      resultSha256: sha256Text(serialized),
      result
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
    if (compressed.length > MAX_COMPRESSED_ENTRY_BYTES) return;
    await mkdir(path.dirname(context.filename), { recursive: true });
    temporary = `${context.filename}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, compressed);
    await rename(temporary, context.filename);
  } catch {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    // Caching is an optimization only. Storage errors cannot change generation.
  }
}

async function sha256FileOnce(filename) {
  const resolved = path.resolve(filename);
  let promise = sourceDigestCache.get(resolved);
  if (!promise) {
    promise = readFile(resolved).then((bytes) => createHash("sha256").update(bytes).digest("hex"));
    sourceDigestCache.set(resolved, promise);
  }
  return promise;
}

function normalizeBehaviorFile(value) {
  if (value instanceof URL) return fileURLToPath(value);
  return path.resolve(String(value));
}

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function safeKey(value) {
  return String(value || "derivative").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "derivative";
}
