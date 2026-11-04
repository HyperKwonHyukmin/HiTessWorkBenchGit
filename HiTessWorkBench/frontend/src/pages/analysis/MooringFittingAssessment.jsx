// NOTE: 인증이 필요한 analysis/download API를 사용하므로 fetch에 Authorization 헤더를 명시한다.
//
// 파일 기반 해석 앱 공통 틀(runFrame) 적용 — 표준 문서 docs/standards/file-based-app-page-standard.md,
// 기준 페이지 = HiTessModelBuilder.jsx · GroupModuleUnitLiftingAnalysis.jsx.
// 골격: 왼쪽 레일(StepRail · InputSummary · MF 안전계수 · 실행 버튼) + 오른쪽 작업면
//       (JobProgressCard → VerdictHeader → NextActionBar → 단계 본문 → EngineLogPanel).
// 판정 규칙은 utils/mooringVerdict.js(+테스트) 한 곳에 있다.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload, CheckCircle2, AlertCircle, AlertTriangle, Download, ChevronDown, ChevronsRight,
  RotateCcw, RefreshCw, ExternalLink, FileSpreadsheet, FileText, Camera, ClipboardCheck,
  FilePlus2, Loader2,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { API_BASE_URL } from '../../config';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import {
  StepRail, InputSummary, VerdictHeader, KeyFigures, NextActionBar, JobProgressCard,
  EngineLogPanel, StudioLauncherCard, RunStartPanel,
} from '../../components/analysis/runFrame';
import { getAnalysisById } from '../../api/analysis';
import { getAuthHeaders, handleUnauthorized } from '../../utils/auth';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboardFilesHandoff, useDashboardAutoRun } from '../../utils/dashboardFileHandoff';
import { useResultReentry } from '../../utils/resultReentry';
import { computeMooringVerdict, summarizeMooringRawAudit, extractEngineAlerts } from '../../utils/mooringVerdict';

const MENU_NAME = 'Mooring Fitting Assessment';
const PROGRAM_NAME = 'MooringFitting';
const STUDIO_VIEWER_ID = 'mooring-fitting-studio';
const DEFAULT_MF_SF = 1.25;

const API_ENDPOINT = '/api/analysis/mooring-fitting/request';
const STATUS_ENDPOINT = (jobId) => `/api/analysis/status/${jobId}`;
const DOWNLOAD_ENDPOINT = (path) => `/api/download?filepath=${encodeURIComponent(path)}`;
const SOLVE_SUMMARY_ENDPOINT = (dir) => `/api/analysis/mooring-fitting/solve-summary?output_dir=${encodeURIComponent(dir)}`;
// Studio 구조해석은 Studio 창에서 끝나 이 페이지에 알림이 없다 — 이 페이지를 보는 동안 이 간격으로 마지막 해석 요약을 다시 읽는다.
const SOLVE_SUMMARY_POLL_MS = 15000;

/* ──────────────────────────────────────────────────────────────────────────
   단계 — 상태는 저장하지 않고 '사건'(실행 결과·Studio 열림·파일 받음)에서 매 렌더 계산한다
   ──────────────────────────────────────────────────────────────────────── */

const STEP_DEFS = [
  { id: 'input',  title: 'CSV 입력 검증',        icon: FileSpreadsheet },
  { id: 'studio', title: 'Studio 편집·구조해석', icon: ExternalLink },
  { id: 'result', title: '최종 검증·보고서',     icon: ClipboardCheck },
];
const STEP_INDEX = { input: 0, studio: 1, result: 2 };

const fileBaseName = (path) => String(path || '').split(/[\\/]/).pop();

/** DB JSON 컬럼이 문자열로 올 때가 있다(MySQL). 객체로 맞춘다. */
const asObject = (v) => {
  if (!v) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v) || {}; } catch { return {}; }
  }
  return v;
};

const EMPTY_ARTIFACTS = { raw: null, validation: null, diagnosis: null, loading: false, loaded: false, error: null };

const linkCls = 'inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer';
const subHeadCls = 'mb-2 text-xs font-bold text-slate-700';

/* ──────────────────────────────────────────────────────────────────────────
   입력 칸 — Structure / Load CSV (어느 칸에 놓아도 파일명으로 자동 분류)
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileSpreadsheet size={13} className={file ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-slate-800">{label}</span>
          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">필수</span>
        </div>
        {file && !disabled && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded text-slate-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
            title="제거"
            aria-label={`${label} 제거`}
          >
            <RotateCcw size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {file ? (
        <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-3 text-center">
          <CheckCircle2 size={15} className="mb-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="w-full truncate text-center font-mono text-xs font-semibold text-slate-800" title={file.name}>{file.name}</p>
          <p className="text-[11px] text-slate-600">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click(); } }}
          className={`flex flex-col items-center justify-center gap-1 py-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50
            ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-blue-50/40'}`}
        >
          <Upload size={16} className="text-slate-400" aria-hidden="true" />
          <p className="px-2 text-xs leading-relaxed text-slate-600">
            끌어 놓기 또는 <span className="font-semibold text-blue-700">클릭</span>
            <br />
            <span className="font-mono text-[11px] text-slate-500">{hint}</span>
          </p>
          <input ref={inputRef} type="file" accept=".csv" multiple className="hidden" onChange={handlePick} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   1단계 본문 — CSV 행 감사(STAGE_00.raw.json)
   ──────────────────────────────────────────────────────────────────────── */

const ROW_STATUS_CONFIG = {
  converted:   { label: '변환', badge: 'bg-emerald-50 text-emerald-800' },
  ignored:     { label: '제외', badge: 'bg-slate-100 text-slate-700' },
  warning:     { label: '경고', badge: 'bg-amber-50 text-amber-900' },
  parseFailed: { label: '실패', badge: 'bg-red-50 text-red-800' },
  blank:       { label: '공백', badge: 'bg-slate-100 text-slate-600' },
};

function PanelNote({ tone = 'muted', children }) {
  const cls = tone === 'warn'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${cls}`}>
      {tone === 'warn'
        ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        : <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

function KindBar({ label, converted, total, ignored, warning, failed, fileName }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{label}</span>
        {total > 0
          ? <span className="font-mono text-xs text-slate-600">{converted.toLocaleString()} / {total.toLocaleString()}행 변환</span>
          : <span className="text-xs text-slate-500">입력 없음</span>}
      </div>
      {total > 0 && (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full bg-emerald-500" style={{ width: `${(converted / total) * 100}%` }} />
            {ignored > 0 && <div className="h-full bg-slate-400" style={{ width: `${(ignored / total) * 100}%` }} />}
            {warning > 0 && <div className="h-full bg-amber-400" style={{ width: `${(warning / total) * 100}%` }} />}
            {failed > 0 && <div className="h-full bg-red-500" style={{ width: `${(failed / total) * 100}%` }} />}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-700">제외 {ignored.toLocaleString()}</span>
            <span className={warning > 0 ? 'text-amber-800' : 'text-slate-600'}>경고 {warning.toLocaleString()}</span>
            <span className={failed > 0 ? 'font-semibold text-red-700' : 'text-slate-600'}>실패 {failed.toLocaleString()}</span>
          </div>
          {fileName && <p className="truncate border-t border-slate-100 pt-1 font-mono text-[11px] text-slate-600" title={fileName}>{fileBaseName(fileName)}</p>}
        </>
      )}
    </div>
  );
}

function FilterPills({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer
            ${value === o.v ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CsvValidationPanel({ audit, loading, error }) {
  const [showRows, setShowRows] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');

  if (loading) return <PanelNote>out 폴더의 검증 JSON 을 읽는 중…</PanelNote>;
  if (error) return <PanelNote tone="warn">검증 정보를 표시할 수 없습니다 — {error}</PanelNote>;
  if (!audit) return <PanelNote tone="warn">STAGE_00.raw.json 이 결과에 없거나 읽지 못했습니다.</PanelNote>;

  const { summary, byKind, rowAudit, counts } = audit;
  const ignoredEntries = Object.entries(summary.ignoredByReason || {})
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const filteredRows = rowAudit
    .filter(r => kindFilter === 'all' || r.kind === kindFilter)
    .filter(r => statusFilter === 'all' || r.status === statusFilter);

  return (
    <div className="w-full min-w-0 space-y-4">
      <KeyFigures
        items={[
          { key: 'total', label: '전체 입력 행', value: (summary.totalDataRows || 0).toLocaleString() },
          { key: 'conv', label: '변환', value: (summary.convertedRows || 0).toLocaleString() },
          { key: 'fail', label: '파싱 실패', value: (summary.parseFailedRows || 0).toLocaleString(), tone: summary.parseFailedRows > 0 ? 'warn' : 'default', sub: summary.parseFailedRows > 0 ? '모델에 없음 · 검토 필요' : undefined },
          { key: 'ign', label: '제외(SKIP·주석)', value: (summary.ignoredRows || 0).toLocaleString(), sub: '판정 미반영' },
          { key: 'warn', label: '빈 LOADCASE', value: (summary.warningRows || 0).toLocaleString(), sub: '헤더/dummy · 판정 미반영' },
        ]}
        caption={summary.hasAccountingMismatch ? 'CSV 전체 행 수와 처리된 행 수가 맞지 않습니다 — 원본 CSV 를 확인하세요.' : undefined}
      />

      <div>
        <p className={subHeadCls}>파일별 처리 현황</p>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(byKind).map(([label, d]) => (
            <KindBar
              key={label}
              label={label}
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

      <div>
        <p className={subHeadCls}>행 종류별 변환 수</p>
        <dl className="grid grid-cols-4 gap-2 lg:grid-cols-7">
          {[
            ['MF', counts.mf], ['PLATE', counts.plate], ['BRACKET', counts.bracket], ['ANGLE', counts.angle],
            ['FLATBAR', counts.flatbar], ['TBAR', counts.tbar], ['LOADCASE', counts.loadCase],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <dt className="text-[11px] font-semibold text-slate-600">{label}</dt>
              <dd className="mt-0.5 font-mono text-sm font-bold text-slate-800">{value ?? 0}</dd>
            </div>
          ))}
        </dl>
      </div>

      {ignoredEntries.length > 0 && (
        <div>
          <p className={subHeadCls}>제외·경고·실패 사유</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {ignoredEntries.map(({ label, count }) => (
              <li key={label} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700" title={label}>{label}</span>
                <span className="shrink-0 font-mono font-bold text-slate-800">{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rowAudit.length > 0 && (
        <div className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setShowRows(v => !v)}
            aria-expanded={showRows}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FileSpreadsheet size={14} className="text-slate-600" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-800">행 단위 검증</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">{rowAudit.length.toLocaleString()}행</span>
            </span>
            <ChevronDown size={14} className={`text-slate-500 transition-transform ${showRows ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {showRows && (
            <>
              <div className="flex flex-wrap items-center gap-3 border-y border-slate-100 bg-slate-50 px-4 py-2.5">
                <FilterPills
                  label="종류" value={kindFilter} onChange={setKindFilter}
                  options={[{ v: 'all', label: '전체' }, { v: 'Structure', label: 'Structure' }, { v: 'Load', label: 'Load' }]}
                />
                <FilterPills
                  label="상태" value={statusFilter} onChange={setStatusFilter}
                  options={[
                    { v: 'all', label: '전체' }, { v: 'converted', label: '변환' }, { v: 'ignored', label: '제외' },
                    { v: 'warning', label: '경고' }, { v: 'parseFailed', label: '실패' }, { v: 'blank', label: '공백' },
                  ]}
                />
                <span className="ml-auto font-mono text-xs text-slate-600">
                  {filteredRows.length.toLocaleString()} / {rowAudit.length.toLocaleString()}행
                </span>
              </div>

              <div className="max-h-96 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[88px]" /><col className="w-[64px]" /><col className="w-[72px]" />
                    <col className="w-[92px]" /><col className="w-[24%]" /><col />
                  </colgroup>
                  <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">종류</th>
                      <th className="px-2 py-2 text-right font-semibold text-slate-700">행</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">상태</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredRows.slice(0, 1000).map((r, i) => {
                      const cfg = ROW_STATUS_CONFIG[r.status] || ROW_STATUS_CONFIG.ignored;
                      return (
                        <tr key={`${r.kind}-${r.physicalLineNumber}-${i}`} className="hover:bg-blue-50/30">
                          <td className="truncate px-3 py-1.5 text-slate-700" title={r.kind}>{r.kind}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-600">{r.physicalLineNumber || '-'}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${cfg.badge}`}>{cfg.label}</span>
                          </td>
                          <td className="truncate px-3 py-1.5 text-slate-700" title={r.rowType}>{r.rowType}</td>
                          <td className="truncate px-3 py-1.5 font-mono text-[11px] text-slate-800" title={r.name}>{r.name}</td>
                          <td className={`truncate px-3 py-1.5 ${r.status === 'converted' ? 'text-slate-500' : 'text-slate-700'}`} title={r.reason}>{r.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length > 1000 && (
                  <p className="border-t border-slate-100 py-3 text-center text-xs text-slate-600">
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

/**
 * 엔진 경고 줄 — 성공해도 보여 준다. 엔진은 입력 실질 누락·부재 자동 제거·절점 병합·컴포넌트 분리·
 * 평형 검증 결과를 stdout 으로 경고하는데, 예전에는 실패 때만 화면에 실려 성공 케이스에서 전부 사라졌다.
 * 정상 정리(절점 병합 등)도 섞여 있어 판정에는 쓰지 않는다 — 원문은 아래 EngineLogPanel.
 */
function EngineAlertsPanel({ alerts }) {
  const [open, setOpen] = useState(false);
  if (!alerts || alerts.length === 0) return null;
  const shown = open ? alerts : alerts.slice(0, 5);
  return (
    <div>
      <p className={subHeadCls}>엔진 경고 {alerts.length}줄 <span className="font-normal text-slate-600">· 판정 미반영 — 부재 제거·입력 누락이 있는지 확인하세요</span></p>
      <ul className="space-y-1 rounded-lg border border-slate-200 px-3 py-2">
        {shown.map((l, i) => (
          <li key={i} className="break-all font-mono text-xs leading-relaxed text-slate-800">{l}</li>
        ))}
      </ul>
      {alerts.length > 5 && (
        <button type="button" onClick={() => setOpen(v => !v)} className={`mt-1.5 ${linkCls}`}>
          {open ? '접기' : `나머지 ${alerts.length - 5}줄 보기`}
        </button>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   원인 진단 — 백엔드(mooring_diagnosis)가 판정한 문장을 그대로 보여 준다(프론트는 판정하지 않는다)
   showElements: 부재별 주원인까지 보여줄지. 1단계는 케이스 진단만(해석 전이라 부재 판정이 없다).
   ──────────────────────────────────────────────────────────────────────── */

const CONFIDENCE_STYLE = {
  '확정': 'bg-red-50 text-red-800',
  '유력': 'bg-amber-50 text-amber-900',
  '참고': 'bg-slate-100 text-slate-700',
};

function DiagnosisPanel({ diagnosis, showElements = false }) {
  if (!diagnosis) return null;
  const findings = diagnosis.findings ?? [];
  const primaries = showElements ? (diagnosis.elementFindings ?? []).filter(f => f.primary) : [];
  if (findings.length === 0 && primaries.length === 0) return null;

  return (
    <div>
      <p className={subHeadCls}>원인 진단 {findings.length + primaries.length}건</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {findings.map((f, i) => <DiagnosisItem key={`c${i}`} finding={f} />)}
        {primaries.map((f, i) => (
          <DiagnosisItem key={`e${i}`} finding={f} prefix={`Beam ${f.elementId} · LC ${f.loadCaseId}`} />
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
        판정 근거 수치가 문장에 들어 있습니다. 확신도는 확정 · 유력 · 참고 세 단계이고, 참고는 판정에 쓰지 않습니다.
      </p>
    </div>
  );
}

function DiagnosisItem({ finding, prefix }) {
  const chip = CONFIDENCE_STYLE[finding.confidence] ?? CONFIDENCE_STYLE['참고'];
  return (
    <li className="px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${chip}`}>{finding.confidence}</span>
        {prefix && <span className="font-mono text-[11px] text-slate-700">{prefix}</span>}
        <span className="font-mono text-[11px] text-slate-500">{finding.code}</span>
      </div>
      <p className="text-sm leading-relaxed text-slate-800">{finding.message}</p>
      {finding.hint && <p className="mt-1 text-xs leading-relaxed text-slate-600">→ {finding.hint}</p>}
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   3단계 본문 — 최종 검증(STAGE_07) · 산출 파일 · 보고서
   ──────────────────────────────────────────────────────────────────────── */

function FinalValidationPanel({ validationJson, loading, error }) {
  if (loading) return <PanelNote>out 폴더의 검증 JSON 을 읽는 중…</PanelNote>;
  if (error) return <PanelNote tone="warn">검증 정보를 표시할 수 없습니다 — {error}</PanelNote>;
  if (!validationJson) return <PanelNote tone="warn">STAGE_07_FinalValidation.validation.json 이 결과에 없거나 읽지 못했습니다.</PanelNote>;

  const summary = validationJson.summary || {};
  const checks = validationJson.checks || [];
  const counts = validationJson.modelCounts || {};
  const passed = summary.overall === 'PASSED';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-800">최종 모델 검증 (STAGE_07)</p>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${passed ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
          {passed ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertCircle size={12} aria-hidden="true" />}
          {summary.overall || 'UNKNOWN'}
        </span>
        <span className="text-xs text-slate-600">CSV 변환 이후 모델의 최종 점검 목록</span>
      </div>

      <KeyFigures
        items={[
          { key: 'pass', label: '통과', value: summary.passed ?? 0 },
          { key: 'warn', label: '경고', value: summary.warning ?? 0, tone: (summary.warning ?? 0) > 0 ? 'warn' : 'default' },
          { key: 'err', label: '오류', value: summary.error ?? 0, tone: (summary.error ?? 0) > 0 ? 'bad' : 'default' },
          { key: 'nodes', label: '절점', value: (counts.nodes ?? 0).toLocaleString() },
          { key: 'elems', label: '요소', value: (counts.elements ?? 0).toLocaleString() },
        ]}
      />

      {checks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="max-h-72 overflow-y-auto custom-scrollbar">
            {checks.map((check, idx) => (
              <div key={`${check.code}-${idx}`} className="grid grid-cols-[130px_80px_1fr] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                <span className="truncate font-mono text-slate-700" title={check.code}>{check.code || '-'}</span>
                <span className={check.severity === 'Error' ? 'font-bold text-red-700' : check.severity === 'Warning' ? 'font-bold text-amber-800' : 'font-bold text-emerald-700'}>
                  {check.severity || '-'}
                </span>
                <span className="text-slate-800">{check.message || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** build-full 이 남긴 파일 중 사용자가 받아 볼 만한 것 — result_info 에 실제 경로가 있을 때만 보인다. */
const ARTIFACT_FILES = [
  { key: 'final_bdf',        label: '최종 BDF',             note: 'STAGE_07 모델(편집 전)' },
  { key: 'report_mf_csv',    label: 'MF 하중 계산 CSV',     note: 'Report_LoadCalculation_MF' },
  { key: 'report_winch_csv', label: 'Winch 하중 계산 CSV',  note: 'Report_LoadCalculation_Winch' },
  { key: 'parse_skips_csv',  label: '제외된 CSV 행',        note: '행 번호·사유·원문' },
  { key: 'validation_json',  label: '최종 검증 JSON',       note: 'STAGE_07 Checklist' },
];

function ArtifactFilesList({ result, onDownload }) {
  const files = ARTIFACT_FILES.filter(f => result?.[f.key]);
  if (files.length === 0) return null;
  return (
    <div>
      <p className={subHeadCls}>산출 파일</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {files.map(f => (
          <li key={f.key} className="flex items-center gap-3 px-3 py-2">
            <FileText size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">{f.label}</span>
              <span className="block truncate font-mono text-[11px] text-slate-600" title={result[f.key]}>{fileBaseName(result[f.key])} · {f.note}</span>
            </span>
            <button type="button" onClick={() => onDownload(result[f.key])} className={linkCls}>
              <Download size={12} aria-hidden="true" /> 받기
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 보고서 표제 입력 한 칸. ReportPanel 밖에 두어야 타이핑 중 포커스가 유지된다. */
function ReportField({ label, value, onChange, placeholder, type = 'text', className = '', ...rest }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder} {...rest}
        className={`rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`}
      />
    </label>
  );
}

/**
 * 강도검토 보고서 생성 패널 — 표제 정보를 받아 엔진 report verb 를 돌리고 xlsx 를 받는다.
 *
 * 생성과 내려받기를 두 번의 호출로 나눈 이유: 엔진이 내는 경고(예: 결과 CSV 가 BDF 보다
 * 오래됨)를 사용자가 파일을 열기 전에 보게 하려는 것이다. 파일 자체는 read() 한 바이트로
 * 내려오므로 DRM 이 걸린 xlsx 에서도 길이가 어긋나지 않는다.
 * 입력칸에 Enter 처리는 없다(한글 조합 Enter 가 생성을 누르지 않게 버튼으로만 만든다).
 */
function ReportPanel({ outputDir, onNotify, onGenerated }) {
  const [form, setForm] = useState({
    hull_no: '', dwg_no: '', fitting: '', title: '',
    report_date: new Date().toISOString().slice(0, 10),
  });
  const [top, setTop] = useState(20);
  const [yieldStrength, setYieldStrength] = useState(315);
  // γM — Studio 화면 판정(허용 = σy/γM)과 같은 값이어야 보고서 판정이 화면과 일치한다.
  const [gammaM, setGammaM] = useState(1.0);
  const [useStudioFigures, setUseStudioFigures] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  // Studio 캡쳐 준비 — 엔진이 'LC별로 어느 부재를 강조·라벨링할지' 계획서를 만든다.
  // 이 파일이 있어야 Studio 에 [보고서 그림] 버튼이 나타난다.
  const handlePlan = async () => {
    if (!outputDir) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/mooring-fitting/report-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ output_dir: outputDir, top: Number(top),
                               yield_strength: Number(yieldStrength),
                               gamma_m: Number(gammaM) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `계획 생성 실패 (${res.status})`);
      }
      const body = await res.json();
      const lcCount = body?.plan?.loadCases?.length ?? 0;
      onNotify?.(`캡쳐 계획 생성 완료 (LC ${lcCount}건). Studio 의 [보고서 생성] 이 이 계획대로 캡쳐합니다.`, 'success');
    } catch (e) {
      onNotify?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!outputDir) return;
    setBusy(true);
    setMeta(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/mooring-fitting/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          output_dir: outputDir, ...form,
          top: Number(top), yield_strength: Number(yieldStrength),
          gamma_m: Number(gammaM),
          use_studio_figures: useStudioFigures,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `보고서 생성 실패 (${res.status})`);
      }
      const info = await res.json();
      setMeta(info);

      const dl = await fetch(
        `${API_BASE_URL}/api/analysis/mooring-fitting/report-download?output_dir=${encodeURIComponent(outputDir)}`,
        { headers: getAuthHeaders() },
      );
      if (!dl.ok) throw new Error(`보고서 내려받기 실패 (${dl.status})`);
      const blob = await dl.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = info.fileName || 'MooringFitting_Report.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onGenerated?.();
      onNotify?.(`보고서 생성 완료 (${info.pages ?? '?'} 페이지)`, 'success');
    } catch (e) {
      onNotify?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText size={14} className="text-slate-600" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">강도검토 보고서</h3>
        <span className="text-xs text-slate-600">Studio 구조해석 결과로 작성됩니다</span>
      </div>

      <p className="text-xs leading-relaxed text-slate-600">
        Studio 에서 구조해석을 수행한 뒤 생성할 수 있습니다. 표제 정보는 보고서 머리말에 들어갑니다.
        Studio 의 <b>[보고서 생성]</b> 버튼은 캡쳐까지 한 번에 처리하므로, 여기서는 표제 정보를 직접 넣어
        만들 때만 쓰면 됩니다.
      </p>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ReportField label="선번" value={form.hull_no} onChange={set('hull_no')} placeholder="예: 3496" />
        <ReportField label="도면번호" value={form.dwg_no} onChange={set('dwg_no')} placeholder="예: A508372" />
        <ReportField label="대상 의장품" value={form.fitting} onChange={set('fitting')} placeholder="예: MF-F08(P)" />
        <ReportField label="작성일" value={form.report_date} onChange={set('report_date')} placeholder="YYYY-MM-DD" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <ReportField label="LC별 상위 부재" type="number" min={1} value={top} onChange={e => setTop(e.target.value)} className="w-24" />
        <ReportField label="항복강도 (MPa)" type="number" min={1} value={yieldStrength} onChange={e => setYieldStrength(e.target.value)} className="w-28" />
        <ReportField label="재료계수 γM" type="number" min={0.1} step={0.05} value={gammaM} onChange={e => setGammaM(e.target.value)} className="w-24" />
        <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-700">
          <input type="checkbox" checked={useStudioFigures} onChange={e => setUseStudioFigures(e.target.checked)} className="accent-blue-600" />
          Studio 캡쳐 그림 사용
        </label>

        <button
          type="button" onClick={handlePlan} disabled={busy || !outputDir}
          title="Studio 가 찍을 그림 목록만 미리 만든다. Studio 의 [보고서 생성] 은 이 계획을 스스로 만들므로 보통 누를 필요가 없다."
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <Camera size={13} aria-hidden="true" /> Studio 캡쳐 준비
        </button>
        <button
          type="button" onClick={handleGenerate} disabled={busy || !outputDir}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
          {busy ? '생성 중…' : '보고서 생성'}
        </button>
      </div>

      {meta && (
        <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-700">
            {meta.fileName} · {meta.pages ?? '?'} 페이지
            {meta.usedStudioFigures ? ' · Studio 캡쳐 사용' : ' · 엔진 렌더 그림'}
          </p>
          {(meta.warnings || []).map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-amber-900">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

export default function MooringFittingAssessment() {
  const { showToast }    = useToast();
  const { employeeId }   = useAuth();
  const dashboardCtx     = useDashboard();
  const { setCurrentMenu, currentMenu } = useNavigation();
  const savedPageState = dashboardCtx?.analysisPageStates?.[MENU_NAME] || {};

  const [structureFile, setStructureFile] = useState(savedPageState.structureFile ?? null);
  const [loadFile,      setLoadFile]      = useState(savedPageState.loadFile ?? null);
  const [mfSafetyFactor, setMfSafetyFactor] = useState(savedPageState.mfSafetyFactor ?? DEFAULT_MF_SF);
  const [activeIdx,     setActiveIdx]     = useState(Math.min(savedPageState.activeIdx ?? 0, STEP_DEFS.length - 1));
  const [hasRunOnce,    setHasRunOnce]    = useState(savedPageState.hasRunOnce ?? false);
  const [jobId,         setJobId]         = useState(savedPageState.jobId ?? null);
  const [jobStatus,     setJobStatus]     = useState(savedPageState.jobStatus ?? null);
  const [elapsedSecs,   setElapsedSecs]   = useState(savedPageState.elapsedSecs ?? 0);
  const [engineLog,     setEngineLog]     = useState(savedPageState.engineLog ?? null);
  const [artifactJson,  setArtifactJson]  = useState(savedPageState.artifactJson ?? EMPTY_ARTIFACTS);
  // 단계 완료 사건 — Studio 가 실제로 열렸는가 / 보고서·산출 파일을 실제로 받았는가
  const [studioOpened,  setStudioOpened]  = useState(savedPageState.studioOpened ?? false);
  const [delivered,     setDelivered]     = useState(savedPageState.delivered ?? false);

  const [studioStatus,           setStudioStatus]           = useState('idle');
  const [studioInstalled,        setStudioInstalled]        = useState(null);
  const [studioProgress,         setStudioProgress]         = useState(null);
  const [studioError,            setStudioError]            = useState(null);
  const [studioInstalledVersion, setStudioInstalledVersion] = useState(null);
  const [studioLatestVersion,    setStudioLatestVersion]    = useState(null);

  const pollRef    = useRef(null);
  const elapsedRef = useRef(null);
  // 실행·다시 열기가 끝난 뒤 판정이 나오면 한 번만 다음 단계로 옮긴다(결과 JSON 이 비동기로 오기 때문)
  const pendingAdvanceRef = useRef(false);

  const startGlobalJob = dashboardCtx?.startGlobalJob;

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(MENU_NAME, {
      structureFile, loadFile, mfSafetyFactor, activeIdx, hasRunOnce, jobId, jobStatus,
      elapsedSecs, engineLog, artifactJson, studioOpened, delivered,
    });
  }, [structureFile, loadFile, mfSafetyFactor, activeIdx, hasRunOnce, jobId, jobStatus, elapsedSecs, engineLog, artifactJson, studioOpened, delivered]);

  /* ── 결과 지우기(입력이 바뀌면 옛 결과는 의미가 없다) ─────────────── */
  const stopTimers = () => {
    if (pollRef.current)    { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  };

  const clearResults = () => {
    stopTimers();
    pendingAdvanceRef.current = false;
    setJobId(null);
    setJobStatus(null);
    setElapsedSecs(0);
    setEngineLog(null);
    setArtifactJson(EMPTY_ARTIFACTS);
    setStudioOpened(false);
    setDelivered(false);
    setHasRunOnce(false);
    setActiveIdx(0);
  };

  /* ── 파일명 휴리스틱 분류 ─────────────────────────────────────────── */
  // 파일명에 'Load' 포함 → Load CSV, 그 외 → Structure CSV.
  // 어느 칸에 떨어뜨리든, 한꺼번에 여러 파일을 드롭해도 자동 분류.
  const classifyAndAssign = (file) => {
    if (!file) return;
    if (jobStatus && jobStatus.status !== 'Pending' && jobStatus.status !== 'Running') clearResults();
    if (/load/i.test(file.name)) setLoadFile(file);
    else setStructureFile(file);
  };

  // 대시보드 '새 해석 시작'에 놓은 파일을 이어받는다(이 화면의 업로드 처리와 같은 경로)
  useDashboardFilesHandoff(MENU_NAME, (files) => files.forEach(classifyAndAssign), ['.csv']);

  /* ── 폴링 ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!jobId) return undefined;
    if (!elapsedRef.current) {
      elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    }
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}${STATUS_ENDPOINT(jobId)}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          handleUnauthorized(res.status);
          return;
        }
        const data = await res.json();
        setJobStatus(data);

        if (data.status === 'Success' || data.status === 'Failed' || data.status === 'Cancelled') {
          clearInterval(pollRef.current);
          if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
          // 엔진 출력은 성공/실패 무관하게 보관한다(성공해도 입력 누락·부재 제거 경고가 있다).
          setEngineLog(data.engine_log || (data.status !== 'Success' ? (data.message || '알 수 없는 오류') : null));
          if (data.status === 'Success') pendingAdvanceRef.current = true; // 판정이 나오면 Studio 단계로
          else setActiveIdx(0);
        }
      } catch { /* network blip — keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  /* ── 언마운트 정리 ─────────────────────────────────────────────────── */
  useEffect(() => () => stopTimers(), []);

  /* ── 실행 ──────────────────────────────────────────────────────────── */
  const beginRunState = (message) => {
    setHasRunOnce(true);
    setElapsedSecs(0);
    setEngineLog(null);
    setArtifactJson(EMPTY_ARTIFACTS);
    setStudioOpened(false);
    setDelivered(false);
    pendingAdvanceRef.current = false;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    setJobStatus({ status: 'Pending', progress: 0, message });
    setActiveIdx(0);
  };

  const handleRun = async () => {
    if (!structureFile || !loadFile) {
      showToast('Structure CSV와 Load CSV를 모두 선택하세요', 'error');
      return;
    }
    const sfNum = Number(mfSafetyFactor);
    if (!Number.isFinite(sfNum) || sfNum <= 0) {
      showToast('MF Safety Factor는 0보다 큰 숫자여야 합니다', 'error');
      return;
    }
    if (!employeeId) {
      showToast('로그인 정보가 없습니다.', 'error');
      return;
    }

    const fd = new FormData();
    fd.append('structure_file',   structureFile);
    fd.append('load_file',        loadFile);
    fd.append('employee_id',      employeeId);
    fd.append('source',           'Workbench');
    fd.append('mf_safety_factor', String(sfNum));

    setJobId(null);
    beginRunState('서버에 작업 요청 중...');

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
      startGlobalJob?.(data.job_id, MENU_NAME);
    } catch (e) {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
      setJobStatus({ status: 'Failed', progress: 0, message: `요청 실패: ${e.message}` });
      setEngineLog(`[요청 실패]\n서버: ${API_BASE_URL}\n오류: ${e.message}`);
      showToast(`해석 요청 실패: ${e.message}`, 'error');
    }
  };

  const handleSampleBeforeRun = () => {
    setJobId(null);
    beginRunState('샘플 CSV 준비 중...');
  };

  const handleSampleSubmitted = (submittedJobId) => {
    setJobId(submittedJobId);
    startGlobalJob?.(submittedJobId, MENU_NAME);
  };

  const handleSampleError = (status, detail) => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (status === 429) {
      setJobStatus(null);
      setHasRunOnce(false);
      return;
    }
    setJobStatus({ status: 'Failed', progress: 0, message: `샘플 실행 실패: ${detail}` });
    setEngineLog(`[샘플 요청 실패]\n오류: ${detail}`);
  };

  /** 서버 파일 받기. 실제로 받았으면 true(단계 완료 사건으로 쓴다). */
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
      a.download = fileBaseName(path) || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      showToast(`다운로드 실패: ${e.message}`, 'error');
      return false;
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

  /** 서버에 보관된 입력 CSV 를 받아 File 로 만든다(직접 올린 것과 같은 경로로 다시 실행할 수 있게). */
  const downloadAsFile = async (path) => {
    const res = await fetch(`${API_BASE_URL}${DOWNLOAD_ENDPOINT(path)}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      handleUnauthorized(res.status);
      throw new Error(res.status === 404 ? `${fileBaseName(path)} 이 서버에 없습니다` : `HTTP ${res.status}`);
    }
    return new File([await res.blob()], fileBaseName(path), { type: 'text/csv' });
  };

  /* ── Studio 뷰어 ────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    if (window.electron?.invoke) {
      setStudioStatus('checking');
      window.electron.invoke('viewer:check-installed', STUDIO_VIEWER_ID)
        .then((r) => {
          if (cancelled) return;
          setStudioInstalled(r === null ? false : !!r?.installed);
          setStudioInstalledVersion(r?.manifest?.version ?? null);
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
      .then(r => (r.ok ? r.json() : null))
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
    return () => { try { unsub?.(); } catch { /* 이미 해제됨 */ } };
  }, []);

  // Studio 편집 적용 요청 — 편집 의도(intents)를 백엔드 apply-edit 로 넘기고 결과를 Studio 에 회신한다.
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
    return () => { try { unsub?.(); } catch { /* 이미 해제됨 */ } };
  }, []);

  /* ── 파생 ──────────────────────────────────────────────────────────── */
  const isRunning  = jobStatus?.status === 'Pending' || jobStatus?.status === 'Running';
  const isSuccess  = jobStatus?.status === 'Success';
  const isFailed   = jobStatus?.status === 'Failed' || jobStatus?.status === 'Cancelled';
  const project    = jobStatus?.project || null;
  const result     = project ? asObject(project.result_info) : null;
  const projectInput = project ? asObject(project.input_info) : {};
  const outDir     = result?.out_dir || null;
  const artifactsMissing = !!result?._artifacts_missing;
  const canRun     = !!structureFile && !!loadFile && !isRunning;
  const sfNum      = Number(mfSafetyFactor);
  const sfValid    = Number.isFinite(sfNum) && sfNum > 0;
  // 입력 이름 — 입력 요약·Studio 창 제목에 쓴다(다시 연 결과에서 CSV 를 못 받았으면 기록의 경로 이름)
  const inputName  = structureFile?.name || fileBaseName(projectInput.structure_csv) || null;

  // 대시보드에서 넘겨받은 파일로 입력이 갖춰지면 실행까지 바로 이어간다(handleRun·canRun 선언 뒤에 둔다 — TDZ)
  useDashboardAutoRun(MENU_NAME, (canRun && !hasRunOnce && structureFile) || null, handleRun);

  const handleOpenStudio = async () => {
    if (!isSuccess || !outDir || artifactsMissing) {
      showToast('먼저 Mooring Fitting 실행을 완료하세요.', 'warning');
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
      }

      setStudioStatus('opening');
      const params = new URLSearchParams({ output_dir: outDir });
      const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
        downloadUrl: `${API_BASE_URL}/api/analysis/mooring-fitting/viewer-zip?${params}`,
        jobId: outDir.split(/[\\/]/).pop(),
        headers: getAuthHeaders(),
      });
      if (fetchRes === null) throw new Error('IPC viewer:fetchResultDir 미등록');
      if (!fetchRes?.ok) throw new Error(fetchRes?.error || 'BDF 데이터 다운로드 실패');

      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: STUDIO_VIEWER_ID,
        // 창 제목 = 'Mooring Fitting · 구조 CSV 이름' — 여러 Studio 창 중 어느 입력인지 바로 보이게
        windowTitle: inputName ? `Mooring Fitting · ${inputName}` : undefined,
        initialFolder: fetchRes.dir,
        parentAnalysisId: null,
        serverUrl: API_BASE_URL,
        outputDir: outDir,   // 서버측 원본 BDF 폴더 — Studio 구조해석(solve)이 사용
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      setStudioOpened(true);
      setStudioStatus('idle');
    } catch (e) {
      setStudioStatus('error');
      setStudioError(e?.message ?? 'Studio 오류');
      showToast(`MooringFittingStudio 실행 실패 — ${e?.message}`, 'error');
    }
  };

  /* ── 리셋 ──────────────────────────────────────────────────────────── */
  const handleReset = () => {
    clearResults();
    setStructureFile(null);
    setLoadFile(null);
    setMfSafetyFactor(DEFAULT_MF_SF);
    setStudioError(null);
    setStudioProgress(null);
    if (studioStatus === 'error') setStudioStatus('idle');
    dashboardCtx?.clearAnalysisPageState?.(MENU_NAME);
  };

  /* ── 지난 결과 다시 열기(My Projects·대시보드 '내 작업'·최근 실행) ─────── */
  // build-full 기록(MooringFitting)의 result_info.out_dir 로 결과 화면을 복원한다. 입력 CSV 도 받아 두어
  // '옵션 바꿔 다시 실행'이 직접 올린 것과 같은 경로로 돈다(받지 못하면 결과만 연다).
  const applyResultReentry = async (analysisId) => {
    try {
      const { data: rec } = await getAnalysisById(analysisId);
      if (rec.program_name !== PROGRAM_NAME) throw new Error('Mooring Fitting 기록이 아닙니다.');
      if (rec.files_available === false) throw new Error('결과 파일이 보관 기간이 지나 삭제되었습니다.');
      const info = asObject(rec.result_info);
      if (!info.out_dir) throw new Error('이 기록에는 산출 폴더 정보가 없습니다.');
      const input = asObject(rec.input_info);

      const [structRes, loadRes] = await Promise.allSettled([
        input.structure_csv ? downloadAsFile(input.structure_csv) : Promise.reject(new Error('경로 없음')),
        input.load_csv ? downloadAsFile(input.load_csv) : Promise.reject(new Error('경로 없음')),
      ]);

      handleReset();
      if (structRes.status === 'fulfilled') setStructureFile(structRes.value);
      if (loadRes.status === 'fulfilled') setLoadFile(loadRes.value);
      if (input.mf_safety_factor != null) setMfSafetyFactor(input.mf_safety_factor);
      setHasRunOnce(true);
      setJobStatus({
        status: rec.status || 'Success', progress: 100, message: '',
        project: { ...rec, result_info: info, input_info: input },
      });
      pendingAdvanceRef.current = rec.status === 'Success' || !rec.status;
      const when = rec.created_at ? new Date(rec.created_at).toLocaleString('ko-KR') : '';
      showToast(`지난 결과를 열었습니다${when ? ` (${when})` : ''}.`, 'success');
    } catch (e) {
      showToast(`결과를 열지 못했습니다: ${e?.response?.data?.detail || e.message}`, 'error');
    }
  };
  useResultReentry(MENU_NAME, applyResultReentry);

  /* ── 최근 실행의 입력 불러오기 — 결과는 열지 않는다(고쳐서 다시 돌리는 용도) ─── */
  const applyRecentInput = async (record) => {
    const input = asObject(record?.input_info);
    if (!input.structure_csv || !input.load_csv) { showToast('이 실행에는 불러올 CSV 정보가 없습니다.', 'warning'); return; }
    try {
      const [s, l] = await Promise.all([downloadAsFile(input.structure_csv), downloadAsFile(input.load_csv)]);
      handleReset();
      setStructureFile(s);
      setLoadFile(l);
      if (input.mf_safety_factor != null) setMfSafetyFactor(input.mf_safety_factor);
      showToast('최근 실행의 CSV 2개와 MF 안전계수를 불러왔습니다.', 'success');
    } catch (e) {
      showToast(`입력을 불러오지 못했습니다: ${e.message}`, 'error');
    }
  };

  /* ── 결과 JSON 읽기 ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isSuccess || !result || result._artifacts_missing) return undefined;

    let cancelled = false;
    setArtifactJson(prev => ({ ...prev, loading: true, error: null }));

    Promise.all([
      fetchArtifactJson(result.raw_json),
      fetchArtifactJson(result.validation_json),
      // 진단은 부가 정보다. 조회에 실패해도 검증 패널까지 같이 비면 안 되므로 개별로 삼킨다.
      fetchArtifactJson(result.diagnosis_json).catch(() => null),
    ])
      .then(([raw, validation, diagnosis]) => {
        if (!cancelled) setArtifactJson({ raw, validation, diagnosis, loading: false, loaded: true, error: null });
      })
      .catch((e) => {
        if (!cancelled) setArtifactJson({ ...EMPTY_ARTIFACTS, loaded: true, error: e.message });
      });

    return () => { cancelled = true; };
    // 경로 문자열로만 다시 읽는다 — 폴링이 jobStatus 객체를 매번 새로 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, result?.raw_json, result?.validation_json, result?.diagnosis_json, result?._artifacts_missing]);

  /* ── 마지막 Studio 구조해석 요약 ─────────────────────────────────────── */
  // 서버의 out/ 폴더에서 읽는다(해석이 없거나 마지막 해석이 실패했으면 null). 해석 시각이 바뀌면
  // 원인 진단(DIAGNOSIS.json — 해석 뒤 부재별 진단이 더해진다)도 다시 읽는다.
  const [solveSummary, setSolveSummary] = useState(null);
  const solvedAtRef = useRef(null);
  // 결과 폴더가 바뀔 때만 비운다 — 메뉴를 떠났다 돌아올 때 비우면 그사이 끝난 해석의 진단을 다시 읽지 않는다.
  useEffect(() => {
    setSolveSummary(null);
    solvedAtRef.current = null;
  }, [isSuccess, outDir, artifactsMissing]);
  useEffect(() => {
    if (!isSuccess || !outDir || artifactsMissing) return undefined;
    let cancelled = false;
    const load = async () => {
      if (currentMenu !== MENU_NAME || document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(`${API_BASE_URL}${SOLVE_SUMMARY_ENDPOINT(outDir)}`, { headers: getAuthHeaders() });
        if (!res.ok || cancelled) return; // 옛 서버(404)·일시 오류 — 모델 생성 판정을 그대로 둔다
        const summary = (await res.json())?.summary ?? null;
        if (cancelled) return;
        setSolveSummary(summary);
        const solvedAt = summary?.solvedAt ?? null;
        if (solvedAt !== solvedAtRef.current) {
          const first = solvedAtRef.current === null;
          solvedAtRef.current = solvedAt;
          if (!first && result?.diagnosis_json) {
            fetchArtifactJson(result.diagnosis_json)
              .then(diagnosis => { if (!cancelled) setArtifactJson(prev => ({ ...prev, diagnosis })); })
              .catch(() => {});
          }
        }
      } catch { /* 네트워크 일시 오류 — 다음 주기에 다시 */ }
    };
    load();
    const timer = setInterval(load, SOLVE_SUMMARY_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, outDir, artifactsMissing, currentMenu]);

  /* ── 판정 ──────────────────────────────────────────────────────────── */
  const audit = useMemo(() => summarizeMooringRawAudit(artifactJson.raw), [artifactJson.raw]);
  const engineAlerts = useMemo(() => extractEngineAlerts(engineLog), [engineLog]);
  const verdictInput = {
    jobState: isRunning ? 'running' : isSuccess ? 'success' : isFailed ? 'failed' : 'idle',
    jobMessage: jobStatus?.message,
    result,
    rawJson: artifactJson.raw,
    validationJson: artifactJson.validation,
    diagnosis: artifactJson.diagnosis,
    artifactsLoading: isSuccess && !artifactsMissing && !artifactJson.loaded,
    artifactsError: artifactJson.error,
  };
  // 모델 생성 판정(1단계·단계 이동 기준)과, 구조해석이 있으면 그 결과로 바뀌는 최종 판정(판정 머리)을 나눈다.
  const buildVerdict = computeMooringVerdict(verdictInput);
  const verdict = isSuccess && solveSummary ? computeMooringVerdict({ ...verdictInput, solveSummary }) : buildVerdict;
  const verdictOk = !!buildVerdict.level && buildVerdict.level !== 'fail';
  const studioReady = isSuccess && !!outDir && !artifactsMissing;

  // 실행이 끝나 판정이 나오면 판정 화면(Studio 단계)으로 — 실패면 입력 단계에 남는다
  useEffect(() => {
    if (!pendingAdvanceRef.current || !buildVerdict.level) return;
    pendingAdvanceRef.current = false;
    setActiveIdx(buildVerdict.level === 'fail' ? STEP_INDEX.input : STEP_INDEX.studio);
  }, [buildVerdict.level]);

  const displaySteps = STEP_DEFS.map((def) => {
    if (def.id === 'input') {
      if (isRunning) return { ...def, status: 'running', hint: '실행 중' };
      if (buildVerdict.level === 'fail') return { ...def, status: 'error', hint: isFailed || artifactsMissing ? '실행 실패' : '모델 검증 실패' };
      if (buildVerdict.level === 'review') return { ...def, status: 'review', hint: '통과 · 확인할 항목 있음' };
      if (buildVerdict.level === 'pass') return { ...def, status: 'done', hint: '검증 통과' };
      return { ...def, status: 'wait' };
    }
    if (def.id === 'studio') {
      if (!studioReady) return { ...def, status: 'wait' };
      if (verdict.basis === 'solve') {
        const hint = `구조해석 완료 · ${verdict.title}`;
        if (verdict.level === 'fail') return { ...def, status: 'error', hint };
        if (verdict.level === 'review') return { ...def, status: 'review', hint };
        return { ...def, status: 'done', hint };
      }
      if (studioOpened) return { ...def, status: 'done', hint: 'Studio 열림' };
      return { ...def, status: 'wait', hint: 'Studio 열기 전' };
    }
    if (!studioReady) return { ...def, status: 'wait' };
    if (delivered) return { ...def, status: 'done', hint: '보고서·파일 받음' };
    if (buildVerdict.level === 'fail') return { ...def, status: 'error', hint: '최종 검증 오류' };
    return { ...def, status: 'wait', hint: '보고서 대기' };
  });
  const activeStep = displaySteps[activeIdx] ?? displaySteps[0];

  const inputItems = [
    { key: 'structure', label: 'Structure', fileName: inputName, state: buildVerdict.level === 'fail' ? 'error' : buildVerdict.level === 'review' ? 'warn' : 'ok' },
    { key: 'load', label: 'Load', fileName: loadFile?.name || fileBaseName(projectInput.load_csv) || null, state: 'ok' },
  ];

  /* ── 실행 버튼 — 하나만. 단축키도 같은 객체를 쓴다 ───────────────── */
  const hasResult = isSuccess || isFailed;
  const runAction = {
    label: hasResult ? '옵션 바꿔 다시 실행' : 'Mooring Fitting 실행',
    icon: hasResult ? RefreshCw : ChevronsRight,
    onClick: handleRun,
    enabled: canRun && sfValid,
    title: hasResult ? '지금 입력 CSV 와 MF 안전계수로 다시 실행합니다. 지금 결과는 지워집니다.' : undefined,
  };
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (currentMenu !== MENU_NAME) return; // keep-alive 라 다른 화면에서도 살아 있다
      const a = runActionRef.current;
      if (!a.enabled) return;
      e.preventDefault();
      a.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);

  /* ── 다음 행동 바 — 단계마다 주 행동 1개 ─────────────────────────── */
  const studioBusy = ['checking', 'installing', 'opening'].includes(studioStatus);
  const openStudioAction = {
    label: studioOpened ? 'Studio 다시 열기' : 'Studio 열기', icon: ExternalLink,
    onClick: handleOpenStudio, busy: studioBusy, disabled: !studioReady,
  };
  const nextAction = (() => {
    if (isRunning || !verdict.level) {
      if (activeStep.id !== 'input' && !studioReady && !isRunning) {
        return {
          note: '아직 실행 결과가 없습니다. CSV 2개를 올리고 실행하세요.',
          primary: { label: '입력으로 돌아가기', icon: FileSpreadsheet, onClick: () => setActiveIdx(STEP_INDEX.input) },
        };
      }
      return null;
    }
    if (activeStep.id === 'input') {
      if (verdictOk) {
        return {
          note: verdict.level === 'review'
            ? '모델은 만들어졌지만 아래 항목을 확인하세요. 문제없다면 Studio 에서 편집·구조해석을 진행합니다.'
            : 'CSV 변환과 모델 생성이 끝났습니다. Studio 에서 편집·구조해석을 진행합니다.',
          primary: { label: 'Studio 편집·구조해석으로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.studio) },
        };
      }
      if (studioReady) {
        // 최종 검증 오류는 Studio 편집(그룹 삭제·RBE2)으로 고칠 수도 있다 — 열기는 막지 않는다.
        return {
          note: '최종 검증 오류는 CSV 를 고쳐 다시 실행하거나, Studio 에서 그룹 삭제·RBE2 편집으로 고칩니다.',
          secondary: [
            { key: 'checklist', label: 'Checklist 보기', icon: ClipboardCheck, onClick: () => setActiveIdx(STEP_INDEX.result) },
            { key: 'studio', label: 'Studio 에서 보정', icon: ExternalLink, onClick: () => setActiveIdx(STEP_INDEX.studio) },
          ],
        };
      }
      return null; // 실행 실패 — 원인은 판정 머리, 원문은 엔진 출력
    }
    if (activeStep.id === 'studio') {
      if (!studioReady) {
        return {
          note: 'CSV 입력 검증을 먼저 마치세요.',
          primary: { label: '입력으로 돌아가기', icon: FileSpreadsheet, onClick: () => setActiveIdx(STEP_INDEX.input) },
        };
      }
      return {
        note: studioOpened
          ? 'Studio 에서 편집·구조해석을 마치면 Studio 의 [보고서 생성] 또는 3단계에서 보고서를 받습니다.'
          : 'Studio 를 열어 그룹 삭제·RBE2 편집과 구조해석(SOL 101)을 진행하세요.',
        primary: openStudioAction,
        secondary: studioOpened
          ? [{ key: 'result', label: '최종 검증·보고서로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.result) }]
          : [],
      };
    }
    return null; // 결과 단계 — 보고서·파일 버튼은 본문에 있다
  })();

  const vc = solveSummary?.verdictCounts;
  const verdictSummary = verdict.basis === 'solve'
    ? (vc ? `OK ${vc.OK ?? 0} · 재질 변경 ${vc.MATERIAL_CHANGE ?? 0} · NOT OK ${vc.NOT_OK ?? 0}` : null)
    : verdict.level === 'pass'
    ? 'CSV 파싱 실패 0 · 최종 검증 오류 0 · 경고 0'
    : verdict.level === 'review'
      ? '모델은 만들어졌습니다. 아래 항목을 확인한 뒤 진행하세요.'
      : null;
  const solvedAtText = solveSummary?.solvedAt
    ? new Date(solveSummary.solvedAt * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const verdictMeta = verdict.basis === 'build'
    ? '모델 생성(build-full) 기준 · 구조해석 전'
    : verdict.basis === 'solve' ? `Studio 구조해석 결과 기준${solvedAtText ? ` · ${solvedAtText}` : ''}` : null;

  // 첫 화면(입력 단계 · 아직 아무것도 돌리지 않음) — 두 칸 높이를 맞추고 아래를 진행 순서·최근 실행으로 채운다.
  const isStartScreen = activeStep.id === 'input' && !jobStatus;
  const hasAnyInput = !!(structureFile || loadFile);

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">

      <FileBasedPageBanner
        title={MENU_NAME}
        subtitle="Structure CSV + Load CSV 입력 정합성 및 FE 변환 검증"
        icon={FileSpreadsheet}
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      <div className="flex flex-col items-stretch gap-5 px-1 xl:flex-row">

        {/* ── 왼쪽 레일: 단계 · 입력 요약 · 옵션 · 실행 ── */}
        <aside className={`flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0 ${isStartScreen ? '' : 'xl:self-start'}`}>
          <StepRail steps={displaySteps} activeIdx={activeIdx} onSelect={setActiveIdx} />

          {activeStep.id !== 'input' && (
            <>
              <div className="h-px bg-slate-100" />
              <InputSummary items={inputItems} />
            </>
          )}

          <div className="h-px bg-slate-100" />
          <div>
            <label htmlFor="mf-safety-factor" className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">MF 안전계수 (SF)</span>
                <span className="block text-xs text-slate-600">MF 하중(CHOCK·BOLLARD·Roller 등)에만 곱합니다. Winch 제외.</span>
              </span>
              <input
                id="mf-safety-factor"
                type="number"
                value={mfSafetyFactor}
                min={0.1}
                step={0.05}
                disabled={isRunning}
                onChange={(e) => setMfSafetyFactor(e.target.value)}
                className="w-20 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:opacity-60"
              />
            </label>
            <p className={`mt-1.5 font-mono text-[11px] ${sfValid ? 'text-slate-600' : 'text-red-700'}`}>
              {sfValid ? `P = SWL × 9806.65 × ${sfNum} (N)` : '0보다 큰 숫자를 입력하세요'}
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={runAction.onClick}
              disabled={!runAction.enabled}
              title={runAction.title}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isRunning
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> 실행 중…</>
                : <><runAction.icon size={15} aria-hidden="true" /> {runAction.label}</>}
            </button>
            {!(structureFile && loadFile) ? (
              <p className="text-center text-xs text-slate-600">Structure CSV 와 Load CSV 를 올리면 열립니다.</p>
            ) : (
              <p className="text-center text-[11px] text-slate-600">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl</kbd>
                {' + '}
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Enter</kbd>
                {' 로도 실행합니다'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
              {(hasAnyInput || jobStatus) && (
                <button type="button" onClick={handleReset} disabled={isRunning} className={linkCls}>
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <SampleRunButton
                appKey="mooring-fitting"
                variant="link"
                label="샘플로 실행"
                disabled={isRunning}
                onBeforeRun={handleSampleBeforeRun}
                onJobSubmitted={handleSampleSubmitted}
                onError={handleSampleError}
              />
            </div>
          </div>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {isRunning && (
            <JobProgressCard
              title="Mooring Fitting 실행 중"
              message={jobStatus?.message}
              progress={jobStatus?.progress ?? 0}
              elapsed={elapsedSecs}
              note="다른 화면으로 이동해도 계속 진행됩니다. 오른쪽 아래 작업 카드로 돌아올 수 있습니다."
            />
          )}

          {!isRunning && verdict.level && (
            <VerdictHeader
              level={verdict.level}
              title={verdict.title}
              summary={verdictSummary}
              reasons={verdict.reasons}
              meta={verdictMeta}
            />
          )}
          {nextAction && <NextActionBar {...nextAction} />}

          <section className={`flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-5 py-4 ${isStartScreen ? 'flex-1' : ''}`}>
            <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-100 pb-3">
              <activeStep.icon size={15} className="text-slate-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            <div className="min-w-0 space-y-4">
              {activeStep.id === 'input' && (
                <>
                  <div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <UploadDropzone
                        label="Structure CSV"
                        hint="MooringFittingData.csv"
                        file={structureFile}
                        disabled={isRunning}
                        onFiles={(files) => files.forEach(classifyAndAssign)}
                        onClear={() => { setStructureFile(null); if (hasResult) clearResults(); }}
                      />
                      <UploadDropzone
                        label="Load CSV"
                        hint="MooringFittingDataLoad.csv"
                        file={loadFile}
                        disabled={isRunning}
                        onFiles={(files) => files.forEach(classifyAndAssign)}
                        onClear={() => { setLoadFile(null); if (hasResult) clearResults(); }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      두 파일을 한 번에 끌어 놓아도 됩니다 — 파일명에 <span className="font-semibold text-slate-800">Load</span> 가 있으면 Load CSV, 나머지는 Structure CSV 로 나눕니다.
                    </p>
                  </div>

                  {isStartScreen && (
                    <RunStartPanel
                      programName={PROGRAM_NAME}
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => { const i = asObject(r.input_info); return !!(i.structure_csv && i.load_csv); }}
                      steps={[
                        { title: 'CSV 입력 검증', detail: 'Structure·Load CSV 를 행 단위로 변환해 8단계 BDF 파이프라인으로 모델을 만들고, 빠진 행·최종 모델 검사·원인 진단을 보여 줍니다.' },
                        { title: 'Studio 편집·구조해석', detail: 'Studio 에서 모델을 3D 로 열어 그룹 삭제·RBE2 편집과 구조해석(SOL 101)을 진행합니다.' },
                        { title: '최종 검증·보고서', detail: '최종 검증 Checklist·부재별 원인 진단을 확인하고 강도검토 보고서(xlsx)와 산출 파일을 받습니다.' },
                      ]}
                    />
                  )}

                  {isSuccess && !artifactsMissing && (
                    <>
                      <CsvValidationPanel audit={audit} loading={artifactJson.loading || !artifactJson.loaded} error={artifactJson.error} />
                      <DiagnosisPanel diagnosis={artifactJson.diagnosis} />
                      <EngineAlertsPanel alerts={engineAlerts} />
                    </>
                  )}
                </>
              )}

              {activeStep.id === 'studio' && (
                <>
                  <StudioLauncherCard
                    title="Mooring Fitting Studio"
                    description="CSV 로 만든 모델을 3D 로 열어 편집하고 구조해석을 실행합니다. 설치 파일은 필요할 때 자동으로 받고, 이후에는 설치본을 다시 씁니다."
                    installed={studioInstalled}
                    status={studioStatus}
                    progress={studioProgress}
                    error={studioError}
                    installedVersion={studioInstalledVersion}
                    latestVersion={studioLatestVersion}
                    ready={studioReady}
                    notReadyTitle="먼저 Mooring Fitting 실행을 완료하세요"
                    onLaunch={handleOpenStudio}
                  />
                  <ol className="space-y-1.5 text-sm text-slate-700">
                    {[
                      ['BDF 시각화', 'CSV 변환 결과 BDF 를 3D 로 봅니다.'],
                      ['그룹 · RBE2 편집', '불필요한 그룹을 지우고 RBE2 를 추가·삭제합니다. 편집은 이 화면이 서버에 적용합니다.'],
                      ['구조해석 · 최종 BDF', '구조해석을 실행하고 편집한 BDF 를 저장합니다. 보고서는 Studio [보고서 생성] 또는 3단계에서 만듭니다.'],
                    ].map(([t, d], i) => (
                      <li key={t} className="flex gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-bold text-slate-700">{i + 1}</span>
                        <span><span className="font-semibold text-slate-800">{t}</span> — {d}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {activeStep.id === 'result' && (
                studioReady ? (
                  <>
                    <FinalValidationPanel
                      validationJson={artifactJson.validation}
                      loading={artifactJson.loading || !artifactJson.loaded}
                      error={artifactJson.error}
                    />
                    <DiagnosisPanel diagnosis={artifactJson.diagnosis} showElements />
                    <ReportPanel outputDir={outDir} onNotify={showToast} onGenerated={() => setDelivered(true)} />
                    <ArtifactFilesList
                      result={result}
                      onDownload={async (path) => { if (await handleDownload(path)) setDelivered(true); }}
                    />
                  </>
                ) : (
                  <p className="text-sm text-slate-600">실행을 마치면 최종 검증 Checklist 와 보고서·산출 파일이 여기에 표시됩니다.</p>
                )
              )}
            </div>
          </section>

          {/* 엔진 출력 원문 — 실패면 펼쳐 둔다. 성공해도 경고 확인용으로 접어서 남긴다. */}
          {!isRunning && engineLog && <EngineLogPanel key={isFailed ? 'failed' : 'ok'} log={engineLog} defaultOpen={isFailed} />}
        </main>
      </div>
    </div>
  );
}
