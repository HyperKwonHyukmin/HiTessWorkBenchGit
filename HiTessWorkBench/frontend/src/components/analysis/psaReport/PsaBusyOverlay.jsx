// PSA 평가보고서 — 올리기와 파일 찾기 동안 화면을 막는 진행 창.
// 끝나기 전에 다른 칸을 고치거나 [보고서 만들기]를 누르면 반쯤 올라간 폴더로 판정하게 되므로 조작을 막는다.
// 오류가 나면 창은 닫히고(서버 확인 실패는 '보고서 파일 확인' 단계에 그대로 보인다) 다시 시도할 수 있다.
import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * phase = 'upload' | 'check'
 * upload = { done, total, current } — 올린 파일 수, 전체, 지금 올리는 폴더 이름(없으면 생략)
 */
export default function PsaBusyOverlay({ open, phase, upload }) {
  if (!open) return null;
  const pct = upload?.total ? Math.min(100, Math.round((upload.done / upload.total) * 100)) : null;
  const title = phase === 'upload' ? '폴더를 서버에 올리는 중입니다' : '보고서에 쓸 파일을 찾는 중입니다';
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby="psa-busy-title"
        aria-describedby="psa-busy-desc"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <Loader2 size={22} className="shrink-0 animate-spin text-brand-blue motion-reduce:animate-none" aria-hidden="true" />
          <h2 id="psa-busy-title" className="text-base font-bold text-slate-900">{title}</h2>
        </div>
        <p id="psa-busy-desc" className="mt-2 text-sm text-slate-600">
          끝날 때까지 다른 입력은 잠시 막아 둡니다.
        </p>
        {phase === 'upload' && upload?.total > 0 && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs text-slate-700">
              <span className="truncate pr-2">{upload.current || '파일'}</span>
              <span className="shrink-0 font-semibold tabular-nums">{upload.done.toLocaleString()} / {upload.total.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
              <div className="h-full rounded-full bg-brand-blue transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
