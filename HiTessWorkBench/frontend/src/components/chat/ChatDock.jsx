/**
 * @fileoverview 우하단 상주 채팅 도크 — 관리자↔사용자 1:1 DM.
 *
 * polling 기반(WebSocket 없음). /threads 를 주기적으로 폴링해 미읽음/최근 메시지를 받고,
 * 대화를 열면 /conversation 을 폴링하며 자신에게 온 미읽음을 읽음 처리한다.
 * 새 메시지가 오면 토스트로 즉시 알리고 도크를 자동으로 펼친다.
 *
 * 외부에서 특정 사용자와 대화를 열려면 window 커스텀 이벤트를 발생시킨다:
 *   window.dispatchEvent(new CustomEvent('workbench:open-chat',
 *     { detail: { employeeId, name } }))
 * (User Management 접속자 카드의 '대화' 버튼이 이 방식으로 도크를 연다.)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, ChevronLeft, Minus } from 'lucide-react';
import { getChatThreads, getChatConversation, sendChatMessage } from '../../api/chat';
import { useToast } from '../../contexts/ToastContext';

const THREADS_POLL_MS = 5000;
const CONVERSATION_POLL_MS = 4000;

/** 'HH:MM' 로컬 시각. */
function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Avatar({ name, id }) {
  const label = (name || id || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="h-9 w-9 shrink-0 rounded-xl bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-bold">
      {label}
    </div>
  );
}

export default function ChatDock({ currentUserId, isAdmin = false }) {
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [activeOther, setActiveOther] = useState(null); // { id, name }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const prevUnreadRef = useRef(null); // null = 최초 폴링(무음 baseline)
  const activeIdRef = useRef(null);
  const scrollRef = useRef(null);

  activeIdRef.current = activeOther?.id || null;

  const openConversation = useCallback(async (other) => {
    setActiveOther({ id: other.id, name: other.name });
    setOpen(true);
    setMessages([]);
    try {
      const res = await getChatConversation(other.id);
      setMessages(res.data.messages || []);
    } catch {
      // 조회 실패는 조용히 무시(다음 폴링에서 재시도).
    }
  }, []);

  // 대화 목록 폴링 + 새 메시지 감지 → 토스트/자동 펼침.
  useEffect(() => {
    if (!currentUserId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getChatThreads();
        if (cancelled) return;
        const data = res.data || {};
        const list = data.threads || [];
        const unread = data.total_unread || 0;
        setThreads(list);
        setTotalUnread(unread);

        // 최초 폴링은 baseline 만 잡고 알리지 않는다(로그인 시 과거 미읽음으로 인한 놀람 방지).
        if (prevUnreadRef.current !== null && unread > prevUnreadRef.current) {
          const newest = list.find((t) => t.unread > 0); // list 는 최신순
          if (newest) {
            showToast(
              `💬 ${newest.other_name || newest.other_id}: ${newest.last_message || ''}`,
              'info',
            );
            setOpen(true);
            // 현재 열려 있는 대화가 없을 때만 새 메시지의 대화를 자동으로 연다.
            if (!activeIdRef.current) {
              openConversation({ id: newest.other_id, name: newest.other_name });
            }
          }
        }
        prevUnreadRef.current = unread;
      } catch {
        // 폴링 실패는 조용히 무시.
      }
    };

    poll();
    const timer = setInterval(poll, THREADS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentUserId, showToast, openConversation]);

  // 열린 대화 폴링(상대 답장 수신 + 읽음 처리).
  useEffect(() => {
    if (!activeOther?.id) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getChatConversation(activeOther.id);
        if (!cancelled) setMessages(res.data.messages || []);
      } catch {
        // 무시.
      }
    };

    const timer = setInterval(poll, CONVERSATION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeOther]);

  // 외부(User Management 등)에서 특정 사용자와 대화 열기.
  useEffect(() => {
    const handler = (e) => {
      const { employeeId, name } = e.detail || {};
      if (!employeeId) return;
      openConversation({ id: employeeId, name });
    };
    window.addEventListener('workbench:open-chat', handler);
    return () => window.removeEventListener('workbench:open-chat', handler);
  }, [openConversation]);

  // 메시지 갱신 시 맨 아래로 스크롤.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !activeOther?.id || sending) return;
    setSending(true);
    try {
      await sendChatMessage(activeOther.id, body);
      setDraft('');
      const res = await getChatConversation(activeOther.id);
      setMessages(res.data.messages || []);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(detail || '메시지 전송에 실패했습니다.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 도크 자체를 노출할지: 관리자는 항상, 일반 사용자는 대화가 있을 때만.
  const shouldShow = isAdmin || threads.length > 0 || totalUnread > 0;
  if (!currentUserId || !shouldShow) return null;

  // 접힌 상태 — 플로팅 버튼 + 미읽음 뱃지.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[99990] h-14 w-14 rounded-full bg-[#002554] text-white shadow-xl flex items-center justify-center hover:bg-[#00366f] transition-colors cursor-pointer"
        title="메시지"
        aria-label="메시지 열기"
      >
        <MessageCircle size={24} />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center border-2 border-white">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>
    );
  }

  // 펼친 상태 — 대화 목록 또는 대화창.
  return (
    <div className="fixed bottom-6 right-6 z-[99990] w-[min(360px,calc(100vw-2rem))] h-[min(480px,calc(100vh-6rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#002554] text-white shrink-0">
        {activeOther ? (
          <>
            <button
              type="button"
              onClick={() => setActiveOther(null)}
              className="text-white/80 hover:text-white cursor-pointer"
              aria-label="대화 목록으로"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="font-bold text-sm flex-1 truncate">
              {activeOther.name || activeOther.id}
            </span>
          </>
        ) : (
          <>
            <MessageCircle size={18} />
            <span className="font-bold text-sm flex-1">메시지</span>
            {totalUnread > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs font-bold">
                {totalUnread}
              </span>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-white/80 hover:text-white cursor-pointer"
          aria-label="접기"
        >
          <Minus size={20} />
        </button>
      </div>

      {/* 본문 */}
      {activeOther ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                아직 대화가 없습니다. 첫 메시지를 보내보세요.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap ${
                      m.mine
                        ? 'bg-[#002554] text-white rounded-br-sm'
                        : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {m.body}
                    <div
                      className={`mt-1 text-[10px] ${m.mine ? 'text-white/60' : 'text-slate-400'}`}
                    >
                      {formatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 입력 */}
          <div className="shrink-0 border-t border-slate-200 p-2 flex items-end gap-2 bg-white">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요…"
              className="flex-1 resize-none max-h-24 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="h-9 w-9 shrink-0 rounded-xl bg-[#002554] text-white flex items-center justify-center hover:bg-[#00366f] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              aria-label="전송"
            >
              <Send size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto bg-white">
          {threads.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400 px-6 text-center">
              {isAdmin
                ? 'User Management 접속자 카드의 “대화” 버튼으로 대화를 시작하세요.'
                : '아직 받은 메시지가 없습니다.'}
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.other_id}
                type="button"
                onClick={() => openConversation({ id: t.other_id, name: t.other_name })}
                className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-50 border-b border-slate-100 text-left cursor-pointer"
              >
                <Avatar name={t.other_name} id={t.other_id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-700 truncate">
                      {t.other_name || t.other_id}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                      {formatTime(t.last_at)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{t.last_message}</div>
                </div>
                {t.unread > 0 && (
                  <span className="ml-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {t.unread}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
