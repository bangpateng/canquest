# SSH tunnel: local PC → CanQuest TestNet validator (162.250.190.204)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\tunnel-testnet.ps1 -ParticipantIp 172.19.0.5 -NginxIp 172.19.0.6
#
# Discover IPs on VPS:
#   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1
#   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-nginx-1

param(
    [Parameter(Mandatory = $false)]
    [string] $VpsHost = "162.250.190.204",
    [Parameter(Mandatory = $false)]
    [string] $SshUser = "root",
    [Parameter(Mandatory = $true)]
    [string] $ParticipantIp,
    [Parameter(Mandatory = $true)]
    [string] $NginxIp,
    [int] $LocalLedgerPort = 7575,
    [int] $LocalValidatorPort = 8080
)

$forwardLedger = "${LocalLedgerPort}:${ParticipantIp}:7575"
$forwardValidator = "${LocalValidatorPort}:${NginxIp}:80"

Write-Host "=== CanQuest TestNet tunnel ===" -ForegroundColor Cyan
Write-Host "VPS: ${SshUser}@${VpsHost}"
Write-Host "  localhost:${LocalLedgerPort} -> ${ParticipantIp}:7575 (JSON Ledger API)"
Write-Host "  localhost:${LocalValidatorPort} -> ${NginxIp}:80 (Splice nginx / validator API)"
Write-Host ""
Write-Host "Verify (another terminal):" -ForegroundColor Yellow
Write-Host "  curl http://127.0.0.1:${LocalLedgerPort}/livez"
Write-Host "  curl -H `"Host: wallet.localhost`" http://127.0.0.1:${LocalValidatorPort}/api/validator/v0/version"
Write-Host ""
Write-Host "Press Ctrl+C to stop tunnel." -ForegroundColor Gray

ssh -N -L $forwardLedger -L $forwardValidator "${SshUser}@${VpsHost}"
