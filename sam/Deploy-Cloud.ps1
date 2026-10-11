param(
    [switch]$Provision,
    [switch]$PrepareOnly,
    [string]$ExecuteChangeSet = '',
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
    Write-Host 'Update the existing stack with -Provision -PrepareOnly, then -Provision -ExecuteChangeSet <reviewed-name>.'
    exit 0
}
if ($Profile -ne 'drystock-deploy') { throw 'Only the separate authorised drystock-deploy profile is permitted.' }
if ($AccountId -ne '071031980923' -or $Region -ne 'ap-south-1') { throw 'Only the existing DryStock account and ap-south-1 are permitted.' }
if ($PrepareOnly -and $ExecuteChangeSet) { throw 'PrepareOnly and ExecuteChangeSet cannot be combined.' }
if ($ExecuteChangeSet -and $ExecuteChangeSet -notmatch '^drystock-[0-9]+$') { throw 'Use an exact reviewed drystock change-set name.' }
function AwsJson([string[]]$Arguments) {
    $result = & rtk proxy aws @Arguments --profile $Profile --region $Region --no-cli-pager --output json
    if ($LASTEXITCODE -ne 0) { throw "AWS operation failed: $($Arguments[0]) $($Arguments[1]). Stop and inspect the named permission; do not broaden automatically." }
    return ($result | ConvertFrom-Json)
}
function Write-JsonFile([string]$Path, $Value) {
    [System.IO.File]::WriteAllText((Join-Path $taskRoot $Path), ($Value | ConvertTo-Json -Depth 30), [System.Text.UTF8Encoding]::new($false))
}
function Canonical-Json($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [System.Collections.IDictionary]) {
        $pairs = @($Value.Keys | Sort-Object | ForEach-Object { (ConvertTo-Json ([string]$_) -Compress) + ':' + (Canonical-Json $Value[$_]) })
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [pscustomobject]) {
        $pairs = @($Value.PSObject.Properties | Sort-Object Name | ForEach-Object { (ConvertTo-Json $_.Name -Compress) + ':' + (Canonical-Json $_.Value) })
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return '[' + (@($Value | ForEach-Object { Canonical-Json $_ }) -join ',') + ']'
    }
    return ConvertTo-Json $Value -Compress
}
function Review-CodeUpdate($Details) {
    if ($Details.Status -ne 'CREATE_COMPLETE' -or $Details.ExecutionStatus -ne 'AVAILABLE') { throw "Change set is not executable: $($Details.Status) $($Details.StatusReason)" }
    if (-not $Details.Changes) { throw 'No backend change was prepared; stop rather than claim a backend update.' }
    foreach ($entry in $Details.Changes) {
        $change = $entry.ResourceChange
        # Permit code plus SAM's unchanged API dependency; fail closed for
        # replacement, deletion, additions, permissions and configuration edits.
        $functionChange = $change.LogicalResourceId -eq 'CloudFunction' -and $change.ResourceType -eq 'AWS::Lambda::Function'
        $apiDependency = $change.LogicalResourceId -eq 'Api' -and $change.ResourceType -eq 'AWS::ApiGatewayV2::Api'
        if ((-not $functionChange -and -not $apiDependency) -or
            $change.Action -ne 'Modify' -or $change.Replacement -ne 'False' -or -not $change.Details -or
            @($change.Scope).Count -ne 1 -or $change.Scope[0] -ne 'Properties') {
            throw "Unsafe infrastructure change: $($change.Action) $($change.LogicalResourceId), replacement=$($change.Replacement). No execution or frontend upload."
        }
        foreach ($detail in $change.Details) {
            $code = $functionChange -and $detail.Target.Name -eq 'Code'
            $integration = $apiDependency -and $detail.Target.Name -eq 'Body' -and $detail.Evaluation -eq 'Dynamic' -and
                $detail.ChangeSource -eq 'ResourceAttribute' -and $detail.CausingEntity -eq 'CloudFunction.Arn'
            if ($detail.Target.Attribute -ne 'Properties' -or (-not $code -and -not $integration) -or $detail.Target.RequiresRecreation -ne 'Never') {
                throw "Unexpected Lambda property change: $($detail.Target.Name). No execution or frontend upload."
            }
        }
    }
    # SAM can flag the unchanged API Body when its referenced function is updated.
    # Prove the entire processed template is identical except for the image URI.
    if (@($Details.Changes | Where-Object { $_.ResourceChange.LogicalResourceId -eq 'CloudFunction' }).Count -ne 1) { throw 'Exactly one Lambda code modification is required.' }
    $old = (AwsJson @('cloudformation','get-template','--stack-name',$stackName,'--template-stage','Processed')).TemplateBody
    $new = (AwsJson @('cloudformation','get-template','--stack-name',$stackName,'--change-set-name',$Details.ChangeSetName,'--template-stage','Processed')).TemplateBody
    $oldImage = $old.Resources.CloudFunction.Properties.Code.ImageUri
    $newImage = $new.Resources.CloudFunction.Properties.Code.ImageUri
    if (-not $oldImage -or -not $newImage -or $oldImage -eq $newImage) { throw 'No different backend image in the reviewed template.' }
    $new.Resources.CloudFunction.Properties.Code.ImageUri = $oldImage
    if ((Canonical-Json $old) -cne (Canonical-Json $new)) { throw 'Processed templates differ beyond Lambda image code. Stop and review infrastructure.' }
    Write-JsonFile 'artifacts/cloud-update/template-review.json' @{previous_image=$oldImage;new_image=$newImage;only_image_uri_changed=$true}
    Write-Host ($Details.Changes.ResourceChange | Select-Object Action, LogicalResourceId, ResourceType, Replacement | Format-Table | Out-String)
}
$priorStatic = $env:DRYSTOCK_STATIC_EXPORT
$priorApi = $env:NEXT_PUBLIC_API_BASE_URL
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
    # UPDATE only: require the existing stack before any image builds or pushes.
    $existing = (AwsJson @('cloudformation','describe-stacks','--stack-name',$stackName)).Stacks[0]
    if (-not $existing -or $existing.RoleARN -ne $cfRole -or $existing.StackStatus -notmatch '_COMPLETE$') { throw 'Existing stack must be stable and use its approved CloudFormation role.' }
    $currentParameters = @{}
    foreach ($entry in $existing.Parameters) { $currentParameters[$entry.ParameterKey] = $entry.ParameterValue }
    if ($currentParameters.LambdaExecutionRoleArn -ne $runtimeRole -or
        ($OriginAccessControlId -and $OriginAccessControlId -ne $currentParameters.OriginAccessControlId) -or
        ($PSBoundParameters.ContainsKey('BudgetEmail') -and $BudgetEmail -ne $currentParameters.BudgetEmail)) { throw 'Existing role, OAC and budget parameters must be preserved for this code update.' }
    $before = (AwsJson @('cloudformation','list-stack-resources','--stack-name',$stackName)).StackResourceSummaries
    New-Item -ItemType Directory -Force -Path artifacts/cloud-update | Out-Null
    Write-JsonFile 'artifacts/cloud-update/resources-before.json' $before
    if (-not $ExecuteChangeSet) {
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
    $changeSet = "drystock-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    $parameters = @($existing.Parameters | ForEach-Object { @{ParameterKey=$_.ParameterKey;UsePreviousValue=$true} })
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
    if ($changeSetWaitExitCode -ne 0) {
        $details = AwsJson @('cloudformation','describe-change-set','--stack-name',$stackName,'--change-set-name',$changeSet)
        $reason = [string]$details.StatusReason
        $waitFailure = ($changeSetWaitText | Out-String).Trim()
        if (-not $reason) { $reason = 'No StatusReason returned.' }
        throw "Change set '$changeSet' did not become ready ($($details.Status)): $reason Waiter: $waitFailure. No backend or frontend deployment."
    }
    } else { $changeSet = $ExecuteChangeSet }
    $details = AwsJson @('cloudformation','describe-change-set','--stack-name',$stackName,'--change-set-name',$changeSet)
    Write-JsonFile 'artifacts/cloud-update/change-set.json' $details
    Review-CodeUpdate $details
    if ($PrepareOnly) { Write-Host "Prepared $changeSet. Review artifacts/cloud-update/change-set.json before executing this exact name."; return }
        $null = AwsJson @('cloudformation','execute-change-set','--stack-name',$stackName,'--change-set-name',$changeSet)
        $waiter = 'stack-update-complete'
        & rtk proxy aws cloudformation wait $waiter --stack-name $stackName --profile $Profile --region $Region
        if ($LASTEXITCODE -ne 0) { throw 'Stack did not complete. Inspect stack events for the exact failure.' }
    $after = (AwsJson @('cloudformation','list-stack-resources','--stack-name',$stackName)).StackResourceSummaries
    Write-JsonFile 'artifacts/cloud-update/resources-after.json' $after
    if ($before.Count -ne $after.Count) { throw 'Stack resource count changed unexpectedly.' }
    foreach ($resource in $before) {
        $match = @($after | Where-Object { $_.LogicalResourceId -eq $resource.LogicalResourceId })
        if ($match.Count -ne 1 -or $match[0].PhysicalResourceId -ne $resource.PhysicalResourceId) { throw "Resource identity changed: $($resource.LogicalResourceId)." }
    }
    $stack = AwsJson @('cloudformation','describe-stacks','--stack-name',$stackName)
    $outputs = @{}
    foreach ($entry in $stack.Stacks[0].Outputs) { $outputs[$entry.OutputKey] = $entry.OutputValue }
    if ($outputs.SiteBucketName -ne "drystock-demo-site-${AccountId}-${Region}") { throw 'Unexpected frontend bucket.' }
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
    $invalidation = AwsJson @('cloudfront','create-invalidation','--distribution-id',$outputs.DistributionId,'--paths','/*')
    Write-JsonFile 'artifacts/cloud-update/invalidation.json' $invalidation
    & rtk proxy aws cloudfront wait invalidation-completed --distribution-id $outputs.DistributionId --id $invalidation.Invalidation.Id --profile $Profile --region $Region
    if ($LASTEXITCODE -ne 0) { throw 'CloudFront invalidation did not complete.' }
    $completedInvalidation = AwsJson @('cloudfront','get-invalidation','--distribution-id',$outputs.DistributionId,'--id',$invalidation.Invalidation.Id)
    Write-JsonFile 'artifacts/cloud-update/invalidation.json' $completedInvalidation
    Write-JsonFile 'artifacts/cloud-update/deployment.json' $outputs
    New-Item -ItemType Directory -Force -Path artifacts/phase3 | Out-Null
    $outputs | ConvertTo-Json | Set-Content artifacts/phase3/deployment.json -Encoding utf8
    Write-Host "Assets uploaded: $($outputs.WebsiteUrl). Real cloud/API/browser checks are still required before declaring success."
} finally {
    $env:DRYSTOCK_STATIC_EXPORT = $priorStatic
    $env:NEXT_PUBLIC_API_BASE_URL = $priorApi
    Pop-Location
}
