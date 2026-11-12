import React, { useEffect, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { getNewsletterStats } from '../../../api/reports';
import { OUTCOME_LABELS } from '../../../utils/newsletterStats';
import { Kpi, DailyBars, CompareTable } from './StatBits';

/**
 * 웹 뉴스레터 조회 통계(2026-11-10) — 지정한 사번만 본다(서버 NEWSLETTER_STATS_VIEWERS, 사용자 지시 '나만 보게').
 * 서버가 {allowed:false} 면 아무것도 그리지 않는다(403 은 진단 경고가 쌓여 쓰지 않음).
 * 2026-11-12 핵심만 남김(사용자 결정): 조회수·방문 PC·날짜별 조회·발송 전후 비교. 읽은 깊이·머문 시간·구획 도달은 뺐다(서버는 계속 모은다).
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
  const lastDay = issue?.daily?.length ? issue.daily[issue.daily.length - 1].day : null;

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Newspaper size={16} className="text-blue-600" aria-hidden="true" /> 웹 뉴스레터
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

          <dl className="grid grid-cols-3 gap-4">
            <Kpi label="조회수" value={issue.views} note="새로고침 포함" />
            <Kpi label="방문 PC" value={issue.visitors} note="IP 기준, 사람 수 아님" />
            <Kpi label="마지막 조회" value={lastDay ? lastDay.slice(5) : '-'} note={`조회한 날 ${issue.daily.length}일`} />
          </dl>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-2">날짜별 조회</h4>
              <DailyBars daily={issue.daily} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-600 mb-2">
                발송 전후 {issue.outcomes.days}일
                <span className="font-normal text-slate-500"> (기준 {issue.outcomes.sentDay}, {issue.sentDayFromIssue ? '발송일' : '첫 조회일'})</span>
              </h4>
              <CompareTable rows={OUTCOME_LABELS} before={issue.outcomes.before} after={issue.outcomes.after}
                beforeLabel="발송 전" afterLabel="발송 후"
                elapsed={issue.outcomes.daysElapsed} days={issue.outcomes.days} />
              <p className="mt-2 text-[11px] text-slate-500">
                {issue.outcomes.daysElapsed < issue.outcomes.days && `발송 뒤 ${issue.outcomes.daysElapsed}일째라 아직 기간이 다 차지 않았습니다. `}
                {!issue.sentDayFromIssue && 'issue.json 에 sentDate 를 적으면 그 날을 기준으로 셉니다. '}
                영상 재생 기록은 30일 뒤 지워집니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
