# DryStock

**Phase 3 status:** cloud-compatible code and scoped IAM review are prepared; cloud provisioning is paused until owner-authorised `drystock-deploy` access is configured. No public cloud URL exists yet. Read [IAM access setup](sam/IAM_ACCESS.md), [deployment guide](DEPLOYMENT.md) and [prepared architecture/status](AWS_ARCHITECTURE.md). The existing local and SAM pathways remain supported.

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

Optional cloud-adapter development dependencies: `rtk proxy .\.venv\Scripts\python.exe -m pip install -r backend\requirements-cloud-test.txt`. With them installed, the current suite has 83 passing tests, including 21 cloud tests using local Moto doubles. Without them, the optional cloud tests skip and the local app continues to work. `rtk proxy npm.cmd --prefix frontend run test:api` runs six API-client tests.

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

No endpoint sends messages, accesses weather providers or deploys. In SAM mode, generation calls the loopback AWS SAM API and independently checks the actual Lambda-compatible response before persistence; failed calls never silently fall back to local compute.

## Structure and implemented AWS SAM path

`frontend/`: Next.js App Router, TypeScript, Tailwind CSS, responsive operational UI.
`backend/app/`: Pydantic schemas, CP-SAT optimiser, independent validator, baseline schedules, SQLite store and FastAPI routes.
`backend/tests/`: Pytest tests. `sample-data/`: reproducible fictional fixture. `Start-DryStock.ps1`: local launcher.

`backend/app/engine.py` provides the shared stateless compute contract; `compute.py` selects local or SAM execution; `lambda_handler.py` handles stateless Lambda requests. `sam/` contains the Linux image, SAM template, events and real-execution verification scripts. `backend/benchmarks/` defines 29 fixed benchmark cases. The frontend adds result provenance, separate weight metrics, actual handling-input details and a before/after disruption view.

**AWS SAM actually executed the real optimiser locally.** Both historical outcomes match local execution, including all three baselines. The image uses Linux Python 3.12, x86_64 and OR-Tools 9.15.6755, with 2,048 MB and a 30-second timeout. SQLite and workflow state remain local. Nothing is deployed to an AWS account. The actual architecture, installation, exact build/invoke/API commands and failure semantics are in [sam/README.md](sam/README.md).

After building with `rtk proxy powershell -NoProfile -File sam\Invoke-Verify.ps1`, run these in two terminals from the project root:

```powershell
rtk proxy powershell -NoProfile -File sam\Start-Api.ps1
```

```powershell
rtk proxy powershell -NoProfile -File .\Start-DryStock.ps1 -ComputeBackend sam -Database artifacts\phase2-demo.sqlite3 -BackendPort 8001 -FrontendPort 3002
```

Open [SAM demo](http://127.0.0.1:3002). Use the separate demonstration database; reset it if a prior run is present. Generate → compare → approve → record L02 → trigger demo disruption → generate → compare revised results. Restart the launcher with `-ComputeBackend local` to switch compute mode. The original launcher defaults remain local. Stop both terminals with Ctrl+C when finished.

Reproduce the expanded evidence and frontend checks:

```powershell
rtk proxy .\.venv\Scripts\python.exe backend\benchmarks\run.py
rtk proxy .\.venv\Scripts\python.exe -m pytest backend\tests -q
rtk proxy npm.cmd --prefix frontend run typecheck
rtk proxy npm.cmd --prefix frontend run lint
rtk proxy npm.cmd --prefix frontend run build
rtk proxy npm.cmd --prefix frontend audit
```

The predefined suite contains 29 independently validated cases: 14 improvements, 15 ties, mean absolute gain ₹1,089.34 and median ₹0. All 29 were OPTIMAL; no timeouts occurred. Relative mean is 5.56% and median 0.18% over 27 cases with nonzero baseline benefit. Original and historical disruption fixtures remain unchanged. See [benchmark report](artifacts/phase2/BENCHMARKS.md), [full machine-readable inputs/results](artifacts/phase2/benchmarks.json), [Phase 2 report](PHASE2_REPORT.md) and [2:50 demo script](DEMO_SCRIPT.md).

A cloud deployment is optional for the user-specified AWS open-source SAM pathway and needs separate permission. Before any public deployment, add authentication and suitable hosting/persistence; local SAM execution does not establish cloud readiness or event acceptance.

CP-SAT implementation follows Google's [optional interval and resource scheduling documentation](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/scheduling.md) and [solver status documentation](https://developers.google.com/optimization/cp/cp_solver).
