import React, { useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, Calculator } from 'lucide-react';
import { parseEngineeringExpression } from '../../utils/engineeringNumber';

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
  max,
  step = 'any',
  type = 'number',
  size = 'md',
  id,
  name,
  required = false,
  disabled = false,
  error,
  warning,
  precision,
  unitOptions,
  unitValue,
  onUnitChange,
  allowFormula = false,
  rangeHint = true,
  onBlur,
  onFocus,
  className = '',
}) {
  const s = SIZES[size] ?? SIZES.md;
  const generatedId = useId();
  const inputId = id || `calc-input-${generatedId.replace(/:/g, '')}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const normalizedUnits = useMemo(
    () => (unitOptions || []).map(option => (
      typeof option === 'string'
        ? { value: option, label: option, factor: 1 }
        : { factor: 1, ...option }
    )),
    [unitOptions],
  );
  const [internalUnit, setInternalUnit] = useState(
    unitValue || normalizedUnits[0]?.value || unit || '',
  );
  const [formulaDraft, setFormulaDraft] = useState('');
  const [formulaError, setFormulaError] = useState('');

  useEffect(() => {
    if (unitValue != null) setInternalUnit(unitValue);
  }, [unitValue]);

  const selectedUnit = unitValue ?? internalUnit;
  const selectedUnitMeta = normalizedUnits.find(option => option.value === selectedUnit);
  const factor = Number(selectedUnitMeta?.factor) || 1;
  const displayedMin = min != null ? Number(min) / factor : undefined;
  const displayedMax = max != null ? Number(max) / factor : undefined;
  const displayedStep = step !== 'any' && Number.isFinite(Number(step))
    ? Number(step) / factor
    : step;
  const numericValue = value === '' || value == null ? null : Number(value);
  const displayedValue = formulaDraft !== ''
    ? formulaDraft
    : numericValue != null && Number.isFinite(numericValue) && factor !== 1
      ? numericValue / factor
      : value;
  const rangeError = numericValue != null && Number.isFinite(numericValue)
    ? min != null && numericValue < Number(min)
      ? `최솟값 ${min}${unit ? ` ${unit}` : ''} 이상이어야 합니다.`
      : max != null && numericValue > Number(max)
        ? `최댓값 ${max}${unit ? ` ${unit}` : ''} 이하여야 합니다.`
        : ''
    : '';
  const effectiveError = error || formulaError || rangeError;
  const describedBy = [
    desc || rangeHint ? helpId : null,
    effectiveError || warning ? errorId : null,
  ].filter(Boolean).join(' ') || undefined;

  const commitNumericValue = (rawValue) => {
    if (rawValue === '') {
      onChange?.('');
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const canonical = parsed * factor;
    const normalized = Number.isInteger(precision)
      ? Number(canonical.toFixed(precision))
      : canonical;
    onChange?.(String(normalized));
  };

  const handleChange = (event) => {
    const next = event.target.value;
    setFormulaError('');
    if (allowFormula && /[()+\-*/^]/.test(next.replace(/^[+-]?[\d.]+(?:e[+-]?\d+)?$/i, ''))) {
      setFormulaDraft(next);
      return;
    }
    setFormulaDraft('');
    commitNumericValue(next);
  };

  const handleBlur = (event) => {
    if (formulaDraft !== '') {
      const parsed = parseEngineeringExpression(formulaDraft);
      if (parsed == null) {
        setFormulaError('수식을 계산할 수 없습니다. 숫자와 + − × ÷, 괄호를 확인하세요.');
      } else {
        setFormulaError('');
        setFormulaDraft('');
        commitNumericValue(parsed);
      }
    } else if (Number.isInteger(precision) && numericValue != null && Number.isFinite(numericValue)) {
      onChange?.(String(Number(numericValue.toFixed(precision))));
    }
    onBlur?.(event);
  };

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className={`block ${s.label} font-semibold text-slate-600 mb-1`}>
          {label}
          {required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}
        </label>
      )}
      {desc && <p id={helpId} className="mb-1 text-[11px] text-slate-500">{desc}</p>}
      <div
        className={`flex items-center rounded-lg border overflow-hidden transition-all bg-white ${
          readOnly || disabled
            ? 'border-slate-100 bg-slate-50'
            : effectiveError
              ? 'border-red-400 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500/20'
              : 'border-slate-200 focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20'
        }`}
      >
        {allowFormula && (
          <span className="pl-3 text-slate-400" title="사칙연산 수식 입력 가능">
            <Calculator size={14} />
          </span>
        )}
        <input
          id={inputId}
          name={name}
          type={allowFormula ? 'text' : type}
          inputMode={type === 'number' || allowFormula ? 'decimal' : undefined}
          value={displayedValue ?? ''}
          min={displayedMin}
          max={displayedMax}
          step={displayedStep}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={disabled}
          required={required}
          aria-invalid={!!effectiveError}
          aria-describedby={describedBy}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={onFocus}
          className={`min-w-0 flex-1 ${s.pad} text-sm font-bold text-slate-800 outline-none bg-transparent disabled:cursor-not-allowed disabled:text-slate-400`}
        />
        {normalizedUnits.length > 0 ? (
          <select
            value={selectedUnit}
            disabled={readOnly || disabled}
            onChange={(event) => {
              const next = event.target.value;
              if (unitValue == null) setInternalUnit(next);
              onUnitChange?.(next);
            }}
            className={`${s.unit} border-l border-slate-200 bg-slate-50 font-bold text-slate-600 outline-none focus:bg-blue-50 disabled:text-slate-400`}
            aria-label={`${label || '입력값'} 단위`}
          >
            {normalizedUnits.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : unit != null && unit !== '' && (
          <span className={`${s.unit} bg-slate-50 text-slate-500 font-bold border-l border-slate-200 shrink-0`}>
            {unit}
          </span>
        )}
      </div>
      {!desc && rangeHint && (min != null || max != null) && (
        <p id={helpId} className="mt-1 text-[10px] font-medium text-slate-500">
          허용 범위: {min ?? '제한 없음'} – {max ?? '제한 없음'}{unit ? ` ${unit}` : ''}
          {allowFormula ? ' · 수식 입력 가능' : ''}
        </p>
      )}
      {(effectiveError || warning) && (
        <p
          id={errorId}
          className={`mt-1 flex items-start gap-1 text-[11px] font-semibold ${
            effectiveError ? 'text-red-600' : 'text-amber-700'
          }`}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{effectiveError || warning}</span>
        </p>
      )}
    </div>
  );
}
