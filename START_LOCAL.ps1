$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host 'Starting 30NICE Mail Cloud local services...' -ForegroundColor Cyan
Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', "Set-Location -LiteralPath '$Root'; npm run dev" -WorkingDirectory $Root
Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', "Set-Location -LiteralPath '$Root'; npm run dev:api" -WorkingDirectory $Root
Write-Host 'Portal: http://localhost:3002' -ForegroundColor Green
Write-Host 'API:    http://localhost:3001/health' -ForegroundColor Green
