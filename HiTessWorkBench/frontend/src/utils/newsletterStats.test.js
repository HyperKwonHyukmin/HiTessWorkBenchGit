import test from 'node:test';
import assert from 'node:assert/strict';
import { pct, fmtDelta, fmtReach, unseenMailList, hasTargetList, personMeta, reachPct, groupEntriesByApp } from './newsletterStats.js';

test('pct — 0 으로 나누지 않는다', () => {
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(3, 0), 0);
});

test('fmtReach — 대상 0 이면 App 사용자 없음, 분류 없으면 빈 글', () => {
  assert.equal(fmtReach({ targetUsers: 12, viewedTargets: 3 }), '3 / 12명 (25%)');
  assert.equal(fmtReach({ targetUsers: 0, viewedTargets: 0 }), 'App 사용자 없음');
  assert.equal(fmtReach(null), '');
  // 옛 서버(명단 없는 응답 모양)를 만나도 죽지 않고 '-'
  assert.equal(fmtReach({ recentUsers: 3, reachedUsers: 1 }), '-');
});

test('hasTargetList — 명단이 배열일 때만(옛 서버 응답이면 명단 칸을 그리지 않는다)', () => {
  assert.equal(hasTargetList({ targets: [] }), true);
  assert.equal(hasTargetList({ recentUsers: 3 }), false);
  assert.equal(hasTargetList(null), false);
});

test('unseenMailList — 안 본 사람만, 주소 없는 사람은 따로', () => {
  const r = unseenMailList([
    { name: '가', email: 'a@x.com', seenDay: '2026-11-12' },
    { name: '나', email: ' b@x.com ', seenDay: null },
    { name: '다', email: null, seenDay: null },
    { name: '라', email: 'bad', seenDay: null },
  ]);
  assert.deepEqual(r, { text: 'b@x.com', count: 1, missing: ['다', '라'] });
});

test('fmtDelta — 전이 0 이면 % 없음', () => {
  assert.equal(fmtDelta(10, 14), '+4 (+40%)');
  assert.equal(fmtDelta(5, 2), '−3 (−60%)');
  assert.equal(fmtDelta(0, 3), '+3');
  assert.equal(fmtDelta(2, 2), '변화 없음');
});

test('personMeta — 빈 값(-)과 이름과 같은 값은 뺀다', () => {
  assert.equal(personMeta({ name: '구조시스템연구실', position: '-', department: '구조시스템연구실' }), '');
  assert.equal(personMeta({ name: '가', position: '책임', department: '선장설계부' }), '책임, 선장설계부');
  assert.equal(personMeta({ name: '나', position: null, department: '기장설계부' }), '기장설계부');
});

test('reachPct — 대상이 없거나 옛 응답이면 null', () => {
  assert.equal(reachPct({ targetUsers: 26, viewedTargets: 13 }), 50);
  assert.equal(reachPct({ targetUsers: 0, viewedTargets: 0 }), null);
  assert.equal(reachPct({ recentUsers: 3 }), null);
});

test('groupEntriesByApp — App 마다 최신 한 줄, 나머지는 older(받은 순서 유지)', () => {
  const E = [
    { entry: 'mb2', app: 'MB', date: '2026-11-20' },
    { entry: 'mu2', app: 'MU', date: '2026-11-12' },
    { entry: 'mu1', app: 'MU', date: '2026-11-11' },
    { entry: 'x', date: '2026-11-10' },
    { entry: 'mb1', app: 'MB', date: '2026-11-01' },
  ];
  const g = groupEntriesByApp(E);
  assert.deepEqual(g.map(x => [x.app, x.latest.entry, x.older.map(o => o.entry)]), [
    ['MB', 'mb2', ['mb1']], ['MU', 'mu2', ['mu1']], ['기타', 'x', []],
  ]);
  assert.deepEqual(groupEntriesByApp(null), []);
});
