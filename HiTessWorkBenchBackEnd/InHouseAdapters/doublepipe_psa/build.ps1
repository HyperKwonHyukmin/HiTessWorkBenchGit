<#
.SYNOPSIS
  PSA_AllLoadCases.exe 빌드 — prep(스테이징+패치+템플릿) → PyInstaller → 배포 폴더 배치.

.DESCRIPTION
  연구원 원본 엔진 폴더는 읽기만 하고 수정하지 않는다.
  산출물은 InHouseProgram/DoublePipe/HiTessAdapter/ 에 놓인다(백엔드가 보는 곳).

.PARAMETER Python
  엔진 의존성(numpy/scipy/openpyxl/matplotlib/pyNastran)과 pyinstaller 가 설치된 파이썬.
  기본값은 PATH 의 python.

.EXAMPLE
  .\build.ps1
  .\build.ps1 -Python "C:\Python38\python.exe"
#>
param(
    [string]$Python = "python",
    [string]$EngineDir = ""
)

$ErrorActionPreference = "Stop"
$AdapterRoot = $PSScriptRoot
$BackendDir = Split-Path (Split-Path $AdapterRoot -Parent) -Parent
$DeployDir = Join-Path $BackendDir "InHouseProgram\DoublePipe\HiTessAdapter"

Push-Location $AdapterRoot
try {
    Write-Host "=== [1/3] prep (스테이징 + 패치 + 템플릿 추출) ===" -ForegroundColor Cyan
    $prepArgs = @("-m", "hitess_adapter.prep")
    if ($EngineDir -ne "") { $prepArgs += @("--engine-dir", $EngineDir) }
    $env:PYTHONPATH = $AdapterRoot
    & $Python @prepArgs
    if ($LASTEXITCODE -ne 0) { throw "prep 실패 (exit=$LASTEXITCODE)" }

    Write-Host "=== [2/3] PyInstaller 빌드 ===" -ForegroundColor Cyan
    & $Python -m PyInstaller --noconfirm `
        --workpath (Join-Path $AdapterRoot "build\pyi") `
        --distpath (Join-Path $AdapterRoot "dist") `
        (Join-Path $AdapterRoot "PSA_AllLoadCases.spec")
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller 실패 (exit=$LASTEXITCODE)" }

    Write-Host "=== [3/3] 배포 폴더 배치 ===" -ForegroundColor Cyan
    if (-not (Test-Path $DeployDir)) { New-Item -ItemType Directory -Force $DeployDir | Out-Null }
    Copy-Item -LiteralPath (Join-Path $AdapterRoot "dist\PSA_AllLoadCases.exe") -Destination $DeployDir -Force
    Copy-Item -LiteralPath (Join-Path $AdapterRoot "build\report_template.bin") -Destination $DeployDir -Force

    Write-Host ""
    Write-Host "완료. 배포 폴더: $DeployDir" -ForegroundColor Green
    Get-ChildItem $DeployDir | Format-Table Name, Length, LastWriteTime
    Write-Host "⚠ 서버(145)에는 위 2개 파일을 수동 복사하고 백엔드를 재시작해야 반영됩니다." -ForegroundColor Yellow
}
finally {
    Pop-Location
}
