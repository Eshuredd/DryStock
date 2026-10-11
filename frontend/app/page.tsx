'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {YardState, SavedPlan, Task} from '../lib/types';
import {DemoComparison} from './demo-comparison';
import {WorkInstructions} from './work-instructions';
import {StrategyComparison} from './strategy-comparison';
import {deriveWorkflow, money} from '../lib/workflow';
import {apiFetch, cloudDemo} from '../lib/api';

const stamp = (v: string) => new Date(v).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'});
type Tab = 'Plan & timeline' | 'Material lots' | 'Compare strategies' | 'Activity';
type Feedback = {scope: string; message: string; failed: boolean};
const tabs: Tab[] = ['Plan & timeline','Material lots','Compare strategies','Activity'];

function Icon({name}: {name: 'leaf' | 'rain' | 'arrow' | 'check'}) {
  const paths = {leaf: 'M20 4C10 3 3 8 5 16c2 6 11 5 14-3 1-3 1-6 1-9ZM4 21 15 10', rain: 'M6 15a5 5 0 0 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1 0 8M8 18l-1 3m6-3-1 3m6-3-1 3', arrow: 'M5 12h14m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6'};
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export default function Home() {
  const [data, setData] = useState<YardState | null>(null);
  const [tab, setTab] = useState<Tab>('Plan & timeline');
  const [pending, setPending] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Feedback | null>(null);
  const [deadline, setDeadline] = useState(60);
  const [elapsed, setElapsed] = useState(0);
  const [forklift, setForklift] = useState(true);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [filter, setFilter] = useState('');
  const busy = pending !== null;

  const sync = useCallback((state: YardState) => {
    setData(state); setDeadline(state.scenario.deadline); setElapsed(state.scenario.now_minute);
    setForklift(state.scenario.forklifts.every(f => f.enabled));
    setDisabled(state.scenario.workers.filter(w => !w.enabled).map(w => w.id));
  }, []);
  const refresh = useCallback(async () => {
    try {const r = await apiFetch('/api/state', {cache: 'no-store'}); if (!r.ok) throw new Error('Demo unavailable. Please retry or refresh state.'); sync(await r.json()); setError('');}
    catch (e) {setError((e as Error).message);}
  }, [sync]);
  useEffect(() => {void refresh();}, [refresh]);
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
    if (!data || mutationLock.current) return false;
    mutationLock.current = true; setPending(path === '/api/plans' ? 'generate' : path.endsWith('/approve') ? 'approve' : scope); setError(''); setResult(null);
    try {
      const r = await apiFetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: data.revision, ...extra})});
      const body = await r.json();
      if (!r.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'The action could not be saved. Refresh state and retry.');
      sync(body); setResult({scope, message: success, failed: false}); return true;
    } catch (e) {setResult({scope, message: `${e instanceof SyntaxError ? 'The server returned an unreadable response.' : (e as Error).message} Could not confirm success. Refresh state before retrying.`, failed: true}); return false;}
    finally {mutationLock.current = false; setPending(null);}
  }
  const feedback = (scope: string) => result?.scope === scope ? <div className={`inline-feedback ${result.failed ? 'error' : 'notice'}`} role={result.failed ? 'alert' : 'status'}>{result.message}{result.failed && <button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh state</button>}</div> : null;
  function navigate(next: Tab) {setTab(next); window.scrollTo({top:0});}
  function focusWork() {document.getElementById('work-instructions')?.focus();}

  const s = data?.scenario;
  const workflow = data ? deriveWorkflow(data, history) : null;
  const active = workflow?.active;
  const scheduledKg = s?.lots.filter(l => workflow?.upcoming.some(t => t.lot_id === l.id)).reduce((n,l) => n+l.weight_kg,0) || 0;
  const completedKg = s?.lots.filter(l => workflow?.completed.has(l.id)).reduce((n,l) => n+l.weight_kg,0) || 0;
  const exposedKg = workflow?.unprotected.reduce((n,l) => n+l.weight_kg,0) || 0;
  const generate = () => void mutate('plan','/api/plans',{},'Draft generated and independently validated. Review the assignments, then approve.');
  const approve = () => active && void mutate('plan',`/api/plans/${active.id}/approve`,{},'Manager approval recorded. You can now report simulated completion.');
  const complete = (task: Task) => active && void mutate(`complete-${task.lot_id}`,`/api/plans/${active.id}/tasks/${task.lot_id}/complete`,{},`${task.lot_id} simulated completion recorded at minutes ${task.start}–${task.end}. Its protection resource is retained on replanning.`);
  const disruptionReason = !s?.completed.length ? 'Record a simulated completion first to demonstrate retained protection.'
    : s.now_minute > 35 ? 'The scenario clock has passed the demo cutoff of minute 35. Use Change conditions instead.'
    : s.deadline === 35 && !forklift ? 'Earlier rain and forklift loss have already been applied.' : '';
  const computeName = data?.compute_backend === 'aws' ? 'AWS Lambda' : data?.compute_backend === 'sam' ? 'AWS SAM local API' : 'Local Python';
  const resultCompute = active?.execution?.execution_backend === 'aws' ? 'AWS Lambda' : active?.execution?.execution_backend === 'sam' ? 'AWS SAM local API' : 'Local Python';

  const work = s && workflow && workflow.tasks.length > 0 ? <WorkInstructions scenario={s} tasks={workflow.tasks} approved={active?.state === 'approved'} busy={busy} pending={pending} onComplete={complete} feedback={feedback}/> : null;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="DryStock home"><span className="brand-icon"><Icon name="leaf"/></span><span className="brand-name">DryStock<span className="brand-dot">.</span></span></a>
      <div className="yard-label">OPERATIONS WORKSPACE</div>
      <nav aria-label="Workspace navigation">{tabs.map((t,i) => <button key={t} aria-label={t} aria-current={tab === t ? 'page' : undefined} className={`nav-item ${tab === t ? 'selected' : ''}`} onClick={() => navigate(t)}><span className="nav-symbol" aria-hidden="true">{['◫','▦','↗','◷'][i]}</span><span>{['Plan','Lots','Compare','Activity'][i]}</span></button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot"/>{cloudDemo ? 'AWS-hosted demonstration' : 'Local demonstration'}<p>Bharat Builds Environmental Hacks<br/>Waste & Energy track</p><p>Yard manager · Demo operator<br/>No sign-in</p></div>
    </aside>
    <main id="main-content" tabIndex={-1}>
      <header className="topbar"><span>Workspace / Protection planning</span><span className="simulation-tag">FICTIONAL SCENARIO</span></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">KEEP MATERIALS IN THE RECOVERY LOOP</div><h1>{tab === 'Plan & timeline' ? 'A plan before the rain.' : tab}</h1><p>{s?.name || 'Surat Paper Recovery Yard'}</p></div></div>
        {error && <div className="alert error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh state</button></div>}
        {!data && !error && <div className="empty" role="status">Loading yard and resource availability…</div>}
        {s && workflow && <>
          {tab !== 'Plan & timeline' && <div className="scenario-strip"><span>Fictional rain at minute {s.rain_arrival_minute} · {s.deadline-s.now_minute} min handling window · clock {s.now_minute}</span><strong>{workflow.stateLabel}</strong><button className="secondary" onClick={() => {navigate('Plan & timeline'); if (active?.state === 'approved') requestAnimationFrame(focusWork);}}>{workflow.primaryLabel}</button></div>}
          {tab === 'Plan & timeline' && <>
            <section className="weather-banner" aria-label="Fictional weather"><div className="weather-icon"><Icon name="rain"/></div><div className="weather-text"><strong>{s.deadline-s.now_minute} minutes to finish protection</strong><span>Fictional rain at minute {s.rain_arrival_minute} · {s.safety_buffer_minutes}-minute buffer. Scenario clock: {s.now_minute}; handling cutoff: {s.deadline}.</span></div></section>
            <section className={`panel workflow-summary ${active?.state === 'approved' ? 'is-approved' : ''}`} aria-labelledby="review-heading" aria-busy={pending === 'generate' || pending === 'approve'}>
              <div className="panel-heading"><div><h2 id="review-heading">{active?.state === 'approved' ? 'Approved plan' : active ? 'Review the protection plan' : workflow.previous ? 'Re-optimise for changed conditions' : 'Protect what matters before rain'}</h2><p className="state-label">{workflow.stateLabel}</p></div></div>
              {active ? <div className="plan-overview"><div><span>Pending planned estimated benefit</span><strong>{money(workflow.plannedBenefit)}</strong><small>{workflow.upcoming.length} additional actions · pending simulated execution</small></div><div><span>Estimated residual loss</span><strong>{money(workflow.residual)}</strong><small>Includes partial protection effectiveness</small></div></div>
                : <div className="risk-summary"><strong>{money(workflow.initialLoss)} estimated loss at risk before protection</strong><p>Choose lots to cover or move with {s.workers.filter(w=>w.enabled).length} available crew, {s.tarps.filter(t=>t.enabled).length} tarps, {s.storage.filter(b=>b.enabled).length} covered bays and {s.forklifts.filter(f=>f.enabled).length} forklift(s). Loss and effectiveness are fictional operator assumptions.</p></div>}
              {s.completed.length > 0 && <div className="completion-summary"><strong>{money(workflow.completedBenefit)} estimated benefit from operator-reported simulated completion</strong><p>{s.completed.length} reported complete: {s.completed.map(t=>`${t.lot_id} (${t.tarp_id || t.storage_id})`).join(', ')}. Retained protection, separate from pending work; not measured savings.</p></div>}
              {active && <p className="validation-strip"><Icon name="check"/>Independent validation passed · Computed with {resultCompute}. Fictional inputs; actual computation.</p>}
              <div className="summary-actions"><button className="primary" disabled={busy} onClick={active?.state === 'draft' ? approve : active?.state === 'approved' ? focusWork : generate}>
                {pending === 'approve' ? 'Approving plan…' : pending === 'generate' ? 'Generating plan…' : workflow.primaryLabel}<Icon name={active?.state === 'draft' ? 'check' : 'arrow'}/>
              </button>{active && <button className="text-button" disabled={busy} onClick={generate}>{pending === 'generate' ? 'Generating new draft…' : 'Regenerate plan'}</button>}{active && <small>Regeneration replaces this plan and requires fresh approval.</small>}</div>
              {active?.state === 'draft' && <p className="detail-copy">Review crew, equipment and timing in the assignments below before approving. Approval enables simulated reporting; it does not mean protection is complete.</p>}
              {active?.state === 'approved' && workflow.upcoming.length === 0 && <p className="detail-copy">All actions in this plan are reported complete. Regenerate to consider any remaining exposed lots.</p>}
              {feedback('plan')}
            </section>
            {active?.state === 'approved' && work}
            {workflow.previous && <DemoComparison scenario={s} current={active || null} before={workflow.previous}/>}
            <details className="panel scenario-controls" key={data.latest?.id || 'initial'}><summary>Change conditions</summary>
              <div className="demo-controls"><strong>Earlier rain + forklift loss</strong><p>After a simulated completion, shorten the cutoff to minute 35 and make the forklift unavailable.</p><button className="secondary" disabled={busy || Boolean(disruptionReason)} aria-describedby="disruption-reason" onClick={() => void mutate('disruption','/api/disruptions',{deadline:35,now_minute:s.now_minute,forklift_enabled:false,disabled_workers:disabled},'Earlier rain and forklift loss applied. Old approval invalidated; completed protection retained. Re-optimise next.')}>
                {pending === 'disruption' ? 'Applying disruption…' : 'Trigger demo disruption'}</button><p id="disruption-reason">{disruptionReason || 'Applying this disruption invalidates the current approval.'}</p>{feedback('disruption')}</div>
              <form onSubmit={e=>{e.preventDefault(); void mutate('scenario','/api/disruptions',{deadline,now_minute:elapsed,disabled_workers:disabled,forklift_enabled:forklift},'Scenario changes saved. Previous approval invalidated. Generate a new draft; completed protection is retained.');}}>
                <h3>Revise the scenario</h3><p>Times are minutes from the start of this fictional event. Saving invalidates existing approval; simulated completed work stays protected.</p>
                <div className="scenario-fields"><div className="field"><label htmlFor="deadline">Finish handling by minute</label><input id="deadline" type="number" min={s.now_minute} max="230" required value={deadline} disabled={busy} onChange={e=>setDeadline(Number(e.target.value))}/></div>
                  <div className="field"><label htmlFor="elapsed">Scenario clock (elapsed minutes)</label><input id="elapsed" type="number" min={s.now_minute} max={deadline} required value={elapsed} disabled={busy} onChange={e=>setElapsed(Number(e.target.value))}/><small>Cannot move before minute {s.now_minute}.</small></div></div>
                <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={forklift} onChange={e=>setForklift(e.target.checked)}/>Forklift available</label>
                <fieldset><legend>Available workers</legend>{s.workers.map(w=><label className="checkbox-row" key={w.id}><input type="checkbox" disabled={busy} checked={!disabled.includes(w.id)} onChange={e=>setDisabled(e.target.checked ? disabled.filter(x=>x!==w.id) : [...disabled,w.id])}/>{w.name}</label>)}</fieldset>
                <button className="secondary" disabled={busy} type="submit">{pending === 'scenario' ? 'Saving scenario changes…' : 'Apply scenario changes'}</button><p className="micro-copy">Rain arrival follows the handling cutoff plus the {s.safety_buffer_minutes}-minute buffer.</p>{feedback('scenario')}
              </form>
            </details>
            {active?.state !== 'approved' && work}
            {workflow.tasks.length > 0 && <details className="panel schedule-panel"><summary>Protection timeline · crew and equipment</summary><p className="detail-copy">Grey tasks are operator-reported simulated completions. Work instructions provide the full textual assignments.</p>
              <div className="timeline"><div className="timeline-scale"><span>0 min</span><span>{Math.round(s.deadline/2)} min</span><span>{s.deadline} min cutoff</span></div>{[...s.workers.map(w=>({id:w.id,name:w.name,enabled:w.enabled,crew:true})),...s.forklifts.map(f=>({...f,crew:false}))].map(resource=><div className="timeline-row" key={resource.id}><div className="timeline-name"><strong>{resource.name}</strong><small>{resource.enabled ? resource.crew ? 'Crew' : 'Equipment' : 'Unavailable'}</small></div><div className="timeline-track">{workflow.tasks.filter(t=>resource.crew ? t.worker_ids.includes(resource.id) : t.forklift_id === resource.id).map(t=><div key={t.lot_id} className={`timeline-task ${t.action} ${workflow.completed.has(t.lot_id) ? 'done' : ''}`} style={{left:`${t.start/Math.max(s.deadline,1)*100}%`,width:`${(t.end-t.start)/Math.max(s.deadline,1)*100}%`}} title={`${t.lot_id}: ${t.action === 'cover' ? 'Cover' : 'Move'}, minutes ${t.start}–${t.end}${workflow.completed.has(t.lot_id) ? ', reported complete (simulated)' : ', pending'}`}>{t.lot_id}<span>{t.action === 'cover' ? 'Cover' : 'Move'}</span></div>)}</div></div>)}</div>
              <div className="legend"><span><i className="legend-cover"/>Cover</span><span><i className="legend-move"/>Move</span><span><i className="legend-done"/>Simulated completion</span></div>
            </details>}
            <div className="details-grid">
              <details className="panel"><summary>{active ? 'Lots left exposed' : 'Lots awaiting protection'} · {workflow.unprotected.length}</summary><p className="detail-copy">{active ? 'No action is planned for these lots under the current resource limits.' : 'Generate a plan to decide which lots to protect.'}</p><div className="exposed-list">{workflow.unprotected.map(l=><div key={l.id}><strong>{l.id} · {l.description}</strong><small>{l.weight_kg.toLocaleString('en-IN')} kg · {l.location}</small><span>{money(l.exposed_loss_inr)} assumed exposed loss</span></div>)}{!workflow.unprotected.length && <p>All eligible lots have a protection action.</p>}</div></details>
              <details className="panel resource-panel"><summary>Yard resources · {s.workers.filter(w=>w.enabled).length} available crew</summary><p className="detail-copy">Draft assets are reserved in the plan; operator-reported completed protection stays allocated through rain.</p><div className="crew-list">{s.workers.map(w=><div key={w.id}><strong>{w.name}</strong><span>{w.enabled ? w.skills.includes('forklift') ? 'Available · forklift operator' : 'Available · crew' : 'Unavailable'}</span></div>)}{s.forklifts.map(f=><div key={f.id}><strong>{f.name}</strong><span>{f.enabled ? 'Available' : 'Unavailable'}</span></div>)}</div>{[['Tarpaulins',s.tarps,'tarp_id'],['Covered bays',s.storage,'storage_id']].map(([label,resources,key])=><div className="asset-group" key={label as string}><h3>{label as string}</h3>{(resources as typeof s.tarps).map(r=>{const task=workflow.tasks.find(t=>t[key as 'tarp_id'|'storage_id']===r.id); return <div className="asset" key={r.id}><strong>{r.id} · {r.name}</strong><small>Up to {r.capacity_kg.toLocaleString('en-IN')} kg</small><span>{task ? `${task.lot_id} · ${workflow.completed.has(task.lot_id) ? 'reported complete (simulated)' : 'reserved for pending work'}` : r.enabled ? 'Free' : 'Unavailable'}</span></div>;})}</div>)}</details>
              <details className="panel"><summary>Material coverage · weight details</summary><div className="material-metrics"><p><strong>{scheduledKg.toLocaleString('en-IN')} kg</strong> pending additional protection</p><p><strong>{completedKg.toLocaleString('en-IN')} kg</strong> operator-reported complete (simulated)</p><p><strong>{exposedKg.toLocaleString('en-IN')} kg</strong> unscheduled exposed material</p><p>Scheduled weight is not measured waste prevented. Covered material may still suffer residual loss.</p></div></details>
              <details className="panel execution-evidence"><summary>Computation evidence · {active ? resultCompute : computeName}</summary><div className="detail-copy"><p>Fictional inputs are separate from actual computation. Selected compute: {computeName}.</p><p>{active ? `Current result: ${resultCompute}; independently validated before saving.` : 'No active result. Compute failures do not save a new plan.'}</p>{active?.execution?.runtime && <p>Python {active.execution.runtime.python} · OR-Tools {active.execution.runtime.ortools}<br/>Scenario fingerprint: {active.execution.scenario_sha256}<br/>{active.execution.runtime.aws_request_id && `AWS invocation: ${active.execution.runtime.aws_request_id}`}</p>}{active?.execution?.assumptions?.map(a=><p key={a}>{a}</p>)}</div></details>
            </div>
            <button className="secondary compare-link" onClick={()=>navigate('Compare strategies')}>Compare strategies</button>
          </>}
          {tab === 'Material lots' && <section className="panel"><div className="panel-heading inventory-heading"><div><h2>Material inventory</h2><p>{s.lots.length} fictional lots. Values, vulnerability (1 low–5 high) and loss estimates are operator assumptions.</p></div><label className="search-label">Find a lot<input placeholder="ID, material or location" value={filter} onChange={e=>setFilter(e.target.value)}/></label></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Material inventory, scroll horizontally for all columns"><table><thead><tr><th>Lot / material</th><th>Weight / location</th><th>Exposure</th><th>Value / assumed loss</th><th>Allowed handling</th><th>Protection</th></tr></thead><tbody>{s.lots.filter(l=>`${l.id} ${l.description} ${l.location}`.toLowerCase().includes(filter.toLowerCase())).map(l=><tr key={l.id}><td><strong>{l.id} · {l.description}</strong><span className="cell-sub">{l.condition}</span></td><td>{l.weight_kg.toLocaleString('en-IN')} kg<span className="cell-sub">{l.location}</span></td><td><span className={`pill ${l.exposure === 'high' ? 'warning' : ''}`}>{l.exposure}</span><span className="cell-sub">Vulnerability {l.vulnerability}/5</span></td><td>{money(l.value_inr)}<span className="cell-sub">{money(l.exposed_loss_inr)} assumed loss</span></td><td>{l.actions.map(a=><span className="action-option" key={a.kind}>{a.kind === 'cover' ? 'Cover with tarp' : 'Move to bay'} · {a.duration} min · {a.workers} crew{a.forklift ? ' + forklift' : ''}<small>{a.effectiveness_bps/100}% assumed effectiveness{a.required_skills.length ? ` · ${a.required_skills.map(skill=>skill.replaceAll('_',' ')).join(', ')}` : ''}</small></span>)}{l.restrictions.map(r=><span className="cell-sub" key={r}>{r}</span>)}{!l.actions.length && 'No action needed'}</td><td><span className={`pill ${workflow.completed.has(l.id) || l.protection_status === 'already_protected' ? 'success' : ''}`}>{workflow.completed.has(l.id) ? 'Reported complete (simulated)' : l.protection_status === 'already_protected' ? 'Sheltered in fixture' : workflow.upcoming.some(t=>t.lot_id===l.id) ? 'Planned — pending' : 'Exposed'}</span></td></tr>)}</tbody></table>{!s.lots.some(l=>`${l.id} ${l.description} ${l.location}`.toLowerCase().includes(filter.toLowerCase())) && <p className="detail-copy" role="status">No matching lots. Try another ID, material or location.</p>}</div></section>}
          {tab === 'Compare strategies' && <StrategyComparison current={active || null}/>}
          {tab === 'Activity' && <div className="activity-grid"><section className="panel"><div className="panel-heading"><div><h2>Operational audit trail</h2><p>{cloudDemo ? 'This temporary session persists in DynamoDB for four hours.' : 'Approvals, simulated completions and revisions persist in this local demonstration database.'}</p></div></div><div className="events">{data.events.length ? data.events.map(e=><div key={e.id}><strong>{e.kind.replaceAll('_',' ')}</strong><p>{e.detail}</p><small>{stamp(e.at)} IST</small></div>) : <div className="empty">No activity yet. Generate your first plan.</div>}</div></section><section className="panel"><div className="panel-heading"><h2>Plan history</h2><span className="subtle">Latest 30</span></div><div className="history-list">{history.map(p=><div key={p.id}><strong>Plan {p.id}</strong><span className="pill">{p.state}</span><p>{p.plan.tasks.length} actions · {money(p.plan.planned_saved_inr)} additional estimated benefit at generation</p><small>{stamp(p.created)} IST · {p.plan.solver_status}</small></div>)}{!history.length && <div className="empty">No saved plans.</div>}</div></section></div>}
          <footer><span>DryStock / Weather-aware protection planning<br/><small>Fictional data. Estimated outcomes, not scientifically validated measurements. {cloudDemo ? 'Temporary isolated demo session; not production authentication.' : 'Local demonstration; no authentication.'}</small></span><div><button className="text-button" disabled={busy} onClick={()=>{if (window.confirm('Reset this fictional yard and completion state? Audit history will be retained.')) void mutate('reset','/api/reset',{},'Demo yard reset. Audit history retained.');}}>{pending === 'reset' ? 'Resetting fictional yard…' : 'Reset demo yard'}</button>{feedback('reset')}</div></footer>
        </>}
      </div>
    </main>
  </div>;
}
