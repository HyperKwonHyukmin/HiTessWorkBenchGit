import React, { useEffect, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { getNewsletterStats } from '../../../api/reports';
import { SECTION_LABELS, OUTCOME_LABELS, pct, fmtDuration, fmtDelta } from '../../../utils/newsletterStats';

/**
 * 웹 뉴스레터 조회 통계(2026-11-10) — 지정한 사번만 본다(서버 NEWSLETTER_STATS_VIEWERS, 사용자 지시 '나만 보게').
 * 서버가 {allowed:false} 면 아무것도 그리지 않는다 — 다른 관리자에게는 칸 자체가 없다(403 은 진단 경고가 쌓여 쓰지 않음).
 * 방문자는 IP(PC) 기준이라 사람 수가 아니다. 성과는 첫 조회일 앞뒤 14일 비교로 본다.
 */
export default function NewsletterStatsPanel() {
  const [data, setData] = useState(null);
  const [issueId, setIssueId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    getNewsletterStats({ signal: controller.signal })
      .then(res => {
        if (!res.data?.allowed) { setData(null); return; }
        setData(res.data);
        setIssueId(res.data?.issues?.[0]?.issue ?? null);
      })
      .catch(() => setData(null));   // 옛 서버(404)·네트워크 — 조용히 숨긴다
    return () => controller.abort();
  }, []);

  if (!data) return null;
  const issue = data.issues.find(i => i.issue === issueId);

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Newspaper size={16} className="text-blue-600" aria-hidden="true" /> 웹 뉴스레터 조회
          <span className="text-[11px] font-medium text-slate-500">나만 보는 칸</span>
        </h3>
        {data.issues.length > 1 && (
          <select value={issueId ?? ''} onChange={e => setIssueId(e.target.value)} aria-label="호 선택"
            className="text-xs border border-slate-200 rounded px-2 py-1">
            {data.issues.map(i => <option key={i.issue} value={i.issue}>{i.title}</option>)}
          </select>
        )}
      </div>

      {!issue ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          아직 조회 기록이 없습니다. 뉴스레터 링크가 열리면 그때부터 쌓입니다.
        </p>
      ) : (
        <div className="p-5 space-y-6">
          <div className="text-sm font-bold text-slate-800">{issue.title}</div>

          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="조회수" value={issue.views} note="새로고침 포함" />
            <Kpi label="방문 PC" value={issue.visitors} note="IP 기준 · 사람 수 아님" />
            <Kpi label="평균 읽은 깊이" value={`${issue.avgDepth}%`} note={`측정 ${issue.measured}건`} />
            <Kpi label="머문 시간(중앙값)" value={fmtDuration(issue.medianDwell)} note="화면에 보인 시간만" />
          </dl>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-2">날짜별 조회</h4>
              <Bars rows={issue.daily.map(d => ({ key: d.day, label: d.day.slice(5), value: d.views, sub: `PC ${d.visitors}` }))} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-2">구획까지 읽은 방문 비율</h4>
              <Bars unit="%" rows={data.sections.map(s => ({
                key: s, label: SECTION_LABELS[s] ?? s, value: pct(issue.sectionReach[s], issue.visits),
              }))} />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-slate-600 mb-2">
              발송 전후 {issue.outcomes.days}일 비교
              <span className="font-normal text-slate-500"> · 기준일 {issue.outcomes.sentDay}({issue.sentDayFromIssue ? '발송일' : '첫 조회일 — issue.json 에 sentDate 를 적으면 그 날로'}) · 지난 날 {issue.outcomes.daysElapsed}일</span>
            </h4>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">항목</th>
                  <th className="px-3 py-2 text-right font-bold">발송 전</th>
                  <th className="px-3 py-2 text-right font-bold">발송 후</th>
                  <th className="px-3 py-2 text-right font-bold">변화</th>
                </tr>
              </thead>
              <tbody>
                {OUTCOME_LABELS.map(([key, label]) => (
                  <tr key={key} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{issue.outcomes.before[key]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{issue.outcomes.after[key]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtDelta(issue.outcomes.before[key], issue.outcomes.after[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">
              {issue.outcomes.daysElapsed < issue.outcomes.days && '발송 후 기간이 아직 다 차지 않았습니다. '}
              영상 재생 기록은 30일이 지나면 지워져 오래된 호의 값은 작게 보일 수 있습니다.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, note }) {
  return (
    <div className="border border-slate-100 rounded-md px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-xl font-bold text-slate-800 tabular-nums">{value}</dd>
      {note && <dd className="text-[11px] text-slate-500">{note}</dd>}
    </div>
  );
}

function Bars({ rows, unit = '' }) {
  if (rows.length === 0) return <p className="text-xs text-slate-500">자료 없음</p>;
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <li key={r.key} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2 text-xs">
          <span className="text-slate-600 truncate">{r.label}</span>
          <span className="h-2.5 bg-slate-100 rounded">
            <span className="block h-full bg-blue-500 rounded" style={{ width: `${(100 * r.value) / max}%` }} />
          </span>
          <span className="text-right tabular-nums text-slate-700">{r.value}{unit}{r.sub ? ` · ${r.sub}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}
