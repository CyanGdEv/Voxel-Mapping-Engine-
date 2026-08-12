#!/usr/bin/env node
// TPMAP_STRUCTURAL_SCENERY_INTEGRATION_V1
// Post-Phase30 bridge: wire ordinary park barriers into the shared structural
// material library without mutating checksum-locked Phase30 source artifacts.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const MARKER='TPMAP_STRUCTURAL_SCENERY_INTEGRATION_V1';
const STRUCTURAL_MARKER='TPMAP_PHASE35_STRUCTURAL_MATERIAL_PATTERN_LIBRARY_V1';
const args=parse(process.argv.slice(2));
if(args.selfTest) selfTest();
else if(!args.generator||!args.structuralLibrary) throw new Error('--generator and --structural-library are required');
else await install(args);

function parse(argv){
  const out={generator:null,structuralLibrary:null,validateOnly:false,selfTest:false};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--generator') out.generator=argv[++i];
    else if(argv[i]==='--structural-library') out.structuralLibrary=argv[++i];
    else if(argv[i]==='--validate-only') out.validateOnly=true;
    else if(argv[i]==='--self-test') out.selfTest=true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

async function install({generator,structuralLibrary,validateOnly}){
  const root=path.resolve(generator);
  const sceneryFile=path.join(root,'src/lib/park-scenery-fidelity.mjs');
  const structuralTarget=path.join(root,'src/lib/structural-material-pattern-library.mjs');
  const structuralSource=await readFile(path.resolve(structuralLibrary),'utf8');
  if(!structuralSource.includes(STRUCTURAL_MARKER)) throw new Error('Structural material source marker missing');
  if(!validateOnly){
    await copyFile(path.resolve(structuralLibrary),structuralTarget);
    const before=await readFile(sceneryFile,'utf8');
    const after=transformScenery(before);
    if(after!==before) await writeFile(sceneryFile,after,'utf8');
  }
  const scenery=await readFile(sceneryFile,'utf8');
  const structural=await readFile(structuralTarget,'utf8');
  validateScenery(scenery);
  if(!structural.includes(STRUCTURAL_MARKER)) throw new Error('Generated structural material library missing');
  console.log(JSON.stringify({status:validateOnly?'validated':'installed',marker:MARKER,sharedLibrary:STRUCTURAL_MARKER}));
}

export function transformScenery(source){
  let out=String(source);
  if(out.includes(MARKER)){validateScenery(out);return out;}
  const importAnchor='// ThemePark Map park scenery fidelity layer v1.\n// Evidence-driven model shapes with deterministic Minecraft-native detailing.\n';
  if(!out.includes(importAnchor)) throw new Error('Park scenery header anchor missing');
  out=out.replace(importAnchor,`${importAnchor}import { structuralBlockFor, structuralMaterialFamily } from './structural-material-pattern-library.mjs'; // ${MARKER}\n`);

  const masonryOld=`    const brick = /brick/.test(material) ? "minecraft:brick_wall" : /sandstone/.test(material) ? "minecraft:sandstone_wall" : "minecraft:stone_brick_wall";\n    const cap = /brick/.test(material) ? "minecraft:brick_slab" : /sandstone/.test(material) ? "minecraft:sandstone_slab" : "minecraft:stone_brick_slab";`;
  const masonryNew=`    const structuralFamily = structuralMaterialFamily(material) || (/brick/.test(material) ? "brick" : /sandstone/.test(material) ? "sandstone" : "stone");\n    const brick = structuralBlockFor({ material: structuralFamily, role: "wall", tags });\n    const cap = structuralBlockFor({ material: structuralFamily, role: "cap", tags });`;
  out=replaceOnce(out,masonryOld,masonryNew,'masonry barrier recipe');

  const metalOld=`  if (/(metal|chain|mesh|railing|guard_rail|fence)/.test(\`${'${barrier} ${material}'}\`)) {\n    add(4, start, y + 1, z, end, y + 2, z, "minecraft:iron_bars");\n    for (let x = start; x <= end; x += 4) add(4, x, y + 1, z, x, y + 2, z, "minecraft:polished_blackstone_wall");\n    return true;\n  }`;
  const metalNew=`  if (/(glass|glazed|glazing)/.test(\`${'${barrier} ${material}'}\`)) {\n    const pane = structuralBlockFor({ material: "glass", role: "railing", colour: tags.colour || tags.color, tags });\n    add(4, start, y + 1, z, end, y + 2, z, pane);\n    return true;\n  }\n\n  if (/(metal|steel|iron|chain|mesh|railing|guard_rail|fence)/.test(\`${'${barrier} ${material}'}\`)) {\n    const railing = structuralBlockFor({ material: "metal", role: "railing", tags });\n    add(4, start, y + 1, z, end, y + 2, z, railing);\n    for (let x = start; x <= end; x += 4) add(4, x, y + 1, z, x, y + 2, z, "minecraft:polished_blackstone_wall");\n    return true;\n  }`;
  out=replaceOnce(out,metalOld,metalNew,'metal barrier recipe');

  const capsOld='  return Object.freeze({ fullBlocks: true, slabs: true, stairs: true, walls: true, fences: true, deterministic: true, evidenceDriven: true });';
  const capsNew='  return Object.freeze({ fullBlocks: true, slabs: true, stairs: true, walls: true, fences: true, ironBars: true, glassPanes: true, sharedStructuralMaterials: true, deterministic: true, evidenceDriven: true });';
  out=replaceOnce(out,capsOld,capsNew,'scenery capability contract');
  validateScenery(out);
  return out;
}

function validateScenery(source){
  for(const token of [MARKER,'structuralBlockFor','structuralMaterialFamily','role: "wall"','role: "cap"','material: "glass", role: "railing"','material: "metal", role: "railing"','sharedStructuralMaterials: true']){
    if(!source.includes(token)) throw new Error(`Structural scenery integration missing ${token}`);
  }
  if(source.includes('const brick = /brick/.test(material) ? "minecraft:brick_wall"')) throw new Error('Legacy masonry shape selector survived structural integration');
  if(source.includes('end, y + 2, z, "minecraft:iron_bars"')) throw new Error('Legacy direct iron-bars selector survived structural integration');
}

function replaceOnce(source,before,after,label){
  const first=source.indexOf(before);
  if(first<0) throw new Error(`Structural scenery anchor missing: ${label}`);
  if(source.indexOf(before,first+before.length)>=0) throw new Error(`Structural scenery anchor ambiguous: ${label}`);
  return source.slice(0,first)+after+source.slice(first+before.length);
}

function selfTest(){
  const fixture=`// ThemePark Map park scenery fidelity layer v1.\n// Evidence-driven model shapes with deterministic Minecraft-native detailing.\n\nexport function compileParkBarrierRun(){\n  const tags={},barrier='',material='',start=0,end=2,y=64,z=0,add=()=>{};\n  if (/(stone|masonry|wall|brick)/.test(\`${'${barrier} ${material}'}\`)) {\n    const brick = /brick/.test(material) ? "minecraft:brick_wall" : /sandstone/.test(material) ? "minecraft:sandstone_wall" : "minecraft:stone_brick_wall";\n    const cap = /brick/.test(material) ? "minecraft:brick_slab" : /sandstone/.test(material) ? "minecraft:sandstone_slab" : "minecraft:stone_brick_slab";\n  }\n  if (/(metal|chain|mesh|railing|guard_rail|fence)/.test(\`${'${barrier} ${material}'}\`)) {\n    add(4, start, y + 1, z, end, y + 2, z, "minecraft:iron_bars");\n    for (let x = start; x <= end; x += 4) add(4, x, y + 1, z, x, y + 2, z, "minecraft:polished_blackstone_wall");\n    return true;\n  }\n}\nexport function sceneryShapeCapabilities() {\n  return Object.freeze({ fullBlocks: true, slabs: true, stairs: true, walls: true, fences: true, deterministic: true, evidenceDriven: true });\n}\n`;
  const once=transformScenery(fixture),twice=transformScenery(once);
  if(once!==twice) throw new Error('Structural scenery transform is not idempotent');
  validateScenery(once);
  console.log('structural_scenery_integration_self_test=PASS');
}
