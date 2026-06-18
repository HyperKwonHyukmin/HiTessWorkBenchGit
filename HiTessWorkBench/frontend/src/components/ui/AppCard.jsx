import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock } from 'lucide-react';
import StatusBadge from './StatusBadge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

// 카드 배경 그라데이션 (accent-50 tint → white, 세로)
const ACCENT_CARD_BG = {
  blue:    'from-blue-50/100',
  violet:  'from-violet-50/100',
  emerald: 'from-emerald-50/100',
  purple:  'from-purple-50/100',
  amber:   'from-amber-50/100',
  indigo:  'from-indigo-50/100',
  cyan:    'from-cyan-50/100',
  teal:    'from-teal-50/100',
};

const ACCENT_CARD_BG_SOFT = {
  blue:    'from-blue-50/55',
  violet:  'from-violet-50/55',
  emerald: 'from-emerald-50/55',
  purple:  'from-purple-50/55',
  amber:   'from-amber-50/55',
  indigo:  'from-indigo-50/55',
  cyan:    'from-cyan-50/55',
  teal:    'from-teal-50/55',
};

const ACCENT_TOP_BAND = {
  blue:    'bg-blue-500',
  violet:  'bg-violet-500',
  emerald: 'bg-emerald-500',
  purple:  'bg-purple-500',
  amber:   'bg-amber-400',
  indigo:  'bg-indigo-500',
  cyan:    'bg-cyan-500',
  teal:    'bg-teal-500',
};

// 아이콘 박스 배경 (solid)
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

// 제목 hover 색상
const ACCENT_TITLE = {
  blue:    'group-hover:text-blue-700',
  violet:  'group-hover:text-violet-700',
  emerald: 'group-hover:text-emerald-700',
  purple:  'group-hover:text-purple-700',
  amber:   'group-hover:text-amber-700',
  indigo:  'group-hover:text-indigo-700',
  cyan:    'group-hover:text-cyan-700',
  teal:    'group-hover:text-teal-700',
};

// 태그 accent tint
const ACCENT_TAG = {
  blue:    'bg-blue-100/100 text-blue-700 border-blue-200',
  violet:  'bg-violet-100/100 text-violet-700 border-violet-200',
  emerald: 'bg-emerald-100/100 text-emerald-700 border-emerald-200',
  purple:  'bg-purple-100/100 text-purple-700 border-purple-200',
  amber:   'bg-amber-100/100 text-amber-700 border-amber-200',
  indigo:  'bg-indigo-100/100 text-indigo-700 border-indigo-200',
  cyan:    'bg-cyan-100/100 text-cyan-700 border-cyan-200',
  teal:    'bg-teal-100/100 text-teal-700 border-teal-200',
};

const ACCENT_TAG_REFINED = {
  blue:    'bg-slate-50 text-blue-700 border-blue-200/80',
  violet:  'bg-slate-50 text-violet-700 border-violet-200/80',
  emerald: 'bg-slate-50 text-emerald-700 border-emerald-200/80',
  purple:  'bg-slate-50 text-purple-700 border-purple-200/80',
  amber:   'bg-slate-50 text-amber-700 border-amber-200/80',
  indigo:  'bg-slate-50 text-indigo-700 border-indigo-200/80',
  cyan:    'bg-slate-50 text-cyan-700 border-cyan-200/80',
  teal:    'bg-slate-50 text-teal-700 border-teal-200/80',
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
  return <StatusBadge status={devStatus === 'dev' ? 'Developing' : devStatus} size="sm" dot />;
}

export default function AppCard({
  app = {},
  accentColor = 'blue',
  visualTone = 'colorful',
  cardDetailTone = 'default',
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

  const isRestrained = visualTone === 'restrained';
  const accentCardBg = isRestrained
    ? (ACCENT_CARD_BG_SOFT[accentColor] ?? ACCENT_CARD_BG_SOFT.blue)
    : (ACCENT_CARD_BG[accentColor] ?? ACCENT_CARD_BG.blue);
  const accentTopBand = ACCENT_TOP_BAND[accentColor] ?? ACCENT_TOP_BAND.blue;
  const accentIconBg = ACCENT_ICON_BG[accentColor] ?? ACCENT_ICON_BG.blue;
  const accentBorder = ACCENT_BORDER[accentColor]  ?? ACCENT_BORDER.blue;
  const accentTitle  = ACCENT_TITLE[accentColor]   ?? ACCENT_TITLE.blue;
  const accentTag    = ACCENT_TAG[accentColor]     ?? ACCENT_TAG.blue;
  const accentTagRefined = ACCENT_TAG_REFINED[accentColor] ?? ACCENT_TAG_REFINED.blue;
  const accentCta    = ACCENT_CTA[accentColor]     ?? ACCENT_CTA.blue;
  const isRefined = cardDetailTone === 'refined';

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart?.(); }}
      className={[
        'group relative rounded-2xl overflow-hidden',
        'border border-slate-200 shadow-sm',
        'cursor-pointer flex flex-col h-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-200',
        `bg-gradient-to-b ${accentCardBg} via-white to-white`,
        accentBorder,
      ].join(' ')}
      whileHover={{
        y: isRefined ? -3 : -5,
        boxShadow: isRefined
          ? '0 10px 24px -10px rgba(0, 37, 84, 0.16)'
          : '0 16px 36px -8px rgba(0, 37, 84, 0.13)',
        transition: { type: 'spring', stiffness: 350, damping: 28 },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      {isRestrained && (
        <div className={`absolute inset-x-0 top-0 h-1 ${accentTopBand}`} aria-hidden="true" />
      )}

      {/* ── 즐겨찾기 ── */}
      <motion.button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFavorite?.(); }}
        className={[
          'absolute top-4 right-4 z-10 text-slate-300 hover:text-yellow-400 outline-none cursor-pointer transition-all',
          isRefined && !isFavorite ? 'opacity-35 group-hover:opacity-100' : 'opacity-100',
        ].join(' ')}
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        whileTap={{ scale: 1.35 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      >
        <Star
          size={18}
          fill={isFavorite ? '#eab308' : 'transparent'}
          color={isFavorite ? '#eab308' : 'currentColor'}
        />
      </motion.button>

      {/* ── 콘텐츠 ── */}
      <div className="flex flex-col flex-1 px-6 pt-6 pb-5">

        {/* 아이콘 박스 */}
        <div
          className={[
            'relative w-11 h-11 rounded-xl mb-4 shrink-0 overflow-hidden',
            'flex items-center justify-center text-white',
            'group-hover:scale-105 transition-transform duration-200',
            accentIconBg,
          ].join(' ')}
        >
          {icon}
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" aria-hidden="true" />
        </div>

        {/* 제목 + 뱃지 */}
        <div className="flex items-start gap-2 mb-1.5 flex-wrap pr-6">
          <h3 className={`text-[15px] font-bold text-slate-800 leading-snug transition-colors ${accentTitle}`}>
            {title}
          </h3>
          <DevStatusBadge devStatus={devStatus} />
        </div>

        {/* 설명 */}
        {(description || isRefined) && (
          <p
            className={[
              'text-[13px] text-slate-500 leading-relaxed',
              isRefined ? 'min-h-[2.6rem] overflow-hidden' : '',
            ].join(' ')}
            style={isRefined ? {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            } : undefined}
          >
            {description}
          </p>
        )}

        {/* 태그 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className={[
                  'text-[10px] font-bold px-2 py-0.5 border rounded-md uppercase tracking-wider',
                  isRefined
                    ? accentTagRefined
                    : isRestrained
                    ? 'bg-slate-50 text-slate-600 border-slate-200'
                    : accentTag,
                ].join(' ')}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* contributor */}
        {(contributor || isRefined) && (
          <div className={[
            'flex items-center justify-end gap-1 mt-4 text-[11px] text-slate-400',
            !contributor ? 'invisible' : '',
          ].join(' ')}>
            <User size={10} />
            <span>by <span className="font-medium text-slate-500">{contributor}</span></span>
          </div>
        )}

        {/* CTA */}
        <div className={`mt-3 pt-3 border-t border-slate-200/100 flex items-center font-semibold text-[13px] ${
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
