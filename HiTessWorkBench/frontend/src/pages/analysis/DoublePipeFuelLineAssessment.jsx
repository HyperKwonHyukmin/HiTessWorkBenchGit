import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ArrowRight, Box, CheckCircle2, Download, Filter, Info, Lock, ListChecks, Pipette, Play,
  RotateCcw, Send, Sliders, Table2, Terminal, Upload, X, Zap,
} from 'lucide-react';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import DoublePipeViewer from '../../components/analysis/DoublePipeViewer';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import SolverCredit from '../../components/ui/SolverCredit';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';

const PAGE_KEY = '이중관 구조 연료배관 해석';

const DEFAULT_FORM = {
  inner_pipe: {
    outDia: 114.3,
    thick: 3.05,
    bendR: 152.4,
  },
  ubolt: {
    mass: 0.2485,
  },
  load_conditions: {
    Pref: 15.3,
    DesignTemperature: 60,
    InitialTemperature: 45,
    FluidDensity: 0.00e-8,
    AccUX: 0.09,
    AccUY: 0.68,
    AccUZ: 0.45,
    Hogg: 0.44,
    Sagg: -0.34,
    Summer: 45,
    Winter: -18,
    Stiff: 1.75e12,
    FrictionFactor: 0.15,
  },
};

// 3단계 워크플로 — 순서 자체가 정보(설계 → 전체 Load Case 해석 → 선택 Load Case 재해석)이므로 번호를 부여한다.
const TABS = [
  {
    key: 'inner-support',
    label: 'Design Inner Support',
    shortLabel: 'Inner Support',
    icon: Sliders,
    statusLabel: '입력 준비됨',
  },
  {
    key: 'all-load-cases',
    label: 'Piping Stress Analysis',
    shortLabel: 'Stress Analysis',
    icon: ListChecks,
    statusLabel: 'Tab1 결과 대기',
    description: '1단계에서 생성한 내관 포함 배관 CSV를 배관응력 해석(Main.py) 파이프라인의 입력으로 넘겨 '
      + 'Abaqus 비마찰·마찰 반복 해석과 ASME B31.3 적합성 검토를 실행합니다. 3D 뷰어로 생성된 배관 모델과 '
      + 'UBOLT 지지점을 확인하고, 전체 29개 Load Case를 자동 해석합니다.',
  },
  {
    key: 'selected-load-cases',
    label: 'Report & Results',
    shortLabel: 'Report',
    icon: Filter,
    statusLabel: '개발 중',
    description: '선택 Load Case 해석 결과 중 특정 Load Case만 재검토하거나, '
      + 'Report for PSA.xlsx와 F06 결과 파일을 내려받는 화면으로 연결할 예정입니다.',
  },
];

// 29개 Load Case (Main.py / hmNastranBDF.py 의 SUBCASE 정의). L17(SUS)은 Allowable Stress 선행조건이라 항상 자동 포함.
const LOAD_CASES = [
  { id: 'L1', cat: 'OPE', label: 'W+P1+T1+D1' }, { id: 'L2', cat: 'OPE', label: 'W+P1+T1+D2' },
  { id: 'L3', cat: 'OPE', label: 'W+P1+T2+D1' }, { id: 'L4', cat: 'OPE', label: 'W+P1+T2+D2' },
  { id: 'L5', cat: 'OPE', label: 'W+P1+T1+D1+U1' }, { id: 'L6', cat: 'OPE', label: 'W+P1+T1+D1+U2' },
  { id: 'L7', cat: 'OPE', label: 'W+P1+T1+D1+U3' }, { id: 'L8', cat: 'OPE', label: 'W+P1+T1+D2+U1' },
  { id: 'L9', cat: 'OPE', label: 'W+P1+T1+D2+U2' }, { id: 'L10', cat: 'OPE', label: 'W+P1+T1+D2+U3' },
  { id: 'L11', cat: 'OPE', label: 'W+P1+T2+D1+U1' }, { id: 'L12', cat: 'OPE', label: 'W+P1+T2+D1+U2' },
  { id: 'L13', cat: 'OPE', label: 'W+P1+T2+D1+U3' }, { id: 'L14', cat: 'OPE', label: 'W+P1+T2+D2+U1' },
  { id: 'L15', cat: 'OPE', label: 'W+P1+T2+D2+U2' }, { id: 'L16', cat: 'OPE', label: 'W+P1+T2+D2+U3' },
  { id: 'L17', cat: 'SUS', label: 'W+P1', mandatory: true },
  { id: 'L18', cat: 'OCC', label: 'W+P1+U1+D1' }, { id: 'L19', cat: 'OCC', label: 'W+P1+U2+D1' },
  { id: 'L20', cat: 'OCC', label: 'W+P1+U3+D1' }, { id: 'L21', cat: 'OCC', label: 'W+P1+U1+D2' },
  { id: 'L22', cat: 'OCC', label: 'W+P1+U2+D2' }, { id: 'L23', cat: 'OCC', label: 'W+P1+U3+D2' },
  { id: 'L24', cat: 'EXP', label: 'T1+D1' }, { id: 'L25', cat: 'EXP', label: 'T1+D2' },
  { id: 'L26', cat: 'EXP', label: 'T2+D1' }, { id: 'L27', cat: 'EXP', label: 'T2+D2' },
  { id: 'L28', cat: 'EXP', label: 'T1+D1-D2' }, { id: 'L29', cat: 'EXP', label: 'T2+D1-D2' },
];

const CASE_CATS = [
  { cat: 'OPE', name: 'Operating', dot: 'bg-sky-500' },
  { cat: 'SUS', name: 'Sustained', dot: 'bg-amber-500' },
  { cat: 'OCC', name: 'Occasional', dot: 'bg-violet-500' },
  { cat: 'EXP', name: 'Expansion', dot: 'bg-emerald-500' },
];

// outDia/thick 은 실행 시 백엔드(append_offset.py 포팅본)가 Pipe_Dim 표준 규격으로 내부에서
// 스냅한다 — 스냅된 값은 결과 테이블에서 확인하며, 입력 단계에서는 자유 입력을 그대로 유지한다.
// UBOLT 질량(ubolt.mass)도 동일하게 내부 기본값(0.2485kg)만 사용하고 입력 필드로는 노출하지 않는다.
const INNER_PIPE_FIELDS = [
  { path: ['inner_pipe', 'outDia'], label: 'Out. Diameter', unit: 'mm' },
  { path: ['inner_pipe', 'thick'], label: 'Thickness', unit: 'mm' },
  { path: ['inner_pipe', 'bendR'], label: 'Bend Radius', unit: 'mm' },
  // 1.75e12 처럼 자릿수가 큰 값이라 일반 숫자 입력 대신 계수×10^지수 방식으로 받는다.
  { path: ['load_conditions', 'Stiff'], label: 'Support Stiffness', unit: 'N/mm', scientific: true },
];

const PSA_LOAD_FIELDS = [
  { path: ['load_conditions', 'Pref'], label: 'Design Pressure', unit: 'barG' },
  { path: ['load_conditions', 'DesignTemperature'], label: 'Design Temperature', unit: 'degC' },
  { path: ['load_conditions', 'InitialTemperature'], label: 'Initial Temperature', unit: 'degC' },
  { path: ['load_conditions', 'FluidDensity'], label: 'Fluid Density', unit: 'kg/mm3' },
  { path: ['load_conditions', 'AccUX'], label: 'Acceleration Ux', unit: 'g' },
  { path: ['load_conditions', 'AccUY'], label: 'Acceleration Uy', unit: 'g' },
  { path: ['load_conditions', 'AccUZ'], label: 'Acceleration Uz', unit: 'g' },
  { path: ['load_conditions', 'Hogg'], label: 'Hull Deflection (Hogg)', unit: 'mm' },
  { path: ['load_conditions', 'Sagg'], label: 'Hull Deflection (Sagg)', unit: 'mm' },
  { path: ['load_conditions', 'Summer'], label: 'Summer', unit: 'degC' },
  { path: ['load_conditions', 'Winter'], label: 'Winter', unit: 'degC' },
  { path: ['load_conditions', 'FrictionFactor'], label: 'Friction Factor', unit: '' },
];

const LOG_COLORS = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-sky-400',
};

// 결과 테이블에서 배관 부재 type 을 색상 배지로 구분 — 가장 자주 스캔하는 열이라 색으로 즉시 식별되게 한다.
const TYPE_STYLES = {
  TUBI: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  ELBO: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  BEND: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  TEE: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  UBOLT: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  ATTA: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  OLET: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  INST: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
};

function cloneDefaults() {
  return {
    inner_pipe: { ...DEFAULT_FORM.inner_pipe },
    ubolt: { ...DEFAULT_FORM.ubolt },
    load_conditions: { ...DEFAULT_FORM.load_conditions },
  };
}

function getValue(form, path) {
  return path.reduce((target, key) => target?.[key], form);
}

function setValue(form, path, value) {
  const [group, key] = path;
  return {
    ...form,
    [group]: {
      ...form[group],
      [key]: value,
    },
  };
}

function parseNumericInput(value) {
  if (value === '') return '';
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

// 섹션 카드 공통 헤더 — DESIGN.md 규칙에 따라 그라디언트 컬러 배너·대문자 eyebrow 대신
// 플레인 흰 헤더 + 하단 보더를 쓴다(색은 페이지 상단 배너 한 곳에만).
function CardHeader({ icon: Icon, title, right, tone = 'slate' }) {
  const iconColor = tone === 'sky' ? 'text-sky-600' : 'text-slate-500';
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
      {Icon && <Icon size={15} className={iconColor} />}
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function FieldGroup({ title, icon: Icon, fields, form, onFieldChange, resetToken = 0 }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader icon={Icon} title={title} />
      <div className="grid grid-cols-2 gap-3 p-4">
        {fields.map(field => {
          const inputId = `dpfl-${field.path.join('-')}`;
          const fieldKey = field.path.join('.');

          if (field.scientific) {
            return (
              <ScientificField
                // 리셋 시 내부 계수/지수 로컬 상태를 새 기본값으로 되돌리기 위한 강제 리마운트
                key={`${fieldKey}-${resetToken}`}
                id={inputId}
                label={field.label}
                unit={field.unit}
                value={getValue(form, field.path)}
                onChange={(value) => onFieldChange(field.path, value)}
              />
            );
          }

          return (
            <div key={fieldKey}>
              <label htmlFor={inputId} className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold leading-tight text-slate-600">{field.label}</span>
                {field.unit && <span className="shrink-0 text-[10px] font-bold text-slate-400">{field.unit}</span>}
              </label>
              <input
                id={inputId}
                type="number"
                step="any"
                value={getValue(form, field.path)}
                onChange={(event) => onFieldChange(field.path, parseNumericInput(event.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm font-semibold text-slate-800 outline-none transition-all focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 큰 자릿수 값(예: Support Stiffness 1.75e12)을 "계수 × 10^지수" 두 칸으로 입력받는다.
function toScientificParts(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return { coefficient: num || 0, exponent: 0 };
  const exponent = Math.floor(Math.log10(Math.abs(num)));
  const coefficient = Number((num / 10 ** exponent).toFixed(6));
  return { coefficient, exponent };
}

function fromScientificParts(coefficient, exponent) {
  if (coefficient === '' || exponent === '') return '';
  const c = Number(coefficient);
  const e = Number(exponent);
  if (Number.isNaN(c) || Number.isNaN(e)) return '';
  return c * 10 ** e;
}

function ScientificField({ id, label, unit, value, onChange }) {
  const initial = toScientificParts(value);
  const [coefficient, setCoefficient] = useState(initial.coefficient);
  const [exponent, setExponent] = useState(initial.exponent);

  const commit = (nextCoefficient, nextExponent) => {
    const combined = fromScientificParts(nextCoefficient, nextExponent);
    if (combined !== '') onChange(combined);
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold leading-tight text-slate-600">{label}</span>
        {unit && <span className="shrink-0 text-[10px] font-bold text-slate-400">{unit}</span>}
      </label>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition-all focus-within:border-sky-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-500/20">
        <input
          id={id}
          type="number"
          step="any"
          value={coefficient}
          onChange={(event) => {
            const next = parseNumericInput(event.target.value);
            setCoefficient(next);
            commit(next, exponent);
          }}
          className="w-0 min-w-0 flex-1 bg-transparent px-2.5 py-2 text-right text-sm font-semibold text-slate-800 outline-none"
        />
        <span className="flex shrink-0 items-center bg-slate-100 px-1.5 text-[11px] font-bold text-slate-400">×10</span>
        <input
          type="number"
          step="1"
          value={exponent}
          aria-label={`${label} 지수(10의 거듭제곱)`}
          onChange={(event) => {
            const next = parseNumericInput(event.target.value);
            setExponent(next);
            commit(coefficient, next);
          }}
          className="w-11 shrink-0 bg-transparent py-2 pr-2 text-right text-sm font-semibold text-slate-800 outline-none"
        />
      </div>
    </div>
  );
}

// 아직 해석 서버와 연결되지 않은 실행 액션 — 클릭은 허용해 상태를 안내하되(addLog/toast),
// 시각적으로는 완전히 활성화된 버튼처럼 보이지 않도록 잠금 스타일을 쓴다.
function DevLockedButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="아직 준비 중인 기능입니다."
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-200 py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-300 hover:text-slate-600"
    >
      <Lock size={16} />
      {label}
    </button>
  );
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e5 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(2);
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 결과 테이블(columns + rows)을 클라이언트에서 CSV 문자열로 직렬화한다(RFC 4180 이스케이프).
function toCsv(columns, rows) {
  const escape = (value) => {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map(row => columns.map(col => escape(row[col])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

// 뷰어 렌더 중 예외가 앱 전체를 멈추지 않도록 감싸는 에러 경계.
class ViewerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[DoublePipeViewer] 렌더 오류:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center bg-slate-900 px-6 text-center">
          <p className="text-sm font-semibold text-slate-200">3D 뷰어를 표시할 수 없습니다</p>
          <p className="mt-1.5 text-xs text-slate-400">상단의 <span className="font-semibold text-slate-200">입력 CSV</span> 탭에서 배관 데이터를 표로 확인하세요.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Tab1/Tab2 결과 CSV(내관 포함) → 이중관 전용 3D 배관 뷰어(외관/내관 구분 + U-볼트 클램프 표현).
// CSV 파싱·그룹핑은 DoublePipeViewer 내부에서 PipeEditiorCSV(해석 파이프라인)와 동일 규칙으로 처리한다.
function Model3DViewer({ columns, rows }) {
  return (
    <ViewerErrorBoundary>
      <DoublePipeViewer columns={columns} rows={rows} />
    </ViewerErrorBoundary>
  );
}

function StatRow({ label, value, unit }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className="truncate pl-2 text-sm font-bold text-slate-800">
        {typeof value === 'number' ? formatNumber(value) : value}
        {unit && <span className="ml-1 text-[10px] font-semibold text-slate-400">{unit}</span>}
      </span>
    </div>
  );
}

// Support Stiffness 요약도 입력칸과 동일하게 "계수 × 10ⁿ" 표기로 맞춰, 13자리 숫자 대신 짧게 보여준다.
function ScientificValue({ value }) {
  if (!Number.isFinite(value) || value === 0) return formatNumber(value);
  const { coefficient, exponent } = toScientificParts(value);
  return (
    <>
      {coefficient}
      <span className="mx-0.5">×10</span>
      <sup>{exponent}</sup>
    </>
  );
}

// 1단계는 형상 파라미터 입력이라 실제 3D 모델이 없다 — 대신 입력값을 즉시 반영하는
// 단면 개략도로 "3D Viewer" 자리의 빈 공간을 실제 확인 가능한 정보로 채운다.
function InnerSupportPreview({ form }) {
  const outDia = Number(form.inner_pipe.outDia);
  const thick = Number(form.inner_pipe.thick);
  const bendR = Number(form.inner_pipe.bendR);
  const stiff = Number(form.load_conditions.Stiff);
  const isValid = Number.isFinite(outDia) && outDia > 0 && Number.isFinite(thick) && thick > 0 && thick < outDia / 2;

  if (!isValid) {
    return (
      <div className="flex h-full items-center justify-center text-center text-slate-400">
        <div>
          <Sliders size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Out. Diameter / Thickness 값을 입력하면 단면 미리보기가 표시됩니다.</p>
        </div>
      </div>
    );
  }

  const rOuter = 76;
  const scale = rOuter / (outDia / 2);
  const rInner = Math.max(rOuter - thick * scale, 3);
  const cx = 110;
  const cy = 100;
  const innerDia = outDia - 2 * thick;
  const wallRatio = (thick / outDia) * 100;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Inner Pipe 단면 미리보기</h3>
        <Badge variant="info" size="sm" dot>Live</Badge>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-6">
        <svg viewBox="0 0 220 200" className="h-full max-h-[240px] w-auto shrink-0" role="img" aria-label="Inner pipe 단면 개략도">
          <circle cx={cx} cy={cy} r={rOuter} fill="#eff6ff" stroke="#0369a1" strokeWidth="2" />
          <circle cx={cx} cy={cy} r={rInner} fill="white" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1={cx - rOuter} y1={cy} x2={cx + rOuter} y2={cy} stroke="#0369a1" strokeWidth="1" strokeDasharray="4 3" />
          <text x={cx} y={cy - rOuter - 10} textAnchor="middle" fontSize="12" fontWeight="700" className="fill-slate-600">
            {`Ø${outDia} mm`}
          </text>
          <text x={cx + rInner + 6} y={cy + 4} fontSize="10" className="fill-slate-500">
            {`t=${thick} mm`}
          </text>
          <text x={cx} y={cy + rOuter + 18} textAnchor="middle" fontSize="9" className="fill-slate-400">
            {`t/D ${wallRatio.toFixed(1)}%`}
          </text>
        </svg>

        <svg viewBox="0 0 150 170" className="h-full max-h-[240px] w-auto shrink-0" role="img" aria-label="Bend radius 개략도">
          <polyline points="28,150 28,65 122,65" fill="none" stroke="#e0f2fe" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="28,150 28,65 122,65" fill="none" stroke="#0369a1" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" />
          <text x="34" y="52" fontSize="12" fontWeight="700" className="fill-slate-600">
            {`R${bendR}`}
          </text>
          <text x="34" y="66" fontSize="9" className="fill-slate-400">
            mm bend
          </text>
        </svg>

        <div className="flex flex-1 flex-col gap-2">
          <StatRow label="Out. Diameter" value={outDia} unit="mm" />
          <StatRow label="Inner Diameter" value={innerDia} unit="mm" />
          <StatRow label="Thickness" value={thick} unit="mm" />
          <StatRow label="Bend Radius" value={bendR} unit="mm" />
          <StatRow label="Support Stiffness" value={<ScientificValue value={stiff} />} unit="N/mm" />
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2">
        <Info size={12} className="mt-0.5 shrink-0 text-sky-500" />
        <p className="text-[10px] leading-relaxed text-sky-700">
          {Number.isFinite(stiff) && stiff >= 1e10
            ? 'Support Stiffness ≥ 1×10¹⁰ N/mm — UBOLT 자동 배치 간격이 확장됩니다 (ELBO 인접 300mm, 패턴 간격 1500/1600mm 교번).'
            : 'Support Stiffness < 1×10¹⁰ N/mm — UBOLT 자동 배치는 기본 간격을 사용합니다 (ELBO 인접 150mm, 패턴 간격 900/1100mm 교번).'}
        </p>
      </div>

      <p className="mt-3 shrink-0 text-[10px] leading-relaxed text-slate-400">
        입력값을 즉시 반영하는 개략도입니다. 실행 후 <span className="font-semibold text-slate-500">3D 모델</span> 탭에서 생성된 배관 형상을 확인할 수 있습니다.
      </p>
    </div>
  );
}

// 내관 자동 생성(append_offset.py 포팅본) 결과 CSV 를 가시성 높은 표로 렌더링.
// - 좌측 고정 '#' 열(가로 스크롤에도 행 기준 유지) · type 색상 배지 · 숫자열 우측정렬 monospace
function ResultTable({ columns, rows }) {
  // 숫자열 판별 — 비어있지 않은 표본값이 대부분 숫자면 우측정렬 + 등폭 처리.
  const numericCols = useMemo(() => {
    const set = new Set();
    const sample = rows.slice(0, 30);
    columns.forEach(col => {
      let num = 0;
      let filled = 0;
      for (const row of sample) {
        const v = row[col];
        if (v === '' || v == null) continue;
        filled += 1;
        if (!Number.isNaN(Number(v))) num += 1;
      }
      if (filled >= 3 && num / filled >= 0.8) set.add(col);
    });
    return set;
  }, [columns, rows]);

  const typeCol = columns.includes('type') ? 'type' : columns[1];

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-slate-200 bg-slate-100 px-2.5 py-2 text-right font-bold text-slate-400">#</th>
            {columns.map(col => (
              <th
                key={col}
                className={`sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-2.5 py-2 font-bold uppercase tracking-wide text-slate-500 ${
                  numericCols.has(col) ? 'text-right' : 'text-left'
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const zebra = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';
            return (
              <tr key={index} className="group">
                <td className={`sticky left-0 z-10 border-b border-slate-100 px-2.5 py-1.5 text-right font-mono text-[10px] font-semibold text-slate-400 ${zebra} group-hover:bg-sky-50`}>
                  {index + 1}
                </td>
                {columns.map(col => {
                  const raw = row[col];
                  const empty = raw === '' || raw == null;
                  if (col === typeCol && !empty) {
                    const t = String(raw).trim().toUpperCase();
                    const style = TYPE_STYLES[t] || 'bg-slate-100 text-slate-600 ring-slate-500/20';
                    return (
                      <td key={col} className={`whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 ${zebra} transition-colors group-hover:bg-sky-50`}>
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${style}`}>{t}</span>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col}
                      className={`whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 ${zebra} transition-colors group-hover:bg-sky-50 ${
                        numericCols.has(col) ? 'text-right font-mono tabular-nums text-slate-700' : 'text-slate-600'
                      }`}
                    >
                      {empty ? <span className="text-slate-300">—</span> : String(raw)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 콘솔에는 상세 파일 경로(절대경로)를 노출하지 않는다 — 파일명만 남겨 사용자에게 필요한 정보만 보여준다.
function sanitizeLog(line) {
  let s = String(line);
  // Traceback 의 'File "C:\...\Main.py", line 30' → 'Main.py:30'
  s = s.replace(/File "([^"]+)", line (\d+)/g, (_, p, n) => `${p.split(/[\\/]/).pop()}:${n}`);
  // 남은 Windows 절대경로 토큰(C:\... / C:/...) → 파일명만
  s = s.replace(/[A-Za-z]:[\\/][^\s"']+/g, m => m.split(/[\\/]/).pop());
  return s;
}

// 로그 라인에서 오류/치명 키워드를 감지해 콘솔 색을 지정.
function classifyLog(line) {
  const s = String(line);
  if (/치명|오류|ERROR|FATAL|Traceback|실패/.test(s)) return 'error';
  if (/경고|WARNING|WARN/.test(s)) return 'warning';
  if (/완료|성공|생성/.test(s)) return 'success';
  return 'info';
}

export default function DoublePipeFuelLineAssessment() {
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const { showToast } = useToast();
  const { employeeId } = useAuth();
  const logEndRef = useRef(null);
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};
  const [activeTab, setActiveTab] = useState(savedPageState.activeTab ?? 'inner-support');
  // 저장된 상태가 이전 스키마(ubolt 그룹 없음)일 수 있어 기본값과 얕게 병합해 필드 누락을 막는다.
  const [form, setForm] = useState(() => {
    const saved = savedPageState.form;
    if (!saved) return cloneDefaults();
    return {
      inner_pipe: { ...DEFAULT_FORM.inner_pipe, ...saved.inner_pipe },
      ubolt: { ...DEFAULT_FORM.ubolt, ...saved.ubolt },
      load_conditions: { ...DEFAULT_FORM.load_conditions, ...saved.load_conditions },
    };
  });
  const [logs, setLogs] = useState(savedPageState.logs ?? [
    { time: new Date().toLocaleTimeString(), message: 'Inner Support 입력 기본값이 로드되었습니다.', type: 'info' },
  ]);
  // 초기화 시 ScientificField(Support Stiffness)의 로컬 계수/지수 상태를 강제 리마운트하기 위한 카운터.
  const [resetToken, setResetToken] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  // 업로드한 외관 CSV(File 객체)와 실행 결과는 페이지 상태 저장 대상에 포함하지 않는다(직렬화 불가/용량 문제).
  const [csvFile, setCsvFile] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [tab1View, setTab1View] = useState('preview'); // 'preview' | 'table' | '3d'
  // Tab1 결과 CSV를 Tab2 입력값으로 전달했을 때 그 핸드오프 정보(폴더/결과 CSV/테이블 데이터).
  const [tab2Input, setTab2Input] = useState(null);
  const [tab2View, setTab2View] = useState('3d'); // '3d' | 'table'
  // Tab2 전체 Load Case 배관응력 해석
  const [psaRunning, setPsaRunning] = useState(false);
  const psaPollRef = useRef(null);

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, { activeTab, form, logs });
  }, [activeTab, form, logs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 폴링 인터벌 정리(언마운트 시).
  useEffect(() => () => {
    if (psaPollRef.current) clearInterval(psaPollRef.current);
  }, []);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  const handleFieldChange = (path, value) => {
    setForm(prev => setValue(prev, path, value));
  };

  const handleReset = () => {
    setForm(cloneDefaults());
    setResetToken(token => token + 1);
    setLogs([{ time: new Date().toLocaleTimeString(), message: '입력값을 기본 JSON 값으로 복원했습니다.', type: 'success' }]);
  };

  const handleCsvFile = (file) => {
    setCsvFile(file);
    setPreviewResult(null);
    setTab2Input(null);
    setTab1View('preview');
    addLog(`[FILE] ${file.name} 선택됨 (${formatBytes(file.size)}).`, 'info');
  };

  // 결과 CSV를 클라이언트에서 생성해 다운로드한다(서버 폴더에 저장된 것과 동일 데이터).
  const handleDownloadResult = () => {
    if (!previewResult) return;
    const csv = toCsv(previewResult.columns, previewResult.rows);
    // 엑셀에서 한글/좌표 문자열이 깨지지 않도록 UTF-8 BOM 포함.
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = previewResult.resultCsv || 'inner_pipe_result.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addLog(`결과 CSV(${link.download})를 다운로드했습니다.`, 'success');
  };

  // 결과 CSV를 Tab2 입력값으로 지정하고 Tab2로 이동. (해제 시 on=false)
  const handleSendToTab2 = (on) => {
    if (on) {
      if (!previewResult) return;
      setTab2Input({
        sourceCsv: previewResult.sourceCsv,
        resultCsv: previewResult.resultCsv,
        workDir: previewResult.workDir,
        rowCount: previewResult.rowCount,
        columns: previewResult.columns,
        rows: previewResult.rows,
      });
      setTab2View('3d');
      addLog('결과 CSV를 Piping Stress Analysis 입력으로 전달했습니다.', 'success');
      showToast('Piping Stress Analysis 입력으로 전달했습니다.', 'success');
      setActiveTab('all-load-cases');
    } else {
      setTab2Input(null);
      addLog('전달을 해제했습니다.', 'info');
    }
  };

  // 업로드한 외관 CSV + Tab1 입력값을 백엔드로 보내 append_offset.py 포팅본(inner_pipe_transform.py)을
  // 실행하고 내관 자동 생성 결과 CSV를 테이블로 받는다.
  const handleRunInnerSupport = async () => {
    if (!csvFile) {
      showToast('먼저 외관 배관 CSV를 업로드하세요.', 'warning');
      return;
    }
    setIsRunning(true);
    setTab2Input(null);
    addLog(`내관 자동 생성(append_offset.py) 실행을 요청했습니다... (입력: ${csvFile.name})`, 'info');
    try {
      const formData = new FormData();
      formData.append('csv_file', csvFile);
      formData.append('config', JSON.stringify({
        inner_pipe: form.inner_pipe,
        ubolt: form.ubolt,
        load_conditions: form.load_conditions,
      }));
      formData.append('employee_id', employeeId || 'unknown');

      const res = await axios.post(`${API_BASE_URL}/api/doublepipe/inner-pipe-preview`, formData);
      setPreviewResult(res.data);
      // Tab1 은 이전 요구대로 결과 테이블을 기본으로 보여준다(3D 모델은 상단 탭에서 전환).
      setTab1View('table');
      (res.data.logs || []).forEach(line => addLog(sanitizeLog(line), classifyLog(line)));
      addLog(`완료: 내관 포함 ${res.data.rowCount}개 부재가 생성되었습니다.`, 'success');
      showToast('내관 자동 생성이 완료되었습니다.', 'success');
    } catch (e) {
      const message = e.response?.data?.detail ?? '실행 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.';
      addLog(message, 'error');
      showToast(message, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  // 전체 Load Case 배관응력 해석(Main.py) 실행 — 백그라운드 작업 시작 후 status 폴링으로 로그 스트리밍.
  const handleRunPsa = async () => {
    if (!tab2Input) {
      showToast('먼저 Tab1에서 결과 CSV를 전달하세요.', 'warning');
      return;
    }
    setPsaRunning(true);
    addLog(`전체 ${LOAD_CASES.length}개 Load Case 배관응력 해석을 요청했습니다.`, 'info');
    try {
      const res = await axios.post(`${API_BASE_URL}/api/doublepipe/run-psa`, {
        workDir: tab2Input.workDir,
        resultCsv: tab2Input.resultCsv,
        employee_id: employeeId || 'unknown',
      });
      const jobId = res.data.jobId;
      addLog('배관응력 해석을 시작했습니다.', 'info');
      let lastIdx = 0;
      psaPollRef.current = setInterval(async () => {
        try {
          const s = await axios.get(`${API_BASE_URL}/api/doublepipe/run-psa/status/${jobId}`);
          const jobLogs = s.data.logs || [];
          for (; lastIdx < jobLogs.length; lastIdx += 1) {
            const ln = jobLogs[lastIdx];
            addLog(sanitizeLog(ln), classifyLog(ln));
          }
          if (s.data.status !== 'running') {
            clearInterval(psaPollRef.current);
            psaPollRef.current = null;
            setPsaRunning(false);
            if (s.data.status === 'done') {
              addLog('완료: Report for PSA.xlsx 가 생성되었습니다.', 'success');
              showToast('전체 Load Case 해석이 완료되었습니다.', 'success');
            } else if (s.data.diagnostic === 'solver_env_missing') {
              addLog('해석 실패 — 해석 프로그램 내부 모듈이 손상되었습니다.', 'error');
              showToast('해석 프로그램이 손상되었습니다. 서버 관리자에게 문의하세요. (콘솔 안내 참조)', 'error');
            } else if (s.data.diagnostic === 'abaqus_not_found') {
              addLog('해석 실패 — 이 컴퓨터에 Abaqus 솔버가 없습니다.', 'error');
              showToast('Abaqus가 설치되어 있지 않아 해석을 완주할 수 없습니다. (콘솔 안내 참조)', 'error');
            } else if (s.data.diagnostic === 'abaqus_solve_failed') {
              addLog('해석 실패 — Abaqus 해석이 오류로 종료되었습니다.', 'error');
              showToast('Abaqus 해석 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.', 'error');
            } else {
              addLog(`해석 실패 (returncode ${s.data.returncode}). 로그를 확인하세요.`, 'error');
              showToast('해석에 실패했습니다. 콘솔 로그를 확인하세요.', 'error');
            }
          }
        } catch {
          // 일시적 폴링 실패는 다음 주기에서 재시도.
        }
      }, 1500);
    } catch (e) {
      setPsaRunning(false);
      const message = e.response?.data?.detail ?? 'PSA 해석 요청에 실패했습니다.';
      addLog(message, 'error');
      showToast(message, 'error');
    }
  };

  // Tab2 입력 CSV 의 부재/지지 요약(전달 입력 카드에 표시).
  const tab2Summary = useMemo(() => {
    if (!tab2Input) return null;
    const cols = tab2Input.columns || [];
    const typeCol = cols.includes('type') ? 'type' : cols[1];
    let pipe = 0;
    let ubolt = 0;
    for (const r of tab2Input.rows || []) {
      const k = String(r[typeCol] ?? '').trim().toUpperCase();
      if (k === 'UBOLT') ubolt += 1;
      else if (['TUBI', 'ELBO', 'BEND', 'TEE', 'OLET', 'INST'].includes(k)) pipe += 1;
    }
    return { pipe, ubolt };
  }, [tab2Input]);

  // 사이드바 스크롤 영역(입력/설명) — 액션 버튼은 renderSidebarActions()에서 하단에 고정한다.
  const renderSidebarContent = () => {
    if (activeTab === 'all-load-cases') {
      const pipeCount = tab2Summary?.pipe ?? 0;
      const uboltCount = tab2Summary?.ubolt ?? 0;
      const tab2Meta = TABS.find(t => t.key === 'all-load-cases');
      return (
        <>
          {tab2Input ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <CardHeader icon={CheckCircle2} title="Piping Stress Analysis 입력" tone="sky" />
              <div className="space-y-2 p-4">
                <StatRow label="입력 CSV" value={tab2Input.resultCsv} />
                <StatRow label="배관 부재" value={pipeCount} unit="EA" />
                <StatRow label="U-Bolt 지지" value={uboltCount} unit="EA" />
                <StatRow label="작업 폴더" value={tab2Input.workDir} />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                <ArrowRight size={20} className="text-sky-500" />
              </div>
              <p className="text-sm font-bold text-slate-600">입력이 필요합니다</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                1단계에서 <span className="font-semibold text-sky-600">Piping Stress Analysis로 전달</span>을 누르면
                생성된 이중관 배관 CSV가 이 단계의 입력으로 지정됩니다.
              </p>
            </div>
          )}

          {/* 전체 Load Case (전체 자동 해석) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader
              icon={ListChecks}
              title="해석 Load Case"
              right={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">전체 {LOAD_CASES.length}개</span>}
            />
            <div className="p-4">
              <p className="mb-3 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-[11px] leading-relaxed text-sky-800">
                <Info size={13} className="mt-0.5 shrink-0 text-sky-500" />
                <span>{tab2Meta?.description}</span>
              </p>
              <div className="space-y-2.5">
                {CASE_CATS.map(({ cat, name, dot }) => {
                  const cases = LOAD_CASES.filter(c => c.cat === cat);
                  return (
                    <div key={cat}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${dot}`} />
                        <span className="text-[11px] font-bold text-slate-600">{name}</span>
                        <span className="text-[10px] font-semibold text-slate-500">{cases.length}개</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cases.map(c => (
                          <span
                            key={c.id}
                            title={`${c.id} · ${c.cat} · ${c.label}${c.mandatory ? ' — SUS 선행조건' : ''}`}
                            className={`flex items-center gap-0.5 rounded-md border px-2 py-1 text-[11px] font-bold ${
                              c.mandatory
                                ? 'border-amber-300 bg-amber-100 text-amber-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            {c.id.replace('L', '')}
                            {c.mandatory && <Lock size={8} />}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>
                  이 단계는 <span className="font-bold">전체 {LOAD_CASES.length}개 Load Case</span>를 자동 해석합니다
                  (L17 SUS 선행 포함). 실제 해석 완주에는 Abaqus 솔버 환경이 필요합니다.
                </span>
              </p>
            </div>
          </div>
        </>
      );
    }

    if (activeTab === 'selected-load-cases') {
      const tab = TABS.find(item => item.key === activeTab);
      const TabIcon = tab?.icon ?? Info;
      return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader icon={TabIcon} title={tab?.shortLabel} right={<Badge variant="warning" size="sm" dot>개발 중</Badge>} />
          <div className="p-5">
            <p className="text-xs leading-relaxed text-slate-500">{tab?.description}</p>
          </div>
        </div>
      );
    }

    return (
      <>
        <CsvUpload file={csvFile} onFile={handleCsvFile} />
        <FieldGroup
          title="Inner Pipe"
          icon={Sliders}
          fields={INNER_PIPE_FIELDS}
          form={form}
          onFieldChange={handleFieldChange}
          resetToken={resetToken}
        />
        <FieldGroup
          title="Load Conditions"
          icon={ListChecks}
          fields={PSA_LOAD_FIELDS}
          form={form}
          onFieldChange={handleFieldChange}
          resetToken={resetToken}
        />
      </>
    );
  };

  // 사이드바 하단 고정 액션 — 스크롤과 무관하게 항상 보이도록 aside footer에 배치한다.
  const renderSidebarActions = () => {
    if (activeTab === 'all-load-cases') {
      return (
        <>
          <Button
            variant="primary"
            fullWidth
            isLoading={psaRunning}
            disabled={!tab2Input || psaRunning}
            onClick={handleRunPsa}
          >
            <Zap size={15} />
            전체 Load Case 해석 실행 ({LOAD_CASES.length})
          </Button>
          {!tab2Input && (
            <p className="mt-2 text-center text-[11px] text-slate-500">Tab1 결과를 전달하면 실행할 수 있습니다.</p>
          )}
        </>
      );
    }

    if (activeTab === 'selected-load-cases') {
      const tab = TABS.find(item => item.key === activeTab);
      return <DevLockedButton label={`${tab?.shortLabel} 준비 중`} onClick={() => { addLog('결과/리포트 화면은 준비 중입니다.', 'warning'); showToast('준비 중인 기능입니다.', 'info'); }} />;
    }

    return (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="sm" fullWidth onClick={handleReset}>
          <RotateCcw size={14} />
          입력값 초기화
        </Button>

        <Button variant="primary" fullWidth isLoading={isRunning} disabled={!csvFile} onClick={handleRunInnerSupport}>
          <Play size={15} />
          Design Inner Support 실행
        </Button>

        {!csvFile && !previewResult && (
          <p className="text-center text-[11px] text-slate-400">외관 배관 CSV를 업로드하면 실행할 수 있습니다.</p>
        )}

        {previewResult && (
          <>
            <Button variant="secondary" fullWidth size="sm" onClick={handleDownloadResult}>
              <Download size={14} />
              결과 CSV 다운로드 ({previewResult.rowCount}행)
            </Button>

            {/* Tab2 전달 — 토글이 아닌 명확한 액션 버튼 */}
            {tab2Input ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-emerald-800">Piping Stress Analysis로 전달됨</p>
                  <p className="truncate text-[10px] text-emerald-600">{tab2Input.resultCsv}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('all-load-cases')}
                  className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-emerald-700"
                >이동</button>
                <button
                  type="button"
                  title="전달 취소"
                  onClick={() => handleSendToTab2(false)}
                  className="shrink-0 rounded-lg p-1 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                ><X size={14} /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSendToTab2(true)}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-sky-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:from-sky-700 hover:to-sky-600 hover:shadow"
              >
                <Send size={15} />
                Piping Stress Analysis로 전달
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  const activeTabMeta = TABS.find(item => item.key === activeTab);

  // 우측 뷰어 패널 — 탭별로 3D 모델 / 결과 테이블 / 단면 미리보기를 전환.
  const renderViewer = () => {
    if (activeTab === 'inner-support') {
      const hasResult = !!previewResult;
      const dark = tab1View === '3d' && hasResult;
      return (
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <div className={`flex shrink-0 items-center gap-1.5 border-b px-3 py-2 ${dark ? 'border-slate-800 bg-slate-800/70' : 'border-slate-100 bg-slate-50'}`}>
            <ViewTab active={tab1View === 'preview'} onClick={() => setTab1View('preview')} icon={Sliders} label="단면 미리보기" dark={dark} />
            <ViewTab active={tab1View === '3d'} onClick={() => hasResult && setTab1View('3d')} icon={Box} label="3D 모델" disabled={!hasResult} dark={dark} />
            <ViewTab active={tab1View === 'table'} onClick={() => hasResult && setTab1View('table')} icon={Table2} label={`결과 테이블${hasResult ? ` (${previewResult.rowCount})` : ''}`} disabled={!hasResult} dark={dark} />
            {hasResult && <span className={`ml-auto truncate text-[11px] ${dark ? 'text-slate-400' : 'text-slate-400'}`}>{previewResult.resultCsv}</span>}
          </div>
          <div className="min-h-0 flex-1">
            {tab1View === 'table' && hasResult ? (
              <ResultTable columns={previewResult.columns} rows={previewResult.rows} />
            ) : tab1View === '3d' && hasResult ? (
              <Model3DViewer columns={previewResult.columns} rows={previewResult.rows} />
            ) : (
              <InnerSupportPreview form={form} />
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'all-load-cases') {
      const has = !!tab2Input;
      const dark = has && tab2View === '3d';
      return (
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          {has && (
            <div className={`flex shrink-0 items-center gap-1.5 border-b px-3 py-2 ${dark ? 'border-slate-800 bg-slate-800/70' : 'border-slate-100 bg-slate-50'}`}>
              <ViewTab active={tab2View === '3d'} onClick={() => setTab2View('3d')} icon={Box} label="3D 배관 모델" dark={dark} />
              <ViewTab active={tab2View === 'table'} onClick={() => setTab2View('table')} icon={Table2} label={`입력 CSV (${tab2Input.rowCount})`} dark={dark} />
              <span className="ml-auto truncate text-[11px] text-slate-400">{tab2Input.resultCsv}</span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {!has ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-slate-500">
                  <Box size={44} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-semibold text-slate-400">3D 배관 모델</p>
                  <p className="mt-1 text-xs">Tab1에서 결과 CSV를 전달하면 생성된 이중관 배관 모델이 3D로 표시됩니다.</p>
                </div>
              </div>
            ) : tab2View === '3d' ? (
              <Model3DViewer columns={tab2Input.columns} rows={tab2Input.rows} />
            ) : (
              <ResultTable columns={tab2Input.columns} rows={tab2Input.rows} />
            )}
          </div>
        </div>
      );
    }

    // Tab3 (준비 중)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-slate-500">
            <Filter size={44} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm font-semibold text-slate-400">{activeTabMeta?.shortLabel}</p>
            <p className="mt-1 text-xs">선택 Load Case 결과·리포트 화면은 준비 중입니다.</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative mx-auto flex h-full max-w-[1400px] flex-col animate-fade-in-up">
      <FileBasedPageBanner
        title="이중관 구조 연료배관 해석"
        subtitle="Inner Support 설계와 연료배관 Load Case 해석 입력을 구성합니다."
        icon={Pipette}
        guideTitle="[파일] 이중관 구조 연료배관 해석 — 사용 안내"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* 3단계 워크플로 스텝퍼 (컴팩트) */}
      <div className="mb-3 grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab.key;
          const Icon = tab.icon;
          const isDone = (tab.key === 'inner-support' && !!previewResult)
            || (tab.key === 'all-load-cases' && !!tab2Input);
          const statusText = tab.key === 'all-load-cases' && tab2Input ? '입력 연결됨' : (isDone ? '완료' : tab.statusLabel);
          const statusColor = tab.key === 'selected-load-cases' ? 'text-amber-600' : (isDone || (tab.key === 'all-load-cases' && tab2Input) ? 'text-emerald-600' : (tab.key === 'inner-support' ? 'text-emerald-600' : 'text-slate-400'));
          return (
            <button
              key={tab.key}
              type="button"
              title={tab.label}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => setActiveTab(tab.key)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                isActive
                  ? 'border-sky-500 bg-sky-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                isActive ? 'bg-sky-600 text-white' : isDone ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {isDone ? <CheckCircle2 size={13} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`flex items-center gap-1.5 text-xs font-bold leading-tight ${isActive ? 'text-sky-800' : 'text-slate-700'}`}>
                  <Icon size={12} className={isActive ? 'text-sky-600' : 'text-slate-400'} />
                  <span className="truncate">{tab.shortLabel}</span>
                </span>
                <span className={`mt-0.5 block text-[10px] font-semibold ${statusColor}`}>
                  {statusText}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        {/* 좌측: 스크롤 입력 영역 + 하단 고정 액션 (스크롤과 무관하게 실행 버튼 항상 노출) */}
        <aside className="flex w-[380px] shrink-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5">
            {renderSidebarContent()}
          </div>
          <div className="mt-3 shrink-0 border-t border-slate-200 pt-3">
            {renderSidebarActions()}
          </div>
        </aside>

        {/* 우측: 뷰어(3D/테이블/미리보기) + 콘솔 */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {renderViewer()}

          {/* 콘솔 */}
          <div className="flex h-[180px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-4 py-2">
              <Terminal size={14} className="text-slate-400" />
              <span className="font-mono text-xs text-slate-400">Console</span>
              {psaRunning && <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-sky-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />해석 진행 중</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {logs.map((log, index) => (
                <p key={`${log.time}-${index}`} className={`font-mono text-xs leading-relaxed ${LOG_COLORS[log.type] || 'text-slate-300'}`}>
                  <span className="mr-2 text-slate-500">{log.time}</span>
                  {log.message}
                </p>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </main>
      </div>

      <SolverCredit contributor="김윤환" />
    </div>
  );
}

// 뷰어 헤더의 뷰 전환 탭 버튼 — 3D(다크) 패널에서도 대비를 유지하도록 dark 대응.
function ViewTab({ active, onClick, icon: Icon, label, disabled, dark }) {
  const inactive = dark ? 'text-slate-300 hover:bg-slate-700/60' : 'text-slate-500 hover:bg-slate-200';
  const disabledCls = dark ? 'text-slate-600' : 'text-slate-300';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
        disabled ? `cursor-not-allowed ${disabledCls}` : active ? 'bg-sky-600 text-white' : inactive
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// 외관 배관 CSV 업로드 드롭존 — 클릭/드래그.
function CsvUpload({ file, onFile }) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const pickFile = (picked) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.csv')) return;
    onFile(picked);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader icon={Upload} title="외관 배관 CSV" tone="sky" />
      <div className="p-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragOver(false);
            pickFile(event.dataTransfer.files?.[0]);
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            isDragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50'
          }`}
        >
          <Upload size={24} className="mx-auto mb-2 text-slate-400" />
          {file ? (
            <div>
              <p className="truncate text-sm font-semibold text-slate-700">{file.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">{formatBytes(file.size)}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-500">클릭하거나 CSV를 드래그하세요</p>
              <p className="mt-0.5 text-xs text-slate-400">외관(Outer) 배관 형상 .csv</p>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
