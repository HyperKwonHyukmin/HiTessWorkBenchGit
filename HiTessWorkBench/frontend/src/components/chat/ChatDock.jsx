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
import { MessageCircle, Send, ChevronLeft, Minus, Trash2 } from 'lucide-react';
import {
  getChatThreads,
  getChatConversation,
  sendChatMessage,
  deleteChatConversation,
} from '../../api/chat';
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
  const [confirmDelete, setConfirmDelete] = useState(null); // 삭제 확인 대기 중인 상대 { id, name }

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

        if (prevUnreadRef.current === null) {
          // 로그인 후 첫 폴링 — 오프라인 중 받은 미읽음이 있으면 토스트로 알린다.
          // 도크는 접힌 채로 두어 우하단 버튼에 미읽음 숫자가 남게 한다(자동으로 열지 않음).
          if (unread > 0) {
            showToast(`읽지 않은 메시지 ${unread}개가 있습니다.`, 'info');
          }
        } else if (unread > prevUnreadRef.current) {
          // 세션 중 새 메시지 도착 — 토스트로만 알리고 도크는 접힌 채로 둔다.
          // 대화를 자동으로 열면 즉시 읽음 처리되어 우하단 버튼의 미읽음 뱃지가
          // 곧바로 사라진다. 뱃지가 유지되도록, 관리자가 직접 버튼을 눌러
          // 대화를 열 때만 읽음 처리한다.
          const newest = list.find((t) => t.unread > 0); // list 는 최신순
          if (newest) {
            showToast(
              `💬 ${newest.other_name || newest.other_id}: ${newest.last_message || ''}`,
              'info',
            );
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

  const handleConfirmDelete = async () => {
    const target = confirmDelete;
    if (!target) return;
    try {
      await deleteChatConversation(target.id);
      // 삭제한 대화가 열려 있으면 목록으로 되돌아간다.
      if (activeIdRef.current === target.id) {
        setActiveOther(null);
        setMessages([]);
      }
      const res = await getChatThreads();
      setThreads(res.data.threads || []);
      setTotalUnread(res.data.total_unread || 0);
      prevUnreadRef.current = res.data.total_unread || 0;
      showToast('대화를 삭제했습니다. 상대방에게는 그대로 남습니다.', 'success');
    } catch {
      showToast('대화 삭제에 실패했습니다.', 'error');
    } finally {
      setConfirmDelete(null);
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
            <button
              type="button"
              onClick={() => setConfirmDelete({ id: activeOther.id, name: activeOther.name })}
              className="text-white/80 hover:text-white cursor-pointer"
              title="대화 삭제"
              aria-label="대화 삭제"
            >
              <Trash2 size={17} />
            </button>
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
              <div
                key={t.other_id}
                className="group/row flex items-center gap-2 px-3 py-3 hover:bg-slate-50 border-b border-slate-100"
              >
                <button
                  type="button"
                  onClick={() => openConversation({ id: t.other_id, name: t.other_name })}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
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
                </button>
                {t.unread > 0 && (
                  <span className="min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {t.unread}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ id: t.other_id, name: t.other_name })}
                  className="shrink-0 rounded-lg p-1.5 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100 cursor-pointer"
                  title="대화 삭제"
                  aria-label={`${t.other_name || t.other_id} 대화 삭제`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 삭제 확인 오버레이 */}
      {confirmDelete && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="h-12 w-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
            <Trash2 size={22} />
          </div>
          <p className="text-sm text-slate-600">
            <span className="font-bold text-slate-800">
              {confirmDelete.name || confirmDelete.id}
            </span>
            {' 님과의 대화를 삭제할까요?'}
            <br />
            <span className="text-xs text-slate-400">
              내 화면에서만 지워지고 상대방에게는 그대로 남습니다.
            </span>
          </p>
          <div className="flex gap-2 w-full">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 cursor-pointer"
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
