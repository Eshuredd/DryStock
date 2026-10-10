'use client';

import {useCallback, useEffect, useState} from 'react';
import type {YardState, SavedPlan, Task} from '../lib/types';

const money = (v: number) => new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0}).format(v);
const stamp = (v: string) => new Date(v).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'});
type Tab = 'Plan & timeline' | 'Material lots' | 'Compare strategies' | 'Activity';

function Icon({name}: {name: 'leaf' | 'rain' | 'arrow' | 'check' | 'clock'}) {
  const paths = {leaf: 'M20 4C10 3 3 8 5 16c2 6 11 5 14-3 1-3 1-6 1-9ZM4 21 15 10', rain: 'M6 15a5 5 0 0 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1 0 8M8 18l-1 3m6-3-1 3m6-3-1 3', arrow: 'M5 12h14m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6', clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'};
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export default function Home() {
  const [data, setData] = useState<YardState | null>(null);
  const [tab, setTab] = useState<Tab>('Plan & timeline');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deadline, setDeadline] = useState(60);
  const [elapsed, setElapsed] = useState(0);
  const [forklift, setForklift] = useState(true);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [filter, setFilter] = useState('');

  const sync = useCallback((state: YardState) => {
    setData(state); setDeadline(state.scenario.deadline); setElapsed(state.scenario.now_minute);
    setForklift(state.scenario.forklifts.every(f => f.enabled));
    setDisabled(state.scenario.workers.filter(w => !w.enabled).map(w => w.id));
  }, []);
  const refresh = useCallback(async () => {
    try {const r = await fetch('/api/state', {cache: 'no-store'}); if (!r.ok) throw new Error('Backend unavailable. Start FastAPI on port 8000.'); sync(await r.json()); setError('');}
    catch (e) {setError((e as Error).message);}
  }, [sync]);
  useEffect(() => {void refresh();}, [refresh]);
  useEffect(() => {
    if (tab !== 'Activity') return;
    let cancelled = false;
    async function loadHistory() {
      try {
        const r = await fetch('/api/plans', {cache: 'no-store'});
        if (!r.ok) throw new Error('Could not load plan history');
        const rows = await r.json();
        if (!cancelled) setHistory(rows);
      } catch (e) {if (!cancelled) setError((e as Error).message);}
    }
    void loadHistory();
    return () => {cancelled = true;};
  }, [tab, data?.revision, data?.latest?.id, data?.latest?.state]);

  async function mutate(path: string, extra: object = {}, success = '') {
    if (!data || busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: data.revision, ...extra})});
      const result = await r.json();
      if (!r.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
      sync(result); setNotice(success); return true;
    } catch (e) {setError((e as Error).message); return false;}
    finally {setBusy(false);}
  }
  async function disrupt() {
    await mutate('/api/disruptions', {deadline, now_minute: elapsed, disabled_workers: disabled, forklift_enabled: forklift}, 'Scenario updated. Generate a new plan and obtain manager approval.');
  }

  const s = data?.scenario;
  const latest = data?.latest;
  const active = latest && latest.state !== 'superseded' ? latest : null;
  const completed = new Set(s?.completed.map(t => t.lot_id));
  const upcoming = active?.plan.tasks.filter(t => !completed.has(t.lot_id)) || [];
  const initialLoss = s?.lots.filter(l => l.protection_status === 'exposed').reduce((n,l) => n+l.exposed_loss_inr, 0) || 0;
  const savedCompleted = s?.completed.reduce((n,t) => n+t.saved_loss_inr, 0) || 0;
  const savedPlanned = upcoming.reduce((n,t) => n+t.saved_loss_inr, 0);
  const residual = initialLoss-savedCompleted-savedPlanned;
  const totalTasks = (s?.completed.length || 0) + upcoming.length;
  const viewTasks = [...(s?.completed || []), ...upcoming].sort((a,b) => a.start-b.start || a.lot_id.localeCompare(b.lot_id));
  const unprotected = s?.lots.filter(l => l.protection_status === 'exposed' && !completed.has(l.id) && !upcoming.some(t => t.lot_id === l.id)) || [];
  const resourceLabel = (t: Task) => [t.forklift_id, t.tarp_id, t.storage_id].filter(Boolean).join(' · ');

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="DryStock home"><span className="brand-icon"><Icon name="leaf"/></span>DryStock<span className="brand-dot">.</span></a>
      <div className="yard-label">OPERATIONS WORKSPACE</div>
      <nav aria-label="Workspace navigation">{(['Plan & timeline','Material lots','Compare strategies','Activity'] as Tab[]).map((t, i) => <button key={t} aria-label={t} aria-current={tab === t ? 'page' : undefined} title={t} className={`nav-item ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}><span className="nav-symbol">{['◫','▦','↗','◷'][i]}</span>{t}{t === 'Plan & timeline' && <span className="nav-count">{totalTasks}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot"/>Local demonstration<p>Bharat Builds Environmental Hacks<br/>Waste & Energy track</p><div className="avatar-row"><span className="avatar">YM</span><div>Yard manager<small>Demo operator · no sign-in</small></div></div></div>
    </aside>

    <main>
      <header className="topbar"><div><span className="breadcrumb">Workspace / </span>Protection planning</div><span className="simulation-tag">SIMULATED DATA</span></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">KEEP MATERIALS IN THE RECOVERY LOOP</div><h1>{tab === 'Plan & timeline' ? 'A plan before the rain.' : tab}</h1><p>{s?.name || 'Surat Paper Recovery Yard'} <span className="muted">/ One yard. One approaching weather event.</span></p></div><button className="primary" disabled={busy || !data} onClick={() => void mutate('/api/plans', {}, 'New draft generated and independently validated.')}><span>{busy ? 'Working…' : active ? 'Regenerate plan' : 'Generate plan'}</span><Icon name="arrow"/></button></div>
        {error && <div className="alert error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Refresh state</button></div>}
        {notice && <div className="alert notice" role="status">{notice}</div>}
        {!data && !error && <div className="empty">Loading yard and resource availability…</div>}
        {s && <>
          <section className="weather-banner" aria-label="Simulated weather"><div className="weather-icon"><Icon name="rain"/></div><div className="weather-text"><strong>Heavy rain is approaching</strong><span>Simulated forecast · rainfall at minute {s.rain_arrival_minute} · {s.safety_buffer_minutes}-minute handling buffer</span></div><div className="deadline-display"><span>HANDLING WINDOW LEFT</span><strong>{s.deadline-s.now_minute}<small> min</small></strong></div><div className="weather-cutoff"><Icon name="clock"/><span>Cutoff at minute {s.deadline}<small>Scenario clock: {s.now_minute} min</small></span></div></section>
          <div className="stats-grid">
            <section className="stat-card"><span>Estimated loss if exposed</span><strong>{money(initialLoss)}</strong><small>Operator assumptions · before protection</small></section>
            <section className="stat-card green"><span>Additional loss avoided by plan</span><strong>{money(savedPlanned)}</strong><small>{upcoming.length} scheduled actions · pending execution</small></section>
            <section className="stat-card"><span>Completed protection benefit</span><strong>{money(savedCompleted)}</strong><small>{s.completed.length} actions recorded complete</small></section>
            <section className="stat-card"><span>Estimated residual loss after plan</span><strong>{money(residual)}</strong><small>Includes partial effectiveness of tarps</small></section>
          </div>

          {tab === 'Plan & timeline' && <div className="planning-grid"><div className="plan-main">
            <section className="panel"><div className="panel-heading"><div><h2>Protection schedule</h2><p>Specific crews. Shared equipment. A feasible handling window.</p></div><span className={`pill ${active?.state === 'approved' ? 'success' : ''}`}>{active ? active.state === 'approved' ? 'Manager approved' : 'Awaiting approval' : 'No active plan'}</span></div>
              {active && <div className="validation-strip"><span><Icon name="check"/>Independent validation passed</span><span>{active.plan.solver_status} · {active.plan.solve_seconds.toFixed(2)}s</span></div>}
              {!active && <div className="empty"><span className="empty-icon">◫</span><h3>{latest?.state === 'superseded' ? 'The yard has changed.' : 'Ready when you are.'}</h3><p>Generate a draft to allocate the available crews, tarps and covered bays before the cutoff.</p><button className="secondary" disabled={busy} onClick={() => void mutate('/api/plans')}>Generate protection plan</button></div>}
              {viewTasks.length > 0 && <><div className="timeline"><div className="timeline-scale"><span>0 min</span><span>{Math.round(s.deadline/2)} min</span><span>{s.deadline} min · cutoff</span></div>{s.workers.map(w => <div className="timeline-row" key={w.id}><div className="timeline-name"><strong>{w.name}</strong><small>{w.enabled ? w.skills.includes('forklift') ? 'Forklift operator' : 'Yard crew' : 'Unavailable'}</small></div><div className="timeline-track">{viewTasks.filter(t => t.worker_ids.includes(w.id)).map(t => <div key={t.lot_id} className={`timeline-task ${t.action} ${completed.has(t.lot_id) ? 'done' : ''}`} style={{left: `${t.start/Math.max(s.deadline,1)*100}%`, width: `${(t.end-t.start)/Math.max(s.deadline,1)*100}%`}} title={`${t.lot_id} ${t.action}: minutes ${t.start}–${t.end}${completed.has(t.lot_id) ? ' (completed)' : ''}`}>{t.lot_id}<span>{t.action === 'cover' ? 'Cover' : 'Move'}</span></div>)}</div></div>)}{s.forklifts.map(f => <div className="timeline-row" key={f.id}><div className="timeline-name"><strong>{f.name}</strong><small>{f.enabled ? 'Shared equipment' : 'Unavailable'}</small></div><div className="timeline-track">{viewTasks.filter(t => t.forklift_id === f.id).map(t => <div key={t.lot_id} className={`timeline-task relocate ${completed.has(t.lot_id) ? 'done' : ''}`} style={{left: `${t.start/Math.max(s.deadline,1)*100}%`, width: `${(t.end-t.start)/Math.max(s.deadline,1)*100}%`}} title={`${t.lot_id}: minutes ${t.start}–${t.end}`}>{t.lot_id}</div>)}</div></div>)}</div><div className="legend"><span><i className="legend-cover"/>Cover with tarp</span><span><i className="legend-move"/>Relocate to bay</span><span><i className="legend-done"/>Completed</span></div></>}
              {active?.state === 'draft' && <div className="approval-row"><p>Review the resource assignments before releasing work.</p><button className="primary" disabled={busy} onClick={() => void mutate(`/api/plans/${active.id}/approve`, {}, 'Manager approval recorded. Tasks are ready for execution.')}><Icon name="check"/>Approve plan</button></div>}
            </section>
            {viewTasks.length > 0 && <section className="panel"><div className="panel-heading"><div><h2>Work instructions</h2><p>Completion records simulated execution at the scheduled times.</p></div><span className="subtle">{s.completed.length} / {totalTasks} complete</span></div><div className="table-scroll"><table><thead><tr><th>Lot / action</th><th>Window</th><th>Assigned crew</th><th>Resources</th><th>Status</th></tr></thead><tbody>{viewTasks.map(t => <tr key={t.lot_id}><td><strong>{t.lot_id}</strong><span className="cell-sub">{t.action === 'cover' ? 'Cover with tarp' : 'Move to covered bay'}</span></td><td>{t.start}–{t.end} min</td><td>{t.worker_ids.map(id => s.workers.find(w => w.id === id)?.name || id).join(', ')}</td><td>{resourceLabel(t)}<span className="cell-sub">{money(t.saved_loss_inr)} benefit</span></td><td>{completed.has(t.lot_id) ? <span className="pill success">Complete</span> : <button className="secondary compact" disabled={busy || active?.state !== 'approved'} onClick={() => active && void mutate(`/api/plans/${active.id}/tasks/${t.lot_id}/complete`, {}, `${t.lot_id} completion recorded. Replanning will retain its protection resource.`)}>Record complete</button>}</td></tr>)}</tbody></table></div><div className="footnote">Demo assumption: each recorded action occurred at its scheduled start/end. Unfinished actions restart in full on replanning; partial or in-progress operations are outside this MVP.</div></section>}
            <section className="panel"><div className="panel-heading"><div><h2>{active ? 'Lots left exposed' : 'Lots awaiting protection'}</h2><p>{active ? 'Resource tradeoffs are explicit. These lots receive no action in the current plan.' : 'Generate a plan to see which lots can be protected.'}</p></div><span className="pill">{unprotected.length} lots</span></div><div className="exposed-list">{unprotected.map(l => <div key={l.id}><span className="lot-square">{l.id}</span><div><strong>{l.description}</strong><small>{l.weight_kg.toLocaleString('en-IN')} kg · {l.location}</small></div><span>{money(l.exposed_loss_inr)}<small>assumed loss</small></span></div>)}{!unprotected.length && <p>All eligible lots have a protection action.</p>}</div></section>
          </div><aside className="right-column">
            <section className="panel resource-panel"><div className="panel-heading"><div><h2>Yard resources</h2><p>Protection assets stay allocated through rain.</p></div></div><div className="resource-summary"><span>Available crew</span><strong>{s.workers.filter(w => w.enabled).length} / {s.workers.length}</strong></div><div className="crew-list">{s.workers.map(w => <div key={w.id}><span className={`status-dot ${w.enabled ? '' : 'off'}`}/><span>{w.name}</span><small>{w.skills.includes('forklift') ? 'Operator' : 'Crew'}</small></div>)}</div>{[['Tarpaulins', s.tarps, 'tarp_id'], ['Covered bays', s.storage, 'storage_id']].map(([label, resources, key]) => <div className="asset-group" key={label as string}><div className="resource-summary"><span>{label as string}</span><strong>{(resources as typeof s.tarps).filter(r => viewTasks.some(t => t[key as 'tarp_id' | 'storage_id'] === r.id)).length} / {(resources as typeof s.tarps).length}<small> allocated</small></strong></div>{(resources as typeof s.tarps).map(r => <div className="asset" key={r.id}><strong>{r.id}</strong><span>{r.name}<small>Up to {r.capacity_kg.toLocaleString('en-IN')} kg</small></span><span className="asset-lot">{viewTasks.find(t => t[key as 'tarp_id' | 'storage_id'] === r.id)?.lot_id || 'Free'}</span></div>)}</div>)}</section>
            <section className="panel disruption-panel"><div className="panel-heading"><div><span className="eyebrow">WHAT IF THE YARD CHANGES?</span><h2>Revise the scenario</h2><p>Save a disruption, then generate a new draft.</p></div></div><form onSubmit={e => {e.preventDefault(); void disrupt();}}><div className="field"><label htmlFor="deadline">Handling cutoff <span>minutes from event origin</span></label><input id="deadline" type="number" min={s.now_minute} max="230" required value={deadline} onChange={e => setDeadline(Number(e.target.value))}/></div><div className="field"><label htmlFor="elapsed">Elapsed time <span>must not move backwards</span></label><input id="elapsed" type="number" min={s.now_minute} max={deadline} required value={elapsed} onChange={e => setElapsed(Number(e.target.value))}/></div><label className="checkbox-row"><input type="checkbox" checked={forklift} onChange={e => setForklift(e.target.checked)}/>Forklift available</label><fieldset><legend>Available workers</legend>{s.workers.map(w => <label className="checkbox-row" key={w.id}><input type="checkbox" checked={!disabled.includes(w.id)} onChange={e => setDisabled(e.target.checked ? disabled.filter(x => x !== w.id) : [...disabled,w.id])}/>{w.name}</label>)}</fieldset><button className="secondary full" disabled={busy} type="submit">Apply scenario changes <Icon name="arrow"/></button><p className="micro-copy">Invalidates existing approval. Completed protection stays in place. Rain arrival moves with cutoff + buffer.</p></form></section>
          </aside></div>}

          {tab === 'Material lots' && <section className="panel"><div className="panel-heading"><div><h2>Material inventory</h2><p>12 fictional lots · values, vulnerability and loss estimates are operator assumptions.</p></div><label className="search-label">Find a lot<input placeholder="ID, material or location" value={filter} onChange={e => setFilter(e.target.value)}/></label></div><div className="table-scroll"><table><thead><tr><th>Lot / material</th><th>Weight / location</th><th>Exposure</th><th>Value / assumed loss</th><th>Allowed handling</th><th>Protection</th></tr></thead><tbody>{s.lots.filter(l => `${l.id} ${l.description} ${l.location}`.toLowerCase().includes(filter.toLowerCase())).map(l => <tr key={l.id}><td><strong>{l.id} · {l.description}</strong><span className="cell-sub">{l.condition}</span></td><td>{l.weight_kg.toLocaleString('en-IN')} kg<span className="cell-sub">{l.location}</span></td><td><span className={`pill ${l.exposure === 'high' ? 'warning' : ''}`}>{l.exposure}</span><span className="cell-sub">Vulnerability {l.vulnerability}/5</span></td><td>{money(l.value_inr)}<span className="cell-sub">{money(l.exposed_loss_inr)} expected loss</span></td><td>{l.actions.map(a => <span className="action-option" key={a.kind}>{a.kind} · {a.duration}m · {a.workers} crew{a.forklift ? ' + forklift' : ''}<small>{a.effectiveness_bps/100}% effectiveness{a.required_skills.length ? ` · ${a.required_skills.join(', ')}` : ''}</small></span>)}{l.restrictions.map(r => <span className="cell-sub" key={r}>{r}</span>)}{!l.actions.length && 'No action needed'}</td><td><span className={`pill ${completed.has(l.id) || l.protection_status === 'already_protected' ? 'success' : ''}`}>{completed.has(l.id) ? 'Completed' : l.protection_status === 'already_protected' ? 'Sheltered' : upcoming.some(t => t.lot_id === l.id) ? 'Planned' : 'Exposed'}</span></td></tr>)}</tbody></table></div></section>}

          {tab === 'Compare strategies' && <section className="panel comparison"><div className="panel-heading"><div><h2>Same yard. Same constraints.</h2><p>All strategies use identical compatibility, handling and resource limits.</p></div></div>{!active ? <div className="empty"><h3>Generate a plan to compare outcomes.</h3><p>Three greedy scheduling rules are evaluated alongside CP-SAT.</p></div> : <><div className="comparison-note">Snapshot at plan generation · completed benefit then: {money(active.plan.completed_saved_inr)} · each baseline takes the highest-benefit feasible action for each lot in priority order.</div><div className="table-scroll"><table><thead><tr><th>Scheduling strategy</th><th>Additional avoided loss</th><th>Residual loss</th><th>Scheduled lots</th><th>Valid schedule</th></tr></thead><tbody>{[active.plan, ...active.comparisons].map(p => <tr className={p.strategy === 'CP-SAT' ? 'optimized-row' : ''} key={p.strategy}><td><strong>{p.strategy}</strong><span className="cell-sub">{p.strategy === 'CP-SAT' ? `${p.solver_status} · upper bound ${money(p.best_bound_inr || 0)}` : 'Deterministic greedy scheduling'}</span></td><td>{money(p.planned_saved_inr)}</td><td>{money(p.residual_loss_inr)}</td><td>{p.tasks.length}</td><td><span className="pill success">{p.validation.valid ? 'Passed' : 'Failed'}</span></td></tr>)}</tbody></table></div><div className="comparison-verdict">{(() => {const best = Math.max(...active.comparisons.map(p => p.planned_saved_inr)); const gain = active.plan.planned_saved_inr-best; return gain > 0 ? <><strong>{money(gain)} more estimated loss avoided</strong><p>Compared with the strongest baseline in this scenario{best > 0 ? ` (${(gain/best*100).toFixed(1)}% improvement)` : ''}. This result is specific to the fictional data.</p></> : gain === 0 ? <><strong>The strongest baseline matches this plan.</strong><p>No optimisation advantage in estimated loss avoided for this scenario.</p></> : <><strong>A baseline currently performs better by {money(-gain)}.</strong><p>The solver returned a feasible incumbent without proving optimality. Do not claim an advantage.</p></>;})()}</div><div className="footnote">Objective: minimise assumed preventable material loss. INR benefits are rounded down to whole rupees. An OPTIMAL status proves optimality only under these model assumptions.</div></>}</section>}

          {tab === 'Activity' && <div className="activity-grid"><section className="panel"><div className="panel-heading"><div><h2>Operational audit trail</h2><p>Approvals, completions and scenario revisions persist in SQLite.</p></div></div><div className="events">{data.events.length ? data.events.map(e => <div key={e.id}><span className="event-dot"/><div><strong>{e.kind.replaceAll('_',' ')}</strong><p>{e.detail}</p><small>{stamp(e.at)} IST</small></div></div>) : <div className="empty">No activity yet. Generate your first plan.</div>}</div></section><section className="panel"><div className="panel-heading"><h2>Plan history</h2><span className="subtle">Latest 30</span></div><div className="history-list">{history.map(p => <div key={p.id}><strong>Plan {p.id}</strong><span className="pill">{p.state}</span><p>{p.plan.tasks.length} actions · {money(p.plan.planned_saved_inr)} additional avoided loss at generation</p><small>{stamp(p.created)} IST · {p.plan.solver_status}</small></div>)}{!history.length && <div className="empty">No saved plans.</div>}</div></section></div>}

          <footer><span>DryStock / Weather-aware protection planning<br/><small>Fictional data. Estimated outcomes, not scientifically validated measurements. Local demo; no authentication.</small></span><button className="text-button" disabled={busy} onClick={() => {if (window.confirm('Reset the fictional yard and completion state? Audit history will be retained.')) void mutate('/api/reset', {}, 'Demo yard reset. Audit history retained.');}}>Reset demo yard</button></footer>
        </>}
      </div>
    </main>
  </div>;
}
