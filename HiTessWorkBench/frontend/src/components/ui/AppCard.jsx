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
  blue:    'hover:border-blue-300',
  violet:  'hover:border-violet-300',
  emerald: 'hover:border-emerald-300',
  purple:  'hover:border-purple-300',
  amber:   'hover:border-amber-300',
  indigo:  'hover:border-indigo-300',
  cyan:    'hover:border-cyan-300',
  teal:    'hover:border-teal-300',
};

const ACCENT_TITLE_CLASSES = {
  blue:    'group-hover:text-blue-600',
  violet:  'group-hover:text-violet-600',
  emerald: 'group-hover:text-emerald-600',
  purple:  'group-hover:text-purple-600',
  amber:   'group-hover:text-amber-600',
  indigo:  'group-hover:text-indigo-600',
  cyan:    'group-hover:text-cyan-600',
  teal:    'group-hover:text-teal-600',
};

// 아이콘 배경 박스 색상 (solid)
const ACCENT_ICON_BG = {
  blue:    'bg-blue-600',
  violet:  'bg-violet-600',
  emerald: 'bg-emerald-600',
  purple:  'bg-purple-600',
  amber:   'bg-amber-500',
  indigo:  'bg-indigo-600',
  cyan:    'bg-cyan-600',
  teal:    'bg-teal-600',
};

// 카드 배경 subtle tint (hover 시)
const ACCENT_CARD_HOVER_BG = {
  blue:    'hover:bg-blue-50/30',
  violet:  'hover:bg-violet-50/30',
  emerald: 'hover:bg-emerald-50/30',
  purple:  'hover:bg-purple-50/30',
  amber:   'hover:bg-amber-50/30',
  indigo:  'hover:bg-indigo-50/30',
  cyan:    'hover:bg-cyan-50/30',
  teal:    'hover:bg-teal-50/30',
};

// "시작하기" 텍스트 + 화살표 색
const ACCENT_CTA_CLASSES = {
  blue:    'text-blue-600',
  violet:  'text-violet-600',
  emerald: 'text-emerald-600',
  purple:  'text-purple-600',
  amber:   'text-amber-600',
  indigo:  'text-indigo-600',
  cyan:    'text-cyan-600',
  teal:    'text-teal-600',
};

// 태그 accent tint
const ACCENT_TAG_CLASSES = {
  blue:    'bg-blue-50 text-blue-600 border-blue-100',
  violet:  'bg-violet-50 text-violet-600 border-violet-100',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  purple:  'bg-purple-50 text-purple-600 border-purple-100',
  amber:   'bg-amber-50 text-amber-600 border-amber-100',
  indigo:  'bg-indigo-50 text-indigo-600 border-indigo-100',
  cyan:    'bg-cyan-50 text-cyan-600 border-cyan-100',
  teal:    'bg-teal-50 text-teal-600 border-teal-100',
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
 * @param {string}   [props.app.iconBg]        - 아이콘 배경 Tailwind 클래스 (예: 'bg-cyan-600') — accentColor 추출에 활용
 * @param {string[]} [props.app.tags]
 * @param {'Active'|'Developing'|'Planned'|'stable'|'dev'} [props.app.devStatus]
 * @param {'blue'|'violet'|'emerald'|'purple'|'amber'|'indigo'|'cyan'|'teal'} [props.accentColor='blue']
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
    tags        = [],
    devStatus,
    contributor,
  } = app;

  const accent = ACCENT_ICON_BG[accentColor]        ?? ACCENT_ICON_BG.blue;
  const accentBorder  = ACCENT_BORDER_CLASSES[accentColor] ?? ACCENT_BORDER_CLASSES.blue;
  const accentTitle   = ACCENT_TITLE_CLASSES[accentColor]  ?? ACCENT_TITLE_CLASSES.blue;
  const accentHoverBg = ACCENT_CARD_HOVER_BG[accentColor]  ?? ACCENT_CARD_HOVER_BG.blue;
  const accentCta     = ACCENT_CTA_CLASSES[accentColor]    ?? ACCENT_CTA_CLASSES.blue;
  const accentTag     = ACCENT_TAG_CLASSES[accentColor]    ?? ACCENT_TAG_CLASSES.blue;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart?.(); }}
      className={[
        'group relative bg-white rounded-2xl overflow-hidden',
        'border border-slate-200 shadow-sm',
        'cursor-pointer flex flex-col h-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-200',
        accentBorder,
        accentHoverBg,
      ].join(' ')}
      whileHover={{
        y: -5,
        boxShadow: '0 16px 36px -8px rgba(0, 37, 84, 0.13)',
        transition: { type: 'spring', stiffness: 350, damping: 28 },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      {/* ── 우상단: 즐겨찾기 별표 버튼 ── */}
      <motion.button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFavorite?.();
        }}
        className="absolute top-4 right-4 z-10 text-slate-300 hover:text-yellow-400 outline-none cursor-pointer"
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        whileTap={{ scale: 1.35 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      >
        <Star
          size={18}
          fill={isFavorite ? '#eab308' : 'transparent'}
          color={isFavorite ? '#eab308' : 'currentColor'}
        />
      </motion.button>

      {/* ── 상단 헤더: 아이콘 + accent 배경 스트립 ── */}
      <div className="px-6 pt-6 pb-5">
        {/* 아이콘 박스 */}
        <div
          className={[
            'relative w-11 h-11 rounded-xl mb-5 shrink-0 overflow-hidden',
            'flex items-center justify-center',
            'group-hover:scale-105 transition-transform duration-200',
            accent,
          ].join(' ')}
        >
          {/* 아이콘 — 부모가 solid 컬러이므로 흰색으로 강제 */}
          <div className="relative flex items-center justify-center w-full h-full text-white">
            {icon}
          </div>
          {/* 광택 레이어 */}
          <div
            className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {/* 제목 + 개발 상태 뱃지 */}
        <div className="flex items-start gap-2 mb-2 flex-wrap pr-6">
          <h3 className={`text-[15px] font-bold text-slate-800 leading-snug ${accentTitle} transition-colors`}>
            {title}
          </h3>
          <DevStatusBadge devStatus={devStatus} />
        </div>

        {/* 설명 */}
        <p className="text-[13px] text-slate-500 leading-relaxed">
          {description}
        </p>
      </div>

      {/* ── 태그 목록 ── */}
      {tags.length > 0 && (
        <div className="px-6 flex flex-wrap gap-1.5">
          {tags.map((tag, idx) => (
            <span
              key={idx}
              className={`text-[10px] font-bold px-2 py-0.5 border rounded-md uppercase tracking-wider ${accentTag}`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Solver 기여자 ── */}
      {contributor && (
        <div className="flex items-center justify-end gap-1 px-6 mt-4 text-[11px] text-slate-400">
          <User size={10} />
          <span>by <span className="font-medium text-slate-500">{contributor}</span></span>
        </div>
      )}

      {/* ── 하단: 시작하기 ── */}
      <div className={`mx-6 mt-3 mb-5 pt-4 border-t border-slate-100 flex items-center font-semibold text-[13px] ${
        isRestricted ? 'text-slate-400' : accentCta
      }`}>
        {isRestricted ? (
          <>
            <Lock size={12} className="mr-1.5 opacity-60" />
            <span className="opacity-60">관리자 전용</span>
          </>
        ) : (
          <>
            <span className="group-hover:opacity-80 transition-opacity">시작하기</span>
            <ArrowRight
              size={14}
              className="ml-1.5 group-hover:translate-x-1.5 transition-transform duration-200"
            />
          </>
        )}
      </div>
    </motion.div>
  );
}
