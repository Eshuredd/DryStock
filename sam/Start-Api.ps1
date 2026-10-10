$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$isolatedSam = Join-Path $taskRoot '.sam-venv\Scripts\sam.exe'
$samCommand = if (Test-Path -LiteralPath $isolatedSam) { $isolatedSam } else { 'sam' }
$env:SAM_CLI_TELEMETRY = '0'
$env:AWS_EC2_METADATA_DISABLED = 'true'
$env:AWS_DEFAULT_REGION = 'ap-south-1'
Push-Location $taskRoot
try { & rtk proxy $samCommand local start-api --template-file .aws-sam/build/template.yaml --host 127.0.0.1 --port 3001 }
finally { Pop-Location }
