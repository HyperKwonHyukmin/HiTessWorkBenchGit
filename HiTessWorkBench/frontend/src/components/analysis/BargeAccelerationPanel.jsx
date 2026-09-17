import React, { useMemo } from 'react';
import { ArrowDownToLine, AlertTriangle, Calculator, CheckCircle2, Info } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import NumberField from './NumberField';
import { BARGE_LOAD_CASES, getBargeAccelerationInputIssues } from '../../utils/bargeAcceleration';

function SelectField({ label, value, onChange, disabled, children }) {
  return (
    <label className={`block min-w-0 ${disabled ? 'opacity-60' : ''}`}>
      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700
                   focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100
                   disabled:bg-slate-50 disabled:cursor-not-allowed"
      >
        {children}
      </select>
    </label>
  );
}

function ResultValue({ label, value, unit, tone = 'slate' }) {
  const valueClass = tone === 'blue' ? 'text-blue-700' : 'text-slate-800';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-bold ${valueClass}`}>
        {Number.isFinite(value) ? value.toFixed(5) : '—'}
        <span className="ml-1 text-[10px] font-medium text-slate-400">{unit}</span>
      </p>
    </div>
  );
}

export default function BargeAccelerationPanel({
  input,
  onChange,
  onImportModule,
  canImportModule,
  onCalculate,
  calculating,
  result,
  isCurrent,
  error,
  disabled,
  // 구조 해석에서 포락할 하중조건. 넘기지 않으면 선택 UI 를 띄우지 않는다
  // (이 패널은 가속도 계산만 하는 자리로도 쓰인다).
  envelopeLoadCases,
  onEnvelopeChange,
}) {
  const baselineVcgM = useMemo(() => (
    Number(input.cargoVcgFromBottomM || 0)
    + Number(input.bargeDepthM || 0)
    + Number(input.supportHeightM || 0)
  ), [input.cargoVcgFromBottomM, input.bargeDepthM, input.supportHeightM]);

  const inputIssues = useMemo(() => getBargeAccelerationInputIssues(input), [input]);
  const issueByField = useMemo(
    () => new Map(inputIssues.map(issue => [issue.field, issue.message])),
    [inputIssues],
  );
  const vcgOk = !issueByField.has('cargoVcgFromBaselineM');
  const inputsOk = inputIssues.length === 0;
  const activeResult = isCurrent ? result : null;
  const dynamic = activeResult?.dynamicAccelerationMS2;
  const total = activeResult?.totalAccelerationG;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Calculator size={16} className="text-blue-600" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Barge 가속도 계산</h4>
            <p className="text-[10px] text-slate-500">원본 Excel의 APOL(1) 보간 · 선택한 LC 한 개만 구조 해석에 적용</p>
          </div>
        </div>
        <Badge variant={isCurrent ? 'success' : 'warning'} size="sm" dot>
          {isCurrent ? '해석조건 적용 완료' : '계산 필요'}
        </Badge>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.9fr)]">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Motion · Cargo 입력</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onImportModule}
                disabled={disabled || !canImportModule}
                className="shrink-0"
                title="화물 = 정반+Unit 스택 전체로 봅니다. 합산 중량 · 정반 바닥 기준 합산 무게중심 VCG · Support Height 0 을 가져옵니다."
              >
                <ArrowDownToLine size={12} /> 2단계 정반+Unit 값 가져오기
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                label="유의파고 Hs" unit="m" value={input.significantWaveHeightM}
                min={0} step={0.1} disabled={disabled}
                error={issueByField.get('significantWaveHeightM')}
                onChange={value => onChange({ significantWaveHeightM: value })}
              />
              <SelectField
                label="Roll 임계감쇠" value={String(input.criticalDampingPct)} disabled={disabled}
                onChange={value => onChange({ criticalDampingPct: Number(value) })}
              >
                <option value="3">3% · Option 0 (Excel 기본)</option>
                <option value="5">5% · Option 1</option>
              </SelectField>
              <SelectField
                label="화물 배치" value={input.cargoPosition} disabled={disabled}
                onChange={value => onChange({ cargoPosition: value })}
              >
                <option value="single-center">단일 · Midship/Centerline</option>
                <option value="multiple-offset">복수 · 편심 배치</option>
              </SelectField>
              <NumberField
                label="화물 총중량" unit="ton" value={input.cargoWeightT}
                min={0} step={0.1} disabled={disabled}
                title="화물 = 정반 + Module Unit 스택 전체. 아래 VCG 도 반드시 같은 기준이어야 한다."
                error={issueByField.get('cargoWeightT')}
                onChange={value => onChange({ cargoWeightT: value })}
              />
              <NumberField
                label="화물 바닥 기준 VCG" unit="m" value={input.cargoVcgFromBottomM}
                min={0} step={0.1} disabled={disabled}
                title="화물(정반+Unit) 합산 무게중심의, 정반 바닥 기준 높이. 총중량과 같은 기준이어야 한다 — Unit 자체 VCG 를 넣으면 정반 질량(약 84%)을 무시한 값이 된다."
                onChange={value => onChange({ cargoVcgFromBottomM: value })}
              />
              <NumberField
                label="Barge Depth" unit="m" value={input.bargeDepthM}
                min={0} step={0.1} disabled={disabled}
                onChange={value => onChange({ bargeDepthM: value })}
              />
              <NumberField
                label="Support Height" unit="m" value={input.supportHeightM}
                min={0} step={0.1} disabled={disabled}
                title="바지 갑판에서 화물 바닥까지의 높이. 화물 = 정반+Unit 스택이므로 가져오기는 0 을 넣습니다(정반이 곧 화물이라 그 아래 받침이 없다)."
                onChange={value => onChange({ supportHeightM: value })}
              />
              <div className="sm:col-span-1 lg:col-span-2">
                <p className="text-[11px] font-semibold text-slate-600">Barge baseline 기준 화물 VCG</p>
                <div
                  aria-invalid={!vcgOk}
                  className={`mt-1 flex min-h-[31px] items-center justify-between rounded-lg border px-2.5 py-1.5
                  ${vcgOk ? 'border-slate-200 bg-slate-50' : 'border-red-300 bg-red-50'}`}
                >
                  <span className="font-mono text-xs font-bold text-slate-700">{baselineVcgM.toFixed(3)} m</span>
                  <span className={`text-[10px] font-semibold ${vcgOk ? 'text-emerald-600' : 'text-red-600'}`}>
                    {vcgOk ? '허용 3~25 m' : '범위를 확인하세요'}
                  </span>
                </div>
                {!vcgOk && (
                  <p className="mt-1 text-[10px] font-medium leading-snug text-red-600">
                    {issueByField.get('cargoVcgFromBaselineM')}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              대표 하중조건 <span className="font-normal normal-case text-slate-400">— 아래 가속도 표에 보일 조건</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BARGE_LOAD_CASES.map(lc => {
                const selected = input.loadCase === lc.id;
                return (
                  <button
                    key={lc.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ loadCase: lc.id })}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200
                      ${selected
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}
                      disabled:cursor-not-allowed disabled:opacity-60`}
                    aria-pressed={selected}
                  >
                    <span className="block text-xs font-bold">{lc.id} <span className="font-mono">({lc.signs})</span></span>
                    <span className="mt-0.5 block text-[9px]">{lc.description}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
              <Info size={11} className="mt-0.5 shrink-0" />
              부호는 동적 가속도 방향입니다. 총 Z 가속도에는 중력 −1g가 합성되며, 환산값은 9.8 m/s²를 사용합니다.
            </p>
          </div>

          {onEnvelopeChange && (
            <div className="border-t border-slate-100 pt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  구조 해석 포락 조건
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onEnvelopeChange(BARGE_LOAD_CASES.map(lc => lc.id))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold
                    text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  8개 전부
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {BARGE_LOAD_CASES.map(lc => {
                  const on = envelopeLoadCases.includes(lc.id);
                  const last = on && envelopeLoadCases.length <= 1;
                  return (
                    <button
                      key={lc.id}
                      type="button"
                      disabled={disabled || last}
                      title={`${lc.description}${last ? ' — 최소 한 개는 남겨야 합니다' : ''}`}
                      onClick={() => onEnvelopeChange(
                        on ? envelopeLoadCases.filter(id => id !== lc.id)
                          : [...envelopeLoadCases, lc.id],
                      )}
                      aria-pressed={on}
                      className={`rounded-md border px-1.5 py-1 text-center transition-colors
                        ${on ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'}
                        disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="block text-[11px] font-bold">{lc.id}</span>
                      <span className="block font-mono text-[9px]">{lc.signs}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
                <Info size={11} className="mt-0.5 shrink-0" />
                <span>
                  고른 조건을 <b>한 모델의 SUBCASE 로 함께</b> 풀고 부재·Leg 마다 자기 최악 조건을 고릅니다.
                  강성 분해가 한 번이라 8개를 다 풀어도 해석 시간은 1개일 때와 사실상 같습니다.
                  <b className="text-amber-700"> LC1~4 는 횡방향이 모두 +Y 라 그 4개만으로는 포락이 아닙니다</b>
                  {' '}— 실측에서 −Y(LC5~8)가 지배 Leg 를 바꿨습니다.
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">계산 결과</p>
            {activeResult && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                <CheckCircle2 size={11} /> {activeResult.loadCase.id} 적용
              </span>
            )}
          </div>

          <p className="mb-1 mt-3 text-[10px] font-semibold text-slate-500">Most Probable Maximum</p>
          <div className="grid grid-cols-3 gap-2">
            <ResultValue label="X" value={dynamic?.x} unit="m/s²" />
            <ResultValue label="Y" value={dynamic?.y} unit="m/s²" />
            <ResultValue label="Z" value={dynamic?.z} unit="m/s²" />
          </div>

          <p className="mb-1 mt-3 text-[10px] font-semibold text-slate-500">중력 포함 총 가속도</p>
          <div className="grid grid-cols-3 gap-2">
            <ResultValue label="AX" value={total?.ax} unit="g" tone="blue" />
            <ResultValue label="AY" value={total?.ay} unit="g" tone="blue" />
            <ResultValue label="AZ" value={total?.az} unit="g" tone="blue" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
            <span className="text-[10px] font-semibold text-blue-700">합성 가속도</span>
            <span className="font-mono text-sm font-bold text-blue-800">
              {Number.isFinite(activeResult?.totalMagnitudeG) ? activeResult.totalMagnitudeG.toFixed(5) : '—'} g
            </span>
          </div>

          {!isCurrent && result && (
            <p className="mt-2 text-[10px] font-semibold text-amber-700">
              입력 또는 LC가 변경되었습니다. 다시 계산해야 구조 해석에 적용됩니다.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">
              {error}
            </p>
          )}
          {!inputsOk && (
            <div role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900">
              <p className="flex items-center gap-1.5 text-[11px] font-bold">
                <AlertTriangle size={13} aria-hidden="true" /> 가속도를 계산할 수 없는 입력이 있습니다
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[10px] leading-relaxed">
                {inputIssues.map(issue => <li key={issue.field}>{issue.message}</li>)}
              </ul>
              <p className="mt-1.5 text-[10px] text-amber-800">
                범위 밖 값은 신뢰할 수 없는 외삽이 되므로 자동 보정하지 않습니다.
              </p>
            </div>
          )}

          <div className="mt-auto pt-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              fullWidth
              isLoading={calculating}
              disabled={disabled || !inputsOk}
              title={!inputsOk ? inputIssues[0]?.message : undefined}
              onClick={onCalculate}
            >
              <Calculator size={13} /> 가속도 계산 및 해석조건 적용
            </Button>
            <p className="mt-2 text-center text-[9px] text-slate-400">
              Barge_Acceleration_rev02_YJH_RE(회신).xlsm 기준
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
