Bdf Scanner

1. 프로젝트 개요

배경

조선소 선박 의장 구조해석 업무에서 CSV → BDF 변환 → Nastran 해석 → 결과 보고서까지 이어지는 HiTESS 파이프라인을 단일 GUI에서 관리하기 위한 데스크톱 앱.

핵심 문제

- 파이프라인 각 단계를 CLI/수동으로 관리하여 실수 가능성 높음
- 단계별 진행 상황, 옵션 설정, 결과 확인이 분산되어 있음
- CSV 시작과 BDF 직접 시작 두 경로가 혼재하여 관리 어려움

목표

파이프라인 전체를 하나의 Hybrid UI에서 제어하고, 단계별 자유 이동 및 부분 재실행이 가능한 엔지니어링 전용 데스크톱 앱 구축

2. 파이프라인 구조 — 4-Way 분기

진입점 (Entry Point)

구분
Route A
Route B
시작 파일
CSV
BDF
첫 단계
CSV 검증 → ModelBuilder → BDF 변환
BDF 파싱 및 문법 검증
특징
연결성 엉망인 CSV를 ModelBuilder로 복구 후 BDF 생성
기존 BDF를 바로 활용


분기점 (BDF 준비 완료 이후)

구분
Route *-1
Route *-2
목적
FEM 모델 유효성 검증
Nastran 구조해석
주요 작업
비연결 요소, 종횡비, 미참조 PID/MID, ID 중복
SOL 선택, 하중케이스, F06 파싱
출력
검증 리포트 (오류·경고 목록)
응력·변위 보고서 (Excel/HTML)
연계
검증 통과 시 Route *-2로 바로 진행 가능
—


전체 경로 요약

[CSV] → CSV 검증 → ModelBuilder → BDF 변환 ─┐
                                              ├→ [BDF 준비 완료] → 모델 유효성 검증 → 검증 리포트
[BDF] → BDF 파싱·문법 검증 ──────────────────┘                 ↘ (통과 시)
                                                               → Nastran 해석 → F06 파싱 → 결과 보고서

3. UI 구조 — Hybrid 3-Zone 레이아웃

Zone 1 — TopBar

- 앱 이름: HiLAB
- 현재 케이스명 표시 (예: MF-2025-083 · Mooring Fitting)
- 시작점 토글: [CSV → BDF 변환 포함] / [BDF 직접 로드]
    - 선택에 따라 Left Panel 단계 목록 동적 재구성
- 케이스 변경 / 전체 초기화 버튼

Zone 2 — Body (좌우 분할)

Left Panel — 파이프라인 스텝퍼 (200px 고정)

- 수직 dot + line + card 구조
- 단계 상태: done / running / wait / error / skip
- 클릭으로 임의 단계 자유 이동
- 선택된 단계에 ▲ 이전 / ▼ 다음 내비게이션 버튼 표시
- 완료/전체 진행 카운터 (예: 2 / 5)
- 분기점 단계에서 다음 경로 선택 UI 표시

Right Panel — 단계 상세 패널 (나머지)

- 선택된 단계에 따라 완전히 다른 컴포넌트 렌더링
- 완료 단계: 결과 수치 카드(GRID수, Element수, 오류수 등) + 로그 뷰어
- 대기/설정 단계: 파라미터 입력 폼 (select, number input, checkbox 등)
- 분기 단계: 다음 경로 선택 카드 UI

Zone 3 — ActionBar (하단 고정)

- [이 단계만 실행] [이 단계부터 실행] [전체 실행]
- 실행 중: [중단] 버튼으로 전환
- 현재 선택된 단계명 힌트 표시

4. 단계별 Detail Panel 스펙

Route A 전용

A-1. CSV 입력 검증

- 결과 표시: 총 행수, 오류 수, 감지된 단위계
- 완료 로그: 필수 컬럼 확인, 단위계 감지, 범위 이상치 여부

A-2. ModelBuilder (BDF 변환)

- 설정: 넘버링 오프셋 (GRID / CBAR / RBE2 시작 ID)
- 결과: 생성된 GRID / Element / RBE 수, 출력 BDF 경로
- 연결성 복구 알고리즘: Union-Find 기반 (기존 C# 로직 연동)

Route B 전용

B-1. BDF 파일 로드

- 파일 선택 버튼 + 선택된 파일명 표시
- 파싱 결과: GRID수, Element수, 경고 수

공통 단계

모델 유효성 검증

- 실행 모드: strict (경고 시 중단) / lenient (경고 무시)
- 종횡비 임계값 (기본 5.0)
- 검사 항목 체크박스:
    - 비연결 요소 탐지 (Union-Find)
    - 미참조 PID / MID
    - 종횡비 초과 요소
    - ID 범위 충돌 검사
    - 단위계 일관성 재확인

Nastran 해석

- Solution 선택: SOL 101 / SOL 103 / SOL 111
- 하중 케이스 수 입력
- Nastran 실행 경로 설정
- 출력 요청 체크박스: DISPLACEMENT / STRESS / SPCFORCES / FREQ

결과 보고서

- 형식 선택: Excel (.xlsx) / HTML / Word (.docx)
- 출력 폴더 선택
- 파일명 규칙: 케이스번호_날짜 / 수동 입력

5. 기술 스택

항목
선택
프레임워크
Electron + React (TypeScript)
스타일
Tailwind CSS
상태 관리
Zustand
빌드
Vite + electron-vite
백엔드 연동
Python subprocess (기존 HiTESS C# 파이프라인)
상태 직렬화
JSON (케이스별 파이프라인 상태 저장/복원)
    6. 상태 설계

type StepStatus = 'done' | 'running' | 'wait' | 'error' | 'skip'
type EntryMode = 'csv' | 'bdf'
type BranchRoute = 'validation' | 'nastran' | 'both'  // 분기점 선택

interface PipelineStep {
  id: string
  title: string
  sub: string
  status: StepStatus
  params: Record<string, unknown>   // 단계별 파라미터
  result?: Record<string, unknown>  // 실행 결과
}

interface PipelineState {
  caseId: string
  caseName: string
  entryMode: EntryMode
  branchRoute: BranchRoute
  steps: PipelineStep[]
  activeIdx: number
}

설계 원칙

- PipelineState 전체를 JSON으로 직렬화 → 케이스별 저장/복원 가능
- 시작점 전환 시 steps 배열 교체, 공통 단계(분기 이후) 파라미터는 유지
- 순환 참조 없이 단방향 상태 흐름 유지

7. 개발 단계별 구현 범위

Phase 1 — 셸과 상태 (초기 구현)

[ ] Electron + React + Vite 프로젝트 초기화
[ ] 3-zone 레이아웃: TopBar, PipelineStepList, StepDetailPanel, ActionBar
[ ] usePipelineStore (Zustand): steps, activeIdx, entryMode, branchRoute
[ ] 시작점 토글 → steps 재구성 로직
[ ] 단계 클릭 / ▲▼ 내비게이션
[ ] 분기점 UI (다음 경로 선택)
[ ] 3가지 실행 버튼 (setTimeout mock)

Phase 2 — 단계별 Detail Panel

[ ] CsvValidationPanel
[ ] ModelBuilderPanel
[ ] BdfLoadPanel
[ ] QcPanel (모델 유효성 검증)
[ ] NastranPanel
[ ] ReportPanel
[ ] 실행 결과 수치 카드 + 로그 뷰어

Phase 3 — 백엔드 연동

[ ] Electron main process → Python subprocess 실행
[ ] stdout 스트리밍 → 로그 뷰어 실시간 업데이트
[ ] 기존 HiTESS C# 모듈 연동 (ModelBuilder, 품질 검사, Nastran 실행)
[ ] 파이프라인 상태 JSON 저장/복원
[ ] 케이스 히스토리 관리

8. 참고 및 연관 사항

- 기존 HiTESS C# 솔루션을 _reference/ 폴더에 복사하여 Claude Code에서 참조
- ModelBuilder의 연결성 복구 알고리즘(Union-Find) 재활용 필요
- F06 파싱: FATAL/WARNING 우선 추출 후 응력·변위 결과 처리
- 단위계: mm/N/tonne/MPa 기준 (혼용 방지 검증 레이어 필수)
- Claude Code 실행 위치: HiLAB 프로젝트 루트 (CLAUDE.md에 _reference 읽기 전용 명시)
