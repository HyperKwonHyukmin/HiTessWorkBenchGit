/// <summary>
/// 분석 앱 카드 컴포넌트입니다.
/// NewAnalysis, InteractiveApps, ParametricApps 등 앱 목록 페이지에서 공통으로 사용합니다.
/// framer-motion 기반 hover/tap 마이크로인터랙션과 개선된 devStatus 뱃지를 포함합니다.
/// </summary>
import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock } from 'lucide-react';
import Badge from './Badge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

const ACCENT_BORDER_CLASSES = {
  blue:    'hover:border-blue-400',
  violet:  'hover:border-violet-400',
  emerald: 'hover:border-emerald-400',
  purple:  'hover:border-purple-400',
};

const ACCENT_TITLE_CLASSES = {
  blue:    'group-hover:text-blue-600',
  violet:  'group-hover:text-violet-600',
  emerald: 'group-hover:text-emerald-600',
  purple:  'group-hover:text-purple-600',
};

// hover 시 상단에 나타나는 accent 컬러 상단 바
const ACCENT_TOP_BAR = {
  blue:    'bg-blue-500',
  violet:  'bg-violet-500',
  emerald: 'bg-emerald-500',
  purple:  'bg-purple-500',
};

/**
 * devStatus → Badge 매핑
 * - 'Active' / 'stable' : 뱃지 없음
 * - 'Developing' / 'dev': 개발중 (warning)
 * - 'Planned'           : 출시 예정 (info)
 */
function DevStatusBadge({ devStatus }) {
  if (!devStatus || devStatus === 'Active' || devStatus === 'stable') return null;
  if (devStatus === 'Developing' || devStatus === 'dev') {
    return <Badge variant="warning" size="sm" dot>개발중</Badge>;
  }
  if (devStatus === 'Planned') {
    return <Badge variant="info" size="sm" dot>출시 예정</Badge>;
  }
  return null;
}

/**
 * AppCard 컴포넌트
 *
 * @param {object}   props
 * @param {object}   props.app
 * @param {string}   props.app.title
 * @param {string}   [props.app.description]
 * @param {React.ReactNode} [props.app.icon]
 * @param {string}   [props.app.iconBg]        - 아이콘 배경 Tailwind 클래스 (예: 'bg-cyan-600')
 * @param {string[]} [props.app.tags]
 * @param {'Active'|'Developing'|'Planned'|'stable'|'dev'} [props.app.devStatus]
 * @param {'blue'|'violet'|'emerald'|'purple'} [props.accentColor='blue']
 * @param {boolean}  [props.isFavorite=false]
 * @param {boolean}  [props.isRestricted=false] - 비관리자 접근 제한 여부 (잠금 UI 표시)
 * @param {() => void} [props.onFavorite]
 * @param {() => void} [props.onStart]
 */
export default function AppCard({
  app = {},
  accentColor = 'blue',
  isFavorite = false,
  isRestricted = false,
  onFavorite,
  onStart,
}) {
  const {
    title       = '',
    description = '',
    icon,
    iconBg      = 'bg-blue-100',
    tags        = [],
    devStatus,
    contributor,
  } = app;

  const accentBorderClass = ACCENT_BORDER_CLASSES[accentColor] ?? ACCENT_BORDER_CLASSES.blue;
  const accentTitleClass  = ACCENT_TITLE_CLASSES[accentColor]  ?? ACCENT_TITLE_CLASSES.blue;
  const accentTopBarClass = ACCENT_TOP_BAR[accentColor]        ?? ACCENT_TOP_BAR.blue;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart?.(); }}
      className={[
        'group relative bg-white p-8 rounded-2xl overflow-hidden',
        'border border-slate-200 shadow-sm',
        'cursor-pointer flex flex-col h-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-200',
        accentBorderClass,
      ].join(' ')}
      whileHover={{
        y: -6,
        boxShadow: '0 20px 40px -12px rgba(0, 37, 84, 0.15)',
        transition: { type: 'spring', stiffness: 350, damping: 28 },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      {/* ── 상단 accent 바 (hover 시 나타남) ── */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${accentTopBarClass} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}
        aria-hidden="true"
      />

      {/* ── 우상단: 즐겨찾기 별표 버튼 ── */}
      <motion.button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFavorite?.();
        }}
        className="absolute top-5 right-5 z-10 text-slate-300 hover:text-yellow-400 outline-none cursor-pointer"
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        whileTap={{ scale: 1.35 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      >
        <Star
          size={22}
          fill={isFavorite ? '#eab308' : 'transparent'}
          color={isFavorite ? '#eab308' : 'currentColor'}
        />
      </motion.button>

      {/* ── 아이콘 영역 ── */}
      <div className="relative w-14 h-14 rounded-xl mb-6 group-hover:scale-110 transition-transform duration-200 overflow-hidden shrink-0">
        <div className={`absolute inset-0 ${iconBg} opacity-10 group-hover:opacity-20 transition-opacity duration-200`} aria-hidden="true" />
        <div className="relative flex items-center justify-center w-full h-full">
          {icon}
        </div>
      </div>

      {/* ── 본문 영역 ── */}
      <div className="flex-1">
        {/* 제목 + 개발 상태 뱃지 */}
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          <h3 className={`text-xl font-bold text-slate-800 ${accentTitleClass} transition-colors leading-tight`}>
            {title}
          </h3>
          <DevStatusBadge devStatus={devStatus} />
        </div>

        {/* 설명 */}
        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          {description}
        </p>

        {/* 태그 목록 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className="text-[10px] font-bold px-2.5 py-1 bg-slate-50 text-slate-500 border border-slate-200 rounded-md uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

      </div>

      {/* ── Solver 기여자 (항상 하단 구분선 바로 위, 우측 정렬) ── */}
      {contributor && (
        <div className="flex items-center justify-end gap-1.5 mt-8 mb-1 text-xs text-slate-400">
          <User size={11} />
          <span>Solver Contributed by <span className="font-medium text-slate-500">{contributor}</span></span>
        </div>
      )}

      {/* ── 하단: 시작 버튼 영역 ── */}
      <div className={`${contributor ? 'mt-0' : 'mt-8'} pt-5 border-t border-slate-100 flex items-center font-bold text-sm ${
        isRestricted ? 'text-slate-400' : 'text-brand-blue'
      }`}>
        {isRestricted ? (
          <>
            <Lock size={13} className="mr-1.5 opacity-60" />
            <span className="opacity-60">관리자 전용</span>
          </>
        ) : (
          <>
            <span className="group-hover:opacity-80 transition-opacity">시작하기</span>
            <ArrowRight
              size={16}
              className="ml-1.5 group-hover:translate-x-1.5 transition-transform duration-200"
            />
          </>
        )}
      </div>
    </motion.div>
  );
}
