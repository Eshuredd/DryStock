/* global URL, URLSearchParams */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relative) {
  const filename = fileURLToPath(new URL(relative,import.meta.url));
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,Intl,Set,JSON,URLSearchParams,require: name => name.startsWith('.') ? load(path.relative(path.dirname(fileURLToPath(import.meta.url)),path.resolve(path.dirname(filename),name))+ (name.endsWith('workflow') ? '.ts' : '.tsx')) : require(name)});
  return exports;
}
const {deriveWorkflow,comparisonTotals,assignment,validateScenarioTimes,viewFromQuery,viewHref,zeroActionExplanation,strategyEstimates,computeLabel} = load('../lib/workflow.ts');
const {CrewSchedule} = load('../app/crew-schedule.tsx');
const {WorkInstructions} = load('../app/work-instructions.tsx');
const {StrategyComparison} = load('../app/strategy-comparison.tsx');
const {LotInventory} = load('../app/lot-inventory.tsx');
const {HistoricalPlan} = load('../app/historical-plan.tsx');
const fixture = JSON.parse(fs.readFileSync(new URL('../../sample-data/surat-yard.json',import.meta.url),'utf8'));
const l02 = {lot_id:'L02',action:'cover',start:0,end:12,worker_ids:['W1','W3'],tarp_id:'T2',forklift_id:null,storage_id:null,saved_loss_inr:5850};
const l06 = {...l02,lot_id:'L06',start:12,end:26,tarp_id:'T1',saved_loss_inr:7020};
const scenario = {...fixture,now_minute:0,completed:[],workers:fixture.workers.map(w=>({...w,enabled:true})),forklifts:fixture.forklifts.map(f=>({...f,enabled:true})),lots:fixture.lots.map(l=>({...l,restrictions:l.restrictions || [],actions:l.actions.map(a=>({...a,required_skills:a.required_skills || []})),protection_status:l.protection_status || 'exposed'}))};
const plan = {strategy:'CP-SAT',solver_status:'OPTIMAL',tasks:[l02,l06],initial_loss_inr:54230,completed_saved_inr:0,planned_saved_inr:12870,residual_loss_inr:41360,solve_seconds:.1,best_bound_inr:12870,validation:{valid:true,errors:[]}};
const original = {id:'original',state:'draft',revision:0,scenario,plan,comparisons:[{...plan,strategy:'Highest loss first',planned_saved_inr:12000,residual_loss_inr:42230}]};
const state = (latest, s=scenario) => ({compute_backend:'local',revision:0,scenario:s,latest,events:[]});

test('scenario generations exclude prior results even after reset audit leaves the latest-30 window',()=>{
  const old={...original,state:'superseded',scenario_epoch:0};
  const fresh={...original,id:'new',scenario_epoch:1};
  const s={...state(fresh),scenario_epoch:1};
  const w=deriveWorkflow(s,[old]);assert.equal(w.previous,undefined);assert.equal(w.active.id,'new');
  const restored=deriveWorkflow({...state(old),scenario_epoch:1},[old]);
  assert.equal(restored.active,null);assert.equal(restored.previous,undefined);assert.equal(restored.stateLabel,'No plan');
});

test('condition edits honor the custom safety buffer',()=>{
  assert(validateScenarioTimes('240','0',0,240).values);
  assert(validateScenarioTimes('201','0',0,200).errors.deadline);
});

test('workflow follows generation, approval, completion, disruption and revised approval',()=>{
  assert.equal(deriveWorkflow(state(null),[]).primaryLabel,'Generate plan');
  assert.equal(deriveWorkflow(state(original),[]).primaryLabel,'Review assignments');
  const done = {...scenario,now_minute:12,completed:[l02]};
  const approved = {...original,state:'approved'};
  const w = deriveWorkflow(state(approved,done),[]);
  assert.equal(w.primaryLabel,'View work instructions');
  assert.equal(w.completedBenefit,5850); assert.equal(w.plannedBenefit,7020);
  assert.equal(w.tasks.length,2); assert.equal(w.upcoming.length,1);
  const changed = {...done,deadline:35,rain_arrival_minute:45,forklifts:done.forklifts.map(f=>({...f,enabled:false}))};
  const superseded = {...original,state:'superseded'};
  const disrupted = deriveWorkflow(state(superseded,changed),[superseded]);
  assert.equal(disrupted.primaryLabel,'Re-optimise'); assert.equal(disrupted.plannedBenefit,0);
  assert.equal(disrupted.completedBenefit,5850); assert.equal(disrupted.active,null);
  const revised = {...original,id:'revised',scenario:changed,plan:{...plan,tasks:[l06],planned_saved_inr:7020,completed_saved_inr:5850}};
  assert.equal(deriveWorkflow(state(revised,changed),[revised,superseded]).primaryLabel,'Review assignments');
  assert.equal(deriveWorkflow(state({...revised,state:'approved'},changed),[revised,superseded]).stateLabel,'Approved');
  const moreDone={...changed,completed:[l02,{...l06,lot_id:'L07'}]};
  assert.equal(deriveWorkflow(state({...revised,state:'approved'},moreDone),[revised,superseded]).previous.id,'original');
  const laterClock={...changed,now_minute:13};
  const next={...revised,id:'next',scenario:laterClock};
  assert.equal(deriveWorkflow(state(next,laterClock),[next,{...revised,state:'superseded'},superseded]).previous.id,'revised');
});
test('reset and ordinary completion do not create a disruption summary',()=>{
  const history=[{...original,state:'superseded',scenario:{...scenario,deadline:35}}];
  assert.equal(deriveWorkflow(state(null),history).primaryLabel,'Generate plan');
  assert.equal(deriveWorkflow(state(original,{...scenario,now_minute:12,completed:[l02]}),[original]).previous,undefined);
  const old={...original,state:'superseded',created:'2026-10-11T06:00:00Z'};
  const reset={...state(old),events:[{kind:'demo_reset',at:'2026-10-11T06:01:00Z'}]};
  assert.equal(deriveWorkflow(reset,[old]).primaryLabel,'Generate plan');
  assert.equal(deriveWorkflow(reset,[old]).previous,undefined);
});
test('before/after totals compare retained plus pending, without duplicate completion',()=>{
  const done={...scenario,completed:[l02]};
  const revised={...original,plan:{...plan,tasks:[l06]}};
  const totals=comparisonTotals(original,revised,done);
  assert.equal(totals.retained,5850); assert.equal(totals.oldPending,7020);
  assert.equal(totals.oldTotal,12870); assert.equal(totals.newTotal,12870);
  assert.equal(comparisonTotals(original,null,done).newTotal,null);
  const already={...original,scenario:done,plan:{...plan,tasks:[l06]}};
  assert.equal(comparisonTotals(already,revised,done).oldTotal,12870);
  const newlyCompleted={...l06,lot_id:'L07',saved_loss_inr:1275};
  const later=comparisonTotals(original,revised,{...done,completed:[l02,newlyCompleted]});
  assert.equal(later.oldTotal,12870); // New completion cannot inflate the historical plan.
  assert.equal(later.retained,7125); assert.equal(later.oldRetained,5850);
});
test('allocation explanations use crew names',()=>{
  assert.match(assignment(l02,scenario),/Asha, Meera/);
  assert.doesNotMatch(assignment(l02,scenario),/W1|W3/);
});
test('desktop and mobile completion controls stay gated until approval',()=>{
  const props={scenario,tasks:[l02],approved:false,busy:false,pending:null,onComplete:()=>{},feedback:()=>null};
  const draft=renderToStaticMarkup(createElement(WorkInstructions,props));
  assert.equal((draft.match(/disabled=""/g)||[]).length,2);
  assert.match(draft,/Approve the current draft before recording completion/);
  const approved=renderToStaticMarkup(createElement(WorkInstructions,{...props,approved:true}));
  assert.doesNotMatch(approved,/disabled=""/);
  assert.match(approved,/mobile-work/); assert.match(approved,/Record L02 simulated completion/);
  const done=renderToStaticMarkup(createElement(WorkInstructions,{...props,approved:true,scenario:{...scenario,completed:[l02]}}));
  assert.doesNotMatch(done,/Record L02 simulated completion/);
  assert.match(done,/Reported complete \(simulated\)/);
});
test('comparison verdict precedes table and preserves tie/better-baseline cases',()=>{
  const html=renderToStaticMarkup(createElement(StrategyComparison,{current:original}));
  assert(html.indexOf('more estimated loss avoided')<html.indexOf('<table'));
  assert.match(html,/not measured savings or a general performance claim/);
  const tie={...original,comparisons:[{...plan,strategy:'Highest loss first'}]};
  assert.match(renderToStaticMarkup(createElement(StrategyComparison,{current:tie})),/strongest baseline matches/);
  const better={...original,comparisons:[{...plan,strategy:'Highest loss first',planned_saved_inr:14000,residual_loss_inr:40230}]};
  assert.match(renderToStaticMarkup(createElement(StrategyComparison,{current:better})),/Do not claim an advantage/);
});

test('comparison uses strongest matching residual and retains completed benefit equally',()=>{
  const snapshot={...original,plan:{...plan,completed_saved_inr:5850,planned_saved_inr:7020},comparisons:[
    {...plan,strategy:'Weak',completed_saved_inr:5850,planned_saved_inr:6000,residual_loss_inr:42380},
    {...plan,strategy:'Strong',completed_saved_inr:5850,planned_saved_inr:6500,residual_loss_inr:41880},
    {...plan,strategy:'Wrong retained',planned_saved_inr:20000,residual_loss_inr:34230}]};
  const e=strategyEstimates(snapshot);
  assert.equal(e.best.strategy,'Strong');assert.equal(e.series[0].value,48380);
  assert.equal(e.series[2].value,41360);assert.equal(e.difference,520);
  assert.equal(e.percent,520/41880*100);assert.equal(e.baselines.length,2);
  // Later completion does not enter the saved comparison calculation.
  assert.equal(strategyEstimates({...snapshot,scenario:{...scenario,completed:[l02,l06]}}).series[0].value,48380);
});

test('comparison handles zero, equality, worse, missing and invalid estimates honestly',()=>{
  const zero={...plan,initial_loss_inr:0,completed_saved_inr:0,planned_saved_inr:0,residual_loss_inr:0,tasks:[]};
  const e=strategyEstimates({...original,plan:zero,comparisons:[{...zero,strategy:'Zero'}]});
  assert.equal(e.maximum,0);assert.equal(e.percent,null);assert.equal(e.difference,0);
  assert.equal(strategyEstimates({...original,comparisons:[]}).best,null);
  assert.equal(strategyEstimates({...original,comparisons:undefined}).difference,null);
  assert.equal(strategyEstimates({...original,plan:{...plan,residual_loss_inr:NaN}}),null);
  const worse=strategyEstimates({...original,comparisons:[{...plan,strategy:'Better',planned_saved_inr:14000,residual_loss_inr:40230}]});
  assert.equal(worse.difference,-1130);assert(worse.percent<0);
  const html=renderToStaticMarkup(createElement(StrategyComparison,{current:{...original,comparisons:[]}}));
  assert.match(html,/Baseline comparison unavailable/);assert.doesNotMatch(html,/Infinity|NaN/);
  assert.match(html,/No additional protection/);assert.match(html,/accessible table/);
});

test('schedule uses real windows, named tools and a separate simulated completion status',()=>{
  const s={...scenario,deadline:35,completed:[l02]};
  const html=renderToStaticMarkup(createElement(CrewSchedule,{scenario:s,tasks:[l06,l02]}));
  assert.match(html,/Cutoff: minute 35/);assert.match(html,/Reported complete \(simulated\)/);
  assert.match(html,/Pending scheduled work/);assert.match(html,/0–12 min/);assert.match(html,/12–26 min/);
  assert(html.indexOf('<ol')<html.lastIndexOf('Crew:'));
  assert.match(html,/left:0%;width:34.285/);assert.match(html,/left:34.285/);
  assert.equal(computeLabel(undefined),null);assert.equal(computeLabel('aws'),'AWS Lambda');assert.equal(computeLabel('local'),'Local Python');
});

test('numeric drafts reject empty, fractional and out-of-range inputs before mutation',()=>{
  for (const [cutoff,clock] of [['','12'],['35',''],['12.5','12'],['35','12.5'],['11','12'],['231','12'],['35','11'],['35','36'],['35','1e1']]) {
    const result=validateScenarioTimes(cutoff,clock,12);
    assert.equal(result.values,null,`${cutoff}/${clock}`);
    assert(Object.keys(result.errors).length > 0);
  }
  const parsed=validateScenarioTimes('35','12',12);
  assert.equal(parsed.values.deadline,35); assert.equal(parsed.values.now_minute,12);
  assert.equal(validateScenarioTimes('0','0',0).values.deadline,0); // Explicit zero remains valid at event start.
});
test('view URLs are public allowlisted parameters and parse safely',()=>{
  for (const view of ['Plan & timeline','Material lots','Compare strategies','Activity']) assert.equal(viewFromQuery(viewHref(view).split('?')[1]),view);
  assert.equal(viewFromQuery('?view=invalid&token=private'),'Plan & timeline');
  assert.equal(viewHref('Material lots','L02 & paper'),'/?view=lots&q=L02+%26+paper');
  assert.equal(viewHref('Activity','secret'),'/?view=activity');
});
test('mobile lot identity and simulated status share a card; search retains details',()=>{
  const html=renderToStaticMarkup(createElement(LotInventory,{scenario:{...scenario,completed:[l02]},upcoming:[l06],filter:'L02',onFilter:()=>{}}));
  assert.match(html,/lot-card-heading"><h3>L02/); assert.match(html,/Reported complete \(simulated\)/);
  assert.match(html,/Lot details and handling/); assert.match(html,/Material value/); assert.doesNotMatch(html,/L06 ·/);
  const empty=renderToStaticMarkup(createElement(LotInventory,{scenario,upcoming:[],filter:'missing-lot',onFilter:()=>{}}));
  assert.match(empty,/role="status">No matching lots/);
});
test('zero-action explanation states only supported causes',()=>{
  const noCrew={...scenario,workers:scenario.workers.map(w=>({...w,enabled:false}))};
  assert.equal(zeroActionExplanation(noCrew),'No crew are available.');
  assert.match(zeroActionExplanation(scenario),/more specific cause is not provided/);
  const zero={...original,plan:{...plan,tasks:[]}};
  assert.equal(deriveWorkflow(state(zero,noCrew),[]).primaryLabel,'Change conditions');
});
test('approval belongs after assignments; historical snapshots have no mutation controls',()=>{
  const props={scenario,tasks:[l02],approved:false,busy:false,pending:null,onComplete:()=>{},feedback:()=>null};
  const html=renderToStaticMarkup(createElement(WorkInstructions,props,createElement('button',null,'Approve this draft')));
  assert(html.lastIndexOf('Approve this draft') > html.indexOf('</table>'));
  const historical=renderToStaticMarkup(createElement(HistoricalPlan,{saved:{...original,created:'2026-10-11T00:00:00Z',state:'superseded'}}));
  assert.match(historical,/Historical snapshot — not executable/); assert.match(historical,/planned at generation; later execution is not implied/);
  assert.doesNotMatch(historical,/<button|Record .* completion|Approve this/);
});
