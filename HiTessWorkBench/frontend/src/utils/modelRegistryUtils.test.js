import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_TAGS,
  MODEL_FAMILIES,
  QUALITY_LADDER,
  SOFT_DELETE_NOTE,
  buildListParams,
  buildRegistrationPayload,
  defaultSelectedArtifactKinds,
  extractApiError,
  familyLabel,
  formatBytes,
  formatNumber,
  formatUtilization,
  normalizeTags,
  outcomeInfo,
  qualityInfo,
  qualityLabelWithCode,
  statusInfo,
  utilizationVariant,
} from './modelRegistryUtils.js';

// ── 태그 정규화 (백엔드 normalize_tags 와 동일 규칙) ────────────────────────

test('normalizeTags trims, lowercases and dedupes', () => {
  assert.deepEqual(normalizeTags(['  Beam ', 'beam', 'FRAME', '', '  ']), ['beam', 'frame']);
});

test('normalizeTags accepts a comma separated string', () => {
  assert.deepEqual(normalizeTags('Ref, lifting , ref'), ['ref', 'lifting']);
});

test('normalizeTags caps the tag count', () => {
  const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `tag${i}`);
  assert.equal(normalizeTags(many).length, MAX_TAGS);
});

test('normalizeTags tolerates nullish input', () => {
  assert.deepEqual(normalizeTags(null), []);
  assert.deepEqual(normalizeTags(undefined), []);
});

// ── 등록 payload ────────────────────────────────────────────────────────────

test('buildRegistrationPayload never includes paths or registrar identity', () => {
  const payload = buildRegistrationPayload({
    sourceAnalysisId: 12,
    artifactKind: 'modelbuilder_final',
    title: '  기준 모델  ',
  });

  for (const forbidden of ['source_path', 'bdf_path', 'output_dir', 'registered_by', 'employee_id']) {
    assert.equal(forbidden in payload, false, `${forbidden} 가 payload 에 들어가면 안 된다`);
  }
  assert.equal(payload.source_analysis_id, 12);
  assert.equal(payload.artifact_kind, 'modelbuilder_final');
  assert.equal(payload.title, '기준 모델');
});

test('buildRegistrationPayload defaults visibility to company', () => {
  const payload = buildRegistrationPayload({
    sourceAnalysisId: 1, artifactKind: 'modelbuilder_final', title: 'T',
  });
  assert.equal(payload.visibility, 'company');
});

test('buildRegistrationPayload omits blank optional fields', () => {
  const payload = buildRegistrationPayload({
    sourceAnalysisId: 1,
    artifactKind: 'modelbuilder_final',
    title: 'T',
    description: '   ',
    modelType: '',
    reuseNotes: '  ',
  });
  assert.equal('description' in payload, false);
  assert.equal('model_type' in payload, false);
  assert.equal('reuse_notes' in payload, false);
});

test('buildRegistrationPayload keeps supplied optional fields', () => {
  const payload = buildRegistrationPayload({
    sourceAnalysisId: 1,
    artifactKind: 'module_unit_lifting',
    title: 'T',
    modelRole: 'failure',
    confidence: 'review-required',
    modelType: ' module-unit ',
    reuseNotes: ' COG 편심 주의 ',
    tags: ['  Lift ', 'lift'],
    includeArtifacts: ['bdf', 'validation'],
  });
  assert.equal(payload.model_role, 'failure');
  assert.equal(payload.confidence, 'review-required');
  assert.equal(payload.model_type, 'module-unit');
  assert.equal(payload.reuse_notes, 'COG 편심 주의');
  assert.deepEqual(payload.tags, ['lift']);
  assert.deepEqual(payload.include_artifacts, ['bdf', 'validation']);
});

test('buildRegistrationPayload includes target_model_uid only when adding a revision', () => {
  const fresh = buildRegistrationPayload({
    sourceAnalysisId: 1, artifactKind: 'modelbuilder_final', title: 'T',
  });
  assert.equal('target_model_uid' in fresh, false);

  const revision = buildRegistrationPayload({
    sourceAnalysisId: 1, artifactKind: 'modelbuilder_final', title: 'T',
    targetModelUid: 'uid-9',
  });
  assert.equal(revision.target_model_uid, 'uid-9');
});

// ── 목록 쿼리 ───────────────────────────────────────────────────────────────

test('buildListParams drops All and empty filters', () => {
  const params = buildListParams({ skip: 0, limit: 20 });
  assert.deepEqual(params, { skip: 0, limit: 20, status: 'active', sort: 'created_desc' });
});

test('buildListParams forwards active filters only', () => {
  const params = buildListParams({
    query: '  권상 ',
    qualityLevel: 'Q3',
    modelType: 'All',
    designOutcome: 'fail',
  });
  assert.equal(params.query, '권상');
  assert.equal(params.quality_level, 'Q3');
  assert.equal(params.design_outcome, 'fail');
  assert.equal('model_type' in params, false);
});

// ── 표시 포맷: null 과 0 을 구분한다 ────────────────────────────────────────

test('formatNumber distinguishes null from zero', () => {
  assert.equal(formatNumber(null), '-');
  assert.equal(formatNumber(undefined), '-');
  assert.equal(formatNumber(0), '0');
});

test('formatUtilization distinguishes null from zero', () => {
  assert.equal(formatUtilization(null), '-');
  assert.equal(formatUtilization(0), '0.0%');
  assert.equal(formatUtilization(0.7169), '71.7%');
});

test('formatBytes distinguishes null from zero', () => {
  assert.equal(formatBytes(null), '-');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB');
});

test('utilizationVariant flags values above allowable', () => {
  assert.equal(utilizationVariant(null), 'neutral');
  assert.equal(utilizationVariant(0.5), 'success');
  assert.equal(utilizationVariant(0.95), 'warning');
  assert.equal(utilizationVariant(1.2), 'error');
});

// ── 품질과 설계 결과는 별개 축 ──────────────────────────────────────────────

test('quality and design outcome are separate vocabularies', () => {
  assert.equal(qualityInfo('Q3').variant, 'success');
  assert.equal(outcomeInfo('fail').variant, 'error');
  // 설계 fail 이어도 품질 등급 어휘에는 fail 이 존재하지 않는다.
  assert.equal('fail' in qualityInfo('Q3'), false);
});

test('unknown quality level degrades gracefully', () => {
  assert.equal(qualityInfo(undefined).variant, 'neutral');
  assert.equal(outcomeInfo('무언가').label, '미해석');
});

// ── 오류 파싱 ───────────────────────────────────────────────────────────────

test('extractApiError reads structured backend detail', () => {
  const err = {
    response: {
      data: {
        detail: {
          code: 'EXACT_DUPLICATE',
          message: '이미 등록됨',
          model_uid: 'uid-1',
          revision: 2,
        },
      },
    },
  };
  assert.deepEqual(extractApiError(err), {
    code: 'EXACT_DUPLICATE',
    message: '이미 등록됨',
    modelUid: 'uid-1',
    revision: 2,
    modelStatus: null,
  });
});

test('extractApiError surfaces model_status so archived duplicates offer restore', () => {
  // 보관된 모델과 중복이면 '등록 불가'가 아니라 '복원'을 제안해야 한다.
  const err = {
    response: {
      data: {
        detail: {
          code: 'ARCHIVED_DUPLICATE',
          message: '보관 상태로 남아 있습니다',
          model_uid: 'uid-9',
          revision: 1,
          model_status: 'archived',
        },
      },
    },
  };
  const parsed = extractApiError(err);
  assert.equal(parsed.code, 'ARCHIVED_DUPLICATE');
  assert.equal(parsed.modelStatus, 'archived');
  assert.equal(parsed.modelUid, 'uid-9');
});

test('extractApiError handles plain string detail and network errors', () => {
  assert.equal(
    extractApiError({ response: { data: { detail: '권한 없음' } } }).message,
    '권한 없음',
  );
  assert.equal(extractApiError({ message: 'Network Error' }).message, 'Network Error');
  assert.equal(extractApiError({}, '기본 메시지').message, '기본 메시지');
});

// ── preview 기본 선택 ───────────────────────────────────────────────────────

test('defaultSelectedArtifactKinds picks server defaults', () => {
  const available = [
    { kind: 'bdf', default_selected: true },
    { kind: 'validation', default_selected: true },
    { kind: 'op2', default_selected: false },
  ];
  assert.deepEqual(defaultSelectedArtifactKinds(available), ['bdf', 'validation']);
  assert.deepEqual(defaultSelectedArtifactKinds(undefined), []);
});

// ── 등급 어휘: 코드가 아니라 평문이 1차 표기 ────────────────────────────────

test('quality levels lead with plain Korean, not the Q code', () => {
  // 'Q3' 만 보고 뜻을 아는 사람은 이 기능을 만든 사람뿐이다.
  assert.equal(qualityInfo('Q3').label, '해석까지 통과');
  assert.equal(qualityInfo('Q3').code, 'Q3');
  assert.equal(qualityLabelWithCode('Q3'), '해석까지 통과 (Q3)');
});

test('quality ladder is ordered and cumulative', () => {
  const ranks = QUALITY_LADDER.map((k) => qualityInfo(k).rank);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  // 각 칸에는 '여기 올라오려면 무엇이 필요한가'가 있어야 한다.
  for (const key of QUALITY_LADDER) {
    assert.ok(qualityInfo(key).requirement, `${key} 에 도달 조건이 없다`);
  }
});

test('unknown quality level still yields a printable label', () => {
  assert.equal(qualityLabelWithCode('Q9'), 'Q9');
  assert.equal(qualityInfo('Q9').rank, -1);
});

// ── 상태 어휘: 사용자에게는 '삭제' 다 ──────────────────────────────────────

test('archived status is presented as deleted, not archived', () => {
  assert.equal(statusInfo('archived').label, '삭제됨');
  assert.equal(statusInfo('active').label, '사용 중');
});

test('soft delete note explains that files survive', () => {
  // 라벨을 '삭제'로 바꾸는 대신, 되돌릴 수 있다는 사실은 문구가 책임진다.
  assert.match(SOFT_DELETE_NOTE, /복원/);
});

// ── 모델 계열 어휘 (백엔드 ModelFamily 와 1:1) ─────────────────────────────

test('MODEL_FAMILIES 는 백엔드 ModelFamily 어휘와 1:1 이다', () => {
  assert.deepEqual(
    MODEL_FAMILIES.map((f) => f.value),
    ['module-unit', 'side-passage', 'truss', 'other'],
  );
});

test('familyLabel 은 어휘 값을 사람이 읽는 라벨로 바꾼다', () => {
  assert.equal(familyLabel('module-unit'), 'Module / Group Unit 구조');
  assert.equal(familyLabel('other'), '기타');
});

test('familyLabel 은 어휘 밖·빈 값을 미분류로 표시한다', () => {
  // 백엔드 family_key 의 unassigned 규칙과 같은 판정이어야 한다
  assert.equal(familyLabel('beam-frame'), '미분류');
  assert.equal(familyLabel(''), '미분류');
  assert.equal(familyLabel(null), '미분류');
  assert.equal(familyLabel(undefined), '미분류');
});

test('buildListParams 는 계열 필터를 model_type 으로 보낸다', () => {
  const params = buildListParams({ modelType: 'side-passage' });
  assert.equal(params.model_type, 'side-passage');
});
