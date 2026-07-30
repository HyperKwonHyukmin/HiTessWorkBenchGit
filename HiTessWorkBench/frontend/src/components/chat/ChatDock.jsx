/**
 * @fileoverview 우하단 상주 채팅 도크 — 관리자↔사용자 1:1 DM.
 *
 * polling 기반(WebSocket 없음).
 *  - /threads   : 5초 주기. 미읽음/최근 메시지 → 새 메시지 토스트·자동 펼침
 *  - /contacts  : 패널이 열려 있는 동안 20초 주기. 활성 관리자 전원 + 접속 상태
 *  - /conversation : 대화를 열면 4초 주기. 자신에게 온 미읽음을 읽음 처리
 *
 * 목록 화면은 '관리자 로스터 + 기타 대화' 통합 목록이다(ChatRosterList). 사용자는 패널을
 * 여는 것만으로 누가 지금 응답 가능한지 보고 먼저 대화를 걸 수 있다.
 *
 * 외부에서 특정 사용자와 대화를 열려면 window 커스텀 이벤트를 발생시킨다:
 *   window.dispatchEvent(new CustomEvent('workbench:open-chat',
 *     { detail: { employeeId, name } }))
 * (User Management 접속자 카드의 '대화' 버튼이 이 방식으로 도크를 연다.)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, ChevronLeft, Minus, Trash2 } from 'lucide-react';
import {
  getChatThreads,
  getChatContacts,
  getChatConversation,
  sendChatMessage,
  deleteChatConversation,
} from '../../api/chat';
import ChatRosterList from './ChatRosterList';
import {
  buildChatSections,
  formatChatTime,
  statusDotClass,
  statusLabel,
} from '../../utils/chatContacts';
import { useToast } from '../../contexts/ToastContext';

const THREADS_POLL_MS = 5000;
const CONVERSATION_POLL_MS = 4000;
// 관리자 접속 상태 갱신 주기. 패널이 열려 있는 동안만 돌아 접힘 상태에서는 부하가 없다.
const CONTACTS_POLL_MS = 20000;

export default function ChatDock({
  currentUserId,
  // 도크 노출 여부가 로그인 상태만으로 결정되면서 화면 분기에는 더 쓰이지 않는다.
  // 호출부(UtilityDock)의 인터페이스를 유지하기 위해 prop 은 그대로 받는다.
  isAdmin = false,
  embedded = false,
  isOpen,
  onOpenChange,
  hideLauncher = false,
  onUnreadChange,
  onAvailabilityChange,
}) {
  const { showToast } = useToast();

  const [internalOpen, setInternalOpen] = useState(false);
  const [threads, setThreads] = useState([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [activeOther, setActiveOther] = useState(null); // { id, name }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // 삭제 확인 대기 중인 상대 { id, name }
  const [contacts, setContacts] = useState([]);
  const [contactsError, setContactsError] = useState(false);

  const prevUnreadRef = useRef(null); // null = 최초 폴링(무음 baseline)
  const activeIdRef = useRef(null);
  const scrollRef = useRef(null);

  activeIdRef.current = activeOther?.id || null;
  const isControlled = typeof isOpen === 'boolean';
  const open = isControlled ? isOpen : internalOpen;
  const setDockOpen = useCallback((nextOpen) => {
    if (!isControlled) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  const openConversation = useCallback(async (other) => {
    setActiveOther({ id: other.id, name: other.name });
    setDockOpen(true);
    setMessages([]);
    try {
      const res = await getChatConversation(other.id);
      setMessages(res.data.messages || []);
    } catch {
      // 조회 실패는 조용히 무시(다음 폴링에서 재시도).
    }
  }, [setDockOpen]);

  // 폴링 effect 안에서 최신 openConversation/setDockOpen 을 쓰기 위한 ref.
  // deps 에 직접 넣으면 부모가 넘기는 인라인 onOpenChange 때문에 매 렌더마다
  // 폴링 interval 이 재생성된다.
  const openConversationRef = useRef(openConversation);
  openConversationRef.current = openConversation;
  const setDockOpenRef = useRef(setDockOpen);
  setDockOpenRef.current = setDockOpen;

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
          // 세션 중 새 메시지 도착 — 토스트로 알리고 대화창을 즉시 띄운다.
          // (자동으로 열면 곧바로 읽음 처리되어 미읽음 뱃지는 사라지지만,
          //  대화창이 화면에 떠 있으므로 놓칠 일이 없다는 판단.)
          const newest = list.find((t) => t.unread > 0); // list 는 최신순
          if (newest) {
            showToast(
              `💬 ${newest.other_name || newest.other_id}: ${newest.last_message || ''}`,
              'info',
            );
            if (activeIdRef.current === newest.other_id) {
              // 이미 그 대화를 열어 둔 상태 — 다시 로드하면 스크롤이 초기화되므로
              // 접혀 있던 도크만 펼친다(대화 폴링이 새 메시지를 곧 채운다).
              setDockOpenRef.current(true);
            } else {
              openConversationRef.current({
                id: newest.other_id,
                name: newest.other_name,
              });
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
  }, [currentUserId, showToast]);

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

  // 관리자 로스터 폴링 — 패널이 열려 있는 동안만 돌린다.
  // threads(5초)에 합치지 않는 이유: 합치면 패널을 열지 않은 전 사용자가 5초마다
  // 관리자 명단·접속 상태를 받아 상시 부하가 사용자 수에 비례해 늘어난다.
  useEffect(() => {
    if (!currentUserId || !open) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getChatContacts();
        if (cancelled) return;
        setContacts(res.data.items || []);
        setContactsError(false);
      } catch {
        // 실패해도 threads 로 만든 목록은 유지된다(기존 대화가 사라지면 안 됨).
        if (!cancelled) setContactsError(true);
      }
    };

    poll();
    const timer = setInterval(poll, CONTACTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentUserId, open]);

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

  const sections = useMemo(() => buildChatSections(contacts, threads), [contacts, threads]);
  // 대화창 헤더·배너용 상태. 출처가 contacts 뿐이라 상대가 관리자가 아니면 null 이다.
  const activeStatus = activeOther
    ? (contacts.find((c) => c.employee_id === activeOther.id)?.status || null)
    : null;

  // 도크는 로그인한 모든 사용자에게 노출한다 — 사용자가 관리자에게 먼저 문의할 수 있어야
  // 하므로, '받은 대화가 있을 때만' 이라는 기존 조건은 진입점 자체를 없애 버린다.
  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  useEffect(() => {
    onAvailabilityChange?.(!!currentUserId);
  }, [currentUserId, onAvailabilityChange]);

  if (!currentUserId) return null;

  // 접힌 상태 — 플로팅 버튼 + 미읽음 뱃지.
  if (!open) {
    if (hideLauncher) return null;
    return (
      <button
        type="button"
        onClick={() => setDockOpen(true)}
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
    <div className={`w-[min(360px,calc(100vw-2rem))] h-[min(480px,calc(100vh-7rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden ${
      embedded ? 'relative' : 'fixed bottom-6 right-6 z-[99990]'
    }`}>
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
            <span className="font-bold text-sm truncate">
              {activeOther.name || activeOther.id}
            </span>
            {activeStatus && (
              <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-white/70">
                <span
                  className={`h-2 w-2 rounded-full ${statusDotClass(activeStatus)}`}
                  aria-hidden="true"
                />
                {statusLabel(activeStatus)}
              </span>
            )}
            <span className="flex-1" />
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
          onClick={() => setDockOpen(false)}
          className="text-white/80 hover:text-white cursor-pointer"
          aria-label="접기"
        >
          <Minus size={20} />
        </button>
      </div>

      {/* 본문 */}
      {activeOther ? (
        <>
          {activeStatus === 'offline' && (
            <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              현재 부재중입니다. 메시지는 저장되며 접속 후 확인합니다.
            </div>
          )}
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
                      {formatChatTime(m.created_at)}
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
        <ChatRosterList
          sections={sections}
          error={contactsError}
          onPick={(row) => openConversation({ id: row.other_id, name: row.name })}
          onDelete={(row) => setConfirmDelete({ id: row.other_id, name: row.name })}
        />
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
