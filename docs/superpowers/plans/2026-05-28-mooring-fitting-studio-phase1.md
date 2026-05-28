# MooringFittingStudio Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **IMPORTANT:** Do NOT run git add/commit at any step. User commits manually.

**Goal:** Build MooringFittingStudio — an Electron BrowserWindow viewer/editor for MooringFitting BDF results supporting Stage 00 / Stage 07 visualization, group delete, RBE2 add/delete, and final BDF export.

**Architecture:** StudioBasic shell (React 19 + Vite + Three.js + Zustand) extended with nastran_bridge JSON loading, 1D beam rendering (LineSegments), and an intent-based edit system. Backend adds two endpoints: viewer-zip (converts BDFs to JSON and zips) and apply-edit (applies intents and writes edited BDF). Electron routes the new `mooring:finalize-edit-request` channel in addition to the existing `modelflow` channel.

**Tech Stack:** React 19, Vite 8, Three.js r184, Zustand 5, FastAPI (Python), Electron 34, nastran_bridge.py

---

## File Map

**nastran_bridge.py** (`C:\Coding\WorkBenchSubModule\Nastran_bridge\nastran_bridge.py`)
- Add: `parse_spc1(fields)`, `parse_spc(fields)` helpers
- Modify: `convert_bdf()` — add SPC/SPC1 parsing → `spcs` array in output
- Modify: `apply_edit_json()` — add `deleteRigid` intent handler

**analysis.py** (`C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py`)
- Add: `GET /api/analysis/mooring-fitting/viewer-zip`
- Add: `POST /api/analysis/mooring-fitting/apply-edit`

**electron/index.js** (`C:\Coding\WorkBench\HiTessWorkBench\electron\index.js`)
- Modify: `viewer:finalizeEditedModel` handler — route to `mooring:finalize-edit-request` when `viewerCurrentId === 'mooring-fitting-studio'`
- Add: `ipcMain.on("mooring:finalize-edit-response", ...)` handler

**MooringFittingAssessment.jsx** (`C:\Coding\WorkBench\HiTessWorkBench\frontend\src\pages\analysis\MooringFittingAssessment.jsx`)
- Add: Studio state + `handleOpenStudio` + "Studio 열기" button (result section)
- Add: `ipcRenderer.on('mooring:finalize-edit-request', ...)` handler

**MooringFittingStudio** (new, `C:\Coding\WorkBenchSubModule\MooringFittingStudio\`)
- All files below are new unless noted
- `package.json` — name: mooring-fitting-studio, port 5177 (copy StudioBasic → modify)
- `vite.config.js` — id: mooring-fitting-studio, port 5177
- `index.html` — title: MooringFitting Studio
- `src/main.jsx` — entry (copy from StudioBasic unchanged)
- `src/index.css` — app shell styles (copy from StudioBasic, extend)
- `src/host/host.js` — ElectronHost + WebHost adapters
- `src/data/BdfStageData.js` — nastran_bridge JSON wrapper
- `src/store/useViewerStore.js` — viewports + layers + activeStageKey
- `src/store/useStageStore.js` — loads stage00.json / stage07.json
- `src/store/useEditStore.js` — simplified intent manager
- `src/utils/colors.js` — color constants
- `src/three/BeamMesh.js` — CBEAM/CBAR LineSegments
- `src/three/RigidMesh.js` — RBE2 spider LineSegments
- `src/three/SpcMarkers.js` — SPC node spheres
- `src/three/SceneBuilder.js` — assembles scene from BdfStageData
- `src/components/ThreeViewport.jsx` — Three.js canvas (adapted from StudioBasic)
- `src/components/Sidebar.jsx` — stage toggle + layer panel
- `src/components/InspectorPanel.jsx` — selected entity details
- `src/components/AddRigidDialog.jsx` — RBE2 add dialog
- `src/components/EditPanel.jsx` — group delete + RBE2 list
- `src/components/BottomReviewDock.jsx` — diagnostics table
- `src/App.jsx` — root layout

---

## Task 1: nastran_bridge.py — SPC parsing + deleteRigid intent

**Files:**
- Modify: `C:\Coding\WorkBenchSubModule\Nastran_bridge\nastran_bridge.py`

- [ ] **Step 1: Add `parse_spc1` and `parse_spc` helpers after `parse_rbe2`**

Find the `parse_rbe2` function (around line 280-320) and insert after it:

```python
def parse_spc(fields: list[str]) -> list[dict[str, Any]]:
    """SPC 카드 → [{nodeId, components}] 목록 반환 (한 카드에 node-pair 2개).

    SPC, G1, C1, D1, G2, C2, D2 (free-field or fixed)
    """
    results = []
    if len(fields) < 3:
        return results
    for i in range(0, 2):
        base = 2 + i * 3
        nid = as_int(fields[base] if len(fields) > base else None)
        comp = str(fields[base + 1]).strip() if len(fields) > base + 1 else ""
        if nid is not None and comp:
            results.append({"nodeId": nid, "components": comp})
    return results


def parse_spc1(fields: list[str]) -> list[dict[str, Any]]:
    """SPC1 카드 → [{nodeId, components}] 목록 반환.

    SPC1, SID, C, G1, G2, ... (나머지 모두 노드 ID)
    """
    if len(fields) < 4:
        return []
    comp = str(fields[2]).strip()
    results = []
    for raw in fields[3:]:
        nid = as_int(raw)
        if nid is not None:
            results.append({"nodeId": nid, "components": comp})
    return results
```

- [ ] **Step 2: Add SPC parsing loop in `convert_bdf` after the element/rigid parsing loop**

Inside `convert_bdf`, after the existing `for fields in records:` loop (the one parsing CBEAM, RBE2, etc.), add a new loop and update the return value:

```python
    spcs: list[dict[str, Any]] = []
    for fields in records:
        card = fields[0].upper()
        if card == "SPC1":
            spcs.extend(parse_spc1(fields))
        elif card == "SPC":
            spcs.extend(parse_spc(fields))
```

Then in the `return { ... }` dict at the end of `convert_bdf`, add the `spcs` entry between `pointMasses` and `connectivity`:

```python
        "pointMasses": sorted(point_masses, key=lambda item: item["id"]),
        "spcs": spcs,
        "connectivity": connectivity,
```

- [ ] **Step 3: Add `deleteRigid` intent in `apply_edit_json`**

Find the `elif kind == "addRigid":` block (around line 1583-1586) and add a new `elif` after it:

```python
        elif kind == "deleteRigid":
            rigid_id = as_int(params.get("rigidId"))
            if rigid_id is None:
                summary["skipped"] += 1
                continue
            rigids_list = base_data.get("rigids", [])
            before_count = len(rigids_list)
            base_data["rigids"] = [r for r in rigids_list if r.get("id") != rigid_id]
            if len(base_data["rigids"]) < before_count:
                summary["applied"] += 1
                summary["deleted"]["rigids"] += 1
            else:
                summary["skipped"] += 1
```

Also change the final `else` clause from `raise SystemExit` to a skip so unknown intents don't crash:

```python
        else:
            logger.warning("Unsupported edit intent kind (skipped): %s", kind)
            summary["skipped"] += 1
```

- [ ] **Step 4: Smoke-test the changes**

Run from `C:\Coding\WorkBenchSubModule\Nastran_bridge\`:

```powershell
python -c "
from pathlib import Path
from nastran_bridge import convert_bdf, apply_edit_json
data = convert_bdf(Path(r'C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection\20260527_141633_A476854_MooringFitting\out\STAGE_00_BuildRaw.bdf'))
print('spcs count:', len(data.get('spcs', [])))
print('rigids count:', len(data.get('rigids', [])))
# Test deleteRigid
edit = {'schemaVersion': '1.0', 'intents': [{'kind': 'deleteRigid', 'params': {'rigidId': data['rigids'][0]['id']}}]} if data.get('rigids') else {'schemaVersion': '1.0', 'intents': []}
import copy
result, summary = apply_edit_json(copy.deepcopy(data), edit)
print('deleteRigid summary:', summary)
"
```

Expected: `spcs count: <N>`, `rigids count: <M>`, `deleteRigid summary: {'applied': 1, ...}` (or `applied: 0` if no rigids)

---

## Task 2: Backend — viewer-zip endpoint

**Files:**
- Modify: `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py`

- [ ] **Step 1: Add nastran_bridge import at the top of analysis.py**

Find the existing import block near the top of analysis.py. Add after the existing service imports:

```python
import sys as _sys
_NASTRAN_BRIDGE_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "WorkBenchSubModule", "Nastran_bridge"))
if _NASTRAN_BRIDGE_DIR not in _sys.path:
    _sys.path.insert(0, _NASTRAN_BRIDGE_DIR)
try:
    import nastran_bridge as _nb
    _NB_AVAILABLE = True
except ImportError:
    _nb = None
    _NB_AVAILABLE = False
    logger.warning("[mooring-studio] nastran_bridge 임포트 실패 — viewer-zip 미사용 가능")
```

Check what `_BACKEND_DIR` is defined as in analysis.py:

```python
# already exists near top of analysis.py — verify:
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
```

- [ ] **Step 2: Add `viewer-zip` endpoint after the existing `/mooring-fitting/request` endpoint**

After the closing of `request_mooring_fitting` (around line 1150), add:

```python
@router.get("/analysis/mooring-fitting/viewer-zip")
def get_mooring_fitting_viewer_zip(
    output_dir: str = Query(..., description="MooringFitting out/ 폴더 절대경로 (userConnection 하위)"),
    current_user: str = Depends(require_auth),
):
    """out/ 폴더의 Stage_00/07 BDF 를 nastran_bridge 로 변환 후 zip 반환.

    StreamingResponse + BytesIO 조합은 h11 LocalProtocolError 를 유발하므로
    bytes 를 일괄 빌드한 뒤 Response 로 반환한다 (modelflow/result-zip 과 동일 패턴).
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        abs_dir = _validate_userconnection_path(output_dir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")

    if not os.path.isdir(abs_dir):
        raise HTTPException(status_code=404, detail=f"output_dir 없음: {abs_dir}")

    bdf_map = {
        "stage00.json": "STAGE_00_BuildRaw.bdf",
        "stage07.json": "STAGE_07_FinalValidation.bdf",
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for json_name, bdf_name in bdf_map.items():
            bdf_path = os.path.join(abs_dir, bdf_name)
            if not os.path.isfile(bdf_path):
                logger.warning("[mooring viewer-zip] BDF 없음, 스킵: %s", bdf_path)
                continue
            try:
                from pathlib import Path as _Path
                data = _nb.convert_bdf(_Path(bdf_path))
                zf.writestr(json_name, __import__("json").dumps(data, ensure_ascii=False))
                logger.info("[mooring viewer-zip] 변환 완료: %s → %s", bdf_name, json_name)
            except Exception as e:
                logger.exception("[mooring viewer-zip] BDF 변환 실패: %s", bdf_path)
                raise HTTPException(status_code=500, detail=f"BDF 변환 실패 ({bdf_name}): {e}")

    body = buf.getvalue()
    if not body:
        raise HTTPException(status_code=500, detail="zip 이 비어 있음 — BDF 파일을 확인하세요")

    fname = f"mooring-studio-{os.path.basename(os.path.dirname(abs_dir))}.zip"
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
```

Make sure `import zipfile` is already at the top of analysis.py (it should be — check with grep). Also ensure `import io` is present.

- [ ] **Step 3: Verify the imports exist**

```powershell
Select-String -Path "C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py" -Pattern "^import io$|^import zipfile$"
```

Expected: both lines found. If missing, add them with the other stdlib imports.

---

## Task 3: Backend — apply-edit endpoint

**Files:**
- Modify: `C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py`

- [ ] **Step 1: Add `apply-edit` endpoint after the `viewer-zip` endpoint**

```python
@router.post("/analysis/mooring-fitting/apply-edit")
async def apply_mooring_fitting_edit(
    request: Request,
    current_user: str = Depends(require_auth),
):
    """intents 를 stage07.json 에 적용해 수정된 BDF 를 저장한다.

    Body JSON: { folderPath: str, intents: list, stageRef?: str }
    """
    if not _NB_AVAILABLE:
        raise HTTPException(status_code=500, detail="nastran_bridge 모듈 없음")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON body 파싱 실패")

    folder_path = body.get("folderPath")
    intents = body.get("intents")
    if not folder_path or not isinstance(intents, list):
        raise HTTPException(status_code=400, detail="folderPath 와 intents 는 필수")

    try:
        abs_folder = _validate_userconnection_path(folder_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"경로 검증 실패: {e}")

    stage07_path = os.path.join(abs_folder, "stage07.json")
    if not os.path.isfile(stage07_path):
        raise HTTPException(status_code=404, detail=f"stage07.json 없음: {stage07_path}")

    import json as _json
    import copy as _copy
    from pathlib import Path as _Path

    try:
        base_data = _json.loads(_Path(stage07_path).read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"stage07.json 읽기 실패: {e}")

    edit_data = {
        "schemaVersion": "1.0",
        "intents": intents,
    }

    try:
        result_data, summary = _nb.apply_edit_json(_copy.deepcopy(base_data), edit_data)
    except Exception as e:
        logger.exception("[mooring apply-edit] apply_edit_json 실패")
        raise HTTPException(status_code=500, detail=f"편집 적용 실패: {e}")

    try:
        bdf_text = _nb.convert_json_to_bdf(result_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 변환 실패: {e}")

    output_bdf = os.path.join(abs_folder, "mooring_fitting_edited.bdf")
    try:
        _Path(output_bdf).write_text(bdf_text, encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BDF 저장 실패: {e}")

    logger.info("[mooring apply-edit] 완료: %s (applied=%d)", output_bdf, summary.get("applied", 0))
    return {"ok": True, "bdfPath": output_bdf, "summary": summary}
```

- [ ] **Step 2: Quick manual test (optional — verify no syntax errors)**

```powershell
python -c "import ast; ast.parse(open(r'C:\Coding\WorkBench\HiTessWorkBenchBackEnd\app\routers\analysis.py').read()); print('syntax ok')"
```

Expected: `syntax ok`

---

## Task 4: Electron — mooring:finalize-edit routing

**Files:**
- Modify: `C:\Coding\WorkBench\HiTessWorkBench\electron\index.js`

- [ ] **Step 1: Modify `viewer:finalizeEditedModel` to route based on viewerCurrentId**

Find the `ipcMain.handle("viewer:finalizeEditedModel", ...)` handler (around line 954). Inside the handler, find the line:

```js
      mainWindow.webContents.send("modelflow:finalize-edit-request", {
```

Replace that line (and the surrounding Promise+send block) so it routes to the correct channel:

```js
      const channel = viewerCurrentId === 'mooring-fitting-studio'
        ? 'mooring:finalize-edit-request'
        : 'modelflow:finalize-edit-request';

      mainWindow.webContents.send(channel, {
        requestId,
        folderPath: baseAbs,
        editFileName,
      });
```

- [ ] **Step 2: Add `mooring:finalize-edit-response` IPC handler**

After the existing `ipcMain.on("modelflow:finalize-edit-response", ...)` handler (around line 1005), add:

```js
// MooringFittingStudio finalize-edit 결과 채널 — modelflow 와 동일 _pendingFinalizeReqs 공유
ipcMain.on("mooring:finalize-edit-response", (_e, msg) => {
  const { requestId, ok, error } = msg || {};
  const resolve = _pendingFinalizeReqs.get(requestId);
  if (resolve) {
    _pendingFinalizeReqs.delete(requestId);
    resolve({ ok: !!ok, error: error || null });
  }
});
```

---

## Task 5: MooringFittingStudio — Project setup

**Files:**
- Create: `C:\Coding\WorkBenchSubModule\MooringFittingStudio\` (copy from StudioBasic)

- [ ] **Step 1: Copy StudioBasic source files to MooringFittingStudio**

```powershell
$src = "C:\Coding\WorkBenchSubModule\StudioBasic"
$dst = "C:\Coding\WorkBenchSubModule\MooringFittingStudio"

# Root files (no node_modules)
Copy-Item "$src\package.json"    "$dst\package.json"
Copy-Item "$src\vite.config.js"  "$dst\vite.config.js"
Copy-Item "$src\index.html"      "$dst\index.html"
Copy-Item "$src\eslint.config.js" "$dst\eslint.config.js"

# src/ tree
New-Item -ItemType Directory -Force "$dst\src\store" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\hooks" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\components" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\three" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\host" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\data" | Out-Null
New-Item -ItemType Directory -Force "$dst\src\utils" | Out-Null

Copy-Item "$src\src\main.jsx"      "$dst\src\main.jsx"
Copy-Item "$src\src\index.css"     "$dst\src\index.css"
Copy-Item "$src\src\hooks\useCameraSync.js" "$dst\src\hooks\useCameraSync.js"
Copy-Item "$src\src\three\baseScene.js" "$dst\src\three\baseScene.js"
```

- [ ] **Step 2: Update `package.json`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\package.json`:

```json
{
  "name": "mooring-fitting-studio",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "lucide-react": "^1.11.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "three": "^0.184.0",
    "zustand": "^5.0.12"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "eslint": "^10.2.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.5.0",
    "vite": "^8.0.10"
  }
}
```

- [ ] **Step 3: Update `vite.config.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))

const VIEWER_MANIFEST = {
  id: 'mooring-fitting-studio',
  name: 'MooringFittingStudio',
  version: pkg.version,
  entry: 'index.html',
  linkedMenu: 'MooringFittingStudio',
  minWorkbenchVersion: '2.0.0',
  description: 'MooringFitting BDF 뷰어 + 그룹 삭제 · RBE2 편집 · 최종 BDF 출력',
  hostApi: 'workbenchAPI@1',
}

function workbenchManifestPlugin(manifest) {
  return {
    name: 'workbench-manifest',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist')
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8',
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), workbenchManifestPlugin(VIEWER_MANIFEST)],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server:  { port: 5177, strictPort: true },
  preview: { port: 5177, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
```

- [ ] **Step 4: Update `index.html` title**

Edit `C:\Coding\WorkBenchSubModule\MooringFittingStudio\index.html` — change `<title>` from `StudioBasic` to `MooringFitting Studio`.

- [ ] **Step 5: npm install**

```powershell
cd C:\Coding\WorkBenchSubModule\MooringFittingStudio
npm install
```

Expected: `node_modules\` created, no errors.

---

## Task 6: host.js + BdfStageData.js

**Files:**
- Create: `src/host/host.js`
- Create: `src/data/BdfStageData.js`

- [ ] **Step 1: Write `src/host/host.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\host\host.js`:

```js
/**
 * host.js — Workbench 호스트 어댑터
 *
 * ElectronHost: window.workbenchAPI (Electron preload) 래핑
 * WebHost: 개발/테스트용 — 로컬 파일 API
 */

class ElectronHost {
  constructor(api) { this.api = api }

  /** 초기 폴더에서 JSON 파일 목록을 읽어 반환 */
  async getInitialFolder() {
    const fn = this.api.getInitialFolder
    if (typeof fn !== 'function') return { folderRef: null, files: [] }
    try {
      return (await fn.call(this.api)) ?? { folderRef: null, files: [] }
    } catch (e) {
      console.error('[ElectronHost] getInitialFolder error', e)
      return { folderRef: null, files: [] }
    }
  }

  /** folderRef 폴더에 fileName 파일을 content(string)로 쓴다 */
  async writeFile(folderRef, fileName, content) {
    if (!folderRef || !fileName) return { ok: false, error: 'folderRef / fileName 누락' }
    const fs = window.__electronFs
    if (!fs) return { ok: false, error: 'electronFs 미등록' }
    try {
      const filePath = `${folderRef}/${fileName}`.replace(/\\/g, '/')
      await fs.writeFile(filePath, content)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message }
    }
  }

  /** _edit.json 을 폴더에 쓴 뒤 Workbench 에 최종 편집 요청을 보낸다 */
  async finalizeEditedModel(folderRef, request) {
    const fn = this.api.finalizeEditedModel
    if (typeof fn !== 'function') return { ok: false, error: 'finalizeEditedModel 미등록' }
    try {
      return (await fn.call(this.api, folderRef, request)) ?? { ok: false, error: '응답 없음' }
    } catch (e) {
      return { ok: false, error: e?.message }
    }
  }
}

class WebHost {
  async getInitialFolder() { return { folderRef: null, files: [] } }
  async writeFile() { return { ok: false, error: 'WebHost: writeFile 미지원' } }
  async finalizeEditedModel() { return { ok: false, error: 'WebHost: finalize 미지원' } }
}

let _host = null

export function getHost() {
  if (_host) return _host
  const api = window.workbenchAPI
  _host = api ? new ElectronHost(api) : new WebHost()
  return _host
}
```

- [ ] **Step 2: Write `src/data/BdfStageData.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\data\BdfStageData.js`:

```js
import * as THREE from 'three'

/**
 * BdfStageData — nastran_bridge.convert_bdf() JSON 래퍼
 *
 * 좌표는 mm 단위 그대로 사용 (Three.js 씬 단위 = mm).
 * 노드 맵은 O(1) 조회를 위해 Map 으로 캐시한다.
 */
export class BdfStageData {
  constructor(json, sourceFileName = '') {
    this.json = json
    this.sourceFileName = sourceFileName
    this.meta = json.meta ?? {}
    this._nodesMap = new Map((json.nodes ?? []).map(n => [n.id, n]))
  }

  get nodes()    { return this.json.nodes    ?? [] }
  get elements() { return this.json.elements ?? [] }
  get rigids()   { return this.json.rigids   ?? [] }
  get spcs()     { return this.json.spcs     ?? [] }
  get properties()  { return this.json.properties  ?? [] }
  get materials()   { return this.json.materials   ?? [] }
  get connectivity(){ return this.json.connectivity ?? {} }
  get healthMetrics(){ return this.json.healthMetrics ?? {} }
  get diagnostics() { return this.json.diagnostics  ?? [] }

  /** 노드 ID → THREE.Vector3 (mm 단위). 없으면 null. */
  getNodePos(nodeId) {
    const n = this._nodesMap.get(nodeId)
    if (!n) return null
    return new THREE.Vector3(n.x, n.y, n.z)
  }

  /** 연결 그룹 목록 */
  get groups() {
    return this.connectivity.groups ?? []
  }
}

/**
 * JSON 파일 목록에서 stage00.json, stage07.json 을 찾아 BdfStageData 배열 반환.
 * @param {Array<{name: string, content: string}>} fileList
 * @returns {Array<{key: string, label: string, data: BdfStageData}>}
 */
export function loadStagesFromFiles(fileList) {
  const STAGE_MAP = {
    'stage00.json': { key: '00', label: 'Stage 00 — Raw Build' },
    'stage07.json': { key: '07', label: 'Stage 07 — Final Validation' },
  }
  const stages = []
  for (const { name, content } of fileList) {
    const lc = name.toLowerCase()
    const entry = Object.entries(STAGE_MAP).find(([k]) => lc.endsWith(k))
    if (!entry) continue
    try {
      const json = typeof content === 'string' ? JSON.parse(content) : content
      const [, { key, label }] = entry
      stages.push({ key, label, data: new BdfStageData(json, name) })
    } catch (e) {
      console.warn('[BdfStageData] parse error:', name, e)
    }
  }
  // 키 순서 정렬 (00 먼저)
  stages.sort((a, b) => a.key.localeCompare(b.key))
  return stages
}
```

---

## Task 7: Stores

**Files:**
- Modify: `src/store/useViewerStore.js`
- Create: `src/store/useStageStore.js`
- Create: `src/store/useEditStore.js`

- [ ] **Step 1: Rewrite `src/store/useViewerStore.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\store\useViewerStore.js`:

```js
import { create } from 'zustand'

let _nextId = 1

export const useViewerStore = create((set, get) => ({
  viewports: [{ id: _nextId++ }],
  layers: {
    beams:  true,
    rigids: true,
    spcs:   true,
    grid:   true,
  },
  cameraLinked: false,
  selectedEntity: null,
  // 현재 활성 Stage 키 ('00' | '07')
  activeStageKey: '07',

  addViewport: () => {
    if (get().viewports.length >= 4) return
    set(s => ({ viewports: [...s.viewports, { id: _nextId++ }] }))
  },
  removeViewport: (id) => {
    set(s => {
      if (s.viewports.length <= 1) return s
      return { viewports: s.viewports.filter(v => v.id !== id) }
    })
  },
  setActiveViewport: () => {},
  toggleLayer: (key) => set(s => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  toggleCameraLink: () => set(s => ({ cameraLinked: !s.cameraLinked })),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setActiveStageKey: (key) => set({ activeStageKey: key, selectedEntity: null }),
  reset: () => set({ viewports: [{ id: _nextId++ }], selectedEntity: null, activeStageKey: '07' }),
}))
```

- [ ] **Step 2: Write `src/store/useStageStore.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\store\useStageStore.js`:

```js
import { create } from 'zustand'
import { loadStagesFromFiles } from '../data/BdfStageData.js'

export const useStageStore = create((set) => ({
  // stages: Array<{key: '00'|'07', label: string, data: BdfStageData}>
  stages: [],
  loading: false,
  error: null,
  // 폴더에 대한 불투명 참조 (Electron: 절대경로 문자열)
  sourceFolderRef: null,

  setSourceFolderRef: (ref) => set({ sourceFolderRef: ref ?? null }),

  reset: () => set({ stages: [], loading: false, error: null, sourceFolderRef: null }),

  loadStages: async (fileList) => {
    set({ loading: true, error: null })
    try {
      const stages = loadStagesFromFiles(fileList)
      if (stages.length === 0) {
        set({ loading: false, error: 'stage00.json / stage07.json 파일을 찾을 수 없습니다.' })
        return
      }
      set({ stages, loading: false })
    } catch (err) {
      set({ loading: false, error: `로드 실패: ${err.message}` })
    }
  },

  /** key('00'|'07') 에 해당하는 BdfStageData 반환. 없으면 null. */
  getStage: (key) => {
    const entry = useStageStore.getState().stages.find(s => s.key === key)
    return entry?.data ?? null
  },
}))
```

- [ ] **Step 3: Write `src/store/useEditStore.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\store\useEditStore.js`:

```js
import { create } from 'zustand'
import { getHost } from '../host/host.js'
import { useStageStore } from './useStageStore.js'

let _intentSeq = 1

export const useEditStore = create((set, get) => ({
  enabled: false,
  // intents: Array<{id, kind, params, createdAt}>
  intents: [],
  selectedIntentId: null,
  // RBE2 추가 시 다중 선택 중인 노드 ID 목록
  pendingNodeSelection: [],
  // 최종 BDF 출력 진행 상태
  finalizeStatus: 'idle', // idle | running | done | error
  finalizeError: null,

  toggleEnabled: () => set(s => ({
    enabled: !s.enabled,
    pendingNodeSelection: [],
  })),

  addIntent: (kind, params) => {
    const intent = { id: _intentSeq++, kind, params, createdAt: Date.now() }
    set(s => ({ intents: [...s.intents, intent] }))
    return intent
  },

  removeIntent: (id) => set(s => ({
    intents: s.intents.filter(i => i.id !== id),
    selectedIntentId: s.selectedIntentId === id ? null : s.selectedIntentId,
  })),

  clearIntents: () => set({ intents: [], selectedIntentId: null }),
  selectIntent: (id) => set({ selectedIntentId: id }),

  toggleNodeSelection: (nodeId) => {
    if (nodeId == null) return
    set(s => {
      const has = s.pendingNodeSelection.includes(nodeId)
      return {
        pendingNodeSelection: has
          ? s.pendingNodeSelection.filter(id => id !== nodeId)
          : [...s.pendingNodeSelection, nodeId],
      }
    })
  },
  clearNodeSelection: () => set({ pendingNodeSelection: [] }),

  /**
   * intents 를 _edit.json 으로 저장하고 Workbench 에 최종 BDF 출력 요청.
   */
  finalizeAndExport: async () => {
    const { intents } = get()
    if (intents.length === 0) return { ok: false, error: '편집 내역이 없습니다.' }

    const folderRef = useStageStore.getState().sourceFolderRef
    if (!folderRef) return { ok: false, error: 'sourceFolderRef 없음 — Electron 에서 열었는지 확인' }

    set({ finalizeStatus: 'running', finalizeError: null })

    const editFileName = 'stage07_edit.json'
    const payload = {
      schemaVersion: '1.0',
      stageRef: 'stage07',
      intents: intents.map(({ kind, params }) => ({ kind, params })),
    }

    const writeResult = await getHost().writeFile(folderRef, editFileName, JSON.stringify(payload, null, 2))
    if (!writeResult.ok) {
      set({ finalizeStatus: 'error', finalizeError: writeResult.error })
      return { ok: false, error: writeResult.error }
    }

    const result = await getHost().finalizeEditedModel(folderRef, { editFileName })
    if (result?.ok) {
      set({ finalizeStatus: 'done' })
    } else {
      set({ finalizeStatus: 'error', finalizeError: result?.error ?? '알 수 없는 오류' })
    }
    return result ?? { ok: false, error: '응답 없음' }
  },

  reset: () => set({
    enabled: false, intents: [], selectedIntentId: null,
    pendingNodeSelection: [], finalizeStatus: 'idle', finalizeError: null,
  }),
}))
```

---

## Task 8: Three.js modules

**Files:**
- Create: `src/utils/colors.js`
- Create: `src/three/BeamMesh.js`
- Create: `src/three/RigidMesh.js`
- Create: `src/three/SpcMarkers.js`
- Create: `src/three/SceneBuilder.js`

- [ ] **Step 1: Write `src/utils/colors.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\utils\colors.js`:

```js
export const COLORS = {
  beam:      0x6ee7b7, // emerald-300
  rigid:     0xfbbf24, // amber-400
  spc:       0xf87171, // red-400
  selected:  0x38bdf8, // sky-400
  grid:      0x1e293b, // slate-800
}
```

- [ ] **Step 2: Write `src/three/BeamMesh.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\three\BeamMesh.js`:

```js
import * as THREE from 'three'
import { COLORS } from '../utils/colors.js'

/**
 * buildBeamMesh — CBEAM/CBAR/CROD 요소를 LineSegments 로 렌더링.
 *
 * @param {import('../data/BdfStageData.js').BdfStageData} stageData
 * @returns {{ mesh: THREE.LineSegments, pickables: THREE.Object3D[] }}
 */
export function buildBeamMesh(stageData) {
  const positions = []
  const pickables = []

  for (const el of stageData.elements) {
    const a = stageData.getNodePos(el.startNode)
    const b = stageData.getNodePos(el.endNode)
    if (!a || !b) continue
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({ color: COLORS.beam, linewidth: 1 })
  const mesh = new THREE.LineSegments(geo, mat)
  mesh.userData.layerKey = 'beams'

  // 각 요소를 개별 피킹 가능 객체로 추가 (LineSegments 는 전체가 하나라 여기서는 생략)
  // Phase 1 에서는 그룹 삭제가 주 편집이므로 요소 단위 피킹 대신 그룹 단위 UI 사용

  return { mesh, pickables }
}
```

- [ ] **Step 3: Write `src/three/RigidMesh.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\three\RigidMesh.js`:

```js
import * as THREE from 'three'
import { COLORS } from '../utils/colors.js'

/**
 * buildRigidMesh — RBE2 스파이더를 LineSegments 로 렌더링.
 * 각 RBE2 마다 독립된 Group child 로 생성해 삭제 intent 반영 시 교체 가능.
 *
 * @param {import('../data/BdfStageData.js').BdfStageData} stageData
 * @returns {{ group: THREE.Group, pickables: THREE.Object3D[] }}
 */
export function buildRigidMesh(stageData) {
  const group = new THREE.Group()
  group.userData.layerKey = 'rigids'
  const pickables = []
  const mat = new THREE.LineBasicMaterial({ color: COLORS.rigid, linewidth: 1 })

  for (const rigid of stageData.rigids) {
    const indPos = stageData.getNodePos(rigid.independentNode)
    if (!indPos) continue

    const positions = []
    for (const depId of (rigid.dependentNodes ?? [])) {
      const depPos = stageData.getNodePos(depId)
      if (!depPos) continue
      positions.push(indPos.x, indPos.y, indPos.z, depPos.x, depPos.y, depPos.z)
    }
    if (positions.length === 0) continue

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const mesh = new THREE.LineSegments(geo, mat)
    mesh.userData.entity = { type: 'rigid', id: rigid.id, data: rigid }
    group.add(mesh)
    pickables.push(mesh)
  }

  return { group, pickables }
}
```

- [ ] **Step 4: Write `src/three/SpcMarkers.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\three\SpcMarkers.js`:

```js
import * as THREE from 'three'
import { COLORS } from '../utils/colors.js'

const SPC_SPHERE_RADIUS = 50 // mm

/**
 * buildSpcMarkers — SPC 구속 노드를 구(sphere) 마커로 렌더링.
 *
 * @param {import('../data/BdfStageData.js').BdfStageData} stageData
 * @returns {{ group: THREE.Group, pickables: THREE.Object3D[] }}
 */
export function buildSpcMarkers(stageData) {
  const group = new THREE.Group()
  group.userData.layerKey = 'spcs'
  const pickables = []

  const geo = new THREE.SphereGeometry(SPC_SPHERE_RADIUS, 10, 8)
  const mat = new THREE.MeshPhongMaterial({ color: COLORS.spc, shininess: 40 })

  // 중복 노드 제거 (SPC1 에서 같은 노드가 여러 번 나올 수 있음)
  const seen = new Set()
  for (const spc of stageData.spcs) {
    if (seen.has(spc.nodeId)) continue
    seen.add(spc.nodeId)
    const pos = stageData.getNodePos(spc.nodeId)
    if (!pos) continue

    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(pos)
    mesh.userData.entity = { type: 'spc', id: spc.nodeId, data: spc }
    group.add(mesh)
    pickables.push(mesh)
  }

  return { group, pickables }
}
```

- [ ] **Step 5: Write `src/three/SceneBuilder.js`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\three\SceneBuilder.js`:

```js
import * as THREE from 'three'
import { COLORS } from '../utils/colors.js'
import { buildBeamMesh } from './BeamMesh.js'
import { buildRigidMesh } from './RigidMesh.js'
import { buildSpcMarkers } from './SpcMarkers.js'

const GRID_SIZE  = 50000
const GRID_DIVS  = 20

/**
 * buildScene — BdfStageData 에서 Three.js 씬 트리를 조립한다.
 *
 * @param {import('../data/BdfStageData.js').BdfStageData|null} stageData
 * @returns {{
 *   root:     THREE.Group,
 *   layers:   Record<string, THREE.Object3D>,
 *   pickables: THREE.Object3D[],
 *   bounds:   THREE.Box3,
 * }}
 */
export function buildScene(stageData) {
  const root = new THREE.Group()
  const layers = {}
  const pickables = []

  if (stageData) {
    const { mesh: beamMesh } = buildBeamMesh(stageData)
    layers.beams = beamMesh
    root.add(beamMesh)

    const { group: rigidGroup, pickables: rigidPick } = buildRigidMesh(stageData)
    layers.rigids = rigidGroup
    root.add(rigidGroup)
    pickables.push(...rigidPick)

    const { group: spcGroup, pickables: spcPick } = buildSpcMarkers(stageData)
    layers.spcs = spcGroup
    root.add(spcGroup)
    pickables.push(...spcPick)
  }

  // Grid (XY 평면, Z = 0)
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, COLORS.grid, COLORS.grid)
  grid.rotation.x = Math.PI / 2
  layers.grid = grid
  root.add(grid)

  // Bounding box 계산
  const bounds = new THREE.Box3()
  if (stageData && stageData.elements.length > 0) {
    bounds.setFromObject(layers.beams)
  } else {
    bounds.set(
      new THREE.Vector3(-GRID_SIZE / 2, -GRID_SIZE / 2, 0),
      new THREE.Vector3( GRID_SIZE / 2,  GRID_SIZE / 2, GRID_SIZE / 4),
    )
  }

  return { root, layers, pickables, bounds }
}
```

---

## Task 9: Components

**Files:**
- Modify: `src/components/ThreeViewport.jsx`
- Create: `src/components/Sidebar.jsx`
- Create: `src/components/InspectorPanel.jsx`
- Create: `src/components/AddRigidDialog.jsx`
- Create: `src/components/EditPanel.jsx`
- Create: `src/components/BottomReviewDock.jsx`

- [ ] **Step 1: Rewrite `src/components/ThreeViewport.jsx`**

The existing ThreeViewport.jsx uses `buildBaseScene()` (StudioBasic placeholder). Replace the entire file with a stage-aware version.

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\ThreeViewport.jsx`:

```jsx
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'
import { buildScene } from '../three/SceneBuilder.js'
import { COLORS } from '../utils/colors.js'
import { useViewerStore } from '../store/useViewerStore.js'

const DRAG_THRESHOLD = 3
const DAMPING_TAIL_MS = 700

export default function ThreeViewport({ stageData, onPick, onReady, onDispose }) {
  const containerRef = useRef(null)
  const rendererRef  = useRef(null)
  const sceneRef     = useRef(null)
  const cameraRef    = useRef(null)
  const controlsRef  = useRef(null)
  const sceneDataRef = useRef(null) // { root, layers, pickables, bounds }
  const animFrameRef = useRef(null)
  const pointerRef   = useRef(null)
  const fitSavedRef  = useRef(null)
  const raycaster    = useRef(new THREE.Raycaster())

  const layers      = useViewerStore(s => s.layers)
  const selected    = useViewerStore(s => s.selectedEntity)
  const prevSelRef  = useRef(null)

  const render = useCallback(() => {
    const r = rendererRef.current; const s = sceneRef.current; const c = cameraRef.current
    if (!r || !s || !c || !r.domElement.isConnected) return
    r.render(s, c)
  }, [])

  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) return
    animFrameRef.current = requestAnimationFrame(() => { animFrameRef.current = null; render() })
  }, [render])

  const fitView = useCallback(() => {
    const camera = cameraRef.current; const controls = controlsRef.current
    const sd = sceneDataRef.current
    if (!camera || !controls || !sd) return
    const sphere = new THREE.Sphere()
    sd.bounds.getBoundingSphere(sphere)
    const radius = Math.max(sphere.radius, 100)
    const dist   = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2
    controls.target.copy(sphere.center)
    camera.up.set(0, 0, 1)
    camera.position.copy(sphere.center).add(new THREE.Vector3(dist * 0.6, -dist * 0.8, dist * 0.5))
    camera.near = Math.max(1, radius * 0.005)
    camera.far  = Math.max(10000, radius * 100)
    camera.updateProjectionMatrix()
    controls.update()
    fitSavedRef.current = {
      position: camera.position.clone(),
      target:   controls.target.clone(),
      up:       camera.up.clone(),
    }
    scheduleRender()
  }, [scheduleRender])

  // Three.js 초기화 (마운트 시 1회)
  useEffect(() => {
    const el = containerRef.current; if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x0d1117, 1)
    el.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x203040, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 0.7)
    key.position.set(2, -3, 5)
    scene.add(key)

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 1, 1e7)
    cameraRef.current = camera

    const controls = new TrackballControls(camera, renderer.domElement)
    controls.rotateSpeed = 1.5; controls.zoomSpeed = 0.75; controls.panSpeed = 0.35
    controls.staticMoving = false; controls.dynamicDampingFactor = 0.2
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controlsRef.current = controls

    let active = false; let endedAt = 0
    const loop = () => {
      controls.update(); render()
      if (active || Date.now() - endedAt < DAMPING_TAIL_MS) {
        animFrameRef.current = requestAnimationFrame(loop)
      } else { animFrameRef.current = null }
    }
    controls.addEventListener('start', () => { active = true; if (!animFrameRef.current) animFrameRef.current = requestAnimationFrame(loop) })
    controls.addEventListener('end',   () => { active = false; endedAt = Date.now() })

    const ro = new ResizeObserver(() => {
      const w = Math.max(1, el.clientWidth); const h = Math.max(1, el.clientHeight)
      renderer.setSize(w, h); camera.aspect = w / h
      camera.updateProjectionMatrix(); controls.handleResize(); scheduleRender()
    })
    ro.observe(el)

    const onDown = e => { pointerRef.current = { x: e.clientX, y: e.clientY } }
    const onUp   = e => {
      const s = pointerRef.current; pointerRef.current = null; if (!s) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_THRESHOLD) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc  = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(ndc, camera)
      const sd = sceneDataRef.current
      if (!sd) return
      const hits = raycaster.current.intersectObjects(sd.pickables, true)
      const entity = hits.find(h => h.object.userData?.entity)?.object.userData.entity ?? null
      onPick?.(entity)
    }
    const onKey = e => {
      if (!el.matches(':hover')) return
      if (e.key.toLowerCase() === 'f') fitView()
      else if (e.key.toLowerCase() === 'r' && fitSavedRef.current) {
        const { position, target, up } = fitSavedRef.current
        camera.position.copy(position); camera.up.copy(up)
        controls.target.copy(target); controls.update(); scheduleRender()
      }
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)

    onReady?.({ camera, controls, requestRender: scheduleRender, fitView })

    return () => {
      onDispose?.()
      window.removeEventListener('keydown', onKey)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      ro.disconnect(); controls.dispose()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      renderer.dispose(); renderer.domElement.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // stageData 변경 시 씬 재빌드
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    if (sceneDataRef.current) {
      scene.remove(sceneDataRef.current.root)
      sceneDataRef.current.root.traverse(o => {
        o.geometry?.dispose?.()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.())
      })
    }
    const sd = buildScene(stageData ?? null)
    scene.add(sd.root)
    sceneDataRef.current = sd
    fitView()
  }, [stageData, fitView])

  // 레이어 가시성
  useEffect(() => {
    const sd = sceneDataRef.current; if (!sd) return
    Object.entries(layers).forEach(([key, vis]) => {
      if (sd.layers[key]) sd.layers[key].visible = vis
    })
    scheduleRender()
  }, [layers, scheduleRender])

  // 선택 하이라이트
  useEffect(() => {
    if (prevSelRef.current) {
      prevSelRef.current.material.emissive?.setHex(0x000000)
      prevSelRef.current = null
    }
    const sd = sceneDataRef.current; if (!sd || !selected) { scheduleRender(); return }
    const match = sd.pickables.find(o => o.userData.entity?.id === selected.id)
    if (match?.material?.emissive) {
      match.material.emissive.setHex(COLORS.selected)
      prevSelRef.current = match
    }
    scheduleRender()
  }, [selected, scheduleRender])

  return <div ref={containerRef} className="three-viewport" />
}
```

- [ ] **Step 2: Write `src/components/Sidebar.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\Sidebar.jsx`:

```jsx
import { Layers, SquareSplitHorizontal } from 'lucide-react'
import { useViewerStore } from '../store/useViewerStore.js'
import { useStageStore } from '../store/useStageStore.js'

const LAYER_LABELS = {
  beams:  'CBEAM / CBAR',
  rigids: 'RBE2 (Rigid)',
  spcs:   'SPC 노드',
  grid:   'Grid',
}

export default function Sidebar() {
  const { layers, toggleLayer, activeStageKey, setActiveStageKey } = useViewerStore()
  const stages = useStageStore(s => s.stages)

  return (
    <aside className="sidebar">
      <div className="brand">
        <SquareSplitHorizontal size={18} />
        <div>
          <strong>MooringFitting</strong>
          <span>BDF Studio</span>
        </div>
      </div>

      {stages.length > 0 && (
        <section className="panel-section">
          <div className="section-title"><span>Stage</span></div>
          <div className="stage-toggle">
            {stages.map(s => (
              <button
                key={s.key}
                type="button"
                className={`stage-btn ${activeStageKey === s.key ? 'active' : ''}`}
                onClick={() => setActiveStageKey(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel-section">
        <div className="section-title"><Layers size={14} /><span>Layers</span></div>
        {Object.entries(LAYER_LABELS).map(([key, label]) => (
          <label key={key} className="toggle-row">
            <input type="checkbox" checked={!!layers[key]} onChange={() => toggleLayer(key)} />
            <span>{label}</span>
          </label>
        ))}
      </section>
    </aside>
  )
}
```

- [ ] **Step 3: Write `src/components/InspectorPanel.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\InspectorPanel.jsx`:

```jsx
import { useViewerStore } from '../store/useViewerStore.js'

export default function InspectorPanel() {
  const entity = useViewerStore(s => s.selectedEntity)
  if (!entity) return null

  const data = entity.data ?? {}

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <span className="inspector-type">{entity.type.toUpperCase()}</span>
        <span className="inspector-id">ID {entity.id}</span>
      </div>
      <table className="inspector-table">
        <tbody>
          {Object.entries(data).map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{Array.isArray(v) ? v.join(', ') : String(v ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Write `src/components/AddRigidDialog.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\AddRigidDialog.jsx`:

```jsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { useEditStore } from '../store/useEditStore.js'

export default function AddRigidDialog({ onClose }) {
  const { addIntent, pendingNodeSelection, clearNodeSelection } = useEditStore()
  const [indNode, setIndNode]     = useState('')
  const [depNodes, setDepNodes]   = useState('')
  const [cm, setCm]               = useState('123456')
  const [error, setError]         = useState('')

  const handleAdd = () => {
    setError('')
    const indId = parseInt(indNode, 10)
    if (!indId) { setError('독립 노드 ID를 입력하세요.'); return }

    const rawDep = depNodes.trim() || pendingNodeSelection.join(' ')
    const depIds = rawDep.split(/[\s,]+/).map(s => parseInt(s, 10)).filter(Boolean)
    if (depIds.length === 0) { setError('종속 노드 ID를 입력하세요.'); return }

    addIntent('addRigid', { independentNode: indId, dependentNodes: depIds, cm: cm || '123456' })
    clearNodeSelection()
    onClose?.()
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog-box">
        <div className="dialog-header">
          <span>RBE2 추가</span>
          <button type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <label>독립 노드 ID (GRID)
            <input type="number" value={indNode} onChange={e => setIndNode(e.target.value)} placeholder="예) 1001" />
          </label>
          <label>종속 노드 ID 목록 (공백 또는 쉼표 구분)
            <input type="text" value={depNodes || pendingNodeSelection.join(' ')}
              onChange={e => setDepNodes(e.target.value)}
              placeholder={pendingNodeSelection.length > 0 ? `선택됨: ${pendingNodeSelection.join(', ')}` : '예) 1002 1003 1004'} />
          </label>
          <label>구속 자유도 (CM)
            <input type="text" value={cm} onChange={e => setCm(e.target.value)} placeholder="123456" />
          </label>
          {error && <p className="dialog-error">{error}</p>}
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary" onClick={handleAdd}>추가</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/components/EditPanel.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\EditPanel.jsx`:

```jsx
import { useState } from 'react'
import { Edit2, Trash2, Plus, Download, X } from 'lucide-react'
import { useEditStore } from '../store/useEditStore.js'
import { useStageStore } from '../store/useStageStore.js'
import AddRigidDialog from './AddRigidDialog.jsx'

export default function EditPanel() {
  const { enabled, intents, toggleEnabled, removeIntent, clearIntents, finalizeAndExport, finalizeStatus, finalizeError } = useEditStore()
  const stage07 = useStageStore(s => s.getStage('07'))
  const [showAddRigid, setShowAddRigid]   = useState(false)
  const [finalizeMsg, setFinalizeMsg] = useState('')

  const groups = stage07?.groups ?? []

  const handleDeleteGroup = (groupId) => {
    if (intents.some(i => i.kind === 'deleteGroup' && i.params.groupId === groupId)) return
    useEditStore.getState().addIntent('deleteGroup', { groupId })
  }

  const handleDeleteRigid = (rigidId) => {
    useEditStore.getState().addIntent('deleteRigid', { rigidId: rigidId })
  }

  const handleFinalize = async () => {
    setFinalizeMsg('')
    const result = await finalizeAndExport()
    setFinalizeMsg(result.ok ? '✅ BDF 출력 완료' : `❌ ${result.error}`)
  }

  if (!enabled) {
    return (
      <div className="edit-panel">
        <button type="button" className="btn-edit-toggle" onClick={toggleEnabled}>
          <Edit2 size={14} /> 편집 모드 켜기
        </button>
      </div>
    )
  }

  return (
    <div className="edit-panel edit-panel--active">
      <div className="edit-panel-header">
        <span>편집 모드</span>
        <button type="button" onClick={toggleEnabled} title="편집 모드 끄기"><X size={14} /></button>
      </div>

      {/* 그룹 삭제 */}
      <section className="edit-section">
        <div className="edit-section-title">그룹 삭제</div>
        <div className="group-list">
          {groups.length === 0 && <p className="empty">그룹 정보 없음</p>}
          {groups.map(g => {
            const alreadyDeleted = intents.some(i => i.kind === 'deleteGroup' && i.params.groupId === g.groupId)
            return (
              <div key={g.groupId} className={`group-item ${alreadyDeleted ? 'deleted' : ''}`}>
                <span>그룹 {g.groupId} ({g.elementCount ?? '?'}개 요소)</span>
                <button type="button" disabled={alreadyDeleted} onClick={() => handleDeleteGroup(g.groupId)}>
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* RBE2 편집 */}
      <section className="edit-section">
        <div className="edit-section-title">
          RBE2
          <button type="button" className="btn-icon" onClick={() => setShowAddRigid(true)}>
            <Plus size={13} /> 추가
          </button>
        </div>
        {stage07 && stage07.rigids.map(r => {
          const alreadyDeleted = intents.some(i => i.kind === 'deleteRigid' && i.params.rigidId === r.id)
          return (
            <div key={r.id} className={`group-item ${alreadyDeleted ? 'deleted' : ''}`}>
              <span>RBE2 {r.id} (ind: {r.independentNode})</span>
              <button type="button" disabled={alreadyDeleted} onClick={() => handleDeleteRigid(r.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
      </section>

      {/* Intent 목록 */}
      {intents.length > 0 && (
        <section className="edit-section">
          <div className="edit-section-title">
            적용 예정 ({intents.length}건)
            <button type="button" className="btn-icon danger" onClick={clearIntents}>전체 취소</button>
          </div>
          {intents.map(intent => (
            <div key={intent.id} className="intent-item">
              <span className={`intent-kind ${intent.kind}`}>{intent.kind}</span>
              <span className="intent-params">{JSON.stringify(intent.params)}</span>
              <button type="button" onClick={() => removeIntent(intent.id)}><X size={12} /></button>
            </div>
          ))}
        </section>
      )}

      {/* 최종 BDF 출력 */}
      <div className="edit-finalize">
        <button
          type="button"
          className="btn-finalize"
          disabled={intents.length === 0 || finalizeStatus === 'running'}
          onClick={handleFinalize}
        >
          <Download size={14} />
          {finalizeStatus === 'running' ? '처리 중...' : '최종 BDF 출력'}
        </button>
        {finalizeMsg && <p className="finalize-msg">{finalizeMsg}</p>}
        {finalizeError && <p className="finalize-error">{finalizeError}</p>}
      </div>

      {showAddRigid && <AddRigidDialog onClose={() => setShowAddRigid(false)} />}
    </div>
  )
}
```

- [ ] **Step 6: Write `src/components/BottomReviewDock.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\components\BottomReviewDock.jsx`:

```jsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, Info } from 'lucide-react'
import { useStageStore } from '../store/useStageStore.js'
import { useViewerStore } from '../store/useViewerStore.js'

const SEVERITY_ICON = {
  error:   <AlertTriangle size={13} className="sev-error" />,
  warning: <AlertTriangle size={13} className="sev-warning" />,
  info:    <Info size={13} className="sev-info" />,
}

export default function BottomReviewDock() {
  const [open, setOpen] = useState(false)
  const activeKey = useViewerStore(s => s.activeStageKey)
  const getStage  = useStageStore(s => s.getStage)
  const stage     = getStage(activeKey)
  const diags     = stage?.diagnostics ?? []
  const metrics   = stage?.healthMetrics ?? {}

  return (
    <div className={`bottom-dock ${open ? 'open' : ''}`}>
      <button type="button" className="dock-toggle" onClick={() => setOpen(v => !v)}>
        <span>진단 ({diags.length}건)</span>
        {metrics.totals && (
          <span className="dock-summary">
            노드 {metrics.totals.nodes ?? 0} · 요소 {metrics.totals.elements ?? 0} · RBE2 {metrics.totals.rigids ?? 0}
          </span>
        )}
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <div className="dock-body">
          {diags.length === 0 && <p className="dock-empty">진단 항목 없음</p>}
          <table className="diag-table">
            <thead>
              <tr><th>등급</th><th>코드</th><th>메시지</th></tr>
            </thead>
            <tbody>
              {diags.map((d, i) => (
                <tr key={i}>
                  <td>{SEVERITY_ICON[d.severity] ?? d.severity}</td>
                  <td>{d.code}</td>
                  <td>{d.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

---

## Task 10: App.jsx + CSS

**Files:**
- Rewrite: `src/App.jsx`
- Extend: `src/index.css`

- [ ] **Step 1: Rewrite `src/App.jsx`**

Write `C:\Coding\WorkBenchSubModule\MooringFittingStudio\src\App.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { getHost } from './host/host.js'
import { useStageStore } from './store/useStageStore.js'
import { useViewerStore } from './store/useViewerStore.js'
import useCameraSync from './hooks/useCameraSync.js'
import ThreeViewport from './components/ThreeViewport.jsx'
import Sidebar from './components/Sidebar.jsx'
import InspectorPanel from './components/InspectorPanel.jsx'
import EditPanel from './components/EditPanel.jsx'
import BottomReviewDock from './components/BottomReviewDock.jsx'

export default function App() {
  const viewportApiRefs = useRef({})
  const { viewports, cameraLinked, selectedEntity, addViewport, setSelectedEntity } = useViewerStore()
  const { activeStageKey } = useViewerStore()
  const { loadStages, setSourceFolderRef, loading, error, getStage } = useStageStore()

  useCameraSync(viewportApiRefs, cameraLinked, viewports)

  useEffect(() => {
    const host = getHost()
    host.getInitialFolder().then(({ folderRef, files }) => {
      if (folderRef) setSourceFolderRef(folderRef)
      if (files?.length > 0) loadStages(files)
    })
  }, [loadStages, setSourceFolderRef])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedEntity(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedEntity])

  const activeStageData = getStage(activeStageKey)

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="viewport-area">
        {loading && <div className="loading-overlay">BDF 변환 중...</div>}
        {error   && <div className="error-overlay">{error}</div>}

        <div className="viewport-grid" data-count={viewports.length}>
          {viewports.map((vp) => (
            <section key={vp.id} className="viewport-cell">
              <ThreeViewport
                stageData={activeStageData}
                onPick={setSelectedEntity}
                onReady={(api) => { viewportApiRefs.current[vp.id] = api }}
                onDispose={() => { delete viewportApiRefs.current[vp.id] }}
              />
            </section>
          ))}
        </div>

        <InspectorPanel />
        <BottomReviewDock />
      </main>

      <EditPanel />
    </div>
  )
}
```

- [ ] **Step 2: Extend `src/index.css` with new selectors**

Append the following styles to the existing `index.css` (keep all existing StudioBasic styles):

```css
/* ── MooringFittingStudio additions ── */

.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #0d1117;
  color: #e2e8f0;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}

.sidebar {
  width: 220px;
  min-width: 180px;
  background: #111827;
  border-right: 1px solid #1e293b;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
}

.brand { display: flex; align-items: center; gap: 8px; padding: 8px 4px 12px; border-bottom: 1px solid #1e293b; }
.brand strong { font-size: 14px; font-weight: 700; color: #6ee7b7; display: block; }
.brand span   { font-size: 11px; color: #64748b; }

.panel-section { margin-top: 8px; }
.section-title { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 4px 6px; }
.toggle-row { display: flex; align-items: center; gap: 6px; padding: 4px 4px; cursor: pointer; border-radius: 4px; }
.toggle-row:hover { background: #1e293b; }

.stage-toggle { display: flex; flex-direction: column; gap: 4px; }
.stage-btn { width: 100%; text-align: left; padding: 6px 8px; border-radius: 6px; border: 1px solid #1e293b; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; }
.stage-btn.active { background: #064e3b; border-color: #6ee7b7; color: #6ee7b7; font-weight: 600; }

.viewport-area { flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.viewport-grid { flex: 1; display: grid; }
.viewport-grid[data-count="1"] { grid-template-columns: 1fr; }
.viewport-grid[data-count="2"] { grid-template-columns: 1fr 1fr; }
.viewport-grid[data-count="3"] { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.viewport-grid[data-count="4"] { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.viewport-cell { position: relative; overflow: hidden; }
.three-viewport { width: 100%; height: 100%; }

.loading-overlay, .error-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(13,17,23,0.8); z-index: 10; font-size: 14px;
}
.error-overlay { color: #f87171; }

/* Inspector */
.inspector-panel { position: absolute; top: 8px; right: 8px; width: 260px; background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; z-index: 20; }
.inspector-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.inspector-type { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #fbbf24; }
.inspector-id { font-size: 10px; color: #64748b; }
.inspector-table { width: 100%; font-size: 11px; border-collapse: collapse; }
.inspector-table td { padding: 2px 4px; border-bottom: 1px solid #1e293b; }
.inspector-table td:first-child { color: #94a3b8; width: 40%; }

/* Edit Panel */
.edit-panel { width: 240px; min-width: 200px; background: #111827; border-left: 1px solid #1e293b; padding: 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.edit-panel--active { border-left-color: #6ee7b7; }
.edit-panel-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 12px; color: #6ee7b7; padding-bottom: 6px; border-bottom: 1px solid #1e293b; }
.btn-edit-toggle { width: 100%; padding: 8px; background: #1e293b; border: 1px dashed #334155; border-radius: 6px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; }
.btn-edit-toggle:hover { background: #0f172a; color: #6ee7b7; }

.edit-section { margin-top: 8px; }
.edit-section-title { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 2px 0 6px; display: flex; justify-content: space-between; align-items: center; }
.btn-icon { background: transparent; border: none; color: #6ee7b7; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 2px; padding: 2px 4px; border-radius: 4px; }
.btn-icon:hover { background: #1e293b; }
.btn-icon.danger { color: #f87171; }

.group-item { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-radius: 4px; font-size: 11px; }
.group-item:hover { background: #1e293b; }
.group-item.deleted { opacity: 0.4; text-decoration: line-through; }
.group-item button { background: transparent; border: none; color: #f87171; cursor: pointer; padding: 2px; border-radius: 3px; }
.group-item button:disabled { opacity: 0.3; cursor: default; }

.intent-item { display: flex; gap: 4px; align-items: center; padding: 3px 6px; background: #0f172a; border-radius: 4px; margin-bottom: 2px; font-size: 10px; }
.intent-kind { font-weight: 700; color: #fbbf24; min-width: 70px; }
.intent-params { flex: 1; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.intent-item button { background: transparent; border: none; color: #475569; cursor: pointer; }

.edit-finalize { margin-top: 12px; }
.btn-finalize { width: 100%; padding: 8px; background: #064e3b; border: 1px solid #6ee7b7; border-radius: 6px; color: #6ee7b7; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; }
.btn-finalize:hover:not(:disabled) { background: #065f46; }
.btn-finalize:disabled { opacity: 0.4; cursor: default; }
.finalize-msg   { font-size: 11px; color: #6ee7b7; margin-top: 4px; }
.finalize-error { font-size: 11px; color: #f87171; margin-top: 4px; }

/* Bottom Dock */
.bottom-dock { position: absolute; bottom: 0; left: 0; right: 240px; background: #0f172a; border-top: 1px solid #1e293b; z-index: 15; }
.dock-toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 11px; }
.dock-toggle:hover { background: #1e293b; }
.dock-summary { flex: 1; text-align: right; color: #475569; }
.dock-body { max-height: 180px; overflow-y: auto; padding: 4px 0; }
.dock-empty { text-align: center; padding: 12px; color: #475569; font-size: 12px; }
.diag-table { width: 100%; font-size: 11px; border-collapse: collapse; }
.diag-table th, .diag-table td { padding: 3px 10px; border-bottom: 1px solid #1e293b; text-align: left; }
.diag-table th { color: #475569; font-weight: 600; }
.sev-error { color: #f87171; } .sev-warning { color: #fbbf24; } .sev-info { color: #38bdf8; }

/* Dialog */
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: flex; align-items: center; justify-content: center; }
.dialog-box { background: #111827; border: 1px solid #1e293b; border-radius: 10px; width: 360px; overflow: hidden; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #0f172a; border-bottom: 1px solid #1e293b; font-weight: 600; font-size: 13px; }
.dialog-header button { background: transparent; border: none; color: #64748b; cursor: pointer; }
.dialog-body { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.dialog-body label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #94a3b8; }
.dialog-body input { padding: 6px 8px; background: #1e293b; border: 1px solid #334155; border-radius: 5px; color: #e2e8f0; font-size: 12px; outline: none; }
.dialog-body input:focus { border-color: #6ee7b7; }
.dialog-error { color: #f87171; font-size: 11px; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #1e293b; }
.btn-primary   { padding: 6px 16px; background: #059669; border: none; border-radius: 5px; color: #fff; cursor: pointer; font-size: 12px; font-weight: 600; }
.btn-secondary { padding: 6px 16px; background: #1e293b; border: 1px solid #334155; border-radius: 5px; color: #94a3b8; cursor: pointer; font-size: 12px; }
.btn-primary:hover   { background: #047857; }
.btn-secondary:hover { background: #0f172a; }
.empty { color: #475569; font-size: 11px; padding: 4px; }
```

---

## Task 11: WorkBench frontend — MooringFittingAssessment.jsx Studio button

**Files:**
- Modify: `C:\Coding\WorkBench\HiTessWorkBench\frontend\src\pages\analysis\MooringFittingAssessment.jsx`

- [ ] **Step 1: Add viewer constants and state near the top of the component function**

Find the `MooringFittingAssessment` function body (around line 803 where `useState` hooks are). Add after the existing state declarations:

```js
const STUDIO_VIEWER_ID = 'mooring-fitting-studio'

const [studioStatus,    setStudioStatus]    = useState('idle')   // idle|checking|installing|opening|error
const [studioInstalled, setStudioInstalled] = useState(null)
const [studioProgress,  setStudioProgress]  = useState(null)
const [studioError,     setStudioError]     = useState(null)
```

- [ ] **Step 2: Add viewer install-progress listener useEffect**

After the existing `useEffect` hooks, add:

```js
useEffect(() => {
  if (!window.electron?.onMessage) return undefined
  const unsub = window.electron.onMessage('viewer:install-progress', (data) => {
    if (!data || data.viewerId !== STUDIO_VIEWER_ID) return
    setStudioProgress(data)
  })
  return () => { try { unsub?.() } catch {} }
}, [])
```

- [ ] **Step 3: Add `mooring:finalize-edit-request` IPC listener**

Add another `useEffect` to handle the finalize request from Electron (Electron sends this when Studio calls finalizeEditedModel):

```js
useEffect(() => {
  if (!window.electron?.onMessage) return undefined
  const unsub = window.electron.onMessage('mooring:finalize-edit-request', async (data) => {
    const { requestId, folderPath, editFileName } = data ?? {}
    if (!requestId) return
    try {
      const editPath = `${folderPath}/${editFileName}`.replace(/\\/g, '/')
      const editData = JSON.parse(await window.fs?.readFile(editPath, 'utf-8') ?? '{}')
      const token = localStorage.getItem('session_token')
      const res = await fetch(`${API_BASE_URL}/api/analysis/mooring-fitting/apply-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ folderPath, intents: editData.intents ?? [] }),
      })
      const json = await res.json()
      window.electron.send('mooring:finalize-edit-response', { requestId, ok: !!json?.ok, error: json?.detail })
    } catch (e) {
      window.electron.send('mooring:finalize-edit-response', { requestId, ok: false, error: e?.message })
    }
  })
  return () => { try { unsub?.() } catch {} }
}, [])
```

- [ ] **Step 4: Add `handleOpenStudio` callback**

Add this function inside the component, after the other handler functions:

```js
const handleOpenStudio = async () => {
  if (!isSuccess || !result?.out_dir) return
  setStudioError(null)
  try {
    setStudioStatus('checking')
    const check = await window.electron?.invoke('viewer:check-installed', STUDIO_VIEWER_ID)
    if (check === null) throw new Error('IPC viewer:check-installed 미등록')

    const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${STUDIO_VIEWER_ID}`, { headers: getAuthHeaders() })
    if (!manifestRes.ok) throw new Error(`manifest 조회 실패: HTTP ${manifestRes.status}`)
    const meta = await manifestRes.json()

    const localVer  = check?.manifest?.version ?? null
    const serverVer = meta?.manifest?.version ?? null
    if (!localVer || localVer !== serverVer) {
      setStudioStatus('installing')
      const installRes = await window.electron.invoke('viewer:install', {
        viewerId: STUDIO_VIEWER_ID,
        downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`,
        uncPath: meta.uncPath,
        expectedSha256: meta.sha256,
      })
      if (installRes === null) throw new Error('IPC viewer:install 미등록')
      if (!installRes?.ok) throw new Error(installRes?.error || 'Studio 설치 실패')
      setStudioInstalled(true)
    }

    setStudioStatus('opening')
    const params = new URLSearchParams({ output_dir: result.out_dir })
    const token = localStorage.getItem('session_token')
    const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
      downloadUrl: `${API_BASE_URL}/api/analysis/mooring-fitting/viewer-zip?${params}`,
      jobId: result.out_dir.split(/[\\/]/).pop(),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (fetchRes === null) throw new Error('IPC viewer:fetchResultDir 미등록')
    if (!fetchRes?.ok) throw new Error(fetchRes?.error || 'BDF 데이터 다운로드 실패')

    const openRes = await window.electron.invoke('viewer:open', {
      viewerId: STUDIO_VIEWER_ID,
      initialFolder: fetchRes.dir,
      parentAnalysisId: null,
      serverUrl: API_BASE_URL,
    })
    if (openRes === null) throw new Error('IPC viewer:open 미등록')
    if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패')
    setStudioStatus('idle')
  } catch (e) {
    setStudioStatus('error')
    setStudioError(e?.message ?? 'Studio 오류')
  }
}
```

- [ ] **Step 5: Add Studio button in the result UI**

Find where the result section renders download buttons (around where `result?.final_bdf` is shown). Add a "Studio 열기" button:

```jsx
{isSuccess && result && !result._artifacts_missing && (
  <div className="mt-4">
    {studioProgress && studioStatus === 'installing' && (
      <div className="text-xs text-blue-400 mb-2">
        설치 중... {studioProgress.percent ?? 0}%
      </div>
    )}
    {studioError && (
      <div className="text-xs text-red-400 mb-2">{studioError}</div>
    )}
    <button
      type="button"
      onClick={handleOpenStudio}
      disabled={studioStatus !== 'idle' && studioStatus !== 'error'}
      className="flex items-center gap-2 rounded-xl border border-emerald-500 bg-emerald-950 px-4 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {studioStatus === 'installing' ? (
        <><span className="animate-spin">⟳</span> 설치 중...</>
      ) : studioStatus === 'opening' ? (
        <><span className="animate-spin">⟳</span> Studio 여는 중...</>
      ) : (
        <>🔬 Studio 열기</>
      )}
    </button>
  </div>
)}
```

Find the exact location by searching for where `result?.final_bdf` download button appears (around line 756-760 based on earlier read). Place this block after the last download button in the FinalValidationPanel or in the main result card.

Actually, the button belongs in the main assessment component's result section (not inside FinalValidationPanel), where `isSuccess && result` is accessible. Search for `isSuccess` in the render section to find the right spot.

---

## Task 12: Build + UNC deploy

**Note:** Per policy, UNC deploy requires explicit user confirmation before execution.

- [ ] **Step 1: Build MooringFittingStudio**

```powershell
cd C:\Coding\WorkBenchSubModule\MooringFittingStudio
npm run build
```

Expected: `dist/` contains `index.html`, `manifest.json`, `assets/`.

- [ ] **Step 2: Verify manifest.json**

```powershell
Get-Content C:\Coding\WorkBenchSubModule\MooringFittingStudio\dist\manifest.json
```

Expected: `"id": "mooring-fitting-studio"`, `"version": "0.1.0"`

- [ ] **Step 3: Create the zip package (ask user before deploying)**

```powershell
$src   = "C:\Coding\WorkBenchSubModule\MooringFittingStudio\dist"
$zip   = "C:\Coding\WorkBenchSubModule\MooringFittingStudio\mooring-fitting-studio-0.1.0.zip"
Compress-Archive -Path "$src\*" -DestinationPath $zip -Force
Write-Host "zip size: $([Math]::Round((Get-Item $zip).Length / 1KB)) KB"
```

- [ ] **Step 4: Deploy to UNC (user confirmation required first)**

```powershell
$unc = "\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram"
Copy-Item "C:\Coding\WorkBenchSubModule\MooringFittingStudio\mooring-fitting-studio-0.1.0.zip" $unc
Write-Host "배포 완료"
```

---

## Completion Criteria (from spec)

- [ ] MooringFittingAssessment → "Studio 열기" 버튼 클릭 → Studio 창 오픈
- [ ] Stage 00 / Stage 07 전환 시 씬 교체됨
- [ ] CBEAM (emerald), RBE2 (amber), SPC sphere (red) 모두 3D에서 시각적으로 구분됨
- [ ] 그룹 삭제 intent 추가 후 "최종 BDF 출력" → `mooring_fitting_edited.bdf` 생성
- [ ] RBE2 추가/삭제 intent → 동작 확인
