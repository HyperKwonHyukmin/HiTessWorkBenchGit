/**
 * 공용 파일 헬퍼 유틸리티
 */

/**
 * 파일 경로에서 파일명 추출 (Windows/Unix 경로 모두 지원)
 * @param {string} filePath
 * @returns {string}
 */
export function extractFilename(filePath) {
  if (!filePath) return '';
  return filePath.split('\\').pop().split('/').pop();
}

/**
 * 파일 경로에서 확장자 추출 (점 포함, 없으면 빈 문자열)
 * @param {string} filePath
 * @returns {string}
 */
export function getFileExtension(filePath) {
  const name = extractFilename(filePath);
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx) : '';
}

/**
 * 객체를 JSON 파일로 브라우저에서 다운로드한다.
 *
 * 4 개 calculator 페이지(Carling/DTypeLug/JibRest/MastPost) 가 module-level 에서
 * 각자 정의하던 동일 구현을 단일 유틸로 통합.
 *
 *     downloadJson(payload, 'mast_post_input.json');
 *
 * @param {object} data       직렬화할 객체.
 * @param {string} filename   다운로드 파일명 (확장자 포함).
 */
/**
 * 객체에서 FormData 인스턴스를 생성한다.
 *
 * 5+ 페이지가 axios multipart 요청 직전 반복하던
 *     const fd = new FormData();
 *     fd.append('bdf_file', file);
 *     fd.append('employee_id', employeeId);
 *     fd.append('source', 'Workbench');
 * 패턴을 한 호출로 압축:
 *     const fd = buildFormData({ bdf_file: file, employee_id, source: 'Workbench' });
 *
 * null / undefined 값은 자동 스킵 (선택적 옵션 필드용). boolean 은 문자열로 변환.
 *
 * @param {Record<string, any>} fields
 * @returns {FormData}
 */
export function buildFormData(fields) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    fd.append(key, value);
  }
  return fd;
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Blob(서버에서 받은 바이너리 응답 등)을 브라우저에서 파일로 다운로드한다.
 *
 *     downloadBlob(res.data, 'report.xlsm', res.headers['content-type']);
 *
 * @param {Blob|ArrayBuffer} data   바이너리 데이터.
 * @param {string} filename         다운로드 파일명 (확장자 포함).
 * @param {string} [mimeType]       MIME 타입 (생략 시 octet-stream).
 */
export function downloadBlob(data, filename, mimeType = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Content-Disposition 헤더에서 filename 을 추출한다. 없으면 fallback 반환.
 * @param {string} disposition  Content-Disposition 헤더 값.
 * @param {string} fallback     추출 실패 시 사용할 파일명.
 * @returns {string}
 */
export function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* noop */ } }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}
