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
import ExportPngButton from '../../components/admin/reports/ExportPngButton';
import ReportPrintView from '../../components/admin/reports/ReportPrintView';

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
  // 로컬(KST) 캘린더 날짜로 포맷 — toISOString(UTC)은 새벽 시간대에 하루 어긋난다.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function UsageReports() {
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(() => defaultDateFor('daily'));
  const [retryTick, setRetryTick] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const reportBodyRef = useRef(null);
  const printViewRef = useRef(null);

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
        const detail = err?.response?.data?.detail;
        let msg;
        if (typeof detail === 'string') {
          msg = detail;
        } else if (Array.isArray(detail)) {
          msg = detail.map(d => (d && typeof d === 'object' ? (d.msg || JSON.stringify(d)) : String(d))).join(' · ');
        } else if (detail && typeof detail === 'object') {
          msg = detail.msg || JSON.stringify(detail);
        } else {
          msg = err?.message || '리포트를 불러올 수 없습니다.';
        }
        const status = err?.response?.status;
        setError(status ? `[${status}] ${msg}` : msg);
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
        <div className="flex items-center gap-2">
          <ExportPngButton
            targetRef={printViewRef}
            period={period}
            date={date}
            label={data?.period?.label}
            disabled={loading || !!error || isEmpty}
          />
          <ExportXlsxButton period={period} date={date} disabled={loading || !!error || isEmpty} />
        </div>
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
        <div ref={reportBodyRef} className="space-y-6">
          <ReportKpiGrid summary={data.summary} deltas={data.deltas} />
          <PeriodTimeChart timeBuckets={data.timeBuckets} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ReportProgramsTable programs={data.programs} />
            <ReportUsersTable users={data.users} />
          </div>
          <ReportDepartmentChart departments={data.departments} />
        </div>
      )}

      {/* PNG 캡처 전용 off-screen print view */}
      {data && !isEmpty && !error && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-99999px',
            top: 0,
            pointerEvents: 'none',
            zIndex: -1,
          }}
        >
          <ReportPrintView ref={printViewRef} data={data} period={period} />
        </div>
      )}
    </div>
  );
}
