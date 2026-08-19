import test from 'node:test';
import assert from 'node:assert/strict';

import { filenameFromDisposition } from './fileHelper.js';

// 백엔드 app/routers/reports.py::_content_disposition 이 실제로 내보내는 헤더 값.
// 한글 이름은 latin-1 헤더에 raw 로 못 실어서 RFC 5987 두 벌로 나간다.
const KOREAN_APP =
  'attachment; filename="Rule_Calculation_p_1.xlsx"; '
  + "filename*=UTF-8''%EC%84%A0%EA%B8%89_Rule_%EA%B8%B0%EB%B0%98_%EC%84%A0%EC%B2%B4"
  + '_%EA%B0%80%EC%86%8D%EB%8F%84_Calculation_p_1.xlsx';

const ASCII_APP =
  'attachment; filename="Column_Buckling_Load_Calculator_Deck_A_7.xlsx"; '
  + "filename*=UTF-8''Column_Buckling_Load_Calculator_Deck_A_7.xlsx";

test('한글 App 계산서는 ASCII 폴백이 아니라 UTF-8 이름으로 저장된다', () => {
  // 순진하게 filename= 만 읽으면 'Rule_Calculation_p_1.xlsx' 를 집어가서
  // 사용자는 어느 App 결과인지 여전히 알 수 없다.
  assert.equal(
    filenameFromDisposition(KOREAN_APP, 'fallback.xlsx'),
    '선급_Rule_기반_선체_가속도_Calculation_p_1.xlsx',
  );
});

test('ASCII 이름은 두 벌이 같아도 그대로 읽힌다', () => {
  assert.equal(
    filenameFromDisposition(ASCII_APP, 'fallback.xlsx'),
    'Column_Buckling_Load_Calculator_Deck_A_7.xlsx',
  );
});

test('헤더가 비어 있으면 폴백을 쓴다', () => {
  // CORS 로 노출하지 않으면 브라우저가 JS 에게 헤더를 숨긴다 — 이때 걸리는 경로다.
  assert.equal(filenameFromDisposition('', 'WorkBench_Report_7.xlsx'), 'WorkBench_Report_7.xlsx');
  assert.equal(
    filenameFromDisposition(undefined, 'WorkBench_Report_7.xlsx'),
    'WorkBench_Report_7.xlsx',
  );
});

test('filename* 이 깨져 있으면 ASCII 쪽으로 물러선다', () => {
  const broken = 'attachment; filename="safe.xlsx"; filename*=UTF-8\'\'%E0%A4%A';
  assert.equal(filenameFromDisposition(broken, 'fallback.xlsx'), 'safe.xlsx');
});
