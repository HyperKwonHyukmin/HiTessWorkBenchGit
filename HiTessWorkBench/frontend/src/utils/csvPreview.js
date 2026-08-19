/**
 * @fileoverview CSV 미리보기용 파싱 유틸.
 *
 * 사내 해석 입력 CSV 는 (1) 따옴표로 감싼 필드 안에 쉼표가 들어오고, (2) 엑셀에서
 * 저장하면 cp949(euc-kr) 로 떨어지며, (3) BOM/CRLF 가 섞여 온다. 화면에 표로 뿌리기
 * 전에 이 세 가지를 한 곳에서 흡수한다.
 *
 * 표시 상한을 여기 두는 이유: 미리보기는 '포맷 확인' 이 목적이라 수만 행을 DOM 에
 * 그릴 필요가 없다. 실제 전량 검증은 실행 후 InputAudit(CsvAuditPanel) 이 담당한다.
 */

/** 기본 표시 행 수(데이터 행 기준). */
export const PREVIEW_ROW_LIMIT = 500;

/** '전체 보기' 를 눌렀을 때의 표시 상한(데이터 행 기준). */
export const EXPANDED_ROW_LIMIT = 5000;

/** 파싱 단계 안전밸브 — 병적으로 큰 파일에서 메모리를 지키기 위한 상한(헤더 포함). */
export const MAX_PARSE_ROWS = 200000;

const BOM = 0xFEFF;
const REPLACEMENT = '�';

function stripBom(text) {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

function countReplacementChars(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === REPLACEMENT) n += 1;
  }
  return n;
}

/**
 * CSV 텍스트를 2차원 배열로 파싱한다.
 *
 * RFC4180 수준의 따옴표 처리를 지원한다 — 따옴표로 감싼 필드 안의 쉼표/개행은
 * 필드의 일부로 취급하고, `""` 는 따옴표 한 개로 푼다. 완전 공백 행은 버린다.
 *
 * @param {string} text
 * @param {{ maxRows?: number }} [options]
 * @returns {{ rows: string[][], totalRows: number, truncated: boolean }}
 *   rows[0] 이 헤더. totalRows 는 잘라내기 **이전** 전체 행 수(헤더 포함).
 */
export function parseCsvRows(text, { maxRows = MAX_PARSE_ROWS } = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { rows: [], totalRows: 0, truncated: false };
  }

  const clean = stripBom(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let totalRows = 0;
  let truncated = false;

  const commitField = () => { row.push(field); field = ''; };
  const commitRow = () => {
    commitField();
    // 파일 끝 개행이나 중간 빈 줄이 만드는 [''] 행은 데이터가 아니다.
    const isBlank = row.length === 1 && row[0].trim() === '';
    if (!isBlank) {
      totalRows += 1;
      if (rows.length < maxRows) rows.push(row);
      else truncated = true;
    }
    row = [];
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch !== '"') { field += ch; continue; }
      if (clean[i + 1] === '"') { field += '"'; i += 1; continue; }
      inQuotes = false;
      continue;
    }

    if (ch === '"' && field === '') { inQuotes = true; continue; }
    if (ch === ',') { commitField(); continue; }
    if (ch === '\r') {
      if (clean[i + 1] === '\n') i += 1;
      commitRow();
      continue;
    }
    if (ch === '\n') { commitRow(); continue; }
    field += ch;
  }

  if (field !== '' || row.length > 0) commitRow();

  return { rows, totalRows, truncated };
}

/**
 * CSV 바이트를 문자열로 디코딩한다. UTF-8 을 먼저 시도하고, 깨진 글자(U+FFFD)가
 * 나오면 euc-kr(=cp949 상위집합)로 다시 읽어 덜 깨진 쪽을 택한다.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
export function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const utf8Broken = countReplacementChars(utf8);
  if (utf8Broken === 0) return utf8;

  try {
    const legacy = new TextDecoder('euc-kr').decode(bytes);
    return countReplacementChars(legacy) < utf8Broken ? legacy : utf8;
  } catch {
    // euc-kr 디코더가 없는 런타임 — UTF-8 결과라도 돌려준다.
    return utf8;
  }
}

function readFileArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`파일 읽기 실패: ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * File 객체를 읽어 미리보기용 행 배열로 만든다.
 *
 * @param {File} file
 * @returns {Promise<{ rows: string[][], totalRows: number, truncated: boolean }|null>}
 */
export async function readCsvFileRows(file) {
  if (!file) return null;
  const buffer = await readFileArrayBuffer(file);
  return parseCsvRows(decodeCsvBuffer(buffer));
}

/**
 * 표에 실제로 그릴 데이터 행을 잘라낸다.
 *
 * @param {string[][]} rows          parseCsvRows 결과(rows[0]=헤더)
 * @param {boolean}    expanded      '전체 보기' 활성 여부
 * @returns {{ header: string[], bodyRows: string[][], shownCount: number, hiddenCount: number }}
 */
export function sliceCsvPreview(rows, expanded) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { header: [], bodyRows: [], shownCount: 0, hiddenCount: 0 };
  }
  const header = rows[0];
  const body = rows.slice(1);
  const limit = expanded ? EXPANDED_ROW_LIMIT : PREVIEW_ROW_LIMIT;
  const bodyRows = body.length > limit ? body.slice(0, limit) : body;
  return {
    header,
    bodyRows,
    shownCount: bodyRows.length,
    hiddenCount: Math.max(body.length - bodyRows.length, 0),
  };
}
