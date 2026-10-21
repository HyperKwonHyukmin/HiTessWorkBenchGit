# LogBook 3D 뷰어 사본 — 여기서 고치지 말 것

All Projects 의 BDF 3D 미리보기(`../BdfPreviewDialog.jsx`)가 쓰는 Hi-TESS LogBook 뷰어 엔진·계산 모듈의 **무수정 사본**이다.

| 이 폴더 | LogBook 원본 (`C:\Coding\Logbook\frontend\src\`) |
|---|---|
| `components/viewer/viewerEngine.js` | `components/viewer/viewerEngine.js` |
| `lib/*.js` (13개) | `lib/` 같은 이름 |

- 원본 커밋 `20b3eaa`(LogBook), 2026-10-21 복사. lbm 형식 **v2** — 백엔드 `app/services/bdf_preview/`(LogBook `backend/app/bdf/` 사본)와 짝이다.
- 폴더 구조를 원본과 같게 둬서 import 경로(`../../lib/…`)를 고치지 않았다. 다시 복사할 때도 덮어쓰기만 하면 된다.
- three 는 LogBook 과 같은 `~0.184.0` 이다. WorkBench three 를 올리고 내릴 때 이 엔진도 같이 확인할 것.
- 고칠 일이 생기면 LogBook 에서 고치고 백엔드·프런트 사본을 함께 다시 복사한다.
