/**
 * 공지 본문 모달 — 대시보드 NoticeStrip 과 Notice & Updates 게시판이 공용으로 사용한다.
 *
 * Props:
 *   - isOpen, notice, onClose : 필수
 *   - primaryAction : { label, onClick, icon? } — 우측 강조 CTA. 클릭 시 자동으로 onClose 호출 후 onClick 실행.
 *   - extraActions  : ReactNode — 닫기 버튼 앞에 들어가는 추가 액션 (예: 관리자 수정/삭제).
 */
import React, { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Pin, X, CalendarDays, Lock } from 'lucide-react';

// 타입별 톤 토큰 — NoticeStrip / NoticeDetailModal 공용. 새 타입 추가 시 이곳만 수정한다.
export const NOTICE_TYPE_STYLE = {
  Notice:      { label: '공지',     bar: 'from-blue-400 to-blue-600',       chip: 'bg-blue-50 text-blue-700 border-blue-200',         glow: 'rgba(59,130,246,0.18)',  headerBg: 'from-blue-600 to-blue-700',       headerBorder: 'border-blue-500',    chipStrong: 'bg-blue-600 text-white',    ctaBtn: 'from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800'         },
  Update:      { label: '업데이트', bar: 'from-emerald-400 to-emerald-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', glow: 'rgba(16,185,129,0.18)', headerBg: 'from-emerald-600 to-emerald-700', headerBorder: 'border-emerald-500', chipStrong: 'bg-emerald-600 text-white', ctaBtn: 'from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800' },
  Maintenance: { label: '점검',     bar: 'from-amber-400 to-amber-600',     chip: 'bg-amber-50 text-amber-700 border-amber-200',      glow: 'rgba(245,158,11,0.18)', headerBg: 'from-amber-500 to-amber-600',     headerBorder: 'border-amber-400',   chipStrong: 'bg-amber-500 text-white',   ctaBtn: 'from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700'     },
  Event:       { label: '이벤트',   bar: 'from-violet-400 to-violet-600',   chip: 'bg-violet-50 text-violet-700 border-violet-200',   glow: 'rgba(139,92,246,0.18)', headerBg: 'from-violet-600 to-violet-700',   headerBorder: 'border-violet-500',  chipStrong: 'bg-violet-600 text-white',  ctaBtn: 'from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800' },
};

const formatDateTime = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
};

const formatAuthor = (notice) => {
  if (!notice?.author_id) return null;
  return notice.author_name ? `${notice.author_name}(${notice.author_id})` : notice.author_id;
};

export default function NoticeDetailModal({ isOpen, notice, onClose, primaryAction = null, extraActions = null }) {
  const style = (notice && NOTICE_TYPE_STYLE[notice.type]) || NOTICE_TYPE_STYLE.Notice;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-220" enterFrom="opacity-0 scale-[0.97] translate-y-3" enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-[0.97]"
          >
            <Dialog.Panel className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

              {/* ── 헤더: 타입 색상 그라데이션 배경의 공지문서 헤더 ── */}
              <div className={`relative shrink-0 bg-gradient-to-br ${style.headerBg} px-6 pt-5 pb-0 overflow-hidden`}>
                {/* 우측 상단/하단 미세 글로우 — 헤더 내부에서만 작동 */}
                <div
                  className="absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-20 blur-2xl pointer-events-none"
                  style={{ background: 'rgba(255,255,255,0.5)' }}
                />
                <div
                  className="absolute right-16 bottom-0 w-24 h-24 rounded-full opacity-10 blur-xl pointer-events-none"
                  style={{ background: 'rgba(255,255,255,0.6)' }}
                />

                <div className="relative flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/20 text-white border border-white/30 tracking-wide">
                      {style.label}
                    </span>
                    {notice?.is_pinned && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90 border border-white/25">
                        <Pin size={9} className="-mt-px" />
                        고정
                      </span>
                    )}
                    {notice?.is_private && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-white/90 border border-white/25">
                        <Lock size={9} className="-mt-px" />
                        비공개
                      </span>
                    )}
                  </div>
                  <button
                    onClick={onClose}
                    aria-label="공지 닫기"
                    title="닫기"
                    className="text-white/70 hover:text-white hover:bg-white/15 p-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    <X size={18} />
                  </button>
                </div>

                <Dialog.Title className="relative text-[1.25rem] font-bold text-white leading-snug tracking-tight break-keep pb-1 pr-2">
                  {notice?.title || '(제목 없음)'}
                </Dialog.Title>

                <div className="relative flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2.5 py-2.5 border-t border-white/20 text-[11px] text-white/70">
                  {notice?.created_at && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={11} className="opacity-80" />
                      {formatDateTime(notice.created_at)}
                    </span>
                  )}
                  {formatAuthor(notice) && (
                    <>
                      <span className="text-white/30 select-none">·</span>
                      <span className="inline-flex items-center gap-1 opacity-80">
                        작성자 {formatAuthor(notice)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* ── 본문: 종이 안내문 inset 카드 + 좌측 accent line ── */}
              <div className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar">
                <div className="px-6 pt-5 pb-6">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5">
                    <div className={`relative pl-4 border-l-2 ${style.headerBorder}`}>
                      <p className="whitespace-pre-wrap text-sm text-slate-700 leading-[1.85] tracking-tight">
                        {notice?.content || '본문이 없습니다.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── 푸터: 좌측 문서번호, 우측 액션 그룹 (extra → 닫기 → primary) ── */}
              <div className="shrink-0 px-5 py-3.5 bg-white border-t border-slate-100 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-300 select-none tabular-nums">
                  #{notice?.id ?? '—'}
                </span>
                <div className="flex items-center gap-2">
                  {extraActions}
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-slate-500 font-semibold hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    닫기
                  </button>
                  {primaryAction && (
                    <button
                      onClick={() => { onClose(); primaryAction.onClick?.(); }}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r ${style.ctaBtn} rounded-lg shadow-sm transition-all cursor-pointer`}
                    >
                      {primaryAction.label}
                      {primaryAction.icon}
                    </button>
                  )}
                </div>
              </div>

            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
