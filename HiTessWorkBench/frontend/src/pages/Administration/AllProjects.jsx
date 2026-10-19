/// <summary>
/// 관리자 All Projects — 모든 사용자의 해석 이력(My Projects 와 같은 기준)을 한곳에서 보고,
/// 작업 폴더의 입력·결과 파일을 받거나 의미 있는 모델을 Hi-TESS LogBook 으로 보낸다.
/// </summary>
import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FolderSearch, RefreshCw, Search } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import StatusBadge from '../../components/ui/StatusBadge';
import AdminProjectDetailModal from '../../components/admin/AdminProjectDetailModal';
import { getAdminProjects } from '../../api/adminProjects';
import { getDisplayProgramName } from '../../contexts/DashboardContext';
import { formatShortDateTime } from '../../utils/adminProjectFiles';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { value: 'All', label: '모든 상태' },
  { value: 'Success', label: '해석 완료' },
  { value: 'Failed', label: '해석 실패' },
  { value: 'Cancelled', label: '사용자 중단' },
  { value: 'Running', label: '실행 중' },
];
const FILE_OPTIONS = [
  { value: 'All', label: '모든 파일 상태' },
  { value: 'available', label: '파일 보관 중' },
  { value: 'expired', label: '파일 만료' },
];

const selectCls = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function AllProjects() {
  const [items, setItems] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState('All');
  const [status, setStatus] = useState('All');
  const [fileStatus, setFileStatus] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sentOnly, setSentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const fetchData = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getAdminProjects((page - 1) * PAGE_SIZE, PAGE_SIZE, {
        search: search.trim() || undefined,
        program_name: program === 'All' ? undefined : program,
        status: status === 'All' ? undefined : status,
        file_status: fileStatus === 'All' ? undefined : fileStatus,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        logbook: sentOnly ? 'sent' : undefined,
      });
      if (signal?.aborted) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPrograms(data.programs || []);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e?.response?.data?.detail || e?.message || '목록을 불러오지 못했습니다.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, search, program, status, fileStatus, dateFrom, dateTo, sentOnly]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => fetchData(controller.signal), search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fetchData, search]);

  // 필터를 바꾸면 첫 페이지로 — 같은 렌더에서 함께 바꿔 요청이 한 번만 나가게 한다.
  const withReset = (setter) => (value) => { setter(value); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-7xl pb-28">
      <PageHeader
        title="All Projects"
        icon={FolderSearch}
        subtitle="모든 사용자의 해석 입력·결과 파일을 확인하고, 의미 있는 모델을 Hi-TESS LogBook 으로 보냅니다."
        accentColor="violet"
      />

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">검색</span>
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => withReset(setSearch)(e.target.value)}
            placeholder="이름·사번·부서·프로젝트·App"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <select value={program} onChange={(e) => withReset(setProgram)(e.target.value)} aria-label="App" className={selectCls}>
          <option value="All">모든 App</option>
          {programs.map(p => <option key={p} value={p}>{getDisplayProgramName(p)}</option>)}
        </select>
        <select value={status} onChange={(e) => withReset(setStatus)(e.target.value)} aria-label="상태" className={selectCls}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={fileStatus} onChange={(e) => withReset(setFileStatus)(e.target.value)} aria-label="파일 상태" className={selectCls}>
          {FILE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={dateFrom} onChange={(e) => withReset(setDateFrom)(e.target.value)} aria-label="시작일" className={`${selectCls} w-[9.5rem]`} />
          <span className="text-slate-500">~</span>
          <input type="date" value={dateTo} onChange={(e) => withReset(setDateTo)(e.target.value)} aria-label="종료일" className={`${selectCls} w-[9.5rem]`} />
        </div>
        <button
          type="button"
          onClick={() => withReset(setSentOnly)(!sentOnly)}
          aria-pressed={sentOnly}
          title="LogBook 으로 보낸 기록만 봅니다(실패한 시도만 있는 기록은 제외)"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            sentOnly
              ? 'border-blue-300 bg-blue-50 text-brand-blue'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <BookOpen size={15} aria-hidden="true" /> LogBook 보낸 것만
        </button>
        <button
          type="button"
          onClick={() => fetchData()}
          className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
          aria-label="새로 고침"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
              <tr>
                <th className="px-4 py-3">기록 · 프로젝트</th>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3">사용자 (부서)</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">파일</th>
                <th className="px-4 py-3">LogBook</th>
                <th className="px-4 py-3 text-right">실행 시각</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {error ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-red-600">{error}</td></tr>
              ) : !loading && items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                  {sentOnly ? '조건에 맞는 기록 중 LogBook 으로 보낸 것이 없습니다.' : '조건에 맞는 해석 기록이 없습니다.'}
                </td></tr>
              ) : items.map(item => (
                <tr
                  key={item.id}
                  onClick={() => setSelected(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelected(item); }}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"
                >
                  <td className="max-w-[18rem] px-4 py-2.5">
                    <span className="block font-mono text-[11px] text-slate-500">#{item.id}</span>
                    <span className="block truncate text-sm font-semibold text-slate-800" title={item.project_name}>
                      {item.project_name || 'Unnamed'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-700">{getDisplayProgramName(item.program_name)}</td>
                  <td className="px-4 py-2.5">
                    <span className="block text-sm font-semibold text-slate-800">
                      {item.userName} <span className="font-mono text-xs font-normal text-slate-500">({item.employee_id})</span>
                    </span>
                    <span className="text-xs text-slate-500">{item.department}</span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={item.status} size="sm" /></td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={item.retention?.status || (item.files_available === false ? 'expired' : 'available')} size="sm" />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {item.logbook ? (
                      <span className="inline-flex items-center gap-1 text-brand-blue" title={`마지막: ${formatShortDateTime(item.logbook.last_at)} · ${item.logbook.last_by}`}>
                        <BookOpen size={13} aria-hidden="true" /> {item.logbook.count}번 보냄
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">{formatShortDateTime(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-600">
            전체 <span className="font-bold text-slate-800">{total.toLocaleString()}</span>건
            {total > 0 && <> 중 {first}–{last}</>}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-300"
              aria-label="이전 페이지"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 text-xs font-bold text-slate-600">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-300"
              aria-label="다음 페이지"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <AdminProjectDetailModal
        project={selected}
        onClose={() => setSelected(null)}
        onExported={() => fetchData()}
      />
    </div>
  );
}
