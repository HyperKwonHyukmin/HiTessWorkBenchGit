<#
.SYNOPSIS
  HiTESS WorkBench 릴리즈 자동화 스크립트

.DESCRIPTION
  git 상태 → 버전 동기화 → Python 문법 → Frontend build → Electron dist →
  산출물 검증 → 배포 복사 → Git 태그 → 요약 순서로 진행합니다.
  각 주요 단계에서 [Y/n] 확인을 요청합니다 (-Yes 로 자동 승인).

.PARAMETER Yes
  모든 확인 프롬프트를 자동 승인합니다.

.PARAMETER Dry
  실제 빌드/복사 없이 실행될 명령만 출력합니다.

.PARAMETER SkipBuild
  이미 빌드된 경우 검증·복사만 수행합니다.

.PARAMETER SetVersion
  실행 전 4곳의 버전을 일괄 갱신합니다. 예: -SetVersion 1.2.0

.EXAMPLE
  pwsh scripts/release.ps1
  pwsh scripts/release.ps1 -Yes
  pwsh scripts/release.ps1 -Dry
  pwsh scripts/release.ps1 -SetVersion 1.2.0 -Yes
  pwsh scripts/release.ps1 -SkipBuild -Yes
#>
param(
    [Alias("y")][switch]$Yes,
    [switch]$Dry,
    [switch]$SkipBuild,
    [string]$SetVersion = ""
)

$ErrorActionPreference = "Stop"
$ROOT      = Split-Path $PSScriptRoot -Parent
$StartTime = Get-Date

function Step([string]$n, [string]$msg) { Write-Host "`n  [$n] $msg" -ForegroundColor Cyan }
function OK([string]$msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function WARN([string]$msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function ERR([string]$msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }
function INFO([string]$msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function DRY([string]$msg)  { Write-Host "    [DRY] $msg" -ForegroundColor Magenta }

function Confirm-Step([string]$msg) {
    if ($Yes -or $Dry) { return $true }
    $ans = Read-Host "  $msg [Y/n]"
    return ($ans -eq "" -or $ans -match "^[Yy]")
}

# ── 헤더 ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  HiTESS WorkBench — Release Script                        ║" -ForegroundColor Cyan
if ($Dry) {
    Write-Host "  ║  [DRY RUN — 실제 빌드/복사 없음]                          ║" -ForegroundColor Yellow
}
if ($SkipBuild) {
    Write-Host "  ║  [SkipBuild — 기존 빌드 산출물 사용]                      ║" -ForegroundColor Yellow
}
Write-Host "  ╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# ── Step 1: Git 상태 ─────────────────────────────────────────────────────
Step "1/8" "Git 상태 점검"
$gitDirty = git -C $ROOT status --porcelain 2>&1
if ($gitDirty) {
    WARN "커밋되지 않은 변경사항 있음:"
    $gitDirty | ForEach-Object { INFO $_ }
    if (-not (Confirm-Step "변경사항이 있습니다. 계속 진행할까요?")) {
        ERR "중단됩니다."; exit 1
    }
} else {
    OK "작업 트리 깨끗함"
}

# ── Step 2: 버전 동기화 검증 ──────────────────────────────────────────────
Step "2/8" "버전 동기화 검증"
$checkScript = Join-Path $PSScriptRoot "check-versions.ps1"

if ($SetVersion -ne "") {
    INFO "버전을 $SetVersion 으로 일괄 갱신합니다..."
    if ($Dry) {
        DRY "pwsh $checkScript -SetVersion $SetVersion"
    } else {
        & pwsh -NonInteractive -File $checkScript -SetVersion $SetVersion
        if ($LASTEXITCODE -ne 0) { ERR "버전 갱신 실패"; exit 1 }
    }
} else {
    & pwsh -NonInteractive -File $checkScript 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        ERR "버전 불일치 감지. 먼저 -SetVersion X.Y.Z 옵션으로 갱신하세요."
        & pwsh -NonInteractive -File $checkScript
        exit 1
    }
}

# 현재 버전 읽기
$sysPy   = Join-Path $ROOT "HiTessWorkBenchBackEnd\app\routers\system.py"
$sysContent = Get-Content $sysPy -Raw
$version = if ($sysContent -match 'SERVER_VERSION\s*=\s*"([^"]+)"') { $Matches[1] } else { "unknown" }
OK "현재 버전: $version"

# ── Step 3: Python 문법 체크 ──────────────────────────────────────────────
Step "3/8" "Python 문법 체크"
$venvInner = Join-Path $ROOT "HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe"
$venvOuter = Join-Path $ROOT "WorkBenchEnv\Scripts\python.exe"
if     (Test-Path $venvInner) { $PYTHON = $venvInner }
elseif (Test-Path $venvOuter) { $PYTHON = $venvOuter }
else   { $PYTHON = (Get-Command python -ErrorAction SilentlyContinue)?.Source }

if ($Dry) {
    DRY "$PYTHON -m compileall -q HiTessWorkBenchBackEnd\app"
    OK "Python 문법 (dry-run 건너뜀)"
} else {
    $appDir = Join-Path $ROOT "HiTessWorkBenchBackEnd\app"
    $result = & $PYTHON -m compileall -q $appDir 2>&1
    if ($LASTEXITCODE -ne 0) {
        ERR "Python 문법 오류:"; $result | ForEach-Object { INFO $_ }; exit 1
    }
    OK "Python 문법 이상 없음"
}

# ── Step 4: Frontend build ─────────────────────────────────────────────────
Step "4/8" "Frontend build$(if ($SkipBuild) { ' (건너뜀)' })"
$frontendDir = Join-Path $ROOT "HiTessWorkBench\frontend"
if ($SkipBuild) {
    $indexHtml = Join-Path $frontendDir "dist\index.html"
    if (-not (Test-Path $indexHtml)) { ERR "dist/index.html 없음. -SkipBuild 없이 재실행하세요."; exit 1 }
    OK "기존 빌드 사용"
} elseif ($Dry) {
    DRY "cd HiTessWorkBench\frontend && npm run build"
} else {
    if (Confirm-Step "npm run build 를 실행할까요?") {
        $prevLoc = Get-Location
        Set-Location $frontendDir
        npm run build
        $buildOk = ($LASTEXITCODE -eq 0)
        Set-Location $prevLoc
        if (-not $buildOk) { ERR "Frontend build 실패"; exit 1 }
        OK "Frontend build 완료"
    } else {
        WARN "Frontend build 건너뜀"
    }
}

# ── Step 5: Electron dist ──────────────────────────────────────────────────
Step "5/8" "Electron dist$(if ($SkipBuild) { ' (건너뜀)' })"
$electronRoot = Join-Path $ROOT "HiTessWorkBench"
if ($SkipBuild) {
    OK "기존 dist_electron 사용"
} elseif ($Dry) {
    DRY "cd HiTessWorkBench && npm run dist"
} else {
    if (Confirm-Step "npm run dist 를 실행할까요? (수 분 소요)") {
        $prevLoc = Get-Location
        Set-Location $electronRoot
        npm run dist
        $distOk = ($LASTEXITCODE -eq 0)
        Set-Location $prevLoc
        if (-not $distOk) { ERR "Electron dist 실패"; exit 1 }
        OK "Electron dist 완료"
    } else {
        WARN "Electron dist 건너뜀"
    }
}

# ── Step 6: 산출물 검증 ────────────────────────────────────────────────────
Step "6/8" "산출물 검증"
$distDir    = Join-Path $ROOT "HiTessWorkBench\dist_electron"
$exePattern = "HiTESS-WorkBench-v$version*.exe"
$exe = Get-ChildItem $distDir -Filter $exePattern -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
    ERR "exe 산출물 없음: $distDir\$exePattern"
    WARN "npm run dist 를 먼저 실행하거나 -SetVersion 으로 버전을 맞추세요."
    exit 1
}
$sizeMB = [Math]::Round($exe.Length / 1MB, 1)
OK "산출물: $($exe.Name)  ($sizeMB MB)"

# ── Step 7: 배포 복사 ─────────────────────────────────────────────────────
Step "7/8" "배포 폴더 복사"
$deployDir = Join-Path $ROOT "HiTessWorkBenchBackEnd\LastestVersionProgram"
$envDir    = [System.Environment]::GetEnvironmentVariable("LATEST_CLIENT_DIR")
if ($envDir) { $deployDir = $envDir }
INFO "대상: $deployDir"

if ($Dry) {
    DRY "기존 exe → .bak 백업 후 $($exe.Name) 복사"
} else {
    if (-not (Test-Path $deployDir)) {
        New-Item -ItemType Directory -Path $deployDir -Force | Out-Null
    }
    $dest = Join-Path $deployDir $exe.Name
    if (Confirm-Step "$($exe.Name) 을 $deployDir 에 복사할까요?") {
        # 기존 exe 백업 (같은 이름 제외)
        $existingExes = Get-ChildItem $deployDir -Filter "*.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne $exe.Name }
        foreach ($old in $existingExes) {
            Copy-Item $old.FullName "$($old.FullName).bak" -Force
            INFO "백업: $($old.Name) → $($old.Name).bak"
        }
        Copy-Item $exe.FullName $dest -Force
        OK "복사 완료: $($exe.Name)"
    } else {
        WARN "배포 복사 건너뜀"
    }
}

# ── Step 8: Git 태그 ──────────────────────────────────────────────────────
Step "8/8" "Git 태그"
$tagName   = "v$version"
$tagExists = (git -C $ROOT tag -l $tagName 2>$null).Trim() -ne ""
if ($tagExists) {
    INFO "태그 $tagName 이미 존재 — 건너뜀"
} elseif ($Dry) {
    DRY "git tag $tagName && git push origin $tagName"
} else {
    if (Confirm-Step "태그 '$tagName' 를 생성하고 push 할까요?") {
        git -C $ROOT tag $tagName
        git -C $ROOT push origin $tagName
        OK "태그 $tagName push 완료"
    } else {
        WARN "태그 건너뜀 — 나중에 수동으로: git tag $tagName && git push origin $tagName"
    }
}

# ── 요약 ─────────────────────────────────────────────────────────────────
$elapsed = [Math]::Round(((Get-Date) - $StartTime).TotalSeconds)
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  릴리즈 완료  ✓                                            ║" -ForegroundColor Green
Write-Host "  ╠═══════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  버전: v$version   소요시간: ${elapsed}s" -ForegroundColor Green
Write-Host "  ╠═══════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  다음 단계:                                                ║" -ForegroundColor Green
Write-Host "  ║   1. 서버 PC 에서 server_manager.py 실행                   ║" -ForegroundColor Green
Write-Host "  ║   2. Update 버튼 클릭 → 서버 자동 재시작                   ║" -ForegroundColor Green
Write-Host "  ║   3. 클라이언트에서 업데이트 확인 → 새 exe 배포             ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
