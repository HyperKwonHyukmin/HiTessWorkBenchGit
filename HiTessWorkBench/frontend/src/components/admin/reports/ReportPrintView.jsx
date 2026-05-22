import React from 'react';
import ReportKpiGrid from './ReportKpiGrid';
import PeriodTimeChart from './PeriodTimeChart';
import ReportProgramsTable from './ReportProgramsTable';
import ReportUsersTable from './ReportUsersTable';
import ReportDepartmentChart from './ReportDepartmentChart';

const PERIOD_KO = { daily: '일간', weekly: '주간', monthly: '월간' };
const TOP_N = 20;

function formatGeneratedAt(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PrintReport = React.forwardRef(function PrintReport({ data, period }, ref) {
  if (!data) return null;
  const periodLabelKo = PERIOD_KO[period] || period;
  const generatedAt = formatGeneratedAt();

  const allPrograms = data.programs || [];
  const allUsers = data.users || [];
  const programs = allPrograms.slice(0, TOP_N);
  const users = allUsers.slice(0, TOP_N);
  const programsExtra = allPrograms.length - programs.length;
  const usersExtra = allUsers.length - users.length;
  const programsFootnote = programsExtra > 0
    ? `전체 ${allPrograms.length}개 중 상위 ${TOP_N}개 표시 · 외 ${programsExtra}개 생략`
    : null;
  const usersFootnote = usersExtra > 0
    ? `전체 ${allUsers.length}명 중 상위 ${TOP_N}명 표시 · 외 ${usersExtra}명 생략`
    : null;

  return (
    <div
      ref={ref}
      style={{
        width: '1240px',
        background: '#ffffff',
        color: '#0f172a',
        padding: '40px 48px 32px',
        fontFamily: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      {/* 헤더 */}
      <div className="flex items-end justify-between pb-5 mb-7 border-b-2 border-slate-800">
        <div>
          <div className="text-[11px] font-black text-blue-600 tracking-[0.25em] uppercase">
            HiTESS WorkBench
          </div>
          <h1 className="mt-2 text-[28px] leading-tight font-black text-slate-900">
            사용량 리포트
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-bold text-slate-800">{periodLabelKo}</span>
            <span className="mx-2 text-slate-300">·</span>
            {data.period?.label || ''}
          </p>
        </div>
        <div className="text-right text-[11px] text-slate-500 leading-relaxed">
          <div className="uppercase tracking-wider">Generated</div>
          <div className="mt-1 text-sm font-bold text-slate-700">{generatedAt}</div>
        </div>
      </div>

      {/* 본문 */}
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-xs font-black text-slate-500 uppercase tracking-[0.18em]">
            핵심 지표
          </h2>
          <ReportKpiGrid summary={data.summary} deltas={data.deltas} />
        </section>

        {data.timeBuckets?.data?.length > 0 && (
          <section>
            <PeriodTimeChart timeBuckets={data.timeBuckets} />
          </section>
        )}

        <section>
          <ReportProgramsTable programs={programs} footnote={programsFootnote} />
        </section>

        <section>
          <ReportUsersTable users={users} footnote={usersFootnote} />
        </section>

        {data.departments?.length > 0 && (
          <section>
            <ReportDepartmentChart departments={data.departments} />
          </section>
        )}
      </div>

      {/* 풋터 */}
      <div className="mt-10 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-400">
        <div>Confidential · HiTESS WorkBench Internal Usage Report</div>
        <div>page 1 / 1</div>
      </div>
    </div>
  );
});

export default PrintReport;
