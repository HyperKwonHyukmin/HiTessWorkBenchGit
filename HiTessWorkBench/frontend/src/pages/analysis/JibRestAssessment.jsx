import React, { useState } from 'react';
import axios from 'axios';
import {
  TableProperties, Calculator, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, AlertCircle, Loader2,
  Weight, BarChart3, ChevronRight, ImageIcon, Wind, Download, ArrowLeft
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import jibRestRef from '../../assets/images/jib_rest_reference.png';
import jibCraneRef from '../../assets/images/jib_crane_reference.png';
import { formatFixed as fmt } from '../../utils/formatting';
import SolverCredit from '../../components/ui/SolverCredit';

const downloadJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const OkBadge = ({ ok }) =>
  ok
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold"><CheckCircle2 size={11} /> OK</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 border border-red-200 rounded-full text-[10px] font-bold"><XCircle size={11} /> NG</span>;

const InputField = ({ label, desc, value, onChange, unit, placeholder, readOnly }) => (
  <div>
    <label className="block text-xs font-bold text-slate-700 mb-1">{label}</label>
    {desc && <p className="text-[10px] text-slate-400 mb-1">{desc}</p>}
    <div className={`flex items-center border-2 rounded-xl overflow-hidden transition-colors ${
      readOnly ? 'border-slate-100 bg-slate-50' : 'border-slate-200 focus-within:border-indigo-500 bg-white'
    }`}>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className="flex-1 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none bg-transparent"
      />
      <span className="px-3 py-2.5 bg-slate-50 text-slate-500 text-xs font-bold border-l border-slate-200">{unit}</span>
    </div>
  </div>
);

const GroupLabel = ({ children }) => (
  <p className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mt-1 mb-2">{children}</p>
);

// ─────────────────────────────────────────────
// 풍하중 stat 카드
// ─────────────────────────────────────────────

const LoadCard = ({ label, value, unit }) => (
  <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
    <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wide">{label}</p>
    <p className="text-lg font-extrabold text-indigo-700 mt-0.5">
      {value} <span className="text-xs font-medium text-indigo-400">{unit}</span>
    </p>
  </div>
);

// ─────────────────────────────────────────────
// 후보 상세 패널
// displacement = 실제 δ, maxDisplacement = 허용
// ─────────────────────────────────────────────

const CandidateDetail = ({ c }) => {
  const rows = [
    { label: '브래킷 높이 BH',    value: c.bracketHeight,    unit: 'mm' },
    { label: '브래킷 폭 BB',      value: c.bracketBreadth,   unit: 'mm' },
    { label: '브래킷 반경 BR',    value: c.bracketRadius,    unit: 'mm' },
    { label: '브래킷 두께 BT',    value: c.bracketThickness, unit: 'mm' },
    { label: '유효 하중 높이 L',  value: c.loadHeight,       unit: 'mm' },
    { label: '수평 하중 FH',      value: fmt(c.forceHorizontal, 1), unit: 'N' },
    { label: '수직 하중 FV',      value: fmt(c.forceVertical, 1),   unit: 'N' },
    { label: '단면적 A',          value: fmt(c.area),        unit: 'mm²' },
    { label: '단면 2차 모멘트 I', value: c.momentOfInertia != null ? Number(c.momentOfInertia).toExponential(3) : '-', unit: 'mm⁴' },
    { label: '단면계수 Z',        value: fmt(c.sectionModulus), unit: 'mm³' },
    { label: '굽힘 응력 σ_b',    value: fmt(c.maxBendingStress),    unit: 'MPa' },
    { label: '축 응력 σ_a',      value: fmt(c.maxAxialStress),      unit: 'MPa' },
    { label: '등가 응력 σ_eq',   value: fmt(c.maxEquivalentStress), unit: 'MPa' },
    { label: '허용 응력',         value: c.allowableStress,  unit: 'MPa' },
    { label: '실제 처짐 δ',      value: fmt(c.displacement),        unit: 'mm' },
    { label: '허용 처짐',         value: fmt(c.maxDisplacement),     unit: 'mm' },
  ];
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-2 animate-fade-in-up">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map(r => (
          <div key={r.label} className="bg-white border border-slate-100 rounded-lg px-3 py-2">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide truncate">{r.label}</p>
            <p className="text-sm font-extrabold text-slate-700">
              {r.value} <span className="text-[10px] text-slate-400 font-medium">{r.unit}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 후보 테이블 (1단/2단 공용)
// ─────────────────────────────────────────────

const CandidateTable = ({ result, selectedRank, setSelectedRank, on2danSelect }) => {
  const passCount = result?.candidates?.filter(c => c.stressOk && c.displacementOk).length ?? 0;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-3 flex items-center justify-between">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Weight size={14} className="text-white" /> 파이프 후보 목록
        </h3>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
          passCount > 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'
        }`}>
          {passCount > 0 ? `${passCount}개 적합` : '적합 후보 없음'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-gray-100">
              <th className="px-4 py-3 font-bold text-center w-14">Rank</th>
              <th className="px-4 py-3 font-bold text-center">OD (mm)</th>
              <th className="px-4 py-3 font-bold text-center">T (mm)</th>
              <th className="px-4 py-3 font-bold text-right">σ_eq (MPa)</th>
              <th className="px-4 py-3 font-bold text-center text-slate-300">/ 200</th>
              <th className="px-4 py-3 font-bold text-right">δ (mm)</th>
              <th className="px-4 py-3 font-bold text-center">/ 허용</th>
              <th className="px-4 py-3 font-bold text-center">응력</th>
              <th className="px-4 py-3 font-bold text-center">처짐</th>
              {on2danSelect && <th className="px-4 py-3 font-bold text-center">2단</th>}
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {result.candidates?.map(c => {
              const isSelected = selectedRank === c.rank;
              const isPass = c.stressOk && c.displacementOk;
              return (
                <React.Fragment key={c.rank}>
                  <tr
                    onClick={() => setSelectedRank(isSelected ? null : c.rank)}
                    className={`transition-colors cursor-pointer group ${
                      isSelected ? 'bg-indigo-50'
                      : isPass ? 'hover:bg-emerald-50/40'
                      : 'hover:bg-red-50/30 opacity-60'
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      {c.rank === 1 && isPass
                        ? <span className="inline-flex items-center justify-center w-7 h-7 bg-indigo-600 text-white text-xs font-extrabold rounded-full shadow">1</span>
                        : <span className="text-slate-500 font-bold">{c.rank}</span>}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-700">{c.outerDiameter}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{c.thickness}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(c.maxEquivalentStress, 1)}</td>
                    <td className="px-4 py-3 text-center text-slate-300 text-xs">/ 200</td>
                    {/* displacement = 실제 δ, maxDisplacement = 허용 */}
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(c.displacement, 1)}</td>
                    <td className="px-4 py-3 text-center text-slate-500 text-xs">/ {fmt(c.maxDisplacement, 1)}</td>
                    <td className="px-4 py-3 text-center"><OkBadge ok={c.stressOk} /></td>
                    <td className="px-4 py-3 text-center"><OkBadge ok={c.displacementOk} /></td>
                    {on2danSelect && (
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => on2danSelect(c)}
                          className="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          선택
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <ChevronRight
                        size={16}
                        className={`text-slate-300 group-hover:text-indigo-500 transition-all ${isSelected ? 'rotate-90 text-indigo-500' : ''}`}
                      />
                    </td>
                  </tr>
                  {isSelected && (
                    <tr>
                      <td colSpan={on2danSelect ? 11 : 10} className="px-4 pb-3">
                        <CandidateDetail c={c} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 bg-slate-50 border-t border-gray-100 text-[11px] text-slate-400">
        * 단면적(A) 오름차순 정렬 — Rank 1이 기준 만족 최경량 파이프 &nbsp;|&nbsp; 행 클릭 시 상세 치수 확인
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

const EMPTY_1DAN = { jh: '990', jb: '670', wj: '14500', ww: '1200', wc: '3000', lj: '12074', lw: '4604', lc: '2478', lr: '22100', h1: '9029', h4: '4111', pw: '288' };
const EMPTY_2DAN = { h2: '2454', h3: '1000', d1: '762', t1: '7.9' };

export default function JibRestAssessment() {
  const { setCurrentMenu } = useNavigation();
  const [activeTab, setActiveTab] = useState('1dan');
  const [inputs1dan, setInputs1dan] = useState(EMPTY_1DAN);
  const [inputs2dan, setInputs2dan] = useState(EMPTY_2DAN);
  const [result1dan, setResult1dan] = useState(null);
  const [result2dan, setResult2dan] = useState(null);
  const [selected1danCandidate, setSelected1danCandidate] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRank1, setSelectedRank1] = useState(null);
  const [selectedRank2, setSelectedRank2] = useState(null);
  const [showRefImg, setShowRefImg] = useState(false);
  const [refImgTab, setRefImgTab] = useState('jib_crane');
  const [showFormulas, setShowFormulas] = useState(false);

  const getEmployeeId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').employee_id || 'unknown'; }
    catch { return 'unknown'; }
  };

  const setField1 = (key) => (val) => setInputs1dan(prev => ({ ...prev, [key]: val }));
  const setField2 = (key) => (val) => setInputs2dan(prev => ({ ...prev, [key]: val }));

  const isValid1dan = Object.values(inputs1dan).every(v => v !== '' && Number(v) > 0);
  const isValid2dan = isValid1dan && Object.values(inputs2dan).every(v => v !== '' && Number(v) > 0);

  const handleCalculate1dan = async () => {
    setIsLoading(true);
    setError(null);
    setResult1dan(null);
    setSelectedRank1(null);
    try {
      const payload = {};
      Object.entries(inputs1dan).forEach(([k, v]) => { payload[k] = parseFloat(v); });
      payload.employee_id = getEmployeeId();
      const res = await axios.post(`${API_BASE_URL}/api/davit/jib-rest-1dan`, payload);
      setResult1dan(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalculate2dan = async () => {
    setIsLoading(true);
    setError(null);
    setResult2dan(null);
    setSelectedRank2(null);
    try {
      const payload = {};
      Object.entries(inputs1dan).forEach(([k, v]) => { payload[k] = parseFloat(v); });
      Object.entries(inputs2dan).forEach(([k, v]) => { payload[k] = parseFloat(v); });
      payload.employee_id = getEmployeeId();
      const res = await axios.post(`${API_BASE_URL}/api/davit/jib-rest-2dan`, payload);
      setResult2dan(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handle2danSelect = (candidate) => {
    setSelected1danCandidate(candidate);
    setInputs2dan(prev => ({
      ...prev,
      d1: String(candidate.outerDiameter),
      t1: String(candidate.thickness),
    }));
    setActiveTab('2dan');
    setResult2dan(null);
    setSelectedRank2(null);
  };

  const activeResult = activeTab === '1dan' ? result1dan : result2dan;
  const activeLoads = activeResult?.loads;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-[#002554] via-indigo-900 to-indigo-700 overflow-hidden">
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
                <TableProperties size={18} className="text-indigo-300" />
                Jib Rest Assessment
              </h1>
              <p className="text-sm text-indigo-200/80 mt-0.5">Jib Rest 구조물의 1단/2단 파이프 설계 후보를 LR Rule 기준으로 산출합니다.</p>
            </div>
          </div>
          <GuideButton guideTitle="[파라메트릭] Jib Rest Assessment — 1단/2단 파이프 설계" variant="dark" />
        </div>
      </div>

      {/* 1단/2단 탭 */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {[
          { id: '1dan', label: '1단 계산' },
          { id: '2dan', label: '2단 계산' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setError(null); }}
            className={`px-6 py-2.5 text-sm font-bold rounded-t-lg border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab.label}
            {tab.id === '2dan' && selected1danCandidate && (
              <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">
                D1={selected1danCandidate.outerDiameter}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 참조 그림 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowRefImg(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2"><ImageIcon size={16} className="text-slate-400" /> 참조 그림</span>
          {showRefImg ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showRefImg && (
          <div className="border-t border-gray-100">
            {/* 내부 탭 */}
            <div className="flex gap-1 px-6 pt-4">
              {[
                { id: 'jib_crane', label: 'Jib Crane' },
                { id: 'jib_rest',  label: 'Jib Rest' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setRefImgTab(t.id)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    refImgTab === t.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-6">
              <img
                src={refImgTab === 'jib_rest' ? jibRestRef : jibCraneRef}
                alt={refImgTab === 'jib_rest' ? 'Jib Rest 참조 도면' : 'Jib Crane 참조 도면'}
                className="w-full rounded-lg object-contain"
              />
            </div>
          </div>
        )}
      </div>

      {/* 계산 수식 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setShowFormulas(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2"><BarChart3 size={16} className="text-slate-400" /> 계산 수식</span>
          {showFormulas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showFormulas && (
          <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 text-sm">
            {/* 하중 계산 */}
            <div>
              <p className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mb-3">하중 계산 (Load Tab)</p>
              <div className="space-y-2.5">
                {[
                  ['투영 면적', 'JA = JH × 2 × LJ', 'mm²'],
                  ['형상계수 Cf', 'b/d 비율 → 선형 보간', '—'],
                  ['풍하중', 'Fwind = q × JA × Cf', 'kg'],
                  ['수평 하중', 'FH = (WW·LW + WC·LC\n  + WJ·LJ·FHF + Fwind·LJ)\n  / LR × 0.5', 'kg'],
                  ['수직 하중', 'FV = (WW·LW + WC·LC\n  + WJ·LJ) × FVF / LR', 'kg'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5 whitespace-pre-line">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 브래킷 · 유효 높이 */}
            <div>
              <p className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mb-3">브래킷 · 유효 높이</p>
              <div className="space-y-2.5">
                {[
                  ['브래킷 높이', 'BH = ⌈H1 / 350⌉ × 50', 'mm'],
                  ['브래킷 폭', 'BB = BH / 2', 'mm'],
                  ['브래킷 반경', 'BR = 3 × BB', 'mm'],
                  ['유효 높이 (1단)', 'L₁ = H1 − BH / 5', 'mm'],
                  ['유효 높이 (2단)', 'L₂ = H2', 'mm'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 응력 검토 */}
            <div>
              <p className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mb-3">응력 검토 (Solver)</p>
              <div className="space-y-2.5">
                {[
                  ['수평 하중 (N)', 'Fh = FH·9.8 + PW·9.8·FHF·(H4/H1)', 'N'],
                  ['수직 하중 (N)', 'Fz = FV·9.8 + PW·9.8·FVF', 'N'],
                  ['굽힘 응력', 'σ_b = Fh × L / Z', 'MPa'],
                  ['축 응력', 'σ_a = Fz / A', 'MPa'],
                  ['등가 응력', 'σ_eq = σ_b + σ_a ≤ 200', 'MPa'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 단면 특성 · 처짐 */}
            <div>
              <p className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mb-3">단면 특성 · 처짐</p>
              <div className="space-y-2.5">
                {[
                  ['단면적', 'A = π/4 × (D² − d²)', 'mm²'],
                  ['단면 2차 모멘트', 'I = π/64 × (D⁴ − d⁴)', 'mm⁴'],
                  ['단면계수', 'Z = I / (D/2)', 'mm³'],
                  ['처짐', 'δ = Fh × L³ / (3EI)', 'mm'],
                  ['허용 처짐 (1단)', 'δ ≤ H1 / 125', '—'],
                  ['허용 처짐 (2단)', 'δ ≤ H2 / 125', '—'],
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
      </div>

      {/* 2열 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">

        {/* 좌측: 입력 패널 */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-6 py-3">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">입력 조건</h2>
            </div>
            <div className="p-6 space-y-4">
            {/* 1단 공통 입력 */}
            <GroupLabel>치수</GroupLabel>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="JH — Jib 높이" value={inputs1dan.jh} onChange={setField1('jh')} unit="mm" placeholder="990" />
              <InputField label="JB — Jib 폭" value={inputs1dan.jb} onChange={setField1('jb')} unit="mm" placeholder="670" />
            </div>

            <GroupLabel>자중</GroupLabel>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="WJ — Jib" value={inputs1dan.wj} onChange={setField1('wj')} unit="kg" placeholder="14500" />
              <InputField label="WW — 윈치+받침대" value={inputs1dan.ww} onChange={setField1('ww')} unit="kg" placeholder="1200" />
              <InputField label="WC — 실린더" value={inputs1dan.wc} onChange={setField1('wc')} unit="kg" placeholder="3000" />
              <InputField label="PW — 플랫폼" value={inputs1dan.pw} onChange={setField1('pw')} unit="kg" placeholder="288" />
            </div>

            <GroupLabel>모멘트 팔</GroupLabel>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="LJ — Jib" value={inputs1dan.lj} onChange={setField1('lj')} unit="mm" placeholder="12074" />
              <InputField label="LW — 윈치" value={inputs1dan.lw} onChange={setField1('lw')} unit="mm" placeholder="4604" />
              <InputField label="LC — 실린더" value={inputs1dan.lc} onChange={setField1('lc')} unit="mm" placeholder="2478" />
              <InputField label="LR — Jib Rest" value={inputs1dan.lr} onChange={setField1('lr')} unit="mm" placeholder="22100" />
            </div>

            <GroupLabel>높이</GroupLabel>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="H1 — 전체 높이" value={inputs1dan.h1} onChange={setField1('h1')} unit="mm" placeholder="9029" />
              <InputField label="H4 — 플랫폼 높이" value={inputs1dan.h4} onChange={setField1('h4')} unit="mm" placeholder="4111" />
            </div>

            {/* 2단 추가 입력 */}
            {activeTab === '2dan' && (
              <>
                <div className="border-t border-dashed border-indigo-200 pt-4 mt-2">
                  <GroupLabel>2단 추가 입력</GroupLabel>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="H2 — 상단 파이프 높이" value={inputs2dan.h2} onChange={setField2('h2')} unit="mm" placeholder="2454" />
                    <InputField label="H3 — Reducer 높이" value={inputs2dan.h3} onChange={setField2('h3')} unit="mm" placeholder="1000" />
                    <InputField
                      label="D1 — 하단 외경"
                      value={inputs2dan.d1} onChange={setField2('d1')} unit="mm" placeholder="762"
                      readOnly={!!selected1danCandidate}
                    />
                    <InputField
                      label="T1 — 하단 두께"
                      value={inputs2dan.t1} onChange={setField2('t1')} unit="mm" placeholder="7.9"
                      readOnly={!!selected1danCandidate}
                    />
                  </div>
                  {selected1danCandidate && (
                    <p className="text-[11px] text-indigo-500 mt-2">
                      ✓ 1단 Rank {selected1danCandidate.rank} 선택됨 — D1/T1 자동 입력
                      <button
                        onClick={() => { setSelected1danCandidate(null); setInputs2dan(prev => ({ ...prev, d1: '', t1: '' })); }}
                        className="ml-2 text-slate-400 hover:text-red-500 cursor-pointer underline"
                      >
                        초기화
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}

            <button
              onClick={activeTab === '1dan' ? handleCalculate1dan : handleCalculate2dan}
              disabled={!(activeTab === '1dan' ? isValid1dan : isValid2dan) || isLoading}
              className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all mt-2 ${
                (activeTab === '1dan' ? isValid1dan : isValid2dan) && !isLoading
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading
                ? <><Loader2 size={18} className="animate-spin" /> 계산 중...</>
                : <><Calculator size={18} /> {activeTab === '1dan' ? '1단 Calculate' : '2단 Calculate'}</>}
            </button>
            </div>
          </div>

          {/* 계산 기준 */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-gray-100 text-sm space-y-1.5">
              {[
                ['탄성계수', 'E = 206,000 MPa (강재)'],
                ['허용 등가 응력', '200 MPa'],
                ['허용 처짐 (1단)', 'H1 / 125'],
                ['허용 처짐 (2단)', 'H2 / 125'],
                ['풍속 기준', 'vs = 63 m/s (LR Rule)'],
                ['횡경사', '30°'],
                ['파이프 카탈로그', '45종 (OD 267.4 ~ 1016.4 mm)'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-slate-400 font-medium shrink-0 text-xs">{k}</span>
                  <span className="font-bold text-slate-700 text-right text-xs">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우측: 결과 패널 */}
        <div className="space-y-5">

          {!activeResult && !error && !isLoading && (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 flex flex-col items-center text-slate-400 text-center">
              <div className="p-5 bg-slate-50 rounded-full mb-4">
                <TableProperties size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">
                {activeTab === '1dan'
                  ? '입력값을 입력하고 1단 Calculate를 실행하세요.'
                  : result1dan
                    ? '2단 추가 입력을 완료하고 2단 Calculate를 실행하세요.'
                    : '1단 계산을 먼저 수행하고 후보를 선택해 주세요.'}
              </p>
            </div>
          )}

          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center text-slate-400">
              <Loader2 size={40} className="animate-spin text-indigo-500 mb-4" />
              <p className="font-bold text-slate-600">파이프 후보를 계산하는 중입니다...</p>
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

          {activeResult && (
            <>
              {/* JSON 다운로드 */}
              {(() => {
                const tag = activeTab === '1dan' ? '1dan' : '2dan';
                const inputData = activeTab === '1dan'
                  ? Object.fromEntries(Object.entries(inputs1dan).map(([k, v]) => [k, parseFloat(v)]))
                  : { ...Object.fromEntries(Object.entries(inputs1dan).map(([k, v]) => [k, parseFloat(v)])),
                      ...Object.fromEntries(Object.entries(inputs2dan).map(([k, v]) => [k, parseFloat(v)])) };
                return (
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-3 flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">다운로드</span>
                    <button
                      onClick={() => downloadJson(inputData, `jib_rest_${tag}_input.json`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      <Download size={13} /> 입력 JSON
                    </button>
                    <button
                      onClick={() => downloadJson(activeResult, `jib_rest_${tag}_result.json`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      <Download size={13} /> 결과 JSON
                    </button>
                  </div>
                );
              })()}

              {/* 풍하중 카드 */}
              {activeLoads && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
                  <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-4">
                    <Wind size={16} className="text-indigo-500" /> 풍하중 계산 결과
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <LoadCard label="형상계수 Cf" value={fmt(activeLoads.cf, 3)} unit="—" />
                    <LoadCard label="풍하중 Fwind" value={fmt(activeLoads.fwindKg, 0)} unit="kg" />
                    <LoadCard label="수평 하중 FH" value={fmt(activeLoads.fHKg, 0)} unit="kg" />
                    <LoadCard label="수직 하중 FV" value={fmt(activeLoads.fVKg, 0)} unit="kg" />
                  </div>
                </div>
              )}

              <CandidateTable
                result={activeResult}
                selectedRank={activeTab === '1dan' ? selectedRank1 : selectedRank2}
                setSelectedRank={activeTab === '1dan' ? setSelectedRank1 : setSelectedRank2}
                on2danSelect={activeTab === '1dan' ? handle2danSelect : null}
              />
            </>
          )}
        </div>
      </div>
      <SolverCredit contributor="박준석" />
    </div>
  );
}
