import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, Lock, Settings2 } from 'lucide-react';
import StatusBadge from './StatusBadge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

// 헤더 그라데이션 — PageHeader(페이지 배너)와 같은 문법을 쓴다.
// Trust Blue 에서 출발해 모드 액센트로 흘러, 사이드바·배너·카드가 한 언어로 묶인다.
const ACCENT_HEADER = {
  blue:    'from-brand-blue via-brand-blue-dark to-brand-blue-light',
  violet:  'from-brand-blue via-violet-900 to-violet-800',
  emerald: 'from-brand-blue via-emerald-900 to-emerald-800',
  purple:  'from-brand-blue via-purple-900 to-purple-800',
  amber:   'from-brand-blue via-amber-900 to-amber-800',
  indigo:  'from-brand-blue via-indigo-900 to-indigo-800',
  cyan:    'from-brand-blue via-cyan-900 to-cyan-800',
  teal:    'from-brand-blue via-teal-900 to-teal-800',
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

// CTA 색상 — 상호작용은 Action Blue 계열이 맡는다(정체성 네이비와 역할을 섞지 않는다).
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

/**
 * 입력 → 출력 형식을 한 줄로 보여준다.
 *
 * 예전에는 Input 칩 줄 / Output 칩 줄 / 태그 줄이 따로 있어 카드 아래 절반이 칩으로 막혔다.
 * 해석 앱의 본질은 '무엇을 넣으면 무엇이 나오는가' 하나이므로 화살표 한 줄로 합친다.
 */
function FormatFlow({ inputLabel, inputFormats, outputFormats }) {
  if (inputFormats.length === 0 && outputFormats.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {inputFormats.length === 0 && (
        <span className="font-semibold text-slate-500">{inputLabel}</span>
      )}
      {inputFormats.map(format => (
        <span
          key={format}
          className="rounded-md bg-slate-100 px-2 py-0.5 font-bold tracking-wide text-slate-700"
        >
          {format}
        </span>
      ))}
      {inputFormats.length > 0 && outputFormats.length > 0 && (
        <span className="px-0.5 text-slate-300" aria-hidden="true">→</span>
      )}
      {outputFormats.map(format => (
        <span
          key={`out-${format}`}
          className="rounded-md bg-slate-50 px-2 py-0.5 font-semibold text-slate-500"
        >
          {format}
        </span>
      ))}
      {/* 화살표는 장식이므로 스크린리더에는 관계를 말로 전달한다. */}
      {inputFormats.length > 0 && outputFormats.length > 0 && (
        <span className="sr-only">
          {`입력 ${inputFormats.join(', ')} · 출력 ${outputFormats.join(', ')}`}
        </span>
      )}
    </div>
  );
}

export default function AppCard({
  app = {},
  accentColor = 'blue',
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
    inputFormats = [],
    outputFormats = [],
    inputLabel = 'Input',
    devStatus,
    contributor,
  } = app;

  const accentHeader = ACCENT_HEADER[accentColor] ?? ACCENT_HEADER.blue;
  const accentBorder = ACCENT_BORDER[accentColor] ?? ACCENT_BORDER.blue;
  const accentCta    = ACCENT_CTA[accentColor]    ?? ACCENT_CTA.blue;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onStart?.();
        // Space 는 기본 동작(페이지 스크롤)을 막고 실행한다.
        if (e.key === ' ') { e.preventDefault(); onStart?.(); }
      }}
      className={[
        'group relative rounded-2xl overflow-hidden bg-white',
        'border border-slate-200 shadow-sm',
        'cursor-pointer flex flex-col h-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-200',
        accentBorder,
      ].join(' ')}
      whileHover={{
        y: -4,
        boxShadow: '0 20px 40px -20px rgba(0, 37, 84, 0.40)',
        transition: { type: 'spring', stiffness: 350, damping: 28 },
      }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      {/* ── 헤더 ──
          Trust Blue 그라데이션 위에 아이콘과 제목을 얹는다. 사이드바·PageHeader 와 같은
          언어라 카드가 프레임과 따로 놀지 않고 화면 전체가 하나의 시스템으로 읽힌다. */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${accentHeader} px-6 pt-6 pb-5`}>
        {/* 깊이용 코너 원 — PageHeader 의 흰 도형과 같은 처리. */}
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/[0.06]"
          aria-hidden="true"
        />

        {onSettings && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSettings(); }}
            className="absolute top-5 right-12 z-10 rounded-lg p-0.5 text-white/45 outline-none transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
            title="App 설정 (관리자)"
            aria-label={`${title} App 설정`}
          >
            <Settings2 size={17} />
          </button>
        )}

        <motion.button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavorite?.(); }}
          className="absolute top-5 right-5 z-10 text-white/55 outline-none transition-colors hover:text-amber-300 cursor-pointer"
          aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          whileTap={{ scale: 1.35 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        >
          <Star
            size={18}
            fill={isFavorite ? '#fbbf24' : 'transparent'}
            color={isFavorite ? '#fbbf24' : 'currentColor'}
          />
        </motion.button>

        {/* 아이콘 — 네이비 위 반투명 유리 박스 */}
        <div
          className={[
            'relative z-[1] w-11 h-11 rounded-xl mb-4 shrink-0',
            'flex items-center justify-center text-white',
            'bg-white/[0.13] border border-white/20 backdrop-blur-sm',
            'group-hover:scale-105 transition-transform duration-200',
          ].join(' ')}
        >
          {icon}
        </div>

        {/* 제목 + 상태 뱃지 */}
        <div className="relative z-[1] flex items-start gap-2 flex-wrap pr-6">
          <h3 className="text-[18px] font-bold leading-snug tracking-tight text-white">
            {title}
          </h3>
          <DevStatusBadge devStatus={devStatus} />
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex flex-1 flex-col px-6 pt-5 pb-6">
        {description && (
          <p
            className="text-[13px] leading-relaxed text-slate-500 overflow-hidden"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
          >
            {description}
          </p>
        )}

        <div className="mt-4">
          <FormatFlow
            inputLabel={inputLabel}
            inputFormats={inputFormats}
            outputFormats={outputFormats}
          />
        </div>

        <div className="flex-1 min-h-[16px]" />

        {/* CTA + 기여자 */}
        <div className="flex items-center justify-between gap-3 pt-4">
          <span className={`flex items-center gap-1.5 text-[13px] font-bold ${
            isRestricted ? 'text-slate-500' : accentCta
          }`}>
            {isRestricted ? (
              <>
                <Lock size={13} />
                관리자 전용
              </>
            ) : (
              <>
                시작하기
                <ArrowRight
                  size={14}
                  className="transition-transform duration-200 group-hover:translate-x-1.5"
                />
              </>
            )}
          </span>
          {contributor && (
            <span className="shrink-0 text-[11.5px] text-slate-500">{contributor}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
