import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronsRight,
  DatabaseZap, Download, ExternalLink, Eye, FileEdit, FilePlus2, FileSpreadsheet, History, Loader2,
  Lock, PackageCheck, RefreshCw, RotateCcw, ScanSearch, Send, ShieldCheck, UploadCloud, X,
} from 'lucide-react';

import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import {
  StepRail, InputSummary, VerdictHeader, KeyFigures, NextActionBar, JobProgressCard, EngineLogPanel, StudioLauncherCard,
  RunStartPanel,
} from '../../components/analysis/runFrame';
import { computeModelBuilderVerdict } from '../../utils/modelBuilderVerdict';
import { useResultReentry } from '../../utils/resultReentry';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { isAppBlockedFor, mergeAppSetting, useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../contexts/ToastContext';
import { API_BASE_URL } from '../../config';
import { downloadFileBlob, rerunAnalysisProject } from '../../api/analysis';
import { getAuthHeaders, handleUnauthorized, isAdmin } from '../../utils/auth';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import AppCommunityHub from '../../components/analysis/AppCommunityHub';
import PreflightIssueCenter from '../../components/analysis/PreflightIssueCenter';
import CsvPreviewPanel from '../../components/analysis/CsvPreviewPanel';
import { readCsvFileRows } from '../../utils/csvPreview';
import ModelRegistrationModal from '../../components/modelRegistry/ModelRegistrationModal';
import { notifyStudioSourceUpdated } from '../../utils/studioSourceNotice';
import { describeDiagnostic, downloadDiagnostics, enrichDiagnostic } from '../../utils/modelValidation';
import { useDashboardFilesHandoff, useDashboardAutoRun } from '../../utils/dashboardFileHandoff';

/* ──────────────────────────────────────────────────────────────────────────
   상수
   ──────────────────────────────────────────────────────────────────────── */

// 2026-04-30: ModelBuilderStudio 재구성에 따라 manifest.id 가 'model-studio' 로 변경됨.
// 사내 스토리지 zip: model-studio-<version>.zip — 백엔드 _find_zip 이 prefix 매칭.
const VIEWER_ID = 'model-studio';
// 2. Model Builder Studio 카드가 설치본과 비교할 Workbench 기준 버전.
// Studio 패키지 배포 시 model-studio package.json/manifest 버전과 함께 갱신한다.
const MODEL_BUILDER_STUDIO_VERSION = '0.0.90';

// 단계 이름은 '도구'가 아니라 엔지니어가 할 일로 쓴다(Studio 는 2단계에서 쓰는 도구).
// 상태는 실제 사건으로만 바뀐다 — 1: 실행 성공, 2: 판정 통과·검토 확인·편집 적용, 3: BDF 받기·후속 해석 전달.
const INITIAL_STEPS = [
  { id: 'input',   title: '입력 검증',      icon: FileSpreadsheet, status: 'wait' },
  { id: 'review',  title: '모델 확인·보정', icon: ScanSearch,      status: 'wait' },
  { id: 'deliver', title: 'BDF 저장·전달',  icon: PackageCheck,    status: 'wait' },
];

const REASON_LABELS = {
  csv_row_accepted:               '정상 변환',
  no_geometry_and_zero_mass:      '형상 없음 + 질량 0',
  pipe_outdia_zero:               '배관 외경(outDia) 0 — 형상 누락',
  zero_length_pipe:               '길이 0 배관(형상 없음)',
  zero_length_pipe_without_mass:  '길이 0 + 질량 없는 배관',
  zero_length_structure:          '길이 0 구조 부재',
  unsupported_structure_section:  '미지원 구조 단면',
  zero_mass_attachment:           '질량 0 부착물',
  zero_mass_equipment:            '질량 0 장비',
  ambiguousDuplicateSourceName:   '동일 sourceName 중복',
  parse_failed:                   '파싱 실패',
  parseFailed:                    '파싱 실패',
  blank_line:                     '공백 행',
  blank:                          '공백 행',
};


const DEFAULT_MESH_SIZE_MM = '500';

// 1단계: 파일명으로 유형 추측
const CSV_TYPE_KEYWORDS = {
  stru:  ['stru', 'struct', 'str', 'structural', 'structure', 'support', 'supt', '구조'],
  pipe:  ['pipe', 'pip', 'piping', '배관'],
  equip: ['equip', 'equipment', 'equp', 'eq', 'eqp', '장비', 'cargo', 'load', 'weight', 'mass'],
};

// 2단계: CSV 헤더 컬럼명으로 유형 검증
const CSV_REQUIRED_COLS = {
  stru:  ['ori'],     // ori(방향)
  pipe:  ['outdia'],  // outDia(외경)
  equip: ['cog'],     // cog(무게중심)
};

/* ──────────────────────────────────────────────────────────────────────────
   유틸리티
   ──────────────────────────────────────────────────────────────────────── */

async function fetchJson(filepath) {
  const res = await fetch(
    `${API_BASE_URL}/api/download?filepath=${encodeURIComponent(filepath)}`,
    { headers: getAuthHeaders() }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  return JSON.parse(clean);
}

async function triggerDownload(filepath, downloadName) {
  const res = await downloadFileBlob(filepath);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName || filepath.split(/[\\/]/).pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const AUDIT_STATUS_LABELS = {
  converted: '변환 성공',
  error: '오류',
  ignored: '제외',
  parseFailed: '파싱 실패',
  blank: '공백 행',
};

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadRowAuditCsv(rowAudit) {
  const headers = [
    '파일 종류', '원본 파일', '실제 줄 번호', '데이터 행 번호', '이름',
    '상태', '사유 코드', '사유', '매핑 신뢰도', '원본 행', '원본 필드',
  ];
  const rows = rowAudit.map((row) => [
    row.kind, row.file, row.physicalLineNumber, row.dataRowNumber, row.name,
    AUDIT_STATUS_LABELS[row.status] ?? row.status, row.reasonCode, row.reason,
    row.mappingConfidence, row.rawLine,
    row.rawFields == null ? '' : JSON.stringify(row.rawFields),
  ]);
  const csv = [headers, ...rows].map(columns => columns.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  a.href = url;
  a.download = `HiTESS_ModelBuilder_행단위검증_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 원본 BDF 경로로부터 _edit.bdf 다운로드 파일명 생성. ex) foo.bdf → foo_edit.bdf
function makeEditDownloadName(originalPath, ext) {
  const base = (originalPath || '').split(/[\\/]/).pop() || `model.${ext}`;
  const stem = base.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  return `${stem}_edit.${ext}`;
}

// 후속 해석 화면에 표시할 출처 라벨. 편집본이 넘어간 경우를 문구로 명시한다.
// edited/ 산출물은 원본과 파일명이 같고 폴더만 달라서, 라벨이 없으면 후속 해석 화면에서
// 원본이 넘어온 것으로 오해하기 쉽다.
function handoffSourceLabel(bdfPath, originalBdfPath) {
  const isEdited = !!bdfPath && bdfPath !== originalBdfPath;
  return isEdited ? 'HiTESS Model Builder (Edit BDF)' : 'HiTESS Model Builder';
}

function buildEditedModelCheckStage(editedSummary) {
  if (!editedSummary) return null;
  const e = editedSummary;
  const connectivity = e.connectivity ?? e.Connectivity ?? null;
  const issues = e.healthMetrics?.issues ?? e.health?.issues ?? e.issues ?? {};
  const health = e.health ?? {
    freeEndCount: issues.freeEndNodes?.length ?? issues.freeEndNodeCount ?? issues.freeEndCount ?? 0,
    orphanNodeCount: issues.orphanNodes?.length ?? issues.orphanNodeCount ?? issues.orphanCount ?? 0,
    shortElementCount: issues.shortElements?.length ?? issues.shortElementCount ?? 0,
    unresolvedUboltCount: issues.unresolvedUbolts?.length ?? issues.unresolvedUboltCount ?? 0,
    disconnectedGroupCount: issues.disconnectedGroups?.length
      ?? issues.disconnectedGroupCount
      ?? Math.max((connectivity?.groupCount ?? 1) - 1, 0),
  };
  const diagnostics = e.healthMetrics?.diagnosticCounts ?? e.diagnosticCounts ?? {};
  if (!connectivity && !e.nodes && !e.elements && !e.rigids) return null;

  return {
    stageIndex: 'Edit',
    stageName: 'Edit Validation',
    processingDurationMs: 0,
    counts: {
      nodes: Array.isArray(e.nodes) ? e.nodes.length : e.summary?.finalNodeCount ?? e.meta?.nodeCount ?? 0,
      elements: Array.isArray(e.elements) ? e.elements.length : e.summary?.finalElementCount ?? e.meta?.elementCount ?? 0,
      rigids: Array.isArray(e.rigids) ? e.rigids.length : e.summary?.finalRigidCount ?? e.meta?.rigidCount ?? 0,
      pointMasses: Array.isArray(e.pointMasses) ? e.pointMasses.length : e.summary?.finalPointMassCount ?? e.meta?.pointMassCount ?? 0,
    },
    delta: {},
    connectivity: connectivity ?? {},
    health,
    diagnostics: {
      error: diagnostics.error ?? diagnostics.errors ?? 0,
      warning: diagnostics.warning ?? diagnostics.warnings ?? 0,
      info: diagnostics.info ?? diagnostics.infos ?? 0,
    },
  };
}

const fileBaseName = (p) => (p ? p.split(/[\\/]/).pop() : '');

function extractBaseAndKeyword(filename, keywords) {
  const lower = filename.replace(/\.csv$/i, '').toLowerCase();
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    const re = new RegExp(`[_\\-\\.\\s]?${kw}[_\\-\\.\\s]?`, 'i');
    if (re.test(lower)) {
      const base = lower.replace(re, '').replace(/[_\-\.\s]+$/, '').replace(/^[_\-\.\s]+/, '');
      return { base, keyword: kw };
    }
  }
  return null;
}

function guessTypeFromFilename(filename) {
  const lower = filename.toLowerCase();
  for (const [type, keywords] of Object.entries(CSV_TYPE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return type;
  }
  return null;
}

function readCsvHeader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      const firstLine = clean.split(/\r?\n/)[0] || '';
      const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
      resolve(cols);
    };
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

async function detectCsvType(file) {
  const cols = await readCsvHeader(file);
  for (const [type, required] of Object.entries(CSV_REQUIRED_COLS)) {
    if (required.every(r => cols.some(c => c.includes(r)))) return type;
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
   InputAudit / StageSummary 어댑터 (실제 Cmb.Cli 스키마 기반)
   ──────────────────────────────────────────────────────────────────────── */

// rowAudit 배열을 kind별로 분리하고 status별 카운트를 산출
function summarizeAuditByKind(audit) {
  if (!audit) return null;
  const rows = Array.isArray(audit.rowAudit) ? audit.rowAudit : [];
  const kindMap = { Structure: [], Pipe: [], Equipment: [] };
  for (const r of rows) {
    if (kindMap[r.kind]) kindMap[r.kind].push(r);
  }
  const tally = (arr) => {
    const counts = { converted: 0, ignored: 0, error: 0, parseFailed: 0, blank: 0 };
    for (const r of arr) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  };
  const inputFiles = Array.isArray(audit.inputFiles) ? audit.inputFiles : [];
  const findFile = (kind) => inputFiles.find(f => f.kind === kind) || null;
  return {
    Structure: { kind: 'Structure', file: findFile('Structure'), rows: kindMap.Structure, counts: tally(kindMap.Structure) },
    Pipe:      { kind: 'Pipe',      file: findFile('Pipe'),      rows: kindMap.Pipe,      counts: tally(kindMap.Pipe) },
    Equipment: { kind: 'Equipment', file: findFile('Equipment'), rows: kindMap.Equipment, counts: tally(kindMap.Equipment) },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   소형 UI 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   CsvDropZone — 단일/다중 파일 드롭존 (이전 버전 룩앤필 그대로)
   ──────────────────────────────────────────────────────────────────────── */

function CsvDropZone({ label, requirement, file, fileError, onFile, onClear, multiple = false, onMultipleFiles, onWarnNotCsv, disabled = false }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const isWarn = typeof fileError === 'string' && fileError.startsWith('__warn__');
  const displayError = isWarn ? fileError.slice(8) : fileError;

  const handleSingleFile = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) {
      onWarnNotCsv?.();
      return;
    }
    onFile(f);
  };

  const handleFileList = (fileList) => {
    const csvFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (csvFiles.length === 0) { onWarnNotCsv?.(); return; }
    if (csvFiles.length === 1) handleSingleFile(csvFiles[0]);
    else if (multiple && onMultipleFiles) onMultipleFiles(csvFiles);
    else handleSingleFile(csvFiles[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!disabled) handleFileList(e.dataTransfer.files);
  };

  // 배지는 파일 유무와 무관하게 '이 칸이 무엇을 요구하는지'만 말한다.
  // (예전엔 파일을 넣으면 '필수'가 '선택'으로 바뀌어, '선택 입력'과 '선택됨'이 같은 글자였다.)
  const badge = requirement === 'either'
    ? <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">둘 중 하나 필수</span>
    : <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">선택 입력</span>;

  const tone = fileError && !isWarn ? 'border-red-300' : isWarn ? 'border-amber-300' : 'border-slate-200';

  return (
    <div className={`overflow-hidden rounded-lg border bg-white transition-colors ${tone}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileSpreadsheet size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span className="truncate text-xs font-bold text-slate-800">{label}</span>
          {badge}
        </div>
        {file && !disabled && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`${label} 파일 제거`}
            className="shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {file ? (
        <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-center">
          {fileError && !isWarn
            ? <AlertCircle size={14} className="mb-0.5 shrink-0 text-red-600" aria-hidden="true" />
            : isWarn
            ? <AlertCircle size={14} className="mb-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            : <CheckCircle2 size={14} className="mb-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          }
          <p className="w-full truncate text-center text-xs font-semibold text-slate-800" title={file.name}>{file.name}</p>
          {fileError && !isWarn
            ? <p className="text-center text-[11px] leading-tight text-red-700">{displayError}</p>
            : isWarn
            ? <p className="text-center text-[11px] leading-tight text-amber-800">{displayError}</p>
            : <p className="text-[11px] text-slate-600">{(file.size / 1024).toFixed(1)} KB</p>
          }
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`flex w-full flex-col items-center justify-center gap-1 py-3 text-center transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50
            disabled:cursor-not-allowed disabled:opacity-60
            ${dragOver ? 'bg-blue-50' : 'hover:bg-slate-50 cursor-pointer'}`}
        >
          <UploadCloud size={16} className="text-slate-500" aria-hidden="true" />
          <span className="px-2 text-[11px] leading-relaxed text-slate-600">
            놓거나 <span className="font-semibold text-blue-700">눌러서 선택</span>
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple={multiple}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => { if (e.target.files?.length) handleFileList(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   PreviewModeToggle — 미리보기 표를 '내 파일' / '사내 샘플' 로 전환
   업로드 슬롯은 그대로 두고 표만 바꾼다. 두 포맷을 오가며 비교할 수 있게 하기 위함.
   ──────────────────────────────────────────────────────────────────────── */

function PreviewModeToggle({ mode, loading, onMine, onSample }) {
  const base = 'px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1';
  const on   = 'bg-white text-blue-700 shadow-sm';
  const off  = 'text-slate-500 hover:text-slate-700';
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 border border-slate-200 shrink-0">
      <button type="button" onClick={onMine} className={`${base} ${mode === 'mine' ? on : off}`}>
        내 파일
      </button>
      <button type="button" onClick={onSample} disabled={loading} className={`${base} ${mode === 'sample' ? on : off} ${loading ? 'opacity-60 cursor-wait' : ''}`}>
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
        사내 샘플
      </button>
    </div>
  );
}

function DetailCSV({
  struFile, pipeFile, equiFile,
  struError, pipeError, equiError,
  setStruFile, setPipeFile, setEquiFile,
  setStruError, setPipeError, setEquiError,
  onAutoAssign, onMultipleFiles, onWarnNotCsv, disabled,
}) {
  const common = { multiple: true, onMultipleFiles, onWarnNotCsv, disabled };
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <CsvDropZone
        label="Structural" requirement="either"
        file={struFile} fileError={struError}
        onFile={(f) => onAutoAssign(f, 'stru')}
        onClear={() => { setStruFile(null); setStruError(null); }}
        {...common}
      />
      <CsvDropZone
        label="Piping" requirement="either"
        file={pipeFile} fileError={pipeError}
        onFile={(f) => onAutoAssign(f, 'pipe')}
        onClear={() => { setPipeFile(null); setPipeError(null); }}
        {...common}
      />
      <CsvDropZone
        label="Equipment" requirement="optional"
        file={equiFile} fileError={equiError}
        onFile={(f) => onAutoAssign(f, 'equip')}
        onClear={() => { setEquiFile(null); setEquiError(null); }}
        {...common}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CSV 검증 결과 패널 — v2 (Hero-first 레이아웃)
   ──────────────────────────────────────────────────────────────────────── */

/* 파일별 변환 막대 */
function KindBar({ label, converted, total, ignored, errored = 0, failed, fileName }) {
  const pct = total > 0 ? Math.round((converted / total) * 100) : 0;
  const hasIssue = ignored > 0 || failed > 0 || errored > 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
      {/* 헤더 행 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{label}</span>
        {total > 0
          ? <span className={`text-xs font-bold font-mono ${hasIssue ? 'text-amber-600' : 'text-emerald-600'}`}>{pct}%</span>
          : <span className="text-xs text-slate-600">입력 없음</span>
        }
      </div>

      {total > 0 && (
        <>
          {/* 수치 요약 */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-800 font-mono leading-none"><AnimatedNumber value={converted} locale /></span>
            <span className="text-xs text-slate-500">행 변환</span>
          </div>

          {/* 스택 진행 바 */}
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-700 rounded-l-full"
              style={{ width: `${(converted / total) * 100}%` }}
            />
            {errored > 0 && (
              <div
                className="h-full bg-red-500 transition-all duration-700"
                style={{ width: `${(errored / total) * 100}%` }}
              />
            )}
            {ignored > 0 && (
              <div
                className="h-full bg-amber-400 transition-all duration-700"
                style={{ width: `${(ignored / total) * 100}%` }}
              />
            )}
            {failed > 0 && (
              <div
                className="h-full bg-red-400 transition-all duration-700 rounded-r-full"
                style={{ width: `${(failed / total) * 100}%` }}
              />
            )}
          </div>

          {/* 범례 (오류·제외·실패만 — 변환은 큰 수치로 이미 표시) */}
          {(ignored > 0 || failed > 0 || errored > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              {errored > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-700 font-semibold">
                  <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> 오류 {errored.toLocaleString()}
                </span>
              )}
              {ignored > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-700">
                  <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> 제외 {ignored.toLocaleString()}
                </span>
              )}
              {failed > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> 실패 {failed.toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* 파일명 */}
          {fileName && (
            <p className="text-[11px] text-slate-500 font-mono truncate pt-1 border-t border-slate-100" title={fileName}>{fileName}</p>
          )}
        </>
      )}
    </div>
  );
}

/* 제외 사유 행 */
function IgnoreReasonRow({ label, count, maxCount }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-700 w-48 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 bg-amber-50 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-bold font-mono text-amber-700 w-10 text-right shrink-0">{count.toLocaleString()}</span>
    </div>
  );
}

/* 필터 알약 */
function FilterPills({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500 font-semibold">{label}</span>
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`text-xs px-2.5 py-1 rounded-full font-medium cursor-pointer transition-colors
            ${value === o.v ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CsvAuditPanel({ audit, jobStatus, hasResult, loading, error, onRetry }) {
  const [showRows,     setShowRows]     = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter,   setKindFilter]   = useState('all');

  // 실행 중·실행 전 상태는 페이지(진행 카드·미리보기)가 그린다. 이 패널은 결과가 있을 때만 쓰인다.
  if (!hasResult) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-slate-600">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        <span className="text-sm">입력 검증 결과를 불러오는 중…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <AlertCircle size={28} className="text-red-600" aria-hidden="true" />
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 cursor-pointer"
        >
          <RotateCcw size={13} aria-hidden="true" /> 다시 불러오기
        </button>
      </div>
    );
  }

  if (!audit) return null;

  /* ── 데이터 계산 ── */
  const summary  = audit.summary || {};
  const byKind   = summarizeAuditByKind(audit);

  const total     = summary.totalDataRows   || 0;
  const converted = summary.convertedRows   || 0;
  const ignored   = summary.ignoredRows     || 0;
  const errors    = summary.errorRows       || 0;
  const failed    = summary.parseFailedRows || 0;
  const convRate  = total > 0 ? Math.round((converted / total) * 100) : 0;

  const ignoredEntries = Object.entries(summary.ignoredByReason || {})
    .map(([code, count]) => ({ code, count, label: REASON_LABELS[code] ?? code }))
    .sort((a, b) => b.count - a.count);
  const maxIgnored = ignoredEntries.length > 0 ? Math.max(...ignoredEntries.map(e => e.count)) : 1;

  const filteredRows = (audit.rowAudit || [])
    .filter(r => statusFilter === 'all' || r.status === statusFilter)
    .filter(r => kindFilter   === 'all' || r.kind   === kindFilter);

  return (
    <div className="w-full min-w-0 space-y-4">
      <KeyFigures
        items={[
          { key: 'total',     label: '입력 행',   value: total.toLocaleString() },
          { key: 'converted', label: '변환됨',    value: converted.toLocaleString(), sub: `${convRate}%` },
          { key: 'ignored',   label: '제외됨',    value: ignored.toLocaleString(), tone: ignored > 0 ? 'warn' : 'default', sub: '사유는 아래 분포 참고' },
          { key: 'errors',    label: '오류·파싱 실패', value: (errors + failed).toLocaleString(), tone: errors + failed > 0 ? 'bad' : 'default' },
        ]}
      />
      {(errors > 0 || failed > 0) && (
        <p className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {errors > 0 && `데이터 오류 ${errors.toLocaleString()}건(예: 배관 outDia=0)은 형상이 빠질 수 있습니다. `}
          {failed > 0 && `파싱 실패 ${failed.toLocaleString()}건은 원본 CSV 를 확인하세요. `}
          아래 '행 단위 검증'에서 해당 행을 볼 수 있습니다.
        </p>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          B. 파일별 처리 현황 (3열 카드)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {byKind && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-800">파일별 처리 현황</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {['Structure', 'Pipe', 'Equipment'].map((k) => {
              const d = byKind[k];
              const c = d.counts;
              const rowTotal = (d.file?.dataRowCount) ?? ((c.converted ?? 0) + (c.ignored ?? 0) + (c.error ?? 0) + (c.parseFailed ?? 0));
              return (
                <KindBar
                  key={k}
                  label={k}
                  converted={c.converted ?? 0}
                  total={rowTotal}
                  ignored={c.ignored ?? 0}
                  errored={c.error ?? 0}
                  failed={c.parseFailed ?? 0}
                  fileName={d.file ? fileBaseName(d.file.path) : null}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          C. 제외 사유 분포
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {ignoredEntries.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">
            제외 사유 분포 <span className="font-mono font-semibold text-slate-600">{ignoredEntries.reduce((a, e) => a + e.count, 0).toLocaleString()}건</span>
          </h3>
          <div className="space-y-2.5">
            {ignoredEntries.map(({ code, count, label }) => (
              <IgnoreReasonRow key={code} label={label} count={count} maxCount={maxIgnored} />
            ))}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          D. 행 단위 검증 (기본 접힘)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {audit.rowAudit?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm w-full max-w-full min-w-0">
          {/* 토글 헤더 */}
          <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
            <button
              onClick={() => setShowRows(v => !v)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
            >
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">행 단위 검증</span>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {audit.rowAudit.length.toLocaleString()}행
              </span>
              {!showRows && (
                <span className="text-[11px] text-slate-500 ml-1">— 클릭하여 자세히 보기</span>
              )}
            </div>
            </button>
            <div className="ml-3 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => downloadRowAuditCsv(audit.rowAudit)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600 cursor-pointer"
                title="전체 행의 검증 상태와 오류·제외 사유를 CSV 파일로 저장"
              >
                <Download size={12} /> CSV 저장
              </button>
              <button
                type="button"
                onClick={() => setShowRows(v => !v)}
                className="p-1 cursor-pointer"
                aria-label={showRows ? '행 단위 검증 접기' : '행 단위 검증 펼치기'}
              >
                <ChevronDown size={14} className={`text-slate-500 transition-transform duration-200 ${showRows ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {showRows && (
            <>
              {/* 필터 바 */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-t border-b border-slate-100 bg-slate-50 flex-wrap">
                <FilterPills
                  label="종류"
                  value={kindFilter} onChange={setKindFilter}
                  options={[
                    { v: 'all',       label: '전체' },
                    { v: 'Structure', label: 'Structure' },
                    { v: 'Pipe',      label: 'Pipe' },
                    { v: 'Equipment', label: 'Equipment' },
                  ]}
                />
                <span className="text-slate-200">|</span>
                <FilterPills
                  label="상태"
                  value={statusFilter} onChange={setStatusFilter}
                  options={[
                    { v: 'all',         label: '전체' },
                    { v: 'converted',   label: '변환' },
                    { v: 'error',       label: '오류' },
                    { v: 'ignored',     label: '제외' },
                    { v: 'parseFailed', label: '실패' },
                    { v: 'blank',       label: '공백' },
                  ]}
                />
                <span className="ml-auto text-xs font-mono text-slate-500">
                  {filteredRows.length.toLocaleString()} / {audit.rowAudit.length.toLocaleString()}행
                </span>
              </div>

              {/* 테이블 — table-fixed + 명시적 컬럼 폭으로 컨테이너 폭 절대 초과 안 함 */}
              <div className="max-h-96 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col className="w-[56px]" />
                    <col className="w-[88px]" />
                    <col className="w-[34%]" />
                    <col />
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">종류</th>
                      <th className="px-2 py-2 text-right font-semibold text-slate-500">행#</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">상태</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">name</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredRows.slice(0, 1000).map((r, i) => {
                      const rowBg = r.status === 'error'       ? 'bg-red-50'
                                  : r.status === 'parseFailed' ? 'bg-red-50/60'
                                  : r.status === 'ignored'     ? 'bg-amber-50/40'
                                  : r.status === 'blank'       ? 'bg-slate-50/60' : '';
                      const badge = r.status === 'converted'   ? 'bg-emerald-100 text-emerald-700'
                                  : r.status === 'error'       ? 'bg-red-100 text-red-700'
                                  : r.status === 'ignored'     ? 'bg-amber-100 text-amber-700'
                                  : r.status === 'parseFailed' ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-500';
                      // 한국어 라벨 우선 → 원문(reason) → 코드 순. 모든 상태(제외/실패/공백 포함)
                      // 에서 짧은 한국어 라벨을 먼저 노출해 칸 넘침을 막는다.
                      const reasonText = REASON_LABELS[r.reasonCode] ?? r.reason ?? r.reasonCode ?? '—';
                      return (
                        <tr key={i} className={`hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                          <td className="px-3 py-1.5 text-slate-600 truncate" title={r.kind}>{r.kind}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-500">{r.physicalLineNumber}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>{AUDIT_STATUS_LABELS[r.status] ?? r.status}</span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] truncate" title={r.name}>{r.name}</td>
                          <td
                            className={`px-3 py-1.5 whitespace-normal break-keep leading-snug ${r.status === 'converted' ? 'text-slate-500' : 'text-slate-600'}`}
                            title={reasonText}
                          >
                            {reasonText}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length > 1000 && (
                  <p className="text-center text-xs text-slate-500 py-3 italic border-t border-slate-100">
                    상위 1,000행만 표시 — 전체 {filteredRows.length.toLocaleString()}행
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   해석 모델 검증 패널 (00_StageSummary.json 상세)
   ──────────────────────────────────────────────────────────────────────── */

function StageSummaryPanel({
  summary, audit, loading, error, hasResult, bdfResult,
  onLaunchViewer, viewerInstalled, viewerStatus, viewerProgress, viewerError,
  installedVersion, latestVersion,
  editStatus, editApplying, editJobStatus, editTrace, editedSummary, editError,
  onApplyEdit, onRefreshEditStatus,
}) {
  // 본 패널은 두 개의 서브 탭을 가짐: 원본(build-full) / Edit(apply-edit-intent 결과)
  // Edit 탭 진입 가능 여부: edited/ 산출물 또는 *_edit.json 존재 시
  const editAvailable = !!(editStatus?.has_edit_json || editStatus?.has_edited);
  const [subTab, setSubTab] = useState('original');
  // edited 결과가 새로 도착하면 자동으로 Edit 탭으로 전환 (사용자 워크플로 상 자연스러움)
  useEffect(() => {
    if (editStatus?.has_edited) setSubTab('edit');
  }, [editStatus?.has_edited]);

  // 편집 적용이 시작되면 진행을 보여 주는 Edit 탭으로 넘긴다(전체 화면 잠금 대신 이 자리에서 진행 표시).
  useEffect(() => {
    if (editApplying) setSubTab('edit');
  }, [editApplying]);

  if (!hasResult) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ScanSearch size={28} className="text-slate-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">아직 확인할 모델이 없습니다</p>
        <p className="max-w-md text-xs text-slate-600">
          1단계에서 CSV 를 넣고 실행하면 판정과 단계별 변화량, Studio 열기가 여기에 나타납니다.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 w-full min-w-0">
      <StudioLauncher
        bdfResult={bdfResult}
        onLaunchViewer={onLaunchViewer}
        viewerInstalled={viewerInstalled}
        viewerStatus={viewerStatus}
        viewerProgress={viewerProgress}
        viewerError={viewerError}
        installedVersion={installedVersion}
        latestVersion={latestVersion}
        locked={editApplying}
      />

      {/* ── 서브 탭: 원본 / Edit ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <SubTab
          active={subTab === 'original'} onClick={() => setSubTab('original')}
          label="원본 모델" icon={ShieldCheck}
        />
        <SubTab
          active={subTab === 'edit'} onClick={() => setSubTab('edit')}
          label="편집 적용 모델" icon={FileEdit}
          badge={editApplying ? '적용 중' : editStatus?.has_edited ? '적용됨' : (editStatus?.has_edit_json ? '대기' : null)}
          badgeCls={editStatus?.has_edited ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}
          disabled={!editAvailable && !editApplying}
        />
        <button
          type="button"
          onClick={onRefreshEditStatus}
          title="Studio 편집 내역을 다시 확인하고, 새 편집이 있으면 적용합니다"
          aria-label="편집 상태 새로 고침"
          className="ml-auto mb-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
        >
          <RefreshCw size={12} aria-hidden="true" /> 편집 확인
        </button>
      </div>

      {subTab === 'original' && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 단계별 요약을 불러오는 중…
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center py-8 text-red-500 gap-2">
              <AlertCircle size={28} /><p className="text-xs">{error}</p>
            </div>
          )}
          {summary && <StageSummaryDetail summary={summary} audit={audit} />}

        </>
      )}

      {subTab === 'edit' && (
        <EditResultPanel
          editStatus={editStatus}
          editApplying={editApplying}
          editJobStatus={editJobStatus}
          editTrace={editTrace}
          editedSummary={editedSummary}
          originalSummary={summary}
          editError={editError}
          onApplyEdit={onApplyEdit}
        />
      )}
    </div>
  );
}

function SubTab({ active, onClick, label, icon: Icon, badge, badgeCls = '', disabled = false }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 transition-colors text-xs font-semibold cursor-pointer
        ${active
          ? 'border-blue-500 text-blue-700'
          : disabled
            ? 'border-transparent text-slate-500 cursor-not-allowed'
            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
    >
      {Icon && <Icon size={13} />}
      {label}
      {badge && (
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${badgeCls}`}>{badge}</span>
      )}
    </button>
  );
}

/* ── Edit 결과 패널 — apply-trace 요약 + edited final 메트릭 + 원본 대비 Δ ── */
function EditResultPanel({
  editStatus, editApplying, editJobStatus, editTrace, editedSummary, originalSummary,
  editError, onApplyEdit,
}) {
  // 1) 편집 자체가 없는 상태
  if (!editStatus?.has_edit_json && !editStatus?.has_edited) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
        <FileEdit size={24} className="mx-auto mb-2 text-slate-500" aria-hidden="true" />
        <p className="mb-1 text-sm font-semibold text-slate-700">아직 편집 내역이 없습니다</p>
        <p className="text-xs text-slate-600">Studio 에서 모델을 고친 뒤 '최종 모델 출력'을 누르면 자동으로 적용됩니다.</p>
      </div>
    );
  }

  // 2) 적용 진행 중
  if (editApplying) {
    const p = editJobStatus?.progress ?? 0;
    // 진행률 구간으로 지금 하는 일을 추정한다(서버는 단계 이름을 따로 주지 않는다).
    const phase = p < 20 ? '편집 내용을 모델에 반영' : p < 70 ? '편집 모델 Nastran 해석' : 'F06 결과 정리';
    return (
      <JobProgressCard
        title="편집 적용 중"
        message={`${phase} · ${editJobStatus?.message ?? ''}`}
        progress={p}
        note="수 분 걸릴 수 있습니다. 다른 화면으로 이동해도 계속 진행되며, 끝나면 알림이 뜹니다."
      />
    );
  }

  // 3) 편집 JSON은 있는데 적용 안 됨 (또는 재적용 필요)
  const needsApply = editStatus?.needs_apply || (editStatus?.has_edit_json && !editStatus?.has_edited);
  return (
    <div className="space-y-3 w-full min-w-0">
      {needsApply && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
              <AlertCircle size={14} className="text-amber-700" aria-hidden="true" /> 적용하지 않은 편집이 있습니다
            </p>
            <p className="mt-0.5 text-xs text-amber-900">
              {editStatus?.edited_bdf_mtime
                ? '지금 편집본보다 새로운 Studio 편집이 있습니다. 적용해야 후속 해석에 반영됩니다.'
                : 'Studio 에서 저장한 편집 내용을 원본 모델에 적용합니다.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onApplyEdit}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 cursor-pointer"
          >
            <ChevronsRight size={13} aria-hidden="true" /> 편집 적용
          </button>
        </div>
      )}

      {editError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700 break-all">{editError}</p>
        </div>
      )}

      {/* apply-trace 요약 */}
      {editTrace && <EditTraceSummary trace={editTrace} />}

      {/* edited final + 원본 대비 Δ */}
      {editedSummary && (
        <EditedMetricsCard editedSummary={editedSummary} originalSummary={originalSummary} />
      )}

      {/* Nastran F06 진단 — FATAL / ERROR 유무만 간단히 */}
      {editStatus?.has_edited && (
        <NastranDiagnosticsCard diag={editStatus.f06_diagnostics} hasF06={!!editStatus.edited_f06_path} />
      )}
    </div>
  );
}

function EditTraceSummary({ trace }) {
  // apply-trace.json 실제 스키마:
  //   intents[]    — Studio 가 보낸 편집 의도 + Studio 측 검증 결과(validation.status)
  //   operations[] — apply-edit-intent 실제 실행 결과 ({code, level, intentId, kind, details})
  //                  code === "INTENT_APPLIED" + level === "info" 가 적용 성공 마커
  const intents    = Array.isArray(trace?.intents)    ? trace.intents    : [];
  const operations = Array.isArray(trace?.operations) ? trace.operations : [];

  // 적용 성공: operations 의 INTENT_APPLIED 카운트. failed/error 는 level === "error" 로 판정.
  const appliedOps = operations.filter(op => op?.code === 'INTENT_APPLIED');
  const errorOps   = operations.filter(op => String(op?.level || '').toLowerCase() === 'error');
  const total      = intents.length || operations.length;
  const success    = appliedOps.length;
  const failed     = errorOps.length;

  // intent 유형별 카운트 — operations(실제 적용된 것) 기준이 가장 정확.
  // operations 가 비면 intents 의 kind 로 fallback.
  const kindSource = appliedOps.length > 0 ? appliedOps : intents;
  const kindCounts = {};
  kindSource.forEach(it => {
    const k = it?.kind ?? it?.action ?? '기타';
    kindCounts[k] = (kindCounts[k] || 0) + 1;
  });

  // 적용된 작업 상세 라인 (최대 5건 미리보기)
  const detailLines = appliedOps.slice(0, 5).map(op => ({
    kind: op.kind,
    details: op.details || '',
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm w-full min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <FileEdit size={14} className="text-blue-600" />
        <p className="text-sm font-bold text-slate-800">편집 적용 결과</p>
        {trace?.baseStage && (
          <span className="ml-auto text-xs text-slate-600" title={`base: ${trace.baseStage}`}>
            기준 단계 {trace.baseStage}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <SummaryMetric label="편집 항목" value={total.toLocaleString()} variant="neutral" />
        <SummaryMetric label="적용 성공"       value={success.toLocaleString()} variant={failed > 0 || success === 0 ? 'neutral' : 'good'} />
        <SummaryMetric label="실패/거부"       value={failed.toLocaleString()}  variant={failed > 0 ? 'error' : 'neutral'} />
      </div>

      {Object.keys(kindCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="mr-1 text-xs font-semibold text-slate-600">유형</span>
          {Object.entries(kindCounts).map(([kind, count]) => (
            <span key={kind} className="text-[11px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              {kind} <span className="font-bold">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      {detailLines.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <p className="mb-1.5 text-xs font-semibold text-slate-600">적용 상세 ({detailLines.length}/{appliedOps.length})</p>
          <ul className="space-y-1">
            {detailLines.map((d, i) => (
              <li key={i} className="text-[11px] text-slate-600 leading-snug flex items-start gap-1.5">
                <span className="shrink-0 mt-[3px] w-1 h-1 rounded-full bg-blue-400" />
                <span className="font-mono text-slate-500 mr-1">{d.kind}</span>
                <span className="break-all">{d.details}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Nastran F06 FATAL/ERROR 진단 카드 — 결과 메트릭 없이 진단만 표시 ── */
function NastranDiagnosticsCard({ diag, hasF06 }) {
  // F06 자체가 없는 경우 — Nastran 해석이 실패했거나 미실행
  if (!hasF06) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        Nastran 해석 결과(F06)가 없습니다. Nastran 실행이 실패했거나 꺼져 있었습니다.
      </div>
    );
  }
  if (!diag || !diag.available) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        F06 진단 결과를 불러올 수 없습니다.
      </div>
    );
  }
  const fatal = diag.fatalCount ?? 0;
  const error = diag.errorCount ?? 0;

  // 클린: FATAL/ERROR 모두 0
  if (fatal === 0 && error === 0) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" />
          <p className="text-sm font-bold text-emerald-900">Nastran 해석 정상 종료</p>
          <span className="ml-auto text-[11px] font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            FATAL 0 · ERROR 0
          </span>
        </div>
        <p className="text-[11px] text-emerald-800/80 mt-1.5">F06 파일에 FATAL/ERROR 메시지가 없습니다.</p>
      </div>
    );
  }

  // 발생: 카운트 + 샘플 메시지 표시
  return (
    <div className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} className="text-red-600" />
        <p className="text-sm font-bold text-red-900">Nastran 해석 오류 발생</p>
        <span className="ml-auto text-[11px] font-mono text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold">
          FATAL {fatal} · ERROR {error}
        </span>
      </div>

      {fatal > 0 && Array.isArray(diag.fatalSamples) && diag.fatalSamples.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-red-700 mb-1.5">FATAL 메시지</p>
          <div className="space-y-1.5">
            {diag.fatalSamples.map((s, i) => (
              <pre key={i} className="text-[11px] font-mono text-red-900 bg-white border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap break-all leading-snug">{s}</pre>
            ))}
          </div>
        </div>
      )}

      {error > 0 && Array.isArray(diag.errorSamples) && diag.errorSamples.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-red-700 mb-1.5">ERROR 메시지</p>
          <div className="space-y-1.5">
            {diag.errorSamples.map((s, i) => (
              <pre key={i} className="text-[11px] font-mono text-red-900 bg-white border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap break-all leading-snug">{s}</pre>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── edited Final JSON 메트릭 (build-full {designName}.json 동일 스키마)
   원본의 StageSummary `summary` 와 다른 스키마이므로 Final JSON 의 nodes/elements/...
   배열 길이를 직접 카운트하고, meta.massProperties 가 있으면 추가로 표시. ── */
function EditedMetricsCard({ editedSummary, originalSummary }) {
  // editedSummary 는 edited/{designName}.json 전체. Final 스키마는 단일 모델 스냅샷.
  const e = editedSummary ?? {};
  const editCheckStage = buildEditedModelCheckStage(editedSummary);

  // 다양한 스키마 가능성에 방어적으로 대응 — 가장 흔한 키부터 시도
  const countOf = (...candidates) => {
    for (const c of candidates) {
      if (Array.isArray(c)) return c.length;
      if (typeof c === 'number') return c;
    }
    return null;
  };
  const editedNodes = countOf(
    e.nodes, e.Nodes, e.summary?.finalNodeCount, e.meta?.nodeCount
  );
  const editedElements = countOf(
    e.elements, e.Elements, e.beams, e.cbeams, e.summary?.finalElementCount, e.meta?.elementCount
  );
  const editedRigids = countOf(
    e.rigids, e.Rigids, e.rbe2s, e.RBE2, e.summary?.finalRigidCount, e.meta?.rigidCount
  );
  const editedPM = countOf(
    e.pointMasses, e.PointMasses, e.conm2s, e.summary?.finalPointMassCount, e.meta?.pointMassCount
  );

  // 원본 StageSummary 의 finalXxxCount 와 비교 (있을 때만)
  const o = originalSummary?.summary ?? {};
  const fmtDelta = (eVal, oVal) => {
    if (eVal == null || oVal == null) return null;
    const d = (eVal ?? 0) - (oVal ?? 0);
    if (d === 0) return { txt: '±0', cls: 'text-slate-500' };
    if (d > 0)   return { txt: `+${d.toLocaleString()}`, cls: 'text-blue-600' };
    return { txt: d.toLocaleString(), cls: 'text-red-500' };
  };
  const items = [
    { label: '노드',       eVal: editedNodes,    oVal: o.finalNodeCount      },
    { label: '요소 CBEAM', eVal: editedElements, oVal: o.finalElementCount   },
    { label: '강체 RBE2',  eVal: editedRigids,   oVal: o.finalRigidCount     },
    { label: '질점 PM',    eVal: editedPM,       oVal: o.finalPointMassCount },
  ];

  // 질량 특성 — meta.massProperties 또는 root massProperties
  const mp = e.meta?.massProperties ?? e.massProperties ?? null;
  const cgArr = mp?.centerOfGravityMm ?? mp?.cg ?? null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm w-full min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-600" />
        <p className="text-sm font-bold text-slate-800">편집 적용 모델</p>
        <span className="ml-auto text-xs text-slate-600">원본 대비 변화</span>
      </div>

      {/* 4개 핵심 카운트 */}
      <div className="grid grid-cols-4 gap-2">
        {items.map(({ label, eVal, oVal }) => {
          const delta = fmtDelta(eVal, oVal);
          return (
            <div key={label} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm min-w-0 overflow-hidden">
              <p className="text-[11px] text-slate-500 truncate mb-0.5">{label}</p>
              <p className="text-lg font-bold font-mono leading-tight truncate text-slate-800">
                {eVal != null ? eVal.toLocaleString() : '—'}
              </p>
              {delta && (
                <p className={`text-[11px] font-mono leading-none mt-0.5 ${delta.cls}`}>{delta.txt}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 질량 특성 — Final JSON 에 포함된 경우 */}
      {mp && (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 mb-2">질량 특성 (Mass Properties)</p>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-2xl font-bold font-mono text-slate-800 leading-none">
              {Number(mp.totalMassTon ?? mp.totalMassKg / 1000 ?? 0).toFixed(2)}
            </span>
            <span className="text-xs text-slate-500 mb-0.5">ton</span>
            {mp.beamMassTon != null && (
              <span className="ml-auto text-[11px] text-slate-500 font-mono">
                BEAM {Number(mp.beamMassTon).toFixed(2)} · PM {Number(mp.pointMassTon ?? 0).toFixed(2)}
              </span>
            )}
          </div>
          {Array.isArray(cgArr) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500">CG</span>
              {['X', 'Y', 'Z'].map((axis, idx) => (
                <span key={axis} className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                  {axis} {cgArr[idx] != null ? Number(cgArr[idx]).toFixed(0) : '—'} mm
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {editCheckStage && (
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={13} className="text-blue-600" />
            <p className="text-xs font-semibold text-slate-700">
              편집 모델 점검
            </p>
          </div>
          <PhaseDeltaCard stage={editCheckStage} />
        </div>
      )}
    </div>
  );
}

function StudioLauncher({
  bdfResult, onLaunchViewer, viewerInstalled, viewerStatus, viewerProgress, viewerError,
  installedVersion, latestVersion, locked = false,
}) {
  return (
    <StudioLauncherCard
      title="Model Builder Studio"
      description="3D 로 모델을 보고 분리 그룹·자유단을 확인하며, RBE2 추가·그룹 삭제 같은 보정을 합니다. Studio 에서 '최종 모델 출력'을 누르면 이 화면이 편집을 자동으로 적용합니다."
      installed={viewerInstalled}
      status={viewerStatus}
      progress={viewerProgress}
      error={viewerError}
      installedVersion={installedVersion}
      latestVersion={latestVersion}
      ready={!!bdfResult?.outputDir}
      locked={locked}
      notReadyTitle="먼저 Model Builder 실행을 완료하세요"
      lockedTitle="편집 적용이 끝난 뒤 다시 열 수 있습니다."
      onLaunch={onLaunchViewer}
    />
  );
}

/* ── Stage 트랙 — 6단계를 가로로 강제 등분, 클릭 시 해당 stage 선택 ──
   stages: 역순(최종→초기)으로 들어옴. selectedKey/onSelect 로 master-detail 연동.
   부모 박스를 절대 안 넘기 위해: 각 stage 버튼을 flex-basis: 0 + flex-grow: 1 로 강제 등분
   + 모든 텍스트 truncate. 선택 표시는 inset border 로 ring 잘림 방지. */
function StageTrack({ stages, selectedKey, onSelect }) {
  if (!stages.length) return null;
  return (
    <div className="w-full min-w-0">
      <div className="flex items-stretch w-full min-w-0">
        {stages.map((st, i) => {
          const d   = st.diagnostics ?? {};
          const c   = st.counts ?? {};
          const hasErr  = (d.error ?? 0) > 0;
          const isLast  = i === stages.length - 1;
          const isSelected = st.stageIndex === selectedKey;
          // 점 색과 글자는 같은 규칙(에러 유무)을 따른다. 경고는 판정에 쓰지 않으므로 색으로 표시하지 않는다.
          const dotCls  = hasErr ? 'bg-red-600' : 'bg-emerald-600';
          return (
            <React.Fragment key={st.stageIndex ?? i}>
              <button
                type="button"
                onClick={() => onSelect?.(st.stageIndex)}
                style={{ flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 }}
                aria-pressed={isSelected}
                className={`flex flex-col items-center overflow-hidden rounded-lg border px-1.5 py-3 transition-colors cursor-pointer
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50
                  ${isSelected
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="flex flex-col items-center gap-1.5 w-full min-w-0">
                  <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${dotCls}`} />
                  <p className={`text-[12px] font-bold text-center truncate w-full leading-snug
                    ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}
                    title={st.stageName === 'Validation' ? '최종 검증 (Validation)' : st.stageName}>
                    {st.stageName === 'Validation' ? '최종 검증' : st.stageName}
                  </p>
                </div>
                <div className="mt-2.5 w-full min-w-0 space-y-1 text-center">
                  <p className="text-[14px] font-mono font-bold text-slate-800 leading-none truncate" title={`노드 ${(c.nodes ?? 0).toLocaleString()}`}>
                    {(c.nodes ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-none">노드</p>
                  <p className="text-[14px] font-mono font-bold text-slate-800 leading-none mt-1.5 truncate" title={`요소 ${(c.elements ?? 0).toLocaleString()}`}>
                    {(c.elements ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-none">요소</p>
                </div>
                <div className="mt-2.5 w-full flex flex-col items-center gap-0.5 min-w-0">
                  {hasErr
                    ? <span className="text-[11px] font-bold text-red-700">에러 {d.error.toLocaleString()}</span>
                    : <span className="text-[11px] font-semibold text-emerald-700">에러 없음</span>}
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-slate-500 truncate w-full text-center">{st.processingDurationMs ?? 0}ms</p>
              </button>
              {!isLast && (
                <div className="flex items-center shrink-0 px-0.5 pt-3">
                  <ChevronsRight size={11} className="text-slate-500" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-600">단계를 누르면 아래에 그 단계의 변화량이 나옵니다 (왼쪽 1단계 → 오른쪽 최종).</p>
    </div>
  );
}

function StageSummaryDetail({ summary, audit }) {
  const s          = summary?.summary ?? {};
  const stages     = Array.isArray(summary?.stages) ? summary.stages : [];
  // 마스터-디테일: 트랙에서 클릭한 stage만 아래에 표시. 기본 = 최종 단계.
  const [selectedStageIdx, setSelectedStageIdx] = useState(null);
  const effectiveSelectedKey = selectedStageIdx ?? stages[stages.length - 1]?.stageIndex ?? null;
  const selectedStage = stages.find(st => st.stageIndex === effectiveSelectedKey) ?? stages[stages.length - 1];

  // Studio 로드 직후 기본값 = "배관 유체 비움". 엔진이 함께 저장한 fluid-empty 변형이 있으면
  // 그걸 표시해 Studio 화면과 값이 어긋나지 않게 한다. 구버전 summary 는 이 필드가 없어
  // 원본(유체 포함) 값으로 폴백한다.
  const mpFluidEmpty = s.massPropertiesFluidEmpty ?? null;
  const mp     = mpFluidEmpty ?? s.massProperties ?? null;
  const cgArr  = mp?.centerOfGravityMm;
  const isFluidEmpty = !!mpFluidEmpty;

  // 경고는 판정에 쓰지 않지만(대부분 동일 이름 중복) 숨기지도 않는다 — 수를 보여 주고 이유를 함께 적는다.
  const totalErr  = s.totalErrors   ?? 0;
  const totalWarn = s.totalWarnings ?? 0;
  const totalInfo = s.totalInfos    ?? 0;
  const fmtMm = (v) => (v != null ? Number(v).toFixed(0) : '—');
  const massCaption = mp
    ? <>COG X {fmtMm(cgArr?.[0])} · Y {fmtMm(cgArr?.[1])} · Z {fmtMm(cgArr?.[2])} mm{isFluidEmpty && <> · 배관 유체 비움 기준(Studio 기본 표시와 같은 값)</>}</>
    : null;

  return (
    <div className="w-full min-w-0 space-y-3">
      <KeyFigures
        items={[
          { key: 'nodes',    label: '노드',       value: (s.finalNodeCount      ?? 0).toLocaleString() },
          { key: 'elements', label: '요소 CBEAM', value: (s.finalElementCount   ?? 0).toLocaleString() },
          { key: 'rigids',   label: '강체 RBE2',  value: (s.finalRigidCount     ?? 0).toLocaleString() },
          { key: 'pm',       label: '질점 CONM2', value: (s.finalPointMassCount ?? 0).toLocaleString() },
          ...(mp ? [{
            key: 'mass', label: '총중량', value: Number(mp.totalMassTon ?? 0).toFixed(2), unit: 'ton',
            sub: `BEAM ${Number(mp.beamMassTon ?? 0).toFixed(2)} · 질점 ${Number(mp.pointMassTon ?? 0).toFixed(2)}`,
          }] : []),
        ]}
        caption={massCaption}
      />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">진단</span>
        <span className={totalErr > 0 ? 'font-bold text-red-700' : ''}>에러 {totalErr.toLocaleString()}</span>
        <span title="경고는 대부분 동일 이름 중복으로, 판정에 반영하지 않습니다. 단계별 건수는 아래 표에서 볼 수 있습니다.">
          경고 {totalWarn.toLocaleString()} <span className="text-slate-500">(판정 미반영)</span>
        </span>
        <span>정보 {totalInfo.toLocaleString()}</span>
        <span className="ml-auto font-mono text-slate-500">{stages.length}단계 · {s.firstStage ?? '—'} → {s.lastStage ?? '—'}</span>
      </p>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          C. Stage 진행 트랙 + 선택된 stage 상세 (마스터-디테일)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {stages.length > 0 && (
        <div className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800">
              단계별 변화 ({stages.length}단계)
            </h3>
            {selectedStage && (
              <span className="text-[11px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                선택: #{selectedStage.stageIndex} {selectedStage.stageName === 'Validation' ? '최종 검증 (Validation)' : selectedStage.stageName}
              </span>
            )}
          </div>

          <StageTrack
            stages={stages}
            selectedKey={effectiveSelectedKey}
            onSelect={setSelectedStageIdx}
          />

          {/* 선택된 stage 상세 */}
          {selectedStage && (
            <div className="mt-4 pt-4 border-t border-slate-100 w-full min-w-0 overflow-hidden">
              <PhaseDeltaCard stage={selectedStage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ValidationDiagnosticList({ stage }) {
  const records = (stage.diagnosticDetails ?? []).filter(d => String(d.severity).toLowerCase() === 'error' || d.code === 'EMPTY_RIGID_EXCLUDED');
  const failed = stage.diagnostics?.error > 0;
  if (!failed && !records.length) return null;
  return (
    <section aria-label="검증 오류 원인과 조치" className="space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className={`font-bold ${failed ? 'text-red-700' : 'text-amber-800'}`}>{failed ? '검증 실패 — 수정 후 재검증이 필요합니다' : `자동 제외 기록 ${records.length}건`}</p>
        {records.length > 0 && <button type="button" className="text-blue-700 underline shrink-0" onClick={() => downloadDiagnostics(records, `HiTESS_${stage.stageName}_진단`)}>진단 CSV 저장</button>}
      </div>
      <p className="text-slate-600">{failed ? '생성된 단계 모델은 오류 확인용입니다. 오류가 해결된 최종 모델로 해석을 진행하세요.' : '연결 조건을 제공하지 않는 빈 RBE2만 제외했으며 나머지 모델은 보존했습니다.'}</p>
      {stage.diagnosticLoadError && <p role="alert" className="text-red-700">{stage.diagnosticLoadError}</p>}
      {!stage.diagnosticLoadError && failed && records.length === 0 && <p className="text-red-700">오류 개수는 기록됐지만 상세 진단이 없습니다. Studio 또는 실행 로그에서 확인하세요.</p>}
      {records.map((d, i) => {
        const g = describeDiagnostic(d);
        const excluded = d.code === 'EMPTY_RIGID_EXCLUDED';
        return <div key={i} className={`space-y-1 break-words rounded-lg border px-3 py-2 ${excluded ? 'border-amber-200 bg-amber-50/50' : 'border-red-200 bg-red-50/50'}`}>
          <p className={`font-bold ${excluded ? 'text-amber-800' : 'text-red-700'}`}>{g.title} · {d.code}</p>
          <p className="font-mono text-slate-700">{d.elemId != null && `요소/RBE ${d.elemId} `}{d.nodeId != null && `노드 N${d.nodeId}`}</p>
          {d.sourceName && <p className="text-slate-700">입력 이름: {d.sourceName}</p>}
          {d.positionMm && <p className="text-slate-700">위치 XYZ(mm): {d.positionMm.map(v => Number(v).toFixed(1)).join(', ')}</p>}
          <p className="text-slate-700">{g.cause}</p>
          <p className="text-slate-700">조치: {g.action}</p>
          <details className="text-slate-600"><summary className="cursor-pointer">엔진 원문</summary>{d.message}</details>
        </div>;
      })}
    </section>
  );
}

function PhaseDeltaCard({ stage }) {
  const d = stage.delta        ?? {};
  const c = stage.connectivity ?? {};
  const h = stage.health       ?? {};

  const fmtDiff = (n) => n > 0 ? `+${n.toLocaleString()}` : n < 0 ? n.toLocaleString() : '0';
  const diffCls = (n) => n > 0 ? 'text-blue-600' : n < 0 ? 'text-red-500' : 'text-slate-500';

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden w-full min-w-0">
      {/* 카드 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-slate-100">
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold shrink-0">
          #{stage.stageIndex}
        </span>
        <span className="text-xs font-bold text-slate-700 truncate">{stage.stageName === 'Validation' ? '최종 검증 (Validation)' : stage.stageName}</span>
        {(stage.diagnostics?.error ?? 0) > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold shrink-0">
            에러 {stage.diagnostics.error}
          </span>
        )}
        {(stage.diagnostics?.warning ?? 0) > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
            경고 {(stage.diagnostics.warning).toLocaleString()}
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-500 font-mono shrink-0">
          {stage.processingDurationMs ?? 0} ms
        </span>
      </div>

      {/* 3섹션 세로 스택 표 — 부모 폭 절대 넘지 않음 */}
      <div className="px-4 py-3 space-y-3 w-full min-w-0 overflow-hidden">
        <ValidationDiagnosticList stage={stage} />

        {/* 변화량 (Δ) 표 */}
        <div className="w-full min-w-0 overflow-hidden">
          <p className="mb-1 text-xs font-semibold text-slate-700">변화량 (Δ)</p>
          <table className="w-full table-fixed text-[11px]">
            <colgroup>
              <col style={{ width: '50%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <tbody>
              <KvRow label="요소 생성"  val={fmtDiff(d.elementsCreated ?? 0)}     cls={diffCls(d.elementsCreated ?? 0)} />
              <KvRow label="요소 제거"  val={fmtDiff(-(d.elementsRemoved ?? 0))}  cls={diffCls(-(d.elementsRemoved ?? 0))} />
              <KvRow label="요소 분할"  val={(d.elementsSplit ?? 0).toLocaleString()} />
              <KvRow label="노드 병합"  val={(d.nodesMerged   ?? 0).toLocaleString()} />
              <KvRow label="노드 이동"  val={(d.nodesMoved    ?? 0).toLocaleString()} />
              <KvRow label="순 노드 Δ"  val={fmtDiff(d.netNodeDelta    ?? 0)} cls={diffCls(d.netNodeDelta    ?? 0)} bold />
              <KvRow label="순 요소 Δ"  val={fmtDiff(d.netElementDelta ?? 0)} cls={diffCls(d.netElementDelta ?? 0)} bold />
            </tbody>
          </table>
        </div>

        {/* 구분선 */}
        <div className="h-px bg-slate-200" />

        {/* 연결성 + 건전성 — 2열 배치 */}
        <div className="grid grid-cols-2 gap-3 w-full min-w-0">
          {/* 연결성 */}
          <div className="min-w-0 overflow-hidden">
            <p className="mb-1 text-xs font-semibold text-slate-700">연결성</p>
            <table className="w-full table-fixed text-[11px]">
              <colgroup>
                <col style={{ width: '55%' }} />
                <col style={{ width: '45%' }} />
              </colgroup>
              <tbody>
                <KvRow label="그룹 수"       val={(c.groupCount ?? 0).toLocaleString()}
                  cls={(c.groupCount ?? 0) > 10 ? 'text-amber-600' : ''} />
                <KvRow label="최대 그룹 요소" val={(c.largestGroupElementCount ?? 0).toLocaleString()} />
                <KvRow label="최대 그룹 비율" val={c.largestGroupNodeRatio != null ? `${(c.largestGroupNodeRatio * 100).toFixed(1)}%` : '—'} />
                <KvRow label="고립 노드"      val={(c.isolatedNodeCount ?? 0).toLocaleString()}
                  cls={(c.isolatedNodeCount ?? 0) > 0 ? 'text-amber-600' : ''} />
              </tbody>
            </table>
          </div>
          {/* 건전성 */}
          <div className="min-w-0 overflow-hidden">
            <p className="mb-1 text-xs font-semibold text-slate-700">건전성</p>
            <table className="w-full table-fixed text-[11px]">
              <colgroup>
                <col style={{ width: '55%' }} />
                <col style={{ width: '45%' }} />
              </colgroup>
              <tbody>
                <KvRow label="자유단"        val={(h.freeEndCount         ?? 0).toLocaleString()}
                  cls={(h.freeEndCount         ?? 0) > 0 ? 'text-amber-600' : ''} />
                <KvRow label="고립 노드"      val={(h.orphanNodeCount      ?? 0).toLocaleString()}
                  cls={(h.orphanNodeCount      ?? 0) > 0 ? 'text-amber-600' : ''} />
                <KvRow label="짧은 요소"      val={(h.shortElementCount    ?? 0).toLocaleString()}
                  cls={(h.shortElementCount    ?? 0) > 0 ? 'text-red-600'   : ''} />
                <KvRow label="미해결 U-bolt"  val={(h.unresolvedUboltCount ?? 0).toLocaleString()}
                  cls={(h.unresolvedUboltCount ?? 0) > 0 ? 'text-red-600'   : ''} />
                <KvRow label="비연결 그룹"    val={(h.disconnectedGroupCount ?? 0).toLocaleString()}
                  cls={(h.disconnectedGroupCount ?? 0) > 0 ? 'text-amber-600' : ''} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 표 행 헬퍼 (table-fixed 내부에서 사용) ── */
function KvRow({ label, val, cls = '', bold = false }) {
  return (
    <tr>
      <td className="py-0.5 pr-2 text-slate-500 truncate">{label}</td>
      <td className={`py-0.5 text-right font-mono ${bold ? 'font-bold' : ''} ${cls || 'text-slate-700'}`}>{val}</td>
    </tr>
  );
}

function SummaryMetric({ label, value, variant }) {
  const color = variant === 'error' ? 'text-red-600'
              : variant === 'warn'  ? 'text-amber-600'
              : variant === 'good'  ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm min-w-0 overflow-hidden">
      <p className="text-[11px] text-slate-500 truncate mb-0.5">{label}</p>
      <p className={`text-lg font-bold font-mono leading-tight truncate ${color}`}>{value}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Nastran 패널
   ──────────────────────────────────────────────────────────────────────── */

function DeliverPanel({
  bdfResult, hasResult, editStatus, onSendToGmu, onSendToSidePassage, gmuLocked,
  sourceAnalysisId, onRegister, canRegister, onResolveHandoffBdf, onDelivered, massLine, verdict,
}) {
  // 후속 해석으로 넘길 BDF 를 확정하는 동안(edit-status 재조회) 버튼 잠금.
  // 훅은 아래 early return 보다 위에 있어야 한다(rules of hooks).
  const [handoffBusy, setHandoffBusy] = useState(null); // 'gmu' | 'sidepassage' | null

  if (!hasResult) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <PackageCheck size={28} className="text-slate-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-700">아직 받을 BDF 가 없습니다</p>
        <p className="max-w-md text-xs text-slate-600">Model Builder 실행이 끝나면 최종 BDF 와 후속 해석 전달이 여기에 나타납니다.</p>
      </div>
    );
  }
  if (!bdfResult?.outputDir || !bdfResult?.bdfPath) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
        <p className="text-sm text-amber-900">최종 BDF 를 찾을 수 없습니다. 모델 생성이 실패했다면 1·2단계의 원인을 먼저 확인하세요.</p>
      </div>
    );
  }
  const editBdf = editStatus?.edited_bdf_path;

  // ── 후속 해석으로 전달할 BDF = 편집본이 있으면 '항상' 편집본 ─────────────
  // 원본(build-full)과 편집본(edited/)은 파일명이 같고 폴더만 다르므로,
  // 어느 쪽이 넘어가는지 화면에 명시해 두지 않으면 사용자가 확인할 방법이 없다.
  const handoffPath   = editBdf || bdfResult.bdfPath;
  const handoffIsEdit = !!editBdf;
  const handoffName   = handoffIsEdit
    ? makeEditDownloadName(editBdf, 'bdf')
    : fileBaseName(bdfResult.bdfPath || '');
  // 편집 intent(_edit.json)가 편집본 BDF 보다 최신이면 지금 넘길 편집본은 이전 회차의 것이다.
  const handoffStale  = handoffIsEdit && !!editStatus?.needs_apply;

  const sendHandoff = async (which, send) => {
    setHandoffBusy(which);
    try {
      // 전달 직전에 edit-status 를 한 번 더 확인한다. Studio 에서 편집을 적용했지만
      // 이 페이지의 editStatus 가 아직 갱신되지 않은 순간에 원본이 조용히 넘어가는 것을 막는다.
      const fresh = onResolveHandoffBdf ? await onResolveHandoffBdf() : null;
      onDelivered?.('handoff');
      send(fresh || handoffPath);
    } finally {
      setHandoffBusy(null);
    }
  };

  const handoffBtn = 'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50';
  const handoffOn  = 'border-blue-300 bg-white text-blue-800 hover:border-blue-500 hover:bg-blue-50 cursor-pointer';
  const handoffOff = 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed';

  return (
    <div className="space-y-4">
      <section aria-label="BDF 받기" className="space-y-2">
        <h3 className="text-sm font-bold text-slate-800">BDF 받기</h3>
        <FileDownloadRow
          label="원본 최종 BDF"
          filename={fileBaseName(bdfResult.bdfPath)}
          filepath={bdfResult.bdfPath}
          primary={!editBdf}
          onDownloaded={() => onDelivered?.('download')}
          /* 원본과 편집본은 의미가 다르므로 각각 별도 artifact kind 로 등록한다. */
          onRegister={canRegister && sourceAnalysisId ? () => onRegister('modelbuilder_final') : undefined}
        />
        {editBdf ? (
          <FileDownloadRow
            label="편집 적용 BDF"
            filename={makeEditDownloadName(editBdf, 'bdf')}
            filepath={editBdf}
            downloadName={makeEditDownloadName(editBdf, 'bdf')}
            primary
            onDownloaded={() => onDelivered?.('download')}
            onRegister={canRegister && sourceAnalysisId ? () => onRegister('modelbuilder_edited') : undefined}
          />
        ) : (
          <p className="px-1 text-xs text-slate-600">Studio 에서 모델을 고쳐 적용하면 &lsquo;편집 적용 BDF&rsquo;가 여기에 추가됩니다.</p>
        )}
      </section>

      {(onSendToGmu || onSendToSidePassage) && (
        <section aria-label="후속 해석으로 전달" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">후속 해석으로 전달</h3>
            <p className="mt-0.5 text-xs text-slate-600">이 BDF 를 선택한 해석의 입력으로 넘기고 그 화면으로 이동합니다.</p>
          </div>
          {/* 실제로 전달될 파일 — 원본/편집본은 파일명이 같으므로 배지로 구분해 명시한다 */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
              handoffIsEdit ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
            }`}>
              {handoffIsEdit ? '편집 적용 BDF' : '원본 최종 BDF'}
            </span>
            <p className="min-w-0 truncate font-mono text-xs text-slate-700" title={handoffPath}>{handoffName}</p>
            {massLine && <p className="ml-auto shrink-0 text-xs text-slate-600">{massLine}</p>}
          </div>

          {verdict?.level === 'review' && (
            <p className="flex items-start gap-1.5 text-xs text-amber-900">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              2단계 판정이 &lsquo;검토 필요&rsquo;입니다. 사유를 확인한 뒤 전달하세요.
            </p>
          )}
          {handoffStale && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-900">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              Studio 편집 내용이 편집본 BDF 보다 새롭습니다. 2단계에서 편집을 다시 적용한 뒤 전달하세요.
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onSendToGmu && (
              <button
                type="button"
                onClick={() => { if (!gmuLocked && !handoffBusy) sendHandoff('gmu', onSendToGmu); }}
                disabled={gmuLocked || !!handoffBusy}
                title={gmuLocked ? '개발 중인 해석입니다. 관리자만 사용할 수 있습니다.' : undefined}
                className={`${handoffBtn} ${gmuLocked || handoffBusy ? handoffOff : handoffOn}`}
              >
                {handoffBusy === 'gmu'
                  ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  : gmuLocked ? <Lock size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                {gmuLocked ? 'Group & Module Unit 권상 (개발 중)' : 'Group & Module Unit 권상 구조 해석'}
              </button>
            )}
            {onSendToSidePassage && (
              <button
                type="button"
                onClick={() => { if (!handoffBusy) sendHandoff('sidepassage', onSendToSidePassage); }}
                disabled={!!handoffBusy}
                className={`${handoffBtn} ${handoffBusy ? handoffOff : handoffOn}`}
              >
                {handoffBusy === 'sidepassage'
                  ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  : <Send size={14} aria-hidden="true" />}
                Side Passage Assessment
              </button>
            )}
          </div>
          {gmuLocked && (
            <p className="text-xs text-slate-600">권상 해석은 개발 중이라 관리자 계정에서만 전달할 수 있습니다.</p>
          )}
        </section>
      )}
    </div>
  );
}

function FileDownloadRow({ label, filename, filepath, primary, downloadName, onRegister, onDownloaded }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await triggerDownload(filepath, downloadName);
      onDownloaded?.();
    } catch (e) {
      console.warn(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="truncate font-mono text-xs text-slate-600" title={filename}>{filename}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* 등록은 관리자가 명시적으로 눌러야만 시작된다(자동 등록 없음). */}
        {onRegister && (
          <button
            type="button"
            onClick={onRegister}
            title="Model Library 에 등록"
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-blue hover:text-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <DatabaseZap size={12} aria-hidden="true" /> 등록
          </button>
        )}
        <button
          type="button"
          onClick={download}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-60 cursor-pointer ${
            primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          }`}
        >
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />} 받기
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   옵션 — 자주 바꾸는 Mesh size 만 위에 두고 나머지는 '고급'으로 접는다
   ──────────────────────────────────────────────────────────────────────── */

function OptionsPanel({
  meshSize, setMeshSize,
  uboltFullFix, setUboltFullFix,
  useNastran, setUseNastran,
  disabled,
}) {
  const changed = uboltFullFix !== true || useNastran !== false;
  return (
    <section aria-label="실행 옵션" className="space-y-2">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-xs font-bold text-slate-700">Mesh size</span>
          <span className="block text-[11px] text-slate-600">요소 최대 길이</span>
        </span>
        <span className="flex items-center gap-1.5">
          <input
            type="number" value={meshSize} onChange={(e) => setMeshSize(e.target.value)}
            step="10" min="10" disabled={disabled}
            aria-label="Mesh size (mm)"
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
          />
          <span className="text-xs text-slate-600">mm</span>
        </span>
      </label>
      <details className="group rounded-lg border border-slate-200 bg-white" open={changed || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
          고급 옵션
          <span className="flex items-center gap-1 text-[11px] font-normal text-slate-600">
            {changed ? '기본값에서 바뀜' : '기본값'}
            <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <div className="space-y-2.5 border-t border-slate-100 px-3 py-2.5">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-semibold text-slate-700">U-bolt 강체 완전 고정</span>
              <span className="block text-[11px] text-slate-600">U-bolt RBE2 를 6자유도(123456) 모두 묶음</span>
            </span>
            <input
              type="checkbox" checked={uboltFullFix} onChange={(e) => setUboltFullFix(e.target.checked)} disabled={disabled}
              className="h-4 w-4 cursor-pointer rounded text-blue-600 disabled:opacity-50"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-semibold text-slate-700">Nastran 해석까지 실행</span>
              <span className="block text-[11px] text-slate-600">BDF 생성 후 자중(GRAV)·SPC 로 바로 해석. 결과 파일은 산출 폴더에 저장</span>
            </span>
            <input
              type="checkbox" checked={useNastran} onChange={(e) => setUseNastran(e.target.checked)} disabled={disabled}
              className="h-4 w-4 cursor-pointer rounded text-blue-600 disabled:opacity-50"
            />
          </label>
        </div>
      </details>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

// GMU(Group & Module Unit 권상 구조 해석) 후속 전달 대상 메뉴명. ANALYSIS_DATA 의 title 과 일치해야 한다.
const GMU_MENU_NAME = 'Group & Module Unit 권상 구조 해석';
const SIDE_PASSAGE_MENU_NAME = 'Side Passage Assessment';
const MODEL_BUILDER_COMMUNITY_KEY = ANALYSIS_DATA.find(
  app => app.title === 'HiTESS Model Builder',
)?.communityKey;

// GMU 앱이 개발 중(Developing/Planned)이거나 점검 중이면 일반 사용자에게는 전달을
// 막고, 관리자에게만 허용한다. 관리자가 App Settings 에서 내린 판정까지 반영한다.
function isGmuHandoffLocked(overrides) {
  const meta = ANALYSIS_DATA.find(a => a.title === GMU_MENU_NAME);
  if (!meta) return false;
  return isAppBlockedFor(mergeAppSetting(meta, overrides?.[GMU_MENU_NAME]), isAdmin());
}

export default function HiTessModelBuilder() {
  const { showToast } = useToast();
  const { setCurrentMenu, currentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});
  const clearGlobalJob = dashboardCtx?.clearGlobalJob || (() => {});
  const setPageState   = dashboardCtx?.setModelBuilderPageState || (() => {});
  const setGmuHandoff  = dashboardCtx?.setGmuHandoff  || (() => {});
  const setSidePassageHandoff = dashboardCtx?.setSidePassageHandoff || (() => {});
  const saved          = dashboardCtx?.modelBuilderPageState;
  const appOverrides   = useAppSettings();
  // 개발 중/점검 중 + 비관리자 → GMU 전달 버튼 비활성화
  const gmuLocked      = isGmuHandoffLocked(appOverrides);

  // ── 입력 상태 ──
  const [struFile,  setStruFile]  = useState(saved?.struFile ?? null);
  const [pipeFile,  setPipeFile]  = useState(saved?.pipeFile ?? null);
  const [equiFile,  setEquiFile]  = useState(saved?.equiFile ?? null);
  const [struError, setStruError] = useState(null);
  const [pipeError, setPipeError] = useState(null);
  const [equiError, setEquiError] = useState(null);

  // ── CSV 미리보기 ──
  // 실행 전 '1. CSV 입력 검증' 카드 자리에서 입력 CSV 를 표로 확인한다.
  // 'mine' = 내가 올린 파일(브라우저에서 파싱) / 'sample' = 사내 표준 샘플(서버 응답).
  // 샘플을 봐도 업로드 슬롯(struFile 등)은 건드리지 않는다 — 실행 조건이 흔들리면 안 된다.
  const [previewMode,    setPreviewMode]    = useState('mine');
  const [previewTabKey,  setPreviewTabKey]  = useState('stru');
  const [minePreview,    setMinePreview]    = useState({});
  const [samplePreview,  setSamplePreview]  = useState(null);
  const [sampleLoading,  setSampleLoading]  = useState(false);
  const [sampleError,    setSampleError]    = useState(null);

  // ── 옵션 (기본값: useNastran=false, uboltFullFix=true, meshSize=500) ──
  const [meshSize,      setMeshSize]      = useState(saved?.meshSize      ?? DEFAULT_MESH_SIZE_MM);
  const [uboltFullFix,  setUboltFullFix]  = useState(saved?.uboltFullFix  ?? true);
  const [useNastran,    setUseNastran]    = useState(saved?.useNastran    ?? false);

  // ── 작업/결과 상태 ──
  // 이전 버전 페이지 상태(단계 id 가 csv-validation/model-qc/nastran)는 새 단계 정의로 바꾼다.
  const [steps,      setSteps]      = useState(() => (
    saved?.steps?.[0]?.id === INITIAL_STEPS[0].id ? saved.steps : INITIAL_STEPS.map(s => ({ ...s }))
  ));
  const [activeIdx,  setActiveIdx]  = useState(saved?.activeIdx ?? 0);
  const [hasRunOnce, setHasRunOnce] = useState(saved?.hasRunOnce ?? false);
  const [jobStatus,  setJobStatus]  = useState(saved?.jobStatus ?? null);
  const [currentJobId, setCurrentJobId] = useState(saved?.currentJobId ?? null);
  // Model Library 등록은 job_id 가 아니라 Analysis 레코드 id 를 쓴다.
  // 상태 응답의 project.id 가 그 값이며(analysis_runner.record_analysis), GMU 페이지도 같은 방식으로 잡는다.
  const [sourceAnalysisId, setSourceAnalysisId] = useState(saved?.sourceAnalysisId ?? null);
  // '검토 필요' 판정을 사용자가 확인했는지 — 확인하면 2단계가 완료로 바뀐다.
  const [reviewAck, setReviewAck] = useState(saved?.reviewAck ?? false);
  // 결과를 다시 열었을 때(브라우저에 File 객체 없음) 입력 요약에 보여 줄 서버 쪽 입력 파일명.
  const [serverInputs, setServerInputs] = useState(saved?.serverInputs ?? null);
  const [rerunBusy, setRerunBusy] = useState(false);
  // 등록 모달은 관리자가 명시적으로 열 때만 뜬다. 해석 완료가 등록 트리거가 되지 않는다.
  const [registerTarget, setRegisterTarget] = useState(null);
  const canRegisterToStorage = isAdmin();
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [bdfResult,  setBdfResult]  = useState(saved?.bdfResult ?? null);
  const [engineLog,  setEngineLog]  = useState(saved?.engineLog ?? null);
  const [runNastranRequested, setRunNastranRequested] = useState(saved?.runNastranRequested ?? false);

  // ── audit/summary 캐시 ──
  const [auditData,    setAuditData]    = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError,   setAuditError]   = useState(null);
  const [summaryData,    setSummaryData]    = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError,   setSummaryError]   = useState(null);

  // ── viewer 상태 ──
  const [viewerInstalled, setViewerInstalled] = useState(null); // null=확인 전, true/false=결과
  const [viewerStatus,    setViewerStatus]    = useState('idle');
  const [viewerProgress,  setViewerProgress]  = useState(null);
  const [viewerError,     setViewerError]     = useState(null);
  // 버전 동기화: 워크벤치(서버 측 최신 zip 의 manifest.version) ↔ 로컬 설치본 manifest.version
  const [installedVersion, setInstalledVersion] = useState(null); // 로컬 설치본
  const [latestVersion,    setLatestVersion]    = useState(MODEL_BUILDER_STUDIO_VERSION); // Workbench 기준 Studio 버전
  // 백엔드가 다른 머신일 때 result-zip 을 받아 사용자 PC 로컬에 풀어 둔 경로.
  // null 이면 backend.outputDir 을 직접 사용 (dev: 같은 PC).
  const [localResultDir,   setLocalResultDir]   = useState(null);

  // ── Studio 편집 결과(*_edit.json → edited/) 상태 ──
  const [editStatus, setEditStatus] = useState(null); // /edit-status 응답
  const [editApplying, setEditApplying] = useState(false);
  const [editJobStatus, setEditJobStatus] = useState(null); // 편집 적용 job 진행률
  const [editTrace, setEditTrace] = useState(null);   // apply-trace.json
  const [editedSummary, setEditedSummary] = useState(null); // edited/ 의 final json (FEM 메트릭)
  const [editError, setEditError] = useState(null);
  const editPollRef = useRef(null);

  const pollRef    = useRef(null);
  const elapsedRef = useRef(null);

  // ── 마운트 시 Studio 설치 여부 + 서버 최신 버전 동시 조회 ──
  useEffect(() => {
    let cancelled = false;
    // 로컬 설치 확인
    if (window.electron?.invoke) {
      setViewerStatus('checking');
      window.electron.invoke('viewer:check-installed', VIEWER_ID)
        .then((r) => {
          if (cancelled) return;
          setViewerInstalled(r === null ? false : !!r?.installed);
          setInstalledVersion(r?.manifest?.version ?? null);
          setViewerStatus('idle');
        })
        .catch(() => {
          if (cancelled) return;
          setViewerInstalled(false);
          setInstalledVersion(null);
          setViewerStatus('idle');
        });
    } else {
      setViewerInstalled(false);
    }
    // 서버 최신 버전 조회 (실패해도 무시 — 오프라인에서도 기존 설치본은 사용 가능)
    fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`)
      .then(r => r.ok ? r.json() : null)
      .then(meta => {
        if (cancelled) return;
        setLatestVersion(meta?.manifest?.version ?? MODEL_BUILDER_STUDIO_VERSION);
      })
      .catch(() => { /* 서버 미접속 — 무시 */ });
    return () => { cancelled = true; };
  }, []);

  // ── 진행률 이벤트 구독 (viewer install) ──
  useEffect(() => {
    if (!window.electron?.onMessage) return;
    const unsub = window.electron.onMessage('viewer:install-progress', (data) => {
      if (!data || data.viewerId !== VIEWER_ID) return;
      setViewerProgress(data);
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // ── 페이지 상태 지속 저장 (전역 modelBuilderPageState) ──
  // 페이지 이탈 후 우측 하단 글로벌 작업 카드로 복귀(remount)했을 때 입력값·진행 상태를 그대로
  // 복원하기 위해, 복원 대상 상태가 바뀔 때마다 전역에 저장한다. (이 저장부가 없어서 복귀 시
  // saved=null → 항상 '초기 화면'으로 리셋되던 버그를 수정: 위 useState 들이 읽는 saved 를 채워준다.)
  //  • fresh-entry(메뉴 재클릭)  : DashboardContext.resetAnalysisEntryState 가 이 값을 null 로 비워
  //                                새 진입은 정상적으로 초기화된다.
  //  • resume(트레이 카드 클릭)  : 리셋을 건너뛰므로 여기 저장된 값이 그대로 복원된다.
  // struFile 등 File 객체는 localStorage 가 아닌 인메모리 컨텍스트 상태에 담기므로 안전하게 보존된다.
  useEffect(() => {
    setPageState({
      struFile, pipeFile, equiFile,
      meshSize, uboltFullFix, useNastran,
      steps, activeIdx, hasRunOnce,
      jobStatus, currentJobId, sourceAnalysisId, bdfResult,
      engineLog, runNastranRequested, reviewAck, serverInputs,
    });
  }, [
    struFile, pipeFile, equiFile,
    meshSize, uboltFullFix, useNastran,
    steps, activeIdx, hasRunOnce,
    jobStatus, currentJobId, sourceAnalysisId, bdfResult,
    engineLog, runNastranRequested, reviewAck, serverInputs,
    setPageState,
  ]);

  // ── 최초 마운트: globalJob 동기화 ──
  useEffect(() => {
    // 다른 App 해석이 더 최근이어도 이 App 의 해석을 집어야 한다(globalJob 은 최신 1개일 뿐).
    const gj = dashboardCtx?.getJobForMenu?.('HiTESS Model Builder');
    if (saved?.jobStatus?.status === 'Running' && gj) {
      if (gj.status === 'Success' || gj.status === 'Failed' || gj.status === 'Cancelled') {
        setCurrentJobId(gj.jobId);
        fetch(`${API_BASE_URL}/api/analysis/status/${gj.jobId}`, { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then(applyJobResult)
          .catch(() => setJobStatus({ status: 'Failed', progress: 0, message: '상태 조회 실패' }));
      } else if (gj.status === 'Running') {
        setCurrentJobId(gj.jobId);
        startPolling(gj.jobId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 언마운트: 폴링 정리 ──
  useEffect(() => () => {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
  }, []);

  // ── 결과 도착 시 audit/summary 자동 로드 ──
  useEffect(() => {
    if (!bdfResult?.auditPath) { setAuditData(null); return; }
    let cancelled = false;
    setAuditLoading(true); setAuditError(null);
    fetchJson(bdfResult.auditPath)
      .then(d => { if (!cancelled) setAuditData(d); })
      .catch(e => { if (!cancelled) setAuditError(`InputAudit 로드 실패: ${e.message}`); })
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
  }, [bdfResult?.auditPath]);

  useEffect(() => {
    if (!bdfResult?.summaryPath) { setSummaryData(null); return; }
    let cancelled = false;
    setSummaryLoading(true); setSummaryError(null);
    fetchJson(bdfResult.summaryPath)
      .then(async d => {
        const folder = bdfResult.summaryPath.replace(/[^\\/]+$/, '');
        const stages = await Promise.all((d.stages ?? []).map(async stage => {
          if (!(stage.diagnostics?.error > 0) && !(stage.stageName === 'Validation' && stage.diagnostics?.warning > 0)) return stage;
          if (!stage.jsonFile || /[\\/]/.test(stage.jsonFile) || stage.jsonFile.includes('..')) {
            return { ...stage, diagnosticLoadError: '진단 파일 경로가 없습니다. Studio에서 해당 단계의 진단을 확인하세요.' };
          }
          try {
            const phase = await fetchJson(folder + stage.jsonFile);
            return { ...stage, diagnosticDetails: (phase.diagnostics ?? []).map(item => enrichDiagnostic(item, phase)) };
          } catch (e) {
            return { ...stage, diagnosticLoadError: `상세 진단을 불러오지 못했습니다: ${e.message}. Studio에서 해당 단계를 확인하세요.` };
          }
        }));
        if (!cancelled) setSummaryData({ ...d, stages });
      })
      .catch(e => { if (!cancelled) setSummaryError(`StageSummary 로드 실패: ${e.message}`); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [bdfResult?.summaryPath]);

  /* ── 업로드 CSV 미리보기 파싱 ──────────────────────────────────────
     파일이 바뀔 때마다 브라우저에서 직접 읽는다(서버 왕복 없음). 사내 CSV 는
     cp949 로 저장돼 오는 일이 잦아 readCsvFileRows 가 인코딩 폴백까지 처리한다. */
  useEffect(() => {
    const present = [
      ['stru',  struFile],
      ['pipe',  pipeFile],
      ['equip', equiFile],
    ].filter(([, f]) => !!f);

    if (present.length === 0) { setMinePreview({}); return undefined; }

    let cancelled = false;
    setMinePreview(Object.fromEntries(
      present.map(([key, file]) => [key, { filename: file.name, loading: true }])
    ));

    (async () => {
      const entries = await Promise.all(present.map(async ([key, file]) => {
        try {
          const parsed = await readCsvFileRows(file);
          return [key, { filename: file.name, ...parsed }];
        } catch (e) {
          return [key, { filename: file.name, error: e?.message || 'CSV를 읽지 못했습니다.' }];
        }
      }));
      if (!cancelled) setMinePreview(Object.fromEntries(entries));
    })();

    return () => { cancelled = true; };
  }, [struFile, pipeFile, equiFile]);

  /* ── 사내 표준 샘플 CSV 미리보기 ───────────────────────────────────
     한 번 받은 응답은 samplePreview 에 캐시해 재요청하지 않는다. */
  const openSamplePreview = useCallback(async () => {
    setPreviewMode('sample');
    setActiveIdx(0);   // 미리보기가 사는 'CSV 입력 검증' 스텝으로 이동
    if (samplePreview || sampleLoading) return;

    setSampleLoading(true);
    setSampleError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/sample-preview`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        handleUnauthorized(res.status);
        let detail = `HTTP ${res.status}`;
        try { const b = await res.json(); if (b?.detail) detail = b.detail; } catch { /* 본문 없음 */ }
        throw new Error(detail);
      }
      const data = await res.json();
      setSamplePreview(data);
      const firstKey = ['stru', 'pipe', 'equip'].find(k => data?.[k]?.rows?.length);
      if (firstKey) setPreviewTabKey(firstKey);
    } catch (e) {
      setSampleError(`샘플 CSV를 불러오지 못했습니다. (${e.message})`);
      showToast('샘플 CSV 미리보기를 불러오지 못했습니다.', 'error');
    } finally {
      setSampleLoading(false);
    }
  }, [samplePreview, sampleLoading, showToast]);

  /* ── CSV 자동 분류: 단일 드롭 ──────────────────────────────────────── */
  const handleAutoAssign = useCallback(async (file, slotHint) => {
    const prevPipe  = pipeFile;
    const prevEquip = equiFile;

    let headerType = null;
    try { headerType = await detectCsvType(file); } catch { /* skip */ }
    const guessed   = guessTypeFromFilename(file.name);
    const finalType = headerType || guessed || slotHint;

    const setters = {
      stru:  [setStruFile,  setStruError],
      pipe:  [setPipeFile,  setPipeError],
      equip: [setEquiFile,  setEquiError],
    };

    const makeError = (slot, actual) => {
      if (!actual || slot === actual) return null;
      const labels = { stru: 'Structural', pipe: 'Piping', equip: 'Equipment' };
      return `${labels[actual] ?? actual} CSV로 감지됨. 올바른 칸에 배치되었습니다.`;
    };

    if (finalType !== slotHint) {
      const [, setErr] = setters[slotHint] || [];
      if (setErr) setErr(null);
      const [setFile, setErr2] = setters[finalType] || [];
      if (setFile) {
        setFile(file);
        if (setErr2) setErr2(makeError(slotHint, finalType));
      } else {
        const [setFileSlot, setErrSlot] = setters[slotHint] || [];
        if (setFileSlot) setFileSlot(file);
        if (setErrSlot)  setErrSlot('파일 유형을 자동 인식할 수 없습니다. CSV 구조를 확인하세요.');
      }
    } else {
      const [setFile, setErr] = setters[slotHint] || [];
      if (setFile) setFile(file);
      if (setErr) {
        if (headerType && headerType === slotHint) setErr(null);
        else if (!headerType && guessed === slotHint) setErr(null);
        else if (!headerType && !guessed) setErr('__warn__CSV 헤더/파일명 자동 인식 불가. 올바른 파일인지 확인하세요.');
        else setErr(null);
      }
    }

    // stru 파일 확정 시 동일 폴더의 pipe/equip 형제 CSV 자동 배치 (Electron only)
    if (finalType === 'stru' && window.electron?.invoke) {
      const placed = await scanSiblingCsvs(file, {
        skipPipe:  !!prevPipe,
        skipEquip: !!prevEquip,
        setters,
      });
      if (placed.length > 0) showToast(`동일 폴더에서 CSV ${placed.length}개를 자동 배치했습니다.`, 'success');
    }
  }, [pipeFile, equiFile, showToast]);

  /* ── CSV 자동 분류: 다중 드롭 ──────────────────────────────────────── */
  const handleMultipleFiles = useCallback(async (files) => {
    let assignedStru = null;
    const setters = {
      stru:  [setStruFile,  setStruError],
      pipe:  [setPipeFile,  setPipeError],
      equip: [setEquiFile,  setEquiError],
    };
    for (const file of files) {
      let headerType = null;
      try { headerType = await detectCsvType(file); } catch (_) {}
      const guessed   = guessTypeFromFilename(file.name);
      const finalType = headerType || guessed;
      if (!finalType) continue;
      const [setFile, setErr] = setters[finalType] || [];
      if (setFile) {
        setFile(file);
        if (setErr) setErr(null);
        if (finalType === 'stru') assignedStru = file;
      }
    }
    showToast(`CSV ${files.length}개를 자동 분류했습니다.`, 'success');

    if (assignedStru && window.electron?.invoke) {
      const placed = await scanSiblingCsvs(assignedStru, {
        skipPipe:  !!pipeFile,
        skipEquip: !!equiFile,
        setters,
      });
      if (placed.length > 0) showToast(`동일 폴더에서 추가 CSV ${placed.length}개를 자동 배치했습니다.`, 'success');
    }
  }, [pipeFile, equiFile, showToast]);

  // 대시보드 '새 해석 시작'에 놓은 파일을 이어받는다(이 화면의 업로드 처리와 같은 경로)
  // 배정은 비동기(헤더 판별 + 같은 폴더 형제 CSV 스캔)라, 끝난 뒤에 자동 실행이 걸리도록 완료 표시를 남긴다.
  const [handoffAssigned, setHandoffAssigned] = useState(null);
  useDashboardFilesHandoff('HiTESS Model Builder', async (files) => {
    try {
      if (files.length > 1) await handleMultipleFiles(files);
      else await handleAutoAssign(files[0], 'stru');
    } finally {
      setHandoffAssigned(Date.now());
    }
  }, ['.csv']);

  /* ── 동일 폴더 형제 CSV 자동 스캔 (Electron) ─────────────────────── */
  const scanSiblingCsvs = async (struFile, options = {}) => {
    if (!struFile || !window.electron?.invoke) return [];
    const struPath = window.electron.getPathForFile?.(struFile) || struFile.path || '';
    if (!struPath) return [];
    const dirPath = struPath.replace(/[/\\][^/\\]+$/, '');
    let siblings;
    try { siblings = await window.electron.invoke('list-dir-csvs', dirPath); } catch { return []; }
    if (!siblings?.length) return [];

    const struInfo = extractBaseAndKeyword(struFile.name, CSV_TYPE_KEYWORDS.stru);
    const placed = [];

    for (const { name, filePath } of siblings) {
      if (name === struFile.name) continue;
      const guessed = guessTypeFromFilename(name);
      if (guessed === 'stru') continue;

      if (guessed) {
        if (!options.setters[guessed]) continue;
        if (guessed === 'pipe'  && options.skipPipe)  continue;
        if (guessed === 'equip' && options.skipEquip) continue;
        if (struInfo) {
          const sibInfo = extractBaseAndKeyword(name, CSV_TYPE_KEYWORDS[guessed] || []);
          if (sibInfo && sibInfo.base !== struInfo.base) continue;
        }
      } else if (struInfo && !name.toLowerCase().includes(struInfo.base)) continue;

      let buffer;
      try { buffer = await window.electron.invoke('read-file-buffer', filePath); } catch { continue; }
      if (!buffer) continue;

      const siblingFile = new File([buffer], name, { type: 'text/csv' });
      let headerType = null;
      try { headerType = await detectCsvType(siblingFile); } catch { /* skip */ }
      const finalType = headerType || guessed;
      if (!finalType || finalType === 'stru') continue;
      if (!options.setters[finalType]) continue;
      if (guessed && headerType && guessed !== headerType) continue;
      if (finalType === 'pipe'  && options.skipPipe)  continue;
      if (finalType === 'equip' && options.skipEquip) continue;

      const [setFile, setErrFn] = options.setters[finalType] || [];
      if (setFile) {
        setFile(siblingFile);
        if (setErrFn) setErrFn(null);
        placed.push(finalType);
      }
    }
    return placed;
  };

  /* ── 실행 ──────────────────────────────────────────────────────────── */
  const handleRunModelBuilder = async () => {
    // Structural 또는 Piping CSV 중 하나만 있어도 실행 가능(횡방향/배관 단독 모델 지원).
    if (!struFile && !pipeFile) { showToast('Structural 또는 Piping CSV 파일이 필요합니다.', 'warning'); return; }
    const isHardError = (e) => e && !e.startsWith('__warn__');
    if (isHardError(struError) || isHardError(pipeError) || isHardError(equiError)) {
      showToast('파일 형식 오류를 먼저 해결하세요.', 'warning'); return;
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const formData = new FormData();
    if (struFile) formData.append('stru_file', struFile);
    if (pipeFile) formData.append('pipe_file',  pipeFile);
    if (equiFile) formData.append('equip_file', equiFile);
    formData.append('employee_id', user.employee_id || 'unknown');
    formData.append('mesh_size',      String(parseInt(meshSize, 10) || Number(DEFAULT_MESH_SIZE_MM)));
    formData.append('ubolt_full_fix', String(!!uboltFullFix));
    formData.append('run_nastran',    String(!!useNastran));

    beginRun('파일 전송 중…', !!useNastran);
    setServerInputs(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/request`, {
        method: 'POST', body: formData, headers: getAuthHeaders(),
      });
      if (!res.ok) {
        handleUnauthorized(res.status);
        let detail = `HTTP ${res.status}`;
        try { const b = await res.json(); detail += ` — ${b.detail ?? JSON.stringify(b)}`; } catch {}
        throw new Error(detail);
      }
      const data = await res.json();
      setCurrentJobId(data.job_id);
      startPolling(data.job_id);
      startGlobalJob(data.job_id, 'HiTESS Model Builder');
    } catch (e) {
      setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error' } : s));
      setJobStatus({ status: 'Failed', progress: 0, message: `요청 실패: ${e.message}` });
      setEngineLog(`[요청 실패]\n서버: ${API_BASE_URL}\n오류: ${e.message}`);
    }
  };

  // 실행 시작 공통 상태 — 직접 실행·샘플 실행·옵션 바꿔 재실행이 같은 출발점을 쓴다.
  const beginRun = (message, nastran) => {
    setHasRunOnce(true);
    setRunNastranRequested(!!nastran);
    setActiveIdx(0);
    setBdfResult(null);
    setReviewAck(false);
    setElapsedSecs(0);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    setAuditData(null);
    setSummaryData(null);
    setEngineLog(null);
    setSteps(INITIAL_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'running' : 'wait' })));
    setJobStatus({ status: 'Running', progress: 5, message });
  };

  // 같은 입력 CSV 로 옵션만 바꿔 다시 실행. 브라우저에 파일이 있으면 그대로 다시 올리고,
  // 결과를 다시 연 경우처럼 파일이 없으면 서버에 남은 원본 CSV 로 재실행한다(POST /analysis/{id}/rerun).
  const handleRerunSameInputs = async () => {
    if (struFile || pipeFile) { handleRunModelBuilder(); return; }
    if (!sourceAnalysisId) {
      showToast('다시 실행할 입력 파일이 없습니다. CSV 를 올려 주세요.', 'warning');
      return;
    }
    const mesh = Number(meshSize);
    if (!Number.isFinite(mesh) || mesh <= 0) { showToast('Mesh size 를 확인하세요.', 'warning'); return; }
    setRerunBusy(true);
    beginRun('서버에 남은 입력 CSV 로 다시 실행 요청 중…', !!useNastran);
    try {
      const res = await rerunAnalysisProject(sourceAnalysisId, {
        mesh_size: mesh, ubolt_full_fix: !!uboltFullFix, run_nastran: !!useNastran,
      });
      const jobId = res.data?.job_id;
      if (!jobId) throw new Error('작업 ID 를 받지 못했습니다.');
      setCurrentJobId(jobId);
      startPolling(jobId);
      startGlobalJob(jobId, 'HiTESS Model Builder');
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setSteps(prev => prev.map((s, i) => (i === 0 ? { ...s, status: 'error' } : s)));
      setJobStatus({ status: 'Failed', progress: 0, message: `재실행 요청 실패: ${detail}` });
      setEngineLog(`[재실행 요청 실패]
오류: ${detail}`);
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    } finally {
      setRerunBusy(false);
    }
  };

  // 샘플 실행 콜백 — SampleRunButton 이 호출. 실제 build-full 흐름과 동일하게 폴링 시스템에 등록.
  const sampleMfBefore = () => {
    beginRun('샘플 파일 준비 중…', false);
    setServerInputs({ stru: '사내 표준 샘플', pipe: '사내 표준 샘플', equip: '사내 표준 샘플' });
  };
  const sampleMfSubmitted = (jobId) => {
    setCurrentJobId(jobId);
    startPolling(jobId);
    startGlobalJob(jobId, 'HiTESS Model Builder');
  };
  const sampleMfError = (st, detail) => {
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    if (st === 429) {
      // 토스트는 컴포넌트가 표시. 페이지 상태는 idle 로 복귀.
      setSteps(prev => prev.map((s, i) => (i === 0 ? { ...s, status: 'wait' } : s)));
      setJobStatus(null);
      setHasRunOnce(false);
    } else {
      setSteps(prev => prev.map((s, i) => (i === 0 ? { ...s, status: 'error' } : s)));
      setJobStatus({ status: 'Failed', progress: 0, message: `샘플 실행 실패: ${detail}` });
      setEngineLog(`[샘플 요청 실패]\n오류: ${detail}`);
    }
  };

  /* ── 폴링 ──────────────────────────────────────────────────────────── */
  const startPolling = (jobId) => {
    setCurrentJobId(jobId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        setJobStatus(data);
        if (typeof data.project?.id === 'number') setSourceAnalysisId(data.project.id);


        // Cancelled(사용자 중단)도 종료 상태 — 빠지면 폴러가 멈추지 않는다.
        if (data.status === 'Success' || data.status === 'Failed' || data.status === 'Cancelled') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          applyJobResult(data);
        }
      } catch {
        clearInterval(pollRef.current);
        pollRef.current = null;
        if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
      }
    }, 1500);
  };

  const applyJobResult = useCallback((data) => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    setJobStatus(data);
    if (typeof data.project?.id === 'number') setSourceAnalysisId(data.project.id);
    if (data.status === 'Success') {
      setBdfResult({
        outputDir:    data.output_dir   ?? null,
        auditPath:    data.audit_path   ?? null,
        summaryPath:  data.summary_path ?? null,
        bdfPath:      data.bdf_path     ?? null,
        jsonPath:     data.json_path    ?? null,
      });
      // 새 모델이 나왔다 — 이전 모델로 열려 있는 Model Builder Studio 창에 경고를 띄운다.
      // (Studio 가 안 떠 있거나 같은 모델이면 main 이 무시한다.)
      notifyStudioSourceUpdated(
        VIEWER_ID,
        data.output_dir ?? null,
        'Model Builder 가 모델을 다시 만들었습니다. 이 창은 이전 빌드를 보고 있습니다 — WorkBench 에서 Studio 를 다시 여세요.',
      );
      // 1단계만 완료. 2단계는 판정(통과)·검토 확인·편집 적용으로, 3단계는 BDF 받기·전달로 완료된다.
      setSteps(INITIAL_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'done' : 'wait' })));
      // 실행이 끝나면 판정을 보는 2단계로 간다(2026-10-01 사용자 결정 — 예전엔 1단계로 되돌아갔다).
      setActiveIdx(1);
    } else if (data.status === 'Failed' || data.status === 'Cancelled') {
      if (data.status === 'Failed' && data.output_dir) {
        setBdfResult({ outputDir: data.output_dir, auditPath: data.audit_path ?? null,
          summaryPath: data.summary_path ?? null, bdfPath: null, jsonPath: null });
        setActiveIdx(1);
      }
      setSteps(prev => prev.map((s, i) => {
        if (i === 0) return { ...s, status: data.audit_path ? 'done' : 'error' };
        if (i === 1) return { ...s, status: data.output_dir ? 'error' : 'wait' };
        return { ...s, status: 'wait' };
      }));
      setEngineLog(
        data.engine_log
        || data.message
        || (data.status === 'Cancelled' ? '사용자 요청으로 해석을 중단했습니다.' : '알 수 없는 오류'),
      );
    }
  }, []);

  /* ── 지난 결과 다시 열기 (My Projects·대시보드 → 결과 화면) ─────────────
     브라우저 메모리의 페이지 상태가 아니라 서버 기록(result_info 의 산출 폴더)으로 복원한다.
     그래서 앱을 떠났다 오거나 다른 날에도 같은 결과 화면으로 돌아올 수 있다. */
  const applyResultReentry = async (analysisId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/${analysisId}`, { headers: getAuthHeaders() });
      if (!res.ok) { handleUnauthorized(res.status); throw new Error(`HTTP ${res.status}`); }
      const rec = await res.json();
      if (rec.program_name !== 'HiTessModelBuilder') throw new Error('Model Builder 기록이 아닙니다.');
      const info = rec.result_info || {};
      const input = rec.input_info || {};
      if (!info.output_dir) throw new Error('이 기록에는 결과 폴더 정보가 없습니다.');
      if (rec.files_available === false) throw new Error('결과 파일이 보관 기간이 지나 삭제되었습니다.');

      handleReset();
      setMeshSize(String(input.mesh_size ?? DEFAULT_MESH_SIZE_MM));
      setUboltFullFix(input.ubolt_full_fix ?? true);
      setUseNastran(!!input.run_nastran);
      setServerInputs({
        stru:  input.stru_csv  ? fileBaseName(input.stru_csv)  : null,
        pipe:  input.pipe_csv  ? fileBaseName(input.pipe_csv)  : null,
        equip: input.equip_csv ? fileBaseName(input.equip_csv) : null,
      });
      setHasRunOnce(true);
      applyJobResult({
        status: rec.status === 'Success' ? 'Success' : 'Failed',
        progress: 100,
        message: rec.job_message || '지난 결과',
        project: { id: rec.id },
        output_dir: info.output_dir,
        audit_path: info.audit_path,
        summary_path: info.summary_path,
        bdf_path: info.bdf_path,
        json_path: info.json_path,
        engine_log: rec.status === 'Success' ? null : (rec.job_message || null),
      });
      const when = rec.created_at ? new Date(rec.created_at).toLocaleString('ko-KR') : '';
      showToast(`지난 결과를 열었습니다${when ? ` (${when})` : ''}.`, 'success');
    } catch (e) {
      showToast(`결과를 열지 못했습니다: ${e.message}`, 'error');
    }
  };
  useResultReentry('HiTESS Model Builder', applyResultReentry);

  /* ── 최근 실행의 입력 불러오기 ──────────────────────────────────────
     그 실행에 쓴 CSV 를 서버 보관본에서 받아 File 로 만들어 입력 칸에 넣는다. 사용자가 직접 올린 것과
     같은 상태라 미리보기·실행 전 점검·업로드 실행이 그대로 돈다. 옵션(Mesh size·U-bolt·Nastran)도 그 실행 값으로. */
  const applyRecentInput = async (record) => {
    const input = record?.input_info || {};
    const slots = [
      ['stru',  input.stru_csv,  setStruFile, setStruError],
      ['pipe',  input.pipe_csv,  setPipeFile, setPipeError],
      ['equip', input.equip_csv, setEquiFile, setEquiError],
    ].filter(([, path]) => !!path);
    if (slots.length === 0) { showToast('이 실행에는 불러올 CSV 정보가 없습니다.', 'warning'); return; }
    try {
      const files = await Promise.all(slots.map(async ([, path]) => {
        const res = await fetch(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(path)}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); throw new Error(res.status === 404 ? `${fileBaseName(path)} 이 서버에 없습니다` : `HTTP ${res.status}`); }
        return new File([await res.blob()], fileBaseName(path), { type: 'text/csv' });
      }));
      handleReset();
      setMeshSize(String(input.mesh_size ?? DEFAULT_MESH_SIZE_MM));
      setUboltFullFix(input.ubolt_full_fix ?? true);
      setUseNastran(!!input.run_nastran);
      slots.forEach(([, , setFile, setErr], i) => { setFile(files[i]); setErr(null); });
      showToast(`최근 실행의 CSV ${files.length}개와 옵션을 불러왔습니다.`, 'success');
    } catch (e) {
      showToast(`입력을 불러오지 못했습니다: ${e.message}`, 'error');
    }
  };

  /* ── viewer 런처 ───────────────────────────────────────────────────── */
  const launchAlgorithmViewer = useCallback(async () => {
    if (!window.electron?.invoke) {
      showToast('Electron 환경에서만 Studio를 사용할 수 있습니다.', 'error');
      return;
    }
    if (!bdfResult?.outputDir) {
      showToast('먼저 Model Builder 실행을 완료하세요.', 'warning');
      return;
    }
    setViewerError(null);
    try {
      setViewerStatus('checking');
      const check = await window.electron.invoke('viewer:check-installed', VIEWER_ID);
      if (check === null) throw new Error('IPC viewer:check-installed 미등록');

      // 서버 최신 manifest 를 항상 먼저 조회 — 버전 비교 기준
      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`);
      if (!manifestRes.ok) throw new Error(`manifest 조회 실패: HTTP ${manifestRes.status}`);
      const meta = await manifestRes.json();
      const serverVer = meta?.manifest?.version ?? null;
      const localVer  = check?.manifest?.version ?? null;
      setLatestVersion(serverVer);

      // 미설치 OR 버전 불일치 → 자동 재설치 (electron 측 install 핸들러가 기존 폴더 자동 삭제 후 재압축)
      const needInstall = !check?.installed || (serverVer && localVer && serverVer !== localVer);
      if (needInstall) {
        const reason = !check?.installed
          ? '미설치 — 다운로드 시작'
          : `버전 불일치 (설치본 v${localVer} ≠ 워크벤치 v${serverVer}) — 새 버전으로 자동 업데이트`;
        showToast(reason, 'info');
        setViewerStatus('installing');
        const installRes = await window.electron.invoke('viewer:install', {
          viewerId:       VIEWER_ID,
          downloadUrl:    `${API_BASE_URL}${meta.downloadUrl}`,
          // 사내 storage UNC 경로 — DRM/프록시 우회용. Electron 측 핸들러가 우선 시도하고
          // 실패 시 downloadUrl 로 폴백.
          uncPath:        meta.uncPath,
          expectedSha256: meta.sha256,
        });
        if (installRes === null) throw new Error('IPC viewer:install 미등록');
        if (!installRes?.ok)     throw new Error(installRes?.error || '설치 실패');
        setViewerInstalled(true);
        setInstalledVersion(installRes?.manifest?.version ?? serverVer);
      }

      setViewerStatus('ready');

      // ── 결과 폴더 접근 가능성 검사 + 필요 시 다운로드 ──────────────────
      // dev: 백엔드와 사용자 PC 가 같은 머신 → outputDir 이 직접 fs 로 접근 가능 → 그대로 사용.
      // production: 백엔드가 다른 머신 → result-zip 으로 받아 사용자 PC 로컬 temp 에 풀어서 사용.
      let initialFolder = bdfResult.outputDir;
      const access = await window.electron.invoke('viewer:checkPathAccess', {
        path: bdfResult.outputDir,
      });
      if (!access?.accessible) {
        showToast('결과 폴더 다운로드 중...', 'info');
        const params = new URLSearchParams({ output_dir: bdfResult.outputDir });
        const downloadUrl = `${API_BASE_URL}/api/analysis/modelflow/result-zip?${params}`;
        const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
          downloadUrl,
          jobId: jobStatus?.job_id || bdfResult.outputDir.split(/[\\/]/).pop(),
          headers: getAuthHeaders(),  // 실제 인증 체계(localStorage 'user') 사용 — 'session_token'은 미저장 키
        });
        if (fetchRes === null) throw new Error('IPC viewer:fetchResultDir 미등록');
        if (!fetchRes?.ok) throw new Error(fetchRes?.error || '결과 폴더 다운로드 실패');
        initialFolder = fetchRes.dir;
        setLocalResultDir(fetchRes.dir);
      } else {
        setLocalResultDir(null);
      }

      const openRes = await window.electron.invoke('viewer:open', {
        viewerId:      VIEWER_ID,
        initialFolder,
        // ★ Studio 구조해석(solve)이 호출할 백엔드 주소. 형제 스튜디오(Mooring/SidePassage/
        //   ModuleUnit/Plate)와 동일하게 반드시 넘긴다. 누락하면 electron main 이
        //   viewerServerUrl 을 못 잡아 하드코딩 기본값(DEFAULT_BACKEND_BASE_URL=145)으로
        //   폴백 → config.js 가 70 이어도 solve 가 145 로 가 404 가 난다.
        serverUrl:     API_BASE_URL,
        // 이 창이 보고 있는 원본 모델 식별자. 이후 새 빌드가 나오면 main 이 이 값과 비교해
        // 열려 있는 Studio 에 "원본이 갱신됨" 배너를 띄운다.
        sourceKey:     bdfResult?.outputDir ?? null,
        // 서버측 ModelFlow 빌드 산출 폴더(userConnection 하위) — Studio 의 구조해석(Analysis)
        // 이 백엔드 work_dir 로 쓴다. initialFolder(로컬 로드 폴더)와 달리 prod 에선 서버 경로라
        // 반드시 별도로 등록해야 viewer:runModelBuilderSolve 가 output_dir 을 찾는다.
        outputDir:     bdfResult.outputDir,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok)     throw new Error(openRes?.error || '오픈 실패');
      setViewerStatus('idle');

      // Studio 풀스크린 창이 닫힌 직후 — *_edit.json 신규 작성 여부를 즉시 확인.
      // 신규 / 갱신 시 자동으로 apply-edit-intent 트리거.
      try {
        await refreshEditStatusAndMaybeApply();
      } catch (err) {
        console.warn('[apply-edit] refreshEditStatus failed', err);
      }
    } catch (e) {
      setViewerError(e.message);
      setViewerStatus('error');
      showToast(`Viewer 실패: ${e.message}`, 'error');
    }
    // refreshEditStatusAndMaybeApply 는 아래에서 정의 — eslint react-hooks/exhaustive-deps 무시 OK
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bdfResult?.outputDir, showToast]);

  /* ── Edit 적용 흐름: edit-status 폴 + 필요 시 apply-edit POST ──────── */
  const refreshEditStatus = useCallback(async () => {
    if (!bdfResult?.outputDir) return null;
    setEditError(null);
    try {
      const url = `${API_BASE_URL}/api/analysis/modelflow/edit-status?output_dir=${encodeURIComponent(bdfResult.outputDir)}`;
      const r = await fetch(url, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setEditStatus(data);
      return data;
    } catch (e) {
      setEditError(`편집 상태 조회 실패: ${e.message}`);
      return null;
    }
  }, [bdfResult?.outputDir]);

  /* Edit 적용을 두 단계로 분리:
     - Phase 1 (start)  : POST /apply-edit → job_id 즉시 회수.   Studio 의 finalize 응답에 사용.
     - Phase 2 (poll)   : 1.5 s 주기로 status 조회. 백그라운드 진행.
     이 분리로 Studio 는 수 분간의 Nastran 해석을 기다리지 않고 즉시 닫힐 수 있고,
     워크벤치 페이지는 Phase 1 직후부터 editApplying=true 로 오버레이를 즉시 띄움. */

  const startApplyEditJob = useCallback(async (overrideOutputDir) => {
    const outputDir = overrideOutputDir || bdfResult?.outputDir;
    if (!outputDir) return { ok: false, error: 'output_dir 정보가 없습니다.' };
    setEditError(null);
    setEditApplying(true);  // ← 오버레이 즉시 활성화
    setEditJobStatus({ status: 'Pending', progress: 0, message: '편집 적용 요청 중...' });
    try {
      const r = await fetch(`${API_BASE_URL}/api/analysis/modelflow/apply-edit`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_dir: outputDir, strict: false }),
      });
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try { const b = await r.json(); detail += ` — ${b.detail ?? JSON.stringify(b)}`; } catch {}
        throw new Error(detail);
      }
      const { job_id } = await r.json();
      return { ok: true, jobId: job_id };
    } catch (e) {
      setEditApplying(false);
      setEditJobStatus(null);
      const msg = `편집 적용 요청 실패: ${e.message}`;
      setEditError(msg);
      return { ok: false, error: msg };
    }
  }, [bdfResult?.outputDir]);

  const pollEditJobInBackground = useCallback((jobId) => {
    if (editPollRef.current) { clearInterval(editPollRef.current); editPollRef.current = null; }
    editPollRef.current = setInterval(async () => {
      try {
        const sr = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!sr.ok) { handleUnauthorized(sr.status); return; }
        const sd = await sr.json();
        setEditJobStatus(sd);
        if (sd.status === 'Success' || sd.status === 'Failed' || sd.status === 'Cancelled') {
          clearInterval(editPollRef.current);
          editPollRef.current = null;
          setEditApplying(false);
          if (sd.status === 'Success') {
            await refreshEditStatus();
            // 편집을 적용했으면 2단계(확인·보정)는 끝난 것이다. 3단계는 BDF 받기·전달로 끝난다.
            setActiveIdx(2);
            setSteps(prev => prev.map((s, i) => (i <= 1 ? { ...s, status: 'done' } : s)));
            if (currentJobId) clearGlobalJob(currentJobId);
            showToast('편집을 적용했습니다. 편집 적용 BDF 를 받거나 후속 해석으로 전달하세요.', 'success');
          } else {
            const errText = sd.engine_log || sd.message || '편집 적용 실패';
            setEditError(errText);
            showToast(`편집 적용 실패: ${sd.message ?? errText}`, 'error');
          }
        }
      } catch (err) {
        clearInterval(editPollRef.current);
        editPollRef.current = null;
        setEditApplying(false);
        setEditError(`폴링 오류: ${err.message}`);
      }
    }, 1500);
  }, [refreshEditStatus, showToast, clearGlobalJob, currentJobId]);

  // 수동 버튼 / fallback 자동 트리거가 호출 — POST + 폴링 시작.
  const applyEdit = useCallback(async () => {
    const r = await startApplyEditJob();
    if (r.ok) pollEditJobInBackground(r.jobId);
    else      showToast(`편집 적용 실패: ${r.error}`, 'error');
  }, [startApplyEditJob, pollEditJobInBackground, showToast]);

  const refreshEditStatusAndMaybeApply = useCallback(async () => {
    const st = await refreshEditStatus();
    if (st?.has_edit_json && st?.needs_apply && !editApplying) {
      // *_edit.json 이 새로 작성되었거나 edited 보다 신규 — 자동 적용 (백그라운드)
      showToast('Studio 에서 저장한 새 편집을 적용합니다.', 'info');
      const r = await startApplyEditJob();
      if (r.ok) pollEditJobInBackground(r.jobId);
    }
  }, [refreshEditStatus, startApplyEditJob, pollEditJobInBackground, editApplying, showToast]);

  // ── edit-status 가 갱신되면 apply-trace.json + edited final json 자동 로드 ──
  useEffect(() => {
    if (!editStatus?.apply_trace_path) { setEditTrace(null); return; }
    let cancelled = false;
    fetchJson(editStatus.apply_trace_path)
      .then(d => { if (!cancelled) setEditTrace(d); })
      .catch(e => { if (!cancelled) setEditError(`apply-trace 로드 실패: ${e.message}`); });
    return () => { cancelled = true; };
  }, [editStatus?.apply_trace_path]);

  useEffect(() => {
    if (!editStatus?.edited_json_path) { setEditedSummary(null); return; }
    let cancelled = false;
    fetchJson(editStatus.edited_json_path)
      .then(d => { if (!cancelled) setEditedSummary(d); })
      .catch(() => { if (!cancelled) setEditedSummary(null); });
    return () => { cancelled = true; };
  }, [editStatus?.edited_json_path]);

  // ── 결과 폴더가 바뀌면 edit-status 한 번 갱신 (페이지 재진입 시 복원) ──
  useEffect(() => {
    if (bdfResult?.outputDir) refreshEditStatus();
    else { setEditStatus(null); setEditTrace(null); setEditedSummary(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bdfResult?.outputDir]);

  // ── 언마운트 시 편집 폴링 정리 ──
  useEffect(() => () => {
    if (editPollRef.current) clearInterval(editPollRef.current);
  }, []);

  // ── Studio finalizeEditedModel IPC 리스너 ─────────────────────────
  // 핵심 설계: Studio 는 POST 성공(작업 시작) 까지만 await 한다.
  // 전체 체인(apply-edit + Nastran + F06 파싱, 수 분) 을 await 하면 Studio 가 그 시간 동안
  // 응답 없음 상태로 멈춰 보이므로, POST 가 job_id 를 회수한 직후 즉시 회신해서
  // Studio 가 빠르게 닫히도록 한다. 폴링은 백그라운드에서 계속하며 워크벤치 페이지의
  // 2단계 편집 탭의 진행 카드가 진행률을 표시한다(전체 화면을 잠그지 않는다).
  useEffect(() => {
    if (!window.electron?.onMessage) return;
    const unsub = window.electron.onMessage('modelflow:finalize-edit-request', async (msg) => {
      const { requestId, folderPath, editFileName } = msg || {};
      if (!requestId) return;

      // 1) 사용자가 워크벤치를 봤을 때 곧바로 Edit 탭이 활성화되어 있도록 step 1 로 전환
      setActiveIdx(1);
      // 2) editStatus 한 번 갱신 (선택적, 빠른 GET)
      try { await refreshEditStatus(); } catch {}

      // 3) folderPath 가 사용자 PC 로컬 추출 폴더이면, *_edit.json 을 백엔드 output_dir 로 업로드 선행.
      //    apply-edit-intent 는 백엔드 로컬 파일을 읽으므로 업로드 없이는 동작 안 함.
      const isLocalExtract = !!localResultDir && folderPath === localResultDir;
      const backendOutputDir = bdfResult?.outputDir || folderPath;
      let uploadFailed = null;

      if (!editFileName) {
        // 수정 내역 0건 = 원본 그대로. 이전 회차의 *_edit.json / edited/ 가 남아 있으면
        // 후속 해석 전달·다운로드가 옛 편집본(기본값 '유체 비움' BDF 등)을 계속 쓰므로 걷어낸다.
        let discardError = null;
        try {
          const r = await fetch(`${API_BASE_URL}/api/analysis/modelflow/discard-edit`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ output_dir: backendOutputDir }),
          });
          if (!r.ok) {
            let detail = `HTTP ${r.status}`;
            try { const b = await r.json(); detail += ` — ${b.detail ?? JSON.stringify(b)}`; } catch {}
            throw new Error(detail);
          }
        } catch (e) {
          discardError = e.message || String(e);
        }
        try { await refreshEditStatus(); } catch {}
        if (discardError) {
          try {
            window.electron.sendMessage('modelflow:finalize-edit-response', {
              requestId,
              ok: false,
              error: `이전 편집본 정리 실패: ${discardError}`,
            });
          } catch {}
          showToast(`이전 편집본을 정리하지 못했습니다: ${discardError}`, 'error');
          return;
        }
        setActiveIdx(2);
        setSteps(prev => prev.map((s, i) => (i <= 1 ? { ...s, status: 'done' } : s)));
        if (currentJobId) clearGlobalJob(currentJobId);
        try {
          window.electron.sendMessage('modelflow:finalize-edit-response', {
            requestId,
            ok: true,
          });
        } catch {}
        showToast('모델 수정 없이 원본 BDF 저장 단계로 이동했습니다.', 'success');
        return;
      }

      if (isLocalExtract && editFileName) {
        try {
          const editPath = `${folderPath}\\${editFileName}`;
          const readRes = await window.electron.invoke('viewer:readLocalFile', { filePath: editPath });
          if (!readRes?.ok) throw new Error(readRes?.error || '_edit.json 읽기 실패');

          const blob = new Blob([readRes.data], { type: 'application/json' });
          const fd = new FormData();
          fd.append('target_dir', backendOutputDir);
          fd.append('file', blob, editFileName);
          const r = await fetch(`${API_BASE_URL}/api/analysis/modelflow/upload-edit`, {
            method: 'POST',
            headers: getAuthHeaders(),  // multipart 는 Content-Type 자동 — auth 만 명시
            body: fd,
          });
          if (!r.ok) {
            let detail = `HTTP ${r.status}`;
            try { const b = await r.json(); detail += ` — ${b.detail ?? JSON.stringify(b)}`; } catch {}
            throw new Error(detail);
          }
        } catch (e) {
          uploadFailed = e.message || String(e);
        }
      }

      // 4) Phase 1: POST → job_id 즉시 회수 (backend output_dir 기준)
      const startResult = uploadFailed
        ? { ok: false, error: `*_edit.json 업로드 실패: ${uploadFailed}` }
        : await startApplyEditJob(backendOutputDir);

      // 5) Studio 에는 Phase 1 결과만 즉시 회신 — Studio 창은 곧 닫힘
      try {
        window.electron.sendMessage('modelflow:finalize-edit-response', {
          requestId,
          ok: startResult.ok,
          error: startResult.ok ? undefined : startResult.error,
        });
      } catch (err) {
        console.warn('[finalize-edit] response send failed', err);
      }

      // 6) Phase 2: 백그라운드 폴링 — 오버레이가 보이는 워크벤치 페이지에서 진행 표시
      if (startResult.ok) {
        pollEditJobInBackground(startResult.jobId);
      } else {
        showToast(`Studio 편집 적용 실패: ${startResult.error}`, 'error');
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, [startApplyEditJob, pollEditJobInBackground, refreshEditStatus, showToast, localResultDir, bdfResult?.outputDir, clearGlobalJob, currentJobId]);

  /* ── 리셋 ──────────────────────────────────────────────────────────── */
  const handleReset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (editPollRef.current) { clearInterval(editPollRef.current); editPollRef.current = null; }
    setStruFile(null); setPipeFile(null); setEquiFile(null);
    setStruError(null); setPipeError(null); setEquiError(null);
    setMeshSize(DEFAULT_MESH_SIZE_MM); setUboltFullFix(true); setUseNastran(false);
    setLocalResultDir(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setActiveIdx(0); setHasRunOnce(false); setCurrentJobId(null);
    setReviewAck(false); setServerInputs(null); setSourceAnalysisId(null);
    setJobStatus(null); setBdfResult(null); setEngineLog(null);
    setRunNastranRequested(false);
    setAuditData(null); setSummaryData(null);
    setViewerStatus('idle'); setViewerError(null); setViewerProgress(null);
    setEditStatus(null); setEditTrace(null); setEditedSummary(null);
    setEditApplying(false); setEditJobStatus(null); setEditError(null);
    // 미리보기도 초기 상태로. 받아둔 샘플 응답은 캐시로 남겨 재요청을 아낀다.
    setPreviewMode('mine'); setPreviewTabKey('stru'); setSampleError(null);
  };

  /* ── 파생 ──────────────────────────────────────────────────────────── */
  const isRunning  = jobStatus?.status === 'Running' || jobStatus?.status === 'Pending';
  const hasResult  = !!bdfResult?.outputDir;
  const preflightIssues = useMemo(() => {
    const issues = [];
    if (!struFile && !pipeFile) {
      issues.push({
        id: 'source-required',
        severity: 'error',
        title: 'Structural 또는 Piping CSV가 필요합니다.',
        detail: '둘 중 하나 이상의 입력 파일을 지정해야 Model Builder를 실행할 수 있습니다.',
        field: 'source-files',
      });
    }
    [
      ['structural-file', 'Structural CSV', struError],
      ['piping-file', 'Piping CSV', pipeError],
      ['equipment-file', 'Equipment CSV', equiError],
    ].forEach(([id, title, detail]) => {
      if (detail) issues.push({ id, severity: 'error', title: `${title} 형식을 확인하세요.`, detail, field: id });
    });
    const mesh = Number(meshSize);
    if (!Number.isFinite(mesh) || mesh <= 0) {
      issues.push({
        id: 'mesh-size',
        severity: 'error',
        title: 'Mesh size가 올바르지 않습니다.',
        detail: '0보다 큰 mm 단위 숫자를 입력하세요.',
        field: 'mesh-size',
      });
    } else if (mesh > 1000) {
      issues.push({
        id: 'mesh-size-large',
        severity: 'warning',
        title: 'Mesh size가 매우 큽니다.',
        detail: '국부 형상이 누락될 수 있으므로 모델 목적에 맞는지 확인하세요.',
        field: 'mesh-size',
      });
    }
    return issues;
  }, [equiError, meshSize, pipeError, pipeFile, struError, struFile]);
  const hasPreflightErrors = preflightIssues.some(issue => issue.severity === 'error');
  // 아무것도 올리기 전에는 '파일이 필요합니다' 를 오류로 띄우지 않는다 — 아직 실수한 게 없다.
  // 실행 버튼은 그대로 잠그고, 버튼 아래 안내 한 줄로 무엇을 하면 되는지만 알린다.
  const inputTouched = !!(struFile || pipeFile || equiFile || struError || pipeError || equiError);
  const visiblePreflightIssues = inputTouched
    ? preflightIssues
    : preflightIssues.filter(issue => issue.id !== 'source-required');

  // 대시보드에서 넘겨받은 CSV 배정이 끝나고 실행 버튼이 열려 있으면 실행까지 바로 이어간다
  useDashboardAutoRun(
    'HiTESS Model Builder',
    (handoffAssigned && (struFile || pipeFile) && !isRunning && !hasRunOnce && !hasPreflightErrors && handoffAssigned) || null,
    handleRunModelBuilder,
  );

  /* ── CSV 미리보기 파생 ─────────────────────────────────────────────
     '내 파일'/'사내 샘플' 어느 쪽이든 같은 표 컴포넌트가 그리도록 형태를 맞춘다. */
  const previewTabs = useMemo(() => {
    const source = previewMode === 'sample' ? samplePreview : minePreview;
    return [
      ['stru',  'Structural'],
      ['pipe',  'Piping'],
      ['equip', 'Equipment'],
    ].map(([key, label]) => {
      const entry = source?.[key] ?? null;
      return {
        key,
        label,
        filename:  entry?.filename,
        rows:      entry?.rows,
        totalRows: entry?.totalRows ?? 0,
        truncated: !!entry?.truncated,
        loading:   previewMode === 'sample' ? sampleLoading : !!entry?.loading,
        error:     previewMode === 'sample' ? sampleError : entry?.error,
      };
    });
  }, [previewMode, samplePreview, minePreview, sampleLoading, sampleError]);

  // 결과가 있을 때만 1단계에 입력 검증 결과를 보여 준다. 실행 전·실행 중에는 그 자리를 CSV 미리보기가 채운다.
  const showAuditPanel = hasResult && !!bdfResult?.auditPath;
  // 첫 화면(아무 입력·실행 없음) — 빈 CSV 표 자리 대신 진행 순서·최근 실행을 두고 두 칸 높이를 맞춘다.
  const isStartScreen = activeIdx === 0 && !inputTouched && !jobStatus && !hasResult && previewMode === 'mine';

  /* ── 판정 · 단계 표시 ─────────────────────────────────────────────── */
  const editedStage = useMemo(() => buildEditedModelCheckStage(editedSummary), [editedSummary]);
  const verdict = useMemo(() => (
    isRunning
      ? { level: null, title: '', reasons: [] }
      : computeModelBuilderVerdict({
          jobStatus: jobStatus?.status,
          summary: summaryData,
          audit: auditData,
          editedStage: editStatus?.has_edited ? editedStage : null,
        })
  ), [isRunning, jobStatus?.status, summaryData, auditData, editStatus?.has_edited, editedStage]);

  // 2단계 상태는 저장값(편집 적용 시 완료)에 판정을 겹쳐 그린다 — 판정이 바뀌면 자동으로 따라간다.
  const displaySteps = steps.map((st, i) => {
    if (i === 0 && st.status === 'running') return { ...st, hint: jobStatus?.message || '진행 중' };
    if (i !== 1 || st.status === 'done' || !verdict.level) return st;
    if (verdict.level === 'pass') return { ...st, status: 'done', hint: '판정 통과' };
    if (verdict.level === 'review') {
      return reviewAck ? { ...st, status: 'done', hint: '검토 확인함' } : { ...st, status: 'review' };
    }
    return { ...st, status: 'error' };
  });
  const activeStep = displaySteps[activeIdx];

  const fileState = (file, err) => (!file ? 'empty' : err && !String(err).startsWith('__warn__') ? 'error' : err ? 'warn' : 'ok');
  const inputItems = [
    { key: 'stru',  label: 'Structural', fileName: struFile?.name ?? serverInputs?.stru ?? null, state: fileState(struFile ?? serverInputs?.stru, struError) },
    { key: 'pipe',  label: 'Piping',     fileName: pipeFile?.name ?? serverInputs?.pipe ?? null, state: fileState(pipeFile ?? serverInputs?.pipe, pipeError) },
    { key: 'equip', label: 'Equipment',  fileName: equiFile?.name ?? serverInputs?.equip ?? null, state: fileState(equiFile ?? serverInputs?.equip, equiError) },
  ];

  /* ── 실행 버튼 — 실행 전 '실행', 실행 후 '옵션 바꿔 다시 실행' ───────── */
  const hasLocalInputs = !!(struFile || pipeFile);
  const meshValid = Number.isFinite(Number(meshSize)) && Number(meshSize) > 0;
  const canRunFresh = hasLocalInputs && !hasPreflightErrors && !isRunning;
  const canRerun = !isRunning && !rerunBusy && meshValid
    && (hasLocalInputs ? !hasPreflightErrors : !!sourceAnalysisId);
  const runAction = !hasRunOnce
    ? { label: 'Model Builder 실행', icon: ChevronsRight, onClick: handleRunModelBuilder, enabled: canRunFresh,
        title: hasPreflightErrors ? '입력 점검 오류를 먼저 해결하세요.' : undefined }
    : { label: '옵션 바꿔 다시 실행', icon: RefreshCw, onClick: handleRerunSameInputs, enabled: canRerun,
        title: hasLocalInputs ? '올려 둔 CSV 로 현재 옵션을 적용해 다시 만듭니다.' : '서버에 남아 있는 지난 입력 CSV 로 현재 옵션을 적용해 다시 만듭니다.' };

  // Ctrl+Enter = 실행 버튼. 입력 칸에 커서가 있어도 동작한다(Mesh size 를 고치고 바로 실행).
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (currentMenu !== 'HiTESS Model Builder') return; // 앱 페이지는 keep-alive 라 다른 화면에서도 살아 있다
      const a = runActionRef.current;
      if (!a.enabled) return;
      e.preventDefault();
      a.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);

  const markDelivered = useCallback(() => {
    setSteps(prev => prev.map((s, i) => (i === 2 ? { ...s, status: 'done' } : s)));
  }, []);

  // 전달 화면에 함께 보여 줄 질량 — 원본과 편집본이 다르면 둘 다(권상 해석의 핵심 입력이 총중량이다).
  const massLine = useMemo(() => {
    const orig = summaryData?.summary?.massPropertiesFluidEmpty ?? summaryData?.summary?.massProperties;
    const edited = editedSummary?.meta?.massProperties ?? editedSummary?.massProperties;
    const o = orig?.totalMassTon != null ? Number(orig.totalMassTon) : null;
    const e = edited?.totalMassTon != null ? Number(edited.totalMassTon) : null;
    if (editStatus?.has_edited && o != null && e != null && Math.abs(o - e) >= 0.005) {
      return `총중량 원본 ${o.toFixed(2)} → 편집본 ${e.toFixed(2)} ton`;
    }
    const v = editStatus?.has_edited && e != null ? e : o;
    return v != null ? `총중량 ${v.toFixed(2)} ton` : null;
  }, [summaryData, editedSummary, editStatus?.has_edited]);

  /* ── 다음 행동 바 — 단계마다 주 행동 1개 ─────────────────────────── */
  const nextAction = (() => {
    if (isRunning || editApplying || !hasResult) return null;
    if (activeStep.id === 'input') {
      return {
        note: '입력 검증 결과입니다. 모델 판정은 2단계에서 봅니다.',
        primary: { label: '판정 보기', icon: ChevronsRight, onClick: () => setActiveIdx(1) },
      };
    }
    if (activeStep.id === 'review') {
      if (verdict.level === 'fail') {
        return {
          note: '모델을 해석에 쓸 수 없습니다. 원인을 고친 입력으로 다시 실행하세요.',
          primary: { label: '입력으로 돌아가기', icon: FileSpreadsheet, onClick: () => setActiveIdx(0) },
          secondary: bdfResult?.outputDir ? [{ key: 'studio', label: 'Studio 에서 위치 확인', icon: ExternalLink, onClick: launchAlgorithmViewer }] : [],
        };
      }
      if (verdict.level === 'review' && !reviewAck) {
        return {
          note: '사유를 Studio 에서 확인·보정하세요. 문제없다고 판단했다면 확인하고 넘어갈 수 있습니다.',
          primary: { label: 'Studio 에서 확인·보정', icon: ExternalLink, onClick: launchAlgorithmViewer },
          secondary: [{ key: 'ack', label: '확인함 — 이대로 진행', icon: CheckCircle2, onClick: () => { setReviewAck(true); setActiveIdx(2); } }],
        };
      }
      return {
        note: verdict.level === 'pass' ? '판정 통과. 필요하면 Studio 로 확인한 뒤 BDF 를 받거나 전달하세요.' : '검토를 확인했습니다. BDF 를 받거나 후속 해석으로 전달하세요.',
        primary: { label: 'BDF 저장·전달로', icon: ChevronsRight, onClick: () => setActiveIdx(2) },
        secondary: [{ key: 'studio', label: 'Studio 에서 확인·보정', icon: ExternalLink, onClick: launchAlgorithmViewer }],
      };
    }
    return null;
  })();

  const verdictSummary = verdict.level === 'pass'
    ? '검증 에러 없음 · 질량 있는 입력 모두 반영 · 분리 그룹 0 · 미해결 U-bolt 0'
    : verdict.level === 'review' ? '모델은 만들어졌지만 아래 항목을 확인해야 합니다.' : null;

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    // pb-28: 화면 오른쪽 아래 전역 작업·메시지 도크가 마지막 버튼을 가리지 않게 여백을 둔다(1366 실측).
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">

      <FileBasedPageBanner
        title="HiTESS Model Builder"
        subtitle="설계 CSV(구조·배관·장비) → 1D Beam FE 모델 → Nastran BDF"
        icon={ShieldCheck}
        guideTitle="[파일] HiTESS Model Builder — CSV → BDF 변환"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {MODEL_BUILDER_COMMUNITY_KEY && (
        <AppCommunityHub
          appKey={MODEL_BUILDER_COMMUNITY_KEY}
          appName="HiTESS Model Builder"
        />
      )}

      <div className="flex flex-col items-stretch gap-5 px-1 xl:flex-row">

        {/* ── 왼쪽 레일: 단계 · 입력 요약 · 옵션 · 실행 ── */}
        <aside className={`flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0 ${isStartScreen ? '' : 'xl:self-start'}`}>
          <StepRail
            steps={displaySteps}
            activeIdx={activeIdx}
            onSelect={setActiveIdx}
          />

          {/* 입력 단계에서는 파일 칸이 이미 파일명을 보여 주므로 요약을 숨긴다(1366 에서 실행 버튼이 첫 화면에 들어오게). */}
          {activeStep.id !== 'input' && (
            <>
              <div className="h-px bg-slate-100" />
              <InputSummary
                items={inputItems}
                footer={serverInputs && !hasLocalInputs && (
                  <p className="text-[11px] text-slate-600">서버에 저장된 지난 입력입니다. 다른 CSV 로 바꾸려면 &lsquo;새 입력으로 시작&rsquo;을 누르세요.</p>
                )}
              />
            </>
          )}

          <div className="h-px bg-slate-100" />
          <OptionsPanel
            meshSize={meshSize} setMeshSize={setMeshSize}
            uboltFullFix={uboltFullFix} setUboltFullFix={setUboltFullFix}
            useNastran={useNastran} setUseNastran={setUseNastran}
            disabled={isRunning}
          />

          <div className="space-y-2">
            <button
              type="button"
              onClick={runAction.onClick}
              disabled={!runAction.enabled}
              title={runAction.title}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isRunning || rerunBusy
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> 실행 중…</>
                : <><runAction.icon size={15} aria-hidden="true" /> {runAction.label}</>}
            </button>
            {!hasRunOnce && !hasLocalInputs ? (
              <p className="text-center text-xs text-slate-600">구조 또는 배관 CSV 를 올리면 열립니다.</p>
            ) : (
            <p className="text-center text-[11px] text-slate-600">
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl</kbd>
              {' + '}
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Enter</kbd>
              {' 로도 실행합니다'}
            </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
              {hasRunOnce && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                >
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <button
                type="button"
                onClick={openSamplePreview}
                disabled={sampleLoading}
                className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-wait disabled:text-slate-500 cursor-pointer"
              >
                {sampleLoading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                샘플 CSV 보기
              </button>
              <SampleRunButton
                appKey="modelflow"
                variant="link"
                label="샘플로 실행"
                disabled={isRunning || hasRunOnce}
                onBeforeRun={sampleMfBefore}
                onJobSubmitted={sampleMfSubmitted}
                onError={sampleMfError}
              />
            </div>
          </div>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {isRunning && (
            <JobProgressCard
              title="모델 생성 중"
              message={jobStatus?.message}
              progress={jobStatus?.progress ?? 0}
              elapsed={elapsedSecs}
              note="다른 화면으로 이동해도 계속 진행됩니다. 오른쪽 아래 작업 카드로 돌아올 수 있습니다."
            />
          )}

          {verdict.level && (
            <VerdictHeader
              level={verdict.level}
              title={verdict.title}
              summary={verdictSummary}
              reasons={verdict.reasons}
              meta={verdict.basis === 'edited' ? '편집 적용 모델 기준' : null}
            />
          )}
          {nextAction && <NextActionBar {...nextAction} />}

          <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white px-5 py-4">
            <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-100 pb-3">
              <activeStep.icon size={15} className="text-slate-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            <div className="min-h-0 flex-1 space-y-4">
              {activeStep.id === 'input' && (
                <>
                  {!showAuditPanel && (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-700">
                        CSV 를 칸에 하나씩 놓거나, 세 파일을 한 번에 놓으면 헤더를 보고 자동으로 나눕니다.
                      </p>
                      <DetailCSV
                        struFile={struFile} pipeFile={pipeFile} equiFile={equiFile}
                        struError={struError} pipeError={pipeError} equiError={equiError}
                        setStruFile={setStruFile} setPipeFile={setPipeFile} setEquiFile={setEquiFile}
                        setStruError={setStruError} setPipeError={setPipeError} setEquiError={setEquiError}
                        onAutoAssign={handleAutoAssign}
                        onMultipleFiles={handleMultipleFiles}
                        onWarnNotCsv={() => showToast('CSV 파일(.csv)만 올릴 수 있습니다.', 'warning')}
                        disabled={isRunning}
                      />
                      {(inputTouched || visiblePreflightIssues.length > 0) && (
                        <PreflightIssueCenter issues={visiblePreflightIssues} compact />
                      )}
                    </div>
                  )}
                  {isStartScreen ? (
                    <RunStartPanel
                      programName="HiTessModelBuilder"
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => !!(r.input_info?.stru_csv || r.input_info?.pipe_csv)}
                      steps={[
                        { title: '입력 검증', detail: '구조·배관·장비 CSV 를 읽어 열 구성과 값을 점검하고, 1D Beam FE 모델과 BDF 를 만듭니다.' },
                        { title: '모델 확인·보정', detail: '분리 그룹·제외된 행·U-bolt 를 판정하고, 필요하면 Studio 에서 3D 로 열어 고칩니다.' },
                        { title: 'BDF 저장·전달', detail: 'BDF 를 받거나 권상 구조 해석 등 다음 앱으로 바로 넘깁니다.' },
                      ]}
                    />
                  ) : showAuditPanel ? (
                    <CsvAuditPanel
                      audit={auditData}
                      jobStatus={jobStatus}
                      hasResult={hasResult && !!bdfResult?.auditPath}
                      loading={auditLoading}
                      error={auditError}
                      onRetry={() => setBdfResult(prev => ({ ...prev }))}
                    />
                  ) : (
                    // 높이는 여기서 정한다. 패널의 h-full 이 단계 상자 높이를 그대로 물려받으면
                    // 위 업로드 칸만큼 상자 밖으로 밀려난다. 표가 있을 때만 고정 높이, 비었을 땐 내용 높이.
                    <div className={previewTabs.some(t => t.rows?.length || t.loading || t.error) ? 'h-[clamp(320px,58vh,640px)]' : ''}>
                    <CsvPreviewPanel
                      tabs={previewTabs}
                      activeKey={previewTabKey}
                      onActiveKeyChange={setPreviewTabKey}
                      emptyTitle={previewMode === 'sample' ? '샘플 CSV 를 불러오는 중' : '올린 CSV 가 여기에 표로 보입니다'}
                      emptyMessage={previewMode === 'sample'
                        ? '사내 표준 샘플 CSV 를 불러오면 여기에 표시됩니다.'
                        : '처음이라면 사내 표준 샘플 CSV 로 열 구성을 먼저 확인할 수 있습니다.'}
                      emptyAction={previewMode === 'mine' ? (
                        <button
                          type="button"
                          onClick={openSamplePreview}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                        >
                          <Eye size={13} aria-hidden="true" /> 사내 샘플 CSV 보기
                        </button>
                      ) : null}
                      headerRight={
                        <PreviewModeToggle
                          mode={previewMode}
                          loading={sampleLoading}
                          onMine={() => setPreviewMode('mine')}
                          onSample={openSamplePreview}
                        />
                      }
                    />
                    </div>
                  )}
                </>
              )}
              {activeStep.id === 'review' && (
                <StageSummaryPanel
                  summary={summaryData}
                  audit={auditData}
                  loading={summaryLoading}
                  error={summaryError}
                  hasResult={hasResult}
                  bdfResult={bdfResult}
                  onLaunchViewer={launchAlgorithmViewer}
                  viewerInstalled={viewerInstalled}
                  viewerStatus={viewerStatus}
                  viewerProgress={viewerProgress}
                  viewerError={viewerError}
                  installedVersion={installedVersion}
                  latestVersion={latestVersion}
                  editStatus={editStatus}
                  editApplying={editApplying}
                  editJobStatus={editJobStatus}
                  editTrace={editTrace}
                  editedSummary={editedSummary}
                  editError={editError}
                  onApplyEdit={applyEdit}
                  onRefreshEditStatus={refreshEditStatusAndMaybeApply}
                />
              )}
              {activeStep.id === 'deliver' && (
                <DeliverPanel
                  bdfResult={bdfResult}
                  hasResult={hasResult}
                  editStatus={editStatus}
                  gmuLocked={gmuLocked}
                  sourceAnalysisId={sourceAnalysisId}
                  canRegister={canRegisterToStorage}
                  onRegister={(artifactKind) => setRegisterTarget({ artifactKind })}
                  onDelivered={markDelivered}
                  massLine={massLine}
                  verdict={verdict}
                  /* 전달 직전 edit-status 를 다시 읽어 '지금 디스크에 있는' 최종 편집본을 확정한다.
                     Studio 편집 적용 직후처럼 페이지의 editStatus 가 아직 낡은 순간에도
                     원본이 아니라 편집본이 넘어가도록 보장한다. */
                  onResolveHandoffBdf={async () => {
                    const fresh = await refreshEditStatus();
                    return fresh?.edited_bdf_path
                      || editStatus?.edited_bdf_path
                      || bdfResult?.bdfPath
                      || null;
                  }}
                  onSendToGmu={(bdfPath) => {
                    if (gmuLocked) return; // 개발 중 + 비관리자는 전달 차단
                    setGmuHandoff({
                      bdfServerPath: bdfPath,
                      sourceApp: handoffSourceLabel(bdfPath, bdfResult?.bdfPath),
                    });
                    setCurrentMenu(GMU_MENU_NAME);
                  }}
                  onSendToSidePassage={(bdfPath) => {
                    setSidePassageHandoff({
                      bdfServerPath: bdfPath,
                      sourceApp: handoffSourceLabel(bdfPath, bdfResult?.bdfPath),
                    });
                    setCurrentMenu(SIDE_PASSAGE_MENU_NAME);
                  }}
                />
              )}
            </div>
          </section>

          {/* 실패했을 때만 — 기본 접힘. 사용자가 먼저 읽을 것은 판정 머리의 원인이다. */}
          <EngineLogPanel log={engineLog} />
        </main>
      </div>

      <ModelRegistrationModal
        isOpen={Boolean(registerTarget)}
        onClose={() => setRegisterTarget(null)}
        source={{
          analysisId: sourceAnalysisId,
          artifactKind: registerTarget?.artifactKind,
        }}
        onRegistered={(r) => showToast(
          r?.restored
            ? '삭제되었던 모델을 Model Library 에 복원했습니다.'
            : 'Model Library 에 등록되었습니다.',
          'success',
        )}
      />
    </div>
  );
}
