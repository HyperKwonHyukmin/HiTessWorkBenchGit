// HiTESS Model Builder 결과 판정 — 통과 / 검토 필요 / 실패 한 가지로 요약한다.
//
// 화면 위쪽 판정 머리(VerdictHeader)와 왼쪽 단계 레일이 같은 함수를 쓴다. 예전엔 머리는 에러 수만,
// 단계 점은 경고 유무를 따로 봐서 '초록 검증 완료 + 노란 점 + OK' 가 한 화면에 같이 떴다.
//
// 판정 기준(2026-10-01 사용자 결정):
//   실패      — 해석 실패/중단, 또는 최종 단계 진단 에러가 1건 이상
//   검토 필요 — ① 질량이 있는 입력 행이 변환에서 제외됨(총중량 과소 위험)
//               ② 최종 모델에 분리된 그룹이 남음
//               ③ 미해결 U-bolt 가 남음
//   통과      — 그 밖. 자유단·경고 수는 정상 모델에서도 많이 나와 판정에 쓰지 않는다
//               (경고 대부분은 동일 이름 중복이다).

// 제외되어도 총중량이 줄지 않는 사유 — 질량이 원래 0 이거나 길이가 0 인 행.
// zero_length_pipe 는 질량을 가진 경우가 있어(별도 *_without_mass 코드가 있다) 여기 넣지 않는다.
const MASSLESS_REASONS = new Set([
  'zero_mass_equipment',
  'zero_mass_attachment',
  'no_geometry_and_zero_mass',
  'zero_length_pipe_without_mass',
  'zero_length_structure',
  'blank_line',
  'blank',
]);

const EXCLUDED_STATUSES = new Set(['ignored', 'error', 'parseFailed']);

const KIND_LABELS = { Structure: '구조', Pipe: '배관', Equipment: '장비' };

function parseMass(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/** 변환에서 빠졌는데 질량이 있었던(또는 있었을 수 있는) 행. */
export function massBearingExclusions(audit) {
  const rows = Array.isArray(audit?.rowAudit) ? audit.rowAudit : [];
  return rows.filter((r) => {
    if (!EXCLUDED_STATUSES.has(r?.status)) return false;
    const mass = parseMass(r?.rawFields?.mass);
    if (mass != null) return mass > 0;
    return !MASSLESS_REASONS.has(r?.reasonCode);
  });
}

function summarizeByKind(rows) {
  const counts = {};
  for (const r of rows) {
    const label = KIND_LABELS[r.kind] ?? r.kind ?? '기타';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => `${k} ${n.toLocaleString()}건`).join(' · ');
}

function lastStage(summary) {
  const stages = Array.isArray(summary?.stages) ? summary.stages : [];
  return stages[stages.length - 1] ?? null;
}

/**
 * @param {object}  args
 * @param {string}  [args.jobStatus]   'Success' | 'Failed' | 'Cancelled' | 'Running' ...
 * @param {object}  [args.summary]     00_StageSummary.json
 * @param {object}  [args.audit]       00_InputAudit.json
 * @param {object}  [args.editedStage] 편집 적용 모델 점검 결과({health, diagnostics}). 있으면 연결성은 이 값으로 본다
 *                                     — 후속 해석에 넘어가는 모델이 편집본이기 때문이다.
 * @returns {{level: 'pass'|'review'|'fail'|null, title: string, reasons: {code: string, text: string}[], basis: 'original'|'edited'}}
 *   level=null 은 아직 판단할 자료가 없음(실행 전·로딩 중).
 */
export function computeModelBuilderVerdict({ jobStatus, summary, audit, editedStage } = {}) {
  const basis = editedStage ? 'edited' : 'original';

  if (jobStatus === 'Failed' || jobStatus === 'Cancelled') {
    const final = lastStage(summary);
    const reasons = [];
    if (final && (final.diagnostics?.error ?? 0) > 0) {
      reasons.push({ code: 'stage-error', text: `${stageLabel(final)} 단계에서 진단 에러 ${final.diagnostics.error.toLocaleString()}건이 났습니다.` });
    }
    reasons.push({
      code: jobStatus === 'Cancelled' ? 'cancelled' : 'job-failed',
      text: jobStatus === 'Cancelled' ? '사용자 요청으로 실행을 중단했습니다.' : '모델 생성이 끝나지 않았습니다. 아래 원인과 엔진 출력을 확인하세요.',
    });
    return { level: 'fail', title: jobStatus === 'Cancelled' ? '실행 중단' : '모델 생성 실패', reasons, basis };
  }

  if (!summary) return { level: null, title: '', reasons: [], basis };

  const final = lastStage(summary);
  const totalErrors = summary?.summary?.totalErrors ?? final?.diagnostics?.error ?? 0;
  const editedErrors = editedStage?.diagnostics?.error ?? 0;
  if (totalErrors > 0 || editedErrors > 0) {
    const n = editedErrors > 0 ? editedErrors : totalErrors;
    return {
      level: 'fail',
      title: '검증 실패',
      reasons: [{ code: 'diagnostic-error', text: `${editedErrors > 0 ? '편집 모델' : '모델'} 검증 에러 ${n.toLocaleString()}건 — 수정 후 다시 만들어야 해석에 쓸 수 있습니다.` }],
      basis,
    };
  }

  const reasons = [];
  const lost = massBearingExclusions(audit);
  if (lost.length > 0) {
    reasons.push({
      code: 'mass-excluded',
      text: `질량이 있는 입력 ${lost.length.toLocaleString()}행이 변환에서 빠졌습니다(${summarizeByKind(lost)}). 총중량이 실제보다 작을 수 있습니다.`,
    });
  }

  const health = editedStage?.health ?? final?.health ?? {};
  const groups = health.disconnectedGroupCount ?? 0;
  if (groups > 0) {
    reasons.push({
      code: 'disconnected-groups',
      text: `서로 연결되지 않은 그룹 ${groups.toLocaleString()}개가 남아 있습니다. Studio 에서 연결하거나 불필요한 그룹을 지우세요.`,
    });
  }
  const ubolts = health.unresolvedUboltCount ?? 0;
  if (ubolts > 0) {
    reasons.push({
      code: 'unresolved-ubolt',
      text: `연결 대상을 찾지 못한 U-bolt ${ubolts.toLocaleString()}개가 있습니다. 배관이 지지되지 않을 수 있습니다.`,
    });
  }

  if (reasons.length > 0) return { level: 'review', title: '검토 필요', reasons, basis };
  return { level: 'pass', title: '통과', reasons: [], basis };
}

function stageLabel(stage) {
  return stage?.stageName === 'Validation' ? '최종 검증' : (stage?.stageName ?? '마지막');
}
