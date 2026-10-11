# Offline regression tests: every external command is intercepted; no AWS calls occur.
$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'Deploy-Cloud.ps1'
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('drystock-deploy-tests-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path (Join-Path $sandbox 'sam'), (Join-Path $sandbox '.aws-sam')
Copy-Item -LiteralPath $source -Destination (Join-Path $sandbox 'sam/Deploy-Cloud.ps1')
$terminal = 'Waiter ChangeSetCreateComplete failed: Waiter encountered a terminal failure state: For expression "Status" we matched expected path: "FAILED"'

function Assert($Condition, [string]$Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}
function rtk {
    $command = @($args)
    $global:deployTest.Calls.Add(($command -join ' '))
    $global:LASTEXITCODE = 0
    Assert ($command[0] -eq 'proxy') 'Commands must use the RTK proxy'
    if ($command[1] -eq 'aws') {
        $service = $command[2]; $operation = $command[3]
        if ($service -eq 'sts') {
            return '{"Account":"071031980923","Arn":"arn:aws:sts::071031980923:assumed-role/drystock-deploy/test"}'
        }
        if ($service -eq 'ecr') { return 'fictional-test-token' }
        if ($service -eq 's3' -or $service -eq 'cloudfront') { return '{}' }
        Assert ($service -eq 'cloudformation') "Unexpected service: $service"
        if ($operation -eq 'describe-stacks') {
            $global:deployTest.Describes++
            if ($global:deployTest.Create -and $global:deployTest.Describes -eq 1) {
                $global:LASTEXITCODE = 254
                return 'Stack with id drystock-demo does not exist'
            }
            return '{"Stacks":[{"Outputs":[{"OutputKey":"ApiUrl","OutputValue":"https://fictional.invalid"},{"OutputKey":"SiteBucketName","OutputValue":"fictional-bucket"},{"OutputKey":"DistributionId","OutputValue":"fictional-distribution"},{"OutputKey":"WebsiteUrl","OutputValue":"https://fictional.invalid"}]}]}'
        }
        if ($operation -eq 'create-change-set') {
            $global:deployTest.ChangeSet = $command[[array]::IndexOf($command, '--change-set-name') + 1]
            return '{}'
        }
        if ($operation -eq 'wait') {
            if ($command[4] -eq 'change-set-create-complete' -and $global:deployTest.WaitFailure) {
                # ErrorRecord models native stderr under Windows PowerShell 5.1.
                Write-Error $global:deployTest.WaitFailure
                $global:LASTEXITCODE = 255
            } elseif ($command[4] -ne 'change-set-create-complete' -and $global:deployTest.StackWaitFails) {
                $global:LASTEXITCODE = 255
            }
            return
        }
        if ($operation -eq 'describe-change-set') {
            Assert ($command[[array]::IndexOf($command, '--change-set-name') + 1] -eq $global:deployTest.ChangeSet) 'Must inspect the exact created change set'
            Assert ($command[[array]::IndexOf($command, '--stack-name') + 1] -eq 'drystock-demo') 'Must inspect the named stack'
            if ($global:deployTest.DescribeDenied) { Write-Error 'AccessDenied: DescribeChangeSet is not authorised'; return }
            return ($global:deployTest.Details | ConvertTo-Json -Depth 5 -Compress)
        }
        Assert ($operation -eq 'execute-change-set') "Unexpected operation: $operation"
        return '{}'
    }
    Assert ($command[1] -eq 'npm.cmd' -or $command[1] -eq 'docker' -or $command[1] -like '*sam.exe') 'Unexpected external command'
    if ($command[1] -eq 'npm.cmd' -and $global:deployTest.FrontendFails) { $global:LASTEXITCODE = 1 }
}

function Run-Case([string]$Name, [hashtable]$Options, [bool]$Continues, [string]$ErrorContains = '') {
    $reportPath = Join-Path $sandbox 'artifacts/phase3/deployment.json'
    if (Test-Path $reportPath) { Remove-Item -LiteralPath $reportPath }
    $global:deployTest = @{
        Calls = [System.Collections.Generic.List[string]]::new(); Describes = 0
        WaitFailure = $terminal; Create = $false
        Details = @{Status = 'FAILED'; StatusReason = 'No updates are to be performed.'; Changes = @()}
    }
    foreach ($key in $Options.Keys) { $global:deployTest[$key] = $Options[$key] }
    $failure = ''
    try { & (Join-Path $sandbox 'sam/Deploy-Cloud.ps1') -Provision -OriginAccessControlId fictional-oac 6>$null 2>$null }
    catch { $failure = $_.Exception.Message }
    $calls = $global:deployTest.Calls
    $frontend = @($calls | Where-Object { $_ -like 'proxy npm.cmd*' })
    if ($Continues) {
        Assert (-not $failure) "$Name unexpectedly failed: $failure"
        Assert ($frontend.Count -eq 3) "$Name must lint, typecheck and build"
        Assert (@($calls | Where-Object { $_ -like 'proxy aws s3 cp*' }).Count -eq 1) "$Name must upload assets"
        Assert (@($calls | Where-Object { $_ -like 'proxy aws cloudfront create-invalidation*' }).Count -eq 1) "$Name must invalidate CloudFront"
        Assert ($global:deployTest.Describes -eq 2) "$Name must retrieve stack outputs after the change-set branch"
        Assert (Test-Path $reportPath) "$Name must report deployment outputs"
    } else {
        Assert ($failure.Contains($ErrorContains)) "$Name must expose the failure ($ErrorContains), got: $failure"
        Assert (@($calls | Where-Object { $_ -like 'proxy aws s3 cp*' }).Count -eq 0) "$Name must not upload"
        Assert (@($calls | Where-Object { $_ -like 'proxy aws cloudfront*' }).Count -eq 0) "$Name must not invalidate"
        Assert (-not (Test-Path $reportPath)) "$Name must not report successful deployment"
        if (-not $Options.FrontendFails -and -not $Options.StackWaitFails) { Assert ($frontend.Count -eq 0) "$Name must stop before frontend build" }
    }
    $execution = @($calls | Where-Object { $_ -like '*execute-change-set*' })
    $stackWait = @($calls | Where-Object { $_ -match 'wait stack-(create|update)-complete' })
    $normal = -not $Options.WaitFailure -and $Options.ContainsKey('WaitFailure')
    Assert ($execution.Count -eq [int]$normal) "$Name change-set execution gating"
    Assert ($stackWait.Count -eq [int]$normal) "$Name stack waiter gating"
    if ($normal) {
        $expectedWaiter = if ($Options.Create) { 'stack-create-complete' } else { 'stack-update-complete' }
        Assert ($stackWait[0].Contains($expectedWaiter)) "$Name must preserve the correct CREATE/UPDATE waiter"
    }
    Assert (-not (Test-Path Env:DRYSTOCK_STATIC_EXPORT)) "$Name must clean build environment"
    Write-Host "PASS $Name"
}

$oldTelemetry = $env:SAM_CLI_TELEMETRY
$oldMetadata = $env:AWS_EC2_METADATA_DISABLED
try {
    foreach ($guard in @(
        @{Name='profile safeguard'; Arguments=@{Profile='default';OriginAccessControlId='fictional-oac'}; Reason='Only the separate authorised'},
        @{Name='OAC safeguard'; Arguments=@{}; Reason='owner-approved bootstrap OAC ID is required'}
    )) {
        $global:deployTest = @{Calls=[System.Collections.Generic.List[string]]::new()}
        $failure = ''
        $guardArguments = $guard.Arguments
        try { & (Join-Path $sandbox 'sam/Deploy-Cloud.ps1') -Provision @guardArguments } catch { $failure = $_.Exception.Message }
        Assert ($failure.Contains($guard.Reason)) "$($guard.Name) must stop"
        Assert ($global:deployTest.Calls.Count -eq 0) "$($guard.Name) must stop before external commands"
        Write-Host "PASS $($guard.Name)"
    }
    Run-Case 'empty UPDATE continues frontend deployment' @{} $true
    Run-Case 'standard empty-change-set wording' @{Details=@{Status='FAILED';StatusReason="The submitted information didn't contain changes. Submit different information to create a change set.";Changes=@()}} $true
    Run-Case 'genuine failure exposes StatusReason' @{Details=@{Status='FAILED';StatusReason='Template validation failed: invalid resource';Changes=@()}} $false 'Template validation failed: invalid resource'
    Run-Case 'CREATE never bypasses failed change set' @{Create=$true} $false 'No updates are to be performed.'
    Run-Case 'nonempty changes cannot bypass failure' @{Details=@{Status='FAILED';StatusReason='No updates are to be performed.';Changes=@(@{ResourceChange=@{Action='Modify'}})}} $false 'No updates are to be performed.'
    Run-Case 'waiter permission failure is not ignored' @{WaitFailure='AccessDenied: not authorised to DescribeChangeSet'} $false 'AccessDenied'
    Run-Case 'waiter timeout is not ignored' @{WaitFailure='Waiter ChangeSetCreateComplete failed: Max attempts exceeded'} $false 'Max attempts exceeded'
    Run-Case 'inspection permission failure is not ignored' @{DescribeDenied=$true} $false 'AccessDenied'
    Run-Case 'successful UPDATE executes and waits' @{WaitFailure=''} $true
    Run-Case 'successful CREATE executes and waits' @{WaitFailure='';Create=$true} $true
    Run-Case 'frontend failure after empty UPDATE stops' @{FrontendFails=$true} $false 'Frontend lint failed'
    Run-Case 'stack waiter failure still stops' @{WaitFailure='';StackWaitFails=$true} $false 'Stack did not complete'
} finally {
    Remove-Item Function:rtk
    Remove-Variable deployTest -Scope Global
    $env:SAM_CLI_TELEMETRY = $oldTelemetry
    $env:AWS_EC2_METADATA_DISABLED = $oldMetadata
    # Only remove the explicitly created, resolved temporary test directory.
    $resolved = [System.IO.Path]::GetFullPath($sandbox)
    Assert ($resolved.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) 'Cleanup must stay in the temp directory'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
