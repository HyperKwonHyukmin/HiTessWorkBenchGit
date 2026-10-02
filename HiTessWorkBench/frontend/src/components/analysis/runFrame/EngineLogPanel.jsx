import React, { useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';

/**
 * 공통 틀 — 엔진 출력. 실패했을 때만 보이고 기본은 접혀 있다.
 * 사용자가 먼저 읽을 것은 판정 머리의 원인·조치이고, 원문 로그는 문의·디버깅용이다.
 */
export default function EngineLogPanel({ log, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!log) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
      >
        <Terminal size={14} className="text-slate-500" aria-hidden="true" />
        엔진 출력 원문
        <span className="text-xs font-normal text-slate-600">문의할 때 이 내용을 함께 보내 주세요</span>
        <ChevronDown size={14} className={`ml-auto text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-all border-t border-slate-100 bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800">
          {log}
        </pre>
      )}
    </section>
  );
}
