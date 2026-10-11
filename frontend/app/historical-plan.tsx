import type {SavedPlan} from '../lib/types';
import {assignment, money} from '../lib/workflow';
import {StrategyComparison} from './strategy-comparison';

export function HistoricalPlan({saved}: {saved: SavedPlan}) {
  const s = saved.scenario;
  const backend = saved.execution?.execution_backend || saved.plan.execution_backend;
  return <details className="historical-plan">
    <summary>Inspect saved plan · read-only</summary>
    <div className="historical-content">
      <h3>Historical snapshot — not executable</h3>
      <p>Plan {saved.id} · saved {new Date(saved.created).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})} IST · current record status: {saved.state}.</p>
      <p>Fictional conditions at generation: clock {s.now_minute}, handling cutoff {s.deadline}, rain {s.rain_arrival_minute} minutes. This snapshot does not describe current conditions or verify physical protection.</p>
      <p>Actual computation: {backend === 'aws' ? 'AWS Lambda' : backend === 'sam' ? 'AWS SAM local API' : backend === 'local' ? 'Local Python' : 'not recorded in this snapshot'}. Validation: {saved.plan.validation.valid ? 'passed' : 'failed'}.</p>
      <details><summary>Historical resources</summary><p>{s.workers.map(w=>`${w.name}: ${w.enabled ? 'enabled' : 'unavailable'}`).join(' · ')}</p><p>{s.forklifts.map(f=>`${f.name}: ${f.enabled ? 'enabled' : 'unavailable'}`).join(' · ')}</p><p>Tarps: {s.tarps.map(t=>`${t.name} (${t.capacity_kg} kg, ${t.enabled ? 'enabled' : 'unavailable'})`).join(' · ')}</p><p>Covered bays: {s.storage.map(b=>`${b.name} (${b.capacity_kg} kg, ${b.enabled ? 'enabled' : 'unavailable'})`).join(' · ')}</p></details>
      <h3>Assignments at generation</h3>
      {[...s.completed,...saved.plan.tasks].map(t => <div className="historical-task" key={t.lot_id}><strong>{t.lot_id} · {s.lots.find(l=>l.id===t.lot_id)?.description}</strong><p>{assignment(t,s)}</p><p>{money(t.saved_loss_inr)} estimated benefit · {s.completed.some(c=>c.lot_id===t.lot_id) ? 'reported complete (simulated) before generation' : 'planned at generation; later execution is not implied'}</p></div>)}
      {!saved.plan.tasks.length && <p>No additional actions were planned in this snapshot.</p>}
      <StrategyComparison current={saved}/>
    </div>
  </details>;
}
