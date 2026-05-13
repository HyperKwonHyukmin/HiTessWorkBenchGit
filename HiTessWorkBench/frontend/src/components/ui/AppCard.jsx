import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock } from 'lucide-react';
import Badge from './Badge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

// 헤더 밴드 배경 (solid accent)
const ACCENT_HEADER = {
  blue:    'bg-blue-600',
  violet:  'bg-violet-600',
  emerald: 'bg-emerald-600',
  purple:  'bg-purple-600',
  amber:   'bg-amber-500',
  indigo:  'bg-indigo-600',
  cyan:    'bg-cyan-600',
  teal:    'bg-teal-600',
};

// 헤더 hover 시 약간 더 밝게
const ACCENT_HEADER_HOVER = {
  blue:    'group-hover:bg-blue-500',
  violet:  'group-hover:bg-violet-500',
  emerald: 'group-hover:bg-emerald-500',
  purple:  'group-hover:bg-purple-500',
  amber:   'group-hover:bg-amber-400',
  indigo:  'group-hover:bg-indigo-500',
  cyan:    'group-hover:bg-cyan-500',
  teal:    'group-hover:bg-teal-500',
};

// 바디 그라데이션 (accent tint → white)
const ACCENT_GRADIENT = {
  blue:    'from-blue-50/50',
  violet:  'from-violet-50/50',
  emerald: 'from-emerald-50/50',
  purple:  'from-purple-50/50',
  amber:   'from-amber-50/50',
  indigo:  'from-indigo-50/50',
  cyan:    'from-cyan-50/50',
  teal:    'from-teal-50/50',
};

// 테두리 hover
const ACCENT_BORDER = {
  blue:    'hover:border-blue-300',
  violet:  'hover:border-violet-300',
  emerald: 'hover:border-emerald-300',
  purple:  'hover:border-purple-300',
  amber:   'hover:border-amber-300',
  indigo:  'hover:border-indigo-300',
  cyan:    'hover:border-cyan-300',
  teal:    'hover:border-teal-300',
};

// 태그 accent tint
const ACCENT_TAG = {
  blue:    'bg-blue-50 text-blue-600 border-blue-100',
  violet:  'bg-violet-50 text-violet-600 border-violet-100',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  purple:  'bg-purple-50 text-purple-600 border-purple-100',
  amber:   'bg-amber-50 text-amber-600 border-amber-100',
  indigo:  'bg-indigo-50 text-indigo-600 border-indigo-100',
  cyan:    'bg-cyan-50 text-cyan-600 border-cyan-100',
  teal:    'bg-teal-50 text-teal-600 border-teal-100',
};

// CTA 색상
const ACCENT_CTA = {
  blue:    'text-blue-600',
  violet:  'text-violet-600',
  emerald: 'text-emerald-600',
  purple:  'text-purple-600',
  amber:   'text-amber-600',
  indigo:  'text-indigo-600',
  cyan:    'text-cyan-600',
  teal:    'text-teal-600',
};

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

  const accentHeader      = ACCENT_HEADER[accentColor]      ?? ACCENT_HEADER.blue;
  const accentHeaderHover = ACCENT_HEADER_HOVER[accentColor] ?? ACCENT_HEADER_HOVER.blue;
  const accentGradient    = ACCENT_GRADIENT[accentColor]    ?? ACCENT_GRADIENT.blue;
  const accentBorder      = ACCENT_BORDER[accentColor]      ?? ACCENT_BORDER.blue;
  const accentTag         = ACCENT_TAG[accentColor]         ?? ACCENT_TAG.blue;
  const accentCta         = ACCENT_CTA[accentColor]         ?? ACCENT_CTA.blue;

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
      ].join(' ')}
      whileHover={{
        y: -5,
        boxShadow: '0 16px 36px -8px rgba(0, 37, 84, 0.14)',
        transition: { type: 'spring', stiffness: 350, damping: 28 },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >

      {/* ── 컬러 밴드 헤더 ── */}
      <div className={`relative px-5 py-5 flex items-center gap-3.5 transition-colors duration-200 ${accentHeader} ${accentHeaderHover}`}>
        {/* 아이콘 (반투명 흰색 박스) */}
        <div className="shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
          {icon}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/10 to-transparent pointer-events-none" aria-hidden="true" />
        </div>

        {/* 제목 */}
        <h3 className="flex-1 min-w-0 text-[14px] font-bold text-white leading-snug pr-8 truncate">
          {title}
        </h3>

        {/* 즐겨찾기 */}
        <motion.button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavorite?.(); }}
          className="absolute top-4 right-4 z-10 text-white/50 hover:text-yellow-300 outline-none cursor-pointer transition-colors"
          aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          whileTap={{ scale: 1.35 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        >
          <Star
            size={17}
            fill={isFavorite ? '#fde047' : 'transparent'}
            color={isFavorite ? '#fde047' : 'currentColor'}
          />
        </motion.button>
      </div>

      {/* ── 바디 (미묘한 그라데이션 + 콘텐츠) ── */}
      <div className={`flex flex-col flex-1 px-5 pt-4 pb-5 bg-gradient-to-b ${accentGradient} to-white`}>

        {/* devStatus 뱃지 */}
        {devStatus && devStatus !== 'Active' && devStatus !== 'stable' && (
          <div className="mb-3">
            <DevStatusBadge devStatus={devStatus} />
          </div>
        )}

        {/* 설명 */}
        <p className="text-[13px] text-slate-500 leading-relaxed">
          {description}
        </p>

        {/* 태그 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
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

        <div className="flex-1" />

        {/* contributor */}
        {contributor && (
          <div className="flex items-center justify-end gap-1 mt-4 text-[11px] text-slate-400">
            <User size={10} />
            <span>by <span className="font-medium text-slate-500">{contributor}</span></span>
          </div>
        )}

        {/* CTA */}
        <div className={`mt-3 pt-3 border-t border-slate-100 flex items-center font-semibold text-[13px] ${
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
      </div>
    </motion.div>
  );
}
