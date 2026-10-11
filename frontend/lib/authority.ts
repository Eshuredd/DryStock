import type {Task, YardState} from './types';

type Context = {planId: string | null; revision: number};
export type Operation = {
  kind: 'generate' | 'approve' | 'complete' | 'scenario' | 'disruption' | 'reset';
  scope: string; path: string; success: string; extra?: object; planId?: string; lotId?: string;
};
export type Feedback = {
  scope: string; message: string; failed: boolean; recovery: boolean;
  origin: Context | null; context: Context | null;
};
export type AuthorityState = {
  data: YardState | null; authority: 'checking' | 'confirmed' | 'uncertain';
  pending: string | null; feedback: Feedback | null;
};
const initial: AuthorityState = {data:null, authority:'checking', pending:null, feedback:null};
const context = (data: YardState): Context => ({planId:data.latest?.id || null, revision:data.revision});
const sameContext = (a: Context, b: Context) => a.planId === b.planId && a.revision === b.revision;
export const canExecute = (s: AuthorityState) => s.authority === 'confirmed' && !s.pending &&
  s.data?.latest?.state === 'approved' && s.data.latest.revision === s.data.revision;
export function scopedFeedback(s: AuthorityState, scope: string) {
  const f = s.feedback;
  return f?.scope === scope && f.context && s.data && sameContext(f.context,context(s.data)) ? f : null;
}
function sameTask(a: Task, b: Task) {
  return a.lot_id === b.lot_id && a.action === b.action && a.start === b.start && a.end === b.end &&
    a.tarp_id === b.tarp_id && a.storage_id === b.storage_id && a.forklift_id === b.forklift_id &&
    a.saved_loss_inr === b.saved_loss_inr && a.worker_ids.join(',') === b.worker_ids.join(',');
}
function confirmedOperation(op: Operation, origin: YardState, current: YardState, acknowledgement?: YardState) {
  if (op.kind === 'approve') return current.latest?.id === origin.latest?.id &&
    current.revision === origin.revision && current.latest?.revision === current.revision && current.latest?.state === 'approved' &&
    (!acknowledgement || (acknowledgement.latest?.id === origin.latest?.id && acknowledgement.latest?.state === 'approved' && acknowledgement.revision === origin.revision));
  if (op.kind === 'complete') {
    const task = origin.latest?.plan.tasks.find(t => t.lot_id === op.lotId);
    return Boolean(task && !origin.scenario.completed.some(t => t.lot_id === op.lotId) &&
      current.scenario.completed.some(t => sameTask(task,t)));
  }
  if (!acknowledgement) return false;
  if (op.kind === 'generate') return current.latest?.id === acknowledgement.latest?.id &&
    current.latest?.state === 'draft' && current.latest.revision === current.revision && current.revision === origin.revision;
  return current.revision === acknowledgement.revision && JSON.stringify(current.scenario) === JSON.stringify(acknowledgement.scenario);
}

/** Coordinates reads and mutations for one mounted workspace. Never replays a POST. */
export function createAuthorityController(fetchApi: (path: string, options?: RequestInit) => Promise<Response>) {
  let state = initial, sequence = 0, lifetime = 0, alive = true;
  let readAbort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (update: Partial<AuthorityState>) => {
    if (!alive) return;
    state = {...state,...update}; listeners.forEach(fn => fn());
  };
  const invalidateReads = () => {sequence++; readAbort?.abort(); readAbort = null;};
  async function read() {
    invalidateReads(); const ticket = sequence, life = lifetime;
    const abort = new AbortController(); readAbort = abort;
    try {
      const r = await fetchApi('/api/state',{cache:'no-store',signal:abort.signal});
      if (!r.ok) throw new Error('Current state could not be checked.');
      const data: YardState = await r.json();
      if (!alive || life !== lifetime || ticket !== sequence) return null;
      return data;
    } finally {if (ticket === sequence) readAbort = null;}
  }
  async function refresh(background = false) {
    if (!alive || state.pending || (background && readAbort)) return false;
    publish({authority:'checking'});
    const ticket = sequence + 1, life = lifetime;
    try {
      const data = await read(); if (!data) return false;
      const f = state.feedback;
      const obsolete = f?.context && !sameContext(f.context,context(data));
      publish({data,authority:'confirmed',feedback:background && !f ? null : background && f && !f.failed && !obsolete ? f : {
        scope:'state',message:obsolete ? 'Plan changed. Current state loaded; review the current plan.' : 'Current state checked.',
        failed:false,recovery:false,origin:null,context:null
      }});
      return true;
    } catch {
      if (alive && life === lifetime && ticket === sequence) publish({authority:'uncertain',feedback:{
        scope:'state',message:'Current state could not be checked. Cached assignments are not confirmed; approval and simulated reporting are disabled. Refresh state to recover.',
        failed:true,recovery:true,origin:state.feedback?.origin || null,context:null
      }});
      return false;
    }
  }
  async function mutate(op: Operation) {
    if (!alive || state.pending || state.authority !== 'confirmed' || !state.data) return false;
    const origin = state.data, life = lifetime;
    if ((op.kind === 'approve' || op.kind === 'complete') &&
      (!origin.latest || origin.latest.id !== op.planId || origin.latest.revision !== origin.revision ||
       origin.latest.state !== (op.kind === 'approve' ? 'draft' : 'approved'))) return false;
    invalidateReads();
    publish({authority:'checking',pending:op.kind === 'generate' ? 'generate' : op.kind === 'approve' ? 'approve' : op.scope,feedback:null});
    let acknowledgement: YardState | undefined, rejection: string | undefined, ambiguous = false;
    let uncertainty = `The ${op.kind === 'approve' ? 'approval' : op.kind === 'complete' ? 'completion' : 'action'} response was lost.`;
    try {
      const r = await fetchApi(op.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:origin.revision,...op.extra})});
      // 409/4xx rejects the request. A gateway/server 5xx can follow a committed write.
      if (!r.ok) {
        let detail = r.status >= 500 ? 'No readable server acknowledgement.' : `The server rejected this action (HTTP ${r.status}).`;
        try {const body = await r.json(); if (typeof body.detail === 'string') detail = body.detail;} catch { /* Keep the HTTP status when no readable detail exists. */ }
        if (r.status >= 500) {ambiguous = true; uncertainty = `Server error (HTTP ${r.status}): ${detail} The action outcome was not acknowledged.`;}
        else rejection = detail;
      } else acknowledgement = await r.json();
    } catch {ambiguous = true;}
    if (!alive || life !== lifetime) return false;
    // Cached data never supplies execution authority after a rejection or lost response.
    publish({authority:'checking'});
    try {
      const current = await read(); if (!current || !alive || life !== lifetime) return false;
      const confirmed = confirmedOperation(op,origin,current,acknowledgement);
      const stillOriginPlan = current.latest?.id === origin.latest?.id;
      let message = op.success, failed = false, target: Context | null = context(current);
      if (rejection) {
        const replaced = !stillOriginPlan || current.revision !== origin.revision;
        const cause = rejection === 'Yard changed. Refresh and try again.' ? 'Yard changed.' : rejection;
        message = `Action rejected${replaced ? ' for the earlier plan' : ''}: ${cause} Current state loaded.${current.latest?.state === 'draft' ? ' Review the current draft before approving.' : ''}`;
        failed = true;
        if (replaced) target = null;
      } else if (ambiguous) {
        message = confirmed && op.kind === 'approve' ? `${uncertainty} ${current.latest?.plan.tasks.length === 0 ? 'Current state confirms this zero-action decision is approved; no additional work is enabled.' : 'Current state confirms this plan is approved; simulated reporting is available.'}`
          : confirmed && op.kind === 'complete' ? `${uncertainty} Current state confirms ${op.lotId} is reported complete (simulated).`
          : `${uncertainty} Current state loaded; the request was not retried. Review the current plan before taking another action.`;
        failed = !confirmed;
        target = null;
      } else if (!confirmed) {
        message = `Plan changed. Current state loaded; review the current ${current.latest?.state === 'draft' ? 'draft' : 'plan'}. The earlier response does not authorize obsolete assignments.`;
        target = null;
      } else if (!stillOriginPlan && op.kind === 'complete') {
        message = `${op.lotId} simulated completion is confirmed and retained. Plan changed; review the current plan.`; target = null;
      }
      publish({data:current,authority:'confirmed',pending:null,feedback:{scope:op.scope,message,failed,recovery:false,origin:context(origin),context:target}});
      return Boolean(acknowledgement && !rejection && !ambiguous && confirmed);
    } catch {
      if (alive && life === lifetime) publish({authority:'uncertain',pending:null,feedback:{
        scope:op.scope,message:`${rejection ? `Action rejected: ${rejection}` : ambiguous ? `${uncertainty} The action may have been saved.` : 'The server acknowledged the action, but current plan authority is not confirmed.'} Current state could not be checked. Approval and simulated reporting are disabled. Refresh state; the request will not be retried automatically.`,
        failed:true,recovery:true,origin:context(origin),context:null
      }});
      return false;
    }
  }
  return {
    getSnapshot: () => state, getServerSnapshot: () => initial,
    subscribe: (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};},
    refresh, mutate,
    start: () => {alive = true; lifetime++; void refresh(true);},
    suspend: () => {if (!alive) return; if (!state.pending) invalidateReads(); publish({authority:'uncertain'});},
    dispose: () => {alive = false; lifetime++; invalidateReads();}
  };
}
