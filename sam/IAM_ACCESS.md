# DryStock deployment access

**Verified 11 October 2026:** `drystock-deploy` authenticates as the approved assumed role in account **071031980923**, region **ap-south-1**. It successfully updated the existing `drystock-demo` backend, uploaded the frontend and invalidated its CloudFront distribution. No IAM policy, trust, role or unrelated application was modified. Use the [deployment guide](../DEPLOYMENT.md) for current update commands and evidence.

Direct DynamoDB DescribeTable, CloudFront GetDistributionConfig, Lambda GetPolicy and API Gateway GetStage calls were denied to the deployment identity. These are recorded verification limits, not instructions to expand access. Live runtime sessions and persistence were tested through the authorised application API. The rendered policy package below remains an owner review reference; it is not evidence that every proposed action is granted in live IAM.

## Review package

The source of truth is [bootstrap-template.yaml](bootstrap-template.yaml). It is an **owner-operated** bootstrap, not a template the restricted RideWatch user should apply. It creates only new DryStock resources: private artifact bucket, ECR repository, S3 origin access control, and three roles. An existing account-authorised role must be supplied as `DeploymentPrincipalArn`; root and IAM user principals are rejected by the parameter pattern. Do not use root or expand RideWatch policies.

Rendered exact IAM statements for this account/Region:

- [Deployment identity policy](iam-review/deployment-policy.json) and [trust](iam-review/deployment-trust.json).
- [CloudFormation execution policy](iam-review/cloudformation-policy.json) and [trust](iam-review/cloudformation-trust.json).
- [Lambda runtime policy](iam-review/runtime-policy.json) and [trust](iam-review/runtime-trust.json).
- [Minimal source-role assume permission](iam-review/source-assume-role-policy.json), for the owner's selected SSO/federated role only.

The deployment trust JSON includes `OWNER_APPROVED_SSO_ROLE` as an explicit placeholder. The owner must replace it with the actual authorised principal, or regenerate with `--principal <role-arn>`. Never apply the placeholder. Regeneration is entirely local:

```powershell
rtk proxy .\.venv\Scripts\python.exe sam\render_iam_review.py --account 071031980923 --region ap-south-1 --principal <owner-approved-role-arn>
```

## Identity and service-role separation

| Role | Trust | Permissions |
|---|---|---|
| `drystock-deploy` | One owner-selected SSO/federated role | Manage only `drystock-demo` CloudFormation stack/change sets; pass only its CloudFormation role; upload exact artifact/site buckets and exact ECR repository; invalidate DryStock-tagged CloudFront; read named Lambda logs/configuration |
| `drystock-demo-cloudformation` | CloudFormation service | Provision/update/delete named Lambda, DynamoDB, site bucket, log group and named budget; create the named/tagged HTTP API and tagged distribution; pass only the runtime role to Lambda |
| `drystock-demo-runtime` | Lambda service | Get/Put/Update/Query only `drystock-demo-sessions`; write only the function's own log streams |

The CloudFormation role has **no IAM policy/role creation or editing**, no user/credential administration, no EC2/VPC, no RDS and no ECS permissions. The runtime has no deployment rights or access to unrelated tables. DynamoDB transaction calls are authorised by the underlying `PutItem`/`UpdateItem` actions; there is no `dynamodb:TransactWriteItems` IAM action. [Transaction documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).

## Exact deployment permission groups

| Service | Scope and operations in review policy |
|---|---|
| CloudFormation | Create/update/delete/describe `stack/drystock-demo/*`; create/describe/execute/delete `changeSet/drystock-*/*`; template validation on `*`; no access to the bootstrap stack |
| IAM | Deployment identity: `PassRole` only `drystock-demo-cloudformation`, conditioned on CloudFormation. Execution role: `GetRole`/`PassRole` only `drystock-demo-runtime`, conditioned on Lambda. No grants or credentials |
| ECR | Layer upload/check, PutImage, image/repository describe/read only repository `drystock-demo`; `GetAuthorizationToken` requires `*`. Bootstrap owner creates repository and Lambda image-read policy |
| Lambda | Function lifecycle/configuration/code, resource permission, tags and concurrency controls only `function:drystock-demo-api`. The template uses shared unreserved account concurrency; a reservation is not required. Existing IAM permissions are retained. Deployment identity has read-only account limit check on `*` |
| API Gateway v2 | Creation on `/apis` restricted by request API name `drystock-demo-api` and `Project=DryStock`; GET/POST/PUT/PATCH/DELETE child routes/integrations/stages/tags restricted by DryStock resource tag in `ap-south-1` |
| DynamoDB | Create/describe/update/delete, tags and TTL only table `drystock-demo-sessions`; runtime data operations only this table |
| S3 | Lifecycle/configuration/policy actions only site bucket `drystock-demo-site-071031980923-ap-south-1`; deploy uploads only that bucket and `drystock-demo-artifacts-071031980923-ap-south-1` |
| CloudFront | CreateDistribution on `*` restricted by request tag; account distribution CRUD restricted by existing DryStock tag; create-time tagging requires DryStock request tag and rejects an existing different Project tag. Uses managed headers policy; OAC is owner-created, so the execution role gets no account-wide mutable OAC/header-policy permissions |
| CloudWatch Logs | Named log group lifecycle/retention and stream read/write; DescribeLogGroups requires `*` |
| Budgets | View/modify only named budget `drystock-demo`; optional email parameter, US$5 account-wide alert |

The exact review action arrays are in the JSON files, including update/rollback/delete operations. They are not a complete audit of live policies. The 11 October update verified its required operations using existing permissions; direct administrative inspection restrictions remain. Tags are an initial-creation scope, not the same as an exact generated resource ID. The owner can review residual creation capabilities separately. Do not broaden policies automatically. [API Gateway IAM reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_apigatewayv2.html), [CloudFront IAM reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

CloudFormation service-role access can outlive the caller's `PassRole` access for a stack. Limit who can operate this stack and protect the execution role accordingly. [AWS service-role guidance](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).

## Original owner bootstrap reference

The current application's bootstrap and roles already exist. These original setup steps are retained for reference; do not rerun them to update this application.

1. Use the account owner's existing authorised administrative **role**, not root and not RideWatch. Review both `sam/bootstrap-template.yaml` and `sam/cloud-template.yaml`, names, cost controls and trust principal.
2. The owner creates the bootstrap named `drystock-demo-bootstrap` with that principal and `CAPABILITY_NAMED_IAM`, or creates the same resources/roles manually. This is a proposed owner action; it has not been run. Record the runtime role ARN, CloudFormation role ARN and OAC ID outputs.
3. The owner grants the selected SSO/federated base role only `sts:AssumeRole` on `arn:aws:iam::071031980923:role/drystock-deploy`, in addition to the target role trust. No modification of unrelated IAM policies is needed. A separate narrowly scoped permission set is appropriate.
4. Configure local temporary access using either option below. Do not paste credentials into chat, commit them, or put them in environment/source files.

### Recommended: IAM Identity Center + role assumption

Obtain the existing Start URL and SSO Region from the owner. The SSO Region may differ from `ap-south-1`. Configure a separate base profile with the owner-assigned minimal permission set:

```powershell
rtk proxy aws configure sso --profile drystock-sso
rtk proxy aws sso login --profile drystock-sso
rtk proxy aws configure set role_arn arn:aws:iam::071031980923:role/drystock-deploy --profile drystock-deploy
rtk proxy aws configure set source_profile drystock-sso --profile drystock-deploy
rtk proxy aws configure set region ap-south-1 --profile drystock-deploy
rtk proxy aws configure set output json --profile drystock-deploy
rtk proxy aws sts get-caller-identity --profile drystock-deploy
```

The wizard/login happen locally in your terminal/browser. These commands do not create IAM roles. CLI role assumption obtains and caches temporary credentials automatically. Expected STS ARN: `arn:aws:sts::071031980923:assumed-role/drystock-deploy/...`. [SSO setup](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html), [CLI role profiles](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-role.html).

### Alternative: existing temporary credential provider

An account-approved federation/credential-process tool can supply short-lived credentials to `drystock-deploy`; or configure a separate temporary source profile locally and the same `role_arn`/`source_profile` chain. Use the owner's tool/portal, keep values out of shell command history and chat, and include the temporary session token when the tool requires it. Never create a permanent administrator access key. Credential-provider commands are not invented here because the account's provider has not been supplied.

Access is now configured and STS-verified. Current updates use only `drystock-deploy`, inspect the existing `drystock-demo` stack, and preserve its OAC/runtime role/budget parameters through `UsePreviousValue`. No bootstrap or access expansion is part of the code update.
