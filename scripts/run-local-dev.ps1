# CanQuest - start local dev (PC)
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\run-local-dev.ps1

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if (-not (Test-Path (Join-Path $Root "apps\api"))) {
    Write-Host "ERROR: Run from repo root. Expected apps\api under: $Root" -ForegroundColor Red
    exit 1
}

Write-Host "=== CanQuest local dev ===" -ForegroundColor Cyan
Write-Host "Repo: $Root"

function Stop-ListenPort {
    param([int]$Port)
    $lines = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
    foreach ($line in $lines) {
        if ($line -match '\s+(\d+)\s*$') {
            $procId = [int]$Matches[1]
            Write-Host "  Stop PID $procId on port $Port"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ""
Write-Host "[1] Docker (postgres + redis)..." -ForegroundColor Yellow
Set-Location -LiteralPath $Root
docker compose -f docker-compose.dev.yml up -d
if ($LASTEXITCODE -ne 0) {
    docker compose up postgres redis -d
}

Write-Host ""
Write-Host "[2] Free ports 3000 / 3001..." -ForegroundColor Yellow
Stop-ListenPort -Port 3001
Stop-ListenPort -Port 3000
Start-Sleep -Seconds 2

$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"

Write-Host ""
Write-Host "[3] Start API (new window)..." -ForegroundColor Yellow
$apiCmd = "Set-Location -LiteralPath '$ApiDir'; npm run start:dev"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $apiCmd

Start-Sleep -Seconds 10

Write-Host ""
Write-Host "[4] Start Web (new window)..." -ForegroundColor Yellow
$webCmd = "Set-Location -LiteralPath '$WebDir'; npm run dev"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $webCmd

Start-Sleep -Seconds 8

Write-Host ""
Write-Host "[5] Health check..." -ForegroundColor Yellow
try {
    $h = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 8
    Write-Host "  API: OK ($($h.service))" -ForegroundColor Green
} catch {
    Write-Host "  API: not ready yet - wait for 'API running on port 3001' in the API window" -ForegroundColor Red
}

Write-Host ""
Write-Host "Open: http://localhost:3000" -ForegroundColor Cyan
Write-Host 'TestNet tunnel: scripts\tunnel-testnet.ps1 -ParticipantIp <IP> -NginxIp <IP>'
Write-Host 'See docs/CANTON_TESTNET.md — validator VPS: 162.250.190.204'
Write-Host 'Register invite: CANQUEST | Admin login: ADMIN_PANEL_EMAIL in apps/api/.env'
