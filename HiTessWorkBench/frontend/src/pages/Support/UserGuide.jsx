import React, { useState, useEffect, Fragment } from 'react';
import { BookOpen, Edit3, FileText, X, Terminal, Eye, Trash2, Edit2 } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import axios from 'axios';
import { API_BASE_URL } from '../../config';

export default function UserGuide() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [guides, setGuides] = useState([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreview, setIsPreview] = useState(false); 
  const [editMode, setEditMode] = useState(false);
  const [selectedGuideId, setSelectedGuideId] = useState(null);

  const [activeCategory, setActiveCategory] = useState("Getting Started");
  const [formData, setFormData] = useState({ category: 'Getting Started', title: '', content: '' });

  const categories = ["Getting Started", "Analysis Modules", "Result Interpretation", "Troubleshooting"];

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setIsAdmin(parsed.is_admin);
      setCurrentUser(parsed);
    }
    fetchGuides();
  }, []);

  const fetchGuides = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/user-guides`);
      setGuides(res.data);
    } catch (err) { console.error("가이드 로드 실패", err); }
  };

  const openWriteModal = () => {
    setEditMode(false); setIsPreview(false);
    setFormData({ category: activeCategory, title: '', content: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (guide) => {
    setEditMode(true); setIsPreview(false); setSelectedGuideId(guide.id);
    setFormData({ category: guide.category, title: guide.title, content: guide.content });
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if(!window.confirm("이 가이드를 삭제하시겠습니까?")) return;
    try { 
      await axios.delete(`${API_BASE_URL}/api/user-guides/${id}`); 
      fetchGuides(); 
    } catch (err) { alert("삭제 실패"); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if(!currentUser) { alert("로그인이 필요합니다."); return; }
    try {
      const payload = { ...formData, author_id: currentUser.employee_id };
      if (editMode) await axios.put(`${API_BASE_URL}/api/user-guides/${selectedGuideId}`, payload);
      else await axios.post(`${API_BASE_URL}/api/user-guides`, payload);
      setIsModalOpen(false); fetchGuides();
    } catch (err) { alert("저장 실패"); }
  };

  const currentGuides = guides.filter(g => g.category === activeCategory);

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] animate-fade-in-up">
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-[#002554] flex items-center gap-3"><BookOpen className="text-indigo-500" size={32} /> User Guide</h1>
          <p className="text-slate-500 mt-2">시스템 매뉴얼 및 해석 기준 가이드라인을 확인하세요.</p>
        </div>
        <div className="flex gap-3">
          {isAdmin && (
            <button onClick={openWriteModal} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 shadow-md cursor-pointer">
              <Edit3 size={18} /> 새 가이드 작성
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        <div className="w-64 bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2 overflow-y-auto shrink-0 shadow-sm">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`text-left px-4 py-3 rounded-xl text-sm font-bold transition-colors cursor-pointer ${activeCategory === cat ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-8 overflow-y-auto shadow-sm relative">
          <div className="flex items-center gap-2 text-indigo-600 font-bold mb-6 border-b border-slate-100 pb-4"><FileText size={20} /> {activeCategory}</div>
          {currentGuides.length === 0 ? <p className="text-slate-400">등록된 가이드라인이 없습니다.</p> : 
            currentGuides.map(guide => (
              <div key={guide.id} className="mb-10 prose prose-slate max-w-none text-slate-600 group relative pr-20">
                <h3 className="text-xl font-extrabold text-[#002554] mb-3">{guide.title}</h3>
                {isAdmin && (
                  <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                     <button onClick={() => openEditModal(guide)} className="p-2 bg-slate-100 text-slate-600 rounded hover:bg-blue-100 hover:text-blue-600 cursor-pointer"><Edit2 size={16}/></button>
                     <button onClick={() => handleDelete(guide.id)} className="p-2 bg-slate-100 text-slate-600 rounded hover:bg-red-100 hover:text-red-600 cursor-pointer"><Trash2 size={16}/></button>
                  </div>
                )}
                <p className="bg-slate-50 p-5 rounded-xl border border-slate-100 whitespace-pre-wrap leading-relaxed">{guide.content}</p>
              </div>
            ))
          }
        </div>
      </div>

      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-7xl h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="bg-indigo-600 p-5 flex justify-between items-center text-white shrink-0">
                <Dialog.Title className="font-extrabold text-lg flex items-center gap-2"><BookOpen size={20}/> {editMode ? '가이드라인 수정' : '시스템 가이드라인 제정'}</Dialog.Title>
                <button onClick={() => setIsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg cursor-pointer"><X size={24}/></button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-hidden bg-slate-50 p-6 flex gap-6">
                <div className="w-1/4 space-y-5 overflow-y-auto custom-scrollbar pr-2">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <label className="block text-xs font-bold text-indigo-600 uppercase mb-2">분류 (Category)</label>
                    <select value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold text-slate-700 bg-slate-50">
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="block text-xs font-bold text-indigo-600 uppercase mt-4 mb-2">대상 버전 (Target Version)</label>
                    <input type="text" placeholder="ex) v1.0.0 이상" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-sm font-mono" />
                  </div>
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                     <p className="text-xs text-indigo-800 font-bold mb-1">💡 작성 팁</p>
                     <p className="text-[11px] text-indigo-600 leading-relaxed">마크다운(Markdown) 문법을 사용하여 구조적인 기술 문서를 작성할 수 있습니다.</p>
                  </div>
                </div>

                <div className="w-3/4 flex flex-col gap-4 h-full">
                  <div className="shrink-0">
                    <input type="text" required placeholder="가이드 소제목 (명확하게 기재)" value={formData.title} onChange={e=>setFormData({...formData, title: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-bold text-lg text-slate-800 shadow-sm" />
                  </div>
                  
                  <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="flex items-center gap-4 bg-slate-100 border-b border-slate-200 p-2 px-4 shrink-0">
                      <button type="button" onClick={() => setIsPreview(false)} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${!isPreview ? 'bg-white text-indigo-600 border-slate-200 shadow-sm' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Terminal size={14}/> Write</button>
                      <button type="button" onClick={() => setIsPreview(true)} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${isPreview ? 'bg-white text-indigo-600 border-slate-200 shadow-sm' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Eye size={14}/> Preview</button>
                    </div>
                    
                    {!isPreview ? (
                      <textarea required placeholder="가이드 내용을 작성하세요." value={formData.content} onChange={e=>setFormData({...formData, content: e.target.value})} className="flex-1 p-4 outline-none focus:ring-inset focus:ring-2 focus:ring-indigo-500/20 resize-none font-mono text-sm text-slate-700 leading-relaxed bg-slate-50" />
                    ) : (
                      <div className="flex-1 p-5 overflow-y-auto bg-white text-sm text-slate-800 leading-relaxed whitespace-pre-wrap border-[3px] border-indigo-100 m-2 rounded-xl">
                        {formData.content || <span className="text-slate-400 italic">내용이 없습니다.</span>}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-end gap-3 shrink-0 pt-2">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer">취소</button>
                    <button type="submit" className="px-8 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg cursor-pointer">{editMode ? '가이드라인 수정' : '가이드라인 배포'}</button>
                  </div>
                </div>
              </form>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}