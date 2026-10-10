param([Parameter(Mandatory=$true)][string]$ApiBaseUrl)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$priorExport = $env:DRYSTOCK_STATIC_EXPORT
$priorBase = $env:NEXT_PUBLIC_API_BASE_URL
try {
    $env:DRYSTOCK_STATIC_EXPORT = '1'
    $env:NEXT_PUBLIC_API_BASE_URL = $ApiBaseUrl
    & rtk proxy npm.cmd --prefix (Join-Path $taskRoot 'frontend') run build
    if ($LASTEXITCODE -ne 0) { throw 'Static frontend build failed' }
} finally {
    [Environment]::SetEnvironmentVariable('DRYSTOCK_STATIC_EXPORT', $priorExport, 'Process')
    [Environment]::SetEnvironmentVariable('NEXT_PUBLIC_API_BASE_URL', $priorBase, 'Process')
}
