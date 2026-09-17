import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Crosshair, Info, Layers, Loader2, RotateCcw, ShieldCheck,
} from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import NumberField from './NumberField';
import { assessModuleOceanWeld } from '../../api/analysis';
import { DEFAULT_WELD_SPEC, weldSpecEquals } from '../../utils/weldSpecDefaults';

const RESULT_SCHEMA = 'module-ocean-weld/2';

const MATERIAL_FIELDS = [
  { key: 'yieldMPa', label: 'Yield Stress', unit: 'MPa', step: 10, min: 1 },
  { key: 'safetyFactor', label: 'Required Safety Factor', unit: '', step: 0.1, min: 0.1 },
];

const PLATE_FIELDS = [
  { key: 'plateHeightMm', label: 'Plate Height', unit: 'mm', step: 10, min: 1 },
  { key: 'plateBreadthMm', label: 'Plate Breadth', unit: 'mm', step: 10, min: 1 },
];

const WELD_FIELDS = [
  { key: 'tackCount', label: 'Welding Point', unit: 'EA', step: 1, min: 4, max: 4, disabled: true },
  { key: 'weldLengthMm', label: 'Weld Length', unit: 'mm', step: 1, min: 1 },
  { key: 'weldLegMm', label: 'Weld Leg', unit: 'mm', step: 1, min: 1 },
];

const formatNumber = (value, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatMoment = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
};

function WeldLayoutDiagram({ spec, governingPoint }) {
  const height = Math.max(Number(spec.plateHeightMm) || 1, 1);
  const breadth = Math.max(Number(spec.plateBreadthMm) || 1, 1);
  const length = Math.min(Math.max(Number(spec.weldLengthMm) || 1, 1), height, breadth);
  const scale = 142 / Math.max(height, breadth);
  const plateWidth = breadth * scale;
  const plateHeight = height * scale;
  const horizontalWeld = length * scale;
  const verticalWeld = length * scale;
  const cx = 130;
  const cy = 93;
  const left = cx - plateWidth / 2;
  const right = cx + plateWidth / 2;
  const top = cy - plateHeight / 2;
  const bottom = cy + plateHeight / 2;
  const pointX = governingPoint
    ? cx + (Number(governingPoint.xMm) / breadth) * plateWidth
    : null;
  const pointY = governingPoint
    ? cy - (Number(governingPoint.yMm) / height) * plateHeight
    : null;

  return (
    <figure className="min-w-0" aria-labelledby="weld-layout-title">
      <figcaption id="weld-layout-title" className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">Welding Arrangement</span>
        <span className="text-[10px] text-slate-500">4-side centered</span>
      </figcaption>
      <svg viewBox="0 0 260 205" className="h-[205px] w-full" role="img">
        <title>Plate 네 면 중앙의 4분절 필릿용접 배치</title>
        <desc>파란색 사각형은 Plate, 붉은 선은 용접 분절, 주황색 점은 지배 응력 위치입니다.</desc>
        <rect x="0.5" y="0.5" width="259" height="204" rx="10" fill="#f8fafc" stroke="#e2e8f0" />

        <line x1="22" y1={cy} x2="238" y2={cy} stroke="#cbd5e1" strokeDasharray="3 4" />
        <line x1={cx} y1="12" x2={cx} y2="174" stroke="#cbd5e1" strokeDasharray="3 4" />
        <rect
          x={left} y={top} width={plateWidth} height={plateHeight}
          fill="#eff6ff" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 3"
        />

        <line x1={cx - horizontalWeld / 2} y1={top} x2={cx + horizontalWeld / 2} y2={top}
          stroke="#dc2626" strokeWidth="6" strokeLinecap="square" />
        <line x1={right} y1={cy - verticalWeld / 2} x2={right} y2={cy + verticalWeld / 2}
          stroke="#dc2626" strokeWidth="6" strokeLinecap="square" />
        <line x1={cx - horizontalWeld / 2} y1={bottom} x2={cx + horizontalWeld / 2} y2={bottom}
          stroke="#dc2626" strokeWidth="6" strokeLinecap="square" />
        <line x1={left} y1={cy - verticalWeld / 2} x2={left} y2={cy + verticalWeld / 2}
          stroke="#dc2626" strokeWidth="6" strokeLinecap="square" />

        <circle cx={cx} cy={cy} r="3.5" fill="#002554" />
        <text x={cx + 7} y={cy - 7} fontSize="10" fontWeight="700" fill="#334155">PLATE</text>

        {Number.isFinite(pointX) && Number.isFinite(pointY) && (
          <g>
            <circle cx={pointX} cy={pointY} r="7" fill="#fef3c7" stroke="#b45309" strokeWidth="1.5" />
            <circle cx={pointX} cy={pointY} r="2.5" fill="#d97706" />
          </g>
        )}

        <line x1={left} y1="184" x2={right} y2="184" stroke="#64748b" />
        <line x1={left} y1="180" x2={left} y2="188" stroke="#64748b" />
        <line x1={right} y1="180" x2={right} y2="188" stroke="#64748b" />
        <text x={cx} y="199" textAnchor="middle" fontSize="10" fill="#475569">
          B {formatNumber(breadth, 0)} mm
        </text>

        <line x1="12" y1={top} x2="12" y2={bottom} stroke="#64748b" />
        <line x1="8" y1={top} x2="16" y2={top} stroke="#64748b" />
        <line x1="8" y1={bottom} x2="16" y2={bottom} stroke="#64748b" />
        <text x="7" y={cy} textAnchor="middle" fontSize="10" fill="#475569"
          transform={`rotate(-90 7 ${cy})`}>
          H {formatNumber(height, 0)} mm
        </text>
      </svg>
      <div className="mt-1 flex items-center justify-center gap-4 text-[10px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-red-600" />용접선</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-600" />지배점</span>
      </div>
    </figure>
  );
}

function ResultBadge({ status }) {
  return <Badge variant={status === 'OK' ? 'success' : 'error'} size="sm" dot>{status === 'OK' ? 'OK' : 'NG'}</Badge>;
}

function SpecFieldGroup({ title, fields, weldSpec, onSpecChange }) {
  const shortestSide = Math.min(
    Number(weldSpec.plateHeightMm) || Infinity,
    Number(weldSpec.plateBreadthMm) || Infinity,
  );

  return (
    <div className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
      <p className="mb-2 text-[11px] font-bold text-slate-700">{title}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {fields.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            unit={field.unit}
            step={field.step}
            min={field.min}
            max={field.key === 'weldLengthMm' ? shortestSide : field.max}
            disabled={field.disabled}
            value={weldSpec[field.key]}
            title={field.disabled ? 'Excel 기준 네 면 중앙 4분절 배치로 고정됩니다.' : undefined}
            onChange={(value) => onSpecChange({ ...weldSpec, [field.key]: value })}
          />
        ))}
      </div>
    </div>
  );
}

export default function OceanWeldPanel({
  legReaction, weld, weldSpec, onSpecChange, onWeldResult, onOpenLegModel,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef(null);
  const seqRef = useRef(0);
  const requestedRef = useRef(null);

  const legJson = legReaction?.resultJson;
  const summary = weld?.summary;
  const section = weld?.section;
  const rows = weld?.legs || [];
  const quality = legReaction?.quality;
  const stale = Boolean(legJson) && (
    weld?.schema !== RESULT_SCHEMA || !section || !weldSpecEquals(weldSpec, weld?.spec)
  );

  useEffect(() => {
    if (!stale) return undefined;
    const specKey = `${legJson}|${JSON.stringify(weldSpec)}`;
    if (requestedRef.current === specKey) return undefined;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      requestedRef.current = specKey;
      setBusy(true);
      setError('');
      try {
        const response = await assessModuleOceanWeld(legJson, weldSpec);
        if (seq === seqRef.current) onWeldResult(response.data);
      } catch (requestError) {
        if (seq !== seqRef.current) return;
        const detail = requestError?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail
          : Array.isArray(detail) ? detail.map((item) => item.msg).join(', ')
            : '용접부 재평가에 실패했습니다.');
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [stale, legJson, JSON.stringify(weldSpec)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!legReaction) return null;

  const isDefaultSpec = weldSpecEquals(weldSpec, DEFAULT_WELD_SPEC);
  const pendingClass = stale ? 'opacity-40 transition-opacity' : 'transition-opacity';
  const governingPoint = summary?.governingPoint;
  const check = legReaction?.check;
  // 모멘트 검산은 무게중심이 있어야 돌아간다(옛 결과에는 없다) — 있을 때만 표시한다.
  // 단일 LC 결과는 check.moment, 포락 결과는 check.momentOk/momentMaxRelError 로 온다.
  const momentOk = check?.moment ? check.moment.ok : check?.momentOk;
  const momentError = check?.moment ? check.moment.maxRelError : check?.momentMaxRelError;
  const momentChecked = momentOk !== null && momentOk !== undefined;
  const allChecksOk = check?.ok === true && (!momentChecked || momentOk === true);
  // 기둥 높이를 정반 실형상에서 읽기 전(스터브 500mm 아래로 매달던 시절)의 결과는
  // 반력 모멘트가 실제의 1/4 이라 용접 안전율이 과대하게 나온다. 숫자만 보면
  // 구분할 수 없으므로 반드시 표시해야 한다 — 결과에 zTopMm 이 있는지가 판별자다.
  const reactionLegs = legReaction?.legs || [];
  const legacyReaction = reactionLegs.length > 0 && !Number.isFinite(reactionLegs[0]?.zTopMm);

  return (
    <div className="space-y-4">
      {legacyReaction && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold">기둥 높이 수정 전에 돌린 해석입니다 — 다시 해석하세요</p>
            <p className="mt-0.5 text-[11px] text-red-700">
              예전 모델은 정반 Leg 아래로 500mm 스터브를 매달아 모멘트 지렛대가 250mm 였습니다.
              실제 기둥(2,145mm)의 약 1/4 이라 굽힘응력이 작게 나오고 안전율이 과대평가됩니다.
              아래 판정은 참고만 하세요.
            </p>
          </div>
        </div>
      )}

      {/* ⚠ 예전 문구("반력 해석에 구속되지 않은 자유도가 있습니다")는 오해를 샀다 —
          특이 자유도는 사실상 전부 **Module Unit(화물) 쪽**에 있는데, 문구가 정반 Leg
          반력 자체를 의심하게 만들었다. 반력은 정반 Leg 절점의 SPC 반력이고 합계 평형
          검산으로 따로 확인된다. 그래서 특이가 **정반 쪽에도 있는지**로 갈라 말한다. */}
      {quality && quality.trustworthy === false && (() => {
        const deckSide = quality.highPivotDeckNodeIds?.length || 0;
        const onlyModule = deckSide === 0;
        const balanced = check?.ok === true;   // 반력 합계 = 질량×가속도 검산
        return (
          <div className={`flex items-start gap-2.5 rounded-xl border p-3 ${onlyModule
            ? 'border-slate-300 bg-slate-50 text-slate-700'
            : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-bold">
                {onlyModule
                  ? 'Module Unit 쪽에 구속되지 않은 자유도가 있습니다'
                  : '정반 쪽에 구속되지 않은 자유도가 있습니다 — 판정 전에 확인하세요'}
              </p>
              <p className={`mt-0.5 text-[11px] ${onlyModule ? 'text-slate-500' : 'text-amber-700'}`}>
                특이 자유도 {quality.highPivotDofCount}개(절점 {quality.highPivotNodeCount}개)
                {onlyModule
                  ? <> 는 모두 Module Unit 부재에 있습니다. 아래 판정에 쓰는 반력은
                      <b> 정반 Leg 절점의 SPC 반력</b>이라
                      {balanced ? ' 영향을 받지 않습니다(합계 평형 검산 통과).'
                        : ' 별개이지만, 합계 평형 검산은 통과하지 못했습니다.'}
                      {' '}자세한 내역은 「과정 1 · 구조 검토」 탭에 있습니다.</>
                  : <> 중 {deckSide}개 절점이 정반 쪽입니다 — 반력이 영향을 받을 수 있습니다.</>}
              </p>
            </div>
          </div>
        );
      })()}

      <section className={`rounded-2xl border p-4 shadow-sm ${
        summary?.status === 'NG' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
      }`}>
        <div className={pendingClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-slate-600" />
              <h4 className="text-sm font-bold text-slate-800">정반 Leg 용접부 판정</h4>
              {summary && <ResultBadge status={summary.status} />}
            </div>
            <Badge variant="info" size="sm" dot>Elastic line weld group · 8 endpoints · 6-DOF</Badge>
          </div>

          {weld?.error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700">
              용접 평가를 수행하지 못했습니다: {weld.error}
            </p>
          ) : !summary ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              {legJson && <Loader2 size={13} className="animate-spin" />}
              {legJson ? '저장된 Leg 반력으로 용접부를 평가하고 있습니다.'
                : 'Leg 반력 파일이 없습니다. 구조 해석을 다시 수행하세요.'}
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
              <div><p className="text-[10px] text-slate-500">Maximum Equivalent</p>
                <p className="font-mono text-sm font-bold text-slate-800">{formatNumber(summary.maxSigmaEqMPa)} MPa</p></div>
              <div><p className="text-[10px] text-slate-500">Allowable</p>
                <p className="font-mono text-sm font-bold text-slate-800">{formatNumber(summary.allowableMPa)} MPa</p></div>
              <div><p className="text-[10px] text-slate-500">Usage</p>
                <p className={`font-mono text-sm font-bold ${summary.maxUsage > 1 ? 'text-red-700' : 'text-slate-800'}`}>
                  {formatNumber(summary.maxUsage, 3)}</p></div>
              <div><p className="text-[10px] text-slate-500">Actual Safety Factor</p>
                <p className="font-mono text-sm font-bold text-slate-800">{formatNumber(summary.actualSafetyFactor, 2)}</p></div>
              <div><p className="text-[10px] text-slate-500">Governing Boundary</p>
                <p className="text-sm font-bold text-slate-800">Leg {summary.governingLegIndex}</p></div>
              <div><p className="text-[10px] text-slate-500">Governing Point</p>
                <p className="truncate text-sm font-bold text-slate-800" title={governingPoint?.label}>
                  {governingPoint?.label || '—'}</p></div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-800">Weld Specification</h4>
              <p className="mt-0.5 text-[10px] text-slate-500">전 Leg 공통 · Excel reference layout</p>
            </div>
            {!isDefaultSpec && !busy && (
              <Button type="button" variant="ghost" size="sm"
                className="px-2 py-1 text-[10px]" onClick={() => onSpecChange({ ...DEFAULT_WELD_SPEC })}>
                <RotateCcw size={11} /> 기본값
              </Button>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <SpecFieldGroup title="Material / Criteria" fields={MATERIAL_FIELDS}
              weldSpec={weldSpec} onSpecChange={onSpecChange} />
            <SpecFieldGroup title="Plate" fields={PLATE_FIELDS}
              weldSpec={weldSpec} onSpecChange={onSpecChange} />
            <SpecFieldGroup title="Welding" fields={WELD_FIELDS}
              weldSpec={weldSpec} onSpecChange={onSpecChange} />
          </div>

          {busy && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
              <Loader2 size={12} className="animate-spin" /> 변경된 사양으로 재평가 중
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(320px,1.2fr)]">
            <WeldLayoutDiagram spec={weldSpec} governingPoint={governingPoint} />

            <div className={pendingClass}>
              <div className="flex items-center gap-2">
                <Crosshair size={14} className="text-slate-500" />
                <h4 className="text-xs font-bold text-slate-700">Section Properties</h4>
              </div>
              {section ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-[11px]">
                  <div><dt className="text-slate-500">Effective Throat</dt>
                    <dd className="font-mono font-semibold text-slate-800">{formatNumber(section.throatMm, 2)} mm</dd></div>
                  <div><dt className="text-slate-500">Single Weld Area</dt>
                    <dd className="font-mono font-semibold text-slate-800">{formatNumber(section.weldAreaMm2, 1)} mm²</dd></div>
                  <div><dt className="text-slate-500">Total Area</dt>
                    <dd className="font-mono font-semibold text-slate-800">{formatNumber(section.totalAreaMm2, 1)} mm²</dd></div>
                  <div><dt className="text-slate-500">Polar Moment J</dt>
                    <dd className="font-mono font-semibold text-slate-800">{formatMoment(section.polarMomentMm4)} mm⁴</dd></div>
                  <div><dt className="text-slate-500">Ix / Iy</dt>
                    <dd className="font-mono font-semibold text-slate-800">
                      {formatMoment(section.ixxMm4)} / {formatMoment(section.iyyMm4)} mm⁴</dd></div>
                  <div><dt className="text-slate-500">Zx / Zy</dt>
                    <dd className="font-mono font-semibold text-slate-800">
                      {formatMoment(section.sectionModulusXMm3)} / {formatMoment(section.sectionModulusYMm3)} mm³</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-xs text-slate-500">평가 후 단면 제원이 표시됩니다.</p>
              )}
              <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-600">
                <p><b>Demand:</b> 네 용접선 끝점에서 σn과 τx·τy를 위치별 합성</p>
                <p><b>Criteria:</b> σeq ≤ σy / Required SF</p>
                <p><b>Included:</b> Fx, Fy, Fz, Mx, My, Mz</p>
                <p><b>Note:</b> 굽힘은 실제 용접선 위 지점에서 대수합으로 더한다.
                  원본 시트의 벡터합(√(σbx²+σby²))보다 7~8% 보수적이다.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-slate-800">Case / Boundary Weld Assessment</h4>
              <p className="mt-0.5 text-[10px] text-slate-500">현재 해석 Case의 각 Leg 반력과 동일 위치 지배응력</p>
            </div>
            <Button type="button" variant="primary" size="sm" onClick={onOpenLegModel}>
              <Layers size={13} /> Leg 모델에서 위치 확인
            </Button>
          </div>

          <div className={`mt-3 overflow-x-auto ${pendingClass}`}>
            <table className="w-full min-w-[1500px] border-separate border-spacing-0 text-[10px]">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th colSpan="2" className="border-y border-l border-slate-200 px-2 py-1.5 text-left">Load Point</th>
                  <th colSpan="6" className="border-y border-l border-slate-200 px-2 py-1.5 text-center">Reaction</th>
                  <th colSpan="6" className="border-y border-l border-slate-200 px-2 py-1.5 text-center">Critical-point Stress</th>
                  <th colSpan="2" className="border border-slate-200 px-2 py-1.5 text-center">Assessment</th>
                </tr>
                <tr className="bg-slate-50 text-slate-600">
                  {[
                    ['Case / Boundary', ''], ['Node', ''],
                    ['Fx', 'N'], ['Fy', 'N'], ['Fz', 'N'],
                    ['Mx', 'N·mm'], ['My', 'N·mm'], ['Mz', 'N·mm'],
                    ['Point', ''], ['σn', 'MPa'], ['τdirect', 'MPa'],
                    ['τMz', 'MPa'], ['τ', 'MPa'], ['σeq', 'MPa'],
                    ['Safety Factor', ''], ['Remark', ''],
                  ].map(([label, unit]) => (
                    <th key={label} className="border-b border-l border-slate-200 px-2 py-1.5 text-right first:text-left last:border-r">
                      <span>{label}</span>{unit && <span className="ml-1 font-normal text-slate-400">[{unit}]</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rows.map((row) => {
                  const isGoverning = row.index === summary?.governingLegIndex;
                  return (
                    <tr key={row.index} className={row.status === 'NG' ? 'bg-red-50' : isGoverning ? 'bg-amber-50' : 'bg-white'}>
                      <td className="whitespace-nowrap border-b border-l border-slate-200 px-2 py-2 font-semibold">
                        {/* Leg 마다 지배 LC 가 다르다(실측: +Y 는 Leg 2, −Y 는 Leg 7).
                            'Case 1' 로 고정해 두면 어느 조건의 값인지 알 수 없다. */}
                        {row.loadCase || 'Case 1'} / Leg {row.index}
                        {isGoverning && <span className="ml-1 text-[9px] font-bold text-amber-700">GOV.</span>}
                      </td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 font-mono">{row.jungbanNodeId ?? '—'}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.fxN, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.fyN, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.fzN, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatMoment(row.mxNmm)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatMoment(row.myNmm)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatMoment(row.mzNmm)}</td>
                      <td className="max-w-[120px] truncate border-b border-l border-slate-200 px-2 py-2 text-right"
                        title={row.governingPoint?.label}>{row.governingPoint?.label || '—'}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.sigmaNormalMPa, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.tauDirectMPa, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.tauTorsionMPa, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono">{formatNumber(row.tauMPa, 1)}</td>
                      <td className="border-b border-l border-slate-200 px-2 py-2 text-right font-mono font-bold">{formatNumber(row.sigmaEqMPa, 1)}</td>
                      <td className={`border-b border-l border-slate-200 px-2 py-2 text-right font-mono font-bold ${
                        row.actualSafetyFactor != null && row.actualSafetyFactor < weldSpec.safetyFactor ? 'text-red-700' : ''
                      }`}>{formatNumber(row.actualSafetyFactor, 2)}</td>
                      <td className="border-x border-b border-slate-200 px-2 py-2 text-center"><ResultBadge status={row.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-slate-600">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>σeq = √(σn² + 3(τx² + τy²)). 각 행은 하나의 실제 Leg 하중이며,
              서로 다른 행의 최대 성분을 합친 가상 조합은 사용하지 않습니다.</span>
          </p>
        </section>
      )}

      {check && (
        <section className={`rounded-xl border px-4 py-3 ${
          allChecksOk ? 'border-slate-200 bg-white' : 'border-red-300 bg-red-50'
        }`}>
          <div className="flex items-start gap-2">
            <Info size={14} className={allChecksOk ? 'mt-0.5 text-slate-500' : 'mt-0.5 text-red-600'} />
            <div>
              <p className={`text-xs font-semibold ${allChecksOk ? 'text-slate-700' : 'text-red-700'}`}>
                반력 평형 검산 {allChecksOk ? '통과' : '불일치'}
                <span className="ml-1 font-normal text-slate-500">
                  {momentChecked ? '(힘 3성분 + 모멘트 3성분)' : '(힘 3성분)'}
                </span>
              </p>
              <p className="mt-0.5 text-[10px] text-slate-600">
                {check.sumReactionN
                  ? <>ΣFz {formatNumber(check.sumReactionN?.[2] / 1000, 1)} kN ·
                      m·a {formatNumber(check.expectedN?.[2] / 1000, 1)} kN{' · '}</>
                  : null}
                힘 상대오차 {Number(check.maxRelError ?? 0).toExponential(1)}
                {momentChecked && <>
                  {' · '}모멘트 상대오차 {Number(momentError).toExponential(1)}
                </>}
              </p>
              {momentChecked && (
                /* 힘만 맞아도 각 Leg 의 분담과 모멘트가 맞는다는 보장은 없다.
                   균일 가속도장의 합력은 무게중심을 지나므로, 그 조건을 따로 본다. */
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  모멘트 검산은 <b>합력의 작용선이 무게중심을 지나는가</b>를 봅니다 —
                  힘 합계가 맞아도 Leg 별 분담이 틀리면 여기서 걸립니다.
                  {!momentOk && ' 지금은 통과하지 못했으므로 무게중심 입력과 Leg 반력을 함께 확인하세요.'}
                </p>
              )}
              {!check.ok && (
                <p className="mt-1 text-[10px] leading-relaxed text-red-700">
                  Σ반력이 <b>합산 중량 × 가속도</b>와 맞지 않습니다. 화면의 합산 중량은 BDF 의
                  단면·두께·밀도와 CONM2 로 계산한 값이라, 모델에 <b>비구조질량(NSM)</b>이나
                  <b> CONM2 질량중심 오프셋</b>이 있으면 해석이 실제로 실은 질량과 다릅니다
                  (2단계 중량 패널의 '중량에 반영되지 않은 요소' 안내도 함께 확인하세요).
                  반력 자체는 해석 결과 그대로이므로, 아래 용접 판정은 유효합니다.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
