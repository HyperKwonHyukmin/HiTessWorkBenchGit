# DrawingToAnalysis 홍보 영상 — 촬영 스크립트

WorkBench 실화면을 Playwright 로 자동 조작하며 녹화한다. 사람이 OBS 로 녹화하지 않는다 —
UI 가 바뀌면 스크립트만 고쳐 재녹화하면 되고, 매 촬영이 같은 입력(같은 도면)으로 재현된다.

## 사전 조건

1. **프론트는 프로덕션 빌드로 띄운다** (dev 서버 아님)
   ```
   cd HiTessWorkBench/frontend
   npm run build
   npx vite preview --port 5174 --strictPort
   ```
   - dev 서버는 의존성 재최적화 중이면 동적 import 가 실패해 페이지가 **백지**로 뜬다.
   - 포트는 **5174 또는 5173** 이어야 한다. 백엔드 `main.py` 의 CORS `allow_origins`
     가 이 둘만 허용해서, `http://[::1]:5174` 같은 다른 origin 으로 붙으면 앱이 통째로
     "서버에 연결할 수 없음" 이 된다.
2. 백엔드 9091 가동 (`/api/version` 이 200 이어야 한다)
3. 도면 카탈로그에 `Lug_L_25.pdf`, `BlockSupport_SU_145.pdf` 존재
   (`HiTessWorkBenchBackEnd/InHouseProgram/DrawingToAnalysis/PdfCatalogue/`)

## 실행

```
node scripts/promo/capture-dta.mjs    # → capture/*.webm + marks.json
node scripts/promo/cut-clips.mjs      # → hitess-promo/public/dta_*.mp4 + clips.json
```

그 다음 `C:\Coding\Video\hitess-promo` 에서:

```
npx remotion render DrawingToAnalysisExec     out/dta_exec.mp4
npx remotion render DrawingToAnalysisEngineer out/dta_engineer.mp4
```

렌더 전에 `npm run clean` 이 필요할 수 있다(webpack 캐시가 깨지면 번들링이 실패한다).

## marks.json

`capture-dta.mjs` 가 각 비트의 시작 시각(초)을 기록한다. `cut-clips.mjs` 는 절대 초가 아니라
**마커 이름**으로 구간을 자른다. UI 가 바뀌어 타이밍이 밀려도 자르는 규칙은 그대로 두고
재녹화만 하면 된다 — 재촬영 비용을 낮추는 장치다.

## 진입 동선 주의

DrawingToAnalysis 는 `devStatus: Developing` 이라 File-Based Apps 목록에서 접힌
**"개발 중" 섹션** 안에 있다. 그래서 명령 팔레트(`Ctrl+K` → "Drawing")로 직행한다.
이 경로는 "개발 중" 라벨이 화면에 잡히지 않는 부수 효과도 있다.
