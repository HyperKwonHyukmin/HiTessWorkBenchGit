import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getUsageReport } from '../../api/reports';
import PeriodTabs from '../../components/admin/reports/PeriodTabs';
import PeriodNavigator from '../../components/admin/reports/PeriodNavigator';
import ReportKpiGrid from '../../components/admin/reports/ReportKpiGrid';
import PeriodTimeChart from '../../components/admin/reports/PeriodTimeChart';
import ReportProgramsTable from '../../components/admin/reports/ReportProgramsTable';
import ReportUsersTable from '../../components/admin/reports/ReportUsersTable';
import ReportDepartmentChart from '../../components/admin/reports/ReportDepartmentChart';
import ExportXlsxButton from '../../components/admin/reports/ExportXlsxButton';

function defaultDateFor(period) {
  const d = new Date();
  if (period === 'daily') {
    d.setDate(d.getDate() - 1);
  } else if (period === 'weekly') {
    d.setDate(d.getDate() - 7);
  } else if (period === 'monthly') {
    d.setDate(1);
    d.setDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export default function UsageReports() {
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(() => defaultDateFor('daily'));
  const [retryTick, setRetryTick] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const handlePeriodChange = (p) => {
    setPeriod(p);
    setDate(defaultDateFor(p));
  };

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    getUsageReport({ period, date, signal: controller.signal })
      .then(res => {
        setData(res.data);
        setLoading(false);
      })
      .catch(err => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setError(err?.response?.data?.detail || err?.message || '리포트를 불러올 수 없습니다.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [period, date, retryTick]);

  const total = data?.summary?.total ?? 0;
  const isEmpty = data && total === 0;

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4">
          <PeriodTabs value={period} onChange={handlePeriodChange} />
          {data?.period && (
            <PeriodNavigator
              period={period}
              date={date}
              label={data.period.label}
              onChange={setDate}
            />
          )}
        </div>
        <ExportXlsxButton period={period} date={date} disabled={loading || !!error || isEmpty} />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-blue-500" size={40}/></div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-rose-500 mb-3">{error}</p>
          <button onClick={() => setRetryTick(t => t + 1)} className="px-4 py-2 text-sm font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700">
            다시 시도
          </button>
        </div>
      ) : isEmpty ? (
        <div className="text-center py-20 text-slate-400">
          {data.period.label} 기간에 해석 기록이 없습니다.
        </div>
      ) : data && (
        <div className="space-y-6">
          <ReportKpiGrid summary={data.summary} deltas={data.deltas} />
          <PeriodTimeChart timeBuckets={data.timeBuckets} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ReportProgramsTable programs={data.programs} />
            <ReportUsersTable users={data.users} />
          </div>
          <ReportDepartmentChart departments={data.departments} />
        </div>
      )}
    </div>
  );
}
