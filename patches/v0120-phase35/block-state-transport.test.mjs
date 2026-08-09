import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildBedrockWorld } from './mcworld.mjs';
import { buildBedrockAddon } from './bedrock.mjs';

function statefulCompilation(){
  return {
    meta:{
      bounds:{minX:0,minZ:0,maxX:0,maxZ:0},
      spawnLocal:{x:0,y:0,z:0},
      confidence:1,
      evidenceGrade:'A',
      baseY:64,
      opsPerYield:16,
      elevationDatumM:100
    },
    palette:[
      'minecraft:grass_block',
      {name:'minecraft:normal_stone_stairs',states:{upside_down_bit:false,weirdo_direction:2}}
    ],
    chunks:[{x:0,z:0,o:[[6,0,1,0,0,1,0,1]]}],
    signs:[],
    stats:{operations:1,rawOperations:1,chunks:1,estimatedBlocks:1}
  };
}

function plainCompilation(){
  const c=statefulCompilation();
  c.palette=['minecraft:grass_block','minecraft:stone'];
  return c;
}

test('stateful palette descriptor round-trips stair states into mcworld',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tpmap-stateful-world-'));
  try{
    const result=await buildBedrockWorld({parkName:'State Test',slug:'state-test',compilation:statefulCompilation(),outputDir:dir,options:{worldMargin:0,maxWorldChunks:4,palette:'clean',baseY:64}});
    assert.equal(result.validation.statefulPalette.status,'passed');
    assert.equal(result.validation.statefulPalette.block,'minecraft:normal_stone_stairs');
    assert.deepEqual(result.validation.statefulPalette.states,{upside_down_bit:false,weirdo_direction:2});
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('stateful addon operation uses BlockPermutation instead of fill',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tpmap-stateful-addon-'));
  try{
    const result=await buildBedrockAddon({parkName:'State Test',slug:'state-test',compilation:statefulCompilation(),outputDir:dir});
    const source=await readFile(path.join(result.packRoot,'scripts/main.js'),'utf8');
    assert.match(source,/BlockPermutation\.resolve\(block\.name, block\.states\)/);
    assert.match(source,/Stateful palette operations must be single-block writes/);
    assert.match(source,/applyOperation\(dimension, operation, anchor\)/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('plain string palette remains backward compatible',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tpmap-plain-world-'));
  try{
    const result=await buildBedrockWorld({parkName:'Plain Test',slug:'plain-test',compilation:plainCompilation(),outputDir:dir,options:{worldMargin:0,maxWorldChunks:4,palette:'clean',baseY:64}});
    assert.equal(result.validation.statefulPalette.status,'not-applicable');
    assert.equal(result.validation.status,'passed');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('stateful descriptor operations must stay single voxel',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tpmap-stateful-span-'));
  const c=statefulCompilation(); c.chunks[0].o[0]=[6,0,1,0,1,1,0,1];
  try{
    await assert.rejects(()=>buildBedrockWorld({parkName:'Bad State',slug:'bad-state',compilation:c,outputDir:dir,options:{worldMargin:0,maxWorldChunks:4,palette:'clean',baseY:64}}),/Stateful palette operations must be single-block writes/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
