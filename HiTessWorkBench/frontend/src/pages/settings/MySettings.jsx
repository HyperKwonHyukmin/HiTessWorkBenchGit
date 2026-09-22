/**
 * @fileoverview 개인 환경설정 — 내 정보 / 시작 화면 / 알림 수신 / 초기화 4카드(spec §5.5).
 *
 * 진입 경로: 헤더 사용자 블록 클릭 · 명령 팔레트('My Settings') · App.jsx renderPage 케이스.
 * 저장은 모두 PreferencesContext.updatePrefs 를 거친다 — 화면은 즉시 바뀌고
 * 500ms 디바운스로 `PUT /api/preferences` 가 나간다(실패 시 30초 재시도).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { UserCog, RefreshCw, WifiOff, Check } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useAppCatalogue, useFavorites, findAppByAnyName, getAppMenuName } from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { NOTIFICATION_KINDS } from '../../constants/notificationKinds';

// App.jsx 의 landing_menu 적용 effect 가 인정하는 메뉴 상수와 같은 목록이어야 한다.
// (여기에만 있는 값을 고르면 로그인 시 무시되고 Dashboard 로 열린다.)
const BASE_MENUS = [
  { menu: 'Dashboard',         label: 'Dashboard(기본)' },
  { menu: 'My Projects',       label: 'My Projects' },
  { menu: 'Model Library',     label: 'Model Library' },
  { menu: 'File-Based Apps',   label: 'File-Based Apps' },
  { menu: 'Interactive Apps',  label: 'Interactive Apps' },
  { menu: 'Parametric Apps',   label: 'Parametric Apps' },
  { menu: 'Productivity Apps', label: 'Productivity Apps' },
  { menu: 'Notice & Updates',  label: 'Notice & Updates' },
  { menu: 'User Guide',        label: 'User Guide' },
];

const ADMIN_MENU_ITEMS = [
  { menu: 'User Management',     label: 'User Management' },
  { menu: 'Analysis Management', label: 'Analysis Management' },
  { menu: 'System Management',   label: 'System Settings' },
  { menu: 'Usage Reports',       label: 'Usage Reports' },
  { menu: 'App Community',       label: 'App Community' },
  { menu: 'App Settings',        label: 'App Settings' },
  { menu: 'API Apps',            label: 'API Apps' },
];

/** 서버 동기화 상태 배지 — PreferencesContext.status(idle|loading|ready|offline). */
function StatusBadge({ status }) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold text-white">
        <RefreshCw size={12} className="animate-spin" /> 동기화 중
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
        <WifiOff size={12} /> 서버 연결 없음 · 이 PC 에만 저장됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
      <Check size={12} /> 서버와 동기화됨
    </span>
  );
}

function Card({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export default function MySettings() {
  const { user } = useAuth();
  const { prefs, status, updatePrefs } = usePreferences();
  const { favorites, clearFavorites } = useFavorites();
  const { recentApps, clearRecentApps } = useRecentActivity();
  const { apps: catalogue } = useAppCatalogue();
  const isAdmin = !!user?.is_admin;

  const [confirming, setConfirming] = useState(null);   // 'favorites' | 'recent' | null

  // 즐겨찾기에 담긴 앱은 시작 화면 후보로도 제공한다(페이지가 있는 앱만).
  const favoriteMenus = useMemo(() => {
    const seen = new Set();
    return (favorites || []).reduce((items, storedTitle) => {
      const canonical = findAppByAnyName(storedTitle)?.title ?? storedTitle;
      const app = catalogue.find(a => a.title === canonical);
      if (!app || !app.hasPage) return items;
      const menu = getAppMenuName(app.title);
      if (seen.has(menu)) return items;
      seen.add(menu);
      items.push({ menu, label: app.title });
      return items;
    }, []);
  }, [favorites, catalogue]);

  const onLandingChange = useCallback((menu) => {
    updatePrefs({ landing_menu: menu || null });
  }, [updatePrefs]);

  const notifications = prefs?.notifications || { muted_kinds: [], desktop_toast: true };
  const mutedSet = useMemo(() => new Set(notifications.muted_kinds || []), [notifications.muted_kinds]);

  const setDesktopToast = useCallback((next) => {
    updatePrefs({ notifications: { desktop_toast: !!next } });
  }, [updatePrefs]);

  const setKindEnabled = useCallback((kind, enabled) => {
    const current = new Set(notifications.muted_kinds || []);
    if (enabled) current.delete(kind); else current.add(kind);
    updatePrefs({ notifications: { muted_kinds: [...current].sort() } });
  }, [notifications.muted_kinds, updatePrefs]);

  const groupedKinds = useMemo(() => {
    const bucket = new Map();
    for (const k of NOTIFICATION_KINDS) {
      const list = bucket.get(k.group) || [];
      list.push(k);
      bucket.set(k.group, list);
    }
    return [...bucket.entries()];
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={UserCog}
        accentColor="indigo"
        title="My Settings"
        subtitle="즐겨찾기 · 최근 사용 앱 · 시작 화면 · 알림 수신 설정은 사번 단위로 서버에 저장됩니다."
        actions={<StatusBadge status={status} />}
      />

      <div className="space-y-4 pb-6">
        <Card title="내 정보" description="변경은 관리자에게 요청하세요.">
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">사번</dt><dd className="font-bold text-slate-800">{user?.employee_id || '-'}</dd>
            <dt className="text-slate-500">이름</dt><dd className="text-slate-700">{user?.name || '-'}</dd>
            <dt className="text-slate-500">부서</dt><dd className="text-slate-700">{user?.department || '-'}</dd>
            <dt className="text-slate-500">직급</dt><dd className="text-slate-700">{user?.position || '-'}</dd>
          </dl>
        </Card>

        <Card title="시작 화면" description="로그인 직후 자동으로 열릴 화면을 고릅니다. Dashboard 는 기본값입니다.">
          <select
            value={prefs?.landing_menu || 'Dashboard'}
            onChange={(e) => onLandingChange(e.target.value === 'Dashboard' ? null : e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {BASE_MENUS.map(opt => (
              <option key={opt.menu} value={opt.menu}>{opt.label}</option>
            ))}
            {favoriteMenus.length > 0 && (
              <optgroup label="즐겨찾기 앱">
                {favoriteMenus.map(opt => (
                  <option key={`fav-${opt.menu}`} value={opt.menu}>{opt.label}</option>
                ))}
              </optgroup>
            )}
            {isAdmin && (
              <optgroup label="관리자 메뉴">
                {ADMIN_MENU_ITEMS.map(opt => (
                  <option key={`admin-${opt.menu}`} value={opt.menu}>{opt.label}</option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            접근 권한이 없는 메뉴나 사용 중지된 앱을 골라 두면 Dashboard 로 열립니다.
          </p>
        </Card>

        <Card
          title="알림 수신"
          description="종 아이콘의 알림 중 어떤 것을 받을지 고릅니다. 데스크톱 알림은 창이 뒤에 있을 때 Windows 알림으로 뜹니다."
        >
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={notifications.desktop_toast !== false}
              onChange={(e) => setDesktopToast(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            데스크톱 알림 표시(Windows 토스트)
          </label>
          <div className="space-y-3">
            {groupedKinds.map(([group, kinds]) => (
              <div key={group}>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{group}</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {kinds.map(k => (
                    <label key={k.kind} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={!mutedSet.has(k.kind)}
                        onChange={(e) => setKindEnabled(k.kind, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      {k.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            체크를 해제한 종류는 서버에서 아예 만들지 않습니다(이미 쌓인 알림은 그대로 남습니다).
          </p>
        </Card>

        <Card title="초기화" description="이 목록을 비우면 서버에도 즉시 반영됩니다.">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming('favorites')}
              disabled={(favorites || []).length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              즐겨찾기 비우기({(favorites || []).length}개)
            </button>
            <button
              type="button"
              onClick={() => setConfirming('recent')}
              disabled={(recentApps || []).length === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              최근 사용 비우기({(recentApps || []).length}개)
            </button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={confirming === 'favorites'}
        variant="warning"
        title="즐겨찾기를 모두 지울까요?"
        message="이 사번의 즐겨찾기 목록을 서버에서도 비웁니다."
        confirmLabel="비우기"
        onConfirm={() => { clearFavorites(); setConfirming(null); }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        isOpen={confirming === 'recent'}
        variant="warning"
        title="최근 사용 기록을 모두 지울까요?"
        message="다른 PC 에서 보이는 이 사번의 최근 사용 기록도 함께 비워집니다."
        confirmLabel="비우기"
        onConfirm={() => { clearRecentApps(); setConfirming(null); }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
