import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Activity, ArrowRight, Ban, Box, Check, CheckCircle2, ChevronRight, Clock, Download, Filter, Info, Loader2, Lock, ListChecks,
  Pipette, Play, RotateCcw, Ruler, Send, ShieldAlert, Sliders, Table2, Terminal, Upload, X, Zap,
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
import { readPsaHint, writePsaHint, clearPsaHint, formatElapsed } from '../../utils/doublePipePsa';
import { getAuthHeaders } from '../../utils/auth';

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

// 3단계 워크플로 — 순서 자체가 정보(Inner Support 설계 → 배관응력 해석 → 고유진동 해석)이므로
// 번호를 부여한다. 2·3단계는 Tab1 결과 전달 / 직접 업로드 어느 쪽으로도 진입할 수 있다.
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
    key: 'natural-frequency',
    label: 'Natural Frequency',
    shortLabel: 'Natural Frequency',
    icon: Activity,
    statusLabel: '배관 CSV 대기',
    description: '배관 CSV로 고유진동(Normal Mode) 해석용 inp를 생성해 Abaqus *FREQUENCY 스텝을 실행하고, '
      + '결과(.dat)에서 모드별 고유진동수(Hz)를 추출합니다. 마찰 반복은 진행하지 않습니다.',
  },
];

// 고유진동 해석 옵션 기본값 — Run_ModalAnalysis 의 --modes / --min-freq 기본값과 같다.
const MODAL_DEFAULTS = { modes: 10, minFreq: 1.0 };

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

// L17(SUS)은 Allowable Stress 선행조건이라 선택 해석 시 항상 자동 포함(백엔드/엔진과 동일 규칙).
const MANDATORY_LC = 'L17';

// outDia/thick 은 실행 시 백엔드(append_offset.py 포팅본)가 Pipe_Dim 표준 규격으로 내부에서
// 스냅한다 — 스냅된 값은 결과 테이블에서 확인하며, 입력 단계에서는 자유 입력을 그대로 유지한다.
// UBOLT 질량(ubolt.mass)도 동일하게 내부 기본값(0.2485kg)만 사용하고 입력 필드로는 노출하지 않는다.
// group: 카드 내부 소제목(연속된 항목끼리만 묶임) — 정보 위계를 위한 표시 전용 메타데이터이며 계산/전송 로직과는 무관하다.
const INNER_PIPE_FIELDS = [
  { path: ['inner_pipe', 'outDia'], label: 'Out. Diameter', unit: 'mm', group: '형상' },
  { path: ['inner_pipe', 'thick'], label: 'Thickness', unit: 'mm', group: '형상' },
  { path: ['inner_pipe', 'bendR'], label: 'Bend Radius', unit: 'mm', group: '형상' },
  // 1.75e12 처럼 자릿수가 큰 값이라 일반 숫자 입력 대신 계수×10^지수 방식으로 받는다.
  { path: ['load_conditions', 'Stiff'], label: 'Support Stiffness', unit: 'N/mm', scientific: true, group: '지지 강성', fullWidth: true },
];

const PSA_LOAD_FIELDS = [
  { path: ['load_conditions', 'Pref'], label: 'Design Pressure', unit: 'barG', group: '설계 조건' },
  { path: ['load_conditions', 'DesignTemperature'], label: 'Design Temperature', unit: 'degC', group: '설계 조건' },
  { path: ['load_conditions', 'InitialTemperature'], label: 'Initial Temperature', unit: 'degC', group: '설계 조건' },
  { path: ['load_conditions', 'FluidDensity'], label: 'Fluid Density', unit: 'kg/mm3', group: '설계 조건' },
  { path: ['load_conditions', 'AccUX'], label: 'Acceleration Ux', unit: 'g', group: '가속도 (g)' },
  { path: ['load_conditions', 'AccUY'], label: 'Acceleration Uy', unit: 'g', group: '가속도 (g)' },
  { path: ['load_conditions', 'AccUZ'], label: 'Acceleration Uz', unit: 'g', group: '가속도 (g)' },
  { path: ['load_conditions', 'Hogg'], label: 'Hull Deflection (Hogg)', unit: 'mm', group: '선체 처짐 · 계절 온도' },
  { path: ['load_conditions', 'Sagg'], label: 'Hull Deflection (Sagg)', unit: 'mm', group: '선체 처짐 · 계절 온도' },
  { path: ['load_conditions', 'Summer'], label: 'Summer', unit: 'degC', group: '선체 처짐 · 계절 온도' },
  { path: ['load_conditions', 'Winter'], label: 'Winter', unit: 'degC', group: '선체 처짐 · 계절 온도' },
  { path: ['load_conditions', 'FrictionFactor'], label: 'Friction Factor', unit: '', group: '마찰' },
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

function createInitialLogs() {
  return [
    { time: new Date().toLocaleTimeString(), message: 'Inner Support 입력 기본값이 로드되었습니다.', type: 'info' },
  ];
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
// tone='success'는 입력/연결이 완료된 카드임을 알리는 상태 피드백용(초록 아이콘)이며, 헤더 자체 배경은 바꾸지 않는다.
function CardHeader({ icon: Icon, title, subtitle, right, tone = 'slate' }) {
  const iconColor = tone === 'success' ? 'text-emerald-600' : tone === 'sky' ? 'text-sky-600' : 'text-slate-500';
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className={iconColor} />}
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {subtitle && <p className="mt-1 pl-6 text-[11px] leading-relaxed text-slate-500">{subtitle}</p>}
    </div>
  );
}

// fields의 group(연속 항목 한정)으로 소섹션을 나눠 렌더링 — 정보 위계를 위한 표시 전용 분리이며
// getValue/onFieldChange 배선은 그대로라 계산·상태 로직에는 영향이 없다.
function FieldGroup({ title, icon: Icon, fields, form, onFieldChange, resetToken = 0 }) {
  const sections = useMemo(() => {
    const out = [];
    fields.forEach((field) => {
      const label = field.group ?? null;
      const last = out[out.length - 1];
      if (last && last.label === label) last.fields.push(field);
      else out.push({ label, fields: [field] });
    });
    return out;
  }, [fields]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader icon={Icon} title={title} />
      <div className="space-y-3.5 p-4">
        {sections.map((section, sIdx) => (
          <div key={section.label ?? `section-${sIdx}`}>
            {section.label && (
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{section.label}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {section.fields.map(field => {
                const inputId = `dpfl-${field.path.join('-')}`;
                const fieldKey = field.path.join('.');
                const spanCls = field.fullWidth ? 'col-span-2' : '';

                if (field.scientific) {
                  return (
                    <div key={fieldKey} className={spanCls}>
                      <ScientificField
                        // 리셋 시 내부 계수/지수 로컬 상태를 새 기본값으로 되돌리기 위한 강제 리마운트
                        key={`${fieldKey}-${resetToken}`}
                        id={inputId}
                        label={field.label}
                        unit={field.unit}
                        value={getValue(form, field.path)}
                        onChange={(value) => onFieldChange(field.path, value)}
                      />
                    </div>
                  );
                }

                return (
                  <div key={fieldKey} className={spanCls}>
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
        ))}
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

// CSV 문자열 → { columns, rows } (Tab2 직접 업로드 시 클라이언트 파싱). RFC 4180 따옴표/이스케이프 처리.
// 좌표 문자열("X 34866mm Y -3600mm Z 19384mm")처럼 필드 안에 공백은 있어도 콤마는 보통 없지만,
// 따옴표로 감싼 필드(콤마 포함)도 안전하게 파싱한다. 결과 rows 는 열 이름을 키로 한 객체 배열이다.
function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, ''); // UTF-8 BOM 제거
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } // 이스케이프된 따옴표
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\r') {
      // CRLF 의 CR 은 무시 (LF 에서 레코드 종료)
    } else if (c === '\n') {
      record.push(field); records.push(record); record = []; field = '';
    } else {
      field += c;
    }
  }
  // 마지막 줄(개행 없이 끝난 경우) 반영
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  if (records.length === 0) return { columns: [], rows: [] };

  const columns = records[0].map(h => String(h).trim());
  const rows = records
    .slice(1)
    .filter(r => r.some(v => v != null && String(v).trim() !== ''))
    .map((r) => {
      const obj = {};
      columns.forEach((col, idx) => { obj[col] = r[idx] ?? ''; });
      return obj;
    });
  return { columns, rows };
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

// 배관 단면 물성 표기용 포맷터 — 큰 값(A/I/Z)은 천단위 구분, 작은 값(d/Sh/Sa)은 소수 2자리.
function fmtSection(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e5) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return v.toFixed(2);
}

// 배관 정보 미리보기 상단 "입력 형상 요약" 칩 — 사이드바에서 입력 중인 값을 우측 미리보기에서도 바로 되짚어보게 한다.
function SpecChip({ label, value, unit, accent }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
      accent ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-slate-50'
    }`}>
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`font-mono text-xs font-black tabular-nums ${accent ? 'text-sky-700' : 'text-slate-700'}`}>{value}</span>
      {unit && <span className="text-[9px] font-semibold text-slate-400">{unit}</span>}
    </div>
  );
}

// 단면 물성/응력 카드 1개 — InnerSupportPreview의 metrics 배열 항목을 그대로 렌더링한다(값·수식 불변, 마크업만 재사용 가능하게 추출).
function MetricTile({ m }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${m.stress ? 'border-sky-100 bg-sky-50/50' : 'border-slate-100 bg-slate-50/60'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-bold text-slate-600">{m.label}</span>
        <span className={`font-mono text-[10px] font-bold ${m.stress ? 'text-sky-500' : 'text-slate-400'}`}>{m.sym}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-sm font-black tabular-nums text-slate-800">{fmtSection(m.value)}</span>
        <span className="text-[10px] font-semibold text-slate-400">{m.unit}</span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[9px] leading-tight text-slate-400" title={m.formula}>{m.formula}</div>
    </div>
  );
}

// 1단계는 형상 파라미터 입력이라 실제 3D 모델이 없다 — 대신 입력값(외경 D·두께 t·설계압력 P)으로
// 중공 원형 단면의 물성(d·A·I·Z)과 응력(Sh·Sa)을 실시간 계산해 "배관 정보 미리보기"로 채운다.
// 수식: d=D−2t, A=π/4(D²−d²), I=π/64(D⁴−d⁴), Z=I/(D/2), Sh=P·D/(2t), Sa=P·d²/(D²−d²).
function InnerSupportPreview({ form }) {
  const D = Number(form.inner_pipe.outDia);
  const t = Number(form.inner_pipe.thick);
  const Pbar = Number(form.load_conditions?.Pref);   // Design Pressure [barG]
  const isValid = Number.isFinite(D) && D > 0 && Number.isFinite(t) && t > 0 && t < D / 2;

  if (!isValid) {
    return (
      <div className="flex h-full items-center justify-center text-center text-slate-400">
        <div>
          <Sliders size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Out. Diameter / Thickness 값을 입력하면 배관 정보 미리보기가 표시됩니다.</p>
        </div>
      </div>
    );
  }

  // ── 중공 원형 단면 물성 (참조: Pipe Section Calculator, Figure/1.png) ──
  const d = D - 2 * t;                              // Inner Diameter [mm]
  const A = (Math.PI / 4) * (D * D - d * d);        // Area [mm²]
  const I = (Math.PI / 64) * (D ** 4 - d ** 4);     // Moment of Inertia [mm⁴]
  const Z = I / (D / 2);                            // Section Modulus [mm³]
  const Pmpa = Number.isFinite(Pbar) ? Pbar * 0.1 : NaN;      // barG → MPa (1 bar = 0.1 MPa)
  const Sh = Number.isFinite(Pmpa) ? (Pmpa * D) / (2 * t) : NaN;           // Hoop Stress [MPa]
  const Sa = Number.isFinite(Pmpa) ? (Pmpa * d * d) / (D * D - d * d) : NaN; // Axial Stress [MPa]

  const rOuter = 72;
  const scale = rOuter / (D / 2);
  const rInner = Math.max(rOuter - t * scale, 3);
  const cx = 88;
  const cy = 92;
  const wallRatio = (t / D) * 100;

  const metrics = [
    { label: 'Inner Diameter', sym: 'd', value: d, unit: 'mm', formula: 'd = D − 2t' },
    { label: 'Area', sym: 'A', value: A, unit: 'mm²', formula: 'A = π/4 · (D² − d²)' },
    { label: 'Moment of Inertia', sym: 'I', value: I, unit: 'mm⁴', formula: 'I = π/64 · (D⁴ − d⁴)' },
    { label: 'Section Modulus', sym: 'Z', value: Z, unit: 'mm³', formula: 'Z = I / (D/2)' },
    { label: 'Hoop Stress', sym: 'Sh', value: Sh, unit: 'MPa', formula: 'Sh = P · D / (2t)', stress: true },
    { label: 'Axial Stress', sym: 'Sa', value: Sa, unit: 'MPa', formula: 'Sa = P · d² / (D² − d²)', stress: true },
  ];

  const geometryMetrics = metrics.filter((m) => !m.stress);
  const stressMetrics = metrics.filter((m) => m.stress);

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">배관 정보 미리보기</h3>
        <Badge variant="info" size="sm" dot>Live</Badge>
      </div>

      {/* 입력 형상 요약 — 좌측 사이드바에서 지금 입력 중인 값을 우측에서도 바로 되짚어본다 */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <SpecChip label="Out. Dia" value={`Ø${D}`} unit="mm" />
        <SpecChip label="Thickness" value={t} unit="mm" />
        <SpecChip label="Bend R" value={form.inner_pipe.bendR} unit="mm" />
        {Number.isFinite(Pbar) && <SpecChip label="Design P" value={Pbar} unit="barG" accent />}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[196px_1fr] items-start gap-5">
        {/* 중공 원형 단면 개략도 — 도면 패널로 감싸 우측 물성 패널과 대구를 이루게 한다 */}
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-100 bg-slate-50/60">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-2">
            <Ruler size={12} className="text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">단면 개략도</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <svg viewBox="0 0 176 184" className="h-full max-h-[220px] w-auto" role="img" aria-label="배관 단면 개략도">
              <circle cx={cx} cy={cy} r={rOuter} fill="#eff6ff" stroke="#0369a1" strokeWidth="2" />
              <circle cx={cx} cy={cy} r={rInner} fill="white" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2" />
              <line x1={cx - rOuter} y1={cy} x2={cx + rOuter} y2={cy} stroke="#0369a1" strokeWidth="1" strokeDasharray="4 3" />
              <text x={cx} y={cy - rOuter - 8} textAnchor="middle" fontSize="12" fontWeight="700" className="fill-slate-600">
                {`D Ø${D} mm`}
              </text>
              <text x={cx} y={cy + rOuter + 16} textAnchor="middle" fontSize="10" className="fill-slate-500">
                {`d Ø${fmtSection(d)} mm`}
              </text>
              <text x={cx} y={cy + rOuter + 30} textAnchor="middle" fontSize="9" className="fill-slate-400">
                {`t ${t} mm · t/D ${wallRatio.toFixed(1)}%`}
              </text>
            </svg>
          </div>
        </div>

        {/* 실시간 단면 물성·응력 — 형상값과 응력값을 별도 그룹으로 나눠 스캔하기 쉽게 구성 */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">단면 물성</p>
            <div className="grid grid-cols-2 gap-2">
              {geometryMetrics.map((m) => <MetricTile key={m.sym} m={m} />)}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">응력 (Design Pressure 기준)</p>
            <div className="grid grid-cols-2 gap-2">
              {stressMetrics.map((m) => <MetricTile key={m.sym} m={m} />)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex shrink-0 items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2">
        <Info size={12} className="shrink-0 text-sky-500" />
        <p className="text-[10px] leading-relaxed text-sky-700">
          {Number.isFinite(Pmpa)
            ? <>Hoop/Axial 응력은 <span className="font-bold">P = {Pmpa.toFixed(2)} MPa</span> (Design Pressure {Pbar} barG) 기준. 외경 D·두께 t·설계압력을 바꾸면 즉시 재계산됩니다.</>
            : <>d·A·I·Z 는 형상만으로 계산됩니다. Hoop/Axial 응력은 <span className="font-bold">Design Pressure</span> 입력 시 표시됩니다.</>}
        </p>
      </div>
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
  // Report 탭 제거로 저장된 activeTab 이 유효하지 않을 수 있어(예: 'selected-load-cases') 방어한다.
  const VALID_TABS = ['inner-support', 'all-load-cases', 'natural-frequency'];
  const [activeTab, setActiveTab] = useState(
    VALID_TABS.includes(savedPageState.activeTab) ? savedPageState.activeTab : 'inner-support',
  );
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
  const [logs, setLogs] = useState(() => savedPageState.logs ?? createInitialLogs());
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
  // Tab3(Natural Frequency) — Tab2 와 같은 구조. Tab1 전달 또는 직접 업로드 어느 쪽이든 진입 가능.
  const [tab3Input, setTab3Input] = useState(null);
  const [tab3View, setTab3View] = useState('3d'); // '3d' | 'table' | 'result'
  const [modalOpts, setModalOpts] = useState({ ...MODAL_DEFAULTS });
  const [modalResult, setModalResult] = useState(null);     // { modes: [{modeNo, freqHz}], resultPath }
  // Tab2 전체 Load Case 배관응력 해석
  const [psaRunning, setPsaRunning] = useState(false);      // 내 해석이 진행 중(오버레이 표시)
  const [psaJobId, setPsaJobId] = useState(null);
  // 실행 중인 작업 종류 — Abaqus 라이센스를 공유하므로 상태/오버레이/폴링을 한 벌로 쓰고
  // 완료 메시지·결과 표시만 여기서 분기한다. 'psa' | 'modal'
  const [runKind, setRunKind] = useState('psa');
  const [psaAnchor, setPsaAnchor] = useState(null);         // 내 해석 경과 앵커(클라 epoch 초)
  const [psaReportPath, setPsaReportPath] = useState(null); // 완료된 해석의 Report for PSA.xlsx 서버 경로(다운로드용)
  const [reportDownloading, setReportDownloading] = useState(false);
  const [lockState, setLockState] = useState(null);         // 남의 해석 점유 중 { anchor } — 페이지 잠금
  const [cancelling, setCancelling] = useState(false);
  // Load Case 선택: 'all'=전체 29개(기본), 'select'=개별 선택. select 모드에서 L17(SUS)은 항상 포함(잠금).
  const [lcMode, setLcMode] = useState('all');
  const [selectedLcs, setSelectedLcs] = useState(() => new Set([MANDATORY_LC]));
  const [pdfLoading, setPdfLoading] = useState(false);
  const [, setElapsedTick] = useState(0);                   // 1초 틱(오버레이/락 타이머 리렌더)
  const psaPollRef = useRef(null);
  const lockPollRef = useRef(null);
  const psaLastIdxRef = useRef(0);                          // status 로그 스트리밍 인덱스
  const didInitRef = useRef(false);                         // 마운트 시 /active 재연결 1회 가드
  const resetGenerationRef = useRef(0);                     // 초기화 이전 비동기 응답의 상태 재유입 방지

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, { activeTab, form, logs });
  }, [activeTab, form, logs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 폴링 인터벌 정리(언마운트 시). ※ 실행 중인 해석은 중단하지 않는다 — 전역 위젯이 이어받는다.
  useEffect(() => () => {
    if (psaPollRef.current) clearInterval(psaPollRef.current);
    if (lockPollRef.current) clearInterval(lockPollRef.current);
  }, []);

  // 오버레이/락 타이머용 1초 틱 — 진행 중이거나 잠김 상태일 때만 리렌더한다.
  useEffect(() => {
    if (!psaRunning && !lockState) return undefined;
    const t = setInterval(() => setElapsedTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [psaRunning, lockState]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  // status 폴링 시작(신규 실행/재연결 공용). psaLastIdxRef 부터 새 로그만 콘솔에 스트리밍한다.
  const startPsaPolling = (jobId) => {
    if (psaPollRef.current) clearInterval(psaPollRef.current);
    psaPollRef.current = setInterval(async () => {
      try {
        const s = await axios.get(`${API_BASE_URL}/api/doublepipe/run-psa/status/${jobId}`);
        const jobLogs = s.data.logs || [];
        for (; psaLastIdxRef.current < jobLogs.length; psaLastIdxRef.current += 1) {
          const ln = jobLogs[psaLastIdxRef.current];
          addLog(sanitizeLog(ln), classifyLog(ln));
        }
        if (s.data.status !== 'running') {
          clearInterval(psaPollRef.current);
          psaPollRef.current = null;
          setPsaRunning(false);
          setPsaJobId(null);
          setPsaAnchor(null);
          clearPsaHint();
          const isModal = s.data.kind === 'modal';
          if (s.data.status === 'done' && isModal) {
            // 고유진동 해석 완료 → 모드별 고유진동수 표를 결과 뷰에 띄운다.
            const modes = s.data.modes || [];
            setModalResult({ modes, resultPath: s.data.resultPath || null });
            if (modes.length) setTab3View('result');
            addLog(`완료: 고유진동수 ${modes.length}개 모드를 추출했습니다.`, 'success');
            showToast('고유진동 해석이 완료되었습니다.', 'success');
          } else if (s.data.status === 'done') {
            // 완료 → 보고서 다운로드 경로 확보(reportReady 이고 reportPath 있을 때만).
            if (s.data.reportReady && s.data.reportPath) setPsaReportPath(s.data.reportPath);
            addLog('완료: Report for PSA.xlsx 가 생성되었습니다.', 'success');
            showToast('전체 Load Case 해석이 완료되었습니다.', 'success');
          } else if (s.data.diagnostic === 'cancelled') {
            addLog('해석이 중단되었습니다.', 'warning');
          } else if (s.data.diagnostic === 'solver_env_missing') {
            addLog('해석 실패 — 해석 프로그램 내부 모듈이 손상되었습니다.', 'error');
            showToast('해석 프로그램이 손상되었습니다. 서버 관리자에게 문의하세요. (콘솔 안내 참조)', 'error');
          } else if (s.data.diagnostic === 'abaqus_not_found') {
            addLog('해석 실패 — 이 컴퓨터에 Abaqus 솔버가 없습니다.', 'error');
            showToast('Abaqus가 설치되어 있지 않아 해석을 완주할 수 없습니다. (콘솔 안내 참조)', 'error');
          } else if (s.data.diagnostic === 'modal_console_encoding') {
            addLog('해석 실패 — 해석 프로그램이 콘솔 인코딩 오류로 중단되었습니다(대개 Abaqus 실행 실패가 선행).', 'error');
            showToast('고유진동 해석이 중단되었습니다. Abaqus 설치/PATH를 확인하세요.', 'error');
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
  };

  // 남의 해석이 라이센스를 점유 중 — 페이지를 잠그고 /active 로 해제를 감시한다.
  const startLockPolling = () => {
    if (lockPollRef.current) clearInterval(lockPollRef.current);
    lockPollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/doublepipe/active`);
        if (!data.active) {
          clearInterval(lockPollRef.current);
          lockPollRef.current = null;
          setLockState(null);
          addLog('라이센스가 해제되었습니다. 이제 해석을 실행할 수 있습니다.', 'success');
          showToast('라이센스가 해제되었습니다.', 'success');
        } else {
          // 매 주기 재앵커해 드리프트 방지.
          setLockState({ anchor: Date.now() / 1000 - (data.elapsedSec || 0) });
        }
      } catch {
        // 일시 오류 — 다음 주기 재시도(잠금 유지).
      }
    }, 3000);
  };

  const enterLockState = (elapsedSec) => {
    setLockState({ anchor: Date.now() / 1000 - (elapsedSec || 0) });
    startLockPolling();
  };

  // 진행 중인 내 해석에 다시 연결(마운트 재연결/전역 위젯 복귀). 콘솔은 재연결 헤더로 초기화 후
  // 백엔드가 보관한 로그를 처음부터 다시 스트리밍한다(중복 방지 + 완전한 콘솔).
  const reconnectToRunning = (jobId, elapsedSec, kind = 'psa') => {
    const isModal = kind === 'modal';
    setRunKind(isModal ? 'modal' : 'psa');
    setActiveTab(isModal ? 'natural-frequency' : 'all-load-cases');
    setPsaRunning(true);
    setPsaJobId(jobId);
    setPsaAnchor(Date.now() / 1000 - (elapsedSec || 0));
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: isModal ? '진행 중인 고유진동 해석에 다시 연결했습니다.' : '진행 중인 배관응력 해석에 다시 연결했습니다.',
      type: 'info',
    }]);
    psaLastIdxRef.current = 0;
    writePsaHint({ jobId, employeeId: employeeId || 'unknown' });
    startPsaPolling(jobId);
  };

  // 이탈 중 종료된 내 해석 결과를 페이지 복귀 시 복원 표시.
  const replayCompletion = (data) => {
    const isModal = data.kind === 'modal';
    const label = isModal ? '고유진동 해석' : '배관응력 해석';
    setRunKind(isModal ? 'modal' : 'psa');
    setActiveTab(isModal ? 'natural-frequency' : 'all-load-cases');
    if (data.status === 'done') {
      if (isModal) {
        const modes = data.modes || [];
        setModalResult({ modes, resultPath: data.resultPath || null });
        if (modes.length) setTab3View('result');
        addLog(`이전에 실행한 고유진동 해석이 완료되었습니다. (${modes.length}개 모드)`, 'success');
      } else {
        addLog('이전에 실행한 배관응력 해석이 완료되었습니다. (Report for PSA.xlsx 생성됨)', 'success');
      }
      showToast(`${label}이 완료되었습니다.`, 'success');
    } else if (data.diagnostic === 'cancelled') {
      addLog(`이전 ${label}은 중단되었습니다.`, 'warning');
    } else {
      addLog(`이전에 실행한 ${label}이 실패로 종료되었습니다. 콘솔/서버 로그를 확인하세요.`, 'error');
      showToast(`이전 ${label}이 실패했습니다.`, 'error');
    }
  };

  // 소유자 해석 중단 — 프로세스 트리 종료 + 라이센스 즉시 해제.
  const handleCancelPsa = async () => {
    if (!psaJobId || cancelling) return;
    setCancelling(true);
    addLog('해석 중단을 요청했습니다...', 'warning');
    try {
      await axios.post(`${API_BASE_URL}/api/doublepipe/run-psa/cancel`, {
        jobId: psaJobId,
        employee_id: employeeId || 'unknown',
      });
      if (psaPollRef.current) { clearInterval(psaPollRef.current); psaPollRef.current = null; }
      setPsaRunning(false);
      setPsaJobId(null);
      setPsaAnchor(null);
      clearPsaHint();
      addLog('해석을 중단했습니다. 라이센스가 해제되었습니다.', 'warning');
      showToast('해석을 중단했습니다.', 'info');
    } catch (e) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : '해석 중단에 실패했습니다.';
      addLog(msg, 'error');
      showToast(msg, 'error');
    } finally {
      setCancelling(false);
    }
  };

  // 마운트 시 백엔드 /active 로 3분기: (a)남의 작업=락, (b)내 작업=재연결, (c)없으면 힌트로 완료 복원.
  useEffect(() => {
    if (didInitRef.current || !employeeId) return;
    didInitRef.current = true;
    let cancelledEffect = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/doublepipe/active`);
        if (cancelledEffect) return;
        if (data.active) {
          const mine = String(data.employeeId || '') === String(employeeId || '');
          if (mine) reconnectToRunning(data.jobId, data.elapsedSec || 0, data.kind || 'psa');
          else enterLockState(data.elapsedSec || 0);
          return;
        }
        // 전역적으로 실행 중 없음 → 이탈 중 완료된 내 작업이 있는지 힌트로 확인.
        const hint = readPsaHint();
        if (hint?.jobId) {
          try {
            const s = await axios.get(`${API_BASE_URL}/api/doublepipe/run-psa/status/${hint.jobId}`);
            if (cancelledEffect) return;
            if (s.data.status === 'running') reconnectToRunning(hint.jobId, 0, s.data.kind || 'psa');
            else { replayCompletion(s.data); clearPsaHint(); }
          } catch {
            clearPsaHint(); // 404 등 → 힌트 정리
          }
        }
      } catch {
        // 백엔드 미가용 — 정상 페이지로 진행.
      }
    })();
    return () => { cancelledEffect = true; };
  }, [employeeId]);

  const handleFieldChange = (path, value) => {
    setForm(prev => setValue(prev, path, value));
  };

  const handleReset = () => {
    resetGenerationRef.current += 1;
    setActiveTab('inner-support');
    setForm(cloneDefaults());
    setResetToken(token => token + 1);
    setIsRunning(false);
    setCsvFile(null);
    setPreviewResult(null);
    setTab1View('preview');
    setTab2Input(null);
    setTab2View('3d');
    setTab3Input(null);
    setTab3View('3d');
    setModalOpts({ ...MODAL_DEFAULTS });
    setModalResult(null);
    setLcMode('all');
    setSelectedLcs(new Set([MANDATORY_LC]));
    setPdfLoading(false);
    setPsaReportPath(null);
    setLogs(createInitialLogs());
  };

  // 완료된 배관응력 해석의 Report for PSA.xlsx 를 서버(userConnection)에서 내려받는다.
  // 서식 템플릿이 반영된 최종 보고서(이미지·시트 포함)로, 백엔드 /api/download 가 스트리밍한다.
  const handleDownloadReport = async () => {
    if (!psaReportPath || reportDownloading) return;
    setReportDownloading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/download`, {
        params: { filepath: psaReportPath },
        responseType: 'blob',
        headers: getAuthHeaders(),   // /api/download 는 require_auth — 헤더 누락 시 401→자동 로그아웃
      });
      const url = URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Report for PSA.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addLog('Report for PSA.xlsx 를 다운로드했습니다.', 'success');
    } catch {
      addLog('보고서(xlsx) 다운로드에 실패했습니다.', 'error');
      showToast('보고서 다운로드에 실패했습니다. 서버 연결을 확인하세요.', 'error');
    } finally {
      setReportDownloading(false);
    }
  };

  const handleCsvFile = (file) => {
    setCsvFile(file);
    setPreviewResult(null);
    setTab2Input(null);
    setTab3Input(null);
    setModalResult(null);
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

  // 제작도면 PDF 를 온디맨드로 생성해 내려받는다. 무거운 matplotlib 렌더는 백엔드 exe 가
  // 처리(번들 — 서버 venv 에 matplotlib 불필요)하며 대략 10초가량 걸린다.
  const handleGeneratePdf = async () => {
    if (!previewResult?.workDir || !previewResult?.sourceCsv || pdfLoading) return;
    const resetGeneration = resetGenerationRef.current;
    setPdfLoading(true);
    addLog('제작도면 PDF 생성 중… (배치·치수 도면, 약 10초 소요)', 'info');
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/doublepipe/inner-pipe-pdf`,
        {
          workDir: previewResult.workDir,
          sourceCsv: previewResult.sourceCsv,
          employee_id: employeeId || 'unknown',
        },
        { responseType: 'blob' },
      );
      if (resetGenerationRef.current !== resetGeneration) return;
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const stem = (previewResult.sourceCsv || 'inner_pipe').replace(/\.csv$/i, '');
      link.download = `${stem}_Y-15000.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addLog(`제작도면 PDF(${link.download})를 다운로드했습니다.`, 'success');
    } catch {
      if (resetGenerationRef.current !== resetGeneration) return;
      addLog('제작도면 PDF 생성에 실패했습니다.', 'error');
      showToast('제작도면 PDF 생성에 실패했습니다.', 'error');
    } finally {
      if (resetGenerationRef.current === resetGeneration) setPdfLoading(false);
    }
  };

  // 결과 CSV를 Tab2 입력값으로 지정하고 Tab2로 이동. (해제 시 on=false)
  const handleSendToTab2 = (on) => {
    if (on) {
      if (!previewResult) return;
      setTab2Input({
        source: 'tab1',                 // Tab1 결과 CSV (이미 userConnection 폴더에 저장됨)
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

  // Tab2 에서 직접 업로드한 배관 CSV — 클라이언트에서 파싱해 뷰어에 띄우고 해석 입력으로 지정한다.
  // (Tab1 을 거치지 않고 준비된 이중관 CSV 로 곧바로 진행하는 경로)
  const handleTab2Csv = async (file) => {
    const resetGeneration = resetGenerationRef.current;
    addLog(`[FILE] ${file.name} 선택됨 (${formatBytes(file.size)}).`, 'info');
    try {
      const text = await file.text();
      if (resetGenerationRef.current !== resetGeneration) return;
      const { columns, rows } = parseCsv(text);
      if (!columns.length || !rows.length) {
        addLog('CSV 파싱 실패 — 유효한 배관 데이터를 찾지 못했습니다.', 'error');
        showToast('CSV에서 배관 데이터를 읽지 못했습니다.', 'error');
        return;
      }
      setTab2Input({
        source: 'upload',               // Tab2 직접 업로드 (해석 실행 시 파일을 백엔드로 전송)
        resultCsv: file.name,
        rowCount: rows.length,
        columns,
        rows,
        file,
      });
      setTab2View('3d');
      addLog(`업로드한 CSV로 이중관 배관 모델을 생성했습니다 (${rows.length}개 부재).`, 'success');
      showToast('배관 모델을 3D 뷰어에 표시했습니다.', 'success');
    } catch {
      if (resetGenerationRef.current !== resetGeneration) return;
      addLog('CSV 파일을 읽는 중 오류가 발생했습니다.', 'error');
      showToast('CSV 파일을 읽을 수 없습니다.', 'error');
    }
  };

  // Tab2 입력(전달/업로드) 해제.
  const handleClearTab2Input = () => {
    setTab2Input(null);
    addLog('배관 CSV 입력을 해제했습니다.', 'info');
  };

  // ── Tab3 (Natural Frequency) — Tab2 와 동일한 두 진입 경로 ──────────────────
  // Tab1 결과 CSV를 Tab3 입력값으로 지정하고 Tab3로 이동. (해제 시 on=false)
  const handleSendToTab3 = (on) => {
    if (on) {
      if (!previewResult) return;
      setTab3Input({
        source: 'tab1',                 // Tab1 결과 CSV (이미 userConnection 폴더에 저장됨)
        sourceCsv: previewResult.sourceCsv,
        resultCsv: previewResult.resultCsv,
        workDir: previewResult.workDir,
        rowCount: previewResult.rowCount,
        columns: previewResult.columns,
        rows: previewResult.rows,
      });
      setModalResult(null);
      setTab3View('3d');
      addLog('결과 CSV를 Natural Frequency 입력으로 전달했습니다.', 'success');
      showToast('Natural Frequency 입력으로 전달했습니다.', 'success');
      setActiveTab('natural-frequency');
    } else {
      setTab3Input(null);
      addLog('Natural Frequency 전달을 해제했습니다.', 'info');
    }
  };

  // Tab3 에서 직접 업로드한 배관 CSV — 클라이언트에서 파싱해 뷰어에 띄우고 해석 입력으로 지정한다.
  const handleTab3Csv = async (file) => {
    const resetGeneration = resetGenerationRef.current;
    addLog(`[FILE] ${file.name} 선택됨 (${formatBytes(file.size)}).`, 'info');
    try {
      const text = await file.text();
      if (resetGenerationRef.current !== resetGeneration) return;
      const { columns, rows } = parseCsv(text);
      if (!columns.length || !rows.length) {
        addLog('CSV 파싱 실패 — 유효한 배관 데이터를 찾지 못했습니다.', 'error');
        showToast('CSV에서 배관 데이터를 읽지 못했습니다.', 'error');
        return;
      }
      setTab3Input({
        source: 'upload',               // 직접 업로드 (해석 실행 시 파일을 백엔드로 전송)
        resultCsv: file.name,
        rowCount: rows.length,
        columns,
        rows,
        file,
      });
      setModalResult(null);
      setTab3View('3d');
      addLog(`업로드한 CSV로 이중관 배관 모델을 생성했습니다 (${rows.length}개 부재).`, 'success');
      showToast('배관 모델을 3D 뷰어에 표시했습니다.', 'success');
    } catch {
      if (resetGenerationRef.current !== resetGeneration) return;
      addLog('CSV 파일을 읽는 중 오류가 발생했습니다.', 'error');
      showToast('CSV 파일을 읽을 수 없습니다.', 'error');
    }
  };

  // Tab3 입력(전달/업로드) 해제.
  const handleClearTab3Input = () => {
    setTab3Input(null);
    setModalResult(null);
    addLog('고유진동 해석 배관 CSV 입력을 해제했습니다.', 'info');
  };

  // 업로드한 외관 CSV + Tab1 입력값을 백엔드로 보내 append_offset.py 포팅본(inner_pipe_transform.py)을
  // 실행하고 내관 자동 생성 결과 CSV를 테이블로 받는다.
  const handleRunInnerSupport = async () => {
    if (!csvFile) {
      showToast('먼저 외관 배관 CSV를 업로드하세요.', 'warning');
      return;
    }
    const resetGeneration = resetGenerationRef.current;
    setIsRunning(true);
    setTab2Input(null);
    setTab3Input(null);
    setModalResult(null);
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
      if (resetGenerationRef.current !== resetGeneration) return;
      setPreviewResult(res.data);
      // Tab1 은 이전 요구대로 결과 테이블을 기본으로 보여준다(3D 모델은 상단 탭에서 전환).
      setTab1View('table');
      (res.data.logs || []).forEach(line => addLog(sanitizeLog(line), classifyLog(line)));
      addLog(`완료: 내관 포함 ${res.data.rowCount}개 부재가 생성되었습니다.`, 'success');
      showToast('내관 자동 생성이 완료되었습니다.', 'success');
    } catch (e) {
      if (resetGenerationRef.current !== resetGeneration) return;
      const message = e.response?.data?.detail ?? '실행 중 오류가 발생했습니다. 서버 연결 상태를 확인하세요.';
      addLog(message, 'error');
      showToast(message, 'error');
    } finally {
      if (resetGenerationRef.current === resetGeneration) setIsRunning(false);
    }
  };

  // 전체 Load Case 배관응력 해석(Main.py) 실행 — 백그라운드 작업 시작 후 status 폴링으로 로그 스트리밍.
  // 개별 LC 체크 토글(L17 선행은 잠금이라 무시). select 모드에서만 사용.
  const toggleLc = (id) => {
    if (id === MANDATORY_LC) return;
    setSelectedLcs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 카테고리 단위 전체 선택/해제(L17 은 항상 유지). on=true 면 그 그룹 전체 체크.
  const setCategoryLcs = (cat, on) => {
    setSelectedLcs((prev) => {
      const next = new Set(prev);
      for (const c of LOAD_CASES) {
        if (c.cat !== cat || c.id === MANDATORY_LC) continue;
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  // select 모드에서 L17 을 제외하고 사용자가 실제 고른 개수(실행 가능 판정용).
  const nonMandatorySelected = useMemo(
    () => [...selectedLcs].filter((id) => id !== MANDATORY_LC).length,
    [selectedLcs],
  );
  // 실행에 넘길 LC 배열(L17 포함). all 모드면 null(전체).
  const runLoadCases = lcMode === 'select'
    ? LOAD_CASES.filter((c) => selectedLcs.has(c.id)).map((c) => c.id)
    : null;
  const canRunLc = lcMode === 'all' || nonMandatorySelected >= 1;

  const handleRunPsa = async () => {
    if (!tab2Input) {
      showToast('먼저 배관 CSV를 전달하거나 업로드하세요.', 'warning');
      return;
    }
    if (lcMode === 'select' && nonMandatorySelected < 1) {
      showToast('선택 모드에서는 Load Case를 1개 이상 선택하세요.', 'warning');
      return;
    }
    setPsaRunning(true);
    setRunKind('psa');
    setPsaReportPath(null);   // 새 해석 시작 — 이전 보고서 다운로드 버튼 숨김
    addLog(
      runLoadCases
        ? `선택 ${runLoadCases.length}개 Load Case(L17 선행 포함) 배관응력 해석을 요청했습니다: ${runLoadCases.join(', ')}`
        : `전체 ${LOAD_CASES.length}개 Load Case 배관응력 해석을 요청했습니다.`,
      'info',
    );
    try {
      let res;
      if (tab2Input.source === 'upload' && tab2Input.file) {
        // 직접 업로드 경로 — 파일을 백엔드로 올려 새 작업 폴더에 저장 후 해석 시작.
        const formData = new FormData();
        formData.append('csv_file', tab2Input.file);
        formData.append('employee_id', employeeId || 'unknown');
        // 선택 모드면 콤마 문자열로 전달(멀티파트). all 모드면 빈 값=전체.
        formData.append('load_cases', runLoadCases ? runLoadCases.join(',') : '');
        res = await axios.post(`${API_BASE_URL}/api/doublepipe/run-psa-upload`, formData);
        // 이후 단계(Tab3 리포트)를 위해 백엔드가 만든 작업 폴더를 기록해 둔다.
        if (res.data.workDir) {
          setTab2Input(prev => (prev ? { ...prev, workDir: res.data.workDir } : prev));
        }
      } else {
        // Tab1 결과 CSV(이미 userConnection 폴더에 저장됨)로 해석 시작.
        res = await axios.post(`${API_BASE_URL}/api/doublepipe/run-psa`, {
          workDir: tab2Input.workDir,
          resultCsv: tab2Input.resultCsv,
          employee_id: employeeId || 'unknown',
          load_cases: runLoadCases,   // null=전체 / ['L17','L18',...]=선택
        });
      }
      const jobId = res.data.jobId;
      addLog('배관응력 해석을 시작했습니다.', 'info');
      setPsaJobId(jobId);
      setPsaAnchor(Date.now() / 1000);       // 방금 시작 → 경과 0 부터
      psaLastIdxRef.current = 0;
      writePsaHint({ jobId, employeeId: employeeId || 'unknown' });
      startPsaPolling(jobId);
    } catch (e) {
      setPsaRunning(false);
      const detail = e.response?.data?.detail;
      // 라이센스 점유 중(레이스) — 버튼을 미리 막아도 서버 최종 관문이 409 를 줄 수 있다.
      if (e.response?.status === 409 && detail?.code === 'license_busy') {
        enterLockState(detail.elapsedSec || 0);
        addLog('다른 사용자가 해석 중이라 실행할 수 없습니다.', 'warning');
        showToast('All licenses are currently occupied. Please try again later', 'warning');
        return;
      }
      const message = typeof detail === 'string' ? detail : 'PSA 해석 요청에 실패했습니다.';
      addLog(message, 'error');
      showToast(message, 'error');
    }
  };

  // 고유진동(Normal Mode) 해석 실행 — PSA 와 같은 Abaqus 라이센스/폴링/오버레이를 공유한다.
  const handleRunModal = async () => {
    if (!tab3Input) {
      showToast('먼저 배관 CSV를 전달하거나 업로드하세요.', 'warning');
      return;
    }
    setPsaRunning(true);
    setRunKind('modal');
    setModalResult(null);     // 새 해석 시작 — 이전 결과 숨김
    addLog(
      `고유진동 해석을 요청했습니다. (최대 ${modalOpts.modes}개 모드, ${modalOpts.minFreq}Hz 이상)`,
      'info',
    );
    try {
      let res;
      if (tab3Input.source === 'upload' && tab3Input.file) {
        // 직접 업로드 경로 — 파일을 백엔드로 올려 새 작업 폴더에 저장 후 해석 시작.
        const formData = new FormData();
        formData.append('csv_file', tab3Input.file);
        formData.append('employee_id', employeeId || 'unknown');
        formData.append('modes', String(modalOpts.modes));
        formData.append('min_freq', String(modalOpts.minFreq));
        res = await axios.post(`${API_BASE_URL}/api/doublepipe/run-modal-upload`, formData);
        if (res.data.workDir) {
          setTab3Input(prev => (prev ? { ...prev, workDir: res.data.workDir } : prev));
        }
      } else {
        // Tab1 결과 CSV(이미 userConnection 폴더에 저장됨)로 해석 시작.
        res = await axios.post(`${API_BASE_URL}/api/doublepipe/run-modal`, {
          workDir: tab3Input.workDir,
          resultCsv: tab3Input.resultCsv,
          employee_id: employeeId || 'unknown',
          modes: modalOpts.modes,
          min_freq: modalOpts.minFreq,
        });
      }
      const jobId = res.data.jobId;
      addLog('고유진동 해석을 시작했습니다.', 'info');
      setPsaJobId(jobId);
      setPsaAnchor(Date.now() / 1000);
      psaLastIdxRef.current = 0;
      writePsaHint({ jobId, employeeId: employeeId || 'unknown' });
      startPsaPolling(jobId);
    } catch (e) {
      setPsaRunning(false);
      const detail = e.response?.data?.detail;
      // PSA 와 같은 단일 Abaqus 라이센스를 공유하므로 PSA 실행 중에도 409 가 난다.
      if (e.response?.status === 409 && detail?.code === 'license_busy') {
        enterLockState(detail.elapsedSec || 0);
        addLog('다른 해석이 라이센스를 사용 중이라 실행할 수 없습니다.', 'warning');
        showToast('All licenses are currently occupied. Please try again later', 'warning');
        return;
      }
      const message = typeof detail === 'string' ? detail : '고유진동 해석 요청에 실패했습니다.';
      addLog(message, 'error');
      showToast(message, 'error');
    }
  };

  // 입력 CSV 의 부재/지지 요약(전달 입력 카드에 표시). Tab2/Tab3 가 같은 형식을 쓴다.
  const summarizeCsv = (input) => {
    if (!input) return null;
    const cols = input.columns || [];
    const typeCol = cols.includes('type') ? 'type' : cols[1];
    let pipe = 0;
    let ubolt = 0;
    for (const r of input.rows || []) {
      const k = String(r[typeCol] ?? '').trim().toUpperCase();
      if (k === 'UBOLT') ubolt += 1;
      else if (['TUBI', 'ELBO', 'BEND', 'TEE', 'OLET', 'INST'].includes(k)) pipe += 1;
    }
    return { pipe, ubolt };
  };
  const tab2Summary = useMemo(() => summarizeCsv(tab2Input), [tab2Input]);
  const tab3Summary = useMemo(() => summarizeCsv(tab3Input), [tab3Input]);

  // 사이드바 스크롤 영역(입력/설명) — 액션 버튼은 renderSidebarActions()에서 하단에 고정한다.
  const renderSidebarContent = () => {
    if (activeTab === 'natural-frequency') {
      return (
        <>
          {/* 입력 — Tab1 전달 또는 Tab3 직접 업로드(둘 다 지원, Tab2 와 동일 구조) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader
              icon={tab3Input ? CheckCircle2 : Upload}
              title="배관 CSV 입력"
              tone={tab3Input ? 'success' : 'sky'}
              right={tab3Input && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  tab3Input.source === 'upload' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                }`}>
                  {tab3Input.source === 'upload' ? '직접 업로드' : 'Tab1 전달'}
                </span>
              )}
            />
            <div className="space-y-3 p-4">
              {tab3Input && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <Table2 size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700" title={tab3Input.resultCsv}>
                      {tab3Input.resultCsv}
                    </span>
                    <button
                      type="button"
                      title="입력 해제"
                      onClick={handleClearTab3Input}
                      className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <MiniStat label="배관 부재" value={tab3Summary?.pipe ?? 0} />
                    <MiniStat label="U-Bolt 지지" value={tab3Summary?.ubolt ?? 0} />
                  </div>
                </div>
              )}

              <Tab2Dropzone onFile={handleTab3Csv} hasInput={!!tab3Input} />

              {!tab3Input && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Info size={12} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    1단계에서 <span className="font-semibold text-sky-600">Natural Frequency로 전달</span>하거나,
                    내관·U-Bolt가 포함된 이중관 배관 CSV를 직접 업로드하세요.
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* 고유진동 해석 옵션 — Run_ModalAnalysis 의 --modes / --min-freq */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader
              icon={Activity}
              title="고유진동 해석 조건"
              subtitle="Abaqus *FREQUENCY 스텝으로 고유모드를 추출합니다 (마찰 반복 없음)."
            />
            <div className="space-y-3 p-4">
              <ModalOptionField
                label="추출 모드 개수"
                unit="EA"
                value={modalOpts.modes}
                min={1}
                max={50}
                step={1}
                hint="최대 50개"
                onChange={(v) => setModalOpts(prev => ({ ...prev, modes: v }))}
              />
              <ModalOptionField
                label="최소 고유진동수"
                unit="Hz"
                value={modalOpts.minFreq}
                min={0}
                max={10000}
                step={0.1}
                hint="이 값 미만 모드는 제외"
                onChange={(v) => setModalOpts(prev => ({ ...prev, minFreq: v }))}
              />
              <p className="flex items-start gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                <Info size={12} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  배관응력 해석과 <span className="font-bold text-slate-700">같은 Abaqus 라이센스</span>를 사용하므로
                  두 해석은 동시에 실행할 수 없습니다.
                </span>
              </p>
            </div>
          </div>
        </>
      );
    }

    if (activeTab === 'all-load-cases') {
      const pipeCount = tab2Summary?.pipe ?? 0;
      const uboltCount = tab2Summary?.ubolt ?? 0;
      return (
        <>
          {/* 입력 — Tab1 전달 또는 Tab2 직접 업로드(둘 다 지원) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader
              icon={tab2Input ? CheckCircle2 : Upload}
              title="배관 CSV 입력"
              tone={tab2Input ? 'success' : 'sky'}
              right={tab2Input && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  tab2Input.source === 'upload' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                }`}>
                  {tab2Input.source === 'upload' ? '직접 업로드' : 'Tab1 전달'}
                </span>
              )}
            />
            <div className="space-y-3 p-4">
              {tab2Input && (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <Table2 size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700" title={tab2Input.resultCsv}>
                      {tab2Input.resultCsv}
                    </span>
                    <button
                      type="button"
                      title="입력 해제"
                      onClick={handleClearTab2Input}
                      className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <MiniStat label="배관 부재" value={pipeCount} />
                    <MiniStat label="U-Bolt 지지" value={uboltCount} />
                  </div>
                </div>
              )}

              <Tab2Dropzone onFile={handleTab2Csv} hasInput={!!tab2Input} />

              {!tab2Input && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Info size={12} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    1단계에서 <span className="font-semibold text-sky-600">Piping Stress Analysis로 전달</span>하거나,
                    내관·U-Bolt가 포함된 이중관 배관 CSV를 직접 업로드하세요.
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* 해석 Load Case — All(전체 자동) / 선택 */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader
              icon={ListChecks}
              title="해석 Load Case"
              // TABS[1].description(Abaqus/ASME B31.3 방법론 설명)을 짧게 옮겨 카드 안에서 실제로 보이게 한다.
              subtitle="Abaqus 비마찰·마찰 반복 해석 + ASME B31.3 적합성 검토를 실행합니다."
            />
            <div className="p-4">
              {/* 전체 / 선택 — 눈에 띄는 세그먼트 컨트롤 */}
              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLcMode('all')}
                  aria-pressed={lcMode === 'all'}
                  className={`flex flex-col items-start gap-1 rounded-xl border-2 px-3 py-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
                    lcMode === 'all'
                      ? 'border-sky-500 bg-sky-50 shadow-sm ring-1 ring-sky-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <ListChecks size={15} className={lcMode === 'all' ? 'text-sky-600' : 'text-slate-400'} />
                    <span className={`text-sm font-black ${lcMode === 'all' ? 'text-sky-700' : 'text-slate-600'}`}>전체</span>
                    {lcMode === 'all' && <Check size={14} strokeWidth={3} className="ml-auto text-sky-600" />}
                  </span>
                  <span className={`text-[10px] font-semibold ${lcMode === 'all' ? 'text-sky-600' : 'text-slate-400'}`}>
                    {LOAD_CASES.length}개 전체 자동 해석
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setLcMode('select')}
                  aria-pressed={lcMode === 'select'}
                  className={`flex flex-col items-start gap-1 rounded-xl border-2 px-3 py-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
                    lcMode === 'select'
                      ? 'border-sky-500 bg-sky-50 shadow-sm ring-1 ring-sky-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <Filter size={15} className={lcMode === 'select' ? 'text-sky-600' : 'text-slate-400'} />
                    <span className={`text-sm font-black ${lcMode === 'select' ? 'text-sky-700' : 'text-slate-600'}`}>선택</span>
                    {lcMode === 'select' && <Check size={14} strokeWidth={3} className="ml-auto text-sky-600" />}
                  </span>
                  <span className={`text-[10px] font-semibold ${lcMode === 'select' ? 'text-sky-600' : 'text-slate-400'}`}>
                    {lcMode === 'select' ? `${selectedLcs.size}개 선택됨 (L17 포함)` : '개별 Load Case 지정'}
                  </span>
                </button>
              </div>
              {lcMode === 'all' ? (
                <>
                  <div className="divide-y divide-slate-100">
                    {CASE_CATS.map(({ cat, name, dot }) => {
                      const cases = LOAD_CASES.filter(c => c.cat === cat);
                      if (!cases.length) return null;
                      const first = cases[0].id;
                      const last = cases[cases.length - 1].id;
                      const range = first === last ? first : `${first}–${last}`;
                      const mandatory = cases.some(c => c.mandatory);
                      return (
                        // grid 고정 컬럼(라벨 / 선행배지 / 범위 / 개수)으로 행마다 값이 있거나 없어도 세로 정렬이 어긋나지 않게 한다.
                        <div key={cat} className="grid grid-cols-[auto_1fr_auto_2.5rem] items-center gap-2 py-2">
                          <span className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                            <span className="text-xs font-bold text-slate-700">{name}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{cat}</span>
                          </span>
                          <span className="flex justify-end">
                            {mandatory && (
                              <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                                <Lock size={8} />선행
                              </span>
                            )}
                          </span>
                          <span className="text-right font-mono text-[11px] text-slate-500">{range}</span>
                          <span className="text-right text-[11px] font-bold text-slate-700">{cases.length}개</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
                    <Info size={12} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                      전체 <span className="font-bold text-slate-700">{LOAD_CASES.length}개</span> Load Case를 자동 해석합니다
                      (L17 SUS 선행 포함). 실제 완주에는 Abaqus 솔버 환경이 필요합니다.
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {CASE_CATS.map(({ cat, name, dot }) => {
                      const cases = LOAD_CASES.filter(c => c.cat === cat);
                      if (!cases.length) return null;
                      const selectable = cases.filter(c => c.id !== MANDATORY_LC);
                      const allOn = selectable.length > 0 && selectable.every(c => selectedLcs.has(c.id));
                      return (
                        <div key={cat} className="overflow-hidden rounded-xl border border-slate-100">
                          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                            <span className="text-[11px] font-bold text-slate-700">{name}</span>
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{cat}</span>
                            {selectable.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setCategoryLcs(cat, !allOn)}
                                className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold text-sky-600 transition-colors hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                              >{allOn ? '해제' : '전체'}</button>
                            )}
                          </div>
                          <div className="space-y-0.5 p-1.5">
                            {cases.map((c) => {
                              const locked = c.id === MANDATORY_LC;
                              const checked = locked || selectedLcs.has(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  disabled={locked}
                                  onClick={() => toggleLc(c.id)}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
                                    locked ? 'cursor-default bg-amber-50'
                                      : checked ? 'bg-sky-50 hover:bg-sky-100'
                                        : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                                  }`}>
                                    {checked && <Check size={11} strokeWidth={3} />}
                                  </span>
                                  <span className="w-8 shrink-0 font-mono text-[11px] font-bold text-slate-700">{c.id}</span>
                                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={c.label}>{c.label}</span>
                                  {locked && (
                                    <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                                      <Lock size={8} />선행
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className={`mt-3 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed ${
                    nonMandatorySelected < 1 ? 'border-rose-100 bg-rose-50 text-rose-600' : 'border-slate-100 bg-slate-50 text-slate-500'
                  }`}>
                    <Info size={12} className="mt-0.5 shrink-0" />
                    <span>
                      선택 <span className="font-bold text-slate-700">{nonMandatorySelected}개</span> + <span className="font-bold text-amber-700">L17(선행)</span>
                      {' = 총 '}<span className="font-bold text-slate-700">{selectedLcs.size}개</span> 해석.
                      {nonMandatorySelected < 1 && ' Load Case를 1개 이상 선택하세요.'}
                    </span>
                  </p>
                </>
              )}
            </div>
          </div>
        </>
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
    if (activeTab === 'natural-frequency') {
      const modeCount = modalResult?.modes?.length ?? 0;
      return (
        <>
          <Button
            variant="primary"
            fullWidth
            isLoading={psaRunning}
            disabled={!tab3Input || psaRunning}
            onClick={handleRunModal}
          >
            <Activity size={15} />
            고유진동 해석 실행 ({modalOpts.modes}개 모드)
          </Button>
          {!tab3Input && (
            <p className="mt-2 text-center text-[11px] text-slate-500">CSV를 전달하거나 업로드하면 실행할 수 있습니다.</p>
          )}

          {/* 해석 완료 후 고유진동수 요약 */}
          {modeCount > 0 && !psaRunning && (
            <div className="mt-3 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="flex items-center gap-2 px-3 pt-2.5">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-800">해석 완료 · {modeCount}개 모드</span>
              </div>
              <div className="p-2.5">
                <Button variant="secondary" fullWidth size="sm" onClick={() => setTab3View('result')}>
                  <Table2 size={14} />
                  고유진동수 결과 보기
                </Button>
                <p className="mt-1.5 text-center text-[10px] text-emerald-600/80">
                  1차 모드 {modalResult.modes[0].freqHz.toFixed(4)} Hz
                </p>
              </div>
            </div>
          )}
        </>
      );
    }

    if (activeTab === 'all-load-cases') {
      return (
        <>
          <Button
            variant="primary"
            fullWidth
            isLoading={psaRunning}
            disabled={!tab2Input || psaRunning || !canRunLc}
            onClick={handleRunPsa}
          >
            <Zap size={15} />
            {lcMode === 'select'
              ? `선택 Load Case 해석 실행 (${selectedLcs.size})`
              : `전체 Load Case 해석 실행 (${LOAD_CASES.length})`}
          </Button>
          {!tab2Input ? (
            <p className="mt-2 text-center text-[11px] text-slate-500">CSV를 전달하거나 업로드하면 실행할 수 있습니다.</p>
          ) : lcMode === 'select' && !canRunLc ? (
            <p className="mt-2 text-center text-[11px] text-rose-500">Load Case를 1개 이상 선택하세요.</p>
          ) : null}

          {/* 해석 완료 후 결과 보고서(xlsx) 다운로드 */}
          {psaReportPath && !psaRunning && (
            <div className="mt-3 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="flex items-center gap-2 px-3 pt-2.5">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-800">해석 완료 · 보고서 준비됨</span>
              </div>
              <div className="p-2.5">
                <Button variant="primary" fullWidth size="sm" isLoading={reportDownloading} onClick={handleDownloadReport}>
                  <Download size={14} />
                  Report for PSA.xlsx 다운로드
                </Button>
                <p className="mt-1.5 text-center text-[10px] text-emerald-600/80">ASME B31.3 적합성·응력 결과 · 서식/이미지 포함</p>
              </div>
            </div>
          )}
        </>
      );
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

            {previewResult.pdfSupported && (
              <Button variant="secondary" fullWidth size="sm" onClick={handleGeneratePdf} disabled={pdfLoading}>
                <Download size={14} />
                {pdfLoading ? '제작도면 PDF 생성 중…' : '제작도면 PDF 생성·다운로드 (배치·치수)'}
              </Button>
            )}

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

            {/* Tab3 전달 — 배관응력 해석과 독립적으로, 같은 결과 CSV를 고유진동 해석에도 보낼 수 있다. */}
            {tab3Input ? (
              <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                <CheckCircle2 size={16} className="shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-violet-800">Natural Frequency로 전달됨</p>
                  <p className="truncate text-[10px] text-violet-600">{tab3Input.resultCsv}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('natural-frequency')}
                  className="shrink-0 rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-violet-700"
                >이동</button>
                <button
                  type="button"
                  title="전달 취소"
                  onClick={() => handleSendToTab3(false)}
                  className="shrink-0 rounded-lg p-1 text-violet-500 transition-colors hover:bg-violet-100 hover:text-violet-700"
                ><X size={14} /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSendToTab3(true)}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:from-violet-700 hover:to-violet-600 hover:shadow"
              >
                <Activity size={15} />
                Natural Frequency로 전달
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
            </div>
          )}
          <div className="min-h-0 flex-1">
            {!has ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-slate-500">
                  <Box size={44} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-semibold text-slate-400">3D 배관 모델</p>
                  <p className="mt-1 text-xs">Tab1에서 결과 CSV를 전달하거나, 왼쪽에서 배관 CSV를 업로드하면 이중관 배관 모델이 3D로 표시됩니다.</p>
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

    if (activeTab === 'natural-frequency') {
      const has = !!tab3Input;
      const modes = modalResult?.modes || [];
      const dark = has && tab3View === '3d';
      return (
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          {has && (
            <div className={`flex shrink-0 items-center gap-1.5 border-b px-3 py-2 ${dark ? 'border-slate-800 bg-slate-800/70' : 'border-slate-100 bg-slate-50'}`}>
              <ViewTab active={tab3View === '3d'} onClick={() => setTab3View('3d')} icon={Box} label="3D 배관 모델" dark={dark} />
              <ViewTab active={tab3View === 'table'} onClick={() => setTab3View('table')} icon={Table2} label={`입력 CSV (${tab3Input.rowCount})`} dark={dark} />
              <ViewTab
                active={tab3View === 'result'}
                onClick={() => modes.length && setTab3View('result')}
                icon={Activity}
                label={`고유진동수${modes.length ? ` (${modes.length})` : ''}`}
                disabled={!modes.length}
                dark={dark}
              />
            </div>
          )}
          <div className="min-h-0 flex-1">
            {!has ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-slate-500">
                  <Activity size={44} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-semibold text-slate-400">고유진동 해석</p>
                  <p className="mt-1 text-xs">Tab1에서 결과 CSV를 전달하거나, 왼쪽에서 배관 CSV를 업로드하면 이중관 배관 모델이 3D로 표시됩니다.</p>
                </div>
              </div>
            ) : tab3View === 'result' && modes.length ? (
              <NaturalFrequencyTable modes={modes} minFreq={modalOpts.minFreq} />
            ) : tab3View === 'table' ? (
              <ResultTable columns={tab3Input.columns} rows={tab3Input.rows} />
            ) : (
              <Model3DViewer columns={tab3Input.columns} rows={tab3Input.rows} />
            )}
          </div>
        </div>
      );
    }

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
        guidePlaceholder={`이 앱의 사용 가이드는 아직 준비되지 않았습니다.
향후 작성 예정입니다.`}
        devHtmlGuide="doublepipe-fuelline"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* 3단계 워크플로 스텝퍼 (컴팩트) — 카드 사이에 연결 화살표를 둬 순서가 있는 흐름임을 분명히 한다 */}
      <div className="relative mb-3 shrink-0">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TABS.map((tab, index) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const linkedInput = (tab.key === 'all-load-cases' && !!tab2Input)
              || (tab.key === 'natural-frequency' && !!tab3Input);
            const isDone = (tab.key === 'inner-support' && !!previewResult) || linkedInput;
            const statusText = linkedInput ? '입력 연결됨' : (isDone ? '완료' : tab.statusLabel);
            const statusColor = (isDone || tab.key === 'inner-support') ? 'text-emerald-600' : 'text-slate-400';
            return (
              <button
                key={tab.key}
                type="button"
                title={tab.label}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => setActiveTab(tab.key)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
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
        {/* 순서 흐름 표시용 장식 화살표 — 클릭 불가, 3열 그리드에서만 표시 */}
        {['33.333%', '66.667%'].map((left) => (
          <div
            key={left}
            style={{ left }}
            className="pointer-events-none absolute inset-y-0 z-10 hidden -translate-x-1/2 items-center sm:flex"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-300 shadow-sm">
              <ChevronRight size={14} />
            </span>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        {/* 좌측: 스크롤 입력 영역 + 하단 고정 액션 (스크롤과 무관하게 실행 버튼 항상 노출) */}
        <aside className="flex min-h-0 w-[380px] shrink-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1.5 [&>*]:shrink-0">
            {renderSidebarContent()}
          </div>
          <div className="mt-3 shrink-0 border-t border-slate-200 pt-3">
            {renderSidebarActions()}
          </div>
        </aside>

        {/* 우측: 뷰어(3D/테이블/미리보기) + 콘솔 */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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

      {/* 실행 중 오버레이(요구1) — 페이지 콘텐츠를 덮되 앱 사이드바는 살아 있어 이탈 가능(전역 위젯이 이어받음).
          jobId 확정 후에만 표시해 요청~409(라이센스 점유) 사이 깜빡임을 막는다. */}
      {psaRunning && psaJobId && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15">
              <Loader2 size={28} className="animate-spin text-sky-400" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              {runKind === 'modal' ? '고유진동 해석 진행 중' : '배관응력 해석 진행 중'}
            </h3>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Clock size={18} className="text-sky-400" />
              <span className="font-mono text-3xl font-black tabular-nums text-white">
                {formatElapsed(Date.now() / 1000 - (psaAnchor ?? Date.now() / 1000))}
              </span>
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div className="h-full w-full animate-pulse rounded-full bg-sky-400/70" />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-400">
              Abaqus 해석은 <span className="font-bold text-slate-200">최대 1시간</span>까지 소요될 수 있습니다.
              완료되면 결과가 자동으로 표시됩니다.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              다른 화면으로 이동해도 우측 하단 위젯에서 진행 시간을 확인하고 돌아올 수 있습니다.
            </p>
            {logs.length > 0 && (
              <p
                className="mt-3 truncate rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-[10px] text-slate-400"
                title={logs[logs.length - 1].message}
              >
                {logs[logs.length - 1].message}
              </p>
            )}
            <button
              type="button"
              onClick={handleCancelPsa}
              disabled={cancelling}
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Ban size={14} />
              {cancelling ? '중단 중…' : '해석 중단'}
            </button>
          </div>
        </div>
      )}

      {/* 라이센스 락 오버레이(요구3) — 남의 해석 점유 중. 전체 페이지 잠금 + 경과시간만 표시. */}
      {lockState && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900/95 p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
              <ShieldAlert size={28} className="text-amber-400" />
            </div>
            <h3 className="text-sm font-bold text-white">All licenses are currently occupied</h3>
            <p className="mt-1.5 text-xs text-slate-400">Please try again later</p>
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">다른 사용자가 해석 중</p>
              <div className="mt-1.5 flex items-center justify-center gap-2">
                <Clock size={16} className="text-amber-400" />
                <span className="font-mono text-2xl font-black tabular-nums text-white">
                  {formatElapsed(Date.now() / 1000 - lockState.anchor)}
                </span>
                <span className="text-[10px] font-semibold text-slate-400">경과 · 최대 1시간</span>
              </div>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              <Loader2 size={12} className="animate-spin" />
              라이센스가 해제되면 자동으로 사용할 수 있습니다.
            </p>
          </div>
        </div>
      )}

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

// Tab2 입력 요약 미니 통계 — 파일명 아래 배관 부재/U-Bolt 개수를 한 눈에 보여준다.
function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-center">
      <div className="text-sm font-bold text-slate-800">
        {value}
        <span className="ml-0.5 text-[9px] font-semibold text-slate-400">EA</span>
      </div>
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
    </div>
  );
}

// 고유진동 해석 옵션(--modes / --min-freq) 숫자 입력 — 빈 문자열 편집을 허용하되
// 실행에 넘기는 값은 항상 유효 범위의 숫자로 유지한다(blur 시 클램프).
function ModalOptionField({ label, unit, value, min, max, step, hint, onChange }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    onChange(clamped);
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5">
        <span className="text-xs font-bold text-slate-700">{label}</span>
        <span className="text-[10px] font-semibold text-slate-400">{hint}</span>
      </span>
      <span className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm font-bold tabular-nums text-slate-800 outline-none"
        />
        <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">{unit}</span>
      </span>
    </label>
  );
}

// 고유진동수 결과표 — Run_ModalAnalysis 가 .dat 에서 추출한 모드별 Hz.
function NaturalFrequencyTable({ modes, minFreq }) {
  const maxFreq = modes.reduce((acc, m) => Math.max(acc, m.freqHz), 0) || 1;
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <p className="text-xs font-bold text-slate-700">
          고유진동수 <span className="text-slate-400">(≥ {minFreq} Hz · {modes.length}개 모드)</span>
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          1차 모드 <span className="font-mono font-bold text-sky-600">{modes[0].freqHz.toFixed(4)} Hz</span>
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-1.5">
          {modes.map((m) => (
            <div key={m.modeNo} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-right font-mono text-[11px] font-bold text-slate-500">
                MODE {m.modeNo}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-500"
                  style={{ width: `${Math.max(2, (m.freqHz / maxFreq) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-xs font-black tabular-nums text-slate-800">
                {m.freqHz.toFixed(4)}
                <span className="ml-1 text-[9px] font-semibold text-slate-400">Hz</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Tab2 배관 CSV 업로드 드롭존 — 입력 카드 안에 들어가는 슬림형(클릭/드래그).
function Tab2Dropzone({ onFile, hasInput }) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const pick = (picked) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.csv')) return;
    onFile(picked);
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          pick(event.dataTransfer.files?.[0]);
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          isDragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50'
        }`}
      >
        <Upload size={20} className="mx-auto mb-1.5 text-slate-400" />
        <p className="text-xs font-semibold text-slate-600">{hasInput ? '다른 배관 CSV로 교체' : '배관 CSV 직접 업로드'}</p>
        <p className="mt-0.5 text-[10px] text-slate-400">내관·U-Bolt 포함 이중관 배관 .csv</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
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
      <CardHeader icon={file ? CheckCircle2 : Upload} title="외관 배관 CSV" tone={file ? 'success' : 'sky'} />
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
            isDragOver
              ? 'border-sky-400 bg-sky-50'
              : file
                ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50'
          }`}
        >
          {file ? (
            <div>
              <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-500" />
              <p className="truncate text-sm font-semibold text-slate-700">{file.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">{formatBytes(file.size)} · 클릭 시 다른 파일로 교체</p>
            </div>
          ) : (
            <div>
              <Upload size={24} className="mx-auto mb-2 text-slate-400" />
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
          onChange={(event) => {
            pickFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
