/// <summary>
/// 메인 대시보드 UI 컴포넌트입니다.
/// (수정) 즐겨찾기에서 Truss Assessment 진입 시 글로벌 상태를 초기화하는 로직 추가
/// </summary>
import React, { Suspense, lazy, useState, useEffect, useRef, Fragment } from 'react';
import { motion } from 'framer-motion';
import { Dialog, Transition } from '@headlessui/react';
import { getQueueStatus, getNotices } from '../../api/admin';
import { getAnalysisHistory, getTopPrograms, getMonthlyAnalysisCount } from '../../api/analysis';
import {
  Activity, FileText, Server,
  ArrowUpRight, Star, CalendarDays, Database, Map, Rocket,
  Wrench, Clock, X, ChevronRight, ChevronDown, Layers, Cpu, Maximize2, Trophy, SlidersHorizontal,
  Megaphone, Pin, Sparkles, Play, GripVertical, ArrowLeft, ArrowRight, Check
} from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { ANALYSIS_DATA, findAppByProgramName, getAppMenuName, useAnalysisPageState, useFavorites } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { POLLING_POLICY } from '../../hooks/pollingPolicy';
import { NOTICE_TYPE_STYLE } from '../../components/modals/noticeTypeStyle';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DashboardFab from '../../components/DashboardFab';
const AdminGateModal = lazy(() => import('../../components/ui/AdminGateModal'));
const NoticeDetailModal = lazy(() => import('../../components/modals/NoticeDetailModal'));
const NewsletterArchiveModal = lazy(() => import('../../components/NewsletterArchiveModal'));

const MODE_KO = {
  File: "File-Based Apps",
  Interactive: "Interactive Apps",
  Parametric: "Parametric Apps",
  Productivity: "Productivity Apps"
};

const DASHBOARD_CARD_BASE = "relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-colors group";

const EngineeringStatCard = ({ title, value, subtext, icon: Icon, color, onClick }) => {
  const isClickable = typeof onClick === 'function';
  return (
    <motion.div
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`${DASHBOARD_CARD_BASE} min-h-[112px] p-4 xl:p-5 flex items-start justify-between ${
        isClickable ? 'hover:border-blue-300 cursor-pointer' : ''
      }`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={isClickable ? { y: -1, transition: { type: 'spring', stiffness: 350, damping: 28 } } : undefined}
    >
      {isClickable && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500">
          <ArrowUpRight size={16} />
        </div>
      )}
      <div>
        <h3 className={`text-slate-600 text-sm font-bold tracking-tight transition-colors ${isClickable ? 'group-hover:text-blue-600' : ''}`}>
          {title}
        </h3>
        <div className="mt-2 flex items-center space-x-2 mb-1">
          <span className="text-2xl font-extrabold text-slate-800 tracking-tight">{value}</span>
        </div>
        <p className="text-xs font-medium text-slate-500">{subtext}</p>
      </div>
      <div className={`p-2.5 rounded-lg ${color} shadow-sm transition-transform`}>
        <Icon size={20} className="text-white" />
      </div>
    </motion.div>
  );
};

const FavoriteCard = ({
  title,
  icon: Icon,
  color,
  desc,
  onClick,
  onFavoriteRemove,
  isEditing,
  position,
  total,
  onMoveLeft,
  onMoveRight,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
}) => (
  <motion.div
    draggable={isEditing}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDrop={onDrop}
    className={`flex min-h-[104px] w-full flex-col items-start p-3.5 bg-white rounded-xl border shadow-sm group text-left h-full relative overflow-hidden transition-colors ${
      isEditing
        ? 'border-blue-300 ring-1 ring-blue-100 cursor-grab active:cursor-grabbing'
        : 'border-slate-200 hover:border-blue-300'
    } ${isDragging ? 'opacity-45' : 'opacity-100'}`}
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, ease: 'easeOut' }}
    whileHover={!isEditing ? {
      y: -1,
      boxShadow: '0 6px 16px -12px rgba(0, 37, 84, 0.18)',
      transition: { type: 'spring', stiffness: 380, damping: 28 },
    } : undefined}
  >
    {isEditing ? (
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={position === 0}
          aria-label={`${title} 왼쪽으로 이동`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={position === total - 1}
          aria-label={`${title} 오른쪽으로 이동`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowRight size={14} />
        </button>
        <GripVertical size={16} className="ml-1 text-slate-400" aria-hidden="true" />
      </div>
    ) : (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onFavoriteRemove?.();
        }}
        aria-label={`${title} 즐겨찾기 해제`}
        title="즐겨찾기 해제"
        className="group/star absolute top-2.5 right-2.5 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg text-amber-400 opacity-75 transition-all hover:bg-amber-50 hover:text-amber-500 hover:opacity-100 hover:ring-1 hover:ring-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1"
      >
        <Star size={16} fill="currentColor" className="transition-transform group-hover/star:scale-110" />
      </button>
    )}
    <div className={`mb-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg ${color} text-white shadow-sm`}>
      <Icon size={17} />
    </div>
    <h3 className="font-bold text-slate-800 text-sm leading-snug pr-6 line-clamp-1">{title}</h3>
    <p
      className="text-xs text-slate-500 mt-1 max-w-full leading-relaxed overflow-hidden"
      style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}
    >
      {desc}
    </p>
    {isEditing ? (
      <span className="mt-auto pt-3 text-[11px] font-semibold text-blue-700">
        {position + 1} / {total} · 드래그하여 이동
      </span>
    ) : (
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
        aria-label={`${title} 열기`}
      />
    )}
  </motion.div>
);

const QueueStatusCard = React.memo(function QueueStatusCard() {
  const [queueStatus, setQueueStatus] = useState({ running: 0, pending: 0, limit: 2 });
  const [isBackendConnected, setIsBackendConnected] = useState(false);

  useEffect(() => {
    const fetchQueue = async () => {
      if (document.hidden) return;
      try {
        const res = await getQueueStatus();
        setQueueStatus(res.data);
        setIsBackendConnected(true);
      } catch (error) {
        console.error("Queue Status fetch error", error);
        setIsBackendConnected(false);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, POLLING_POLICY.systemIntervalMs);
    const onVisible = () => { if (!document.hidden) fetchQueue(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const usageRatio = queueStatus.limit > 0 ? (queueStatus.running / queueStatus.limit) * 100 : 0;

  return (
    <div className={`${DASHBOARD_CARD_BASE} min-h-[112px] p-4 xl:p-5 border-blue-200 bg-blue-50/45 hover:border-blue-300`}>
      <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Server size={100} />
      </div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-slate-600 text-sm font-bold tracking-tight flex items-center gap-2">
          <Activity size={16} className="text-blue-500" /> 해석 서버 부하 현황
        </h3>
        {isBackendConnected ? (
          <span className="inline-flex items-center text-[10px] font-bold text-emerald-700" title="백엔드 서버와 정상적으로 연결되어 있습니다.">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1 animate-pulse"></span>
            온라인
          </span>
        ) : (
          <span className="inline-flex items-center text-[10px] font-bold text-red-700" title="백엔드 서버 연결이 끊겼습니다.">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full mr-1"></span>
            오프라인
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 font-bold mb-2">현재 서버 구동 현황</p>
      <div className="text-2xl font-extrabold text-slate-800 tracking-tight mb-2">
        {queueStatus.running} <span className="text-sm text-slate-500 font-medium">/ {queueStatus.limit} 구동 중</span>
      </div>
      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-500 ${queueStatus.running >= queueStatus.limit ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${usageRatio}%` }}
        ></div>
      </div>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
        <Activity size={14} className={queueStatus.pending > 0 ? "text-orange-500" : "text-slate-500"} />
        대기 중인 큐: <span className={queueStatus.pending > 0 ? "text-orange-600" : "text-slate-500"}>{queueStatus.pending} 건</span>
      </div>
    </div>
  );
});

// 공유 Badge 컴포넌트에 매핑(자체 구현 제거 — bg-emerald-100 등 드리프트 해소)
const STATUS_BADGE = {
  Success: { variant: 'success', label: '해석 완료' },
  Failed:  { variant: 'error',   label: '해석 실패' },
  Pending: { variant: 'neutral', label: '대기 중' },
};

const ProjectRow = ({ id, name, type, status, date, className = '' }) => {
  const s = STATUS_BADGE[status] || { variant: 'neutral', label: status || '대기 중' };
  return (
    <tr className={`border-b border-gray-50 last:border-0 hover:bg-slate-50/60 transition-colors ${className}`}>
      <td className="py-2 px-3 font-mono text-xs text-slate-500 text-center">{id}</td>
      <td className="py-2 px-3">
        <div className="flex items-center">
          <FileText size={16} className="text-slate-500 mr-2" />
          <span className="font-bold text-sm text-slate-700">
            {name || '이름 없는 프로젝트'}
          </span>
        </div>
      </td>
      <td className="py-2 px-3 text-xs text-slate-500 font-mono">
        <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">{type}</span>
      </td>
      <td className="py-2 px-3">
        <Badge variant={s.variant} size="sm" dot>{s.label}</Badge>
      </td>
      <td className="py-2 px-3 text-xs text-slate-500 text-right">{new Date(date).toLocaleString()}</td>
    </tr>
  );
};

// 소개 배너 테마. 색 난립을 피하기 위해 둘 다 네이비 기조로 통일하고,
// platform/workbench 구분은 아이콘·제목으로만 전달한다(Restrained 원칙).
const BANNER_THEMES = {
  platform: {
    gradient: 'linear-gradient(135deg, #00305c 0%, #002554 60%, #001b3d 100%)',
    DecorIcon: Layers,
    decorIconClass: 'text-white/5',
    bgOverlay: 'bg-gradient-to-r from-white/[0.04] via-transparent to-transparent',
    iconBg: 'bg-white/10 border-white/15 group-hover:bg-white/20',
    iconColor: 'text-blue-200',
    ctaColor: 'text-blue-200 group-hover:text-white',
    subtitleColor: 'text-slate-200',
  },
  workbench: {
    gradient: 'linear-gradient(135deg, #14233f 0%, #0f1b34 60%, #0b1428 100%)',
    DecorIcon: Cpu,
    decorIconClass: 'text-white/5',
    bgOverlay: 'bg-gradient-to-r from-white/[0.04] via-transparent to-transparent',
    iconBg: 'bg-white/10 border-white/15 group-hover:bg-white/20',
    iconColor: 'text-slate-200',
    ctaColor: 'text-slate-200 group-hover:text-white',
    subtitleColor: 'text-slate-200',
  },
};

const DiscoverHiTessBanner = ({ variant = 'platform', title, subtitle, ctaText, MainIcon = Layers, onClick }) => {
  const t = BANNER_THEMES[variant];
  return (
    <motion.div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="relative rounded-xl overflow-hidden cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
      style={{ background: t.gradient }}
      whileHover={{ y: -2, transition: { type: 'spring', stiffness: 350, damping: 28 } }}
    >
      {/* 배경 장식 (좌측 컬러 스트라이프 제거 — 절제된 네이비 카드) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <t.DecorIcon size={120} className={`absolute -right-6 -bottom-6 ${t.decorIconClass} rotate-12`} />
        <div className={`absolute inset-0 ${t.bgOverlay}`} />
      </div>

      <div className="relative z-10 flex flex-row items-center gap-3 px-4 py-2.5">
        {/* 아이콘 */}
        <div className={`p-2 rounded-lg border group-hover:scale-110 transition-all shadow-md shrink-0 ${t.iconBg}`}>
          <MainIcon size={18} className={t.iconColor} />
        </div>

        {/* 타이틀 (eyebrow 라벨 제거 — 제목·부제만으로 충분) */}
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-bold text-sm tracking-tight leading-tight truncate">
            {title}
          </h3>
          <p className={`${t.subtitleColor} text-[11px] truncate`}>
            {subtitle}
          </p>
        </div>

        {/* CTA 화살표 */}
        <div className={`flex items-center gap-1 font-semibold text-xs shrink-0 transition-colors ${t.ctaColor}`}>
          <span className="hidden lg:block whitespace-nowrap">{ctaText}</span>
          <ChevronRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
};

const AppRoadmapBanner = ({ onOpenModal }) => {
  const statusCounts = ANALYSIS_DATA.reduce((acc, app) => {
    const status = app.devStatus || 'Active';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const activeCount = statusCounts.Active || 0;
  const devCount = statusCounts.Developing || 0;
  const plannedCount = statusCounts.Planned || 0;
  const modeSummary = ROADMAP_MODE_ORDER
    .map(mode => ({
      mode,
      info: MODE_BADGE[mode],
      apps: ANALYSIS_DATA.filter(a => a.mode === mode),
    }))
    .filter(item => item.apps.length > 0);

  return (
    <div
      onClick={onOpenModal}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenModal(); } }}
      className="bg-gradient-to-r from-brand-blue to-slate-900 rounded-xl shadow-sm border border-white/10 overflow-hidden cursor-pointer hover:shadow-md transition-all group flex flex-col lg:flex-row lg:min-h-[78px] relative focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
    >
      <Map size={96} className="absolute -left-8 -bottom-9 text-white/5 rotate-12 pointer-events-none" />
      <div className="px-4 py-3 lg:w-[310px] border-b lg:border-b-0 lg:border-r border-white/10 relative z-10 flex flex-col justify-center">
        <h3 className="text-white font-bold text-sm flex items-center gap-2 mb-2">
          <Map size={15} className="text-blue-300"/> 시스템 해석 앱 로드맵
        </h3>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <span className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5">
            <span className="text-sm font-black text-white leading-none">{activeCount}</span>
            <span className="text-[10px] font-bold text-emerald-200">서비스</span>
          </span>
          <span className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5">
            <span className="text-sm font-black text-white leading-none">{devCount}</span>
            <span className="text-[10px] font-bold text-amber-100">개발</span>
          </span>
          <span className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.08] px-2 py-1.5">
            <span className="text-sm font-black text-white leading-none">{plannedCount}</span>
            <span className="text-[10px] font-bold text-slate-200">예정</span>
          </span>
        </div>
      </div>
      <div className="px-3.5 py-3 lg:flex-1 relative overflow-hidden flex flex-col justify-center gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 items-stretch gap-2 pr-0 lg:pr-28">
          {modeSummary.map(({ mode, info, apps }) => {
            const modeActive = apps.filter(a => (a.devStatus || 'Active') === 'Active').length;
            const modeDev = apps.filter(a => a.devStatus === 'Developing').length;
            return (
            <div key={mode} className="rounded-lg border border-white/15 bg-white/[0.075] px-3 py-2 min-h-[54px] min-w-0 h-full flex flex-col justify-center transition-colors group-hover:border-white/20 group-hover:bg-white/[0.11]">
              <p className="text-[11px] font-bold text-blue-50 truncate">{(MODE_KO[mode] || info.label).replace(/ Apps$/, '')}</p>
              <div className="mt-1 flex items-end justify-between gap-2">
                <p className="text-white text-base font-black leading-none">{apps.length}</p>
                <p className="text-[10px] font-semibold text-slate-200 whitespace-nowrap">
                  운영 <span className="font-extrabold text-emerald-300">{modeActive}</span>
                  <span className="mx-0.5 text-slate-500">·</span>
                  개발 <span className="font-extrabold text-amber-200">{modeDev}</span>
                </p>
              </div>
            </div>
            );
          })}
        </div>
        <div className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1 text-[11px] font-bold text-blue-100 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 group-hover:bg-white/[0.16] group-hover:text-white transition-colors">
          지도 열기 <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform"/>
        </div>
      </div>
    </div>
  );
};

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
const VideoPlayerModal = ({ isOpen, onClose }) => {
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

const NoticeStrip = ({ onOpenDetail, onOpenList }) => {
  const [notices, setNotices] = useState([]);
  const [lastSeenId, setLastSeenId] = useState(0);

  useEffect(() => {
    getNotices()
      .then(res => {
        const data = Array.isArray(res.data) ? res.data : [];
        const sorted = [...data].sort((a, b) => {
          if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.created_at) - new Date(a.created_at);
        });
        setNotices(sorted.slice(0, 5));
      })
      .catch(() => {});
    const seen = parseInt(localStorage.getItem('notice_last_seen_id') || '0', 10);
    if (Number.isFinite(seen)) setLastSeenId(seen);
  }, []);

  if (notices.length === 0) return null;

  const unreadCount = notices.filter(n => Number(n.id) > lastSeenId).length;
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

const isRoadmapAppNavigable = (app) =>
  (app.devStatus || 'Active') === 'Active' && app.hasPage;

const RoadmapModal = ({ isOpen, onClose, onSelectApp }) => {
  const totalCount = ANALYSIS_DATA.length;
  const statusCounts = ANALYSIS_DATA.reduce((acc, app) => {
    const status = app.devStatus || 'Active';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const modeSummaries = ROADMAP_MODE_ORDER
    .map(mode => {
      const apps = ANALYSIS_DATA.filter(a => a.mode === mode);
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
function IntroModal({ isOpen, onClose, content, onRetry, modalTitle = 'Discover HiTESS', modalSubtitle = '차세대 조선해양 구조 해석 플랫폼 소개' }) {
  const iframeRef = useRef(null);

  // 슬라이드 전환 시 history.pushState → Electron이 iframe에 blur 발생시키는 문제 대응
  useEffect(() => {
    if (!isOpen || !content) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleBlur = () => {
      requestAnimationFrame(() => {
        if (document.contains(iframe)) iframe.focus();
      });
    };

    iframe.addEventListener('blur', handleBlur);
    return () => iframe.removeEventListener('blur', handleBlur);
  }, [isOpen, content]);

  const handleFullscreen = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
  };

  const iframeProps = {
    ref: iframeRef,
    className: 'w-full h-full border-0',
    title: 'Discover HiTESS',
    onLoad: e => e.target.focus(),
  };

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
                      {modalTitle}
                    </Dialog.Title>
                    <p className="text-slate-300 text-[11px]">{modalSubtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleFullscreen}
                    title="전체화면 (F)"
                    className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <button
                    onClick={onClose}
                    className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* iframe 본문 */}
              <div className="flex-1 overflow-hidden bg-[#E8EDF5]">
                {content ? (
                  content.mode === 'srcdoc'
                    ? <iframe {...iframeProps} srcdoc={content.value} sandbox="allow-scripts allow-same-origin" allowFullScreen />
                    : <iframe {...iframeProps} src={content.value} allowFullScreen />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                    <Layers size={48} className="text-slate-300" />
                    <p className="text-sm font-bold">소개 페이지를 불러올 수 없습니다.</p>
                    <p className="text-xs text-slate-500">Electron 앱을 재시작한 후 다시 시도해 주세요.</p>
                    <button
                      onClick={onRetry}
                      className="mt-1 px-4 py-2 bg-brand-blue text-white text-xs font-bold rounded-lg hover:bg-brand-blue-dark transition-colors cursor-pointer"
                    >
                      다시 시도
                    </button>
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

export default function Dashboard() {
  const { showToast } = useToast();
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const { favorites, toggleFavorite, reorderFavorite } = useFavorites();
  const { recentApps, clearRecentApps } = useRecentActivity();
  const { setAssessmentPageState } = useAnalysisPageState();

  const [projects, setProjects] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [monthlyUsageCount, setMonthlyUsageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [topProgramsLoading, setTopProgramsLoading] = useState(true);
  const [topProgramsError, setTopProgramsError] = useState(null);

  const [isRoadmapModalOpen, setIsRoadmapModalOpen] = useState(false);
  const [gateApp, setGateApp] = useState(null); // 개발 중/예정 앱 진입 차단 모달
  const [isIntroModalOpen, setIsIntroModalOpen] = useState(false);
  // 홍보영상 플레이어 모달 — 열릴 때만 <video>가 DOM에 마운트됨
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  // 뉴스레터 아카이브 모달
  const [isNewsletterModalOpen, setIsNewsletterModalOpen] = useState(false);
  const [topPrograms30, setTopPrograms30] = useState([]);
  const [topProgramsAll, setTopProgramsAll] = useState([]);
  const [activeTopProgramsTab, setActiveTopProgramsTab] = useState('30d');
  const [isTopProgramsModalOpen, setIsTopProgramsModalOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [isNoticeDetailOpen, setIsNoticeDetailOpen] = useState(false);
  const [isEditingFavorites, setIsEditingFavorites] = useState(false);
  const [draggedFavorite, setDraggedFavorite] = useState(null);
  // { mode: 'srcdoc', value: htmlString } | { mode: 'src', value: url } | null
  const [introContent, setIntroContent] = useState(null);
  const [introTarget, setIntroTarget] = useState('platform');
  // target별 로드된 콘텐츠 캐시 (재열람 시 재요청 방지)
  const introCache = useRef({});

  // 플랫폼 소개 배너: 기본적으로 접어둔다(매일 쓰는 사용자 우선). 사용자가 펼치면 그 선호를 저장해 다음 방문에 반영.
  const [introOpen, setIntroOpen] = useState(() => localStorage.getItem('dashboard_intro_open') === '1');
  const toggleIntro = () => setIntroOpen(v => {
    const next = !v;
    localStorage.setItem('dashboard_intro_open', next ? '1' : '0');
    return next;
  });

  const handleDiscoverHiTess = async (target) => {
    setIsIntroModalOpen(true);
    setIntroTarget(target);
    // 캐시 히트 시 즉시 표시
    if (introCache.current[target]) {
      setIntroContent(introCache.current[target]);
      return;
    }
    setIntroContent(null);
    try {
      if (window.electron) {
        // Electron: 파일을 문자열로 읽어 srcdoc 주입 (file:// iframe 보안 우회)
        let html = await window.electron.invoke('get-intro-page-html', target);
        if (html) {
          // srcdoc iframe은 opaque origin → history.pushState가 SecurityError를 발생시켜
          // _goSlide()의 cleanup 코드가 전혀 실행되지 않고 isAnimating이 영구 고정됨.
          // pushState 호출을 try-catch로 감싸서 예외가 스크립트 실행을 중단하지 않도록 차단.
          html = html.replace(
            "if (location.hash !== h) history.pushState(null, '', h);",
            "try { history.pushState(null, '', h); } catch(e) {}"
          );
          const content = { mode: 'srcdoc', value: html };
          introCache.current[target] = content;
          setIntroContent(content);
        }
      } else {
        // 웹: Vite 플러그인이 서빙하는 경로 사용.
        //   'platform'  → hitess-introduction.html (Discover HiTESS)
        //   'workbench' → hitess-platform.html     (HiTESS WorkBench)
        const fileName = target === 'workbench' ? 'hitess-platform.html' : 'hitess-introduction.html';
        const content = { mode: 'src', value: `/IntroductionPage/${fileName}` };
        introCache.current[target] = content;
        setIntroContent(content);
      }
    } catch (err) {
      console.error('소개 페이지 로드 실패:', err);
    }
  };

  const fetchTopProgramStats = async () => {
    setTopProgramsLoading(true);
    setTopProgramsError(null);
    try {
      const [recentRes, allRes] = await Promise.all([
        getTopPrograms(30, 5),
        getTopPrograms(0, 10),
      ]);
      setTopPrograms30(Array.isArray(recentRes.data) ? recentRes.data : []);
      setTopProgramsAll(Array.isArray(allRes.data) ? allRes.data : []);
    } catch (error) {
      console.error('인기 프로그램 집계 불러오기 실패:', error);
      setTopProgramsError('인기 프로그램 집계를 불러오지 못했습니다.');
      setTopPrograms30([]);
      setTopProgramsAll([]);
    } finally {
      setTopProgramsLoading(false);
    }
  };

  useEffect(() => {
    fetchTopProgramStats();
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setHistoryError(null);
      try {
        if (!employeeId) return;

        const now = new Date();
        const [historyRes, monthlyRes] = await Promise.all([
          getAnalysisHistory(employeeId, 0, 5),
          getMonthlyAnalysisCount(employeeId, now.getFullYear(), now.getMonth() + 1),
        ]);

        const rawData = historyRes.data?.items ?? historyRes.data;
        setProjects(rawData);
        setTotalCount(historyRes.data?.total ?? rawData.length);
        setMonthlyUsageCount(monthlyRes.data?.count ?? 0);
      } catch (error) {
        console.error("이력 불러오기 실패:", error);
        setHistoryError('프로젝트 이력 데이터를 불러오지 못했습니다.');
        setProjects([]);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [employeeId, historyRefreshToken]);

  const totalExecutions = totalCount;

  // 즐겨찾기 카드 진입 로직.
  // AppCataloguePage.handleStart 와 동일한 데이터 기반 규칙을 사용한다.
  // (기존에는 title 하드코딩 switch 라서 목록에 없던 Active 앱 —
  //  HiTESS Model Builder, HP-SCR, F06 Parser, Mooring Fitting 등 — 이
  //  전부 '준비 중' 으로 잘못 막혔다.)
  const handleFavoriteClick = (title) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === title);
    if (!appMeta) {
      showToast(`'${title}' 앱 정보를 찾을 수 없습니다.`, 'info');
      return;
    }
    // 개발 중/예정 앱은 관리자가 아니면 안내 모달로 차단
    if ((appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    const menuName = getAppMenuName(title);
    // 실제 페이지가 등록된 앱(hasPage)은 진입 허용. 페이지가 없는 미구현 앱만 '준비 중' 안내.
    if (!appMeta.hasPage && appMeta.devStatus && appMeta.devStatus !== 'Active') {
      showToast(`'${title}' 앱은 현재 준비 중입니다.`, 'info');
      return;
    }
    // Truss Structural Assessment 는 진입 시 이전 글로벌 상태를 초기화한다.
    if (title === 'Truss Structural Assessment' && setAssessmentPageState) {
      setAssessmentPageState({});
    }
    setCurrentMenu(menuName);
  };

  const handleProgramShortcut = (programName) => {
    const appMeta =
      findAppByProgramName(programName) ||
      ANALYSIS_DATA.find(app => app.title === programName);

    if (!appMeta) {
      showToast(`'${programName}' 앱 정보를 찾을 수 없습니다.`, 'info');
      return;
    }

    handleFavoriteClick(appMeta.title);
  };

  const topProgramTabs = [
    { id: '30d', label: '최근 30일', rows: topPrograms30, emptyText: '최근 30일 사용 데이터가 없습니다.' },
    { id: 'all', label: '전체 기간', rows: topProgramsAll, emptyText: '전체 기간 사용 데이터가 없습니다.' },
  ];
  const activeTopProgramTab = topProgramTabs.find(tab => tab.id === activeTopProgramsTab) ?? topProgramTabs[0];
  const activeTopProgramRows = activeTopProgramTab.rows;
  const activeTopProgramMaxCount = activeTopProgramRows[0]?.count || 1;
  const activeTopProgramTotalCount = activeTopProgramRows.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const activeTopProgramTopShare = activeTopProgramTotalCount
    ? Math.round((activeTopProgramMaxCount / activeTopProgramTotalCount) * 100)
    : 0;

  const handleRoadmapAppSelect = (app) => {
    if (!isRoadmapAppNavigable(app)) return;
    setIsRoadmapModalOpen(false);
    handleFavoriteClick(app.title);
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3 overflow-hidden animate-fade-in-up xl:gap-4">

      <div className="shrink-0">
        <h1 className="text-2xl font-bold text-brand-blue tracking-tight">WorkBench Overview</h1>
        <p className="text-sm text-slate-500 mt-1">해석 서버 현황, 수행 통계, 즐겨찾기 앱을 한눈에 확인하세요.</p>
      </div>

      <RoadmapModal
        isOpen={isRoadmapModalOpen}
        onClose={() => setIsRoadmapModalOpen(false)}
        onSelectApp={handleRoadmapAppSelect}
      />

      {/* 즐겨찾기에서 개발 중/예정 앱 진입 시도 시 안내 (관리자는 위 로직에서 통과) */}
      <Suspense fallback={null}>
        <AdminGateModal
          isOpen={!!gateApp}
          onClose={() => setGateApp(null)}
          appTitle={gateApp?.title}
          devStatus={gateApp?.devStatus}
        />
      </Suspense>

      {/* ── 인기 프로그램 기간별 순위 모달 ── */}
      <Transition appear show={isTopProgramsModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsTopProgramsModalOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Trophy size={18} className="text-amber-500 shrink-0" />
                      <Dialog.Title className="text-base font-bold text-slate-800">인기 해석 프로그램</Dialog.Title>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-500">기간별 사용 순위를 비교하고 바로 앱으로 이동합니다.</p>
                  </div>
                  <button onClick={() => setIsTopProgramsModalOpen(false)} className="inline-flex items-center justify-center min-w-9 min-h-9 -mr-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
                    <X size={18} />
                  </button>
                </div>
                <div className="mb-4 grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {topProgramTabs.map(tab => {
                    const isActive = activeTopProgramsTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTopProgramsTab(tab.id)}
                        className={`min-h-8 rounded-md px-3 text-xs font-bold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${
                          isActive
                            ? 'bg-white text-amber-700 shadow-sm'
                            : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
                        }`}
                        aria-pressed={isActive}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-bold text-slate-400">집계 건수</p>
                    <p className="mt-0.5 text-sm font-black text-slate-700">{activeTopProgramTotalCount}건</p>
                  </div>
                  <div className="border-x border-slate-200 px-3 py-2">
                    <p className="text-[10px] font-bold text-slate-400">표시 앱</p>
                    <p className="mt-0.5 text-sm font-black text-slate-700">{activeTopProgramRows.length}개</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-bold text-slate-400">1위 점유율</p>
                    <p className="mt-0.5 text-sm font-black text-slate-700">{activeTopProgramTopShare}%</p>
                  </div>
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {topProgramsLoading ? (
                    <div className="space-y-2 py-2" role="status" aria-live="polite">
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
                      ))}
                    </div>
                  ) : topProgramsError ? (
                    <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-5 text-center">
                      <p className="text-sm font-bold text-red-700">{topProgramsError}</p>
                      <button
                        type="button"
                        onClick={fetchTopProgramStats}
                        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 cursor-pointer"
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : activeTopProgramRows.map((item, i) => {
                    return (
                      <button
                        key={item.program_name}
                        type="button"
                        onClick={() => handleProgramShortcut(item.program_name)}
                        className="w-full flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 px-1 rounded-lg hover:bg-blue-50/60 transition-colors text-left cursor-pointer"
                      >
                        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                          i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{item.program_name}</span>
                        <div className="w-20 bg-slate-100 rounded-full h-1.5 shrink-0">
                          <div
                            className="bg-blue-400 h-1.5 rounded-full"
                            style={{ width: `${(item.count / activeTopProgramMaxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-500 w-12 text-right shrink-0">{item.count}건</span>
                        <ChevronRight size={14} className="text-blue-500 shrink-0" />
                      </button>
                    );
                  })}
                  {!topProgramsLoading && !topProgramsError && activeTopProgramRows.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-8">{activeTopProgramTab.emptyText}</p>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
      <IntroModal
        isOpen={isIntroModalOpen}
        onClose={() => setIsIntroModalOpen(false)}
        content={introContent}
        onRetry={() => {
          delete introCache.current[introTarget];
          handleDiscoverHiTess(introTarget);
        }}
        modalTitle={introTarget === 'workbench' ? 'HiTESS WorkBench' : 'Discover HiTESS'}
        modalSubtitle={introTarget === 'workbench' ? 'HiTESS WorkBench 해석 플랫폼 소개' : '차세대 조선해양 구조 해석 플랫폼 소개'}
      />

      {/* HiTESS Story 플레이어 모달 */}
      <VideoPlayerModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
      />

      {/* 공지 & 업데이트 슬림 스트립 */}
      <NoticeStrip
        onOpenDetail={(n) => { setSelectedNotice(n); setIsNoticeDetailOpen(true); }}
        onOpenList={() => setCurrentMenu('Notice & Updates')}
      />
      <Suspense fallback={null}>
        <NoticeDetailModal
          isOpen={isNoticeDetailOpen}
          notice={selectedNotice}
          onClose={() => setIsNoticeDetailOpen(false)}
          primaryAction={{
            label: '전체 공지 보기',
            onClick: () => setCurrentMenu('Notice & Updates'),
            icon: <ChevronRight size={14} />,
          }}
        />
      </Suspense>

      {/* 플랫폼 소개 & 로드맵 */}
      <div className="shrink-0">
        <div className="mb-1.5 flex flex-wrap items-center justify-end gap-2">
            <DashboardFab
              onOpenVideo={() => setIsVideoModalOpen(true)}
              onOpenNewsletter={() => setIsNewsletterModalOpen(true)}
            />
            {/* 클릭 가능함을 명시하는 버튼형 칩 — 접힘이 기본, 누르면 소개가 펼쳐진다 */}
            <button
              type="button"
              onClick={toggleIntro}
              aria-expanded={introOpen}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-xs font-bold shadow-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${
                introOpen
                  ? 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
              }`}
            >
              {introOpen ? '소개 접기' : '소개 펼쳐보기'}
              <ChevronDown size={15} className={`transition-transform ${introOpen ? 'rotate-180' : ''}`} />
            </button>
        </div>
        <div className="flex flex-col gap-2">
          {/* 소개 배너 — 접이식(첫 방문만 펼침) */}
          {introOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <DiscoverHiTessBanner
                variant="platform"
                title="Discover HiTESS"
                subtitle="차세대 조선해양 구조 해석 플랫폼을 살펴보세요"
                ctaText="살펴보기"
                MainIcon={Layers}
                onClick={() => handleDiscoverHiTess('platform')}
              />
              <DiscoverHiTessBanner
                variant="workbench"
                title="HiTESS WorkBench"
                subtitle="해석 도구 모음과 생산성 도구를 경험해보세요"
                ctaText="살펴보기"
                MainIcon={Cpu}
                onClick={() => handleDiscoverHiTess('workbench')}
              />
            </div>
          )}
          <AppRoadmapBanner onOpenModal={() => setIsRoadmapModalOpen(true)} />
        </div>
      </div>

      {/* 서비스 현황 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold text-slate-700 flex items-center gap-2">
            <Activity size={15} className="text-blue-400" /> 서비스 현황
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 xl:gap-4">
        <QueueStatusCard />

        <EngineeringStatCard
          title="월간 해석 수행 건수"
          value={`${monthlyUsageCount} 건`}
          subtext="이번 달 실행된 전체 프로젝트"
          icon={CalendarDays}
          color="bg-brand-blue"
        />
        <EngineeringStatCard
          title="누적 해석 수행 건수"
          value={`${totalExecutions} 건`}
          subtext="지금까지 실행된 총 프로젝트 내역"
          icon={Database}
          color="bg-brand-blue"
        />
        <div
          className={`${DASHBOARD_CARD_BASE} min-h-[112px] p-4 xl:p-5 hover:border-amber-300`}
        >
          <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Trophy size={100} />
          </div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-slate-600 text-sm font-bold tracking-tight flex items-center gap-2">
              <Trophy size={16} className="text-amber-500" /> 인기 해석 프로그램
            </h3>
            <button
              type="button"
              onClick={() => setIsTopProgramsModalOpen(true)}
              className="relative z-10 inline-flex h-7 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 text-[10px] font-black text-amber-700 transition-colors hover:bg-amber-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              aria-label="기간별 인기 해석 프로그램 순위 보기"
            >
              순위 보기 <ChevronRight size={12} />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 font-bold mb-2">최근 30일 상위 3개</p>
          {topProgramsLoading ? (
            <div className="space-y-1.5" role="status" aria-live="polite">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-6 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : topProgramsError ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-2">
              <p className="text-[11px] font-bold text-red-700">{topProgramsError}</p>
              <button
                type="button"
                onClick={fetchTopProgramStats}
                className="mt-1 text-[10px] font-black text-red-700 underline underline-offset-2"
              >
                다시 시도
              </button>
            </div>
          ) : topPrograms30.length > 0 ? (
            <div className="space-y-1.5">
              {topPrograms30.slice(0, 3).map((item, i) => {
                const RANK_COLORS = ['text-amber-500', 'text-slate-500', 'text-orange-400'];
                return (
                  <button
                    key={item.program_name}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleProgramShortcut(item.program_name); }}
                    className="w-full flex items-center gap-2 rounded-md px-1 py-1 hover:bg-amber-50/80 transition-colors text-left cursor-pointer"
                  >
                    <span className={`text-xs font-extrabold w-4 shrink-0 ${RANK_COLORS[i]}`}>{i + 1}</span>
                    <span className="flex-1 text-xs font-medium text-slate-700 truncate">{item.program_name}</span>
                    <span className="text-[10px] text-slate-500 font-bold shrink-0">{item.count}건</span>
                    <ChevronRight size={12} className="text-amber-500 shrink-0" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-2">데이터 없음</p>
          )}
        </div>
      </div>
      </div>

      {/* 즐겨찾기 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-bold text-slate-700 flex items-center gap-2">
              <Star size={15} className="text-amber-400" fill="currentColor" /> 즐겨찾기
            </h2>
            {isEditingFavorites && (
              <p className="mt-1 text-xs text-slate-500">카드를 드래그하거나 화살표 버튼으로 순서를 변경하세요.</p>
            )}
          </div>
          {favorites.length > 1 && (
            <Button
              type="button"
              variant={isEditingFavorites ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setIsEditingFavorites(value => !value);
                setDraggedFavorite(null);
              }}
              className="rounded-lg"
            >
              {isEditingFavorites ? <Check size={14} /> : <GripVertical size={14} />}
              {isEditingFavorites ? '편집 완료' : '순서 편집'}
            </Button>
          )}
        </div>

        {recentApps.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-black tracking-wide text-slate-400">
                <Clock size={12} /> 최근 사용 앱
              </span>
              {recentApps.slice(0, 6).map(app => (
                <button
                  key={app.menu}
                  type="button"
                  onClick={() => setCurrentMenu(app.menu)}
                  className="max-w-[160px] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  title={app.label}
                >
                  {app.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={clearRecentApps}
              className="shrink-0 text-[10px] font-bold text-slate-400 hover:text-red-500"
            >
              Clear
            </button>
          </div>
        )}

        {favorites.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-blue-200 bg-white p-5 text-center shadow-sm">
            <div className="p-4 bg-blue-50 rounded-full mb-4">
              <Star size={32} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-700 mb-1">자주 쓰는 앱을 바로 꺼내 쓰세요.</p>
            <p className="text-sm text-slate-500 mb-5">앱 카드의 별을 누르면 이 영역에 고정됩니다. 먼저 업무 유형별 앱 목록으로 이동할 수 있습니다.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-2xl">
              {[
                { label: '파일 기반 앱', menu: 'File-Based Apps', icon: Layers },
                { label: '계산/설계 앱', menu: 'Parametric Apps', icon: SlidersHorizontal },
                { label: '후처리 도구', menu: 'Productivity Apps', icon: Wrench },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.menu}
                    type="button"
                    onClick={() => setCurrentMenu(item.menu)}
                    variant="primary"
                    size="sm"
                    fullWidth
                    className="rounded-lg"
                  >
                    <Icon size={14}/>
                    {item.label}
                    <ChevronRight size={14}/>
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          >
            {favorites.map((favTitle, index) => {
              const analysisInfo = ANALYSIS_DATA.find(a => a.title === favTitle);
              if (!analysisInfo) return null;
              return (
                <FavoriteCard
                  key={favTitle}
                  title={analysisInfo.title}
                  desc={analysisInfo.description}
                  icon={analysisInfo.icon}
                  color={analysisInfo.color}
                  onClick={() => handleFavoriteClick(analysisInfo.title)}
                  onFavoriteRemove={() => toggleFavorite(analysisInfo.title)}
                  isEditing={isEditingFavorites}
                  position={index}
                  total={favorites.length}
                  onMoveLeft={() => reorderFavorite(favTitle, favorites[index - 1])}
                  onMoveRight={() => reorderFavorite(favTitle, favorites[index + 1])}
                  onDragStart={(event) => {
                    setDraggedFavorite(favTitle);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', favTitle);
                  }}
                  onDragEnd={() => setDraggedFavorite(null)}
                  onDragOver={(event) => {
                    if (!isEditingFavorites) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const activeTitle = draggedFavorite || event.dataTransfer.getData('text/plain');
                    reorderFavorite(activeTitle, favTitle);
                    setDraggedFavorite(null);
                  }}
                  isDragging={draggedFavorite === favTitle}
                />
              );
            })}
          </motion.div>
        )}
      </div>

      {/* 프로젝트 이력 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold text-slate-700 flex items-center gap-2">
            <Clock size={15} className="text-slate-500" /> 프로젝트 이력
          </h2>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] font-bold text-slate-400 [@media(max-height:900px)]:inline">
              최근 5건 중 화면 높이에 맞춰 표시
            </span>
            <button onClick={() => setCurrentMenu('My Projects')} className="inline-flex items-center gap-1 text-xs font-bold text-blue-500 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer">
              전체 이력 보기 →
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold w-24 text-center">ID</th>
                  <th className="py-3 px-4 font-bold">프로젝트명</th>
                  <th className="py-3 px-4 font-bold">모듈 (유형)</th>
                  <th className="py-3 px-4 font-bold">진행 상태</th>
                  <th className="py-3 px-4 font-bold text-right">수행 일시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-500 text-sm" role="status" aria-live="polite">
                      <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" aria-hidden="true"></div>
                      <p>이력 데이터를 불러오는 중입니다...</p>
                    </td>
                  </tr>
                ) : historyError ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-sm">
                      <p className="font-bold text-red-700">{historyError}</p>
                      <p className="mt-1 text-xs text-slate-500">서버 연결 또는 인증 상태를 확인한 뒤 다시 시도하세요.</p>
                      <button
                        type="button"
                        onClick={() => setHistoryRefreshToken(value => value + 1)}
                        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 cursor-pointer"
                      >
                        다시 시도
                      </button>
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-500 text-sm">최근 수행된 프로젝트 내역이 없습니다.</td>
                  </tr>
                ) : (
                  projects.slice(0, 5).map((project, index) => (
                    <ProjectRow
                      key={project.id}
                      id={project.id}
                      name={project.project_name}
                      type={project.program_name}
                      status={project.status}
                      date={project.created_at}
                      className={
                        index >= 4
                          ? '[@media(max-height:900px)]:hidden'
                          : index >= 3
                            ? '[@media(max-height:780px)]:hidden'
                            : ''
                      }
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 뉴스레터 아카이브 모달 */}
      <Suspense fallback={null}>
        <NewsletterArchiveModal
          isOpen={isNewsletterModalOpen}
          onClose={() => setIsNewsletterModalOpen(false)}
        />
      </Suspense>
    </div>
  );
}
