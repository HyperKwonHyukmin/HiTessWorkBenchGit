<#
.SYNOPSIS
  HiTESS WorkBench L2 워치독을 Windows 작업 스케줄러에 등록한다.

.DESCRIPTION
  서버(145)에서 1회만 실행하면 된다. 이후 git pull 만으로 워치독 코드가 갱신된다
  (스케줄러는 스크립트 경로만 들고 있고 내용은 매 실행 시 새로 읽는다).

  트리거 2개를 등록한다:
   - 5분마다 반복: 상시 감시
   - 로그온 시  : 리부트 후 RDP 로그인만 하면 백엔드가 자동으로 올라온다

  '사용자가 로그온한 경우에만 실행'(InteractiveToken) 이어야 한다. 워치독이
  띄우는 것은 tkinter GUI 인 Server Manager 라서, 세션 0 에서 돌면 창이 뜨지
  않는다.

  ⚠ 이 태스크는 서버에만 있어야 한다. 개발 PC 에서 시험했다면 반드시 해제할 것:
      Unregister-ScheduledTask -TaskName HiTessWatchdog -Confirm:$false

.EXAMPLE
  # 관리자 권한 PowerShell 에서
  powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1

.EXAMPLE
  # 등록만 확인하고 실제로 바꾸지 않는다
  powershell -ExecutionPolicy Bypass -File scripts\install_watchdog_task.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = 'HiTessWatchdog'
)

$ErrorActionPreference = 'Stop'

# ── 사전 점검 ────────────────────────────────────────────────────────────
# RunLevel Highest 로 등록하려면 등록하는 쪽이 관리자여야 한다. 아니면
# Register-ScheduledTask 가 'Access is denied' 로만 끝나 원인을 알기 어렵다.
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "관리자 권한이 필요합니다. PowerShell 을 '관리자로 실행' 한 뒤 다시 시도하세요."
}

$repoRoot   = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'HiTessWorkBenchBackEnd'
$python     = Join-Path $backendDir 'WorkBenchEnv\Scripts\pythonw.exe'
$script     = Join-Path $backendDir 'server_watchdog.py'
$launcher   = Join-Path $backendDir 'HiTESS_Server.bat'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python 을 찾을 수 없습니다: $python`n  WorkBenchEnv 가상환경이 생성되어 있는지 확인하세요."
}
if (-not (Test-Path -LiteralPath $script)) {
    throw "워치독 스크립트를 찾을 수 없습니다: $script"
}
# 워치독이 복구에 쓰는 런처다. 없으면 등록은 되지만 정작 복구가 조용히 실패한다.
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "런처를 찾을 수 없습니다: $launcher`n  이게 없으면 워치독이 등록돼도 복구하지 못합니다."
}

# ── 태스크 구성 ──────────────────────────────────────────────────────────
# pythonw.exe 를 쓰는 이유: 5분마다 콘솔 창이 깜빡이면 서버 운영자가 견딜 수 없다.
# 부작용으로 워치독은 stdout/stderr 가 사라지므로, 기록은 전부
# logs/server_events.jsonl 로만 남는다(server_watchdog.py 가 그렇게 만들어져 있다).
$action = New-ScheduledTaskAction -Execute $python -Argument "`"$script`"" -WorkingDirectory $backendDir

# RepetitionDuration 의 MaxValue 는 '무기한' 을 뜻한다(P99999999D 로 정규화됨).
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

# 도메인 계정이면 USERNAME 만으로는 해석되지 않는다 — 정규화된 이름을 쓴다.
$account = "$env:USERDOMAIN\$env:USERNAME"

$logon = New-ScheduledTaskTrigger -AtLogOn -User $account

# InteractiveToken: 로그온한 사용자 세션에서 실행 → GUI 를 띄울 수 있다.
$principal = New-ScheduledTaskPrincipal -UserId $account `
    -LogonType Interactive -RunLevel Highest

# 워치독은 30초 grace 후 종료되므로 5분이면 충분하다.
# IgnoreNew: 앞선 실행이 아직 돌고 있으면 새로 띄우지 않는다 — 겹쳐 돌면
# watchdog_state.json 의 read-modify-write 가 서로를 덮어써 재기동 횟수를
# 과소 계산하고, 최악의 경우 런처를 두 번 띄운다.
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

if (-not $PSCmdlet.ShouldProcess($TaskName, '작업 스케줄러에 등록')) {
    Write-Host "[WhatIf] 등록하지 않고 종료합니다."
    Write-Host "  실행 계정: $account"
    Write-Host "  실행     : $python"
    Write-Host "  대상     : $script"
    return
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "기존 '$TaskName' 태스크를 제거합니다."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger @($repeat, $logon) `
    -Principal $principal `
    -Settings $settings `
    -Description 'HiTESS WorkBench 백엔드 L2 워치독 — Server Manager 생존 감시 및 재기동' | Out-Null

# ── 등록 결과를 되읽어 확인한다 ──────────────────────────────────────────
# 침묵을 성공으로 간주하지 않는다. 트리거가 2개인지까지 확인해야
# '5분 반복은 걸렸는데 로그온 트리거가 빠진' 상태를 잡을 수 있다.
$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $registered) {
    throw "등록에 실패했습니다: '$TaskName' 을 되읽을 수 없습니다."
}
if ($registered.Triggers.Count -ne 2) {
    Write-Warning "트리거가 2개가 아닙니다(현재 $($registered.Triggers.Count)개). 작업 스케줄러에서 확인하세요."
}

Write-Host ""
Write-Host "'$TaskName' 등록 완료." -ForegroundColor Green
Write-Host "  실행 계정: $account"
Write-Host "  실행     : $python"
Write-Host "  대상     : $script"
Write-Host "  트리거   : 5분 반복 + 로그온 시 ($($registered.Triggers.Count)개)"
Write-Host ""
Write-Host "즉시 1회 실행해 확인하려면:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Select-Object LastRunTime, LastTaskResult"
Write-Host "  → Server Manager 가 떠 있다면 LastTaskResult 는 0 이고," -ForegroundColor DarkGray
Write-Host "    새 창이 뜨지 않으며 logs/server_events.jsonl 에 watchdog_* 이벤트가 없어야 정상입니다." -ForegroundColor DarkGray
Write-Host ""
Write-Host "개발 PC 에서 시험했다면 반드시 해제하세요 (이 태스크는 서버에만 있어야 합니다):" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
