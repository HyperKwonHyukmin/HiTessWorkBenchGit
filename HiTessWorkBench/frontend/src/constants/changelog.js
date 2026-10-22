/**
 * 솔버별 개발 이력 (정적 changelog)
 * 새 항목은 배열 맨 앞에 추가 (최신 → 과거 순)
 *
 * type: 'feat' | 'improve' | 'fix' | 'break'
 */

export const CHANGELOG = {
  TrussAnalysis: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        '3D 모델 뷰어 초기 릴리스',
        'CSV 업로드 → Truss 해석 파이프라인 연동',
      ],
    },
  ],

  TrussAssessment: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'BDF 업로드 기반 구조 안정성 평가 기능 추가',
        'Excel 결과 내보내기 (DRM 우회 메모리 생성 방식)',
        'Load Case별 Summary / Element Assessment / Distribution Panel / Side Support 시트 구성',
      ],
    },
  ],

  HiTessModelBuilder: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'CSV → BDF → Nastran 전체 FEM 파이프라인 초기 구현 (개발 중)',
      ],
    },
  ],

  F06Parser: [
    {
      version: '1.0.1',
      date: '2026-04-20',
      type: 'improve',
      changes: [
        'CBAR Stress 컬럼 명칭을 SA-Stress / SB-Stress로 변경',
        '테이블에서 불필요한 여유강도(MS) 컬럼 제거 (CSV 다운로드에서 확인 가능)',
        '통계 차트 기본 활성화',
        '적용 범위 안내 추가 (SOL 101 정적 해석 / 1D Beam 전용)',
        'SPC Force 결과에서 반력이 발생하지 않은 노드 자동 제거',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-04-20',
      type: 'feat',
      changes: [
        'Nastran SOL 101 F06 파일 파싱 기능 출시',
        'Displacement · SPC Force · CBAR / CBEAM / CROD 내력 및 응력 결과 조회',
        'Subcase별 탭 뷰: 컬럼 클릭으로 오름·내림차순 정렬',
        'Subcase별 최대값 추세 및 상위 10개 요소 랭킹 차트 시각화',
        'Subcase · 결과 유형별 CSV 개별 다운로드',
        '각 탭에서 핵심 요약 값만 표시 (전체 상세 데이터는 CSV로 확인)',
      ],
    },
  ],

  BdfScanner: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'BDF 유효성 검증 기능 추가',
        '선택적 Nastran 해석 실행 지원',
      ],
    },
  ],

  SimpleBeamAssessment: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        '단면 파라미터 입력 기반 보(Beam) 응력·변위 평가',
        '실시간 3D 단면 시각화 및 하중 다이어그램',
        '해석 결과 PDF 캡처 기능',
      ],
    },
  ],

  MastPostAssessment: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'Post 높이·하중 입력 → 최적 파이프 후보 산출',
        '다빗 구조 파라메트릭 설계 지원',
      ],
    },
  ],

  JibRestAssessment: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'Jib Rest 1단/2단 파이프 설계 후보 산출',
        '참조 도면 이미지 연동',
      ],
    },
  ],

  ColumnBucklingCalculator: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'AISC 기준 기둥 좌굴 허용 하중 계산기 초기 릴리스',
        '유효 길이 계수(K) 및 단면 특성 입력 지원',
      ],
    },
  ],

  BeamAnalysisViewer: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'JSON / CSV 기반 해석 결과 시각화',
        '응력·변위 분포 차트 제공',
      ],
    },
  ],
};

/**
 * 타입별 한글 분류(관리자 업데이트 이력과 같은 말). 분류는 중립 배지로 보이고,
 * 사용 방식이 바뀌는 break 만 주의(amber) 배지다 — 색은 알아야 할 때만 쓴다.
 */
export const CHANGELOG_TYPE_META = {
  feat:    { label: '기능', variant: 'neutral' },
  improve: { label: '개선', variant: 'neutral' },
  fix:     { label: '수정', variant: 'neutral' },
  break:   { label: '사용 방식 변경', variant: 'warning' },
};

/** '새 항목' 판정 열쇠(날짜|버전) — utils/updateHistory.newIndexes 에 넘긴다. */
export const changelogKey = (entry) => `${entry?.date || ''}|${entry?.version || ''}`;
