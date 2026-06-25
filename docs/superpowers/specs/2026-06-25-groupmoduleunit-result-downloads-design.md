# Group & Module Unit 권상 구조해석 — 해석 결과 산출물 다운로드 설계

**작성일:** 2026-06-25
**대상:** WorkBench `Group & Module Unit 권상 구조 해석` 페이지의 **"3. 해석 결과 확인"** 단계

## 목표

"3. 해석 결과 확인" 단계에서 최종 모델 BDF(해석 덱 + 편집 구조 모델)와, Nastran 해석을 수행했다면 F06·OP2를 다운로드할 수 있게 한다.

## 배경 / 현재 상태

- 페이지: `HiTessWorkBench/frontend/src/pages/analysis/GroupModuleUnitLiftingAnalysis.jsx`. 3단계(BDF 입력 검증 → Group Module Unit Studio → 해석 결과 확인).
- **Step 3는 현재 사실상 빈 placeholder.** `ResultsPanel`이 쓰는 `analysisResult` state는 `handleReset`에서 `null`로만 설정될 뿐 실제로 채워지지 않는다. 실제 구조해석 결과는 **Studio(별도 Electron viewer)** 안에서 표시된다.
- 구조해석은 Studio가 `viewer:runUnitStructural` → 백엔드 `unit_structural_service.py`로 실행한다. 산출물은 **부모 BDF와 같은 폴더** `userConnection/<ts>_<사번>_GroupModuleUnit/`(또는 `_SidePassage`)에 생성된다:
  - `<stem>_lifting.bdf` — Nastran이 실제로 푼 최종 덱(Studio 편집 + 권상 와이어(CROD) + SPC/하중 포함)
  - `<stem>_lifting.f06` — Nastran F06
  - `<stem>_lifting.op2` — **덱이 `PARAM,POST,-1`로 OP2 출력을 요청한 경우에만** 생성(보장되지 않음 → 디스크에서 존재 확인 필요)
  - `<stem>_edited.bdf` — Studio 편집을 BDF로 변환한 구조 모델(편집을 적용한 경우에만)
  - `<stem>_lifting_meta.json`, `<stem>_lifting_nastranResult.json` — (다운로드 대상 아님)
  - `<stem>` = 업로드된 원본 BDF 파일명의 stem.
- 페이지가 이미 보유한 상태:
  - `bdfAnalysisId` — BDF 검증으로 생성된 GroupModuleUnit `Analysis.id`(DB parent record). `usePolling.onComplete`에서 `data.project.id`로 설정.
  - `bdfFolderPath` — `bdfPath`(=result_info.bdf)에서 파생된 산출물 폴더.
- 기존 다운로드 인프라:
  - 백엔드 `GET /api/download?filepath=...` — 인증 + `userConnection/` 내부 경로만 허용 + 감사로그. `FileResponse`로 서빙(JSON/BDF는 이미 이 경로로 다운로드되어 동작 확인됨).
  - 프론트 `api/analysis.js`의 `downloadFileBlob(filepath)` — axios `responseType:'blob'` + `getAuthHeaders()`. **바이너리 OP2에 그대로 사용 가능.**
- parent record의 `input_info["bdf_model"]`에 업로드된 원본 BDF 절대경로가 들어 있다(`unit_structural_service.py`, `module-stability/upload`가 동일 필드 사용).

## 확정된 결정사항

1. **"최종 모델 BDF"** = 해석 덱(`_lifting.bdf`)과 편집 구조 모델(`_edited.bdf`) **둘 다** 다운로드 제공.
2. **OP2/F06** = Nastran 수행 시(파일이 디스크에 존재할 때)만 노출.
3. **`_edited.bdf` 부재 시(편집 안 함)** → "편집 구조 모델" 버튼 **숨김**(원본 BDF로 대체하지 않음).
4. **UI 배치** = Step 3 **상단에 다운로드 카드 추가**. 기존 판정 테이블(`ResultsPanel`)은 건드리지 않고 그 위에 둔다.
5. **데이터 소스** = `bdfAnalysisId`(parent id) 기반 백엔드 산출물 스캔 엔드포인트. 폴더만 보므로 구조해석 자식 레코드가 없어도(편집/안정성만) `_edited.bdf`를 노출할 수 있다.

## 아키텍처

```
[Step 3 활성 + bdfAnalysisId 존재]
        │  (마운트 시 + "새로고침" 버튼)
        ▼
GET /api/analysis/groupmoduleunit/{parent_id}/artifacts
        │  parent record → dirname(bdf_model) 폴더 스캔
        ▼
{ folder, artifacts: [ {kind,label,fileName,path,sizeBytes} ... ] }  // 존재하는 것만
        │
        ▼
[ResultArtifactsCard]  버튼 클릭 → downloadFileBlob(path) → objectURL → <a download>
        ▼
GET /api/download?filepath=<path>   (기존 메커니즘: 인증·userConnection 제한·감사로그)
```

## 백엔드 — 신규 엔드포인트

**파일:** `HiTessWorkBenchBackEnd/app/routers/analysis.py`

**엔드포인트:** `GET /api/analysis/groupmoduleunit/{parent_id}/artifacts`

**동작:**
1. `require_auth`로 `current_user` 확보.
2. DB에서 `Analysis.id == parent_id` 로드. 없으면 404.
3. 검증: `program_name ∈ {"GroupModuleUnit", "SidePassage"}` 아니면 400; `employee_id != current_user` 면 403.
4. `bdf_model = parent.input_info.get("bdf_model")`. 없거나 미존재면 404("부모 BDF 경로를 찾을 수 없습니다").
5. `folder = dirname(abspath(bdf_model))`. `_is_within_dir(_USER_CONNECTION_DIR, folder)` 아니면 403(방어).
6. `stem = splitext(basename(bdf_model))[0]`.
7. 순수 헬퍼 `scan_lifting_artifacts(folder, stem)` 호출 → 존재하는 산출물만 리스트로 반환.

**순수 헬퍼(단위 테스트 대상):**
```python
ARTIFACT_SPECS = [
    ("liftingBdf", "{stem}_lifting.bdf", "해석 덱 BDF"),
    ("editedBdf",  "{stem}_edited.bdf",  "편집 구조 모델 BDF"),
    ("f06",        "{stem}_lifting.f06", "Nastran F06"),
    ("op2",        "{stem}_lifting.op2", "Nastran OP2"),
]

def scan_lifting_artifacts(folder: str, stem: str) -> list[dict]:
    """folder 안에서 알려진 산출물 파일을 존재하는 것만 메타와 함께 반환."""
    out = []
    for kind, pattern, label in ARTIFACT_SPECS:
        name = pattern.format(stem=stem)
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            try:
                size = os.path.getsize(path)   # best-effort (DRM at-rest 시 오차 가능, 표시용)
            except OSError:
                size = None
            out.append({
                "kind": kind, "label": label, "fileName": name,
                "path": os.path.abspath(path), "sizeBytes": size,
            })
    return out
```

**응답(200):**
```json
{
  "folder": "<abs folder>",
  "artifacts": [
    { "kind": "liftingBdf", "label": "해석 덱 BDF", "fileName": "model_lifting.bdf", "path": "<abs>", "sizeBytes": 12345 },
    { "kind": "f06", "label": "Nastran F06", "fileName": "model_lifting.f06", "path": "<abs>", "sizeBytes": 67890 }
  ]
}
```
`artifacts`는 **존재하는 파일만** 포함(없으면 빈 배열). 호출자는 `kind`로 그룹핑.

## 프론트엔드

**API 헬퍼 추가** — `HiTessWorkBench/frontend/src/api/analysis.js`:
```js
export const getGroupModuleUnitArtifacts = (parentId) =>
  axios.get(`${API_BASE_URL}/api/analysis/groupmoduleunit/${parentId}/artifacts`,
            { headers: getAuthHeaders() });
```

**신규 컴포넌트** — `HiTessWorkBench/frontend/src/components/analysis/ResultArtifactsCard.jsx`:
- props: `{ parentAnalysisId }`.
- 마운트 및 `parentAnalysisId` 변경 시 `getGroupModuleUnitArtifacts`로 fetch. **"새로고침" 버튼** 제공(구조해석은 Studio에서 비동기로 끝나므로 Step 3로 돌아와 갱신).
- 산출물을 2그룹으로 표시:
  - **모델 BDF**: `liftingBdf`, `editedBdf`
  - **Nastran 결과**: `f06`, `op2`
  - 그룹에 해당 산출물이 하나도 없으면 그 그룹 헤더 숨김.
- 각 버튼: 라벨 + 파일명 + 용량(KB/MB). 클릭 → `downloadFileBlob(art.path)` → `URL.createObjectURL(blob)` → `<a download=art.fileName>` 클릭 → revoke. 실패 시 toast.
- 상태:
  - `parentAnalysisId` 없음 → "BDF 검증을 먼저 완료하세요" 안내.
  - 로딩 → 스피너.
  - `artifacts` 빈 배열 → "아직 산출물이 없습니다 — Studio에서 권상 구조 해석을 수행한 뒤 새로고침하세요."
  - 오류 → 에러 메시지 + 재시도.

**페이지 연결** — `GroupModuleUnitLiftingAnalysis.jsx`의 `isResultsStep` 블록:
- 기존 "해석 결과 확인" 카드 **위에** `<ResultArtifactsCard parentAnalysisId={bdfAnalysisId} />` 추가.
- import 추가, 기존 `ResultsPanel`/`analysisResult` 로직은 그대로 둔다.

## 에러 처리

- `bdfAnalysisId` null → 카드는 안내 문구만 표시(요청 안 함).
- 엔드포인트 404(parent 없음/BDF 경로 없음) / 403(소유자 불일치) → 카드에 사용자 친화 메시지.
- 다운로드 시점 파일 없음/`/api/download` 404 → toast 에러("파일을 찾을 수 없습니다 — 다시 새로고침해 주세요").

## 테스트 / 검증

- **백엔드:** `scan_lifting_artifacts(folder, stem)`는 DB/HTTP 의존 없는 순수 함수 → 임시 폴더에 더미 파일을 만들어 단위 검증(존재하는 것만 반환, 4종 매핑, 빈 폴더 → `[]`). 레포에 pytest 구성이 있으면 테스트 추가, 없으면 scratch 스크립트로 검증 + `py_compile`.
- **프론트:** 이 WorkBench 프론트는 vitest 미구성 → 수동 검증(`npm run dev`). 구조해석 수행 후 Step 3에서 4파일 노출/그룹핑/다운로드 확인, 미수행 시 BDF만/빈 상태 확인.

## 범위에서 제외 (YAGNI)

- 원본 업로드 BDF·`_lifting_meta.json`·`_lifting_nastranResult.json` 다운로드(요청 외).
- 자동 폴링(새로고침 버튼으로 충분).
- 기존 `ResultsPanel` 판정 테이블/Excel 버튼 변경.
- OP2를 강제 생성(lift-run 덱에 `PARAM,POST,-1` 주입)하는 변경 — 현재는 "존재 시 노출"만. (추후 별도 요청 시 검토.)

## 서버 반영 메모

- `analysis.py`는 git 추적 백엔드 코드 → 서버(145)는 `git pull` + 백엔드 재시작으로 반영.
- 이번 변경은 InHouseProgram(exe/py) 미변경 → 수동 교체 불필요.
