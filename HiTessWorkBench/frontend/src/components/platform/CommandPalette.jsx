import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Activity, ArrowRight, Clock, Search, Server, Settings, Star, X } from 'lucide-react';
import { ANALYSIS_DATA, getAppMenuName } from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';

function scoreCommand(command, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const text = `${command.label} ${command.subtitle || ''} ${command.keywords || ''}`.toLowerCase();
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  if (text.includes(q)) return 50;
  return 0;
}

const iconMap = {
  recent: Clock,
  app: Activity,
  menu: Star,
  system: Settings,
  server: Server,
};

export default function CommandPalette({
  isOpen,
  onClose,
  menuItems = [],
  onNavigate,
  onOpenDiagnostics,
  onOpenServerSettings,
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const { recentApps } = useRecentActivity();

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [isOpen]);

  const commands = useMemo(() => {
    const recent = recentApps.map(item => ({
      id: `recent:${item.menu}`,
      type: 'recent',
      label: item.label,
      subtitle: item.category || item.mode || '최근 사용 앱',
      action: () => onNavigate(item.menu),
    }));

    const menus = menuItems.map(item => ({
      id: `menu:${item.menu}`,
      type: 'menu',
      label: item.label,
      subtitle: '메뉴 이동',
      action: () => onNavigate(item.menu),
    }));

    const apps = ANALYSIS_DATA.map(app => ({
      id: `app:${app.title}`,
      type: 'app',
      label: app.title,
      subtitle: `${app.mode} · ${app.category}`,
      keywords: `${app.description} ${(app.tags || []).join(' ')}`,
      action: () => onNavigate(getAppMenuName(app.title)),
    }));

    const system = [
      {
        id: 'system:diagnostics',
        type: 'server',
        label: '서버 진단 열기',
        subtitle: '네트워크 상태 · API 오류 · 버전 확인',
        action: onOpenDiagnostics,
      },
      {
        id: 'system:server-settings',
        type: 'system',
        label: '서버 주소 설정',
        subtitle: '백엔드 API URL 변경',
        action: onOpenServerSettings,
      },
      {
        id: 'system:settings',
        type: 'system',
        label: 'System Management',
        subtitle: '운영 대시보드 열기',
        action: () => onNavigate('System Management'),
      },
    ];

    return [...recent, ...system, ...menus, ...apps];
  }, [menuItems, onNavigate, onOpenDiagnostics, onOpenServerSettings, recentApps]);

  const filtered = useMemo(() => {
    return commands
      .map(command => ({ command, score: scoreCommand(command, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.command)
      .slice(0, 12);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const execute = (command) => {
    if (!command) return;
    command.action?.();
    onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      execute(filtered[activeIndex]);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[99999]">
      <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-x-0 top-[10vh] mx-auto w-[min(760px,calc(100vw-2rem))]">
        <Dialog.Panel className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Search size={18} className="text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="명령, 앱, 메뉴 검색...  예: BDF, 서버 진단, 최근 작업"
              className="h-9 flex-1 border-0 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
            <span className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 sm:inline">Ctrl K</span>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[58vh] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm font-medium text-slate-400">일치하는 명령이 없습니다.</div>
            ) : filtered.map((command, index) => {
              const Icon = iconMap[command.type] || Activity;
              const active = index === activeIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => execute(command)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{command.label}</span>
                      <span className="block truncate text-xs text-slate-500">{command.subtitle}</span>
                    </span>
                  </span>
                  <ArrowRight size={15} className={active ? 'text-blue-500' : 'text-slate-300'} />
                </button>
              );
            })}
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
