# DryStock Phase 2 completion report

The existing application was extended. No commit, push or AWS cloud deployment was performed. The original 37 tests, production build and two historical benchmarks were reproduced before implementation. The original fictional lot data was preserved.

## Files added or modified

Modified: `.gitignore`, `README.md`, `VERIFICATION.md`, `Start-DryStock.ps1`; `backend/app/main.py`, `models.py`, `store.py`, `validator.py`; `frontend/app/page.tsx`, `globals.css`, `frontend/lib/types.ts`, `frontend/package.json`, `package-lock.json`.

Added application code: `backend/app/engine.py`, `compute.py`, `lambda_handler.py`; `backend/benchmarks/__init__.py`, `suite.py`, `run.py`; `backend/tests/test_compute.py`, `test_benchmarks.py`; `frontend/app/demo-comparison.tsx`, `frontend/eslint.config.mjs`.

Added SAM packaging/reproduction: `.dockerignore`; `sam/template.yaml`, `Dockerfile`, `requirements.txt`, `prepare_events.py`, `verify_response.py`, `capture_demo.py`, `Invoke-Verify.ps1`, `Start-Api.ps1`, `README.md`, `events/original.json`, `events/disruption.json`.

Added documentation: `DEMO_SCRIPT.md`, this report. Added evidence: `artifacts/phase2/BENCHMARKS.md`, `benchmarks.json`, `end-to-end.json`, desktop/strategy/mobile screenshots; `artifacts/sam-original-runtime.log`, `sam-disruption-runtime.log`, corresponding `*-response.json` and `*-comparison.json`; `sam-api-original.json`, `sam-api-comparison.json`. Local virtual environments, builds, databases and dependencies are ignored.

## Actual AWS execution and reproduction

**Verified:** AWS SAM CLI 1.168.0 built a Linux Lambda image and executed the real shared OR-Tools engine for both historical events. A real SAM local API handled HTTP generation, including the browser disruption workflow. Lambda remains stateless; FastAPI revalidates each actual response before SQLite persistence. SAM failure has no local fallback.

Successful commands from the repository root:

```powershell
rtk proxy powershell -NoProfile -File sam\Invoke-Verify.ps1
rtk proxy powershell -NoProfile -File sam\Start-Api.ps1
rtk proxy powershell -NoProfile -File .\Start-DryStock.ps1 -ComputeBackend sam -Database artifacts\phase2-demo.sqlite3 -BackendPort 8001 -FrontendPort 3002
rtk proxy .\.venv\Scripts\python.exe sam\capture_demo.py --port 8001
```

The first wrapper executes actual `sam validate --lint`, `sam build` and two `sam local invoke ProtectionFunction` commands, then independently compares their responses with local execution. Expanded exact commands, installation and architecture: [SAM guide](sam/README.md). The second and third commands run in separate terminals. Open http://127.0.0.1:3002; reset only the isolated demo yard, then generate → compare → approve → record L02 → trigger disruption → regenerate → compare. The read-only capture runs after that workflow. [DEMO_SCRIPT.md](DEMO_SCRIPT.md) covers a 2:50 recording.

## Modelled results

| Scenario | Local CP-SAT | Actual SAM CP-SAT | Strongest baseline | Gain |
|---|---:|---:|---:|---:|
| Original | ₹35,809 | ₹35,809 | ₹35,550 | ₹259 / 0.73% |
| Historical disruption | ₹16,821 | ₹16,821 | ₹14,985 | ₹1,836 / 12.25% |

All three baseline modelled outcomes also match between local and SAM. Schedules are independently valid; worker identities and start times may differ between Windows Python 3.14.6 and Linux Python 3.12.15. Both use OR-Tools 9.15.6755. Results are OPTIMAL under the fictional model, not measured savings.

Disruption retains L02 on T2, simulated completed benefit ₹5,850, clock 12, cutoff 35 and disabled forklift. Four new actions address ₹16,821, leaving six lots unscheduled and residual assumed loss ₹31,559. The actual SAM UI revision schedules 1,530 kg, retains 500 kg simulated complete and leaves 3,650 kg unscheduled exposed. Scheduled kilograms are not waste prevented.

The fixed **29-case suite** produced 29 OPTIMAL results, zero FEASIBLE/unproven results and zero time-budget exits. All optimiser and baseline schedules passed independent validation. **14 improve (48.28%); 15 tie (51.72%)**. Mean absolute gain ₹1,089.34; median ₹0; best ₹7,150; worst ₹0. Relative mean 5.56%, median 0.18% over 27 nonzero-baseline cases. Two zero-baseline percentages are undefined. There were no baseline wins. The suite varies deadlines, crews, forklift, asset capacity/availability, compatibility, quantities, durations and synthetic loss assumptions with fixed seeds 1101–1110. Inputs were not retuned after results. [Full evidence](artifacts/phase2/BENCHMARKS.md).

## Checks executed

| Check | Result |
|---|---|
| Original backend suite before edits | 37 passed, 0 failed |
| Final backend suite | 62 passed, 0 failed; one upstream Starlette warning |
| Explicit TypeScript `tsc --noEmit` | Passed |
| ESLint CLI with zero-warning limit | Passed |
| Next.js 16.4.0 production build | Passed |
| npm audit | 0 vulnerabilities |
| Real SAM image build and template lint | Passed |
| Real SAM invocations | 2/2 verified against local |
| Real SAM API and UI disruption | Passed; actual response independently checked |
| Fixed benchmark suite | 29/29 usable, optimal and independently valid |
| Desktop/mobile inspection | Passed; no mobile document overflow |
| Git whitespace check | Passed |

Commands: `rtk proxy .\.venv\Scripts\python.exe -m pytest backend/tests -q`; `rtk proxy npx tsc --noEmit`, `rtk proxy npm run lint`, `rtk proxy npm run build`, `rtk proxy npm audit` from `frontend`; `rtk proxy .\.venv\Scripts\python.exe backend/benchmarks/run.py` from root. Test counts do not treat Python handler tests or stub transports as real SAM invocations.

## Submission and remaining limits

Implementation, reproduction scripts, evidence and demo outline are complete. The video itself has **not** been recorded or submitted. Record/export the walkthrough, prepare event-required materials and verify the organiser's current eligibility/submission rules. There is no demonstrated customer adoption or physical-yard validation. No live forecast, calibrated damage model, partial/in-progress work or production authentication was added.

Under the event pathway described in the supplied brief, actual AWS SAM open-source usage is the intended qualifying route; cloud deployment is therefore not needed for this demonstration. Organiser acceptance is not independently verified. Deployment is optional, needs separate permission, and should follow authentication and hosting/persistence work; it is not recommended merely to add an AWS badge.

Owned verification servers on 3001/3002/8001 were stopped; the existing user's port-8000 service was preserved. Docker Desktop remains available for reproduction. No AWS credentials or account settings were changed.
