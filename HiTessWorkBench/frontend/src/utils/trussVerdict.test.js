import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDE_SUPPORT_ALLOWABLE, computeTrussAssessmentVerdict, computeTrussBuilderVerdict,
  parseFailureReport, summarizeAssessment,
} from './trussVerdict.js';

const lc = (idx, { elems = [], panels = [], supports = [] } = {}) => ({
  loadCaseIndex: idx, elementAssessment: elems, distributionPanel: panels, sideSupport: supports,
});
const ok = (element, assessment) => ({ element, assessment, result: 'OK' });

test('실패 리포트에서 단계·원인·조치를 뽑는다(들여쓴 줄은 이어 붙인다)', () => {
  const report = [
    '======', '해석 실패 원인', '======',
    '[단계] 부재 응력 검토',
    '[원인] 평가된 부재가 없습니다.',
    '[상세]', '       PID 1001', '[조치] Property ID 를 1~18 로', '       맞춰 다시 올리세요.',
    '======', '엔진 출력',
  ].join('\n');
  const r = parseFailureReport(report);
  assert.equal(r.stage, '부재 응력 검토');
  assert.equal(r.cause, '평가된 부재가 없습니다.');
  assert.equal(r.remedy, 'Property ID 를 1~18 로 맞춰 다시 올리세요.');
  assert.deepEqual(parseFailureReport(''), { stage: null, cause: null, remedy: null });
});

test('Model Builder: 결과 BDF 가 있으면 통과, 실행 실패면 실패, 실행 전이면 판정 없음', () => {
  assert.equal(computeTrussBuilderVerdict({}).level, null);
  assert.equal(computeTrussBuilderVerdict({ project: { status: 'Success', result_info: { bdf: 'a.bdf' } } }).level, 'pass');
  assert.equal(computeTrussBuilderVerdict({ project: { status: 'Success', result_info: {} } }).level, 'fail');
  const f = computeTrussBuilderVerdict({ jobFailed: true, report: '[원인] CSV 열 부족' });
  assert.equal(f.level, 'fail');
  assert.match(f.reasons[0].text, /CSV 열 부족/);
});

test('Assessment: loadCases 가 없으면 판정 없음', () => {
  assert.equal(summarizeAssessment({ A: { rows: [] } }), null);
  assert.equal(computeTrussAssessmentVerdict({ resultsMap: { A: [{ x: 1 }] } }).level, null);
});

test('Assessment: 모든 부재·패널 OK, 반력 허용 이내면 통과 + 최대값 위치', () => {
  const map = { M: { loadCases: [
    lc(1, { elems: [ok(1, 0.2), ok(2, 0.71)], panels: [{ result: 'OK' }], supports: [{ reaction: -SIDE_SUPPORT_ALLOWABLE }] }),
    lc(2, { elems: [ok(1, 0.5)] }),
  ] } };
  const v = computeTrussAssessmentVerdict({ resultsMap: map });
  assert.equal(v.level, 'pass');
  assert.equal(v.summary.members, 3);
  assert.equal(v.summary.maxAssessment, 0.71);
  assert.deepEqual(v.summary.maxAt, { caseName: 'M', loadCase: 1, element: 2 });
  assert.equal(v.summary.supportFail, 0); // 허용값과 같으면 통과(표와 같은 '>' 비교)
});

test('Assessment: 부재·패널 불합격, 반력 초과는 실패 사유로 각각 센다', () => {
  const map = { M: { loadCases: [lc(1, {
    elems: [ok(1, 0.3), { element: 2, assessment: 1.4, result: 'NG' }],
    panels: [{ result: 'Fail' }],
    supports: [{ reactionForce: SIDE_SUPPORT_ALLOWABLE + 1 }],
  })] } };
  const v = computeTrussAssessmentVerdict({ resultsMap: map });
  assert.equal(v.level, 'fail');
  assert.deepEqual(v.reasons.map(r => r.code), ['member-fail', 'panel-fail', 'support-fail']);
  assert.match(v.reasons[0].text, /1\.40/);
});

test('Assessment: 실행 실패는 리포트 원인을 사유로', () => {
  const v = computeTrussAssessmentVerdict({ jobFailed: true, report: '[원인] PRINT 누락\n[조치] Case Control 수정' });
  assert.equal(v.level, 'fail');
  assert.equal(v.reasons.length, 2);
  assert.equal(computeTrussAssessmentVerdict({ jobFailed: true }).reasons[0].code, 'failed');
});
