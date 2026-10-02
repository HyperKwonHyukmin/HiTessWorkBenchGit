import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

/**
 * 공통 틀 — 판정 머리. 결과 화면 맨 위에서 "다음 단계로 넘겨도 되는가"에 한 줄로 답한다.
 * 판정은 통과 / 검토 필요 / 실패 셋뿐이며 색 + 아이콘 + 글자를 함께 쓴다.
 *
 * level:   'pass' | 'review' | 'fail'
 * title:   판정 문구(예: '통과', '검토 필요')
 * summary: 판정 옆 한 줄 설명(무엇을 기준으로 봤는지)
 * reasons: [{ code, text }] — '검토 필요'·'실패'의 사유. 3줄 안쪽으로 둔다.
 * meta:    오른쪽 끝 보조 정보(예: '편집 모델 기준')
 */
const TONE = {
  pass:   { icon: CheckCircle2,  box: 'border-emerald-200 bg-emerald-50', title: 'text-emerald-800', icon_cls: 'text-emerald-600', text: 'text-emerald-900' },
  review: { icon: AlertTriangle, box: 'border-amber-200 bg-amber-50',     title: 'text-amber-900',   icon_cls: 'text-amber-600',   text: 'text-amber-900' },
  fail:   { icon: XCircle,       box: 'border-red-200 bg-red-50',         title: 'text-red-800',     icon_cls: 'text-red-600',     text: 'text-red-900' },
};

export default function VerdictHeader({ level, title, summary, reasons = [], meta, children }) {
  const t = TONE[level];
  if (!t) return null;
  const Icon = t.icon;
  return (
    <section
      aria-live="polite"
      aria-label={`판정: ${title}`}
      className={`rounded-xl border px-4 py-3.5 ${t.box}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon size={20} className={`shrink-0 ${t.icon_cls}`} aria-hidden="true" />
        <h2 className={`text-base font-extrabold ${t.title}`}>{title}</h2>
        {summary && <p className={`min-w-0 text-sm ${t.text}`}>{summary}</p>}
        {meta && <span className="ml-auto shrink-0 text-xs font-semibold text-slate-600">{meta}</span>}
      </div>
      {reasons.length > 0 && (
        <ul className={`mt-2 space-y-1 pl-8 text-sm leading-relaxed ${t.text}`}>
          {reasons.map((r) => (
            <li key={r.code} className="list-disc">{r.text}</li>
          ))}
        </ul>
      )}
      {children && <div className="mt-3 pl-8">{children}</div>}
    </section>
  );
}
