import React, { useState } from 'react';
import axios from 'axios';
import {
  TableProperties, Calculator, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, AlertCircle, Loader2,
  Ruler, Weight, BarChart3, ChevronRight, ImageIcon, Download, ArrowLeft
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import mastPostRef from '../../assets/images/mast_post_reference.png';
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
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold"><CheckCircle2 size={11}/> OK</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 border border-red-200 rounded-full text-[10px] font-bold"><XCircle size={11}/> NG</span>;

const InputField = ({ label, desc, value, onChange, unit, placeholder }) => (
  <div>
    <label className="block text-sm font-bold text-slate-700 mb-1">{label}</label>
    {desc && <p className="text-[11px] text-slate-400 mb-1.5">{desc}</p>}
    <div className="flex items-center border-2 border-slate-200 rounded-xl overflow-hidden focus-within:border-violet-500 transition-colors bg-white">
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-4 py-3 text-sm font-bold text-slate-800 outline-none bg-transparent"
      />
      <span className="px-4 py-3 bg-slate-50 text-slate-500 text-sm font-bold border-l border-slate-200">{unit}</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// 후보 상세 패널 (행 클릭 시 인라인 확장)
// 실제 JSON 필드명 기준:
//   maxDisplacement = 실제 처짐 δ
//   allowableDisplacement = 허용 처짐
// ─────────────────────────────────────────────

const CandidateDetail = ({ c }) => {
  const rows = [
    { label: '브래킷 높이 BH',     value: c.bracketHeight,      unit: 'mm'  },
    { label: '브래킷 폭 BB',       value: c.bracketBreadth,     unit: 'mm'  },
    { label: '브래킷 반경 BR',     value: c.bracketRadius,      unit: 'mm'  },
    { label: '브래킷 두께 BT',     value: c.bracketThickness,   unit: 'mm'  },
    { label: 'Post 자중',          value: fmt(c.postWeight, 1), unit: 'kg'  },
    { label: '유효 하중 높이 L',   value: c.loadHeight,         unit: 'mm'  },
    { label: '수평 하중 FH',       value: fmt(c.forceHorizontal, 1), unit: 'N' },
    { label: '수직 하중 FV',       value: fmt(c.forceVertical, 1),   unit: 'N' },
    { label: '굽힘 모멘트 M',      value: c.bendingMoment != null ? Number(c.bendingMoment).toExponential(3) : '-', unit: 'N·mm' },
    { label: '단면적 A',           value: fmt(c.area),          unit: 'mm²' },
    { label: '단면 2차 모멘트 I',  value: c.momentOfInertia != null ? Number(c.momentOfInertia).toExponential(3) : '-', unit: 'mm⁴' },
    { label: '단면계수 Z',         value: fmt(c.sectionModulus),unit: 'mm³' },
    { label: '굽힘 응력 σ_b',     value: fmt(c.maxBendingStress),   unit: 'MPa' },
    { label: '축 응력 σ_a',       value: fmt(c.maxAxialStress),     unit: 'MPa' },
    { label: '등가 응력 σ_eq',    value: fmt(c.maxEquivalentStress),unit: 'MPa' },
    { label: '허용 응력',          value: c.allowableStress,    unit: 'MPa' },
    { label: '실제 처짐 δ',       value: fmt(c.maxDisplacement),    unit: 'mm'  },
    { label: '허용 처짐',          value: fmt(c.allowableDisplacement), unit: 'mm' },
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
// 메인
// ─────────────────────────────────────────────

export default function MastPostAssessment() {
  const { setCurrentMenu } = useNavigation();
  const [heightMm, setHeightMm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRank, setSelectedRank] = useState(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showRefImg, setShowRefImg] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);

  const isValid = heightMm !== '' && weightKg !== '' && Number(heightMm) > 0 && Number(weightKg) > 0;

  const getEmployeeId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').employee_id || 'unknown'; }
    catch { return 'unknown'; }
  };

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    setSelectedRank(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/davit/mast-post`, {
        height_mm: parseFloat(heightMm),
        weight_kg: parseFloat(weightKg),
        employee_id: getEmployeeId(),
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const passCount = result?.candidates?.filter(c => c.stressOk && c.displacementOk).length ?? 0;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-[#002554] via-violet-900 to-violet-700 overflow-hidden">
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
                <TableProperties size={18} className="text-violet-300" />
                Mast Post Assessment
              </h1>
              <p className="text-sm text-violet-200/80 mt-0.5">Post 높이와 플랫폼 하중을 입력하여 LR Rule 기준 최적 파이프 후보를 산출합니다.</p>
            </div>
          </div>
          <GuideButton guideTitle="[파라메트릭] Mast Post Assessment — Post 파이프 자동 선정" variant="dark" />
        </div>
      </div>


      {/* 참조 그림 — 전체 너비 */}
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
          <div className="border-t border-gray-100 p-6">
            <img
              src={mastPostRef}
              alt="Mast Post 참조 도면"
              className="w-full rounded-lg object-contain"
            />
          </div>
        )}
      </div>

      {/* 계산 수식 — 전체 너비 */}
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
        {showFormulas && (
          <div className="border-t border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">

            {/* 브래킷 & 하중 높이 */}
            <div>
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">브래킷 · 유효 높이</p>
              <div className="space-y-2.5">
                {[
                  ['브래킷 높이', 'BH = ⌈H / 350⌉ × 50', 'mm'],
                  ['브래킷 폭', 'BB = BH / 2', 'mm'],
                  ['브래킷 반경', 'BR = 3 × BB', 'mm'],
                  ['유효 하중 높이', 'L = H₁ − BH / 5', 'mm'],
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
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">응력 검토</p>
              <div className="space-y-2.5">
                {[
                  ['굽힘 모멘트', 'M = F_H × L', 'N·mm'],
                  ['굽힘 응력', 'σ_b = M / Z', 'MPa'],
                  ['축 응력', 'σ_a = F_V / A', 'MPa'],
                  ['등가 응력', 'σ_eq = σ_b + σ_a', 'MPa'],
                  ['허용 조건', 'σ_eq ≤ 200 MPa', '—'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* 단면 특성 & 처짐 */}
            <div>
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">단면 특성 · 처짐</p>
              <div className="space-y-2.5">
                {[
                  ['단면적', 'A = π/4 × (D² − d²)', 'mm²'],
                  ['단면 2차 모멘트', 'I = π/64 × (D⁴ − d⁴)', 'mm⁴'],
                  ['단면계수', 'Z = I / (D/2)', 'mm³'],
                  ['처짐', 'δ = F_H × L³ / (3EI)', 'mm'],
                  ['허용 조건', 'δ ≤ H₁ / 125', '—'],
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

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">

        {/* 좌측: 입력 패널 */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-violet-700 to-violet-600 px-6 py-3 flex items-center gap-2">
              <Ruler size={14} className="text-white" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">입력 조건</h2>
            </div>
            <div className="p-6 space-y-5">
            <InputField
              label="Post 전체 높이"
              desc="플랫폼 하단부터 Post 상단까지의 전체 높이"
              value={heightMm} onChange={setHeightMm} unit="mm" placeholder="예: 5000"
            />
            <InputField
              label="플랫폼 하중"
              desc="플랫폼에 작용하는 총 중량 (자중 포함)"
              value={weightKg} onChange={setWeightKg} unit="kg" placeholder="예: 200"
            />
            <button
              onClick={handleCalculate}
              disabled={!isValid || isLoading}
              className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                isValid && !isLoading
                  ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading
                ? <><Loader2 size={18} className="animate-spin" /> 계산 중...</>
                : <><Calculator size={18} /> Calculate</>}
            </button>
            </div>
          </div>

          {/* 계산 기준 */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowCriteria(v => !v)}
              className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2"><BarChart3 size={16} className="text-slate-400" /> 계산 기준 요약</span>
              {showCriteria ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {showCriteria && (
              <div className="px-6 pb-5 border-t border-gray-100 pt-3 space-y-1.5 text-sm">
                {[
                  ['탄성계수', 'E = 206,000 MPa (강재)'],
                  ['허용 등가 응력', '200 MPa'],
                  ['허용 처짐', 'H₁ / 125'],
                  ['풍속 기준', 'vs = 63 m/s (LR Rule)'],
                  ['횡경사', '30°'],
                  ['브래킷 높이', 'ROUNDUP(H/350, 0) × 50 mm'],
                  ['유효 하중 높이', 'L = H₁ − BH/5'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-slate-400 font-medium shrink-0">{k}</span>
                    <span className="font-bold text-slate-700 text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 우측: 결과 패널 */}
        <div className="space-y-5">

          {!result && !error && !isLoading && (
            <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 flex flex-col items-center text-slate-400 text-center">
              <div className="p-5 bg-slate-50 rounded-full mb-4">
                <TableProperties size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">입력값을 입력하고 Calculate를 실행하세요.</p>
              <p className="text-sm mt-1">Post 높이와 플랫폼 하중을 입력하면 최적 파이프 후보를 산출합니다.</p>
            </div>
          )}

          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center text-slate-400">
              <Loader2 size={40} className="animate-spin text-violet-500 mb-4" />
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

          {result && (
            <>
              {/* JSON 다운로드 */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-3 flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">다운로드</span>
                <button
                  onClick={() => downloadJson({ height_mm: parseFloat(heightMm), weight_kg: parseFloat(weightKg) }, 'mast_post_input.json')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={13} /> 입력 JSON
                </button>
                <button
                  onClick={() => downloadJson(result, 'mast_post_result.json')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Download size={13} /> 결과 JSON
                </button>
              </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-3 flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Weight size={14} className="text-white" /> 파이프 후보 목록
                </h3>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                  passCount > 0
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    : 'bg-red-100 text-red-700 border-red-200'
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
                              isSelected ? 'bg-violet-50'
                              : isPass ? 'hover:bg-emerald-50/40'
                              : 'hover:bg-red-50/30 opacity-60'
                            }`}
                          >
                            <td className="px-4 py-3 text-center">
                              {c.rank === 1 && isPass
                                ? <span className="inline-flex items-center justify-center w-7 h-7 bg-violet-600 text-white text-xs font-extrabold rounded-full shadow">1</span>
                                : <span className="text-slate-500 font-bold">{c.rank}</span>}
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-slate-700">{c.outerDiameter}</td>
                            <td className="px-4 py-3 text-center text-slate-600">{c.thickness}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(c.maxEquivalentStress, 1)}</td>
                            <td className="px-4 py-3 text-center text-slate-300 text-xs">/ 200</td>
                            {/* maxDisplacement = 실제 처짐 δ, allowableDisplacement = 허용 처짐 */}
                            <td className="px-4 py-3 text-right font-bold text-slate-700">{fmt(c.maxDisplacement, 1)}</td>
                            <td className="px-4 py-3 text-center text-slate-500 text-xs">/ {fmt(c.allowableDisplacement, 1)}</td>
                            <td className="px-4 py-3 text-center"><OkBadge ok={c.stressOk} /></td>
                            <td className="px-4 py-3 text-center"><OkBadge ok={c.displacementOk} /></td>
                            <td className="px-4 py-3 text-center">
                              <ChevronRight
                                size={16}
                                className={`text-slate-300 group-hover:text-violet-500 transition-all ${isSelected ? 'rotate-90 text-violet-500' : ''}`}
                              />
                            </td>
                          </tr>
                          {isSelected && (
                            <tr>
                              <td colSpan={10} className="px-4 pb-3">
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
            </>
          )}
        </div>
      </div>
      <SolverCredit contributor="박준석" />
    </div>
  );
}
