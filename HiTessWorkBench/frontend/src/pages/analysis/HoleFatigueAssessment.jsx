import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  TableProperties, Calculator,
  CheckCircle2, XCircle, AlertCircle, Loader2,
  BarChart3, Download, Anchor, Wrench, Activity, FileText,
  Waves,
} from 'lucide-react';
import SolverCredit from '../../components/ui/SolverCredit';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAuth } from '../../contexts/AuthContext';
import { API_BASE_URL } from '../../config';
import { formatFixed as fmt } from '../../utils/formatting';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import { downloadJson } from '../../utils/fileHelper';
import holeFatigueRef from '../../assets/images/Hole_fatigue.png';
import ReferenceFormulaTabs from '../../components/ui/ReferenceFormulaTabs';

// ─────────────────────────────────────────────
// 입력 컴포넌트
// ─────────────────────────────────────────────

const NumberField = ({ label, value, onChange, unit, placeholder, readOnly, hint }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-600 mb-1.5 leading-tight">{label}</label>
    <div className={`flex items-center border rounded-lg overflow-hidden transition-colors ${readOnly ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100'}`}>
      <input
        type="number"
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`flex-1 min-w-0 px-2.5 py-2 text-sm font-bold outline-none bg-transparent ${readOnly ? 'text-slate-500 cursor-not-allowed' : 'text-slate-800'}`}
      />
      {unit && <span className="px-2 py-2 bg-slate-50 text-slate-400 text-[10px] font-bold border-l border-slate-100 whitespace-nowrap">{unit}</span>}
    </div>
    {hint && <p className="text-[10px] text-slate-400 mt-1 leading-tight">{hint}</p>}
  </div>
);

const SelectField = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-600 mb-1.5 leading-tight">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-2 text-sm font-bold text-slate-800 border border-slate-200 rounded-lg bg-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-colors cursor-pointer"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

const InputCard = ({ title, icon: Icon, accent, children }) => (
  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
    <div className={`px-4 py-2.5 flex items-center gap-2 bg-gradient-to-r ${accent}`}>
      <Icon size={13} className="text-white" />
      <h3 className="text-[11px] font-bold text-white uppercase tracking-wider">{title}</h3>
    </div>
    <div className="p-4 space-y-3 flex-1">
      {children}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// 결과 표시 컴포넌트
// ─────────────────────────────────────────────

const UsageBadge = ({ uf, size = 'sm', label }) => {
  if (uf == null) {
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">U.F.</span>
        <span className="text-sm text-slate-300 font-mono">—</span>
      </div>
    );
  }
  const ok = uf < 1.0;
  const pct = Math.min(uf, 1) * 100;
  const tone = ok
    ? { ring: 'border-emerald-200', iconBg: 'bg-emerald-100', icon: 'text-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-500' }
    : { ring: 'border-red-200', iconBg: 'bg-red-100', icon: 'text-red-500', text: 'text-red-700', bar: 'bg-red-500' };

  if (size === 'lg') {
    return (
      <div className={`inline-flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl bg-white border ${tone.ring} shadow-sm`} aria-label={`${label || '사용률'} ${fmt(uf, 2)}, ${ok ? '합격' : '불합격'}`}>
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${tone.iconBg}`}>
          {ok ? <CheckCircle2 size={15} className={tone.icon} /> : <XCircle size={15} className={tone.icon} />}
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">
            {label || 'U.F.'}
          </span>
          <span className={`text-base font-extrabold font-mono tabular-nums leading-none ${tone.text}`}>
            {fmt(uf, 2)}
          </span>
        </div>
        <div className="w-10 h-1 rounded-full bg-slate-100 relative overflow-hidden ml-0.5">
          <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // sm
  return (
    <div className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-lg bg-white border ${tone.ring} shadow-sm`} aria-label={`사용률 ${fmt(uf, 2)}, ${ok ? '합격' : '불합격'}`}>
      <div className={`flex items-center justify-center w-5 h-5 rounded-md ${tone.iconBg}`}>
        {ok ? <CheckCircle2 size={11} className={tone.icon} /> : <XCircle size={11} className={tone.icon} />}
      </div>
      <span className={`text-sm font-extrabold font-mono tabular-nums leading-none ${tone.text}`}>
        {fmt(uf, 2)}
      </span>
      <div className="w-8 h-1 rounded-full bg-slate-100 relative overflow-hidden">
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const ResultRow = ({ label, value, unit }) => (
  <div className="flex items-center justify-between py-2 px-3 border-b border-slate-50 last:border-b-0">
    <span className="text-[11px] text-slate-500 font-medium">{label}</span>
    <span className="text-right font-mono text-sm text-slate-800 font-bold">
      {value != null ? fmt(value, 2) : '—'} {unit && <span className="text-[10px] text-slate-400 font-normal ml-0.5">{unit}</span>}
    </span>
  </div>
);

const ResultCard = ({ index, title, snCurve, accent, children, usageFactor }) => (
  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
    <div className={`px-5 py-3 bg-gradient-to-r ${accent}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white text-xs font-extrabold">{index}</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 text-white text-[10px] font-bold border border-white/20">SN-{snCurve}</span>
      </div>
      <h3 className="text-xs font-bold text-white tracking-tight leading-tight">{title}</h3>
    </div>
    <div className="px-2 py-2 flex-1">
      {children}
    </div>
    <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Usage Factor</span>
      <UsageBadge uf={usageFactor} />
    </div>
  </div>
);

// ─────────────────────────────────────────────
// 자동 계산 헬퍼 (README의 GUI 기본 규칙)
// ─────────────────────────────────────────────

const calcReductionFactor = (area) => area === 'World Wide' ? 0.8 : 1.0;
const calcFractionTimeFactor = (shipType) => shipType === 'ETC' ? 1.0 : 0.85;
const calcGrindingFactor = (grinding) => grinding === 'Grinding' ? 1.3 : 1.0;
const calcWeibullShapeParameter = (shipType, lengthM) => {
  if (shipType === 'CNTR') return 1.05;
  const L = parseFloat(lengthM);
  if (!L || L <= 0) return null;
  return Math.round((2.21 - 0.54 * Math.log10(L) + 0.05) * 100) / 100;
};

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

export default function HoleFatigueAssessment() {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();

  // Ship information
  const [shipType, setShipType] = useState('CNTR');
  const [shipLengthM, setShipLengthM] = useState('336.78');
  const [sectionModulusM3, setSectionModulusM3] = useState('69.16');
  const [operatingArea, setOperatingArea] = useState('North Atlantic');

  // SCF parameters
  const [plateThicknessMm, setPlateThicknessMm] = useState('60');
  const [sleeveOuterDiameterMm, setSleeveOuterDiameterMm] = useState('162');
  const [sleeveThicknessMm, setSleeveThicknessMm] = useState('28');
  const [weldingType, setWeldingType] = useState('Full penetration');
  const [weldingThroatThicknessMm, setWeldingThroatThicknessMm] = useState('25.28');
  const [weldingToeGrinding, setWeldingToeGrinding] = useState('Grinding');

  // Allowable stress
  const [probabilityLevel, setProbabilityLevel] = useState('1e-8');
  const [designLifeCycle, setDesignLifeCycle] = useState('7.8e7');

  // Vertical wave bending moment
  const [maxVwbmKnm, setMaxVwbmKnm] = useState('5000000');

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // 자동 계산 필드
  const reductionFactor = useMemo(() => calcReductionFactor(operatingArea), [operatingArea]);
  const fractionTimeFactor = useMemo(() => calcFractionTimeFactor(shipType), [shipType]);
  const grindingFactor = useMemo(() => calcGrindingFactor(weldingToeGrinding), [weldingToeGrinding]);
  const weibullShape = useMemo(() => calcWeibullShapeParameter(shipType, shipLengthM), [shipType, shipLengthM]);

  const stressRangeMpa = result?.derived?.stress_range_mpa;

  // 모든 숫자 입력은 NaN 가드 후 양수만 허용 — 'abc'/'.' 등이 parseFloat로 NaN이 되어
  // 백엔드(Pydantic float)에서 422를 내거나 결과가 NaN으로 전파되는 것을 방지한다.
  const isValid = [
    shipLengthM, sectionModulusM3, plateThicknessMm, sleeveOuterDiameterMm,
    sleeveThicknessMm, weldingThroatThicknessMm, probabilityLevel, designLifeCycle, maxVwbmKnm,
  ].every((v) => {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) && n > 0;
  });

  const buildPayload = () => ({
    ship_type: shipType,
    ship_length_m: parseFloat(shipLengthM),
    section_modulus_m3: parseFloat(sectionModulusM3),
    operating_area: operatingArea,
    reduction_factor_on_operating_area: reductionFactor,
    fraction_time_factor: fractionTimeFactor,
    plate_thickness_mm: parseFloat(plateThicknessMm),
    sleeve_outer_diameter_mm: parseFloat(sleeveOuterDiameterMm),
    sleeve_thickness_mm: parseFloat(sleeveThicknessMm),
    welding_type: weldingType,
    welding_throat_thickness_mm: parseFloat(weldingThroatThicknessMm),
    welding_toe_grinding: weldingToeGrinding,
    probability_level_of_exceedance: parseFloat(probabilityLevel),
    weibull_shape_parameter: weibullShape,
    design_life_cycle: parseFloat(designLifeCycle),
    max_vertical_wave_bending_moment_knm: parseFloat(maxVwbmKnm),
  });

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/hole-calculation/calculate`, {
        ...buildPayload(),
        employee_id: employeeId || 'unknown',
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const transverse = result?.fatigue_cracking_transverse_to_weld_toe;
  const parallel = result?.fatigue_cracking_parallel_to_weld_toe;
  const root = result?.fatigue_cracking_from_weld_root;
  const showRootSection = weldingType === 'Partial or Fillet';

  const overallOk = result && [
    transverse?.usage_factor,
    parallel?.usage_factor,
    showRootSection ? root?.usage_factor : null,
  ].filter(v => v != null).every(uf => uf < 1.0);

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      <AnalysisPageBanner
        title="Simplified Hole Fatigue Assessment"
        subtitle="Welded pipe penetration의 SCF 기반 피로 평가 — DNVGL-RP-C203 기준"
        icon={TableProperties}
        guideTitle="[파라메트릭] Simplified Hole Fatigue Assessment"
        onBack={() => setCurrentMenu('Parametric Apps')}
        backLabel="Parametric Apps로 돌아가기"
        gradient="from-brand-blue via-emerald-900 to-emerald-700"
        iconClassName="text-emerald-300"
        subtitleClassName="text-emerald-200/80"
      />

      <ReferenceFormulaTabs
        accent="emerald"
        className="mb-4"
      >
        {(activeInfoTab) => activeInfoTab === 'image' ? (
          <div className="border-t border-gray-100 p-6 bg-slate-50">
            <img
              src={holeFatigueRef}
              alt="Hole Fatigue 참조 도면"
              loading="lazy"
              decoding="async"
              className="w-full max-w-3xl mx-auto rounded-lg object-contain bg-white p-4 border border-gray-200"
            />
            <p className="text-center text-xs text-slate-500 mt-3">
              (1) Fillet weld 영역 σ_p — (2) Insert tubular 직각 응력 σ_n, σ_l — (3) Weld root 전단 응력 τ_∥p, σ_n
            </p>
          </div>
        ) : (
          <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 text-sm">

            {/* 공칭 응력 범위 */}
            <div>
              <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">공칭 응력 범위</p>
              <div className="space-y-2.5">
                {[
                  ['응력 범위', 'σ_range = 2·M_VWBM / Z / 1000', 'MPa'],
                  ['M_VWBM', '최대 수직 파랑 굽힘 모멘트', 'kNm'],
                  ['Z', 'Section modulus', 'm³'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* SCF 보간 (DNVGL Table) */}
            <div>
              <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">SCF 보간 (DNVGL Table)</p>
              <div className="space-y-2.5">
                {[
                  ['무차원비', 't_r/t_p, R/t_p, h/t_r', '—'],
                  ['Plate SCF', 'σ_p ← 가로 균열용 SCF', 'SN-C'],
                  ['Toe SCF',   'σ_l ← 세로 균열용 SCF',   'SN-D'],
                  ['Root SCF',  'σ_n, τ_∥p ← Root 응력', 'SN-W3'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 계산 응력 */}
            <div>
              <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">계산 응력 σ_cal</p>
              <div className="space-y-2.5">
                {[
                  ['Transverse', 'σ_cal = σ_range × SCF_plate', 'MPa'],
                  ['Parallel',   'σ_cal = σ_range × SCF_toe',   'MPa'],
                  ['Root (정응력)', 'σ_n,cal = σ_range × SCF_n', 'MPa'],
                  ['Root (전단)',  'τ_∥p,cal = σ_range × SCF_τ', 'MPa'],
                  ['Root 합산', 'σ_cal = √(σ_n² + τ_∥p²)·f_root', 'MPa'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 허용 응력 / Usage */}
            <div>
              <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">허용 응력 · Usage</p>
              <div className="space-y-2.5">
                {[
                  ['Probability factor', 'P_f = (ln(P)/ln(10⁻⁸))^(1/h)', '—'],
                  ['σ_allowable', '두께·해역·확률·Weibull·수명 보정', 'MPa'],
                  ['Usage Factor', 'U.F. = σ_cal / σ_allowable', '—'],
                  ['판정 기준', 'U.F. < 1.0 만족', 'OK/NG'],
                  ['Weibull h', 'CNTR → 1.05, 그 외 → 2.21−0.54·log10(L)+0.05', '—'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </ReferenceFormulaTabs>

      {/* ───────── 입력 패널 (전체 너비, 4컬럼 그리드) ───────── */}
      <div className="bg-gradient-to-br from-emerald-50/40 via-white to-emerald-50/40 border border-emerald-100 rounded-2xl p-5 mb-4 shadow-sm">

        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-emerald-600 rounded-lg">
            <BarChart3 size={14} className="text-white" />
          </div>
          <h2 className="text-sm font-bold text-slate-700 tracking-tight">Design Parameters</h2>
          <div className="flex-1 border-t border-emerald-100 mx-2" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">DNVGL-RP-C203</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

          {/* (1) Ship information */}
          <InputCard title="Ship Information" icon={Anchor} accent="from-emerald-700 to-emerald-600">
            <SelectField label="Ship type" value={shipType} onChange={setShipType} options={['CNTR', 'GAS', 'TANKER', 'BULK', 'ETC']} />
            <NumberField label="Ship length" value={shipLengthM} onChange={setShipLengthM} unit="m" placeholder="336.78" />
            <NumberField label="Section modulus" value={sectionModulusM3} onChange={setSectionModulusM3} unit="m³" placeholder="69.16" />
            <SelectField label="Operating area" value={operatingArea} onChange={setOperatingArea} options={['North Atlantic', 'World Wide']} />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Reduction factor" value={reductionFactor} unit="" readOnly />
              <NumberField label="Fraction time" value={fractionTimeFactor} unit="" readOnly />
            </div>
          </InputCard>

          {/* (2) SCF parameters */}
          <InputCard title="SCF of Holes with Sleeve" icon={Wrench} accent="from-emerald-700 to-emerald-600">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Plate thickness" value={plateThicknessMm} onChange={setPlateThicknessMm} unit="mm" placeholder="60" />
              <NumberField label="Sleeve OD" value={sleeveOuterDiameterMm} onChange={setSleeveOuterDiameterMm} unit="mm" placeholder="162" />
            </div>
            <NumberField label="Sleeve thickness" value={sleeveThicknessMm} onChange={setSleeveThicknessMm} unit="mm" placeholder="28" />
            <SelectField label="Welding type" value={weldingType} onChange={setWeldingType} options={['Full penetration', 'Partial or Fillet']} />
            <NumberField label="Welding throat thickness" value={weldingThroatThicknessMm} onChange={setWeldingThroatThicknessMm} unit="mm" placeholder="25.28" />
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Toe grinding" value={weldingToeGrinding} onChange={setWeldingToeGrinding} options={['Grinding', 'No Grinding']} />
              <NumberField label="Grinding factor" value={grindingFactor} unit="" readOnly />
            </div>
          </InputCard>

          {/* (3) Allowable stress range */}
          <InputCard title="Allowable Stress Range" icon={BarChart3} accent="from-emerald-700 to-emerald-600">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5 leading-tight">Probability of exceedance</label>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setProbabilityLevel('1e-2')} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${probabilityLevel === '1e-2' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>1e-2</button>
                <button onClick={() => setProbabilityLevel('1e-8')} className={`flex-1 px-2 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${probabilityLevel === '1e-8' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>1e-8</button>
              </div>
              <input
                type="text"
                value={probabilityLevel}
                onChange={e => setProbabilityLevel(e.target.value)}
                className="w-full px-2.5 py-2 text-sm font-bold text-slate-800 border border-slate-200 rounded-lg outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-colors"
              />
            </div>
            <NumberField label="Weibull shape parameter h" value={weibullShape ?? ''} unit="" readOnly hint="Ship type / Ship length 기반 자동 산출" />
            <NumberField label="Design life cycle" value={designLifeCycle} onChange={setDesignLifeCycle} unit="" placeholder="7.8e7" hint="N > 1e+07" />
          </InputCard>

          {/* (4) Vertical wave bending moment + 결과 stress range */}
          <InputCard title="Vertical Wave Bending Moment" icon={Waves} accent="from-emerald-700 to-emerald-600">
            <NumberField label="Max. VWBM" value={maxVwbmKnm} onChange={setMaxVwbmKnm} unit="kNm" placeholder="5,000,000" />

            {/* Nominal stress range — 결과 반영 read-only */}
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nominal Stress Range</p>
              <p className="text-2xl font-extrabold text-emerald-700 font-mono">
                {stressRangeMpa != null ? fmt(stressRangeMpa, 1) : '—'}
                <span className="text-xs text-slate-400 ml-1.5 font-normal">MPa</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-1">σ_range = 2·M / Z / 1000</p>
            </div>

            {/* Calculate 버튼 */}
            <button
              onClick={handleCalculate}
              disabled={!isValid || isLoading}
              className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                isValid && !isLoading
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-md shadow-emerald-200 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading
                ? <><Loader2 size={16} className="animate-spin" /> 계산 중...</>
                : <><Calculator size={16} /> CALCULATION</>}
            </button>
          </InputCard>

        </div>
      </div>

      {/* ───────── 결과 영역 ───────── */}
      <div className="space-y-4">

        {!result && !error && !isLoading && (
          <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-12 flex flex-col items-center text-slate-400 text-center">
            <div className="p-5 bg-slate-50 rounded-full mb-4">
              <TableProperties size={36} className="opacity-20" />
            </div>
            <p className="font-bold text-slate-500">입력값을 확인하고 CALCULATION을 실행하세요.</p>
            <p className="text-sm mt-1">Welded pipe penetration의 SCF 기반 피로 평가 결과를 산출합니다.</p>
          </div>
        )}

        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 flex flex-col items-center text-slate-400">
            <Loader2 size={36} className="animate-spin text-emerald-500 mb-4" />
            <p className="font-bold text-slate-600">피로 평가를 계산하는 중입니다...</p>
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
            {/* Conclusion 카드 (전체 너비) */}
            <div className={`rounded-2xl p-5 border-2 ${overallOk ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {overallOk
                    ? <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={28} />
                    : <XCircle className="text-red-600 shrink-0 mt-0.5" size={28} />
                  }
                  <div className="min-w-0">
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${overallOk ? 'text-emerald-700' : 'text-red-700'}`}>Conclusion</p>
                    <p className={`text-lg font-extrabold mt-0.5 ${overallOk ? 'text-emerald-900' : 'text-red-900'}`}>
                      {result.conclusion ?? (overallOk ? 'Sufficient the fatigue strength.' : 'Insufficient.')}
                    </p>
                  </div>
                </div>

                {/* Usage Factor 요약 + 다운로드 */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <UsageBadge uf={transverse?.usage_factor} size="lg" label="① TRANS" />
                  <UsageBadge uf={parallel?.usage_factor} size="lg" label="② PARAL" />
                  {showRootSection && <UsageBadge uf={root?.usage_factor} size="lg" label="③ ROOT" />}
                  <div className="w-px h-6 bg-slate-200 mx-1" />
                  <button
                    onClick={() => downloadJson(buildPayload(), 'hole_fatigue_input.json')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                  >
                    <Download size={13} /> 입력
                  </button>
                  <button
                    onClick={() => downloadJson(result, 'hole_fatigue_result.json')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                  >
                    <Download size={13} /> 결과
                  </button>
                </div>
              </div>
            </div>

            {/* 결과 3 섹션 — 가로 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

              <ResultCard
                index="1"
                title="Transverse to the weld toe"
                snCurve="C"
                accent="from-slate-700 to-slate-600"
                usageFactor={transverse?.usage_factor}
              >
                <ResultRow label="SCF" value={transverse?.scf} unit="" />
                <ResultRow label="σ_cal" value={transverse?.sigma_cal_mpa} unit="MPa" />
                <ResultRow label="σ_allowable" value={transverse?.sigma_allowable_sn_curve_c_mpa} unit="MPa" />
              </ResultCard>

              <ResultCard
                index="2"
                title="Parallel to the weld toe"
                snCurve="D"
                accent="from-slate-700 to-slate-600"
                usageFactor={parallel?.usage_factor}
              >
                <ResultRow label="SCF" value={parallel?.scf} unit="" />
                <ResultRow label="σ_cal" value={parallel?.sigma_cal_mpa} unit="MPa" />
                <ResultRow label="σ_allowable" value={parallel?.sigma_allowable_sn_curve_d_mpa} unit="MPa" />
              </ResultCard>

              {showRootSection ? (
                <ResultCard
                  index="3"
                  title="From the weld root"
                  snCurve="W3"
                  accent="from-slate-700 to-slate-600"
                  usageFactor={root?.usage_factor}
                >
                  <ResultRow label="SCF (normal)" value={root?.scf_stress_in_plate_normal_to_weld} unit="" />
                  <ResultRow label="σ_cal (normal)" value={root?.sigma_cal_stress_in_plate_normal_to_weld_mpa} unit="MPa" />
                  <ResultRow label="SCF (shear)" value={root?.scf_shear_stress_in_plate} unit="" />
                  <ResultRow label="τ_cal (shear)" value={root?.tau_cal_shear_stress_in_plate_mpa} unit="MPa" />
                  <ResultRow label="σ_cal" value={root?.sigma_cal_mpa} unit="MPa" />
                  <ResultRow label="σ_allowable" value={root?.sigma_allowable_sn_curve_w3_mpa} unit="MPa" />
                </ResultCard>
              ) : (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
                  <FileText size={28} className="text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-500">(3) From the weld root</p>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    Welding type이 <span className="font-bold text-slate-600">Full penetration</span> 인 경우<br />
                    weld root 평가는 적용되지 않습니다.
                  </p>
                </div>
              )}

            </div>
          </>
        )}
      </div>

      <SolverCredit contributor="김윤환" />
    </div>
  );
}
