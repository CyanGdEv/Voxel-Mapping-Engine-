#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MARKER = 'PHASE30D_RASTER_PLANNING_GEOMETRY';
const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const root = option('--root');
  if (!root) throw new Error('--root is required');
  transformFile(path.join(root, 'src/lib/planning-georeference.mjs'), transformGeoreference);
  transformFile(path.join(root, 'src/lib/planning-vectorize.mjs'), transformVectorize);
  console.log('Phase 30D raster planning geometry transform applied');
}

function option(name) { const i=args.indexOf(name); return i>=0 ? args[i+1] : null; }
function transformFile(file, fn) {
  const before=readFileSync(file,'utf8');
  const after=fn(before);
  if (after===before && !before.includes(MARKER)) throw new Error(`Phase 30D made no change to ${file}`);
  writeFileSync(file,after);
}

export function transformGeoreference(input) {
  if (input.includes(`${MARKER}:GEOREFERENCE`)) return input;
  const anchor = `  await execFileAsync("pdftoppm", [\n    "-f", String(candidate.page), "-l", String(candidate.page), "-singlefile",\n    "-r", String(config.dpi), "-png", sourceFile, prefix\n  ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });\n  const gcpArguments = [];`;
  const replacement = `  // ${MARKER}:GEOREFERENCE\n  if (document.mime === "application/pdf") {\n    await execFileAsync("pdftoppm", [\n      "-f", String(candidate.page), "-l", String(candidate.page), "-singlefile",\n      "-r", String(config.dpi), "-png", sourceFile, prefix\n    ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });\n  } else if (/^image\\/(?:png|jpeg|webp|tiff)$/.test(String(document.mime || ""))) {\n    await execFileAsync("gdal_translate", ["-of", "PNG", sourceFile, png], {\n      timeout: 120_000, maxBuffer: 8 * 1024 * 1024\n    });\n  } else {\n    throw new Error(\`unsupported planning raster MIME \${document.mime || "unknown"}\`);\n  }\n  const gcpArguments = [];`;
  if (!input.includes(anchor)) throw new Error('Could not locate planning georeference rasterization anchor');
  return input.replace(anchor,replacement);
}

export function transformVectorize(input) {
  if (input.includes(`${MARKER}:VECTORIZE`)) return input;
  let text=input;
  const constants = `const POLYGON_ROLES = new Set(["site-plan", "block-plan", "landscape-plan", "ride-layout", "floor-plan", "terrain-or-drainage", "access-plan", "lighting-plan"]);`;
  if (!text.includes(constants)) throw new Error('Could not locate planning vectorize constants');
  text=text.replace(constants, `${constants}\nconst ${MARKER} = true;\nconst RASTER_PLANNING_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]);`);
  const old = `      if (entry.document.mime !== "application/pdf") {\n        rejectDocument(report, entry, "raster-document-vectorization-not-enabled");\n        continue;\n      }\n      const sourceFile = await locateCachedDocument(cacheDirectory, entry.document);\n      if (!sourceFile) {\n        rejectDocument(report, entry, "cached-document-not-found");\n        continue;\n      }\n      const svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n      const parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });`;
  const repl = `      const sourceFile = await locateCachedDocument(cacheDirectory, entry.document);\n      if (!sourceFile) {\n        rejectDocument(report, entry, "cached-document-not-found");\n        continue;\n      }\n      let svg = null;\n      let rasterExtraction = null;\n      let parsed;\n      if (entry.document.mime === "application/pdf") {\n        svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n        parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n      } else if (RASTER_PLANNING_MIMES.has(String(entry.document.mime || ""))) {\n        rasterExtraction = await extractRasterPlanningLinework(runtime, sourceFile, entry, config);\n        parsed = rasterExtraction.parsed;\n      } else {\n        rejectDocument(report, entry, "unsupported-raster-document-mime");\n        continue;\n      }`;
  if (!text.includes(old)) throw new Error('Could not locate planning vectorize PDF-only extraction block');
  text=text.replace(old,repl);

  const semanticLine = `      const semantic = await extractPlanningSemanticAnchors(runtime, sourceFile, entry.georeference.page || 1, parsed, entry.document);`;
  if (text.includes(semanticLine)) {
    text=text.replace(semanticLine, `${semanticLine}\n      if (rasterExtraction?.semanticAnchors?.length) semantic.anchors.push(...rasterExtraction.semanticAnchors);`);
  }

  text=text.replace(`        svgSha256: sha256Text(svg)`, `        svgSha256: svg ? sha256Text(svg) : null,\n        rasterLineworkSha256: rasterExtraction?.sha256 || null,\n        rasterShapeCount: rasterExtraction?.parsed?.shapes?.length || 0`);

  const insertBefore = `export function parseSvgDrawing(svg, options = {}) {`;
  if (!text.includes(insertBefore)) throw new Error('Could not locate parseSvgDrawing insertion point');
  text=text.replace(insertBefore, `${rasterHelpers()}\n\n${insertBefore}`);
  return text;
}

function rasterPython() { return `import cv2, json, math, sys
import numpy as np
filename=sys.argv[1]
img=cv2.imread(filename, cv2.IMREAD_COLOR)
if img is None: raise SystemExit('unable to decode planning raster')
h,w=img.shape[:2]
gray=cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
gray=cv2.GaussianBlur(gray,(3,3),0)
binary=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY_INV,31,11)
num, labels, stats, _ = cv2.connectedComponentsWithStats(binary,8)
clean=np.zeros_like(binary)
min_component=max(12,int(w*h*0.000003))
for i in range(1,num):
    area=int(stats[i,cv2.CC_STAT_AREA])
    if area>=min_component: clean[labels==i]=255
min_dim=min(w,h)
min_line=max(24,int(min_dim*0.025))
max_gap=max(4,int(min_dim*0.006))
lines=cv2.HoughLinesP(clean,1,np.pi/180,threshold=max(25,int(min_line*0.7)),minLineLength=min_line,maxLineGap=max_gap)
shapes=[]
seen=set()
def add_line(x1,y1,x2,y2):
    if math.hypot(x2-x1,y2-y1)<min_line: return
    q=4
    a=(round(x1/q),round(y1/q)); b=(round(x2/q),round(y2/q))
    key=tuple(sorted((a,b)))
    if key in seen: return
    seen.add(key)
    shapes.append({'type':'line','closed':False,'curved':False,'points':[{'x':float(x1),'y':float(y1)},{'x':float(x2),'y':float(y2)}]})
if lines is not None:
    for row in lines[:5000]:
        x1,y1,x2,y2=map(int,row[0]); add_line(x1,y1,x2,y2)
contours,_=cv2.findContours(clean,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
min_area=max(180.0,w*h*0.00008); max_area=w*h*0.72
for contour in contours:
    area=abs(cv2.contourArea(contour))
    if area<min_area or area>max_area: continue
    x,y,bw,bh=cv2.boundingRect(contour)
    if bw<12 or bh<12: continue
    if x<=2 and y<=2 and x+bw>=w-3 and y+bh>=h-3: continue
    peri=cv2.arcLength(contour,True)
    approx=cv2.approxPolyDP(contour,max(2.0,peri*0.006),True)
    if len(approx)<4 or len(approx)>80: continue
    pts=[{'x':float(p[0][0]),'y':float(p[0][1])} for p in approx]
    pts.append(dict(pts[0]))
    shapes.append({'type':'polygon','closed':True,'curved':False,'points':pts})
    if len(shapes)>=7000: break
print(json.dumps({'width':w,'height':h,'shapes':shapes[:7000]}))`; }

function rasterHelpers() {
  const source = String.raw`
// ${MARKER}:VECTORIZE
const RASTER_LINEWORK_PYTHON = __RASTER_PYTHON__;

async function extractRasterPlanningLinework(runtime, filename, entry, config) {
  let result;
  if (typeof runtime.planningRasterVectorProvider === "function") {
    result = await runtime.planningRasterVectorProvider({ filename, document: entry.document, georeference: entry.georeference, config });
  } else {
    const { stdout } = await execFileAsync("python3", ["-c", RASTER_LINEWORK_PYTHON, filename], {
      timeout: 180_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8"
    });
    result = JSON.parse(stdout);
  }
  const pixelWidth = Number(result?.width), pixelHeight = Number(result?.height);
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    throw new Error("planning raster vectorizer returned invalid dimensions");
  }
  const pageWidth = Number(entry.georeference.pageWidthPoints);
  const pageHeight = Number(entry.georeference.pageHeightPoints);
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    throw new Error("planning raster vectorization requires accepted page dimensions");
  }
  const sx=pageWidth/pixelWidth, sy=pageHeight/pixelHeight;
  const shapes=(result.shapes || []).slice(0, 7000).flatMap((shape) => {
    const points=(shape.points || []).map((point)=>({x:Number(point.x)*sx,y:Number(point.y)*sy})).filter((point)=>Number.isFinite(point.x)&&Number.isFinite(point.y));
    if (points.length < 2) return [];
    return [{ type: shape.closed ? "polygon" : "line", closed: shape.closed === true, curved: false, points }];
  });
  const serialized=JSON.stringify({pixelWidth,pixelHeight,shapes});
  return {
    parsed: { width: pageWidth, height: pageHeight, shapes },
    semanticAnchors: [],
    sha256: sha256Text(serialized)
  };
}
`;
  return source.replace('__RASTER_PYTHON__', JSON.stringify(rasterPython()));
}

function selfTest() {
  const sampleGeo=`async function warpPdfPage(sourceFile, outputDirectory, document, candidate, validation, config) {\n  const key = safeKey(document.sha256 || document.cacheKey || document.id);\n  const prefix = path.join(outputDirectory, \`\${key}-p\${candidate.page}\`);\n  const png = \`\${prefix}.png\`, vrt = \`\${prefix}.vrt\`, tif = \`\${prefix}.tif\`;\n  await execFileAsync("pdftoppm", [\n    "-f", String(candidate.page), "-l", String(candidate.page), "-singlefile",\n    "-r", String(config.dpi), "-png", sourceFile, prefix\n  ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });\n  const gcpArguments = [];`;
  const g=transformGeoreference(sampleGeo);
  if(!g.includes('gdal_translate')||!g.includes(`${MARKER}:GEOREFERENCE`)) throw new Error('georeference self-test failed');
  const sampleVec=`const POLYGON_ROLES = new Set(["site-plan", "block-plan", "landscape-plan", "ride-layout", "floor-plan", "terrain-or-drainage", "access-plan", "lighting-plan"]);\nasync function f(){\n      if (entry.document.mime !== "application/pdf") {\n        rejectDocument(report, entry, "raster-document-vectorization-not-enabled");\n        continue;\n      }\n      const sourceFile = await locateCachedDocument(cacheDirectory, entry.document);\n      if (!sourceFile) {\n        rejectDocument(report, entry, "cached-document-not-found");\n        continue;\n      }\n      const svg = await renderPdfPageAsSvg(runtime, sourceFile, entry.georeference.page || 1, workDirectory, entry.document);\n      const parsed = parseSvgDrawing(svg, { curveTolerance: config.curveTolerance });\n      x={svgSha256: sha256Text(svg)};\n}\nexport function parseSvgDrawing(svg, options = {}) {}`;
  const v=transformVectorize(sampleVec);
  if(!v.includes('planningRasterVectorProvider')||!v.includes(`${MARKER}:VECTORIZE`)) throw new Error('vectorize self-test failed');
  console.log('Phase 30D raster planning geometry transform self-test passed');
}
