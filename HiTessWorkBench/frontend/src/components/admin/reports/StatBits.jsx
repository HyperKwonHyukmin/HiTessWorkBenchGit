import React from 'react';
import { fmtDelta } from '../../../utils/newsletterStats';

/** 공지 조회 통계 패널(뉴스레터·업데이트 안내) 공용 조각. */

export function Kpi({ label, value, note }) {
  return (
    <div className="border border-slate-100 rounded-md px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-xl font-bold text-slate-800 tabular-nums">{value}</dd>
      {note && <dd className="text-[11px] text-slate-500">{note}</dd>}
    </div>
  );
}

export function DailyBars({ daily }) {
  if (!daily?.length) return <p className="text-xs text-slate-500">아직 조회가 없습니다.</p>;
  const max = Math.max(1, ...daily.map(d => d.views));
  return (
    <ul className="space-y-1.5">
      {daily.map(d => (
        <li key={d.day} className="grid grid-cols-[3.5rem_1fr_6rem] items-center gap-2 text-xs">
          <span className="text-slate-600 tabular-nums">{d.day.slice(5)}</span>
          <span className="h-2.5 bg-slate-100 rounded">
            <span className="block h-full bg-blue-500 rounded" style={{ width: `${(100 * d.views) / max}%` }} />
          </span>
          <span className="text-right tabular-nums text-slate-700">{d.views}회 · 방문 {d.visitors}</span>
        </li>
      ))}
    </ul>
  );
}

/** 전후 비교 표 — rows = [[key, label]], before/after = {key: 숫자}.
 * '후' 기간이 다 차기 전(elapsed < days)에는 변화 대신 '집계 중' — 0일째의 0건이 −100% 로 읽히지 않게. */
export function CompareTable({ rows, before, after, beforeLabel = '전', afterLabel = '후', elapsed = null, days = null }) {
  const pending = elapsed != null && days != null && elapsed < days;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left font-bold">항목</th>
          <th className="px-3 py-2 text-right font-bold">{beforeLabel}</th>
          <th className="px-3 py-2 text-right font-bold">{afterLabel}</th>
          <th className="px-3 py-2 text-right font-bold">변화</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, label]) => (
          <tr key={key} className="border-t border-slate-100">
            <td className="px-3 py-2 text-slate-700">{label}</td>
            <td className="px-3 py-2 text-right tabular-nums">{before?.[key] ?? 0}</td>
            <td className="px-3 py-2 text-right tabular-nums">{after?.[key] ?? 0}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-600">
              {pending ? <span className="text-slate-400">집계 중 ({elapsed}/{days}일)</span> : fmtDelta(before?.[key], after?.[key])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
