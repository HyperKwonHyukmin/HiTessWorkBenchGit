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
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import { EASE_OUT } from '../../components/ui/motion';
import {
  Activity, AlertTriangle, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Compass, HelpCircle,
  FileUp, History, Loader2, Map as MapIcon, Newspaper, Play, RotateCcw,
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
import { FAILED_STATUSES, groupConsecutiveRuns, resultHighlight, unresolvedFailures } from '../../utils/dashboardResults';
import { CardArt, resolveCardArt } from '../../components/ui/cardArt';
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
const RECENT_RESULT_COUNT = 8;
const PINNED_FAILURE_MAX = 3;
// My Projects 가 마운트 시 읽어 상태 필터를 미리 건다(7일 실패 칩 → 실패만 보기)
const MY_PROJECTS_STATUS_FILTER_KEY = 'workbench:my-projects-status-filter';
const HISTORY_FETCH = 30;
const TREND_MONTHS = 6;

const MODE_LABEL = { File: 'File-Based', Interactive: 'Interactive', Parametric: 'Parametric', Productivity: 'Productivity' };

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

const INPUT_FILE_RE = /\.(bdf|dat|nas|blk|csv|pdf|f06|json|png|jpe?g)$/i;
const baseName = (p) => String(p).split(/[\\/]/).pop();

/**
 * 결과 행에 보여 줄 입력 파일명. 프로젝트명은 '앱이름_날짜시각' 이라 앱·시간과 겹치고,
 * 같은 앱을 여러 번 돌리면 어느 모델이었는지 구분이 안 된다. input_info 의 키는 앱마다 달라
 * (stru_csv·bdf_path·file_path …) 파일 확장자로 끝나는 첫 문자열 값을 쓴다. 여러 개면 '외 N'.
 */
const inputFileLabel = (record) => {
  let info = record?.input_info;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { return null; }
  }
  if (!info || typeof info !== 'object') return null;
  const names = [];
  // MySQL JSON 은 키를 길이·사전순으로 재정렬한다(pipe_csv 가 stru_csv 보다 앞). 주 입력으로 보이는 키를 먼저 본다.
  const PRIMARY_KEY_RE = /stru|bdf|model|main|input/i;
  const entries = Object.entries(info).sort(([a], [b]) => Number(PRIMARY_KEY_RE.test(b)) - Number(PRIMARY_KEY_RE.test(a)));
  const visit = (value, depth) => {
    if (typeof value === 'string') {
      if (INPUT_FILE_RE.test(value.trim())) names.push(baseName(value.trim()));
    } else if (Array.isArray(value)) {
      value.forEach(v => visit(v, depth));
    } else if (value && typeof value === 'object' && depth < 1) {
      Object.values(value).forEach(v => visit(v, depth + 1));
    }
  };
  entries.forEach(([, v]) => visit(v, 0));
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  return unique.length > 1 ? `${unique[0]} 외 ${unique.length - 1}` : unique[0];
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

/** 카드 공통 틀. 색 띠 같은 장식 없이 테두리·그림자만 — 섹션의 색은 제목 아이콘 칩 하나가 맡는다. */
const Card = ({ className = '', children }) => (
  <section className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
    {children}
  </section>
);

/** 섹션 제목 — 세 섹션(새 해석 시작·내 작업·참고 지표) 모두 같은 틀(제목 · 보조 정보 · 오른쪽 동작)을 카드 바깥 위에 둔다. */
const SectionHeader = ({ icon, title, accent, meta, action }) => (
  <div className="mb-2 flex min-h-[32px] items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-2">
      <DashboardSectionTitle icon={icon} title={title} accent={accent} />
      {meta && <span className="text-xs font-semibold text-slate-500">{meta}</span>}
    </div>
    {action}
  </div>
);

// 실행이 끝난 작업을 '진행 중' 자리에 잠깐 남겨 완료/실패로 바뀌는 순간을 보여 준 뒤 결과 목록으로 넘긴다.
const FINISHED_LINGER_MS = 2500;

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

const ResourceMenu = ({ onGuide, onUserGuide, onIntro, onRoadmap, onVideo, onNewsletter }) => {
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

  // 위 두 칸 = 쓰는 법(도움말), 아래 = 읽을거리(자료). 예전엔 '자료' 만 있어 사용 안내를 찾을 곳이 없었다.
  const groups = [
    [
      { icon: Compass, label: '대시보드 사용법', onClick: onGuide },
      { icon: BookOpen, label: '앱별 사용자 가이드', onClick: onUserGuide },
    ],
    [
      { icon: Layers, label: 'HiTESS WorkBench 소개', onClick: onIntro },
      { icon: MapIcon, label: '앱 로드맵', onClick: onRoadmap },
      { icon: Play, label: 'HiTESS Story 영상', onClick: onVideo },
      { icon: Newspaper, label: 'News Letter', onClick: onNewsletter },
    ],
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
        <HelpCircle size={14} /> 도움말·자료
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {groups.map((items, gi) => (
            <div key={gi} role="group" className={gi > 0 ? 'mt-1 border-t border-slate-100 pt-1' : undefined}>
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
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── 사용법 안내

// 한 번 닫으면 다시 저절로 뜨지 않는다(이 PC 의 이 사용자 기준). 도움말 메뉴로 언제든 다시 연다.
const GUIDE_DISMISSED_KEY = 'workbench:dashboard-guide-dismissed';
// 실행 이력이 이보다 적으면 '처음 쓰는 사람' 으로 보고 안내를 저절로 펼친다.
const GUIDE_AUTO_MAX_RUNS = 3;

const GUIDE_STEPS = [
  {
    icon: FileUp,
    title: '입력 파일로 시작',
    body: 'BDF·CSV·PDF·F06 을 아래 칸에 놓으면 그 파일을 받는 앱을 골라 줍니다. 앱을 고르면 파일을 들고 이동합니다.',
  },
  {
    icon: Activity,
    title: '실행 상황 보기',
    body: '해석은 서버에서 돌아갑니다. 다른 화면으로 가도 멈추지 않고, 진행률은 내 작업과 오른쪽 아래 작업 버튼에 보입니다.',
  },
  {
    icon: CheckCircle2,
    title: '결과 확인·받기',
    body: '내 작업의 줄을 누르면 결과 파일·보고서·3D 보기가 있는 상세가 열립니다. 실패하면 사유와 같은 앱 새로 시작 버튼이 붙습니다.',
  },
];

const DashboardGuide = ({ onClose, onUserGuide }) => (
  <section aria-labelledby="dashboard-guide-title" className="rounded-2xl border border-blue-200 bg-blue-50/50 px-5 py-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id="dashboard-guide-title" className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
        <Compass size={16} className="text-blue-600" aria-hidden="true" />
        대시보드 사용법
      </h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUserGuide}
          className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-bold text-blue-700 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          앱별 사용자 가이드 <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="사용법 닫기"
          title="닫기 — 도움말·자료 메뉴에서 다시 열 수 있습니다"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <X size={15} />
        </button>
      </div>
    </div>
    {/* 실제 순서가 있는 절차라 번호를 쓴다 */}
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {GUIDE_STEPS.map(({ icon: Icon, title, body }, i) => (
        <li key={title} className="flex gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-blue-100">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-extrabold text-white tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <Icon size={14} className="text-blue-600" aria-hidden="true" /> {title}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);

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

const DropZone = ({ catalogue, isBlocked, onOpenApp, onActiveChange }) => {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState(null); // { files: File[], names, formats: Set }
  const inputRef = useRef(null);
  // 추천이 떠 있는 동안 부모가 바로가기 타일을 접는다 — 추천 목록이 그 자리를 써서 카드 높이가 유지된다.
  useEffect(() => { onActiveChange?.(!!dropped); }, [dropped, onActiveChange]);

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
    // 파일을 들고 갈 수 있는 앱을 위로 — 같은 조건이면 카탈로그 순서 유지
    const ordered = [...matches].sort((x, y) =>
      Number(FILE_HANDOFF_MENUS.has(getAppMenuName(y.title))) - Number(FILE_HANDOFF_MENUS.has(getAppMenuName(x.title))));
    return (
      <div
        className={`rounded-xl border p-3 transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-blue-200 bg-blue-50/40'}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      >
        {/* 머리: 놓은 파일 + 다른 파일 / 닫기 */}
        <div className="flex items-start gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-blue-200">
            <FileUp size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-800" title={dropped.names.join(', ')}>
              {dropped.names[0]}{dropped.names.length > 1 && <span className="font-medium text-slate-500"> 외 {dropped.names.length - 1}개</span>}
            </p>
            <p className="text-xs text-slate-600">
              {formatText} · 이 파일로 할 수 있는 해석 <b className="tabular-nums text-blue-700">{matches.length}</b>개
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            다른 파일
          </button>
          <button
            type="button"
            onClick={() => setDropped(null)}
            aria-label="추천 닫기"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <X size={15} />
          </button>
        </div>

        {/* 앱 목록 — 한 줄에 하나, 행 전체가 누르는 자리(좁은 칩은 고르기 어려웠다).
            왼쪽 썸네일은 바로가기 타일·카탈로그 카드와 같은 도면 띠(모눈 + 분류 선화)다. */}
        {ordered.length > 0 ? (
          <ul className="mt-3 max-h-[336px] space-y-1 overflow-y-auto pr-0.5">{/* 바로가기 타일 자리 높이 — 넘치면 스크롤 */}
            {ordered.map((app, rowIndex) => {
              const menu = getAppMenuName(app.title);
              const carries = FILE_HANDOFF_MENUS.has(menu);
              const tone = TILE_BAND[app.mode] || TILE_BAND.File;
              const artName = resolveCardArt(app);
              return (
                <motion.li
                  key={app.title}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: EASE_OUT, delay: rowIndex * 0.035 }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (carries) offerDashboardFiles(menu, dropped.files);
                      onOpenApp(app.title);
                    }}
                    className="group flex min-h-[46px] w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left transition-[border-color,box-shadow] hover:border-blue-400 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span
                      className={`relative h-9 w-12 shrink-0 overflow-hidden rounded-md bg-gradient-to-b ring-1 ring-inset ring-slate-200 ${tone.band} to-white`}
                      style={{ backgroundImage: `radial-gradient(circle, ${tone.dot} 1px, transparent 1.2px)`, backgroundSize: '8px 8px' }}
                      aria-hidden="true"
                    >
                      {artName && (
                        <CardArt
                          name={artName}
                          drawDelay={rowIndex * 50}
                          className={`absolute left-1/2 top-1/2 h-[23px] w-[44px] -translate-x-1/2 -translate-y-1/2 transition-colors ${tone.art}`}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold leading-[18px] text-slate-800 group-hover:text-blue-700">{app.title}</span>
                      <span className="block truncate text-[11.5px] leading-4 text-slate-500" title={app.description}>
                        {app.category && <span className={`font-bold ${tone.tag}`}>{app.category}</span>}
                        {app.category && app.description && <span className="mx-1 text-slate-300" aria-hidden="true">·</span>}
                        {app.description}
                      </span>
                    </span>
                    {/* 대부분 앱이 파일을 들고 가므로 예외('다시 선택')만 표시한다 — 전부 붙이면 제목만 잘린다 */}
                    {!carries && (
                      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600" title="이 앱은 화면에서 파일을 다시 선택해야 합니다">
                        다시 선택
                      </span>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" />
                  </button>
                </motion.li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-600">
            이 형식을 입력으로 받는 앱이 없습니다. BDF · CSV · PDF · F06 파일을 넣어 보세요.
          </p>
        )}
        {ordered.length > 0 && (
          <p className="mt-2 px-0.5 text-[11px] text-slate-500">
            앱을 고르면 이 파일을 가지고 바로 이동합니다{ordered.some(app => !FILE_HANDOFF_MENUS.has(getAppMenuName(app.title))) ? " — '다시 선택' 앱은 화면에서 파일을 다시 고르세요" : ''}.
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
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

// 앱 타일의 도면 띠 — 앱 카탈로그 카드(ui/AppCard)와 같은 문법(모눈 + 구조 선화)을 작게 줄인 것.
// 모드 색은 카탈로그와 같다(File=blue · Interactive=violet · Parametric=emerald · Productivity=amber).
const TILE_BAND = {
  File: { band: 'from-blue-50/80', dot: '#c9d8f4', art: 'text-blue-300 group-hover:text-blue-600', tag: 'text-blue-800' },
  Interactive: { band: 'from-violet-50/80', dot: '#ddd3f7', art: 'text-violet-300 group-hover:text-violet-600', tag: 'text-violet-800' },
  Parametric: { band: 'from-emerald-50/80', dot: '#c6ead9', art: 'text-emerald-300 group-hover:text-emerald-600', tag: 'text-emerald-800' },
  Productivity: { band: 'from-amber-50/80', dot: '#f1dfb5', art: 'text-amber-300 group-hover:text-amber-600', tag: 'text-amber-800' },
};

const QuickAppTile = ({ app, meta, isFavorite, onOpen, onToggleFavorite, index = 0 }) => {
  const tone = TILE_BAND[app.mode] || TILE_BAND.File;
  const artName = resolveCardArt(app);
  return (
    <div className="group relative flex min-h-[112px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-blue-300 hover:shadow-md motion-reduce:transform-none">
      <div
        className={`relative h-9 shrink-0 border-b border-slate-100 bg-gradient-to-b ${tone.band} to-white`}
        style={{ backgroundImage: `radial-gradient(circle, ${tone.dot} 1px, transparent 1.2px)`, backgroundSize: '10px 10px' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/70 to-transparent" aria-hidden="true" />
        {artName && (
          <CardArt
            name={artName}
            drawDelay={index * 60}
            className={`pointer-events-none absolute right-8 top-1 h-7 w-[54px] transition-colors duration-200 ${tone.art}`}
          />
        )}
        {/* 분류 이름(없으면 모드) — 선화와 짝이라 어떤 그림인지 말해 준다 */}
        {/* 흰 바탕 이름표 — 좁은 타일(1366 폭 3열)에서 선화가 글자 밑으로 들어와도 읽힌다 */}
        <span className={`absolute left-2.5 top-1/2 z-[1] max-w-[62%] -translate-y-1/2 truncate rounded-full bg-white/90 px-1.5 py-px text-[10.5px] font-bold ${tone.tag}`}>
          {app.category || MODE_LABEL[app.mode] || app.mode}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-3 pb-2.5 pt-2">
        <h3 className="line-clamp-2 break-keep text-[13px] font-bold leading-snug text-slate-800" title={app.title}>{app.title}</h3>
        {meta && <p className="mt-auto pt-1 text-[11px] font-semibold text-slate-500">{meta}</p>}
      </div>
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

// 끝난 직후 잠깐 보이는 모습. 진행 중(파랑) → 완료(초록)/실패(빨강)로 바뀌는 순간이 곧 알림이다.
const LIVE_DONE = {
  Success: { icon: CheckCircle2, iconCls: 'text-emerald-600', box: 'border-emerald-200 bg-emerald-50/60', bar: 'bg-emerald-500', track: 'bg-emerald-100', pct: 'text-emerald-700', text: '완료 — 아래 결과 목록에 추가했습니다' },
  Failed: { icon: XCircle, iconCls: 'text-red-600', box: 'border-red-200 bg-red-50/60', bar: 'bg-red-500', track: 'bg-red-100', pct: 'text-red-700', text: '실패 — 아래 목록에서 사유를 확인하세요' },
};
LIVE_DONE.Interrupted = LIVE_DONE.Failed;
LIVE_DONE.Cancelled = { ...LIVE_DONE.Failed, icon: XCircle, iconCls: 'text-slate-500', box: 'border-slate-200 bg-slate-50', bar: 'bg-slate-400', track: 'bg-slate-200', pct: 'text-slate-600', text: '중단됨' };

const LiveJobRow = ({ job, onOpen }) => {
  const done = LIVE_DONE[job.status];
  const progress = done && job.status === 'Success' ? 100 : Math.min(100, Math.max(0, Number(job.progress) || 0));
  const elapsed = done ? '' : formatElapsed(job.startedAt);
  const Icon = done?.icon || Loader2;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <button
        type="button"
        onClick={onOpen}
        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
          done ? done.box : 'border-blue-200 bg-blue-50/50 hover:bg-blue-50'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {/* 회전 아이콘 → 체크/엑스로 바뀌는 순간을 짧은 크기·투명도 전환으로 */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={done ? job.status : 'running'}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="inline-flex shrink-0"
            >
              <Icon size={16} className={done ? done.iconCls : 'animate-spin text-blue-600'} aria-hidden="true" />
            </motion.span>
          </AnimatePresence>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{job.displayName || job.menu}</span>
          <span className={`shrink-0 text-xs font-bold tabular-nums ${done ? done.pct : 'text-blue-700'}`}>
            {/* 실패·중단에 '100%' 를 쓰면 다 끝난 것처럼 읽힌다 — 상태 낱말로 바꾼다 */}
            {done && job.status !== 'Success'
              ? (job.status === 'Cancelled' ? '중단' : '실패')
              : <><AnimatedNumber value={progress} />%</>}
          </span>
        </div>
        <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${done ? done.track : 'bg-blue-100'}`}>
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${done ? done.bar : 'progress-flow bg-blue-600'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span className="truncate">{done ? done.text : (job.message || '실행 중')}</span>
          {elapsed && <span className="shrink-0 tabular-nums">경과 {elapsed}</span>}
        </div>
      </button>
    </motion.li>
  );
};

// 결과 판정 칩 — 글자(OK/NG·검증 오류)가 판정을 말하고 색은 거든다(색맹 사용자 대응).
const HIGHLIGHT_TONE = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  ng: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const HighlightChip = ({ highlight }) => (highlight ? (
  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${HIGHLIGHT_TONE[highlight.tone] || HIGHLIGHT_TONE.info}`}>
    {highlight.label}
  </span>
) : null);

const statusOf = (project) => RESULT_STATUS[project.status] || { icon: Clock, cls: 'text-slate-500', label: project.status || '대기' };

/**
 * 성공·취소 등 한 줄 행. 같은 앱·같은 입력을 연달아 돌렸으면 한 줄로 묶고(groupConsecutiveRuns),
 * 오른쪽 '×N' 을 누르면 회차별 줄이 펼쳐진다. 행 본체는 가장 최근 회차의 상세를 연다.
 */
const ResultGroupRow = ({ group, expanded, onToggle, onDetail }) => {
  const { head, runs } = group;
  const status = statusOf(head);
  const Icon = status.icon;
  const count = runs.length;
  const subtitle = inputFileLabel(head) || head.project_name || '이름 없는 프로젝트';
  const oldest = runs[runs.length - 1];
  const timeTitle = count > 1
    ? `${formatAbsolute(oldest.created_at)} ~ ${formatAbsolute(head.created_at)} · ${count}회 실행`
    : formatAbsolute(head.created_at);
  const listId = `result-group-${group.id}`;

  return (
    <motion.li layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
      <div className="group flex items-center rounded-lg transition-colors hover:bg-slate-50">
        <button
          type="button"
          onClick={() => onDetail(head)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <Icon size={15} className={`shrink-0 ${status.cls}`} aria-label={status.label} />
          <span className="shrink-0 text-sm font-bold text-slate-800" title={head.program_name}>{getDisplayProgramName(head.program_name)}</span>
          {/* 이미 처리했거나 7일이 지난 실패는 큰 카드 대신 이 한 줄로 — 글자로도 '실패' 를 말한다 */}
          {FAILED_STATUSES.has(head.status) && <span className={`shrink-0 text-xs font-bold ${status.cls}`}>{status.label}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={head.project_name}>{subtitle}</span>
          <HighlightChip highlight={resultHighlight(head)} />
          <span className="shrink-0 text-xs tabular-nums text-slate-500" title={timeTitle}>{formatRelative(head.created_at)}</span>
          {count === 1 && <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-600" />}
        </button>
        {count > 1 && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={listId}
            title={expanded ? '회차 접기' : `같은 입력으로 ${count}번 실행 — 회차별로 보기`}
            className="mr-1 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-slate-100 px-1.5 text-[11px] font-bold tabular-nums text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            ×{count}
            <ChevronDown size={13} className={`transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
      {count > 1 && expanded && (
        <motion.ul
          id={listId}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT }}
          className="mb-1 ml-[18px] overflow-hidden border-l border-slate-200 pl-3"
        >
          {runs.map((run, index) => {
            const runStatus = statusOf(run);
            const RunIcon = runStatus.icon;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onDetail(run)}
                  className="group/run flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <RunIcon size={13} className={`shrink-0 ${runStatus.cls}`} aria-label={runStatus.label} />
                  <span className="w-10 shrink-0 font-semibold tabular-nums text-slate-500">{count - index}회차</span>
                  <span className="min-w-0 flex-1 truncate tabular-nums text-slate-600">{formatAbsolute(run.created_at)}</span>
                  <HighlightChip highlight={resultHighlight(run)} />
                  <ChevronRight size={13} className="shrink-0 text-slate-300 group-hover/run:text-blue-600" />
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
      </AnimatePresence>
    </motion.li>
  );
};

/** 실패 행 — 묶지 않는다. 사유 한 줄과 '같은 앱에서 새로 시작'·'상세·로그' 동작을 붙인다. */
const FailedResultRow = ({ project, onDetail, onRestart }) => {
  const status = statusOf(project);
  const Icon = status.icon;
  const appTitle = getDisplayProgramName(project.program_name);
  const subtitle = inputFileLabel(project) || project.project_name || '이름 없는 프로젝트';
  const when = (
    <span className="shrink-0 text-xs tabular-nums text-slate-500" title={formatAbsolute(project.created_at)}>
      {formatRelative(project.created_at)}
    </span>
  );
  const reason = failureReason(project);
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${status.cls}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-sm font-bold text-slate-800" title={project.program_name}>{appTitle}</span>
            <span className={`shrink-0 text-xs font-bold ${status.cls}`}>{status.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={project.project_name}>{subtitle}</span>
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
    </motion.li>
  );
};

// ─────────────────────────────────────────────────────────────── 하단 참고 지표
// 위 두 카드(새 해석 시작·내 작업)는 '일하는 곳', 여기는 '흘끗 보는 곳'이다.
// 그림자·그라데이션 띠·큰 섹션 제목 없이 반투명 흰 띠 하나에 담아 한 단계 물러나 보이게 하고,
// 안쪽은 큰 숫자 하나 + 작은 추이 막대 / 순위 + 데이터 막대로 정돈한다. 좌우 폭은 위 격자와 같은 5 : 7.

const ReferenceLabel = ({ icon: Icon, children, meta }) => (
  <p className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-600">
    {Icon && <Icon size={13} className="text-slate-400" aria-hidden="true" />}
    {children}
    {meta && <span className="font-medium text-slate-400">· {meta}</span>}
  </p>
);

/** 월별 실행 — 이번 달 건수를 크게, 6개월 추이는 옆에 작은 막대로. 정확한 값은 막대에 마우스를 올리면 보인다. */
const MonthlyTrendStrip = ({ months, loading, successRate }) => {
  const max = Math.max(1, ...months.map(m => m.count));
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  const bars = loading ? Array.from({ length: TREND_MONTHS }, (_, i) => ({ label: `m${i}`, count: 0 })) : months;
  return (
    <div>
      <ReferenceLabel icon={TrendingUp}>내 월별 실행</ReferenceLabel>
      <div className="flex items-end gap-5">
        <div className="shrink-0">
          <p className="leading-none">
            <span className="text-[28px] font-extrabold tabular-nums tracking-tight text-slate-800">{loading ? '–' : <AnimatedNumber value={current?.count ?? 0} />}</span>
            <span className="ml-0.5 text-sm font-bold text-slate-500">건</span>
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-500">{current ? `${current.label} 실행` : '이번 달 실행'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {/* 개인 건수는 테스트 실행이 섞여 들쭉날쭉하다 — 증감 대신 지난달 값을 그대로 둔다 */}
            {previous && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                지난달 <span className="tabular-nums">{previous.count}</span>
              </span>
            )}
            {successRate != null && (
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                누적 성공률 <span className="tabular-nums">{successRate}%</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-end gap-1.5" role="img" aria-label={months.map(m => `${m.label} ${m.count}건`).join(', ')}>
          {bars.map((m, i) => {
            const isCurrent = i === bars.length - 1;
            return (
              <div key={m.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={loading ? undefined : `${m.label} ${m.count}건`}>
                <div className="flex h-14 w-full max-w-[28px] items-end">
                  <div
                    className={`w-full rounded-t-md transition-colors ${
                      loading ? 'animate-pulse bg-slate-200'
                        : `bar-grow-y ${isCurrent ? 'bg-gradient-to-t from-brand-blue to-sky-400' : 'bg-slate-200 hover:bg-slate-300'}`
                    }`}
                    style={{
                      height: loading ? `${30 + i * 10}%` : `${Math.max(6, (m.count / max) * 100)}%`,
                      // 옛 달부터 차례로 자라 이번 달에서 끝난다
                      '--bar-delay': `${i * 55}ms`,
                    }}
                  />
                </div>
                <span className={`text-[10px] leading-none ${isCurrent ? 'font-bold text-brand-blue' : 'text-slate-400'}`}>
                  {loading ? '' : m.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// 1~3위는 은은한 메달 색, 나머지는 회색
const RANK_STYLE = [
  'bg-amber-100 text-amber-700',
  'bg-slate-200 text-slate-600',
  'bg-orange-100 text-orange-700',
];

/** 많이 쓰는 앱 — 두 열 순위(위→아래), 이름 아래 가는 데이터 막대로 차이를 보여 준다. 누르면 그 앱으로 간다. */
const PopularStrip = ({ rows, loading, onOpen }) => {
  const max = rows[0]?.count || 1;
  return (
    <div>
      <ReferenceLabel icon={Trophy} meta="최근 30일 · 전체 사용자">많이 쓰는 앱</ReferenceLabel>
      {loading ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">최근 30일 사용 기록이 없습니다.</p>
      ) : (
        // 순위는 위→아래로 읽히게 열 우선 배치(1·2·3 | 4·5)
        <ol className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
          {rows.map((item, i) => (
            <li key={item.program_name}>
              <button
                type="button"
                onClick={() => onOpen(item.program_name)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold tabular-nums ${RANK_STYLE[i] || 'bg-slate-100 text-slate-500'}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700 group-hover:text-blue-700" title={item.program_name}>
                      {getDisplayProgramName(item.program_name)}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{item.count}</span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="bar-grow-x block h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500"
                      style={{ width: `${(item.count / max) * 100}%`, '--bar-delay': `${i * 60}ms` }}
                    />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
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
  const [recentFailures, setRecentFailures] = useState([]); // 최근 7일 Failed·Interrupted
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [historyToken, setHistoryToken] = useState(0);
  // true 면 다음 이력 조회는 스켈레톤을 띄우지 않는다(작업 완료 후 새로고침 — 목록이 깜빡이지 않게)
  const quietHistoryRef = useRef(false);
  const [clock, setClock] = useState(() => Date.now());
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
  const [favoritePage, setFavoritePage] = useState(0);
  // 펼친 실행 묶음은 하나만 — 여러 개를 펼치면 카드가 길어져 왼쪽과 높이가 어긋난다
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return localStorage.getItem(GUIDE_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const [guideRequested, setGuideRequested] = useState(false);
  const isDropBlocked = useCallback((app) => isBlockedFor(app, admin), [isBlockedFor, admin]);
  const [modal, setModal] = useState(null); // 'intro' | 'roadmap' | 'video' | 'newsletter'
  const [notice, setNotice] = useState(null);

  // ── 데이터 ─────────────────────────────────────────────
  useEffect(() => {
    if (!employeeId) return undefined;
    let cancelled = false;
    if (!quietHistoryRef.current) setHistoryLoading(true);
    quietHistoryRef.current = false;
    setHistoryError(null);
    getAnalysisHistory(employeeId, 0, HISTORY_FETCH)
      .then(res => { if (!cancelled) setHistory(res.data?.items ?? res.data ?? []); })
      .catch(() => { if (!cancelled) { setHistory([]); setHistoryError('작업 이력을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    // 실패는 상태 필터로 따로 받는다 — 최근 N건만 보면 성공 실행에 밀려 칩 숫자와 목록이 어긋난다.
    const weekAgo = Date.now() - 7 * 86400000;
    Promise.all(['Failed', 'Interrupted'].map(status =>
      getAnalysisHistory(employeeId, 0, 20, { status })
        .then(res => res.data?.items ?? [])
        .catch(() => [])))
      .then(([failed, interrupted]) => {
        if (cancelled) return;
        setRecentFailures([...failed, ...interrupted]
          .filter(p => Date.parse(p.created_at) >= weekAgo)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
      });
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
  // 즐겨찾기는 6개씩 한 쪽 — 넘치면 좌우 화살표로 넘긴다(펼치면 카드가 길어져 오른쪽 '내 작업'과 높이가 어긋났다)
  const favoritePages = [];
  for (let i = 0; i < favoriteApps.length; i += QUICK_APP_COUNT) favoritePages.push(favoriteApps.slice(i, i + QUICK_APP_COUNT));
  const favoritePageCount = favoritePages.length;
  // 별을 해제해 쪽 수가 줄면 마지막 쪽으로 당긴다
  const currentFavoritePage = Math.min(favoritePage, Math.max(0, favoritePageCount - 1));

  // ── 내 작업 ─────────────────────────────────────────────
  const liveJobs = globalJobs.filter(job => !isTerminalJobStatus(job.status));
  // 방금 끝난 작업은 FINISHED_LINGER_MS 동안 '진행 중' 자리에서 완료/실패로 바뀐 모습을 보여 준다.
  const justFinished = globalJobs.filter(job => isTerminalJobStatus(job.status)
    && job.completedAt && clock - job.completedAt < FINISHED_LINGER_MS);
  const liveRows = [...liveJobs, ...justFinished];
  const justFinishedKey = justFinished.map(job => job.jobId).join(',');
  useEffect(() => {
    if (!justFinishedKey) return undefined;
    const timer = setTimeout(() => setClock(Date.now()), FINISHED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [justFinishedKey]);
  // 작업이 끝나면 결과 목록을 조용히(스켈레톤 없이) 다시 받아 새 결과가 위로 들어오게 한다.
  const finishedKey = globalJobs.filter(job => isTerminalJobStatus(job.status)).map(job => job.jobId).join(',');
  const prevFinishedKey = useRef(finishedKey);
  useEffect(() => {
    if (prevFinishedKey.current === finishedKey) return;
    prevFinishedKey.current = finishedKey;
    quietHistoryRef.current = true;
    setClock(Date.now());
    setHistoryToken(v => v + 1);
  }, [finishedKey]);
  // 확인할 실패 = 최근 7일 실패 중 그 뒤로 같은 앱이 아직 성공하지 않은 것.
  // 다시 돌려 성공했다면 이미 처리한 실패다. 상단 칩과 목록 맨 위 고정이 같은 기준을 쓴다.
  const openFailures = unresolvedFailures(recentFailures, history);
  const pinnedFailures = openFailures.slice(0, PINNED_FAILURE_MAX);
  const pinnedIds = new Set(pinnedFailures.map(p => p.id));
  // 고정 실패는 각자 한 줄, 나머지는 같은 앱·같은 입력의 연속 실행을 묶는다. 개수 제한은 '줄' 기준.
  const resultGroups = [
    ...pinnedFailures.map(p => ({ id: p.id, head: p, runs: [p] })),
    ...groupConsecutiveRuns(history.filter(p => !pinnedIds.has(p.id)), inputFileLabel),
  ].slice(0, RECENT_RESULT_COUNT);
  const openFailedProjects = () => {
    try { sessionStorage.setItem(MY_PROJECTS_STATUS_FILTER_KEY, JSON.stringify({ value: 'Failed', at: Date.now() })); } catch { /* 필터 없이 이동 */ }
    setCurrentMenu('My Projects');
  };

  // 사용법 — 메뉴로 부르면 항상, 아니면 실행 이력이 거의 없는 사람에게만 저절로(닫은 적이 없을 때)
  const showGuide = guideRequested
    || (!guideDismissed && !historyLoading && !historyError && history.length < GUIDE_AUTO_MAX_RUNS);
  const closeGuide = () => {
    setGuideRequested(false);
    setGuideDismissed(true);
    try { localStorage.setItem(GUIDE_DISMISSED_KEY, '1'); } catch { /* 이번 화면에서만 닫힘 */ }
  };

  const firstName = user?.name || employeeId || '';
  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const serverOffline = serverQueue?.online === false;
  const serverPending = Number(serverQueue?.pending) || 0;
  const serverLabel = serverOffline
    ? '끊김'
    : serverQueue
      ? `${serverQueue.running ?? 0} / ${serverQueue.limit ?? 0}${serverPending > 0 ? ` · 대기 ${serverPending}` : ''}`
      : '-';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 pb-24">

      {/* ── 인사 줄 ── */}
      {/* overflow-hidden 을 바깥에 두면 '자료' 드롭다운이 잘린다 → 워터마크만 안쪽 층에서 자른다 */}
      <div className="relative z-20 rounded-2xl border border-brand-blue/10 bg-gradient-to-r from-brand-blue via-[#07315d] to-slate-900 shadow-sm">
        {/* 배경 무늬 = 카드와 같은 트러스 선화. 화면을 열 때 한 번 천천히 그려지고 옅은 무늬로 남는다.
            절점은 비워 둔다(--art-node) — 흰 채움이면 어두운 띠 위에 점으로 튄다. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true" style={{ '--art-node': 'transparent' }}>
          <CardArt
            name="truss"
            className="absolute -bottom-3 right-4 h-[100px] w-[193px] text-white/[0.06]"
            style={{ '--draw-duration': '1400ms' }}
            drawDelay={150}
          />
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
              label="확인할 실패"
              value={openFailures.length}
              tone={openFailures.length > 0 ? 'danger' : 'neutral'}
              onClick={recentFailures.length > 0 ? openFailedProjects : undefined}
              title={`최근 7일 실패 ${recentFailures.length}건 중 이후 같은 앱이 아직 성공하지 않은 건${recentFailures.length > 0 ? ' · 누르면 실패 목록' : ''}`}
            />
            {/* 서버가 동시에 돌리는 해석 수(실행 중 / 최대 슬롯) — 전 사용자 합계. 꽉 차면 새 해석은 대기열에 선다. */}
            <StatusChip
              icon={Server}
              label="서버 해석 현황"
              value={serverLabel}
              tone={serverOffline ? 'danger' : serverPending > 0 ? 'running' : 'neutral'}
              title={serverOffline
                ? '해석 서버에 연결할 수 없습니다'
                : `서버에서 지금 돌아가는 해석 ${serverQueue?.running ?? 0}건 / 동시에 돌릴 수 있는 최대 ${serverQueue?.limit ?? 0}건 (전체 사용자)`
                  + (serverPending > 0 ? ` · 대기 ${serverPending}건 — 새 해석은 앞 작업이 끝나면 시작됩니다` : ' · 지금 실행하면 바로 시작됩니다')}
            />
            <span className="mx-0.5 hidden h-6 w-px bg-white/15 lg:block" aria-hidden="true" />
            <ResourceMenu
              onGuide={() => setGuideRequested(true)}
              onUserGuide={() => setCurrentMenu('User Guide')}
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
        pinnedWithinDays={30}
        hideAfterDays={60}
        onOpenDetail={(n) => setNotice(n)}
        onOpenList={() => setCurrentMenu('Notice & Updates')}
      />

      {showGuide && <DashboardGuide onClose={closeGuide} onUserGuide={() => setCurrentMenu('User Guide')} />}

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
            <DropZone catalogue={catalogue} isBlocked={isDropBlocked} onOpenApp={openApp} onActiveChange={setDropActive} />
            {/* 파일 추천이 떠 있는 동안은 추천 목록이 이 자리를 쓴다(닫으면 그대로 돌아온다) */}
            <div hidden={dropActive}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <QuickTabs
                  active={activeQuickTab}
                  onSelect={selectQuickTab}
                  favoriteCount={favoriteApps.length}
                />
                {activeQuickTab === 'favorites' && favoritePageCount > 1 && (
                  <div className="flex items-center gap-1" role="group" aria-label="즐겨찾기 쪽 이동">
                    <span className="mr-1 text-xs font-bold tabular-nums text-slate-500" aria-live="polite">
                      {currentFavoritePage + 1} / {favoritePageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFavoritePage(Math.max(0, currentFavoritePage - 1))}
                      disabled={currentFavoritePage === 0}
                      aria-label="이전 즐겨찾기"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFavoritePage(Math.min(favoritePageCount - 1, currentFavoritePage + 1))}
                      disabled={currentFavoritePage >= favoritePageCount - 1}
                      aria-label="다음 즐겨찾기"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-slate-200 disabled:hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
              {activeQuickTab === 'favorites' ? (
                favoriteApps.length === 0 ? (
                  <QuickEmpty>
                    즐겨찾기한 앱이 없습니다. 타일이나 앱 목록의 <Star size={11} className="inline -mt-0.5 text-amber-400" fill="currentColor" /> 를 누르면 여기에 고정됩니다.
                  </QuickEmpty>
                ) : (
                  // 모든 쪽을 가로로 늘어놓고 translateX 로 민다 — 높이는 가장 큰 쪽(6개)에 고정돼
                  // 마지막 쪽에 타일이 적어도 카드 높이가 흔들리지 않는다.
                  <div className="overflow-hidden">
                    <div
                      className="flex transition-transform duration-300 ease-out motion-reduce:transition-none"
                      style={{ transform: `translateX(-${currentFavoritePage * 100}%)` }}
                    >
                      {favoritePages.map((page, pageIndex) => (
                        <div
                          key={pageIndex}
                          className="grid w-full shrink-0 grid-cols-2 content-start gap-2 sm:grid-cols-3"
                          aria-hidden={pageIndex !== currentFavoritePage}
                          inert={pageIndex !== currentFavoritePage ? '' : undefined}
                        >
                          {page.map((app, tileIndex) => (
                            <QuickAppTile
                              key={app.title}
                              index={tileIndex}
                              app={app}
                              meta={visitedAt[app.title] ? `마지막 사용 ${formatRelative(visitedAt[app.title])}` : '아직 사용 안 함'}
                              isFavorite
                              onOpen={() => openApp(app.title)}
                              onToggleFavorite={() => toggleFavorite(favoriteStoredByTitle[app.title] ?? app.title)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : recentAppList.length === 0 ? (
                <QuickEmpty>아직 사용한 앱이 없습니다. 앱을 열면 최근 순서대로 여기에 쌓입니다.</QuickEmpty>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {recentAppList.map(({ app, at }, tileIndex) => {
                    const stored = favoriteStoredByTitle[app.title];
                    return (
                      <QuickAppTile
                        key={app.title}
                        index={tileIndex}
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
          <Card className="flex-1 p-3">
            {liveRows.length > 0 && <p className="px-1 pb-1.5 pt-1 text-xs font-bold text-slate-500">진행 중</p>}
            <ul className={liveRows.length > 0 ? 'mb-2 space-y-1.5' : undefined}>
              <AnimatePresence initial={false}>
                {liveRows.map(job => (
                  <LiveJobRow key={job.jobId} job={job} onOpen={() => setCurrentMenu(job.menu)} />
                ))}
              </AnimatePresence>
            </ul>
            {liveRows.length > 0 && <p className="px-1 pb-1.5 pt-1 text-xs font-bold text-slate-500">최근 결과</p>}
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
            ) : resultGroups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                아직 실행한 해석이 없습니다. 왼쪽에서 입력 파일로 새 해석을 시작하세요.
              </p>
            ) : (
              <ul className="space-y-1">
                <AnimatePresence initial={false}>
                {/* 큰 실패 카드는 '확인할 실패'(상단 칩과 같은 기준)만. 나머지 실패는 한 줄 행.
                    처음 그릴 때는 그대로, 작업이 끝나 새 결과가 생기면 그 줄만 위에서 들어온다. */}
                {resultGroups.map(group => (pinnedIds.has(group.id) ? (
                  <FailedResultRow
                    key={group.id}
                    project={group.head}
                    onDetail={() => openProjectDetail(group.head)}
                    onRestart={() => openProgram(group.head.program_name)}
                  />
                ) : (
                  <ResultGroupRow
                    key={group.id}
                    group={group}
                    expanded={expandedGroup === group.id}
                    onToggle={() => setExpandedGroup(prev => (prev === group.id ? null : group.id))}
                    onDetail={openProjectDetail}
                  />
                )))}
                </AnimatePresence>
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── 참고 지표 — 제목은 위 두 섹션과 같은 틀, 본문은 그림자 없는 평평한 띠로 한 단계 물러나 보이게 ── */}
      <section aria-labelledby="dashboard-reference-title" className="mt-4">
        <SectionHeader icon={BarChart3} title={<span id="dashboard-reference-title">참고 지표</span>} accent="history" />
        <div className="grid grid-cols-1 gap-4 rounded-2xl bg-white/70 px-5 py-4 ring-1 ring-slate-200/70 xl:grid-cols-12 xl:gap-0">
          <div className="xl:col-span-5 xl:pr-6">
            <MonthlyTrendStrip months={months} loading={monthsLoading} successRate={successRate} />
          </div>
          <div className="border-t border-slate-100 pt-4 xl:col-span-7 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
            <PopularStrip rows={popular} loading={popularLoading} onOpen={openProgram} />
          </div>
        </div>
      </section>

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
