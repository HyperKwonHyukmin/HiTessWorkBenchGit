import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStripEntry, seenStorageKey, readBeaconMessage } from './updateNotices.js';

const NOW = Date.parse('2026-11-20T09:00:00');
const E = [
  { id: 'a-test', date: '2026-11-19', title: '시험', test: true },
  { id: 'b', date: '2026-11-12', title: '새것' },
  { id: 'c', date: '2026-10-01', title: '20일 넘음' },
];

test('pickStripEntry — 시험용은 개발 화면에서만, 30일 안 최신, NEW 는 14일 안 안 본 것', () => {
  assert.deepEqual(pickStripEntry(E, { now: NOW }), { entry: E[1], newCount: 1 });
  assert.deepEqual(pickStripEntry(E, { now: NOW, includeTest: true }), { entry: E[0], newCount: 2 });
  assert.equal(pickStripEntry(E, { now: NOW, seenIds: ['b'] }).newCount, 0);
  assert.deepEqual(pickStripEntry([E[2]], { now: NOW }), { entry: null, newCount: 0 });
  assert.deepEqual(pickStripEntry(null, { now: NOW }), { entry: null, newCount: 0 });
});

test('seenStorageKey — 사번별', () => {
  assert.equal(seenStorageKey('a476854'), 'workbench:update-seen:A476854');
  assert.equal(seenStorageKey(null), 'workbench:update-seen:ANON');
});

test('readBeaconMessage — 모양이 맞을 때만', () => {
  const p = { entry: 'b', type: 'view' };
  assert.deepEqual(readBeaconMessage({ type: 'hitess-update-beacon', payload: p }), p);
  assert.equal(readBeaconMessage({ type: 'other', payload: p }), null);
  assert.equal(readBeaconMessage({ type: 'hitess-update-beacon', payload: { entry: 1, type: 'view' } }), null);
  assert.equal(readBeaconMessage({ type: 'hitess-update-beacon', payload: { entry: 'b', type: 'hack' } }), null);
});
