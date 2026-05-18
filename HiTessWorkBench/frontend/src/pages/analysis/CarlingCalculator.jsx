import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, ArrowLeft, BarChart3, Calculator, CheckCircle2, ChevronDown,
  ChevronUp, Download, ImageIcon, Loader2, Ruler, Settings2, TableProperties
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

const DEFAULT_FREE = {
  load: { type: 'concentrated', value: '10', position_mm: '500' },
  hull: {
    plate_thickness_gross_mm: '10',
    stiffener_span_mm: '1000',
    material: 'Mild',
    corrosion_mm: '1',
  },
  safety_factor: '1.2',
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
  effective_breadth_mm: '600',
  safety_factor: '1.2',
};

const PAGE_META = {
  free: {
    title: 'Carling Free Calculator',
    subtitle: '01_Carling Free Calculator 기준으로 카링 설치 필요 여부를 판정합니다.',
    endpoint: '/api/carling/free',
    defaultInput: DEFAULT_FREE,
    referenceImages: [carlingFreeRef, carlingFreeRef2],
  },
  optimization: {
    title: 'Carling Design Optimization',
    subtitle: '02_Carling Design Optimization 기준으로 H/T 범위 내 최소 중량 후보를 산출합니다.',
    endpoint: '/api/carling/optimization',
    defaultInput: DEFAULT_OPTIMIZATION,
    referenceImages: [carlingOptiRef, carlingOptiRef2],
  },
};

const downloadJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
    safety_factor: numberize(inputs.safety_factor),
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
    effective_breadth_mm: numberize(inputs.effective_breadth_mm),
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

const Field = ({ label, value, onChange, unit = 'mm', min = 0 }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-700 mb-1">{label}</label>
    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-emerald-500 bg-white">
      <input
        type="number"
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 px-2.5 py-2 text-sm font-bold text-slate-800 outline-none bg-transparent"
      />
      <span className="px-2.5 py-2 bg-slate-50 text-slate-500 text-[11px] font-bold border-l border-slate-200">{unit}</span>
    </div>
  </div>
);

const SelectField = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-700 mb-1">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 bg-white"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

const CheckBadge = ({ value }) => {
  const ok = value === 'OK' || value === 'Total OK' || value === 'Carling Free';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
      ok ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'
    }`}>
      <CheckCircle2 size={11} /> {value || '-'}
    </span>
  );
};

const CheckCard = ({ label, value }) => {
  const ok = value === 'OK' || value === 'Total OK' || value === 'Carling Free';
  const displayLabel = String(label || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div className={`relative overflow-hidden rounded-xl border px-4 py-4 ${
      ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
    }`}>
      <div className={`absolute right-3 top-3 opacity-10 ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
        <CheckCircle2 size={42} />
      </div>
      <p className={`text-[10px] font-extrabold uppercase tracking-widest mb-2 ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
        {displayLabel}
      </p>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          <CheckCircle2 size={16} />
        </span>
        <span className={`text-lg font-extrabold ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {value || '-'}
        </span>
      </div>
    </div>
  );
};

const Metric = ({ label, value, unit }) => (
  <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500">{label}</p>
    <p className="text-lg font-extrabold text-emerald-700 mt-0.5">
      {fmt(value, 2)} <span className="text-xs font-medium opacity-70">{unit}</span>
    </p>
  </div>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon size={14} className="text-emerald-600" />
    <h3 className="text-xs font-extrabold text-emerald-700 uppercase tracking-widest">{children}</h3>
  </div>
);

const FormulaContent = ({ variant }) => {
  const formulas = variant === 'free'
    ? [
      ['Factored Load', 'P_d = P x SF'],
      ['Moment / Shear', 'M = P_d x a x b / L,   V = P_d x b / L'],
      ['Net Plate', 't_net = t_gross - corrosion'],
      ['Bending Stress', 'sigma_B = M / Z'],
      ['Shear Stress', 'sigma_S = V / A'],
      ['Deflection', 'd = P_d x a^2 x b^2 / (3 E I L)'],
    ]
    : [
      ['Factored Load', 'P_d = P x SF'],
      ['Plate Net Thickness', 't_net = t_gross - plate_corrosion'],
      ['Candidate Search', 'H = H_min..H_max,   T = T_min..T_max'],
      ['Bending Check', 'sigma_B = M / Z_composite <= sigma_B_allow'],
      ['Shear Check', 'sigma_S = V / A_composite <= sigma_S_allow'],
      ['Weld Check', 'sigma_weld <= sigma_weld_allow, choose minimum weight Total OK'],
    ];

  return (
    <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
      {formulas.map(([label, expression]) => (
        <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-1">{label}</p>
          <p className="font-mono text-xs font-bold text-slate-700 leading-relaxed">{expression}</p>
        </div>
      ))}
    </div>
  );
};

export default function CarlingCalculator({ variant = 'free' }) {
  const { employeeId } = useAuth();
  const meta = PAGE_META[variant] || PAGE_META.free;
  const { setCurrentMenu } = useNavigation();
  const [inputs, setInputs] = useState(meta.defaultInput);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showRefImg, setShowRefImg] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);

  const payload = useMemo(() => toPayload(inputs, variant), [inputs, variant]);

  const isValid = useMemo(() => {
    if (!isPositive(payload.load.value) || !isPositive(payload.safety_factor)) return false;
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
      && isPositive(payload.effective_breadth_mm)
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
            <p className="text-sm text-emerald-200/80 mt-0.5">{meta.subtitle}</p>
          </div>
        </div>
        <GuideButton guideTitle={`[파라메트릭] ${meta.title}`} variant="dark" />
      </PageBanner>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowRefImg(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <ImageIcon size={16} className="text-slate-400" /> 참조 그림
          </span>
          {showRefImg ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showRefImg && (
          <div className="border-t border-gray-100 p-5 bg-slate-50">
            <div className="mx-auto grid max-w-5xl grid-cols-1 md:grid-cols-2 gap-4">
              {(meta.referenceImages || []).map((src, index) => (
                <div key={src} className="bg-white border border-slate-100 rounded-xl p-3">
                  <img
                    src={src}
                    alt={`${meta.title} reference ${index + 1}`}
                    className="w-full max-h-60 object-contain"
                  />
                  <p className="mt-2 text-center text-[11px] font-bold text-slate-400">
                    Reference {index + 1}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowFormulas(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <BarChart3 size={16} className="text-slate-400" /> 계산 수식
          </span>
          {showFormulas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showFormulas && <FormulaContent variant={variant} />}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[520px_1fr] gap-6 items-start">
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 py-3 flex items-center gap-2">
              <Ruler size={14} className="text-white" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">입력 조건</h2>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <SectionTitle icon={Calculator}>Load</SectionTitle>
                <div className="grid grid-cols-2 gap-2.5">
                  <SelectField label="Load Type" value={inputs.load.type} onChange={setNested(setInputs, ['load', 'type'])} options={['concentrated', 'distributed']} />
                  <Field label="Load" value={inputs.load.value} onChange={setNested(setInputs, ['load', 'value'])} unit="N" min={0} />
                  {inputs.load.type === 'concentrated' && (
                    <Field label="Position" value={inputs.load.position_mm} onChange={setNested(setInputs, ['load', 'position_mm'])} unit="mm" min={0} />
                  )}
                  <Field label="Safety Factor" value={inputs.safety_factor} onChange={setNested(setInputs, ['safety_factor'])} unit="-" min={0} />
                </div>
              </div>

              <div>
                <SectionTitle icon={Ruler}>Hull</SectionTitle>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Plate Thickness" value={inputs.hull.plate_thickness_gross_mm} onChange={setNested(setInputs, ['hull', 'plate_thickness_gross_mm'])} />
                  <Field label="Stiffener Span" value={inputs.hull.stiffener_span_mm} onChange={setNested(setInputs, ['hull', 'stiffener_span_mm'])} />
                  {variant === 'free' ? (
                    <>
                      <SelectField label="Material" value={inputs.hull.material} onChange={setNested(setInputs, ['hull', 'material'])} options={['Mild', 'HT32', 'HT36']} />
                      <Field label="Corrosion" value={inputs.hull.corrosion_mm} onChange={setNested(setInputs, ['hull', 'corrosion_mm'])} />
                    </>
                  ) : (
                    <>
                      <SelectField label="Corrosion Type" value={inputs.hull.corrosion_type} onChange={handleCorrosionType} options={['NON-CSR', 'CSR-TANK']} />
                      <Field label="Plate Corrosion" value={inputs.hull.plate_corrosion_mm} onChange={setNested(setInputs, ['hull', 'plate_corrosion_mm'])} />
                    </>
                  )}
                </div>
              </div>

              {variant === 'optimization' && (
                <div>
                  <SectionTitle icon={Settings2}>Carling Search Range</SectionTitle>
                  <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                    <SelectField label="Material" value={inputs.carling.material} onChange={setNested(setInputs, ['carling', 'material'])} options={['Mild', 'HT32', 'HT36']} />
                    <Field label="Effective Breadth" value={inputs.effective_breadth_mm} onChange={setNested(setInputs, ['effective_breadth_mm'])} />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                    <Field label="H Min" value={inputs.carling.height_mm.min} onChange={setNested(setInputs, ['carling', 'height_mm', 'min'])} />
                    <Field label="H Max" value={inputs.carling.height_mm.max} onChange={setNested(setInputs, ['carling', 'height_mm', 'max'])} />
                    <Field label="H Step" value={inputs.carling.height_mm.step} onChange={setNested(setInputs, ['carling', 'height_mm', 'step'])} />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <Field label="T Min" value={inputs.carling.thickness_gross_mm.min} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'min'])} />
                    <Field label="T Max" value={inputs.carling.thickness_gross_mm.max} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'max'])} />
                    <Field label="T Step" value={inputs.carling.thickness_gross_mm.step} onChange={setNested(setInputs, ['carling', 'thickness_gross_mm', 'step'])} />
                  </div>
                </div>
              )}

              {!isValid && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-lg px-3 py-2">
                  입력값 범위 또는 부식 여유 조건을 확인하세요.
                </div>
              )}

              <button
                onClick={handleCalculate}
                disabled={!isValid || isLoading}
                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  isValid && !isLoading
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 cursor-pointer'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isLoading ? <><Loader2 size={18} className="animate-spin" /> 계산 중...</> : <><Calculator size={18} /> Calculate</>}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {!result && !error && !isLoading && (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 flex flex-col items-center text-slate-400 text-center">
              <div className="p-5 bg-slate-50 rounded-full mb-4">
                <TableProperties size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">입력값을 확인하고 Calculate를 실행하세요.</p>
              <p className="text-sm mt-1">계산 결과는 판정값과 응력 상세 테이블로 표시됩니다.</p>
            </div>
          )}

          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center text-slate-400">
              <Loader2 size={40} className="animate-spin text-emerald-500 mb-4" />
              <p className="font-bold text-slate-600">Carling 계산을 수행하는 중입니다...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-4">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={22} />
              <div>
                <p className="font-bold text-red-700">계산 실패</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {result && (
            <>
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-3 flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">다운로드</span>
                <button onClick={() => downloadJson(payload, `carling_${variant}_input.json`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                  <Download size={13} /> 입력 JSON
                </button>
                <button onClick={() => downloadJson(result, `carling_${variant}_result.json`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer">
                  <Download size={13} /> 결과 JSON
                </button>
              </div>

              {variant === 'free' ? (
                <FreeResult result={result} />
              ) : (
                <OptimizationResult result={result} okCandidates={okCandidates} candidates={sortedCandidates} />
              )}
            </>
          )}
        </div>
      </div>

      <SolverCredit contributor="박준석" />
    </div>
  );
}

function FreeResult({ result }) {
  const i = result.intermediate || {};
  const checks = result.result?.checks || {};
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">판정 결과</h3>
          <CheckBadge value={result.result?.assessment} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Bending Stress" value={i.sigma_B_calc_MPa} unit="MPa" />
          <Metric label="Bending Allow" value={i.sigma_B_allow_MPa} unit="MPa" />
          <Metric label="Shear Stress" value={i.sigma_S_calc_MPa} unit="MPa" />
          <Metric label="Shear Allow" value={i.sigma_S_allow_MPa} unit="MPa" />
          <Metric label="Deflection" value={i.d_calc_mm} unit="mm" />
          <Metric label="Deflection Allow" value={i.d_allow_mm} unit="mm" />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Check Summary</h3>
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

function OptimizationResult({ result, okCandidates, candidates }) {
  const optimal = result.optimal || {};
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">최적 후보</h3>
          <span className="text-xs font-bold text-slate-400">OK {okCandidates.length} / Total {result.candidates?.length || 0}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric label="Height" value={optimal.H_mm} unit="mm" />
          <Metric label="Thickness" value={optimal.T_gross_mm} unit="mm" />
          <Metric label="Weld Leg" value={optimal.min_leg_length_mm} unit="mm" />
          <Metric label="Weight" value={optimal.weight_kg} unit="kg" />
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500">Material</p>
            <p className="text-lg font-extrabold text-emerald-700 mt-0.5">{optimal.material || '-'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">후보별 상세 결과</h3>
        </div>
        <div className="overflow-auto max-h-[620px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="px-4 py-3 font-bold text-right">H</th>
                <th className="px-4 py-3 font-bold text-right">T</th>
                <th className="px-4 py-3 font-bold text-right">Weight</th>
                <th className="px-4 py-3 font-bold text-right">Bending</th>
                <th className="px-4 py-3 font-bold text-right">Shear</th>
                <th className="px-4 py-3 font-bold text-right">Weld</th>
                <th className="px-4 py-3 font-bold text-right">Leg</th>
                <th className="px-4 py-3 font-bold text-center">Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {candidates.map(row => (
                <tr key={`${row.H_mm}-${row.T_gross_mm}`} className="hover:bg-emerald-50/30">
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(row.H_mm, 2)}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(row.T_gross_mm, 2)}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(row.weight_kg, 2)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(row.stress?.sigma_B_calc_MPa, 2)} / {fmt(row.stress?.sigma_B_allow_MPa, 2)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(row.stress?.sigma_S_calc_MPa, 2)} / {fmt(row.stress?.sigma_S_allow_MPa, 2)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(row.stress?.sigma_weld_calc_MPa, 2)} / {fmt(row.stress?.sigma_weld_allow_MPa, 2)}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(row.min_leg_length_mm, 2)}</td>
                  <td className="px-4 py-3 text-center"><CheckBadge value={row.assessment} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 bg-slate-50 border-t border-gray-100 text-[11px] text-slate-400">
          * 응력 항목은 계산값 / 허용값 순서이며 단위는 MPa입니다. OK 후보를 중량 오름차순으로 먼저 표시합니다.
        </div>
      </div>
    </div>
  );
}
