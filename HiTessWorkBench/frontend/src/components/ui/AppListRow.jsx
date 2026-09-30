import React from 'react';
import { ArrowRight, CornerDownRight, Lock, Settings2, Star } from 'lucide-react';
import StatusBadge from './StatusBadge';
import FormatFlow, { FORMAT_FLOW_ALIGNED_COLS } from './FormatFlow';
import { formatNotificationTime } from '../../utils/notificationLink';

/**
 * 목록의 열 틀 — 행과 머리글이 같은 값을 써야 열이 위아래로 맞는다.
 *   별 | 앱(이름·설명) | 입력→출력 | 마지막 사용 | 담당 | 설정·진입
 * 좁은 화면에서는 뒤 열부터 접는다(형식은 설명 아래로 내려간다).
 * 형식 열 21.5rem 은 FormatFlow 의 FORMAT_FLOW_ALIGNED_COLS 합계와 같아야 한다.
 */
const ROW_GRID = [
  'grid items-center gap-x-4 px-4',
  'grid-cols-[1.75rem_minmax(0,1fr)_3.25rem]',
  'lg:grid-cols-[1.75rem_minmax(0,1fr)_21.5rem_4.5rem_3.25rem]',
  'xl:grid-cols-[1.75rem_minmax(0,1fr)_21.5rem_4.5rem_4.5rem_3.25rem]',
].join(' ');

function DevStatusBadge({ devStatus }) {
  if (!devStatus || devStatus === 'Active') return null;
  return <StatusBadge status={devStatus} size="sm" dot />;
}

/** 목록 맨 위에 한 번 놓는 열 이름. 형식·시각 열이 무엇인지 말해 준다(그 열들은 lg 이상에서만 있다). */
export function AppListHeader() {
  return (
    <div
      className={`${ROW_GRID} hidden py-2 text-[11px] font-semibold text-slate-500 lg:grid`}
      aria-hidden="true"
    >
      <span />
      <span>앱</span>
      <div className={`grid ${FORMAT_FLOW_ALIGNED_COLS} items-center gap-x-1.5`}>
        <span className="text-right">입력</span>
        <span />
        <span>출력</span>
      </div>
      <span className="text-right">마지막 사용</span>
      <span className="hidden xl:block">담당</span>
      <span />
    </div>
  );
}

/**
 * 앱 카탈로그의 한 행.
 *
 * 아이콘 칸이 없다 — 같은 화면의 앱은 모두 같은 모드라 아이콘·색이 전부 같고(모드 시그니처),
 * 그 시그니처는 페이지 머리글이 한 번 보여 준다. 대신 맨 앞에 즐겨찾기 별을 둬서
 * 자주 쓰는 앱이 세로로 훑을 때 바로 걸리게 한다.
 */
export default function AppListRow({
  app = {},
  isFavorite = false,
  isRestricted = false,
  // 같은 series 의 앞 앱에서 이어지는 단계(예: Truss 모델 생성 → 구조 평가).
  continuesPrevious = false,
  // 같은 series 의 다음 단계가 바로 아래 행에 이어진다.
  leadsNext = false,
  // 카테고리 소제목이 없는 목록에서만 이름 옆에 카테고리를 붙인다.
  showCategory = false,
  // 마지막으로 연 시각(epoch ms). 없으면 칸을 비운다.
  lastUsedAt,
  onFavorite,
  onStart,
  // 관리자에게만 전달된다 — 넘어오면 행에 App 설정(톱니바퀴) 버튼이 붙는다.
  onSettings,
}) {
  const {
    title = '',
    description = '',
    category,
    inputFormats = [],
    outputFormats = [],
    inputLabel = 'Input',
    devStatus,
    contributor,
  } = app;
  const lastUsed = lastUsedAt ? formatNotificationTime(lastUsedAt) : '';

  return (
    <article
      className={[
        ROW_GRID,
        'group relative py-3 transition-colors duration-150',
        'hover:bg-slate-50 focus-within:bg-slate-50',
        // 이어지는 단계는 앞 행과 한 덩어리로 읽히게 사이 구분선을 지우고 간격을 좁힌다.
        // (Tailwind 4 의 divide-y 는 앞 행의 border-bottom 이라, 지우는 쪽은 앞 행이다.)
        leadsNext ? '!border-b-0 !pb-1.5' : '',
        continuesPrevious ? '!pt-1.5' : '',
      ].join(' ')}
    >
      {/* 행 전체 진입 버튼. 별·설정 버튼과는 형제(중첩 아님)라 포커스·클릭이 서로 섞이지 않는다. */}
      <button
        type="button"
        onClick={onStart}
        aria-label={isRestricted ? `${title} (관리자 전용)` : `${title} 열기`}
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      />

      <button
        type="button"
        onClick={onFavorite}
        aria-pressed={isFavorite}
        aria-label={`${title} 즐겨찾기 ${isFavorite ? '해제' : '추가'}`}
        title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        className={[
          'relative z-10 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg outline-none',
          'transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-400',
          isFavorite ? 'text-amber-400' : 'text-slate-400 hover:text-amber-500',
        ].join(' ')}
      >
        <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      <div className="flex min-w-0 gap-2">
        {continuesPrevious && (
          <CornerDownRight size={14} className="mt-1 shrink-0 text-slate-400" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[15px] font-bold tracking-tight text-slate-800 transition-colors group-hover:text-blue-700">
              {continuesPrevious && <span className="sr-only">이전 단계에서 이어짐: </span>}
              {title}
            </h3>
            {showCategory && category && (
              <span className="shrink-0 text-[11px] font-semibold text-slate-500">{category}</span>
            )}
            <DevStatusBadge devStatus={devStatus} />
          </div>
          {description && (
            <p className="mt-0.5 truncate text-[13px] text-slate-500" title={description}>{description}</p>
          )}
          <FormatFlow
            className="mt-1.5 lg:hidden"
            inputLabel={inputLabel}
            inputFormats={inputFormats}
            outputFormats={outputFormats}
          />
        </div>
      </div>

      <FormatFlow
        aligned
        className="hidden lg:grid"
        inputLabel={inputLabel}
        inputFormats={inputFormats}
        outputFormats={outputFormats}
      />

      <span
        className="hidden text-right text-xs tabular-nums text-slate-500 lg:block"
        title={lastUsed ? `마지막 사용 ${lastUsed}` : undefined}
      >
        {lastUsed}
      </span>

      <span className="hidden truncate text-xs text-slate-500 xl:block">{contributor}</span>

      <div className="flex items-center justify-end gap-1.5">
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            title="App 설정 (관리자)"
            aria-label={`${title} App 설정`}
            className="relative z-10 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-slate-200/70 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Settings2 size={15} />
          </button>
        )}
        {isRestricted ? (
          <Lock size={15} className="text-slate-400" aria-hidden="true" />
        ) : (
          <ArrowRight
            size={16}
            className="text-slate-400 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-blue-600 motion-reduce:transform-none"
            aria-hidden="true"
          />
        )}
      </div>
    </article>
  );
}
