import React, { useState, useEffect, Fragment } from 'react';
import { Lightbulb, Plus, ThumbsUp, MessageCircle, X, Trash2, Send, Tag, Flag } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { getFeatureRequests, createFeatureRequest, upvoteFeatureRequest, commentFeatureRequest, deleteFeatureRequest } from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';

export default function UserRequests() {
  const { showToast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [requests, setRequests] = useState([]);

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
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setIsAdmin(parsed.is_admin);
      setCurrentUser(parsed);
    }
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
  };

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <PageHeader
        title="User Requests"
        icon={Lightbulb}
        subtitle="필요한 기능이나 개선사항을 제안해 주세요. 모든 사용자가 작성할 수 있습니다."
        accentColor="amber"
        actions={
          <button onClick={openWriteModal} className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 text-white rounded-lg text-sm font-bold hover:bg-white/20 transition-colors cursor-pointer">
            <Plus size={18} /> 새 요청 작성
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {requests.map(req => (
          <div key={req.id} onClick={() => openViewModal(req)} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-brand-accent hover:shadow-md transition-all cursor-pointer flex flex-col h-full">
            <div className="flex justify-between items-start mb-4">
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full border ${statusColors[req.status] || statusColors['Under Review']}`}>{req.status}</span>
              <span className="text-xs text-slate-400 font-bold">{req.author_name}</span>
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">{req.title}</h3>
            <p className="text-sm text-slate-500 mb-4 flex-1 line-clamp-3">{req.content}</p>
            <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-auto">
              <div className="flex gap-4">
                <button onClick={(e) => { e.stopPropagation(); handleUpvote(req.id); }} className="flex items-center gap-1.5 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer">
                  <ThumbsUp size={16} /> <span className="text-sm font-bold">{req.upvotes}</span>
                </button>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <MessageCircle size={16} /> <span className="text-sm font-bold">{req.comments_count}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

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
                <button onClick={() => setIsWriteModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer"><X size={24}/></button>
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
                <button onClick={() => setIsViewModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-800 cursor-pointer"/></button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                <div className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{selectedReq?.content}</div>
                
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shrink-0 mt-8">
                  <h4 className="text-xs font-bold text-indigo-600 mb-3 flex items-center gap-1"><MessageCircle size={14}/> Admin Feedback</h4>
                  {isAdmin ? (
                     <div className="space-y-3">
                       <select value={adminReply.status} onChange={e=>setAdminReply({...adminReply, status: e.target.value})} className="w-full p-2 border rounded text-sm font-bold text-slate-700 outline-none">
                         <option value="Under Review">Under Review (검토 중)</option>
                         <option value="Planned">Planned (계획됨)</option>
                         <option value="In Progress">In Progress (개발 중)</option>
                       </select>
                       <textarea placeholder="사용자에게 전달할 답변을 작성하세요." value={adminReply.admin_comment} onChange={e=>setAdminReply({...adminReply, admin_comment: e.target.value})} className="w-full p-3 border rounded-lg text-sm h-24 resize-none outline-none" />
                       <div className="flex justify-end gap-2">
                         <button onClick={() => setConfirmDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-lg flex items-center gap-1 hover:bg-red-100 cursor-pointer"><Trash2 size={16}/> 게시글 삭제</button>
                         <button onClick={handleAdminReplySave} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg flex items-center gap-1 hover:bg-indigo-700 cursor-pointer"><Send size={16}/> 피드백 저장</button>
                       </div>
                     </div>
                  ) : (
                     <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap">
                       {selectedReq?.admin_comment || "아직 관리자 답변이 등록되지 않았습니다."}
                     </p>
                  )}
                </div>
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