#!/usr/bin/env node
// TPMAP_PHASE34_COMPILER_CONTRACT_PROBE_V1
// Diagnostic-only: locate the checksum-locked compileMap implementation and its immediate writer contract.
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const idx = args.indexOf("--generator");
const root = idx >= 0 ? path.resolve(args[idx + 1]) : null;
if (!root) throw new Error("--generator is required");

const files = await walk(path.join(root, "src"));
const hits = [];
for (const file of files) {
  if (!/\.(?:mjs|js)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  if (!text.includes("compileMap")) continue;
  const lines = text.split("\n");
  for (let i=0;i<lines.length;i++) {
    if (!lines[i].includes("compileMap")) continue;
    const lo=Math.max(0,i-18), hi=Math.min(lines.length,i+70);
    hits.push({ file:path.relative(root,file), line:i+1, excerpt:lines.slice(lo,hi).map((line,j)=>`${lo+j+1}: ${line}`).join("\n") });
  }
}
if (!hits.length) throw new Error("Phase 34 compiler probe could not locate compileMap in prepared generator");
console.log("TPMAP_PHASE34_COMPILER_CONTRACT_PROBE_BEGIN");
for (const hit of hits.slice(0,12)) {
  console.log(`FILE ${hit.file} LINE ${hit.line}`);
  console.log(hit.excerpt);
  console.log("TPMAP_PHASE34_COMPILER_CONTRACT_PROBE_HIT_END");
}
console.log(JSON.stringify({ marker:"TPMAP_PHASE34_COMPILER_CONTRACT_PROBE_V1", filesScanned:files.length, compileMapHits:hits.length }));
console.log("TPMAP_PHASE34_COMPILER_CONTRACT_PROBE_END");

async function walk(dir){const out=[];for(const ent of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
