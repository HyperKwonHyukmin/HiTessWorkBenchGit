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
