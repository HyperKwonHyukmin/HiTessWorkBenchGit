import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock, Settings2 } from 'lucide-react';
import StatusBadge from './StatusBadge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

// 호버 시 카드 본문에 깔리는 옅은 액센트 — 색이 '지금 이 카드를 가리키고 있다'는
// 상태를 나타낸다. 정지 상태의 카드는 흰색이라 색이 장식으로 남지 않는다.
const ACCENT_HOVER_SURFACE = {
  blue:    'hover:bg-blue-50/40',
  violet:  'hover:bg-violet-50/40',
  emerald: 'hover:bg-emerald-50/40',
  purple:  'hover:bg-purple-50/40',
  amber:   'hover:bg-amber-50/40',
  indigo:  'hover:bg-indigo-50/40',
  cyan:    'hover:bg-cyan-50/40',
  teal:    'hover:bg-teal-50/40',
};

// 헤더 존은 본문보다 한 단계 진하게 물들어 호버 중에도 존 구분이 유지된다.
const ACCENT_HOVER_ZONE = {
  blue:    'group-hover:bg-blue-50',
  violet:  'group-hover:bg-violet-50',
  emerald: 'group-hover:bg-emerald-50',
  purple:  'group-hover:bg-purple-50',
  amber:   'group-hover:bg-amber-50',
  indigo:  'group-hover:bg-indigo-50',
  cyan:    'group-hover:bg-cyan-50',
  teal:    'group-hover:bg-teal-50',
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
  // 관리자에게만 전달된다 — 넘어오면 카드에 App 설정(톱니바퀴) 버튼이 붙는다.
  onSettings,
}) {
  const {
    title       = '',
    description = '',
    icon,
    tags        = [],
    inputFormats = [],
    outputFormats = [],
    inputLabel = 'Input',
    devStatus,
    contributor,
  } = app;

  const isRestrained = visualTone === 'restrained';
  const accentHoverSurface = ACCENT_HOVER_SURFACE[accentColor] ?? ACCENT_HOVER_SURFACE.blue;
  const accentHoverZone = ACCENT_HOVER_ZONE[accentColor] ?? ACCENT_HOVER_ZONE.blue;
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
        'cursor-pointer flex flex-col h-full bg-white',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-200',
        // 정지 상태는 흰색. 색은 호버에서만 등장해 '가리키고 있음'을 뜻한다.
        accentHoverSurface,
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
      {/* ── App 설정 (관리자 전용) ── */}
      {onSettings && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSettings(); }}
          className="absolute top-4 right-11 z-10 rounded-lg p-0.5 text-slate-300 opacity-35 outline-none transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 cursor-pointer"
          title="App 설정 (관리자)"
          aria-label={`${title} App 설정`}
        >
          <Settings2 size={17} />
        </button>
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

      {/* ── 헤더 존 ──
          아이콘과 제목을 한 표면(slate-50)으로 묶는다. 색을 늘리지 않고 표면 분할만으로
          '먼저 읽을 것'을 만들고, 흰 카드가 흰 배경(#F8F9FC) 위에서 납작해지는 것도 막는다. */}
      <div
        className={[
          'px-6 pt-6 pb-4 border-b border-slate-200 bg-slate-50',
          'transition-colors duration-200',
          accentHoverZone,
        ].join(' ')}
      >
        {/* 아이콘 박스 */}
        <div
          className={[
            'relative w-11 h-11 rounded-xl mb-3.5 shrink-0 overflow-hidden',
            'flex items-center justify-center text-white',
            'shadow-[0_6px_14px_-8px_rgba(37,99,235,0.55)]',
            'group-hover:scale-105 transition-transform duration-200',
            accentIconBg,
          ].join(' ')}
        >
          {icon}
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" aria-hidden="true" />
        </div>

        {/* 제목 + 뱃지 — 본문(13px) 대비 1.3배로 두어 제목이 제목으로 읽히게 한다. */}
        <div className="flex items-start gap-2 flex-wrap pr-6">
          <h3 className={`text-[17px] font-bold text-slate-800 leading-snug tracking-tight transition-colors ${accentTitle}`}>
            {title}
          </h3>
          <DevStatusBadge devStatus={devStatus} />
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex flex-col flex-1 px-6 pt-4 pb-5">

        {/* 설명 — 2줄로 자르되 최소 높이는 강제하지 않는다(카드가 내용만큼만 높아진다). */}
        {description && (
          <p
            className={[
              'text-[13px] text-slate-500 leading-relaxed',
              isRefined ? 'overflow-hidden' : '',
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

        {/* 입력 파일 형식 — 라벨·칩 모두 11px/600. 10px·900 은 제목보다 무거워 위계를 뒤집었다. */}
        {inputFormats.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{inputLabel}</span>
            {inputFormats.map(format => (
              <span
                key={format}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700"
              >
                {format}
              </span>
            ))}
          </div>
        )}
        {outputFormats.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Output</span>
            {outputFormats.map(format => (
              <span
                key={format}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
              >
                {format}
              </span>
            ))}
          </div>
        )}

        {/* 태그 — 한글이 섞이므로 uppercase/tracking-wider 를 쓰지 않는다.
            (uppercase 는 한글에 무효과, tracking-wider 는 자간을 벌려 조판이 깨진다.) */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className={[
                  'text-[11px] font-medium px-2 py-0.5 border rounded-md',
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

        {/* contributor — 없으면 빈 자리를 남기지 않는다(카드 높이를 억지로 맞추지 않는다). */}
        {contributor && (
          <div className="flex items-center justify-end gap-1 mt-4 text-[11px] text-slate-500">
            <User size={11} />
            <span>by <span className="font-medium text-slate-600">{contributor}</span></span>
          </div>
        )}

        {/* CTA */}
        <div className={`mt-3 pt-3 border-t border-slate-200/100 flex items-center font-semibold text-[13px] ${
          isRestricted ? 'text-slate-500' : accentCta
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
