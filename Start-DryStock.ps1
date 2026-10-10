param([switch]$Install, [ValidateSet('local','sam')][string]$ComputeBackend = 'local', [string]$Database = '', [int]$BackendPort = 8000, [int]$FrontendPort = 3000)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$pythonExe = Join-Path $taskRoot '.venv\Scripts\python.exe'
$frontendDir = Join-Path $taskRoot 'frontend'
$backendDir = Join-Path $taskRoot 'backend'
$env:DRYSTOCK_COMPUTE_BACKEND = $ComputeBackend
$env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
if ($Database) { $env:DRYSTOCK_DB = [System.IO.Path]::GetFullPath($Database) }
if ($Install) {
    if (-not (Test-Path -LiteralPath $pythonExe)) { & rtk proxy python -m venv (Join-Path $taskRoot '.venv') }
    & rtk proxy $pythonExe -m pip install -r (Join-Path $backendDir 'requirements.lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed' }
    Push-Location $frontendDir
    try { & rtk proxy npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' } }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run .\Start-DryStock.ps1 -Install first' }
foreach ($taskPort in @($BackendPort, $FrontendPort)) {
    if (Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $taskPort is already in use. Stop that process or use the README manual launch commands."
    }
}
$backendProcess = Start-Process -FilePath $pythonExe -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$BackendPort" -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($backendProcess.HasExited) { throw 'Backend exited during startup' }
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/health"
            if ($response.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Backend did not become ready' }
    Write-Host "DryStock: http://127.0.0.1:$FrontendPort | API docs: http://127.0.0.1:$BackendPort/docs | Compute: $ComputeBackend"
    $databasePath = if ($env:DRYSTOCK_DB) { $env:DRYSTOCK_DB } else { Join-Path $backendDir 'drystock.sqlite3' }
    Write-Host "Press Ctrl+C to stop. Yard changes persist in $databasePath."
    Push-Location $frontendDir
    try { & rtk proxy npm.cmd run dev -- --port $FrontendPort }
    finally { Pop-Location }
} finally {
    if (-not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id }
}
