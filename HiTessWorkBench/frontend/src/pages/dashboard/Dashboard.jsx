/// <summary>
/// 메인 대시보드 UI 컴포넌트입니다.
/// (수정) 즐겨찾기에서 Truss Assessment 진입 시 글로벌 상태를 초기화하는 로직 추가
/// </summary>
import React, { useState, useEffect, useRef, Fragment } from 'react';
import { motion } from 'framer-motion';
import { Dialog, Transition } from '@headlessui/react';
import { getQueueStatus, getNotices } from '../../api/admin';
import { getAnalysisHistory, getTopPrograms, getMonthlyAnalysisCount } from '../../api/analysis';
import {
  Activity, FileText, Server,
  ArrowUpRight, Star, CalendarDays, Database, Map, Rocket,
  Wrench, Clock, X, ChevronRight, Layers, Cpu, Maximize2, Trophy,
  Megaphone, Pin, Sparkles
} from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import NoticeDetailModal, { NOTICE_TYPE_STYLE } from '../../components/modals/NoticeDetailModal';

const MODE_KO = {
  File: "File-Based Apps",
  Interactive: "Interactive Apps",
  Parametric: "Parametric Apps",
  Productivity: "Productivity Apps",
  Academic: "Academic Apps"
};

const EngineeringStatCard = ({ title, value, subtext, icon: Icon, color, onClick }) => {
  const isClickable = typeof onClick === 'function';
  return (
    <motion.div
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`relative bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between transition-all duration-200 group ${
        isClickable ? 'hover:shadow-lg hover:border-blue-300 cursor-pointer' : ''
      }`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={isClickable ? { y: -3, transition: { type: 'spring', stiffness: 350, damping: 28 } } : undefined}
    >
      {isClickable && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400">
          <ArrowUpRight size={18} />
        </div>
      )}
      <div>
        <h3 className={`text-slate-600 text-sm font-bold tracking-tight transition-colors ${isClickable ? 'group-hover:text-blue-600' : ''}`}>
          {title}
        </h3>
        <div className="mt-2 flex items-center space-x-2 mb-1">
          <span className="text-2xl font-extrabold text-slate-800 tracking-tight">{value}</span>
        </div>
        <p className="text-xs font-medium text-slate-400">{subtext}</p>
      </div>
      <div className={`p-3 rounded-xl ${color} shadow-sm ${isClickable ? 'group-hover:scale-110' : ''} transition-transform`}>
        <Icon size={22} className="text-white" />
      </div>
    </motion.div>
  );
};

const FavoriteCard = ({ title, icon: Icon, color, desc, onClick }) => (
  <motion.button
    onClick={onClick}
    className="flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-slate-200 shadow-sm group w-full text-center h-full relative overflow-hidden cursor-pointer"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, ease: 'easeOut' }}
    whileHover={{
      y: -5,
      boxShadow: '0 12px 28px -8px rgba(0, 37, 84, 0.18)',
      borderColor: '#3b82f6',
      transition: { type: 'spring', stiffness: 380, damping: 28 },
    }}
    whileTap={{ scale: 0.97 }}
  >
    <div className="absolute top-3 right-3 text-yellow-400">
      <Star size={16} fill="currentColor" />
    </div>
    <div className={`p-4 rounded-full ${color} text-white mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
      <Icon size={28} />
    </div>
    <h3 className="font-bold text-slate-700 text-sm">{title}</h3>
    <p className="text-xs text-slate-400 mt-1 truncate max-w-full px-2">{desc}</p>
  </motion.button>
);

const ProjectRow = ({ id, name, type, status, date }) => {
  const statusStyles = {
    Success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Failed: 'bg-red-100 text-red-700 border-red-200',
    Pending: 'bg-gray-100 text-slate-600 border-slate-200',
  };

  const statusKo = {
    Success: '해석 완료',
    Failed: '해석 실패',
    Pending: '대기 중'
  };

  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-slate-50/60 transition-colors">
      <td className="py-3 px-4 font-mono text-xs text-slate-500 text-center">{id}</td>
      <td className="py-3 px-4">
        <div className="flex items-center">
          <FileText size={16} className="text-slate-400 mr-2" />
          <span className="font-bold text-sm text-slate-700">
            {name || '이름 없는 프로젝트'}
          </span>
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-slate-500 font-mono">
        <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">{type}</span>
      </td>
      <td className="py-3 px-4">
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusStyles[status] || statusStyles.Pending}`}>
          {statusKo[status] || status}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-slate-400 text-right">{new Date(date).toLocaleString()}</td>
    </tr>
  );
};

const BANNER_THEMES = {
  platform: {
    gradient: 'linear-gradient(135deg, #003520 0%, #002554 55%, #1a1060 100%)',
    DecorIcon: Layers,
    decorIconClass: 'text-emerald-400/5',
    bgOverlay: 'bg-gradient-to-r from-emerald-500/8 via-transparent to-indigo-500/8',
    accentBar: 'bg-gradient-to-b from-emerald-400 to-emerald-600',
    iconBg: 'bg-emerald-500/15 border-emerald-400/30 group-hover:bg-emerald-500/25 shadow-emerald-900/30',
    iconColor: 'text-emerald-400',
    labelColor: 'text-emerald-400',
    chipText: 'text-emerald-100/75 group-hover:border-emerald-400/25',
    chipIconColor: 'text-emerald-400/80',
    ctaColor: 'text-emerald-300 group-hover:text-emerald-200',
    subtitleColor: 'text-emerald-100/55',
  },
  workbench: {
    gradient: 'linear-gradient(135deg, #0f1729 0%, #162040 55%, #0d1b3e 100%)',
    DecorIcon: Cpu,
    decorIconClass: 'text-indigo-400/5',
    bgOverlay: 'bg-gradient-to-r from-indigo-500/8 via-transparent to-violet-500/8',
    accentBar: 'bg-gradient-to-b from-indigo-400 to-indigo-600',
    iconBg: 'bg-indigo-500/15 border-indigo-400/30 group-hover:bg-indigo-500/25 shadow-indigo-900/30',
    iconColor: 'text-indigo-400',
    labelColor: 'text-indigo-400',
    chipText: 'text-indigo-100/75 group-hover:border-indigo-400/25',
    chipIconColor: 'text-indigo-400/80',
    ctaColor: 'text-indigo-300 group-hover:text-indigo-200',
    subtitleColor: 'text-indigo-100/55',
  },
};

const DiscoverHiTessBanner = ({ variant = 'platform', badge, title, subtitle, ctaText, MainIcon = Layers, onClick }) => {
  const t = BANNER_THEMES[variant];
  return (
    <motion.div
      onClick={onClick}
      className="relative rounded-xl overflow-hidden cursor-pointer group"
      style={{ background: t.gradient }}
      whileHover={{ y: -2, transition: { type: 'spring', stiffness: 350, damping: 28 } }}
    >
      {/* 배경 장식 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <t.DecorIcon size={120} className={`absolute -right-6 -bottom-6 ${t.decorIconClass} rotate-12`} />
        <div className={`absolute inset-0 ${t.bgOverlay}`} />
        <div className={`absolute top-0 left-0 w-1 h-full ${t.accentBar} opacity-80`} />
      </div>

      <div className="relative z-10 flex flex-row items-center gap-3 px-4 py-2.5">
        {/* 아이콘 */}
        <div className={`p-2 rounded-lg border group-hover:scale-110 transition-all shadow-md shrink-0 ${t.iconBg}`}>
          <MainIcon size={18} className={t.iconColor} />
        </div>

        {/* 타이틀 */}
        <div className="min-w-0 flex-1">
          <span className={`${t.labelColor} text-[9px] font-bold tracking-widest uppercase block truncate`}>
            {badge}
          </span>
          <h3 className="text-white font-bold text-sm tracking-tight leading-tight truncate">
            {title}
          </h3>
          <p className={`${t.subtitleColor} text-[10px] truncate`}>
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
  const activeApps = ANALYSIS_DATA.filter(a => a.devStatus === 'Active');
  const devCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Developing').length;
  const activeCount = activeApps.length;
  const modeSummary = ROADMAP_MODE_ORDER
    .map(mode => ({
      mode,
      info: MODE_BADGE[mode],
      count: ANALYSIS_DATA.filter(a => a.mode === mode).length,
    }))
    .filter(item => item.count > 0);

  return (
    <div
      onClick={onOpenModal}
      className="bg-gradient-to-r from-brand-blue to-indigo-900 rounded-xl shadow-lg border border-indigo-500/30 overflow-hidden cursor-pointer hover:shadow-xl transition-all group flex flex-col md:flex-row relative"
    >
      <Map size={120} className="absolute -left-10 -bottom-10 text-white/5 rotate-12 pointer-events-none" />
      <div className="p-5 md:w-1/3 border-b md:border-b-0 md:border-r border-white/10 relative z-10 flex flex-col justify-center">
        <h3 className="text-white font-bold text-sm flex items-center gap-2 mb-1">
          <Map size={16} className="text-blue-300"/> 시스템 해석 앱 로드맵
        </h3>
        <p className="text-blue-200/70 text-xs mb-3">플랫폼 내 해석 모듈 통합 개발 현황</p>
        <div className="flex gap-2 text-[10px] font-bold">
          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">서비스 중: {activeCount}</span>
          <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">개발 중: {devCount}</span>
        </div>
      </div>
      <div className="p-4 md:flex-1 relative overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 pr-20">
          {modeSummary.map(({ mode, info, count }) => (
            <div key={mode} className="rounded-lg border border-white/10 bg-white/8 px-3 py-2 min-w-0">
              <p className="text-[10px] font-bold text-blue-200/70 truncate">{MODE_KO[mode] || info.label}</p>
              <p className="text-white text-lg font-black leading-tight">{count}</p>
            </div>
          ))}
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 group-hover:text-white transition-colors flex items-center gap-1 text-xs font-bold">
          지도 열기 <ChevronRight size={16}/>
        </div>
      </div>
    </div>
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      whileHover={{ y: -1, boxShadow: `0 10px 24px -10px ${style.glow}` }}
      className="relative bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors cursor-pointer overflow-hidden group mb-6"
    >
      {/* 좌측 강조 그라데이션 바 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${style.bar}`} />
      {/* 미세한 우측 글로우 */}
      <div
        className="absolute -right-10 -top-10 w-40 h-40 rounded-full opacity-40 blur-2xl pointer-events-none"
        style={{ background: style.glow }}
      />

      <div className="relative flex items-center gap-3 px-4 py-3 pl-5">
        {/* 좌측 라벨 + NEW 배지 */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors">
              <Megaphone size={14} className="text-slate-600 group-hover:text-blue-600 transition-colors" />
            </div>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 ring-2 ring-white" />
              </span>
            )}
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[11px] font-bold text-slate-700 tracking-tight">공지 &amp; 업데이트</span>
            <span className="text-[9px] text-slate-400 font-medium mt-0.5">최근 알림</span>
          </div>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-sm"
            >
              <Sparkles size={9} />
              NEW {unreadCount}
            </motion.span>
          )}
        </div>

        {/* 구분선 */}
        <div className="h-6 w-px bg-slate-200 shrink-0" />

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
            <span className="text-sm font-semibold text-slate-700 truncate group-hover:text-blue-600 transition-colors">
              {current.title || '(제목 없음)'}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0 hidden sm:inline">
              {formatRelative(current.created_at)}
            </span>
          </motion.div>
        </div>

        {/* 우측 CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleOpenAll}
            title="전체 공지 목록으로 이동"
            className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
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
  Academic:     { title: 'Academic Apps', label: 'Academic',       cls: 'text-cyan-700 bg-cyan-50 border-cyan-200',       ring: 'border-l-cyan-500',       iconBg: 'bg-cyan-600',       summary: 'AI 기반 해석 및 연구 단계 기능을 실험적으로 통합하는 영역입니다.' },
};

const STATUS_GROUP_STYLE = {
  Active:     { label: '서비스 중', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', icon: Rocket },
  Developing: { label: '개발 중',   bg: 'bg-slate-50 border-slate-200',     text: 'text-slate-500',   dot: 'bg-slate-300',   icon: Wrench },
  Planned:    { label: '예정',      bg: 'bg-slate-50 border-slate-200',      text: 'text-slate-600',   dot: 'bg-slate-400',   icon: Clock },
};

const ROADMAP_STATUS_DOT = {
  Active: 'bg-emerald-500',
  Developing: 'bg-amber-400',
  Planned: 'bg-slate-400',
};

const ROADMAP_MODE_ORDER = ['File', 'Interactive', 'Parametric', 'Productivity', 'Academic'];

const RoadmapModal = ({ isOpen, onClose }) => {
  const totalCount = ANALYSIS_DATA.length;
  const statusCounts = ANALYSIS_DATA.reduce((acc, app) => {
    const status = app.devStatus || 'Active';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

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
                <p className="text-xs text-blue-200/70 mt-1">전체 프로그램 구조와 서비스 상태를 한 화면에서 파악합니다.</p>
              </div>
              <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"><X size={20}/></button>
            </div>

            {/* 요약 배지 */}
            <div className="px-5 pt-3 pb-2 flex flex-wrap gap-2 shrink-0">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border bg-white text-slate-700 border-slate-200">
                <Map size={11} />
                전체: {totalCount}개
              </span>
              {Object.entries(STATUS_GROUP_STYLE).map(([key, style]) => {
                const Icon = style.icon;
                return (
                  <span key={key} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${style.bg} ${style.text}`}>
                    <Icon size={11} />
                    {style.label}: {statusCounts[key] || 0}개
                  </span>
                );
              })}
              {ROADMAP_MODE_ORDER.map(mode => {
                const modeInfo = MODE_BADGE[mode];
                const count = ANALYSIS_DATA.filter(a => a.mode === mode).length;
                if (!count) return null;
                return (
                  <span key={mode} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${modeInfo.cls}`}>
                    {modeInfo.title}: {count}개
                  </span>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5 custom-scrollbar space-y-3">
              {ROADMAP_MODE_ORDER.map((mode) => {
                const apps = ANALYSIS_DATA.filter(a => a.mode === mode);
                if (apps.length === 0) return null;
                const modeInfo = MODE_BADGE[mode] || { title: mode, label: mode, cls: 'text-slate-500 bg-slate-100 border-slate-200', ring: 'border-l-slate-400', iconBg: 'bg-slate-500', summary: '' };
                const activeCount = apps.filter(a => (a.devStatus || 'Active') === 'Active').length;
                const developingCount = apps.filter(a => a.devStatus === 'Developing').length;
                const FirstIcon = apps[0].icon;
                const categoryCount = new Set(apps.map(a => a.category)).size;

                return (
                  <section key={mode} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
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
                            앱 {apps.length}개 · 카테고리 {categoryCount}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <span className="px-2 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">서비스 {activeCount}</span>
                        {developingCount > 0 && (
                          <span className="px-2 py-1 text-[10px] font-bold rounded-full bg-slate-50 text-slate-500 border border-slate-200">개발 {developingCount}</span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                      {apps.map((app) => {
                        const status = app.devStatus || 'Active';
                        const isDeveloping = status === 'Developing';
                        const AppIcon = app.icon;
                        return (
                          <div
                            key={app.title}
                            className={`relative rounded-lg px-3 py-2.5 transition-all border group overflow-hidden min-h-[92px] ${
                              isDeveloping
                                ? 'bg-slate-50/70 border-slate-200 shadow-none opacity-80 hover:opacity-95 hover:shadow-sm'
                                : 'bg-white border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200'
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
                                  <span className="text-[10px] font-bold text-slate-400 truncate">{app.category}</span>
                                </div>
                                <h4 className="font-bold text-slate-800 text-[12px] leading-snug line-clamp-2">{app.title}</h4>
                              </div>
                            </div>

                            <div className="relative mt-2 flex items-center justify-between gap-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                status === 'Active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : status === 'Developing'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-slate-50 text-slate-500 border-slate-200'
                              }`}>
                                {(STATUS_GROUP_STYLE[status] || STATUS_GROUP_STYLE.Planned).label}
                              </span>
                              {(app.relatedApps?.length > 0 || app.acceptsTransferFrom?.length > 0) && (
                                <span className="text-[10px] text-indigo-500 font-bold bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                  연계
                                </span>
                              )}
                            </div>
                          </div>
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
                style={{ background: 'linear-gradient(90deg, #003520 0%, #002554 60%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30">
                    <Layers size={18} className="text-emerald-400" />
                  </div>
                  <div>
                    <Dialog.Title className="text-white font-bold text-sm leading-tight">
                      {modalTitle}
                    </Dialog.Title>
                    <p className="text-emerald-100/50 text-[11px]">{modalSubtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleFullscreen}
                    title="전체화면 (F)"
                    className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
                    <p className="text-xs text-slate-400">Electron 앱을 재시작한 후 다시 시도해 주세요.</p>
                    <button
                      onClick={onRetry}
                      className="mt-1 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
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
  const { favorites, setAssessmentPageState } = useDashboard();
  
  const [projects, setProjects] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [monthlyUsageCount, setMonthlyUsageCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [queueStatus, setQueueStatus] = useState({ running: 0, pending: 0, limit: 2 });
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isRoadmapModalOpen, setIsRoadmapModalOpen] = useState(false);
  const [isIntroModalOpen, setIsIntroModalOpen] = useState(false);
  const [topPrograms30, setTopPrograms30] = useState([]);
  const [topProgramsAll, setTopProgramsAll] = useState([]);
  const [isTopProgramsModalOpen, setIsTopProgramsModalOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [isNoticeDetailOpen, setIsNoticeDetailOpen] = useState(false);
  // { mode: 'srcdoc', value: htmlString } | { mode: 'src', value: url } | null
  const [introContent, setIntroContent] = useState(null);
  const [introTarget, setIntroTarget] = useState('platform');
  // target별 로드된 콘텐츠 캐시 (재열람 시 재요청 방지)
  const introCache = useRef({});

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

  useEffect(() => {
    getTopPrograms(30, 5).then(r => setTopPrograms30(r.data)).catch(() => {});
    getTopPrograms(0, 10).then(r => setTopProgramsAll(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchQueue = async () => {
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
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        if (!employeeId) return;

        const now = new Date();
        const [historyRes, monthlyRes] = await Promise.all([
          getAnalysisHistory(employeeId),
          getMonthlyAnalysisCount(employeeId, now.getFullYear(), now.getMonth() + 1),
        ]);

        const rawData = historyRes.data?.items ?? historyRes.data;
        const sortedData = [...rawData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setProjects(sortedData);
        setTotalCount(historyRes.data?.total ?? sortedData.length);
        setMonthlyUsageCount(monthlyRes.data?.count ?? 0);
      } catch (error) {
        console.error("이력 불러오기 실패:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const totalExecutions = totalCount;

  const handleFavoriteClick = (title) => {
    const targetApp = ANALYSIS_DATA.find(a => a.title === title);
    if (targetApp && targetApp.devStatus !== 'Active') {
      showToast(`'${title}' 앱은 현재 개발 중인 모듈입니다.`, 'info');
      return;
    }

    if (title === "Truss Model Builder") {
      setCurrentMenu('Truss Analysis');
    } else if (title === "Truss Structural Assessment") {
      // [동작] 카드를 누르면 이전 글로벌 상태를 빈 객체로 덮어씌워 완전 초기화합니다.
      if (setAssessmentPageState) setAssessmentPageState({});
      setCurrentMenu('Truss Structural Assessment');
    } else if (title === "Simple Beam Assessment") {
      setCurrentMenu('Simple Beam Assessment');
    } else if (title === "Plate Structure Analysis") {
      setCurrentMenu('Plate Structure Analysis');
    } else if (title === "Mast Post Assessment") {
      setCurrentMenu('Mast Post Assessment');
    } else if (title === "Jib Rest Assessment") {
      setCurrentMenu('Jib Rest Assessment');
    } else if (title === "Column Buckling Load Calculator") {
      setCurrentMenu('Column Buckling Load Calculator');
    } else if (title === "D Type Lug Assessment") {
      setCurrentMenu('D Type Lug Assessment');
    } else if (title === "Carling Free Calculator") {
      setCurrentMenu('Carling Free Calculator');
    } else if (title === "Carling Design Optimization") {
      setCurrentMenu('Carling Design Optimization');
    } else if (title === "BDF Scanner") {
      setCurrentMenu('BDF Scanner');
    } else {
      showToast(`'${title}' 기능은 현재 준비 중입니다.`, 'info');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10 animate-fade-in-up">
      
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-brand-blue tracking-tight">WorkBench Overview</h1>
        <p className="text-sm text-slate-500 mt-1">해석 서버 현황, 수행 통계, 즐겨찾기 앱을 한눈에 확인하세요.</p>
      </div>

      <RoadmapModal isOpen={isRoadmapModalOpen} onClose={() => setIsRoadmapModalOpen(false)} />

      {/* ── 전체 기간 순위 모달 ── */}
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
              <Dialog.Panel className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Trophy size={18} className="text-amber-500" />
                    <Dialog.Title className="text-base font-bold text-slate-800">전체 기간 인기 프로그램</Dialog.Title>
                  </div>
                  <button onClick={() => setIsTopProgramsModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {topProgramsAll.map((item, i) => {
                    const maxCount = topProgramsAll[0]?.count || 1;
                    const MEDAL = ['🥇', '🥈', '🥉'];
                    return (
                      <div key={item.program_name} className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 px-1">
                        <span className="text-base w-6 shrink-0 text-center">
                          {i < 3 ? MEDAL[i] : <span className="text-xs font-bold text-slate-400">{i + 1}</span>}
                        </span>
                        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{item.program_name}</span>
                        <div className="w-20 bg-slate-100 rounded-full h-1.5 shrink-0">
                          <div
                            className="bg-blue-400 h-1.5 rounded-full"
                            style={{ width: `${(item.count / maxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-500 w-12 text-right shrink-0">{item.count}건</span>
                      </div>
                    );
                  })}
                  {topProgramsAll.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-8">데이터가 없습니다.</p>
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

      {/* 공지 & 업데이트 슬림 스트립 */}
      <NoticeStrip
        onOpenDetail={(n) => { setSelectedNotice(n); setIsNoticeDetailOpen(true); }}
        onOpenList={() => setCurrentMenu('Notice & Updates')}
      />
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

      {/* 플랫폼 소개 & 로드맵 — 신규/숙련 사용자 모두를 위한 컨텍스트 정보 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
            <Layers size={15} className="text-slate-400" /> 플랫폼 소개 &amp; 로드맵
          </h2>
          <span className="text-xs text-slate-400">처음이신가요? 플랫폼 소개를 살펴보세요</span>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DiscoverHiTessBanner
              variant="platform"
              badge="Platform Introduction"
              title="Discover HiTESS"
              subtitle="차세대 조선해양 구조 해석 플랫폼을 살펴보세요"
              ctaText="살펴보기"
              MainIcon={Layers}
              onClick={() => handleDiscoverHiTess('platform')}
            />
            <DiscoverHiTessBanner
              variant="workbench"
              badge="WorkBench Introduction"
              title="HiTESS WorkBench"
              subtitle="해석 도구 모음과 AI 어시스턴트를 경험해보세요"
              ctaText="살펴보기"
              MainIcon={Cpu}
              onClick={() => handleDiscoverHiTess('workbench')}
            />
          </div>
          <AppRoadmapBanner onOpenModal={() => setIsRoadmapModalOpen(true)} />
        </div>
      </div>

      {/* 서비스 현황 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <Activity size={15} className="text-blue-400" /> 서비스 현황
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative overflow-hidden group hover:border-blue-300 transition-colors">
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
          <p className="text-[11px] text-slate-400 font-bold mb-2">현재 서버 구동 현황</p>
          <div className="text-2xl font-extrabold text-slate-800 tracking-tight mb-2">
            {queueStatus.running} <span className="text-sm text-slate-400 font-medium">/ {queueStatus.limit} 구동 중</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-3">
            <div 
              className={`h-full transition-all duration-500 ${queueStatus.running >= queueStatus.limit ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${(queueStatus.running / queueStatus.limit) * 100}%` }}
            ></div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
            <Activity size={14} className={queueStatus.pending > 0 ? "text-orange-500" : "text-slate-400"} />
            대기 중인 큐: <span className={queueStatus.pending > 0 ? "text-orange-600" : "text-slate-500"}>{queueStatus.pending} 건</span>
          </div>
        </div>

        <EngineeringStatCard 
          title="월간 해석 수행 건수" 
          value={`${monthlyUsageCount} 건`} 
          subtext="이번 달 실행된 전체 프로젝트" 
          icon={CalendarDays} 
          color="bg-indigo-500"
        />
        <EngineeringStatCard
          title="누적 해석 수행 건수"
          value={`${totalExecutions} 건`}
          subtext="지금까지 실행된 총 프로젝트 내역"
          icon={Database}
          color="bg-blue-500"
        />
        <div
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative overflow-hidden group hover:border-amber-300 transition-colors cursor-pointer"
          onClick={() => setIsTopProgramsModalOpen(true)}
        >
          <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Trophy size={100} />
          </div>
          <h3 className="text-slate-600 text-sm font-bold tracking-tight flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-amber-500" /> 인기 해석 프로그램
          </h3>
          <p className="text-[11px] text-slate-400 font-bold mb-2">최근 30일 Top 5</p>
          {topPrograms30.length > 0 ? (
            <div className="space-y-1.5">
              {topPrograms30.slice(0, 3).map((item, i) => {
                const RANK_COLORS = ['text-amber-500', 'text-slate-400', 'text-orange-400'];
                return (
                  <div key={item.program_name} className="flex items-center gap-2">
                    <span className={`text-xs font-extrabold w-4 shrink-0 ${RANK_COLORS[i]}`}>{i + 1}</span>
                    <span className="flex-1 text-xs font-medium text-slate-700 truncate">{item.program_name}</span>
                    <span className="text-[10px] text-slate-400 font-bold shrink-0">{item.count}건</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-300 mt-2">데이터 없음</p>
          )}
          <p className="text-[10px] text-amber-500 font-semibold mt-3 group-hover:text-amber-600 transition-colors">전체 순위 보기 →</p>
        </div>
      </div>
      </div>

      {/* 즐겨찾기 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <Star size={15} className="text-amber-400" fill="currentColor" /> 즐겨찾기
          </h2>
        </div>
        
        {favorites.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm flex flex-col items-center">
            <div className="p-4 bg-slate-50 rounded-full mb-4">
              <Star size={32} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-500 mb-1">즐겨찾기 항목이 없습니다.</p>
            <p className="text-sm text-slate-400 mb-5">자주 사용하는 해석 앱에 별(★)을 눌러 대시보드에 추가해 보세요.</p>
            <button
              onClick={() => setCurrentMenu('File-Based Apps')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm hover:shadow"
            >
              <Layers size={14}/>
              해석 앱 둘러보기
              <ChevronRight size={14}/>
            </button>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          >
            {favorites.map(favTitle => {
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
                />
              );
            })}
          </motion.div>
        )}
      </div>

      {/* 프로젝트 이력 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <Clock size={15} className="text-slate-400" /> 프로젝트 이력
          </h2>
          <button onClick={() => setCurrentMenu('My Project')} className="text-xs font-bold text-blue-500 hover:text-blue-600 cursor-pointer">
            전체 이력 보기 →
          </button>
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
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="py-10 text-center text-slate-400 text-sm">
                      <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2"></div>
                      <p>이력 데이터를 불러오는 중입니다...</p>
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-10 text-center text-slate-400 text-sm">최근 수행된 프로젝트 내역이 없습니다.</td>
                  </tr>
                ) : (
                  projects.slice(0, 5).map((project) => (
                    <ProjectRow
                      key={project.id}
                      id={project.id}
                      name={project.project_name}
                      type={project.program_name}
                      status={project.status}
                      date={project.created_at}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}
