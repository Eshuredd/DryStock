/* global AbortController, URL, setImmediate */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = fs.readFileSync(new URL('../lib/authority.ts',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,AbortController,Set,JSON});
const {createAuthorityController,canExecute,scopedFeedback} = exports;
const fixture = JSON.parse(fs.readFileSync(new URL('../../sample-data/surat-yard.json',import.meta.url),'utf8'));
const task = {lot_id:'L02',action:'cover',start:0,end:12,worker_ids:['W2','W3'],tarp_id:'T2',forklift_id:null,storage_id:null,saved_loss_inr:5850};
function yard(id='A',state='draft',revision=0,completed=[]) {
  return {revision,scenario:{...fixture,completed,now_minute:completed.length ? 12 : 0},latest:{id,state,revision,plan:{tasks:[task]}},events:[],compute_backend:'local'};
}
const response = (body,status=200) => ({ok:status>=200&&status<300,status,json:async()=>body});
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick = () => new Promise(resolve=>setImmediate(resolve));
const approve = {kind:'approve',scope:'approval',path:'/api/plans/A/approve',planId:'A',success:'Manager approval recorded.'};
const complete = {kind:'complete',scope:'complete-L02',path:'/api/plans/A/tasks/L02/complete',planId:'A',lotId:'L02',success:'L02 simulated completion recorded.'};

test('reset waits for authoritative state and removes completion execution authority',async()=>{
  const current={...yard('A','approved',1,[task]),scenario_epoch:0};
  const restored={...yard(),revision:2,latest:null,scenario_epoch:1,input_source:'sample'};
  const h=await setup(current,async()=>response(restored));
  const read=deferred();h.setGet(()=>read.promise);
  const result=h.controller.mutate({kind:'reset',scope:'reset',path:'/api/reset',success:'Sample restored; no active plan.'});
  await tick();assert.equal(canExecute(h.controller.getSnapshot()),false);
  read.resolve(response(restored));assert.equal(await result,true);
  const s=h.controller.getSnapshot();assert.equal(s.data.latest,null);assert.equal(s.data.scenario.completed.length,0);
  assert.match(scopedFeedback(s,'reset').message,/no active plan/);
});

test('reset success is not claimed when another client changes the acknowledged scenario',async()=>{
  const restored={...yard(),revision:1,latest:null};
  const h=await setup(yard(),async()=>response(restored));h.setCurrent(yard('B','draft',2));
  assert.equal(await h.controller.mutate({kind:'reset',scope:'reset',path:'/api/reset',success:'Sample restored.'}),false);
  assert.match(h.controller.getSnapshot().feedback.message,/Plan changed/);
});
async function setup(initial=yard(),post=async()=>response(yard('A','approved'))) {
  const calls=[];let current=initial,get=async()=>response(current);
  const controller=createAuthorityController(async(path,options={})=>{
    calls.push({path,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    return options.method==='POST' ? post(path,options) : get(path,options);
  });
  await controller.refresh();
  return {controller,calls,setCurrent:v=>{current=v;},setGet:f=>{get=f;}};
}

for (const revision of [0,1]) test(`late approval reconciles different plan IDs at ${revision===0?'the same':'a changed'} yard revision`,async()=>{
  const pending=deferred();const h=await setup(yard(),()=>pending.promise);
  const action=h.controller.mutate(approve);
  assert.equal(canExecute(h.controller.getSnapshot()),false);
  const replacement=yard('B','draft',revision);h.setCurrent(replacement);
  pending.resolve(response(yard('A','approved')));assert.equal(await action,false);
  const s=h.controller.getSnapshot();assert.equal(s.data.latest.id,'B');assert.equal(s.authority,'confirmed');
  assert.equal(canExecute(s),false);assert.match(s.feedback.message,/Plan changed/);
  assert.equal(scopedFeedback(s,'approval'),null);assert.equal(s.feedback.origin.planId,'A');assert.equal(s.feedback.origin.revision,0);
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('normal approval remains gated until authoritative GET completes',async()=>{
  const h=await setup();const read=deferred();h.setGet(()=>read.promise);
  const action=h.controller.mutate(approve);await tick();
  assert.equal(h.controller.getSnapshot().data.latest.state,'draft');assert.equal(canExecute(h.controller.getSnapshot()),false);
  read.resolve(response(yard('A','approved')));assert.equal(await action,true);
  assert.equal(canExecute(h.controller.getSnapshot()),true);assert.match(scopedFeedback(h.controller.getSnapshot(),'approval').message,/approval recorded/);
});

test('overlapping reads resolving out of order keep the newest accepted plan',async()=>{
  const h=await setup();const old=deferred(),fresh=deferred();let n=0;h.setGet(()=>++n===1?old.promise:fresh.promise);
  const first=h.controller.refresh(),second=h.controller.refresh();
  fresh.resolve(response(yard('B','draft',1)));assert.equal(await second,true);
  old.resolve(response(yard('A','approved')));assert.equal(await first,false);
  assert.equal(h.controller.getSnapshot().data.latest.id,'B');assert.equal(canExecute(h.controller.getSnapshot()),false);
});

for (const [revision,detail] of [[1,'Yard changed. Refresh and try again.'],[0,'Completion requires an approved, active plan']]) {
  test(`known ${revision?'revision':'plan-identity'} conflict immediately gates cached execution and recovers replacement`,async()=>{
    const rejection=deferred(),read=deferred();const h=await setup(yard('A','approved'),()=>rejection.promise);
    h.setGet(()=>read.promise);const action=h.controller.mutate(complete);
    assert.equal(canExecute(h.controller.getSnapshot()),false);
    rejection.resolve(response({detail},409));await tick();
    assert.equal(canExecute(h.controller.getSnapshot()),false);assert.equal(h.controller.getSnapshot().authority,'checking');
    read.resolve(response(yard('B','draft',revision)));assert.equal(await action,false);
    assert.equal(canExecute(h.controller.getSnapshot()),false);assert.match(h.controller.getSnapshot().feedback.message,/Action rejected/);
    assert.equal(h.controller.getSnapshot().feedback.recovery,false);assert.equal(scopedFeedback(h.controller.getSnapshot(),'complete-L02'),null);
    assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
  });
}

test('failed reconciliation retains disabled stale work; successful refresh replaces obsolete guidance',async()=>{
  const h=await setup(yard('A','approved'),async()=>response({detail:'Yard changed'},409));
  h.setGet(async()=>response({detail:'controlled read failure'},503));
  assert.equal(await h.controller.mutate(complete),false);
  assert.equal(h.controller.getSnapshot().authority,'uncertain');assert.equal(canExecute(h.controller.getSnapshot()),false);
  assert.equal(h.controller.getSnapshot().feedback.recovery,true);
  assert.equal(await h.controller.refresh(),false);assert.equal(h.controller.getSnapshot().feedback.recovery,true);
  h.setGet(async()=>response(yard('B','draft',1,[task])));assert.equal(await h.controller.refresh(),true);
  const s=h.controller.getSnapshot();assert.equal(s.feedback.recovery,false);assert.equal(s.feedback.failed,false);
  assert.doesNotMatch(s.feedback.message,/retry|could not|rejected/i);assert.equal(scopedFeedback(s,'complete-L02'),null);
  assert.equal(s.data.scenario.completed[0].lot_id,'L02');assert.equal(canExecute(s),false);
});

test('a lost approval acknowledgement reconciles committed authority without replay or invented response success',async()=>{
  const h=await setup(yard(),async()=>{h.setCurrent(yard('A','approved'));throw new Error('controlled lost response');});
  assert.equal(await h.controller.mutate(approve),false);
  const s=h.controller.getSnapshot();assert.equal(canExecute(s),true);assert.match(s.feedback.message,/response was lost.*confirms this plan is approved/);
  assert.doesNotMatch(s.feedback.message,/Manager approval recorded/);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('lost completion response retains confirmed simulated work without replay',async()=>{
  const h=await setup(yard('A','approved'),async()=>{h.setCurrent(yard('A','approved',1,[task]));throw new Error('controlled lost response');});
  await h.controller.mutate(complete);assert.match(h.controller.getSnapshot().feedback.message,/confirms L02 is reported complete \(simulated\)/);
  assert.equal(h.controller.getSnapshot().data.scenario.completed.length,1);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('normal completion binds feedback to its original operation and accepted new revision',async()=>{
  const completed=yard('A','approved',1,[task]);const h=await setup(yard('A','approved'),async()=>response(completed));h.setCurrent(completed);
  assert.equal(await h.controller.mutate(complete),true);const s=h.controller.getSnapshot();
  assert.equal(s.feedback.origin.revision,0);assert.equal(s.feedback.context.revision,1);
  assert.match(scopedFeedback(s,'complete-L02').message,/completion recorded/);assert.equal(canExecute(s),true);
  h.setCurrent(yard('B','draft',1,[task]));await h.controller.refresh(true);
  assert.equal(scopedFeedback(h.controller.getSnapshot(),'complete-L02'),null);assert.match(h.controller.getSnapshot().feedback.message,/Plan changed/);
});

test('double activation sends one mutation and an unmounted acknowledgement cannot update state',async()=>{
  const ack=deferred();const h=await setup(yard(),()=>ack.promise);
  const first=h.controller.mutate(approve);assert.equal(await h.controller.mutate(approve),false);
  h.controller.dispose();ack.resolve(response(yard('A','approved')));assert.equal(await first,false);
  assert.equal(h.controller.getSnapshot().data.latest.state,'draft');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('a previous mount read cannot replace the new mount state even when cancellation is ignored',async()=>{
  const h=await setup();const old=deferred();h.setGet(()=>old.promise);const first=h.controller.refresh();
  h.controller.dispose();h.setGet(async()=>response(yard('B','draft',1)));h.controller.start();await tick();
  old.resolve(response(yard('A','approved')));assert.equal(await first,false);assert.equal(h.controller.getSnapshot().data.latest.id,'B');
});

test('background return coalesces reads and suspension cannot strand an acknowledged mutation',async()=>{
  const h=await setup();const read=deferred();h.setGet(()=>read.promise);
  const action=h.controller.mutate(approve);await tick();h.controller.suspend();
  assert.equal(await h.controller.refresh(true),false);assert.equal(canExecute(h.controller.getSnapshot()),false);
  read.resolve(response(yard('A','approved')));assert.equal(await action,true);assert.equal(h.controller.getSnapshot().pending,null);
});

test('a gateway error after commit is ambiguous rather than a confirmed rejection',async()=>{
  const h=await setup(yard(),async()=>{h.setCurrent(yard('A','approved'));return response({detail:'controlled gateway error'},502);});
  assert.equal(await h.controller.mutate(approve),false);
  assert.equal(canExecute(h.controller.getSnapshot()),true);
  assert.match(h.controller.getSnapshot().feedback.message,/HTTP 502.*confirms this plan is approved/);
  assert.doesNotMatch(h.controller.getSnapshot().feedback.message,/Action rejected/);
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('permission rejection remains explicit and never shows approval success',async()=>{
  const h=await setup(yard(),async()=>response({detail:'permission denied'},403));
  assert.equal(await h.controller.mutate(approve),false);assert.equal(canExecute(h.controller.getSnapshot()),false);
  assert.match(h.controller.getSnapshot().feedback.message,/Action rejected: permission denied/);
});

test('approval acknowledgement identity must match its originating plan before success',async()=>{
  const h=await setup(yard(),async()=>response(yard('B','approved')));h.setCurrent(yard('A','approved'));
  assert.equal(await h.controller.mutate(approve),false);assert.match(h.controller.getSnapshot().feedback.message,/Plan changed/);
  assert.equal(scopedFeedback(h.controller.getSnapshot(),'approval'),null);
});

test('acknowledged approval with failed reconciliation cannot enable cached work or replay',async()=>{
  const h=await setup(yard(),async()=>response(yard('A','approved')));
  h.setGet(async()=>response({detail:'controlled read failure'},503));
  assert.equal(await h.controller.mutate(approve),false);
  assert.equal(h.controller.getSnapshot().authority,'uncertain');
  assert.equal(h.controller.getSnapshot().data.latest.state,'draft');
  assert.equal(canExecute(h.controller.getSnapshot()),false);
  assert.match(h.controller.getSnapshot().feedback.message,/acknowledged.*not confirmed/);
  assert.equal(scopedFeedback(h.controller.getSnapshot(),'approval'),null);
  h.setGet(async()=>response(yard('A','approved')));
  assert.equal(await h.controller.refresh(),true);
  assert.equal(canExecute(h.controller.getSnapshot()),true);
  assert.equal(h.controller.getSnapshot().feedback.message,'Current state checked.');
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('an older approved read cannot recover authority after the newest read fails',async()=>{
  const h=await setup(yard('A','approved'));const old=deferred(),fresh=deferred();let n=0;
  h.setGet(()=>++n===1?old.promise:fresh.promise);
  const first=h.controller.refresh(),second=h.controller.refresh();
  fresh.resolve(response({detail:'controlled read failure'},503));
  assert.equal(await second,false);
  old.resolve(response(yard('A','approved')));assert.equal(await first,false);
  assert.equal(h.controller.getSnapshot().authority,'uncertain');
  assert.equal(canExecute(h.controller.getSnapshot()),false);
  assert.equal(h.controller.getSnapshot().feedback.recovery,true);
});

test('lost zero-action approval acknowledgement does not imply available simulated work',async()=>{
  const draft=yard();draft.latest.plan.tasks=[];
  const approved=yard('A','approved');approved.latest.plan.tasks=[];
  const h=await setup(draft,async()=>{h.setCurrent(approved);throw new Error('controlled lost response');});
  assert.equal(await h.controller.mutate(approve),false);
  assert.match(h.controller.getSnapshot().feedback.message,/zero-action decision is approved; no additional work is enabled/);
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});
