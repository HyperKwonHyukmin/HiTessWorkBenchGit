# Module Unit Studio — "Save" 탭 (편집 반영 최종 BDF 출력) 구현 계획

> **For agentic workers:** 본 계획은 executing-plans 로 task 단위 실행. 스펙: `docs/superpowers/specs/2026-06-29-module-unit-save-bdf-export-design.md`.

**Goal:** Module Unit Studio에 "Save" 리본 탭을 추가해, 편집(회전·유체비우기·삭제·가서포트·RBE) 반영 최종 모델을 백엔드 `convert_json_to_bdf`로 BDF 생성 → Save-As 저장.

**Architecture:** Mooring `viewer:exportMooringBdf` 미러링. 스튜디오는 `buildEditedStageJson`으로 최종 JSON을 만들어 host 한 번 호출; Electron이 업로드→백엔드 convert→다운로드→Save-As 수행.

**Tech Stack:** FastAPI(analysis.py), Electron IPC(index.js/preload.js), React/Zustand(스튜디오), vitest.

---

## Task 1: 백엔드 라우트 `/analysis/module-unit/export-bdf`

**Files:** Modify `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py` (sidepassage checkplate-export 라우트 뒤, ~2811행 이후)

- [ ] **Step 1: 라우트 추가** — `_validate_userconnection_path`/`assert_current_user_can_access_path`/`_nb.convert_json_to_bdf`/`_NB_AVAILABLE` 재사용.

```python
@router.post("/analysis/module-unit/export-bdf")
async def export_module_unit_bdf(
    request: Request,
    current_user: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """Module Unit Studio "Save" → 편집 반영 최종 모델 JSON → convert_json_to_bdf → BDF 파일.

    Body JSON: { jsonPath: str }
      jsonPath = userConnection 하위 편집 모델(_edited.json) 절대경로
                 (= module-stability/upload 가 돌려준 remotePath).
    동작: json.load(jsonPath) → _nb.convert_json_to_bdf(data) → "<base>.bdf" 작성.
    반환: { ok, bdfPath, stats }  → 호출측이 /api/download 로 회수.
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body 파싱 실패")

    json_path = body.get("jsonPath")
    if not json_path or not isinstance(json_path, str):
        raise HTTPException(status_code=400, detail="jsonPath 는 필수")

    try:
        abs_path = _validate_userconnection_path(json_path)
        assert_current_user_can_access_path(abs_path, current_user, db, _ALLOWED_DOWNLOAD_BASE)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail=f"편집 모델 JSON 없음: {abs_path}")

    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"JSON 로드 실패: {e}")

    try:
        bdf_text = _nb.convert_json_to_bdf(data)
    except Exception as e:
        logger.exception("[module-unit export-bdf] BDF 생성 실패")
        raise HTTPException(status_code=500, detail=f"BDF 생성 실패: {e}")

    from pathlib import Path as _Path
    base = os.path.splitext(os.path.basename(abs_path))[0]
    out_path = os.path.join(os.path.dirname(abs_path), f"{base}.bdf")
    try:
        _Path(out_path).write_text(bdf_text, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 저장 실패: {e}")

    def _count(card: str) -> int:
        return sum(1 for ln in bdf_text.splitlines()
                   if ln[:8].strip().upper().rstrip("*") == card)
    stats = {
        "gridCount": _count("GRID"),
        "beamCount": _count("CBEAM") + _count("CBAR"),
        "rbe2Count": _count("RBE2"),
        "conm2Count": _count("CONM2"),
    }
    logger.info("[module-unit export-bdf] 완료: %s (grid=%d, beam=%d, rbe2=%d)",
                out_path, stats["gridCount"], stats["beamCount"], stats["rbe2Count"])
    return {"ok": True, "bdfPath": out_path, "stats": stats}
```

- [ ] **Step 2: `json` import 확인** — 파일 상단에 `import json` 있는지 확인. 없으면 추가.
- [ ] **Step 3: py_compile 검증** — `python -m py_compile app/routers/analysis.py` → 오류 없음.

---

## Task 2: WorkBench Electron IPC `viewer:exportUnitBdf`

**Files:** Modify `electron/preload.js`, `electron/index.js`

- [ ] **Step 1: preload 채널 화이트리스트** — `VALID_INVOKE_CHANNELS`에 `'viewer:exportUnitBdf'` 추가(`'viewer:exportMooringBdf'` 옆).
- [ ] **Step 2: preload workbenchAPI 노출** — `exportSidePassageBdf` 뒤에:

```javascript
  // ModuleUnitStudio "Save" → 편집 반영 최종 모델 JSON 업로드 → 백엔드 convert_json_to_bdf
  // → BDF 다운로드 → 사용자 PC 저장(대화상자). payload = { fileName, content }
  // 반환 = { ok, savedPath, stats } | { ok:false, canceled?, error }
  exportUnitBdf: (opts) =>
    ipcRenderer.invoke('viewer:exportUnitBdf', opts),
```

- [ ] **Step 3: index.js IPC 핸들러** — `viewer:exportSidePassageBdf` 핸들러 뒤(~1942행)에 추가. 업로드는 `viewer:uploadEvaluationArtifact` 로직(factory form), 변환/다운로드/저장은 `exportMooringBdf` 패턴.

```javascript
// ModuleUnitStudio "Save" → 편집 반영 최종 모델 JSON 을 서버에 업로드 →
// 백엔드 module-unit/export-bdf(convert_json_to_bdf)로 BDF 생성 → 다운로드 → 사용자 PC 저장.
// payload = { fileName, content }, 반환 = { ok, savedPath, stats } | { ok:false, canceled?, error }
ipcMain.handle("viewer:exportUnitBdf", async (_e, payload) => {
  try {
    const fileName = payload?.fileName;
    const content  = payload?.content;
    if (!fileName || typeof content !== "string") {
      return { ok: false, error: "fileName / content 누락" };
    }
    const runtimeConfig = await getWorkbenchRuntimeConfig();
    const { serverUrl } = runtimeConfig;
    const employeeId = runtimeConfig.employeeId;
    if (!employeeId) {
      return { ok: false, error: "사용자 정보가 없습니다 (로그인 필요)." };
    }
    if (!viewerParentAnalysisId) {
      return { ok: false, error: "parentAnalysisId 가 viewer:open 시점에 등록되지 않았습니다. WorkBench 에서 BDF 검증을 먼저 마치고 Studio 를 여세요." };
    }

    // 1) 편집 모델 JSON 업로드 (uploadEvaluationArtifact 와 동일 엔드포인트, artifact_kind='edited')
    const makeForm = () => {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "application/json" }), fileName);
      form.append("employee_id", employeeId);
      form.append("parent_analysis_id", String(viewerParentAnalysisId));
      form.append("artifact_kind", "edited");
      return form;
    };
    const { res: upRes } = await fetchWithSessionRefresh(
      `${serverUrl}/api/analysis/module-stability/upload`,
      () => ({ method: "POST", body: makeForm() }),
      runtimeConfig,
    );
    if (!upRes.ok) {
      const detail = await readBackendError(upRes);
      return { ok: false, error: `편집 모델 업로드 실패: ${upRes.status}${detail ? ` - ${detail}` : ""}` };
    }
    const upBody = await upRes.json();
    const jsonPath = upBody.remotePath;
    if (!jsonPath) return { ok: false, error: "업로드 응답에 remotePath 가 없습니다." };

    // 2) 백엔드에서 BDF 생성
    const { res: reqRes } = await fetchWithSessionRefresh(
      `${serverUrl}/api/analysis/module-unit/export-bdf`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonPath }),
      },
      runtimeConfig,
    );
    if (!reqRes.ok) {
      const detail = await readBackendError(reqRes);
      const hint = reqRes.status === 404
        ? ` - export-bdf API가 해당 서버에 없습니다. 서버(${serverUrl})가 최신 WorkBench 백엔드인지 확인하세요.`
        : "";
      return { ok: false, error: `BDF 생성 실패: ${reqRes.status}${detail ? ` - ${detail}` : ""}${hint}` };
    }
    const body = await reqRes.json();
    const bdfPath = body?.bdfPath;
    if (!bdfPath) return { ok: false, error: "백엔드 응답에 bdfPath 가 없습니다." };

    // 3) 생성된 BDF 다운로드
    const dlUrl = `${serverUrl}/api/download?filepath=${encodeURIComponent(bdfPath)}`;
    const { res: dlRes } = await fetchWithSessionRefresh(dlUrl, { method: "GET" }, runtimeConfig);
    if (!dlRes.ok) {
      const detail = await readBackendError(dlRes);
      return { ok: false, error: `BDF 다운로드 실패: ${dlRes.status}${detail ? ` - ${detail}` : ""}` };
    }
    const bdfText = await dlRes.text();

    // 4) 사용자 PC 저장 (저장 대화상자)
    const target = viewerWindow && !viewerWindow.isDestroyed() ? viewerWindow : mainWindow;
    const saveRes = await dialog.showSaveDialog(target, {
      title: "편집 반영 최종 BDF 저장",
      defaultPath: path.basename(bdfPath) || "module_unit_edited.bdf",
      filters: [{ name: "Nastran BDF", extensions: ["bdf"] }],
    });
    if (saveRes.canceled || !saveRes.filePath) {
      return { ok: false, canceled: true, error: "저장이 취소되었습니다." };
    }
    fs.writeFileSync(saveRes.filePath, bdfText, "utf-8");
    return { ok: true, savedPath: saveRes.filePath, stats: body?.stats ?? null };
  } catch (e) {
    return { ok: false, error: e?.message || "예외 발생" };
  }
});
```

- [ ] **Step 4: node --check** — `node --check electron/index.js` + `node --check electron/preload.js` → 오류 없음.

---

## Task 3: 스튜디오 host.js `exportUnitBdf`

**Files:** Modify `src/host/host.js` (ElectronHost constructor, `runUnitStructural` 블록 뒤)

- [ ] **Step 1: 메서드 추가** — preload 채널 존재 시에만 부여(가드).

```javascript
    // ModuleUnitStudio "Save" → 편집 반영 최종 BDF 출력. preload 노출 시에만 활성.
    // payload = { fileName, content }, 반환 = { ok, savedPath?, stats?, canceled?, error? }
    if (typeof api?.exportUnitBdf === 'function') {
      this.exportUnitBdf = async ({ fileName, content } = {}) => {
        try {
          const r = await api.exportUnitBdf({ fileName, content })
          return r ?? { ok: false, error: '응답이 없습니다 (preload 미응답).' }
        } catch (e) {
          return { ok: false, error: e?.message ?? String(e) }
        }
      }
    }
```

- [ ] **Step 2: 주석 인터페이스 추가** — 상단 ElectronHost 주석에 `exportUnitBdf(fileName, content)` 한 줄 설명 추가(선택).

---

## Task 4: 스튜디오 useEditStore `exportEditedBdf` (+ 테스트)

**Files:** Modify `src/store/useEditStore.js` (`exportPostureStabilityToFile` 뒤, store 객체 내), Test `src/store/useEditStore.test.js`

- [ ] **Step 1: 액션 추가** — store 객체 마지막 액션으로.

```javascript
  /**
   * 편집(회전·유체비우기·삭제·가서포트·RBE) 반영 최종 모델을 Nastran BDF 로 저장.
   * buildEditedStageJson → host.exportUnitBdf(업로드+백엔드 convert+다운로드+Save-As).
   * @returns {Promise<{ ok:boolean, savedPath?:string, stats?:object, canceled?:boolean, error?:string }>}
   */
  exportEditedBdf: async () => {
    const stage = currentStage()
    if (!stage) return { ok: false, error: '모델이 로드되지 않았습니다.' }
    const host = getHost()
    if (typeof host.exportUnitBdf !== 'function') {
      return { ok: false, error: 'BDF 출력은 WorkBench 앱에서 지원됩니다. WorkBench 앱을 최신 버전으로 업데이트하세요.' }
    }
    const intents = get().intents ?? []
    const editedJson = buildEditedStageJson(stage, intents)
    const content = JSON.stringify(editedJson, null, 2)
    const fileName = buildEditedStageFileName(stage, formatTimestamp)
    return host.exportUnitBdf({ fileName, content })
  },
```

- [ ] **Step 2: 테스트 — host 미지원 시 안내 반환**

```javascript
it('exportEditedBdf — host.exportUnitBdf 없으면 안내 반환', async () => {
  setHost({ name: 'web' })                       // exportUnitBdf 없음
  useStageStore.setState({ stages: [makeStage()] })
  const r = await useEditStore.getState().exportEditedBdf()
  expect(r.ok).toBe(false)
  expect(r.error).toMatch(/WorkBench 앱/)
})
```

- [ ] **Step 3: 테스트 — host 있으면 편집 반영 JSON 전달**

```javascript
it('exportEditedBdf — host.exportUnitBdf 에 편집 반영 JSON+파일명 전달', async () => {
  let captured = null
  setHost({ name: 'electron', exportUnitBdf: async (a) => { captured = a; return { ok: true, savedPath: 'C:/x.bdf' } } })
  useStageStore.setState({ stages: [makeStage()] })
  const r = await useEditStore.getState().exportEditedBdf()
  expect(r.ok).toBe(true)
  expect(captured.fileName).toMatch(/\.json$/)
  const parsed = JSON.parse(captured.content)
  expect(Array.isArray(parsed.nodes)).toBe(true)
  expect(Array.isArray(parsed.elements)).toBe(true)
})
```

(makeStage/ setHost 임포트는 기존 useEditStore.test.js 헬퍼/임포트 패턴 재사용. setHost 는 `../host/host.js` 에서 import.)

- [ ] **Step 4: 테스트 실행** — `npm --prefix <studio> test -- src/store/useEditStore.test.js` → 전부 PASS.

---

## Task 5: Save 탭 + SavePanel UI

**Files:** Modify `src/components/TopMenuBar.jsx`, `src/components/LeftDock.jsx`; Create `src/components/SavePanel.jsx`, `src/components/panels/SavePanelDock.jsx`

- [ ] **Step 1: TopMenuBar 탭 추가** — import에 `Save` 추가, TABS 끝에 `{ key: 'save', label: 'Save', Icon: Save }`.
- [ ] **Step 2: LeftDock 라우팅** — `import SavePanelDock from './panels/SavePanelDock.jsx'` + `if (activeMode === 'save') return <SavePanelDock />`.
- [ ] **Step 3: SavePanelDock 재export** — `export { default } from '../SavePanel.jsx'`.
- [ ] **Step 4: SavePanel 작성** — 헤더 "저장 (Save)", 편집 요약(intents stable 구독 후 본문 filter), "Nastran BDF로 저장" 버튼, 인라인 상태(local state: idle/saving/ok/error/canceled). AnalyzePanel 스타일/프리미티브(Section/Hint) 관례 준수. `exportEditedBdf` 호출. (전체 코드는 실행 시 작성 — Section/Hint/배지 스타일은 AnalyzePanel 동일.)

요약 카운트 계산(본문):
```javascript
const intents = useEditStore(s => s.intents)
const exportEditedBdf = useEditStore(s => s.exportEditedBdf)
const supportCount = intents.filter(i => i.kind === 'addSupportBeam').length
const addRigidCount = intents.filter(i => i.kind === 'addRigid').length
const deleteCount = intents.filter(i => i.kind?.startsWith('delete')).length
const rotated = intents.some(i => i.kind === 'rotateModel')
const fluidEmptied = intents.some(i => i.kind === 'emptyPipeFluid')
```

- [ ] **Step 5: node --check / lint** — 신규/수정 JSX 4파일 `node --check` (jsx는 빌드로 검증). `npm --prefix <studio> run build` 성공.

---

## Task 6: 버전 bump + 패키지 + 배포 + 검증

- [ ] **Step 1: 스튜디오 버전 bump** — `package.json` 0.0.69 → 0.0.70.
- [ ] **Step 2: 전체 테스트** — `npm --prefix <studio> test` → 전부 PASS.
- [ ] **Step 3: 패키지** — `npm --prefix <studio> run package` → `release/hitess-module-unit-studio-0.0.70.zip` + sha256.
- [ ] **Step 4: 배포** — zip을 로컬 `HiTessWorkBenchBackEnd\StudioProgram\` (1순위) + UNC `...\StudioProgram` 양쪽 복사(`Copy-Item -LiteralPath`).
- [ ] **Step 5: WorkBench 버전 bump** — 1.2.40 → 1.2.41 (package.json 루트/electron/frontend + system.py SERVER_VERSION). *(앱 재빌드·배포는 사용자 결정.)*
- [ ] **Step 6: 배포 보고** — 서버(145) git pull+재시작(analysis.py), WorkBench 앱 재배포(재설치), 스튜디오 zip 3계층 모두 필요함을 명시.

---

## 배포 의무 보고 (CLAUDE.md)

- **서버(145):** `git pull` + 백엔드 재시작 — `analysis.py` 신규 라우트. **InHouseProgram 교체 불필요**(`convert_json_to_bdf` 기존 존재).
- **WorkBench 데스크톱 앱:** preload/index.js 변경 → 새 릴리스 빌드 후 사용자 재설치(`git pull`만으로 안 됨).
- **스튜디오 zip:** 로컬 `StudioProgram` + UNC 수동 복사.
