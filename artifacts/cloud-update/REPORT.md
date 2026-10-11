# Existing DryStock application update — 11 October 2026

**Follow-up throttling review (no new deployment):** see [THROTTLING.md](THROTTLING.md) for measured full-item counter costs, five new local capacity tests, on-demand/provisioned options and verified Mumbai prices. Current checks pass **118 backend / 50 frontend tests**, lint, TypeScript, 18 offline deployment guard cases and a production static export. A fresh public serial generate/approve/complete/disrupt/reload/reset workflow passed. Concurrent AWS reliability remains unverified pending approval of a fix. The stack's optional $5 alert is **not configured** (`BudgetEmail` empty; no budget resource); a separate account alert could not be read because `budgets:ViewBudget` is denied. No capacity, IAM, billing resource or deployment change was made in this review. The original deployment evidence below is preserved.

Deployed clean application source at **`1d5e337`** to the existing `drystock-demo` stack in **ap-south-1**, using only **`drystock-deploy`** in account `071031980923`. Both the backend container and production frontend were updated. No commit, push, new application, IAM expansion or unrelated infrastructure change occurred.

Website: **https://d38gzj2yabm82w.cloudfront.net**. API: **https://x59yh2i1yf.execute-api.ap-south-1.amazonaws.com**.

Lambda `drystock-demo-api` is **`$LATEST`**, updated at `2026-10-11T16:02:55Z`, with resolved image digest / CodeSha256 **`90df6d2f32a6c8c90d7ebc7315fba1dd81991b39f0a05940fb99b7ba2afee41d`**. There is no published numeric version or alias in the existing SAM configuration. [Lambda evidence](lambda.json).

## Deployment and preservation

SAM lint, Docker image build and packaging succeeded using the existing `sam/cloud-template.yaml`, `sam/Cloud.Dockerfile`, ECR repository and artifact bucket. The SAM and Docker configuration files were unchanged.

Reviewed change set **`drystock-1791734464`** before execution. The initial guard stopped on a SAM API dependency. The processed current/proposed templates were then compared in full: **only the Lambda image URI changed**. The resulting safe set modifies Lambda code and refreshes the unchanged API Body dependency on `CloudFunction.Arn`; both show replacement **False**, requires recreation **Never**. No table/bucket/distribution/role/permission deletion, addition or replacement was executed. [Change set](change-set.json), [template proof](template-review.json).

The stack reached **UPDATE_COMPLETE**. All **nine physical resource IDs** are identical before and after. Stack parameters were passed with `UsePreviousValue`; the existing runtime role, CloudFormation role, OAC and empty optional budget parameter were retained. Deployment did not reset, enumerate or perform administrator writes to pre-existing session partitions. Ordinary TTL expiry still applies. [Before](resources-before.json), [after](resources-after.json), [stack outputs and parameters](stack-after.json).

Next.js static export used the actual API endpoint. All 24 exported files were uploaded to the existing site bucket with `s3 cp`, without deleting old objects. CloudFront invalidation **`I7UXKMW06TND6KRGQI3LC7V10U`** covered `/*` and was confirmed **Completed**. [Invalidation](invalidation.json), [deployment outputs](deployment.json).

## Automated and API checks

| Check | Actual result |
|---|---|
| `rtk proxy .venv/Scripts/python.exe -m pytest backend/tests -q` | **113 passed**, one existing upstream Starlette TestClient deprecation warning |
| `rtk proxy npm.cmd test` in frontend | **50 passed**, no failures |
| `rtk proxy powershell -NoProfile -File sam/tests/Deploy-Cloud.Tests.ps1` | **18 passed**; external calls intercepted, no AWS mutations |
| Frontend lint / TypeScript | Passed with no errors |
| SAM template lint | Passed |
| Production static build | Passed, Next.js **16.4.0**, actual AWS API configuration |
| New live verifier Python compilation | Passed |
| `git diff --check` | Passed |

The original live benchmark smoke passed without changing historical results: **₹35,809** initial benefit versus strongest baseline **₹35,550**; disrupted benefit **₹16,821** versus **₹14,985**. Both outputs pass independent verification and match local modeled outcomes. Their invocation IDs match actual CloudWatch START/END/REPORT records. [Benchmark HTTP evidence](benchmark-smoke.json), [invocation logs](invocation-logs.json). The original sample and five historical benchmark/report files match `1d5e337` after line-ending normalization. [Preservation check](fixture-preservation.json).

Reset passed after each of **generation, approval, completion and disruption**. Every checked reset returned the exact original sample, default conditions, empty simulated completions, `latest: null`, `input_source: sample`, and a new scenario epoch. GET state matched the POST result; old plans remained superseded and in earlier epochs, with reset audit events retained. Stale reset revisions returned 409. The first three stages passed before a real capacity failure; the disruption stage then passed in sequential testing. Both records are retained rather than relabeling the failed run as successful. [First run including capacity failure](usability-capacity-failure.json), [completed sequential run](usability-sequential.json).

The live custom workflow exercised actual `/api/scenario` save, optimisation, independent validation, approval, completion of arbitrary lot IDs, reload persistence, replacement rejection after completed work, and reset to the sample. A separate visitor's sample and empty history remained unaffected. Wrong-session approval, unapproved completion and stale scenario revisions returned 409. Tampered output was independently rejected.

Server validation rejected unknown fields, invalid IDs, loss above value, invalid worker availability, incompatible material codes, excessive lots and injected completed work. Invalid requests left state unchanged. An additional well-formed completed history passed the independent history validator locally but was **rejected by the scenario-input endpoint**, proving users cannot inject execution through custom input. A request of **exactly 32 KiB** with valid inputs was accepted; a body over 32 KiB returned **413**. **31 unique lot IDs** were rejected. [Input boundary evidence](input-boundaries.json).

The live application enforced **20 computations** per session and **300 authenticated requests** per session. Reset did not replenish the exhausted compute counter. Fresh small scenarios limited test load. The four-hour expiry was checked against AWS HTTP Date. Shared **100 sessions/hour**, **200 computations/day**, the 35-second lease and engine bounds remain in source and offline conditional-counter tests; shared limits were deliberately not exhausted on the public service. No quota settings were changed.

Missing bearer authentication returned 401, an unapproved Origin returned 403, proper `/api/scenario` preflight succeeded and state responses were not cached. Public HTTP redirected to HTTPS; anonymous direct access to the private S3 `index.html` returned **403 AccessDenied**, while CloudFront served the site. [HTTPS/storage checks](https-storage-checks.json).

## Public browser verification

Tested the **actual public HTTPS website**, using the in-app Chromium browser at desktop size and **390 × 844** mobile viewport. Desktop size restored to width 1280 afterward. There was no document-level horizontal overflow; the mobile document width was 375, allowing for the scrollbar.

Desktop sample workflow: generate, approve, complete L02, apply rain/forklift disruption, reset, inspect clearly labeled historical results. Desktop custom workflow: reject blank required fields inline, enter a custom lot/value/loss/skill/worker/tarp capacity, save, generate, approve, complete, reload, then Use sample yard. Mobile custom workflow independently entered another lot and a 50-minute rain/40-minute cutoff, saved, generated, approved, completed, reloaded and reset. Completion persisted after reload; reset restored defaults and no active plan. A fresh second tab showed an untouched sample with no activity or history. No console error/warning logs were captured in the tested tabs. [Browser observations](browser-checks.json).

Screenshots: [desktop reset](public-reset-desktop.png), [historical separation](public-history-desktop.png), [isolated visitor](public-isolated-visitor.png), [custom completion after reload](public-custom-mobile.png), [full mobile input workflow completion](public-mobile-workflow.png), [mobile reset](public-reset-mobile.png).

## Failures and remaining limitations

**The preserved DynamoDB 5 RCU / 5 WCU capacity can throttle.** Concurrent sample smoke/browser checks caused real `ProvisionedThroughputExceededException` failures in UpdateItem and TransactWriteItems and an API 503. Request quota increments write the full state item even on GET, so sample traffic consumes capacity faster than small custom states. The website correctly disabled stale execution authority and recovered through an explicit Refresh state. No ambiguous mutation was automatically retried. Sequential verification completed, but this does not establish concurrent-load reliability. Capacity was not increased. [CloudWatch failures](storage-failures.log).

The deployment identity denied direct DynamoDB DescribeTable, CloudFront GetDistributionConfig, Lambda GetPolicy and API Gateway GetStage. No broader IAM access, alternate profile or runtime-role bypass was used. Configured capacities/permissions were verified in processed templates and unchanged resource identities; persistence was verified through the AWS API/DynamoDB adapter and browser reloads. A direct table scan, live IAM-policy audit and full infrastructure drift check remain unavailable. Existing individual session records were not inspected; resource preservation and the code-only update prevent deployment-driven table replacement/deletion.

Browser testing used responsive viewports, **not physical Android/iOS devices or Safari**. The plan summary also retains minor wording (“sample rain”) when describing a custom rain assumption, though the scenario-source badge correctly marks custom operator assumptions. No frontend source was changed during this deployment task. The existing model has tarp/bay capacities but no forklift weight-capacity constraint. Completion and all monetary/weather estimates remain simulated assumptions.

Retained probe failures: initial preflight omitted required Access-Control-Request headers; expiry used the slightly offset local clock; both assertions were corrected to reflect actual browser/AWS behavior. A manual invalidation lookup used the wrong ID and returned NoSuchInvalidation before the correct recorded ID was confirmed Completed. A local boto3 diagnostic could not load the login credential provider without its optional CRT dependency; the existing authorised AWS CLI was used successfully instead, without installing dependencies. These are verifier failures, distinct from the real DynamoDB capacity failure.

## Local files changed during this deployment task

- `sam/Deploy-Cloud.ps1`: update-only deployment, previous parameters, prepare/review/execute, processed-template proof, resource ID checks and completed invalidation.
- `sam/tests/Deploy-Cloud.Tests.ps1`: 18 offline cases for those guards and failures.
- `sam/cloud_usability_smoke.py`: token-safe live scenario/reset/isolation/input/quota verification with partial failure evidence.
- `README.md`, `DEPLOYMENT.md`, `AWS_ARCHITECTURE.md`, `VERIFICATION.md`, `sam/IAM_ACCESS.md`: replace stale deployment claims and record verified results/limits while preserving dated historical records.
- `artifacts/cloud-update/`: this report, snapshots, successful and failed probes, logs and screenshots. Additional one-off diagnostic scripts are ignored under `.aws-sam/`.

No application backend/frontend source, fictional fixture, historical benchmark, SAM template, Dockerfile or IAM policy was edited during this release. No commit or push was made.
