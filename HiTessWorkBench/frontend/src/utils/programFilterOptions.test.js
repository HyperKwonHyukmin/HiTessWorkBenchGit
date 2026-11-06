import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgramFilterOptions, programFilterParams } from './programFilterOptions.js';

const CATALOG = {
  HiTessModelBuilder: { title: 'HiTESS Model Builder', category: '구조 모델' },
  AmToModelBuilder: { title: 'HiTESS Model Builder', category: '구조 모델' },
  'BDF Scanner': { title: 'BDF Scanner', category: '도구' },
  GroupModuleUnit: { title: 'Group & Module Unit 권상 구조 해석', category: '권상' },
};
const find = (k) => CATALOG[k];

test('같은 App 의 여러 내부 키는 한 줄로 합친다', () => {
  const out = buildProgramFilterOptions(['HiTessModelBuilder', 'AmToModelBuilder', 'BDF Scanner'], find);
  const mb = out.filter(o => o.label === 'HiTESS Model Builder');
  assert.equal(mb.length, 1);
  assert.deepEqual(mb[0].keys, ['AmToModelBuilder', 'HiTessModelBuilder']);
  assert.deepEqual(out.find(o => o.label === 'BDF Scanner').keys, ['BDF Scanner']);
});

test('분류별로 묶고 카탈로그에 없는 키는 기타로 맨 뒤', () => {
  const out = buildProgramFilterOptions(['Legacy', 'BDF Scanner', 'GroupModuleUnit', 'HiTessModelBuilder'], find);
  assert.deepEqual(out.map(o => o.group), ['구조 모델', '권상', '도구', '기타']);
  assert.equal(out.at(-1).value, 'Legacy');
});

test('빈 값은 버린다', () => {
  assert.deepEqual(buildProgramFilterOptions(['', null], find), []);
});

test('키가 하나면 program_name, 여럿이면 program_names', () => {
  assert.deepEqual(programFilterParams(undefined), {});
  assert.deepEqual(programFilterParams({ keys: ['GroupModuleUnit'] }), { program_name: 'GroupModuleUnit' });
  assert.deepEqual(programFilterParams({ keys: ['A', 'B'] }), { program_names: 'A|B' });
});
