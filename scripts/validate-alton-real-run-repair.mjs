#!/usr/bin/env node
// Focused repository-side self-test for the structural repair helpers added after
// the real Alton generation failure. Production-preparation CI invokes the same
// helpers from the assembled build fragments; this file provides a cheap syntax
// and transform smoke-test for local/CI use.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const script of [
  'scripts/repair-alton-live-generator-contracts.mjs',
  'scripts/prepare-phase35-block-state-input.mjs',
  'scripts/complete-phase30b-semantic-contract.mjs'
]){
  const file=path.join(root,script);
  const check=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(check.status!==0) process.exit(check.status??1);
  const test=spawnSync(process.execPath,[file,'--self-test'],{stdio:'inherit'});
  if(test.status!==0) process.exit(test.status??1);
}
console.log('Alton real-run repair focused self-tests passed');
