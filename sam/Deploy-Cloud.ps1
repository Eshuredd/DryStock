param(
    [switch]$Provision,
    [string]$Profile = 'drystock-deploy',
    [string]$AccountId = '071031980923',
    [string]$Region = 'ap-south-1',
    [string]$OriginAccessControlId = '',
    [string]$BudgetEmail = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$samCommand = Join-Path $taskRoot '.sam-venv\Scripts\sam.exe'
$env:SAM_CLI_TELEMETRY = '0'
$env:AWS_EC2_METADATA_DISABLED = 'true'
$stackName = 'drystock-demo'
if (-not $Provision) {
    Write-Host 'Review only. No AWS calls or provisioning. Read sam/IAM_ACCESS.md and DEPLOYMENT.md.'
    Write-Host 'After owner-approved access, use -Provision -OriginAccessControlId <bootstrap-output> -BudgetEmail <alert-email>.'
    exit 0
}
if ($Profile -ne 'drystock-deploy') { throw 'Only the separate authorised drystock-deploy profile is permitted.' }
if (-not $OriginAccessControlId) { throw 'The owner-approved bootstrap OAC ID is required.' }
function AwsJson([string[]]$Arguments) {
    $result = & rtk proxy aws @Arguments --profile $Profile --region $Region --no-cli-pager --output json
    if ($LASTEXITCODE -ne 0) { throw "AWS operation failed: $($Arguments[0]) $($Arguments[1]). Stop and inspect the named permission; do not broaden automatically." }
    return ($result | ConvertFrom-Json)
}
Push-Location $taskRoot
try {
    $identity = AwsJson @('sts','get-caller-identity')
    if ($identity.Account -ne $AccountId -or $identity.Arn -notmatch 'assumed-role/(drystock-deploy|AWSReservedSSO_DryStock)') {
        throw 'Unexpected account or deployment identity. An account-approved temporary deployment role is required.'
    }
    $cfRole = "arn:aws:iam::${AccountId}:role/drystock-demo-cloudformation"
    $runtimeRole = "arn:aws:iam::${AccountId}:role/drystock-demo-runtime"
    $artifactBucket = "drystock-demo-artifacts-${AccountId}-${Region}"
    $repository = "${AccountId}.dkr.ecr.${Region}.amazonaws.com/drystock-demo"
    & rtk proxy $samCommand validate --lint --template-file sam/cloud-template.yaml
    if ($LASTEXITCODE -ne 0) { throw 'Template lint failed' }
    & rtk proxy $samCommand build --template-file sam/cloud-template.yaml --build-dir .aws-sam/cloud-build
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
    # Official CLI token is piped directly to Docker; never echoed or written to project files.
    & rtk proxy aws ecr get-login-password --profile $Profile --region $Region | & rtk proxy docker login --username AWS --password-stdin "${AccountId}.dkr.ecr.${Region}.amazonaws.com"
    if ($LASTEXITCODE -ne 0) { throw 'ECR login failed' }
    & rtk proxy $samCommand package --template-file .aws-sam/cloud-build/template.yaml --image-repository $repository --s3-bucket $artifactBucket --output-template-file .aws-sam/cloud-packaged.yaml --profile $Profile --region $Region
    if ($LASTEXITCODE -ne 0) { throw 'SAM package failed' }
    $type = 'UPDATE'
    $describeErrorActionPreference = $ErrorActionPreference
    try {
        # PowerShell 5.1 treats native stderr as error records; inspect the exit code below.
        $ErrorActionPreference = 'Continue'
        $stackText = & rtk proxy aws cloudformation describe-stacks --stack-name $stackName --profile $Profile --region $Region --no-cli-pager 2>&1
        $stackExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $describeErrorActionPreference
    }
    if ($stackExitCode -ne 0) {
        if (($stackText | Out-String) -match 'does not exist') { $type = 'CREATE' }
        else { throw 'Could not inspect the named stack. Verify DescribeStacks permission before provisioning.' }
    }
    $changeSet = "drystock-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    $parameters = @(
        @{ParameterKey='LambdaExecutionRoleArn';ParameterValue=$runtimeRole},
        @{ParameterKey='OriginAccessControlId';ParameterValue=$OriginAccessControlId},
        @{ParameterKey='BudgetEmail';ParameterValue=$BudgetEmail}
    )
    [System.IO.File]::WriteAllText((Join-Path $taskRoot '.aws-sam/cloud-parameters.json'), ($parameters | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    $null = AwsJson @('cloudformation','create-change-set','--stack-name',$stackName,'--change-set-name',$changeSet,'--change-set-type',$type,'--template-body','file://.aws-sam/cloud-packaged.yaml','--parameters','file://.aws-sam/cloud-parameters.json','--role-arn',$cfRole,'--capabilities','CAPABILITY_AUTO_EXPAND','--tags','Key=Project,Value=DryStock','Key=Environment,Value=demo')
    $waitErrorActionPreference = $ErrorActionPreference
    try {
        # Capture native stderr on PowerShell 5.1 so a failed waiter can be diagnosed.
        $ErrorActionPreference = 'Continue'
        $changeSetWaitText = & rtk proxy aws cloudformation wait change-set-create-complete --stack-name $stackName --change-set-name $changeSet --profile $Profile --region $Region 2>&1
        $changeSetWaitExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $waitErrorActionPreference
    }
    $skipStackUpdate = $false
    if ($changeSetWaitExitCode -ne 0) {
        $details = AwsJson @('cloudformation','describe-change-set','--stack-name',$stackName,'--change-set-name',$changeSet)
        $reason = [string]$details.StatusReason
        $waitFailure = ($changeSetWaitText | Out-String).Trim()
        $emptyReason = $reason -ceq 'No updates are to be performed.' -or
            $reason -ceq "The submitted information didn't contain changes. Submit different information to create a change set."
        # Only a terminal FAILED waiter plus a confirmed empty UPDATE is harmless.
        # Permission errors/timeouts must still stop, even if an old empty set is describable.
        $terminalFailure = $waitFailure -match '(?s)Waiter ChangeSetCreateComplete failed:.*terminal failure state:.*"FAILED"'
        if ($type -eq 'UPDATE' -and $details.Status -eq 'FAILED' -and $emptyReason -and -not $details.Changes -and $terminalFailure) {
            $skipStackUpdate = $true
            Write-Host "No infrastructure changes: $reason Continuing with frontend validation and upload."
        } else {
            if (-not $reason) { $reason = 'No StatusReason returned.' }
            throw "Change set '$changeSet' did not become ready ($($details.Status)): $reason Waiter: $waitFailure"
        }
    }
    if (-not $skipStackUpdate) {
        $null = AwsJson @('cloudformation','execute-change-set','--stack-name',$stackName,'--change-set-name',$changeSet)
        $waiter = if ($type -eq 'CREATE') { 'stack-create-complete' } else { 'stack-update-complete' }
        & rtk proxy aws cloudformation wait $waiter --stack-name $stackName --profile $Profile --region $Region
        if ($LASTEXITCODE -ne 0) { throw 'Stack did not complete. Inspect stack events for the exact failure.' }
    }
    $stack = AwsJson @('cloudformation','describe-stacks','--stack-name',$stackName)
    $outputs = @{}
    foreach ($entry in $stack.Stacks[0].Outputs) { $outputs[$entry.OutputKey] = $entry.OutputValue }
    $env:DRYSTOCK_STATIC_EXPORT = '1'
    $env:NEXT_PUBLIC_API_BASE_URL = $outputs.ApiUrl
    & rtk proxy npm.cmd --prefix frontend run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed' }
    & rtk proxy npm.cmd --prefix frontend run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Frontend typecheck failed' }
    & rtk proxy npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Static build failed' }
    # Upload only assets to this named stack's exact bucket. No delete/sync of unrelated buckets.
    & rtk proxy aws s3 cp frontend/out "s3://$($outputs.SiteBucketName)/" --recursive --cache-control 'public,max-age=300' --profile $Profile --region $Region
    if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed' }
    $null = AwsJson @('cloudfront','create-invalidation','--distribution-id',$outputs.DistributionId,'--paths','/*')
    New-Item -ItemType Directory -Force -Path artifacts/phase3 | Out-Null
    $outputs | ConvertTo-Json | Set-Content artifacts/phase3/deployment.json -Encoding utf8
    Write-Host "Assets uploaded: $($outputs.WebsiteUrl). Real cloud/API/browser checks are still required before declaring success."
} finally {
    Remove-Item Env:DRYSTOCK_STATIC_EXPORT -ErrorAction SilentlyContinue
    Remove-Item Env:NEXT_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}
