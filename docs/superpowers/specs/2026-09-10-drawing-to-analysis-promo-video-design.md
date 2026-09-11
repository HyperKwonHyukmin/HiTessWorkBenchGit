# DrawingToAnalysis 홍보 동영상 — 설계

- 작성일: 2026-09-10
- 대상 기능: `DrawingToAnalysis` (WorkBench File-Based App, `devStatus: Developing`)
- 제작 기반: 기존 Remotion 프로젝트 `C:\Coding\Video\hitess-promo` 확장
- 관련 코드: `HiTessWorkBench/frontend/src/pages/analysis/DrawingToAnalysis.jsx`,
  `HiTessWorkBench/frontend/src/components/analysis/DrawingCatalogueModal.jsx`,
  `HiTessWorkBenchBackEnd/app/services/drawing_to_analysis_service.py`,
  `HiTessWorkBenchBackEnd/app/routers/analysis.py` (카탈로그 API)

## 1. 목적과 대상

하나의 촬영 소재에서 **성격이 다른 두 벌의 영상**을 뽑는다.

| | Exec Cut | Engineer Cut |
|---|---|---|
| 길이 | 2분 | 5분 |
| 대상 | 경영진·부서장 | 현업 설계·해석 엔지니어 |
| 답해야 할 질문 | "얼마나 줄고, 얼마나 퍼지나" | "내 도면으로 진짜 되나, 어디서 막히나" |
| 편집 성향 | 공격적 배속, 임팩트 중심 | 절제된 속도, 조작이 읽히게 |
| 한계 노출 | 자막 한 줄 | 명시적으로 다룸 |

두 벌은 **같은 원본 캡처**를 쓴다. Remotion의 `targetSeconds` prop으로 길이를 바꾸면
`timeline.ts`의 `buildTimeline()`이 씬 길이를 균등 스케일한다. 촬영은 한 번이다.

## 2. 결정 사항 (확정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 제작 기반 | **기존 `hitess-promo` Remotion 프로젝트에 새 Composition 추가** | theme·fonts·BlueprintBg·AppChrome·FeatureScene 전부 재사용. 별도 프로젝트는 드리프트를 낳음 |
| 제작 방식 | **하이브리드** — 인트로/숫자/아웃트로는 Remotion 모션그래픽, 본편은 실화면 캡처 | 경영진에겐 임팩트, 엔지니어에겐 실물 신뢰성이 동시에 필요 |
| 본편 촬영 | **Playwright 자동 조작 + 화면 캡처** (에이전트가 수행) | 사용자 수동 녹화 부담 제거. 실현 가능성은 §4에서 실측 검증됨 |
| 데모 소재 | **`Lug_L_25.pdf`** — 서버 도면 카탈로그에 등록된 실제 LUG 도면 | 앱에 이미 존재. 매 촬영이 동일 입력으로 재현됨 |
| 나레이션 | **없음. 자막 + BGM** | 제작·수정 비용이 낮고 회의실/사이니지 재생에 유리 |
| 자막 처리 | Remotion 컴포넌트로 **영상에 직접 렌더** | 무음성 영상에서 자막이 떨어지면 내용이 0이 됨 |
| 산출물 | **MP4 1080p / 30fps** 2벌 | 기존 `promo.mp4`와 동일 규격 |
| 부수 효과 | 캡처를 `captures.ts`에 등록 → **기존 플랫폼 홍보영상 몽타주의 10번째 클립으로도 재활용** | |

## 3. 서사

### 3.1 Exec Cut (2분)

| # | 구간 | 내용 | 종류 |
|---|---|---|---|
| 1 | 0:00–0:12 | 문제 제기. 도면 한 장 위로 `치수 읽기 → 좌표 입력 → 메시 → 하중 → BDF` 수작업 단계가 쌓임 | 모션그래픽 |
| 2 | 0:12–0:22 | 전환. 쌓인 단계가 접히며 `Drawing to Analysis` 배너 등장 | 모션그래픽 |
| 3 | 0:22–1:00 | 본편. 카탈로그에서 `Lug_L_25` 선택 → 미리보기 → 변환 → BDF 3D 모델 등장 | 실화면 |
| 4 | 1:00–1:25 | 해석까지. 하중·경계조건 세트 추가 → Nastran solve → 결과 | 실화면 + 타임랩스 |
| 5 | 1:25–1:45 | 숫자. before/after 대비 | 모션그래픽 |
| 6 | 1:45–2:00 | 확산. WorkBench 앱 카탈로그 내 위치 + 로드맵 한 줄 | 모션그래픽 |

### 3.2 비트 5의 대비 문구 — 정직성 규칙

```
기존:  모델링 → 해석 → 보고서        하루
지금:  모델링 → 해석                 N분
       보고서 자동화는 다음 단계
```

- `하루`는 현업 실측 기준으로 확정된 값이다.
- **`N`은 촬영 때 실측한 값만 쓴다.** 추정치·반올림한 희망치를 쓰지 않는다.
- 현재 DrawingToAnalysis가 덮는 범위는 **모델링 + 해석까지**다. 결과 시각화·보고서는 코드상
  "다음 단계 제공 예정"이므로 대비 문구에서 명시적으로 분리한다. 이 분리가 엔지니어의
  "보고서는 안 되잖아요" 반박을 사전에 제거한다.

### 3.3 Engineer Cut (5분)

Exec Cut의 비트 3·4를 실속도로 펼치고 다음을 추가한다.

1. **입력 경로 2종** — PDF(벡터) 경로와 JPG/PNG 경로
2. **이미지 모드의 기준선 2점 클릭** — 픽셀↔mm 스케일 확정 (반자동 seed 파라미터)
3. **한계 명시** — 화면 안내문과 동일하게 자막으로 재확인
   - 지원: LUG 및 Block Support **벡터 PDF** rule-based 파싱
   - 미지원: **DRM 적용 PDF**
   - 이미지 입력은 반자동(기준선 입력 필요)
4. **개발 중 상태** — `devStatus: Developing`을 가리지 않는다. 자막으로 "개발 중, 사내 시범 적용" 명시

한계를 숨기지 않는 편이 엔지니어 신뢰를 얻는다는 것이 이 컷의 설계 전제다.

## 4. 실현 가능성 — 실측 검증 결과 (2026-09-10)

Playwright 자동 촬영이 가능한지 말이 아니라 실행으로 확인했다.

| 확인 항목 | 결과 |
|---|---|
| `playwright-core` 버전 | **1.60.0** — 요구 chromium 리비전 **1223** |
| 로컬 브라우저 캐시 | `chromium-1223` **존재** → **추가 설치 불필요** |
| ffmpeg | **8.1.2 full build**, `gdigrab`(윈도우 화면 캡처) 사용 가능 |
| 백엔드 | `10.133.122.70:9091` **가동 중**, `/api/version` → `{"version":"1.5.1"}` |
| 프론트 dev 서버 | `localhost:5173` 가동 중 (`node_modules` 설치 완료) |
| 앱 렌더 | Playwright 1920×1080 헤드리스에서 **정상 렌더, 콘솔 에러 0** |
| 로그인 | 사번 `A476854` 입력 → **성공**, 대시보드 진입 확인 |
| 도면 카탈로그 | `InHouseProgram/DrawingToAnalysis/PdfCatalogue/`에 **`Lug_L_25.pdf`**, `BlockSupport_SU_145.pdf`, `PNG/`(미리보기) |

**결론: 실현 가능.** 남은 것은 스크립팅 디테일이며 미지의 기술 장벽은 없다.

### 4.1 검증 중 발견한 함정 4개 (계획에 반드시 반영)

1. **CORS — 접속 주소가 `http://localhost:5173`이어야 한다.**
   백엔드 `main.py`의 `allow_origins`는 `localhost:5173`, `localhost:5174`, `app://.`, `file://`만
   허용한다. `http://[::1]:5173`으로 접속하면 Origin 불일치로 모든 API가 차단되어 앱이
   **"서버에 연결할 수 없음"** 상태가 된다. 실제로 이 함정에 먼저 빠졌다.

2. **DrawingToAnalysis 카드는 접힌 "개발 중" 섹션 안에 있다.**
   `devStatus: Developing`이라 File-Based Apps에서 바로 보이지 않고, 권상·의장 필터 →
   **"개발 중 3 · 펼쳐 보기"** 를 눌러야 나타난다. 촬영 동선에 이 한 단계가 추가되며,
   Exec Cut에서는 "개발 중" 라벨이 화면에 크게 잡히므로 **진입 장면 구성을 별도로 정해야 한다**
   (예: 명령 팔레트 `Ctrl+K`로 바로 진입해 카탈로그 화면을 우회).

3. **dev 서버가 stale 하면 페이지가 백지로 뜬다.**
   실행 중인 vite(PID 32288)는 config 변경 이전 상태라 동적 import가 실패
   (`Failed to fetch dynamically imported module`)했고, DrawingToAnalysis 페이지가 **백지**로 렌더됐다.
   → **촬영은 dev 서버가 아니라 프로덕션 빌드로 한다.** `npm run build` 후
   `vite preview --port 5174` (CORS 허용 목록에 포함됨). HMR 오버레이·의존성 재최적화가 없고,
   실사용자가 보는 화면과 동일하다. 실행 중인 dev 서버를 건드릴 필요도 없다.

4. **화면 캡처 방식** — Playwright 내장 `recordVideo`는 WebM/VP8이라 홍보용 화질로는 약하다.
   **헤디드 Chromium + ffmpeg `gdigrab` 윈도우 캡처**를 기본으로 한다(사실상 자동화된 OBS).
   기존 `CAPTURE_CHECKLIST.md`의 규격(1080p·고비트레이트)을 그대로 따를 수 있다.

## 5. 제작 파이프라인

### 5.1 기존 프로젝트가 이미 갖춘 것 (신규 개발 불필요)

`C:\Coding\Video\hitess-promo` (Remotion 4.0.474). 최종본 `out/promo.mp4` = 1920×1080 / 30fps / h264 / 60.05s / AAC.

| 자산 | 역할 |
|---|---|
| `src/captures.ts` | `{src, enabled, kind, startFrom}` 레지스트리. 파일을 `public/`에 넣고 `enabled: true`만 켜면 목업→실캡처 자동 전환 |
| `src/timeline.ts` | 씬 길이를 데이터로 보관. `buildTimeline(totalFrames)`이 전체를 균등 스케일 → **길이 다른 두 벌이 공짜** |
| `src/theme.ts` | 브랜드 토큰. Trust Blue `#002554` (PRODUCT.md와 일치), emerald accent |
| `src/fonts.ts` | Inter + Noto Sans KR + JetBrains Mono |
| `components/BlueprintBg` | 도면 그리드 배경 — DrawingToAnalysis 주제와 특히 잘 맞음 |
| `components/AppChrome` | **앱 창틀을 코드로 그림** → 캡처는 내용만 있으면 된다 |
| `scenes/*` | Hook · Brand · Dashboard · Montage · FeatureScene · Outro |
| `templates/A·B·C` | 장면 레이아웃 변형 |

### 5.2 새로 만드는 것

```
hitess-promo/
├── src/
│   ├── DrawingToAnalysisPromo.tsx     # 신규 Composition 본체
│   ├── scenes/dta/                    # 비트 1·2·5·6 모션그래픽
│   ├── dtaTimeline.ts                 # 비트별 길이 + targetSeconds 스케일
│   └── Root.tsx                       # Composition 등록 (수정)
└── public/
    ├── dta_catalogue.mp4              # 비트 3 캡처
    ├── dta_convert.mp4                # 비트 3 캡처
    └── dta_solve.mp4                  # 비트 4 캡처

C:\Coding\WorkBench\scripts\promo\      # 촬영 자동화 (WorkBench 저장소)
├── capture-dta.mjs                     # Playwright 조작 + gdigrab 녹화 제어
└── marks.json                          # 각 비트 시작 시각 (자동 기록)
```

`marks.json`은 `captures.ts`의 `startFrom`(프레임 트림 값)을 **눈대중이 아니라 실측으로**
채우기 위한 것이다. 촬영 스크립트가 각 조작 시점을 기록하면 트림 값이 계산으로 나온다.

### 5.3 절차

| | 단계 | 산출 | 실패 시 |
|---|---|---|---|
| P0 | 촬영 환경 — 프론트 **프로덕션 빌드 + `vite preview --port 5174`**, 백엔드 9091 확인, 데모 계정 확정 | 안정된 촬영 대상 | — |
| P1 | `capture-dta.mjs` 작성·실행 — 로그인 → DrawingToAnalysis 진입(§4.1-2 동선) → `Lug_L_25.pdf` 선택 → 변환 → 하중·BC → solve → 결과 | 캡처 mp4 3종, `marks.json` | solve 실패 시 `BlockSupport_SU_145.pdf`로 대체 |
| P2 | **실측** — solve 포함 총 소요 시간 기록 → 비트 5의 `N` 확정 | 숫자 1개 | — |
| P3 | 캡처를 `public/`에 배치, `captures.ts` 등록, `startFrom`을 `marks.json`으로 산출 | 실캡처 연결 | — |
| P4 | 모션그래픽 4씬(비트 1·2·5·6) + 자막 컴포넌트 작성 | `scenes/dta/*` | — |
| P5 | `Root.tsx`에 Composition 등록 → `remotion render` 2회(2분/5분) | `dta_exec.mp4`, `dta_engineer.mp4` | — |
| P6 | 검토 → 수정은 코드만 고쳐 재렌더 | 최종본 | — |

P2가 P4보다 앞서는 이유: 비트 5의 숫자가 확정돼야 모션그래픽 텍스트를 만들 수 있다.

## 6. 착수 전 해결해야 할 선결 조건

| | 사항 | 상태 |
|---|---|---|
| B1 | **`hitess-promo` 프로젝트 전체가 미커밋.** git에는 Remotion 초기 템플릿 커밋(`f3e086e`) 하나뿐이고 `src/HitessPromo.tsx`·`captures.ts`·`scenes/`·`components/`·`public/`(영상 자산 12개) 모두 untracked. 작업 중 유실 위험. | **사용자 조치 필요** |
| B2 | **`public/music.mp3` 없음.** `HitessPromo.tsx`가 `staticFile("music.mp3")`로 참조하는데 파일이 사라졌다. 최종본에 AAC 오디오가 있으므로 렌더 당시엔 존재했다. 지금 렌더하면 BGM이 빠지거나 실패한다. | **원본 복구 필요** |
| B3 | Exec Cut의 **진입 장면 구성** — "개발 중" 라벨 노출을 어떻게 다룰지 (§4.1-2) | 결정 필요 |

B1·B2는 에이전트가 임의로 처리하지 않았다.

## 7. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| dev 서버 stale → 백지 렌더 | 촬영 자체가 불가 | 프로덕션 빌드 + `vite preview --port 5174` (§4.1-3) |
| CORS Origin 불일치 | 앱 전체 오프라인 | 접속은 반드시 `http://localhost:5174` (§4.1-1) |
| "개발 중" 라벨 노출 | 경영진 컷의 미완성 인상 | 가리지 않고 자막으로 "개발 중, 사내 시범 적용" 명시 — 로드맵 근거로 전환 |
| 해석 대기 시간 | 영상 늘어짐 | Remotion `OffthreadVideo` `playbackRate` 또는 `startFrom` 트림. 결과가 나오는 순간만 실속도 |
| **실제 도면 노출** | 사외 유출 시 문제 | 영상 말미 "사내 한정" 고지. MP4는 사내 경로에만 배포 |
| 캡처 화질 | 홍보물 품질 미달 | 헤디드 + `gdigrab` 고비트레이트, `CAPTURE_CHECKLIST.md` 규격 준수 (§4.1-4) |

## 8. 검증 기준

- `marks.json`의 모든 마커가 기록되었고 순서가 단조 증가한다 (촬영이 끝까지 진행됨)
- `dta_exec.mp4` 길이 2:00 ± 0:10, `dta_engineer.mp4` 5:00 ± 0:30
- 두 파일 모두 1920×1080 / 30fps, 자막이 프레임 밖으로 잘리지 않는다
- 비트 5의 `N`이 P2 실측 로그의 값과 일치한다 (추정치가 섞이지 않았다)
- Engineer Cut에 한계 3종(벡터 PDF 전제 / DRM 미지원 / 이미지 반자동)이 모두 자막으로 등장한다
- 기존 `HitessPromo` Composition이 **변경 전과 동일하게 렌더된다** (회귀 없음)

## 9. 범위 밖 (YAGNI)

- 음성 나레이션·TTS
- 영어 자막 (요청 시 확장 가능한 구조는 유지)
- GIF·짧은 클립 산출
- WorkBench 앱 내 영상 임베드 / 사내 포털 업로드 자동화
- DrawingToAnalysis 기능 자체의 수정 — 이 작업은 촬영일 뿐 앱을 고치지 않는다
- 기존 `HitessPromo` 영상의 재편집 (몽타주 10번째 클립 추가는 선택적 후속 작업)

## 10. 구현 결과 (2026-09-10 완료)

### 산출물

| 파일 | 길이 | 규격 |
|---|---|---|
| `C:\Coding\Video\hitess-promo\out\dta_exec.mp4` | 120.04s | 1920×1080 / 30fps / h264 / 36.3MB |
| `C:\Coding\Video\hitess-promo\out\dta_engineer.mp4` | 290.05s | 1920×1080 / 30fps / h264 / 59.3MB |

### 실측값 (영상 자막의 근거)

| 항목 | 실측 |
|---|---|
| 도면 → 3D Shell 모델 (LUG) | 18.7s |
| 도면 → 3D Shell 모델 (Block Support) | 23.7s |
| Nastran SOL 101 | 27.9s |
| 도면 선택 → 해석 결과 (end-to-end) | 127s ≈ **2분** |

원본 캡처 222.78s, 마커 25개. `src/dta/clips.ts` 의 `MEASURED` 가 단일 출처이며
`Numbers` 씬이 이 값을 직접 읽는다 — 자막에 손으로 적은 숫자가 없다.

### 결정 사항 변경 이력

- 데모 소재: `Lug_L_25.pdf` **+ `BlockSupport_SU_145.pdf` 둘 다** (사용자 결정).
  도면의 대외비 표기·승인란 실명은 **사내 발표 전용** 전제로 그대로 노출한다.
- 하중: `Fz = 245,166 N` (도면 안전하중 25,000 kg). 면내 하중이라 최대 변위 0.138mm.
- B3(진입 장면) 해결: 명령 팔레트 `Ctrl+K` 직행 경로가 **"개발 중" 라벨을 화면에 잡지 않는다.**
- 캡처 방식: §4.1-4 는 헤디드 + `gdigrab` 을 기본으로 잡았으나, **헤드리스 `recordVideo`(VP8)
  로 충분**한 것으로 실측 확인해 그쪽을 썼다. 정적 UI 라 VP8 이 효율적이어서 793 kbps 에서도
  도면 치수가 또렷하게 읽힌다. 부수 효과로 **사용자 화면을 점유하지 않는다.**
- BGM: 사용자 결정으로 **제거**. `USE_AUDIO` 상수와 `Audio` 블록을 삭제했다(커밋 `2e18ca2`).
- Exec/Engineer 를 `targetSeconds` 균등 스케일이 아니라 **별도 비트 테이블**로 나눴다
  (`src/dta/beats.ts`). 두 관객이 원하는 것이 달라서 같은 비율로 늘리고 줄이는 것이 맞지 않았다.

## 11. 남은 항목

- **Engineer Cut 의 이미지 입력 경로 비트 없음** — §3.3 의 "JPG/PNG 기준선 2점 클릭" 은
  촬영하지 않았다. 현재는 `Limits` 씬에서 자막으로만 언급한다. 필요하면 해당 경로를
  추가 촬영해 비트를 넣어야 한다.
- **앱 결함(영상과 무관하나 기록)**: 하중 입력 다이얼로그의 `Fx/Fy/Fz` 와 결과 테이블의
  `T1/T2/T3` 가 **Y↔Z 로 뒤바뀌어** 표기된다. 실증: `Fz` 입력 → `T2(Y)` 에 변위 0.138mm,
  `Fy` 입력 → `T3(Z)` 에 변위 8.146mm. 해석 자체는 정상이나 표기가 어긋난다.
- 배포 위치 확정 (현재 `hitess-promo/out/`, git 미추적)


## 12. 개정 (2026-09-10, 사용자 피드백 반영 — 임원 보고용)

### 구성 변경

| 장면 | 변경 |
|---|---|
| 1 Problem | 단계 재정의: 도면에서 치수 읽기 → 해석 모델 구축 → 하중·경계조건 → 구조해석 수행 → 결과 검토 → 보고서 작성. `하루` → **`소요 시간 2~3일`** |
| 2 Transition | 길이 **10s → 5s** |
| 3 catalogue | "설계 도면을 고른다" → **"설계 도면 확인"** |
| 4 convert | "도면이 해석 모델이 된다" → **"구조해석 모델 구축"** |
| 5 params | "도면 치수 그대로" → **"도면의 치수 정보 인식"** + 부제 "치수 변경 시 자동 반영되어 모델 재구축". 영상 교체 |
| 6 bc | "하중과 경계조건" → **"하중과 경계조건 설정"**. 영상 교체 |
| 7 solve | **삭제** |
| 8 blocksupport | 유지 |
| 9 numbers | **삭제** |
| 10 rollout | 유지 |

### 교체 영상 처리 — 그대로 쓸 수 없었던 이유

사용자 제공 `DrawingtoAnalysis/part5.mp4`, `Part6-1.mp4` 는 **전체 화면 녹화**라 두 가지 문제가 있었다.

1. **윈도우 창틀·작업표시줄이 프레임에 포함**됐다. 임원 보고 영상에 OS UI 가 보이면 안 된다.
   → `crop` 으로 앱 영역만 남겼다 (part5: 상단 17px·하단 36px, part6: 상단 28px·하단 18px).
2. **UI 가 기존 클립의 약 0.73배 크기**로 녹화됐다(다른 배율/해상도). 그대로 두면 프로젝터에서
   파라미터 값이 안 읽힌다. → 정보가 없는 좌측 내비게이션을 잘라내고 확대했다.
   - part5: 파라미터 패널 + 3D 뷰어로 **1.37×** (기존 클립과 거의 같은 글자 크기)
   - part6: 좌측 내비만 제거해 **1.11×** (하단 결과 테이블을 살리기 위해 확대를 절제)

### 대기 구간 트림 — 임원 보고에서 빈 화면은 사고로 보인다

변환·재구축 대기 중에는 뷰어가 흰 화면이 된다. 배속만으로는 비율이 그대로라 **원본을 잘랐다.**

| 클립 | 원본 | 트림 후 | 잘라낸 것 |
|---|---|---|---|
| convert | 31.68s | 21.67s | 변환 대기 10s |
| params | 20.2s | 16.2s | 재구축 빈 화면 6s → 2s (밝기 측정으로 9~15s 구간 확정) |
| blocksupport | 41.69s | 23.73s | 변환 대기 18s |

### 산출물

| 파일 | 길이 | 크기 |
|---|---|---|
| `out/dta_exec.mp4` | **1:35** | 24.0 MB |
| `out/dta_engineer.mp4` | **2:50** | 32.7 MB |

둘 다 1920×1080 / 30fps / h264.

### 짚어 둘 점

- **`Part6-1.mp4` 에는 Nastran 해석과 응력 컨투어·결과 테이블이 이미 들어 있다.** 7번 장면을
  삭제해도 해석 결과는 6번 장면 안에서 보인다. 다만 캡션은 지시대로 "하중과 경계조건 설정"
  이라 결과 화면을 설명하지 않는다.
- **9번(숫자 대비) 삭제로 1번의 `2~3일` 이 받는 문구가 없어졌다.** 도입부 문제 제기는 남았지만
  "그래서 얼마나 줄었나" 를 말하는 장면이 없다.
