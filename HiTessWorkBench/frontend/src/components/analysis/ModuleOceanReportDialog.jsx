import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { getAuthHeaders } from '../../utils/auth';

/**
 * 해상 운송 구조해석 보고서(XLSX) 생성 대화상자.
 *
 * ★ 그림은 **백엔드가 그린다**. 예전에는 이 대화상자가 3D 뷰어를 띄워 화면을 캡처해
 *   base64 로 올려 보냈는데, 그러면 해석 화면이 떠 있어야만 보고서가 나오고 이력에서
 *   다시 뽑을 수도 없었다. Unit 권상 보고서와 같은 방침으로 바꿨다(CLAUDE.md).
 *   그래서 이 컴포넌트가 서버에 보내는 것은 **해석 id 하나**뿐이다.
 */

// 서버가 LC 마다 3D 를 한 장씩 그린다(실측 약 2초/장 + 조립). 진행률은 서버 값이
// 아니라 예상 대비 경과라 95% 에서 멈추고, 초과하면 '마무리 중'으로 바꾼다.
const BASE_SECONDS = 8;
const SECONDS_PER_CASE = 2.5;

export default function ModuleOceanReportDialog({
  open, onClose, analysisId, result, onNotify,
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(null);

  const caseCount = result?.stress?.loadCases?.length || 1;
  const expected = BASE_SECONDS + SECONDS_PER_CASE * caseCount;

  useEffect(() => {
    if (!open) {
      startedRef.current = null;
      setError(null);
      setWarnings([]);
      setElapsed(0);
    }
  }, [open]);

  useEffect(() => {
    if (!generating) return undefined;
    const timer = setInterval(() => setElapsed(v => v + 0.5), 500);
    return () => clearInterval(timer);
  }, [generating]);

  const generate = useCallback(async () => {
    if (!analysisId) {
      setError('해석 기록을 찾을 수 없습니다. 3단계를 다시 실행한 뒤 시도해 주세요.');
      return;
    }
    setGenerating(true);
    setError(null);
    setWarnings([]);
    setElapsed(0);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/analysis/module-ocean-transport/structural-report`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            analysis_id: analysisId,
            metadata: {
              project: result?.inputSnapshot?.bdfPath?.split(/[/\\]/).pop()
                ?.replace(/\.bdf$/i, '') || 'ModuleUnit',
              reportDate: new Date().toISOString().slice(0, 10),
              runId: result?.runId,
            },
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `보고서 생성 실패 (${response.status})`);
      }
      const blob = await response.blob();
      const encoded = response.headers.get('x-report-filename');
      const filename = encoded
        ? decodeURIComponent(encoded)
        : 'ModuleUnit_해상운송_구조해석_보고서.xlsx';

      // 자리표시로 대체된 그림이 있으면 알려 준다 — 조용히 빠지면 사용자가 모른다.
      let summary = null;
      try {
        const raw = response.headers.get('x-report-summary');
        summary = raw ? JSON.parse(decodeURIComponent(raw)) : null;
      } catch { /* 요약 헤더가 깨져도 파일 저장은 막지 않는다 */ }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      const notes = summary?.warnings || [];
      if (notes.length) {
        setWarnings(notes);
        onNotify?.(`보고서를 만들었습니다. 확인할 항목 ${notes.length}건이 있습니다.`, 'warning');
      } else {
        onNotify?.('구조해석 보고서를 생성했습니다.', 'success');
        onClose?.();
      }
    } catch (err) {
      const message = err?.message || '보고서 생성에 실패했습니다.';
      setError(message);
      onNotify?.(message, 'error');
    } finally {
      setGenerating(false);
    }
  }, [analysisId, result, onNotify, onClose]);

  // 열릴 때 한 번만 자동 실행한다. 사용자가 이미 '보고서' 버튼을 눌러 의사를 밝혔다.
  useEffect(() => {
    if (!open || startedRef.current === analysisId) return;
    startedRef.current = analysisId;
    generate();
  }, [open, analysisId, generate]);

  if (!open) return null;

  const pct = Math.min(95, Math.round((elapsed / expected) * 100));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <FileSpreadsheet size={17} className="text-blue-600" /> 구조해석 보고서 생성
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              저장된 해석 결과로 XLSX 보고서를 만듭니다. 3D 그림은 서버가 직접 그립니다.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={generating}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            title="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-6">
          {error ? (
            <div className="text-center">
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
                {error}
              </p>
              <button type="button" onClick={generate}
                className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700">
                다시 생성
              </button>
            </div>
          ) : warnings.length ? (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                <AlertTriangle size={14} /> 보고서를 저장했습니다 · 확인할 항목 {warnings.length}건
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3">
                {warnings.map((note, index) => (
                  <li key={index} className="text-[11px] leading-relaxed text-amber-900">· {note}</li>
                ))}
              </ul>
              <button type="button" onClick={onClose}
                className="mt-4 w-full rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-900">
                닫기
              </button>
            </div>
          ) : (
            <div className="text-center">
              <Loader2 size={26} className="mx-auto animate-spin text-blue-600" />
              <p className="mt-3 text-sm font-bold text-slate-700">
                {elapsed > expected ? '마무리 중' : '보고서 생성 중'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                하중조건 {caseCount}개 · 예상 {Math.round(expected)}초 · 경과 {Math.round(elapsed)}초
              </p>
              <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-3 text-[11px] text-slate-400">완료되면 파일 저장이 자동으로 시작됩니다.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
