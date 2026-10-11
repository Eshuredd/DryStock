import type {SavedPlan, Scenario, Task, YardState} from './types';

export const money = (value: number) => new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0}).format(value);
export const benefit = (tasks: Task[]) => tasks.reduce((sum, task) => sum + task.saved_loss_inr, 0);

export function conditionsChanged(before: Scenario, after: Scenario) {
  return before.deadline !== after.deadline || before.now_minute !== after.now_minute || before.rain_arrival_minute !== after.rain_arrival_minute ||
    before.workers.some(w => after.workers.find(a => a.id === w.id)?.enabled !== w.enabled) ||
    before.forklifts.some(f => after.forklifts.find(a => a.id === f.id)?.enabled !== f.enabled);
}

export function deriveWorkflow(data: YardState, history: SavedPlan[]) {
  const scenario = data.scenario;
  const resetAt = data.events.find(e => e.kind === 'demo_reset')?.at;
  const afterReset = (plan: SavedPlan) => !resetAt || Date.parse(plan.created) > Date.parse(resetAt);
  const latest = data.latest && afterReset(data.latest) ? data.latest : null;
  const active = latest?.state !== 'superseded' ? latest : null;
  const completed = new Set(scenario.completed.map(t => t.lot_id));
  const upcoming = active?.plan.tasks.filter(t => !completed.has(t.lot_id)) || [];
  const initialLoss = scenario.lots.filter(l => l.protection_status === 'exposed').reduce((sum, l) => sum + l.exposed_loss_inr, 0);
  const completedBenefit = benefit(scenario.completed);
  const plannedBenefit = benefit(upcoming);
  const previous = latest?.state === 'superseded' ? latest : active ? history.find(p => p.id !== active?.id && afterReset(p) &&
    p.state === 'superseded' && conditionsChanged(p.scenario, scenario) &&
    active.scenario.completed.every(c => [...p.scenario.completed, ...p.plan.tasks].some(t =>
      t.lot_id === c.lot_id && t.start === c.start && t.end === c.end &&
      t.tarp_id === c.tarp_id && t.storage_id === c.storage_id && t.saved_loss_inr === c.saved_loss_inr))) : undefined;
  const revised = Boolean(previous);
  const stateLabel = active ? active.state === 'approved' ? 'Approved' : revised ? 'Revised draft — awaiting approval' : 'Draft — awaiting approval'
    : latest?.state === 'superseded' ? 'Superseded — re-optimisation required' : 'No plan';
  const primaryLabel = active?.plan.tasks.length === 0 ? 'Change conditions' : active?.state === 'draft' ? 'Review assignments'
    : active?.state === 'approved' ? 'View work instructions' : latest?.state === 'superseded' ? 'Re-optimise' : 'Generate plan';
  return {active, completed, upcoming, initialLoss, completedBenefit, plannedBenefit,
    residual: initialLoss - completedBenefit - plannedBenefit, previous, revised, stateLabel, primaryLabel,
    tasks: [...scenario.completed, ...upcoming].sort((a,b) => a.start-b.start || a.lot_id.localeCompare(b.lot_id)),
    unprotected: scenario.lots.filter(l => l.protection_status === 'exposed' && !completed.has(l.id) && !upcoming.some(t => t.lot_id === l.id))};
}

export type View = 'Plan & timeline' | 'Material lots' | 'Compare strategies' | 'Activity';
const viewKeys = {'Plan & timeline':'plan', 'Material lots':'lots', 'Compare strategies':'compare', Activity:'activity'} as const;
export function viewFromQuery(query: string): View {
  const key = new URLSearchParams(query).get('view');
  return (Object.keys(viewKeys) as View[]).find(view => viewKeys[view] === key) || 'Plan & timeline';
}
// Construct only public view/search parameters; never copy session state into a URL.
export function viewHref(view: View, search = '') {
  const query = new URLSearchParams({view:viewKeys[view]});
  if (view === 'Material lots' && search) query.set('q',search);
  return `/?${query}`;
}

export function validateScenarioTimes(cutoff: string, clock: string, minimum: number) {
  const errors: {deadline?: string; elapsed?: string} = {};
  const integer = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const deadline = integer(cutoff), elapsed = integer(clock);
  if (deadline === null || deadline < minimum || deadline > 230) errors.deadline = `Enter a whole-number cutoff from minute ${minimum} to 230.`;
  if (elapsed === null || elapsed < minimum || elapsed > 230 || (!errors.deadline && deadline !== null && elapsed > deadline)) {
    errors.elapsed = `Enter a whole-number elapsed time from minute ${minimum} to ${errors.deadline ? 'the valid cutoff' : deadline}.`;
  }
  return {errors, values: Object.keys(errors).length || deadline === null || elapsed === null ? null : {deadline, now_minute:elapsed}};
}

export function zeroActionExplanation(scenario: Scenario) {
  const pending = scenario.lots.filter(l => l.protection_status === 'exposed' && !scenario.completed.some(t => t.lot_id === l.id));
  if (!pending.length) return 'No eligible exposed lots remain in this scenario.';
  if (!scenario.workers.some(w => w.enabled)) return 'No crew are available.';
  if (scenario.now_minute >= scenario.deadline) return 'The scenario clock has reached the handling cutoff.';
  return 'No additional actions were selected under the current handling and resource limits. A more specific cause is not provided by this result.';
}

export function assignment(task: Task | undefined, scenario: Scenario) {
  if (!task) return 'Leave exposed';
  const names = task.worker_ids.map(id => scenario.workers.find(w => w.id === id)?.name || 'Unknown crew member');
  return `${task.action === 'cover' ? 'Cover with tarp' : 'Move to bay'} · ${task.start}–${task.end} min · ${names.join(', ')} · ${[task.forklift_id,task.tarp_id,task.storage_id].filter(Boolean).join(', ')}`;
}

// Historical total stays fixed, even if a newly scheduled revised task is later completed.
export function comparisonTotals(before: SavedPlan, current: SavedPlan | null, scenario: Scenario) {
  const completedIds = new Set(scenario.completed.map(t => t.lot_id));
  const old = [...before.scenario.completed, ...before.plan.tasks].filter((t,i,all) => all.findIndex(a => a.lot_id === t.lot_id) === i);
  const retained = benefit(scenario.completed);
  const oldRetained = benefit(old.filter(t => completedIds.has(t.lot_id)));
  const oldPending = benefit(old.filter(t => !completedIds.has(t.lot_id)));
  const newPending = current ? benefit(current.plan.tasks.filter(t => !completedIds.has(t.lot_id))) : null;
  return {retained, oldRetained, oldPending, oldTotal: oldRetained + oldPending, newPending, newTotal: newPending === null ? null : retained + newPending};
}
