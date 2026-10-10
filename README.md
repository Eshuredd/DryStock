# DryStock

A working local MVP for weather-aware material protection planning at recycling yards. Built for **Bharat Builds Environmental Hacks — Waste & Energy track, powered by AWS**. Local operation requires no AWS account. There is no deployment, live forecast, authentication or scientifically calibrated damage model.

The central decision is which whole lots to cover or relocate before rain, using limited crews, compatible tarpaulins, forklifts and covered positions. Leaving a lot exposed is always feasible and consumes nothing. Existing recycling software already handles inventory and warehouse operations; DryStock demonstrates a narrower resource-constrained planning problem, rather than claiming an absence of competitors.

## Run locally on Windows

Prerequisites: Python 3.12–3.14, Node.js 20.9+ (tested with 22.19), npm and `rtk` as required by this workspace's instructions. Dependencies are already installed in this checkout.

```powershell
.\Start-DryStock.ps1
```

For a fresh checkout:

```powershell
.\Start-DryStock.ps1 -Install
```

Open [DryStock](http://127.0.0.1:3000) and [interactive API docs](http://127.0.0.1:8000/docs). The launcher runs the backend in a hidden process, runs the frontend in this terminal, and stops the backend when the launcher exits. If local execution policy blocks the script, use the two-terminal commands below; no system policy change is required.

Backend terminal, from the project root:

```powershell
rtk proxy .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Frontend terminal:

```powershell
Set-Location frontend
rtk proxy npm.cmd run dev
```

The Next.js server forwards `/api/*` to FastAPI. Set `BACKEND_URL` to change that upstream. SQLite defaults to `backend/drystock.sqlite3`; set `DRYSTOCK_DB` to change its path. Services bind to loopback; the demo has no authentication.

## Demonstrate the workflow

1. Generate a plan. Review the timeline, work instructions and independent validation result.
2. Open **Compare strategies**. CP-SAT and three greedy rules use the same constraints; the interface reports improvements, ties, or a stronger baseline honestly.
3. Approve the draft as manager. Completion is blocked until approval.
4. Record L02 complete. In this demonstration, the action is attested as executed at its scheduled times. The scenario clock advances to its finish and its tarp remains allocated.
5. Revise the scenario: cutoff 35, elapsed 12, forklift unavailable. Apply changes. The old plan and its approval become superseded.
6. Generate and approve a new draft. Completed work remains protected; new work starts at/after elapsed time with available resources. Compare the revised results.
7. Reload or restart the backend: approvals, completion records and audit events persist. **Activity** includes scenario snapshots for each stored plan. Reset restores the fictional yard while retaining audit and plan history.

The supplied brief ended mid-sentence at “This must remain” in the leave-unprotected section. The implementation treats that choice as always available and uses the supplied scope for the remaining workflows.

## Planning model and correctness

Each eligible action enumerates compatible crew, tarp/bay and forklift assignments. A CP-SAT Boolean selects the assignment and an optional interval schedules it at integer-minute resolution. At most one action is selected per lot. Per-worker and per-forklift no-overlap constraints enforce contention. At most one selected lot occupies each tarp or covered position for the event. Selected action intervals must fit inside every assigned person's and forklift's availability and the handling cutoff. Explicit skill fields enforce handling qualifications.

The objective maximises additional assumed loss avoided, equivalent to minimising residual loss while holding completed work fixed. Currency uses whole rupees and effectiveness uses integer basis points. The solver gets five seconds, one search worker and seed 7. Results expose OPTIMAL/FEASIBLE status, time and the additional-benefit upper bound. FEASIBLE does not imply optimal. UNKNOWN results return a retryable 503; an empty valid plan is possible when there are no feasible actions. Scheduling does not minimise finish time or labour as a secondary objective.

The independent validator imports neither OR-Tools nor assignment enumeration. It recomputes benefits, checks permitted actions, duration, cutoffs, crew identity/count/skills/availability, equipment, category/weight compatibility, persistent asset consumption, duplicate lot actions and pairwise resource overlaps. It validates completed history as well as new tasks. Optimiser and baseline outputs must pass validation; drafts are revalidated at approval.

Baselines order lots by highest material value, highest exposed loss, or maximum assumed benefit per worker-minute. For each lot, they select the highest-benefit feasible action, then earliest start, enumerating integer start times. They do not optimise the entire set of decisions. Comparison tables are snapshots at generation and include the same already-completed benefit for every strategy.

SQLite transactions serialise writes and optimistic revision numbers reject stale yard changes with HTTP 409. Plan generation preserves a scenario snapshot, invalidates earlier drafts/approvals, and writes audit events. Disruptions invalidate active approval. Completed history is immutable until an explicit demo reset. Completed tarps/bays cannot be reassigned. The clock cannot move backwards, and a revised cutoff cannot precede elapsed/completed work.

## Assumptions and operational limits

Weather, yard identity, material prices, expected losses and effectiveness are fictional assumptions. No scientific accuracy claim is made. Exposure/vulnerability inform operators; the optimiser uses the entered expected loss once, not an invented rain-damage equation. See [sample-data/README.md](sample-data/README.md).

Completion records are explicitly **simulated, operator-attested execution at scheduled times**, not proof of real work or a live dispatch system. Multiple overlapping tasks can be recorded in either order because their attested intervals are fixed. The clock advances to the latest recorded finish. Approval remains valid for recording remaining tasks from that same schedule. Replanning restarts every unfinished task in full at/after the clock; there are no partial or in-progress operations in this MVP. Before operational use, add actual start/finish capture, in-progress locks and remaining work, delay handling, inspections and evidence.

Other limits: whole lots, one lot per protection resource, a single rain event, deterministic durations, no travel/setup between tasks, no rainfall uncertainty, no weather-adjusted residual damage, no resource failure recovery for *already completed* protection, and no arbitrary editable yard configuration in the UI. The JSON fixture can be changed before initialisation or a demo reset; planning modules also accept typed custom scenarios programmatically. FastAPI's `/api/validate` supports independent validation of supplied scenarios and tasks.

## Tests and verification

```powershell
Set-Location backend
rtk proxy C:\Users\eshum\OneDrive\Desktop\TransitShift\.venv\Scripts\python.exe -m pytest -q
Set-Location ..\frontend
rtk proxy npm.cmd run build
rtk proxy npm.cmd audit
```

For other checkouts, substitute the absolute Python path or use `rtk proxy python -m pytest -q` after activating the venv. Tests cover small optima against an independent exhaustive search, baseline equivalence and demonstrated advantage, disabled workers/equipment, availability/skills, cutoff edge cases, resource incompatibility, worker/forklift overlap, tampered benefits, completed-resource preservation, transactional approval/completion/disruption, stale writes, persistent restart, and finishing all tasks. See [VERIFICATION.md](VERIFICATION.md) for the recorded results.

Frontend dependencies are pinned by `frontend/package-lock.json`; exact tested Python dependencies are in `backend/requirements.lock.txt`. `requirements.txt` describes compatible major-version ranges. The tests use Starlette's HTTPX adapter, which currently emits an upstream deprecation warning; tests pass.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Local health / simulated mode |
| `GET /api/state` | Scenario, revision, latest plan and recent audit events |
| `POST /api/plans` | Optimise + compare, save a draft; body `{ "revision": 0 }` |
| `POST /api/plans/{id}/approve` | Approve current validated draft with revision |
| `POST /api/plans/{id}/tasks/{lot}/complete` | Record scheduled simulated completion with revision |
| `POST /api/disruptions` | Cutoff/elapsed/forklift/worker changes with revision |
| `GET /api/plans` | Latest 30 plans with original scenario snapshots |
| `POST /api/validate` | Independently check supplied `{scenario, tasks}` |
| `POST /api/reset` | Restore sample yard with revision; retain audit history |

No endpoint sends messages, accesses weather providers, deploys, or touches AWS.

## Structure and future AWS path

`frontend/`: Next.js App Router, TypeScript, Tailwind CSS, responsive operational UI.
`backend/app/`: Pydantic schemas, CP-SAT optimiser, independent validator, baseline schedules, SQLite store and FastAPI routes.
`backend/tests/`: Pytest tests. `sample-data/`: reproducible fictional fixture. `Start-DryStock.ps1`: local launcher.

An optional later AWS architecture can run the FastAPI service in an ECS/Fargate container, serve the frontend behind a managed HTTPS endpoint, and migrate SQLite to an appropriate managed database. A weather-provider adapter, event ingestion and scheduler can be added behind explicit forecast/scenario schemas. The optimiser and validator remain ordinary Python functions with no AWS imports. This is a future architecture option, not a deployed integration.

CP-SAT implementation follows Google's [optional interval and resource scheduling documentation](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md) and [solver status documentation](https://developers.google.com/optimization/cp/cp_solver).
