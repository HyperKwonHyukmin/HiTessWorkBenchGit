// NOTE: 인증이 필요한 analysis/download API를 사용하므로 fetch에 Authorization 헤더를 명시한다.
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle, Download,
  ChevronDown, Loader2, RefreshCw,
  FileSpreadsheet, AlertTriangle, ChevronsRight, RotateCcw,
  ExternalLink, HardDrive, PackageX, ShieldCheck,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import PageBanner from '../../components/ui/PageBanner';
import { getAuthHeaders, handleUnauthorized } from '../../utils/auth';

const API_ENDPOINT = '/api/analysis/mooring-fitting/request';
const STATUS_ENDPOINT = (jobId) => `/api/analysis/status/${jobId}`;
const DOWNLOAD_ENDPOINT = (path) => `/api/download?filepath=${encodeURIComponent(path)}`;

/* ──────────────────────────────────────────────────────────────────────────
   상수
   ──────────────────────────────────────────────────────────────────────── */

const INITIAL_STEPS = [
  { id: 'csv-validation', title: 'CSV 입력 검증',               icon: FileSpreadsheet, status: 'wait' },
  { id: 'mf-studio',      title: 'Mooring Fitting Studio 실행',  icon: ExternalLink,    status: 'wait' },
  { id: 'final-check',    title: '최종 검증',                   icon: CheckCircle2,    status: 'wait' },
];

const STATUS_CONFIG = {
  wait:    { dot: 'bg-slate-300',                          badge: 'bg-slate-100 text-slate-500',     label: '대기' },
  running: { dot: 'bg-blue-500 ring-4 ring-blue-100',      badge: 'bg-blue-100 text-blue-700',       label: '진행' },
  done:    { dot: 'bg-emerald-500',                        badge: 'bg-emerald-100 text-emerald-700', label: '완료' },
  error:   { dot: 'bg-red-500',                            badge: 'bg-red-100 text-red-700',         label: '오류' },
};

/* ──────────────────────────────────────────────────────────────────────────
   소형 UI 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

function ProgressBar({ progress, message, error, elapsed }) {
  const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-700">{message || '진행 중...'}</p>
        <div className="flex items-center gap-2">
          {elapsed != null && <span className="text-xs text-slate-400 font-mono">{fmtTime(elapsed)}</span>}
          <p className="text-xs font-bold text-blue-600 font-mono">{progress ?? 0}%</p>
        </div>
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
   UploadDropzone — HiTessModelBuilder CsvDropZone 스타일
   ──────────────────────────────────────────────────────────────────────── */

function UploadDropzone({ label, hint, file, disabled, onFiles, onClear }) {
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;
    const csvFiles = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (csvFiles.length > 0) onFiles(csvFiles);
  };

  const handlePick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length > 0) onFiles(picked);
    e.target.value = '';
  };

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden transition-colors ${file ? 'border-emerald-300' : 'border-slate-200'}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileSpreadsheet size={12} className={file ? 'text-emerald-500' : 'text-slate-400'} />
          <span className="text-xs font-semibold text-slate-700 truncate">{label}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium shrink-0">필수</span>
        </div>
        {file && !disabled && (
          <button
            onClick={onClear}
            className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
            title="제거"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* 바디 */}
      {file ? (
        <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-2.5 text-center">
          <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mb-0.5" />
          <p className="text-[10px] font-semibold text-slate-700 truncate w-full text-center" title={file.name}>{file.name}</p>
          <p className="text-[10px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !disabled && inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-1 py-3 transition-colors text-center
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-blue-50/40'}`}
        >
          <Upload size={16} className="text-slate-300" />
          <p className="text-[10px] text-slate-400 leading-relaxed px-2">
            드롭 또는 <span className="text-blue-600 font-medium">클릭</span>
            <br />
            <span className="text-slate-300">{hint}</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={handlePick}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ passed, label = passed ? 'PASSED' : 'FAILED' }) {
  const ok = passed === true || label === 'PASSED';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
    }`}>
      {ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
      {label}
    </span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-800 truncate">{value ?? '-'}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

function LoadingValidationPanel() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">out 폴더의 검증 JSON을 읽는 중...</span>
    </div>
  );
}

function MissingValidationPanel({ message }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-amber-700">검증 정보를 표시할 수 없습니다</p>
        <p className="text-xs text-amber-600 mt-1">{message}</p>
      </div>
    </div>
  );
}

function fileBaseName(path) {
  return String(path || '').split(/[\\/]/).pop();
}

const ROW_STATUS_CONFIG = {
  converted:   { label: '변환', badge: 'bg-emerald-100 text-emerald-700' },
  ignored:     { label: 'SKIP', badge: 'bg-amber-100 text-amber-700' },
  warning:     { label: '경고', badge: 'bg-yellow-100 text-yellow-700' },
  parseFailed: { label: '실패', badge: 'bg-red-100 text-red-700' },
  blank:       { label: '공백', badge: 'bg-slate-100 text-slate-500' },
};

const RAW_KIND_LABELS = {
  mf: 'MF',
  plate: 'PLATE / BRACKET',
  angle: 'ANGLE',
  flatbar: 'FLATBAR',
  tbar: 'TBAR',
};

const isTrivialSkip = (skip) => skip?.rowType === 'Empty' || skip?.rowType === 'Comment';
const isWarningSkip = (skip) => skip?.rowType === 'EMPTY_LOADCASE';
const getRawRowType = (skip) => String(skip?.rawLine || '').split(',')[0].trim().toUpperCase();
const isMetadataSkip = (skip) => {
  const tokens = [
    skip?.rowType,
    skip?.identifier,
    skip?.reason,
    skip?.rawLine,
    getRawRowType(skip),
  ].map(v => String(v || '').toUpperCase());

  return tokens.some(v => v.includes('CORROSION') || v.includes('MAIN GIRDER SIZE'));
};
const isIntentionalSkip = (skip) =>
  !isWarningSkip(skip) && (
    String(skip?.disposition || '').toLowerCase() === 'skip'
    || skip?.rowType === 'Skipped'
    || isMetadataSkip(skip)
  );
const isIgnoredSkip = (skip) => isTrivialSkip(skip) || isIntentionalSkip(skip);
const isFailureSkip = (skip) => !isIgnoredSkip(skip) && !isWarningSkip(skip);

function summarizeSkipReason(skip) {
  if (isWarningSkip(skip)) return '빈 LOADCASE (헤더/dummy, 변환 제외)';
  if (isMetadataSkip(skip)) return 'CORROSION / MAIN GIRDER SIZE 메타데이터 행';
  if (isIntentionalSkip(skip)) return 'SKIP 처리된 CSV 행';
  return skip.reason || skip.rowType || 'Unknown';
}

function buildConvertedRows(rawJson) {
  const structure = rawJson?.structure || {};
  const rows = [];

  Object.entries(RAW_KIND_LABELS).forEach(([key, label]) => {
    (structure[key] || []).forEach((item) => {
      rows.push({
        kind: 'Structure',
        rowType: item.sourceRowType || label,
        physicalLineNumber: item.lineNumber,
        status: 'converted',
        name: item.id || '-',
        reason: 'CSV row converted',
      });
    });
  });

  (rawJson?.winch?.loadCases || []).forEach((item) => {
    rows.push({
      kind: 'Load',
      rowType: 'LOADCASE',
      physicalLineNumber: item.lineNumber,
      status: 'converted',
      name: item.loadId || '-',
      reason: 'Load case converted',
    });
  });

  return rows;
}

function buildSkipRows(rawJson) {
  return (rawJson?.skips || []).map((skip) => {
    const status = skip.rowType === 'Empty' ? 'blank'
      : isWarningSkip(skip) ? 'warning'
        : isIgnoredSkip(skip) ? 'ignored' : 'parseFailed';
    return {
      kind: skip.kind === 'Winch' ? 'Load' : (skip.kind || '-'),
      rowType: skip.rowType || '-',
      physicalLineNumber: skip.lineNumber,
      status,
      name: skip.identifier || '-',
      reason: summarizeSkipReason(skip),
    };
  });
}

function summarizeMooringRawAudit(rawJson) {
  const meta = rawJson?.meta || {};
  const counts = meta.counts || {};
  const integrity = meta.integrity || {};
  const skips = rawJson?.skips || [];
  const convertedStructure = (counts.mf || 0) + (counts.plate || 0) + (counts.bracket || 0)
    + (counts.angle || 0) + (counts.flatbar || 0) + (counts.tbar || 0);
  const convertedLoad = counts.loadCase || 0;
  const structureSkips = skips.filter(s => s.kind === 'Structure');
  const loadSkips = skips.filter(s => s.kind === 'Winch' || s.kind === 'Load');
  const warningRows = skips.filter(isWarningSkip).length;
  const parseFailedRows = skips.filter(isFailureSkip).length;
  const ignoredRows = skips.filter(isIgnoredSkip).length;
  const hasStructureAccounting = integrity.structureTotalLines != null && integrity.structureAccountedFor != null;
  const hasLoadAccounting = integrity.loadTotalLines != null && integrity.loadAccountedFor != null;
  const hasAccountingMismatch =
    (hasStructureAccounting && integrity.structureTotalLines !== integrity.structureAccountedFor)
    || (hasLoadAccounting && integrity.loadTotalLines !== integrity.loadAccountedFor);

  const reasonCounts = skips.reduce((acc, skip) => {
    const key = summarizeSkipReason(skip);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const rowAudit = [...buildConvertedRows(rawJson), ...buildSkipRows(rawJson)]
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || (a.physicalLineNumber || 0) - (b.physicalLineNumber || 0));

  return {
    summary: {
      totalDataRows: (integrity.structureTotalLines || 0) + (integrity.loadTotalLines || 0),
      convertedRows: convertedStructure + convertedLoad,
      ignoredRows,
      warningRows,
      parseFailedRows,
      ignoredByReason: reasonCounts,
      hasAccountingMismatch,
    },
    byKind: {
      Structure: {
        icon: 'Structure',
        fileName: meta.structureCsv,
        total: integrity.structureTotalLines || (convertedStructure + structureSkips.length),
        counts: {
          converted: convertedStructure,
          ignored: structureSkips.filter(isIgnoredSkip).length,
          warning: structureSkips.filter(isWarningSkip).length,
          parseFailed: structureSkips.filter(isFailureSkip).length,
        },
      },
      Load: {
        icon: 'Load',
        fileName: meta.loadCsv,
        total: integrity.loadTotalLines || (convertedLoad + loadSkips.length),
        counts: {
          converted: convertedLoad,
          ignored: loadSkips.filter(isIgnoredSkip).length,
          warning: loadSkips.filter(isWarningSkip).length,
          parseFailed: loadSkips.filter(isFailureSkip).length,
        },
      },
    },
    rowAudit,
    counts,
    integrity,
  };
}

function KindBar({ label, icon, converted, total, ignored, warning, failed, fileName }) {
  const pct = total > 0 ? Math.round((converted / total) * 100) : 0;
  const hasIssue = ignored > 0 || warning > 0 || failed > 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-slate-700">{icon}</span>
        </div>
        {total > 0
          ? <span className={`text-xs font-bold font-mono ${hasIssue ? 'text-amber-600' : 'text-emerald-600'}`}>{pct}%</span>
          : <span className="text-xs text-slate-300 italic">미입력</span>
        }
      </div>

      {total > 0 && (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-800 font-mono leading-none">{converted.toLocaleString()}</span>
            <span className="text-xs text-slate-400">행 변환</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div className="h-full bg-emerald-500 transition-all duration-700 rounded-l-full" style={{ width: `${(converted / total) * 100}%` }} />
            {ignored > 0 && <div className="h-full bg-amber-400 transition-all duration-700" style={{ width: `${(ignored / total) * 100}%` }} />}
            {warning > 0 && <div className="h-full bg-yellow-400 transition-all duration-700" style={{ width: `${(warning / total) * 100}%` }} />}
            {failed > 0 && <div className="h-full bg-red-400 transition-all duration-700 rounded-r-full" style={{ width: `${(failed / total) * 100}%` }} />}
          </div>
          {(ignored > 0 || warning > 0 || failed > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              {ignored > 0 && <span className="flex items-center gap-1 text-xs text-amber-700"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> 제외 {ignored.toLocaleString()}</span>}
              {warning > 0 && <span className="flex items-center gap-1 text-xs text-yellow-700"><span className="w-2 h-2 rounded-sm bg-yellow-400 inline-block" /> 경고 {warning.toLocaleString()}</span>}
              {failed > 0 && <span className="flex items-center gap-1 text-xs text-red-600"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> 실패 {failed.toLocaleString()}</span>}
            </div>
          )}
          {fileName && <p className="text-[11px] text-slate-400 font-mono truncate pt-1 border-t border-slate-100" title={fileName}>{fileBaseName(fileName)}</p>}
        </>
      )}
    </div>
  );
}

function IgnoreReasonRow({ label, count, maxCount }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-700 w-48 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 bg-amber-50 rounded-full h-2.5 overflow-hidden">
        <div className="h-full bg-amber-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold font-mono text-amber-700 w-10 text-right shrink-0">{count.toLocaleString()}</span>
    </div>
  );
}

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

function CsvValidationPanel({ rawJson, loading, error }) {
  const [showRows, setShowRows] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');

  if (loading) return <LoadingValidationPanel />;
  if (error) return <MissingValidationPanel message={error} />;
  if (!rawJson) return <MissingValidationPanel message="STAGE_00.raw.json 파일이 result_info에 없거나 읽기에 실패했습니다." />;

  const audit = summarizeMooringRawAudit(rawJson);
  const { summary, byKind, rowAudit, counts, integrity } = audit;
  const total = summary.totalDataRows || 0;
  const converted = summary.convertedRows || 0;
  const ignored = summary.ignoredRows || 0;
  const warnings = summary.warningRows || 0;
  const failed = summary.parseFailedRows || 0;
  const convRate = total > 0 ? Math.round((converted / total) * 100) : 0;
  const isFailed = failed > 0 || summary.hasAccountingMismatch;
  const ignoredEntries = Object.entries(summary.ignoredByReason || {})
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const maxIgnored = ignoredEntries.length > 0 ? Math.max(...ignoredEntries.map(e => e.count)) : 1;
  const filteredRows = rowAudit
    .filter(r => kindFilter === 'all' || r.kind === kindFilter)
    .filter(r => statusFilter === 'all' || r.status === statusFilter);

  return (
    <div className="space-y-4 w-full min-w-0">
      <div className={`rounded-2xl border px-5 py-4 shadow-sm ${isFailed ? 'bg-red-50 border-red-200' : 'bg-gradient-to-br from-slate-50 to-white border-slate-200'}`}>
        <div className="flex items-start gap-5">
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#e2e8f0" strokeWidth="7" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={isFailed ? '#ef4444' : warnings > 0 ? '#f59e0b' : '#10b981'}
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

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                {isFailed
                  ? <AlertCircle size={15} className="text-red-600 shrink-0" />
                  : <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
                <span className={`text-sm font-bold ${isFailed ? 'text-red-700' : 'text-emerald-700'}`}>
                  {isFailed ? 'CSV 검증 실패' : 'CSV 입력 검증 완료'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
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
              <div className="text-center">
                <p className={`text-2xl font-bold font-mono leading-none ${warnings > 0 ? 'text-yellow-600' : 'text-slate-300'}`}>{warnings.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">경고</p>
              </div>
            </div>

            {warnings > 0 && !isFailed && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-yellow-700 font-semibold">
                <AlertTriangle size={12} /> 빈 LOADCASE {warnings.toLocaleString()}건은 헤더/dummy로 간주되어 변환 실패로 처리하지 않습니다.
              </div>
            )}

            {failed > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-semibold">
                <AlertCircle size={12} /> 파싱 실패 {failed.toLocaleString()}건 — 원본 CSV 확인 필요
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">파일별 처리 현황</p>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(byKind).map(([label, d]) => (
            <KindBar
              key={label}
              label={label}
              icon={d.icon}
              converted={d.counts.converted}
              total={d.total}
              ignored={d.counts.ignored}
              warning={d.counts.warning}
              failed={d.counts.parseFailed}
              fileName={d.fileName}
            />
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Record Type Summary</p>
        <div className="grid grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            ['MF', counts.mf],
            ['PLATE', counts.plate],
            ['BRACKET', counts.bracket],
            ['ANGLE', counts.angle],
            ['FLATBAR', counts.flatbar],
            ['TBAR', counts.tbar],
            ['LOADCASE', counts.loadCase],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <p className="text-[10px] font-bold text-slate-400">{label}</p>
              <p className="text-sm font-bold text-slate-700 mt-0.5">{value ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      {ignoredEntries.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl px-4 py-4 shadow-sm">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-3">
            제외/경고/실패 사유 분포 — {(ignored + warnings + failed).toLocaleString()}건
          </p>
          <div className="space-y-2.5">
            {ignoredEntries.map(({ label, count }) => (
              <IgnoreReasonRow key={label} label={label} count={count} maxCount={maxIgnored} />
            ))}
          </div>
        </div>
      )}

      {rowAudit.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm w-full max-w-full min-w-0">
          <button
            onClick={() => setShowRows(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">행 단위 검증</span>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {rowAudit.length.toLocaleString()}행
              </span>
              {!showRows && <span className="text-[11px] text-slate-400 ml-1">— 클릭하여 자세히 보기</span>}
            </div>
            <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showRows ? 'rotate-180' : ''}`} />
          </button>

          {showRows && (
            <>
              <div className="flex items-center gap-3 px-4 py-2.5 border-t border-b border-slate-100 bg-slate-50 flex-wrap">
                <FilterPills
                  label="종류"
                  value={kindFilter}
                  onChange={setKindFilter}
                  options={[
                    { v: 'all', label: '전체' },
                    { v: 'Structure', label: 'Structure' },
                    { v: 'Load', label: 'Load' },
                  ]}
                />
                <span className="text-slate-200">|</span>
                <FilterPills
                  label="상태"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { v: 'all', label: '전체' },
                    { v: 'converted', label: '변환' },
                    { v: 'ignored', label: '제외' },
                    { v: 'warning', label: '경고' },
                    { v: 'parseFailed', label: '실패' },
                    { v: 'blank', label: '공백' },
                  ]}
                />
                <span className="ml-auto text-xs font-mono text-slate-400">
                  {filteredRows.length.toLocaleString()} / {rowAudit.length.toLocaleString()}행
                </span>
              </div>

              <div className="max-h-96 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col className="w-[64px]" />
                    <col className="w-[88px]" />
                    <col className="w-[92px]" />
                    <col className="w-[24%]" />
                    <col />
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">종류</th>
                      <th className="px-2 py-2 text-right font-semibold text-slate-500">행#</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">상태</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Type</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredRows.slice(0, 1000).map((r, i) => {
                      const cfg = ROW_STATUS_CONFIG[r.status] || ROW_STATUS_CONFIG.ignored;
                      const rowBg = r.status === 'parseFailed' ? 'bg-red-50/60'
                        : r.status === 'warning' ? 'bg-yellow-50/50'
                        : r.status === 'ignored' ? 'bg-amber-50/40'
                          : r.status === 'blank' ? 'bg-slate-50/60' : '';
                      return (
                        <tr key={`${r.kind}-${r.physicalLineNumber}-${i}`} className={`hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                          <td className="px-3 py-1.5 text-slate-600 truncate" title={r.kind}>{r.kind}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-400">{r.physicalLineNumber || '-'}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 truncate" title={r.rowType}>{r.rowType}</td>
                          <td className="px-3 py-1.5 font-mono text-[11px] truncate" title={r.name}>{r.name}</td>
                          <td className={`px-3 py-1.5 truncate ${r.status === 'converted' ? 'text-slate-400' : 'text-slate-600'}`} title={r.reason}>
                            {r.reason}
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

function FinalValidationPanel({ validationJson, loading, error, onDownload, result }) {
  if (loading) return <LoadingValidationPanel />;
  if (error) return <MissingValidationPanel message={error} />;
  if (!validationJson) return <MissingValidationPanel message="STAGE_07_FinalValidation.validation.json 파일이 result_info에 없거나 읽기에 실패했습니다." />;

  const summary = validationJson.summary || {};
  const checks = validationJson.checks || [];
  const counts = validationJson.modelCounts || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">STAGE_07_FinalValidation.validation.json</p>
          <p className="text-xs text-slate-500 mt-0.5">CSV 변환 이후 모델의 최종 checklist 결과</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill passed={summary.overall === 'PASSED'} label={summary.overall || 'UNKNOWN'} />
          {result?.validation_json && (
            <button
              type="button"
              onClick={() => onDownload(result.validation_json)}
              className="flex items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
            >
              <Download size={11} /> JSON
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <MetricCard label="Passed" value={summary.passed ?? 0} />
        <MetricCard label="Warning" value={summary.warning ?? 0} />
        <MetricCard label="Error" value={summary.error ?? 0} />
        <MetricCard label="Nodes" value={counts.nodes ?? 0} />
        <MetricCard label="Elements" value={counts.elements ?? 0} />
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-xs font-bold text-slate-700">Checklist</p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {checks.map((check, idx) => (
            <div key={`${check.code}-${idx}`} className="grid grid-cols-[130px_80px_1fr] gap-2 border-b border-slate-100 px-3 py-2 text-xs">
              <span className="font-mono text-slate-500 truncate" title={check.code}>{check.code || '-'}</span>
              <span className={check.severity === 'Error' ? 'font-bold text-red-600' : check.severity === 'Warning' ? 'font-bold text-amber-600' : 'font-bold text-emerald-600'}>
                {check.severity || '-'}
              </span>
              <span className="text-slate-600">{check.message || '-'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   MooringStudioLauncher
   ──────────────────────────────────────────────────────────────────────── */

function MooringStudioLauncher({ ready, onLaunch, installed, status, progress, error, installedVersion, latestVersion, installDir }) {
  const checking   = status === 'checking';
  const installing = status === 'installing';
  const opening    = status === 'opening';
  const versionMismatch = !!(installedVersion && latestVersion && installedVersion !== latestVersion);
  const disabled   = !ready || checking || installing || opening;

  const versionLine = (() => {
    if (installedVersion && latestVersion && versionMismatch)
      return (
        <p className="text-[10px] font-mono text-amber-700">
          설치본 v{installedVersion} → 워크벤치 v{latestVersion}
          <span className="ml-1 px-1.5 py-[1px] rounded bg-amber-100 text-amber-800 font-bold">업데이트 필요</span>
        </p>
      );
    if (installedVersion) return <p className="text-[10px] font-mono text-slate-500">설치본 v{installedVersion}</p>;
    if (latestVersion)    return <p className="text-[10px] font-mono text-slate-500">워크벤치 v{latestVersion}</p>;
    return <p className="text-[10px] text-slate-400">버전 확인 대기 중</p>;
  })();

  const palette = installed === false || versionMismatch
    ? {
        card:      'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50',
        icon:      'text-amber-700',
        title:     'text-amber-950',
        body:      'text-amber-900',
        badge:     'bg-amber-200 text-amber-800',
        badgeText: installed === false ? '미설치 — 설치 필요' : '버전 업데이트 필요',
        button:    'bg-amber-600 hover:bg-amber-700',
      }
    : {
        card:      'border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50',
        icon:      'text-emerald-700',
        title:     'text-emerald-950',
        body:      'text-emerald-900',
        badge:     checking ? 'bg-slate-200 text-slate-700' : 'bg-emerald-200 text-emerald-800',
        badgeText: checking ? '설치 확인 중' : installed === true ? '설치됨 — 사용 가능' : '상태 확인 전',
        button:    'bg-emerald-600 hover:bg-emerald-700',
      };

  const Icon = installed === false ? PackageX : versionMismatch ? AlertCircle : ShieldCheck;
  const buttonText = (() => {
    if (installing) return <><Loader2 size={14} className="animate-spin" /> 설치 중 {progress?.progress ?? 0}%</>;
    if (checking)   return <><Loader2 size={14} className="animate-spin" /> 확인 중</>;
    if (opening)    return <><Loader2 size={14} className="animate-spin" /> 실행 중</>;
    if (installed === false) return <><Download size={14} /> Studio 설치 후 열기</>;
    if (versionMismatch)     return <><Download size={14} /> 업데이트 후 열기</>;
    return <><ExternalLink size={14} /> Studio 열기</>;
  })();

  return (
    <div className={`rounded-2xl border-2 ${palette.card} px-5 py-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon size={18} className={palette.icon} />
            <h3 className={`text-base font-bold ${palette.title}`}>Mooring Fitting Studio</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${palette.badge}`}>{palette.badgeText}</span>
          </div>
          <p className={`text-[13px] font-bold leading-snug mt-2 ${palette.body}`}>
            {installed === false
              ? <>Studio가 이 PC에 설치되어 있지 않습니다. <b>&quot;Studio 설치 후 열기&quot;</b>를 눌러 최초 1회 설치를 진행하세요.</>
              : versionMismatch
              ? <>설치된 버전이 워크벤치 배포본과 다릅니다. <b>&quot;업데이트 후 열기&quot;</b>를 누르면 자동 갱신됩니다.</>
              : !ready
              ? <>먼저 Mooring Fitting 해석을 완료하면 BDF 뷰어가 활성화됩니다.</>
              : <>해석 결과를 확인한 뒤 Studio를 열어 그룹 삭제 · RBE2 편집 · 최종 BDF 출력을 진행하세요.</>}
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
            설치 파일은 사내 배포 위치에서 자동으로 내려받고, WorkBench 앱 데이터 폴더에 보관됩니다. 최초 설치 이후에는 재사용합니다.
          </p>
          <div className="flex flex-col gap-1 mt-3">
            {versionLine}
            {installDir && (
              <p className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono break-all">
                <HardDrive size={11} className="shrink-0 text-slate-400" />
                {installDir}
              </p>
            )}
            {error && <p className="text-[10px] text-red-600 leading-snug">⚠ {error}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
            {[
              ['BDF 시각화',     'CSV 변환 결과 BDF 파일을 3D로 시각화'],
              ['그룹 · RBE2 편집', '불필요한 그룹 삭제 및 RBE2 추가/삭제'],
              ['최종 BDF 출력',  '편집 완료된 BDF 파일 생성 및 저장'],
            ].map(([title, desc]) => (
              <div key={title} className="rounded-lg border border-white/70 bg-white/65 px-3 py-2">
                <p className="text-[11px] font-bold text-slate-700">{title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={onLaunch}
          disabled={disabled}
          title={!ready ? '먼저 Mooring Fitting 해석을 완료하세요' : ''}
          className={`shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors cursor-pointer shadow-sm ${palette.button}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

export default function MooringFittingAssessment() {
  const [structureFile, setStructureFile] = useState(null);
  const [loadFile,      setLoadFile]      = useState(null);
  const [steps,         setSteps]         = useState(() => INITIAL_STEPS.map(s => ({ ...s })));
  const [activeIdx,     setActiveIdx]     = useState(0);
  const [hasRunOnce,    setHasRunOnce]    = useState(false);
  const [jobId,         setJobId]         = useState(null);
  const [jobStatus,     setJobStatus]     = useState(null);
  const [elapsedSecs,   setElapsedSecs]   = useState(0);
  const [engineLog,     setEngineLog]     = useState(null);
  const [artifactJson,  setArtifactJson]  = useState({
    raw: null,
    validation: null,
    loading: false,
    error: null,
  });

  const STUDIO_VIEWER_ID = 'mooring-fitting-studio';
  const [studioStatus,           setStudioStatus]           = useState('idle');
  const [studioInstalled,        setStudioInstalled]        = useState(null);
  const [studioProgress,         setStudioProgress]         = useState(null);
  const [studioError,            setStudioError]            = useState(null);
  const [studioInstalledVersion, setStudioInstalledVersion] = useState(null);
  const [studioLatestVersion,    setStudioLatestVersion]    = useState(null);
  const [studioInstallDir,       setStudioInstallDir]       = useState(null);

  const pollRef    = useRef(null);
  const elapsedRef = useRef(null);

  const { showToast }    = useToast();
  const { startGlobalJob } = useDashboard();
  const { setCurrentMenu } = useNavigation();

  /* ── 파일명 휴리스틱 분류 ─────────────────────────────────────────── */
  // 파일명에 'Load' 포함 → Load CSV, 그 외 → Structure CSV.
  // 어느 dropzone에 떨어뜨리든, 한꺼번에 여러 파일을 드롭해도 자동 분류.
  const classifyAndAssign = (file) => {
    if (!file) return;
    if (/load/i.test(file.name)) {
      setLoadFile(file);
    } else {
      setStructureFile(file);
    }
  };

  /* ── 폴링 ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}${STATUS_ENDPOINT(jobId)}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          handleUnauthorized(res.status);
          return;
        }
        const data = await res.json();
        setJobStatus(data);

        if (data.status === 'Running') {
          const p = data.progress || 0;
          setSteps(prev => prev.map((s, i) => {
            if (i === 0) return { ...s, status: p >= 90 ? 'done' : 'running' };
            return s;
          }));
        }

        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(pollRef.current);
          if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
          if (data.status === 'Success') {
            setSteps(prev => prev.map(s => s.id !== 'mf-studio' ? { ...s, status: 'done' } : s));
            setActiveIdx(1); // Studio 단계로 이동
          } else {
            setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error' } : s));
            setEngineLog(data.engine_log || data.message || '알 수 없는 오류');
          }
        }
      } catch { /* network blip — keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  /* ── 언마운트 정리 ─────────────────────────────────────────────────── */
  useEffect(() => () => {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
  }, []);

  /* ── 실행 ──────────────────────────────────────────────────────────── */
  const handleRun = async () => {
    if (!structureFile || !loadFile) {
      showToast('Structure CSV와 Load CSV를 모두 선택하세요', 'error');
      return;
    }
    let user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      // localStorage 손상 시 빈 객체로 폴백
    }
    if (!user?.employee_id) {
      showToast('로그인 정보가 없습니다.', 'error');
      return;
    }

    const fd = new FormData();
    fd.append('structure_file', structureFile);
    fd.append('load_file',      loadFile);
    fd.append('employee_id',    user.employee_id);
    fd.append('source',         'Workbench');

    setHasRunOnce(true);
    setElapsedSecs(0);
    setEngineLog(null);
    setArtifactJson({ raw: null, validation: null, loading: false, error: null });
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);

    setSteps(prev => prev.map((s, i) =>
      i === 0 ? { ...s, status: 'running' } : { ...s, status: 'wait' }
    ));
    setJobStatus({ status: 'Pending', progress: 0, message: '서버에 작업 요청 중...' });
    setActiveIdx(0);

    try {
      const res = await fetch(`${API_BASE_URL}${API_ENDPOINT}`, {
        method: 'POST',
        body: fd,
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        handleUnauthorized(res.status);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `요청 실패 (${res.status})`);
      }
      const data = await res.json();
      setJobId(data.job_id);
      startGlobalJob?.(data.job_id, 'Mooring Fitting Assessment');
    } catch (e) {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
      setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error' } : s));
      setJobStatus({ status: 'Failed', progress: 0, message: `요청 실패: ${e.message}` });
      setEngineLog(`[요청 실패]\n서버: ${API_BASE_URL}\n오류: ${e.message}`);
      showToast(`해석 요청 실패: ${e.message}`, 'error');
    }
  };

  const handleDownload = async (path) => {
    try {
      const res = await fetch(`${API_BASE_URL}${DOWNLOAD_ENDPOINT(path)}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        handleUnauthorized(res.status);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `다운로드 실패 (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = path.split(/[\\/]/).pop() || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(`다운로드 실패: ${e.message}`, 'error');
    }
  };

  const fetchArtifactJson = async (path) => {
    if (!path) return null;
    const res = await fetch(`${API_BASE_URL}${DOWNLOAD_ENDPOINT(path)}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      handleUnauthorized(res.status);
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `검증 JSON 조회 실패 (${res.status})`);
    }
    return res.json();
  };

  /* ── Studio 뷰어 ────────────────────────────────────────────────────── */
  const setStepStatus = (id, status) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  useEffect(() => {
    let cancelled = false;
    if (window.electron?.invoke) {
      setStudioStatus('checking');
      window.electron.invoke('viewer:check-installed', STUDIO_VIEWER_ID)
        .then((r) => {
          if (cancelled) return;
          setStudioInstalled(r === null ? false : !!r?.installed);
          setStudioInstalledVersion(r?.manifest?.version ?? null);
          setStudioInstallDir(r?.dir ?? null);
          setStudioStatus('idle');
        })
        .catch((e) => {
          if (cancelled) return;
          setStudioInstalled(false);
          setStudioError(e?.message || 'Studio 설치 상태 확인 실패');
          setStudioStatus('idle');
        });
    } else {
      setStudioInstalled(false);
    }
    fetch(`${API_BASE_URL}/api/viewers/manifest/${STUDIO_VIEWER_ID}`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(meta => {
        if (cancelled) return;
        setStudioLatestVersion(meta?.manifest?.version ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    const unsub = window.electron.onMessage('viewer:install-progress', (data) => {
      if (!data || data.viewerId !== STUDIO_VIEWER_ID) return;
      setStudioProgress(data);
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    const unsub = window.electron.onMessage('mooring:finalize-edit-request', async (data) => {
      const { requestId, folderPath, editFileName } = data ?? {};
      if (!requestId) return;
      try {
        const editPath = `${folderPath}/${editFileName}`.replace(/\\/g, '/');
        const editData = JSON.parse(await window.fs?.readFile(editPath, 'utf-8') ?? '{}');
        const res = await fetch(`${API_BASE_URL}/api/analysis/mooring-fitting/apply-edit`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath, intents: editData.intents ?? [] }),
        });
        const json = await res.json();
        window.electron.send('mooring:finalize-edit-response', { requestId, ok: !!json?.ok, error: json?.detail });
      } catch (e) {
        window.electron.send('mooring:finalize-edit-response', { requestId, ok: false, error: e?.message });
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const handleOpenStudio = async () => {
    if (!isSuccess || !result?.out_dir) {
      showToast('먼저 Mooring Fitting 해석을 완료하세요.', 'warning');
      return;
    }
    if (!window.electron?.invoke) {
      showToast('Electron 환경에서만 Studio를 사용할 수 있습니다.', 'error');
      return;
    }
    setStudioError(null);
    try {
      setStudioStatus('checking');
      const check = await window.electron.invoke('viewer:check-installed', STUDIO_VIEWER_ID);
      if (check === null) throw new Error('IPC viewer:check-installed 미등록');

      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${STUDIO_VIEWER_ID}`, { headers: getAuthHeaders() });
      if (!manifestRes.ok) throw new Error(`manifest 조회 실패: HTTP ${manifestRes.status}`);
      const meta = await manifestRes.json();

      const localVer  = check?.manifest?.version ?? null;
      const serverVer = meta?.manifest?.version ?? null;
      setStudioInstalled(!!check?.installed);
      setStudioInstalledVersion(localVer);
      setStudioLatestVersion(serverVer);
      setStudioInstallDir(check?.dir ?? null);

      const needInstall = !check?.installed || (serverVer && localVer && serverVer !== localVer);
      if (needInstall) {
        const reason = !check?.installed
          ? 'MooringFittingStudio 미설치 — 다운로드 시작'
          : `MooringFittingStudio 업데이트 (v${localVer} → v${serverVer})`;
        showToast(reason, 'info');
        setStudioStatus('installing');
        const installRes = await window.electron.invoke('viewer:install', {
          viewerId: STUDIO_VIEWER_ID,
          downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`,
          uncPath: meta.uncPath,
          expectedSha256: meta.sha256,
        });
        if (installRes === null) throw new Error('IPC viewer:install 미등록');
        if (!installRes?.ok) throw new Error(installRes?.error || 'Studio 설치 실패');
        setStudioInstalled(true);
        setStudioInstalledVersion(installRes?.manifest?.version ?? serverVer);
        setStudioInstallDir(installRes?.dir ?? check?.dir ?? null);
      }

      setStudioStatus('opening');
      const params = new URLSearchParams({ output_dir: result.out_dir });
      const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
        downloadUrl: `${API_BASE_URL}/api/analysis/mooring-fitting/viewer-zip?${params}`,
        jobId: result.out_dir.split(/[\\/]/).pop(),
        headers: getAuthHeaders(),
      });
      if (fetchRes === null) throw new Error('IPC viewer:fetchResultDir 미등록');
      if (!fetchRes?.ok) throw new Error(fetchRes?.error || 'BDF 데이터 다운로드 실패');

      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: STUDIO_VIEWER_ID,
        initialFolder: fetchRes.dir,
        parentAnalysisId: null,
        serverUrl: API_BASE_URL,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      setStepStatus('mf-studio', 'done');
      setStudioStatus('idle');
    } catch (e) {
      setStudioStatus('error');
      setStudioError(e?.message ?? 'Studio 오류');
      showToast(`MooringFittingStudio 실행 실패 — ${e?.message}`, 'error');
    }
  };

  /* ── 리셋 ──────────────────────────────────────────────────────────── */
  const handleReset = () => {
    if (pollRef.current)    { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    setStructureFile(null);
    setLoadFile(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setActiveIdx(0);
    setHasRunOnce(false);
    setJobId(null);
    setJobStatus(null);
    setElapsedSecs(0);
    setEngineLog(null);
    setArtifactJson({ raw: null, validation: null, loading: false, error: null });
  };

  /* ── 파생 ──────────────────────────────────────────────────────────── */
  const isRunning  = jobStatus?.status === 'Pending' || jobStatus?.status === 'Running';
  const isSuccess  = jobStatus?.status === 'Success';
  const isFailed   = jobStatus?.status === 'Failed';
  const result     = jobStatus?.project?.result_info;
  const canRun     = !!structureFile && !!loadFile && !isRunning;
  const doneCount  = steps.filter(s => s.status === 'done').length;
  const activeStep = steps[activeIdx];

  useEffect(() => {
    if (!isSuccess || !result || result._artifacts_missing) {
      return;
    }

    let cancelled = false;
    setArtifactJson(prev => ({ ...prev, loading: true, error: null }));

    Promise.all([
      fetchArtifactJson(result.raw_json),
      fetchArtifactJson(result.validation_json),
    ])
      .then(([raw, validation]) => {
        if (!cancelled) {
          setArtifactJson({ raw, validation, loading: false, error: null });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setArtifactJson({ raw: null, validation: null, loading: false, error: e.message });
        }
      });

    return () => { cancelled = true; };
  }, [isSuccess, result?.raw_json, result?.validation_json, result?._artifacts_missing]);

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      <PageBanner gradient="from-brand-blue via-brand-blue-dark to-blue-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('File-Based Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              <span className="flex items-center gap-2">
                <FileSpreadsheet size={18} /> Mooring Fitting Assessment
              </span>
            </h1>
            <p className="text-sm text-blue-200/80 mt-0.5">
              Structure CSV + Load CSV 입력 정합성 및 FE 변환 검증
            </p>
          </div>
        </div>
      </PageBanner>

      {/* ── Body ── */}
      <div className="flex flex-1 gap-5 min-h-0 px-1">

        {/* ── Left Sidebar ── */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">

          {/* 검증 스텝퍼 + 실행 */}
          <div className="flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* 스텝퍼 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">검증 단계</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>

            {/* 스텝 목록 */}
            <div className="py-5 px-4">
              {steps.map((step, idx) => {
                const StepIcon  = step.icon;
                const cfg       = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.wait;
                const isActive  = idx === activeIdx;
                const isLast    = idx === steps.length - 1;
                return (
                  <div key={step.id} className="flex items-stretch">
                    <div className="flex flex-col items-center w-8 shrink-0 pt-5">
                      <div className={`w-4 h-4 rounded-full shrink-0 ${cfg.dot}`} />
                      {!isLast && <div className="flex-1 w-0.5 my-1.5 rounded-full bg-blue-300" />}
                    </div>
                    <div
                      className={`flex-1 mb-3 ml-2 rounded-xl border px-4 py-4 transition-all cursor-pointer
                        ${isActive
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
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

            {/* 버튼 영역 */}
            <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
              {activeIdx < steps.length - 1 && (
                <button
                  type="button"
                  onClick={() => setActiveIdx(activeIdx + 1)}
                  disabled={isRunning || !hasRunOnce}
                  className="w-full flex items-center justify-center gap-1.5 py-2 border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  <ChevronsRight size={13} />
                  {steps[activeIdx + 1]?.title} 보기
                </button>
              )}
              <button
                type="button"
                onClick={handleRun}
                disabled={!canRun || hasRunOnce}
                title={hasRunOnce && !isRunning ? "다시 실행하려면 '전체 초기화' 후 진행하세요." : undefined}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm cursor-pointer"
              >
                {isRunning
                  ? <>
                      <Loader2 size={15} className="animate-spin" />
                      실행 중...
                      <span className="font-mono text-blue-200 text-xs font-normal">
                        {elapsedSecs >= 60
                          ? `${Math.floor(elapsedSecs / 60)}분 ${elapsedSecs % 60}초`
                          : `${elapsedSecs}초`}
                      </span>
                    </>
                  : hasRunOnce
                    ? <><CheckCircle2 size={15} /> 실행 완료 — 초기화 후 재실행</>
                    : <><ChevronsRight size={16} /> Mooring Fitting 실행</>
                }
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasRunOnce || isRunning}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>
        </div>

        {/* ── Right Main ── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto custom-scrollbar">

          {/* 진행률 (실행 중) */}
          {isRunning && (
            <ProgressBar
              progress={jobStatus?.progress ?? 0}
              message={jobStatus?.message}
              error={isFailed}
              elapsed={elapsedSecs}
            />
          )}

          {/* CSV 입력 영역 (csv-validation 활성 시) */}
          {activeStep.id === 'csv-validation' && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4">
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
                <Upload size={14} className="text-blue-600" />
                <h2 className="text-sm font-bold text-slate-700">CSV 입력</h2>
                <span className="text-[10px] text-slate-400">— 한 번에 2개 드래그하면 자동 분류</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <UploadDropzone
                  label="Structure CSV"
                  hint="MooringFittingData.csv"
                  file={structureFile}
                  disabled={isRunning}
                  onFiles={(files) => files.forEach(classifyAndAssign)}
                  onClear={() => setStructureFile(null)}
                />
                <UploadDropzone
                  label="Load CSV"
                  hint="MooringFittingDataLoad.csv"
                  file={loadFile}
                  disabled={isRunning}
                  onFiles={(files) => files.forEach(classifyAndAssign)}
                  onClear={() => setLoadFile(null)}
                />
              </div>

              <div className={`mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                structureFile && loadFile
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}>
                {structureFile && loadFile
                  ? <><CheckCircle2 size={13} /> 두 파일 준비 완료 — 실행 가능</>
                  : <><AlertCircle size={13} /> Structure + Load CSV 필요</>
                }
              </div>

              <p className="mt-2.5 text-[10px] text-slate-400 leading-relaxed text-center">
                파일명에 <span className="font-bold text-slate-500">Load</span> 포함 → Load CSV,
                나머지 → Structure CSV 자동 분류
              </p>
            </div>
          )}

          {/* 완료 알림 배너 */}
          {isSuccess && result && !result._artifacts_missing && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-emerald-700">CSV 변환 검증 완료</p>
                <p className="text-[10px] text-emerald-700/80 mt-0.5">
                  out 폴더의 검증 정보를 불러왔습니다.{' '}
                  <span className="font-semibold">2단계 &quot;Mooring Fitting Studio 실행&quot;</span>에서 Studio를 열어보세요.
                </p>
              </div>
            </div>
          )}

          {/* 실패 알림 배너 */}
          {isFailed && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 flex items-center gap-3">
              <AlertCircle size={16} className="text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-700">해석 실패</p>
                <p className="text-[10px] text-red-600 mt-0.5">오류가 발생하여 결과 파일이 생성되지 않았습니다. 아래 엔진 로그를 확인하세요.</p>
              </div>
            </div>
          )}

          {/* 활성 스텝 컨텐츠 */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-4 min-w-0">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
              <activeStep.icon size={14} className="text-blue-600" />
              <h2 className="text-sm font-bold text-slate-700">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            {/* 스텝 0: CSV 입력 검증 */}
            {activeStep.id === 'csv-validation' && (
              <>
                {!jobStatus && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <FileSpreadsheet size={36} className="opacity-20" />
                    <p className="text-sm text-slate-400">
                      CSV 파일을 업로드하고 <span className="font-semibold text-blue-500">Mooring Fitting 실행</span>을 누르면 입력 검증 결과가 표시됩니다.
                    </p>
                  </div>
                )}
                {isRunning && (
                  <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">CSV 입력 검증 및 변환 실행 중...</span>
                  </div>
                )}
                {isSuccess && result && !result._artifacts_missing && (
                  <CsvValidationPanel
                    rawJson={artifactJson.raw}
                    loading={artifactJson.loading}
                    error={artifactJson.error}
                  />
                )}
                {isSuccess && result?._artifacts_missing && (
                  <MissingValidationPanel message="out 폴더가 생성되지 않아 STAGE_00.raw.json을 찾을 수 없습니다." />
                )}
              </>
            )}

            {/* 스텝 1: Mooring Fitting Studio 실행 */}
            {activeStep.id === 'mf-studio' && (
              <MooringStudioLauncher
                ready={isSuccess}
                onLaunch={handleOpenStudio}
                installed={studioInstalled}
                status={studioStatus}
                progress={studioProgress}
                error={studioError}
                installedVersion={studioInstalledVersion}
                latestVersion={studioLatestVersion}
                installDir={studioInstallDir}
              />
            )}

            {/* 스텝 2: 최종 검증 */}
            {activeStep.id === 'final-check' && (
              <>
                {!isSuccess && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <CheckCircle2 size={36} className="opacity-20" />
                    <p className="text-sm">해석 완료 후 최종 checklist 검증 결과가 표시됩니다.</p>
                  </div>
                )}
                {isSuccess && result && !result._artifacts_missing && (
                  <FinalValidationPanel
                    validationJson={artifactJson.validation}
                    loading={artifactJson.loading}
                    error={artifactJson.error}
                    result={result}
                    onDownload={handleDownload}
                  />
                )}
              </>
            )}
          </div>

          {/* 엔진 로그 (오류 시) */}
          {engineLog && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-red-600" />
                <p className="text-xs font-bold text-red-700">엔진 출력</p>
              </div>
              <pre className="text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                {engineLog}
              </pre>
            </div>
          )}

          {/* 실행 중 System Console */}
          {isRunning && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw size={13} className="text-slate-500 animate-spin" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">실행 로그</p>
              </div>
              <p className="text-xs font-mono text-sky-600">
                [INFO] 해석 진행 중 — {jobStatus?.progress ?? 0}% ({jobStatus?.message || '처리 중'})
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
