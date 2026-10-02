---
target: HiTESS Model Builder 페이지 전체
total_score: 23
p0_count: 0
p1_count: 3
timestamp: 2026-10-01T04-54-47Z
slug: frontend-src-pages-analysis-hitessmodelbuilder-jsx
---
# HiTESS Model Builder 페이지 비평 (2026-10-01)

대상: HiTessWorkBench/frontend/src/pages/analysis/HiTessModelBuilder.jsx (+ AppCommunityHub, PreflightIssueCenter, CsvPreviewPanel, ModelRegistrationModal)
검증: 1920×1080 · 1366×768 실화면(A476854), 빈/업로드/실행중/결과(실행 API 모의)/재진입. 콘솔 오류 0.

## 점수 (Nielsen) — 23/40 (Acceptable)
| # | 항목 | 점수 | 핵심 |
|---|---|---|---|
| 1 | 상태 가시성 | 3 | 진행이 4곳 중복, 3단계는 탭 열면 600ms 뒤 '완료'(:3329) |
| 2 | 현실 대응 | 2 | apply-edit-intent·phase JSON·base:05·converted 노출, 단계명이 도구명 |
| 3 | 사용자 통제 | 2 | 재실행=전체 초기화(CSV 삭제, :3463), 편집 적용 중 전체 화면 잠금(:1317) |
| 4 | 일관성 | 2 | 공용 Button/Badge/FileDropzone 미사용, ShieldCheck 4의미, indigo 버튼 |
| 5 | 오류 예방 | 3 | Preflight·자동 분류·형제 CSV·전달 전 편집본 재확인 우수 |
| 6 | 인식 | 2 | 2·3단계에서 입력 요약 소실, 재진입 시 결과 소실 |
| 7 | 유연성 | 1 | 단축키 없음, 같은 입력 재실행 불가, 지난 빌드 Studio 재개 불가 |
| 8 | 미니멀 | 2 | '실행 가능' 3중, 샘플 입구 3곳, eyebrow 22·그라데이션 7·2px 테두리 11·이모지 |
| 9 | 오류 복구 | 3 | 행 감사 CSV·원인/조치 진단 우수, 엔진 로그 10px |
| 10 | 도움말 | 3 | 가이드·샘플 미리보기·샘플 실행 |

## 탐지기
- CLI detect: gray-on-color 15건, 전부 오탐(삼항 갈래·hover). 단 AppCommunityHub:952/961 slate-400 아이콘 버튼 2.56:1 실문제.
- 브라우저 detect: nested-cards 11~13, tiny-text 5~8, cramped-padding, bounce-easing, height transition, 브레드크럼 h2 넘침.
- 실측: 빈 상태 대비 미달 37·11px 미만 35, 업로드 상태 546·545(CsvPreviewPanel:118 행번호 slate-300 1.49:1).

## 우선 문제
- [P1] 판정 단일화 실패: 경고를 숨기고(:1880 사용자 요구) totalErr만으로 초록 '모델 검증 완료'. 트랙 점은 노랑+텍스트 OK. Equipment 19% 변환(질량0 30건)도 초록.
- [P1] 성공 후 다음 행동 부재: 완료 시 1단계로 강제 이동(:3068 사용자 요구), 그 자리 실행버튼 비활성 vs 입력카드 '실행 가능' 모순, 3단계 가짜 완료.
- [P1] 반복 작업 차단: hasRunOnce 잠금+초기화가 파일 삭제, 재진입 시 결과 소실, My Projects 에서 Studio 재개 불가.
- [P2] 편집 적용 전체 화면 잠금(fixed inset-0 z-50 blur).
- [P2] 대시보드·카탈로그 문법 불일치 + 장식 과잉, Studio 카드 주황/초록 그라데이션 굵은 문단, blue+indigo 전달 버튼.
- [P2] 가독성·접근성: 10px 77·9px 6, slate-400 77·slate-300 10, div onClick 단계카드(:3615)/드롭존(:388), 1366 도크가 BDF 버튼·샘플 토글 가림, 1366 실행 버튼 fold 걸침.
- [P3] '필수'→'선택' 배지 의미 혼동(:453), Cpu 아이콘, Nastran 옵션 켜도 F06 결과 미표시, LEGACY 데드코드.

## 공통 틀 제안
AppHeader+AppNoticeLine / RunRail(StepRail·InputSummary·OptionsGroup·RunFooter) / StageCanvas(입력: InputSlots·Preflight·CsvPreview, 결과: VerdictHeader·KeyFigures·DiagnosticsList·상세접기) / NextActionBar / ArtifactsCard·HandoffCard / EngineLogPanel.
훅: useAnalysisJob(appKey), useStudioViewer(viewerId). GMU·Mooring 런처와 통합 가능.
