/// <summary>
/// 대시보드 공용 부품 — 공지 한 줄, 섹션 제목, 로드맵·소개자료·홍보영상 모달.
/// 2026-09-30 대시보드 개편 때 구 Dashboard.jsx 에서 그대로 옮겼다(동작 변경 없음).
/// </summary>
import React, { Fragment, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, Transition } from '@headlessui/react';
import {
  ChevronRight, Clock, Layers, Map, Maximize2, Megaphone, Pin, Play, Rocket, Server, Sparkles, Wrench, X,
} from 'lucide-react';
import { getNotices } from '../../api/admin';
import { API_BASE_URL } from '../../config';
import { useAppCatalogue } from '../../contexts/DashboardContext';
import { NOTICE_TYPE_STYLE } from '../../components/modals/noticeTypeStyle';
import Button from '../../components/ui/Button';

const MODE_KO = {
  File: "File-Based Apps",
  Interactive: "Interactive Apps",
  Parametric: "Parametric Apps",
  Productivity: "Productivity Apps"
};

// 대시보드의 섹션 제목은 이 한 가지 모양뿐이다(아이콘 칩 + 제목). 2026-10-01 에 제목 밑 그라데이션 줄,
// 카드 위 색 띠, '참고 지표' 자간 라벨이 섞여 있던 것을 이것으로 통일했다. 색은 아이콘 칩에만 쓴다.
const SECTION_ACCENTS = {
  service: 'bg-blue-50 text-blue-600 ring-blue-100',
  favorite: 'bg-amber-50 text-amber-500 ring-amber-100',
  history: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const DashboardSectionTitle = ({ icon: Icon, title, accent = 'service', children }) => (
  <div className="min-w-0">
    <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${SECTION_ACCENTS[accent] || SECTION_ACCENTS.service}`}>
        <Icon size={15} />
      </span>
      <span>{title}</span>
    </h2>
    {children}
  </div>
);

const PROMOTION_VIDEOS = [
  {
    id: 'workbench',
    title: 'HiTESS WorkBench',
    subtitle: '차세대 조선해양 구조 해석 플랫폼',
    filename: 'HiTESS Workbench.mp4',
  },
  {
    id: 'digital-engineering',
    title: 'HiTESS 설계와 디지털 엔지니어링의 연결',
    subtitle: '설계 데이터와 디지털 엔지니어링 업무 흐름 소개',
    filename: 'HiTESS 설계와 디지털 엔지니어링의 연결.mp4',
  },
];

const buildPromotionVideoUrl = (filename) => (
  `${API_BASE_URL}/static/videos/${encodeURIComponent(filename)}`
);

// HiTESS Story 선택 및 플레이어 모달
// — 모달이 열릴 때만 <video>를 DOM에 마운트하여 백그라운드 디코딩/네트워크 낭비를 방지한다.
// — crossOrigin 속성 미설정: 미디어 스트리밍은 CORS 헤더 없이도 동작하며,
//   crossOrigin을 켜면 오히려 CORS 헤더를 요구해 재생이 깨진다.
export const VideoPlayerModal = ({ isOpen, onClose }) => {
  const videoRef = useRef(null);
  const [selectedVideo, setSelectedVideo] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      setSelectedVideo(null);
    }
  }, [isOpen]);

  const videoUrl = selectedVideo ? buildPromotionVideoUrl(selectedVideo.filename) : '';

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        {/* 배경 오버레이 */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-250" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel
              className="w-full max-w-4xl bg-[#001a3d] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              {/* 모달 헤더 */}
              <div
                className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0"
                style={{ background: 'linear-gradient(90deg, #002554 0%, #00305c 100%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 border border-white/15">
                    <Play size={16} className="text-blue-200" fill="currentColor" />
                  </div>
                  <div>
                    <Dialog.Title className="text-white font-bold text-sm leading-tight">
                      {selectedVideo ? selectedVideo.title : 'HiTESS Story'}
                    </Dialog.Title>
                    <p className="text-slate-300 text-[11px]">
                      {selectedVideo ? selectedVideo.subtitle : '재생할 영상을 선택하세요'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="영상 모달 닫기"
                >
                  <X size={18} />
                </button>
              </div>

              {selectedVideo ? (
                <>
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-5 py-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedVideo(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-blue-100 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
                    >
                      <ChevronRight size={14} className="rotate-180" />
                      영상 목록
                    </button>
                    <span className="truncate text-[11px] font-semibold text-slate-300">{selectedVideo.filename}</span>
                  </div>

                  {/* 16:9 비율 영상 컨테이너 */}
                  {/* isOpen이 true일 때만 <video>를 마운트 — 닫힌 상태에서 네트워크 요청 없음 */}
                  <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
                    {isOpen && (
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        controls
                        autoPlay
                        className="absolute inset-0 w-full h-full"
                        style={{ display: 'block' }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="grid gap-3 bg-slate-950/45 p-5 sm:grid-cols-2">
                  {PROMOTION_VIDEOS.map((video) => (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => setSelectedVideo(video)}
                      className="group flex min-h-32 items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.07] p-4 text-left transition-colors hover:border-blue-300/50 hover:bg-white/[0.11] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 cursor-pointer"
                    >
                      <span className="min-w-0">
                        <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400/15 text-blue-200 ring-1 ring-blue-200/20">
                          <Play size={16} fill="currentColor" />
                        </span>
                        <span className="block text-sm font-extrabold leading-snug text-white">
                          {video.title}
                        </span>
                        <span className="mt-1.5 block text-xs font-medium leading-relaxed text-slate-300">
                          {video.subtitle}
                        </span>
                      </span>
                      <ChevronRight size={18} className="mt-1 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-200" />
                    </button>
                  ))}
                </div>
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};

// newWithinDays: 지정하면 그 기간보다 오래된 공지는 읽지 않았어도 NEW 로 세지 않는다
// (고정 공지가 몇 달째 NEW 로 남는 문제). 넘기지 않으면 예전처럼 읽음 여부만 본다.
// pinnedWithinDays: 지정하면 그 기간보다 오래된 고정 공지는 맨 앞 자리를 잃고 날짜순에 섞인다
// (관리자가 고정 해제를 잊으면 몇 달 지난 안내가 첫 화면을 차지해 앱이 방치된 것처럼 보인다).
// hideAfterDays: 지정하면 모든 공지가 그 기간보다 오래됐을 때 줄 자체를 숨긴다 — 넉 달 지난 안내 한 줄이
// 첫 화면에 남아 있으면 오히려 방치된 앱처럼 보인다. 공지 목록은 사이드바 'Notice & Updates' 에 그대로 있다.
export const NoticeStrip = ({ onOpenDetail, onOpenList, newWithinDays = null, pinnedWithinDays = null, hideAfterDays = null }) => {
  const [notices, setNotices] = useState([]);
  const [lastSeenId, setLastSeenId] = useState(0);

  useEffect(() => {
    getNotices()
      .then(res => {
        const data = Array.isArray(res.data) ? res.data : [];
        const pinCutoff = pinnedWithinDays ? Date.now() - pinnedWithinDays * 86400000 : null;
        const pinnedNow = (n) => !!n.is_pinned && (pinCutoff === null || Date.parse(n.created_at) >= pinCutoff);
        const sorted = [...data].sort((a, b) => {
          if (pinnedNow(a) !== pinnedNow(b)) return pinnedNow(a) ? -1 : 1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        setNotices(sorted.slice(0, 5));
      })
      .catch(() => {});
    const seen = parseInt(localStorage.getItem('notice_last_seen_id') || '0', 10);
    if (Number.isFinite(seen)) setLastSeenId(seen);
  }, []);

  if (notices.length === 0) return null;
  if (hideAfterDays) {
    const staleCutoff = Date.now() - hideAfterDays * 86400000;
    if (notices.every(n => Date.parse(n.created_at) < staleCutoff)) return null;
  }

  const newCutoff = newWithinDays ? Date.now() - newWithinDays * 86400000 : null;
  const unreadCount = notices.filter(n =>
    Number(n.id) > lastSeenId && (newCutoff === null || Date.parse(n.created_at) >= newCutoff)).length;
  const current = notices[0];
  const style = NOTICE_TYPE_STYLE[current.type] || NOTICE_TYPE_STYLE.Notice;

  const formatRelative = (s) => {
    if (!s) return '';
    const d = new Date(s);
    const now = new Date();
    const diffH = (now - d) / 36e5;
    if (diffH < 1) return '방금 전';
    if (diffH < 24) return `${Math.floor(diffH)}시간 전`;
    if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}일 전`;
    return d.toLocaleDateString();
  };

  const markAsSeen = () => {
    const maxId = notices.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
    if (maxId > lastSeenId) {
      localStorage.setItem('notice_last_seen_id', String(maxId));
      setLastSeenId(maxId);
    }
  };

  const handleOpenCurrent = () => {
    markAsSeen();
    if (current) onOpenDetail(current);
  };

  const handleOpenAll = (e) => {
    e.stopPropagation();
    markAsSeen();
    onOpenList();
  };

  return (
    <motion.div
      onClick={handleOpenCurrent}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenCurrent(); }
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      whileHover={{ y: -1 }}
      className="relative bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors cursor-pointer overflow-hidden group"
    >
      {/* 좌측 컬러 스트라이프·글로우 제거 — 아이콘·타입 칩으로 구분 */}
      <div className="relative flex items-center gap-2.5 px-3.5 py-2">
        {/* 좌측 라벨 + NEW 배지 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative">
            <div className="p-1.5 rounded-md bg-slate-50 border border-slate-100 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors">
              <Megaphone size={13} className="text-slate-600 group-hover:text-blue-600 transition-colors" />
            </div>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 ring-2 ring-white" />
              </span>
            )}
          </div>
          <span className="text-[11px] font-bold text-slate-700 tracking-tight whitespace-nowrap">공지 &amp; 업데이트</span>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100"
            >
              <Sparkles size={9} />
              NEW {unreadCount}
            </motion.span>
          )}
        </div>

        {/* 구분선 */}
        <div className="h-5 w-px bg-slate-200 shrink-0" />

        {/* 본문 (회전) */}
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
          <span className={`shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${style.chip}`}>
            {current.is_pinned && <Pin size={9} className="-mt-px" />}
            {style.label}
          </span>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex-1 min-w-0 flex items-center gap-2"
          >
            <span className="text-xs font-semibold text-slate-700 truncate group-hover:text-blue-600 transition-colors">
              {current.title || '(제목 없음)'}
            </span>
            <span className="text-[10px] text-slate-500 shrink-0 hidden sm:inline">
              {formatRelative(current.created_at)}
            </span>
          </motion.div>
        </div>

        {/* 우측 CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenAll}
            title="전체 공지 목록으로 이동"
            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
          >
            <span className="hidden md:inline">전체보기</span>
            <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const MODE_BADGE = {
  File:         { title: 'File-Based Apps', label: 'File-Based',   cls: 'text-blue-700 bg-blue-50 border-blue-200',       ring: 'border-l-blue-500',       iconBg: 'bg-blue-600',       summary: 'CSV, BDF, FEM 결과 파일을 업로드해 해석 모델 생성, 검토, 파이프라인 작업을 수행합니다.' },
  Interactive:  { title: 'Interactive Apps', label: 'Interactive',   cls: 'text-violet-700 bg-violet-50 border-violet-200', ring: 'border-l-violet-500',     iconBg: 'bg-violet-600',     summary: '형상과 단면 조건을 화면에서 직접 조작하며 즉시 계산 결과를 확인하는 도구입니다.' },
  Parametric:   { title: 'Parametric Apps', label: 'Parametric', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', ring: 'border-l-emerald-500', iconBg: 'bg-emerald-600',    summary: '설계 파라미터를 입력해 규칙 기반 계산, 최적 후보 탐색, 상세 판정을 수행합니다.' },
  Productivity: { title: 'Productivity Apps', label: 'Productivity', cls: 'text-amber-700 bg-amber-50 border-amber-200',   ring: 'border-l-amber-500',      iconBg: 'bg-amber-500',      summary: '해석 전후처리, 파일 검증, 결과 추출처럼 반복 업무를 줄이는 보조 도구입니다.' },
};

const STATUS_GROUP_STYLE = {
  Active:     { label: '서비스 중', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', icon: Rocket },
  Developing: { label: '개발 중',   bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   dot: 'bg-amber-500',   icon: Wrench },
  Planned:    { label: '예정',      bg: 'bg-slate-50 border-slate-200',      text: 'text-slate-600',   dot: 'bg-slate-400',   icon: Clock },
};

const ROADMAP_STATUS_DOT = {
  Active: 'bg-emerald-500',
  Developing: 'bg-amber-400',
  Planned: 'bg-slate-400',
};

const ROADMAP_MODE_ORDER = ['File', 'Interactive', 'Parametric', 'Productivity'];
const ROADMAP_STATUS_ORDER = ['Active', 'Developing', 'Planned'];

const ROADMAP_STATUS_BADGE = {
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Developing: 'bg-amber-50 text-amber-700 border-amber-200',
  Planned: 'bg-slate-50 text-slate-600 border-slate-200',
};

export const isRoadmapAppNavigable = (app) =>
  (app.devStatus || 'Active') === 'Active' && app.hasPage;

export const RoadmapModal = ({ isOpen, onClose, onSelectApp }) => {
  const { apps: catalogue } = useAppCatalogue();
  const totalCount = catalogue.length;
  const statusCounts = catalogue.reduce((acc, app) => {
    const status = app.devStatus || 'Active';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const modeSummaries = ROADMAP_MODE_ORDER
    .map(mode => {
      const apps = catalogue.filter(a => a.mode === mode);
      const categories = new Set(apps.map(a => a.category));
      return {
        mode,
        apps,
        categories,
        info: MODE_BADGE[mode] || MODE_BADGE.File,
        activeCount: apps.filter(a => (a.devStatus || 'Active') === 'Active').length,
        developingCount: apps.filter(a => a.devStatus === 'Developing').length,
      };
    })
    .filter(item => item.apps.length > 0);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-7xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: '#F0F3FA' }}>
            {/* 헤더 */}
            <div className="bg-brand-blue px-5 py-4 flex justify-between items-center text-white shrink-0">
              <div>
                <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                  <Map size={20} className="text-blue-300"/> HiTESS 워크벤치 로드맵
                </Dialog.Title>
                <p className="text-xs text-blue-100 mt-1">업무 유형, 서비스 상태, 앱 목적을 한 번에 훑어볼 수 있는 전체 지도입니다.</p>
              </div>
              <button onClick={onClose} className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"><X size={20}/></button>
            </div>

            {/* 읽는 순서: 전체 요약 → 상태 범례 → 업무 유형 바로가기 */}
            <div className="px-5 py-4 border-b border-slate-200 bg-white shrink-0">
              <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-bold text-slate-500 mb-1">전체 구조</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-black text-slate-900 leading-none">{totalCount}</span>
                    <span className="pb-1 text-sm font-bold text-slate-600">개 앱 · {modeSummaries.length}개 업무 유형</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    먼저 서비스 중 앱을 확인하고, 필요한 업무 유형을 선택해 세부 앱 설명을 비교하세요.
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-bold text-slate-500 mb-2">상태 범례</p>
                    <div className="grid grid-cols-3 gap-2">
                      {ROADMAP_STATUS_ORDER.map(key => {
                        const style = STATUS_GROUP_STYLE[key];
                        const Icon = style.icon;
                        return (
                          <div key={key} className={`rounded-lg border px-3 py-2 ${style.bg}`}>
                            <div className={`flex items-center gap-1.5 text-[11px] font-bold ${style.text}`}>
                              <Icon size={12} />
                              {style.label}
                            </div>
                            <p className="mt-1 text-lg font-black text-slate-900">{statusCounts[key] || 0}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-bold text-slate-500 mb-2">업무 유형 바로가기</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {modeSummaries.map(({ mode, apps, info, activeCount, developingCount }) => (
                        <a
                          key={mode}
                          href={`#roadmap-mode-${mode}`}
                          className={`rounded-lg border px-3 py-2 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${info.cls}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[11px] truncate">{info.title}</span>
                            <span className="text-[11px] font-black">{apps.length}</span>
                          </div>
                          <p className="mt-1 text-[10px] font-semibold opacity-80">운영 {activeCount} · 개발 {developingCount}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar space-y-4 scroll-smooth">
              {modeSummaries.map(({ mode, apps, categories, info: modeInfo, activeCount, developingCount }) => {
                const FirstIcon = apps[0].icon;
                const sortedApps = [...apps].sort((a, b) => {
                  const statusA = ROADMAP_STATUS_ORDER.indexOf(a.devStatus || 'Active');
                  const statusB = ROADMAP_STATUS_ORDER.indexOf(b.devStatus || 'Active');
                  if (statusA !== statusB) return statusA - statusB;
                  return a.title.localeCompare(b.title);
                });

                return (
                  <section id={`roadmap-mode-${mode}`} key={mode} className="scroll-mt-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3">
                      <div className={`p-2 rounded-lg ${modeInfo.iconBg} text-white shadow-sm shrink-0`}>
                        <FirstIcon size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-extrabold text-slate-800">{modeInfo.title}</h3>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${modeInfo.cls}`}>
                            {modeInfo.label}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-white text-slate-500 border-slate-200">
                            앱 {apps.length}개 · 카테고리 {categories.size}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{modeInfo.summary}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <span className="px-2 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">서비스 {activeCount}</span>
                        {developingCount > 0 && (
                          <span className="px-2 py-1 text-[10px] font-bold rounded-full bg-slate-50 text-slate-500 border border-slate-200">개발 {developingCount}</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                      {sortedApps.map((app) => {
                        const status = app.devStatus || 'Active';
                        const isDeveloping = status === 'Developing';
                        const statusStyle = STATUS_GROUP_STYLE[status] || STATUS_GROUP_STYLE.Planned;
                        const canNavigate = isRoadmapAppNavigable(app);
                        const AppIcon = app.icon;
                        return (
                          <button
                            type="button"
                            key={app.title}
                            disabled={!canNavigate}
                            title={canNavigate ? `${app.title} 열기` : `${app.title}은 현재 바로가기를 지원하지 않습니다.`}
                            onClick={() => canNavigate && onSelectApp?.(app)}
                            className={`relative text-left rounded-lg px-3.5 py-3 transition-all border group overflow-hidden min-h-[138px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
                              canNavigate
                                ? 'bg-white border-slate-200 shadow-sm cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-blue-300 hover:bg-blue-50/30'
                                : isDeveloping
                                  ? 'bg-slate-50/70 border-slate-200 shadow-none opacity-80 cursor-default hover:border-amber-200 hover:bg-amber-50/30'
                                  : 'bg-slate-50/70 border-slate-200 shadow-none opacity-80 cursor-default hover:border-slate-300 hover:bg-slate-100/60'
                            }`}
                          >
                            <div className={`absolute -right-4 -bottom-4 pointer-events-none ${isDeveloping ? 'opacity-[0.025]' : 'opacity-[0.035]'}`}>
                              <AppIcon size={58} />
                            </div>

                            <div className="relative flex items-start gap-2">
                              <div className={`p-1.5 text-white rounded-md transition-transform shrink-0 ${
                                isDeveloping
                                  ? 'bg-slate-300 shadow-sm'
                                  : `${app.color} shadow-md group-hover:scale-105`
                              }`}>
                                <AppIcon size={15} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ROADMAP_STATUS_DOT[status] || ROADMAP_STATUS_DOT.Planned}`} />
                                  <span className="text-[10px] font-bold text-slate-500 truncate">{app.category}</span>
                                </div>
                                <h4 className="font-bold text-slate-800 text-[13px] leading-snug line-clamp-2">{app.title}</h4>
                              </div>
                            </div>

                            <p className="relative mt-2 text-[11px] leading-relaxed text-slate-600 line-clamp-2">
                              {app.description}
                            </p>

                            <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${ROADMAP_STATUS_BADGE[status] || ROADMAP_STATUS_BADGE.Planned}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                                {statusStyle.label}
                              </span>
                              {canNavigate && (
                                <span className="text-[10px] text-blue-600 font-bold bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                  바로가기
                                </span>
                              )}
                              {(app.relatedApps?.length > 0 || app.acceptsTransferFrom?.length > 0) && (
                                <span className="text-[10px] text-indigo-500 font-bold bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                  연계
                                </span>
                              )}
                            </div>

                            <div className="relative mt-2 flex items-center justify-between gap-2">
                              <div className="flex flex-wrap gap-1 overflow-hidden">
                                {(app.tags || []).slice(0, 3).map(tag => (
                                  <span key={tag} className="text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              {app.contributor && (
                                <span className="text-[10px] font-bold text-slate-500 shrink-0">{app.contributor}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
};

export function IntroModal({ isOpen, onClose, src }) {
  const iframeRef = useRef(null);
  const [loadState, setLoadState] = useState('idle');
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setLoadState('idle');
      setLoadError('');
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setLoadState('loading');
    setLoadError('');

    const timeoutId = window.setTimeout(() => {
      if (!active) return;
      controller.abort();
      setLoadError('서버 응답 시간이 초과되었습니다.');
      setLoadState('error');
    }, 15000);

    const verifyPresentation = async () => {
      try {
        const response = await fetch(src, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
          throw new Error('HTML 응답이 아닙니다.');
        }
        const html = await response.text();
        if (!html.trim()) {
          throw new Error('소개자료가 비어 있습니다.');
        }
        if (active) setLoadState('frame-loading');
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        console.error('소개자료 확인 실패:', error);
        setLoadError(error?.message?.startsWith('HTTP ')
          ? `서버가 소개자료를 제공하지 못했습니다. (${error.message})`
          : '서버에서 소개자료를 불러오지 못했습니다.');
        setLoadState('error');
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    verifyPresentation();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen, retryKey, src]);

  useEffect(() => {
    if (!isOpen || loadState !== 'frame-loading') return undefined;
    const timeoutId = window.setTimeout(() => {
      setLoadError('소개자료 화면을 여는 데 시간이 너무 오래 걸립니다.');
      setLoadState('error');
    }, 15000);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, loadState]);

  const handleFullscreen = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
  };

  const retry = () => setRetryKey(value => value + 1);
  const canRenderFrame = loadState === 'frame-loading' || loadState === 'ready';

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-250" enterFrom="opacity-0 scale-95 translate-y-4" enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-6xl bg-brand-blue rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              style={{ height: 'min(90vh, 860px)' }}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0"
                style={{ background: 'linear-gradient(90deg, #00305c 0%, #002554 70%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 border border-white/15">
                    <Layers size={18} className="text-blue-200" />
                  </div>
                  <div>
                    <Dialog.Title className="text-white font-bold text-sm leading-tight">
                      HiTESS WorkBench 소개
                    </Dialog.Title>
                    <p className="text-slate-300 text-[11px]">통합 해석 플랫폼 런칭 자료</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleFullscreen}
                    title="소개자료 전체화면"
                    aria-label="소개자료 전체화면"
                    disabled={!canRenderFrame}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    title="소개자료 닫기"
                    aria-label="소개자료 닫기"
                    className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* iframe 본문 */}
              <div className="relative flex-1 overflow-hidden bg-[#E8EDF5]">
                {canRenderFrame && (
                  <iframe
                    key={retryKey}
                    ref={iframeRef}
                    className={`h-full w-full border-0 transition-opacity duration-200 ${loadState === 'ready' ? 'opacity-100' : 'opacity-0'}`}
                    src={src}
                    title="HiTESS WorkBench 소개"
                    sandbox="allow-scripts"
                    allowFullScreen
                    onLoad={() => {
                      setLoadState('ready');
                      iframeRef.current?.focus();
                    }}
                    onError={() => {
                      setLoadError('소개자료 화면을 열지 못했습니다.');
                      setLoadState('error');
                    }}
                  />
                )}

                {loadState !== 'ready' && (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    {loadState === 'error' ? (
                      <div className="flex max-w-lg flex-col items-center gap-3 text-center" role="alert">
                        <div className="rounded-full border border-red-200 bg-red-50 p-3">
                          <Server size={28} className="text-red-600" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">소개자료를 불러올 수 없습니다.</p>
                          <p className="mt-1 text-xs text-slate-600">{loadError}</p>
                          <p className="mt-2 break-all font-mono text-[11px] text-slate-500">서버: {API_BASE_URL}</p>
                        </div>
                        <Button type="button" variant="primary" size="sm" onClick={retry}>
                          다시 시도
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-bold text-slate-700">소개자료를 불러오는 중입니다.</p>
                          <p className="mt-1 font-mono text-[11px] text-slate-500">{API_BASE_URL}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
