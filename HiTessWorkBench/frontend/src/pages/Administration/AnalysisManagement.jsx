/// <summary>
/// 관리자 전용 해석 관리 및 통계 대시보드.
/// </summary>
import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { getAllAnalysisHistory } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import { downloadBlob } from '../../utils/fileHelper';
import { formatDateTime } from '../../utils/formatting';
import AnalysisFilterBar from '../../components/admin/AnalysisFilterBar';
import AnalysisHistoryTable from '../../components/admin/AnalysisHistoryTable';

const PAGE_SIZE = 25;
const AnalysisStatsDashboard = lazy(() => import('../../components/admin/AnalysisStatsDashboard'));

export default function AnalysisManagement() {
  const { showToast } = useToast();
  const [analyses, setAnalyses] = useState([]);
  const [stats, setStats] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const analysisRes = await getAllAnalysisHistory(PAGE_SIZE, (currentPage - 1) * PAGE_SIZE, {
        search: searchTerm || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        include_summary: true,
      });
      setAnalyses(analysisRes.data.items || []);
      setStats(analysisRes.data.summary || null);
      setTotalCount(analysisRes.data.total || 0);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, dateFrom, dateTo, searchTerm]);

  useEffect(() => {
    const timer = setTimeout(fetchData, searchTerm ? 250 : 0);
    return () => clearTimeout(timer);
  }, [fetchData, searchTerm]);

  // \uD544\uD130 \uBCC0\uACBD \uC2DC 1\uD398\uC774\uC9C0\uB85C \uB9AC\uC14B\uD55C\uB2E4. \uBCC4\uB3C4 effect\uB85C setCurrentPage(1)\uC744 \uD638\uCD9C\uD558\uBA74
  // searchTerm \uBCC0\uACBD fetch \u2192 page \uBCC0\uACBD fetch \uB85C \uC774\uC911 \uC694\uCCAD\uC774 \uBC1C\uC0DD\uD558\uBBC0\uB85C,
  // \uD578\uB4E4\uB7EC\uC5D0\uC11C \uD544\uD130\uC640 \uD398\uC774\uC9C0\uB97C \uAC19\uC740 \uB80C\uB354\uC5D0 \uB3D9\uAE30 \uC124\uC815\uD574 \uB2E8\uC77C fetch\uB85C \uB9CC\uB4E0\uB2E4.
  const handleSearchChange = useCallback((v) => { setSearchTerm(v); setCurrentPage(1); }, []);
  const handleDateFromChange = useCallback((v) => { setDateFrom(v); setCurrentPage(1); }, []);
  const handleDateToChange = useCallback((v) => { setDateTo(v); setCurrentPage(1); }, []);

  const downloadCSV = async () => {
    try {
      const response = await getAllAnalysisHistory(100000, 0, {
        search: searchTerm || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const items = response.data.items || [];
      if (items.length === 0) { showToast('\uB0B4\uBCF4\uB0BC \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.', 'warning'); return; }
      // CSV \uC140 \uC774\uC2A4\uCF00\uC774\uD504: \uCF64\uB9C8/\uB530\uC634\uD45C/\uAC1C\uD589\uC774 \uC788\uC73C\uBA74 \uD070\uB530\uC634\uD45C\uB85C \uAC10\uC2F8\uACE0 \uB0B4\uBD80 \uB530\uC634\uD45C\uB294 2\uBC30\uB85C.
      const csvCell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['ID', 'Project', 'Module', 'Requester', 'Department', 'Status', 'Date'];
      const rows = items.map(a => [
        a.id,
        a.project_name || '',
        a.program_name,
        `${a.userName}(${a.employee_id})`,
        a.department,
        a.status,
        formatDateTime(a.created_at),
      ].map(csvCell).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + header.join(',') + '\n' + rows], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `Analysis_Report_${Date.now()}.csv`);
    } catch (err) {
      showToast(err?.response?.data?.detail || 'CSV \uB0B4\uBCF4\uB0B4\uAE30\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <AnalysisFilterBar dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={handleDateFromChange} onDateToChange={handleDateToChange} onDownloadCSV={downloadCSV} />

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-blue-500" size={40}/></div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">{error}</div>
      ) : !stats ? (
        <div className="text-center py-20 text-slate-400">{(dateFrom || dateTo) ? '선택한 기간에 해당하는 데이터가 없습니다.' : '데이터가 없습니다.'}</div>
      ) : (
        <>
          <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">통계 차트를 불러오는 중입니다...</div>}>
            <AnalysisStatsDashboard stats={stats} dateFrom={dateFrom} dateTo={dateTo} />
          </Suspense>
          <AnalysisHistoryTable
            filteredAnalyses={analyses}
            searchTerm={searchTerm}
            onSearchChange={handleSearchChange}
            currentPage={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
          />
        </>
      )}
    </div>
  );
}
