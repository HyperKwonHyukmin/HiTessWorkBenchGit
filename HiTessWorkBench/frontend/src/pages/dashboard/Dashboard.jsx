/// <summary>
/// 메인 대시보드 UI 컴포넌트입니다.
/// (수정) 즐겨찾기에서 Truss Assessment 진입 시 글로벌 상태를 초기화하는 로직 추가
/// </summary>
import React, { useState, useEffect, useRef, Fragment } from 'react';
import { motion } from 'framer-motion';
import { Dialog, Transition } from '@headlessui/react';
import { getQueueStatus } from '../../api/admin';
import { getAnalysisHistory } from '../../api/analysis';
import {
  Activity, FileText, Server, CheckCircle2,
  ArrowUpRight, Star, CalendarDays, Database, Map, Rocket,
  Wrench, Clock, X, ChevronRight, Layers, Cpu, FlaskConical, FileBarChart2, Maximize2
} from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';

const MODE_KO = {
  File: "파일 기반",
  Interactive: "대화형 앱",
  Parametric: "파라메트릭"
};

const EngineeringStatCard = ({ title, value, subtext, icon: Icon, color }) => (
  <motion.div
    className="relative bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between hover:shadow-lg hover:border-blue-300 transition-all duration-200 group"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, ease: 'easeOut' }}
    whileHover={{ y: -3, transition: { type: 'spring', stiffness: 350, damping: 28 } }}
  >
    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400">
      <ArrowUpRight size={18} />
    </div>
    <div>
      <h3 className="text-slate-600 text-sm font-bold tracking-tight group-hover:text-blue-600 transition-colors">
        {title}
      </h3>
      <div className="mt-2 flex items-center space-x-2 mb-1">
        <span className="text-2xl font-extrabold text-slate-800 tracking-tight">{value}</span>
      </div>
      <p className="text-xs font-medium text-slate-400">{subtext}</p>
    </div>
    <div className={`p-3 rounded-xl ${color} shadow-sm group-hover:scale-110 transition-transform`}>
      <Icon size={22} className="text-white" />
    </div>
  </motion.div>
);

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

const ProjectRow = ({ id, name, type, status, date, onClick }) => {
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
    <tr onClick={onClick} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/50 transition-colors group cursor-pointer">
      <td className="py-3 px-4 font-mono text-xs text-slate-500 text-center">{id}</td>
      <td className="py-3 px-4">
        <div className="flex items-center">
          <FileText size={16} className="text-slate-400 mr-2 group-hover:text-blue-600 transition-colors" />
          <span className="font-bold text-sm text-slate-700 group-hover:text-blue-600 transition-colors">
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

const StatusBadge = ({ status }) => {
  if (status === 'Active') return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold flex items-center gap-1"><Rocket size={12}/> 서비스 중</span>;
  if (status === 'Developing') return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold flex items-center gap-1"><Wrench size={12}/> 개발 중</span>;
  return <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-bold flex items-center gap-1"><Clock size={12}/> 출시 예정</span>;
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
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const activeCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Active').length;
  const devCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Developing').length;
  const planCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Planned').length;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % ANALYSIS_DATA.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const currentApp = ANALYSIS_DATA[currentIndex];
  const AppIcon = currentApp.icon;

  return (
    <div 
      onClick={onOpenModal}
      className="bg-gradient-to-r from-[#002554] to-indigo-900 rounded-xl shadow-lg border border-indigo-500/30 overflow-hidden cursor-pointer hover:shadow-xl transition-all group flex flex-col md:flex-row relative"
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
          <span className="px-2 py-1 bg-slate-500/20 text-slate-300 rounded border border-slate-500/30">예정: {planCount}</span>
        </div>
      </div>
      <div className="p-5 md:flex-1 relative overflow-hidden flex items-center">
        <div key={currentApp.title} className="animate-fade-in-up flex items-start gap-4 w-full">
           <div className={`p-3 rounded-xl bg-white/10 text-white shrink-0 shadow-inner border border-white/5`}>
             <AppIcon size={24} />
           </div>
           <div className="flex-1 min-w-0">
             <div className="flex items-center gap-2 mb-1">
               <span className="text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-300/30 tracking-wider">
                 {MODE_KO[currentApp.mode] || currentApp.mode}
               </span>
               <h4 className="text-white font-bold text-sm truncate">{currentApp.title}</h4>
               <StatusBadge status={currentApp.devStatus} />
             </div>
             <p className="text-blue-100/70 text-xs line-clamp-2 pr-8">{currentApp.description}</p>
           </div>
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 group-hover:text-white transition-colors flex items-center gap-1 text-xs font-bold">
          상세 보기 <ChevronRight size={16}/>
        </div>
      </div>
    </div>
  );
};

const MODE_BADGE = {
  File:         { text: '파일 기반',   cls: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  Interactive:  { text: '대화형 앱',   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  Parametric:   { text: '파라메트릭', cls: 'text-violet-700 bg-violet-50 border-violet-200' },
  Productivity: { text: '생산성 도구', cls: 'text-orange-700 bg-orange-50 border-orange-200' },
};

const STATUS_GROUP_STYLE = {
  Active:     { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-400', border: 'border-l-emerald-400' },
  Developing: { bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    bar: 'bg-blue-400',    border: 'border-l-blue-400' },
  Planned:    { bg: 'bg-slate-100 border-slate-200',    text: 'text-slate-500',   bar: 'bg-slate-300',   border: 'border-l-slate-300' },
};

const RoadmapModal = ({ isOpen, onClose }) => {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: '#F0F3FA' }}>
            {/* 헤더 */}
            <div className="bg-brand-blue p-5 flex justify-between items-center text-white shrink-0">
              <div>
                <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                  <Map size={20} className="text-blue-300"/> HiTESS 워크벤치 로드맵
                </Dialog.Title>
                <p className="text-xs text-blue-200/70 mt-1">플랫폼 내 도입 예정 및 개발 중인 해석 앱들의 전체 현황입니다.</p>
              </div>
              <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"><X size={20}/></button>
            </div>

            {/* 요약 배지 */}
            <div className="px-6 pt-4 pb-2 flex gap-2 shrink-0">
              {[
                { key: 'Active',     label: '서비스 중', icon: Rocket, cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
                { key: 'Developing', label: '개발 중',   icon: Wrench, cls: 'bg-blue-100 text-blue-700 border-blue-300' },
                { key: 'Planned',    label: '출시 예정', icon: Clock,  cls: 'bg-slate-200 text-slate-600 border-slate-300' },
              ].map(({ key, label, icon: Icon, cls }) => (
                <span key={key} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${cls}`}>
                  <Icon size={11} />
                  {label}: {ANALYSIS_DATA.filter(a => a.devStatus === key).length}
                </span>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar space-y-8">
              {['Active', 'Developing', 'Planned'].map((statusGroup) => {
                const apps = ANALYSIS_DATA.filter(a => a.devStatus === statusGroup);
                if (apps.length === 0) return null;
                const groupTitle = statusGroup === 'Active' ? '현재 서비스 중'
                                 : statusGroup === 'Developing' ? '개발 진행 중'
                                 : '출시 및 개발 예정';
                const sg = STATUS_GROUP_STYLE[statusGroup];
                return (
                  <div key={statusGroup}>
                    {/* 섹션 헤더 */}
                    <div className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg border mb-4 ${sg.bg}`}>
                      <div className={`w-2 h-5 rounded-full ${sg.bar} shrink-0`} />
                      {statusGroup === 'Active'     && <Rocket size={15} className="text-emerald-500"/>}
                      {statusGroup === 'Developing' && <Wrench size={15} className="text-blue-500"/>}
                      {statusGroup === 'Planned'    && <Clock  size={15} className="text-slate-400"/>}
                      <h3 className={`text-sm font-bold tracking-wide ${sg.text}`}>
                        {groupTitle}
                      </h3>
                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${sg.bg} ${sg.text}`}>
                        {apps.length}개
                      </span>
                    </div>

                    {/* 앱 카드 그리드 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {apps.map((app, idx) => {
                        const modeBadge = MODE_BADGE[app.mode] || { text: app.mode, cls: 'text-slate-500 bg-slate-100 border-slate-200' };
                        return (
                          <div
                            key={idx}
                            className={`relative bg-white rounded-xl p-4 shadow-sm hover:shadow-lg transition-all border border-slate-100 hover:border-slate-200 border-l-4 ${sg.border} group overflow-hidden`}
                          >
                            {/* 배경 장식 */}
                            <div className="absolute -right-4 -bottom-4 opacity-[0.04] pointer-events-none">
                              <app.icon size={72} />
                            </div>

                            {/* 상단: 아이콘 + 모드 배지 */}
                            <div className="flex justify-between items-start mb-3">
                              <div className={`p-2.5 ${app.color} text-white rounded-lg shadow-md group-hover:scale-105 transition-transform`}>
                                <app.icon size={20} />
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${modeBadge.cls}`}>
                                {modeBadge.text}
                              </span>
                            </div>

                            <h4 className="font-bold text-slate-800 text-sm mb-1 leading-snug">{app.title}</h4>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mb-3">{app.description}</p>

                            {/* 태그 */}
                            <div className="flex flex-wrap gap-1">
                              {app.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-50 text-slate-400 border border-slate-100 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>

                            {/* 기여자 */}
                            <div className="absolute bottom-2.5 right-3 text-[9px] text-slate-300 font-medium tracking-wide">
                              {app.contributor}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
            <Dialog.Panel className="w-full max-w-6xl bg-[#002554] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
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
  const { setCurrentMenu } = useNavigation();
  // [핵심 변경] 상태 초기화를 위해 setAssessmentPageState 가져오기
  const { favorites, setAssessmentPageState } = useDashboard();
  
  const [projects, setProjects] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [queueStatus, setQueueStatus] = useState({ running: 0, pending: 0, limit: 2 });
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isRoadmapModalOpen, setIsRoadmapModalOpen] = useState(false);
  const [isIntroModalOpen, setIsIntroModalOpen] = useState(false);
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
        // 웹: Vite 플러그인이 서빙하는 경로 사용
        const fileName = target === 'workbench' ? 'hitess-workbench.html' : 'hitess-platform.html';
        const content = { mode: 'src', value: `/IntroductionPage/${fileName}` };
        introCache.current[target] = content;
        setIntroContent(content);
      }
    } catch (err) {
      console.error('소개 페이지 로드 실패:', err);
    }
  };

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
        const userStr = localStorage.getItem('user');
        let employeeId = null;
        try { employeeId = userStr ? JSON.parse(userStr).employee_id : null; } catch { /* 세션 데이터 손상 시 무시 */ }
        if (!employeeId) return;

        const response = await getAnalysisHistory(employeeId);
        const rawData = response.data?.items ?? response.data;
        const sortedData = [...rawData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setProjects(sortedData);
        // 백엔드가 반환하는 실제 전체 건수 사용 (items.length는 최대 200으로 제한됨)
        setTotalCount(response.data?.total ?? sortedData.length);
      } catch (error) {
        console.error("이력 불러오기 실패:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const totalExecutions = totalCount;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyUsageCount = projects.filter(p => {
    const d = new Date(p.created_at);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const handleFavoriteClick = (title) => {
    const targetApp = ANALYSIS_DATA.find(a => a.title === title);
    if (targetApp && targetApp.devStatus !== 'Active') {
      alert(`[안내] '${title}' 앱은 현재 개발 중이거나 출시 예정인 모듈입니다.`);
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
    } else if (title === "Mast Post Assessment") {
      setCurrentMenu('Mast Post Assessment');
    } else if (title === "Jib Rest Assessment") {
      setCurrentMenu('Jib Rest Assessment');
    } else if (title === "Column Buckling Load Calculator") {
      setCurrentMenu('Column Buckling Load Calculator');
    } else if (title === "BDF Scanner") {
      setCurrentMenu('BDF Scanner');
    } else {
      alert(`[안내] ${title} 기능은 현재 준비 중입니다.`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10 animate-fade-in-up">
      
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-blue tracking-tight">워크벤치 종합 현황</h1>
          <p className="text-sm text-slate-500 mt-1">실행 중인 시뮬레이션 상태 및 시스템 리소스를 확인하세요.</p>
        </div>
        <div className="text-right">
          {isBackendConnected ? (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200 shadow-sm">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
              서버 연결 확인
            </span>
          ) : (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200 shadow-sm">
              <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
              서버 연결 끊김
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-6">
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
      <RoadmapModal isOpen={isRoadmapModalOpen} onClose={() => setIsRoadmapModalOpen(false)} />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 relative overflow-hidden group hover:border-blue-300 transition-colors">
          <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Server size={100} />
          </div>
          <h3 className="text-slate-600 text-sm font-bold tracking-tight flex items-center gap-2 mb-3">
            <Activity size={16} className="text-blue-500" /> 해석 서버 부하 현황
          </h3>
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
      </div>

      <div className="space-y-4 pt-4 border-t border-slate-200 border-dashed">
        <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
          <Star size={16} className="text-yellow-500" fill="currentColor" /> 자주 사용하는 앱 (즐겨찾기)
        </h2>
        
        {favorites.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm shadow-sm flex flex-col items-center">
            <div className="p-4 bg-slate-50 rounded-full mb-4">
              <Star size={32} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-500 mb-1">즐겨찾기 항목이 없습니다.</p>
            <p>New Analysis 메뉴에서 자주 사용하는 해석에 별(★)을 눌러 대시보드에 추가해 보세요.</p>
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

      <div className="pt-4 border-t border-slate-200 border-dashed">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
            <Activity size={16} /> 최근 수행 프로젝트 이력
          </h2>
          <button onClick={() => setCurrentMenu('My Project')} className="text-xs font-bold text-blue-600 hover:underline cursor-pointer">
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
                      onClick={() => setCurrentMenu('My Projects')}
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