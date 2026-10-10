import type {SavedPlan, Scenario, Task} from '../lib/types';

const money = (n: number) => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
const assignment = (t: Task | undefined) => t ? `${t.action} · ${t.start}–${t.end}m · ${t.worker_ids.join(', ')} · ${[t.forklift_id,t.tarp_id,t.storage_id].filter(Boolean).join(', ')}` : 'Leave exposed';

export function ActionInputs({scenario,task}: {scenario:Scenario;task:Task}) {
  const lot = scenario.lots.find(l => l.id === task.lot_id);
  const action = lot?.actions.find(a => a.kind === task.action);
  const asset = [...scenario.tarps,...scenario.storage].find(r => r.id === (task.tarp_id || task.storage_id));
  if (!lot || !action) return null;
  return <details className="action-reasons"><summary>Handling inputs</summary><p>{lot.weight_kg} kg; assumed exposed loss {money(lot.exposed_loss_inr)}. This {action.duration}-minute action has {action.effectiveness_bps/100}% assumed effectiveness.</p><p>Needs {action.workers} worker{action.workers > 1 ? 's' : ''}{action.forklift ? ' and a forklift' : ''}. {asset?.id} accepts {lot.category}, up to {asset?.capacity_kg} kg. Finishes at {task.end}, by cutoff {scenario.deadline}.</p><small>Constraint inputs, not a counterfactual explanation or physical verification.</small></details>;
}

export function DemoComparison({scenario,current,history}: {scenario:Scenario;current:SavedPlan|null;history:SavedPlan[]}) {
  if (!scenario.completed.length) return null;
  const before = history.find(p => p.id !== current?.id && p.scenario.deadline > scenario.deadline &&
    scenario.completed.every(c => p.plan.tasks.some(t => JSON.stringify(t) === JSON.stringify(c))));
  if (!before) return null;
  const after = [...scenario.completed,...(current?.plan.tasks || [])];
  const ids = Array.from(new Set([...before.plan.tasks,...after].map(t => t.lot_id)));
  const reconsidered = before.plan.tasks.filter(t => !scenario.completed.some(c => c.lot_id === t.lot_id));
  const disabled = scenario.forklifts.filter(f => !f.enabled).map(f => f.name).concat(scenario.workers.filter(w => !w.enabled).map(w => w.name));
  const best = current ? Math.max(...current.comparisons.map(p => p.planned_saved_inr)) : 0;
  const gain = current ? current.plan.planned_saved_inr-best : 0;
  return <section className="panel before-after"><div className="panel-heading"><div><h2>Before and after the disruption</h2><p>Completed work is retained. Every unfinished task is reconsidered in full.</p></div><span className="pill">{before.scenario.deadline} → {scenario.deadline} min cutoff</span></div>
    <div className="change-summary"><p><strong>Changed:</strong> rain minute {before.scenario.rain_arrival_minute} → {scenario.rain_arrival_minute}; clock {scenario.now_minute}. Unavailable: {disabled.join(', ') || 'none'}.</p><p><strong>Retained:</strong> {scenario.completed.map(t => `${t.lot_id} on ${t.tarp_id || t.storage_id}`).join(', ')} — simulated operator-reported completion.</p><p><strong>Reconsidered:</strong> {reconsidered.map(t => t.lot_id).join(', ')}. {current ? `${money(current.plan.planned_saved_inr)} additional estimated avoidable loss addressed; ${gain > 0 ? `${money(gain)} above the strongest baseline` : gain === 0 ? 'strongest baseline ties' : 'strongest baseline currently better'}.` : 'Generate a revised draft using the selected compute backend.'}</p></div>
    <div className="plan-pair"><div><strong>Original plan · {before.plan.solver_status}</strong><small>{money(before.plan.planned_saved_inr)} modelled benefit at generation</small></div><div><strong>{current ? 'Revised plan' : 'Revised plan pending'}</strong><small>Completed benefit and additional planned benefit are distinct.</small></div></div>
    <div className="table-scroll"><table><thead><tr><th>Lot</th><th>Original allocation / timeline</th><th>Revised allocation / timeline</th><th>Difference</th></tr></thead><tbody>{ids.map(id => {const old = before.plan.tasks.find(t => t.lot_id === id); const revised = after.find(t => t.lot_id === id); const done = scenario.completed.some(t => t.lot_id === id); return <tr key={id}><td><strong>{id}</strong></td><td>{assignment(old)}{old && <div className="mini-track"><i style={{marginLeft:`${old.start/before.scenario.deadline*100}%`,width:`${(old.end-old.start)/before.scenario.deadline*100}%`}}/></div>}</td><td>{current || done ? assignment(revised) : 'Awaiting re-optimisation'}{revised && <div className="mini-track"><i style={{marginLeft:`${revised.start/Math.max(scenario.deadline,1)*100}%`,width:`${(revised.end-revised.start)/Math.max(scenario.deadline,1)*100}%`}}/></div>}</td><td><span className={`pill ${done ? 'success' : ''}`}>{done ? 'Retained complete' : !current ? 'Reconsider' : !revised ? 'Left exposed' : !old ? 'Newly scheduled' : assignment(old) === assignment(revised) ? 'Unchanged' : 'Reassigned'}</span></td></tr>;})}</tbody></table></div>
  </section>;
}
