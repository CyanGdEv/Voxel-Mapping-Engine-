#!/usr/bin/env node
// TPMAP_PHASE36_TREE_RECONSTRUCTION_V2_INSTALLER
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),gi=args.indexOf("--generator"),root=gi>=0?path.resolve(args[gi+1]):null;
const validateOnly=args.includes("--validate-only"),selfTest=args.includes("--self-test"),MARKER="TPMAP_PHASE36_TREE_RECONSTRUCTION_V2_INTEGRATION";
if(selfTest)runSelfTest();else if(!root)throw new Error("--generator is required");else await install(root,validateOnly);

async function install(root,validate){
  const mod=path.join(root,"src/lib/tree-reconstruction-v2.mjs"),test=path.join(root,"test/tree-reconstruction-v2.test.mjs"),raster=path.join(root,"src/lib/raster.mjs");
  if(!validate){
    await writeFile(mod,await readFile(path.join(here,"tree-reconstruction-v2.mjs"),"utf8"));
    await writeFile(test,await readFile(path.join(here,"tree-reconstruction-v2.test.mjs"),"utf8"));
    await writeFile(raster,transformRaster(await readFile(raster,"utf8")));
  }
  validateRaster(await readFile(raster,"utf8"));
  const m=await readFile(mod,"utf8"),t=await readFile(test,"utf8");
  for(const token of ["TPMAP_PHASE36_TREE_RECONSTRUCTION_V2","tryCompileTreeReconstructionV2","maxLeafFillRatio","exactSpeciesFabricated: false"])if(!m.includes(token))throw new Error(`Tree V2 module missing ${token}`);
  for(const token of ["blob-like","woodland polygons become separated deterministic trees"])if(!t.includes(token))throw new Error(`Tree V2 test missing ${token}`);
  console.log(JSON.stringify({status:validate?"validated":"installed",marker:MARKER}));
}

export function transformRaster(source){
  if(source.includes(MARKER)){validateRaster(source);return source;}
  const importLine='import { tryCompileTreeReconstructionV2 } from "./tree-reconstruction-v2.mjs";';
  let out=`${importLine}\nconst ${MARKER} = true;\n${source}`;
  const token="function compileVegetationFeature",at=out.indexOf(token);
  if(at<0||out.indexOf(token,at+token.length)>=0)throw new Error("Tree V2 compileVegetationFeature anchor missing or ambiguous");
  const paren=out.indexOf("(",at+token.length);if(paren<0)throw new Error("Tree V2 function parameter anchor missing");
  let depth=0,close=-1;
  for(let i=paren;i<out.length;i++){if(out[i]==="(")depth++;else if(out[i]===")"&&--depth===0){close=i;break;}}
  if(close<0)throw new Error("Tree V2 function parameter scan failed");
  let body=close+1;while(/\s/.test(out[body]))body++;if(out[body]!=="{")throw new Error("Tree V2 function body anchor missing");
  const inject='\n  const tpmapTreeV2 = tryCompileTreeReconstructionV2(arguments[0]);\n  if (tpmapTreeV2) return tpmapTreeV2;\n';
  out=out.slice(0,body+1)+inject+out.slice(body+1);validateRaster(out);return out;
}
function validateRaster(s){for(const token of [MARKER,'tryCompileTreeReconstructionV2(arguments[0])','if (tpmapTreeV2) return tpmapTreeV2;'])if(!s.includes(token))throw new Error(`Tree V2 raster integration missing ${token}`);}
function runSelfTest(){const sample='function compileVegetationFeature({add,feature}={}) { return null; }';const a=transformRaster(sample),b=transformRaster(a);if(a!==b)throw new Error("Tree V2 transform not idempotent");validateRaster(a);console.log("Tree V2 installer self-test passed");}
