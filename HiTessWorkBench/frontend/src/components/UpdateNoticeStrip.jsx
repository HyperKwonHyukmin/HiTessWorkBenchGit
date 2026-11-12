import React, { useEffect, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { fetchUpdateEntries } from '../api/updates';
import { pickStripEntry, seenStorageKey } from '../utils/updateNotices';
import { getEmployeeId } from '../utils/auth';
import UpdateNoticeModal from './UpdateNoticeModal';

function readSeen(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 대시보드의 '새 기능 안내' 한 줄(2026-11-12). 최근 30일 안의 최신 업데이트 안내를 보이고, 누르면 앱 안 안내 창을 연다.
 * 30일 안 안내가 없거나 옛 서버(목록 없음)면 아무것도 그리지 않는다. NEW = 14일 안이고 이 PC 에서 이 사번이 안 연 안내.
 */
export default function UpdateNoticeStrip() {
  const [entries, setEntries] = useState([]);
  const [seen, setSeen] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const key = seenStorageKey(getEmployeeId());

  useEffect(() => {
    const controller = new AbortController();
    fetchUpdateEntries({ signal: controller.signal }).then(setEntries);
    setSeen(readSeen(key));
    return () => controller.abort();
  }, [key]);

  const { entry, newCount } = pickStripEntry(entries, { seenIds: seen, includeTest: import.meta.env.DEV });
  if (!entry) return null;

  const open = (id) => {
    // 연 안내는 NEW 에서 뺀다 — 목록을 열면 지금 보이는 안내를 본 것으로 친다(페이지 안에서 다른 안내를 고른 것까지는 모른다).
    const next = Array.from(new Set([...seen, id || entry.id])).slice(-200);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 저장 실패는 NEW 가 남을 뿐 */ }
    setSeen(next);
    setOpenId(id);
    setIsOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-sm hover:border-blue-300 transition-colors">
        <button type="button" onClick={() => open(entry.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-md border border-emerald-100 bg-emerald-50 p-1.5">
              <Sparkles size={13} className="text-emerald-700" aria-hidden="true" />
            </span>
            <span className="whitespace-nowrap text-[11px] font-bold text-slate-700">새 기능 안내</span>
            {newCount > 0 && (
              <span className="rounded-full border border-red-100 bg-red-50 px-1.5 py-0.5 text-[11px] font-extrabold text-red-700">NEW {newCount}</span>
            )}
          </span>
          <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {entry.app && (
              <span className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 md:inline">{entry.app}</span>
            )}
            <span className="truncate text-xs font-semibold text-slate-700">{entry.title}</span>
            <span className="hidden shrink-0 text-[11px] text-slate-500 sm:inline">{entry.date}</span>
          </span>
        </button>
        <button type="button" onClick={() => open(null)} aria-label="업데이트 안내 전체 보기"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-blue-50 hover:text-blue-600">
          <span className="hidden md:inline">전체 안내</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      <UpdateNoticeModal isOpen={isOpen} entryId={openId} onClose={() => setIsOpen(false)} />
    </>
  );
}
