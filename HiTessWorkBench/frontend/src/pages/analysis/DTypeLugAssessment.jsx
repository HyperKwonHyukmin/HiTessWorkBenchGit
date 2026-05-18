import React, { useState } from 'react';
import axios from 'axios';
import {
  Activity, AlertCircle, ArrowLeft, BarChart3, Calculator, ChevronDown,
  ChevronUp, Download, History, ImageIcon, Loader2, Ruler, ShieldCheck, TableProperties
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import ChangelogModal from '../../components/ui/ChangelogModal';
import { useAuth } from '../../contexts/AuthContext';
import SolverCredit from '../../components/ui/SolverCredit';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import { formatFixed as fmt } from '../../utils/formatting';
import dTypeLugRef1 from '../../assets/images/D_typeLug1.png';
import dTypeLugRef2 from '../../assets/images/D_typeLug2.png';
import dTypeLugRef3 from '../../assets/images/D_typeLug3.png';

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
    w1_prime: '12', w2_prime: '0',
  },
  material: {
    yield_base_MPa: '235',
    yield_weld_MPa: '291.76',
  },
};

const BRACKET_LABELS = {
  bracket_4EA: 'Bracket 4EA',
  bracket_2EA_double: 'Bracket 2EA Double',
  bracket_2EA_single: 'Bracket 2EA Single',
};

const caseLabel = (index) => Number.isFinite(Number(index)) ? Number(index) + 1 : '-';

const REFERENCE_IMAGES = [
  { src: dTypeLugRef1, label: 'Reference 1' },
  { src: dTypeLugRef2, label: 'Reference 2' },
  { src: dTypeLugRef3, label: 'Reference 3' },
];

const GEOMETRY_GROUPS = [
  { title: 'Length / Height', fields: [['l1', 'L1'], ['l2', 'L2'], ['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4'], ['h5', 'H5']] },
  { title: 'Plate / Radius', fields: [['t1', 'T1'], ['t2', 'T2'], ['t3', 'T3'], ['r1', 'R1'], ['r2', 'R2'], ['pin_radius', 'Pin R']] },
  { title: 'Diameter / Weld', fields: [['d1', 'D1'], ['d2', 'D2'], ['d3', 'D3'], ['w1', 'W1'], ['w2', 'W2'], ['w1_prime', "W1'"], ['w2_prime', "W2'"]] },
];

const downloadJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const toNumberPayload = (inputs) => ({
  load: Object.fromEntries(Object.entries(inputs.load).map(([k, v]) => [k, Number(v)])),
  geometry: Object.fromEntries(Object.entries(inputs.geometry).map(([k, v]) => [k, Number(v)])),
  material: Object.fromEntries(Object.entries(inputs.material).map(([k, v]) => [k, Number(v)])),
});

const InputField = ({ label, value, onChange, unit = 'mm', min = 0 }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-700 mb-1">{label}</label>
    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors bg-white">
      <input
        type="number"
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 px-2.5 py-2 text-sm font-bold text-slate-800 outline-none bg-transparent"
      />
      <span className="px-2.5 py-2 bg-slate-50 text-slate-500 text-[11px] font-bold border-l border-slate-200">{unit}</span>
    </div>
  </div>
);

const StatusBadge = ({ value }) => {
  const ok = Number(value) <= 1;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
      ok ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'
    }`}>
      <ShieldCheck size={11} /> {ok ? 'OK' : 'NG'}
    </span>
  );
};

const ResultMetric = ({ label, value, unit, danger }) => (
  <div className={`border rounded-xl px-4 py-3 ${danger ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
    <p className={`text-[10px] font-bold uppercase tracking-wide ${danger ? 'text-red-400' : 'text-emerald-500'}`}>{label}</p>
    <p className={`text-lg font-extrabold mt-0.5 ${danger ? 'text-red-700' : 'text-emerald-700'}`}>
      {value} <span className="text-xs font-medium opacity-70">{unit}</span>
    </p>
  </div>
);

export default function DTypeLugAssessment() {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const [inputs, setInputs] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBracket, setSelectedBracket] = useState('bracket_4EA');
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showRefImages, setShowRefImages] = useState(false);
  const [showInputJson, setShowInputJson] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  const setField = (section, key) => (value) => {
    setInputs(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const payload = toNumberPayload(inputs);
  const isValid =
    payload.load.force_N > 0 &&
    payload.material.yield_base_MPa > 0 &&
    payload.material.yield_weld_MPa > 0 &&
    Object.values(payload.geometry).every(v => Number.isFinite(v) && v >= 0);

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setSelectedCaseIndex(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/d-type-lug/calculate`, {
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

  const resultEntries = Object.entries(result?.results || {});
  const selectedData = result?.results?.[selectedBracket];
  const selectedAngles = selectedData?.per_angle || [];
  const governing = selectedData?.max_usage_factor || {};
  const governingAngle = result?.angle_cases?.find(a => a.index === governing.governing_angle_index);
  const activeCaseIndex = selectedCaseIndex ?? governing.governing_angle_index ?? selectedAngles[0]?.index;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-emerald-900 to-emerald-700 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
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
                D Type Lug Assessment
              </h1>
              <p className="text-sm text-emerald-200/80 mt-0.5">Excel 기본값 기준 D-Type 러그의 브라켓 타입별 각도 케이스 사용률을 계산합니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              <History size={14} /> 이력
            </button>
            <GuideButton guideTitle="[파라메트릭] D Type Lug Assessment" variant="dark" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowRefImages(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2"><ImageIcon size={16} className="text-slate-400" /> 참조 그림</span>
          {showRefImages ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showRefImages && (
          <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {REFERENCE_IMAGES.map(image => (
              <div key={image.src} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                <img src={image.src} alt={image.label} className="w-full h-52 object-contain rounded-lg bg-white" />
                <p className="text-[11px] text-slate-400 font-bold mt-2 text-center">{image.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowFormulas(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2"><BarChart3 size={16} className="text-slate-400" /> 계산 기준</span>
          {showFormulas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showFormulas && (
          <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            {[
              ['각도 케이스', 'α = 0, 30, 45, 60, 75, 90°\nβ = 0, 15°\n총 12개 케이스'],
              ['검토 단면', 'A: Pin 전단\nB: Pin Bearing\nC: Lug Plate\nD: Base Plate\nE: Weld'],
              ['판정 기준', '사용률(Usage Factor) = 등가응력 / 허용응력\n1.0 이하이면 OK, 1.0 초과이면 NG'],
            ].map(([title, text]) => (
              <div key={title}>
                <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">{title}</p>
                <div className="bg-slate-50 rounded-lg px-3 py-3">
                  <p className="font-mono text-slate-700 font-bold text-xs whitespace-pre-line leading-relaxed">{text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[520px_1fr] gap-6 items-start">
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 py-3 flex items-center gap-2">
              <Ruler size={14} className="text-white" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">입력 조건</h2>
            </div>
            <div className="p-5 space-y-4">
              <InputField label="Force" value={inputs.load.force_N} onChange={setField('load', 'force_N')} unit="N" min={1} />

              {GEOMETRY_GROUPS.map(group => (
                <div key={group.title}>
                  <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-2">{group.title}</p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {group.fields.map(([key, label]) => (
                      <InputField
                        key={key}
                        label={label}
                        value={inputs.geometry[key]}
                        onChange={setField('geometry', key)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-2">Material</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <InputField label="Base Yield" value={inputs.material.yield_base_MPa} onChange={setField('material', 'yield_base_MPa')} unit="MPa" min={1} />
                  <InputField label="Weld Yield" value={inputs.material.yield_weld_MPa} onChange={setField('material', 'yield_weld_MPa')} unit="MPa" min={1} />
                </div>
              </div>

              <button
                onClick={handleCalculate}
                disabled={!isValid || isLoading}
                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  isValid && !isLoading
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 cursor-pointer'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isLoading
                  ? <><Loader2 size={18} className="animate-spin" /> 계산 중...</>
                  : <><Calculator size={18} /> Calculate</>}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowInputJson(v => !v)}
              className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2"><Activity size={16} className="text-slate-400" /> 입력 JSON</span>
              {showInputJson ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {showInputJson && (
              <pre className="border-t border-gray-100 p-4 bg-slate-950 text-emerald-100 text-[11px] overflow-x-auto max-h-[360px]">
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {!result && !error && !isLoading && (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 flex flex-col items-center text-slate-400 text-center">
              <div className="p-5 bg-slate-50 rounded-full mb-4">
                <TableProperties size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">Excel 기본 입력값을 확인하고 Calculate를 실행하세요.</p>
              <p className="text-sm mt-1">계산 결과는 브라켓 타입별 최대 사용률과 각도별 상세값으로 표시됩니다.</p>
            </div>
          )}

          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center text-slate-400">
              <Loader2 size={40} className="animate-spin text-emerald-500 mb-4" />
              <p className="font-bold text-slate-600">D-Type Lug 강도를 계산하는 중입니다...</p>
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
                <button
                  onClick={() => downloadJson(payload, 'd_type_lug_input.json')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={13} /> 입력 JSON
                </button>
                <button
                  onClick={() => downloadJson(result, 'd_type_lug_result.json')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={13} /> 결과 JSON
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {resultEntries.map(([name, data]) => {
                  const max = data.max_usage_factor || {};
                  const danger = Number(max.overall) > 1;
                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedBracket(name)}
                      className={`text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                        selectedBracket === name
                          ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                          : 'bg-white border-gray-200 hover:border-emerald-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-extrabold text-slate-700">{BRACKET_LABELS[name] || name}</p>
                        <StatusBadge value={max.overall} />
                      </div>
                      <p className={`text-3xl font-extrabold mt-3 ${danger ? 'text-red-600' : 'text-emerald-700'}`}>
                        {fmt(max.overall, 2)}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Governing: Section {max.governing_section || '-'} / Case {caseLabel(max.governing_angle_index)}
                      </p>
                    </button>
                  );
                })}
              </div>

              {selectedData && (
                <div className="space-y-4">
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                        <ShieldCheck size={16} className="text-emerald-500" /> 최대 사용률
                      </h3>
                      <span className="text-xs font-bold text-slate-400">{BRACKET_LABELS[selectedBracket]}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      {['A', 'B', 'C', 'D', 'E', 'overall'].map(section => (
                        <ResultMetric
                          key={section}
                          label={section === 'overall' ? 'Overall Usage' : `Section ${section}`}
                          value={fmt(governing[section], 2)}
                          unit="Usage Factor"
                          danger={Number(governing[section]) > 1}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3">
                      Governing angle: α {governingAngle?.alpha_deg ?? '-'}° / β {governingAngle?.beta_deg ?? '-'}° / Case {caseLabel(governing.governing_angle_index)}
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">각도 케이스별 상세 결과</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-gray-100">
                            <th className="px-4 py-3 font-bold text-center">Case</th>
                            <th className="px-4 py-3 font-bold text-center">Alpha</th>
                            <th className="px-4 py-3 font-bold text-center">Beta</th>
                            {['A', 'B', 'C', 'D', 'E'].map(section => (
                              <th key={section} className="px-4 py-3 font-bold text-right">Usage {section}</th>
                            ))}
                            <th className="px-4 py-3 font-bold text-center">Max</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {selectedAngles.map(row => {
                            const angle = result.angle_cases?.find(a => a.index === row.index);
                            const uf = row.usage_factor || {};
                            const maxUf = Math.max(...['A', 'B', 'C', 'D', 'E'].map(k => Number(uf[k] || 0)));
                            return (
                              <tr key={row.index} className="hover:bg-emerald-50/30">
                                <td className="px-4 py-3 text-center font-bold text-slate-600">
                                  <button
                                    onClick={() => setSelectedCaseIndex(row.index)}
                                    className={`w-8 h-8 rounded-lg font-bold transition-colors cursor-pointer ${
                                      activeCaseIndex === row.index
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700'
                                    }`}
                                  >
                                    {caseLabel(row.index)}
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-center text-slate-500">{angle?.alpha_deg ?? '-'}</td>
                                <td className="px-4 py-3 text-center text-slate-500">{angle?.beta_deg ?? '-'}</td>
                                {['A', 'B', 'C', 'D', 'E'].map(section => (
                                  <td key={section} className={`px-4 py-3 text-right font-bold ${Number(uf[section]) > 1 ? 'text-red-600' : 'text-slate-700'}`}>
                                    {fmt(uf[section], 2)}
                                  </td>
                                ))}
                                <td className="px-4 py-3 text-center"><StatusBadge value={maxUf} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-3 bg-slate-50 border-t border-gray-100 text-[11px] text-slate-400">
                      * Usage Factor는 등가응력을 허용응력으로 나눈 사용률입니다. 1.0 이하이면 OK입니다.
                    </div>
                  </div>

                  {selectedAngles.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-6 py-3 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Analysis 응력 상세</h3>
                        <span className="text-xs font-bold text-emerald-100">
                          {BRACKET_LABELS[selectedBracket]}
                        </span>
                      </div>
                      <div className="p-5 space-y-5">
                        <div>
                          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">등가응력</p>
                          <div className="overflow-auto border border-slate-100 rounded-xl max-h-[440px]">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-100">
                                  <th className="px-4 py-3 font-bold text-center">Case</th>
                                  <th className="px-4 py-3 font-bold text-center">Alpha</th>
                                  <th className="px-4 py-3 font-bold text-center">Beta</th>
                                  {['A', 'B', 'C', 'D', 'E'].map(section => (
                                    <th key={section} className="px-4 py-3 font-bold text-right">Eq. {section}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {selectedAngles.map(row => {
                                  const angle = result.angle_cases?.find(a => a.index === row.index);
                                  const eq = row.equivalent_stress || {};
                                  return (
                                    <tr key={row.index} className="hover:bg-emerald-50/30">
                                      <td className="px-4 py-3 text-center font-bold text-slate-700">{caseLabel(row.index)}</td>
                                      <td className="px-4 py-3 text-center text-slate-500">{angle?.alpha_deg ?? '-'}</td>
                                      <td className="px-4 py-3 text-center text-slate-500">{angle?.beta_deg ?? '-'}</td>
                                      {['A', 'B', 'C', 'D', 'E'].map(section => (
                                        <td key={section} className={`px-4 py-3 text-right font-bold ${Number(row.usage_factor?.[section]) > 1 ? 'text-red-600' : 'text-slate-700'}`}>
                                          {fmt(eq[section], 2)}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-widest mb-3">Analysis Components</p>
                          <div className="overflow-auto border border-slate-100 rounded-xl max-h-[520px]">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-100">
                                  <th className="px-4 py-3 font-bold text-center">Case</th>
                                  <th className="px-4 py-3 font-bold text-center">Alpha</th>
                                  <th className="px-4 py-3 font-bold text-center">Beta</th>
                                  <th className="px-4 py-3 font-bold text-center">Section</th>
                                  <th className="px-4 py-3 font-bold text-right">Shear</th>
                                  <th className="px-4 py-3 font-bold text-right">Normal</th>
                                  <th className="px-4 py-3 font-bold text-right">Bearing</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {selectedAngles.flatMap(row => {
                                  const angle = result.angle_cases?.find(a => a.index === row.index);
                                  return ['A', 'B', 'C', 'D', 'E'].map(section => {
                                    const analysis = row.analysis?.[section] || {};
                                    return (
                                      <tr key={`${row.index}-${section}`} className="hover:bg-emerald-50/30">
                                        <td className="px-4 py-3 text-center font-bold text-slate-700">{caseLabel(row.index)}</td>
                                        <td className="px-4 py-3 text-center text-slate-500">{angle?.alpha_deg ?? '-'}</td>
                                        <td className="px-4 py-3 text-center text-slate-500">{angle?.beta_deg ?? '-'}</td>
                                        <td className="px-4 py-3 text-center font-bold text-slate-700">{section}</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">{analysis.shear != null ? fmt(analysis.shear, 2) : '-'}</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">{analysis.normal != null ? fmt(analysis.normal, 2) : '-'}</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">{analysis.bearing != null ? fmt(analysis.bearing, 2) : '-'}</td>
                                      </tr>
                                    );
                                  });
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-2">단위: MPa. 전체 각도 케이스의 Section A~E별 Analysis 응력을 표시하며, 해당하지 않는 항목은 '-'로 표시됩니다.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SolverCredit contributor="김병훈" />
      <ChangelogModal programKey="DTypeLugAssessment" title="D Type Lug Assessment" isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
