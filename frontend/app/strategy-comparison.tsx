import type {SavedPlan} from '../lib/types';
import {money} from '../lib/workflow';

export function StrategyComparison({current}: {current: SavedPlan | null}) {
  if (!current) return <section className="panel empty"><h2>No current comparison</h2><p>Generate or re-optimise a plan to compare estimates under the current fictional conditions.</p></section>;
  const best = Math.max(...current.comparisons.map(p => p.planned_saved_inr));
  const gain = current.plan.planned_saved_inr-best;
  return <section className="panel comparison">
    <div className="panel-heading"><div><h2>Same yard. Same constraints.</h2><p>All strategies use identical compatibility, handling and resource limits.</p></div></div>
    <div className="comparison-verdict">
      <strong>{gain > 0 ? `${money(gain)} more estimated loss avoided` : gain === 0 ? 'The strongest baseline matches this plan.' : `A baseline estimates ${money(-gain)} more benefit.`}</strong>
      <p>{gain > 0 ? `Compared with the strongest baseline${best > 0 ? ` (${(gain/best*100).toFixed(1)}% improvement)` : ''} in this fictional scenario.` : gain === 0 ? 'No optimisation advantage in estimated benefit for this scenario.' : 'The solver has not proved this plan optimal. Do not claim an advantage.'} These are model estimates, not measured savings or a general performance claim.</p>
    </div>
    <p className="comparison-note">Snapshot at generation: {money(current.plan.completed_saved_inr)} retained simulated completion benefit is included equally in every strategy’s residual loss. Additional benefit below refers to work planned at generation, even if subsequently reported complete.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Strategy estimates, scroll horizontally for all columns"><table><thead><tr><th>Strategy</th><th>Additional estimated benefit</th><th>Estimated residual loss</th><th>Planned lots</th><th>Validation</th></tr></thead>
      <tbody>{[current.plan,...current.comparisons].map(p => <tr key={p.strategy} className={p.strategy === 'CP-SAT' ? 'optimized-row' : ''}>
        <td><strong>{p.strategy === 'CP-SAT' ? 'Optimised plan (CP-SAT)' : p.strategy}</strong></td><td>{money(p.planned_saved_inr)}</td><td>{money(p.residual_loss_inr)}</td><td>{p.tasks.length}</td><td><span className={`pill ${p.validation.valid ? 'success' : 'warning'}`}>{p.validation.valid ? 'Passed' : 'Failed'}</span></td>
      </tr>)}</tbody></table></div>
    <details className="comparison-method"><summary>Strategy rules and solver evidence</summary>
      <p>Highest value first prioritises material value. Highest loss first prioritises assumed exposed loss. Loss per worker-minute prioritises estimated benefit per minute of crew time. Each rule chooses the highest-benefit feasible action for each lot in that order.</p>
      <p>CP-SAT considers the combined assignments. Solver status: <strong>{current.plan.solver_status}</strong>; solve time {current.plan.solve_seconds.toFixed(2)}s; additional benefit upper bound {current.plan.best_bound_inr === null ? 'unavailable' : money(current.plan.best_bound_inr)}. “OPTIMAL” applies only under these model assumptions. INR benefits are rounded down to whole rupees.</p>
    </details>
  </section>;
}
