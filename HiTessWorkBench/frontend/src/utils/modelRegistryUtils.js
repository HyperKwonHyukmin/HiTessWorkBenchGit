/**
 * Model Registry 순수 헬퍼.
 *
 * React 없이 node --test 로 검증할 수 있도록 이 파일에는 JSX/DOM 의존을 두지 않는다.
 * (프로젝트 관례: 테스트 가능한 로직은 src/utils/*.js 순수 함수로 분리)
 */

/** 등록 가능한 source artifact 종류 — 백엔드 SourceArtifactKind 와 1:1 대응 */
export const SOURCE_ARTIFACT_KINDS = {
  MODELBUILDER_FINAL: 'modelbuilder_final',
  MODELBUILDER_EDITED: 'modelbuilder_edited',
  MODELBUILDER_SOLVED: 'modelbuilder_solved',
  GROUPMODULE_ORIGINAL: 'groupmodule_original',
  MODULE_UNIT_EDITED: 'module_unit_edited',
  MODULE_UNIT_LIFTING: 'module_unit_lifting',
};

/** 화면에 보여줄 artifact 종류 이름 */
export const ARTIFACT_KIND_LABELS = {
  modelbuilder_final: '원본 최종 BDF',
  modelbuilder_edited: '편집 BDF',
  modelbuilder_solved: '해석 완료 BDF',
  groupmodule_original: '원본 구조 모델 BDF',
  module_unit_edited: '편집 구조 모델 BDF',
  module_unit_lifting: '최종 모델 BDF (Wire 포함)',
};

/** 저장 artifact 종류 이름 */
export const STORED_KIND_LABELS = {
  bdf: '원본 BDF',
  summary: '요약 JSON',
  manifest: '매니페스트',
  'normalized-model': '정규화 모델 JSON',
  validation: '검증 결과',
  'input-audit': '입력 검사',
  'stage-summary': '단계 요약',
  'analysis-result': '해석 결과 JSON',
  f06: 'Nastran F06',
  op2: 'Nastran OP2',
};

export const MODEL_ROLES = [
  { value: 'reference', label: '기준 모델' },
  { value: 'notable', label: '주목할 사례' },
  { value: 'failure', label: '실패/회귀 예제' },
  { value: 'before', label: '수정 전' },
  { value: 'after', label: '수정 후' },
];

export const CONFIDENCE_LEVELS = [
  { value: 'high', label: '높음' },
  { value: 'medium', label: '보통' },
  { value: 'review-required', label: '검토 필요' },
];

export const VISIBILITY_OPTIONS = [
  { value: 'company', label: '전사 공개' },
  { value: 'owner', label: '소유자만' },
];

/**
 * 품질 등급 — 'Q3' 같은 코드는 만든 사람만 안다.
 *
 * 그래서 **평문 한국어를 1차 표기(label)로 삼고 Q 코드는 부가 표기(code)** 로 내린다.
 * 화면에서는 `label` 을 크게, `code` 를 작게 붙여 쓴다. 필터 값·API 값은 여전히 Q 코드다.
 *
 * 등급은 사다리다 — 위 등급은 아래 등급 조건을 모두 만족한다. `requirement` 는
 * "이 칸에 올라오려면 무엇이 필요한가"이고, 이걸 보여 줘야 사용자가 등급을 예측할 수 있다.
 *
 * ⚠ 이 축은 '모델이 얼마나 검증됐나'이지 '설계가 통과했나'가 아니다(그건 DESIGN_OUTCOME_INFO).
 */
export const QUALITY_LEVEL_INFO = {
  Q0: {
    code: 'Q0',
    label: '원본만 확보',
    rank: 0,
    description: 'BDF 를 읽지 못했습니다. 파일과 체크섬만 보관합니다.',
    requirement: 'BDF 파싱 실패',
    variant: 'neutral',
  },
  Q1: {
    code: 'Q1',
    label: '연결 결함 있음',
    rank: 1,
    description: '모델은 읽혔지만 끊기거나 어디에도 붙지 않은 절점·요소가 있습니다.',
    requirement: '파싱 성공',
    variant: 'warning',
  },
  Q2: {
    code: 'Q2',
    label: '구조 이상 없음',
    rank: 2,
    description: '치명적인 연결 문제가 없습니다. 해석은 아직 돌리지 않았습니다.',
    requirement: '+ 미참조·고립·영길이·분리 그룹 0',
    variant: 'info',
  },
  Q3: {
    code: 'Q3',
    label: '해석까지 통과',
    rank: 3,
    description: 'Nastran 이 치명 오류(FATAL) 없이 끝났습니다.',
    requirement: '+ Nastran FATAL 없음',
    variant: 'success',
  },
  Q4: {
    code: 'Q4',
    label: '엔지니어 승인',
    rank: 4,
    description: '사람이 직접 검토하고 기준 모델로 승인했습니다. 자동으로는 절대 부여되지 않습니다.',
    requirement: '+ 관리자 승인 (수동)',
    variant: 'purple',
  },
};

/** 등급 사다리 — 낮은 칸부터. 설명 패널에서 순서대로 그린다. */
export const QUALITY_LADDER = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4'];

/** 설계 결과 — 품질과 별개 축이다. fail 이라고 나쁜 모델이 아니다. */
export const DESIGN_OUTCOME_INFO = {
  unknown: { label: '미해석', variant: 'neutral' },
  pass: { label: '통과', variant: 'success' },
  mixed: { label: '부분 통과', variant: 'warning' },
  fail: { label: '미통과', variant: 'error' },
};

export const REVIEW_STATUS_INFO = {
  unreviewed: { label: '미검토', variant: 'neutral' },
  approved: { label: '승인됨', variant: 'success' },
  rejected: { label: '반려', variant: 'error' },
};

/**
 * 모델 상태 — 백엔드 값은 여전히 active/archived 지만 **화면에서는 '삭제'로 부른다.**
 *
 * 사용자가 누르는 행위는 "목록에서 없앤다"이고, 실제로 그렇게 동작한다.
 * 'archive/보관' 은 내부 구현(파일을 지우지 않는 소프트 삭제)을 가리키는 말이라
 * 화면에 그대로 내보내면 "그럼 삭제는 어디서 하나"라는 질문만 남는다.
 * 되돌릴 수 있다는 사실은 라벨이 아니라 **문구로** 알린다.
 */
export const MODEL_STATUS_INFO = {
  active: { label: '사용 중', variant: 'neutral' },
  archived: { label: '삭제됨', variant: 'neutral' },
};

/** 삭제가 파일을 지우지 않는다는 사실은 한 곳에서만 문장으로 관리한다. */
export const SOFT_DELETE_NOTE =
  '삭제해도 보관된 파일은 지워지지 않습니다. 목록에서 내려갈 뿐이며 언제든 복원할 수 있습니다.';

export function qualityInfo(level) {
  return (
    QUALITY_LEVEL_INFO[level]
    ?? { code: level || '-', label: level || '-', description: '', requirement: '', rank: -1, variant: 'neutral' }
  );
}

export function statusInfo(status) {
  return MODEL_STATUS_INFO[status] ?? { label: status || '-', variant: 'neutral' };
}

/**
 * '구조 이상 없음 (Q2)'.
 *
 * 평문만 쓰면 예전 화면·문서의 Q 코드와 이어지지 않고, 코드만 쓰면 처음 보는 사람이 못 읽는다.
 * 둘 다 필요한 자리(필터 드롭다운, 표 헤더)에서만 이 함수를 쓴다.
 */
export function qualityLabelWithCode(level) {
  const q = qualityInfo(level);
  if (!q.code || q.code === q.label) return q.label;
  return `${q.label} (${q.code})`;
}

export function outcomeInfo(outcome) {
  return DESIGN_OUTCOME_INFO[outcome] ?? DESIGN_OUTCOME_INFO.unknown;
}

export function reviewInfo(status) {
  return REVIEW_STATUS_INFO[status] ?? REVIEW_STATUS_INFO.unreviewed;
}

/**
 * 태그 정규화 — 백엔드 normalize_tags 와 같은 규칙(trim → 소문자 → 중복 제거 → 최대 20개).
 * 프론트에서 미리 맞춰 두면 저장 후 값이 달라 보이는 혼란을 막는다.
 */
export const MAX_TAGS = 20;

export function normalizeTags(input) {
  const list = Array.isArray(input)
    ? input
    : String(input ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase().slice(0, 50);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * 등록 요청 payload 를 만든다.
 *
 * ★ 절대경로·등록자 신원은 절대 넣지 않는다 — 서버가 source_analysis_id 로 해석하고
 * 등록자는 인증 토큰에서 정한다.
 */
export function buildRegistrationPayload({
  sourceAnalysisId,
  artifactKind,
  targetModelUid = null,
  title,
  description,
  modelType,
  modelRole,
  confidence,
  reuseNotes,
  visibility = 'company',
  tags,
  includeArtifacts = [],
}) {
  const payload = {
    source_analysis_id: sourceAnalysisId,
    artifact_kind: artifactKind,
    title: String(title ?? '').trim(),
    visibility,
    tags: normalizeTags(tags),
    include_artifacts: [...includeArtifacts],
  };
  if (targetModelUid) payload.target_model_uid = targetModelUid;
  if (description?.trim()) payload.description = description.trim();
  if (modelType?.trim()) payload.model_type = modelType.trim();
  if (modelRole) payload.model_role = modelRole;
  if (confidence) payload.confidence = confidence;
  if (reuseNotes?.trim()) payload.reuse_notes = reuseNotes.trim();
  return payload;
}

/** 목록 조회 쿼리 — 'All'/빈 값은 서버로 보내지 않는다. */
export function buildListParams({
  skip = 0,
  limit = 20,
  query = '',
  sourceProgram = 'All',
  modelType = 'All',
  modelRole = 'All',
  qualityLevel = 'All',
  designOutcome = 'All',
  reviewStatus = 'All',
  tag = '',
  status = 'active',
  sort = 'created_desc',
} = {}) {
  const params = { skip, limit, status, sort };
  const optional = {
    query: query?.trim(),
    source_program: sourceProgram,
    model_type: modelType,
    model_role: modelRole,
    quality_level: qualityLevel,
    design_outcome: designOutcome,
    review_status: reviewStatus,
    tag: tag?.trim(),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value && value !== 'All') params[key] = value;
  }
  return params;
}

/** 바이트를 사람이 읽는 크기로. 없으면 '-' (0 과 구분한다). */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

/**
 * 수치 표시 — null 과 0 을 반드시 구분한다.
 * 소스에 값이 없는 것을 0 으로 보여주면 통계를 잘못 읽게 된다.
 */
export function formatNumber(value, { digits = 0, suffix = '' } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const fixed = digits > 0 ? Number(value).toFixed(digits) : Math.round(value).toLocaleString();
  return `${digits > 0 ? Number(fixed).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) : fixed}${suffix}`;
}

/** 사용률(0~1)을 백분율로. 없으면 '-'. */
export function formatUtilization(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

/** 사용률 뱃지 색 — 1.0 초과는 허용치 초과다. */
export function utilizationVariant(value) {
  if (value === null || value === undefined) return 'neutral';
  if (value > 1) return 'error';
  if (value > 0.9) return 'warning';
  return 'success';
}

/** 백엔드 오류 응답에서 code/message 를 뽑는다. */
export function extractApiError(error, fallback = '요청을 처리하지 못했습니다.') {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return { code: null, message: detail };
  if (detail && typeof detail === 'object') {
    return {
      code: detail.code ?? null,
      message: detail.message ?? fallback,
      modelUid: detail.model_uid ?? null,
      revision: detail.revision ?? null,
      // ARCHIVED_DUPLICATE 일 때 '복원' 을 제안하려면 대상의 상태가 필요하다.
      modelStatus: detail.model_status ?? null,
    };
  }
  return { code: null, message: error?.message || fallback };
}

/** preview 응답에서 기본 선택된 artifact 종류를 뽑는다. */
export function defaultSelectedArtifactKinds(availableArtifacts) {
  return (availableArtifacts ?? [])
    .filter((a) => a?.default_selected)
    .map((a) => a.kind);
}
