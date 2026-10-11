# Offline: intercept every external command. No AWS calls or Docker builds.
$ErrorActionPreference = 'Stop'
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('drystock-deploy-tests-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path (Join-Path $sandbox 'sam'), (Join-Path $sandbox '.aws-sam')
Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'Deploy-Cloud.ps1') -Destination (Join-Path $sandbox 'sam/Deploy-Cloud.ps1')
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw "Assertion failed: $Message" } }
function rtk {
    $command = @($args)
    $global:deployTest.Calls.Add(($command -join ' '))
    $global:LASTEXITCODE = 0
    Assert ($command[0] -eq 'proxy') 'RTK proxy required'
    if ($command[1] -eq 'aws') {
        $operation = $command[3]
        if ($command[2] -eq 'sts') { return '{"Account":"071031980923","Arn":"arn:aws:sts::071031980923:assumed-role/drystock-deploy/test"}' }
        if ($command[2] -eq 'ecr') { return 'fictional-test-token' }
        if ($command[2] -eq 's3') { return '{}' }
        if ($command[2] -eq 'cloudfront') { return '{"Invalidation":{"Id":"test"}}' }
        Assert ($command[2] -eq 'cloudformation') 'Unexpected service'
        switch ($operation) {
            'describe-stacks' {
                if ($global:deployTest.MissingStack) { $global:LASTEXITCODE = 254; return 'Stack does not exist' }
                return '{"Stacks":[{"StackStatus":"UPDATE_COMPLETE","RoleARN":"arn:aws:iam::071031980923:role/drystock-demo-cloudformation","Parameters":[{"ParameterKey":"LambdaExecutionRoleArn","ParameterValue":"arn:aws:iam::071031980923:role/drystock-demo-runtime"},{"ParameterKey":"OriginAccessControlId","ParameterValue":"original-oac"},{"ParameterKey":"BudgetEmail","ParameterValue":""}],"Outputs":[{"OutputKey":"ApiUrl","OutputValue":"https://fictional.invalid"},{"OutputKey":"SiteBucketName","OutputValue":"drystock-demo-site-071031980923-ap-south-1"},{"OutputKey":"DistributionId","OutputValue":"test"},{"OutputKey":"WebsiteUrl","OutputValue":"https://fictional.invalid"}]}]}'
            }
            'list-stack-resources' { return '{"StackResourceSummaries":[{"LogicalResourceId":"Sessions","PhysicalResourceId":"drystock-demo-sessions"}]}' }
            'create-change-set' {
                Assert ($command[[array]::IndexOf($command,'--change-set-type')+1] -eq 'UPDATE') 'UPDATE only'
                $parameters = Get-Content (Join-Path $sandbox '.aws-sam/cloud-parameters.json') -Raw | ConvertFrom-Json
                Assert ($parameters.Count -eq 3 -and @($parameters | Where-Object { -not $_.UsePreviousValue }).Count -eq 0) 'Preserve all parameters'
                return '{}'
            }
            'get-template' {
                $image = if ($command -contains '--change-set-name') { 'new-image' } else { 'old-image' }
                $body=@{TemplateBody=@{Resources=@{CloudFunction=@{Properties=@{Code=@{ImageUri=$image}}}}}}
                if ($global:deployTest.TemplateDrift -and $command -contains '--change-set-name') { $body.TemplateBody.Resources.CloudFunction.Properties.Role='expanded-role' }
                return ($body | ConvertTo-Json -Depth 20 -Compress)
            }
            'wait' { if ($global:deployTest.WaitFailure) { $global:LASTEXITCODE = 255 }; return }
            'describe-change-set' {
                if ($global:deployTest.DescribeDenied) { $global:LASTEXITCODE=254; return '{}' }
                return ($global:deployTest.Details | ConvertTo-Json -Depth 20 -Compress)
            }
            'execute-change-set' { return '{}' }
            default { throw "Unexpected operation: $operation" }
        }
    }
    Assert ($command[1] -eq 'npm.cmd' -or $command[1] -eq 'docker' -or $command[1] -like '*sam.exe') 'Unexpected command'
}
function Run-Case([string]$Name, [hashtable]$Options, [hashtable]$Arguments, [bool]$Executes, [string]$Failure='') {
    $global:deployTest = @{
        Calls=[System.Collections.Generic.List[string]]::new()
        Details=@{ChangeSetName='drystock-123';Status='CREATE_COMPLETE';ExecutionStatus='AVAILABLE';Changes=@(@{ResourceChange=@{
            LogicalResourceId='CloudFunction';ResourceType='AWS::Lambda::Function';Action='Modify';Replacement='False';Scope=@('Properties')
            Details=@(@{Target=@{Attribute='Properties';Name='Code';RequiresRecreation='Never'}})
        }})}
    }
    foreach ($key in $Options.Keys) { $global:deployTest[$key] = $Options[$key] }
    if ($Options.ApiDependency) {
        $global:deployTest.Details.Changes += @{ResourceChange=@{
            LogicalResourceId='Api';ResourceType='AWS::ApiGatewayV2::Api';Action='Modify';Replacement='False';Scope=@('Properties')
            Details=@(@{Target=@{Attribute='Properties';Name='Body';RequiresRecreation='Never'};Evaluation='Dynamic';ChangeSource='ResourceAttribute';CausingEntity='CloudFunction.Arn'})
        }}
    }
    $errorText = ''
    try { & (Join-Path $sandbox 'sam/Deploy-Cloud.ps1') -Provision @Arguments 6>$null 2>$null }
    catch { $errorText = $_.Exception.Message }
    if ($Failure) { Assert ($errorText.Contains($Failure)) "$Name expected $Failure; got $errorText" }
    else { Assert (-not $errorText) "$Name failed: $errorText" }
    $calls = $global:deployTest.Calls
    Assert (@($calls | Where-Object { $_ -like '*execute-change-set*' }).Count -eq [int]$Executes) "$Name execution gate"
    Assert (@($calls | Where-Object { $_ -like '*aws s3 cp*' }).Count -eq [int]$Executes) "$Name upload gate"
    Assert (@($calls | Where-Object { $_ -like '*cloudfront create-invalidation*' }).Count -eq [int]$Executes) "$Name invalidation gate"
    if ($Executes) {
        Assert (@($calls | Where-Object { $_ -like '*cloudfront wait invalidation-completed*' }).Count -eq 1) 'Wait for invalidation'
        Assert (@($calls | Where-Object { $_ -like '*describe-change-set*' }).Count -eq 1) 'Review before execution'
    }
    Write-Host "PASS $Name"
}
try {
    Run-Case 'profile guard' @{} @{Profile='default'} $false 'Only the separate authorised'
    Run-Case 'region guard' @{} @{Region='us-east-1'} $false 'ap-south-1'
    Run-Case 'missing stack stops without CREATE' @{MissingStack=$true} @{} $false 'describe-stacks'
    Run-Case 'preserve OAC' @{} @{OriginAccessControlId='different'} $false 'must be preserved'
    Run-Case 'preserve budget' @{} @{BudgetEmail='different'} $false 'must be preserved'
    Run-Case 'prepare only never executes' @{} @{PrepareOnly=$true} $false
    Run-Case 'code UPDATE executes and waits' @{} @{} $true
    Run-Case 'execute reviewed set without rebuild' @{} @{ExecuteChangeSet='drystock-123'} $true
    Run-Case 'SAM dependency with identical processed API' @{ApiDependency=$true} @{} $true
    Run-Case 'template drift cannot bypass property guard' @{TemplateDrift=$true} @{} $false 'differ beyond Lambda image code'
    Run-Case 'inspection denial stops' @{DescribeDenied=$true} @{} $false 'describe-change-set'
    Run-Case 'waiter failure stops' @{WaitFailure=$true} @{} $false 'did not become ready'
    Run-Case 'empty backend update stops' @{Details=@{Status='FAILED';StatusReason='No updates are to be performed.';Changes=@()}} @{} $false 'not executable'
    foreach ($unsafe in @(
        @{Name='table replacement';Id='Sessions';Type='AWS::DynamoDB::Table';Action='Modify';Replacement='True';Property='Code'},
        @{Name='conditional replacement';Id='CloudFunction';Type='AWS::Lambda::Function';Action='Modify';Replacement='Conditional';Property='Code'},
        @{Name='resource deletion';Id='SiteBucket';Type='AWS::S3::Bucket';Action='Remove';Replacement='False';Property='Code'},
        @{Name='resource addition';Id='Other';Type='AWS::Lambda::Function';Action='Add';Replacement='False';Property='Code'},
        @{Name='permission edit';Id='CloudFunction';Type='AWS::Lambda::Function';Action='Modify';Replacement='False';Property='Role'}
    )) {
        $details=@{Status='CREATE_COMPLETE';ExecutionStatus='AVAILABLE';Changes=@(@{ResourceChange=@{
            LogicalResourceId=$unsafe.Id;ResourceType=$unsafe.Type;Action=$unsafe.Action;Replacement=$unsafe.Replacement;Scope=@('Properties')
            Details=@(@{Target=@{Attribute='Properties';Name=$unsafe.Property;RequiresRecreation='Never'}})
        }})}
        $expected = if ($unsafe.Property -eq 'Role') {'Unexpected Lambda property'} else {'Unsafe infrastructure change'}
        Run-Case $unsafe.Name @{Details=$details} @{} $false $expected
    }
} finally {
    Remove-Item Function:rtk
    Remove-Variable deployTest -Scope Global
    $resolved = [System.IO.Path]::GetFullPath($sandbox)
    Assert ($resolved.StartsWith([System.IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) 'Cleanup stays in explicitly created temp directory'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
