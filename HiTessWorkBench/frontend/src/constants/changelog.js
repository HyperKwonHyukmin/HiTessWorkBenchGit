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

  HiTessModelFlow: [
    {
      version: '0.0.7',
      date: '2026-04-17',
      type: 'feat',
      changes: [
        'CSV → BDF → Nastran 전체 FEM 파이프라인 초기 구현 (개발 중)',
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

/** 타입별 레이블·배지 색상 */
export const CHANGELOG_TYPE_META = {
  feat:    { label: 'NEW',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  improve: { label: 'IMPROVE',  color: 'bg-blue-100 text-blue-700 border-blue-200'         },
  fix:     { label: 'FIX',      color: 'bg-amber-100 text-amber-700 border-amber-200'      },
  break:   { label: 'BREAKING', color: 'bg-red-100 text-red-700 border-red-200'            },
};
