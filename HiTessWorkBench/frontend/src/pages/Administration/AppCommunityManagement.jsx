/// <summary>
/// 관리자 전용 App 커뮤니티(AppSpace) 관리 페이지.
/// 앱별 공지/게시판 기능 on-off, 활성화, 공지/게시글 현황 및 진입공지 확인 리포트를 제공합니다.
/// (공지·게시글 '작성'은 각 앱 내부의 App 소식 허브에서 수행하며, 여기서는 관리/감독/정리에 집중합니다.)
/// </summary>
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessagesSquare, Plus, Trash2, Megaphone, MessageSquare, Users2,
  RefreshCw, Bell, BellOff, ClipboardCheck, Pin, EyeOff, CalendarClock,
  CheckCircle2, XCircle, Power, PowerOff, X, Inbox,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import {
  getAppSpaces, createAppSpace, updateAppSpace, deleteAppSpace,
  getAppSpaceNotices, getAppSpaceRequests, getNoticeReadReport, deleteNotice, deleteFeatureRequest,
} from '../../api/admin';

// 켜짐/꺼짐 토글 pill 버튼.
const TogglePill = ({ on, onClick, disabled, iconOn: IconOn, iconOff: IconOff, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
      on
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
        : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
    }`}
    title={`${label} ${on ? '켜짐' : '꺼짐'} — 클릭하여 전환`}
  >
    {on ? <IconOn size={12} /> : <IconOff size={12} />}
    {label}
  </button>
);

export default function AppCommunityManagement() {
  const { showToast } = useToast();

  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [togglingKey, setTogglingKey] = useState(null);

  // 선택된 App 상세
  const [notices, setNotices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('notices');

  // 생성 폼
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ app_key: '', display_name: '' });
  const [creating, setCreating] = useState(false);

  // 확인 다이얼로그 / 모달 대상
  const [deleteAppTarget, setDeleteAppTarget] = useState(null);
  const [deleteNoticeTarget, setDeleteNoticeTarget] = useState(null);
  const [deleteRequestTarget, setDeleteRequestTarget] = useState(null);
  const [readReport, setReadReport] = useState(null);
  const [readReportLoading, setReadReportLoading] = useState(false);

  const fetchSpaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAppSpaces();
      const list = res.data || [];
      setSpaces(list);
      setSelectedKey(prev => (prev && list.some(s => s.app_key === prev) ? prev : list[0]?.app_key ?? null));
    } catch {
      showToast('App 커뮤니티 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchSpaces(); }, [fetchSpaces]);

  const fetchDetail = useCallback(async (appKey) => {
    if (!appKey) { setNotices([]); setRequests([]); return; }
    setDetailLoading(true);
    try {
      const [nRes, rRes] = await Promise.all([
        getAppSpaceNotices(appKey),
        getAppSpaceRequests(appKey),
      ]);
      setNotices(nRes.data || []);
      setRequests(rRes.data || []);
    } catch {
      showToast('App 상세 정보를 불러오지 못했습니다.', 'error');
      setNotices([]);
      setRequests([]);
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchDetail(selectedKey); }, [selectedKey, fetchDetail]);

  const selectedSpace = useMemo(
    () => spaces.find(s => s.app_key === selectedKey) || null,
    [spaces, selectedKey],
  );

  const totals = useMemo(() => ({
    apps: spaces.length,
    active: spaces.filter(s => s.is_active).length,
    notices: spaces.reduce((sum, s) => sum + (s.notice_count || 0), 0),
    requests: spaces.reduce((sum, s) => sum + (s.request_count || 0), 0),
  }), [spaces]);

  const handleToggle = async (space, field) => {
    setTogglingKey(space.app_key);
    try {
      const res = await updateAppSpace(space.app_key, { [field]: !space[field] });
      setSpaces(prev => prev.map(s => (s.app_key === space.app_key ? { ...s, ...res.data } : s)));
    } catch {
      showToast('상태 변경에 실패했습니다.', 'error');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleCreate = async () => {
    const appKey = createForm.app_key.trim();
    const displayName = createForm.display_name.trim();
    if (!appKey || !displayName) {
      showToast('App key와 표시 이름을 모두 입력하세요.', 'warning');
      return;
    }
    setCreating(true);
    try {
      await createAppSpace({ app_key: appKey, display_name: displayName });
      showToast('App 커뮤니티가 추가되었습니다.', 'success');
      setCreateForm({ app_key: '', display_name: '' });
      setShowCreate(false);
      await fetchSpaces();
      setSelectedKey(appKey);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'App 추가에 실패했습니다.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const confirmDeleteApp = async () => {
    const target = deleteAppTarget;
    setDeleteAppTarget(null);
    if (!target) return;
    try {
      await deleteAppSpace(target.app_key);
      showToast(`'${target.display_name}' 커뮤니티를 삭제했습니다.`, 'success');
      await fetchSpaces();
    } catch {
      showToast('App 삭제에 실패했습니다.', 'error');
    }
  };

  const confirmDeleteNotice = async () => {
    const target = deleteNoticeTarget;
    setDeleteNoticeTarget(null);
    if (!target) return;
    try {
      await deleteNotice(target.id);
      showToast('공지를 삭제했습니다.', 'success');
      await Promise.all([fetchDetail(selectedKey), fetchSpaces()]);
    } catch {
      showToast('공지 삭제에 실패했습니다.', 'error');
    }
  };

  const confirmDeleteRequest = async () => {
    const target = deleteRequestTarget;
    setDeleteRequestTarget(null);
    if (!target) return;
    try {
      await deleteFeatureRequest(target.id);
      showToast('게시글을 삭제했습니다.', 'success');
      await Promise.all([fetchDetail(selectedKey), fetchSpaces()]);
    } catch {
      showToast('게시글 삭제에 실패했습니다.', 'error');
    }
  };

  const openReadReport = async (notice) => {
    setReadReport({ notice, data: null });
    setReadReportLoading(true);
    try {
      const res = await getNoticeReadReport(notice.id);
      setReadReport({ notice, data: res.data });
    } catch {
      showToast('확인 리포트를 불러오지 못했습니다.', 'error');
      setReadReport(null);
    } finally {
      setReadReportLoading(false);
    }
  };

  const kpis = [
    { label: '총 App', value: totals.apps, icon: MessagesSquare, color: 'text-blue-200', border: 'border-l-blue-500' },
    { label: '활성 App', value: totals.active, icon: Power, color: 'text-emerald-200', border: 'border-l-emerald-500' },
    { label: '총 공지', value: totals.notices, icon: Megaphone, color: 'text-indigo-200', border: 'border-l-indigo-500' },
    { label: '총 게시글', value: totals.requests, icon: MessageSquare, color: 'text-violet-200', border: 'border-l-violet-500' },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <PageHeader
        title="App Community 관리"
        icon={MessagesSquare}
        subtitle="앱별 공지·게시판 기능을 켜고 끄고, 공지/게시글 현황과 진입공지 확인 현황을 관리합니다."
        accentColor="teal"
        actions={
          <button
            onClick={fetchSpaces}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors cursor-pointer"
          >
            <RefreshCw size={13} /> 새로고침
          </button>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpis.map(k => (
          <div key={k.label} className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center border-l-4 ${k.border}`}>
            <div>
              <p className="text-xs font-bold text-slate-400 mb-1">{k.label}</p>
              <h3 className="text-2xl font-black text-slate-800 tabular-nums">{k.value}</h3>
            </div>
            <k.icon className={k.color} size={32} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* 좌: AppSpace 목록 */}
        <div className="space-y-4">
          {/* 생성 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <button
              onClick={() => setShowCreate(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors cursor-pointer"
            >
              <Plus size={14} /> {showCreate ? '닫기' : '새 App 커뮤니티 추가'}
            </button>
            {showCreate && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">App key (뷰어 id)</label>
                  <input
                    type="text"
                    placeholder="예: hitess-model-builder"
                    value={createForm.app_key}
                    onChange={e => setCreateForm(f => ({ ...f, app_key: e.target.value }))}
                    className="w-full text-xs font-mono border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">표시 이름</label>
                  <input
                    type="text"
                    placeholder="예: HiTESS Model Builder"
                    value={createForm.display_name}
                    onChange={e => setCreateForm(f => ({ ...f, display_name: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full px-3 py-2 text-xs font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {creating ? '추가 중...' : '추가'}
                </button>
              </div>
            )}
          </div>

          {/* 목록 */}
          {loading ? (
            <div className="text-center py-16 text-slate-400"><RefreshCw size={20} className="inline animate-spin mr-2" />불러오는 중...</div>
          ) : spaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
              <Inbox size={28} className="mb-2 text-slate-300" />
              <p className="text-sm font-bold">등록된 App 커뮤니티가 없습니다.</p>
            </div>
          ) : (
            spaces.map(space => {
              const selected = space.app_key === selectedKey;
              const busy = togglingKey === space.app_key;
              return (
                <div
                  key={space.app_key}
                  onClick={() => setSelectedKey(space.app_key)}
                  className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer transition-colors ${
                    selected ? 'border-teal-400 ring-1 ring-teal-200' : 'border-slate-200 hover:border-slate-300'
                  } ${space.is_active ? '' : 'opacity-70'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-800 truncate">{space.display_name}</h4>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{space.app_key}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteAppTarget(space); }}
                      className="shrink-0 text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1"
                      title="App 삭제"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
                    <TogglePill on={space.notice_enabled} disabled={busy}
                      onClick={() => handleToggle(space, 'notice_enabled')}
                      iconOn={Bell} iconOff={BellOff} label="공지" />
                    <TogglePill on={space.board_enabled} disabled={busy}
                      onClick={() => handleToggle(space, 'board_enabled')}
                      iconOn={MessageSquare} iconOff={MessageSquare} label="게시판" />
                    <TogglePill on={space.is_active} disabled={busy}
                      onClick={() => handleToggle(space, 'is_active')}
                      iconOn={Power} iconOff={PowerOff} label="활성" />
                  </div>

                  <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><Megaphone size={12} /> 공지 {space.notice_count}</span>
                    <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> 게시글 {space.request_count}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 우: 선택된 App 상세 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-h-[400px]">
          {!selectedSpace ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-slate-400">
              <MessagesSquare size={32} className="mb-2 text-slate-300" />
              <p className="text-sm font-bold">왼쪽에서 App을 선택하세요.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-800">{selectedSpace.display_name}</h3>
                  <p className="text-[11px] font-mono text-slate-400">{selectedSpace.app_key}</p>
                </div>
                {!selectedSpace.is_active && (
                  <span className="px-2 py-1 rounded-full text-[10px] font-black uppercase bg-slate-200 text-slate-500">비활성</span>
                )}
              </div>

              {/* 탭 */}
              <div className="flex gap-1 border-b border-slate-100 mb-4">
                <button
                  onClick={() => setDetailTab('notices')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                    detailTab === 'notices' ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Megaphone size={14} className="inline mr-1.5" />공지 ({notices.length})
                </button>
                <button
                  onClick={() => setDetailTab('requests')}
                  className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                    detailTab === 'requests' ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <MessageSquare size={14} className="inline mr-1.5" />게시글 ({requests.length})
                </button>
              </div>

              {detailLoading ? (
                <div className="text-center py-16 text-slate-400"><RefreshCw size={18} className="inline animate-spin mr-2" />불러오는 중...</div>
              ) : detailTab === 'notices' ? (
                <NoticesTab
                  notices={notices}
                  onDelete={setDeleteNoticeTarget}
                  onReadReport={openReadReport}
                />
              ) : (
                <RequestsTab requests={requests} onDelete={setDeleteRequestTarget} />
              )}

              <p className="mt-5 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
                공지·게시글 <span className="font-bold">작성/수정</span>은 각 앱의 'App 소식' 화면에서 수행합니다. 이 페이지는 기능 on-off와 관리·정리·확인 현황 용도입니다.
              </p>
            </>
          )}
        </div>
      </div>

      {/* 진입공지 확인 리포트 모달 */}
      {readReport && (
        <ReadReportModal
          report={readReport}
          loading={readReportLoading}
          onClose={() => setReadReport(null)}
        />
      )}

      {/* 확인 다이얼로그들 */}
      <ConfirmDialog
        isOpen={!!deleteAppTarget}
        onCancel={() => setDeleteAppTarget(null)}
        onConfirm={confirmDeleteApp}
        title="App 커뮤니티 삭제"
        message={deleteAppTarget
          ? `'${deleteAppTarget.display_name}' 커뮤니티 공간을 삭제합니다. 기존 공지 ${deleteAppTarget.notice_count}개·게시글 ${deleteAppTarget.request_count}개는 남지만 이 앱에서 접근할 수 없게 됩니다.`
          : ''}
        confirmLabel="삭제"
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!deleteNoticeTarget}
        onCancel={() => setDeleteNoticeTarget(null)}
        onConfirm={confirmDeleteNotice}
        title="공지 삭제"
        message={deleteNoticeTarget ? `'${deleteNoticeTarget.title}' 공지를 삭제합니다.` : ''}
        confirmLabel="삭제"
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!deleteRequestTarget}
        onCancel={() => setDeleteRequestTarget(null)}
        onConfirm={confirmDeleteRequest}
        title="게시글 삭제"
        message={deleteRequestTarget ? `'${deleteRequestTarget.title}' 게시글을 삭제합니다.` : ''}
        confirmLabel="삭제"
        variant="danger"
      />
    </div>
  );
}

function NoticesTab({ notices, onDelete, onReadReport }) {
  if (notices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-slate-400">
        <Megaphone size={26} className="mb-2 text-slate-300" />
        <p className="text-sm font-bold">등록된 공지가 없습니다.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {notices.map(n => (
        <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-800 truncate">{n.title}</span>
              {n.is_pinned && <Pin size={12} className="text-amber-500" title="고정" />}
              {n.is_private && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400"><EyeOff size={10} />비공개</span>}
              {n.show_on_entry && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-500"><Bell size={10} />진입공지</span>}
              {n.publish_status !== 'published' && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-500"><CalendarClock size={10} />{n.publish_status}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
              <span>{n.type}</span>
              <span>rev.{n.revision}</span>
              {n.author_name && <span>{n.author_name}</span>}
              {n.created_at && <span>{new Date(n.created_at).toLocaleDateString('ko-KR')}</span>}
            </div>
          </div>
          {n.show_on_entry && (
            <button
              onClick={() => onReadReport(n)}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors cursor-pointer"
              title="확인한 사용자 보기"
            >
              <ClipboardCheck size={12} /> 확인 {n.read_count}
            </button>
          )}
          <button
            onClick={() => onDelete(n)}
            className="shrink-0 text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1"
            title="공지 삭제"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function RequestsTab({ requests, onDelete }) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-slate-400">
        <MessageSquare size={26} className="mb-2 text-slate-300" />
        <p className="text-sm font-bold">등록된 게시글이 없습니다.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {requests.map(r => (
        <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-800 truncate">{r.title}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">{r.status}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-0.5">▲ {r.upvotes}</span>
              {r.author_name && <span>{r.author_name}</span>}
              {r.created_at && <span>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>}
              {r.admin_comment && <span className="inline-flex items-center gap-0.5 text-emerald-500"><CheckCircle2 size={11} />답변완료</span>}
            </div>
          </div>
          <button
            onClick={() => onDelete(r)}
            className="shrink-0 text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1"
            title="게시글 삭제"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ReadReportModal({ report, loading, onClose }) {
  const { notice, data } = report;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardCheck size={18} className="text-blue-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 truncate">진입공지 확인 현황</h3>
              <p className="text-[11px] text-slate-400 truncate">{notice.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400"><RefreshCw size={18} className="inline animate-spin mr-2" />불러오는 중...</div>
        ) : (
          <>
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-4 text-sm">
              <span className="font-bold text-blue-600">현재 rev.{data?.revision} 확인 {data?.current_revision_reads ?? 0}명</span>
              <span className="text-slate-400">누적 {data?.total_reads ?? 0}명</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {(!data?.readers || data.readers.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <Users2 size={24} className="mb-2 text-slate-300" />
                  <p className="text-sm font-bold">아직 확인한 사용자가 없습니다.</p>
                </div>
              ) : (
                data.readers.map((rd, idx) => (
                  <div key={`${rd.employee_id}-${rd.notice_revision}-${idx}`} className="flex items-center justify-between px-5 py-2.5 border-b border-slate-50 text-sm">
                    <div className="min-w-0">
                      <span className="font-bold text-slate-700">{rd.name || rd.employee_id}</span>
                      {rd.department && <span className="ml-2 text-[11px] text-slate-400">{rd.department}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rd.is_current
                        ? <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600"><CheckCircle2 size={12} />최신</span>
                        : <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"><XCircle size={12} />rev.{rd.notice_revision}</span>}
                      <span className="text-[11px] text-slate-400">{rd.acknowledged_at ? new Date(rd.acknowledged_at).toLocaleString('ko-KR') : ''}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
