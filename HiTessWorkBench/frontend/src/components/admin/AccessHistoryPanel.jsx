import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react';
import { getAccessSessionSummary } from '../../api/presence';
import { formatSeconds } from '../../utils/accessHistory';

const PERIODS = [
  [7, '7일'],
  [30, '30일'],
  [90, '90일'],
  [365, '1년'],
];

/**
 * 접속 이력 요약 — access_sessions(기간 제한 없이 보관) 기준.
 * 펼쳤을 때만 불러온다(사용자 관리 화면을 열 때마다 집계하지 않게).
 */
export default function AccessHistoryPanel() {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAccessSessionSummary(days);
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || '접속 이력을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const topPages = (data?.pages || []).slice(0, 10);
  const maxPage = topPages[0]?.active_seconds || 1;

  return (
    <div className="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 cursor-pointer text-left"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} className="text-slate-500"/> : <ChevronRight size={16} className="text-slate-500"/>}
          <History size={15} className="text-slate-500"/>
          <h3 className="text-sm font-extrabold text-slate-700 tracking-tight">접속 이력</h3>
          <span className="text-[11px] text-slate-500 font-medium hidden md:inline">
            사용자별 접속 일수·시간, 화면별 사용 시간
          </span>
        </button>
        {open && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
              {PERIODS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDays(value)}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold cursor-pointer ${days === value ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> 새로고침
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="p-4">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {!data && loading && <p className="py-6 text-center text-sm text-slate-500">불러오는 중…</p>}
          {data && data.session_count === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              이 기간의 접속 이력이 없습니다. 접속 이력은 이 기능을 배포한 뒤부터 쌓입니다.
            </p>
          )}
          {data && data.session_count > 0 && (
            <>
              <dl className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['접속 사용자', `${data.user_count}명`],
                  ['접속 횟수', `${data.session_count}회`],
                  ['앱을 연 시간', formatSeconds(data.online_seconds)],
                  ['실제 사용 시간', formatSeconds(data.active_seconds)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 px-3 py-2">
                    <dt className="text-[11px] font-bold text-slate-500">{label}</dt>
                    <dd className="text-base font-extrabold text-slate-800 tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-2 font-bold">사용자</th>
                        <th className="py-2 px-2 font-bold text-right">접속 일수</th>
                        <th className="py-2 px-2 font-bold text-right">접속 횟수</th>
                        <th className="py-2 px-2 font-bold text-right">실제 사용</th>
                        <th className="py-2 px-2 font-bold text-right">앱을 연 시간</th>
                        <th className="py-2 px-2 font-bold">PC</th>
                        <th className="py-2 px-2 font-bold">버전</th>
                        <th className="py-2 pl-2 font-bold">마지막 접속</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u) => (
                        <tr key={u.employee_id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-2">
                            <span className="font-bold text-slate-800">{u.name || u.employee_id}</span>
                            <span className="ml-1.5 text-[11px] text-slate-500">{u.department || ''}</span>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">{u.days}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{u.sessions}</td>
                          <td className="py-2 px-2 text-right tabular-nums font-bold text-slate-800">{formatSeconds(u.active_seconds)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-600">{formatSeconds(u.online_seconds)}</td>
                          <td className="py-2 px-2 text-slate-600 font-mono" title={u.hostnames.join(', ')}>
                            {u.hostnames[0] || '—'}{u.hostnames.length > 1 ? ` 외 ${u.hostnames.length - 1}` : ''}
                          </td>
                          <td className="py-2 px-2 text-slate-600 font-mono">{u.app_version || '—'}</td>
                          <td className="py-2 pl-2 text-slate-600">
                            {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold text-slate-500 mb-2">화면별 실제 사용 시간 (상위 10)</h4>
                  <ul className="space-y-1.5">
                    {topPages.map((p) => (
                      <li key={p.page} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-slate-700" title={p.page}>{p.page}</span>
                          <span className="shrink-0 tabular-nums text-slate-600">{formatSeconds(p.active_seconds)}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-blue-500"
                            style={{ width: `${Math.max(2, (p.active_seconds / maxPage) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                실제 사용 = 3분 넘게 입력이 없던 시간을 뺀 시간. PC 이름은 새 exe 부터 기록됩니다.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
