# Studio zip UNC 무결성 검증 스크립트
#
# 사내 UNC StudioProgram 폴더의 *.zip 파일들을 검사:
#   1) zip 본체 SHA256 vs *.zip.sha256 사이드카 비교
#   2) zip 안에 manifest.json 이 루트에 존재하는지 확인
#
# 사용:
#   pwsh scripts/verify-studio-zips.ps1                 # 기본 UNC 경로
#   pwsh scripts/verify-studio-zips.ps1 -Path "D:\local-studio-dir"
#   pwsh scripts/verify-studio-zips.ps1 -ViewerId model-studio   # 특정 prefix 만

param(
    [string]$Path = "\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram",
    [string]$ViewerId = ""
)

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "경로 접근 불가: $Path"
    exit 2
}

$filter = if ($ViewerId) { "$ViewerId*.zip" } else { "*.zip" }
$zips = Get-ChildItem -LiteralPath $Path -Filter $filter -File | Where-Object { $_.Name -notmatch '\.bak$' }

if ($zips.Count -eq 0) {
    Write-Warning "검사 대상 zip 없음 (filter=$filter)"
    exit 0
}

$results = @()
foreach ($zip in $zips) {
    $row = [ordered]@{
        Name      = $zip.Name
        SizeKB    = [math]::Round($zip.Length / 1KB, 1)
        Sidecar   = "?"
        SHA256    = "?"
        Manifest  = "?"
        Status    = "?"
    }

    # 1) SHA256 sidecar 비교
    $sidecarPath = "$($zip.FullName).sha256"
    $actualHash = (Get-FileHash -LiteralPath $zip.FullName -Algorithm SHA256).Hash.ToLower()
    if (Test-Path -LiteralPath $sidecarPath) {
        $sidecar = (Get-Content -LiteralPath $sidecarPath -Raw).Trim()
        # `<hash>  <filename>` 또는 `<hash>` 단독 형식 모두 지원
        $expected = ($sidecar -split '\s+')[0].ToLower()
        $row.Sidecar = "exists"
        $row.SHA256 = if ($actualHash -eq $expected) { "MATCH" } else { "MISMATCH" }
    } else {
        $row.Sidecar = "missing"
        $row.SHA256 = "n/a"
    }

    # 2) zip 열어서 manifest.json 확인
    try {
        $zf = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName)
        $hasManifest = $zf.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
        $row.Manifest = if ($hasManifest) { "OK" } else { "MISSING" }
        $zf.Dispose()
    } catch {
        $row.Manifest = "CORRUPT"
    }

    # 종합 판정
    $row.Status = if (
        ($row.Sidecar -eq "missing" -or $row.SHA256 -eq "MATCH") -and
        $row.Manifest -eq "OK"
    ) {
        "OK"
    } else {
        "FAIL"
    }

    $results += [PSCustomObject]$row
}

$results | Format-Table -AutoSize

$fails = $results | Where-Object { $_.Status -eq "FAIL" }
if ($fails.Count -gt 0) {
    Write-Host ""
    Write-Host "FAIL: $($fails.Count) 개 문제 발견" -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "OK: 모든 zip ($($results.Count) 개) 정상" -ForegroundColor Green
    exit 0
}
