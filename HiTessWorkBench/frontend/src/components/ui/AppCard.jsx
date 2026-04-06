/// <summary>
/// 분석 앱 카드 컴포넌트입니다.
/// NewAnalysis, InteractiveApps 등 앱 목록 페이지에서 공통으로 사용합니다.
/// accentColor에 따라 hover 시 border 색상이 변경되며,
/// 즐겨찾기 별표 버튼과 "개발중" 뱃지를 포함합니다.
/// </summary>
import React from 'react';
import { Star, ArrowRight } from 'lucide-react';
import Badge from './Badge';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

/**
 * accentColor별 hover border 클래스.
 * 문자열 보간 방식으로 생성하면 Tailwind가 빌드 시 누락하므로 반드시 완성형으로 작성합니다.
 */
const ACCENT_BORDER_CLASSES = {
  blue:    'hover:border-blue-400',
  violet:  'hover:border-violet-400',
  emerald: 'hover:border-emerald-400',
  purple:  'hover:border-purple-400',
};

/**
 * AppCard 컴포넌트
 *
 * @param {object}   props
 * @param {object}   props.app                      - 앱 메타데이터
 * @param {string}   props.app.title                - 앱 제목
 * @param {string}   [props.app.description]        - 앱 설명
 * @param {React.ReactNode} [props.app.icon]        - 아이콘 요소 (JSX)
 * @param {string}   [props.app.iconBg]             - 아이콘 배경 Tailwind 클래스 (예: 'bg-blue-100')
 * @param {string[]} [props.app.tags]               - 태그 문자열 배열
 * @param {'stable'|'dev'} [props.app.devStatus]   - 개발 상태 ('dev'이면 개발중 뱃지 표시)
 * @param {string}   [props.app.mode]               - 앱 모드 (현재 미사용, 확장용)
 * @param {'blue'|'violet'|'emerald'|'purple'} [props.accentColor='blue'] - hover border 강조 색상
 * @param {boolean}  [props.isFavorite=false]       - 즐겨찾기 여부
 * @param {() => void} [props.onFavorite]           - 즐겨찾기 토글 핸들러
 * @param {() => void} [props.onStart]              - 앱 시작 핸들러
 */
export default function AppCard({
  app = {},
  accentColor = 'blue',
  isFavorite = false,
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
  } = app;

  const accentBorderClass = ACCENT_BORDER_CLASSES[accentColor] ?? ACCENT_BORDER_CLASSES.blue;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart?.(); }}
      className={[
        'group relative bg-white p-8 rounded-2xl',
        'border border-slate-200 shadow-sm',
        'hover:shadow-xl transition-all duration-200',
        'cursor-pointer flex flex-col h-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        accentBorderClass,
      ].join(' ')}
    >
      {/* ── 우상단: 즐겨찾기 별표 버튼 ── */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // 카드 클릭 이벤트 전파 차단
          onFavorite?.();
        }}
        className="absolute top-5 right-5 z-10 text-slate-300 hover:scale-110 transition-transform outline-none cursor-pointer"
        aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      >
        <Star
          size={22}
          fill={isFavorite ? '#eab308' : 'transparent'}
          color={isFavorite ? '#eab308' : 'currentColor'}
        />
      </button>

      {/* ── 아이콘 영역 ── */}
      <div className="relative w-14 h-14 rounded-xl mb-6 group-hover:scale-110 transition-transform overflow-hidden shrink-0">
        {/* iconBg의 10% opacity 배경 */}
        <div className={`absolute inset-0 ${iconBg} opacity-10`} aria-hidden="true" />
        <div className="relative flex items-center justify-center w-full h-full">
          {icon}
        </div>
      </div>

      {/* ── 본문 영역 ── */}
      <div className="flex-1">
        {/* 제목 + 개발중 뱃지 */}
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          <h3 className="text-xl font-bold text-slate-800 group-hover:text-blue-600 transition-colors leading-tight">
            {title}
          </h3>
          {/* devStatus가 'dev'일 경우 개발중 뱃지 표시 */}
          {devStatus === 'dev' && (
            <Badge variant="warning" size="sm" dot>
              개발중
            </Badge>
          )}
        </div>

        {/* 설명 */}
        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          {description}
        </p>

        {/* 태그 목록 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── 하단: 시작 버튼 영역 ── */}
      <div className="mt-8 flex items-center text-brand-blue font-bold text-sm">
        시작
        <ArrowRight
          size={16}
          className="ml-1.5 group-hover:translate-x-1 transition-transform"
        />
      </div>
    </div>
  );
}
