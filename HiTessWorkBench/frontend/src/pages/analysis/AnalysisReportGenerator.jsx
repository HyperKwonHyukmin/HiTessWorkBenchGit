import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';

import { getAnalysisHistory } from '../../api/analysis';
import { downloadAnalysisReport, getReportCapabilities } from '../../api/reports';
import { decorateHistoryForReport } from '../../utils/reportCatalogue';
import { readBlobErrorDetail } from '../../utils/httpErrors';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

export default function AnalysisReportGenerator() {
  const { showToast } = useToast();
  const { employeeId } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [appFilter, setAppFilter] = useState('ALL');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [historyRes, capsRes] = await Promise.all([
          getAnalysisHistory(employeeId),
          getReportCapabilities(),
        ]);
        if (!alive) return;
        // ⚠️ 이력 응답은 배열이 아니라 { total, skip, limit, items, summary } 다.
        //    historyRes.data 를 그대로 넘기면 decorateHistoryForReport 가 [] 를 돌려주고
        //    목록이 언제나 비어 보인다.
        setRows(decorateHistoryForReport(historyRes.data?.items, capsRes.data));
        setTotal(historyRes.data?.total ?? 0);
      } catch {
        if (alive) showToast('해석 이력을 불러오지 못했습니다.', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [employeeId, showToast]);

  const appNames = useMemo(
    () => ['ALL', ...Array.from(new Set(rows.map((r) => r.program_name))).sort()],
    [rows],
  );

  const visibleRows = useMemo(
    () => (appFilter === 'ALL' ? rows : rows.filter((r) => r.program_name === appFilter)),
    [rows, appFilter],
  );

  const selected = useMemo(
    () => visibleRows.find((r) => r.id === selectedId) || null,
    [visibleRows, selectedId],
  );

  const handleGenerate = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await downloadAnalysisReport({ analysisId: selected.id });
      showToast('계산서를 내려받았습니다.', 'success');
    } catch (error) {
      // blob 요청이라 오류 본문도 Blob 이다 — 그냥 .detail 을 읽으면 늘 undefined 다.
      showToast(await readBlobErrorDetail(error, '리포트 생성에 실패했습니다.'), 'error');
    } finally {
      setGenerating(false);
    }
  }, [selected, showToast]);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#002554]">Analysis Report Generator</h1>
        <p className="mt-1 text-sm text-slate-600">
          완료된 해석 이력을 선택해 표준 계산서(XLSX)를 생성합니다.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">
              해석 이력
              {total > rows.length && (
                <span className="ml-2 font-normal text-slate-500">
                  최근 {rows.length}건 표시 (전체 {total}건)
                </span>
              )}
            </h2>
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={appFilter}
              onChange={(event) => setAppFilter(event.target.value)}
            >
              {appNames.map((name) => (
                <option key={name} value={name}>{name === 'ALL' ? '전체 App' : name}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">불러오는 중…</p>
          ) : visibleRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">해석 이력이 없습니다.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
              {visibleRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={!row.reportable}
                    onClick={() => setSelectedId(row.id)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${
                      row.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'
                    } ${row.reportable ? '' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <span>
                      <span className="block font-medium text-slate-800">{row.program_name}</span>
                      <span className="block text-xs text-slate-500">
                        {row.project_name} · {new Date(row.created_at).toLocaleString()}
                      </span>
                    </span>
                    {row.hasTemplate && (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        양식 있음
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">선택한 해석</h2>
          {!selected ? (
            <p className="text-sm text-slate-500">왼쪽 목록에서 해석을 선택하세요.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">App</dt><dd className="font-medium">{selected.program_name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">프로젝트</dt><dd>{selected.project_name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">상태</dt><dd>{selected.status}</dd></div>
              <div className="flex justify-between">
                <dt className="text-slate-500">적용 양식</dt>
                <dd>{selected.hasTemplate ? '사내 표준 양식' : '범용 서식'}</dd>
              </div>
            </dl>
          )}

          <button
            type="button"
            disabled={!selected || generating}
            onClick={handleGenerate}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#002554] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {generating ? '생성 중…' : '계산서 생성'}
          </button>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <FileSpreadsheet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            양식이 등록되지 않은 App 은 범용 서식으로 생성되며, 그 사실이 계산서 표지에 표기됩니다.
          </p>
        </section>
      </div>
    </div>
  );
}
