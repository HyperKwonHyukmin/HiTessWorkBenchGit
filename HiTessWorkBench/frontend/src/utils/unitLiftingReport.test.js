import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveIds, initialReportForm, isPositiveNumber, isReportFormValid, toReportOptions, REPORT_DEFAULTS,
  EXTRA_NOTICE_MAX, revisionSuffix,
} from './unitLiftingReport.js';

test('deriveIds: 파일명의 호선-유닛 패턴을 뽑는다', () => {
  assert.deepEqual(deriveIds('3496-35210-A508372_20260108_edit.bdf'), { hullNo: '3496', unitNo: '35210' });
  assert.deepEqual(deriveIds('3496_35210_x.json'), { hullNo: '3496', unitNo: '35210' });
});

test('deriveIds: 패턴이 없거나 자릿수가 다르면 빈 문자열', () => {
  assert.deepEqual(deriveIds('foo.bdf'), { hullNo: '', unitNo: '' });
  assert.deepEqual(deriveIds('12345-35210.bdf'), { hullNo: '', unitNo: '' });   // 5자리 호선은 대상 아님
  assert.deepEqual(deriveIds(''), { hullNo: '', unitNo: '' });
  assert.deepEqual(deriveIds(undefined), { hullNo: '', unitNo: '' });
});

test('initialReportForm: 파일명에서 호선·유닛을 선입력하고 리비전은 비워 둔다', () => {
  const f = initialReportForm('3496-35210-x.bdf');
  assert.equal(f.hullNo, '3496');
  assert.equal(f.unitNo, '35210');
  assert.equal(f.revision, '');
  // 도면 번호·작성자·부서는 입력에서 뺐다(2026-10-13)
  assert.equal('drawingNo' in f || 'author' in f || 'department' in f, false);
  assert.equal(f.jigLimitTon, REPORT_DEFAULTS.jigLimitTon);
  assert.equal(f.yieldStrengthMpa, REPORT_DEFAULTS.yieldStrengthMpa);
});

test('isPositiveNumber: 0·음수·빈값·문자는 거부', () => {
  assert.equal(isPositiveNumber('6.2'), true);
  assert.equal(isPositiveNumber(6.2), true);
  assert.equal(isPositiveNumber('0'), false);
  assert.equal(isPositiveNumber('-1'), false);
  assert.equal(isPositiveNumber(''), false);
  assert.equal(isPositiveNumber('abc'), false);
  assert.equal(isPositiveNumber(null), false);
});

test('isReportFormValid: 지그 기준·항복강도만 필수', () => {
  assert.equal(isReportFormValid(initialReportForm('')), true);
  assert.equal(isReportFormValid({ ...initialReportForm(''), jigLimitTon: '0' }), false);
  assert.equal(isReportFormValid({ ...initialReportForm(''), yieldStrengthMpa: '' }), false);
});

test('toReportOptions: 숫자 변환·trim, 빈 리비전은 빈 값으로 보낸다', () => {
  const o = toReportOptions({
    hullNo: ' 3496 ', unitNo: '35210', revision: '  ', jigLimitTon: '5', yieldStrengthMpa: '355',
    notes: ' 비고 ', extraNotice: ' 추가 문구 ',
  });
  assert.deepEqual(o, {
    hullNo: '3496', unitNo: '35210', revision: '', jigLimitTon: 5, yieldStrengthMpa: 355,
    notes: '비고', extraNotice: '추가 문구',
  });
  assert.equal(toReportOptions({ jigLimitTon: 6.2, yieldStrengthMpa: 275, revision: ' 02 ' }).revision, '02');
});

test('toReportOptions: 주의 사항 추가 문구는 서식 박스 폭에 맞춰 잘린다', () => {
  // 입력란 maxLength 를 우회해 붙여넣기로 긴 글이 들어와도 서식을 넘지 않게 한다.
  const o = toReportOptions({ jigLimitTon: 6.2, yieldStrengthMpa: 275, extraNotice: '가'.repeat(60) });
  assert.equal(o.extraNotice.length, EXTRA_NOTICE_MAX);
  assert.equal(initialReportForm().extraNotice, '');
});

test('revisionSuffix: 백엔드 revision_suffix 와 같은 규칙', () => {
  assert.deepEqual(['1', '02', 'rev3', 'Rev. 4', 'A', '', null, ' '].map(revisionSuffix),
    ['_rev01', '_rev02', '_rev03', '_rev04', '_revA', '', '', '']);
});
