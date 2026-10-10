param([string]$SamCommand = '', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $taskRoot '.venv\Scripts\python.exe'
if (-not $SamCommand) {
    $isolatedSam = Join-Path $taskRoot '.sam-venv\Scripts\sam.exe'
    $SamCommand = if (Test-Path -LiteralPath $isolatedSam) { $isolatedSam } else { 'sam' }
}
$env:SAM_CLI_TELEMETRY = '0'
$env:AWS_EC2_METADATA_DISABLED = 'true'
$env:AWS_DEFAULT_REGION = 'ap-south-1'
Push-Location $taskRoot
try {
    & rtk proxy $pythonExe sam/prepare_events.py
    if ($LASTEXITCODE -ne 0) { throw 'Event generation failed' }
    & rtk proxy $SamCommand validate --lint --template-file sam/template.yaml
    if ($LASTEXITCODE -ne 0) { throw 'SAM template validation failed' }
    if (-not $SkipBuild) {
        & rtk proxy $SamCommand build --template-file sam/template.yaml
        if ($LASTEXITCODE -ne 0) { throw 'SAM container build failed' }
    }
    foreach ($caseName in @('original', 'disruption')) {
        $eventPath = "sam/events/$caseName.json"
        $responsePath = "artifacts/sam-$caseName-response.json"
        $runtimeLog = "artifacts/sam-$caseName-runtime.log"
        & rtk proxy $SamCommand local invoke ProtectionFunction --template-file .aws-sam/build/template.yaml --event $eventPath --log-file $runtimeLog
        if ($LASTEXITCODE -ne 0) { throw "SAM invocation failed: $caseName" }
        & rtk proxy $pythonExe sam/verify_response.py --event $eventPath --response $runtimeLog --normalized-response $responsePath --output "artifacts/sam-$caseName-comparison.json"
        if ($LASTEXITCODE -ne 0) { throw "SAM comparison failed: $caseName" }
    }
} finally { Pop-Location }
