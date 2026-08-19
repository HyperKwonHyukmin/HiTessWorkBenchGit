import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCsvRows,
  decodeCsvBuffer,
  sliceCsvPreview,
  PREVIEW_ROW_LIMIT,
  EXPANDED_ROW_LIMIT,
} from './csvPreview.js';

/* ── parseCsvRows ─────────────────────────────────────────────────────── */

test('헤더와 데이터 행을 2차원 배열로 나눈다', () => {
  const { rows, totalRows, truncated } = parseCsvRows(
    'name,type,pos\nS1,GENSEC,X 0mm\nS2,GENSEC,X 500mm\n',
  );

  assert.deepEqual(rows[0], ['name', 'type', 'pos']);
  assert.deepEqual(rows[1], ['S1', 'GENSEC', 'X 0mm']);
  assert.equal(totalRows, 3);
  assert.equal(truncated, false);
});

test('따옴표로 감싼 필드 안의 쉼표는 값의 일부다', () => {
  // 순진한 split(',') 이면 여기서 컬럼이 밀려 표 전체가 어긋난다.
  const { rows } = parseCsvRows('name,remark\nP1,"65A, SCH40, 보온재 포함"\n');

  assert.deepEqual(rows[1], ['P1', '65A, SCH40, 보온재 포함']);
});

test('따옴표 안의 개행은 행을 끊지 않는다', () => {
  const { rows, totalRows } = parseCsvRows('name,remark\nP1,"1줄\n2줄"\nP2,단일\n');

  assert.equal(totalRows, 3);
  assert.deepEqual(rows[1], ['P1', '1줄\n2줄']);
  assert.deepEqual(rows[2], ['P2', '단일']);
});

test('이중 따옴표("")는 따옴표 한 개로 풀린다', () => {
  const { rows } = parseCsvRows('name,size\nS1,"3"" pipe"\n');

  assert.deepEqual(rows[1], ['S1', '3" pipe']);
});

test('CRLF 줄바꿈도 LF 와 똑같이 처리한다', () => {
  const { rows, totalRows } = parseCsvRows('a,b\r\n1,2\r\n3,4\r\n');

  assert.equal(totalRows, 3);
  assert.deepEqual(rows[2], ['3', '4']);
});

test('BOM 은 첫 컬럼명에 섞여 들어가지 않는다', () => {
  // BOM 을 안 벗기면 헤더가 '﻿name' 이 되어 컬럼 매칭이 조용히 실패한다.
  const { rows } = parseCsvRows('﻿name,type\nS1,GENSEC\n');

  assert.deepEqual(rows[0], ['name', 'type']);
});

test('빈 줄과 파일 끝 개행은 데이터 행으로 세지 않는다', () => {
  const { rows, totalRows } = parseCsvRows('a,b\n1,2\n\n3,4\n\n');

  assert.equal(totalRows, 3);
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('빈 값이 든 행은 유지한다 (빈 줄과 구분)', () => {
  const { rows, totalRows } = parseCsvRows('a,b,c\n1,,3\n');

  assert.equal(totalRows, 2);
  assert.deepEqual(rows[1], ['1', '', '3']);
});

test('헤더만 있는 파일은 데이터 행 0개로 읽힌다', () => {
  const { rows, totalRows } = parseCsvRows('name,type,pos\n');

  assert.equal(totalRows, 1);
  assert.equal(rows.length, 1);
});

test('빈 문자열은 빈 결과를 돌려준다', () => {
  assert.deepEqual(parseCsvRows(''), { rows: [], totalRows: 0, truncated: false });
});

test('마지막 줄에 개행이 없어도 행을 잃지 않는다', () => {
  const { rows, totalRows } = parseCsvRows('a,b\n1,2');

  assert.equal(totalRows, 2);
  assert.deepEqual(rows[1], ['1', '2']);
});

test('maxRows 를 넘으면 잘라내되 totalRows 는 원본 행 수를 유지한다', () => {
  const text = 'a,b\n' + Array.from({ length: 50 }, (_, i) => `${i},x`).join('\n');

  const { rows, totalRows, truncated } = parseCsvRows(text, { maxRows: 10 });

  assert.equal(rows.length, 10);
  assert.equal(totalRows, 51);
  assert.equal(truncated, true);
});

test('앞뒤 공백은 값의 일부로 보존한다', () => {
  // struData 의 ori 컬럼은 '   1.000   0.000   0.000' 처럼 정렬 공백을 담고 온다.
  const { rows } = parseCsvRows('name,ori\nS1,   1.000   0.000\n');

  assert.deepEqual(rows[1], ['S1', '   1.000   0.000']);
});

/* ── decodeCsvBuffer ──────────────────────────────────────────────────── */

test('UTF-8 CSV 는 그대로 디코딩한다', () => {
  const bytes = new TextEncoder().encode('이름,종류\n기둥,GENSEC\n');

  assert.equal(decodeCsvBuffer(bytes), '이름,종류\n기둥,GENSEC\n');
});

test('cp949(euc-kr) CSV 는 폴백 디코딩으로 한글이 살아난다', () => {
  // 엑셀에서 저장한 사내 CSV 는 대부분 cp949 다. UTF-8 로만 읽으면 전부 '?' 가 된다.
  const eucKr = Buffer.from([
    0xC0, 0xCC, 0xB8, 0xA7, 0x2C, 0xC1, 0xBE, 0xB7, 0xF9, 0x0A,  // 이름,종류\n
    0xB1, 0xE2, 0xB5, 0xD5, 0x2C, 0x47, 0x45, 0x4E,              // 기둥,GEN
  ]);

  const text = decodeCsvBuffer(eucKr);

  assert.ok(text.startsWith('이름,종류'), `한글이 깨졌다: ${JSON.stringify(text)}`);
  assert.ok(text.includes('기둥,GEN'));
});

test('ASCII 전용 CSV 는 인코딩 판별과 무관하게 동일하다', () => {
  const bytes = new TextEncoder().encode('name,type\nS1,GENSEC\n');

  assert.equal(decodeCsvBuffer(bytes), 'name,type\nS1,GENSEC\n');
});

/* ── sliceCsvPreview ──────────────────────────────────────────────────── */

test('기본 상태에서는 상위 500 데이터 행만 그린다', () => {
  const rows = [['a', 'b'], ...Array.from({ length: 1200 }, (_, i) => [`${i}`, 'x'])];

  const { header, bodyRows, shownCount, hiddenCount } = sliceCsvPreview(rows, false);

  assert.deepEqual(header, ['a', 'b']);
  assert.equal(bodyRows.length, PREVIEW_ROW_LIMIT);
  assert.equal(shownCount, 500);
  assert.equal(hiddenCount, 700);
});

test("'전체 보기' 는 상한까지 펼치고 남는 행이 없으면 hiddenCount 가 0 이다", () => {
  const rows = [['a', 'b'], ...Array.from({ length: 1200 }, (_, i) => [`${i}`, 'x'])];

  const { shownCount, hiddenCount } = sliceCsvPreview(rows, true);

  assert.equal(shownCount, 1200);
  assert.equal(hiddenCount, 0);
});

test("'전체 보기' 도 표시 상한을 넘기지 않는다", () => {
  // 미리보기가 브라우저를 멈추게 두느니 상한을 알리고 자른다.
  const rows = [['a', 'b'], ...Array.from({ length: 9000 }, (_, i) => [`${i}`, 'x'])];

  const { shownCount, hiddenCount } = sliceCsvPreview(rows, true);

  assert.equal(shownCount, EXPANDED_ROW_LIMIT);
  assert.equal(hiddenCount, 4000);
});

test('행이 없으면 빈 헤더/본문을 돌려준다', () => {
  assert.deepEqual(sliceCsvPreview([], false), {
    header: [], bodyRows: [], shownCount: 0, hiddenCount: 0,
  });
  assert.deepEqual(sliceCsvPreview(null, false), {
    header: [], bodyRows: [], shownCount: 0, hiddenCount: 0,
  });
});

test('헤더만 있으면 본문은 비고 헤더는 살아있다', () => {
  const { header, bodyRows } = sliceCsvPreview([['name', 'type']], false);

  assert.deepEqual(header, ['name', 'type']);
  assert.equal(bodyRows.length, 0);
});
