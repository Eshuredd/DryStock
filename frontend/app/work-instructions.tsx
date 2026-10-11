import type {ReactNode} from 'react';
import type {Scenario, Task} from '../lib/types';
import {ActionInputs} from './demo-comparison';
import {money} from '../lib/workflow';

export function WorkInstructions({scenario,tasks,approved,busy,pending,onComplete,feedback}: {
  scenario: Scenario; tasks: Task[]; approved: boolean; busy: boolean; pending: string | null;
  onComplete: (task: Task) => void; feedback: (scope: string) => ReactNode;
}) {
  const completed = new Set(scenario.completed.map(t => t.lot_id));
  const names = (task: Task) => task.worker_ids.map(id => scenario.workers.find(w => w.id === id)?.name || 'Unknown crew member').join(', ');
  const resources = (task: Task) => [
    scenario.forklifts.find(f => f.id === task.forklift_id)?.name,
    scenario.tarps.find(t => t.id === task.tarp_id)?.name,
    scenario.storage.find(s => s.id === task.storage_id)?.name
  ].filter(Boolean).join(' · ');
  const status = (task: Task, prefix: string) => {
    const done = completed.has(task.lot_id);
    const scope = `complete-${task.lot_id}`;
    return <div className="task-status">
      {done ? <strong className="pill success">Reported complete (simulated)</strong> : <>
        <button className="secondary" disabled={busy || !approved} aria-describedby={!approved ? `${prefix}-${task.lot_id}-reason` : undefined}
          onClick={() => onComplete(task)} aria-label={`Record ${task.lot_id} simulated completion`}>
          {pending === scope ? 'Recording simulated completion…' : 'Record simulated completion'}
        </button>
        {!approved && <small id={`${prefix}-${task.lot_id}-reason`}>Approve the current draft before recording completion.</small>}
      </>}
      {feedback(scope)}
    </div>;
  };
  return <section className="panel work-panel" id="work-instructions" tabIndex={-1} aria-labelledby="work-heading">
    <div className="panel-heading"><div><h2 id="work-heading">Work instructions</h2><p>Report simulated execution at the scheduled times; this does not verify real work.</p></div><span className="pill">{scenario.completed.length} / {tasks.length} reported complete</span></div>
    <div className="desktop-work table-scroll" tabIndex={0} role="region" aria-label="Work instructions table">
      <table><thead><tr><th>Lot / action</th><th>Window</th><th>Assigned crew</th><th>Resources / estimate</th><th>Simulated reporting</th></tr></thead>
        <tbody>{tasks.map(task => <tr key={task.lot_id} data-lot={task.lot_id}>
          <td><strong>{task.lot_id} · {scenario.lots.find(l => l.id === task.lot_id)?.description}</strong><span className="cell-sub">{task.action === 'cover' ? 'Cover with tarp' : 'Move to covered bay'}</span><ActionInputs scenario={scenario} task={task}/></td>
          <td>{task.start}–{task.end} min</td><td>{names(task)}</td><td>{resources(task)}<span className="cell-sub">{money(task.saved_loss_inr)} estimated benefit</span></td><td>{status(task,'desktop')}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mobile-work">{tasks.map(task => <article className="work-card" key={task.lot_id} data-lot={task.lot_id}>
      <h3>{task.lot_id} · {scenario.lots.find(l => l.id === task.lot_id)?.description}</h3>
      <p><strong>{task.action === 'cover' ? 'Cover with tarp' : 'Move to covered bay'}</strong> · {task.start}–{task.end} min</p>
      <p>{names(task)} · {resources(task)}</p><p>{money(task.saved_loss_inr)} estimated benefit</p>
      {status(task,'mobile')}<ActionInputs scenario={scenario} task={task}/>
    </article>)}</div>
    <p className="footnote">Demo assumption: a reported action occurred at its scheduled start/end. Its protection resource stays allocated. Unfinished actions restart in full on replanning; partial work is outside this MVP.</p>
  </section>;
}
