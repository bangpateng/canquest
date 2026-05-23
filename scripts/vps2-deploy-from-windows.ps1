# Deploy CanQuest to VPS 2 from Windows (SSH + optional env upload).
# Usage:
#   .\scripts\vps2-deploy-from-windows.ps1
#   .\scripts\vps2-deploy-from-windows.ps1 -Seed
#   .\scripts\vps2-deploy-from-windows.ps1 -SshUser root -VpsHost 62.171.185.56
#
# Prerequisites:
#   1. Your id_rsa.pub is in ~/.ssh/authorized_keys on VPS 2
#   2. Code is on GitHub (git push) OR repo already cloned on server
#   3. apps/api/.env and apps/web/.env configured locally (for -UploadEnv)

param(
    [string]$VpsHost = "62.171.185.56",
    [string]$SshUser = "root",
    [string]$RepoPath = "/var/www/canquest",
    [string]$GitRemote = "https://github.com/bangpateng/canquest.git",
    [switch]$Seed,
    [switch]$UploadEnv,
    [switch]$SkipGitPull
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$Key = "$env:USERPROFILE\.ssh\id_rsa"
$SshTarget = "${SshUser}@${VpsHost}"

function Invoke-Ssh([string]$RemoteCmd) {
    & ssh -i $Key -o StrictHostKeyChecking=accept-new $SshTarget $RemoteCmd
    if ($LASTEXITCODE -ne 0) { throw "SSH failed (exit $LASTEXITCODE)" }
}

function Invoke-Scp([string]$Local, [string]$Remote) {
    & scp -i $Key -o StrictHostKeyChecking=accept-new $Local "${SshTarget}:${Remote}"
    if ($LASTEXITCODE -ne 0) { throw "SCP failed (exit $LASTEXITCODE)" }
}

Write-Host "=== CanQuest VPS 2 deploy (from Windows) ===" -ForegroundColor Cyan
Write-Host "Target: $SshTarget  Path: $RepoPath"

Write-Host "`n[0] Testing SSH..." -ForegroundColor Yellow
try {
    Invoke-Ssh "echo SSH_OK && uname -a"
} catch {
    Write-Host @"

SSH failed. Add this PC's public key to VPS 2:

  Get-Content `$env:USERPROFILE\.ssh\id_rsa.pub

Paste into /root/.ssh/authorized_keys on the server (via provider console or password SSH).

Then re-run this script.

"@ -ForegroundColor Red
    exit 1
}

if ($UploadEnv) {
    $apiEnv = Join-Path $RepoRoot "apps\api\.env"
    $webEnv = Join-Path $RepoRoot "apps\web\.env"
    if (-not (Test-Path $apiEnv)) { throw "Missing $apiEnv" }
    if (-not (Test-Path $webEnv)) { throw "Missing $webEnv" }
    Write-Host "`n[1] Uploading .env files..." -ForegroundColor Yellow
    Invoke-Ssh "mkdir -p $RepoPath/apps/api $RepoPath/apps/web"
    Invoke-Scp $apiEnv "$RepoPath/apps/api/.env"
    Invoke-Scp $webEnv "$RepoPath/apps/web/.env"
} else {
    Write-Host "`n[1] Skipping env upload (use -UploadEnv to copy local .env)" -ForegroundColor DarkGray
}

if (-not $SkipGitPull) {
    Write-Host "`n[2] Git pull on server..." -ForegroundColor Yellow
    $cloneOrPull = @"
set -e
if [ ! -d '$RepoPath/.git' ]; then
  sudo mkdir -p $(dirname '$RepoPath')
  sudo chown `$USER:`$USER $(dirname '$RepoPath') 2>/dev/null || true
  git clone '$GitRemote' '$RepoPath'
fi
cd '$RepoPath'
git fetch origin
git checkout master 2>/dev/null || git checkout main
git pull --ff-only origin master 2>/dev/null || git pull --ff-only origin main
"@
    Invoke-Ssh $cloneOrPull
}

$seedFlag = if ($Seed) { "--seed" } else { "" }
Write-Host "`n[3] Running deploy-vps2.sh $seedFlag ..." -ForegroundColor Yellow
Invoke-Ssh "cd '$RepoPath' && chmod +x scripts/deploy-vps2.sh && ./scripts/deploy-vps2.sh $seedFlag"

Write-Host "`n[4] Health checks..." -ForegroundColor Yellow
Invoke-Ssh @"
curl -sf http://127.0.0.1:3001/api/health && echo ' API OK' || echo ' API FAIL'
curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 | grep -q 200 && echo ' Web OK' || echo ' Web check (may need login page)'
curl -sf http://127.0.0.1:7575/livez >/dev/null && echo ' Canton tunnel OK' || echo ' Canton tunnel not ready (set up canton-tunnel.service)'
"@

Write-Host @"

Done. Next on VPS 2 (if not done yet):
  - sudo cp $RepoPath/infra/nginx/canquest.conf /etc/nginx/sites-available/canquest
  - Edit server_name, then: sudo nginx -t && sudo systemctl reload nginx
  - certbot for HTTPS

Public: http://$VpsHost  (or https://canquest.cc)

"@ -ForegroundColor Green
