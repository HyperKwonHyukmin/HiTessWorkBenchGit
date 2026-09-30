import React from 'react';
import { ArrowRight, Lock, Settings2, Star } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { CardArt, resolveCardArt } from './cardArt';
import { formatNotificationTime } from '../../utils/notificationLink';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---
// 모드 시그니처 색(File=blue · Interactive=violet · Parametric=emerald · Productivity=amber).
// 색은 도면 띠(모눈·선화)와 분류 이름표에만 쓴다. 카드 본문은 모드와 무관하게 같은 중성색이다.
const ACCENT = {
  blue: {
    band: 'from-blue-50/80',
    dot: '#c9d8f4',
    art: 'text-blue-300 group-hover:text-blue-600',
    tag: 'text-blue-800 ring-blue-200',
    link: 'text-blue-800',
    pipe: 'from-blue-300 to-blue-500',
    hover: 'hover:border-blue-300',
  },
  violet: {
    band: 'from-violet-50/80',
    dot: '#ddd3f7',
    art: 'text-violet-300 group-hover:text-violet-600',
    tag: 'text-violet-800 ring-violet-200',
    link: 'text-violet-800',
    pipe: 'from-violet-300 to-violet-500',
    hover: 'hover:border-violet-300',
  },
  emerald: {
    band: 'from-emerald-50/80',
    dot: '#c6ead9',
    art: 'text-emerald-300 group-hover:text-emerald-600',
    tag: 'text-emerald-800 ring-emerald-200',
    link: 'text-emerald-800',
    pipe: 'from-emerald-300 to-emerald-500',
    hover: 'hover:border-emerald-300',
  },
  amber: {
    band: 'from-amber-50/80',
    dot: '#f1dfb5',
    art: 'text-amber-300 group-hover:text-amber-600',
    tag: 'text-amber-800 ring-amber-200',
    link: 'text-amber-800',
    pipe: 'from-amber-300 to-amber-500',
    hover: 'hover:border-amber-300',
  },
};

const INPUT_CHIP = 'rounded-md bg-white px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-slate-800 ring-1 ring-inset ring-slate-300';
const OUTPUT_CHIP = 'rounded-md bg-white px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200';

function DevStatusBadge({ devStatus }) {
  if (!devStatus || devStatus === 'Active' || devStatus === 'stable') return null;
  return <StatusBadge status={devStatus === 'dev' ? 'Developing' : devStatus} size="sm" dot />;
}

/** 입력 → 출력을 작은 공정선으로. 카드마다 같은 자리·같은 높이라 가로로 훑어 비교된다. */
function IoLine({ inputFormats, outputFormats, pipeClass }) {
  if (inputFormats.length === 0 && outputFormats.length === 0) return null;
  return (
    // 출력이 길면(Candidate table · JSON) 출력 칩만 아래로 줄바꿈되고, 공정선은 첫 칩 줄 높이에 남는다.
    <div className="mx-4 mt-3 grid grid-cols-[auto_minmax(1.25rem,1fr)_minmax(0,auto)] items-start gap-x-2 rounded-lg bg-slate-50 px-3 pb-2.5 pt-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] font-semibold text-slate-500">입력</span>
        <div className="flex flex-wrap gap-1 whitespace-nowrap">
          {inputFormats.map(f => <span key={f} className={INPUT_CHIP}>{f}</span>)}
        </div>
      </div>
      <div className={`relative mt-[29px] h-[1.5px] rounded bg-gradient-to-r ${pipeClass}`} aria-hidden="true">
        <span className="absolute -left-0.5 -top-[2.25px] h-1.5 w-1.5 rounded-full bg-current opacity-40" />
        <span className="absolute -right-0.5 -top-[3.5px] h-0 w-0 border-y-[4px] border-l-[7px] border-y-transparent border-l-slate-400" />
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10.5px] font-semibold text-slate-500">출력</span>
        <div className="flex flex-wrap justify-end gap-1">
          {outputFormats.map(f => <span key={`o-${f}`} className={OUTPUT_CHIP}>{f}</span>)}
        </div>
      </div>
      <span className="sr-only">{`입력 ${inputFormats.join(', ') || '없음'} · 출력 ${outputFormats.join(', ') || '없음'}`}</span>
    </div>
  );
}

/**
 * 앱 카탈로그 카드 — '도면 감성 카드'.
 *
 * 위쪽 도면 띠(모눈 + 구조 형태 선화 + 분류 이름표)가 분류를 그림으로 말하고, 본문은
 * 규격표처럼 '이름 → 입력·출력 공정선 → 다음/이전 단계 → 담당·마지막 사용' 순서로 읽힌다.
 * 선화는 cardArt.jsx 라이브러리에서 고른다(앱 art → 분류 기본값 → 없으면 모눈만).
 *
 * 예전 카드(네이비 헤더 · 앱마다 같은 44px 아이콘)는 가장 눈에 띄는 자리에 정보가 없었다.
 */
export default function AppCard({
  app = {},
  accentColor = 'blue',
  isFavorite = false,
  isRestricted = false,
  // 마지막으로 연 시각(epoch ms).
  lastUsedAt,
  // 연계 앱 한 줄 — { label: '다음'|'이전'|'연계', names: string[] }. 없으면 자리만 지킨다.
  link,
  onFavorite,
  onStart,
  // 관리자에게만 전달된다 — 넘어오면 카드에 App 설정(톱니바퀴) 버튼이 붙는다.
  onSettings,
}) {
  const {
    title = '',
    description = '',
    category,
    inputFormats = [],
    outputFormats = [],
    devStatus,
    contributor,
  } = app;

  const accent = ACCENT[accentColor] ?? ACCENT.blue;
  const lastUsed = lastUsedAt ? formatNotificationTime(lastUsedAt) : '';
  const artName = resolveCardArt(app);

  return (
    <article
      className={[
        'group relative flex h-full flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_-16px_rgba(0,37,84,0.22)]',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,42,0.05),0_18px_32px_-18px_rgba(0,37,84,0.38)]',
        'motion-reduce:transform-none motion-reduce:transition-none',
        accent.hover,
      ].join(' ')}
    >
      {/* 카드 전체 진입 버튼. 별·설정 버튼과는 형제(중첩 아님)라 포커스·클릭이 서로 섞이지 않는다. */}
      <button
        type="button"
        onClick={onStart}
        aria-label={isRestricted ? `${title} (관리자 전용)` : `${title} 열기`}
        className="absolute inset-0 z-10 cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      />

      {/* ── 도면 띠 ── */}
      <div
        className={`relative h-16 shrink-0 border-b border-slate-100 bg-gradient-to-b ${accent.band} to-white`}
        style={{ backgroundImage: `radial-gradient(circle, ${accent.dot} 1px, transparent 1.2px)`, backgroundSize: '12px 12px' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/70 to-transparent" aria-hidden="true" />
        {artName && (
          <CardArt
            name={artName}
            className={`pointer-events-none absolute right-11 top-1.5 h-[54px] w-[104px] transition-colors duration-200 ${accent.art}`}
          />
        )}
        <div className="absolute left-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {category && (
            <span className={`rounded-full bg-white px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset ${accent.tag}`}>
              {category}
            </span>
          )}
          <DevStatusBadge devStatus={devStatus} />
        </div>
        <button
          type="button"
          onClick={onFavorite}
          aria-pressed={isFavorite}
          aria-label={`${title} 즐겨찾기 ${isFavorite ? '해제' : '추가'}`}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          className={[
            'absolute right-2.5 top-2.5 z-20 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg outline-none',
            'transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-400',
            isFavorite ? 'text-amber-400' : 'text-slate-500 hover:text-amber-500',
          ].join(' ')}
        >
          <Star size={17} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* ── 이름·설명 ── */}
      <div className="px-4 pt-3">
        <h3 className="break-keep text-base font-bold leading-snug tracking-tight text-slate-900">{title}</h3>
        <p className="mt-1 line-clamp-2 min-h-[38px] text-[12.5px] leading-[19px] text-slate-500" title={description}>
          {description}
        </p>
      </div>

      <IoLine inputFormats={inputFormats} outputFormats={outputFormats} pipeClass={accent.pipe} />

      {/* ── 연계 앱 ── 없는 카드도 줄 높이를 지켜 이웃 카드와 아래 줄이 맞는다. */}
      <div className="mx-4 mt-2.5 flex min-h-5 items-center gap-2 text-[12.5px]">
        <span className="shrink-0 text-[11px] font-semibold text-slate-500">{link?.label ?? '연계'}</span>
        {link?.names?.length
          ? <span className={`truncate font-semibold ${accent.link}`} title={link.names.join(' · ')}>{link.names.join(' · ')}</span>
          : <span className="text-slate-400" aria-label="없음">—</span>}
      </div>

      {/* ── 담당·마지막 사용 | 설정·열기 ── */}
      <div className="mt-auto flex items-center justify-between gap-3 px-4 pb-3 pt-3">
        <span className="min-w-0 truncate text-xs text-slate-500">
          {contributor}
          {lastUsed && <><span className="mx-1.5 text-slate-300" aria-hidden="true">·</span><span className="tabular-nums" title="마지막 사용">{lastUsed}</span></>}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {onSettings && (
            <button
              type="button"
              onClick={onSettings}
              title="App 설정 (관리자)"
              aria-label={`${title} App 설정`}
              className="relative z-20 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Settings2 size={15} />
            </button>
          )}
          {isRestricted ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
              <Lock size={13} aria-hidden="true" />
              관리자 전용
            </span>
          ) : (
            <span
              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-[background-color,color,transform] duration-200 group-hover:translate-x-0.5 group-hover:bg-brand-blue group-hover:text-white motion-reduce:transform-none"
              aria-hidden="true"
            >
              <ArrowRight size={14} />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
