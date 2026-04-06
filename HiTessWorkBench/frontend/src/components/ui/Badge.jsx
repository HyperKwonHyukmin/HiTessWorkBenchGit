/// <summary>
/// 상태 뱃지/태그 컴포넌트입니다.
/// variant로 색상, size로 크기, dot prop으로 좌측 원형 마커 표시를 제어합니다.
/// </summary>
import React from 'react';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

/**
 * variant별 배경·텍스트·border 클래스 묶음
 * Tailwind는 빌드 시 클래스를 정적으로 스캔하므로 문자열을 완성형으로 작성해야 합니다.
 */
const VARIANT_CLASSES = {
  success: {
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    dot:   'bg-emerald-500',
  },
  error: {
    badge: 'bg-red-50 text-red-700 border border-red-200',
    dot:   'bg-red-500',
  },
  warning: {
    badge: 'bg-amber-50 text-amber-700 border border-amber-200',
    dot:   'bg-amber-500',
  },
  info: {
    badge: 'bg-blue-50 text-blue-700 border border-blue-200',
    dot:   'bg-blue-500',
  },
  neutral: {
    badge: 'bg-slate-100 text-slate-600 border border-slate-200',
    dot:   'bg-slate-400',
  },
  purple: {
    badge: 'bg-purple-50 text-purple-700 border border-purple-200',
    dot:   'bg-purple-500',
  },
};

/** size별 패딩·텍스트 크기 */
const SIZE_CLASSES = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

/**
 * Badge 컴포넌트
 *
 * @param {object}  props
 * @param {'success'|'error'|'warning'|'info'|'neutral'|'purple'} [props.variant='neutral'] - 색상 종류
 * @param {'sm'|'md'} [props.size='md'] - 뱃지 크기
 * @param {boolean} [props.dot=false]   - 좌측 색상 원형 dot 표시 여부
 * @param {React.ReactNode} props.children - 뱃지 내부 텍스트
 * @param {string}  [props.className=''] - 추가 클래스
 */
export default function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
  className = '',
}) {
  const { badge: badgeClass, dot: dotClass } = VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.neutral;
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5',
        'rounded-full font-bold',
        badgeClass,
        sizeClass,
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* 좌측 원형 dot */}
      {dot && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
