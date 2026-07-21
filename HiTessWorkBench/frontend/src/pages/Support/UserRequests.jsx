import React, { useState, useEffect, Fragment, useMemo } from 'react';
import { Archive, CheckCircle2, LayoutGrid, Lightbulb, List, MessageCircle, Plus, Search, Send, Tag, ThumbsUp, Trash2, X, Flag } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { getFeatureRequests, createFeatureRequest, upvoteFeatureRequest, commentFeatureRequest, deleteFeatureRequest } from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

// 카드/리스트 미리보기 전용 — 본문 앞에 자동 삽입된 "[관련 모듈: ...]" 같은
// 메타데이터 라인을 걷어내고 실제 설명만 보여준다. 저장 데이터·상세보기는 원본 그대로 유지.
const stripMetaPreview = (content) => {
  if (!content) return '';
  return String(content).replace(/^\s*(\[[^\]]*\]\s*\n?)+/, '').trim();
};

export default function UserRequests() {
  const { showToast } = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const [requests, setRequests] = useState([]);
  const [viewMode, setViewMode] = useState('card');
  const [searchQuery, setSearchQuery] = useState('');

  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [formData, setFormData] = useState({
    module: '공통 (UI / UX / Dashboard)',
    priority: '보통 (업무 효율성 향상)',
    title: '',
    content: ''
  });
  const [adminReply, setAdminReply] = useState({ status: 'Under Review', admin_comment: '' });

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await getFeatureRequests();
      setRequests(res.data);
    } catch (err) { console.error("데이터 로드 실패", err); }
  };

  const handleUpvote = async (id) => {
    try { await upvoteFeatureRequest(id); fetchRequests(); }
    catch (err) { console.error("추천 실패", err); }
  };

  const openWriteModal = () => {
    setFormData({ module: '공통 (UI / UX / Dashboard)', priority: '보통 (업무 효율성 향상)', title: '', content: '' });
    setIsWriteModalOpen(true);
  };

  const openViewModal = (req) => {
    setSelectedReq(req);
    setAdminReply({ status: req.status, admin_comment: req.admin_comment || '' });
    setIsViewModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('로그인이 필요합니다.', 'warning'); return; }
    
    try {
      // ✅ 백엔드 DB 수정 없이 모듈과 중요도를 본문에 깔끔하게 병합하여 전송
      const finalContent = `[관련 모듈: ${formData.module}]\n[희망 중요도: ${formData.priority}]\n\n${formData.content}`;
      
      await createFeatureRequest({
        title: formData.title,
        content: finalContent,
        author_id: currentUser.employee_id,
        author_name: currentUser.name
      });
      setIsWriteModalOpen(false); 
      fetchRequests();
    } catch (err) { 
      // 에러 상세 내용을 띄워 디버깅을 용이하게 함
      showToast('요청 제출 실패: ' + (err.response?.data?.detail || err.message), 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFeatureRequest(selectedReq.id);
      setConfirmDeleteOpen(false);
      setIsViewModalOpen(false);
      fetchRequests();
    } catch (err) { showToast('삭제 실패: ' + err.message, 'error'); }
  };

  const handleAdminReplySave = async () => {
    try {
      await commentFeatureRequest(selectedReq.id, adminReply);
      showToast('관리자 답변이 저장되었습니다.', 'success');
      setIsViewModalOpen(false);
      fetchRequests();
    } catch (err) { showToast('저장 실패: ' + err.message, 'error'); }
  };

  const statusColors = {
    'Under Review': 'bg-yellow-100 text-yellow-700 border-yellow-200', 
    'Planned': 'bg-emerald-100 text-emerald-700 border-emerald-200', 
    'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
    'Resolved': 'bg-slate-100 text-slate-600 border-slate-200',
    'Completed': 'bg-slate-100 text-slate-600 border-slate-200',
  };

  const resolvedStatuses = new Set(['Resolved', 'Completed', 'Done', '해결 완료']);

  // 제목/내용 기준 클라이언트 검색 (백엔드 변경 없음)
  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(req =>
      (req.title || '').toLowerCase().includes(q) || (req.content || '').toLowerCase().includes(q)
    );
  }, [requests, searchQuery]);

  const activeRequests = filteredRequests.filter(req => !resolvedStatuses.has(req.status));
  const resolvedRequests = filteredRequests.filter(req => resolvedStatuses.has(req.status));

  const ViewToggle = () => (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        onClick={() => setViewMode('card')}
        aria-label="카드 보기"
        className={`h-8 w-8 rounded-md flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${viewMode === 'card' ? 'bg-brand-blue text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        title="카드 보기"
      >
        <LayoutGrid size={16} />
      </button>
      <button
        type="button"
        onClick={() => setViewMode('list')}
        aria-label="리스트 보기"
        className={`h-8 w-8 rounded-md flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${viewMode === 'list' ? 'bg-brand-blue text-white' : 'text-slate-500 hover:bg-slate-100'}`}
        title="리스트 보기"
      >
        <List size={16} />
      </button>
    </div>
  );

  const AdminCommentPreview = ({ req, muted = false }) => (
    req.admin_comment ? (
      <div className={`mt-4 rounded-lg border p-3 ${muted ? 'bg-white/70 border-slate-200 text-slate-500' : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold mb-1">
          <MessageCircle size={13} /> 관리자 답변
        </div>
        <p className="text-xs leading-relaxed line-clamp-2 whitespace-pre-wrap">{req.admin_comment}</p>
      </div>
    ) : null
  );

  const RequestCard = ({ req, resolved = false }) => (
    <div
      key={req.id}
      onClick={() => openViewModal(req)}
      className={`bg-white p-6 rounded-xl border shadow-sm transition-all cursor-pointer flex flex-col h-full ${
        resolved
          ? 'border-slate-200 opacity-65 hover:opacity-85 hover:shadow-md'
          : 'border-slate-200 hover:border-brand-accent hover:shadow-md'
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full border ${statusColors[req.status] || statusColors['Under Review']}`}>{req.status}</span>
        <span className="text-xs text-slate-400 font-bold">{req.author_name}</span>
      </div>
      <h3 className="text-lg font-bold text-slate-800 mb-2">{req.title}</h3>
      <p className="text-sm text-slate-500 mb-2 flex-1 line-clamp-3 whitespace-pre-wrap">{stripMetaPreview(req.content)}</p>
      <AdminCommentPreview req={req} muted={resolved} />
      <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-4">
        <div className="flex gap-4">
          <button onClick={(e) => { e.stopPropagation(); handleUpvote(req.id); }} className="flex items-center gap-1.5 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer">
            <ThumbsUp size={16} /> <span className="text-sm font-bold">{req.upvotes}</span>
          </button>
          <div className="flex items-center gap-1.5 text-slate-400">
            <MessageCircle size={16} /> <span className="text-sm font-bold">{req.comments_count}</span>
          </div>
        </div>
        {resolved && <CheckCircle2 size={18} className="text-slate-400" />}
      </div>
    </div>
  );

  const RequestList = ({ items, resolved = false }) => (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {items.map((req, index) => (
        <button
          type="button"
          key={req.id}
          onClick={() => openViewModal(req)}
          className={`w-full text-left p-4 transition-colors cursor-pointer ${index > 0 ? 'border-t border-slate-100' : ''} ${resolved ? 'opacity-65 hover:opacity-85 hover:bg-slate-50' : 'hover:bg-amber-50/40'}`}
        >
          <div className="flex flex-col lg:flex-row lg:items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full border ${statusColors[req.status] || statusColors['Under Review']}`}>{req.status}</span>
                <span className="text-xs text-slate-400 font-bold">{req.author_name}</span>
                <span className="text-xs text-slate-300">{new Date(req.created_at).toLocaleDateString()}</span>
              </div>
              <h3 className="font-bold text-slate-800 truncate">{req.title}</h3>
              <p className="text-sm text-slate-500 line-clamp-2 whitespace-pre-wrap mt-1">{stripMetaPreview(req.content)}</p>
              <AdminCommentPreview req={req} muted={resolved} />
            </div>
            <div className="flex items-center gap-4 text-slate-400 lg:pt-7">
              <span className="flex items-center gap-1.5 text-sm font-bold"><ThumbsUp size={16} /> {req.upvotes}</span>
              <span className="flex items-center gap-1.5 text-sm font-bold"><MessageCircle size={16} /> {req.comments_count}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );

  const RequestSection = ({ title, subtitle, items, resolved = false }) => (
    <section className={resolved ? 'mt-10' : ''}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            {resolved ? <Archive size={18} className="text-slate-400" /> : <Lightbulb size={18} className="text-amber-500" />}
            {title}
            <span className="text-xs font-bold text-slate-400">({items.length})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
        </div>
        {!resolved && <ViewToggle />}
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-400">
          표시할 요청이 없습니다.
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {items.map(req => <RequestCard key={req.id} req={req} resolved={resolved} />)}
        </div>
      ) : (
        <RequestList items={items} resolved={resolved} />
      )}
    </section>
  );

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <PageHeader
        title="User Requests"
        icon={Lightbulb}
        subtitle="필요한 기능이나 개선사항을 제안해 주세요. 모든 사용자가 작성할 수 있습니다."
        accentColor="teal"
        actions={
          <button onClick={openWriteModal} className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 text-white rounded-lg text-sm font-bold hover:bg-white/20 transition-colors cursor-pointer">
            <Plus size={18} /> 새 요청 작성
          </button>
        }
      />

      {/* ── 검색 ── */}
      <div className="relative max-w-sm mb-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="제목 또는 내용으로 검색"
          className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-colors"
        />
      </div>

      <RequestSection
        title="진행 중인 요청"
        subtitle="아직 해결되지 않은 항목만 모아서 우선 확인합니다."
        items={activeRequests}
      />

      <RequestSection
        title="해결 완료"
        subtitle="완료된 요청은 연하게 표시하고 별도 영역에 보관합니다."
        items={resolvedRequests}
        resolved
      />

      {/* --- 작성 모달 --- */}
      <Transition appear show={isWriteModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsWriteModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="bg-brand-accent p-5 flex justify-between items-center text-brand-blue">
                <div>
                  <Dialog.Title className="font-extrabold text-lg flex items-center gap-2 text-brand-blue"><Lightbulb size={20} /> 시스템 기능 개선 제안</Dialog.Title>
                  <p className="text-xs font-bold text-brand-blue/70 mt-1">여러분의 아이디어가 더 나은 워크벤치를 만듭니다.</p>
                </div>
                <button
                  onClick={() => setIsWriteModalOpen(false)}
                  aria-label="작성 창 닫기"
                  className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                ><X size={24}/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 bg-slate-50 space-y-6">
                <div className="flex gap-4">
                  <div className="w-1/2">
                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><Tag size={12}/> 관련 모듈</label>
                    <select value={formData.module} onChange={e=>setFormData({...formData, module: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-green-500 bg-white text-sm font-bold text-slate-700 cursor-pointer">
                      <option>공통 (UI / UX / Dashboard)</option><option>Truss Analysis</option><option>Pipe Analysis</option><option>Interactive Apps</option>
                    </select>
                  </div>
                  <div className="w-1/2">
                    <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><Flag size={12}/> 희망 중요도</label>
                    <select value={formData.priority} onChange={e=>setFormData({...formData, priority: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-green-500 bg-white text-sm font-bold text-slate-700 cursor-pointer">
                      <option>낮음 (있으면 좋음)</option><option>보통 (업무 효율성 향상)</option><option>높음 (핵심 기능 버그/부재)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">제안 요약 (Title)</label>
                  <input type="text" required placeholder="ex) Truss 결과의 엑셀 다운로드 기능 추가" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-green-500 font-bold text-slate-800" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상세 제안 내용 (Description)</label>
                  <div className="bg-white rounded-lg border border-slate-200 focus-within:border-green-500 overflow-hidden">
                    <textarea required placeholder="현재의 불편한 점과 개선점을 상세히 적어주세요." value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} className="w-full h-40 p-4 outline-none resize-none text-sm text-slate-700 leading-relaxed" />
                    <div className="bg-slate-50 border-t border-slate-100 p-2 text-xs text-slate-400 font-mono text-right">* 제출된 제안은 운영진 검토 후 Status가 변경됩니다.</div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setIsWriteModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer">취소</button>
                  <button type="submit" className="px-8 py-2.5 bg-brand-blue text-white font-bold rounded-xl hover:bg-brand-blue-dark transition-colors shadow-lg cursor-pointer">제안서 제출하기</button>
                </div>
              </form>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      {/* --- 상세 조회 및 관리자 피드백 모달 --- */}
      <Transition appear show={isViewModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsViewModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-3xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-slate-100 flex justify-between items-start shrink-0">
                <div>
                  <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full border inline-block mb-2 ${statusColors[selectedReq?.status]}`}>{selectedReq?.status}</span>
                  <Dialog.Title className="text-2xl font-bold text-slate-800">{selectedReq?.title}</Dialog.Title>
                  <p className="text-xs text-slate-400 mt-2">작성자: {selectedReq?.author_name} | {selectedReq && new Date(selectedReq.created_at).toLocaleString()}</p>
                </div>
                <button
                  onClick={() => setIsViewModalOpen(false)}
                  aria-label="상세 보기 닫기"
                  className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                ><X size={24} className="text-slate-400 hover:text-slate-800 cursor-pointer"/></button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                <div className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{selectedReq?.content}</div>

                {(() => {
                  const isResolved = selectedReq && resolvedStatuses.has(selectedReq.status);
                  const showEditor = isAdmin && !isResolved;

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shrink-0 mt-8">
                      <h4 className="text-xs font-bold text-indigo-600 mb-3 flex items-center gap-1">
                        <MessageCircle size={14}/> Admin Feedback
                      </h4>

                      {showEditor ? (
                        <div className="space-y-3">
                          <select value={adminReply.status} onChange={e=>setAdminReply({...adminReply, status: e.target.value})} className="w-full p-2 border rounded text-sm font-bold text-slate-700 outline-none">
                            <option value="Under Review">Under Review (검토 중)</option>
                            <option value="Planned">Planned (계획됨)</option>
                            <option value="In Progress">In Progress (개발 중)</option>
                            <option value="Resolved">Resolved (해결 완료)</option>
                          </select>
                          <textarea placeholder="사용자에게 전달할 답변을 작성하세요." value={adminReply.admin_comment} onChange={e=>setAdminReply({...adminReply, admin_comment: e.target.value})} className="w-full p-3 border rounded-lg text-sm h-24 resize-none outline-none" />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setConfirmDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-lg flex items-center gap-1 hover:bg-red-100 cursor-pointer"><Trash2 size={16}/> 게시글 삭제</button>
                            <button onClick={handleAdminReplySave} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg flex items-center gap-1 hover:bg-indigo-700 cursor-pointer"><Send size={16}/> 피드백 저장</button>
                          </div>
                        </div>
                      ) : selectedReq?.admin_comment ? (
                        <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center text-xs font-extrabold shrink-0 shadow-sm">
                            A
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-bold text-slate-800">관리자</span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                  <CheckCircle2 size={10} /> Resolved
                                </span>
                              </div>
                              {isResolved && isAdmin && (
                                <button
                                  onClick={() => setConfirmDeleteOpen(true)}
                                  title="게시글 삭제"
                                  aria-label="게시글 삭제"
                                  className="text-slate-300 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                              {selectedReq.admin_comment}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 font-medium">아직 관리자 답변이 등록되지 않았습니다.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="게시글 삭제"
        message="이 요청 게시글을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?"
        confirmLabel="삭제"
      />
    </div>
  );
}
