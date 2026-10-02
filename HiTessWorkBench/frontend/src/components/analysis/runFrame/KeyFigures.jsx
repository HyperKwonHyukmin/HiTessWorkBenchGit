import React from 'react';

/**
 * 공통 틀 — 핵심 수치 행(성적서의 데이터 행). 큰 숫자 + 작은 라벨을 카드로 띄우지 않고
 * 한 줄 표처럼 칸을 나눠 보여 준다(hero-metric 카드 반복 대신).
 *
 * items: [{ key, label, value, unit?, sub?, tone?: 'default'|'warn'|'bad' }]
 */
const TONE = { default: 'text-slate-900', warn: 'text-amber-700', bad: 'text-red-700' };

export default function KeyFigures({ items, caption }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* 칸이 좁아지면(1366 등) 줄을 바꾼다. flex-wrap + grow 라 마지막 줄도 빈칸 없이 채워지고,
          칸 사이 선은 gap-px + 회색 바탕으로 그려 줄이 바뀌어도 맞는다. */}
      <dl className="flex flex-wrap gap-px bg-slate-200">
        {items.map((it) => (
          <div key={it.key} className="min-w-0 flex-[1_1_132px] bg-white px-4 py-3">
            <dt className="truncate text-xs font-semibold text-slate-600">{it.label}</dt>
            <dd className={`mt-0.5 whitespace-nowrap font-mono text-lg font-bold tabular-nums ${TONE[it.tone] ?? TONE.default}`}>
              {it.value}
              {it.unit && <span className="ml-1 text-xs font-semibold text-slate-600">{it.unit}</span>}
            </dd>
            {it.sub && <p className="truncate text-xs text-slate-600" title={typeof it.sub === 'string' ? it.sub : undefined}>{it.sub}</p>}
          </div>
        ))}
      </dl>
      {caption && <p className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-600">{caption}</p>}
    </div>
  );
}
