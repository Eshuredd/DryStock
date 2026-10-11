import type {SavedPlan} from '../lib/types';
import {money, strategyEstimates} from '../lib/workflow';

export function StrategyComparison({current}: {current: SavedPlan | null}) {
  if (!current) return <section className="panel empty"><h2>No current comparison</h2><p>Generate or re-optimise a plan to compare estimates under the current fictional conditions.</p></section>;
  const estimate = strategyEstimates(current);
  if (!estimate) return <section className="panel empty"><h2>Comparison unavailable</h2><p>Validated comparable monetary estimates were not returned. No chart or advantage is inferred.</p></section>;
  const {best,difference:gain,percent,series,maximum} = estimate;
  return <section className="panel comparison">
    <div className="panel-heading"><div><h2>Same yard. Same constraints.</h2><p>All strategies use identical compatibility, handling and resource limits.</p></div></div>
    <div className="comparison-verdict">
      <strong>{gain === null ? 'Baseline comparison unavailable.' : gain > 0 ? `${money(gain)} more estimated loss avoided` : gain === 0 ? 'The strongest baseline matches this plan.' : `The strongest baseline leaves ${money(-gain)} less estimated loss.`}</strong>
      <p>{best ? `${best.strategy}: ${gain === 0 ? 'equal estimated loss' : percent === null ? 'percentage undefined because baseline loss is zero' : `${Math.abs(percent).toFixed(1)}% ${gain! > 0 ? 'lower' : 'higher'} estimated residual loss`}. ${gain! < 0 ? 'Do not claim an advantage. ' : ''}` : 'No validated baseline with matching valuation and retained work was returned. '}These are model estimates, not measured savings or a general performance claim.</p>
    </div>
    <figure className="loss-chart"><figcaption><strong>Lower estimated loss is better.</strong><span>Shared scale: {money(0)}–{money(maximum)}.</span></figcaption>{series.map((v,i)=><div className="loss-series" key={v.name}><div><span>{v.name}</span><strong>{money(v.value)}</strong></div><div className="loss-track" aria-hidden="true"><div className={`loss-bar series-${i}`} style={{width:`${maximum ? v.value/maximum*100 : 0}%`}}/></div></div>)}</figure>
    <p className="comparison-note">Generation snapshot: clock {current.scenario.now_minute}, cutoff {current.scenario.deadline} min; same resources and valuation model. {money(estimate.retained)} retained simulated benefit is included equally. No additional protection means no new scheduled work; retained work stays protected. Later reports do not change this snapshot.</p>
    <details className="comparison-method"><summary>Chart values · accessible table</summary><table><caption>Estimated residual loss at generation, INR</caption><thead><tr><th>Strategy</th><th>Estimated loss remaining</th></tr></thead><tbody>{series.map(v=><tr key={v.name}><th scope="row">{v.name}</th><td>{money(v.value)}</td></tr>)}</tbody></table></details>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Strategy estimates, scroll horizontally for all columns"><table><thead><tr><th>Strategy</th><th>Additional estimated benefit</th><th>Estimated residual loss</th><th>Planned lots</th><th>Validation</th></tr></thead>
      <tbody>{[current.plan,...estimate.baselines].map(p => <tr key={p.strategy} className={p.strategy === 'CP-SAT' ? 'optimized-row' : ''}>
        <td><strong>{p.strategy === 'CP-SAT' ? 'Optimised plan (CP-SAT)' : p.strategy}</strong></td><td>{money(p.planned_saved_inr)}</td><td>{money(p.residual_loss_inr)}</td><td>{p.tasks.length}</td><td><span className={`pill ${p.validation.valid ? 'success' : 'warning'}`}>{p.validation.valid ? 'Passed' : 'Failed'}</span></td>
      </tr>)}</tbody></table></div>
    <details className="comparison-method"><summary>Strategy rules and solver evidence</summary>
      <p>Highest value first prioritises material value. Highest loss first prioritises assumed exposed loss. Loss per worker-minute prioritises estimated benefit per minute of crew time. Each rule chooses the highest-benefit feasible action for each lot in that order.</p>
      <p>CP-SAT considers the combined assignments. Solver status: <strong>{current.plan.solver_status}</strong>; solve time {current.plan.solve_seconds.toFixed(2)}s; additional benefit upper bound {current.plan.best_bound_inr === null ? 'unavailable' : money(current.plan.best_bound_inr)}. “OPTIMAL” applies only under these model assumptions. INR benefits are rounded down to whole rupees.</p>
    </details>
  </section>;
}
