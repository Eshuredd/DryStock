param([switch]$Install)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$pythonExe = Join-Path $taskRoot '.venv\Scripts\python.exe'
$frontendDir = Join-Path $taskRoot 'frontend'
$backendDir = Join-Path $taskRoot 'backend'
if ($Install) {
    if (-not (Test-Path -LiteralPath $pythonExe)) { & rtk proxy python -m venv (Join-Path $taskRoot '.venv') }
    & rtk proxy $pythonExe -m pip install -r (Join-Path $backendDir 'requirements.lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed' }
    Push-Location $frontendDir
    try { & rtk proxy npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' } }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run .\Start-DryStock.ps1 -Install first' }
foreach ($taskPort in @(8000, 3000)) {
    if (Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $taskPort is already in use. Stop that process or use the README manual launch commands."
    }
}
$backendProcess = Start-Process -FilePath $pythonExe -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($backendProcess.HasExited) { throw 'Backend exited during startup' }
        try {
            $response = Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
            if ($response.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Backend did not become ready' }
    Write-Host 'DryStock: http://127.0.0.1:3000 | API docs: http://127.0.0.1:8000/docs'
    Write-Host 'Press Ctrl+C to stop. All yard changes persist in backend/drystock.sqlite3.'
    Push-Location $frontendDir
    try { & rtk proxy npm.cmd run dev }
    finally { Pop-Location }
} finally {
    if (-not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id }
}
