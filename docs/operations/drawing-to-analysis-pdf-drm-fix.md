# DrawingToAnalysis PDF DRM 변환 장애 기록

## 날짜

2026-05-28

## 증상

- 동일한 LUG PDF를 WorkBench DrawingToAnalysis에서 실행하면 `BDF 변환 실패`가 표시됨.
- 실패 폴더 예시:
  `HiTessWorkBenchBackEnd/userConnection/20260528_144229_A476854_DrawingToAnalysis`
- 해당 폴더의 `diagnostic.json`에는 다음 흐름이 기록됨.
  - `validate_pdf`: 성공
  - `normalize_pdf`: `input_pdf_for_engine.pdf` 생성
  - `engine_done`: `returncode=1`
  - `lug_model.bdf`: 미생성

## 원인

회사 DRM 환경에서 백엔드가 정규화 PDF를 `userConnection` 폴더 안에 저장하면 확장자가 `.pdf`가 아니어도 파일이 다시 DRM 래핑될 수 있다. 실제 WorkBench 실패 폴더에서는 `input_pdf_for_engine.pdfdata`도 파일 헤더가 `%PDF-`가 아니라 `HHIDRMC` 형태가 되었고, PyInstaller로 빌드된 `DrawingToAnalysis.exe` 내부 PyMuPDF가 해당 파일을 열지 못해 BDF 생성이 중단됐다.

또한 DRM 드라이버가 Python 프로세스에는 복호화된 PDF 스트림을 제공하는 경우가 있어, 단순 파일 헤더 검사만으로 유효 PDF 여부를 판단하면 오탐이 생길 수 있다.

## 수정 내용

수정 파일:

- `HiTessWorkBenchBackEnd/app/services/drawing_to_analysis_service.py`

변경 사항:

- 업로드 PDF를 백엔드 Python/PyMuPDF에서 먼저 검증한다.
- 헤더가 `%PDF-`가 아니어도 PyMuPDF가 열 수 있으면 유효 PDF로 인정한다.
- 검증 결과에 `header_magic`을 기록해 DRM 래핑 여부를 추적할 수 있게 했다.
- 엔진에 넘길 정규화 PDF는 `userConnection`이 아니라 OS 임시 폴더의 `workbench_drawing_to_analysis/{job_id}/input_pdf_for_engine.pdfdata`에 저장한다.
- 결과 파일의 출력 위치는 기존 절차대로 `userConnection/{timestamp}_{employee_id}_DrawingToAnalysis/`를 유지한다.
- 정규화는 `fitz.save(..., garbage=4, deflate=True, clean=True)`로 수행한다.
- 각 단계 결과를 `diagnostic.json`에 남겨 재현과 원인 파악이 가능하게 했다.
- BDF 생성 후 `NastranBridge`를 실행해 `lug_model_bridge.json`도 생성한다.

## 재검증

검증 입력:

- `HiTessWorkBenchBackEnd/userConnection/20260528_144229_A476854_DrawingToAnalysis/LugTest.pdf`

CLI 검증 결과:

- 정규화 출력: OS 임시 폴더의 `workbench_drawing_to_analysis/.../input_pdf_for_engine.pdfdata`
- 정규화 파일 헤더: `%PDF-1.7`
- `DrawingToAnalysis.exe`: exit code `0`
- 생성 BDF: `lug_model.bdf`
- 메시 결과: `nodes=2100`, `elements=2016`
- `NastranBridge`: exit code `0`
- 생성 JSON: `lug_model_bridge.json`
- Bridge diagnostics: `0`

WorkBench API 검증 결과:

- API: `POST /api/analysis/drawing-to-analysis/request`
- 생성 폴더: `HiTessWorkBenchBackEnd/userConnection/20260528_145844_A476854_DrawingToAnalysis`
- `diagnostic.json` 상태: `Success`
- `engine_done.returncode`: `0`
- `bridge_done.returncode`: `0`
- 생성 파일: `lug_model.bdf`, `lug_model_bridge.json`, `mesh_preview.png`, `mesh.json`, `vectors.json`, `lug_params.json`

## 운영 메모

이미 실행 중인 FastAPI 서버가 `--reload` 없이 떠 있으면 수정된 서비스 코드가 반영되지 않는다. 이 경우 백엔드 서버를 재시작한 뒤 PDF를 다시 업로드해야 한다.
