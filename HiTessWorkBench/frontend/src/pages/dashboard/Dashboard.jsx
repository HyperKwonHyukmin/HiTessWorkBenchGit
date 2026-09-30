/// <summary>
/// 메인 대시보드 (2026-09-30 개편).
///
/// 배치 원칙:
///  - 첫 화면 = "새 해석 시작" + "내 작업". 실패하면 대부분 파일 업로드부터 다시 하므로
///    '이어서 작업' 대신 실패를 빨리 알아채고 같은 앱에서 새로 시작하는 동선을 앞에 둔다.
///  - 앱 바로가기는 '즐겨찾기 | 최근 사용' 두 탭으로 나눈다. 한 묶음에 섞으면 어느 쪽인지 구분이 안 됐다.
///  - 공지는 상단 한 줄, 소개·로드맵·Story·Newsletter 는 인사 줄의 "자료" 메뉴 하나로.
///  - 지표(월별 실행·많이 쓰는 앱)는 참고 정보라 아래 두 카드로.
///  - 위·아래 두 줄 모두 같은 12열 격자(5 : 7)를 써서 카드 좌우 경계가 세로로 맞는다.
/// 공지 줄·모달·섹션 제목은 dashboardShared.jsx 에 있다.
/// </summary>
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock,
  FileUp, History, LayoutGrid, Loader2, Map as MapIcon, Newspaper, Play, RotateCcw,
  Server, Star, TrendingUp, Trophy, X, XCircle, Layers,
} from 'lucide-react';
import { getQueueStatus } from '../../api/admin';
import { getAnalysisHistory, getMonthlyAnalysisCount, getTopPrograms } from '../../api/analysis';
import { API_BASE_URL } from '../../config';
import {
  findAppByAnyName, findAppByProgramName, getAppMenuName, getDisplayProgramName,
  useAnalysisPageState, useAppCatalogue, useFavorites, useGlobalJobs,
} from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { POLLING_POLICY } from '../../hooks/pollingPolicy';
import { isTerminalJobStatus } from '../../utils/globalJobs';
import { FILE_HANDOFF_MENUS, offerDashboardFiles } from '../../utils/dashboardFileHandoff';
import {
  DashboardSectionTitle, IntroModal, NoticeStrip, RoadmapModal, VideoPlayerModal, isRoadmapAppNavigable,
} from './dashboardShared';

const AdminGateModal = lazy(() => import('../../components/ui/AdminGateModal'));
const NoticeDetailModal = lazy(() => import('../../components/modals/NoticeDetailModal'));
const NewsletterArchiveModal = lazy(() => import('../../components/NewsletterArchiveModal'));

// Dashboard.jsx 와 같은 키 — My Projects 가 이 값을 읽어 상세 모달을 연다.
const OPEN_PROJECT_DETAIL_KEY = 'workbench:open-project-detail';
const QUICK_APP_COUNT = 6; // 한 번에 보이는 타일 수(2줄). 즐겨찾기는 '더 보기'로 나머지를 펼친다.
const QUICK_TAB_KEY = 'workbench:dashboard-quick-tab';
const RECENT_RESULT_COUNT = 6;
const HISTORY_FETCH = 30;
const TREND_MONTHS = 6;

const MODE_LABEL = { File: 'File-Based', Interactive: 'Interactive', Parametric: 'Parametric', Productivity: 'Productivity' };
const MODE_ACCENT = {
  File: 'from-blue-500/70 via-blue-300/40 to-transparent',
  Interactive: 'from-violet-500/70 via-violet-300/40 to-transparent',
  Parametric: 'from-emerald-500/70 via-emerald-300/40 to-transparent',
  Productivity: 'from-amber-500/70 via-amber-300/40 to-transparent',
};

// 드롭한 파일 확장자 → 카탈로그 inputFormats 의 첫 토큰("CSV ×2" → "CSV")
const EXT_TO_FORMAT = {
  bdf: 'BDF', dat: 'BDF', nas: 'BDF', blk: 'BDF',
  csv: 'CSV', pdf: 'PDF', f06: 'F06', json: 'JSON',
  png: 'Image', jpg: 'Image', jpeg: 'Image',
};

/** epoch/ISO → '방금 / n분 전 / n시간 전 / n일 전 / M/D' */
const formatRelative = (value, now = Date.now()) => {
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t) || t <= 0) return '';
  const minutes = Math.floor(Math.max(0, now - t) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const formatAbsolute = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR');
};

const formatElapsed = (startedAt) => {
  const sec = Math.max(0, Math.floor((Date.now() - Number(startedAt || 0)) / 1000));
  if (!startedAt || sec > 86400) return '';
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}분 ${sec % 60}초` : `${sec}초`;
};

/**
 * 실패 레코드에서 사유 한 줄을 찾는다.
 * 1순위 job_message — job_manager 가 모든 해석의 마지막 진행 메시지를 DB 에 남긴다(실측 실패 627건 중 575건).
 * 없으면 result_info 의 error/diagnostic 류 필드.
 */
const failureReason = (record) => {
  const jobMessage = typeof record?.job_message === 'string' ? record.job_message.trim() : '';
  if (jobMessage) return jobMessage.split('\n')[0].slice(0, 140);
  let info = record?.result_info;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { return null; }
  }
  if (!info || typeof info !== 'object') return null;
  const diag = info.diagnostic;
  const candidates = [
    info.error, info.error_message, info.message, info.detail, info.reason,
    typeof diag === 'string' ? diag : diag?.message || diag?.summary || diag?.error,
  ];
  const hit = candidates.find(v => typeof v === 'string' && v.trim());
  return hit ? hit.trim().split('\n')[0].slice(0, 140) : null;
};

/** 카드 공통 틀 — 상단 그라데이션 띠는 구 대시보드와 같은 표현이다. */
const Card = ({ accent = 'from-brand-blue/70 via-blue-400/40 to-transparent', className = '', children }) => (
  <section className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} aria-hidden="true" />
    {children}
  </section>
);

/** 섹션 제목 — 네 카드 모두 같은 틀(제목 · 보조 정보 · 오른쪽 동작)을 카드 바깥 위에 둔다. */
const SectionHeader = ({ icon, title, accent, meta, action }) => (
  <div className="mb-2 flex min-h-[36px] items-end justify-between gap-3">
    <div className="flex min-w-0 items-end gap-2">
      <DashboardSectionTitle icon={icon} title={title} accent={accent} />
      {meta && <span className="pb-1 text-xs font-semibold text-slate-500">{meta}</span>}
    </div>
    {action}
  </div>
);

const LinkButton = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
  >
    {children} <ChevronRight size={14} />
  </button>
);

// ─────────────────────────────────────────────────────────────── 인사 줄

const ResourceMenu = ({ onIntro, onRoadmap, onVideo, onNewsletter }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const items = [
    { icon: Layers, label: 'HiTESS WorkBench 소개', onClick: onIntro },
    { icon: MapIcon, label: '앱 로드맵', onClick: onRoadmap },
    { icon: Play, label: 'HiTESS Story 영상', onClick: onVideo },
    { icon: Newspaper, label: 'News Letter', onClick: onNewsletter },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-bold text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <BookOpen size={14} /> 자료
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onClick(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
            >
              <Icon size={15} className="text-slate-500" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StatusChip = ({ icon: Icon, label, value, tone = 'neutral', onClick, title }) => {
  const toneCls = {
    neutral: 'border-white/15 bg-white/[0.08] text-white',
    running: 'border-blue-300/40 bg-blue-400/15 text-white',
    danger: 'border-red-300/50 bg-red-500/20 text-white',
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${toneCls} ${
        onClick ? 'cursor-pointer transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60' : ''
      }`}
    >
      <Icon size={14} className="opacity-80" />
      <span className="text-blue-100">{label}</span>
      <span className="text-sm font-extrabold tabular-nums">{value}</span>
    </Tag>
  );
};

// ─────────────────────────────────────────────────────────────── 새 해석 시작

const DropZone = ({ catalogue, isBlocked, onOpenApp }) => {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState(null); // { files: File[], names, formats: Set }
  const inputRef = useRef(null);

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const formats = new Set(
      files.map(f => EXT_TO_FORMAT[(f.name.split('.').pop() || '').toLowerCase()]).filter(Boolean),
    );
    setDropped({ files, names: files.map(f => f.name), formats });
  };

  const matches = useMemo(() => {
    if (!dropped) return [];
    return catalogue.filter(app =>
      app.hasPage
      && (app.mode === 'File' || app.mode === 'Productivity')
      && !isBlocked(app)
      && (app.inputFormats || []).some(f => dropped.formats.has(String(f).split(' ')[0])),
    );
  }, [catalogue, dropped, isBlocked]);

  if (dropped) {
    const formatText = [...dropped.formats].join(' · ') || '알 수 없는 형식';
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-blue-800">{formatText} 파일로 할 수 있는 해석</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={dropped.names.join(', ')}>
              {dropped.names.join(', ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDropped(null)}
            aria-label="추천 닫기"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-700"
          >
            <X size={14} />
          </button>
        </div>
        {matches.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matches.map(app => {
              const menu = getAppMenuName(app.title);
              const carries = FILE_HANDOFF_MENUS.has(menu);
              return (
                <button
                  key={app.title}
                  type="button"
                  onClick={() => {
                    if (carries) offerDashboardFiles(menu, dropped.files);
                    onOpenApp(app.title);
                  }}
                  title={carries ? '파일을 그대로 가지고 이동합니다' : '이 앱은 화면에서 파일을 다시 선택해야 합니다'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:text-blue-700"
                >
                  {app.title}
                  {!carries && <span className="rounded bg-slate-100 px-1 py-px text-[11px] font-bold text-slate-600">다시 선택</span>}
                  <ChevronRight size={13} />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-600">이 형식을 입력으로 받는 앱이 없습니다.</p>
        )}
        {matches.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            {matches.every(app => FILE_HANDOFF_MENUS.has(getAppMenuName(app.title)))
              ? '앱을 고르면 파일을 가지고 바로 이동합니다.'
              : "앱을 고르면 파일을 가지고 이동합니다 — '다시 선택' 표시 앱은 화면에서 파일을 다시 고르세요."}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-slate-50/60 hover:border-blue-300 hover:bg-blue-50/40'
      }`}
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 ring-1 ring-slate-200">
        <FileUp size={19} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800">입력 파일을 끌어다 놓으세요</span>
        <span className="block text-xs text-slate-500">BDF · CSV · PDF · F06 — 맞는 해석 앱을 추천합니다</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
    </button>
  );
};

const QUICK_TABS = [
  { key: 'favorites', label: '즐겨찾기', icon: Star },
  { key: 'recent', label: '최근 사용', icon: Clock },
];

/** '즐겨찾기 | 최근 사용' 세그먼트 탭 — 지금 보이는 타일이 어느 목록인지 이름으로 드러낸다 */
const QuickTabs = ({ active, onSelect, favoriteCount }) => (
  <div role="tablist" aria-label="앱 바로가기" className="inline-flex rounded-lg bg-slate-100 p-0.5">
    {QUICK_TABS.map(({ key, label, icon: Icon }) => {
      const selected = active === key;
      return (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onSelect(key)}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            selected ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Icon size={12} className={selected && key === 'favorites' ? 'text-amber-400' : undefined} fill={selected && key === 'favorites' ? 'currentColor' : 'none'} />
          {label}
          {key === 'favorites' && favoriteCount > 0 && (
            <span className={`rounded px-1 text-[10px] tabular-nums ${selected ? 'bg-amber-50 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>{favoriteCount}</span>
          )}
        </button>
      );
    })}
  </div>
);

const QuickEmpty = ({ children }) => (
  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">{children}</p>
);

const QuickAppTile = ({ app, meta, isFavorite, onOpen, onToggleFavorite }) => {
  const Icon = app.icon;
  return (
    <div className="relative flex min-h-[92px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-blue-300 hover:shadow-md">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${MODE_ACCENT[app.mode] || MODE_ACCENT.File}`} aria-hidden="true" />
      {/* 모드는 아이콘 색·글리프가 이미 나타낸다(카탈로그의 모드 시그니처) — 칩은 좁은 타일에서 줄바꿈돼 뺐다 */}
      <span
        className={`mb-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${app.color} text-white`}
        title={MODE_LABEL[app.mode] || app.mode}
      >
        {Icon ? <Icon size={15} /> : <LayoutGrid size={15} />}
      </span>
      <h3 className="line-clamp-2 text-[13px] font-bold leading-snug text-slate-800" title={app.title}>{app.title}</h3>
      {meta && <p className="mt-auto pt-1 text-[11px] font-semibold text-slate-500">{meta}</p>}
      {/* 카드 전체 진입 버튼과 별 버튼은 형제(중첩 아님) */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${app.title} 열기`}
        className="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      />
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={`${app.title} 즐겨찾기 ${isFavorite ? '해제' : '추가'}`}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        className={`absolute right-1.5 top-1.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
          isFavorite ? 'text-amber-400' : 'text-slate-300 hover:text-amber-500'
        }`}
      >
        <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── 내 작업

const RESULT_STATUS = {
  Success: { icon: CheckCircle2, cls: 'text-emerald-600', label: '완료' },
  Failed: { icon: XCircle, cls: 'text-red-600', label: '실패' },
  Interrupted: { icon: XCircle, cls: 'text-red-600', label: '중단됨' },
  Cancelled: { icon: XCircle, cls: 'text-slate-500', label: '취소됨' },
};

const LiveJobRow = ({ job, onOpen }) => {
  const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));
  const elapsed = formatElapsed(job.startedAt);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-left transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <div className="flex items-center gap-2.5">
          <Loader2 size={16} className="shrink-0 animate-spin text-blue-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{job.displayName || job.menu}</span>
          <span className="shrink-0 text-xs font-bold tabular-nums text-blue-700">{progress}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-100">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span className="truncate">{job.message || '실행 중'}</span>
          {elapsed && <span className="shrink-0 tabular-nums">경과 {elapsed}</span>}
        </div>
      </button>
    </li>
  );
};

const ResultRow = ({ project, onDetail, onRestart }) => {
  const status = RESULT_STATUS[project.status] || { icon: Clock, cls: 'text-slate-500', label: project.status || '대기' };
  const Icon = status.icon;
  const failed = project.status === 'Failed' || project.status === 'Interrupted';
  const appTitle = getDisplayProgramName(project.program_name);
  const when = (
    <span className="shrink-0 text-xs tabular-nums text-slate-500" title={formatAbsolute(project.created_at)}>
      {formatRelative(project.created_at)}
    </span>
  );

  // 성공·취소 등은 한 줄 — 행 전체가 상세 열기 버튼이다.
  if (!failed) {
    return (
      <li>
        <button
          type="button"
          onClick={onDetail}
          className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <Icon size={15} className={`shrink-0 ${status.cls}`} aria-label={status.label} />
          <span className="shrink-0 text-sm font-bold text-slate-800" title={project.program_name}>{appTitle}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={project.project_name}>
            {project.project_name || '이름 없는 프로젝트'}
          </span>
          {when}
          <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" />
        </button>
      </li>
    );
  }

  const reason = failureReason(project);
  return (
    <li className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${status.cls}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-sm font-bold text-slate-800" title={project.program_name}>{appTitle}</span>
            <span className={`shrink-0 text-xs font-bold ${status.cls}`}>{status.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={project.project_name}>{project.project_name}</span>
          </div>
          {reason ? (
            <p className="mt-1 text-xs font-medium text-red-800">사유: {reason}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-600">실패 사유가 기록되지 않았습니다 — 상세에서 로그를 확인하세요.</p>
          )}
        </div>
        {when}
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#003366] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <RotateCcw size={13} /> 같은 앱에서 새로 시작
        </button>
        <button
          type="button"
          onClick={onDetail}
          className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          상세·로그 <ChevronRight size={13} />
        </button>
      </div>
    </li>
  );
};

// ─────────────────────────────────────────────────────────────── 하단 참고 카드

const MonthlyTrendCard = ({ months, loading }) => {
  const max = Math.max(1, ...months.map(m => m.count));
  const current = months[months.length - 1]?.count ?? 0;
  const previous = months[months.length - 2]?.count ?? 0;
  const delta = current - previous;
  return (
    <Card className="flex flex-1 flex-col p-4">
      <p className="text-xs text-slate-500">
        이번 달 <b className="tabular-nums text-slate-800">{current}건</b>
        {months.length > 1 && (
          <> · 전월 대비 <b className={`tabular-nums ${delta >= 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{delta >= 0 ? `+${delta}` : delta}</b></>
        )}
      </p>
      <div className="mt-3 flex min-h-[80px] flex-1 items-end gap-2" role="img" aria-label={months.map(m => `${m.label} ${m.count}건`).join(', ')}>
        {loading
          ? Array.from({ length: TREND_MONTHS }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-t bg-slate-200" style={{ height: `${30 + i * 8}%` }} />
          ))
          : months.map((m, i) => (
            <div key={m.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] font-bold tabular-nums text-slate-600">{m.count}</span>
              <div
                className={`w-full rounded-t ${i === months.length - 1 ? 'bg-brand-blue' : 'bg-blue-200'}`}
                style={{ height: `${Math.max(4, (m.count / max) * 100)}%` }}
              />
            </div>
          ))}
      </div>
      <div className="mt-1 flex gap-2">
        {months.map(m => <span key={m.label} className="flex-1 text-center text-[11px] text-slate-500">{m.label}</span>)}
      </div>
    </Card>
  );
};

const PopularCard = ({ rows, loading, onOpen }) => {
  const max = rows[0]?.count || 1;
  return (
    <Card accent="from-amber-400/70 via-amber-200/40 to-transparent" className="flex-1 p-3">
      <ol className="space-y-0.5">
        {loading ? (
          [0, 1, 2, 3, 4].map(i => <li key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)
        ) : rows.length === 0 ? (
          <li className="py-6 text-center text-xs text-slate-500">최근 30일 사용 기록이 없습니다.</li>
        ) : rows.map((item, i) => (
          <li key={item.program_name}>
            <button
              type="button"
              onClick={() => onOpen(item.program_name)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <span className="w-4 shrink-0 text-xs font-bold tabular-nums text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700" title={item.program_name}>
                {getDisplayProgramName(item.program_name)}
              </span>
              <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-blue-400" style={{ width: `${(item.count / max) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-slate-600">{item.count}</span>
              <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" />
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────── 페이지

export default function Dashboard() {
  const { showToast } = useToast();
  const { employeeId, user } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const { favorites, toggleFavorite } = useFavorites();
  const { setAssessmentPageState } = useAnalysisPageState();
  const { apps: catalogue, getBlock, isBlockedFor } = useAppCatalogue();
  const { globalJobs = [] } = useGlobalJobs() || {};
  const { recentApps } = useRecentActivity();
  const admin = getIsAdmin();

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [historyToken, setHistoryToken] = useState(0);
  const [months, setMonths] = useState([]);
  const [monthsLoading, setMonthsLoading] = useState(true);
  const [successRate, setSuccessRate] = useState(null);
  const [popular, setPopular] = useState([]);
  const [popularLoading, setPopularLoading] = useState(true);
  const [serverQueue, setServerQueue] = useState(null);

  const [gateApp, setGateApp] = useState(null);
  const [quickTab, setQuickTab] = useState(() => {
    try { return localStorage.getItem(QUICK_TAB_KEY); } catch { return null; }
  });
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [modal, setModal] = useState(null); // 'intro' | 'roadmap' | 'video' | 'newsletter'
  const [notice, setNotice] = useState(null);

  // ── 데이터 ─────────────────────────────────────────────
  useEffect(() => {
    if (!employeeId) return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    getAnalysisHistory(employeeId, 0, HISTORY_FETCH)
      .then(res => { if (!cancelled) setHistory(res.data?.items ?? res.data ?? []); })
      .catch(() => { if (!cancelled) { setHistory([]); setHistoryError('작업 이력을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId, historyToken]);

  useEffect(() => {
    if (!employeeId) return undefined;
    let cancelled = false;
    const now = new Date();
    const targets = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
    setMonthsLoading(true);
    Promise.all(targets.map(t => getMonthlyAnalysisCount(employeeId, t.year, t.month)
      .then(res => res.data?.count ?? 0).catch(() => 0)))
      .then(counts => {
        if (cancelled) return;
        setMonths(targets.map((t, i) => ({ label: `${t.month}월`, count: counts[i] })));
      })
      .finally(() => { if (!cancelled) setMonthsLoading(false); });
    // 성공률 = 성공 건수 / 전체 건수 (limit=1 로 total 만 받는다)
    Promise.all([
      getAnalysisHistory(employeeId, 0, 1),
      getAnalysisHistory(employeeId, 0, 1, { status: 'Success' }),
    ]).then(([all, ok]) => {
      if (cancelled) return;
      const total = all.data?.total ?? 0;
      setSuccessRate(total > 0 ? Math.round(((ok.data?.total ?? 0) / total) * 100) : null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    getTopPrograms(30, 5)
      .then(res => { if (!cancelled) setPopular(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setPopular([]); })
      .finally(() => { if (!cancelled) setPopularLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 서버 슬롯·대기 — 예전 서버 카드 대신 인사 줄 칩 하나로 보여 준다.
  useEffect(() => {
    const fetchQueue = async () => {
      if (document.hidden) return;
      try {
        const res = await getQueueStatus();
        setServerQueue({ ...(res.data || {}), online: true });
      } catch {
        setServerQueue(prev => ({ ...(prev || {}), online: false }));
      }
    };
    fetchQueue();
    const timer = setInterval(fetchQueue, POLLING_POLICY.systemIntervalMs);
    return () => clearInterval(timer);
  }, []);

  // ── 앱 진입(Dashboard.jsx handleFavoriteClick 과 같은 규칙) ─────────────
  const openApp = (title) => {
    const appMeta = catalogue.find(a => a.title === title) || findAppByAnyName(title);
    if (!appMeta) {
      showToast(`'${title}' 앱 정보를 찾을 수 없습니다.`, 'info');
      return;
    }
    const block = admin ? null : getBlock(appMeta);
    if (block) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus, reason: block.reason, message: block.message });
      return;
    }
    if (!appMeta.hasPage && appMeta.devStatus && appMeta.devStatus !== 'Active') {
      showToast(`'${appMeta.title}' 앱은 현재 준비 중입니다.`, 'info');
      return;
    }
    if (appMeta.title === 'Truss Structural Assessment' && setAssessmentPageState) setAssessmentPageState({});
    setCurrentMenu(getAppMenuName(appMeta.title));
  };

  const openProgram = (programName) => {
    const app = findAppByProgramName(programName) || catalogue.find(a => a.title === programName);
    if (app) openApp(app.title);
    else showToast(`'${programName}' 앱 정보를 찾을 수 없습니다.`, 'info');
  };

  const openProjectDetail = (project) => {
    try { sessionStorage.setItem(OPEN_PROJECT_DETAIL_KEY, JSON.stringify(project)); } catch { /* 목록으로만 이동 */ }
    setCurrentMenu('My Projects');
  };

  // ── 자주 쓰는 앱 = 즐겨찾기 먼저 + 최근 사용으로 채움(중복 제거) ─────────
  const favoriteStoredByTitle = useMemo(() => {
    const map = Object.create(null);
    for (const stored of favorites || []) {
      const canonical = findAppByAnyName(stored)?.title ?? stored;
      if (map[canonical] === undefined) map[canonical] = stored;
    }
    return map;
  }, [favorites]);

  // 앱별 마지막 방문 시각(최근 사용 목록은 최신순)
  const visitedAt = useMemo(() => {
    const map = Object.create(null);
    for (const item of recentApps || []) {
      const found = findAppByAnyName(item.label || item.menu);
      if (found && map[found.title] === undefined) map[found.title] = item.at;
    }
    return map;
  }, [recentApps]);

  // 즐겨찾기 = 개수 제한 없이 전부(넘치는 부분은 '더 보기'로 펼친다)
  const favoriteApps = useMemo(() => Object.keys(favoriteStoredByTitle)
    .map(title => catalogue.find(a => a.title === title))
    .filter(Boolean), [favoriteStoredByTitle, catalogue]);

  // 최근 사용 = 방문 기록 최신순. 즐겨찾기 앱도 빼지 않는다(별 표시로 구분).
  const recentAppList = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const item of recentApps || []) {
      if (out.length >= QUICK_APP_COUNT) break;
      const found = findAppByAnyName(item.label || item.menu)
        || catalogue.find(a => getAppMenuName(a.title) === item.menu);
      const app = found ? catalogue.find(a => a.title === found.title) : null;
      if (!app || seen.has(app.title) || !app.hasPage || isBlockedFor(app, admin)) continue;
      seen.add(app.title);
      out.push({ app, at: item.at });
    }
    return out;
  }, [recentApps, catalogue, isBlockedFor, admin]);

  // 고른 탭이 없으면 즐겨찾기가 있을 때 즐겨찾기, 없으면 최근 사용
  const activeQuickTab = quickTab === 'favorites' || quickTab === 'recent'
    ? quickTab
    : (favoriteApps.length > 0 ? 'favorites' : 'recent');
  const selectQuickTab = (tab) => {
    setQuickTab(tab);
    try { localStorage.setItem(QUICK_TAB_KEY, tab); } catch { /* 이번 화면에서만 유지 */ }
  };
  const hiddenFavoriteCount = Math.max(0, favoriteApps.length - QUICK_APP_COUNT);
  const visibleFavorites = showAllFavorites ? favoriteApps : favoriteApps.slice(0, QUICK_APP_COUNT);

  // ── 내 작업 ─────────────────────────────────────────────
  const liveJobs = globalJobs.filter(job => !isTerminalJobStatus(job.status));
  const recentResults = history.slice(0, RECENT_RESULT_COUNT);
  const weekAgo = Date.now() - 7 * 86400000;
  const failedThisWeek = history.filter(p =>
    (p.status === 'Failed' || p.status === 'Interrupted') && Date.parse(p.created_at) >= weekAgo).length;

  const firstName = user?.name || employeeId || '';
  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const serverOffline = serverQueue?.online === false;
  const serverPending = Number(serverQueue?.pending) || 0;
  const serverLabel = serverOffline
    ? '끊김'
    : serverQueue
      ? `${serverQueue.running ?? 0}/${serverQueue.limit ?? 0}${serverPending > 0 ? ` · 대기 ${serverPending}` : ''}`
      : '-';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 pb-24">

      {/* ── 인사 줄 ── */}
      {/* overflow-hidden 을 바깥에 두면 '자료' 드롭다운이 잘린다 → 워터마크만 안쪽 층에서 자른다 */}
      <div className="relative z-20 rounded-2xl border border-brand-blue/10 bg-gradient-to-r from-brand-blue via-[#07315d] to-slate-900 shadow-sm">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
          <Layers size={96} className="absolute -right-5 -top-6 rotate-12 text-white/[0.035]" />
        </div>
        <div className="relative flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-white">{firstName}님, 오늘 작업을 시작하세요</h1>
            <p className="mt-0.5 text-xs font-medium text-blue-100">
              {todayLabel} · {user?.department || '부서 정보 없음'} · <span className="font-mono">{(() => { try { return new URL(API_BASE_URL).host; } catch { return API_BASE_URL; } })()}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip icon={Activity} label="실행 중" value={liveJobs.length} tone={liveJobs.length > 0 ? 'running' : 'neutral'} />
            <StatusChip
              icon={AlertTriangle}
              label="7일 실패"
              value={failedThisWeek}
              tone={failedThisWeek > 0 ? 'danger' : 'neutral'}
              onClick={failedThisWeek > 0 ? () => setCurrentMenu('My Projects') : undefined}
              title={failedThisWeek > 0 ? '내 프로젝트에서 실패 건 확인' : undefined}
            />
            <StatusChip
              icon={Server}
              label="서버"
              value={serverLabel}
              tone={serverOffline ? 'danger' : serverPending > 0 ? 'running' : 'neutral'}
              title={serverOffline ? '해석 서버에 연결할 수 없습니다' : `사용 중 슬롯 / 전체 슬롯 · 대기 ${serverPending}건`}
            />
            <span className="mx-0.5 hidden h-6 w-px bg-white/15 lg:block" aria-hidden="true" />
            <ResourceMenu
              onIntro={() => setModal('intro')}
              onRoadmap={() => setModal('roadmap')}
              onVideo={() => setModal('video')}
              onNewsletter={() => setModal('newsletter')}
            />
          </div>
        </div>
      </div>

      {/* ── 공지 (기존 한 줄 컴포넌트 재사용) ── */}
      <NoticeStrip
        newWithinDays={14}
        onOpenDetail={(n) => setNotice(n)}
        onOpenList={() => setCurrentMenu('Notice & Updates')}
      />

      {/* ── 새 해석 시작 | 내 작업 — 아래 줄과 같은 5 : 7 격자 ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col xl:col-span-5">
          <SectionHeader
            icon={FileUp}
            title="새 해석 시작"
            accent="service"
            action={<LinkButton onClick={() => setCurrentMenu('File-Based Apps')}>전체 앱</LinkButton>}
          />
          <Card className="flex flex-1 flex-col gap-3 p-4">
            <DropZone catalogue={catalogue} isBlocked={(app) => isBlockedFor(app, admin)} onOpenApp={openApp} />
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <QuickTabs
                  active={activeQuickTab}
                  onSelect={selectQuickTab}
                  favoriteCount={favoriteApps.length}
                />
                {activeQuickTab === 'favorites' && hiddenFavoriteCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllFavorites(v => !v)}
                    aria-expanded={showAllFavorites}
                    className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-bold text-brand-blue hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {showAllFavorites ? '접기' : `+${hiddenFavoriteCount}개 더 보기`}
                    <ChevronDown size={13} className={`transition-transform ${showAllFavorites ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {activeQuickTab === 'favorites' ? (
                favoriteApps.length === 0 ? (
                  <QuickEmpty>
                    즐겨찾기한 앱이 없습니다. 타일이나 앱 목록의 <Star size={11} className="inline -mt-0.5 text-amber-400" fill="currentColor" /> 를 누르면 여기에 고정됩니다.
                  </QuickEmpty>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {visibleFavorites.map(app => (
                      <QuickAppTile
                        key={app.title}
                        app={app}
                        meta={visitedAt[app.title] ? `마지막 사용 ${formatRelative(visitedAt[app.title])}` : '아직 사용 안 함'}
                        isFavorite
                        onOpen={() => openApp(app.title)}
                        onToggleFavorite={() => toggleFavorite(favoriteStoredByTitle[app.title] ?? app.title)}
                      />
                    ))}
                  </div>
                )
              ) : recentAppList.length === 0 ? (
                <QuickEmpty>아직 사용한 앱이 없습니다. 앱을 열면 최근 순서대로 여기에 쌓입니다.</QuickEmpty>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {recentAppList.map(({ app, at }) => {
                    const stored = favoriteStoredByTitle[app.title];
                    return (
                      <QuickAppTile
                        key={app.title}
                        app={app}
                        meta={formatRelative(at)}
                        isFavorite={stored !== undefined}
                        onOpen={() => openApp(app.title)}
                        onToggleFavorite={() => toggleFavorite(stored ?? app.title)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col xl:col-span-7">
          <SectionHeader
            icon={History}
            title="내 작업"
            accent="history"
            meta={liveJobs.length > 0 ? `진행 중 ${liveJobs.length}` : null}
            action={<LinkButton onClick={() => setCurrentMenu('My Projects')}>전체 이력</LinkButton>}
          />
          <Card accent="from-slate-500/70 via-blue-300/40 to-transparent" className="flex-1 p-3">
            {liveJobs.length > 0 && (
              <>
                <p className="px-1 pb-1.5 pt-1 text-xs font-bold text-slate-500">진행 중</p>
                <ul className="mb-2 space-y-1.5">
                  {liveJobs.map(job => (
                    <LiveJobRow key={job.jobId} job={job} onOpen={() => setCurrentMenu(job.menu)} />
                  ))}
                </ul>
              </>
            )}
            <p className="px-1 pb-1.5 pt-1 text-xs font-bold text-slate-500">최근 결과</p>
            {historyLoading ? (
              <ul className="space-y-1.5" role="status" aria-live="polite">
                {[0, 1, 2, 3].map(i => <li key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
              </ul>
            ) : historyError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-4 text-center">
                <p className="text-sm font-bold text-red-700">{historyError}</p>
                <button
                  type="button"
                  onClick={() => setHistoryToken(v => v + 1)}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                >
                  다시 시도
                </button>
              </div>
            ) : recentResults.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                아직 실행한 해석이 없습니다. 왼쪽에서 입력 파일로 새 해석을 시작하세요.
              </p>
            ) : (
              <ul className="space-y-1">
                {recentResults.map(project => (
                  <ResultRow
                    key={project.id}
                    project={project}
                    onDetail={() => openProjectDetail(project)}
                    onRestart={() => openProgram(project.program_name)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── 참고 지표 ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col xl:col-span-5">
          <SectionHeader
            icon={TrendingUp}
            title="내 월별 실행"
            accent="service"
            meta={successRate != null ? `성공률 ${successRate}%` : null}
          />
          <MonthlyTrendCard months={months} loading={monthsLoading} />
        </div>
        <div className="flex flex-col xl:col-span-7">
          <SectionHeader
            icon={Trophy}
            title="많이 쓰는 앱"
            accent="favorite"
            meta="최근 30일 · 전체 사용자"
          />
          <PopularCard rows={popular} loading={popularLoading} onOpen={openProgram} />
        </div>
      </div>

      {/* ── 모달 ── */}
      <Suspense fallback={null}>
        <AdminGateModal
          isOpen={!!gateApp}
          onClose={() => setGateApp(null)}
          appTitle={gateApp?.title}
          devStatus={gateApp?.devStatus}
          reason={gateApp?.reason}
          message={gateApp?.message}
        />
        <NoticeDetailModal
          isOpen={!!notice}
          notice={notice}
          onClose={() => setNotice(null)}
          primaryAction={{ label: '전체 공지 보기', onClick: () => setCurrentMenu('Notice & Updates'), icon: <ChevronRight size={14} /> }}
        />
        <NewsletterArchiveModal isOpen={modal === 'newsletter'} onClose={() => setModal(null)} />
      </Suspense>
      <IntroModal
        isOpen={modal === 'intro'}
        onClose={() => setModal(null)}
        src={modal === 'intro' ? `${API_BASE_URL}/api/presentations/hitess-launch-deck` : ''}
      />
      <RoadmapModal
        isOpen={modal === 'roadmap'}
        onClose={() => setModal(null)}
        onSelectApp={(app) => { if (!isRoadmapAppNavigable(app)) return; setModal(null); openApp(app.title); }}
      />
      <VideoPlayerModal isOpen={modal === 'video'} onClose={() => setModal(null)} />
    </div>
  );
}
