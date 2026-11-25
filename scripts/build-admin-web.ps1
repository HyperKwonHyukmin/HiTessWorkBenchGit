#Requires -Version 7
<#
관리자 웹 콘솔 빌드 — 프론트(admin.html)를 빌드해 HiTessWorkBenchBackEnd/AdminWeb/ 을 통째로 갈아 끼운다.
145 는 이 폴더를 git pull 로 받아 /admin/ 에서 내준다(app/routers/admin_web.py).

  pwsh scripts/build-admin-web.ps1          # 빌드 + 갈아 끼우기
  pwsh scripts/build-admin-web.ps1 -Check   # 지금 AdminWeb 이 멀쩡한지만(DRM·필수 파일)

계획: docs/plans/2026-11-18-admin-web-console-plan.md. /wb-release 가 이 스크립트를 부른다.
#>
param([switch]$Check)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$front = Join-Path $root 'HiTessWorkBench/frontend'
$built = Join-Path $front 'dist-admin'
$target = Join-Path $root 'HiTessWorkBenchBackEnd/AdminWeb'
$drmMagic = [Text.Encoding]::ASCII.GetBytes('HHIDRMC')

function Test-AdminWeb([string]$dir) {
    if (-not (Test-Path (Join-Path $dir 'admin.html'))) { throw "admin.html 이 없습니다: $dir" }
    if (-not (Test-Path (Join-Path $dir 'council.html'))) { throw "council.html 이 없습니다(협의체 과제 현황 /council/): $dir" }
    if (-not (Get-ChildItem (Join-Path $dir 'assets') -Filter *.js -ErrorAction SilentlyContinue)) { throw "assets/*.js 가 없습니다: $dir" }
    $wrapped = foreach ($f in Get-ChildItem $dir -Recurse -File) {
        $head = [byte[]]::new(7)
        $fs = [IO.File]::OpenRead($f.FullName)
        try { $n = $fs.Read($head, 0, 7) } finally { $fs.Dispose() }
        if ($n -eq 7 -and [Linq.Enumerable]::SequenceEqual($head, $drmMagic)) { $f.FullName }
    }
    if ($wrapped) { throw "DRM 에 감싸진 파일이 있습니다(커밋하면 145 에서 깨짐):`n$($wrapped -join "`n")" }
    # 공개 번들에 개발 PC 주소가 실리면 안 된다(vite.config.js 의 admin 모드가 지운다 — 남아 있으면 그 장치가 깨진 것).
    $leak = Get-ChildItem (Join-Path $dir 'assets') -Filter *.js | Where-Object { (Get-Content $_.FullName -Raw).Contains('10.133.122.70') }
    if ($leak) { throw "번들에 개발 PC 주소(10.133.122.70)가 있습니다: $($leak.Name -join ', ')" }
}

# 작업 폴더의 커밋 안 된 화면 코드도 번들에 들어간다 — 다른 세션의 진행 중 변경이 145 에 나가지 않게 알린다.
function Show-UncommittedFrontend {
    $dirty = git -C $root status --porcelain -- 'HiTessWorkBench/frontend/src' 2>$null |
        Where-Object { $_ -notmatch 'frontend/src/(admin/|council/|utils/adminConsole|utils/loginMessages)' }
    if ($dirty) {
        Write-Warning "커밋 안 된 화면 코드 $(@($dirty).Count)개가 번들에 함께 들어갑니다(관리 화면이 import 하는 것만 실제로 실림). 깨끗한 상태로 만들려면 worktree 에서 빌드하세요:"
        $dirty | Select-Object -First 15 | ForEach-Object { Write-Warning "  $_" }
    }
}

if ($Check) {
    Test-AdminWeb $target
    Write-Host "AdminWeb 정상: $((Get-ChildItem $target -Recurse -File).Count)개 파일"
    return
}

Show-UncommittedFrontend

Push-Location $front
try {
    npx vite build --mode admin
    if ($LASTEXITCODE -ne 0) { throw "vite build 실패(종료 코드 $LASTEXITCODE)" }
} finally { Pop-Location }

Test-AdminWeb $built

# 옛 해시 파일이 쌓이지 않게 폴더를 비우고 새로 넣는다. 아이콘 백업 폴더는 쓰지 않아 뺀다.
if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null
Copy-Item -Path (Join-Path $built '*') -Destination $target -Recurse -Exclude 'icon_backup'
$backup = Join-Path $target 'icon_backup'
if (Test-Path $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }

Test-AdminWeb $target
$count = (Get-ChildItem $target -Recurse -File).Count
$size = [math]::Round(((Get-ChildItem $target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "AdminWeb 갱신: $count 개 파일, $size MB → 커밋 후 145 git pull(라우터를 새로 넣었을 때만 재시작)"
