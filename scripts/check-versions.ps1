<#
.SYNOPSIS
  HiTESS WorkBench 버전 동기화 검사 / 일괄 갱신 / 자동 패치 범프

.DESCRIPTION
  4곳의 버전 정의를 비교·갱신한다. (커밋은 하지 않는다 — 갱신 결과를 확인한 뒤 직접 커밋한다.)
    (인자 없음)          현재 최신 버전에서 패치(0.0.1) 자동 증가  (예: 1.2.3 → 1.2.4)
    -SetVersion X.Y.Z    지정 버전으로 4곳 동기화
    -Check               검사만 수행 (갱신 없음)

.PARAMETER SetVersion
  지정한 버전으로 4곳 모두 갱신합니다. 비워두면 현재 최신 버전에서 패치를 1 증가시킵니다.

.PARAMETER Check
  파일을 수정하지 않고 현재 동기화 상태만 보고합니다.

.EXAMPLE
  pwsh scripts/check-versions.ps1                    # 패치 자동 증가 (1.2.3 → 1.2.4)
  pwsh scripts/check-versions.ps1 -SetVersion 1.3.0  # 지정 버전 동기화
  pwsh scripts/check-versions.ps1 -Check             # 검사만 (변경 없음)
#>
param(
    [string]$SetVersion = "",
    [switch]$Check
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

# 검증 대상 (순서 유지)
$TARGETS = [ordered]@{
    "HiTessWorkBench/package.json"                 = "json"
    "HiTessWorkBench/frontend/package.json"        = "json"
    "HiTessWorkBench/electron/package.json"        = "json"
    "HiTessWorkBenchBackEnd/app/routers/system.py" = "py"
}

function Get-AbsPath([string]$rel) {
    return Join-Path $ROOT ($rel -replace '/', '\')
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

# 실제로 내용이 바뀌면 $true 를 반환한다.
function Write-FileVersion([string]$absPath, [string]$type, [string]$ver) {
    $content = Get-Content $absPath -Raw -ErrorAction Stop
    if ($type -eq "json") {
        $new = $content -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$ver`""
    } else {
        $new = $content -replace 'SERVER_VERSION\s*=\s*"[^"]+"', "SERVER_VERSION = `"$ver`""
    }
    if ($new -ceq $content) { return $false }
    [System.IO.File]::WriteAllText($absPath, $new, [System.Text.UTF8Encoding]::new($false))
    return $true
}

# ── 현재 버전 읽기 ─────────────────────────────────────────────────────────
$versions = [ordered]@{}
foreach ($rel in $TARGETS.Keys) {
    try {
        $versions[$rel] = Read-FileVersion (Get-AbsPath $rel) $TARGETS[$rel]
    } catch {
        Write-Host "  오류: $rel 읽기 실패 — $_" -ForegroundColor Red
        exit 1
    }
}

# ── 갱신 대상 버전 결정 ────────────────────────────────────────────────────
$target = ""
if (-not $Check) {
    if ($SetVersion -ne "") {
        if ($SetVersion -notmatch '^\d+\.\d+\.\d+$') {
            Write-Host "  오류: 버전 형식이 올바르지 않습니다 (X.Y.Z): $SetVersion" -ForegroundColor Red
            exit 1
        }
        $target = $SetVersion
    } else {
        # 인자 없음 → 현재 최신 버전에서 패치(끝자리) 1 증가
        $parsed = @()
        foreach ($v in $versions.Values) {
            try { $parsed += [version]$v } catch {}
        }
        if ($parsed.Count -eq 0) {
            Write-Host "  오류: 현재 버전을 파싱할 수 없어 자동 증가가 불가합니다." -ForegroundColor Red
            exit 1
        }
        $base  = ($parsed | Sort-Object -Descending)[0]
        $patch = [Math]::Max($base.Build, 0) + 1
        $target = "{0}.{1}.{2}" -f $base.Major, $base.Minor, $patch
        Write-Host ""
        Write-Host "  자동 패치 증가: $($base.ToString()) → $target" -ForegroundColor Cyan
    }
}

# ── 갱신 ───────────────────────────────────────────────────────────────────
$changedAny = $false
if (-not $Check) {
    Write-Host ""
    Write-Host "  버전을 $target 으로 일괄 갱신합니다..." -ForegroundColor Cyan
    foreach ($rel in $TARGETS.Keys) {
        try {
            $did = Write-FileVersion (Get-AbsPath $rel) $TARGETS[$rel] $target
            if ($did) { $changedAny = $true }
            Write-Host "  ✓ $rel" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ $rel — $_" -ForegroundColor Red
            exit 1
        }
    }
    # 재검증을 위해 다시 읽기
    foreach ($rel in $TARGETS.Keys) {
        $versions[$rel] = Read-FileVersion (Get-AbsPath $rel) $TARGETS[$rel]
    }
}

# ── 비교 보고 ──────────────────────────────────────────────────────────────
$allVals = $versions.Values | Select-Object -Unique
$allSame = ($allVals.Count -eq 1)
$refVer  = $allVals | Select-Object -First 1
$maxLen  = ($TARGETS.Keys | Measure-Object -Property Length -Maximum).Maximum

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

# ── 검사 전용 모드 ─────────────────────────────────────────────────────────
if ($Check) {
    if ($allSame) {
        Write-Host "  모든 버전이 [$refVer] 로 일치합니다." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "  버전 불일치 감지됨." -ForegroundColor Red
        Write-Host "  → pwsh scripts/check-versions.ps1 -SetVersion <X.Y.Z> 로 일괄 갱신하세요." -ForegroundColor Yellow
        exit 1
    }
}

# ── 갱신 후 정합성 확인 ────────────────────────────────────────────────────
if (-not $allSame) {
    Write-Host "  오류: 갱신 후에도 버전이 일치하지 않습니다." -ForegroundColor Red
    exit 1
}
Write-Host "  모든 버전이 [$refVer] 로 일치합니다." -ForegroundColor Green

# ── 갱신 결과 안내 (커밋은 자동화하지 않는다) ───────────────────────────────
# 버전 갱신만 수행하고, 변경 내용을 직접 확인한 뒤 수동으로 커밋한다.
Write-Host ""
if ($changedAny) {
    Write-Host "  버전을 [$target] 으로 갱신했습니다. 변경 내용을 확인한 뒤 직접 커밋하세요." -ForegroundColor Cyan
} else {
    Write-Host "  변경 사항이 없습니다 (이미 $target)." -ForegroundColor Yellow
}
exit 0
