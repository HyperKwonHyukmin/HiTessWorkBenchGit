/**
 * @fileoverview FileReader 기반 파일 파싱 공통 훅.
 * TrussAnalysis, BeamAnalysisViewer, TrussAssessment 등에서 공통으로 사용합니다.
 *
 * @example
 * const { readFile, isReading } = useFileParser(
 *   (text) => JSON.parse(text),       // parseFn: text → result
 *   (result) => setData(result),       // onSuccess
 *   (err) => console.error(err)        // onError (optional)
 * );
 * <input type="file" onChange={(e) => readFile(e.target.files[0])} />
 */
import { useState, useCallback } from 'react';

/**
 * @param {(text: string, file: File) => any} parseFn - 파일 텍스트를 받아 파싱 결과를 반환하는 함수
 * @param {(result: any, file: File) => void} onSuccess - 파싱 성공 콜백
 * @param {(error: Error, file: File) => void} [onError] - 파싱 실패 콜백 (선택)
 * @param {string} [encoding='UTF-8'] - 파일 인코딩
 */
export function useFileParser(parseFn, onSuccess, onError, encoding = 'UTF-8') {
  const [isReading, setIsReading] = useState(false);

  const readFile = useCallback((file) => {
    if (!file) return;

    setIsReading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const result = parseFn(e.target.result, file);
        onSuccess(result, file);
      } catch (err) {
        if (onError) {
          onError(err, file);
        } else {
          console.error(`[useFileParser] 파싱 오류 (${file.name}):`, err);
        }
      } finally {
        setIsReading(false);
      }
    };

    reader.onerror = () => {
      const err = new Error(`파일 읽기 실패: ${file.name}`);
      if (onError) {
        onError(err, file);
      } else {
        console.error('[useFileParser]', err.message);
      }
      setIsReading(false);
    };

    reader.readAsText(file, encoding);
  }, [parseFn, onSuccess, onError, encoding]);

  return { readFile, isReading };
}

/**
 * CSV 텍스트를 2D 배열로 파싱하는 기본 파서 (헬퍼 함수)
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  return text
    .trim()
    .split('\n')
    .filter(row => row.trim() !== '')
    .map(row => row.split(',').map(cell => cell.trim()));
}

/**
 * TSV(탭 구분) 텍스트를 객체 배열로 파싱하는 기본 파서 (헬퍼 함수)
 * @param {string} text
 * @returns {Object[]}
 */
export function parseTsvText(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    const obj = {};
    headers.forEach((header, idx) => {
      const parsed = parseFloat(values[idx]);
      obj[header] = isNaN(parsed) ? values[idx]?.trim() : parsed;
    });
    return obj;
  });
}
