<#
.SYNOPSIS
  HiTESS WorkBench 릴리즈 전 정적 검증

.DESCRIPTION
  Python 문법 / 필수 파일 / Frontend build / exe 산출물 / 버전 동기화를 확인합니다.
  -WithServerCheck 를 추가하면 임시 포트(9099)로 서버를 기동해 API 응답까지 검증합니다.

.PARAMETER SkipBuild
  npm build 를 건너뜁니다 (이미 빌드된 경우).

.PARAMETER WithServerCheck
  임시 포트 9099 에서 서버를 기동하여 GET / 와 GET /api/version 을 검증합니다.

.EXAMPLE
  pwsh scripts/smoke-test.ps1
  pwsh scripts/smoke-test.ps1 -SkipBuild
  pwsh scripts/smoke-test.ps1 -WithServerCheck
#>
param(
    [switch]$SkipBuild,
    [switch]$WithServerCheck
)

$ROOT   = Split-Path $PSScriptRoot -Parent
$FAIL   = $false
$Results = [System.Collections.Generic.List[PSCustomObject]]::new()

function Add-Result([string]$label, [bool]$ok, [string]$detail = "") {
    $Results.Add([PSCustomObject]@{ Label = $label; OK = $ok; Detail = $detail })
    if (-not $ok) { $script:FAIL = $true }
}

function Show-Results {
    Write-Host ""
    Write-Host "  ┌─────────────────────────────────────────────────────────────────┐"
    Write-Host "  │  Smoke Test 결과                                                 │"
    Write-Host "  └─────────────────────────────────────────────────────────────────┘"
    foreach ($r in $Results) {
        $icon  = if ($r.OK) { "✓" } else { "✗" }
        $color = if ($r.OK) { "Green" } else { "Red" }
        $detail = if ($r.Detail) { "  → $($r.Detail)" } else { "" }
        Write-Host "  $icon $($r.Label)$detail" -ForegroundColor $color
    }
    Write-Host ""
}

# ── 버전 읽기 ────────────────────────────────────────────────────────────
$sysPy   = Join-Path $ROOT "HiTessWorkBenchBackEnd\app\routers\system.py"
$sysContent = Get-Content $sysPy -Raw -ErrorAction SilentlyContinue
$version = if ($sysContent -match 'SERVER_VERSION\s*=\s*"([^"]+)"') { $Matches[1] } else { "unknown" }

Write-Host ""
Write-Host "  HiTESS WorkBench Smoke Test  —  버전 $version" -ForegroundColor Cyan
Write-Host ""

# ── Python 실행파일 탐색 ─────────────────────────────────────────────────
$venvInner = Join-Path $ROOT "HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe"
$venvOuter = Join-Path $ROOT "WorkBenchEnv\Scripts\python.exe"
if     (Test-Path $venvInner) { $PYTHON = $venvInner }
elseif (Test-Path $venvOuter) { $PYTHON = $venvOuter }
else   { $PYTHON = (Get-Command python -ErrorAction SilentlyContinue)?.Source }

# ── [1] Python 문법 체크 ─────────────────────────────────────────────────
Write-Host "  [1] Python 문법 체크..." -ForegroundColor DarkGray
if ($PYTHON -and (Test-Path $PYTHON)) {
    $appDir = Join-Path $ROOT "HiTessWorkBenchBackEnd\app"
    $result = & $PYTHON -m compileall -q $appDir 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $detail = if (-not $ok) { ($result | Select-Object -First 2) -join " | " } else { "" }
    Add-Result "Python 문법 (compileall)" $ok $detail
} else {
    Add-Result "Python 문법 (compileall)" $false "Python 실행파일 없음"
}

# ── [2] 필수 파일 존재 ───────────────────────────────────────────────────
Write-Host "  [2] 필수 파일 확인..." -ForegroundColor DarkGray
$required = @(
    "HiTessWorkBenchBackEnd\requirements.txt",
    "HiTessWorkBench\package.json",
    "HiTessWorkBench\frontend\package.json",
    "HiTessWorkBench\electron\package.json",
    "HiTessWorkBenchBackEnd\app\routers\system.py",
    "HiTessWorkBenchBackEnd\server_manager.py",
    "HiTessWorkBenchBackEnd\update.bat"
)
$missing = $required | Where-Object { -not (Test-Path (Join-Path $ROOT $_)) }
Add-Result "필수 파일 존재" ($missing.Count -eq 0) ($missing -join ", ")

# ── [3] Frontend build / dist 확인 ──────────────────────────────────────
$frontendDir = Join-Path $ROOT "HiTessWorkBench\frontend"
$indexHtml   = Join-Path $frontendDir "dist\index.html"

if ($SkipBuild) {
    Write-Host "  [3] Frontend dist 확인 (build 건너뜀)..." -ForegroundColor DarkGray
    Add-Result "Frontend dist 존재" (Test-Path $indexHtml) (if (-not (Test-Path $indexHtml)) { "dist/index.html 없음" } else { "" })
} else {
    Write-Host "  [3] Frontend build (npm run build)..." -ForegroundColor DarkGray
    $prevLoc = Get-Location
    Set-Location $frontendDir
    $buildOut = npm run build 2>&1
    $buildOk  = ($LASTEXITCODE -eq 0)
    Set-Location $prevLoc
    $ok = $buildOk -and (Test-Path $indexHtml)
    Add-Result "Frontend build" $ok (if (-not $ok) { "빌드 실패 또는 dist/index.html 없음" } else { "" })
}

# ── [4] exe 산출물 ───────────────────────────────────────────────────────
Write-Host "  [4] exe 산출물 확인..." -ForegroundColor DarkGray
$distDir    = Join-Path $ROOT "HiTessWorkBench\dist_electron"
$exePattern = "HiTESS-WorkBench-v$version*.exe"
$exe        = Get-ChildItem $distDir -Filter $exePattern -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
    $sizeMB = [Math]::Round($exe.Length / 1MB, 1)
    Add-Result "exe 산출물 ($($exe.Name))" $true "$sizeMB MB"
} else {
    Add-Result "exe 산출물 ($exePattern)" $false "$distDir 에 해당 exe 없음"
}

# ── [5] 버전 동기화 ──────────────────────────────────────────────────────
Write-Host "  [5] 버전 동기화..." -ForegroundColor DarkGray
$checkScript = Join-Path $PSScriptRoot "check-versions.ps1"
if (Test-Path $checkScript) {
    & pwsh -NonInteractive -File $checkScript 2>&1 | Out-Null
    Add-Result "버전 4곳 동기화" ($LASTEXITCODE -eq 0) (if ($LASTEXITCODE -ne 0) { "check-versions.ps1 불일치" } else { "" })
} else {
    Add-Result "버전 4곳 동기화" $false "check-versions.ps1 없음"
}

# ── [6] WithServerCheck (선택) ───────────────────────────────────────────
if ($WithServerCheck) {
    Write-Host "  [6] 서버 동적 헬스 체크 (port 9099)..." -ForegroundColor DarkGray

    if (-not $PYTHON -or -not (Test-Path $PYTHON)) {
        Add-Result "서버 동적 헬스 체크" $false "Python 실행파일 없음"
    } else {
        $backendDir = Join-Path $ROOT "HiTessWorkBenchBackEnd"
        $job = Start-Job -ScriptBlock {
            param($py, $dir)
            Set-Location $dir
            & $py -m uvicorn app.main:app --host 127.0.0.1 --port 9099 2>&1
        } -ArgumentList $PYTHON, $backendDir

        Write-Host "    서버 기동 대기 (6초)..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 6

        try {
            $resp = Invoke-WebRequest "http://127.0.0.1:9099/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            Add-Result "GET / (health)" ($resp.StatusCode -eq 200) "HTTP $($resp.StatusCode)"
        } catch {
            Add-Result "GET / (health)" $false $_.Exception.Message
        }

        try {
            $resp   = Invoke-WebRequest "http://127.0.0.1:9099/api/version" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            $body   = $resp.Content | ConvertFrom-Json
            $srvVer = $body.version
            $match  = ($srvVer -eq $version)
            Add-Result "GET /api/version" $match (if ($match) { "v$srvVer" } else { "서버=$srvVer vs system.py=$version" })
        } catch {
            Add-Result "GET /api/version" $false $_.Exception.Message
        }

        Stop-Job  $job -ErrorAction SilentlyContinue
        Remove-Job $job -ErrorAction SilentlyContinue
    }
}

# ── 결과 출력 ────────────────────────────────────────────────────────────
Show-Results

if ($FAIL) {
    Write-Host "  일부 항목 실패. 위 내용을 확인하세요." -ForegroundColor Red
    exit 1
} else {
    Write-Host "  모든 검사 통과." -ForegroundColor Green
    exit 0
}
