/// <summary>
/// 관리자 대시보드 '프로그램별 사용 통계' 행 클릭 시 뜨는 App 상세 통계 모달.
/// 백엔드 GET /api/analysis/stats/program/{name} 의 상세 집계를 받아
/// 요약 KPI · 추이/분포 차트 · 전체 사용자 랭킹 · 전체 실행 기록(페이지네이션+CSV)을 표시한다.
/// </summary>
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, Building2, CalendarDays, CheckCircle2, Clock3, Download,
  Layers, Sun, Users, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getProgramUsageDetail } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import { downloadBlob } from '../../utils/fileHelper';
import { formatDateTime } from '../../utils/formatting';

const COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4f46e5'];
const RECORDS_PER_PAGE = 12;

function StatTile({ label, value, sub, icon: Icon, accent = 'text-slate-400' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide truncate">{label}</p>
          <p className="mt-1 text-xl font-black text-slate-900 truncate">{value}</p>
          {sub && <p className="mt-0.5 text-[11px] text-slate-500 truncate">{sub}</p>}
        </div>
        <Icon size={22} className={`shrink-0 ${accent}`} />
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    Success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Failed: 'bg-red-50 text-red-700 border-red-200',
    Error: 'bg-red-50 text-red-700 border-red-200',
    Running: 'bg-blue-50 text-blue-700 border-blue-200',
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  const cls = map[status] || 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold ${cls}`}>{status}</span>;
}

function SectionCard({ title, icon: Icon, iconColor, action, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Icon size={16} className={iconColor} /> {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ProgramDetailModal({ programName, dateFrom, dateTo, onClose }) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recordPage, setRecordPage] = useState(1);

  // Esc 로 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRecordPage(1);
    getProgramUsageDetail(programName, { date_from: dateFrom, date_to: dateTo })
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || '상세 통계를 불러오지 못했습니다.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [programName, dateFrom, dateTo]);

  const summary = detail?.summary;
  const userRanking = detail?.userRanking || [];
  const records = detail?.records || [];

  const totalRecordPages = Math.max(1, Math.ceil(records.length / RECORDS_PER_PAGE));
  const pagedRecords = useMemo(
    () => records.slice((recordPage - 1) * RECORDS_PER_PAGE, recordPage * RECORDS_PER_PAGE),
    [records, recordPage],
  );

  const exportRecordsCsv = () => {
    if (records.length === 0) { showToast('내보낼 기록이 없습니다.', 'warning'); return; }
    const header = 'ID,Project,Requester,EmployeeID,Department,Status,DateTime\n';
    const body = records.map(r =>
      `${r.id},"${(r.project_name || '').replace(/"/g, '""')}",${r.userName},${r.employee_id},${r.dept},${r.status},${formatDateTime(r.created_at)}`
    ).join('\n');
    downloadBlob(new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8;' }), `${programName}_records_${Date.now()}.csv`);
  };

  const exportUsersCsv = () => {
    if (userRanking.length === 0) { showToast('내보낼 사용자가 없습니다.', 'warning'); return; }
    const header = 'Rank,Name,EmployeeID,Department,Runs,SuccessRate(%),FirstUse,LastUse\n';
    const body = userRanking.map((u, i) =>
      `${i + 1},${u.name},${u.employee_id},${u.dept},${u.count},${u.successRate},${u.firstRunLabel},${u.lastRunLabel}`
    ).join('\n');
    downloadBlob(new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8;' }), `${programName}_users_${Date.now()}.csv`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-6xl my-4 bg-slate-50 rounded-2xl shadow-2xl border border-slate-200 flex flex-col animate-fade-in-up">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 bg-white border-b border-slate-200 rounded-t-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Layers size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900 truncate" title={programName}>{programName}</h3>
              <p className="text-xs text-slate-500">App 사용 상세 통계{(dateFrom || dateTo) ? ' · 선택 기간' : ' · 전체 기간'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <Activity className="animate-spin mb-3" size={34} />
              <span className="text-sm">상세 통계를 집계하는 중입니다...</span>
            </div>
          ) : error ? (
            <div className="py-24 text-center text-red-500 text-sm">{error}</div>
          ) : !summary || summary.total === 0 ? (
            <div className="py-24 text-center text-slate-400 text-sm">해당 기간에 이 App의 사용 기록이 없습니다.</div>
          ) : (
            <>
              {/* KPI */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                <StatTile label="총 실행" value={summary.total.toLocaleString()} sub={`${summary.coveredDays}일 · 일평균 ${summary.avgPerDay}건`} icon={Activity} accent="text-blue-500" />
                <StatTile label="성공률" value={`${summary.successRate}%`} sub={`성공 ${summary.success} · 실패 ${summary.fail}`} icon={CheckCircle2} accent="text-emerald-500" />
                <StatTile label="사용자" value={summary.userCount.toLocaleString()} sub={`${summary.deptCount}개 부서`} icon={Users} accent="text-violet-500" />
                <StatTile label="피크 시간대" value={summary.peakHour} sub={`최근 사용 ${summary.lastRunLabel}`} icon={Clock3} accent="text-amber-500" />
              </div>

              {/* 추이 */}
              <SectionCard title="실행 추이" icon={Clock3} iconColor="text-emerald-600"
                action={<span className="text-xs text-slate-400">최초 {summary.firstRunLabel} · 최근 30일</span>}>
                <div className="h-[220px] p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.trendData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="programTrend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={3} fill="url(#programTrend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* 분포 3종 */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <SectionCard title="시간대별" icon={Sun} iconColor="text-amber-600">
                  <div className="h-[200px] p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detail.hourData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={3} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#d97706" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard title="요일별" icon={CalendarDays} iconColor="text-emerald-600">
                  <div className="h-[200px] p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detail.weekdayData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#059669" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard title="부서별" icon={Building2} iconColor="text-violet-600">
                  <div className="h-[200px] p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detail.deptData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={72} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                          {detail.deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              </div>

              {/* 사용자 랭킹 (전체) */}
              <SectionCard title={`사용자 랭킹 (${userRanking.length}명)`} icon={Users} iconColor="text-indigo-600"
                action={
                  <button onClick={exportUsersCsv} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-blue-600 transition-colors">
                    <Download size={14} /> CSV
                  </button>
                }>
                <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold">#</th>
                        <th className="px-4 py-2.5 text-left font-bold">사용자</th>
                        <th className="px-4 py-2.5 text-left font-bold">부서</th>
                        <th className="px-4 py-2.5 text-right font-bold">실행</th>
                        <th className="px-4 py-2.5 text-right font-bold">점유율</th>
                        <th className="px-4 py-2.5 text-right font-bold">성공률</th>
                        <th className="px-4 py-2.5 text-right font-bold">최초</th>
                        <th className="px-4 py-2.5 text-right font-bold">최근 실행</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {userRanking.map((u, i) => (
                        <tr key={u.employee_id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-xs font-black text-slate-400">{i + 1}</td>
                          <td className="px-4 py-2.5">
                            <p className="font-bold text-slate-800">{u.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{u.employee_id}</p>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{u.dept}</td>
                          <td className="px-4 py-2.5 text-right font-black text-slate-800">{u.count}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{u.share}%</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{u.successRate}%</td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 font-mono">{u.firstRunLabel}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 font-mono">{u.lastRunLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {/* 전체 실행 기록 */}
              <SectionCard title={`전체 실행 기록 (${records.length.toLocaleString()}건)`} icon={Activity} iconColor="text-blue-600"
                action={
                  <button onClick={exportRecordsCsv} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-blue-600 transition-colors">
                    <Download size={14} /> CSV
                  </button>
                }>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold">프로젝트</th>
                        <th className="px-4 py-2.5 text-left font-bold">사용자</th>
                        <th className="px-4 py-2.5 text-left font-bold">부서</th>
                        <th className="px-4 py-2.5 text-center font-bold">상태</th>
                        <th className="px-4 py-2.5 text-right font-bold">일시</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedRecords.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 max-w-[240px] truncate font-medium text-slate-800" title={r.project_name}>{r.project_name || <span className="text-slate-400">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-slate-800">{r.userName}</span>
                            <span className="ml-1.5 text-[11px] text-slate-400 font-mono">{r.employee_id}</span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{r.dept}</td>
                          <td className="px-4 py-2.5 text-center"><StatusBadge status={r.status} /></td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 font-mono">{formatDateTime(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalRecordPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm">
                    <span className="text-xs text-slate-500">
                      {(recordPage - 1) * RECORDS_PER_PAGE + 1}–{Math.min(recordPage * RECORDS_PER_PAGE, records.length)} / {records.length.toLocaleString()}건
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRecordPage((p) => Math.max(1, p - 1))}
                        disabled={recordPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                      >이전</button>
                      <span className="px-3 text-xs font-bold text-slate-600">{recordPage} / {totalRecordPages}</span>
                      <button
                        onClick={() => setRecordPage((p) => Math.min(totalRecordPages, p + 1))}
                        disabled={recordPage === totalRecordPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                      >다음</button>
                    </div>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
