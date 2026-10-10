# Verification record

Verified locally on 10 October 2026 (Asia/Kolkata). No deployment, commit or push was performed.

## Automated checks

- **37 Pytest tests passed**. Includes independent exhaustive enumeration of small single-worker instances, sample optimality/baseline advantage, equivalent baseline result, short/zero cutoffs, disabled workers and equipment, resource capacity/category, skill/availability, worker and forklift overlaps, tampered benefit, preservation of completed assets, stale revision rejection, approval gates, full-plan completion, restart persistence and disruptions.
- **Next.js 16.4.0 production build passed**, including TypeScript validation, after the final frontend changes.
- **npm audit: zero vulnerabilities** with the installed package lock. Next.js was updated from the initial version after its PostCSS dependency triggered an audit finding.
- FastAPI health returned `{"status":"ok","mode":"simulated"}`; frontend root returned HTTP 200.
- `Start-DryStock.ps1` launched both services and served the frontend successfully. A backend restart preserved completed history and the revised plan.
- Test output includes one upstream Starlette warning about its HTTPX TestClient adapter deprecation; this does not fail tests.

## Benchmark results

All amounts below are estimated INR from the fictional fixture; they are not measured savings. Baselines obey the same scheduling/resource constraints.

| Strategy | Original 60-minute cutoff: additional benefit | 35-minute cutoff, L02 complete, clock 12, no forklift: additional benefit |
|---|---:|---:|
| CP-SAT (OPTIMAL) | 35,809 | 16,821 |
| Highest value first | 34,308 | 14,059 |
| Highest loss first | 35,550 | 14,059 |
| Loss per worker-minute | 27,855 | 14,985 |
| Gain over strongest baseline | **259 (0.73%)** | **1,836 (12.25%)** |

Initial assumed exposed loss: ₹54,230. The original plan's residual loss is ₹18,421. In the disruption scenario, completed benefit is ₹5,850, additional planned benefit is ₹16,821 and residual loss is ₹31,559. The completed tarp T2 remains allocated to L02. The independent validator passes both schedules. A separate automated single-lot fixture proves the baseline can match optimisation; the UI explicitly reports a tie.

Reproduce without modifying the database:

```powershell
rtk proxy .\.venv\Scripts\python.exe backend\demo_report.py
```

Machine-readable results: [artifacts/benchmark.json](artifacts/benchmark.json).

## Browser workflow checks

Using the real Next.js interface and FastAPI/SQLite service:

1. Generated the original five-task plan; completion buttons were disabled before approval.
2. Approved the plan and recorded L02 complete. Completed benefit changed to ₹5,850; pending benefit changed to ₹29,959, preserving the total.
3. Applied earlier rain/cutoff 35 and forklift loss at elapsed minute 12. The former approval was superseded; completed protection remained allocated.
4. Generated a revised four-task draft. All new tasks begin at/after minute 12 and finish by 35. No task uses the forklift or L02's tarp.
5. Confirmed comparison results against all three baselines and no browser error/warning logs during the production workflow.
6. Searched inventory for L05; only the matching lot remained. Verified status differences between planned, completed, exposed and already sheltered.
7. Confirmed audit/plan history and fixed history refresh after generating a plan while on the Activity tab.
8. Restarted services through the launcher and confirmed persisted state.
9. Inspected layouts at 1440×1000 and 390×844. At the mobile width the document did not overflow horizontally; tables have their own horizontal scrolling. Restored the preview viewport afterward.
10. Restored the original fictional yard and generated a current validated draft for the next demonstration. Audit history remains.

Screenshots: [original dashboard](artifacts/drystock-dashboard.jpg), [replanned yard](artifacts/replanned-yard.jpg), [mobile view](artifacts/mobile.jpg).

Temporary verification servers are stopped after checks. Use the launcher to resume locally. This verification covers the local MVP and does not establish real-yard safety, scientific loss accuracy or production deployment readiness. Completion is scheduled-time simulated attestation; partial/in-progress work is intentionally outside scope.
