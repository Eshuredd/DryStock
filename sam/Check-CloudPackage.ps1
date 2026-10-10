$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$samCommand = Join-Path $taskRoot '.sam-venv\Scripts\sam.exe'
$env:SAM_CLI_TELEMETRY = '0'
$env:AWS_EC2_METADATA_DISABLED = 'true'
$env:AWS_DEFAULT_REGION = 'ap-south-1'
Push-Location $taskRoot
try {
    New-Item -ItemType Directory -Force -Path artifacts/phase3 | Out-Null
    & rtk proxy $samCommand build --template-file sam/cloud-template.yaml --build-dir .aws-sam/cloud-build
    if ($LASTEXITCODE -ne 0) { throw 'Cloud-compatible image build failed' }
    & rtk proxy $samCommand local invoke CloudFunction --template-file .aws-sam/cloud-build/template.yaml --event sam/events/cloud-health.json --log-file artifacts/phase3/cloud-health-sam.log
    if ($LASTEXITCODE -ne 0) { throw 'Local package health invocation failed' }
    Write-Host 'Local Lambda package check complete. This does not verify cloud deployment or real DynamoDB.'
} finally { Pop-Location }
