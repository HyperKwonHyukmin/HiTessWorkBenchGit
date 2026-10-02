import React from 'react';
import { AlertCircle, CheckCircle2, FileText, MinusCircle } from 'lucide-react';

/**
 * 공통 틀 — 입력 요약. 업로드한 입력 파일을 어느 단계에서나 보이게 한다.
 * 결과 단계로 넘어가도 "무엇으로 돌렸는지"를 기억할 필요가 없게 하려는 것이다.
 *
 * items: [{ key, label, fileName?, state: 'ok'|'warn'|'error'|'empty', note? }]
 */
const STATE = {
  ok:    { icon: CheckCircle2, cls: 'text-emerald-600' },
  warn:  { icon: AlertCircle,  cls: 'text-amber-600' },
  error: { icon: AlertCircle,  cls: 'text-red-600' },
  empty: { icon: MinusCircle,  cls: 'text-slate-400' },
};

export default function InputSummary({ title = '입력', items, footer }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-xs font-bold text-slate-600">{title}</h3>
      <ul className="space-y-1">
        {items.map((it) => {
          const s = STATE[it.state] ?? STATE.empty;
          const Icon = it.fileName ? s.icon : MinusCircle;
          return (
            <li key={it.key} className="flex min-w-0 items-center gap-2 text-xs">
              <Icon size={13} className={`shrink-0 ${it.fileName ? s.cls : 'text-slate-400'}`} aria-hidden="true" />
              <span className="w-[68px] shrink-0 font-semibold text-slate-700">{it.label}</span>
              {it.fileName ? (
                <span className="flex min-w-0 items-center gap-1 text-slate-600" title={it.fileName}>
                  <FileText size={11} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="truncate font-mono">{it.fileName}</span>
                </span>
              ) : (
                <span className="text-slate-500">{it.note ?? '없음'}</span>
              )}
            </li>
          );
        })}
      </ul>
      {footer}
    </section>
  );
}
