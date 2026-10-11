import type {SavedPlan, Scenario, Task} from '../lib/types';
import {assignment, comparisonTotals, money} from '../lib/workflow';

export function ActionInputs({scenario,task}: {scenario:Scenario;task:Task}) {
  const lot = scenario.lots.find(l => l.id === task.lot_id);
  const action = lot?.actions.find(a => a.kind === task.action);
  const asset = [...scenario.tarps,...scenario.storage].find(r => r.id === (task.tarp_id || task.storage_id));
  if (!lot || !action) return null;
  return <details className="action-reasons"><summary>Handling inputs</summary>
    <p>{lot.weight_kg} kg; assumed exposed loss {money(lot.exposed_loss_inr)}. This {action.duration}-minute action has {action.effectiveness_bps/100}% assumed effectiveness.</p>
    <p>Needs {action.workers} {action.workers === 1 ? 'worker' : 'workers'}{action.forklift ? ' and a forklift' : ''}. {asset?.name} ({asset?.id}) accepts {lot.category}, up to {asset?.capacity_kg} kg. Finishes at minute {task.end}, by cutoff {scenario.deadline}.</p>
    <small>Model inputs, not proof of physical protection or an explanation of every alternative.</small>
  </details>;
}

export function DemoComparison({scenario,current,before}: {scenario:Scenario;current:SavedPlan|null;before:SavedPlan}) {
  const completed = new Set(scenario.completed.map(t => t.lot_id));
  const old = [...before.scenario.completed,...before.plan.tasks];
  const after = [...scenario.completed,...(current?.plan.tasks || []).filter(t => !completed.has(t.lot_id))];
  const ids = Array.from(new Set([...old,...after].map(t => t.lot_id)));
  const totals = comparisonTotals(before,current,scenario);
  const unavailable = scenario.forklifts.filter(f => !f.enabled).map(f => f.name).concat(scenario.workers.filter(w => !w.enabled).map(w => w.name));
  const resourceChanges = [...scenario.workers,...scenario.forklifts].filter(r=>[...before.scenario.workers,...before.scenario.forklifts].find(p=>p.id === r.id)?.enabled !== r.enabled).map(r=>`${r.name}: ${r.enabled ? 'available' : 'unavailable'}`);
  return <section className="panel before-after" aria-labelledby="changes-heading">
    <div className="panel-heading"><div><h2 id="changes-heading">What changed</h2><p>Changed-scenario replanning; separate from same-scenario baseline comparisons.</p></div></div>
    <div className="change-summary">
      <p><strong>Handling cutoff:</strong> {before.scenario.deadline} → {scenario.deadline} min. <strong>Simulated rain:</strong> {before.scenario.rain_arrival_minute} → {scenario.rain_arrival_minute} min. <strong>Clock:</strong> {before.scenario.now_minute} → {scenario.now_minute} min.</p>
      <p><strong>Resource changes:</strong> {resourceChanges.join(', ') || 'None'}. <strong>Unavailable now:</strong> {unavailable.join(', ') || 'None'}. <strong>Retained simulated completion:</strong> {scenario.completed.length ? scenario.completed.map(t => `${t.lot_id} on ${t.tarp_id || t.storage_id}`).join(', ') : 'None reported'}.</p>
      <p><strong>Current schedule:</strong> {current ? `${after.filter(t=>!completed.has(t.lot_id)).length} pending actions · ${money(totals.newPending!)} additional estimated loss avoided · ${money(current.plan.initial_loss_inr-totals.retained-totals.newPending!)} estimated loss remaining.` : 'Awaiting re-optimisation; no new schedule is authorised.'}</p>
      {current && <p><strong>Newly scheduled lots:</strong> {after.filter(t=>!completed.has(t.lot_id) && !old.some(p=>p.lot_id === t.lot_id)).map(t=>t.lot_id).join(', ') || 'None; see detailed allocations for retained or reassigned lots'}.</p>}
    </div>
    <details className="allocation-details"><summary>Before / after estimates and allocations</summary>
      <p className="detail-copy">Both totals estimate benefit for the same fictional yard, separating reported completion from pending work. The original total stays fixed; its completion split only includes lots in that original schedule. Pending estimates are not measured savings. The historical schedule may no longer be feasible.</p>
      <div className="plan-pair">
        <div><strong>Original plan · historical</strong><p>{money(totals.oldTotal)} total estimated benefit</p><small>{money(totals.oldRetained)} reported simulated completion from the original schedule + {money(totals.oldPending)} pending in the original plan</small></div>
        <div><strong>{current ? 'Revised plan' : 'Revised plan pending'}</strong><p>{totals.newTotal === null ? 'Re-optimise to estimate pending work' : `${money(totals.newTotal)} total estimated benefit`}</p><small>{money(totals.retained)} retained simulated completion{totals.newPending === null ? '' : ` + ${money(totals.newPending)} pending in the revised plan`}</small></div>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Before and after allocations, scroll horizontally for all columns"><table><thead><tr><th>Lot</th><th>Original allocation / timeline</th><th>Revised allocation / timeline</th><th>Difference</th></tr></thead><tbody>{ids.map(id => {
        const prior = old.find(t => t.lot_id === id); const revised = after.find(t => t.lot_id === id); const done = completed.has(id);
        return <tr key={id}><td><strong>{id}</strong></td><td>{assignment(prior,before.scenario)}</td><td>{current || done ? assignment(revised,scenario) : 'Awaiting re-optimisation'}</td><td><span className={`pill ${done ? 'success' : ''}`}>{done ? 'Retained simulated completion' : !current ? 'Reconsider' : !revised ? 'Left exposed' : !prior ? 'Newly scheduled' : assignment(prior,before.scenario) === assignment(revised,scenario) ? 'Unchanged' : 'Reassigned'}</span></td></tr>;
      })}</tbody></table></div>
    </details>
  </section>;
}
