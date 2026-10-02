/**
 * Truss Model Builder · Truss Structural Assessment — 판정(통과 / 검토 필요 / 실패).
 *
 * 공통 틀(runFrame) 규칙: 판정은 한 가지만 보여 주고, 근거는 결과에 실제로 있는 값만 쓴다.
 *  - Model Builder: 엔진 결과에 판정 값이 없다. '모델(BDF)이 만들어졌는가' 만 판정한다.
 *  - Assessment:    엔진이 부재·하중분산판마다 result('OK' 외 = 불합격)를 낸다. 그 값을 그대로 센다.
 *                   Side Support 는 엔진이 판정하지 않아 결과 표(AssessmentResultTable)가 허용 반력으로
 *                   직접 판정한다 — 같은 상수(SIDE_SUPPORT_ALLOWABLE)를 쓰므로 표와 판정 머리가 어긋나지 않는다.
 */

/** Side Support 허용 반력(N). 결과 표와 판정 머리가 같은 값을 쓴다. */
export const SIDE_SUPPORT_ALLOWABLE = 100800;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 백엔드 실패 리포트(assessment_diagnostics.build_failure_report / build_preflight_report)에서
 * [단계]·[원인]·[조치] 를 뽑는다. 들여쓴 다음 줄은 같은 항목의 이어지는 줄이다.
 */
export function parseFailureReport(text) {
  const out = { stage: null, cause: null, remedy: null };
  if (!text) return out;
  const keyOf = { '단계': 'stage', '원인': 'cause', '조치': 'remedy' };
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\[(단계|원인|조치|상세|파일)\]\s*(.*)$/);
    if (m) {
      current = keyOf[m[1]] ?? null;
      if (current) out[current] = m[2].trim();
      continue;
    }
    if (current && /^\s{2,}\S/.test(raw)) {
      out[current] = `${out[current] ?? ''} ${raw.trim()}`.trim();
      continue;
    }
    current = null;
  }
  return out;
}

/** 결과 JSON 묶음(케이스 이름 → JSON)을 판정에 쓸 수치로 요약한다. loadCases 형식이 아니면 null. */
export function summarizeAssessment(resultsMap) {
  if (!resultsMap || typeof resultsMap !== 'object') return null;
  const s = {
    loadCaseCount: 0, members: 0, memberFail: 0, maxAssessment: 0, maxAt: null,
    panels: 0, panelFail: 0, supports: 0, supportFail: 0, maxReaction: 0,
  };
  let found = false;
  for (const [caseName, data] of Object.entries(resultsMap)) {
    if (!Array.isArray(data?.loadCases)) continue;
    found = true;
    for (const lc of data.loadCases) {
      s.loadCaseCount += 1;
      for (const r of lc.elementAssessment || []) {
        s.members += 1;
        if (r.result !== 'OK') s.memberFail += 1;
        const a = num(r.assessment);
        if (a > s.maxAssessment) {
          s.maxAssessment = a;
          s.maxAt = { caseName, loadCase: lc.loadCaseIndex, element: r.element };
        }
      }
      for (const r of lc.distributionPanel || []) {
        s.panels += 1;
        if (r.result !== 'OK') s.panelFail += 1;
      }
      for (const r of lc.sideSupport || []) {
        s.supports += 1;
        const reaction = Math.abs(num(r.reaction ?? r.reactionForce));
        if (reaction > s.maxReaction) s.maxReaction = reaction;
        if (reaction > SIDE_SUPPORT_ALLOWABLE) s.supportFail += 1;
      }
    }
  }
  return found ? s : null;
}

const failReasonsFromReport = (report, fallback) => {
  const r = parseFailureReport(report);
  const reasons = [];
  if (r.cause) reasons.push({ code: 'cause', text: r.stage ? `${r.stage} — ${r.cause}` : r.cause });
  if (r.remedy) reasons.push({ code: 'remedy', text: `조치: ${r.remedy}` });
  if (reasons.length === 0) reasons.push({ code: 'failed', text: fallback });
  return reasons;
};

/**
 * Truss Model Builder 판정.
 * @param {object} p
 * @param {boolean} [p.jobFailed]  실행 실패(엔진 실패·요청 실패·시간 초과)
 * @param {object}  [p.project]    성공한 해석 기록(result_info.bdf)
 */
export function computeTrussBuilderVerdict({ jobFailed = false, project = null, report = '' } = {}) {
  if (jobFailed) {
    return { level: 'fail', title: 'BDF 생성 실패', basis: 'build',
      reasons: failReasonsFromReport(report, 'Node·Member CSV 형식을 확인하고, 아래 실행 기록의 엔진 출력을 확인하세요.') };
  }
  if (!project || project.status !== 'Success') return { level: null, title: '', reasons: [], basis: null };
  if (!project.result_info?.bdf) {
    return { level: 'fail', title: 'BDF 생성 실패', basis: 'build',
      reasons: [{ code: 'no-bdf', text: '실행은 끝났지만 결과 BDF 가 기록되지 않았습니다.' }] };
  }
  return { level: 'pass', title: '모델 생성 완료', basis: 'build', reasons: [] };
}

/**
 * Truss Structural Assessment 판정.
 * @param {object} p
 * @param {boolean} [p.jobFailed]   실행 실패
 * @param {string}  [p.report]      실패 리포트(engine_log) — 원인·조치를 사유로 쓴다
 * @param {object}  [p.resultsMap]  결과 JSON 묶음
 */
export function computeTrussAssessmentVerdict({ jobFailed = false, report = '', resultsMap = null } = {}) {
  if (jobFailed) {
    return { level: 'fail', title: '해석 실패', basis: 'run',
      reasons: failReasonsFromReport(report, '아래 실행 기록의 실패 리포트를 확인하세요.') };
  }
  const s = summarizeAssessment(resultsMap);
  if (!s) return { level: null, title: '', reasons: [], basis: null };

  const reasons = [];
  if (s.memberFail > 0) {
    reasons.push({ code: 'member-fail', text: `허용치를 넘는 부재 ${s.memberFail.toLocaleString()}건 (최대 Assessment ${s.maxAssessment.toFixed(2)})` });
  }
  if (s.panelFail > 0) reasons.push({ code: 'panel-fail', text: `하중분산판 불합격 ${s.panelFail}건` });
  if (s.supportFail > 0) {
    reasons.push({ code: 'support-fail', text: `Side Support 반력 초과 ${s.supportFail}건 (허용 ${SIDE_SUPPORT_ALLOWABLE.toLocaleString()} N)` });
  }
  if (reasons.length > 0) return { level: 'fail', title: '구조 평가 불합격', basis: 'assessment', reasons, summary: s };
  return { level: 'pass', title: '구조 평가 통과', basis: 'assessment', reasons: [], summary: s };
}
