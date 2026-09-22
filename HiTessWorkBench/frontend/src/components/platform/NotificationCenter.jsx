/**
 * @fileoverview 헤더 알림 센터 — 종 아이콘 + 미읽음 배지 + 인박스 드롭다운 패널.
 *
 * 서버가 남긴 알림(notifications)을 useNotifications 가 30초 폴링으로 가져온다.
 *  - 새 알림 → 인앱 토스트(항상) + 데스크톱 토스트(창이 포커스를 잃었고 desktop_toast 일 때).
 *    수신 설정(muted_kinds·desktop_toast)은 서버 환경설정(My Settings → PreferencesContext)에서 읽는다.
 *  - 항목 클릭 → 읽음 처리 + link 로 이동. link.params.analysis_id 가 있으면 해당 해석 행을 받아
 *    Dashboard→MyProjects 와 같은 sessionStorage('workbench:open-project-detail') 로 넘겨 상세 모달을 연다.
 *    이동은 기존 'workbench:navigate' 이벤트(Layout 의 handleNavigate, 관리자 게이트 포함)를 쓴다.
 * 우하단 UtilityDock(작업 진행)과 역할이 다르다 — 여기는 '서버가 남긴 통지'다.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, CheckCheck, CheckCircle2, Info, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useNotifications } from '../../hooks/useNotifications';
import { useNotificationPrefs } from '../../hooks/useNotificationPrefs';
import { getAnalysisById } from '../../api/analysis';
import {
  formatNotificationTime,
  notificationKindMeta,
  resolveNotificationTarget,
  toastToneFor,
} from '../../utils/notificationLink';
import { ensureDesktopNotificationPermission, showDesktopNotification } from '../../utils/desktopNotification';

// Dashboard.jsx / MyProjects.jsx 가 쓰는 키·이벤트 이름과 같아야 한다.
const OPEN_PROJECT_DETAIL_KEY = 'workbench:open-project-detail';
const OPEN_PROJECT_DETAIL_EVENT = 'workbench:open-project-detail';

const TONE_ICON = {
  success: <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />,
  error: <AlertCircle size={16} className="shrink-0 text-red-500" />,
  warning: <AlertCircle size={16} className="shrink-0 text-amber-500" />,
  info: <Info size={16} className="shrink-0 text-blue-500" />,
  neutral: <Info size={16} className="shrink-0 text-slate-400" />,
};

/**
 * 알림 링크로 이동한다. analysis_id 가 있으면 해석 행을 받아 My Projects 상세 모달을 자동으로 연다.
 * 행 조회 실패(삭제·권한)는 경고만 하고 목록 화면으로는 이동한다.
 */
async function openNotificationLink(link, showToast) {
  const target = resolveNotificationTarget(link);
  if (!target) return;
  if (target.analysisId) {
    try {
      const res = await getAnalysisById(target.analysisId);
      if (res?.data && typeof res.data === 'object') {
        try {
          sessionStorage.setItem(OPEN_PROJECT_DETAIL_KEY, JSON.stringify(res.data));
        } catch {
          // sessionStorage 가 막힌 환경에서는 목록으로만 이동한다.
        }
        window.dispatchEvent(new CustomEvent(OPEN_PROJECT_DETAIL_EVENT));
      }
    } catch {
      showToast?.('해석 기록을 찾을 수 없습니다. 삭제됐거나 권한이 없는 항목입니다.', 'warning');
    }
  }
  window.dispatchEvent(new CustomEvent('workbench:navigate', { detail: { menu: target.menu } }));
}

function NotificationItem({ item, onOpen, onRemove }) {
  const meta = notificationKindMeta(item.kind);
  return (
    <li className={`group flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${item.is_read ? 'bg-white' : 'bg-blue-50/40'}`}>
      <span className="mt-0.5">{TONE_ICON[meta.tone] || TONE_ICON.info}</span>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
      >
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm ${item.is_read ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`} title={item.title}>
            {item.title}
          </p>
          {!item.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="미읽음" />}
        </div>
        {item.body && (
          <p className="mt-0.5 truncate text-xs text-slate-500" title={item.body}>{item.body}</p>
        )}
        <p className="mt-1 text-[10px] font-semibold text-slate-400">
          {meta.label} · {formatNotificationTime(item.created_at)}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30 group-hover:opacity-100"
        title="알림 삭제"
        aria-label={`${item.title} 알림 삭제`}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const currentUserId = user?.employee_id || null;
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  // 데스크톱 토스트 여부는 서버 환경설정(PreferencesContext)에서 읽는다 —
  // My Settings 에서 바꾼 값이 30초 폴링을 기다리지 않고 바로 반영된다.
  const { desktopToast, mutedKinds } = useNotificationPrefs();
  const prefsRef = useRef({ muted_kinds: mutedKinds, desktop_toast: desktopToast });

  // 새 알림 도착(폴링 델타) — 최신 1건만 토스트로 알린다(여러 건이면 건수를 덧붙인다).
  const handleNew = useCallback((fresh) => {
    const newest = fresh[0];
    if (!newest) return;
    // 서버가 이미 muted kind 를 만들지 않지만, 방금 끈 설정이 반영되기 전 항목까지 막는다.
    if (prefsRef.current.muted_kinds?.includes?.(newest.kind)) return;
    const extra = fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : '';
    const openLink = () => openNotificationLink(newest.link, showToast);
    showToast(`${newest.title}${extra}`, toastToneFor(newest.kind), 8000, {
      onClick: openLink,
      actionLabel: '열기',
    });
    const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : true;
    if (prefsRef.current.desktop_toast && !focused) {
      showDesktopNotification({
        title: newest.title,
        body: newest.body || '',
        tag: `workbench-notification-${newest.id}`,
        onClick: openLink,
      });
    }
  }, [showToast]);

  const { items, unreadCount, loading, reload, markRead, markAllRead, remove } =
    useNotifications({ currentUserId, onNew: handleNew });

  useEffect(() => {
    prefsRef.current = { muted_kinds: mutedKinds, desktop_toast: desktopToast };
  }, [mutedKinds, desktopToast]);

  // 바깥 클릭·Esc 로 닫기.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      if (next) {
        reload();
        // 브라우저(dev)에서는 첫 사용자 제스처에서 권한을 묻는다. Electron 은 이미 granted.
        ensureDesktopNotificationPermission();
      }
      return next;
    });
  };

  const handleOpenItem = async (item) => {
    setOpen(false);
    if (!item.is_read) markRead(item.id);
    await openNotificationLink(item.link, showToast);
  };

  if (!currentUserId) return null;

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        className={`relative rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          open ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
        }`}
        title={unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}건` : '알림'}
        aria-label="알림"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="알림 센터"
          className="absolute right-0 top-full z-[99] mt-2 flex max-h-[min(520px,calc(100vh-6rem))] w-[min(384px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Bell size={16} className="text-brand-blue" />
            <h2 className="text-sm font-bold text-slate-800">알림</h2>
            {unreadCount > 0 && (
              <span className="rounded-full bg-blue-600 px-2 text-[10px] font-bold leading-5 text-white">{badge}</span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
              title="모두 읽음"
            >
              <CheckCheck size={14} />
              모두 읽음
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="알림 닫기"
            >
              <X size={16} />
            </button>
          </header>

          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bell size={30} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-700">
                  {loading ? '알림을 불러오는 중…' : '새 알림이 없습니다.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">해석이 끝나면 여기에 알림이 쌓입니다. 90일 동안 보관됩니다.</p>
              </div>
            ) : (
              <ul>
                {items.map(item => (
                  <NotificationItem key={item.id} item={item} onOpen={handleOpenItem} onRemove={remove} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
