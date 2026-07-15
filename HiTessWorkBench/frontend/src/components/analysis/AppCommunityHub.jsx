import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit2,
  Loader2,
  Megaphone,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  ThumbsUp,
  Trash2,
} from 'lucide-react';

import {
  acknowledgeEntryNotice,
  createAppNotice,
  createAppRequest,
  deleteAppNotice,
  deleteAppRequest,
  getAppCommunity,
  getAppNotices,
  getAppRequests,
  getEntryNotices,
  replyToAppRequest,
  updateAppNotice,
  updateAppRequest,
  upvoteAppRequest,
} from '../../api/appCommunity';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Modal from '../ui/Modal';

const NOTICE_TYPE_LABELS = {
  Notice: '공지',
  Update: '업데이트',
  Maintenance: '점검',
};

const REQUEST_STATUS = {
  'Under Review': { label: '검토 중', variant: 'warning' },
  Planned: { label: '계획됨', variant: 'success' },
  'In Progress': { label: '진행 중', variant: 'info' },
  Resolved: { label: '해결됨', variant: 'neutral' },
  Completed: { label: '완료', variant: 'neutral' },
};

const EMPTY_NOTICE_FORM = {
  type: 'Notice',
  title: '',
  content: '',
  is_pinned: false,
  show_on_entry: true,
  starts_at: '',
  ends_at: '',
};

const EMPTY_REQUEST_FORM = { title: '', content: '' };

const formatDate = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getEntrySnoozeStorageKey = (appKey, employeeId) =>
  `app-entry-notice-snooze:${employeeId || 'unknown'}:${appKey}`;

const getBannerCollapseKey = (appKey, employeeId) =>
  `app-community-collapsed:${employeeId || 'unknown'}:${appKey}`;

const getBoardSeenKey = (appKey, employeeId) =>
  `app-board-seen:${employeeId || 'unknown'}:${appKey}`;

// ISO 문자열을 <input type="datetime-local">이 받는 'YYYY-MM-DDTHH:mm' 형태로 변환한다.
const toDatetimeLocal = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const readFlag = (key) => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const readTimestamp = (key) => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

export default function AppCommunityHub({ appKey, appName }) {
  const { user, isAdmin } = useAuth();
  const { showToast } = useToast();
  const employeeId = user?.employee_id;

  const [availability, setAvailability] = useState(null);
  const [entryNotices, setEntryNotices] = useState([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [entryDismissal, setEntryDismissal] = useState('');

  const [hubOpen, setHubOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('notices');
  const [screen, setScreen] = useState('hub');
  const [notices, setNotices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [noticeForm, setNoticeForm] = useState(EMPTY_NOTICE_FORM);
  const [editingNotice, setEditingNotice] = useState(null);
  const [deleteNoticeCandidate, setDeleteNoticeCandidate] = useState(null);
  const [requestForm, setRequestForm] = useState(EMPTY_REQUEST_FORM);
  const [editingRequest, setEditingRequest] = useState(null);
  const [deleteRequestCandidate, setDeleteRequestCandidate] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [adminReply, setAdminReply] = useState({ status: 'Under Review', admin_comment: '' });

  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [noticeQuery, setNoticeQuery] = useState('');
  const [requestQuery, setRequestQuery] = useState('');
  const [requestSort, setRequestSort] = useState('votes');
  const [boardSeenAt, setBoardSeenAt] = useState(0);

  // 배너 접힘 상태 + 게시판 신규 글 기준 시각을 사용자·App별 localStorage로 복원한다.
  useEffect(() => {
    setBannerCollapsed(readFlag(getBannerCollapseKey(appKey, employeeId)));
    const seenKey = getBoardSeenKey(appKey, employeeId);
    const stored = readTimestamp(seenKey);
    if (stored) {
      setBoardSeenAt(stored);
    } else {
      // 첫 방문 시각을 기준선으로 잡아, 그 이후 등록된 글만 '새 글'로 센다.
      const now = Date.now();
      setBoardSeenAt(now);
      try {
        window.localStorage.setItem(seenKey, String(now));
      } catch {
        // localStorage 미가용 환경에서는 세션 동안만 0 기준으로 동작한다.
      }
    }
  }, [appKey, employeeId]);

  useEffect(() => {
    let active = true;
    Promise.all([getAppCommunity(appKey), getEntryNotices(appKey)])
      .then(([communityResponse, entryResponse]) => {
        if (!active) return;
        setAvailability(communityResponse.data);
        const pending = entryResponse.data || [];
        setEntryNotices(pending);
        let snoozedToday = false;
        try {
          const storageKey = getEntrySnoozeStorageKey(appKey, employeeId);
          snoozedToday = window.localStorage.getItem(storageKey) === getLocalDateKey();
          if (!snoozedToday) window.localStorage.removeItem(storageKey);
        } catch {
          // localStorage를 사용할 수 없는 환경에서는 공지를 정상 표시한다.
        }
        setEntryOpen(pending.length > 0 && !snoozedToday);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError?.response?.status === 404) setAvailability(false);
        else setAvailability({ notice_enabled: true, board_enabled: true });
      });
    return () => { active = false; };
  }, [appKey, employeeId]);

  const loadHub = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [noticeResponse, requestResponse] = await Promise.all([
        getAppNotices(appKey),
        getAppRequests(appKey),
      ]);
      setNotices(noticeResponse.data || []);
      setRequests(requestResponse.data || []);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'App 소식을 불러오지 못했습니다.'));
    } finally {
      setSummaryLoaded(true);
      setLoading(false);
    }
  }, [appKey]);

  useEffect(() => {
    if (!availability || availability === false) return;
    loadHub();
  }, [availability, loadHub]);

  const markBoardSeen = useCallback(() => {
    const now = Date.now();
    setBoardSeenAt(now);
    try {
      window.localStorage.setItem(getBoardSeenKey(appKey, employeeId), String(now));
    } catch {
      // localStorage 미가용 시 세션 내 state만 갱신한다.
    }
  }, [appKey, employeeId]);

  const toggleBannerCollapse = () => {
    setBannerCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(getBannerCollapseKey(appKey, employeeId), next ? '1' : '0');
      } catch {
        // 저장 실패는 무시 — 현재 세션에서만 접힘 상태를 유지한다.
      }
      return next;
    });
  };

  const openHub = (tab = 'notices') => {
    setScreen('hub');
    setActiveTab(tab);
    setHubOpen(true);
    loadHub();
    if (tab === 'requests') markBoardSeen();
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'requests') markBoardSeen();
  };

  const currentEntry = entryNotices[0];
  const acknowledgeCurrent = async () => {
    if (!currentEntry) return;
    setAcknowledging(true);
    try {
      await acknowledgeEntryNotice(appKey, currentEntry.id);
      const remaining = entryNotices.slice(1);
      setEntryNotices(remaining);
      setEntryDismissal('');
      if (remaining.length === 0) setEntryOpen(false);
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '공지 확인을 저장하지 못했습니다.'), 'error');
    } finally {
      setAcknowledging(false);
    }
  };

  const closeEntryModal = () => {
    setEntryDismissal('');
    setEntryOpen(false);
  };

  const confirmEntryNotice = async () => {
    if (entryDismissal === 'today') {
      try {
        window.localStorage.setItem(
          getEntrySnoozeStorageKey(appKey, employeeId),
          getLocalDateKey(),
        );
      } catch {
        showToast('오늘만 숨김 설정을 저장하지 못했습니다.', 'error');
        return;
      }
      closeEntryModal();
      return;
    }

    if (entryDismissal === 'forever') {
      await acknowledgeCurrent();
      return;
    }

    closeEntryModal();
  };

  // 허브 공지 리스트에서 진입 공지를 직접 확인 처리해 '새 공지' 배지/팝업 재등장 루프를 끊는다.
  const acknowledgeFromHub = async (noticeId) => {
    try {
      await acknowledgeEntryNotice(appKey, noticeId);
      setEntryNotices((prev) => {
        const remaining = prev.filter((item) => item.id !== noticeId);
        if (remaining.length === 0) setEntryOpen(false);
        return remaining;
      });
      showToast('공지를 확인 처리했습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '공지 확인을 저장하지 못했습니다.'), 'error');
    }
  };

  const submitNotice = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...noticeForm,
        app_key: appKey,
        is_private: false,
        publish_status: 'published',
        starts_at: noticeForm.starts_at || null,
        ends_at: noticeForm.ends_at || null,
        author_id: employeeId || '',
        author_name: user?.name || null,
      };
      if (editingNotice) await updateAppNotice(editingNotice.id, payload);
      else await createAppNotice(payload);
      setNoticeForm(EMPTY_NOTICE_FORM);
      setEditingNotice(null);
      setScreen('hub');
      setActiveTab('notices');
      await loadHub();
      showToast(editingNotice ? 'App 공지가 수정되었습니다.' : 'App 공지가 게시되었습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '공지 게시에 실패했습니다.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openNoticeForm = (notice = null) => {
    setEditingNotice(notice);
    setNoticeForm(notice ? {
      type: notice.type || 'Notice',
      title: notice.title || '',
      content: notice.content || '',
      is_pinned: !!notice.is_pinned,
      show_on_entry: !!notice.show_on_entry,
      starts_at: toDatetimeLocal(notice.starts_at),
      ends_at: toDatetimeLocal(notice.ends_at),
    } : EMPTY_NOTICE_FORM);
    setScreen('notice-form');
  };

  const deleteNotice = async () => {
    if (!deleteNoticeCandidate) return;
    try {
      await deleteAppNotice(deleteNoticeCandidate.id);
      setDeleteNoticeCandidate(null);
      await loadHub();
      showToast('App 공지가 삭제되었습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '공지 삭제에 실패했습니다.'), 'error');
    }
  };

  const openRequestForm = (request = null) => {
    setEditingRequest(request);
    setRequestForm(request
      ? { title: request.title || '', content: request.content || '' }
      : EMPTY_REQUEST_FORM);
    setScreen('request-form');
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (editingRequest) {
        await updateAppRequest(editingRequest.id, {
          title: requestForm.title,
          content: requestForm.content,
        });
      } else {
        await createAppRequest({
          ...requestForm,
          app_key: appKey,
          author_id: employeeId || '',
          author_name: user?.name || '',
        });
      }
      setRequestForm(EMPTY_REQUEST_FORM);
      setEditingRequest(null);
      setScreen('hub');
      setActiveTab('requests');
      await loadHub();
      showToast(editingRequest ? '게시글이 수정되었습니다.' : 'App 게시판에 글이 등록되었습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '게시글 저장에 실패했습니다.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteRequest = async () => {
    if (!deleteRequestCandidate) return;
    try {
      await deleteAppRequest(deleteRequestCandidate.id);
      const removedId = deleteRequestCandidate.id;
      setDeleteRequestCandidate(null);
      if (selectedRequest?.id === removedId) {
        setSelectedRequest(null);
        setScreen('hub');
      }
      await loadHub();
      showToast('게시글이 삭제되었습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '게시글 삭제에 실패했습니다.'), 'error');
    }
  };

  // 낙관적 추천: 즉시 카운트를 반영하고, 실패 시 롤백한다(전체 재조회 없음).
  const upvoteRequest = async (request) => {
    if (request.upvoted_by_me) return;
    setRequests((prev) => prev.map((item) =>
      item.id === request.id
        ? { ...item, upvotes: (item.upvotes || 0) + 1, upvoted_by_me: true }
        : item,
    ));
    try {
      await upvoteAppRequest(request.id);
    } catch (requestError) {
      setRequests((prev) => prev.map((item) =>
        item.id === request.id
          ? { ...item, upvotes: Math.max(0, (item.upvotes || 1) - 1), upvoted_by_me: false }
          : item,
      ));
      showToast(getErrorMessage(requestError, '추천을 반영하지 못했습니다.'), 'error');
    }
  };

  const openRequest = (request) => {
    setSelectedRequest(request);
    setAdminReply({
      status: request.status || 'Under Review',
      admin_comment: request.admin_comment || '',
    });
    setScreen('request-detail');
  };

  const saveAdminReply = async () => {
    if (!selectedRequest) return;
    setSaving(true);
    try {
      await replyToAppRequest(selectedRequest.id, adminReply);
      setScreen('hub');
      await loadHub();
      showToast('관리자 답변이 저장되었습니다.', 'success');
    } catch (requestError) {
      showToast(getErrorMessage(requestError, '답변 저장에 실패했습니다.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const modalTitle = useMemo(() => {
    if (screen === 'notice-form') return `${appName} 공지 ${editingNotice ? '수정' : '작성'}`;
    if (screen === 'request-form') return `${appName} 게시글 ${editingRequest ? '수정' : '등록'}`;
    if (screen === 'request-detail') return 'App 게시글 상세';
    return `${appName} 공지 · 게시판`;
  }, [appName, screen, editingNotice, editingRequest]);

  const featuredNotice = entryNotices[0] || notices[0] || null;
  const featuredNoticeLabel = featuredNotice
    ? NOTICE_TYPE_LABELS[featuredNotice.type] || featuredNotice.type
    : '';

  const newRequestCount = useMemo(() => requests.filter((request) => {
    if (request.author_id === employeeId) return false;
    const created = new Date(request.created_at).getTime();
    return Number.isFinite(created) && created > boardSeenAt;
  }).length, [requests, boardSeenAt, employeeId]);

  const visibleNotices = useMemo(() => {
    const query = noticeQuery.trim().toLowerCase();
    if (!query) return notices;
    return notices.filter((notice) =>
      `${notice.title || ''} ${notice.content || ''}`.toLowerCase().includes(query));
  }, [notices, noticeQuery]);

  const visibleRequests = useMemo(() => {
    const query = requestQuery.trim().toLowerCase();
    const list = query
      ? requests.filter((request) =>
          `${request.title || ''} ${request.content || ''}`.toLowerCase().includes(query))
      : requests.slice();
    list.sort((a, b) => (requestSort === 'votes'
      ? (b.upvotes - a.upvotes) || (new Date(b.created_at) - new Date(a.created_at))
      : (new Date(b.created_at) - new Date(a.created_at))));
    return list;
  }, [requests, requestQuery, requestSort]);

  if (availability === false) return null;

  if (availability === null) {
    return (
      <section
        aria-label={`${appName} 소식 불러오는 중`}
        aria-busy="true"
        className="mx-1 mb-4 flex min-h-[74px] items-center rounded-2xl border border-slate-200 bg-white px-5 shadow-sm"
      >
        <Loader2 size={17} className="mr-3 shrink-0 animate-spin text-blue-600" />
        <div>
          <p className="text-sm font-bold text-slate-700">App 소식을 확인하고 있습니다.</p>
          <p className="mt-0.5 text-xs text-slate-500">공지사항과 게시판 정보를 불러오는 중입니다.</p>
        </div>
      </section>
    );
  }

  // 확인하지 않은 진입 공지가 있으면 접기를 허용하지 않고 항상 펼쳐 노출한다.
  const showCollapsed = bannerCollapsed && entryNotices.length === 0;

  return (
    <>
      <section
        aria-label={`${appName} App 소식`}
        className="mx-1 mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        {showCollapsed ? (
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700">
              <Megaphone size={14} aria-hidden="true" />
            </span>
            <button
              type="button"
              onClick={() => openHub('notices')}
              className="min-w-0 flex-1 truncate text-left text-xs font-bold text-slate-500 transition-colors hover:text-blue-700 cursor-pointer"
            >
              App 소식
              <span className="ml-1 font-semibold text-slate-400">
                · 공지 {notices.length} · 게시판 {requests.length}
              </span>
            </button>
            {newRequestCount > 0 && (
              <Badge variant="notify" size="sm">새 글 {newRequestCount}</Badge>
            )}
            <button
              type="button"
              onClick={toggleBannerCollapse}
              aria-label="App 소식 펼치기"
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:gap-5">
            <button
              type="button"
              onClick={() => openHub('notices')}
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-2 cursor-pointer"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700">
                <Megaphone size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">App 소식</span>
                  {entryNotices.length > 0 && (
                    <Badge variant="notify" size="sm" dot>새 공지 {entryNotices.length}건</Badge>
                  )}
                  {!loading && !error && featuredNotice?.is_pinned && (
                    <Badge variant="warning" size="sm"><Pin size={10} /> 중요</Badge>
                  )}
                </span>
                {(!summaryLoaded || loading) && notices.length === 0 ? (
                  <span className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-slate-600">
                    <Loader2 size={14} className="animate-spin text-blue-600" /> 공지사항을 불러오는 중입니다.
                  </span>
                ) : error ? (
                  <span className="mt-1 block truncate text-sm font-semibold text-amber-800">
                    소식 요약을 불러오지 못했습니다. 다시 시도해 주세요.
                  </span>
                ) : featuredNotice ? (
                  <span className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-800 group-hover:text-blue-700">
                      {featuredNotice.title}
                    </span>
                    <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                      {featuredNoticeLabel} · {formatDate(featuredNotice.created_at)}
                    </span>
                  </span>
                ) : (
                  <span className="mt-1 block truncate text-sm font-semibold text-slate-600">
                    등록된 공지는 없습니다. App 게시판에서 개선 의견을 남길 수 있습니다.
                  </span>
                )}
              </span>
              <ChevronRight size={17} className="mr-1 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" aria-hidden="true" />
            </button>

            <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 pt-3 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              {availability.notice_enabled && (
                <Button type="button" variant="secondary" size="sm" onClick={() => openHub('notices')}>
                  <Megaphone size={14} />
                  공지 전체
                  {notices.length > 0 && <span className="text-slate-500">{notices.length}</span>}
                </Button>
              )}
              {availability.board_enabled && (
                <Button type="button" size="sm" onClick={() => openHub('requests')}>
                  <MessageSquare size={14} />
                  App 게시판
                  {newRequestCount > 0 ? (
                    <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">새 {newRequestCount}</span>
                  ) : requests.length > 0 ? (
                    <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px]">{requests.length}</span>
                  ) : null}
                </Button>
              )}
              {entryNotices.length === 0 && (
                <button
                  type="button"
                  onClick={toggleBannerCollapse}
                  aria-label="App 소식 접기"
                  title="App 소식 접기"
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <ChevronUp size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 sm:px-5">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-800">
              <AlertCircle size={14} /> App 소식 요약을 불러오지 못했습니다.
            </p>
            <button
              type="button"
              onClick={loadHub}
              className="rounded-lg px-2 py-1 text-xs font-bold text-amber-900 underline decoration-amber-400 underline-offset-2 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600/30 cursor-pointer"
            >
              다시 시도
            </button>
          </div>
        )}
      </section>

      <Modal
        isOpen={entryOpen && !!currentEntry}
        onClose={confirmEntryNotice}
        title={`${appName} 중요 공지`}
        size="lg"
        footer={(
          <div className="space-y-3">
            <fieldset className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
              <legend className="sr-only">공지 창 표시 설정</legend>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="radio"
                  name="entry-dismissal"
                  checked={entryDismissal === ''}
                  onChange={() => setEntryDismissal('')}
                  className="h-4 w-4 border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-600/30"
                />
                다음에 다시 보기
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="radio"
                  name="entry-dismissal"
                  checked={entryDismissal === 'today'}
                  onChange={() => setEntryDismissal('today')}
                  className="h-4 w-4 border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-600/30"
                />
                오늘은 그만 보기
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="radio"
                  name="entry-dismissal"
                  checked={entryDismissal === 'forever'}
                  onChange={() => setEntryDismissal('forever')}
                  className="h-4 w-4 border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-600/30"
                />
                앞으로 그만 보기
              </label>
            </fieldset>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-500">
                {entryDismissal === 'today' && '오늘 자정까지 이 App의 진입 공지를 표시하지 않습니다.'}
                {entryDismissal === 'forever' && '현재 공지는 내용이 수정되기 전까지 다시 표시하지 않습니다.'}
                {!entryDismissal && '선택하지 않으면 다음 App 진입 시 다시 표시됩니다.'}
              </p>
              <Button type="button" size="sm" isLoading={acknowledging} onClick={confirmEntryNotice}>
                <CheckCircle2 size={15} /> 확인
              </Button>
            </div>
          </div>
        )}
      >
        {currentEntry && (
          <article className="px-6 py-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="info" dot>{NOTICE_TYPE_LABELS[currentEntry.type] || currentEntry.type}</Badge>
              {currentEntry.is_pinned && <Badge variant="warning"><Pin size={11} /> 중요</Badge>}
              <span className="text-xs text-slate-500">{formatDate(currentEntry.created_at)}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800">{currentEntry.title}</h2>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {currentEntry.content}
            </div>
            {entryNotices.length > 1 && (
              <p className="mt-6 border-t border-slate-200 pt-4 text-xs font-semibold text-slate-500">
                확인하지 않은 공지 {entryNotices.length - 1}건이 더 있습니다.
              </p>
            )}
          </article>
        )}
      </Modal>

      <Modal
        isOpen={hubOpen}
        onClose={() => setHubOpen(false)}
        title={modalTitle}
        size="full"
      >
        {screen === 'hub' && (
          <div className="min-h-[480px]">
            <div className="sticky top-0 z-10 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 pt-4">
                <div className="flex gap-6">
                  {availability.notice_enabled && (
                    <button
                      type="button"
                      onClick={() => switchTab('notices')}
                      className={`border-b-2 px-1 pb-3 text-sm font-bold transition-colors cursor-pointer ${activeTab === 'notices' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                      공지사항 {notices.length > 0 && `(${notices.length})`}
                    </button>
                  )}
                  {availability.board_enabled && (
                    <button
                      type="button"
                      onClick={() => switchTab('requests')}
                      className={`inline-flex items-center gap-1.5 border-b-2 px-1 pb-3 text-sm font-bold transition-colors cursor-pointer ${activeTab === 'requests' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                      App 게시판 {requests.length > 0 && `(${requests.length})`}
                      {newRequestCount > 0 && (
                        <Badge variant="notify" size="sm">새 {newRequestCount}</Badge>
                      )}
                    </button>
                  )}
                </div>
                {activeTab === 'notices' && isAdmin && (
                  <Button type="button" size="sm" onClick={() => openNoticeForm()}>
                    <Plus size={14} /> 공지 작성
                  </Button>
                )}
                {activeTab === 'requests' && (
                  <Button type="button" size="sm" onClick={() => openRequestForm()}>
                    <Plus size={14} /> 게시글 등록
                  </Button>
                )}
              </div>

              {!loading && !error && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3">
                  <div className="relative min-w-[180px] flex-1">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={activeTab === 'notices' ? noticeQuery : requestQuery}
                      onChange={(event) => (activeTab === 'notices'
                        ? setNoticeQuery(event.target.value)
                        : setRequestQuery(event.target.value))}
                      placeholder={activeTab === 'notices' ? '공지 제목·내용 검색' : '게시글 제목·내용 검색'}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                    />
                  </div>
                  {activeTab === 'requests' && (
                    <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
                      <button
                        type="button"
                        onClick={() => setRequestSort('votes')}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${requestSort === 'votes' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        추천순
                      </button>
                      <button
                        type="button"
                        onClick={() => setRequestSort('recent')}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${requestSort === 'recent' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        최신순
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {loading && (
              <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-slate-600">
                <Loader2 size={18} className="animate-spin text-blue-600" /> App 소식을 불러오는 중입니다.
              </div>
            )}
            {!loading && error && (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle size={28} className="text-red-600" />
                <p className="text-sm font-semibold text-slate-700">{error}</p>
                <Button type="button" variant="secondary" size="sm" onClick={loadHub}>다시 시도</Button>
              </div>
            )}
            {!loading && !error && activeTab === 'notices' && (
              <div className="divide-y divide-slate-100 px-6 py-2">
                {visibleNotices.length === 0 ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                    <Megaphone size={28} className="mb-3 text-slate-400" />
                    {notices.length === 0 ? (
                      <>
                        <p className="text-sm font-bold text-slate-700">등록된 App 공지가 없습니다.</p>
                        <p className="mt-1 text-xs text-slate-500">새 공지가 게시되면 이곳에서 확인할 수 있습니다.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-slate-700">검색 결과가 없습니다.</p>
                        <p className="mt-1 text-xs text-slate-500">다른 검색어를 입력해 보세요.</p>
                      </>
                    )}
                  </div>
                ) : visibleNotices.map((notice) => {
                  const isPendingEntry = entryNotices.some((item) => item.id === notice.id);
                  return (
                    <article key={notice.id} className="py-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="info" size="sm" dot>{NOTICE_TYPE_LABELS[notice.type] || notice.type}</Badge>
                            {notice.is_pinned && <Badge variant="warning" size="sm"><Pin size={10} /> 중요</Badge>}
                            {notice.show_on_entry && <Badge variant="purple" size="sm">진입 시 표시</Badge>}
                          </div>
                          <h3 className="text-base font-bold text-slate-800">{notice.title}</h3>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{notice.content}</p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-slate-500">
                          <p>{formatDate(notice.created_at)}</p>
                          <p className="mt-1">{notice.author_name || notice.author_id}</p>
                          {isPendingEntry && (
                            <button
                              type="button"
                              onClick={() => acknowledgeFromHub(notice.id)}
                              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 cursor-pointer"
                            >
                              <CheckCircle2 size={13} /> 읽음 확인
                            </button>
                          )}
                          {isAdmin && (
                            <div className="mt-3 flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openNoticeForm(notice)}
                                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                                aria-label={`${notice.title} 수정`}
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteNoticeCandidate(notice)}
                                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 cursor-pointer"
                                aria-label={`${notice.title} 삭제`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {!loading && !error && activeTab === 'requests' && (
              <div className="divide-y divide-slate-100 px-6 py-2">
                {visibleRequests.length === 0 ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                    <MessageSquare size={28} className="mb-3 text-slate-400" />
                    {requests.length === 0 ? (
                      <>
                        <p className="text-sm font-bold text-slate-700">등록된 게시글이 없습니다.</p>
                        <p className="mt-1 text-xs text-slate-500">모든 사용자가 개선 아이디어나 불편 사항을 남길 수 있습니다.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-slate-700">검색 결과가 없습니다.</p>
                        <p className="mt-1 text-xs text-slate-500">다른 검색어를 입력해 보세요.</p>
                      </>
                    )}
                  </div>
                ) : visibleRequests.map((request) => {
                  const status = REQUEST_STATUS[request.status] || { label: request.status, variant: 'neutral' };
                  const isOwner = request.author_id === employeeId;
                  return (
                    <article key={request.id} className="flex items-start gap-4 py-5">
                      <button type="button" onClick={() => openRequest(request)} className="min-w-0 flex-1 text-left cursor-pointer">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant={status.variant} size="sm" dot>{status.label}</Badge>
                          <span className="text-xs text-slate-500">{request.author_name} · {formatDate(request.created_at)}</span>
                          {isOwner && <span className="text-[10px] font-bold text-slate-400">내 글</span>}
                        </div>
                        <h3 className="text-base font-bold text-slate-800 hover:text-blue-700">{request.title}</h3>
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{request.content}</p>
                        {request.admin_comment && (
                          <p className="mt-2 text-xs font-semibold text-blue-700">관리자 답변이 등록되었습니다.</p>
                        )}
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => upvoteRequest(request)}
                          disabled={request.upvoted_by_me}
                          aria-pressed={!!request.upvoted_by_me}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${request.upvoted_by_me
                            ? 'cursor-default border-blue-300 bg-blue-50 text-blue-700'
                            : 'cursor-pointer border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'}`}
                          aria-label={`${request.title} 추천`}
                        >
                          <ThumbsUp size={14} className={request.upvoted_by_me ? 'fill-blue-600' : ''} /> {request.upvotes}
                        </button>
                        {(isOwner || isAdmin) && (
                          <div className="flex gap-1">
                            {isOwner && (
                              <button
                                type="button"
                                onClick={() => openRequestForm(request)}
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                                aria-label={`${request.title} 수정`}
                              >
                                <Edit2 size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteRequestCandidate(request)}
                              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 cursor-pointer"
                              aria-label={`${request.title} 삭제`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {screen === 'notice-form' && (
          <form onSubmit={submitNotice} className="space-y-5 px-6 py-6">
            <div className="grid gap-5 md:grid-cols-[180px_1fr]">
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                공지 유형
                <select
                  value={noticeForm.type}
                  onChange={(event) => setNoticeForm((current) => ({ ...current, type: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                >
                  <option value="Notice">공지</option>
                  <option value="Update">업데이트</option>
                  <option value="Maintenance">점검</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                제목
                <input
                  required
                  maxLength={200}
                  value={noticeForm.title}
                  onChange={(event) => setNoticeForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                  placeholder="사용자가 바로 이해할 수 있는 제목"
                />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              내용
              <textarea
                required
                rows={9}
                maxLength={2000}
                value={noticeForm.content}
                onChange={(event) => setNoticeForm((current) => ({ ...current, content: event.target.value }))}
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                placeholder="변경 내용, 영향 범위, 사용자가 해야 할 일을 작성하세요."
              />
            </label>
            <div className="flex flex-wrap gap-5 border-t border-slate-200 pt-4">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={noticeForm.is_pinned} onChange={(event) => setNoticeForm((current) => ({ ...current, is_pinned: event.target.checked }))} />
                중요 공지로 고정
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={noticeForm.show_on_entry} onChange={(event) => setNoticeForm((current) => ({ ...current, show_on_entry: event.target.checked }))} />
                사용자가 App에 진입할 때 한 번 표시
              </label>
            </div>
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  게시 시작 (선택)
                  <input
                    type="datetime-local"
                    value={noticeForm.starts_at}
                    onChange={(event) => setNoticeForm((current) => ({ ...current, starts_at: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                  />
                </label>
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  게시 종료 (선택)
                  <input
                    type="datetime-local"
                    value={noticeForm.ends_at}
                    onChange={(event) => setNoticeForm((current) => ({ ...current, ends_at: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500">
                비워 두면 즉시 게시되고 만료되지 않습니다. 기간을 지정하면 해당 기간에만 사용자에게 노출됩니다.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setEditingNotice(null); setScreen('hub'); }}>취소</Button>
              <Button type="submit" isLoading={saving}><Send size={15} /> {editingNotice ? '저장' : '게시'}</Button>
            </div>
          </form>
        )}

        {screen === 'request-form' && (
          <form onSubmit={submitRequest} className="space-y-5 px-6 py-6">
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              제목
              <input
                required
                maxLength={200}
                value={requestForm.title}
                onChange={(event) => setRequestForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                placeholder="게시글 제목을 한 문장으로 작성하세요."
              />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              상세 내용
              <textarea
                required
                rows={10}
                maxLength={5000}
                value={requestForm.content}
                onChange={(event) => setRequestForm((current) => ({ ...current, content: event.target.value }))}
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                placeholder="현재 동작, 원하는 개선점, 업무에 미치는 영향을 함께 적어주세요."
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setEditingRequest(null); setScreen('hub'); }}>취소</Button>
              <Button type="submit" isLoading={saving}><Send size={15} /> {editingRequest ? '저장' : '등록'}</Button>
            </div>
          </form>
        )}

        {screen === 'request-detail' && selectedRequest && (
          <div className="px-6 py-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={(REQUEST_STATUS[selectedRequest.status] || {}).variant || 'neutral'} dot>
                {(REQUEST_STATUS[selectedRequest.status] || {}).label || selectedRequest.status}
              </Badge>
              <span className="text-xs text-slate-500">{selectedRequest.author_name} · {formatDate(selectedRequest.created_at)}</span>
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-800">{selectedRequest.title}</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{selectedRequest.content}</p>

            {selectedRequest.admin_comment && !isAdmin && (
              <section className="mt-6 border-t border-slate-200 pt-5">
                <h3 className="text-sm font-bold text-slate-800">관리자 답변</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{selectedRequest.admin_comment}</p>
              </section>
            )}

            {isAdmin && (
              <section className="mt-6 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-[180px_1fr]">
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  처리 상태
                  <select
                    value={adminReply.status}
                    onChange={(event) => setAdminReply((current) => ({ ...current, status: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                  >
                    <option value="Under Review">검토 중</option>
                    <option value="Planned">계획됨</option>
                    <option value="In Progress">진행 중</option>
                    <option value="Resolved">해결됨</option>
                    <option value="Completed">완료</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-semibold text-slate-700">
                  관리자 답변
                  <textarea
                    rows={5}
                    maxLength={5000}
                    value={adminReply.admin_comment}
                    onChange={(event) => setAdminReply((current) => ({ ...current, admin_comment: event.target.value }))}
                    className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15"
                    placeholder="검토 결과나 반영 계획을 작성하세요."
                  />
                </label>
              </section>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setScreen('hub')}>목록</Button>
              {selectedRequest.author_id === employeeId && (
                <Button type="button" variant="secondary" onClick={() => openRequestForm(selectedRequest)}>
                  <Edit2 size={14} /> 수정
                </Button>
              )}
              {(selectedRequest.author_id === employeeId || isAdmin) && (
                <Button type="button" variant="danger" onClick={() => setDeleteRequestCandidate(selectedRequest)}>
                  <Trash2 size={14} /> 삭제
                </Button>
              )}
              {isAdmin && <Button type="button" isLoading={saving} onClick={saveAdminReply}>답변 저장</Button>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteNoticeCandidate}
        onCancel={() => setDeleteNoticeCandidate(null)}
        onConfirm={deleteNotice}
        title="App 공지 삭제"
        message={`'${deleteNoticeCandidate?.title || ''}' 공지를 삭제합니다. 사용자 확인 기록도 함께 삭제됩니다.`}
      />

      <ConfirmDialog
        isOpen={!!deleteRequestCandidate}
        onCancel={() => setDeleteRequestCandidate(null)}
        onConfirm={deleteRequest}
        title="게시글 삭제"
        message={`'${deleteRequestCandidate?.title || ''}' 게시글을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
      />
    </>
  );
}
