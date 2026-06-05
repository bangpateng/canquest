$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DamlDir     = "$ProjectRoot\packages\daml"
$SdkVersion  = "3.4.11"
$DarName     = "canquest-v4-1.0.0.dar"

Write-Host ""
Write-Host "CanQuest DAML Build + Test (via Docker)" -ForegroundColor Cyan
Write-Host "Package  : canquest-v4 v1.0.0" -ForegroundColor Cyan
Write-Host "DAML dir : $DamlDir" -ForegroundColor Gray
Write-Host "SDK      : $SdkVersion" -ForegroundColor Gray
Write-Host ""

$d = docker --version 2>&1
Write-Host "Docker   : $d" -ForegroundColor Green
Write-Host ""

$DamlDirDocker = $DamlDir.Replace('\', '/')
Write-Host "Mount    : $DamlDirDocker" -ForegroundColor Gray
Write-Host ""

Write-Host "STEP 1: daml build..." -ForegroundColor Yellow
Write-Host ""

docker run --rm -v "${DamlDirDocker}:/project" -w /project "digitalasset/daml-sdk:$SdkVersion" bash -lc "/home/daml/.daml/bin/daml build 2>&1"

$buildExit = $LASTEXITCODE
Write-Host ""

if ($buildExit -ne 0) {
    Write-Host "BUILD FAILED (exit $buildExit)" -ForegroundColor Red
    exit 1
}

Write-Host "BUILD SUCCESS" -ForegroundColor Green

$DarPath = "$DamlDir\.daml\dist\$DarName"
if (Test-Path $DarPath) {
    $sz = [math]::Round((Get-Item $DarPath).Length / 1KB, 1)
    Write-Host "DAR file : $DarName ($sz KB)" -ForegroundColor Green
} else {
    Write-Host "WARNING: DAR not found at .daml\dist\" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "STEP 2: daml test..." -ForegroundColor Yellow
Write-Host ""

docker run --rm -v "${DamlDirDocker}:/project" -w /project "digitalasset/daml-sdk:$SdkVersion" bash -lc "/home/daml/.daml/bin/daml test 2>&1"

$testExit = $LASTEXITCODE
Write-Host ""

if ($testExit -ne 0) {
    Write-Host "TEST FAILED (exit $testExit)" -ForegroundColor Red
    exit 1
}

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
Write-Host ""

Write-Host "STEP 3: Get Package ID..." -ForegroundColor Yellow
Write-Host ""

$inspect = docker run --rm -v "${DamlDirDocker}:/project" -w /project "digitalasset/daml-sdk:$SdkVersion" bash -lc "/home/daml/.daml/bin/daml damlc inspect-dar .daml/dist/$DarName 2>&1"

Write-Host $inspect

$pkgId = $null
foreach ($line in ($inspect -split "`n")) {
    if ($line -match '([0-9a-f]{64})') {
        $pkgId = $Matches[1]
        break
    }
}

Write-Host ""
Write-Host "=== RESULT ===" -ForegroundColor Cyan

if ($pkgId) {
    Write-Host "Package ID : $pkgId" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add to apps/api/.env on VPS:" -ForegroundColor White
    Write-Host "  CANTON_DAML_PACKAGE_NAME=canquest-v4" -ForegroundColor Yellow
    Write-Host "  CANTON_DAML_PACKAGE_ID=$pkgId" -ForegroundColor Yellow
} else {
    Write-Host "Package ID not found - check inspect output above" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Open tunnel : ssh -N -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 root@<VPS_IP>"
Write-Host "  2. Upload DAR  : cd apps/api ; node scripts/upload-daml-dar.cjs"
Write-Host "  3. Update .env : set CANTON_DAML_PACKAGE_NAME=canquest-v4 on VPS"
Write-Host "  4. Restart API : pm2 restart canquest-api"
Write-Host ""
