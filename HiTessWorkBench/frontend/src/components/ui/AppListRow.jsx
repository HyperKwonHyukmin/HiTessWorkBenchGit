import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock, Settings2 } from 'lucide-react';
import StatusBadge from './StatusBadge';
import FormatFlow from './FormatFlow';

const ACCENT_HOVER = {
  blue:    'hover:border-blue-300 hover:bg-blue-50/30',
  violet:  'hover:border-violet-300 hover:bg-violet-50/30',
  emerald: 'hover:border-emerald-300 hover:bg-emerald-50/30',
  amber:   'hover:border-amber-300 hover:bg-amber-50/30',
  indigo:  'hover:border-indigo-300 hover:bg-indigo-50/30',
  cyan:    'hover:border-cyan-300 hover:bg-cyan-50/30',
  teal:    'hover:border-teal-300 hover:bg-teal-50/30',
  purple:  'hover:border-purple-300 hover:bg-purple-50/30',
};
const ACCENT_TITLE = {
  blue:    'group-hover:text-blue-600',
  violet:  'group-hover:text-violet-600',
  emerald: 'group-hover:text-emerald-600',
  amber:   'group-hover:text-amber-600',
  indigo:  'group-hover:text-indigo-600',
  cyan:    'group-hover:text-cyan-600',
  teal:    'group-hover:text-teal-600',
  purple:  'group-hover:text-purple-600',
};
const ACCENT_ARROW = {
  blue:    'text-blue-500',
  violet:  'text-violet-500',
  emerald: 'text-emerald-500',
  amber:   'text-amber-500',
  indigo:  'text-indigo-500',
  cyan:    'text-cyan-500',
  teal:    'text-teal-500',
  purple:  'text-purple-500',
};

function DevStatusBadge({ devStatus }) {
  if (!devStatus || devStatus === 'Active') return null;
  return <StatusBadge status={devStatus} size="sm" dot />;
}

export default function AppListRow({
  app = {},
  accentColor = 'blue',
  isFavorite  = false,
  isRestricted = false,
  onFavorite,
  onStart,
  // 관리자에게만 전달된다 — 넘어오면 행에 App 설정(톱니바퀴) 버튼이 붙는다.
  onSettings,
}) {
  const {
    title = '',
    description = '',
    icon,
    iconBg = 'bg-blue-100',
    inputFormats = [],
    outputFormats = [],
    inputLabel = 'Input',
    devStatus,
    contributor,
  } = app;

  return (
    // 그리드 카드와 같은 구조 — 루트는 article, 제목만 실제 버튼.
    <motion.article
      onClick={onStart}
      className={[
        'group flex items-center gap-4 bg-white px-5 py-4 rounded-xl',
        'border border-slate-200 shadow-sm cursor-pointer',
        'focus-within:ring-2 focus-within:ring-brand-blue/40',
        'transition-colors duration-150',
        ACCENT_HOVER[accentColor] ?? ACCENT_HOVER.blue,
      ].join(' ')}
      whileHover={{ x: 3, boxShadow: '0 4px 20px -4px rgba(0,37,84,0.10)', transition: { type: 'spring', stiffness: 400, damping: 30 } }}
      whileTap={{ scale: 0.995 }}
    >
      {/* 아이콘 — solid 색상 박스, 흰색 아이콘 */}
      <div className={`shrink-0 relative w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center ${iconBg}`}>
        <div className="relative text-white">{icon}</div>
        <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none" aria-hidden="true" />
      </div>

      {/* 제목 + 설명 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 크기를 명시한다 — 지정이 없으면 상속값(16px)이 되어 그리드 카드 제목과 어긋난다.
              리스트는 밀도가 높으므로 15px, 설명(12px) 대비 1.25 비율을 유지한다. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStart?.(); }}
            className={`text-left text-[15px] font-bold text-slate-800 tracking-tight outline-none cursor-pointer transition-colors ${ACCENT_TITLE[accentColor] ?? ACCENT_TITLE.blue}`}
          >
            {title}
          </button>
          <DevStatusBadge devStatus={devStatus} />
        </div>
        {description && <p className="text-xs text-slate-500 truncate mt-0.5 leading-relaxed">{description}</p>}
      </div>

      {/* 형식 — 그리드 카드와 같은 FormatFlow 를 쓴다(뷰 토글은 밀도만 바꾼다). */}
      <div className="hidden lg:block shrink-0">
        <FormatFlow
          inputLabel={inputLabel}
          inputFormats={inputFormats}
          outputFormats={outputFormats}
        />
      </div>

      {/* contributor */}
      {contributor && (
        <div className="hidden xl:flex items-center gap-1 text-xs text-slate-500 shrink-0 whitespace-nowrap">
          <User size={10} />
          <span>{contributor}</span>
        </div>
      )}

      {/* App 설정 (관리자 전용) */}
      {onSettings && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSettings(); }}
          className="shrink-0 rounded-lg p-0.5 text-slate-300 outline-none transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
          title="App 설정 (관리자)"
          aria-label={`${title} App 설정`}
        >
          <Settings2 size={16} />
        </button>
      )}

      {/* 즐겨찾기 */}
      <motion.button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFavorite?.(); }}
        className="shrink-0 text-slate-300 hover:text-yellow-400 outline-none cursor-pointer"
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        whileTap={{ scale: 1.35 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      >
        <Star size={17} fill={isFavorite ? '#eab308' : 'transparent'} color={isFavorite ? '#eab308' : 'currentColor'} />
      </motion.button>

      {/* 시작 화살표 */}
      <div className={`shrink-0 ${isRestricted ? 'text-slate-300' : ACCENT_ARROW[accentColor] ?? ACCENT_ARROW.blue}`}>
        {isRestricted
          ? <Lock size={15} className="opacity-50" />
          : <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform duration-150" />}
      </div>
    </motion.article>
  );
}
