import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronsRight,
  Cpu, Download, ExternalLink, FileEdit, FileSpreadsheet, History, Loader2,
  PackageX, RotateCcw, ShieldCheck, UploadCloud, X,
} from 'lucide-react';

import ChangelogModal from '../../components/ui/ChangelogModal';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import { API_BASE_URL } from '../../config';
import { downloadFileBlob } from '../../api/analysis';
import { getAuthHeaders, handleUnauthorized } from '../../utils/auth';

/* ──────────────────────────────────────────────────────────────────────────
   상수
   ──────────────────────────────────────────────────────────────────────── */

// 2026-04-30: ModelBuilderStudio 재구성에 따라 manifest.id 가 'model-studio' 로 변경됨.
// 사내 스토리지 zip: model-studio-<version>.zip — 백엔드 _find_zip 이 prefix 매칭.
const VIEWER_ID = 'model-studio';

const INITIAL_STEPS = [
  { id: 'csv-validation', title: 'CSV 입력 검증',  icon: FileSpreadsheet, status: 'wait' },
  { id: 'model-qc',       title: '해석 모델 검증', icon: ShieldCheck,     status: 'wait' },
  { id: 'nastran',        title: '해석 모델 저장', icon: Cpu,             status: 'wait' },
];

const REASON_LABELS = {
  csv_row_accepted:               '정상 변환',
  no_geometry_and_zero_mass:      '형상 없음 + 질량 0',
  zero_length_pipe_without_mass:  '길이 0 + 질량 없는 배관',
  zero_length_structure:          '길이 0 구조 부재',
  zero_mass_attachment:           '질량 0 부착물',
  zero_mass_equipment:            '질량 0 장비',
  ambiguousDuplicateSourceName:   '동일 sourceName 중복',
  parseFailed:                    '파싱 실패',
  blank:                          '공백 행',
};

const STATUS_CONFIG = {
  wait:     { dot: 'bg-slate-300',                          badge: 'bg-slate-100 text-slate-500',     label: '대기' },
  running:  { dot: 'bg-blue-500 ring-4 ring-blue-100',      badge: 'bg-blue-100 text-blue-700',       label: '진행' },
  done:     { dot: 'bg-emerald-500',                        badge: 'bg-emerald-100 text-emerald-700', label: '완료' },
  error:    { dot: 'bg-red-500',                            badge: 'bg-red-100 text-red-700',         label: '오류' },
  disabled: { dot: 'bg-slate-200',                          badge: 'bg-slate-100 text-slate-400',     label: '비활성' },
};

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

// 원본 BDF 경로로부터 _edit.bdf 다운로드 파일명 생성. ex) foo.bdf → foo_edit.bdf
function makeEditDownloadName(originalPath, ext) {
  const base = (originalPath || '').split(/[\\/]/).pop() || `model.${ext}`;
  const stem = base.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  return `${stem}_edit.${ext}`;
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
    const counts = { converted: 0, ignored: 0, parseFailed: 0, blank: 0 };
    for (const r of arr) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  };
  const inputFiles = Array.isArray(audit.inputFiles) ? audit.inputFiles : [];
  const findFile = (kind) => inputFiles.find(f => f.kind === kind) || null;
  return {
    Structure: { kind: 'Structure', icon: '🏗️', file: findFile('Structure'), rows: kindMap.Structure, counts: tally(kindMap.Structure) },
    Pipe:      { kind: 'Pipe',      icon: '🔧', file: findFile('Pipe'),      rows: kindMap.Pipe,      counts: tally(kindMap.Pipe) },
    Equipment: { kind: 'Equipment', icon: '⚙️', file: findFile('Equipment'), rows: kindMap.Equipment, counts: tally(kindMap.Equipment) },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   소형 UI 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

function CollapseSection({ label, open, onToggle, children, accent }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors
          ${accent === 'amber'
            ? 'bg-amber-50 border border-amber-200 hover:bg-amber-100'
            : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
          }`}
      >
        <span className={`text-[10px] font-bold uppercase tracking-widest ${accent === 'amber' ? 'text-amber-700' : 'text-slate-500'}`}>
          {label}
        </span>
        <span className={`text-[10px] ${accent === 'amber' ? 'text-amber-400' : 'text-slate-400'}`}>
          {open ? '▲ 닫기' : '▼ 펼치기'}
        </span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function ProgressBar({ progress, message, error }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-700">{message || '진행 중...'}</p>
        <p className="text-xs font-bold text-blue-600 font-mono">{progress ?? 0}%</p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${error ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CsvDropZone — 단일/다중 파일 드롭존 (이전 버전 룩앤필 그대로)
   ──────────────────────────────────────────────────────────────────────── */

function CsvDropZone({ label, required, file, fileError, onFile, onClear, multiple = false, onMultipleFiles, onWarnNotCsv }) {
  const inputRef = useRef(null);
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
    if (csvFiles.length === 0) return;
    if (csvFiles.length === 1) handleSingleFile(csvFiles[0]);
    else if (multiple && onMultipleFiles) onMultipleFiles(csvFiles);
    else handleSingleFile(csvFiles[0]);
  };

  const handleDrop = (e) => { e.preventDefault(); handleFileList(e.dataTransfer.files); };

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden transition-colors
      ${fileError && !isWarn ? 'border-red-300' : isWarn ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileSpreadsheet size={12} className={fileError && !isWarn ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-400'} />
          <span className="text-xs font-semibold text-slate-700 truncate">{label}</span>
          {required
            ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium shrink-0">필수</span>
            : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium shrink-0">선택</span>
          }
        </div>
        {file && (
          <button onClick={onClear} className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0" title="제거">
            <X size={12} />
          </button>
        )}
      </div>
      {file ? (
        <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-center">
          {fileError && !isWarn
            ? <AlertCircle size={14} className="text-red-500 shrink-0 mb-0.5" />
            : isWarn
            ? <AlertCircle size={14} className="text-amber-400 shrink-0 mb-0.5" />
            : <CheckCircle2 size={14} className="text-green-500 shrink-0 mb-0.5" />
          }
          <p className="text-[10px] font-semibold text-slate-700 truncate w-full text-center" title={file.name}>{file.name}</p>
          {fileError && !isWarn
            ? <p className="text-[10px] text-red-500 leading-tight text-center">{displayError}</p>
            : isWarn
            ? <p className="text-[10px] text-amber-500 leading-tight text-center">{displayError}</p>
            : <p className="text-[10px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
          }
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1 py-3 cursor-pointer hover:bg-blue-50/40 transition-colors text-center"
        >
          <UploadCloud size={16} className="text-slate-300" />
          <p className="text-[10px] text-slate-400 leading-relaxed px-2">
            {multiple
              ? <>드롭 또는 <span className="text-blue-600 font-medium">클릭</span><br /><span className="text-slate-300">여러 파일 자동 분류</span></>
              : <>드롭 또는 <span className="text-blue-600 font-medium">클릭</span></>
            }
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple={multiple}
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFileList(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}

function DetailCSV({
  struFile, pipeFile, equiFile,
  struError, pipeError, equiError,
  setStruFile, setPipeFile, setEquiFile,
  setStruError, setPipeError, setEquiError,
  onAutoAssign, onMultipleFiles, onWarnNotCsv,
}) {
  const isReady = !!struFile && !struError && !pipeError && !equiError;
  const hasError = (struError && !struError.startsWith('__warn__'))
                || (pipeError && !pipeError.startsWith('__warn__'))
                || (equiError && !equiError.startsWith('__warn__'));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <CsvDropZone
          label="Structural" required
          file={struFile} fileError={struError}
          onFile={(f) => onAutoAssign(f, 'stru')}
          onClear={() => { setStruFile(null); setStruError(null); }}
          multiple={true}
          onMultipleFiles={onMultipleFiles}
          onWarnNotCsv={onWarnNotCsv}
        />
        <CsvDropZone
          label="Piping"
          file={pipeFile} fileError={pipeError}
          onFile={(f) => onAutoAssign(f, 'pipe')}
          onClear={() => { setPipeFile(null); setPipeError(null); }}
          multiple={true}
          onMultipleFiles={onMultipleFiles}
          onWarnNotCsv={onWarnNotCsv}
        />
        <CsvDropZone
          label="Equipment"
          file={equiFile} fileError={equiError}
          onFile={(f) => onAutoAssign(f, 'equip')}
          onClear={() => { setEquiFile(null); setEquiError(null); }}
          multiple={true}
          onMultipleFiles={onMultipleFiles}
          onWarnNotCsv={onWarnNotCsv}
        />
      </div>
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors
        ${hasError ? 'bg-red-50 border-red-200 text-red-700'
          : isReady ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
        {hasError
          ? <><AlertCircle size={13} /> 파일 형식 오류를 확인하세요</>
          : isReady
          ? <><CheckCircle2 size={13} /> 필수 파일 준비 완료 — 실행 가능</>
          : <><AlertCircle size={13} /> Structural CSV 파일이 필요합니다 (드래그 한 번에 3개 자동 분류)</>
        }
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CSV 검증 결과 패널 — v2 (Hero-first 레이아웃)
   ──────────────────────────────────────────────────────────────────────── */

/* 파일별 변환 막대 */
function KindBar({ label, icon, converted, total, ignored, failed, fileName }) {
  const pct = total > 0 ? Math.round((converted / total) * 100) : 0;
  const hasIssue = ignored > 0 || failed > 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-col gap-2">
      {/* 헤더 행 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none">{icon}</span>
          <span className="text-sm font-bold text-slate-700">{label}</span>
        </div>
        {total > 0
          ? <span className={`text-xs font-bold font-mono ${hasIssue ? 'text-amber-600' : 'text-emerald-600'}`}>{pct}%</span>
          : <span className="text-xs text-slate-300 italic">미입력</span>
        }
      </div>

      {total > 0 && (
        <>
          {/* 수치 요약 */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-800 font-mono leading-none">{converted.toLocaleString()}</span>
            <span className="text-xs text-slate-400">행 변환</span>
          </div>

          {/* 스택 진행 바 */}
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-700 rounded-l-full"
              style={{ width: `${(converted / total) * 100}%` }}
            />
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

          {/* 범례 (제외·실패만 — 변환은 큰 수치로 이미 표시) */}
          {(ignored > 0 || failed > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
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
            <p className="text-[11px] text-slate-400 font-mono truncate pt-1 border-t border-slate-100" title={fileName}>{fileName}</p>
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
      <span className="text-xs text-slate-400 font-semibold">{label}</span>
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

  /* ── 공통 상태 렌더 ── */
  if (jobStatus?.status === 'Running' || jobStatus?.status === 'Pending') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-blue-600">{jobStatus.message}</p>
          <p className="text-xs text-slate-400 mt-1">CSV 파싱 및 변환 중...</p>
        </div>
        <div className="w-56 bg-slate-100 rounded-full h-2 overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${jobStatus.progress}%` }} />
        </div>
        <p className="text-xs font-mono font-bold text-blue-500">{jobStatus.progress}%</p>
      </div>
    );
  }

  if (!hasResult) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 py-16 text-center">
        <FileSpreadsheet size={36} className="text-slate-200" />
        <div>
          <p className="text-sm font-semibold text-slate-400">검증 결과 대기 중</p>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            CSV 파일을 업로드하고 <span className="text-violet-400 font-semibold">Model Builder 실행</span>을 누르면<br />
            변환 결과가 여기에 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">InputAudit 불러오는 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 gap-3">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-sm px-4 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 cursor-pointer transition-colors"
        >
          <RotateCcw size={13} /> 재시도
        </button>
      </div>
    );
  }

  if (!audit) return null;

  /* ── 데이터 계산 ── */
  const summary  = audit.summary || {};
  const byKind   = summarizeAuditByKind(audit);
  const isFailed = jobStatus?.status === 'Failed';

  const total     = summary.totalDataRows   || 0;
  const converted = summary.convertedRows   || 0;
  const ignored   = summary.ignoredRows     || 0;
  const failed    = summary.parseFailedRows || 0;
  const convRate  = total > 0 ? Math.round((converted / total) * 100) : 0;

  // ambiguousDuplicate 제외, ignored만 표시
  const ignoredEntries = Object.entries(summary.ignoredByReason || {})
    .map(([code, count]) => ({ code, count, label: REASON_LABELS[code] ?? code }))
    .sort((a, b) => b.count - a.count);
  const maxIgnored = ignoredEntries.length > 0 ? Math.max(...ignoredEntries.map(e => e.count)) : 1;

  // rowAudit 필터링
  const filteredRows = (audit.rowAudit || [])
    .filter(r => statusFilter === 'all' || r.status === statusFilter)
    .filter(r => kindFilter   === 'all' || r.kind   === kindFilter);

  return (
    <div className="space-y-4 w-full min-w-0">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          A. Hero 변환 요약
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className={`rounded-2xl border px-5 py-4 shadow-sm ${isFailed ? 'bg-red-50 border-red-200' : 'bg-gradient-to-br from-slate-50 to-white border-slate-200'}`}>
        <div className="flex items-start gap-5">
          {/* 변환률 원형 표시 */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#e2e8f0" strokeWidth="7" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={isFailed ? '#ef4444' : failed > 0 ? '#f59e0b' : '#10b981'}
                  strokeWidth="7"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - convRate / 100)}`}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-base font-bold font-mono leading-none ${isFailed ? 'text-red-600' : 'text-slate-800'}`}>{convRate}%</span>
              </div>
            </div>
            <span className="text-xs text-slate-400 font-medium">변환률</span>
          </div>

          {/* 핵심 지표 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {isFailed
                ? <AlertCircle size={15} className="text-red-600 shrink-0" />
                : <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
              <span className={`text-sm font-bold ${isFailed ? 'text-red-700' : 'text-emerald-700'}`}>
                {isFailed ? 'CSV 검증 실패' : 'CSV 입력 검증 완료'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold font-mono text-slate-800 leading-none">{total.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">전체 입력</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold font-mono text-emerald-600 leading-none">{converted.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">변환 성공</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold font-mono leading-none ${ignored > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{ignored.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">제외됨</p>
              </div>
            </div>

            {failed > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-semibold">
                <AlertCircle size={12} /> 파싱 실패 {failed.toLocaleString()}건 — 원본 CSV 확인 필요
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          B. 파일별 처리 현황 (3열 카드)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {byKind && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">파일별 처리 현황</p>
          <div className="grid grid-cols-3 gap-3">
            {['Structure', 'Pipe', 'Equipment'].map((k) => {
              const d = byKind[k];
              const c = d.counts;
              const rowTotal = (d.file?.dataRowCount) ?? ((c.converted ?? 0) + (c.ignored ?? 0) + (c.parseFailed ?? 0));
              return (
                <KindBar
                  key={k}
                  label={k}
                  icon={d.icon}
                  converted={c.converted ?? 0}
                  total={rowTotal}
                  ignored={c.ignored ?? 0}
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
        <div className="bg-white border border-amber-200 rounded-xl px-4 py-4 shadow-sm">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-3">
            제외 사유 분포 — {ignored.toLocaleString()}건
          </p>
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
          <button
            onClick={() => setShowRows(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">행 단위 검증</span>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {audit.rowAudit.length.toLocaleString()}행
              </span>
              {!showRows && (
                <span className="text-[11px] text-slate-400 ml-1">— 클릭하여 자세히 보기</span>
              )}
            </div>
            <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showRows ? 'rotate-180' : ''}`} />
          </button>

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
                    { v: 'ignored',     label: '제외' },
                    { v: 'parseFailed', label: '실패' },
                    { v: 'blank',       label: '공백' },
                  ]}
                />
                <span className="ml-auto text-xs font-mono text-slate-400">
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
                      const rowBg = r.status === 'parseFailed' ? 'bg-red-50/60'
                                  : r.status === 'ignored'     ? 'bg-amber-50/40'
                                  : r.status === 'blank'       ? 'bg-slate-50/60' : '';
                      const badge = r.status === 'converted'   ? 'bg-emerald-100 text-emerald-700'
                                  : r.status === 'ignored'     ? 'bg-amber-100 text-amber-700'
                                  : r.status === 'parseFailed' ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-500';
                      const reasonText = r.status === 'converted'
                        ? (REASON_LABELS[r.reasonCode] ?? r.reasonCode)
                        : (r.reason || REASON_LABELS[r.reasonCode] || r.reasonCode);
                      return (
                        <tr key={i} className={`hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                          <td className="px-3 py-1.5 text-slate-600 truncate" title={r.kind}>{r.kind}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-400">{r.physicalLineNumber}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>{r.status}</span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] truncate" title={r.name}>{r.name}</td>
                          <td
                            className={`px-3 py-1.5 truncate ${r.status === 'converted' ? 'text-slate-400' : 'text-slate-600'}`}
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
                  <p className="text-center text-xs text-slate-400 py-3 italic border-t border-slate-100">
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

  if (!hasResult) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
        <ShieldCheck size={36} className="opacity-40" />
        <p className="text-xs text-center max-w-md">
          모델 알고리즘 실행 후 phase별 메트릭과 <b>Model Builder Studio</b>(외부 풀스크린 뷰어)가 여기에 표시됩니다.
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
      />

      {/* ── 서브 탭: 원본 / Edit ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <SubTab
          active={subTab === 'original'} onClick={() => setSubTab('original')}
          label="원본 모델" icon={ShieldCheck}
        />
        <SubTab
          active={subTab === 'edit'} onClick={() => setSubTab('edit')}
          label="Edit 적용 모델" icon={FileEdit}
          badge={editStatus?.has_edited ? '적용됨' : (editStatus?.has_edit_json ? '대기' : null)}
          badgeCls={editStatus?.has_edited ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}
          disabled={!editAvailable && !editApplying}
        />
        <button
          type="button"
          onClick={onRefreshEditStatus}
          title="Edit 상태 새로고침"
          className="ml-auto mb-1 p-1.5 rounded-md hover:bg-slate-100 text-slate-400 cursor-pointer"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {subTab === 'original' && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
              <Loader2 size={16} className="animate-spin" /> StageSummary 불러오는 중...
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center py-8 text-red-500 gap-2">
              <AlertCircle size={28} /><p className="text-xs">{error}</p>
            </div>
          )}
          {summary && <StageSummaryDetail summary={summary} audit={audit} />}

          {bdfResult?.bdfPath && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">원본 최종 산출물</p>
                <p className="text-xs text-slate-700 font-mono truncate" title={bdfResult.bdfPath}>{fileBaseName(bdfResult.bdfPath)}</p>
              </div>
              <button
                onClick={() => triggerDownload(bdfResult.bdfPath)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                <Download size={12} /> BDF
              </button>
            </div>
          )}
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
            ? 'border-transparent text-slate-300 cursor-not-allowed'
            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
    >
      {Icon && <Icon size={13} />}
      {label}
      {badge && (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badgeCls}`}>{badge}</span>
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
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
        <FileEdit size={28} className="text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-500 mb-1">아직 편집 내역이 없습니다.</p>
        <p className="text-[11px] text-slate-400">Studio에서 모델 수정 후 "최종 모델 출력"을 누르면 자동으로 적용됩니다.</p>
      </div>
    );
  }

  // 2) 적용 진행 중
  if (editApplying) {
    const p = editJobStatus?.progress ?? 0;
    return (
      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 px-5 py-6">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={16} className="text-blue-600 animate-spin" />
          <p className="text-sm font-bold text-blue-900">apply-edit-intent 실행 중...</p>
          <span className="ml-auto text-xs font-mono text-blue-700">{p}%</span>
        </div>
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${p}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-blue-700">{editJobStatus?.message ?? '편집 적용 중...'}</p>
      </div>
    );
  }

  // 3) 편집 JSON은 있는데 적용 안 됨 (또는 재적용 필요)
  const needsApply = editStatus?.needs_apply || (editStatus?.has_edit_json && !editStatus?.has_edited);
  return (
    <div className="space-y-3 w-full min-w-0">
      {needsApply && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle size={14} className="text-amber-700" />
              <p className="text-sm font-bold text-amber-900">신규 편집 내역이 적용 대기 중입니다</p>
            </div>
            <p className="text-[11px] text-amber-800">
              {editStatus?.edited_bdf_mtime
                ? '기존 적용본보다 최신 편집이 감지되었습니다 — 다시 적용할 수 있습니다.'
                : 'Studio에서 작성한 _edit.json 을 base 모델에 적용합니다.'}
            </p>
          </div>
          <button
            onClick={onApplyEdit}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
          >
            <ChevronsRight size={13} /> 편집 적용 실행
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

/* (legacy) Nastran F06 Subcase 메트릭 표시는 더 이상 사용하지 않음.
   사용자 요구: F06 의 FATAL/ERROR 유무만 표시. 아래 컴포넌트는 다른 곳에서 재사용 가능성을
   위해 유지하되 호출하지 않음. tree-shaking 으로 번들에서 제거됨. */
function EditNastranResults_LEGACY({ editStatus }) {
  const [results, setResults] = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!editStatus?.edited_f06_results_path) { setResults(null); return; }
    let cancelled = false;
    fetchJson(editStatus.edited_f06_results_path)
      .then(d => { if (!cancelled) setResults(d); })
      .catch(e => { if (!cancelled) setError(`F06 결과 로드 실패: ${e.message}`); });
    return () => { cancelled = true; };
  }, [editStatus?.edited_f06_results_path]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
    );
  }
  if (!results) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <Loader2 size={12} className="inline-block mr-1 animate-spin" /> F06 결과 불러오는 중...
      </div>
    );
  }

  // F06Parser _results.json 의 일반 구조 (방어적 파싱):
  // { subcases: [{ id, displacement: {max:{}, min:{}}, spc_force: {...}, cbar_force: {...}, ... }] }
  const subcases = Array.isArray(results?.subcases) ? results.subcases
                 : Array.isArray(results?.Subcases) ? results.Subcases
                 : [];
  const csvByKind = {};
  (editStatus?.edited_f06_csv_paths ?? []).forEach(p => {
    const fn = p.split(/[\\/]/).pop().toLowerCase();
    const m = fn.match(/_sc(\d+)_([a-z_]+)\.csv$/);
    if (m) {
      const sc = `SC${m[1]}`;
      const kind = m[2].replace(/\.csv$/, '');
      csvByKind[sc] = csvByKind[sc] || {};
      csvByKind[sc][kind] = p;
    }
  });

  return (
    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/60 to-white px-5 py-4 shadow-sm w-full min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <Cpu size={14} className="text-blue-600" />
        <p className="text-sm font-bold text-slate-800">Nastran 해석 결과 (Edit BDF)</p>
        <span className="ml-auto text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
          Subcase {subcases.length}
        </span>
      </div>

      {subcases.length === 0 && (
        <p className="text-xs text-slate-500">Subcase 정보를 찾을 수 없습니다 — JSON 구조를 확인하세요.</p>
      )}

      <div className="space-y-3">
        {subcases.map((sc, idx) => {
          const scId = sc?.id ?? sc?.subcase_id ?? sc?.subcaseId ?? (idx + 1);
          const scKey = `SC${scId}`;
          const csvs = csvByKind[scKey] ?? {};
          return (
            <div key={scKey} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">
                  {scKey}
                </span>
                {sc?.title && <span className="text-xs text-slate-700 font-semibold truncate">{sc.title}</span>}
              </div>
              <SubcaseMetricsRow sc={sc} />
              {Object.keys(csvs).length > 0 && (
                <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">CSV 다운로드</span>
                  {Object.entries(csvs).map(([kind, p]) => (
                    <button
                      key={kind}
                      onClick={() => triggerDownload(p)}
                      className="flex items-center gap-1 text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full cursor-pointer"
                      title={p}
                    >
                      <Download size={10} /> {kind}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubcaseMetricsRow({ sc }) {
  // 가능한 키 패턴 — F06Parser 출력 스키마에 따라 방어적으로 표시
  const dispMax = sc?.displacement?.max?.magnitude ?? sc?.displacement?.maxMagnitude ?? sc?.maxDisplacement;
  const dispNode = sc?.displacement?.max?.nodeId ?? sc?.displacement?.maxNode ?? null;
  const spcMax = sc?.spc_force?.max?.magnitude ?? sc?.spcForce?.maxMagnitude;
  const beamMaxStress = sc?.cbeam_stress?.max?.value ?? sc?.cbar_stress?.max?.value
                       ?? sc?.cbeamStress?.max ?? sc?.cbarStress?.max;

  const items = [
    {
      label: '최대 변위',
      value: dispMax != null ? `${Number(dispMax).toFixed(3)} mm` : '—',
      sub:   dispNode != null ? `노드 ${dispNode}` : null,
    },
    {
      label: 'SPC 반력 최대',
      value: spcMax != null ? `${Number(spcMax).toFixed(1)} N` : '—',
    },
    {
      label: 'BEAM 최대 응력',
      value: beamMaxStress != null ? `${Number(beamMaxStress).toFixed(1)} MPa` : '—',
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(({ label, value, sub }) => (
        <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 min-w-0 overflow-hidden">
          <p className="text-[10px] text-slate-400 truncate mb-0.5">{label}</p>
          <p className="text-sm font-bold font-mono leading-tight truncate text-slate-800">{value}</p>
          {sub && <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

/* ── 페이지 잠금 오버레이: Edit BDF Nastran 해석 + F06 파싱 진행 중 ── */
function EditApplyingOverlay({ status }) {
  const p = status?.progress ?? 0;
  const message = status?.message ?? '편집 적용 + Nastran + F06 파싱 진행 중...';
  // 단계 추정
  const stage =
    p < 20 ? { idx: 1, label: 'Edit BDF 생성 (apply-edit-intent)' } :
    p < 70 ? { idx: 2, label: 'Edit BDF Nastran 구조해석' } :
             { idx: 3, label: 'F06 결과 파싱' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm cursor-wait">
      <div className="rounded-2xl border-2 border-blue-300 bg-white shadow-2xl px-8 py-6 max-w-md w-[90%]">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 size={22} className="text-blue-600 animate-spin shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-800">Edit Model로 구조해석 진행 중</p>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">화면 조작이 일시 중단됩니다.</p>
          </div>
          <span className="ml-auto text-base font-bold font-mono text-blue-700">{p}%</span>
        </div>
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden mb-3">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${p}%` }} />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
            STEP {stage.idx} / 3
          </span>
          <span className="text-xs font-semibold text-slate-700">{stage.label}</span>
        </div>
        <p className="text-[11px] text-slate-500">{message}</p>
        <p className="mt-3 pt-3 border-t border-slate-100 text-[10px] text-slate-400 italic">
          해석 완료까지 수 분이 소요될 수 있습니다 — 완료 시 자동으로 잠금이 해제됩니다.
        </p>
      </div>
    </div>
  );
}

function DownloadRowSlim({ label, filepath, primary }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-[10px] text-slate-400 font-mono truncate" title={filepath}>{fileBaseName(filepath)}</p>
      </div>
      <button
        onClick={() => triggerDownload(filepath).catch(e => console.warn(e))}
        className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded cursor-pointer ${
          primary
            ? 'bg-slate-700 hover:bg-slate-800 text-white'
            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
        }`}
      >
        <Download size={10} /> 다운로드
      </button>
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
        <p className="text-sm font-bold text-slate-700">Model Edit 결과</p>
        {trace?.baseStage && (
          <span className="ml-auto text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            base: {trace.baseStage}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <SummaryMetric label="총 의도(intent)" value={total.toLocaleString()} variant="neutral" />
        <SummaryMetric label="적용 성공"       value={success.toLocaleString()} variant={failed > 0 || success === 0 ? 'neutral' : 'good'} />
        <SummaryMetric label="실패/거부"       value={failed.toLocaleString()}  variant={failed > 0 ? 'error' : 'neutral'} />
      </div>

      {Object.keys(kindCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">유형</span>
          {Object.entries(kindCounts).map(([kind, count]) => (
            <span key={kind} className="text-[11px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              {kind} <span className="font-bold">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      {detailLines.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">적용 상세 ({detailLines.length}/{appliedOps.length})</p>
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
        ⚠ Nastran 해석 결과(F06)가 없습니다. Nastran 실행이 실패했거나 비활성 상태였습니다.
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
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" />
          <p className="text-sm font-bold text-emerald-900">Nastran 해석 정상 종료</p>
          <span className="ml-auto text-[10px] font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            FATAL 0 · ERROR 0
          </span>
        </div>
        <p className="text-[11px] text-emerald-800/80 mt-1.5">F06 파일에 FATAL/ERROR 메시지가 없습니다.</p>
      </div>
    );
  }

  // 발생: 카운트 + 샘플 메시지 표시
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} className="text-red-600" />
        <p className="text-sm font-bold text-red-900">Nastran 해석 오류 발생</p>
        <span className="ml-auto text-[10px] font-mono text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold">
          FATAL {fatal} · ERROR {error}
        </span>
      </div>

      {fatal > 0 && Array.isArray(diag.fatalSamples) && diag.fatalSamples.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-widest mb-1.5">FATAL 메시지</p>
          <div className="space-y-1.5">
            {diag.fatalSamples.map((s, i) => (
              <pre key={i} className="text-[10px] font-mono text-red-900 bg-white border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap break-all leading-snug">{s}</pre>
            ))}
          </div>
        </div>
      )}

      {error > 0 && Array.isArray(diag.errorSamples) && diag.errorSamples.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-widest mb-1.5">ERROR 메시지</p>
          <div className="space-y-1.5">
            {diag.errorSamples.map((s, i) => (
              <pre key={i} className="text-[10px] font-mono text-red-900 bg-white border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap break-all leading-snug">{s}</pre>
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
    if (d === 0) return { txt: '±0', cls: 'text-slate-400' };
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
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50/40 to-white px-5 py-4 shadow-sm w-full min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-600" />
        <p className="text-sm font-bold text-slate-700">Edit 적용 모델 메트릭</p>
        <span className="ml-auto text-[10px] text-slate-400">원본 대비 Δ</span>
      </div>

      {/* 4개 핵심 카운트 */}
      <div className="grid grid-cols-4 gap-2">
        {items.map(({ label, eVal, oVal }) => {
          const delta = fmtDelta(eVal, oVal);
          return (
            <div key={label} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm min-w-0 overflow-hidden">
              <p className="text-[10px] text-slate-400 truncate mb-0.5">{label}</p>
              <p className="text-lg font-bold font-mono leading-tight truncate text-slate-800">
                {eVal != null ? eVal.toLocaleString() : '—'}
              </p>
              {delta && (
                <p className={`text-[10px] font-mono leading-none mt-0.5 ${delta.cls}`}>{delta.txt}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 질량 특성 — Final JSON 에 포함된 경우 */}
      {mp && (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">질량 특성 (Mass Properties)</p>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-2xl font-bold font-mono text-slate-800 leading-none">
              {Number(mp.totalMassTon ?? mp.totalMassKg / 1000 ?? 0).toFixed(2)}
            </span>
            <span className="text-xs text-slate-500 mb-0.5">ton</span>
            {mp.beamMassTon != null && (
              <span className="ml-auto text-[10px] text-slate-500 font-mono">
                BEAM {Number(mp.beamMassTon).toFixed(2)} · PM {Number(mp.pointMassTon ?? 0).toFixed(2)}
              </span>
            )}
          </div>
          {Array.isArray(cgArr) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CG</span>
              {['X', 'Y', 'Z'].map((axis, idx) => (
                <span key={axis} className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                  {axis} {cgArr[idx] != null ? Number(cgArr[idx]).toFixed(0) : '—'} mm
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StudioLauncher({
  bdfResult, onLaunchViewer, viewerInstalled, viewerStatus, viewerProgress, viewerError,
  installedVersion, latestVersion,
}) {
  const ready = !!bdfResult?.outputDir;
  const installing = viewerStatus === 'installing';
  const checking   = viewerStatus === 'checking';
  // 버전 일치 판단 — 둘 다 알 때만 비교. 한쪽이라도 null 이면 일치/불일치 판단 보류.
  const versionMismatch = !!(installedVersion && latestVersion && installedVersion !== latestVersion);

  // 버튼 하부에 표시할 버전 라인 — 설치본 v{x}, (다르면) → 워크벤치 v{y} 업데이트 필요
  const versionLine = (() => {
    if (installedVersion && latestVersion && versionMismatch) {
      return (
        <p className="mt-1.5 text-[10px] font-mono text-amber-700 text-right whitespace-nowrap">
          설치본 v{installedVersion} → 워크벤치 v{latestVersion}
          <span className="ml-1 px-1.5 py-[1px] rounded bg-amber-100 text-amber-800 font-bold">업데이트 필요</span>
        </p>
      );
    }
    if (installedVersion) {
      return (
        <p className="mt-1.5 text-[10px] font-mono text-slate-400 text-right whitespace-nowrap">v{installedVersion}</p>
      );
    }
    if (latestVersion) {
      return (
        <p className="mt-1.5 text-[10px] font-mono text-slate-400 text-right whitespace-nowrap">워크벤치 v{latestVersion}</p>
      );
    }
    return null;
  })();

  const featureBullets = (
    <ul className="text-[11px] text-slate-700 mt-2 space-y-0.5 leading-relaxed">
      <li>• <b>3D 모델 시각화</b> — 노드/요소/RBE2/CONM2/U-bolt 회전·확대 검토</li>
      <li>• <b>연결성 그룹 진단</b> — 비연결 그룹·고립 노드·자유단 색상 구분</li>
      <li>• <b>모델 수정</b> — RBE2 강체 수동 추가, 불필요 그룹 삭제</li>
      <li>• <b>편집 결과 BDF 재생성</b> — apply-edit-intent 적용 후 Nastran 검증 가능</li>
    </ul>
  );

  // 설치되지 않음 — 안내 카드
  if (viewerInstalled === false) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 px-5 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <PackageX size={16} className="text-amber-700" />
              <p className="text-base font-bold text-amber-900">Model Builder Studio</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold">미설치</span>
            </div>
            <p className="text-[13px] text-amber-900 font-bold leading-snug mb-1">
              모델 검증 · 수정 · 그룹 진단을 수행하려면 아래 <b>“Studio 설치 후 열기”</b> 버튼을 눌러주세요.
            </p>
            <p className="text-[12px] text-amber-900 font-semibold leading-relaxed">
              Model Builder Studio가 설치되지 않아 설치가 필요합니다.
            </p>
            <p className="text-[11px] text-amber-800/90 mt-1 leading-relaxed">
              ⓘ <b>최초 1회만</b> 자동 다운로드 후 설치됩니다. 한번 설치된 뒤로는 이 단계 없이 즉시 열립니다.
            </p>
            {featureBullets}
            {viewerError && <p className="mt-1.5 text-[10px] text-red-600 leading-snug">⚠ {viewerError}</p>}
          </div>
          <div className="shrink-0 flex flex-col items-end">
            <button
              onClick={onLaunchViewer}
              disabled={!ready || installing || checking}
              title={!ready ? '먼저 Model Builder 실행을 완료하세요' : ''}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer"
            >
              {installing
                ? <><Loader2 size={13} className="animate-spin" /> 설치 중 {viewerProgress?.progress ?? 0}%</>
                : checking
                ? <><Loader2 size={13} className="animate-spin" /> 확인 중...</>
                : <><Download size={13} /> Studio 설치 후 열기</>
              }
            </button>
            {versionLine}
          </div>
        </div>
      </div>
    );
  }

  // 설치됨 (또는 확인 중) — 정상 카드 / 버전 불일치 시 amber 톤으로 전환
  const cardCls = versionMismatch
    ? 'rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 px-5 py-4 shadow-sm'
    : 'rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 px-5 py-4 shadow-sm';
  const titleCls = versionMismatch ? 'text-amber-900' : 'text-emerald-900';
  const bodyCls  = versionMismatch ? 'text-amber-900' : 'text-emerald-900';
  const subCls   = versionMismatch ? 'text-amber-900/80' : 'text-emerald-900/80';
  const monoCls  = versionMismatch ? 'text-amber-700' : 'text-emerald-700';
  const btnCls   = versionMismatch
    ? 'flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer'
    : 'flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer';
  const iconColor = versionMismatch ? 'text-amber-700' : 'text-emerald-700';

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {versionMismatch
              ? <AlertCircle size={16} className={iconColor} />
              : <CheckCircle2 size={16} className={iconColor} />}
            <p className={`text-base font-bold ${titleCls}`}>Model Builder Studio</p>
            {versionMismatch ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold">버전 업데이트 필요</span>
            ) : viewerInstalled === true ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold">설치됨 — 사용 가능</span>
            ) : viewerInstalled === null && checking ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-medium">확인 중...</span>
            ) : null}
          </div>
          <p className={`text-[13px] ${bodyCls} font-bold leading-snug mb-1`}>
            {versionMismatch
              ? <>설치본이 워크벤치 버전과 일치하지 않습니다. <b>“업데이트 후 열기”</b> 버튼을 누르면 자동 갱신됩니다.</>
              : <>모델 검증 · 수정 · 그룹 진단을 수행하려면 <b>“Studio 열기”</b> 버튼을 눌러주세요.</>}
          </p>
          <p className={`text-[11px] ${subCls} leading-relaxed`}>
            풀스크린 외부 창으로 phase JSON 결과 폴더를 자동 로드합니다.
            {' '}<span className={`font-mono text-[10px] ${monoCls}`}>/ {fileBaseName(bdfResult?.outputDir) || '결과 폴더 대기 중'}</span>
          </p>
          {featureBullets}
          {viewerError && <p className="mt-1.5 text-[10px] text-red-600 leading-snug">⚠ {viewerError}</p>}
        </div>
        <div className="shrink-0 flex flex-col items-end">
          <button
            onClick={onLaunchViewer}
            disabled={!ready || installing || checking}
            title={!ready ? '먼저 Model Builder 실행을 완료하세요' : ''}
            className={btnCls}
          >
            {installing
              ? <><Loader2 size={13} className="animate-spin" /> 업데이트 중 {viewerProgress?.progress ?? 0}%</>
              : checking
              ? <><Loader2 size={13} className="animate-spin" /> 확인 중...</>
              : versionMismatch
              ? <><Download size={13} /> 업데이트 후 열기</>
              : <><ExternalLink size={13} /> Studio 열기</>
            }
          </button>
          {versionLine}
        </div>
      </div>
    </div>
  );
}

/* ── Stage 진행 트랙 내 진단 배지 ── */
function DiagBadge({ count, kind }) {
  if (count === 0) return <span className="text-[10px] font-mono text-slate-300">—</span>;
  const cls = kind === 'error'   ? 'bg-red-100 text-red-700 font-bold'
            : kind === 'warning' ? 'bg-amber-100 text-amber-700'
            : 'bg-blue-50 text-blue-600';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${cls}`}>
      {count.toLocaleString()}
    </span>
  );
}

/* ── Stage 트랙 — 6단계를 가로로 강제 등분, 클릭 시 해당 stage 선택 ──
   stages: 역순(최종→초기)으로 들어옴. selectedKey/onSelect 로 master-detail 연동.
   부모 박스를 절대 안 넘기 위해: 각 stage 버튼을 flex-basis: 0 + flex-grow: 1 로 강제 등분
   + 모든 텍스트 truncate. 선택 표시는 inset border-2 로 ring 잘림 방지. */
function StageTrack({ stages, selectedKey, onSelect }) {
  if (!stages.length) return null;
  return (
    <div className="w-full min-w-0">
      <div className="flex items-stretch w-full min-w-0">
        {stages.map((st, i) => {
          const d   = st.diagnostics ?? {};
          const c   = st.counts ?? {};
          const hasErr  = (d.error ?? 0) > 0;
          const hasWarn = (d.warning ?? 0) > 0;
          const isLast  = i === stages.length - 1;
          const isSelected = st.stageIndex === selectedKey;
          const dotCls  = hasErr  ? 'bg-red-500'
                        : hasWarn ? 'bg-amber-400'
                        : 'bg-emerald-500';
          return (
            <React.Fragment key={st.stageIndex ?? i}>
              <button
                type="button"
                onClick={() => onSelect?.(st.stageIndex)}
                style={{ flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 }}
                className={`flex flex-col items-center px-1.5 py-3 rounded-lg cursor-pointer transition-all border-2 overflow-hidden
                  ${isSelected
                    ? 'bg-blue-50 border-blue-500 shadow-sm'
                    : 'border-transparent hover:bg-slate-50 hover:border-slate-200'}`}
              >
                <div className="flex flex-col items-center gap-1.5 w-full min-w-0">
                  <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${dotCls}`} />
                  <p className={`text-[12px] font-bold text-center truncate w-full leading-snug
                    ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}
                    title={st.stageName}>
                    {st.stageName}
                  </p>
                </div>
                <div className="mt-2.5 w-full min-w-0 space-y-1 text-center">
                  <p className="text-[14px] font-mono font-bold text-slate-800 leading-none truncate" title={`노드 ${(c.nodes ?? 0).toLocaleString()}`}>
                    {(c.nodes ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400 leading-none">노드</p>
                  <p className="text-[14px] font-mono font-bold text-slate-800 leading-none mt-1.5 truncate" title={`요소 ${(c.elements ?? 0).toLocaleString()}`}>
                    {(c.elements ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400 leading-none">요소</p>
                </div>
                <div className="mt-2.5 w-full flex flex-col items-center gap-0.5 min-w-0">
                  {hasErr
                    ? <DiagBadge count={d.error} kind="error" />
                    : <span className="text-[11px] text-emerald-500 font-semibold">OK</span>}
                </div>
                <p className="mt-1.5 text-[10px] font-mono text-slate-400 truncate w-full text-center">{st.processingDurationMs ?? 0}ms</p>
              </button>
              {!isLast && (
                <div className="flex items-center shrink-0 px-0.5 pt-3">
                  <ChevronsRight size={11} className="text-slate-300" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-400 italic text-center">↑ 단계를 클릭하면 아래에 상세 변화량이 표시됩니다 (좌측 1단계 → 우측 최종)</p>
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

  const mp     = s.massProperties ?? null;
  const cgArr  = mp?.centerOfGravityMm;

  // 사용자 요구: 경고는 대부분 중복 이름이라 정상 → 화면에서 완전히 삭제. 에러/정보만 표시.
  const totalErr  = s.totalErrors ?? 0;
  const totalInfo = s.totalInfos  ?? 0;

  return (
    <div className="space-y-3 w-full min-w-0">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          A. Hero — 최종 모델 요약 + 진단 합계
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className={`rounded-2xl border px-5 py-4 shadow-sm w-full min-w-0
        ${totalErr > 0
          ? 'bg-red-50 border-red-200'
          : 'bg-gradient-to-br from-slate-50 to-white border-slate-200'}`}>

        {/* 헤더 행 */}
        <div className="flex items-center gap-2 mb-3">
          {totalErr > 0
            ? <AlertCircle size={15} className="text-red-600 shrink-0" />
            : <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
          <span className={`text-sm font-bold ${totalErr > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {totalErr > 0 ? '모델 검증 완료 — 에러 발생' : '모델 검증 완료'}
          </span>
          <span className="ml-auto text-[10px] text-slate-400 font-mono">
            {stages.length}단계 · {s.firstStage ?? '—'} → {s.lastStage ?? '—'}
          </span>
        </div>

        {/* 최종 FEM 메트릭 4개 */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <SummaryMetric label="노드"        value={(s.finalNodeCount      ?? 0).toLocaleString()} variant="neutral" />
          <SummaryMetric label="요소 CBEAM"  value={(s.finalElementCount   ?? 0).toLocaleString()} variant="neutral" />
          <SummaryMetric label="강체 RBE2"   value={(s.finalRigidCount     ?? 0).toLocaleString()} variant="neutral" />
          <SummaryMetric label="질점 PM"     value={(s.finalPointMassCount ?? 0).toLocaleString()} variant="neutral" />
        </div>

        {/* 진단 합계 배지 — 에러/정보만 (경고는 대부분 정상이므로 표시 안 함) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">진단</span>
          <span className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full
            ${totalErr > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
            <AlertCircle size={11} /> 에러 {totalErr.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500 px-2.5 py-1 rounded-full bg-slate-100">
            정보 {totalInfo.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          B. 질량 특성
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {mp && (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm w-full min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">질량 특성 (Mass Properties)</p>

          {/* 총 질량 — 큰 수치 */}
          <div className="flex items-end gap-2 mb-3">
            <span className="text-3xl font-bold font-mono text-slate-800 leading-none">
              {Number(mp.totalMassTon ?? 0).toFixed(2)}
            </span>
            <span className="text-sm text-slate-500 mb-0.5">ton</span>
          </div>

          {/* BEAM / PointMass 분리 진행 바 */}
          {(() => {
            const total = Number(mp.totalMassTon ?? 0);
            const beam  = Number(mp.beamMassTon  ?? 0);
            const pm    = Number(mp.pointMassTon ?? 0);
            const beamPct = total > 0 ? (beam / total) * 100 : 0;
            const pmPct   = total > 0 ? (pm   / total) * 100 : 0;
            return (
              <div className="space-y-1.5 mb-3">
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                  <div className="h-full bg-blue-500 rounded-l-full" style={{ width: `${beamPct}%` }} />
                  <div className="h-full bg-violet-400 rounded-r-full" style={{ width: `${pmPct}%` }} />
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
                    BEAM {beam.toFixed(2)} ton
                    <span className="text-slate-400 font-mono">({beamPct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="w-2 h-2 rounded-sm bg-violet-400 inline-block" />
                    PointMass {pm.toFixed(2)} ton
                    <span className="text-slate-400 font-mono">({pmPct.toFixed(0)}%)</span>
                  </span>
                </div>
              </div>
            );
          })()}

          {/* CG 좌표 */}
          {Array.isArray(cgArr) && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CG</span>
              {['X', 'Y', 'Z'].map((axis, idx) => (
                <span key={axis} className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                  {axis} {cgArr[idx] != null ? Number(cgArr[idx]).toFixed(0) : '—'} mm
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          C. Stage 진행 트랙 + 선택된 stage 상세 (마스터-디테일)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {stages.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm w-full min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 gap-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Stage 진행 ({stages.length}단계)
            </p>
            {selectedStage && (
              <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                선택: #{selectedStage.stageIndex} {selectedStage.stageName}
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

function PhaseDeltaCard({ stage }) {
  const d = stage.delta        ?? {};
  const c = stage.connectivity ?? {};
  const h = stage.health       ?? {};

  const fmtDiff = (n) => n > 0 ? `+${n.toLocaleString()}` : n < 0 ? n.toLocaleString() : '0';
  const diffCls = (n) => n > 0 ? 'text-blue-600' : n < 0 ? 'text-red-500' : 'text-slate-300';

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden w-full min-w-0">
      {/* 카드 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-slate-100">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold shrink-0">
          #{stage.stageIndex}
        </span>
        <span className="text-xs font-bold text-slate-700 truncate">{stage.stageName}</span>
        {(stage.diagnostics?.error ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold shrink-0">
            에러 {stage.diagnostics.error}
          </span>
        )}
        {(stage.diagnostics?.warning ?? 0) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
            경고 {(stage.diagnostics.warning).toLocaleString()}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-400 font-mono shrink-0">
          {stage.processingDurationMs ?? 0} ms
        </span>
      </div>

      {/* 3섹션 세로 스택 표 — 부모 폭 절대 넘지 않음 */}
      <div className="px-4 py-3 space-y-3 w-full min-w-0 overflow-hidden">

        {/* 변화량 (Δ) 표 */}
        <div className="w-full min-w-0 overflow-hidden">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">변화량 (Δ)</p>
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
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">연결성</p>
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
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">건전성</p>
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

/* ── KvLine은 기존 코드에서 사용될 수 있으므로 유지 ── */
function KvLine({ label, value, cls = '', bold = false }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-slate-500 truncate shrink">{label}</span>
      <span className={`font-mono shrink-0 ${bold ? 'font-bold' : ''} ${cls || 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function SummaryMetric({ label, value, variant }) {
  const color = variant === 'error' ? 'text-red-600'
              : variant === 'warn'  ? 'text-amber-600'
              : variant === 'good'  ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm min-w-0 overflow-hidden">
      <p className="text-[10px] text-slate-400 truncate mb-0.5">{label}</p>
      <p className={`text-lg font-bold font-mono leading-tight truncate ${color}`}>{value}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Nastran 패널
   ──────────────────────────────────────────────────────────────────────── */

function NastranPanel({ bdfResult, hasResult, editStatus }) {
  // step 3 "해석 모델 저장" — BDF 다운로드 전용 페이지.
  //   • 원본 최종 BDF (build-full) — 항상 표시
  //   • 최종 Edit BDF (apply-edit-intent) — 편집 적용 시에만 표시. 파일명은 *_edit.bdf 로 받음.
  // 다른 산출물(JSON / StageSummary / InputAudit / F06 / OP2 / LOG) 다운로드는 노출하지 않음.
  if (!hasResult) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
        <Cpu size={36} className="opacity-40" />
        <p className="text-xs text-center max-w-md">Model Builder 실행 후 최종 BDF 가 여기에 표시됩니다.</p>
      </div>
    );
  }
  if (!bdfResult?.outputDir) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6">
        <p className="text-xs text-amber-700">출력 디렉터리 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }
  const editBdf = editStatus?.edited_bdf_path;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-600" />
        <p className="text-xs text-emerald-800">
          최종 BDF 를 다운로드하여 외부 해석/공유에 사용하세요.
          {editBdf && ' Edit 모델이 적용된 경우 두 가지 BDF 가 표시됩니다.'}
        </p>
      </div>

      <div className="space-y-2">
        {/* 원본 최종 BDF */}
        {bdfResult.bdfPath && (
          <FileDownloadRow
            label="원본 최종 BDF"
            filename={fileBaseName(bdfResult.bdfPath)}
            filepath={bdfResult.bdfPath}
            primary
          />
        )}
        {/* 최종 Edit BDF — 편집 적용된 경우에만 */}
        {editBdf && (
          <FileDownloadRow
            label="최종 Edit BDF"
            filename={makeEditDownloadName(editBdf, 'bdf')}
            filepath={editBdf}
            downloadName={makeEditDownloadName(editBdf, 'bdf')}
            primary
          />
        )}
      </div>

      {!editBdf && (
        <p className="text-[10px] text-slate-400 italic px-1">
          모델 수정을 수행하면 "최종 Edit BDF" 다운로드가 추가됩니다.
        </p>
      )}
    </div>
  );
}

function FileDownloadRow({ label, filename, filepath, primary, downloadName }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-[10px] text-slate-400 font-mono truncate" title={filename}>{filename}</p>
      </div>
      <button
        onClick={() => triggerDownload(filepath, downloadName).catch(e => console.warn(e))}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 ${primary ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-800'} text-white text-xs font-semibold rounded-lg cursor-pointer`}
      >
        <Download size={12} /> 받기
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   옵션 패널
   ──────────────────────────────────────────────────────────────────────── */

function OptionsPanel({
  meshSize, setMeshSize,
  uboltFullFix, setUboltFullFix,
  useNastran, setUseNastran,
  disabled,
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">해석 설정</p>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-700">Mesh Size</p>
            <p className="text-[10px] text-slate-400">기본 요소 크기 (mm)</p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number" value={meshSize} onChange={(e) => setMeshSize(e.target.value)}
              step="10" min="10" disabled={disabled}
              className="w-24 text-right text-xs px-2 py-1.5 border border-slate-200 bg-white text-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 cursor-text"
            />
            <span className="text-xs text-slate-400">mm</span>
          </div>
        </div>
        <div className="h-px bg-slate-100" />
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <p className="text-xs font-medium text-slate-700">U-bolt Rigid 자동 고정</p>
            <p className="text-[10px] text-slate-400">U-bolt RBE2 DOF=123456</p>
          </div>
          <input
            type="checkbox" checked={uboltFullFix} onChange={(e) => setUboltFullFix(e.target.checked)} disabled={disabled}
            className="w-4 h-4 rounded text-blue-600 cursor-pointer disabled:opacity-50"
          />
        </label>
        <div className="h-px bg-slate-100" />
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div>
            <p className="text-xs font-medium text-slate-700">Nastran 자동 실행</p>
            <p className="text-[10px] text-slate-400">GRAV+SPC1 후 nastran.exe</p>
          </div>
          <input
            type="checkbox" checked={useNastran} onChange={(e) => setUseNastran(e.target.checked)} disabled={disabled}
            className="w-4 h-4 rounded text-blue-600 cursor-pointer disabled:opacity-50"
          />
        </label>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

export default function HiTessModelBuilder() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});
  const setPageState   = dashboardCtx?.setModelBuilderPageState || (() => {});
  const saved          = dashboardCtx?.modelBuilderPageState;

  // ── 입력 상태 ──
  const [struFile,  setStruFile]  = useState(saved?.struFile ?? null);
  const [pipeFile,  setPipeFile]  = useState(saved?.pipeFile ?? null);
  const [equiFile,  setEquiFile]  = useState(saved?.equiFile ?? null);
  const [struError, setStruError] = useState(null);
  const [pipeError, setPipeError] = useState(null);
  const [equiError, setEquiError] = useState(null);

  // ── 옵션 (기본값: useNastran=true, uboltFullFix=true, meshSize=500) ──
  const [meshSize,      setMeshSize]      = useState(saved?.meshSize      ?? '500');
  const [uboltFullFix,  setUboltFullFix]  = useState(saved?.uboltFullFix  ?? true);
  const [useNastran,    setUseNastran]    = useState(saved?.useNastran    ?? true);

  // ── 작업/결과 상태 ──
  const [steps,      setSteps]      = useState(() => saved?.steps ?? INITIAL_STEPS.map(s => ({ ...s })));
  const [activeIdx,  setActiveIdx]  = useState(saved?.activeIdx ?? 0);
  const [hasRunOnce, setHasRunOnce] = useState(saved?.hasRunOnce ?? false);
  const [jobStatus,  setJobStatus]  = useState(saved?.jobStatus ?? null);
  const [bdfResult,  setBdfResult]  = useState(saved?.bdfResult ?? null);
  const [engineLog,  setEngineLog]  = useState(saved?.engineLog ?? null);
  const [runNastranRequested, setRunNastranRequested] = useState(saved?.runNastranRequested ?? false);
  const [changelogOpen, setChangelogOpen] = useState(false);

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
  const [latestVersion,    setLatestVersion]    = useState(null); // 서버 zip 의 최신
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

  const pollRef = useRef(null);

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
        setLatestVersion(meta?.manifest?.version ?? null);
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

  // ── 언마운트 시 상태 초기화: 다른 앱으로 나가면 모두 리셋 ──
  useEffect(() => () => { setPageState(null); }, [setPageState]);

  // ── 최초 마운트: globalJob 동기화 ──
  useEffect(() => {
    const gj = dashboardCtx?.globalJob;
    if (saved?.jobStatus?.status === 'Running' && gj?.menu === 'HiTess Model Builder') {
      if (gj.status === 'Success' || gj.status === 'Failed') {
        fetch(`${API_BASE_URL}/api/analysis/status/${gj.jobId}`, { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then(applyJobResult)
          .catch(() => setJobStatus({ status: 'Failed', progress: 0, message: '상태 조회 실패' }));
      } else if (gj.status === 'Running') {
        startPolling(gj.jobId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 언마운트: 폴링 정리 ──
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
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
      .then(d => { if (!cancelled) setSummaryData(d); })
      .catch(e => { if (!cancelled) setSummaryError(`StageSummary 로드 실패: ${e.message}`); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [bdfResult?.summaryPath]);

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
    if (!struFile) { showToast('Structural CSV 파일이 필요합니다.', 'warning'); return; }
    const isHardError = (e) => e && !e.startsWith('__warn__');
    if (isHardError(struError) || isHardError(pipeError) || isHardError(equiError)) {
      showToast('파일 형식 오류를 먼저 해결하세요.', 'warning'); return;
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const formData = new FormData();
    formData.append('stru_file', struFile);
    if (pipeFile) formData.append('pipe_file',  pipeFile);
    if (equiFile) formData.append('equip_file', equiFile);
    formData.append('employee_id', user.employee_id || 'unknown');
    formData.append('mesh_size',      String(parseInt(meshSize, 10) || 500));
    formData.append('ubolt_full_fix', String(!!uboltFullFix));
    formData.append('run_nastran',    String(!!useNastran));

    setHasRunOnce(true);
    setRunNastranRequested(!!useNastran);
    setActiveIdx(0);
    setBdfResult(null);
    setAuditData(null);
    setSummaryData(null);
    setEngineLog(null);
    setSteps(prev => prev.map((s, i) =>
      i === 0 ? { ...s, status: 'running' } : { ...s, status: 'wait' }
    ));
    setJobStatus({ status: 'Running', progress: 10, message: '파일 전송 중...' });

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
      startPolling(data.job_id);
      startGlobalJob(data.job_id, 'HiTess Model Builder');
    } catch (e) {
      setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error' } : s));
      setJobStatus({ status: 'Failed', progress: 0, message: `요청 실패: ${e.message}` });
      setEngineLog(`[요청 실패]\n서버: ${API_BASE_URL}\n오류: ${e.message}`);
    }
  };

  /* ── 폴링 ──────────────────────────────────────────────────────────── */
  const startPolling = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        setJobStatus(data);

        if (data.status === 'Running') {
          const p = data.progress || 0;
          setSteps(prev => prev.map((s, i) => {
            if (i === 0) return { ...s, status: p >= 60 ? 'done' : 'running' };
            if (i === 1) return { ...s, status: p >= 60 ? 'running' : 'wait' };
            return s;
          }));
        }

        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          applyJobResult(data);
        }
      } catch {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1500);
  };

  const applyJobResult = useCallback((data) => {
    setJobStatus(data);
    if (data.status === 'Success') {
      setBdfResult({
        outputDir:    data.output_dir   ?? null,
        auditPath:    data.audit_path   ?? null,
        summaryPath:  data.summary_path ?? null,
        bdfPath:      data.bdf_path     ?? null,
        jsonPath:     data.json_path    ?? null,
      });
      setSteps(prev => prev.map((s, i) => {
        if (i === 0) return { ...s, status: 'done' };
        if (i === 1) return { ...s, status: 'done' };
        if (i === 2) return { ...s, status: data.run_nastran ? 'done' : 'wait' };
        return s;
      }));
      // 사용자 요구: 실행 완료 시 자동으로 step 0 (CSV 검증) 으로 이동
      setActiveIdx(0);
    } else if (data.status === 'Failed') {
      setSteps(prev => prev.map((s, i) => i <= 1 ? { ...s, status: 'error' } : s));
      setEngineLog(data.engine_log || data.message || '알 수 없는 오류');
    }
  }, []);

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
        const token = localStorage.getItem('session_token');
        const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
          downloadUrl,
          jobId: jobStatus?.job_id || bdfResult.outputDir.split(/[\\/]/).pop(),
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
        if (sd.status === 'Success' || sd.status === 'Failed') {
          clearInterval(editPollRef.current);
          editPollRef.current = null;
          setEditApplying(false);
          if (sd.status === 'Success') {
            await refreshEditStatus();
            showToast('편집 적용 완료 — Edit 탭에서 확인하세요.', 'success');
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
  }, [refreshEditStatus, showToast]);

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
      showToast('새 편집 내역 감지 — apply-edit-intent 자동 실행', 'info');
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
  // EditApplyingOverlay 가 진행률을 표시.
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
  }, [startApplyEditJob, pollEditJobInBackground, refreshEditStatus, showToast, localResultDir, bdfResult?.outputDir]);

  /* ── 리셋 ──────────────────────────────────────────────────────────── */
  const handleReset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (editPollRef.current) { clearInterval(editPollRef.current); editPollRef.current = null; }
    setStruFile(null); setPipeFile(null); setEquiFile(null);
    setStruError(null); setPipeError(null); setEquiError(null);
    setMeshSize('500'); setUboltFullFix(true); setUseNastran(true);
    setLocalResultDir(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setActiveIdx(0); setHasRunOnce(false);
    setJobStatus(null); setBdfResult(null); setEngineLog(null);
    setRunNastranRequested(false);
    setAuditData(null); setSummaryData(null);
    setViewerStatus('idle'); setViewerError(null); setViewerProgress(null);
    setEditStatus(null); setEditTrace(null); setEditedSummary(null);
    setEditApplying(false); setEditJobStatus(null); setEditError(null);
  };

  /* ── 파생 ──────────────────────────────────────────────────────────── */
  const activeStep = steps[activeIdx];
  const doneCount  = steps.filter(s => s.status === 'done').length;
  const isRunning  = jobStatus?.status === 'Running' || jobStatus?.status === 'Pending';
  const hasResult  = !!bdfResult?.outputDir;

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">

      {/* ── Edit Nastran 진행 중 페이지 잠금 오버레이 ── */}
      {editApplying && (
        <EditApplyingOverlay status={editJobStatus} />
      )}

      {/* ── 그라디언트 배너 헤더 (File-Based Apps 표준) ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-indigo-900 to-violet-700 overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentMenu('File-Based Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <ShieldCheck size={18} /> HiTess Model Builder
              </h1>
              <p className="text-sm text-violet-200/80 mt-0.5">AM 3D 설계 CSV → 1D Beam FEM → Nastran BDF 자동 변환</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              <History size={14} /> 이력
            </button>
            <GuideButton guideTitle="[파일] HiTess Model Builder — CSV → BDF 변환" variant="dark" />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 gap-5 min-h-0 px-1">

        {/* ── Left ── */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">

          {/* 파이프라인 스텝퍼 + 실행 */}
          <div className="flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">파이프라인</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>
            <div className="py-5 px-4">
              {steps.map((step, idx) => {
                const StepIcon = step.icon;
                const effective = (step.id === 'nastran' && !runNastranRequested && step.status === 'wait') ? 'wait' : step.status;
                const cfg = STATUS_CONFIG[effective];
                const isActive = idx === activeIdx;
                const isLast = idx === steps.length - 1;
                return (
                  <div key={step.id} className="flex items-stretch">
                    <div className="flex flex-col items-center w-8 shrink-0 pt-5">
                      <div className={`w-4 h-4 rounded-full shrink-0 ${cfg.dot}`} />
                      {!isLast && <div className="flex-1 w-0.5 my-1.5 rounded-full bg-violet-300" />}
                    </div>
                    <div
                      className={`flex-1 mb-3 ml-2 rounded-xl border px-4 py-4 transition-all cursor-pointer
                        ${isActive ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                      onClick={() => setActiveIdx(idx)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StepIcon size={15} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                          <span className={`text-sm font-bold leading-tight ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                            {idx + 1}. {step.title}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap ${cfg.badge}`}>
                          {isActive && step.status === 'wait' ? '선택됨' : cfg.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
              <button
                onClick={handleRunModelBuilder}
                disabled={isRunning}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm cursor-pointer"
              >
                {isRunning
                  ? <><Loader2 size={15} className="animate-spin" /> 실행 중...</>
                  : <><ChevronsRight size={16} /> Model Builder 실행</>
                }
              </button>
              <button
                onClick={handleReset}
                disabled={!hasRunOnce || isRunning}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>

          {/* 옵션 */}
          <OptionsPanel
            meshSize={meshSize} setMeshSize={setMeshSize}
            uboltFullFix={uboltFullFix} setUboltFullFix={setUboltFullFix}
            useNastran={useNastran} setUseNastran={setUseNastran}
            disabled={isRunning}
          />
        </div>

        {/* ── Right ── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto custom-scrollbar">
          {/* 진행률 (실행 중) */}
          {isRunning && (
            <ProgressBar
              progress={jobStatus?.progress ?? 0}
              message={jobStatus?.message}
              error={jobStatus?.status === 'Failed'}
            />
          )}

          {/* CSV 입력 영역 (csv-validation 활성 시) */}
          {activeStep.id === 'csv-validation' && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4">
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
                <UploadCloud size={14} className="text-blue-600" />
                <h2 className="text-sm font-bold text-slate-700">CSV 입력</h2>
                <span className="text-[10px] text-slate-400">— 한 번에 3개 드래그하면 자동 분류</span>
              </div>
              <DetailCSV
                struFile={struFile} pipeFile={pipeFile} equiFile={equiFile}
                struError={struError} pipeError={pipeError} equiError={equiError}
                setStruFile={setStruFile} setPipeFile={setPipeFile} setEquiFile={setEquiFile}
                setStruError={setStruError} setPipeError={setPipeError} setEquiError={setEquiError}
                onAutoAssign={handleAutoAssign}
                onMultipleFiles={handleMultipleFiles}
                onWarnNotCsv={() => showToast('CSV 파일(.csv)만 업로드 가능합니다.', 'warning')}
              />
            </div>
          )}

          {/* 활성 스텝 컨텐츠 — 카드는 콘텐츠 크기에 따라 자연스럽게 자라며,
              우측 컬럼의 overflow-y-auto가 스크롤을 담당. flex-1/min-h-0 제거하여
              부모 박스 밖으로 콘텐츠가 비집고 나오는 현상 해결. */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4 min-w-0">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
              <activeStep.icon size={14} className="text-blue-600" />
              <h2 className="text-sm font-bold text-slate-700">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            {activeStep.id === 'csv-validation' && (
              <CsvAuditPanel
                audit={auditData}
                jobStatus={jobStatus}
                hasResult={hasResult && !!bdfResult?.auditPath}
                loading={auditLoading}
                error={auditError}
                onRetry={() => setBdfResult(prev => ({ ...prev }))}
              />
            )}
            {activeStep.id === 'model-qc' && (
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
                onRefreshEditStatus={refreshEditStatus}
              />
            )}
            {activeStep.id === 'nastran' && (
              <NastranPanel
                bdfResult={bdfResult}
                hasResult={hasResult}
                editStatus={editStatus}
              />
            )}
          </div>

          {/* 엔진 로그 (오류 시) */}
          {engineLog && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-red-600" />
                <p className="text-xs font-bold text-red-700">엔진 출력</p>
              </div>
              <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{engineLog}</pre>
            </div>
          )}
        </div>
      </div>

      <ChangelogModal
        programKey="HiTessModelBuilder"
        title="HiTess Model Builder 변경 이력"
        isOpen={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />
    </div>
  );
}
