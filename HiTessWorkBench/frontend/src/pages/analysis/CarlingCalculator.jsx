import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, ArrowLeft, BarChart3, Calculator, CheckCircle2, ChevronDown,
  ChevronUp, Download, ImageIcon, Loader2, Ruler, Settings2, TableProperties, XCircle
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import SolverCredit from '../../components/ui/SolverCredit';
import { useAuth } from '../../contexts/AuthContext';
import PageBanner from '../../components/ui/PageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import { formatFixed as fmt } from '../../utils/formatting';
import carlingFreeRef from '../../assets/images/Carling_Free.png';
import carlingFreeRef2 from '../../assets/images/Carling_Free2.png';
import carlingOptiRef from '../../assets/images/Carling_Opti.png';
import carlingOptiRef2 from '../../assets/images/Carling_Opti2.png';
import { downloadJson } from '../../utils/fileHelper';

const FIXED_SAFETY_FACTOR = 1.0;
const FIXED_EFFECTIVE_BREADTH_MM = 600.0;
const DEPTH_PER_THK_ALLOW = 16.0;

const DEFAULT_FREE = {
  load: { type: 'concentrated', value: '10', position_mm: '500' },
  hull: {
    plate_thickness_gross_mm: '10',
    stiffener_span_mm: '1000',
    material: 'Mild',
    corrosion_mm: '1',
  },
};

const DEFAULT_OPTIMIZATION = {
  load: { type: 'concentrated', value: '2000', position_mm: '200' },
  hull: {
    plate_thickness_gross_mm: '12',
    stiffener_span_mm: '800',
    corrosion_type: 'NON-CSR',
    plate_corrosion_mm: '2',
  },
  carling: {
    material: 'Mild',
    height_mm: { min: '80', max: '200', step: '10' },
    thickness_gross_mm: { min: '8', max: '25', step: '1' },
  },
};

const PAGE_META = {
  free: {
    title: 'Carling Free Calculator',
    subtitle: '',
    endpoint: '/api/carling/free',
    defaultInput: DEFAULT_FREE,
    referenceImages: [carlingFreeRef, carlingFreeRef2],
  },
  optimization: {
    title: 'Carling Design Optimization',
    subtitle: '',
    endpoint: '/api/carling/optimization',
    defaultInput: DEFAULT_OPTIMIZATION,
    referenceImages: [carlingOptiRef, carlingOptiRef2],
  },
};

const numberize = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

const toPayload = (inputs, variant) => {
  const base = {
    load: {
      type: inputs.load.type,
      value: numberize(inputs.load.value),
      position_mm: inputs.load.type === 'concentrated' ? numberize(inputs.load.position_mm) : null,
    },
    safety_factor: FIXED_SAFETY_FACTOR,
  };

  if (variant === 'free') {
    return {
      ...base,
      hull: {
        plate_thickness_gross_mm: numberize(inputs.hull.plate_thickness_gross_mm),
        stiffener_span_mm: numberize(inputs.hull.stiffener_span_mm),
        material: inputs.hull.material,
        corrosion_mm: numberize(inputs.hull.corrosion_mm),
      },
    };
  }

  return {
    ...base,
    hull: {
      plate_thickness_gross_mm: numberize(inputs.hull.plate_thickness_gross_mm),
      stiffener_span_mm: numberize(inputs.hull.stiffener_span_mm),
      corrosion_type: inputs.hull.corrosion_type,
      plate_corrosion_mm: numberize(inputs.hull.plate_corrosion_mm),
    },
    carling: {
      material: inputs.carling.material,
      height_mm: {
        min: numberize(inputs.carling.height_mm.min),
        max: numberize(inputs.carling.height_mm.max),
        step: numberize(inputs.carling.height_mm.step),
      },
      thickness_gross_mm: {
        min: numberize(inputs.carling.thickness_gross_mm.min),
        max: numberize(inputs.carling.thickness_gross_mm.max),
        step: numberize(inputs.carling.thickness_gross_mm.step),
      },
    },
    effective_breadth_mm: FIXED_EFFECTIVE_BREADTH_MM,
  };
};

const isPositive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const isNonNegative = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;

const setNested = (setter, path) => (value) => {
  setter(prev => {
    const next = structuredClone(prev);
    let cur = next;
    for (let i = 0; i < path.length - 1; i += 1) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    return next;
  });
};

// ─────────────────────────────────────────────
// 기본 입력 필드
// ─────────────────────────────────────────────
const Field = ({ label, value, onChange, unit = 'mm', min = 0 }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-500 mb-1 uppercase tracking-wide">{label}</label>
    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/10 bg-white transition-all">
      <input
        type="number"
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 px-2.5 py-2 text-sm font-bold text-slate-800 outline-none bg-transparent tabular-nums"
      />
      <span className="px-2.5 py-2 bg-slate-50 text-slate-400 text-[11px] font-semibold border-l border-slate-200 shrink-0">{unit}</span>
    </div>
  </div>
);

const SelectField = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-500 mb-1 uppercase tracking-wide">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 bg-white transition-all"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

// ─────────────────────────────────────────────
// 판정 배지 (pill 스타일)
// ─────────────────────────────────────────────
const CheckBadge = ({ value }) => {
  const ok = value === 'OK' || value === 'Total OK' || value === 'Carling Free';
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-wide ring-1 ring-inset ${
      ok
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
        : 'bg-rose-50 text-rose-700 ring-rose-600/20'
    }`}>
      <Icon size={12} strokeWidth={2.5} /> {value || '-'}
    </span>
  );
};

// ─────────────────────────────────────────────
// Check Summary 카드 (FreeResult용)
// ─────────────────────────────────────────────
const CheckCard = ({ label, value }) => {
  const ok = value === 'OK' || value === 'Total OK' || value === 'Carling Free';
  const displayLabel = String(label || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div className={`relative overflow-hidden rounded-xl border px-4 py-4 ${
      ok ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
    }`}>
      <div className={`absolute right-3 top-3 opacity-10 ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>
        <CheckCircle2 size={42} />
      </div>
      <p className={`text-[10px] font-extrabold uppercase tracking-widest mb-2 ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>
        {displayLabel}
      </p>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        </span>
        <span className={`text-lg font-extrabold ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {value || '-'}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 최적 후보 수치 표시 카드
// ─────────────────────────────────────────────
const Metric = ({ label, value, unit }) => (
  <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500 truncate">{label}</p>
    <p className="text-lg font-extrabold text-emerald-700 mt-0.5 tabular-nums">
      {fmt(value, 2)} <span className="text-xs font-medium opacity-70">{unit}</span>
    </p>
  </div>
);

// ─────────────────────────────────────────────
// 섹션 제목
// ─────────────────────────────────────────────
const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon size={14} className="text-emerald-600 shrink-0" />
    <h3 className="text-[11px] font-extrabold text-emerald-700 uppercase tracking-widest">{children}</h3>
  </div>
);

// ─────────────────────────────────────────────
// 구분선 (입력 섹션 사이)
// ─────────────────────────────────────────────
const Divider = () => <hr className="border-slate-100" />;

// ─────────────────────────────────────────────
// 참조 그림 + 계산 수식 통합 Collapsible 패널
// ─────────────────────────────────────────────
const FormulaContent = ({ variant }) => {
  const formulas = variant === 'free'
    ? [
      ['Bending Moment', 'M = P_d × a × b / L'],
      ['Shear Force', 'V = P_d × b / L'],
      ['Net Plate', 't_net = t_gross − corrosion'],
      ['Bending Stress', 'σ_B = M / Z'],
      ['Shear Stress', 'σ_S = V / A'],
      ['Deflection', 'd = P_d × a² × b² / (3EIL)'],
    ]
    : [
      ['Depth/Thickness Ratio', 'H / t_net ≤ 16'],
      ['Bending Check', 'σ_B = M / Z_composite ≤ σ_B_allow'],
      ['Shear Check', 'σ_S = V / A_composite ≤ σ_S_allow'],
      ['Weld Check', 'σ_weld ≤ σ_weld_allow'],
    ];

  return (
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {formulas.map(([label, expression]) => (
        <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-1.5">{label}</p>
          <p className="font-mono text-xs font-semibold text-slate-600 leading-relaxed">{expression}</p>
        </div>
      ))}
    </div>
  );
};

// 참조 그림 + 수식을 탭으로 통합한 Collapsible 패널
const InfoPanel = ({ variant, meta }) => {
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('image'); // 'image' | 'formula'

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-5">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-6 py-3.5 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-slate-500">
          <BarChart3 size={14} className="text-slate-400" />
          참조 그림 및 계산 수식
        </span>
        {open
          ? <ChevronUp size={15} className="text-slate-400" />
          : <ChevronDown size={15} className="text-slate-400" />
        }
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {/* 탭 바 */}
          <div className="flex border-b border-gray-100 bg-slate-50/60">
            {[
              { key: 'image',   label: '참조 그림', icon: ImageIcon },
              { key: 'formula', label: '계산 수식', icon: BarChart3 },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold transition-colors cursor-pointer border-b-2 -mb-px ${
                  activeTab === key
                    ? 'border-emerald-500 text-emerald-700 bg-white'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {activeTab === 'formula' && <FormulaContent variant={variant} />}

          {activeTab === 'image' && (
            <div className="p-5 bg-slate-50/60">
              <div className="mx-auto grid max-w-4xl grid-cols-1 md:grid-cols-2 gap-4">
                {(meta.referenceImages || []).map((src, index) => (
                  <div key={src} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                    <img
                      src={src}
                      alt={`${meta.title} reference ${index + 1}`}
                      className="w-full max-h-56 object-contain"
                    />
                    <p className="mt-2 text-center text-[11px] font-bold text-slate-400">
                      {index === 0 ? 'Concentrated Force' : 'Distributed Load'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 응력 셀: 계산값 위 / 허용값 아래 2-line 표시
// ─────────────────────────────────────────────
const StressCell = ({ calcVal, allowVal, fail }) => (
  <td className="px-3 py-2.5 text-right">
    <span className={`block text-[12px] font-bold tabular-nums leading-tight ${fail ? 'text-rose-600' : 'text-slate-700'}`}>
      {fmt(calcVal, 2)}
    </span>
    <span className="block text-[10px] text-slate-400 tabular-nums leading-tight">
      / {fmt(allowVal, 2)}
    </span>
  </td>
);

// ─────────────────────────────────────────────
// OK 카운트 KPI 배지
// ─────────────────────────────────────────────
const OkKpi = ({ okCount, total }) => {
  const allOk = okCount === total;
  const noneOk = okCount === 0;
  const color = noneOk ? 'rose' : allOk ? 'emerald' : 'amber';
  const colorMap = {
    emerald: 'bg-emerald-600 text-white ring-emerald-700/20',
    amber:   'bg-amber-500  text-white ring-amber-600/20',
    rose:    'bg-rose-600   text-white ring-rose-700/20',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold ring-1 ring-inset ${colorMap[color]}`}>
        <CheckCircle2 size={13} strokeWidth={2.5} />
        OK {okCount} / {total}
      </span>
      {okCount > 0 && (
        <span className="text-[11px] text-slate-400 font-semibold">
          경량 순 정렬
        </span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export default function CarlingCalculator({ variant = 'free' }) {
  const { employeeId } = useAuth();
  const meta = PAGE_META[variant] || PAGE_META.free;
  const { setCurrentMenu } = useNavigation();
  const [inputs, setInputs] = useState(meta.defaultInput);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const payload = useMemo(() => toPayload(inputs, variant), [inputs, variant]);

  const isValid = useMemo(() => {
    if (!isPositive(payload.load.value)) return false;
    if (payload.load.type === 'concentrated' && !isNonNegative(payload.load.position_mm)) return false;

    if (variant === 'free') {
      return isPositive(payload.hull.plate_thickness_gross_mm)
        && isPositive(payload.hull.stiffener_span_mm)
        && isNonNegative(payload.hull.corrosion_mm)
        && payload.hull.plate_thickness_gross_mm - payload.hull.corrosion_mm > 0;
    }

    const h = payload.carling.height_mm;
    const t = payload.carling.thickness_gross_mm;
    return isPositive(payload.hull.plate_thickness_gross_mm)
      && isPositive(payload.hull.stiffener_span_mm)
      && isNonNegative(payload.hull.plate_corrosion_mm)
      && payload.hull.plate_thickness_gross_mm - payload.hull.plate_corrosion_mm > 0
      && payload.hull.plate_corrosion_mm === (payload.hull.corrosion_type === 'CSR-TANK' ? 4 : 2)
      && isNonNegative(h.min) && isNonNegative(h.max) && isPositive(h.step) && h.min <= h.max
      && isNonNegative(t.min) && isNonNegative(t.max) && isPositive(t.step) && t.min <= t.max;
  }, [payload, variant]);

  const handleCorrosionType = (value) => {
    setInputs(prev => ({
      ...prev,
      hull: {
        ...prev.hull,
        corrosion_type: value,
        plate_corrosion_mm: value === 'CSR-TANK' ? '4' : '2',
      },
    }));
  };

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}${meta.endpoint}`, {
        ...payload,
        employee_id: employeeId || 'unknown',
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const okCandidates = (result?.candidates || []).filter(c => c.assessment === 'Total OK');
  const sortedCandidates = [...(result?.candidates || [])].sort((a, b) => {
    const aOk = a.assessment === 'Total OK' ? 0 : 1;
    const bOk = b.assessment === 'Total OK' ? 0 : 1;
    return aOk - bOk || Number(a.weight_kg || 0) - Number(b.weight_kg || 0);
  });

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      {/* ── 헤더 배너 ── */}
      <PageBanner gradient="from-brand-blue via-emerald-900 to-emerald-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('Parametric Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <TableProperties size={18} className="text-emerald-300" />
              {meta.title}
            </h1>
            {meta.subtitle && <p className="text-sm text-emerald-200/80 mt-0.5">{meta.subtitle}</p>}
          </div>
        </div>
        <GuideButton guideTitle={`[파라메트릭] ${meta.title}`} variant="dark" />
      </PageBanner>

      {/* ── 참조 그림 + 계산 수식 통합 패널 ── */}
      <InfoPanel variant={variant} meta={meta} />

      {/* ── 메인 2-컬럼 그리드 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[480px_1fr] gap-6 items-start">

        {/* ── 좌측: 입력 카드 ── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* 카드 헤더 */}
          <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-5 py-3 flex items-center gap-2">
            <Ruler size={14} className="text-white/80" />
            <h2 className="text-xs font-extrabold text-white uppercase tracking-widest">입력 조건</h2>
          </div>

          <div className="p-5 space-y-5">
            {/* Load 섹션 */}
            <div>
              <SectionTitle icon={Calculator}>Load</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                <SelectField
                  label="Load Type"
                  value={inputs.load.type}
                  onChange={setNested(setInputs, ['load', 'type'])}
                  options={['concentrated', 'distributed']}
                />
                <Field
                  label="Load Value"
                  value={inputs.load.value}
                  onChange={setNested(setInputs, ['load', 'value'])}
                  unit={inputs.load.type === 'distributed' ? 'N/mm' : 'N'}
                  min={0}
                />
                {inputs.load.type === 'concentrated' && (
                  <Field
                    label="Position"
                    value={inputs.load.position_mm}
                    onChange={setNested(setInputs, ['load', 'position_mm'])}
                    unit="mm"
                    min={0}
                  />
                )}
              </div>
            </div>

            <Divider />

            {/* Hull 섹션 */}
            <div>
              <SectionTitle icon={Ruler}>Hull</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5">
                <Field
                  label="Plate Thickness"
                  value={inputs.hull.plate_thickness_gross_mm}
                  onChange={setNested(setInputs, ['hull', 'plate_thickness_gross_mm'])}
                />
                <Field
                  label="Stiffener Span"
                  value={inputs.hull.stiffener_span_mm}
                  onChange={setNested(setInputs, ['hull', 'stiffener_span_mm'])}
                />
                {variant === 'free' ? (
                  <>
                    <SelectField
                      label="Material"
                      value={inputs.hull.material}
                      onChange={setNested(setInputs, ['hull', 'material'])}
                      options={['Mild', 'HT32', 'HT36']}
                    />
                    <Field
                      label="Corrosion"
                      value={inputs.hull.corrosion_mm}
                      onChange={setNested(setInputs, ['hull', 'corrosion_mm'])}
                    />
                  </>
                ) : (
                  <>
                    <SelectField
                      label="Corrosion Type"
                      value={inputs.hull.corrosion_type}
                      onChange={handleCorrosionType}
                      options={['NON-CSR', 'CSR-TANK']}
                    />
                    <Field
                      label="Plate Corrosion"
                      value={inputs.hull.plate_corrosion_mm}
                      onChange={setNested(setInputs, ['hull', 'plate_corrosion_mm'])}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Carling Search Range (optimization only) */}
            {variant === 'optimization' && (
              <>
                <Divider />
                <div>
                  <SectionTitle icon={Settings2}>Carling Search Range</SectionTitle>
                  <div className="mb-2.5">
                    <SelectField
                      label="Material"
                      value={inputs.carling.material}
                      onChange={setNested(setInputs, ['carling', 'material'])}
                      options={['Mild', 'HT32', 'HT36']}
                    />
                  </div>
                  {/* H 범위 */}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Height Range (H)</p>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <Field label="Min" value={inputs.carling.height_mm.min} onChange={setNested(setInputs, ['carling', 'height_mm', 'min'])} />
                    <Field label="Max" value={inputs.carling.height_mm.max} onChange={setNested(setInputs, ['carling', 'height_mm', 'max'])} />
                    <Field label="Step" value={inputs.carling.height_mm.step} onChange={setNested(setInputs, ['carling', 'height_mm', 'step'])} />
                  </div>
                  {/* T 범위 */}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Thickness Range (T)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Min" value={inputs.carling.thickness_gross_mm.min} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'min'])} />
                    <Field label="Max" value={inputs.carling.thickness_gross_mm.max} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'max'])} />
                    <Field label="Step" value={inputs.carling.thickness_gross_mm.step} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'step'])} />
                  </div>
                </div>
              </>
            )}

            {/* 유효성 경고 */}
            {!isValid && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold rounded-lg px-3 py-2.5">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                입력값 범위 또는 부식 여유 조건을 확인하세요.
              </div>
            )}

            {/* Calculate 버튼 */}
            <button
              onClick={handleCalculate}
              disabled={!isValid || isLoading}
              className={`w-full py-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition-all ${
                isValid && !isLoading
                  ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-md shadow-emerald-200 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading
                ? <><Loader2 size={16} className="animate-spin" /> 계산 중...</>
                : <><Calculator size={16} /> Calculate</>
              }
            </button>
          </div>
        </div>

        {/* ── 우측: 결과 영역 ── */}
        <div className="space-y-4">
          {/* 초기 안내 */}
          {!result && !error && !isLoading && (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-14 flex flex-col items-center text-slate-400 text-center">
              <div className="p-5 bg-slate-50 rounded-full mb-4">
                <TableProperties size={36} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">입력값을 확인하고 Calculate를 실행하세요.</p>
              <p className="text-sm mt-1 text-slate-400">계산 결과는 판정값과 응력 상세 테이블로 표시됩니다.</p>
            </div>
          )}

          {/* 로딩 */}
          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-14 flex flex-col items-center text-slate-400">
              <Loader2 size={36} className="animate-spin text-emerald-500 mb-4" />
              <p className="font-bold text-slate-600">Carling 계산을 수행하는 중입니다...</p>
            </div>
          )}

          {/* 오류 */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-start gap-3">
              <AlertCircle className="text-rose-500 shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-bold text-rose-700 text-sm">계산 실패</p>
                <p className="text-sm text-rose-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* 결과 */}
          {result && (
            <>
              {/* 다운로드 바 */}
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mr-1">다운로드</span>
                <button
                  onClick={() => downloadJson(payload, `carling_${variant}_input.json`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={12} /> 입력 JSON
                </button>
                <button
                  onClick={() => downloadJson(result, `carling_${variant}_result.json`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={12} /> 결과 JSON
                </button>
              </div>

              {variant === 'free'
                ? <FreeResult result={result} />
                : <OptimizationResult result={result} okCandidates={okCandidates} candidates={sortedCandidates} />
              }
            </>
          )}
        </div>
      </div>

      <SolverCredit contributor="박준석" />
    </div>
  );
}

// ─────────────────────────────────────────────
// FreeResult
// ─────────────────────────────────────────────
function FreeResult({ result }) {
  const i = result.intermediate || {};
  const checks = result.result?.checks || {};
  const assessment = result.result?.assessment;
  const isOk = assessment === 'OK' || assessment === 'Total OK' || assessment === 'Carling Free';

  // 계산값 / 허용값 쌍으로 구성
  const stressPairs = [
    {
      label: 'Bending Stress',
      calc: i.sigma_B_calc_MPa,
      allow: i.sigma_B_allow_MPa,
      hint: 'σ_Y / 2',
    },
    {
      label: 'Shear Stress',
      calc: i.sigma_S_calc_MPa,
      allow: i.sigma_S_allow_MPa,
      hint: 'σ_Y × 0.4',
    },
    {
      label: 'Deflection',
      calc: i.d_calc_mm,
      allow: i.d_allow_mm,
      hint: 'L / 500',
      unit: 'mm',
    },
  ];

  return (
    <div className="space-y-4">
      {/* 판정 결과 카드 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* 헤더: 타이틀 + 최종 판정 배지 */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-gray-100">
          <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest">판정 결과</h3>
          <CheckBadge value={assessment} />
        </div>

        {/* 응력 비교 3열 */}
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {stressPairs.map(({ label, calc, allow, hint, unit = 'MPa' }) => {
              const fail = Number(calc) > Number(allow);
              return (
                <div
                  key={label}
                  className={`rounded-xl border px-4 py-3 ${
                    fail
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  <p className={`text-[10px] font-extrabold uppercase tracking-widest mb-2 ${
                    fail ? 'text-rose-500' : 'text-slate-400'
                  }`}>
                    {label}
                  </p>
                  {/* 계산값 (크게) */}
                  <p className={`text-xl font-extrabold tabular-nums leading-none ${
                    fail ? 'text-rose-600' : 'text-slate-700'
                  }`}>
                    {fmt(calc, 2)}
                    <span className="text-xs font-medium ml-1 opacity-60">{unit}</span>
                  </p>
                  {/* 허용값 구분선 아래 */}
                  <div className="mt-2 pt-2 border-t border-dashed border-slate-200 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-semibold">허용 ({hint})</span>
                    <span className={`text-xs font-bold tabular-nums ${
                      fail ? 'text-rose-500' : 'text-emerald-600'
                    }`}>
                      {fmt(allow, 2)} {unit}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Check Summary */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className={`px-5 py-3 flex items-center gap-2 ${isOk ? 'bg-gradient-to-r from-emerald-700 to-emerald-600' : 'bg-gradient-to-r from-rose-700 to-rose-600'}`}>
          <h3 className="text-xs font-extrabold text-white uppercase tracking-widest">Check Summary</h3>
        </div>
        <div className="p-5 grid grid-cols-3 gap-3">
          {Object.entries(checks).map(([key, value]) => (
            <CheckCard key={key} label={key} value={value} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// OptimizationResult
// ─────────────────────────────────────────────
function OptimizationResult({ result, okCandidates, candidates }) {
  const optimal = result.optimal || {};

  return (
    <div className="space-y-4">
      {/* 최적 후보 카드 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-gray-100">
          <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest">최적 후보</h3>
          <OkKpi okCount={okCandidates.length} total={result.candidates?.length || 0} />
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Metric label="Height" value={optimal.H_mm} unit="mm" />
            <Metric label="Thickness" value={optimal.T_gross_mm} unit="mm" />
            <Metric label="Weld Leg" value={optimal.min_leg_length_mm} unit="mm" />
            <Metric label="Weight" value={optimal.weight_kg} unit="kg" />
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500 truncate">Material</p>
              <p className="text-lg font-extrabold text-emerald-700 mt-0.5">{optimal.material || '-'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 후보별 상세 결과 테이블 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* 테이블 헤더 바 */}
        <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3 flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-white uppercase tracking-widest">후보별 상세 결과</h3>
          <span className="text-[11px] text-slate-300 font-semibold">{candidates.length}개 후보</span>
        </div>

        <div className="overflow-auto max-h-[620px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50">
              {/* 컬럼 그룹 행 */}
              <tr className="border-b border-slate-100">
                {/* Assessment — sticky 첫 컬럼 */}
                <th
                  className="sticky left-0 z-20 bg-slate-50 px-3 py-2 text-center text-[10px] font-extrabold text-slate-500 uppercase tracking-wider border-r border-slate-200"
                  rowSpan={2}
                >
                  판정
                </th>
                <th
                  colSpan={2}
                  className="px-3 py-2 text-center text-[10px] font-extrabold text-slate-500 uppercase tracking-wider border-b border-slate-100 border-l border-slate-100"
                >
                  Geometry
                </th>
                <th
                  colSpan={4}
                  className="px-3 py-2 text-center text-[10px] font-extrabold text-rose-400 uppercase tracking-wider border-b border-slate-100 border-l border-slate-100"
                >
                  Checks  <span className="normal-case font-normal opacity-60">(계산값 / 허용값)</span>
                </th>
                <th
                  className="px-3 py-2 text-center text-[10px] font-extrabold text-slate-500 uppercase tracking-wider border-b border-slate-100 border-l border-slate-100"
                  rowSpan={2}
                >
                  Leg<span className="font-normal normal-case opacity-60 ml-0.5">mm</span>
                </th>
              </tr>
              {/* 세부 컬럼명 행 */}
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider border-l border-slate-100">H<span className="font-normal normal-case opacity-60 ml-0.5">mm</span></th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">T<span className="font-normal normal-case opacity-60 ml-0.5">mm</span></th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider border-l border-slate-100">H/t Ratio</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Bending<span className="font-normal normal-case opacity-60 ml-0.5">MPa</span></th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Shear<span className="font-normal normal-case opacity-60 ml-0.5">MPa</span></th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Weld<span className="font-normal normal-case opacity-60 ml-0.5">MPa</span></th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {candidates.map(row => {
                const depthRatio = row.carling?.depth_per_thk;
                const depthFail = Number.isFinite(Number(depthRatio)) && Number(depthRatio) > DEPTH_PER_THK_ALLOW;
                const bendingFail = Number(row.stress?.sigma_B_calc_MPa) > Number(row.stress?.sigma_B_allow_MPa);
                const shearFail   = Number(row.stress?.sigma_S_calc_MPa) > Number(row.stress?.sigma_S_allow_MPa);
                const weldFail    = Number(row.stress?.sigma_weld_calc_MPa) > Number(row.stress?.sigma_weld_allow_MPa);
                const isRowOk = row.assessment === 'Total OK';

                return (
                  <tr
                    key={`${row.H_mm}-${row.T_gross_mm}`}
                    className={`transition-colors ${isRowOk ? 'hover:bg-emerald-50/40' : 'hover:bg-rose-50/20'}`}
                  >
                    {/* Assessment — sticky 첫 컬럼 */}
                    <td className="sticky left-0 z-10 px-3 py-2.5 text-center border-r border-slate-100 bg-white">
                      <CheckBadge value={row.assessment} />
                    </td>
                    {/* Geometry */}
                    <td className="px-3 py-2.5 text-right font-bold text-slate-700 tabular-nums border-l border-slate-50">{fmt(row.H_mm, 0)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-700 tabular-nums">{fmt(row.T_gross_mm, 0)}</td>
                    {/* Checks */}
                    <StressCell calcVal={depthRatio} allowVal={DEPTH_PER_THK_ALLOW} fail={depthFail} />
                    <StressCell calcVal={row.stress?.sigma_B_calc_MPa} allowVal={row.stress?.sigma_B_allow_MPa} fail={bendingFail} />
                    <StressCell calcVal={row.stress?.sigma_S_calc_MPa} allowVal={row.stress?.sigma_S_allow_MPa} fail={shearFail} />
                    <StressCell calcVal={row.stress?.sigma_weld_calc_MPa} allowVal={row.stress?.sigma_weld_allow_MPa} fail={weldFail} />
                    {/* Result: Leg */}
                    <td className="px-3 py-2.5 text-right font-bold text-slate-700 tabular-nums">{fmt(row.min_leg_length_mm, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 테이블 푸터 설명 */}
        <div className="px-5 py-3 bg-slate-50 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[11px] text-slate-400">
            Stress Checks: <span className="font-bold text-slate-500">계산값</span> / <span className="text-slate-400">허용값</span>
          </span>
          <span className="text-[11px] text-rose-400 font-semibold">붉은 글씨 = 허용값 초과</span>
          <span className="text-[11px] text-slate-400">OK 후보는 중량 오름차순으로 먼저 표시</span>
        </div>
      </div>
    </div>
  );
}
