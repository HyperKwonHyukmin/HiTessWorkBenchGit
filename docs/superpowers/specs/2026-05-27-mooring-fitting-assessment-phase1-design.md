# Mooring Fitting Assessment — File-Based App Phase 1 디자인

**작성일**: 2026-05-27
**범위**: 워크벤치 File-Based Apps 카테고리에 Mooring Fitting Assessment 페이지를 신규 추가. CSV 2개 업로드 → userConnection 폴더 저장 → `MooringFitting.exe build-full` 실행 → 산출물 경로 DB 기록 + 다운로드. 결과 시각화(3D 뷰어/진단 패널/LINEAGE 등)는 Phase 2 이후 별도 진행.

---

## 1. Out of Scope (Phase 1)

명시적으로 제외 — 사용자가 "여기까지 일단 구현하고자 한다. 그 이후의 과정은 연이어 진행할건데" 라고 명시함.

- `--policy=keep|merge` UI 노출 (백엔드는 기본값 keep, 즉 옵션 없이 호출)
- `--solve` (Nastran 자동 호출) — Nastran 실행은 별도 코드에서 후속 단계로 처리
- 3D 모델 뷰어 (`STAGE_NN.initial.json::nodes/elements` 시각화)
- 진단 패널 (각 STAGE diagnostics 통합 트리)
- LINEAGE timeline 검색 UI
- F06 후처리 (`--solve` 미사용이므로 해당 없음)
- 폼 기반 CSV 에디터 (MF/PLATE/ANGLE 등 타입별 그리드 입력) — 사용자가 외부에서 작성한 CSV를 업로드하는 방식만

## 2. 외부 동작 명세

### 2.1 사용자 시나리오
1. 사용자가 `File-Based Apps` 카탈로그에서 `Mooring Fitting Assessment` 카드를 클릭.
2. 페이지에서 Structure CSV(`MooringFittingData.csv` 형식) 와 Load CSV(`MooringFittingDataLoad.csv` 형식) 를 각각 드래그앤드롭 또는 파일 선택.
3. `Run Analysis` 버튼 클릭 → 백엔드가 `userConnection/{ts}_{eid}_MooringFitting/` 폴더 생성, 두 CSV를 표준 파일명으로 저장, `MooringFitting.exe build-full <work_dir>` 호출.
4. 페이지가 1.5초 간격으로 `GET /api/analysis/status/{job_id}` 폴링 → 진행률(0~100%) 표시.
5. 완료 시 핵심 산출물 5개 + 전체 펼치기 영역에 다운로드 카드 렌더.

### 2.2 입력 파일 의미
README 4장 (Input CSV Schema) 참조. 백엔드는 파일 내용은 검증하지 않음 — exe 가 1차 검증 책임.

### 2.3 산출물
README 6/7장 참조. 핵심 5개 + 전체 약 29개 파일 (8 STAGE × 3종류 + LINEAGE + Report 2 + 최종 validation 등).

## 3. 추가/변경 파일 맵

### Backend (FastAPI)

| 위치 | 변경 | 역할 |
|---|---|---|
| `app/services/mooring_fitting_service.py` | **신규** | `task_execute_mooring_fitting()` — exe 실행, out/ glob, DB 기록 |
| `app/routers/analysis.py` | **편집** | `POST /api/analysis/mooring-fitting/request` 엔드포인트 + service import |
| `app/routers/_intake.py` | **편집** | `save_upload()` 에 `dest_name: str \| None = None` 옵션 추가 (비파괴 확장) |

### Frontend (React)

| 위치 | 변경 | 역할 |
|---|---|---|
| `frontend/src/pages/analysis/MooringFittingAssessment.jsx` | **신규** | 업로드 2개 + Run + 폴링 + 결과 트리 |
| `frontend/src/App.jsx` | **편집** | `renderPage()` switch에 `case 'Mooring Fitting Assessment'` + import |
| `frontend/src/contexts/DashboardContext.jsx` | **편집** | `RAW_ANALYSIS_DATA` 항목 + `APP_REGISTRY_OVERRIDES` endpoint 매핑 |

### 배포 (사용자 수동, 반복)

`WorkBenchSubModule\MooringFitting\` 에서:
```powershell
dotnet publish src/MooringFitting.App -c Release -r win-x64 `
  --self-contained -p:PublishSingleFile=true -o publish/
```
산출된 `publish\MooringFitting.App.exe` → `HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe` 로 **rename 복사**.

백엔드는 `subprocess.run` 시점에 매번 새 프로세스 spawn 하므로 재시작 불필요.

## 4. 명명 규칙 (확정)

| 항목 | 값 |
|---|---|
| 메뉴 표시명 / `title` | `Mooring Fitting Assessment` |
| DB `program_name` | `MooringFitting` |
| `category` | `MooringFitting` |
| `devStatus` | `Developing` (Phase 2 결과 시각화 완료 후 `Active` 전환) |
| `contributor` | `권혁민` |
| userConnection 폴더 접미사 | `MooringFitting` → `{ts}_{eid}_MooringFitting/` |
| API 엔드포인트 | `POST /api/analysis/mooring-fitting/request` |
| exe 절대 경로 | `HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe` |
| 표준 입력 파일명 | `MooringFittingData.csv`, `MooringFittingDataLoad.csv` |
| 타임아웃 | 600초 (10분) |
| `source` 기본값 | `Workbench` |

## 5. 데이터 흐름 (상세)

```
[Frontend] MooringFittingAssessment.jsx
    │ multipart/form-data
    │   structure_file: <UploadFile>     ← 임의 파일명 허용
    │   load_file:      <UploadFile>
    │   employee_id:    string
    │   source:         "Workbench"
    ▼
[POST /api/analysis/mooring-fitting/request]
    │ 1. _verify_employee_self(employee_id, current_user)
    │ 2. work_dir, ts = make_work_dir(employee_id, "MooringFitting")
    │ 3. structure_path = await save_upload(
    │       structure_file, work_dir,
    │       dest_name="MooringFittingData.csv",
    │       error_prefix="Structure CSV 저장 오류")
    │ 4. load_path = await save_upload(
    │       load_file, work_dir,
    │       dest_name="MooringFittingDataLoad.csv",
    │       error_prefix="Load CSV 저장 오류")
    │ 5. exe_path = os.path.abspath(os.path.join(
    │       _BACKEND_DIR, "InHouseProgram", "MooringFitting", "MooringFitting.exe"))
    │ 6. job_id = submit_analysis_job(
    │       task_execute_mooring_fitting,
    │       structure_path, load_path, work_dir, exe_path,
    │       employee_id, ts, source)
    │ 7. return {"job_id": job_id}
    ▼
[task_execute_mooring_fitting] (analysis_executor 스레드)
    │ mark_running(job_id, "MooringFitting 초기화 중...", 10)
    │ if not os.path.exists(exe_path): raise FileNotFoundError
    │ update_progress(job_id, 30, "BDF 파이프라인 실행 중...")
    │ subprocess.run(
    │   [exe_path, "build-full", work_dir],
    │   cwd=work_dir,
    │   stdout=PIPE, stderr=PIPE,
    │   timeout=600,
    │ )
    │ update_progress(job_id, 80, "결과 파일 수집 중...")
    │ out_dir = os.path.join(work_dir, "out")
    │ result_data = collect_artifacts(out_dir, work_dir)
    │ status_msg = "Success" if returncode == 0 else "Failed"
    │ record_analysis(
    │   project_name=f"MooringFitting_{ts}",
    │   program_name="MooringFitting",
    │   input_info={"structure_csv": structure_path, "load_csv": load_path},
    │   result_info=result_data,
    │   ...)
    │ mark_complete(job_id, status_msg, engine_output, project_data,
    │               success_message="MooringFitting 해석 완료",
    │               failure_message="MooringFitting 해석 실패")
    ▼
[Frontend 폴링]
    GET /api/analysis/status/{job_id}  (1.5초 간격)
    → progress 0~100, status Pending/Running/Success/Failed
    완료 시 result_info 산출물 경로로 다운로드 카드 렌더
```

## 6. `collect_artifacts()` — out/ 수집 전략

```python
def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """Phase 2 시각화 대비 풍부하게 수집. 부재 시 None."""
    if not os.path.isdir(out_dir):
        return {"out_dir": out_dir, "_artifacts_missing": True}

    files = os.listdir(out_dir)
    pick = lambda name: os.path.join(out_dir, name) if name in files else None

    return {
        "case_dir": work_dir,
        "out_dir": out_dir,
        # 핵심 5개 (페이지 기본 노출)
        "final_bdf":         pick("STAGE_07_FinalValidation.bdf"),
        "validation_json":   pick("STAGE_07_FinalValidation.validation.json"),
        "lineage_json":      pick("LINEAGE.json"),
        "report_mf_csv":     pick("Report_LoadCalculation_MF.csv"),
        "report_winch_csv":  pick("Report_LoadCalculation_Winch.csv"),
        # 보조 (Phase 2 뷰어용, 펼치기 영역)
        "stage_jsons":          sorted(os.path.join(out_dir, f) for f in files
                                       if f.startswith("STAGE_") and f.endswith(".json")
                                       and ".verification." not in f),
        "stage_bdfs":           sorted(os.path.join(out_dir, f) for f in files
                                       if f.startswith("STAGE_") and f.endswith(".bdf")),
        "stage_verifications":  sorted(os.path.join(out_dir, f) for f in files
                                       if f.endswith(".bdf.verification.json")),
        "raw_json":             pick("STAGE_00.raw.json"),
        "initial_json":         pick("STAGE_00.initial.json"),
    }
```

## 7. 에러 처리 매트릭스

| 케이스 | 백엔드 처리 | 사용자 표시 |
|---|---|---|
| CSV 한쪽 누락 | FastAPI 422 (Form `File(...)` 필수) | "Structure CSV와 Load CSV를 모두 선택하세요" |
| employee_id 위·변조 | `_verify_employee_self()` → 403 | "인증 사용자와 일치하지 않습니다" |
| exe 부재 | `os.path.exists` → "Failed" | "실행 파일을 찾을 수 없습니다: …\MooringFitting.exe" |
| exe exit code ≠ 0 | "Failed" + stdout/stderr 통합 | 빨간 에러 박스 + 로그 펼치기 |
| 타임아웃 (600s) | `subprocess.TimeoutExpired` → "Failed" | "MooringFitting 실행 시간이 초과되었습니다 (10분)" |
| out/ 폴더 미생성 | `_artifacts_missing` flag + "Failed" | "결과 파일이 생성되지 않았습니다" |
| DB 기록 실패 | record_analysis db_err → "Failed" 부착 | "DB Error: …" |

## 8. `save_upload` 비파괴 확장

```python
async def save_upload(
    upload: UploadFile,
    work_dir: str,
    error_prefix: str = "File save error",
    dest_name: str | None = None,   # ← 신규
) -> str:
    fname = dest_name or os.path.basename(upload.filename)
    dest_path = os.path.join(work_dir, fname)
    try:
        with open(dest_path, "wb") as buffer:
            buffer.write(await upload.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{error_prefix}: {str(e)}")
    return dest_path
```
- `dest_name=None`이 기본 → 기존 호출자 전부 동작 동일.
- MooringFitting 라우터만 표준명 명시 → 강제 rename 효과.

## 9. ANALYSIS_DATA 등록 (Frontend)

`RAW_ANALYSIS_DATA` 배열에 다음 항목 1개 추가:
```js
{ mode: "File", category: "MooringFitting", title: "Mooring Fitting Assessment",
  description: "Mooring Fitting / Winch 보강 구조의 CSV 2종을 입력받아 8단계 BDF 파이프라인을 자동 생성합니다.",
  icon: UploadCloud, color: "bg-blue-600",
  tags: ["Mooring", "Winch", "BDF", "Pipeline"],
  devStatus: "Developing", contributor: "권혁민" },
```

`APP_REGISTRY_OVERRIDES` 에 매핑 추가:
```js
"Mooring Fitting Assessment": {
  menuName: "Mooring Fitting Assessment",
  programNames: ["MooringFitting", "Mooring Fitting Assessment"],
  apiEndpoint: "/api/analysis/mooring-fitting/request",
},
```

`App.jsx::renderPage()` 에 분기 추가:
```jsx
case 'Mooring Fitting Assessment': return <MooringFittingAssessment />;
```
및 상단 import 라인 1개 추가.

## 10. 페이지 컴포넌트 골격 (MooringFittingAssessment.jsx)

```jsx
import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { usePolling } from '../../hooks/usePolling';
import { getApiBaseUrl } from '../../config';
import PageBanner from '../../components/PageBanner';
import FileDropZone from '../../components/FileDropZone';  // 기존 컴포넌트 재사용
import RunButton from '../../components/RunButton';
import ResultArtifactList from '../../components/ResultArtifactList';

export default function MooringFittingAssessment() {
  const [structureFile, setStructureFile] = useState(null);
  const [loadFile, setLoadFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [resultInfo, setResultInfo] = useState(null);
  const { addToast } = useToast();
  const { startGlobalJob } = useDashboard();

  const handleRun = async () => {
    if (!structureFile || !loadFile) {
      addToast('Structure CSV와 Load CSV를 모두 선택하세요', 'error');
      return;
    }
    const employeeId = JSON.parse(localStorage.getItem('user'))?.employee_id;
    const fd = new FormData();
    fd.append('structure_file', structureFile);
    fd.append('load_file', loadFile);
    fd.append('employee_id', employeeId);
    fd.append('source', 'Workbench');
    const res = await fetch(`${getApiBaseUrl()}/api/analysis/mooring-fitting/request`, {
      method: 'POST', body: fd, credentials: 'include',
    });
    const data = await res.json();
    setJobId(data.job_id);
    startGlobalJob({ jobId: data.job_id, programName: 'Mooring Fitting Assessment' });
  };

  // usePolling 으로 1.5초 간격 상태 조회 → 완료 시 setResultInfo
  // ...

  return (
    <div>
      <PageBanner title="Mooring Fitting Assessment" subtitle="CSV 2개 → Nastran BDF 8단계 파이프라인" />
      <UploadCardTwoColumn ... />
      {jobId && <ProgressPanel jobId={jobId} />}
      {resultInfo && <ResultArtifactList result={resultInfo} />}
    </div>
  );
}
```
(실제 import할 공통 컴포넌트는 기존 TrussAnalysis.jsx 가 사용하는 것을 재사용 — Phase 1 작성 시 실제 컴포넌트명/시그니처에 맞춰 조정.)

## 11. 테스트 시나리오 (수동)

1. **샘플 케이스 통과** — `WorkBenchSubModule/MooringFitting/csv/NewCase_01/MooringFittingData.csv` + `MooringFittingDataLoad.csv` 업로드 → Success + out/ 폴더에 STAGE_00~07 산출물 생성.
2. **표준명 강제 검증** — 임의 이름(`Vessel_X_data.csv`)으로 업로드 → work_dir에 `MooringFittingData.csv` 로 저장됨 + exe 정상 실행.
3. **exe 부재** — 임시로 `MooringFitting.exe` 를 다른 이름으로 옮긴 뒤 실행 → "Failed" + "실행 파일을 찾을 수 없습니다" 메시지.
4. **타임아웃** — exe 를 sleep 720초 stub 으로 교체 → 600초 후 "Failed" + 타임아웃 메시지.
5. **CSV 누락** — 페이지에서 한쪽만 선택 후 Run → "두 파일 모두 선택" 토스트.
6. **다운로드** — 완료 후 STAGE_07 BDF, Report CSV 다운로드 동작.
7. **이력** — `/api/analysis/history/{employee_id}` 에서 program_name="MooringFitting" 항목 노출.

## 12. Phase 2 이후 확장 포인트 (참고)

본 Phase 1 디자인이 의도적으로 남겨둔 부분 — 추후 별도 디자인/계획에서 처리.

- `--policy=keep|merge` 라디오 토글 (백엔드 Form 파라미터 + service args 1개 추가)
- `--solve` (Nastran 자동 호출) — 단, 사용자 요구상 별도 코드에서 후속 처리하므로 검토 필요
- 3D 모델 뷰어 — `STAGE_NN.initial.json` 의 nodes/elements 를 Three.js 로 시각화
- 진단 패널 — 각 STAGE diagnostics 통합 트리, severity별 필터링
- LINEAGE timeline — 요소/노드 ID 검색 → 생애주기 (생성→split→merge→삭제) 표시
- BDF ↔ FE 모델 카드 1:1 검증 표시
- 1-click 샘플 실행 (다른 앱들의 `run-sample` 패턴) — 사번별 일일 1회 제한
