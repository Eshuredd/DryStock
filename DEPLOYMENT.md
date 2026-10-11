# DryStock deployment

**11 October throttling review:** [Detailed findings and proposed fix](artifacts/cloud-update/THROTTLING.md). Full-item request/lease counters amplify writes; optimisation alone does not make 5 WCU reliable. On-demand on the existing table is proposed for approval, with measured workload costs and provisioned alternatives documented. No infrastructure or application release was made. The stack's optional $5 budget alert is inactive because its email parameter is empty; separately configured account budgets cannot be verified with the authorised profile. Current local checks are 118 backend tests, 50 frontend tests, lint, TypeScript, 18 offline deployment guard cases and a successful static production build. The latest public serial workflow passes; concurrent success after a fix is still pending approval and live verification.

Updated the **existing `drystock-demo` stack in ap-south-1 on 11 October 2026**, from clean local commit `1d5e337`. Both the Lambda backend and Next.js frontend were deployed using only the authorised `drystock-deploy` profile in account `071031980923`. No second application, IAM grants, commit or push was created. RideWatch was not targeted.

- Public website: https://d38gzj2yabm82w.cloudfront.net
- API: https://x59yh2i1yf.execute-api.ap-south-1.amazonaws.com
- Lambda: `drystock-demo-api`, version **`$LATEST`**; the existing template does not publish numbered versions or aliases.
- Resolved container digest / CodeSha256: `90df6d2f32a6c8c90d7ebc7315fba1dd81991b39f0a05940fb99b7ba2afee41d`.
- CloudFormation change set: `drystock-1791734464`; final status `UPDATE_COMPLETE`.
- CloudFront invalidation: `I7UXKMW06TND6KRGQI3LC7V10U`, path `/*`, confirmed **Completed** after upload.

The unchanged SAM template and `sam/Cloud.Dockerfile` built the Linux x86_64 Python 3.12 / OR-Tools container. The frontend was exported with `DRYSTOCK_STATIC_EXPORT=1` and the actual API URL, then uploaded to the existing private S3 bucket. Upload used `s3 cp --recursive`, without deleting existing objects.

## Resource preservation and change-set review

The deployment script now requires an existing stable stack, preserves **all previous stack parameters**, and has no CREATE fallback. It can prepare a change set separately from execution. Before execution it rejects additions, deletions, replacements (including conditional replacement), permission changes and configuration changes.

This change set contained `CloudFunction.Code` and an API `Body` dependency on `CloudFunction.Arn`, both non-replacing. The first restrictive guard stopped before execution on that API dependency. Comparison of the entire processed current and proposed templates proved that **only the Lambda image URI differs**; the API definition, table, bucket, distribution, roles, permissions and limits are identical. The script permits that exact SAM dependency only with this template proof.

All nine logical resources retained their physical IDs after execution. The table remains `drystock-demo-sessions`, bucket `drystock-demo-site-071031980923-ap-south-1`, distribution `E1JXQZMU0LU0NS`, runtime role `drystock-demo-runtime`, and execution role `drystock-demo-cloudformation`. Verification mutated only newly issued test sessions. Existing sessions were not enumerated, reset or migrated through administrator writes; their normal four-hour expiry remains applicable.

Review evidence in [artifacts/cloud-update](artifacts/cloud-update): `change-set.json`, `template-review.json`, resource snapshots, Lambda identity and completed invalidation. Historical benchmark artifacts were not rewritten.

## Repeat an authorised code update

Default invocation remains read-only and makes no AWS calls:

```powershell
rtk proxy powershell -NoProfile -File sam/Deploy-Cloud.ps1
```

Prepare the same existing application, then review the exact emitted change-set name and evidence:

```powershell
rtk proxy powershell -NoProfile -File sam/Deploy-Cloud.ps1 -Provision -PrepareOnly
rtk proxy powershell -NoProfile -File sam/Deploy-Cloud.ps1 -Provision -ExecuteChangeSet drystock-<emitted-number>
```

Do not substitute another profile, account or region. Do not broaden IAM after AccessDenied. The execution step reviews the live set and processed templates again, waits for the stack, compares resource IDs, lints/typechecks/builds the frontend, uploads to the named stack bucket and waits for invalidation. An empty backend change set stops instead of reporting a frontend-only update as a complete backend release. Changes beyond image code require separate infrastructure review.

## Verification

Current automated checks: **113 backend tests**, **50 frontend tests**, **18 offline deployment-script regression cases**, frontend lint, TypeScript checks, SAM template lint and production static export passed. Backend tests emitted one existing upstream Starlette TestClient deprecation warning.

The original live cloud smoke test passed: sample benefit ₹35,809 versus strongest baseline ₹35,550, and disrupted benefit ₹16,821 versus ₹14,985. Results retain AWS invocation IDs and pass the independent local output validator; modeled outcomes match the local engine. These are assumed fictional loss estimates, not measured savings.

New live checks cover `/api/scenario`, bearer sessions, CORS preflight/wrong-origin rejection, extra fields, invalid IDs, valid-shaped injected completions, loss exceeding value, incompatible materials, invalid availability, 31 unique lots and the exact 32 KiB request boundary. Reset was checked after generation, approval, completion and disruption. It restores the exact original fixture, defaults and empty completions, returns `latest: null`, agrees with authoritative GET, and retains superseded plans in earlier scenario epochs. Cross-session mutations and stale revisions are rejected. Custom scenarios were saved, independently optimised, approved, completed, reloaded and reset using the AWS API and its DynamoDB adapter. The live 20-computation and 300-request session limits were enforced; reset did not replenish the compute quota.

Reproduce only when the existing application's test traffic is authorised:

```powershell
rtk proxy .venv/Scripts/python.exe sam/cloud_smoke.py --api-url https://x59yh2i1yf.execute-api.ap-south-1.amazonaws.com --website-url https://d38gzj2yabm82w.cloudfront.net --output artifacts/cloud-update/benchmark-smoke.json
rtk proxy .venv/Scripts/python.exe sam/cloud_usability_smoke.py --api-url https://x59yh2i1yf.execute-api.ap-south-1.amazonaws.com --website-url https://d38gzj2yabm82w.cloudfront.net --quotas
```

Keep tests sequential: each session request charges a conditional counter on the state item, which uses write capacity even for GET. Fresh small scenarios are used for quota testing to limit load. Tokens stay in memory and are absent from evidence.

## Operational limits and observed failures

The existing stack retains: 2 GB / 30-second Lambda, five-second solver, API throttle 2 requests/second with burst 4, DynamoDB **5 RCU / 5 WCU**, four-hour sessions, 300 authenticated requests and 20 optimisation attempts per session, 35-second compute lease, shared 100 new sessions/hour and 200 computations/day, 32 KiB inputs and three-day logs. Reset does not replenish quotas. Shared hourly/daily quotas are verified in source/offline conditional-counter tests rather than deliberately exhausted on the live demo. The account reports 1,000 total and unreserved Lambda concurrency; DryStock has no reserved concurrency.

Overlapping sample/API/browser verification **did cause DynamoDB throughput failures**: CloudWatch logged `ProvisionedThroughputExceededException` for `UpdateItem` and `TransactWriteItems`, and the API returned 503. The UI disabled approval/completion until an explicit authoritative refresh recovered. This is a real limitation of the preserved capacity, not a reset failure. No ambiguous mutation was automatically replayed. Partial failed evidence is retained separately from later sequential verification; no throughput or IAM expansion was made.

The deployment profile denies direct `dynamodb:DescribeTable`, `cloudfront:GetDistributionConfig`, `lambda:GetPolicy` and API Gateway `GetStage`. Resource preservation and configured limits were checked through CloudFormation's processed templates and resource IDs; DynamoDB persistence was verified through separate AWS API requests and browser reloads. A direct table scan, live IAM-policy inspection and infrastructure drift audit were therefore **not performed**. Required build/package/change-set/upload/invalidation operations succeeded using existing permissions.

Two initial smoke-probe assertions were corrected: browser preflight requires `Access-Control-Request-*` headers, and the four-hour expiry assertion must use AWS's HTTP Date rather than the slightly offset local clock. These probe failures are retained as first/second-attempt evidence. One manual invalidation read used an incorrect ID and returned NoSuchInvalidation; the recorded deployment ID was then used and confirmed Completed.

See the final [verification report](artifacts/cloud-update/REPORT.md) for public desktop/mobile viewport observations, quota outcomes, screenshots and remaining limitations. A mobile viewport check does not establish physical Android/iOS compatibility. Fictional demo completion, prices, loss estimates and weather remain assumptions; there are no production user accounts or live forecasts.
