'use client';

import {useEffect, useState, useSyncExternalStore} from 'react';
import type {SavedPlan, Task, Scenario} from '../lib/types';
import {DemoComparison} from './demo-comparison';
import {WorkInstructions} from './work-instructions';
import {CrewSchedule} from './crew-schedule';
import {StrategyComparison} from './strategy-comparison';
import {deriveWorkflow, money, computeLabel, strategyEstimates, validateScenarioTimes, viewFromQuery, viewHref, zeroActionExplanation, type View} from '../lib/workflow';
import {LotInventory} from './lot-inventory';
import {HistoricalPlan} from './historical-plan';
import {ScenarioEditor} from './scenario-editor';
import {apiFetch, cloudDemo} from '../lib/api';
import {canExecute, createAuthorityController, scopedFeedback, type Operation} from '../lib/authority';

const stamp = (v: string) => new Date(v).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'});
type Tab = View;
const tabs: Tab[] = ['Plan & timeline','Material lots','Compare strategies','Activity'];
const querySnapshot = () => window.location.search;
const serverQuery = () => '';
function subscribeNavigation(onChange: () => void) {
  const onBackForward = () => {onChange(); requestAnimationFrame(() => document.getElementById('page-title')?.focus());};
  window.addEventListener('popstate',onBackForward);
  window.addEventListener('drystock-navigation',onChange);
  return () => {window.removeEventListener('popstate',onBackForward); window.removeEventListener('drystock-navigation',onChange);};
}

function Icon({name}: {name: 'leaf' | 'rain' | 'arrow' | 'check'}) {
  const paths = {leaf: 'M20 4C10 3 3 8 5 16c2 6 11 5 14-3 1-3 1-6 1-9ZM4 21 15 10', rain: 'M6 15a5 5 0 0 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1 0 8M8 18l-1 3m6-3-1 3m6-3-1 3', arrow: 'M5 12h14m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6'};
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export default function Home() {
  const [controller] = useState(() => createAuthorityController(apiFetch));
  const authority = useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getServerSnapshot);
  const {data,pending} = authority;
  const query = useSyncExternalStore(subscribeNavigation,querySnapshot,serverQuery);
  const tab = viewFromQuery(query);
  const [error, setError] = useState('');
  const [editingInputs,setEditingInputs] = useState(false);
  type Draft = {base:string; deadline:string; elapsed:string; forklift:boolean; disabled:string[]};
  const [draft,setDraft] = useState<Draft | null>(null);
  const [errors,setErrors] = useState<{base:string; deadline?:string; elapsed?:string}>({base:''});
  const scenarioKey = data ? JSON.stringify(data.scenario) : '';
  const currentDraft: Draft = draft?.base === scenarioKey ? draft : {base:scenarioKey,
    deadline:String(data?.scenario.deadline ?? 60),elapsed:String(data?.scenario.now_minute ?? 0),
    forklift:data?.scenario.forklifts.every(f=>f.enabled) ?? true,
    disabled:data?.scenario.workers.filter(w=>!w.enabled).map(w=>w.id) || []};
  const {deadline,elapsed,forklift,disabled} = currentDraft;
  const fieldErrors: {deadline?:string; elapsed?:string} = errors.base === scenarioKey ? errors : {};
  const updateDraft = (update: Partial<Draft>) => setDraft({...currentDraft,...update});
  const setDeadline = (value:string) => updateDraft({deadline:value});
  const setElapsed = (value:string) => updateDraft({elapsed:value});
  const setForklift = (value:boolean) => updateDraft({forklift:value});
  const setDisabled = (value:string[]) => updateDraft({disabled:value});
  const setFieldErrors = (update: {deadline?:string; elapsed?:string}) => setErrors({base:scenarioKey,...update});
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const filter = new URLSearchParams(query).get('q') || '';
  const busy = pending !== null || authority.authority !== 'confirmed';
  const authorityReason = authority.authority === 'confirmed' ? undefined : authority.authority === 'checking'
    ? 'Checking current state. Cached assignments do not authorize approval or simulated reporting.'
    : 'Current state is not confirmed. Refresh state before approving or reporting simulated completion.';
  async function refresh() {if (await controller.refresh()) setError('');}
  useEffect(() => {
    controller.start();
    const onReturn = () => {if (document.visibilityState === 'visible') void controller.refresh(true);};
    const onVisibility = () => {if (document.visibilityState === 'hidden') controller.suspend(); else onReturn();};
    window.addEventListener('focus',onReturn); window.addEventListener('pageshow',onReturn);
    document.addEventListener('visibilitychange',onVisibility);
    return () => {
      controller.dispose(); window.removeEventListener('focus',onReturn); window.removeEventListener('pageshow',onReturn);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  }, [controller]);
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const r = await apiFetch('/api/plans', {cache: 'no-store'});
        if (!r.ok) throw new Error('Could not load plan history. Refresh state to retry.');
        const rows = await r.json();
        if (!cancelled) setHistory(rows);
      } catch (e) {if (!cancelled) setError((e as Error).message);}
    }
    void loadHistory();
    return () => {cancelled = true;};
  }, [tab, data?.revision, data?.latest?.id, data?.latest?.state]);

  async function mutate(scope: string, path: string, extra: object, success: string) {
    const kind: Operation['kind'] = path === '/api/plans' ? 'generate' : path.endsWith('/approve') ? 'approve'
      : path.endsWith('/complete') ? 'complete' : scope === 'scenario' || scope === 'inputs' ? 'scenario' : scope === 'reset' ? 'reset' : 'disruption';
    setError('');
    return controller.mutate({scope,path,extra,success,kind,planId:active?.id,lotId:scope.startsWith('complete-') ? scope.slice(9) : undefined});
  }
  const feedback = (scope: string) => {const f = scopedFeedback(authority,scope); return f ? <div className={`inline-feedback ${f.failed ? 'error' : 'notice'}`} role={f.failed ? 'alert' : 'status'}>{f.message}</div> : null;};
  function navigate(next: Tab, focusId = 'page-title') {
    const href = viewHref(next,next === 'Material lots' ? filter : '');
    if (window.location.pathname + window.location.search !== href) window.history.pushState(null,'',href);
    window.dispatchEvent(new Event('drystock-navigation'));
    window.scrollTo({top:0}); requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
  function changeFilter(value: string) {
    window.history.replaceState(null,'',viewHref('Material lots',value));
    window.dispatchEvent(new Event('drystock-navigation'));
  }
  function focusWork() {document.getElementById('work-instructions')?.focus();}
  async function resetYard() {
    navigate('Plan & timeline');
    if (await mutate('reset','/api/reset',{},'Sample yard restored. Simulated completed work cleared, default conditions restored and no active plan remains. Earlier plans are read-only history in Activity.')) setEditingInputs(false);
    window.scrollTo({top:0});
  }
  async function saveInputs(scenario: Scenario) {
    const saved = await mutate('inputs','/api/scenario',{scenario},'Your scenario inputs were validated and saved for this demo session. No active plan remains; generate a new draft.');
    if (saved) navigate('Plan & timeline');
    return saved;
  }
  function changeConditions() {
    const editor = document.getElementById('condition-editor') as HTMLDetailsElement | null;
    if (editor) {editor.open = true; editor.querySelector('summary')?.focus();}
  }
  function applyScenario() {
    if (!s) return;
    const parsed = validateScenarioTimes(deadline,elapsed,s.now_minute,240-s.safety_buffer_minutes);
    setFieldErrors(parsed.errors);
    if (!parsed.values) {document.getElementById(parsed.errors.deadline ? 'deadline' : 'elapsed')?.focus(); return;}
    void mutate('scenario','/api/disruptions',{...parsed.values,disabled_workers:disabled,forklift_enabled:forklift},'Scenario changes saved. Previous approval invalidated. Generate a new draft; completed protection is retained.');
  }

  const s = data?.scenario;
  const workflow = data ? deriveWorkflow(data, history) : null;
  const active = workflow?.active;
  const scheduledKg = s?.lots.filter(l => workflow?.upcoming.some(t => t.lot_id === l.id)).reduce((n,l) => n+l.weight_kg,0) || 0;
  const completedKg = s?.lots.filter(l => workflow?.completed.has(l.id)).reduce((n,l) => n+l.weight_kg,0) || 0;
  const exposedKg = workflow?.unprotected.reduce((n,l) => n+l.weight_kg,0) || 0;
  const generate = () => !editingInputs && void mutate('plan','/api/plans',{},'Draft generated and independently validated. Review the assignments, then approve.');
  const approve = async () => {
    const originalView = window.location.search;
    if (active?.state === 'draft' && await mutate('approval',`/api/plans/${active.id}/approve`,{},active.plan.tasks.length === 0 ? 'Zero-action decision approved. No additional simulated work is enabled.' : 'Manager approval recorded. You can now report simulated completion.') &&
      window.location.search === originalView && viewFromQuery(window.location.search) === 'Plan & timeline' && document.visibilityState === 'visible') focusWork();
  };
  const complete = (task: Task) => active && void mutate(`complete-${task.lot_id}`,`/api/plans/${active.id}/tasks/${task.lot_id}/complete`,{},`${task.lot_id} simulated completion recorded at minutes ${task.start}–${task.end}. Its protection resource is retained on replanning.`);
  const disruptionReason = !s?.completed.length ? 'Record a simulated completion first to demonstrate retained protection.'
    : s.now_minute > 35 ? 'The scenario clock has passed the demo cutoff of minute 35. Use Change conditions instead.'
    : s.deadline === 35 && !forklift ? 'Earlier rain and forklift loss have already been applied.' : '';
  const computeName = computeLabel(data?.compute_backend);
  const resultCompute = computeLabel(active?.execution?.execution_backend || active?.plan.execution_backend);
  const comparison = active ? strategyEstimates(active) : null;

  const work = s && workflow && (active || workflow.tasks.length > 0) ? <WorkInstructions scenario={s} tasks={workflow.tasks} approved={canExecute(authority)} reviewing={active?.state === 'draft'} authorityReason={authorityReason} busy={busy} pending={pending} onComplete={complete} feedback={feedback}>
    {active?.state === 'draft' && <div className="approval-actions" aria-busy={pending === 'approve'}><p id="approval-effect">{active.plan.tasks.length === 0 ? 'Records this zero-action decision.' : 'Enables simulated completion reporting.'} Does not confirm physical protection.</p><button className="primary" disabled={busy} aria-describedby="approval-effect" onClick={() => void approve()}>{pending === 'approve' ? 'Approving draft…' : active.plan.tasks.length === 0 ? 'Approve this zero-action draft' : 'Approve this draft'}</button></div>}
    {feedback('approval')}
  </WorkInstructions> : null;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="DryStock home"><span className="brand-icon"><Icon name="leaf"/></span><span className="brand-name">DryStock<span className="brand-dot">.</span></span></a>
      <div className="yard-label">OPERATIONS WORKSPACE</div>
      <nav aria-label="Workspace navigation">{tabs.map((t,i) => <a key={t} href={viewHref(t,t === 'Material lots' ? filter : '')} aria-label={t} aria-current={tab === t ? 'page' : undefined} className={`nav-item ${tab === t ? 'selected' : ''}`} onClick={e => {if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) {e.preventDefault(); navigate(t);}}}><span className="nav-symbol" aria-hidden="true">{['◫','▦','↗','◷'][i]}</span><span>{['Plan','Lots','Compare','Activity'][i]}</span></a>)}</nav>

    </aside>
    <main id="main-content" tabIndex={-1}>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">KEEP MATERIALS IN THE RECOVERY LOOP</div><h1 id="page-title" tabIndex={-1}>{tab === 'Plan & timeline' ? 'A plan before the rain.' : tab}</h1><p>{s?.name || 'Surat Paper Recovery Yard'}</p></div></div>
        <div className="scenario-meta"><span className="simulation-tag">{data?.input_source === 'custom' ? 'Your scenario · demo assumptions' : 'Fictional sample yard'}</span><details className="assumptions"><summary>Data &amp; assumptions</summary><p>{data?.input_source === 'custom' ? 'Inputs were entered by you for this demo session.' : 'Inputs come from the original fictional Surat sample fixture: 12 lots, crew, tarps, bays, handling options and weather.'} Monetary outcomes are calculated model estimates, not measured savings. Reported completion is simulated and does not verify physical protection. Planning time uses the saved scenario clock, not a live weather countdown.</p>{resultCompute ? <p>Current result computed with {resultCompute}.</p> : <p>Generate a plan to calculate a schedule and estimated results.</p>}{computeName && <p>Selected engine: {computeName}.</p>}{active?.execution?.runtime && <p>Python {active.execution.runtime.python} · OR-Tools {active.execution.runtime.ortools}<br/>Scenario fingerprint: {active.execution.scenario_sha256}<br/>{active.execution.runtime.aws_request_id && `AWS invocation: ${active.execution.runtime.aws_request_id}`}</p>}{active?.execution?.assumptions?.map(a=><p key={a}>{a}</p>)}</details></div>
        {error && <div className="alert error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh state</button></div>}
        {data && authorityReason && <div className="alert notice" role="status">{authorityReason}</div>}
        {pending === 'reset' && <div className="alert notice" role="status">Restoring the original sample yard and checking saved state…</div>}
        {authority.feedback && (!authority.feedback.context || ['reset','inputs'].includes(authority.feedback.scope)) && <div className={`alert ${authority.feedback.failed ? 'error' : 'notice'}`} role={authority.feedback.failed ? 'alert' : 'status'}>{authority.feedback.message}{authority.feedback.recovery && <button className="text-button" disabled={pending !== null || authority.authority === 'checking'} onClick={() => void refresh()}>Refresh state</button>}</div>}
        {!data && !error && <div className="empty" role="status">Loading yard and resource availability…</div>}
        {s && workflow && <>
          <section className="panel input-choice" aria-labelledby="input-choice-heading"><h2 id="input-choice-heading">Where should the inputs come from?</h2><p>Use the fictional sample for a quick demonstration, or enter your own demo assumptions. DryStock calculates which whole lots to protect within your time, crew and equipment limits.</p><div className="editor-actions"><button className="secondary" disabled={busy} onClick={()=>{void resetYard();}}>Use sample yard</button><button className="secondary" disabled={busy || s.completed.length>0} onClick={()=>{navigate('Plan & timeline');setEditingInputs(true);requestAnimationFrame(()=>document.getElementById('scenario-editor-title')?.focus());}}>Enter your own scenario</button></div><small>{s.completed.length>0 ? 'Reset demo yard to clear simulated work before replacing inputs.' : 'Save inputs before generating. Tarps and bays need compatible material codes and sufficient kg capacity.'} Demo sessions last four hours, with up to 20 plan generations and 300 requests; reload keeps this tab’s session.</small></section>
          {editingInputs && <ScenarioEditor key={`${data.scenario_epoch ?? data.revision}`} initial={s} startEmpty={data.input_source!=='custom'} busy={busy} onSave={saveInputs} onCancel={()=>setEditingInputs(false)} feedback={feedback('inputs')}/>}
          {tab !== 'Plan & timeline' && <div className="scenario-strip"><span>Fictional rain at minute {s.rain_arrival_minute} · {s.deadline-s.now_minute} min handling window · clock {s.now_minute}</span><strong>{authorityReason ? `Cached status: ${workflow.stateLabel} — not confirmed` : workflow.stateLabel}</strong><button className="secondary" onClick={() => {navigate('Plan & timeline',active ? 'work-instructions' : 'page-title'); if (active?.plan.tasks.length === 0) requestAnimationFrame(changeConditions);}}>{workflow.primaryLabel}</button></div>}
          {tab === 'Plan & timeline' && <>
            {!active && <section className="weather-banner" aria-label="Fictional weather"><div className="weather-icon"><Icon name="rain"/></div><div className="weather-text"><strong>{s.deadline-s.now_minute} minutes to finish protection</strong><span>Fictional rain at minute {s.rain_arrival_minute} · {s.safety_buffer_minutes}-minute buffer. Scenario clock: {s.now_minute}; handling cutoff: {s.deadline}. Saved scenario time, not a live countdown.</span></div></section>}
            <section className={`panel workflow-summary ${active?.state === 'approved' ? 'is-approved' : ''}`} aria-labelledby="review-heading" aria-busy={pending === 'generate' || pending === 'approve'}>
              <div className="panel-heading"><div><h2 id="review-heading">{authorityReason ? 'Cached plan — not confirmed' : active?.state === 'approved' ? 'Approved plan' : active ? 'Review the protection plan' : workflow.previous ? 'Re-optimise for changed conditions' : 'Protect what matters before rain'}</h2><p className="state-label">{authorityReason ? `Cached status: ${workflow.stateLabel}` : workflow.stateLabel}</p></div></div>
              {active ? <div className="plan-overview result-metrics">
                <div><span>Estimated loss remaining</span><strong>{money(workflow.residual)}</strong><small>After retained protection and the pending plan</small></div>
                <div><span>Additional estimated loss avoided</span><strong>{money(workflow.plannedBenefit)}</strong><small>Pending scheduled work only</small></div>
                <div><span>Scheduled actions</span><strong>{workflow.upcoming.length}<small>pending</small></strong><small>{s.completed.length} separately reported complete (simulated)</small></div>
                <div><span>Planning window remaining</span><strong>{Math.max(0,s.deadline-s.now_minute)}<small>minutes</small></strong><small>Saved clock {s.now_minute} · cutoff {s.deadline} · sample rain {s.rain_arrival_minute}. Not a live countdown.</small></div>
              </div>
                : <div className="risk-summary"><strong>{money(workflow.initialLoss)} estimated loss at risk before protection</strong><p>Choose lots to cover or move with {s.workers.filter(w=>w.enabled).length} available crew, {s.tarps.filter(t=>t.enabled).length} tarps, {s.storage.filter(b=>b.enabled).length} covered bays and {s.forklifts.filter(f=>f.enabled).length} forklift(s). Loss and effectiveness are fictional operator assumptions.</p></div>}
              {s.completed.length > 0 && <div className="completion-summary"><strong>{money(workflow.completedBenefit)} estimated benefit from operator-reported simulated completion</strong><p>{s.completed.length} reported complete: {s.completed.map(t=>`${t.lot_id} (${t.tarp_id || t.storage_id})`).join(', ')}. Retained protection, separate from pending work; not measured savings.</p></div>}
              {active && <p className="validation-strip"><Icon name="check"/>Independent validation passed{resultCompute ? ` · Computed with ${resultCompute}` : ' · Computation provenance unavailable'}.</p>}
              <div className="summary-actions"><button className="primary" disabled={busy || (editingInputs && !active)} onClick={active?.plan.tasks.length === 0 ? changeConditions : active ? focusWork : generate}>
                {pending === 'generate' ? 'Generating plan…' : workflow.primaryLabel}<Icon name="arrow"/>
              </button>{active && <button className="text-button" disabled={busy || editingInputs} onClick={generate}>{pending === 'generate' ? 'Generating new draft…' : 'Regenerate plan'}</button>}{active && <small>Regeneration replaces this plan and requires fresh approval.</small>}</div>
              {active?.state === 'draft' && active.plan.tasks.length > 0 && <p className="detail-copy">Review crew, equipment and timing in the assignments below before approving. Approval enables simulated reporting; it does not mean protection is complete.</p>}
              {active?.plan.tasks.length === 0 && <div className="zero-action detail-copy"><strong>Valid plan: no additional protection was scheduled.</strong><p>{zeroActionExplanation(s)} Existing operator-reported simulated protection is retained. Change conditions to consider more work. Approval only records the decision; it does not mean all materials are protected.</p></div>}
              {active?.state === 'approved' && active.plan.tasks.length > 0 && workflow.upcoming.length === 0 && <p className="detail-copy">All actions in this plan are reported complete. Regenerate to consider any remaining exposed lots.</p>}
              {comparison?.best && <p className="detail-copy compact-comparison">Generation snapshot vs {comparison.best.strategy}: {comparison.difference === 0 ? 'equal estimated residual loss' : `${money(Math.abs(comparison.difference!))} ${comparison.difference! > 0 ? 'less' : 'more'} estimated residual loss`}. <button className="text-button" onClick={()=>navigate('Compare strategies')}>Compare strategies</button></p>}
              {feedback('plan')}
            </section>
            {work}
            {workflow.previous && <DemoComparison scenario={s} current={active || null} before={workflow.previous}/>}
            <details className="panel scenario-controls" id="condition-editor" key={data.latest?.id || 'initial'}><summary>Change conditions</summary>
              <div className="demo-controls"><strong>Earlier rain + forklift loss</strong><p>After a simulated completion, shorten the cutoff to minute 35 and make the forklift unavailable.</p><button className="secondary" disabled={busy || Boolean(disruptionReason)} aria-describedby="disruption-reason" onClick={() => void mutate('disruption','/api/disruptions',{deadline:35,now_minute:s.now_minute,forklift_enabled:false,disabled_workers:disabled},'Earlier rain and forklift loss applied. Old approval invalidated; completed protection retained. Re-optimise next.')}>
                {pending === 'disruption' ? 'Applying disruption…' : 'Trigger demo disruption'}</button><p id="disruption-reason">{disruptionReason || 'Applying this disruption invalidates the current approval.'}</p>{feedback('disruption')}</div>
              <form noValidate onSubmit={e=>{e.preventDefault(); applyScenario();}}>
                <h3>Revise the scenario</h3><p>Times are minutes from the start of this fictional event. Saving invalidates existing approval; simulated completed work stays protected.</p>
                <div className="scenario-fields"><div className="field"><label htmlFor="deadline">Finish handling by minute</label><input id="deadline" type="number" step="1" min={s.now_minute} max={240-s.safety_buffer_minutes} required value={deadline} disabled={busy} aria-invalid={Boolean(fieldErrors.deadline)} aria-describedby="deadline-help deadline-error" onChange={e=>setDeadline(e.target.value)}/><small id="deadline-help">Whole minutes from {s.now_minute} to {240-s.safety_buffer_minutes}.</small><p id="deadline-error" className="field-error" role={fieldErrors.deadline ? 'alert' : undefined}>{fieldErrors.deadline}</p></div>
                  <div className="field"><label htmlFor="elapsed">Scenario clock (elapsed minutes)</label><input id="elapsed" type="number" step="1" min={s.now_minute} max={deadline || 240-s.safety_buffer_minutes} required value={elapsed} disabled={busy} aria-invalid={Boolean(fieldErrors.elapsed)} aria-describedby="elapsed-help elapsed-error" onChange={e=>setElapsed(e.target.value)}/><small id="elapsed-help">Whole minutes from {s.now_minute} to the cutoff; cannot move backwards.</small><p id="elapsed-error" className="field-error" role={fieldErrors.elapsed ? 'alert' : undefined}>{fieldErrors.elapsed}</p></div></div>
                <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={forklift} onChange={e=>setForklift(e.target.checked)}/>Forklift available</label>
                <fieldset><legend>Available workers</legend>{s.workers.map(w=><label className="checkbox-row" key={w.id}><input type="checkbox" disabled={busy} checked={!disabled.includes(w.id)} onChange={e=>setDisabled(e.target.checked ? disabled.filter(x=>x!==w.id) : [...disabled,w.id])}/>{w.name}</label>)}</fieldset>
                <button className="secondary" disabled={busy} type="submit">{pending === 'scenario' ? 'Saving scenario changes…' : 'Apply scenario changes'}</button><p className="micro-copy">Rain arrival follows the handling cutoff plus the {s.safety_buffer_minutes}-minute buffer.</p>{feedback('scenario')}
              </form>
            </details>
            {(active || workflow.tasks.length > 0) && <CrewSchedule scenario={s} tasks={workflow.tasks}/>}
            <div className="details-grid">
              <details className="panel"><summary>{active ? 'Lots left exposed' : 'Lots awaiting protection'} · {workflow.unprotected.length}</summary><p className="detail-copy">{active ? 'No action is planned for these lots under the current resource limits.' : 'Generate a plan to decide which lots to protect.'}</p><div className="exposed-list">{workflow.unprotected.map(l=><div key={l.id}><strong>{l.id} · {l.description}</strong><small>{l.weight_kg.toLocaleString('en-IN')} kg · {l.location}</small><span>{money(l.exposed_loss_inr)} assumed exposed loss</span></div>)}{!workflow.unprotected.length && <p>All eligible lots have a protection action.</p>}</div></details>
              <details className="panel resource-panel"><summary>Yard resources · {s.workers.filter(w=>w.enabled).length} available crew</summary><p className="detail-copy">Draft assets are reserved in the plan; operator-reported completed protection stays allocated through rain.</p><div className="crew-list">{s.workers.map(w=><div key={w.id}><strong>{w.name}</strong><span>{w.enabled ? w.skills.includes('forklift') ? 'Available · forklift operator' : 'Available · crew' : 'Unavailable'}</span></div>)}{s.forklifts.map(f=><div key={f.id}><strong>{f.name}</strong><span>{f.enabled ? 'Available' : 'Unavailable'}</span></div>)}</div>{[['Tarpaulins',s.tarps,'tarp_id'],['Covered bays',s.storage,'storage_id']].map(([label,resources,key])=><div className="asset-group" key={label as string}><h3>{label as string}</h3>{(resources as typeof s.tarps).map(r=>{const task=workflow.tasks.find(t=>t[key as 'tarp_id'|'storage_id']===r.id); return <div className="asset" key={r.id}><strong>{r.id} · {r.name}</strong><small>Up to {r.capacity_kg.toLocaleString('en-IN')} kg</small><span>{task ? `${task.lot_id} · ${workflow.completed.has(task.lot_id) ? 'reported complete (simulated)' : 'reserved for pending work'}` : r.enabled ? 'Free' : 'Unavailable'}</span></div>;})}</div>)}</details>
              <details className="panel"><summary>Material coverage · weight details</summary><div className="material-metrics"><p><strong>{scheduledKg.toLocaleString('en-IN')} kg</strong> pending additional protection</p><p><strong>{completedKg.toLocaleString('en-IN')} kg</strong> operator-reported complete (simulated)</p><p><strong>{exposedKg.toLocaleString('en-IN')} kg</strong> unscheduled exposed material</p><p>Scheduled weight is not measured waste prevented. Covered material may still suffer residual loss.</p></div></details>

            </div>
            <button className="secondary compare-link" onClick={()=>navigate('Compare strategies')}>Compare strategies</button>
          </>}
          {tab === 'Material lots' && <LotInventory scenario={s} upcoming={workflow.upcoming} filter={filter} onFilter={changeFilter}/>}
          {tab === 'Compare strategies' && <StrategyComparison current={active || null}/>}
          {tab === 'Activity' && <div className="activity-grid"><section className="panel"><div className="panel-heading"><div><h2>Operational audit trail</h2><p>{cloudDemo ? 'This temporary session persists in DynamoDB for four hours.' : 'Approvals, simulated completions and revisions persist in this local demonstration database.'}</p></div></div><div className="events">{data.events.length ? data.events.map(e=><div key={e.id}><strong>{e.kind.replaceAll('_',' ')}</strong><p>{e.detail}</p><small>{stamp(e.at)} IST</small></div>) : <div className="empty">No activity yet. Generate your first plan.</div>}</div></section><section className="panel"><div className="panel-heading"><h2>Plan history</h2><span className="subtle">Latest 30</span></div><div className="history-list">{history.map(p=><div key={p.id}><strong>Plan {p.id}</strong><span className="pill">{p.state}</span><small>{p.scenario_epoch === data.scenario_epoch ? 'Saved generation snapshot · current scenario' : 'Historical · previous scenario, not current results'}</small><p>{p.plan.tasks.length} actions · {money(p.plan.planned_saved_inr)} additional estimated benefit at generation</p><small>{stamp(p.created)} IST · {p.plan.solver_status}</small><HistoricalPlan saved={p}/></div>)}{!history.length && <div className="empty">No saved plans.</div>}</div></section></div>}
          <div className="yard-actions"><button className="text-button" disabled={busy} onClick={()=>void resetYard()}>{pending === 'reset' ? 'Resetting fictional yard…' : 'Reset demo yard'}</button><small>Restores sample inputs and default weather, clears simulated work and removes the active plan. History remains in Activity.</small></div>
        </>}
      </div>
    </main>
  </div>;
}
