import React from 'react';

// 계산기(파라메트릭) 페이지 공용 숫자 입력 필드.
// 기존에 MastPost/JibRest/DTypeLug 등이 각자 정의하던 InputField 를 통합한다.
// 구조는 디자인 스펙(rounded-lg, 1px border, focus 시 ring-2)으로 통일하되,
// 페이지별 폼 밀도 차이를 위해 size(sm/md/lg)로 패딩·라벨 크기만 분기한다.
// 각 페이지는 이 컴포넌트를 size 등을 고정한 얇은 래퍼로 감싸 사용하므로
// 기존 호출부(<InputField .../>)는 수정 없이 그대로 동작한다.

const SIZES = {
  sm: { label: 'text-[11px]', pad: 'px-2.5 py-2', unit: 'px-2.5 py-2 text-[11px]' },
  md: { label: 'text-xs',     pad: 'px-3 py-2.5',  unit: 'px-3 py-2.5 text-xs' },
  lg: { label: 'text-sm',     pad: 'px-4 py-3',    unit: 'px-4 py-3 text-sm' },
};

export default function CalcInputField({
  label,
  desc,
  value,
  onChange,
  unit,
  placeholder,
  readOnly = false,
  min,
  type = 'number',
  size = 'md',
}) {
  const s = SIZES[size] ?? SIZES.md;
  return (
    <div>
      {label && (
        <label className={`block ${s.label} font-semibold text-slate-600 mb-1`}>{label}</label>
      )}
      {desc && <p className="text-[11px] text-slate-400 mb-1">{desc}</p>}
      <div
        className={`flex items-center rounded-lg border overflow-hidden transition-all bg-white ${
          readOnly
            ? 'border-slate-100 bg-slate-50'
            : 'border-slate-200 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20'
        }`}
      >
        <input
          type={type}
          value={value}
          min={min}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          className={`min-w-0 flex-1 ${s.pad} text-sm font-bold text-slate-800 outline-none bg-transparent`}
        />
        {unit != null && unit !== '' && (
          <span className={`${s.unit} bg-slate-50 text-slate-500 font-bold border-l border-slate-200 shrink-0`}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
