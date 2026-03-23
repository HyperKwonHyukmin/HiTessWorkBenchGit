import React, { useState, useEffect, Fragment } from 'react';
import { Megaphone, Plus, ChevronRight, Pin, X, Edit2, Trash2, Bold, Italic, List, Link, Paperclip } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import axios from 'axios';
import { API_BASE_URL } from '../../config';

export default function NoticeBoard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [notices, setNotices] = useState([]);
  
  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const [formData, setFormData] = useState({ type: 'Notice', title: '', content: '', is_pinned: false });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setIsAdmin(parsed.is_admin);
      setCurrentUser(parsed);
    }
    fetchNotices();
  }, []);

  const fetchNotices = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/notices`);
      setNotices(res.data);
    } catch (err) { console.error("공지사항 로드 실패", err); }
  };

  const openWriteModal = () => {
    setEditMode(false);
    setFormData({ type: 'Notice', title: '', content: '', is_pinned: false });
    setIsWriteModalOpen(true);
  };

  const openViewModal = (notice) => {
    setSelectedNotice(notice);
    setIsViewModalOpen(true);
  };

  const handleEditClick = () => {
    setFormData({ 
      type: selectedNotice.type, title: selectedNotice.title, 
      content: selectedNotice.content, is_pinned: selectedNotice.is_pinned 
    });
    setEditMode(true);
    setIsViewModalOpen(false);
    setIsWriteModalOpen(true);
  };

  const handleDelete = async () => {
    if(!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/notices/${selectedNotice.id}`);
      setIsViewModalOpen(false);
      fetchNotices();
    } catch (err) { alert("삭제 실패: " + err.message); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if(!currentUser) {
        alert("로그인 정보가 없습니다."); return;
    }
    try {
      const payload = { ...formData, author_id: currentUser.employee_id };
      if (editMode) {
        await axios.put(`${API_BASE_URL}/api/notices/${selectedNotice.id}`, payload);
      } else {
        await axios.post(`${API_BASE_URL}/api/notices`, payload);
      }
      setIsWriteModalOpen(false);
      fetchNotices();
    } catch (err) { alert("저장 실패: 서버 연결을 확인하세요."); console.error(err); }
  };

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#002554] flex items-center gap-3">
            <Megaphone className="text-blue-500" size={32} /> Notice & Updates
          </h1>
          <p className="text-slate-500 mt-2">시스템 업데이트 내역 및 중요 공지사항을 확인하세요.</p>
        </div>
        {isAdmin && (
          <button onClick={openWriteModal} className="flex items-center gap-2 px-4 py-2 bg-[#002554] text-white rounded-lg text-sm font-bold hover:bg-[#003366] transition-colors shadow-md cursor-pointer">
            <Plus size={18} /> 새 공지 작성
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex bg-slate-50 px-6 py-4 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="w-20 text-center">Type</div>
          <div className="flex-1">Title</div>
          <div className="w-32 text-center">Date</div>
        </div>
        <div className="divide-y divide-slate-100">
          {notices.map(notice => (
            <div key={notice.id} onClick={() => openViewModal(notice)} className="flex px-6 py-4 items-center hover:bg-slate-50 transition-colors cursor-pointer group">
              <div className="w-20 flex justify-center">
                {notice.is_pinned ? <Pin size={16} className="text-red-500 fill-red-100" /> : <span className="px-2.5 py-1 rounded text-[10px] font-bold border bg-slate-100 text-slate-600 border-slate-200">{notice.type}</span>}
              </div>
              <div className="flex-1 px-4 font-bold text-slate-700 group-hover:text-blue-600 transition-colors">{notice.title}</div>
              <div className="w-32 text-center text-sm text-slate-400 font-mono">{new Date(notice.created_at).toLocaleDateString()}</div>
              <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-500" />
            </div>
          ))}
        </div>
      </div>

      <Transition appear show={isWriteModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsWriteModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="bg-[#002554] p-5 flex justify-between items-center text-white shrink-0">
                <div>
                  <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                    <Megaphone size={20} className="text-blue-400" /> {editMode ? '공지사항 수정' : '공식 공지사항 및 업데이트 배포'}
                  </Dialog.Title>
                  <p className="text-xs text-blue-200 mt-1">시스템의 중요 변경사항을 전사에 공유합니다.</p>
                </div>
                <button onClick={() => setIsWriteModalOpen(false)} className="hover:bg-white/10 p-1.5 rounded-lg transition-colors cursor-pointer"><X size={24}/></button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-6 custom-scrollbar">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex gap-4">
                    <div className="w-1/4">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">분류 (Type)</label>
                      <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-bold text-slate-700 bg-slate-50">
                        <option value="Notice">일반 공지 (Notice)</option>
                        <option value="Update">업데이트 (Update)</option>
                        <option value="Maintenance">서버 점검 (Maintenance)</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">제목 (Title)</label>
                      <input type="text" required placeholder="명확하고 간결한 제목을 입력하세요" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-blue-500 text-slate-800" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-sm font-bold text-slate-700">대시보드 상단 고정 (중요)</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={formData.is_pinned} onChange={e => setFormData({...formData, is_pinned: e.target.checked})} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                    </label>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 bg-slate-100 border-b border-slate-200 p-2 text-slate-500">
                    <button type="button" className="p-1.5 hover:bg-white rounded"><Bold size={16}/></button>
                    <button type="button" className="p-1.5 hover:bg-white rounded"><Italic size={16}/></button>
                    <div className="w-px h-4 bg-slate-300 mx-1"></div>
                    <button type="button" className="p-1.5 hover:bg-white rounded"><List size={16}/></button>
                    <button type="button" className="p-1.5 hover:bg-white rounded"><Link size={16}/></button>
                  </div>
                  <textarea required placeholder="상세 내용을 작성해 주세요." value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} className="w-full h-64 p-4 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/20 resize-none text-sm leading-relaxed text-slate-700" />
                </div>

                <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 flex flex-col items-center justify-center text-slate-500 hover:bg-blue-50 hover:border-blue-300 transition-colors cursor-pointer">
                  <Paperclip size={24} className="mb-2 text-slate-400" />
                  <span className="text-sm font-bold">참고 자료 첨부 (PDF, 이미지 등)</span>
                  <span className="text-xs mt-1">클릭하거나 파일을 이곳으로 드래그 하세요</span>
                </div>

                <div className="flex justify-end gap-3 pt-4 shrink-0">
                  <button type="button" onClick={() => setIsWriteModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer">취소</button>
                  <button type="submit" className="px-8 py-2.5 bg-[#008233] text-white font-bold rounded-xl hover:bg-[#006b29] transition-colors shadow-lg cursor-pointer">공지 배포하기</button>
                </div>
              </form>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      <Transition appear show={isViewModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsViewModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-slate-100 flex justify-between items-start shrink-0">
                <div>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded mb-2 inline-block">{selectedNotice?.type}</span>
                  <Dialog.Title className="text-2xl font-bold text-[#002554] mt-1">{selectedNotice?.title}</Dialog.Title>
                  <p className="text-xs text-slate-400 mt-2">{selectedNotice && new Date(selectedNotice.created_at).toLocaleString()}</p>
                </div>
                <button onClick={() => setIsViewModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={24}/></button>
              </div>
              <div className="p-6 bg-slate-50 min-h-[200px] whitespace-pre-wrap text-slate-700 leading-relaxed overflow-y-auto">
                {selectedNotice?.content}
              </div>
              {isAdmin && (
                <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-2 shrink-0">
                  <button onClick={handleDelete} className="flex items-center gap-1 px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg cursor-pointer"><Trash2 size={16}/> 삭제</button>
                  <button onClick={handleEditClick} className="flex items-center gap-1 px-4 py-2 text-[#002554] font-bold hover:bg-slate-100 rounded-lg cursor-pointer"><Edit2 size={16}/> 수정</button>
                </div>
              )}
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}