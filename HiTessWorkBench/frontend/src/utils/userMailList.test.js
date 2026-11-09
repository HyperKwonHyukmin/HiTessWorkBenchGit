import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActiveMailList, describeMissing, isValidEmail, needsManualEmail, planBulkEmail, missingRosterText,
} from './userMailList.js';

test('planBulkEmail 은 빈 칸을 건너뛰고 틀린 값을 따로 모은다', () => {
  const users = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const r = planBulkEmail(users, { 1: ' a@hhi.co.kr ', 2: '', 3: 'bad', 9: 'x@y.z' });
  assert.deepEqual(r.toSave, [{ id: 1, email: 'a@hhi.co.kr' }]);
  assert.deepEqual(r.invalidIds, [3]);
  assert.equal(r.empty, 2);
});

test('missingRosterText 는 탭으로 이은 줄', () => {
  assert.equal(
    missingRosterText([{ name: '홍', employee_id: 'A1', company: 'HHI', department: '팀', position: '책임' }, { employee_id: 'X2' }]),
    '홍\tA1\tHHI\t팀\t책임\n\tX2\t\t\t',
  );
});

test('needsManualEmail 은 승인 사용자 중 주소가 없거나 틀린 사람만', () => {
  assert.equal(needsManualEmail({ is_active: true, email: null }), true);
  assert.equal(needsManualEmail({ is_active: true, email: 'x@hhi' }), true);
  assert.equal(needsManualEmail({ is_active: true, email: 'x@hhi.co.kr' }), false);
  assert.equal(needsManualEmail({ is_active: false, email: null }), false);
  assert.equal(isValidEmail(' a@b.co '), true);
});

test('승인 사용자만, 중복 주소는 한 번만, 세미콜론으로 잇는다', () => {
  const r = buildActiveMailList([
    { name: '가', is_active: true, email: 'a@hhi.co.kr' },
    { name: '나', is_active: true, email: ' B@hhi.co.kr ' },
    { name: '다', is_active: false, email: 'c@hhi.co.kr' },
    { name: '라', is_active: true, email: 'A@HHI.co.kr' },
  ]);
  assert.equal(r.text, 'a@hhi.co.kr; B@hhi.co.kr');
  assert.equal(r.count, 2);
  assert.equal(r.duplicates, 1);
  assert.equal(r.missing.length, 0);
});

test('주소가 없거나 모양이 틀리면 missing 으로 돌린다', () => {
  const r = buildActiveMailList([
    { name: '가', is_active: true, email: null },
    { name: '나', is_active: true, email: '' },
    { name: '다', is_active: true, email: 'not-an-email' },
    { employee_id: 'X12345', is_active: true, email: 'a;b@hhi.co.kr' },
  ]);
  assert.equal(r.count, 0);
  assert.equal(r.text, '');
  assert.deepEqual(r.missing.map((u) => u.name || u.employee_id), ['가', '나', '다', 'X12345']);
});

test('빈 입력도 깨지지 않는다', () => {
  assert.equal(buildActiveMailList(undefined).count, 0);
});

test('describeMissing 은 앞 몇 명만 보인다', () => {
  const list = ['가', '나', '다'].map((name) => ({ name }));
  assert.equal(describeMissing(list, 5), '가, 나, 다');
  assert.equal(describeMissing(list, 2), '가, 나 외 1명');
});
