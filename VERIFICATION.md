# Verification record

## Existing cloud application update, 11 October 2026

The existing [public DryStock demo](https://d38gzj2yabm82w.cloudfront.net) now includes commit `1d5e337` in both its Lambda backend and Next.js frontend. The code-only processed-template change preserved all nine resource IDs and existing roles, capacities and parameters. Current results: 113 backend tests, 50 frontend tests, 18 deployment-script cases, lint, TypeScript, SAM lint and production static export passed. Live sample/custom API workflows and reset stages passed; overlapping checks exposed real DynamoDB capacity failures, retained in the evidence. See [deployment details](DEPLOYMENT.md) and [the current release report](artifacts/cloud-update/REPORT.md) for final quota/browser results and inspection limitations.

The earlier dated records below are historical verification, including the original access pause; their benchmark results have not been rewritten.

## Phase 3 — preparation and access pause, 10 October 2026

**Deployment: not performed. Website/API URLs: unavailable. Real cloud smoke tests and public browser/isolation checks: not run.** The user explicitly paused cloud deployment pending a new least-privilege `drystock-deploy` identity. No IAM changes, credentials, root use, policy escalation, ECR upload, cloud stack or budget creation occurred. No commit/push occurred.

The existing `ridewatch` profile authenticated in `ap-south-1` but received AccessDenied for `cloudformation:DescribeStacks` on `drystock-demo`, `lambda:GetAccountSettings` and `iam:SimulatePrincipalPolicy`. No further deployment attempt was made with it. The new profile has not been supplied or STS-verified; permissions cannot be represented as granted.

Executed checks:

- Before edits: 62 existing backend tests and Next.js 16.4 production build passed.
- Current backend: **83 passed, 0 failed**, one upstream Starlette warning. Twenty-one new tests use **Moto**, not real DynamoDB. They cover unpredictable tokens, partition isolation, explicit expiry before TTL deletion, request/compute quotas and leases, CAS approval races, stale revision rejection, full approval/completion/disruption/replanning, resource preservation, new-client persistence, tampered baseline/plan checks, input bounds, CORS and sanitized compute/storage failures. Lease-cleanup failure preserves an already committed success; transaction capacity failures report unavailability rather than a false revision conflict.
- Frontend API client: **6 passed, 0 failed**, built-in Node test runner. Checks local routing, shared first-session creation, bearer headers, reload retention, GET expiry recovery, no expired mutation replay and external-path rejection.
- TypeScript, ESLint and ordinary production build passed. Static export build also passed with explicitly fictitious `https://api.example.invalid` configuration to prove export compatibility; it is **not an API endpoint or deployment**. Production deployment will rebuild using actual stack outputs. Local build configuration remains the default.
- Both `sam/cloud-template.yaml` and owner-only `sam/bootstrap-template.yaml` passed SAM lint. IAM JSON review files were generated locally; no AWS IAM validation/simulation or permission changes were performed.
- Cloud-compatible Linux container built successfully; actual **local SAM health invocation** returned HTTP 200. [Runtime log](artifacts/phase3/cloud-health-sam.log). This checks handler imports/native packaging only, not a cloud deployment or live DynamoDB workflow.
- The retained Build It function was rebuilt and both real **local SAM** historical optimiser invocations again matched local outcomes: original 35,809/best 35,550 and disruption 16,821/best 14,985. Historical sample values and objectives were unchanged. Phase 2 evidence is retained; new regression logs are under `artifacts/phase3/`.
- The original fixed 29-case benchmark was rerun without changing its cases; all 29 OPTIMAL, 14 improvements/15 ties, no time-budget exits. Historical inputs remain unchanged.
- `sam/Deploy-Cloud.ps1` ran only in default review mode: no AWS calls/provisioning. The `-Provision` path and `sam/cloud_smoke.py` remain **unexecuted**. CloudFormation policy/provider details require authorised live verification.

Prepared implementation: shared local/cloud workflow rules, DynamoDB transactions and hashed session capabilities, stateless cloud API handler, bounded quotas/TTL, configurable static frontend, image/API/DynamoDB/S3/CloudFront SAM template, separated IAM roles and deployment/smoke scripts. Review [IAM package](sam/IAM_ACCESS.md). Pending acceptance: authorised profile, owner bootstrap, live IAM/account limits, real deployment, public browser workflow, two-fresh-browser isolation, CORS/mobile/HTTPS/console checks and recorded cloud invocation evidence. This phase is **prepared but incomplete**, not a completed Ship It deployment.

## Phase 2 — final verification, 10 October 2026

The sections below this Phase 2 record retain the historical 37-test MVP evidence. Current final results supersede its test counts and compute architecture.

- Backend: **62 passed, 0 failed**, one upstream Starlette HTTPX-adapter deprecation warning. The original 37 passed before edits. New checks cover the shared contract, invalid Lambda events, status handling, time-budget errors, tampered task/summary/baseline rejection, no fallback or persistence on SAM failure, old SQLite migration, stale approval, and deterministic benchmark/statistical calculations.
- Frontend: explicit `tsc --noEmit` passed; ESLint passed with zero warnings; final production build passed. `npm audit` returned zero vulnerabilities. ESLint uses TypeScript and React Hooks checks; it does not use the Next-specific ESLint plugin.
- Real AWS SAM CLI **1.168.0**, Docker Desktop 4.47 / Linux engine 28.4: template validation, image build, **two real `sam local invoke` calls**, and `sam local start-api` plus actual HTTP invocation all passed. No credentials or deployment were used. Direct handler tests and stub transport tests are separate from this execution evidence.
- Successful root command: `rtk proxy powershell -NoProfile -File sam\Invoke-Verify.ps1`. API: `rtk proxy powershell -NoProfile -File sam\Start-Api.ps1`. Exact expanded commands and package/runtime configuration: [SAM guide](sam/README.md).
- SAM runtime Python 3.12.15 / OR-Tools 9.15.6755; local Python 3.14.6 / same OR-Tools. Modelled outcomes match for optimiser and every baseline. Worker identities/timings may differ across operating systems; no byte-identical schedule or performance claim is made.
- Original: **₹35,809 vs ₹35,550**, gain **₹259 (0.73%)**, residual ₹18,421. Historical disruption: **₹16,821 vs ₹14,985**, gain **₹1,836 (12.25%)**, completed ₹5,850, residual ₹31,559. Both OPTIMAL and independently validated.
- Expanded benchmark actually executed: **29 OPTIMAL**, 0 FEASIBLE/unproven, 0 time-budget exits; 14 improvements (48.28%), 15 ties (51.72%), no baseline wins. Mean gain ₹1,089.34, median ₹0, best ₹7,150, worst ₹0. Relative mean 5.56%, median 0.18% over 27 nonzero-baseline cases; the other two are undefined, not zero. Fixed generated seeds 1101–1110. Original fixtures were not retuned.
- Real browser workflow ran against Next.js on 3002, FastAPI on 8001, SAM API on 3001, isolated `artifacts/phase2-demo.sqlite3`. Generate/approve/L02-completion/disrupt/regenerate/compare passed. The original plan was superseded, L02/T2 preserved, forklift unavailable, all new work in minutes 12–35, four new tasks and six exposed lots. New weight metrics: 1,530 kg scheduled, 500 kg simulated complete, 3,650 kg unscheduled exposed. Read-only capture independently validated the actual stored SAM response and matching local outcomes.
- Desktop 1440×1000 and mobile 390×844 inspected. At mobile size, document client and scroll widths both 375 pixels (scrollbar excluded); tables scroll within their containers. Action detail expanded to actual L03 inputs (600 kg, ₹2,160 risk, 14 minutes, 85% effectiveness, T1 capacity 1,500 kg, finish 26 ≤ cutoff 35). No browser error/warning entries observed. Temporary viewport override restored.
- User's running port-8000 service and original database were preserved. Owned verification servers were stopped after checks. No commit, push or cloud deployment occurred.

Evidence: [original runtime log](artifacts/sam-original-runtime.log), [disruption runtime log](artifacts/sam-disruption-runtime.log), [original comparison](artifacts/sam-original-comparison.json), [disruption comparison](artifacts/sam-disruption-comparison.json), [actual SAM API comparison](artifacts/sam-api-comparison.json), [real UI state/history](artifacts/phase2/end-to-end.json), [29-case report](artifacts/phase2/BENCHMARKS.md), [full benchmark JSON](artifacts/phase2/benchmarks.json), [desktop](artifacts/phase2/sam-replanned-desktop.jpg), [strategies](artifacts/phase2/sam-strategies.jpg), [mobile plan](artifacts/phase2/sam-mobile-plan.jpg).

Two correctness discrepancies found during audit were fixed: stored baseline/summary metrics were not previously independently checked, and new provenance needed a non-destructive SQLite migration. The launcher now reports the actual database path. All completion remains scheduled-time simulated attestation; no partial work, measured environmental savings, forecast integration or adoption is claimed.

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
