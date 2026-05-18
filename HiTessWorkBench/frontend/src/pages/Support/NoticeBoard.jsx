import React, { useState, useEffect, Fragment, useMemo } from 'react';
import { Megaphone, Plus, ChevronRight, Pin, X, Edit2, Trash2, Bold, Italic, List, Link, Paperclip, CalendarDays, Inbox } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { getNotices, createNotice, updateNotice, deleteNotice } from '../../api/admin';
import GuideButton from '../../components/ui/GuideButton';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import NoticeDetailModal, { NOTICE_TYPE_STYLE } from '../../components/modals/NoticeDetailModal';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s?/g, '-').replace(/-$/, '');
};

const getPreview = (content, max = 90) => {
  if (!content) return '';
  const plain = String(content).replace(/\s+/g, ' ').trim();
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
};

export default function NoticeBoard() {
  const { showToast } = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const [notices, setNotices] = useState([]);

  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [formData, setFormData] = useState({ type: 'Notice', title: '', content: '', is_pinned: false });

  useEffect(() => {
    fetchNotices();
  }, []);

  const fetchNotices = async () => {
    try {
      const res = await getNotices();
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
    try {
      await deleteNotice(selectedNotice.id);
      setIsViewModalOpen(false);
      setConfirmDeleteOpen(false);
      fetchNotices();
    } catch (err) { showToast('삭제 실패: ' + err.message, 'error'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) { showToast('로그인 정보가 없습니다.', 'warning'); return; }
    try {
      const payload = { ...formData, author_id: currentUser.employee_id };
      if (editMode) {
        await updateNotice(selectedNotice.id, payload);
      } else {
        await createNotice(payload);
      }
      setIsWriteModalOpen(false);
      fetchNotices();
    } catch (err) { showToast('저장 실패: 서버 연결을 확인하세요.', 'error'); console.error(err); }
  };

  const pinnedNotices = useMemo(() => notices.filter(n => n.is_pinned), [notices]);
  const regularNotices = useMemo(() => notices.filter(n => !n.is_pinned), [notices]);

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <PageHeader
        title="Notice & Updates"
        icon={Megaphone}
        subtitle="시스템 업데이트 내역 및 중요 공지사항을 확인하세요."
        accentColor="blue"
        actions={
          <>
            <GuideButton guideTitle="Notice & Updates — HiTess WorkBench 개발 현황 및 로드맵" />
            {isAdmin && (
              <button onClick={openWriteModal} className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 text-white rounded-lg text-sm font-bold hover:bg-white/20 transition-colors cursor-pointer">
                <Plus size={18} /> 새 공지 작성
              </button>
            )}
          </>
        }
      />

      {/* ── Pinned 하이라이트 ── */}
      {pinnedNotices.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3 px-1">
            <Pin size={14} className="text-red-500 fill-red-100" />
            <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pinned</h2>
            <span className="text-[11px] font-semibold text-slate-400 tabular-nums">({pinnedNotices.length})</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pinnedNotices.map(notice => {
              const style = NOTICE_TYPE_STYLE[notice.type] || NOTICE_TYPE_STYLE.Notice;
              return (
                <div
                  key={notice.id}
                  onClick={() => openViewModal(notice)}
                  className="group relative bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-300 transition-all cursor-pointer overflow-hidden"
                >
                  {/* 좌측 컬러 사이드 바 */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${style.bar}`} />

                  <div className="pl-6 pr-5 py-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${style.chip}`}>
                        {style.label}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        <Pin size={9} className="fill-red-500" />
                        고정
                      </span>
                    </div>

                    <h3 className="font-bold text-slate-800 text-[15px] leading-snug group-hover:text-blue-600 transition-colors line-clamp-2 mb-2">
                      {notice.title}
                    </h3>

                    {notice.content && (
                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">
                        {getPreview(notice.content, 110)}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-mono tabular-nums">
                        <CalendarDays size={11} />
                        {formatDate(notice.created_at)}
                      </span>
                      <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 전체 공지 리스트 ── */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Megaphone size={14} className="text-slate-400" />
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">All Notices</h2>
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">({regularNotices.length})</span>
        </div>

        {regularNotices.length === 0 && pinnedNotices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-16 flex flex-col items-center justify-center text-slate-400">
            <Inbox size={36} className="mb-2 opacity-50" />
            <p className="text-sm font-semibold">등록된 공지사항이 없습니다.</p>
            <p className="text-xs mt-1">관리자가 새 공지를 작성하면 이곳에 표시됩니다.</p>
          </div>
        ) : regularNotices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-400">
            고정 공지 외에 표시할 공지가 없습니다.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
            {regularNotices.map(notice => {
              const style = NOTICE_TYPE_STYLE[notice.type] || NOTICE_TYPE_STYLE.Notice;
              return (
                <div
                  key={notice.id}
                  onClick={() => openViewModal(notice)}
                  className="relative flex items-center gap-4 px-6 py-4 hover:bg-slate-50/70 transition-colors cursor-pointer group"
                >
                  {/* 좌측 hover 시 표시되는 컬러 바 */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${style.bar} opacity-0 group-hover:opacity-100 transition-opacity`} />

                  <span className={`inline-flex items-center justify-center w-20 shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border ${style.chip}`}>
                    {style.label}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-700 group-hover:text-blue-600 transition-colors truncate">
                      {notice.title}
                    </div>
                    {notice.content && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {getPreview(notice.content, 120)}
                      </p>
                    )}
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-mono tabular-nums shrink-0">
                    <CalendarDays size={12} className="opacity-70" />
                    {formatDate(notice.created_at)}
                  </span>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Transition appear show={isWriteModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsWriteModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="bg-brand-blue p-5 flex justify-between items-center text-white shrink-0">
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
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
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
                  <button type="submit" className="px-8 py-2.5 bg-brand-green text-white font-bold rounded-xl hover:bg-brand-green transition-colors shadow-lg cursor-pointer">공지 배포하기</button>
                </div>
              </form>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      <NoticeDetailModal
        isOpen={isViewModalOpen}
        notice={selectedNotice}
        onClose={() => setIsViewModalOpen(false)}
        extraActions={isAdmin ? (
          <>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer transition-colors"
            >
              <Trash2 size={15} /> 삭제
            </button>
            <button
              onClick={handleEditClick}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
            >
              <Edit2 size={15} /> 수정
            </button>
          </>
        ) : null}
      />
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="공지 삭제"
        message="이 공지사항을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?"
        confirmLabel="삭제"
      />
    </div>
  );
}