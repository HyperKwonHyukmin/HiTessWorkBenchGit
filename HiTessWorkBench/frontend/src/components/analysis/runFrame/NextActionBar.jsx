import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * 공통 틀 — 다음 행동 바. 판정 머리 바로 아래에서 "지금 할 일" 하나를 주 버튼으로 보여 준다.
 * 주 버튼은 1개, 보조 버튼은 2개까지. 나머지 행동은 해당 단계 본문 안에 둔다.
 * ⚠ 화면 하단에 고정(sticky bottom)하지 말 것 — 오른쪽 아래 전역 작업·메시지 도크가 주 버튼을 가린다(1920 실측).
 *
 * primary:   { label, icon?, onClick, disabled?, busy?, title? }
 * secondary: [{ key, label, icon?, onClick, disabled?, title? }]
 * note:      왼쪽 한 줄 안내(지금 무엇을 하면 되는지)
 */
export default function NextActionBar({ note, primary, secondary = [] }) {
  if (!primary && secondary.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      {note && <p className="min-w-0 flex-1 text-sm text-slate-700">{note}</p>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {secondary.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              title={a.title}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {Icon && <Icon size={15} aria-hidden="true" />}
              {a.label}
            </button>
          );
        })}
        {primary && (() => {
          const Icon = primary.icon;
          return (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled || primary.busy}
              title={primary.title}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {primary.busy
                ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                : Icon && <Icon size={15} aria-hidden="true" />}
              {primary.label}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
