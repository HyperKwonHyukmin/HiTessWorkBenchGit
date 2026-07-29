$ErrorActionPreference = 'Stop'
$Python = Join-Path $PSScriptRoot '..\HiTessWorkBenchBackEnd\WorkBenchEnv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'python' }

& $Python -m PyInstaller --noconfirm --clean --onefile --name RdpCoordinatorServer "$PSScriptRoot\server.py"
if ($LASTEXITCODE -ne 0) { throw 'Server EXE build failed.' }
& $Python -m PyInstaller --noconfirm --clean --onefile --windowed --name RdpCoordinatorClient "$PSScriptRoot\client.py"
if ($LASTEXITCODE -ne 0) { throw 'Client EXE build failed.' }

New-Item -ItemType Directory -Force -Path "$PSScriptRoot\dist\config" | Out-Null
Copy-Item "$PSScriptRoot\config\remote_ip_owners.txt" "$PSScriptRoot\dist\config\remote_ip_owners.txt" -Force
Write-Host "Built files: dist\RdpCoordinatorServer.exe and dist\RdpCoordinatorClient.exe"
