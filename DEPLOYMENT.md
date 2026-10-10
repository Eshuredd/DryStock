# DryStock cloud deployment — awaiting authorised access

**Status: not deployed. No public website or API URL exists for this phase.** Cloud provisioning is paused at the user's explicit request until a separate authorised `drystock-deploy` profile is configured. The existing RideWatch identity has not been escalated. No IAM grants, ECR pushes, CloudFormation stacks or budget were created by this run.

## Scope and access

Target: account 071031980923, Region `ap-south-1`, application stack **`drystock-demo`**. Frontend: Next.js 16 static export → private S3 → CloudFront HTTPS. Backend: HTTP API Gateway → Linux x86_64 Lambda container using existing OR-Tools/validator → DynamoDB. Owner bootstrap: **`drystock-demo-bootstrap`**, private image/artifact storage and separated roles. No EC2/ECS/RDS/NAT/load balancer is planned.

Review [sam/IAM_ACCESS.md](sam/IAM_ACCESS.md), its exact rendered policies, and [sam/bootstrap-template.yaml](sam/bootstrap-template.yaml). Only the owner operates the bootstrap. Do not use root, expand RideWatch, or attach AdministratorAccess. The CloudFormation execution role cannot create/edit IAM identities. Its runtime role is pre-created with only the named table and log permissions.

## Before provisioning

The account owner must review the bootstrap and trust principal, create the approved resources/roles, authorise the separate deployment identity and provide the non-secret OAC ID. Configure SSO/temporary credentials locally using the IAM access guide. Then verify:

```powershell
rtk proxy aws sts get-caller-identity --profile drystock-deploy
rtk proxy aws lambda get-account-settings --profile drystock-deploy --region ap-south-1 --query AccountLimit
rtk proxy aws cloudformation describe-stacks --stack-name drystock-demo --profile drystock-deploy --region ap-south-1
```

Only a “stack does not exist” response permits creation; AccessDenied or another error must be resolved by the owner. The Lambda account-limit check is informational: DryStock does not request reserved concurrency, so this configuration supports an account concurrency limit of 10 without requiring at least 102 concurrent executions. It shares the account's unreserved concurrency pool with other functions and no longer has its own cap of 2 simultaneous executions. Available capacity depends on other functions' reservations and current use; exhausted shared capacity can throttle DryStock. These checks have **not** been run with the new profile because it has not been supplied. The permission files are local review candidates, not a verified live IAM grant.

## Reproducible deployment after access is ready

The script's default is review-only and makes no AWS calls:

```powershell
rtk proxy powershell -NoProfile -File sam\Deploy-Cloud.ps1
```

After owner approval and authorised profile setup:

```powershell
rtk proxy powershell -NoProfile -File sam\Deploy-Cloud.ps1 -Provision -OriginAccessControlId <bootstrap-output> -BudgetEmail <approved-alert-email>
```

Replace bracketed placeholders locally. The approved budget recipient is held in this chat; it is deliberately absent from source. Budget email is a deployment parameter and stays in ignored local parameter files and the new budget configuration. The script accepts only `drystock-deploy`, verifies the account/role, validates/builds the SAM image, logs into ECR through password stdin, packages it, creates a named `drystock-*` change set with `drystock-demo-cloudformation`, executes it, obtains actual outputs, builds the frontend using the returned API endpoint, uploads only its named bucket and invalidates only its distribution. It does not commit or push.

The script is prepared and syntax-checked, **not executed with `-Provision`**. Its update path uses the same stack. It stops on failure; it does not create alternate stacks. An unchanged change set may report no changes; inspect it and skip backend execution before uploading a separately rebuilt frontend. Stack rollbacks, initial API tag permissions and account-level service limits need live checks once access exists.

Frontend build configuration is centralised in `frontend/lib/api.ts` and `next.config.ts`. `DRYSTOCK_STATIC_EXPORT=1` selects static export and disables Next rewrites. `NEXT_PUBLIC_API_BASE_URL` must be a public HTTPS endpoint without credentials/query parameters. It is public configuration, never an AWS secret. For local development, leave both unset; `/api/*` rewrites still use FastAPI/SQLite or SAM local compute.

Cloud Lambda variables: `DRYSTOCK_TABLE` (stack table), `DRYSTOCK_ORIGIN` (exact CloudFront origin), `DRYSTOCK_SAMPLE_PATH=/var/task/sample-data/surat-yard.json` (packaged original fixture). No backend Lambda state is stored on its filesystem. API Gateway CORS permits only that exact frontend origin, GET/POST/OPTIONS and Authorization/Content-Type headers.

DynamoDB encryption uses the default AWS-owned key. `SSEEnabled: false` selects that key; it does **not** mean plaintext storage. This avoids additional KMS permissions/charges. [CloudFormation encryption specification](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-dynamodb-table-ssespecification.html).

## Verify the real deployed service

After provisioning, `artifacts/phase3/deployment.json` will contain actual `WebsiteUrl`, `ApiUrl`, distribution, bucket, function and table outputs. That file has not been generated by a deployment yet.

```powershell
rtk proxy .\.venv\Scripts\python.exe sam\cloud_smoke.py --api-url <actual-ApiUrl> --website-url <actual-WebsiteUrl>
rtk proxy aws logs tail /aws/lambda/drystock-demo-api --since 10m --profile drystock-deploy --region ap-south-1
```

The smoke script checks actual AWS HTTPS endpoint patterns, two independently issued sessions, cross-session approval rejection, original 35,809/best 35,550, approval/L02/disruption/replanning, revised 16,821/best 14,985, reload persistence, invalid-plan rejection, stale revisions, CORS and independently validated local equivalence. Tokens remain in memory and are not written to evidence. Match returned Lambda invocation IDs to the named CloudWatch log group.

Then use the **actual public URL** in fresh browser sessions: execute the entire demo, reload, verify a second visitor is unaffected, inspect desktop/mobile/console/network, HTTPS, CORS and absence of localhost dependencies. API smoke tests do not substitute for these browser tests. No real cloud or public browser check is claimed yet.

## Cost and operational controls

| Control | Configured bound |
|---|---|
| Lambda | 2 GB, timeout 30 seconds; shared unreserved account concurrency, no function reservation or provisioned concurrency |
| Solver | Exactly 5 seconds for the fixed fictional cloud yard; shared engine input bounds remain |
| HTTP API | 2 requests/second, burst 4; service throttling is best-effort, not a spending cap |
| DynamoDB | Fixed 5 RCU / 5 WCU, no autoscaling; transactions and larger state items can throttle |
| Session lifetime | 4 hours, explicit server expiry checks plus TTL on state and history |
| Per-session use | 300 authenticated requests, 20 optimisation attempts; one 35-second compute lease |
| Shared use | 100 new sessions/hour; 200 optimisation attempts per UTC day; enforced conditional DynamoDB counters |
| Request input | 32 KiB maximum; no visitor-uploaded yard scenarios; only fixed sample and permitted disruptions |
| Logs | 3-day retention; no request bodies, capability tokens or Authorization logging |
| Storage | Private encrypted S3; build artifacts expire after 14 days; ECR keeps five image versions |
| Optional budget | Named US$5 monthly account-wide actual/forecast email alerts; no automated budget action |

Budget alerts are **not spending caps** and may be delayed. The account-wide budget also sees other applications; it avoids depending on cost-allocation tags that might not be activated. Project tags are supplied, but this run has not changed billing account settings. If the owner denies Budget permissions, explicitly deploy without `BudgetEmail` and document the missing alert; do not silently claim one exists.

Provisioned DynamoDB capacity can incur ongoing charges while idle. S3/ECR storage and API Gateway/Lambda/CloudFront request/transfer usage can also be charged. Existing account credits/free-tier eligibility are unknown. At the absolute compute-attempt bound, 200 invocations/day × 30 seconds × 2 GB × 30 days is 360,000 GB-seconds/month before failed/other API invocations; this is a usage bound, not an expected bill. Public traffic can still generate gateway/CloudFront charges even when the application rejects requests. Monitor actual billing and remove the demo after judging. [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/).

To disable computation quickly, the owner may optionally set this named function's reserved concurrency to zero as an emergency override. This is a separate operational action; the deployment template leaves concurrency unreserved and does not require a reservation. API/static hosting still incur possible request/storage charges. The restricted deployment identity has read-only direct Lambda configuration; a CloudFormation update by its scoped execution role can change concurrency.

## Safe teardown — proposed, not executed

Read the **named** stack outputs and confirm its exact site bucket/distribution before deletion. Never enumerate and delete other application buckets. When the user explicitly requests teardown:

```powershell
rtk proxy aws cloudformation describe-stacks --stack-name drystock-demo --profile drystock-deploy --region ap-south-1
rtk proxy aws s3 rm s3://drystock-demo-site-071031980923-ap-south-1/ --recursive --profile drystock-deploy --region ap-south-1
rtk proxy aws cloudformation delete-stack --stack-name drystock-demo --profile drystock-deploy --region ap-south-1
rtk proxy aws cloudformation wait stack-delete-complete --stack-name drystock-demo --profile drystock-deploy --region ap-south-1
```

These commands destroy only DryStock's static assets and stack demo data. Do not run them while judges need the URL. CloudFront deletion can take time. If nonempty storage or a rollback blocks deletion, inspect named stack events; do not issue broad deletion commands.

The bootstrap remains separate. Its owner must empty only the named artifact bucket and delete **`drystock-demo-bootstrap`** using their authorised role if no further deployment is needed; this removes the five retained image versions, OAC and DryStock roles. Keeping the bootstrap leaves storage charges possible. The deployment identity cannot manage that bootstrap, and no teardown has been executed.
