# Dev_Server_70.bat 이 부른다 — 9091 을 잡은 백엔드의 맨 위 프로세스(--reload 감시 프로세스)를 "PID 이름" 한 줄로 낸다. 없으면 아무것도 안 낸다.
$c = Get-NetTCPConnection -State Listen -LocalPort 9091 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) { exit 0 }
$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess)
while ($p) {
    $up = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId)
    if ($up -and $up.Name -match '^(python|pythonw|uvicorn)\.exe$') { $p = $up } else { break }
}
if ($p) { Write-Output ("{0} {1}" -f $p.ProcessId, $p.Name) }
