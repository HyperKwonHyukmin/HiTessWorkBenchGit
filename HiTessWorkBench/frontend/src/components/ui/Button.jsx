/// <summary>
/// 공유 버튼 컴포넌트입니다.
/// variant, size, fullWidth, isLoading, disabled 등 다양한 상태를 지원합니다.
/// </summary>
import React from 'react';
import { Loader2 } from 'lucide-react';

// --- 정적 클래스 맵 (Tailwind JIT 호환을 위해 동적 생성 금지) ---

/** variant별 기본 스타일 */
const VARIANT_CLASSES = {
  primary:   'bg-brand-blue text-white hover:bg-brand-blue-dark border border-transparent',
  green:     'bg-brand-green text-white hover:opacity-90 border border-transparent',
  danger:    'bg-red-600 text-white hover:bg-red-700 border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400',
  ghost:     'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-800',
};

/** size별 패딩·텍스트 크기 스타일 */
const SIZE_CLASSES = {
  sm: 'py-1.5 px-3 text-xs',
  md: 'py-2.5 px-5 text-sm',
  lg: 'py-3 px-6 text-base',
};

/**
 * Button 컴포넌트
 *
 * @param {object}   props
 * @param {'primary'|'green'|'danger'|'secondary'|'ghost'} [props.variant='primary'] - 버튼 스타일 종류
 * @param {'sm'|'md'|'lg'}  [props.size='md']    - 버튼 크기
 * @param {boolean}  [props.fullWidth=false]      - 전체 너비 여부
 * @param {boolean}  [props.isLoading=false]      - 로딩 스피너 표시 여부
 * @param {boolean}  [props.disabled=false]       - 비활성 상태
 * @param {React.ReactNode} [props.children]      - 버튼 내용
 * @param {string}   [props.className='']         - 추가 클래스
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  isLoading = false,
  disabled = false,
  children,
  className = '',
  ...rest
}) {
  // disabled 또는 로딩 중일 때는 상호작용 불가
  const isDisabled = disabled || isLoading;

  const baseClasses = [
    'inline-flex items-center justify-center gap-2',
    'font-semibold rounded-xl',
    'transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-blue/40',
    // disabled 상태 스타일
    isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]',
    // fullWidth 여부
    fullWidth ? 'w-full' : '',
    // variant·size 클래스
    VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.primary,
    SIZE_CLASSES[size] ?? SIZE_CLASSES.md,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      disabled={isDisabled}
      className={baseClasses}
      {...rest}
    >
      {/* 로딩 중일 때 스피너 아이콘 표시 */}
      {isLoading && (
        <Loader2
          size={size === 'sm' ? 12 : size === 'lg' ? 18 : 15}
          className="animate-spin shrink-0"
        />
      )}
      {children}
    </button>
  );
}
