<#
  HiTESS MB 실행기 배포 zip 만들기.

  - Electron 바이너리: WorkBench 개발 모드가 쓰는 electron\node_modules\electron\dist (v40.0.0) 를 그대로 복사한다.
    electron.exe → HiTessMBLauncher.exe, locales 는 ko·en-US 만, resources\default_app.asar 삭제,
    앱 코드는 resources\app\ 폴더(asar 아님)로 넣는다.
  - zip 루트에 manifest.json { id: "mb-launcher", version, entry, electron } 을 둔다(서버 /api/viewers/manifest 가 읽음).
  - 결과: HiTessWorkBenchBackEnd\StudioProgram\mb-launcher-<버전>.zip (+ .sha256). 70 로컬 시험용 — UNC 에는 올리지 않는다.
  - 배포본에 개발 PC 주소(10.133.122.70)가 있으면 실패한다. 실행기 서버 주소는 항상 --server 인자로 받는다.

  사용:  pwsh -File AmLauncher\build.ps1   (Windows PowerShell 5.1 에서도 동작)
#>
param(
  [string]$ElectronDist = "C:\Coding\WorkBench\HiTessWorkBench\electron\node_modules\electron\dist",
  [string]$OutDir = "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\StudioProgram",
  [string]$ExpectedElectron = "40.0.0"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 1) 버전 확인
$pkg = [System.IO.File]::ReadAllText((Join-Path $here "package.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$version = $pkg.version
if (-not $version) { throw "package.json 에 version 이 없습니다." }
$versionFile = Join-Path $ElectronDist "version"
if (-not (Test-Path -LiteralPath $versionFile)) { throw "Electron 바이너리 폴더가 없습니다: $ElectronDist" }
$electronVersion = ([System.IO.File]::ReadAllText($versionFile)).Trim()
Write-Host "실행기 버전   : $version"
Write-Host "Electron 버전 : $electronVersion ($ElectronDist)"
if ($electronVersion -ne $ExpectedElectron) {
  throw "Electron 버전이 $ExpectedElectron 이 아닙니다($electronVersion). 고정 버전에서만 Studio 를 확인했다 — -ExpectedElectron 으로 바꾸려면 Studio 확인부터 다시 할 것."
}

# 2) staging 준비
$staging = Join-Path $here "build\staging"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item -Path (Join-Path $ElectronDist "*") -Destination $staging -Recurse -Force

Rename-Item -LiteralPath (Join-Path $staging "electron.exe") -NewName "HiTessMBLauncher.exe"
Get-ChildItem -LiteralPath (Join-Path $staging "locales") -File |
  Where-Object { $_.Name -ne "ko.pak" -and $_.Name -ne "en-US.pak" } |
  Remove-Item -Force
$defaultApp = Join-Path $staging "resources\default_app.asar"
if (Test-Path -LiteralPath $defaultApp) { Remove-Item -LiteralPath $defaultApp -Force }

# 3) 앱 코드 → resources\app
$appDir = Join-Path $staging "resources\app"
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
foreach ($f in @("package.json", "main.js")) { Copy-Item -LiteralPath (Join-Path $here $f) -Destination $appDir }
foreach ($d in @("lib", "preload", "ui")) { Copy-Item -LiteralPath (Join-Path $here $d) -Destination $appDir -Recurse }
# 단위 테스트 파일은 배포본에 싣지 않는다
# (-Include 는 -LiteralPath 와 함께 쓰면 5.1 에서 거르지 않고 전부 잡는다 — Where-Object 로 거른다)
Get-ChildItem -LiteralPath $appDir -Recurse -File |
  Where-Object { $_.Name -like "*.test.js" -or $_.Name -like "*.spec.js" } |
  Remove-Item -Force
# 앱 코드가 빠지면 Electron 기본 화면이 뜨므로 여기서 막는다
foreach ($must in @("package.json", "main.js", "lib\studio-host.js", "preload\studio-preload.js", "ui\progress.html")) {
  if (-not (Test-Path -LiteralPath (Join-Path $appDir $must))) { throw "배포본에 $must 가 없습니다." }
}

# 4) manifest.json (zip 루트)
$manifest = [ordered]@{ id = "mb-launcher"; version = $version; entry = "HiTessMBLauncher.exe"; electron = $electronVersion }
[System.IO.File]::WriteAllText((Join-Path $staging "manifest.json"), ($manifest | ConvertTo-Json), $utf8NoBom)

# 5) 개발 PC 주소 검사 — 앱 코드·manifest (Electron 바이너리는 손대지 않은 원본이라 제외)
$hits = Get-ChildItem -LiteralPath $appDir -Recurse -File | Select-String -SimpleMatch "10.133.122.70"
$hits += Select-String -LiteralPath (Join-Path $staging "manifest.json") -SimpleMatch "10.133.122.70"
if ($hits) {
  $hits | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber)" }
  throw "배포본에 개발 PC 주소(10.133.122.70)가 있습니다."
}
Write-Host "주소 검사     : 10.133.122.70 없음"

# 6) zip — 항목 이름은 '/' 구분(.NET Framework 의 CreateFromDirectory 는 '\' 를 쓸 수 있어 직접 만든다)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zipName = "mb-launcher-$version.zip"
$zipPath = Join-Path $OutDir $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
$stagingFull = (Resolve-Path -LiteralPath $staging).Path.TrimEnd('\') + '\'
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $staging -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($stagingFull.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

# 7) sha256 (다른 Studio zip 과 같은 '<hash>  <파일명>' 형식)
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText("$zipPath.sha256", "$hash  $zipName`n", $utf8NoBom)
$sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
Write-Host "zip           : $zipPath ($sizeMb MB)"
Write-Host "sha256        : $hash"
Write-Host "※ 회사 DRM 이 디스크의 zip 을 감쌀 수 있다 — 서버가 내려주는 sha256 은 /api/viewers/manifest/mb-launcher 로 확인할 것."
