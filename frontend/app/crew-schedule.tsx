import type {Scenario, Task} from '../lib/types';
import {taskResources} from '../lib/workflow';

export function CrewSchedule({scenario,tasks}: {scenario:Scenario;tasks:Task[]}) {
  const ordered = [...tasks].sort((a,b)=>a.start-b.start || a.lot_id.localeCompare(b.lot_id));
  const scale = Math.max(1,scenario.deadline,...tasks.map(t=>t.end));
  const done = new Set(scenario.completed.map(t=>t.lot_id));
  const describe = (t:Task) => `${t.action === 'cover' ? 'Cover with tarp' : 'Move to bay'} · ${t.start}–${t.end} min · ${taskResources(t,scenario)}`;
  return <section className="panel schedule-panel" aria-labelledby="schedule-heading">
    <div className="panel-heading"><div><h2 id="schedule-heading">Crew schedule</h2><p>Saved simulated times; pending work is not completed protection.</p></div></div>
    {!ordered.length && <p className="detail-copy">No additional assignments scheduled. Cutoff: minute {scenario.deadline}.</p>}
    {ordered.length > 0 && <>
      <div className="desktop-schedule" aria-hidden="true">
        <div className="schedule-axis"><span>0 min</span><span>{scale} min</span></div>
        {scenario.workers.map(w=><div className="schedule-row" key={w.id}><strong>{w.name}</strong><div className="schedule-track">
          <div className="schedule-cutoff" style={{left:`${scenario.deadline/scale*100}%`}}/>
          {ordered.filter(t=>t.worker_ids.includes(w.id)).map(t=><div className={`schedule-task ${done.has(t.lot_id) ? 'reported' : ''}`} key={t.lot_id} style={{left:`${t.start/scale*100}%`,width:`${(t.end-t.start)/scale*100}%`}}>{t.lot_id}<span>{t.start}–{t.end}</span></div>)}
        </div></div>)}
      </div>
      <p className="detail-copy">Cutoff: minute {scenario.deadline}. Solid bars: pending. Dashed bars: reported complete (simulated).</p>
      <ol className="schedule-list">{ordered.map(t=><li key={t.lot_id}><div><strong>{t.lot_id} · {scenario.lots.find(l=>l.id===t.lot_id)?.description || 'Material unavailable'}</strong><span className="pill">{done.has(t.lot_id) ? 'Reported complete (simulated)' : 'Pending scheduled work'}</span></div><p>{describe(t)}</p><p>Crew: {t.worker_ids.map(id=>scenario.workers.find(w=>w.id===id)?.name || 'Unknown crew member').join(', ')}</p></li>)}</ol>
    </>}
  </section>;
}
