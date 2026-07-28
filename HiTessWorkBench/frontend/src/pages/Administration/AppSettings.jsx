/// <summary>
/// 관리자 전용 App 설정 페이지.
///
/// 전체 App의 서비스 상태·점검 여부를 한 표에서 조망하고, 개별 App의 설정 창을
/// 열어 상세를 편집합니다. 여기서 '개발 중'·'점검 중'으로 내린 App은 일반
/// 사용자의 화면 진입은 물론 해당 App의 해석 요청 API도 서버에서 거부됩니다.
///
/// 앱 목록의 원본은 코드(ANALYSIS_DATA)이고 이 화면은 그 위에 덮는 오버라이드만
/// 다룹니다 — 그래서 '설정 없음' 상태가 정상이며, 초기화하면 코드 값으로 돌아갑니다.
/// </summary>
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Hammer, RefreshCw, Search, Settings2, ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { KpiCard } from '../../components/ui/KpiCard';
import AppSettingsModal from '../../components/admin/AppSettingsModal';
import { useAppCatalogue } from '../../contexts/DashboardContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../contexts/ToastContext';

const STATUS_STYLE = {
  Active: { label: '서비스 중', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Developing: { label: '개발 중', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  Planned: { label: '출시 예정', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

function StatusPill({ status }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.Active;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${style.className}`}>
      {style.label}
    </span>
  );
}

export default function AppSettings() {
  const { showToast } = useToast();
  const { apps, getBlock, refresh } = useAppCatalogue();
  const overrides = useAppSettings();

  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [editingTitle, setEditingTitle] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // 화면에 처음 들어올 때 최신 설정을 확실히 받아 온다(정기 폴링 주기를 기다리지 않도록).
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const ok = await refresh();
    setRefreshing(false);
    if (!ok) showToast('설정을 불러오지 못했습니다.', 'error');
  }, [refresh, showToast]);

  const modes = useMemo(
    () => ['all', ...Array.from(new Set(apps.map(app => app.mode)))],
    [apps],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return apps.filter(app => {
      if (modeFilter !== 'all' && app.mode !== modeFilter) return false;
      if (!keyword) return true;
      return (
        app.title.toLowerCase().includes(keyword)
        || (app.category || '').toLowerCase().includes(keyword)
        || (app.contributor || '').toLowerCase().includes(keyword)
      );
    });
  }, [apps, modeFilter, search]);

  const stats = useMemo(() => {
    const blocked = apps.filter(app => getBlock(app));
    return {
      total: apps.length,
      available: apps.length - blocked.length,
      maintenance: apps.filter(app => app.maintenance).length,
      overridden: apps.filter(app => app.hasAdminOverride).length,
    };
  }, [apps, getBlock]);

  const editingApp = editingTitle ? apps.find(app => app.title === editingTitle) : null;

  return (
    <div>
      <PageHeader
        title="App Settings"
        icon={SlidersHorizontal}
        subtitle="App별 서비스 상태와 점검 여부, 표시 정보를 관리합니다."
        accentColor="indigo"
        actions={(
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            새로고침
          </button>
        )}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="전체 App" value={stats.total} icon={Settings2} color="blue" />
        <KpiCard label="사용 가능" value={stats.available} icon={CheckCircle2} color="emerald" />
        <KpiCard label="점검 중" value={stats.maintenance} icon={Hammer} color="amber" />
        <KpiCard
          label="관리자 설정 적용"
          value={stats.overridden}
          sub="나머지는 코드 기본값"
          icon={ShieldAlert}
          color="violet"
        />
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="App 이름 · 카테고리 · 담당자"
            className="w-64 rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {modes.map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setModeFilter(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                modeFilter === mode
                  ? 'bg-brand-blue text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {mode === 'all' ? '전체' : mode}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">App</th>
              <th className="px-4 py-3 w-32">상태</th>
              <th className="px-4 py-3 w-40">사용자 접근</th>
              <th className="px-4 py-3 w-28">담당자</th>
              <th className="px-4 py-3 w-24 text-right">설정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                  조건에 맞는 App이 없습니다.
                </td>
              </tr>
            ) : filtered.map(app => {
              const block = getBlock(app);
              return (
                <tr key={app.title} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{app.title}</span>
                      {app.hasAdminOverride && (
                        <span
                          className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700"
                          title="코드 기본값 위에 관리자 설정이 적용된 App입니다."
                        >
                          설정됨
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {app.mode} · {app.category}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={app.devStatus || 'Active'} />
                    {app.maintenance && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-amber-600">
                        <Hammer size={11} />
                        점검 중
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {block ? (
                      <span className="text-xs font-bold text-red-600">
                        차단
                        <span className="ml-1 font-normal text-slate-400">
                          ({block.reason === 'maintenance' ? '점검' : '관리자 전용'})
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-emerald-600">사용 가능</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{app.contributor || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingTitle(app.title)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-white cursor-pointer"
                    >
                      <Settings2 size={13} />
                      설정
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AppSettingsModal
        isOpen={Boolean(editingApp)}
        onClose={() => setEditingTitle(null)}
        app={editingApp}
        setting={editingApp ? overrides[editingApp.title] : undefined}
      />
    </div>
  );
}
