/**
 * Group & Module Unit 권상 구조 해석 — 판정(통과 / 검토 필요 / 실패).
 *
 * 공통 틀(runFrame) 규칙: 판정은 한 가지만 보여 준다. 이 앱은 두 시점에 판정이 생긴다.
 *   1) BDF 입력 검증 직후  — "이 BDF 로 Studio 권상 검토를 시작해도 되는가"
 *   2) Studio 구조 해석 후 — "권상 구조가 허용치 안에 있는가"  (있으면 이쪽이 우선)
 *
 * 구조 해석 판정 규칙은 Electron main(viewer:runUnitStructural)의 status 계산과 같다:
 *   응력 초과 부재·Wire 압축·Wire 결과 누락 중 하나라도 있으면 FAIL, 경고만 있으면 WARN, 아니면 PASS.
 * 지난 결과를 다시 열 때(DB result_info)도 같은 규칙으로 다시 계산하려고 여기 둔다 — 두 곳을 같이 고칠 것.
 */

const num = (v) => Number(v || 0);

/** 구조 해석 요약(summary)·경고·허용응력으로 결과 객체를 만든다(Electron 완료 이벤트와 같은 모양). */
export function buildStructuralResult({ summary = {}, warnings = [], allowableMPa = null, analysisId = null } = {}) {
  const exceed = num(summary.memberExceedCount);
  const compression = num(summary.wireCompressionCount);
  const missing = num(summary.wireMissingResultCount);
  const warnList = Array.isArray(warnings) ? warnings : [];
  const status = exceed > 0 || compression > 0 || missing > 0 ? 'FAIL' : warnList.length > 0 ? 'WARN' : 'PASS';
  const allowable = allowableMPa != null && Number.isFinite(Number(allowableMPa)) ? Number(allowableMPa) : null;
  return {
    ok: true,
    status,
    analysisId,
    summary,
    warnings: warnList,
    items: [
      { label: '최대 부재 응력', value: `${num(summary.memberMaxStressMPa).toFixed(2)} MPa`, allowable: allowable != null ? `${allowable.toFixed(2)} MPa` : '—', ok: exceed === 0 },
      { label: '응력 초과 부재', value: `${exceed} / ${num(summary.memberElementCount)}`, allowable: '0', ok: exceed === 0 },
      { label: 'Wire 압축', value: `${compression} / ${num(summary.wireCount)}`, allowable: '0', ok: compression === 0 },
      { label: 'Wire 결과 누락', value: String(missing), allowable: '0', ok: missing === 0 },
    ],
  };
}

const warningText = (w) => (typeof w === 'string' ? w : w?.message ?? w?.text ?? JSON.stringify(w));

/**
 * @param {object} p
 * @param {boolean} [p.jobFailed]   BDF 검증 작업 자체가 실패(요청 오류·시간 초과·결과 없음)
 * @param {object}  [p.step1Data]   JSON_Validation
 * @param {object}  [p.step2Data]   JSON_F06Summary (Nastran 검증을 켰을 때)
 * @param {object}  [p.structural]  구조 해석 결과(buildStructuralResult 모양, 또는 { status:'ERROR', error })
 * @returns {{ level: 'pass'|'review'|'fail'|null, title: string, reasons: {code,text}[], basis: 'validation'|'structural'|null }}
 */
export function computeGmuVerdict({ jobFailed = false, step1Data = null, step2Data = null, structural = null } = {}) {
  if (structural) {
    if (structural.status === 'ERROR') {
      return { level: 'fail', title: '구조 해석 실패', basis: 'structural',
        reasons: [{ code: 'structural-error', text: structural.error || 'Studio 에서 오류 내용을 확인한 뒤 다시 실행하세요.' }] };
    }
    if (structural.status === 'FAIL') {
      const s = structural.summary ?? {};
      const reasons = [];
      if (num(s.memberExceedCount) > 0) reasons.push({ code: 'member-exceed', text: `허용 응력을 넘는 부재 ${num(s.memberExceedCount)}개 (최대 ${num(s.memberMaxStressMPa).toFixed(1)} MPa)` });
      if (num(s.wireCompressionCount) > 0) reasons.push({ code: 'wire-compression', text: `압축을 받는 Wire ${num(s.wireCompressionCount)}개 — 권상 위치를 다시 잡아야 합니다` });
      if (num(s.wireMissingResultCount) > 0) reasons.push({ code: 'wire-missing', text: `해석 결과가 없는 Wire ${num(s.wireMissingResultCount)}개` });
      return { level: 'fail', title: '구조 판정 불합격', basis: 'structural', reasons };
    }
    if (structural.status === 'WARN') {
      const warns = structural.warnings ?? [];
      const reasons = warns.slice(0, 3).map((w, i) => ({ code: `warn-${i}`, text: warningText(w) }));
      if (warns.length > 3) reasons.push({ code: 'warn-more', text: `외 경고 ${warns.length - 3}건 — Studio 결과 도크에서 확인` });
      return { level: 'review', title: '검토 필요', basis: 'structural', reasons };
    }
    return { level: 'pass', title: '구조 판정 통과', basis: 'structural', reasons: [] };
  }

  if (jobFailed) {
    return { level: 'fail', title: 'BDF 검증 실패', basis: 'validation',
      reasons: [{ code: 'job-failed', text: '검증 작업이 끝나지 못했습니다. BDF 형식을 확인한 뒤 다시 검증하세요.' }] };
  }
  if (!step1Data) return { level: null, title: '', reasons: [], basis: null };

  const summary = step1Data.summary ?? {};
  const ps = step1Data.parsingSummary ?? {};
  const fatals = num(step2Data?.summary?.f06Fatals);
  if (step1Data.status === 'error' || num(summary.totalErrors) > 0 || fatals > 0) {
    const reasons = [];
    // deck 구간 경계 오류(백엔드 bdf_deck_check) — 무엇이 문제인지와 자동 수정 가능 여부를 먼저 말한다.
    for (const issue of step1Data.deckIssues ?? []) {
      if (issue.severity !== 'error') continue;
      reasons.push({ code: `deck-${issue.code}`, text: `${issue.title}${issue.fixable ? ' — 자동 수정할 수 있습니다' : ''}` });
    }
    if (num(summary.totalErrors) > 0) reasons.push({ code: 'bdf-errors', text: `BDF 검증 오류 ${num(summary.totalErrors).toLocaleString()}건 — 아래 '검증 상세'에서 카드별로 확인` });
    if (fatals > 0) reasons.push({ code: 'f06-fatal', text: `Nastran FATAL ${fatals}건 — 해석이 돌지 않는 BDF 입니다` });
    if (reasons.length === 0) reasons.push({ code: 'bdf-error', text: 'BDF 를 해석 모델로 읽지 못했습니다.' });
    return { level: 'fail', title: 'BDF 를 쓸 수 없음', basis: 'validation', reasons };
  }

  // 경고 등급 deck 문제(BEGIN BULK 누락 등)도 '검토 필요'로 올린다 — 통과로 두면 화면이 바로 Studio 단계로
  // 넘어가 자동 수정 제안을 못 보고, 다른 도구로 가져갔을 때 깨지는 BDF 를 그대로 쓰게 된다.
  const reviewReasons = (step1Data.deckIssues ?? [])
    .filter((issue) => issue.severity !== 'error')
    .map((issue) => ({ code: `deck-${issue.code}`, text: `${issue.title}${issue.fixable ? ' — 자동 수정할 수 있습니다' : ''}` }));
  const groups = num(ps.disconnectedGroupCount);
  if (groups > 0) {
    reviewReasons.push({ code: 'disconnected', text: `주 구조와 떨어진 그룹 ${groups}개 — Studio Edit › 자동 연결로 잇거나, 의도한 분리인지 확인하세요` });
  }
  if (reviewReasons.length > 0) {
    return { level: 'review', title: '검토 필요', basis: 'validation', reasons: reviewReasons };
  }
  return { level: 'pass', title: '입력 검증 통과', basis: 'validation', reasons: [] };
}
