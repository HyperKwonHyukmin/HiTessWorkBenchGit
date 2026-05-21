import React from 'react';
import { Activity, Users, Layers, Building2, TrendingUp, Trophy, Sun, CalendarDays } from 'lucide-react';
import { KpiCard } from '../AnalysisStatsDashboard';

function DeltaBadge({ delta }) {
  if (!delta || delta.abs === 0) return null;
  const positive = delta.abs > 0;
  const pct = delta.pct;
  const text = pct === null ? `${positive ? '+' : ''}${delta.abs}` : `${positive ? '+' : ''}${pct}%`;
  return (
    <span className={`ml-1 text-xs font-bold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
      {positive ? '▲' : '▼'} {text}
    </span>
  );
}

export default function ReportKpiGrid({ summary, deltas }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard label="총 실행 수"        value={<>{summary.total}<DeltaBadge delta={deltas?.total} /></>}        icon={Activity} color="blue"    />
      <KpiCard label="활성 사용자"        value={<>{summary.activeUsers}<DeltaBadge delta={deltas?.activeUsers} /></>}    icon={Users}    color="emerald" />
      <KpiCard label="활성 프로그램"      value={<>{summary.activePrograms}<DeltaBadge delta={deltas?.activePrograms} /></>} icon={Layers}   color="amber"  />
      <KpiCard label="활성 부서"          value={summary.activeDepartments}                                          icon={Building2} color="violet" />
      <KpiCard label="일평균 실행"        value={<>{summary.avgPerDay}<DeltaBadge delta={deltas?.avgPerDay} /></>} icon={TrendingUp} color="blue"   />
      <KpiCard label="최대 일일 실행"     value={summary.maxDay}             icon={CalendarDays} color="emerald" />
      <KpiCard label="최다 사용 프로그램" value={summary.busiestProgram || '-'} icon={Trophy}      color="amber"   />
      <KpiCard label="피크 시간대 / 신규" value={`${summary.peakHour || '-'} · 신규 ${summary.newUsers}명`} icon={Sun} color="violet" />
    </div>
  );
}
