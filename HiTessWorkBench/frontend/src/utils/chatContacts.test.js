import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatSections,
  formatChatTime,
  sortRoster,
  statusDotClass,
  statusLabel,
} from './chatContacts.js';

const CONTACTS = [
  { employee_id: 'A1', name: '가온라인', department: '구조해석팀', status: 'online' },
  { employee_id: 'A2', name: '나유휴', department: '구조해석팀', status: 'idle' },
  { employee_id: 'A3', name: '다오프', department: '설계지원팀', status: 'offline' },
];

test('buildChatSections 는 대화 이력이 없는 관리자도 로스터에 포함한다', () => {
  const { roster, others } = buildChatSections(CONTACTS, []);
  assert.deepEqual(roster.map((r) => r.other_id), ['A1', 'A2', 'A3']);
  assert.deepEqual(others, []);
  assert.equal(roster[0].unread, 0);
  assert.equal(roster[0].last_message, '');
});

test('buildChatSections 는 대화 이력을 관리자 행에 병합하고 중복시키지 않는다', () => {
  const threads = [
    { other_id: 'A3', other_name: '다오프', last_message: '확인했습니다', last_at: '2026-07-30T09:00:00', unread: 0 },
  ];
  const { roster, others } = buildChatSections(CONTACTS, threads);
  const a3 = roster.find((r) => r.other_id === 'A3');
  assert.equal(a3.last_message, '확인했습니다');
  assert.equal(a3.last_at, '2026-07-30T09:00:00');
  // 관리자 행이 곧 대화 행 — 기타 대화로 중복 노출되지 않는다.
  assert.deepEqual(others, []);
});

test('buildChatSections 는 로스터에 없는 상대를 기타 대화로 분리한다', () => {
  const threads = [
    { other_id: 'U9', other_name: '일반사용자', last_message: '문의합니다', last_at: '2026-07-30T10:00:00', unread: 1 },
  ];
  const { roster, others } = buildChatSections(CONTACTS, threads);
  assert.deepEqual(roster.map((r) => r.other_id), ['A1', 'A2', 'A3']);
  assert.deepEqual(others.map((o) => o.other_id), ['U9']);
  assert.equal(others[0].name, '일반사용자');
  // 상태 출처가 contacts 뿐이라 알 수 없음 → null (점·라벨을 생략하기 위한 신호)
  assert.equal(others[0].status, null);
});

test('buildChatSections 는 contacts 가 비어도 기존 대화를 잃지 않는다', () => {
  const threads = [
    { other_id: 'A1', other_name: '가온라인', last_message: 'hi', last_at: '2026-07-30T10:00:00', unread: 2 },
  ];
  const { roster, others } = buildChatSections([], threads);
  assert.deepEqual(roster, []);
  assert.deepEqual(others.map((o) => o.other_id), ['A1']);
  assert.equal(others[0].unread, 2);
});

test('buildChatSections 는 인자가 없어도 빈 섹션을 준다', () => {
  assert.deepEqual(buildChatSections(), { roster: [], others: [] });
});

test('sortRoster 는 미읽음 있는 행을 접속 상태보다 먼저 올린다', () => {
  const rows = [
    { other_id: 'A1', name: '가온라인', status: 'online', unread: 0 },
    { other_id: 'A3', name: '다오프', status: 'offline', unread: 3 },
    { other_id: 'A2', name: '나유휴', status: 'idle', unread: 0 },
  ];
  assert.deepEqual(sortRoster(rows).map((r) => r.other_id), ['A3', 'A1', 'A2']);
});

test('sortRoster 는 같은 조건이면 이름순이며 원본을 변경하지 않는다', () => {
  const rows = [
    { other_id: 'B', name: '나나', status: 'online', unread: 0 },
    { other_id: 'A', name: '가가', status: 'online', unread: 0 },
  ];
  const sorted = sortRoster(rows);
  assert.deepEqual(sorted.map((r) => r.other_id), ['A', 'B']);
  assert.deepEqual(rows.map((r) => r.other_id), ['B', 'A']);
});

test('statusLabel 은 한국어 라벨을 주고 알 수 없는 상태는 빈 문자열이다', () => {
  assert.equal(statusLabel('online'), '온라인');
  assert.equal(statusLabel('idle'), '자리비움');
  assert.equal(statusLabel('offline'), '오프라인');
  assert.equal(statusLabel(null), '');
  assert.equal(statusLabel('bogus'), '');
});

test('statusDotClass 는 상태별로 다른 색을 주고 기본값은 회색이다', () => {
  assert.equal(statusDotClass('online'), 'bg-emerald-500');
  assert.equal(statusDotClass('idle'), 'bg-amber-400');
  assert.equal(statusDotClass('offline'), 'bg-slate-300');
  assert.equal(statusDotClass(undefined), 'bg-slate-300');
});

test('formatChatTime 은 빈 값·잘못된 값에 빈 문자열을 준다', () => {
  assert.equal(formatChatTime(null), '');
  assert.equal(formatChatTime(''), '');
  assert.equal(formatChatTime('not-a-date'), '');
});
