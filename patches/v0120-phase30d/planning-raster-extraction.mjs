// TPMAP_PHASE30D_RASTER_PLANNING_GEOMETRY
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm } from "node:fs/promises";
import { classifyComprehensivePlanningLabel } from "./planning-comprehensive-semantics.mjs";

const execFileAsync = promisify(execFile);
const TOOL = fileURLToPath(new URL("../tools/planning_raster_vectorize.py", import.meta.url));

export async function extractRasterPlanningPage({ filename, page = 1, workDirectory, document = {} }) {
  await mkdir(workDirectory, { recursive: true });
  const key = safeKey(document.sha256 || document.cacheKey || document.id || "planning-raster");
  const image = await rasterImage(filename, page, workDirectory, key, document.mime);
  const output = path.join(workDirectory, `${key}-p${page}-raster.svg`);
  const redOcr = path.join(workDirectory, `${key}-p${page}-red-ocr.png`);
  await rm(output, { force: true });
  await rm(redOcr, { force: true });
  await execFileAsync("python3", [TOOL, "--input", image, "--output", output, "--red-ocr-output", redOcr, "--max-shapes", "50000"], {
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024
  });
  const svg = await readFile(output, "utf8");
  const anchors = mergeOcrAnchors(
    await extractRasterTextAnchors(image),
    await extractRasterTextAnchors(redOcr, { coordinateScale: 0.5, minimumConfidence: 20 })
  );
  return { svg, semantic: { anchors, source: "tesseract-tsv" }, image };
}

async function rasterImage(filename, page, workDirectory, key, mime) {
  if (String(mime || "").startsWith("image/")) return filename;
  const prefix = path.join(workDirectory, `${key}-p${page}-render`);
  const output = `${prefix}.png`;
  await rm(output, { force: true });
  await execFileAsync("pdftocairo", [
    "-png", "-singlefile", "-r", "300", "-f", String(page), "-l", String(page), filename, prefix
  ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  return output;
}

export async function extractRasterTextAnchors(filename, options = {}) {
  try {
    const { stdout } = await execFileAsync("tesseract", [filename, "stdout", "--psm", "11", "tsv"], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8"
    });
    return parseTesseractTsv(stdout, options);
  } catch {
    return [];
  }
}

export function parseTesseractTsv(value, options = {}) {
  const coordinateScale = Number(options.coordinateScale) || 1;
  const minimumConfidence = Number(options.minimumConfidence ?? 35);
  const rows = String(value || "").split(/\r?\n/).slice(1).map((line) => line.split("\t"));
  const lines = new Map();
  for (const fields of rows) {
    if (fields.length < 12) continue;
    const confidence = Number(fields[10]);
    const text = fields.slice(11).join("\t").trim();
    if (!text || !Number.isFinite(confidence) || confidence < minimumConfidence) continue;
    const key = fields.slice(1, 5).join(":");
    const x = Number(fields[6]) * coordinateScale, y = Number(fields[7]) * coordinateScale;
    const width = Number(fields[8]) * coordinateScale, height = Number(fields[9]) * coordinateScale;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    const line = lines.get(key) || { words: [], xMin: x, yMin: y, xMax: x + width, yMax: y + height, confidence: 0 };
    line.words.push(text);
    line.xMin = Math.min(line.xMin, x); line.yMin = Math.min(line.yMin, y);
    line.xMax = Math.max(line.xMax, x + width); line.yMax = Math.max(line.yMax, y + height);
    line.confidence = Math.max(line.confidence, confidence);
    lines.set(key, line);
  }
  return [...lines.values()].flatMap((line) => {
    const text = line.words.join(" ");
    const semantic = classifyComprehensivePlanningLabel(text);
    if (!semantic) return [];
    return [{
      text,
      xMin: line.xMin, yMin: line.yMin, xMax: line.xMax, yMax: line.yMax,
      cx: (line.xMin + line.xMax) / 2,
      cy: (line.yMin + line.yMax) / 2,
      ocrConfidence: line.confidence / 100,
      semantic
    }];
  });
}

function mergeOcrAnchors(...groups) {
  const anchors = [], seen = new Set();
  for (const anchor of groups.flat()) {
    const key = `${anchor.semantic?.featureClass}:${Math.round(anchor.cx)}:${Math.round(anchor.cy)}:${String(anchor.text).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(anchor);
  }
  return anchors;
}

function safeKey(value) {
  return String(value || "drawing").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
}
