/// <summary>
/// 공유 입력 필드 컴포넌트입니다.
/// label, error, leftIcon, size 등의 props를 지원하며,
/// 나머지 모든 native input 속성을 그대로 전달합니다.
/// </summary>
import React from 'react';

// --- 정적 클래스 맵 (Tailwind JIT 호환) ---

/** size별 패딩·텍스트 크기 */
const SIZE_CLASSES = {
  sm: 'py-1.5 text-xs',
  md: 'py-2.5 text-sm',
  lg: 'py-3 text-base',
};

/** 정상 상태 border·ring 색상 */
const NORMAL_BORDER = 'border-slate-200 focus:border-brand-blue focus:ring-brand-blue/20';

/** 에러 상태 border·ring 색상 */
const ERROR_BORDER  = 'border-red-400 focus:border-red-400 focus:ring-red-400/20';

/**
 * Input 컴포넌트
 *
 * @param {object}        props
 * @param {string}        [props.label]           - 입력 필드 위 라벨 텍스트
 * @param {string}        [props.error]           - 에러 메시지 (있으면 border 빨간색)
 * @param {React.ElementType} [props.leftIcon]    - 좌측에 표시할 lucide-react 아이콘 컴포넌트
 * @param {'sm'|'md'|'lg'} [props.size='md']      - 입력 필드 크기
 * @param {string}        [props.className='']    - 추가 클래스
 */
export default function Input({
  label,
  error,
  leftIcon: LeftIcon,
  size = 'md',
  className = '',
  id,
  ...rest
}) {
  // label-input 연결을 위한 고유 id (prop 미전달 시 자동 생성)
  const inputId = id ?? (label ? `input-${label.replace(/\s+/g, '-')}` : undefined);

  const sizeClass    = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  const borderClass  = error ? ERROR_BORDER : NORMAL_BORDER;

  // 좌측 아이콘 유무에 따른 패딩 조정
  const paddingLeft  = LeftIcon ? 'pl-9' : 'px-3';

  const inputClasses = [
    'w-full border rounded-lg outline-none',
    'focus:ring-2 transition-all duration-200',
    'bg-white text-slate-800 placeholder-slate-400',
    sizeClass,
    borderClass,
    paddingLeft,
    'pr-3',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1">
      {/* 라벨 영역 */}
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-semibold text-slate-600 select-none"
        >
          {label}
        </label>
      )}

      {/* 입력 필드 래퍼 (아이콘 위치 기준점) */}
      <div className="relative">
        {/* 좌측 아이콘 */}
        {LeftIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <LeftIcon size={14} />
          </span>
        )}

        <input
          id={inputId}
          className={inputClasses}
          {...rest}
        />
      </div>

      {/* 에러 메시지 */}
      {error && (
        <p className="text-xs text-red-500 mt-0.5">
          {error}
        </p>
      )}
    </div>
  );
}
