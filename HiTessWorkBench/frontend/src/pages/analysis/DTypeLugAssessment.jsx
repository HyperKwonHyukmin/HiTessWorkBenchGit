import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, Calculator, Download, Loader2, Maximize2, RotateCcw, TableProperties, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SolverCredit from '../../components/ui/SolverCredit';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import { formatFixed as fmt } from '../../utils/formatting';
import dTypeLugRef1 from '../../assets/images/D_typeLug1.png';
import dTypeLugRef2 from '../../assets/images/D_typeLug2.png';
import bracket4EA from '../../assets/images/D_typeLug_4EA.png';
import bracket2EAOpposite from '../../assets/images/D_typeLug_2EA_OS.png';
import bracket2EASame from '../../assets/images/D_typeLug_2EA_SS.png';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import { downloadJson } from '../../utils/fileHelper';
import ReferenceFormulaTabs from '../../components/ui/ReferenceFormulaTabs';
import VerdictBadge from '../../components/ui/VerdictBadge';
import CalcInputField from '../../components/ui/CalcInputField';
import { VerdictHeader, KeyFigures } from '../../components/analysis/runFrame';
import { useDraftAutosave } from '../../hooks/useDraftAutosave';
import DraftAutosavePill from '../../components/platform/DraftAutosavePill';
import {
  BRACKETS, DEFAULT_BRACKET, SECTIONS, bracketLabel, caseLabel, fieldError,
  governingCaseBySection, rowMaxUsage, sanitizeDraftInputs, toPayload, weldError,
} from '../../utils/dTypeLug';

// 기본값 = Excel 원본 값. 단 W1'(Excel 12)·W2' 는 0 고정이라 입력에 없다(utils/dTypeLug FIXED_GEOMETRY) —
// 그래서 이 기본값의 E 단면 결과는 Excel 과 다르다.
const DEFAULT_INPUT = {
  load: { force_N: '1000000' },
  geometry: {
    l1: '850', l2: '200',
    h1: '365', h2: '190', h3: '190', h4: '115', h5: '74',
    t1: '32', t2: '32', t3: '34',
    r1: '150', r2: '44',
    pin_radius: '41.5',
    d1: '66', d2: '151', d3: '105',
    w1: '6', w2: '8',
  },
  material: {
    yield_base_MPa: '235',
    yield_weld_MPa: '291.76',
  },
};

const BRACKET_FIGURES = {
  bracket_4EA: bracket4EA,
  bracket_2EA_double: bracket2EAOpposite,
  bracket_2EA_single: bracket2EASame,
};

// 두 그림을 가로세로 비율대로 나눠 같은 높이로 맞춘다(Ref1 1378×796, Ref2 1278×522).
const REFERENCE_IMAGES = [
  { src: dTypeLugRef1, label: 'Reference 1 · 검토 단면 A~E 위치', ratio: 1.73 },
  { src: dTypeLugRef2, label: 'Reference 2 · 치수 기호', ratio: 2.45 },
];

const GEOMETRY_GROUPS = [
  { title: '길이 · 높이', fields: [['l1', 'L1'], ['l2', 'L2'], ['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4'], ['h5', 'H5']] },
  { title: '판 두께 · 반경', fields: [['t1', 'T1'], ['t2', 'T2'], ['t3', 'T3'], ['r1', 'R1'], ['r2', 'R2'], ['pin_radius', 'Pin R']] },
  { title: '지름 · 용접', fields: [['d1', 'D1'], ['d2', 'D2'], ['d3', 'D3'], ['w1', 'W1'], ['w2', 'W2']], note: "W1'·W2'는 0으로 고정합니다." },
];

const MATERIAL_FIELDS = [
  ['yield_base_MPa', '모재 항복응력'],
  ['yield_weld_MPa', '용접부 기준응력'],
];

const InputField = (props) => <CalcInputField size="sm" unit="mm" min={0} rangeHint={false} {...props} />;

const usageTone = (v) => (Number(v) > 1 ? 'text-red-700 font-bold' : 'text-slate-800');

function ImageLightbox({ image, onClose }) {
  useEffect(() => {
    if (!image) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [image, onClose]);
  if (!image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-3 bg-slate-900/85 p-6"
      onClick={onClose}
    >
      <img
        src={image.src}
        alt={image.label}
        className="max-h-[85vh] max-w-[95vw] rounded-lg bg-white object-contain p-4"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex items-center gap-3 text-sm text-white">
        <span className="font-semibold">{image.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md border border-white/40 px-2.5 py-1 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={14} aria-hidden="true" /> 닫기 (Esc)
        </button>
      </div>
    </div>
  );
}

function BracketPicker({ value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-slate-800">Bracket 형식</legend>
      <div role="radiogroup" aria-label="Bracket 형식" className="grid grid-cols-3 gap-2">
        {BRACKETS.map(b => {
          const selected = value === b.key;
          return (
            <button
              key={b.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(b.key)}
              className={`rounded-lg border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 ${
                selected
                  ? 'border-brand-blue bg-blue-50 text-brand-blue'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="block text-sm font-bold">{b.name}</span>
              <span className={`block text-xs ${selected ? 'text-brand-blue' : 'text-slate-500'}`}>{b.side}</span>
            </button>
          );
        })}
      </div>
      <figure className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
        <img
          src={BRACKET_FIGURES[value]}
          alt={`${bracketLabel(value)} E 단면 용접부 배치`}
          className="mx-auto h-44 w-full object-contain"
        />
        <figcaption className="mt-1 text-center text-xs text-slate-600">
          {bracketLabel(value)} · E 단면(용접부) 배치
        </figcaption>
      </figure>
    </fieldset>
  );
}

export default function DTypeLugAssessment() {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const [inputs, setInputs] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState(null);
  const [calculatedKey, setCalculatedKey] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBracket, setSelectedBracket] = useState(DEFAULT_BRACKET);
  const [valueMode, setValueMode] = useState('usage');
  const [zoomImage, setZoomImage] = useState(null);
  const draftValue = useMemo(() => ({ inputs, selectedBracket }), [inputs, selectedBracket]);
  const autosave = useDraftAutosave('d-type-lug-assessment', draftValue);

  const restoreDraft = () => autosave.restoreDraft((draft) => {
    setInputs(sanitizeDraftInputs(draft.inputs, DEFAULT_INPUT));
    setSelectedBracket(BRACKETS.some(b => b.key === draft.selectedBracket) ? draft.selectedBracket : DEFAULT_BRACKET);
    setResult(null);
    setError(null);
  });

  const setField = (section, key) => (value) => {
    setInputs(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  };

  const errors = useMemo(() => {
    const out = {};
    const check = (section, key, label, opts) => {
      const msg = fieldError(inputs[section][key], opts);
      if (msg) out[`${section}.${key}`] = { label, msg };
    };
    check('load', 'force_N', 'Force', { positive: true });
    GEOMETRY_GROUPS.forEach(g => g.fields.forEach(([key, label]) => check('geometry', key, label)));
    MATERIAL_FIELDS.forEach(([key, label]) => check('material', key, label, { positive: true }));
    const weld = weldError(inputs.geometry);
    if (weld && !out['geometry.w1'] && !out['geometry.w2']) {
      out['geometry.w1'] = { label: 'W1', msg: weld };
      out['geometry.w2'] = { label: 'W2', msg: weld };
    }
    return out;
  }, [inputs]);
  const invalidLabels = Object.values(errors).map(e => e.label);
  const isValid = invalidLabels.length === 0;
  const errorOf = (section, key) => errors[`${section}.${key}`]?.msg;

  const payload = useMemo(() => toPayload(inputs), [inputs]);
  const payloadKey = JSON.stringify(payload);
  const isStale = result != null && calculatedKey !== payloadKey;
  const isDefault = JSON.stringify(inputs) === JSON.stringify(DEFAULT_INPUT);

  const handleCalculate = async () => {
    if (!isValid || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/d-type-lug/calculate`, {
        ...payload,
        bracket_type: selectedBracket,
        employee_id: employeeId || 'unknown',
      });
      setResult(res.data);
      setCalculatedKey(payloadKey);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : '서버에 연결하지 못했습니다. 네트워크와 서버 주소를 확인한 뒤 다시 계산하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const angleOf = (index) => result?.angle_cases?.find(a => a.index === index);
  const selectedData = result?.results?.[selectedBracket];
  const selectedAngles = selectedData?.per_angle || [];
  const governing = selectedData?.max_usage_factor || {};
  const governingAngle = angleOf(governing.governing_angle_index);
  const sectionGoverning = useMemo(() => governingCaseBySection(selectedAngles), [selectedAngles]);
  const overall = Number(governing.overall);
  const passed = Number.isFinite(overall) && overall <= 1;
  const otherBrackets = BRACKETS.filter(b => b.key !== selectedBracket && result?.results?.[b.key]);

  const angleText = (a) => (a ? `α ${a.alpha_deg}° · β ${a.beta_deg}°` : '');

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      <AnalysisPageBanner
        title="D Type Lug Assessment"
        subtitle="Bracket 형식과 치수를 넣으면 12개 하중 각도 케이스에서 단면 A~E의 사용률을 계산합니다."
        icon={TableProperties}
        guideTitle="[파라메트릭] D Type Lug Assessment"
        onBack={() => setCurrentMenu('Parametric Apps')}
        backLabel="Parametric Apps로 돌아가기"
        gradient="from-brand-blue via-emerald-900 to-emerald-700"
        iconClassName="text-emerald-300"
        subtitleClassName="text-emerald-200/80"
      />

      <div className="mb-3 flex justify-end">
        <DraftAutosavePill autosave={autosave} onRestore={restoreDraft} />
      </div>

      <ReferenceFormulaTabs>
        {(activeInfoTab) => activeInfoTab === 'image' ? (
          <div className="p-5">
            <div
              className="grid grid-cols-1 gap-4 lg:[grid-template-columns:var(--ref-cols)]"
              style={{ '--ref-cols': REFERENCE_IMAGES.map(i => `${i.ratio}fr`).join(' ') }}
            >
              {REFERENCE_IMAGES.map(image => (
                <figure key={image.src} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setZoomImage(image)}
                    className="group relative block w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                    aria-label={`${image.label} 크게 보기`}
                  >
                    <img
                      src={image.src}
                      alt={image.label}
                      decoding="async"
                      className="block h-auto w-full object-contain"
                      style={{ aspectRatio: image.ratio }}
                    />
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Maximize2 size={12} aria-hidden="true" /> 크게 보기
                    </span>
                  </button>
                  <figcaption className="mt-1.5 text-center text-xs text-slate-600">{image.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-6 p-5 text-sm md:grid-cols-3">
            <div>
              <dt className="mb-1.5 font-semibold text-slate-800">각도 케이스</dt>
              <dd className="leading-relaxed text-slate-700">
                α = 0, 30, 45, 60, 75, 90°<br />β = 0, 15°<br />총 12개 케이스
              </dd>
            </div>
            <div>
              <dt className="mb-1.5 font-semibold text-slate-800">검토 단면</dt>
              <dd className="leading-relaxed text-slate-700">
                {SECTIONS.map(s => <span key={s.key} className="block">{s.key} · {s.name}</span>)}
              </dd>
            </div>
            <div>
              <dt className="mb-1.5 font-semibold text-slate-800">판정 기준</dt>
              <dd className="leading-relaxed text-slate-700">
                사용률 = 등가응력 / 허용응력<br />1.0 이하이면 통과, 넘으면 실패
              </dd>
            </div>
          </dl>
        )}
      </ReferenceFormulaTabs>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[440px_1fr]">
        {/* 입력 */}
        <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="dlug-input-title">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 id="dlug-input-title" className="text-base font-bold text-slate-900">입력</h2>
            <button
              type="button"
              onClick={() => setInputs(DEFAULT_INPUT)}
              disabled={isDefault}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent"
            >
              <RotateCcw size={12} aria-hidden="true" /> 기본값으로
            </button>
          </header>

          <div className="space-y-5 p-5">
            <BracketPicker value={selectedBracket} onChange={setSelectedBracket} />

            <InputField
              label="Force"
              value={inputs.load.force_N}
              onChange={setField('load', 'force_N')}
              unit="N"
              min={1}
              error={errorOf('load', 'force_N')}
            />

            {GEOMETRY_GROUPS.map(group => (
              <fieldset key={group.title} className="border-t border-slate-100 pt-4">
                <legend className="mb-2 pr-2 text-sm font-semibold text-slate-800">{group.title}</legend>
                <div className="grid grid-cols-3 gap-2.5">
                  {group.fields.map(([key, label]) => (
                    <InputField
                      key={key}
                      label={label}
                      value={inputs.geometry[key]}
                      onChange={setField('geometry', key)}
                      error={errorOf('geometry', key)}
                    />
                  ))}
                </div>
                {group.note && <p className="mt-2 text-xs text-slate-600">{group.note}</p>}
              </fieldset>
            ))}

            <fieldset className="border-t border-slate-100 pt-4">
              <legend className="mb-2 pr-2 text-sm font-semibold text-slate-800">재료</legend>
              <div className="grid grid-cols-2 gap-2.5">
                {MATERIAL_FIELDS.map(([key, label]) => (
                  <InputField
                    key={key}
                    label={label}
                    value={inputs.material[key]}
                    onChange={setField('material', key)}
                    unit="MPa"
                    min={1}
                    error={errorOf('material', key)}
                  />
                ))}
              </div>
            </fieldset>

            <div>
              <button
                type="button"
                onClick={handleCalculate}
                disabled={!isValid || isLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-blue py-3 text-sm font-bold text-white transition-colors hover:bg-[#003366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {isLoading
                  ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> 계산 중</>
                  : <><Calculator size={16} aria-hidden="true" /> {result ? '다시 계산' : '계산'}</>}
              </button>
              {!isValid && (
                <p className="mt-2 text-xs text-red-700" role="status">
                  입력값을 확인하세요: {invalidLabels.join(', ')}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 결과 */}
        <section className="min-w-0 space-y-4" aria-label="결과" aria-busy={isLoading}>
          {!result && !error && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              {isLoading ? (
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 12개 각도 케이스를 계산하는 중입니다
                </p>
              ) : (
                <>
                  <p className="font-semibold text-slate-800">형식과 치수를 확인한 뒤 계산을 누르세요.</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {bracketLabel(selectedBracket)}의 판정, 단면 A~E 최대 사용률, 각도 케이스별 값이 여기에 나옵니다.
                  </p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5" role="alert">
              <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-bold text-red-800">계산하지 못했습니다</p>
                <p className="mt-0.5 break-words text-sm text-red-900">{error}</p>
              </div>
            </div>
          )}

          {result && selectedData && (
            <>
              {isStale && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="status">
                  <AlertCircle size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
                  <span className="min-w-0 flex-1">입력이 바뀌었습니다. 아래 결과는 이전 입력으로 계산한 값입니다.</span>
                  <button
                    type="button"
                    onClick={handleCalculate}
                    disabled={!isValid || isLoading}
                    className="rounded-md bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                  >
                    다시 계산
                  </button>
                </div>
              )}

              <VerdictHeader
                level={passed ? 'pass' : 'fail'}
                title={passed ? '통과' : '실패'}
                summary={`${bracketLabel(selectedBracket)} · 최대 사용률 ${fmt(governing.overall, 2)} (Section ${governing.governing_section || '-'}, Case ${caseLabel(governing.governing_angle_index)}${governingAngle ? ` · ${angleText(governingAngle)}` : ''})`}
                meta={(
                  <button
                    type="button"
                    onClick={() => downloadJson(result, 'd_type_lug_result.json')}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={12} aria-hidden="true" /> 결과 JSON
                  </button>
                )}
              />

              {otherBrackets.length > 0 && (
                <p className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1 text-sm text-slate-600">
                  <span>다른 형식:</span>
                  {otherBrackets.map((b, i) => {
                    const v = result.results[b.key]?.max_usage_factor?.overall;
                    return (
                      <React.Fragment key={b.key}>
                        {i > 0 && <span aria-hidden="true">·</span>}
                        <button
                          type="button"
                          onClick={() => setSelectedBracket(b.key)}
                          className="rounded px-1 font-semibold text-slate-800 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600"
                          title="이 형식의 결과 보기"
                        >
                          {bracketLabel(b.key).replace('Bracket ', '')} <span className={`tabular-nums ${Number(v) > 1 ? 'text-red-700' : ''}`}>{fmt(v, 2)}</span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </p>
              )}

              <KeyFigures
                items={[
                  ...SECTIONS.map(s => {
                    const g = sectionGoverning[s.key];
                    return {
                      key: s.key,
                      label: `${s.key} · ${s.name}`,
                      value: fmt(governing[s.key], 2),
                      tone: Number(governing[s.key]) > 1 ? 'bad' : 'default',
                      sub: g ? `Case ${caseLabel(g.index)} · ${angleText(angleOf(g.index))}` : '-',
                    };
                  }),
                  {
                    key: 'overall',
                    label: '최대',
                    value: fmt(governing.overall, 2),
                    tone: passed ? 'default' : 'bad',
                    sub: `Section ${governing.governing_section || '-'}`,
                  },
                ]}
                caption="사용률(Usage Factor) = 등가응력 / 허용응력. 1.0 이하이면 통과."
              />

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-sm font-bold text-slate-900">각도 케이스별 결과</h3>
                  <div role="radiogroup" aria-label="표시 값" className="inline-flex rounded-lg border border-slate-200 p-0.5">
                    {[['usage', '사용률'], ['stress', '등가응력 (MPa)']].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={valueMode === key}
                        onClick={() => setValueMode(key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                          valueMode === key ? 'bg-brand-blue text-white' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th scope="col" className="px-3 py-2 text-center">Case</th>
                        <th scope="col" className="px-3 py-2 text-center">α</th>
                        <th scope="col" className="px-3 py-2 text-center">β</th>
                        {SECTIONS.map(s => <th key={s.key} scope="col" className="px-3 py-2 text-right">{s.key}</th>)}
                        <th scope="col" className="px-3 py-2 text-center">판정</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedAngles.map(row => {
                        const angle = angleOf(row.index);
                        const isGov = row.index === governing.governing_angle_index;
                        const maxUf = rowMaxUsage(row);
                        const values = valueMode === 'usage' ? row.usage_factor : row.equivalent_stress;
                        return (
                          <tr key={row.index} className={isGov ? 'bg-slate-100' : undefined}>
                            <th scope="row" className="px-3 py-2 text-center font-semibold text-slate-800">
                              {caseLabel(row.index)}
                              {isGov && <span className="ml-1.5 rounded bg-brand-blue px-1.5 py-0.5 text-[11px] font-semibold text-white">지배</span>}
                            </th>
                            <td className="px-3 py-2 text-center text-slate-700">{angle?.alpha_deg ?? '-'}°</td>
                            <td className="px-3 py-2 text-center text-slate-700">{angle?.beta_deg ?? '-'}°</td>
                            {SECTIONS.map(s => (
                              <td key={s.key} className={`px-3 py-2 text-right ${usageTone(row.usage_factor?.[s.key])}`}>
                                {fmt(values?.[s.key], valueMode === 'usage' ? 2 : 1)}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center">
                              {maxUf != null ? <VerdictBadge ok={maxUf <= 1} okLabel="통과" ngLabel="실패" animate={false} /> : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-600">
                  {valueMode === 'usage'
                    ? '빨간 굵은 글씨는 사용률 1.0 초과.'
                    : '등가응력 단위 MPa. 빨간 굵은 글씨는 그 단면의 사용률이 1.0 초과.'}
                </p>
              </div>

              <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-slate-50">
                  <span className="mr-1.5 inline-block text-slate-500 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                  단면별 응력 성분 <span className="font-normal text-slate-600">전단 · 수직 · 지압, MPa</span>
                </summary>
                <div className="max-h-[520px] overflow-auto border-t border-slate-100">
                  <table className="w-full text-sm tabular-nums">
                    <thead className="sticky top-0">
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th scope="col" className="px-3 py-2 text-center">Case</th>
                        <th scope="col" className="px-3 py-2 text-center">α / β</th>
                        <th scope="col" className="px-3 py-2 text-center">단면</th>
                        <th scope="col" className="px-3 py-2 text-right">전단</th>
                        <th scope="col" className="px-3 py-2 text-right">수직</th>
                        <th scope="col" className="px-3 py-2 text-right">지압</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAngles.flatMap(row => {
                        const angle = angleOf(row.index);
                        return SECTIONS.map((s, i) => {
                          const a = row.analysis?.[s.key] || {};
                          return (
                            <tr key={`${row.index}-${s.key}`} className={i === 0 ? 'border-t border-slate-200' : ''}>
                              <td className="px-3 py-1.5 text-center font-semibold text-slate-800">{i === 0 ? caseLabel(row.index) : ''}</td>
                              <td className="px-3 py-1.5 text-center text-slate-700">{i === 0 && angle ? `${angle.alpha_deg}° / ${angle.beta_deg}°` : ''}</td>
                              <td className="px-3 py-1.5 text-center text-slate-800">{s.key}</td>
                              <td className="px-3 py-1.5 text-right text-slate-800">{a.shear != null ? fmt(a.shear, 2) : '-'}</td>
                              <td className="px-3 py-1.5 text-right text-slate-800">{a.normal != null ? fmt(a.normal, 2) : '-'}</td>
                              <td className="px-3 py-1.5 text-right text-slate-800">{a.bearing != null ? fmt(a.bearing, 2) : '-'}</td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-600">해당하지 않는 성분은 '-'로 표시합니다.</p>
              </details>
            </>
          )}
        </section>
      </div>

      <ImageLightbox image={zoomImage} onClose={() => setZoomImage(null)} />
      <SolverCredit contributor="김연태" />
    </div>
  );
}
