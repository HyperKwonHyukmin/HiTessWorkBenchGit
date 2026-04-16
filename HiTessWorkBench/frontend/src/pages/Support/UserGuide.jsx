import React, { useState, useEffect, Fragment } from 'react';
import {
  BookOpen, Edit3, X, Terminal, Eye, Trash2, Edit2,
  Rocket, BarChart2, FileSearch, Wrench, ChevronDown, HelpCircle,
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { getUserGuides, createUserGuide, updateUserGuide, deleteUserGuide } from '../../api/admin';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';

const CATEGORY_CONFIG = {
  "Getting Started": {
    Icon: Rocket,
    activeBg: "bg-blue-600",
    textColor: "text-blue-600",
    lightBg: "bg-blue-50",
    border: "border-blue-200",
    dotBg: "bg-blue-500",
    badgeBg: "bg-blue-100",
  },
  "Analysis Modules": {
    Icon: BarChart2,
    activeBg: "bg-violet-600",
    textColor: "text-violet-600",
    lightBg: "bg-violet-50",
    border: "border-violet-200",
    dotBg: "bg-violet-500",
    badgeBg: "bg-violet-100",
  },
  "Result Interpretation": {
    Icon: FileSearch,
    activeBg: "bg-emerald-600",
    textColor: "text-emerald-600",
    lightBg: "bg-emerald-50",
    border: "border-emerald-200",
    dotBg: "bg-emerald-500",
    badgeBg: "bg-emerald-100",
  },
  "Troubleshooting": {
    Icon: Wrench,
    activeBg: "bg-orange-600",
    textColor: "text-orange-600",
    lightBg: "bg-orange-50",
    border: "border-orange-200",
    dotBg: "bg-orange-500",
    badgeBg: "bg-orange-100",
  },
};

const CATEGORIES = Object.keys(CATEGORY_CONFIG);

export default function UserGuide() {
  const [isAdmin, setIsAdmin]       = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [guides, setGuides]         = useState([]);

  const [isModalOpen, setIsModalOpen]       = useState(false);
  const [isPreview, setIsPreview]           = useState(false);
  const [editMode, setEditMode]             = useState(false);
  const [selectedGuideId, setSelectedGuideId] = useState(null);

  const [activeCategory, setActiveCategory] = useState("Getting Started");
  const [expandedId, setExpandedId]         = useState(null);

  const [formData, setFormData] = useState({ category: 'Getting Started', title: '', content: '' });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setIsAdmin(parsed.is_admin);
      setCurrentUser(parsed);
    }
    fetchGuides();
  }, []);

  // 카테고리 전환 시 첫 번째 가이드 자동 펼치기
  useEffect(() => {
    const first = guides.filter(g => g.category === activeCategory)[0];
    setExpandedId(first?.id ?? null);
  }, [activeCategory, guides]);

  const fetchGuides = async () => {
    try {
      const res = await getUserGuides();
      setGuides(res.data);
    } catch (err) { console.error('가이드 로드 실패', err); }
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
    if (!window.confirm('이 가이드를 삭제하시겠습니까?')) return;
    try { await deleteUserGuide(id); fetchGuides(); }
    catch { alert('삭제 실패'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) { alert('로그인이 필요합니다.'); return; }
    try {
      const payload = { ...formData, author_id: currentUser.employee_id };
      if (editMode) await updateUserGuide(selectedGuideId, payload);
      else await createUserGuide(payload);
      setIsModalOpen(false);
      fetchGuides();
    } catch { alert('저장 실패'); }
  };

  const currentGuides = guides.filter(g => g.category === activeCategory);
  const cfg = CATEGORY_CONFIG[activeCategory] ?? CATEGORY_CONFIG['Getting Started'];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] animate-fade-in-up">

      {/* ── 그라디언트 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-6 bg-gradient-to-r from-[#002554] via-indigo-900 to-indigo-700 overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-8 -top-8 w-64 h-64 bg-white rounded-full" />
          <div className="absolute right-32 bottom-0 w-32 h-32 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-white border border-white/10">
              <BookOpen size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">User Guide</h1>
              <p className="text-sm text-indigo-200/80 mt-1">시스템 매뉴얼 및 해석 기준 가이드라인을 확인하세요.</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={openWriteModal}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg text-sm font-bold transition-colors cursor-pointer"
            >
              <Edit3 size={16} /> 새 가이드 작성
            </button>
          )}
        </div>
      </div>

      {/* ── 본문: 2-column ── */}
      <div className="flex gap-5 flex-1 min-h-0">

        {/* 좌측 카테고리 네비 */}
        <div className="w-52 shrink-0 flex flex-col gap-2">
          {CATEGORIES.map((cat) => {
            const { Icon, activeBg, textColor, badgeBg, lightBg } = CATEGORY_CONFIG[cat];
            const count   = guides.filter(g => g.category === cat).length;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all cursor-pointer text-left w-full ${
                  isActive
                    ? `${activeBg} text-white shadow-md`
                    : `bg-white border border-slate-200 ${textColor} hover:${lightBg}`
                }`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex-1 leading-tight">{cat}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? 'bg-white/20 text-white' : `${badgeBg} ${textColor}`
                }`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* 우측 아코디언 가이드 목록 */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
          {currentGuides.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <HelpCircle size={36} className="mb-2 opacity-30" />
              <p className="text-sm">등록된 가이드라인이 없습니다.</p>
            </div>
          ) : currentGuides.map((guide) => {
            const isExpanded = expandedId === guide.id;
            return (
              <div
                key={guide.id}
                className={`bg-white rounded-xl border transition-all duration-150 ${
                  isExpanded ? `${cfg.border} shadow-sm` : 'border-slate-200'
                }`}
              >
                {/* 아코디언 헤더 */}
                <div
                  className={`flex items-center justify-between px-5 py-3.5 cursor-pointer select-none rounded-xl ${
                    isExpanded ? '' : 'hover:bg-slate-50/70'
                  }`}
                  onClick={() => setExpandedId(isExpanded ? null : guide.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotBg}`} />
                    <span className={`font-semibold text-sm leading-snug ${
                      isExpanded ? cfg.textColor : 'text-slate-700'
                    }`}>
                      {guide.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-4">
                    {isAdmin && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditModal(guide); }}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        ><Edit2 size={13} /></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(guide.id); }}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                        ><Trash2 size={13} /></button>
                      </>
                    )}
                    <ChevronDown
                      size={15}
                      className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </div>

                {/* 아코디언 콘텐츠 */}
                {isExpanded && (
                  <div className={`px-6 pb-6 border-t ${cfg.border}`}>
                    <div className="pt-5 prose prose-slate prose-sm max-w-none text-slate-600">
                      <MarkdownRenderer content={guide.content} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 편집 모달 ── */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-7xl h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">

              <div className="bg-indigo-700 p-5 flex justify-between items-center text-white shrink-0">
                <Dialog.Title className="font-extrabold text-lg flex items-center gap-2">
                  <BookOpen size={20} /> {editMode ? '가이드라인 수정' : '시스템 가이드라인 제정'}
                </Dialog.Title>
                <button onClick={() => setIsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg cursor-pointer">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex-1 overflow-hidden bg-slate-50 p-6 flex gap-6">
                {/* 좌측 메타 패널 */}
                <div className="w-1/4 space-y-5 overflow-y-auto pr-2">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <label className="block text-xs font-bold text-indigo-600 uppercase mb-2">분류 (Category)</label>
                    <select
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 font-bold text-slate-700 bg-slate-50"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="block text-xs font-bold text-indigo-600 uppercase mt-4 mb-2">대상 버전</label>
                    <input type="text" placeholder="ex) v0.0.6 이상" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-sm font-mono" />
                  </div>
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                    <p className="text-xs text-indigo-800 font-bold mb-1">💡 작성 팁</p>
                    <p className="text-[11px] text-indigo-600 leading-relaxed">
                      마크다운(Markdown) 문법을 사용할 수 있습니다.<br /><br />
                      <code className="bg-indigo-100 px-1 rounded">## 제목</code><br />
                      <code className="bg-indigo-100 px-1 rounded">| 열 | 내용 |</code> (표)<br />
                      <code className="bg-indigo-100 px-1 rounded">**굵게**</code><br />
                      <code className="bg-indigo-100 px-1 rounded">`코드`</code><br />
                      <code className="bg-indigo-100 px-1 rounded">&gt; 인용</code>
                    </p>
                  </div>
                </div>

                {/* 우측 에디터 */}
                <div className="w-3/4 flex flex-col gap-4 h-full">
                  <div className="shrink-0">
                    <input
                      type="text" required
                      placeholder="가이드 소제목 (명확하게 기재)"
                      value={formData.title}
                      onChange={e => setFormData({ ...formData, title: e.target.value })}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-bold text-lg text-slate-800 shadow-sm"
                    />
                  </div>

                  <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="flex items-center gap-4 bg-slate-100 border-b border-slate-200 p-2 px-4 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsPreview(false)}
                        className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          !isPreview ? 'bg-white text-indigo-600 border-slate-200 shadow-sm' : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Terminal size={14} /> Write
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPreview(true)}
                        className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          isPreview ? 'bg-white text-indigo-600 border-slate-200 shadow-sm' : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Eye size={14} /> Preview
                      </button>
                    </div>

                    {!isPreview ? (
                      <textarea
                        required
                        placeholder="가이드 내용을 마크다운으로 작성하세요."
                        value={formData.content}
                        onChange={e => setFormData({ ...formData, content: e.target.value })}
                        className="flex-1 p-4 outline-none focus:ring-inset focus:ring-2 focus:ring-indigo-500/20 resize-none font-mono text-sm text-slate-700 leading-relaxed bg-slate-50"
                      />
                    ) : (
                      <div className="flex-1 p-5 overflow-y-auto bg-white border-[3px] border-indigo-100 m-2 rounded-xl">
                        {formData.content
                          ? <MarkdownRenderer content={formData.content} />
                          : <span className="text-slate-400 italic">내용이 없습니다.</span>
                        }
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 shrink-0 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                    >취소</button>
                    <button
                      type="submit"
                      className="px-8 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg cursor-pointer"
                    >{editMode ? '가이드라인 수정' : '가이드라인 배포'}</button>
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
