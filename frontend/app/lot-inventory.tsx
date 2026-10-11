import type {Lot, Scenario, Task} from '../lib/types';
import {money} from '../lib/workflow';

export function LotInventory({scenario,upcoming,filter,onFilter}: {
  scenario: Scenario; upcoming: Task[]; filter: string; onFilter: (value: string) => void;
}) {
  const lots = scenario.lots.filter(l => `${l.id} ${l.description} ${l.location}`.toLowerCase().includes(filter.toLowerCase()));
  const status = (lot: Lot) => {
    const done = scenario.completed.some(t => t.lot_id === lot.id);
    return <span className={`pill ${done || lot.protection_status === 'already_protected' ? 'success' : ''}`}>
      {done ? 'Reported complete (simulated)' : lot.protection_status === 'already_protected' ? 'Sheltered in fixture' : upcoming.some(t => t.lot_id === lot.id) ? 'Planned — pending' : 'Exposed'}
    </span>;
  };
  const handling = (lot: Lot) => <>
    {lot.actions.map(a => <span className="action-option" key={a.kind}>{a.kind === 'cover' ? 'Cover with tarp' : 'Move to bay'} · {a.duration} min · {a.workers} crew{a.forklift ? ' + forklift' : ''}
      <small>{a.effectiveness_bps/100}% assumed effectiveness{a.required_skills.length ? ` · ${a.required_skills.map(s=>s.replaceAll('_',' ')).join(', ')}` : ''}</small>
    </span>)}
    {lot.restrictions.map(r => <p className="cell-sub" key={r}>{r}</p>)}{!lot.actions.length && 'No action needed'}
  </>;
  return <section className="panel">
    <div className="panel-heading inventory-heading"><div><h2>Material inventory</h2><p>{scenario.lots.length} fictional lots. Values, vulnerability (1 low–5 high) and loss estimates are operator assumptions.</p></div>
      <label className="search-label">Find a lot<input placeholder="ID, material or location" value={filter} onChange={e=>onFilter(e.target.value)}/></label>
    </div>
    <div className="desktop-lots table-scroll" tabIndex={0} role="region" aria-label="Material inventory, scroll horizontally for all columns">
      <table><thead><tr><th>Lot / material</th><th>Weight / location</th><th>Exposure</th><th>Value / assumed loss</th><th>Allowed handling</th><th>Protection</th></tr></thead>
        <tbody>{lots.map(l => <tr key={l.id}><td><strong>{l.id} · {l.description}</strong><span className="cell-sub">{l.condition}</span></td>
          <td>{l.weight_kg.toLocaleString('en-IN')} kg<span className="cell-sub">{l.location}</span></td>
          <td><span className={`pill ${l.exposure === 'high' ? 'warning' : ''}`}>{l.exposure}</span><span className="cell-sub">Vulnerability {l.vulnerability}/5</span></td>
          <td>{money(l.value_inr)}<span className="cell-sub">{money(l.exposed_loss_inr)} assumed loss</span></td><td>{handling(l)}</td><td>{status(l)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mobile-lots">{lots.map(l => <article className="lot-card" key={l.id}>
      <div className="lot-card-heading"><h3>{l.id} · {l.description}</h3>{status(l)}</div>
      <p>{l.location} · {l.weight_kg.toLocaleString('en-IN')} kg</p><p>{l.exposure} exposure · {money(l.exposed_loss_inr)} assumed exposed loss</p>
      <details><summary>Lot details and handling</summary><div className="lot-details"><p>Condition: {l.condition}</p><p>Material value: {money(l.value_inr)} · Vulnerability {l.vulnerability}/5</p>{handling(l)}</div></details>
    </article>)}</div>
    {!lots.length && <p className="detail-copy" role="status">No matching lots. Try another ID, material or location.</p>}
  </section>;
}
