import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultExportTitle,
  describeExportResult,
  formatBytes,
  formatShortDateTime,
  groupFilesByRole,
  isPreviewableBdf,
  summarizeSelection,
} from './adminProjectFiles.js';

const FILES = [
  { path: 'C:/u/w/b.json', folder: 'w', rel: 'b.json', size: 10, role: 'result', drm: false },
  { path: 'C:/u/w/a.bdf', folder: 'w', rel: 'a.bdf', size: 100, role: 'input', drm: false },
  { path: 'C:/u/w/enc.xlsx', folder: 'w', rel: 'enc.xlsx', size: 5, role: 'result', drm: true },
  { path: 'C:/u/w/log/run.f06', folder: 'w', rel: 'log/run.f06', size: 1, role: 'other', drm: false },
];

test('역할별 묶음은 입력 → 결과 → 기타, 빈 묶음 제외', () => {
  const groups = groupFilesByRole(FILES);
  assert.deepEqual(groups.map(g => g.role), ['input', 'result', 'other']);
  assert.deepEqual(groups[1].files.map(f => f.rel), ['b.json', 'enc.xlsx']);
  assert.deepEqual(groupFilesByRole([FILES[3]]).map(g => g.label), ['기타 산출물']);
});

test('선택 요약은 개수·크기·DRM 수', () => {
  const selected = new Set(['C:/u/w/a.bdf', 'C:/u/w/enc.xlsx', 'missing']);
  assert.deepEqual(summarizeSelection(FILES, selected), { count: 2, bytes: 105, drm: 1 });
});

test('크기 표기', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
  assert.equal(formatBytes(300 * 1024 ** 2), '300 MB');
});

test('짧은 시각 표기', () => {
  assert.equal(formatShortDateTime('2026-10-12T14:05:02'), '2026-10-12 14:05');
  assert.equal(formatShortDateTime(null), '');
  assert.equal(formatShortDateTime('nope'), '');
});

test('묶음 이름 기본값은 서버 기본값과 같은 모양', () => {
  assert.equal(defaultExportTitle({ id: 7, program_name: 'GroupModuleUnit', employee_id: 'a123456' }),
    'WB #7 · GroupModuleUnit · A123456');
  assert.equal(defaultExportTitle(null), '');
});

test('보낸 결과 요약', () => {
  assert.match(describeExportResult({ state: 'staged', file_count: 3, blocked: [], rejected: [{}] }), /3개 파일, DRM 파일 1개 제외/);
  assert.match(describeExportResult({ state: 'blocked', file_count: 0, blocked: [{}], rejected: [] }), /이미 LogBook 에 있어/);
});

test('isPreviewableBdf: BDF 계열 확장자만, DRM 은 제외', () => {
  assert.equal(isPreviewableBdf({ rel: 'sub/3496_M01.BDF' }), true);
  assert.equal(isPreviewableBdf({ rel: 'part.dat' }), true);
  assert.equal(isPreviewableBdf({ rel: 'model.bdf', drm: true }), false);
  assert.equal(isPreviewableBdf({ rel: 'model.f06' }), false);
  assert.equal(isPreviewableBdf({ rel: 'model.bdf.bak' }), false);
  assert.equal(isPreviewableBdf(null), false);
});
