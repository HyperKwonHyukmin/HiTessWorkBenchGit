import React, { useState } from 'react';
import axios from 'axios';
import {
  SlidersHorizontal, Calculator, ChevronDown, ChevronUp,
  AlertCircle, Loader2, Ruler, BarChart3, ArrowLeft, Activity
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import SolverCredit from '../../components/ui/SolverCredit';

const MEMBER_GROUPS = [
  {
    label: 'H형강',
    members: ['H200x200', 'H200x204', 'H295x302', 'H300x300', 'H300x305'],
  },
  {
    label: 'Pipe',
    members: [
      '150A PIPE (#40)', '150A PIPE (#60)',
      '200A PIPE (#40)', '200A PIPE (#60)',
      '250A PIPE (#40)', '250A PIPE (#60)',
      '300A PIPE',
      '400A PIPE (#40)', '400A PIPE (#60)',
    ],
  },
  {
    label: 'I.A 단면',
    members: [
      '150 I.A (150x90x9/12)',
      '200 I.A (200x90x9/14)',
      '250 I.A (250x90x10/15)',
    ],
  },
  {
    label: 'I형강',
    members: ['I400x150x12.5x25', 'I350x150x12x24', 'I350x150x9x15'],
  },
];

const InputField = ({ label, desc, value, onChange, unit, placeholder, min }) => (
  <div>
    <label className="block text-sm font-bold text-slate-700 mb-1">{label}</label>
    {desc && <p className="text-[11px] text-slate-400 mb-1.5">{desc}</p>}
    <div className="flex items-center border-2 border-slate-200 rounded-xl overflow-hidden focus-within:border-violet-500 transition-colors bg-white">
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        className="flex-1 px-4 py-3 text-sm font-bold text-slate-800 outline-none bg-transparent"
      />
      <span className="px-4 py-3 bg-slate-50 text-slate-500 text-sm font-bold border-l border-slate-200">{unit}</span>
    </div>
  </div>
);

const PropCell = ({ label, value, unit }) => (
  <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide truncate">{label}</p>
    <p className="text-sm font-extrabold text-slate-700">
      {value ?? '-'} {unit && <span className="text-[10px] text-slate-400 font-medium">{unit}</span>}
    </p>
  </div>
);

export default function ColumnBucklingCalculator() {
  const { setCurrentMenu } = useNavigation();
  const [memberName, setMemberName] = useState('300A PIPE');
  const [lengthMm, setLengthMm] = useState('4470');
  const [eccentricityPct, setEccentricityPct] = useState('25');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showIntermediate, setShowIntermediate] = useState(false);

  const isValid =
    memberName.trim() !== '' &&
    lengthMm !== '' && Number(lengthMm) > 0 &&
    eccentricityPct !== '' && Number(eccentricityPct) >= 0;

  const getEmployeeId = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').employee_id || 'unknown'; }
    catch { return 'unknown'; }
  };

  const handleCalculate = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/column-buckling/calculate`, {
        member_name: memberName,
        length_mm: parseFloat(lengthMm),
        eccentricity_ratio: parseFloat(eccentricityPct) / 100,
        employee_id: getEmployeeId(),
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail ?? '계산 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const inp = result?.input ?? {};
  const mp = result?.memberProfile ?? {};
  const iv = result?.intermediateValues ?? {};
  const res = result?.result ?? {};
  const isEccentric = res.loadCase === 'eccentric';

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
                <SlidersHorizontal size={18} className="text-violet-300" />
                Column Buckling Load Calculator
              </h1>
              <p className="text-sm text-violet-200/80 mt-0.5">AISC 기준 핀-핀 기둥의 최대 허용 사용하중을 산출합니다. (동심·편심 하중 지원)</p>
            </div>
          </div>
          <GuideButton guideTitle="[파라메트릭] Column Buckling Load Calculator" variant="dark" />
        </div>
      </div>

      {/* 계산 수식 */}
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

            <div>
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">편심량 (e)</p>
              <div className="space-y-2.5">
                {[
                  ['일반 단면', 'e = 편심비율 × (B / 2)', 'mm'],
                  ['I.A 단면', 'e = 편심비율 × (RefDim − c_y)', 'mm'],
                  ['비고', 'I.A 단면은 비대칭 → 도심 보정', '—'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">좌굴 임계응력</p>
              <div className="space-y-2.5">
                {[
                  ['Euler 탄성 좌굴', 'Fe = π²EI / (L²A)', 'MPa'],
                  ['세장비 한계', 'λ = 4.71√(E/Fy)', '—'],
                  ['비탄성 (KL/r ≤ λ)', 'Fcr = 0.658^(Fy/Fe) × Fy', 'MPa'],
                  ['탄성 (KL/r > λ)', 'Fcr = 0.877 × Fe', 'MPa'],
                ].map(([name, expr, unit]) => (
                  <div key={name} className="bg-slate-50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">{name}</p>
                    <p className="font-mono text-slate-700 font-bold text-xs mt-0.5">{expr} <span className="text-slate-400 font-normal">[{unit}]</span></p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest mb-3">허용 사용하중</p>
              <div className="space-y-2.5">
                {[
                  ['동심 하중 (e=0)', 'P = Fcr × A / (SF × 9810)', 'ton'],
                  ['편심 하중 (e>0)', 'Secant Formula 반복법', 'ton'],
                  ['Secant σ_max', 'P/A × (1 + Ae/Z × sec(L/2r × √(P/AE)))', 'MPa'],
                  ['만족 조건', 'σ_max ≤ Fy', '—'],
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

              {/* 부재 선택 */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">단면 부재명</label>
                <p className="text-[11px] text-slate-400 mb-1.5">PropertyRefer.txt 등록 단면 중 선택</p>
                <select
                  value={memberName}
                  onChange={e => setMemberName(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-800 bg-white focus:outline-none focus:border-violet-500 transition-colors cursor-pointer"
                >
                  {MEMBER_GROUPS.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.members.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <InputField
                label="기둥 길이"
                desc="핀-핀 경계 조건 기준 유효 기둥 길이"
                value={lengthMm}
                onChange={setLengthMm}
                unit="mm"
                placeholder="예: 4470"
                min={1}
              />

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">편심 비율</label>
                <p className="text-[11px] text-slate-400 mb-1.5">0이면 순수 압축, 0 초과면 Secant Formula 적용</p>
                <div className="flex items-center border-2 border-slate-100 rounded-xl overflow-hidden bg-slate-50">
                  <input
                    type="number"
                    value={eccentricityPct}
                    readOnly
                    className="flex-1 px-4 py-3 text-sm font-bold text-slate-400 outline-none bg-transparent cursor-not-allowed"
                  />
                  <span className="px-4 py-3 bg-slate-100 text-slate-400 text-sm font-bold border-l border-slate-200">%</span>
                </div>
              </div>

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

          {/* 계산 기준 요약 */}
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
                  ['설계 기준', 'AISC'],
                  ['탄성계수 E', '210,000 MPa'],
                  ['항복응력 Fy', '240 MPa'],
                  ['안전율 SF', '3.0'],
                  ['경계 조건 K', '1.0 (핀-핀)'],
                  ['환산 상수', '9,810 N/ton'],
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
                <SlidersHorizontal size={40} className="opacity-20" />
              </div>
              <p className="font-bold text-slate-500">입력값을 입력하고 Calculate를 실행하세요.</p>
              <p className="text-sm mt-1">부재명, 기둥 길이, 편심 비율을 입력하면 최대 허용 사용하중을 산출합니다.</p>
            </div>
          )}

          {isLoading && (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center text-slate-400">
              <Loader2 size={40} className="animate-spin text-violet-500 mb-4" />
              <p className="font-bold text-slate-600">허용 사용하중을 계산하는 중입니다...</p>
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
            <div className="space-y-4">

              {/* 메인 결과 카드 */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-violet-700 to-violet-600 px-6 py-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">최종 계산 결과</h3>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    isEccentric
                      ? 'bg-violet-100 text-violet-700 border-violet-200'
                      : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  }`}>
                    {isEccentric ? '편심 하중 (Secant Formula)' : '순수 압축 (AISC)'}
                  </span>
                </div>

                <div className="p-10 flex flex-col items-center justify-center">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">최대 허용 사용하중</p>
                  <div className="flex items-end gap-2">
                    <span className="text-6xl font-extrabold text-violet-700 tracking-tight">
                      {res.maxWorkingLoadTon?.toFixed(1)}
                    </span>
                    <span className="text-2xl font-bold text-slate-400 mb-2">ton</span>
                  </div>
                </div>
              </div>

              {/* 입력 정보 요약 */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-6 py-3 border-b border-gray-100">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">입력 정보 요약</h3>
                </div>
                <div className="p-5 grid grid-cols-3 gap-4">
                  <PropCell label="부재명"   value={inp.memberName}                                         unit="" />
                  <PropCell label="기둥 길이" value={inp.columnLengthMm?.toLocaleString()}                  unit="mm" />
                  <PropCell label="편심 비율" value={((inp.eccentricityRatio ?? 0) * 100).toFixed(1)}       unit="%" />
                </div>
              </div>

              {/* 단면 제원 */}
              {mp.areaMm2 != null && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="bg-slate-50 px-6 py-3 border-b border-gray-100">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">단면 제원</h3>
                  </div>
                  <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <PropCell label="단면적 A"     value={mp.areaMm2?.toLocaleString()}              unit="mm²" />
                    <PropCell label="관성모멘트 I"  value={mp.momentOfInertiaMm4?.toLocaleString()}   unit="mm⁴" />
                    <PropCell label="회전반경 r"    value={mp.radiusOfGyrationMm?.toFixed(2)}         unit="mm" />
                    <PropCell label="단면계수 Z"    value={mp.sectionModulusMm3?.toLocaleString()}    unit="mm³" />
                  </div>
                </div>
              )}

              {/* 중간 계산값 */}
              {result.intermediateValues && (
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setShowIntermediate(v => !v)}
                    className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Activity size={16} className="text-slate-400" /> 중간 계산값
                    </span>
                    {showIntermediate
                      ? <ChevronUp size={16} className="text-slate-400" />
                      : <ChevronDown size={16} className="text-slate-400" />}
                  </button>
                  {showIntermediate && (
                    <div className="border-t border-gray-100 p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
                      {iv.slendernessRatio != null && (
                        <PropCell label="세장비 KL/r"   value={iv.slendernessRatio?.toFixed(2)}   unit="—" />
                      )}
                      {iv.slendernessLimit != null && (
                        <PropCell label="세장비 한계 λ"  value={iv.slendernessLimit?.toFixed(2)}   unit="—" />
                      )}
                      {iv.eulerStressFe != null && (
                        <PropCell label="탄성 좌굴 Fe"   value={iv.eulerStressFe?.toFixed(2)}      unit="MPa" />
                      )}
                      {iv.criticalStressFcr != null && (
                        <PropCell label="임계응력 Fcr"   value={iv.criticalStressFcr?.toFixed(2)}  unit="MPa" />
                      )}
                      {iv.eccentricityMm != null && (
                        <PropCell label="편심량 e"       value={iv.eccentricityMm?.toFixed(2)}     unit="mm" />
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      <SolverCredit contributor="김병훈" />
    </div>
  );
}
