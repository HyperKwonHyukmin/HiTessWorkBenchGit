@echo off
chcp 65001 >nul
setlocal
rem Hi-TESS 서버(10.14.42.145) 인증서를 이 PC 의 "내 계정" 신뢰 목록에 넣는다. 관리자 권한은 필요 없다.
rem 크롬에서 https://10.14.42.145:9091 (구조해석 자동화 협의체 과제 현황 /council/ 등)을 경고 없이 열기 위한 것이다.
rem 원본: WorkBench 저장소 scripts/council-cert/ (docs/plans/2026-11-25-automation-council-tasks-plan.md)
set "CRT=%~dp0hitess-145.crt"
set "THUMB=E5C5C3C65260B7A01691E4ECAF91705BEC097E49"

if not exist "%CRT%" (
  echo [오류] 같은 폴더에 hitess-145.crt 가 없습니다. 두 파일을 함께 복사해 주세요.
  goto :end
)

rem 파일이 바뀌지 않았는지 지문부터 확인한다.
set "GOT="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 '%CRT%').Thumbprint"`) do set "GOT=%%T"
if /i not "%GOT%"=="%THUMB%" (
  echo [오류] 인증서 지문이 맞지 않아 등록하지 않았습니다.
  echo   기대한 지문: %THUMB%
  echo   파일의 지문: %GOT%
  goto :end
)

certutil -user -verifystore Root %THUMB% >nul 2>&1
if not errorlevel 1 (
  echo 이미 등록돼 있습니다. 크롬 창을 모두 닫았다가 다시 열면 됩니다.
  goto :end
)

echo Hi-TESS 서버 인증서를 등록합니다.
echo 잠시 뒤 뜨는 "보안 경고" 창에서 [예]를 눌러 주세요.
certutil -user -addstore Root "%CRT%" >nul
if errorlevel 1 (
  echo [오류] 등록하지 못했습니다. 보안 경고 창에서 [아니요]를 눌렀다면 다시 실행해 주세요.
  goto :end
)
echo 등록했습니다. 크롬 창을 모두 닫았다가 다시 연 뒤 아래 주소를 여세요.
echo   https://10.14.42.145:9091/council/

:end
echo.
pause
