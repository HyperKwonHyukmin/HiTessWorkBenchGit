import React from 'react';
import { Loader2 } from 'lucide-react';
import AnimatedNumber from '../../ui/AnimatedNumber';
import ProgressTrack from '../../ui/ProgressBar';

/**
 * 공통 틀 — 실행 진행 카드. 진행 표시는 이 카드 한 곳(+ 전역 작업 도크)에만 둔다.
 * 실행 버튼 안 타이머·본문 스피너를 따로 두지 않는다(같은 진행이 여러 곳에 뜨면 시끄럽다).
 */
const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`);

export default function JobProgressCard({ title = '실행 중', message, progress = 0, elapsed, note }) {
  return (
    <section aria-live="polite" aria-label={title} className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Loader2 size={15} className="shrink-0 animate-spin text-blue-600" aria-hidden="true" />
        <p className="text-sm font-bold text-blue-900">{title}</p>
        <p className="min-w-0 flex-1 truncate text-sm text-blue-900">{message}</p>
        {elapsed != null && <span className="shrink-0 font-mono text-xs text-slate-600">{fmtTime(elapsed)}</span>}
        <span className="shrink-0 font-mono text-sm font-bold text-blue-700"><AnimatedNumber value={progress ?? 0} />%</span>
      </div>
      <ProgressTrack value={progress ?? 0} status="running" size="sm" trackClassName="bg-blue-100" />
      {note && <p className="mt-2 text-xs text-slate-600">{note}</p>}
    </section>
  );
}
