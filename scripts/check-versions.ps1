<#
.SYNOPSIS
  HiTESS WorkBench 버전 동기화 검증 및 일괄 갱신

.DESCRIPTION
  4곳의 버전 정의를 비교해 불일치 여부를 보고합니다.
  -SetVersion 을 지정하면 모두 동일한 버전으로 갱신 후 재검증합니다.

.PARAMETER SetVersion
  지정한 버전으로 4곳 모두 갱신합니다. 예: -SetVersion 1.2.0

.EXAMPLE
  pwsh scripts/check-versions.ps1
  pwsh scripts/check-versions.ps1 -SetVersion 1.2.0
#>
param(
    [string]$SetVersion = ""
)

$ROOT = Split-Path $PSScriptRoot -Parent

# 검증 대상 (순서 유지)
$TARGETS = [ordered]@{
    "HiTessWorkBench/package.json"                 = "json"
    "HiTessWorkBench/frontend/package.json"        = "json"
    "HiTessWorkBench/electron/package.json"        = "json"
    "HiTessWorkBenchBackEnd/app/routers/system.py" = "py"
}

function Read-FileVersion([string]$absPath, [string]$type) {
    $content = Get-Content $absPath -Raw -ErrorAction Stop
    if ($type -eq "json") {
        if ($content -match '"version"\s*:\s*"([^"]+)"') { return $Matches[1] }
    } else {
        if ($content -match 'SERVER_VERSION\s*=\s*"([^"]+)"') { return $Matches[1] }
    }
    return $null
}

function Write-FileVersion([string]$absPath, [string]$type, [string]$ver) {
    $content = Get-Content $absPath -Raw -ErrorAction Stop
    if ($type -eq "json") {
        $new = $content -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$ver`""
    } else {
        $new = $content -replace 'SERVER_VERSION\s*=\s*"[^"]+"', "SERVER_VERSION = `"$ver`""
    }
    [System.IO.File]::WriteAllText($absPath, $new, [System.Text.UTF8Encoding]::new($false))
}

# ── 버전 읽기 ────────────────────────────────────────────────────────────
$versions = [ordered]@{}
foreach ($rel in $TARGETS.Keys) {
    $abs = Join-Path $ROOT ($rel -replace '/', '\')
    try {
        $versions[$rel] = Read-FileVersion $abs $TARGETS[$rel]
    } catch {
        Write-Host "  오류: $rel 읽기 실패 — $_" -ForegroundColor Red
        exit 1
    }
}

# ── SetVersion 갱신 ───────────────────────────────────────────────────────
if ($SetVersion -ne "") {
    Write-Host ""
    Write-Host "  버전을 $SetVersion 으로 일괄 갱신합니다..." -ForegroundColor Cyan
    foreach ($rel in $TARGETS.Keys) {
        $abs = Join-Path $ROOT ($rel -replace '/', '\')
        try {
            Write-FileVersion $abs $TARGETS[$rel] $SetVersion
            Write-Host "  ✓ $rel" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ $rel — $_" -ForegroundColor Red
            exit 1
        }
    }
    Write-Host ""
    # 재검증을 위해 다시 읽기
    foreach ($rel in $TARGETS.Keys) {
        $abs = Join-Path $ROOT ($rel -replace '/', '\')
        $versions[$rel] = Read-FileVersion $abs $TARGETS[$rel]
    }
}

# ── 비교 ──────────────────────────────────────────────────────────────────
$allVals  = $versions.Values | Select-Object -Unique
$allSame  = ($allVals.Count -eq 1)
$refVer   = $allVals | Select-Object -First 1
$maxLen   = ($TARGETS.Keys | Measure-Object -Property Length -Maximum).Maximum

Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────────────────────────┐"
Write-Host "  │  버전 동기화 검사                                                │"
Write-Host "  └─────────────────────────────────────────────────────────────────┘"
Write-Host ""

foreach ($rel in $TARGETS.Keys) {
    $ver = $versions[$rel]
    $pad = " " * ($maxLen - $rel.Length + 2)
    if (-not $allSame -and $ver -ne $refVer) {
        Write-Host "  ✗ $rel$pad$ver  ← 불일치" -ForegroundColor Red
    } else {
        Write-Host "  ✓ $rel$pad$ver" -ForegroundColor Green
    }
}

Write-Host ""

if ($allSame) {
    Write-Host "  모든 버전이 [$refVer] 로 일치합니다." -ForegroundColor Green
    exit 0
} else {
    Write-Host "  버전 불일치 감지됨." -ForegroundColor Red
    Write-Host "  → pwsh scripts/check-versions.ps1 -SetVersion <X.Y.Z> 로 일괄 갱신하세요." -ForegroundColor Yellow
    exit 1
}
