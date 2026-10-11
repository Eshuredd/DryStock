# DynamoDB throttling review — 11 October 2026

**Review and local tests only. No fix, capacity change, billing resource, commit, push or deployment was made.** Local HEAD is `392da4d`; deployed application code remains `1d5e337`. The existing stack is `UPDATE_COMPLETE`, Lambda `$LATEST` is Active with Successful update status and unchanged digest `90df6d2f32a6c8c90d7ebc7315fba1dd81991b39f0a05940fb99b7ba2afee41d`. All nine physical resource IDs still match the previous deployment. Only `drystock-deploy` in ap-south-1 was used; RideWatch was not targeted. [Read-only AWS evidence](throttling-readonly-review.json).

## Root cause

The table has **five write capacity units per second, not five arbitrary writes per second**. `DynamoStore.load()` strongly reads the entire `STATE` item, then executes `ADD requests :one` on that same item for every authenticated request. This includes GET state, GET history, invalid revisions and requests that later fail input validation. `compute_lease()` and `release_lease()` also update this item. AWS charges an UpdateItem against the larger complete item before/after the change, even for a single counter. [AWS write accounting](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html).

Generation stores the scenario, latest plan, all three full baseline plans, a second scenario snapshot and audit events inside STATE. The latest plan is also stored separately under PLAN. Approval, completion and disruption rewrite **both** through a transaction; reset clears latest but writes the superseded historical plan. Transactions double the per-item write units. Shrinking STATE on reset is still charged against the larger pre-reset item. Request quotas therefore do not prevent write amplification; even rejected conditional quota updates can consume capacity.

Measured against the actual current source and unchanged sample:

| Request/stage | Item / workload | Read units | Write units | Hypothetical small counters/leases |
|---|---|---:|---:|---:|
| Initial GET state | STATE about 7,322 bytes | 2 | 8 | 1 WU |
| Generate first plan | Includes request count, lease, global count, STATE/PLAN transaction, lease release | 2 | 103 | 70 WU |
| GET generated state | STATE about 19,714 bytes | 5 | 20 | 1 WU |
| GET history after generation | STATE read/count plus one full PLAN query | 9 | 20 | 1 WU |
| Approve | Request count plus transaction | 5 | 86 | 67 WU |
| Complete first action | Request count plus transaction | 5 | 86 | 67 WU |
| Disrupt | Request count plus transaction | 5 | 86 | 67 WU |
| Reset after disruption | Larger old STATE plus historical PLAN | 5 | 86 | 67 WU |

These are offline source-based throughput estimates, not AWS `ReturnConsumedCapacity` readings. UTF-8 string lengths and attribute names are measured; the few numeric attributes use AWS's approximate numeric-size rule. Items are away from relevant rounding boundaries. The storage-only 100-byte item overhead is excluded. [Full operation trace](capacity-audit.json), [reproducible audit tool](../../sam/dynamo_capacity_audit.py).

The frontend fetches history when tab/revision/latest ID/latest state changes. A state-plus-history refresh after generation consequently costs about **40 WU and 14 RU**, before any mutation. History queries are strongly consistent and read full plan snapshots, including comparisons and scenario inputs. By five plans, a history query alone consumes about 16 RU in the trace. The query is bounded to 30; the session compute limit is 20, but this can still exceed five RCU. Projections do not make DynamoDB charge only the requested attributes.

Different sessions have different partition keys, but share the table's total capacity. Small global quota items are not the source of this sample-state amplification. The gateway's two requests/sec and burst four are counts of API requests, not DynamoDB units; they are not matched to this workload. Burst credit can mask the deficit temporarily. AWS may retain up to five minutes of unused capacity, with no guarantee that all credit remains available. [AWS burst/adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html).

The original CloudWatch errors were re-read from the actual function log group: UpdateItem at **16:07:35.885Z**, TransactWriteItems at **16:07:36.316Z**, both `ProvisionedThroughputExceededException`. This corroborates the recorded 503. Logs omit `ThrottlingReasons`, and `cloudwatch:GetMetricStatistics` is denied. The precise historical credit balance and table/partition throttling subreason cannot be recovered with this profile; they are not fabricated. The demonstrated defect is that even a generated-state GET requires four seconds of the table's provisioned write supply. [AWS read results and denials](throttling-readonly-review.json).

## Local reproduction and capacity comparison

Five new tests exercise size rounding and shrinking transactions, whole-item GET counter charging, two concurrent visitors, failed reset atomicity, and complete workflow capacity demand. The concurrency test gives the shared 5 WCU model a full 1,500-unit initial burst and runs two overlapping visitors at an aggregate two GET requests/sec for one minute. Both successful responses and storage 503s occur before either session reaches its 300-request quota. Yard state and historical plans remain unchanged by refused writes.

Moto does **not** enforce provisioned throughput. The test supplies an explicit synthetic budget and raises a real botocore ClientError through the real handler; this is an offline reproduction of the failure mechanism, not an AWS service load result. The accounting tool runs the current handler/store through generate, approve, complete, disrupt, reset and subsequent authoritative GET/history checks. It computes a real sample result once, then reuses verified copies, so it does not measure solver timing or Lambda performance.

| Synthetic workload | Current write demand | Small-counter estimate | Read demand |
|---|---:|---:|---:|
| Three visitors, five full cycles each, aggregate 0.5 API requests/sec | 21.09 WU/sec | 11.60 WU/sec | 4.09 RU/sec |
| Four successive cohorts of three fresh visitors, same cycles, aggregate two requests/sec | 84.36 WU/sec | 46.38 WU/sec | 16.36 RU/sec |

Small counters reduce the measured writes by **45%**, but do not make 5 WCU reliable. At 25 WCU the paced workload has no modeled refusals; the sustained gateway-rate model still refuses writes even with small counters and optimistic full initial credit. 50 WCU has little sustained headroom after optimisation. 75 WCU has better write headroom for this sample workload; without optimisation the measured mean exceeds even 75. Large custom inputs, longer history, service retries, real partitions and actual invocation timing remain outside this model. Zero synthetic refusals are not a deployed-service guarantee.

## Proposed fix and cost before approval

**Recommended smallest capacity remedy for this bursty public demo: update the existing table to on-demand (`PAY_PER_REQUEST`), removing `ProvisionedThroughput`.** This removes the five-unit provisioned bottleneck without changing the application, optimiser, table keys, session records, history, quotas or IAM roles, and needs no new table, cache or autoscaling resource. BillingMode is an in-place CloudFormation property. It still needs explicit approval and a reviewed change set showing **no replacement/deletion**, with all other resource properties unchanged. [CloudFormation property contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html), [on-demand behavior and limits](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html).

The existing deployment script deliberately permits **code-only** changes. It would reject this capacity change. Do not bypass that guard or issue an untracked UpdateTable: an approved infrastructure change needs an explicit, narrowly scoped review path and the existing SAM configuration. If the existing role lacks the necessary action, stop and report it; do not expand IAM.

The proposed table-property diff (shown for review; **not applied**) is:

```diff
-      BillingMode: PROVISIONED
-      ProvisionedThroughput: {ReadCapacityUnits: 5, WriteCapacityUnits: 5}
+      BillingMode: PAY_PER_REQUEST
```

An optional follow-up optimisation is to put `requests`, `computes`, `leaseUntil` and expiry into a **small USAGE item in the same session partition of the existing table**. Keep conditional quota increments/lease acquisition, TTL checks, state CAS, transactional history and independent plan validation. Reset must never refill counters. For compatibility, existing sessions can retain the legacy counter path until their normal four-hour expiry; new sessions use the small item. This avoids resetting quotas or migrating live sessions during overlapping Lambda invocations. This is only a reviewed design/cost counterfactual here; no application code was changed.

If provisioned mode is preferred, a modest **10 RCU / 25 WCU** is a candidate for the paced three-visitor workload, especially with small counters. It must not be advertised as sufficient at the gateway's allowed sustained rate. A sample workload target at that rate suggests **25 RCU / 75 WCU plus small counters** for headroom, or approximately **25 RCU / 125 WCU** without optimisation. Neither is a worst-case guarantee for all allowed inputs/history. An arbitrary small capacity bump without a traffic target and live verification is not a reliable fix.

Verified current **Mumbai Standard table** list rates: RCU **$0.000148/hour**, WCU **$0.000740/hour**; on-demand reads **$0.1425/million RU**, writes **$0.71/million WU**. The official catalog publication is `2026-09-11T12:44:22Z`; it was downloaded during this review. [Saved exact SKU/rate evidence](dynamodb-mumbai-pricing.json), [official Mumbai price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-south-1/index.json).

| Provisioned option | Gross 730-hour monthly throughput cost | Gross increase over 5/5 |
|---|---:|---:|
| Existing 5 RCU / 5 WCU | $3.24 | — |
| 10 RCU / 25 WCU | $14.59 | $11.34 |
| 25 RCU / 25 WCU | $16.21 | $12.96 |
| 25 RCU / 75 WCU | $43.22 | $39.97 |
| 25 RCU / 125 WCU | $70.23 | $66.98 |

Actual provisioned charges may be lower due to available free-tier/credits. AWS lists 25 RCU and 25 WCU in its Standard provisioned free tier; account eligibility and allocation to other applications were **not inspected**, so no free capacity is assumed or taken from RideWatch. If the whole allowance were available, 25/25 throughput could be free, and 25/75 would leave 50 billable WCU, about $27.01/month. These are conditional examples, not the account's verified bill. [AWS pricing/free tier](https://aws.amazon.com/dynamodb/pricing/).

With on-demand, scaling the measured five-cycle traffic mix to **1,000 full sample lifecycles** gives about **$0.49** in DynamoDB read/write requests with the current code, or **$0.28** with hypothetical small counters. At 6,000 such cycles/month, about $2.91 or $1.65 respectively. These are workload examples, **not a spending cap or upper bound**: repeated refreshes/resets, rejected requests, retries, larger custom inputs and long history can increase charges. Storage, Lambda, API Gateway, CloudFront, S3, logs, taxes and account credits are excluded. The $5 account budget cannot be guaranteed by this estimate or the current request quotas.

## Budget alert check

**The existing stack has no configured budget alert.** Its actual `BudgetEmail` parameter is empty, `HasBudgetEmail` is false, and its actual resource list contains no AWS::Budgets::Budget. The template's optional $5 monthly budget definition therefore does not establish that an alert exists.

Reading the named `drystock-demo` budget returned **AccessDenied for `budgets:ViewBudget`**. A separately configured account budget, its amount, notification thresholds and email subscribers cannot be verified. The owner must confirm these through existing billing access; no other profile was used and no budget, subscriber, IAM grant or billing resource was created/changed. A budget notification would not itself stop spending. [Exact check](throttling-readonly-review.json).

## Public website and current verification

The actual [public website](https://d38gzj2yabm82w.cloudfront.net) completed a fresh **serial** sample workflow: generate, approve, complete L11, earlier-rain/forklift-loss disruption, reload and reset. Reload retained the simulated completion and disrupted conditions. Reset visibly restored the original 11 lots, cutoff 60, rain 70, clock zero, available forklift and **No plan**. Activity retained the five audit events and superseded plan explicitly marked **Historical · previous scenario, not current results**. No unexpected storage error appeared in this serial browser workflow; captured console warnings/errors were empty. Public health returned HTTP 200 with AWS/DynamoDB provenance. [Browser record](throttling-browser-check.json), [reset screenshot](throttling-public-reset.png), [historical separation](throttling-public-history.png).

| Current local check | Result |
|---|---|
| Full backend suite | **118 passed**, one existing Starlette deprecation warning |
| New capacity tests after final stress assertions | **5 passed** |
| Frontend tests | **50 passed** |
| Offline deployment guard cases | **18 passed**, external AWS calls intercepted |
| Frontend lint / TypeScript | Passed |
| Production static export, Next.js 16.4.0, actual public API URL | Passed locally; nothing uploaded |
| Capacity audit / evidence generation | Passed; entirely offline |

Reproduce the offline audit without AWS credentials:

```powershell
rtk proxy .venv/Scripts/python.exe -m pytest backend/tests/test_dynamo_capacity.py -q
rtk proxy .venv/Scripts/python.exe sam/dynamo_capacity_audit.py --output artifacts/cloud-update/capacity-audit.json
```

## Remaining work after approval

No concurrent AWS success is claimed. After an approved change, review the processed template/change set, stop on any persistent-resource replacement, update only the existing stack, and verify physical IDs/session continuity. Run bounded overlapping fresh visitors through sample and custom scenarios, generation/approval/completion/disruption/reload/reset with authoritative state/history assertions. Include stale revisions, wrong-session access, request/compute quotas and failed-write safety. Account for the unchanged gateway's expected 429 rate limit separately from unexpected storage 503s. Capture response codes, timings and function logs; never automatically replay an ambiguous mutation. If metrics/budget reads remain denied, report those limits rather than broadening IAM. Then update this report with actual live results.

Local files added: `backend/tests/dynamo_capacity_model.py`, `backend/tests/test_dynamo_capacity.py`, `sam/dynamo_capacity_audit.py`, this report and six evidence artifacts (capacity trace, price catalog, read-only AWS check, browser check, two screenshots). `REPORT.md` and `DEPLOYMENT.md` link this review. Application/frontend/optimiser/fixture/benchmark sources, SAM template, Docker configuration and deployment permissions remain unchanged. Ignored `.aws-sam` helpers collected read-only evidence and ran the local build; they are not production code.
