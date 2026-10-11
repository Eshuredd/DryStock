/* global URL, TextEncoder */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/scenario-input.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Set,JSON});
const {validateScenarioInput,emptyScenario,nextId,codes}=exports;
const sample=()=>{
  const s=JSON.parse(fs.readFileSync(new URL('../../sample-data/surat-yard.json',import.meta.url),'utf8'));
  s.completed=[];
  for(const w of [...s.workers,...s.forklifts]) Object.assign(w,{available_from:0,available_until:240,enabled:true});
  for(const r of [...s.tarps,...s.storage]) r.enabled=true;
  for(const l of s.lots) {l.protection_status ||= 'exposed';l.restrictions ||= [];for(const a of l.actions) {a.forklift ??= false;a.required_skills ||= [];}}
  return s;
};
test('unchanged sample passes custom form validation',()=>assert.deepEqual(Object.keys(validateScenarioInput(sample())),[]));
test('empty editor prompts for material description and worker name',()=>{
  const s=emptyScenario(),e=validateScenarioInput(s);
  assert.match(e['lots.0.description'],/Enter/);assert.match(e['workers.0.name'],/Enter/);
  assert.equal(s.completed.length,0);
});
test('money, timing and resource compatibility errors point to fields',()=>{
  const s=sample();s.lots[0].exposed_loss_inr=s.lots[0].value_inr+1;s.deadline=80;
  s.workers[0].available_from=100;s.workers[0].available_until=10;s.tarps[0].categories=['unknown'];
  s.lots[0].actions[0].duration=1.5;s.lots[0].weight_kg=NaN;
  const e=validateScenarioInput(s);
  for(const key of ['lots.0.exposed_loss_inr','deadline','workers.0.available_until','tarps.0.categories','lots.0.actions.0.duration','lots.0.weight_kg']) assert(e[key],key);
});
test('limits, duplicate identifiers, codes and request size are validated',()=>{
  const s=sample();s.workers[0].id=s.workers[1].id;s.workers[0].skills=['forklift','forklift'];
  s.lots=Array.from({length:31},(_,i)=>({...s.lots[0],id:`L${i}`,description:'x'.repeat(160)}));
  const e=validateScenarioInput(s);assert(e.lots);assert(e['workers.0.id']);assert(e['workers.0.skills']);
  s.lots[0].restrictions=['x'.repeat(32768)];assert(validateScenarioInput(s).size);
});
test('custom scenario can have no crew or equipment; leaving exposed remains feasible',()=>{
  const s=sample();s.workers=[];s.tarps=[];s.storage=[];s.forklifts=[];
  assert.deepEqual(Object.keys(validateScenarioInput(s)),[]);
});
test('generated IDs do not collide and comma codes preserve explicit skills',()=>{
  assert.equal(nextId([{id:'W1'},{id:'W3'}],'W'),'W2');
  assert.deepEqual(Array.from(codes('forklift, bale_handling, ')),['forklift','bale_handling']);
});
