// PSA 평가보고서 자동화 — 단계별 입력 표.
// 상태와 규칙은 utils/psaReport.js, 페이지 골격은 pages/analysis/PsaReportAutomation.jsx.
//
// 표 모양 = 엑셀형 격자(2026-11-17 사용자 선택). 보고서 표와 같은 격자선 안에 칸마다 상자 없이 값만 두고,
// 누른 칸만 파란 테두리로 입력 상태가 된다. 단위는 머리글에 둔다.
// Enter = 같은 열 아랫칸, Shift+Enter = 윗칸(data-col 이 같은 칸끼리). 한글 조합 중 Enter 는 무시.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileSpreadsheet, Plus, Trash2, X, ChevronDown, Lock } from 'lucide-react';
import {
  PROCESS_FIELDS, VALUE_JOINS, MANIFOLD_SIZES, manifoldLoadsFor, manifoldSizeLabel,
  isRealOrBlank, duplicateLineNos, isCompRm,
} from '../../../utils/psaReport';

// ── 격자 공용 ────────────────────────────────────────────────
const GRID_LINE = 'border border-slate-200';
const th = `${GRID_LINE} bg-slate-100 px-3 py-2 text-left align-bottom text-xs font-semibold text-slate-700`;
const cell = `${GRID_LINE} p-0 align-middle`;
const labelCell = `${GRID_LINE} bg-slate-50 px-3 py-2 align-middle text-sm font-semibold text-slate-800`;
const textCell = `${GRID_LINE} px-3 py-2 align-middle text-sm text-slate-600`;
const fieldBase = 'block h-10 w-full bg-transparent px-3 text-sm text-slate-900 placeholder:text-slate-400 hover:bg-blue-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500';
const invalidField = 'bg-red-50 ring-2 ring-inset ring-red-400';

function GridTable({ minWidth, children, caption }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
      {/* table-fixed: colgroup 폭을 그대로 따른다 */}
      <table className="w-full table-fixed border-collapse border-hidden" style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

function HeadUnit({ children }) {
  return <span className="ml-1 font-medium text-slate-500">{children}</span>;
}

function moveOnEnter(e) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
  const col = e.currentTarget.dataset.col;
  if (!col) return;
  e.preventDefault();
  const table = e.currentTarget.closest('table');
  const list = [...table.querySelectorAll(`[data-col="${CSS.escape(col)}"]`)];
  const next = list[list.indexOf(e.currentTarget) + (e.shiftKey ? -1 : 1)];
  if (next) { next.focus(); next.select?.(); }
}

/** 칸 안의 글자 입력(상자 없음) */
export function GridText({ value, onChange, ariaLabel, placeholder, invalid = false, col, list, className = '' }) {
  return (
    <input
      type="text"
      value={value}
      list={list}
      data-col={col}
      onKeyDown={moveOnEnter}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={`${fieldBase} ${invalid ? invalidField : ''} ${className}`}
    />
  );
}

/** 칸 안의 숫자 입력 — 오른쪽 정렬, 숫자가 아니면 그 칸만 빨갛게(빈 칸은 막지 않음). */
// 빈 칸은 옅은 '입력' 으로 입력할 자리임을 보인다(격자에 상자가 없어 빈 칸이 그냥 빈 칸처럼 보인다).
export function GridNumber({ value, onChange, ariaLabel, col, placeholder = '입력', className = '' }) {
  const invalid = !isRealOrBlank(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      data-col={col}
      onKeyDown={moveOnEnter}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      title={invalid ? '숫자가 아닙니다' : undefined}
      className={`${fieldBase} text-right tabular-nums ${invalid ? invalidField : ''} ${className}`}
    />
  );
}

function GridSelect({ value, onChange, options, ariaLabel, placeholder = '선택', warn = false }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${fieldBase} cursor-pointer appearance-none pr-8 ${warn ? 'bg-amber-50 text-amber-900' : ''}`}
      >
        <option value="">{placeholder}</option>
        {options.map(o => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
    </div>
  );
}

function RowIcon({ label, onClick, disabled, children, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:invisible ${
        danger ? 'hover:bg-red-50 hover:text-red-700' : 'hover:bg-slate-200 hover:text-slate-800'}`}
    >
      {children}
    </button>
  );
}

export function AddRowButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
    >
      <Plus size={15} aria-hidden="true" />
      {children}
    </button>
  );
}

function EmptyRow({ colSpan, children }) {
  return <tr><td colSpan={colSpan} className={`${GRID_LINE} px-3 py-6 text-center text-sm text-slate-500`}>{children}</td></tr>;
}

function SectionTitle({ children, hint }) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-slate-800">
      {children}
      {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
    </h3>
  );
}

// ── Line 엑셀 칸 ─────────────────────────────────────────────
const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

// Line 마다 CAESAR II 결과 엑셀 하나(2026-11-19). folder = { name: 파일 이름, target: 서버 폴더 } · upload = 올리는 중
export function ExcelCell({ folder, onPick, onClear, label, upload }) {
  const inputRef = useRef(null);
  const pick = () => inputRef.current?.click();
  const onChange = (e) => {
    if (e.target.files?.length) onPick(e.target.files);
    e.target.value = '';
  };
  const bad = folder?.stale || folder?.incomplete;
  return (
    <div className="min-w-0">
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={onChange} aria-hidden="true" tabIndex={-1} />
      {!folder ? (
        <button
          type="button"
          onClick={pick}
          aria-label={`${label} 결과 엑셀 선택`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          <FileSpreadsheet size={15} aria-hidden="true" /> 엑셀 선택
        </button>
      ) : (
        <div className="flex h-8 min-w-0 items-center gap-1.5">
          <FileSpreadsheet size={15} className={`shrink-0 ${bad ? 'text-amber-600' : 'text-emerald-700'}`} aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-slate-800" title={folder.name}>{folder.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatBytes(folder.totalBytes)}</span>
          {upload ? null : folder.incomplete ? (
            <button type="button" onClick={pick} className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-100">
              올리기 실패, 다시 선택
            </button>
          ) : folder.stale ? (
            <button type="button" onClick={pick} className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100">
              다시 선택 필요
            </button>
          ) : (
            <button type="button" onClick={pick} className="shrink-0 text-xs font-semibold text-slate-500 hover:text-blue-700">바꾸기</button>
          )}
          {!upload && <RowIcon label={`${label} 엑셀 지우기`} onClick={onClear}><X size={14} /></RowIcon>}
        </div>
      )}
      {upload && <p className="mt-0.5 text-[11px] font-semibold text-blue-700" role="status">서버에 올리는 중</p>}
    </div>
  );
}

// 끌어 놓은 항목 → File 목록. 폴더를 놓으면 안의 파일까지(하위 폴더 포함) 모은다 — 거르기는 받는 쪽(planExcelFiles)이.
async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map(it => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e); // eslint-disable-line no-await-in-loop
    }
  };
  for (const e of entries) await walk(e); // eslint-disable-line no-await-in-loop
  return out;
}

/** 파일을 끌어 놓는 자리(파일 여러 개 또는 폴더). 놓은 파일을 onFiles 로 넘긴다 — 결과 엑셀, 보고서 그림이 같이 쓴다. */
export function ExcelDropZone({ onFiles, disabled = false, message = '놓으면 엑셀마다 Line 이 생깁니다', children }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0); // 안쪽 요소를 지날 때 dragleave 가 먼저 와서 깜빡이지 않게
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  return (
    <div
      onDragEnter={e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }}
      onDragLeave={e => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={async e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        onFiles(await filesFromDrop(e.dataTransfer));
      }}
      className={`relative rounded-xl ${over && !disabled ? 'outline-dashed outline-2 outline-offset-4 outline-blue-500' : ''}`}
    >
      {children}
      {over && !disabled && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-blue-50/85">
          <p className="flex items-center gap-2 text-base font-bold text-blue-800">
            <FileSpreadsheet size={20} aria-hidden="true" /> {message}
          </p>
        </div>
      )}
    </div>
  );
}

/** 파일을 고르는 단추(기본 엑셀). multiple 이면 여러 개. 고른 FileList 를 onPick 으로 넘긴다. */
export function ExcelPickButton({ onPick, children, multiple = false, accept = '.xlsx', disabled = false, className = '' }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ''; }}
      />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
    </>
  );
}

/** 폴더 하나를 고르는 단추(webkitdirectory). 고른 FileList 를 onPick 으로 넘긴다. */
export function FolderPickButton({ onPick, children, disabled = false, className = '' }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute('webkitdirectory', '');
      inputRef.current.setAttribute('directory', '');
    }
  }, []);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ''; }}
      />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
    </>
  );
}

// ── 1. Scope of Piping Lines ─────────────────────────────────
export function ScopeTable({ input, uploads = {}, onLineChange, onMove, onRemove, onAdd, onAddCompRm, onPickFolder, onClearFolder }) {
  const dup = duplicateLineNos(input.lines);
  const hasComp = input.lines.some(isCompRm);
  return (
    <div>
      <GridTable minWidth={760} caption="Scope of Piping Lines">
        <colgroup>
          <col style={{ width: 150 }} />
          <col />
          <col style={{ width: '38%' }} />
          <col style={{ width: 96 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>Line No.</th>
            <th className={th}>Pipe Line</th>
            <th className={th}>결과 엑셀<HeadUnit>CAESAR II 내보내기, Line 마다 하나</HeadUnit></th>
            <th className={th}><span className="sr-only">순서와 삭제</span></th>
          </tr>
        </thead>
        <tbody>
          {input.lines.map((l, i) => {
            const isDup = dup.has(String(l.lineNo).trim().toUpperCase());
            return (
              <tr key={l.uid}>
                <td className={cell}>
                  <GridText value={l.lineNo} col="lineNo" onChange={val => onLineChange(l.uid, { lineNo: val })} ariaLabel={`${i + 1}번째 줄 Line No.`} invalid={isDup || !String(l.lineNo).trim()} className="font-semibold" />
                  {isDup && <p className="px-3 pb-1 text-[11px] font-semibold text-red-700">같은 번호가 있습니다</p>}
                </td>
                <td className={cell}>
                  <GridText value={l.pipeLine} col="pipeLine" onChange={val => onLineChange(l.uid, { pipeLine: val })} ariaLabel={`${l.lineNo} Pipe Line`} placeholder="예: Liquid Main" />
                </td>
                <td className={`${GRID_LINE} px-3 py-1 align-middle`}>
                  <ExcelCell
                    label={l.lineNo || `${i + 1}번째 줄`}
                    folder={l.folder}
                    upload={uploads[l.uid]}
                    onPick={fl => onPickFolder(l.uid, fl)}
                    onClear={() => onClearFolder(l.uid)}
                  />
                </td>
                <td className={`${GRID_LINE} px-1 align-middle`}>
                  <div className="flex justify-center">
                    <RowIcon label={`${l.lineNo || '이 줄'} 위로`} onClick={() => onMove(l.uid, -1)} disabled={i === 0}><ArrowUp size={15} /></RowIcon>
                    <RowIcon label={`${l.lineNo || '이 줄'} 아래로`} onClick={() => onMove(l.uid, 1)} disabled={i === input.lines.length - 1}><ArrowDown size={15} /></RowIcon>
                    <RowIcon label={`${l.lineNo || '이 줄'} 삭제`} onClick={() => onRemove(l.uid)} danger><Trash2 size={15} /></RowIcon>
                  </div>
                </td>
              </tr>
            );
          })}
          {input.lines.length === 0 && <EmptyRow colSpan={4}>Line 이 없습니다. 위의 [결과 엑셀 선택] 으로 엑셀을 고르면 엑셀마다 Line 이 생깁니다.</EmptyRow>}
        </tbody>
      </GridTable>
      <div className="flex flex-wrap gap-2">
        <AddRowButton onClick={onAdd}>Line 추가</AddRowButton>
        {!hasComp && <AddRowButton onClick={onAddCompRm}>COMP.RM 다시 추가</AddRowButton>}
      </div>
    </div>
  );
}

// ── 2. Process Condition ─────────────────────────────────────
// 숫자 칸 = 주 값 + (선택) 둘째 값. 칸에 마우스를 올리거나 들어가면 + 가 보이고, 둘째 값 줄의 기호로 잇는 방식을 고른다.
function ValueCell({ cell: c0, onChange, label, col }) {
  const c = c0 || { a: '', b: '', join: '' };
  const set = (patch) => onChange({ ...c, ...patch });
  return (
    <td className={`${cell} group relative align-top`}>
      <GridNumber value={c.a} col={`${col}.a`} onChange={a => set({ a })} ariaLabel={label} className={c.join ? '' : 'pr-9'} />
      {!c.join && (
        <button
          type="button"
          onClick={() => set({ join: 'range' })}
          aria-label={`${label} 둘째 값 추가 (범위, 두 값, 보조 값)`}
          title="둘째 값 추가"
          className="absolute right-1.5 top-[7px] inline-flex h-[26px] w-[26px] items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-800 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Plus size={14} />
        </button>
      )}
      {c.join && (
        <div className="flex items-stretch border-t border-dashed border-slate-200">
          <select
            value={c.join}
            onChange={e => set({ join: e.target.value })}
            aria-label={`${label} 둘째 값을 잇는 방식`}
            title={VALUE_JOINS.find(j => j.value === c.join)?.label}
            className="h-10 w-12 shrink-0 cursor-pointer appearance-none border-r border-slate-200 bg-slate-50 text-center text-sm font-semibold text-slate-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          >
            {VALUE_JOINS.map(j => <option key={j.value} value={j.value}>{j.symbol}</option>)}
          </select>
          <div className="min-w-0 flex-1">
            <GridNumber value={c.b} col={`${col}.b`} onChange={b => set({ b })} ariaLabel={`${label} 둘째 값`} />
          </div>
          <button
            type="button"
            onClick={() => set({ join: '', b: '' })}
            aria-label={`${label} 둘째 값 지우기`}
            title="둘째 값 지우기"
            className="inline-flex w-8 shrink-0 items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </td>
  );
}

export function ProcessTable({ input, onCellChange, onNotesChange }) {
  return (
    <div>
      <GridTable minWidth={980} caption="Process conditions">
        <colgroup>
          <col style={{ width: 110 }} />
          {PROCESS_FIELDS.map(f => <col key={f.key} style={{ width: f.kind === 'value' ? 160 : 130 }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className={`${th} sticky left-0 z-10`}>Line No.</th>
            {PROCESS_FIELDS.map(f => (
              <th key={f.key} className={`${th} ${f.kind === 'value' ? 'text-right' : ''}`}>
                {f.label}{f.unit && <HeadUnit>({f.unit})</HeadUnit>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.lines.map(l => {
            const row = input.process[l.uid] || {};
            const name = l.lineNo || '(번호 없음)';
            return (
              <tr key={l.uid}>
                <th scope="row" className={`${labelCell} sticky left-0 z-10 text-left`}>{name}</th>
                {PROCESS_FIELDS.map(f => (f.kind === 'value' ? (
                  <ValueCell key={f.key} cell={row[f.key]} col={f.key} label={`${name} ${f.label}`} onChange={val => onCellChange(l.uid, f.key, val)} />
                ) : (
                  <td key={f.key} className={`${cell} align-top`}>
                    <GridSelect value={row[f.key] ?? ''} options={f.options} ariaLabel={`${name} ${f.label}`} onChange={val => onCellChange(l.uid, f.key, val)} />
                  </td>
                )))}
              </tr>
            );
          })}
        </tbody>
      </GridTable>

      <p className="mt-2 text-xs text-slate-600">
        숫자 칸에 마우스를 올리면 보이는 <span className="font-semibold text-slate-800">+</span> 로 둘째 값을 더합니다.
        {' '}<span className="font-semibold text-slate-800">~</span> 범위(-196°C ~ -18°C),
        {' '}<span className="font-semibold text-slate-800">&amp;</span> 두 값(500 kg/m³ &amp; 25 kg/m³),
        {' '}<span className="font-semibold text-slate-800">(*)</span> 보조 값(보고서에 두 줄, 45°C(*)).
      </p>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-slate-800">표 설명</span>
        <span className="ml-2 text-xs text-slate-500">보고서 Table 2.3 아래 문단입니다. (*) 와 (**) 의 뜻을 여기에 적습니다.</span>
        <textarea
          value={input.processNotes}
          onChange={e => onNotesChange(e.target.value)}
          rows={7}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </label>
    </div>
  );
}

// ── 3. Displacement ──────────────────────────────────────────
// 보고서 표의 8칸을 Hogging, Sagging 짝으로 보인다(같은 키에 저장).
const DISP_MATRIX = [
  { position: 'Trunk Deck', condition: 'Sea-going', hog: 'tdSeaHog', sag: 'tdSeaSag', lines: 'Vapour / Gas / Relief / Condensate / Fuel Gas', span: 2 },
  { position: 'Trunk Deck', condition: 'Terminal (Harbour)', hog: 'tdTermHog', sag: 'tdTermSag', lines: 'Liquid / Spray', span: 0 },
  { position: 'Compressor Room', condition: 'Sea-going', hog: 'crSeaHog', sag: 'crSeaSag', lines: 'All Lines', span: 1 },
];

export function DisplacementTable({ input, onChange }) {
  const d = input.displacement;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>선체 휨</SectionTitle>
        <GridTable minWidth={760} caption="Displacement, hogging and sagging">
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 150 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>Position</th>
              <th className={th}>Condition</th>
              <th className={`${th} text-right`}>Hogging<HeadUnit>(mm/m)</HeadUnit></th>
              <th className={`${th} text-right`}>Sagging<HeadUnit>(mm/m)</HeadUnit></th>
              <th className={th}>Lines</th>
            </tr>
          </thead>
          <tbody>
            {DISP_MATRIX.map(r => (
              <tr key={r.hog}>
                {r.span > 0 && <th scope="rowgroup" rowSpan={r.span} className={`${labelCell} text-left`}>{r.position}</th>}
                <td className={`${GRID_LINE} bg-slate-50 px-3 py-2 align-middle text-sm text-slate-700`}>{r.condition}</td>
                <td className={cell}><GridNumber value={d[r.hog] ?? ''} col="hog" onChange={val => onChange(r.hog, val)} ariaLabel={`${r.position} ${r.condition} Hogging (mm/m)`} /></td>
                <td className={cell}><GridNumber value={d[r.sag] ?? ''} col="sag" onChange={val => onChange(r.sag, val)} ariaLabel={`${r.position} ${r.condition} Sagging (mm/m)`} /></td>
                <td className={textCell}>{r.lines}</td>
              </tr>
            ))}
          </tbody>
        </GridTable>
      </section>

      <section>
        <SectionTitle>온도 영향</SectionTitle>
        <GridTable minWidth={760} caption="Displacement, sun and cold effect">
          <colgroup>
            <col style={{ width: 340 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 150 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>Position</th>
              <th className={`${th} text-right`}>Sun effect (+45℃)<HeadUnit>(mm/m)</HeadUnit></th>
              <th className={`${th} text-right`}>Cold effect (-18℃)<HeadUnit>(mm/m)</HeadUnit></th>
              <th className={th}>Lines</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={`${labelCell} text-left`}>Trunk Deck</th>
              <td className={cell}><GridNumber value={d.sun ?? ''} col="sun" onChange={val => onChange('sun', val)} ariaLabel="Sun effect (+45℃) (mm/m)" /></td>
              <td className={cell}><GridNumber value={d.cold ?? ''} col="cold" onChange={val => onChange('cold', val)} ariaLabel="Cold effect (-18℃) (mm/m)" /></td>
              <td className={textCell}>All Lines (only for Trunk Deck)</td>
            </tr>
          </tbody>
        </GridTable>
      </section>
    </div>
  );
}

// ── 4. Acceleration ──────────────────────────────────────────
const AXES = [
  { key: 'x', pos: 'X from AP', acc: 'X (U1)' },
  { key: 'y', pos: 'Y from CL', acc: 'Y (U2)' },
  { key: 'z', pos: 'Z from BL', acc: 'Z (U3)' },
];
const LOAD_CONDITIONS = ['Sea-going Condition', 'Terminal Condition'];

export function AccelPositionTable({ input, onChange, onRemove, onAdd }) {
  return (
    <div>
      <GridTable minWidth={680} caption="Acceleration position">
        <colgroup>
          <col />
          {AXES.map(a => <col key={a.key} style={{ width: 160 }} />)}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>Discipline</th>
            {AXES.map(a => <th key={a.key} className={`${th} text-right`}>{a.pos}<HeadUnit>(mm)</HeadUnit></th>)}
            <th className={th}><span className="sr-only">삭제</span></th>
          </tr>
        </thead>
        <tbody>
          {input.accelPositions.map((p, i) => (
            <tr key={p.uid}>
              <td className={cell}><GridText value={p.discipline} col="discipline" onChange={val => onChange(p.uid, { discipline: val })} ariaLabel={`${i + 1}번째 Discipline`} invalid={!p.discipline.trim()} className="font-semibold" placeholder="예: Trunk Deck" /></td>
              {AXES.map(a => (
                <td key={a.key} className={cell}><GridNumber value={p[a.key]} col={a.key} onChange={val => onChange(p.uid, { [a.key]: val })} ariaLabel={`${p.discipline} ${a.pos} (mm)`} /></td>
              ))}
              <td className={`${GRID_LINE} px-1 text-center align-middle`}><RowIcon label={`${p.discipline || '이 줄'} 삭제`} onClick={() => onRemove(p.uid)} danger><Trash2 size={15} /></RowIcon></td>
            </tr>
          ))}
          {input.accelPositions.length === 0 && <EmptyRow colSpan={5}>위치가 없습니다. [Discipline 추가] 로 넣으세요.</EmptyRow>}
        </tbody>
      </GridTable>
      <AddRowButton onClick={onAdd}>Discipline 추가</AddRowButton>
    </div>
  );
}

export function AccelLoadTable({ input, onChange, onRemove, onAdd }) {
  const positions = input.accelPositions;
  return (
    <div>
      <datalist id="psa-load-conditions">
        {LOAD_CONDITIONS.map(c => <option key={c} value={c} />)}
      </datalist>
      <GridTable minWidth={940} caption="Acceleration loads">
        <colgroup>
          <col style={{ width: 160 }} />
          <col style={{ width: 210 }} />
          <col />
          {AXES.map(a => <col key={a.key} style={{ width: 104 }} />)}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>Discipline</th>
            <th className={th}>Load condition</th>
            <th className={th}>Lines</th>
            {AXES.map(a => <th key={a.key} className={`${th} text-right`}>{a.acc}<HeadUnit>(g)</HeadUnit></th>)}
            <th className={th}><span className="sr-only">삭제</span></th>
          </tr>
        </thead>
        <tbody>
          {input.accelLoads.map((a, i) => {
            const missing = !positions.some(p => p.uid === a.positionUid);
            return (
              <tr key={a.uid}>
                <td className={cell}>
                  <GridSelect
                    value={missing ? '' : a.positionUid}
                    onChange={val => onChange(a.uid, { positionUid: val })}
                    options={positions.map(p => ({ value: p.uid, label: p.discipline || '(이름 없음)' }))}
                    ariaLabel={`${i + 1}번째 하중 줄 Discipline`}
                    placeholder="선택 안 함"
                    warn={missing}
                  />
                </td>
                <td className={cell}><GridText value={a.loadCondition} col="loadCondition" list="psa-load-conditions" onChange={val => onChange(a.uid, { loadCondition: val })} ariaLabel={`${i + 1}번째 Load condition`} placeholder="Sea-going Condition" /></td>
                <td className={cell} title={a.lines}><GridText value={a.lines} col="lines" onChange={val => onChange(a.uid, { lines: val })} ariaLabel={`${i + 1}번째 Lines`} placeholder="예: All Lines" /></td>
                {AXES.map(ax => (
                  <td key={ax.key} className={cell}><GridNumber value={a[ax.key]} col={`acc-${ax.key}`} onChange={val => onChange(a.uid, { [ax.key]: val })} ariaLabel={`${i + 1}번째 하중 ${ax.acc} (g)`} /></td>
                ))}
                <td className={`${GRID_LINE} px-1 text-center align-middle`}><RowIcon label={`${i + 1}번째 하중 줄 삭제`} onClick={() => onRemove(a.uid)} danger><Trash2 size={15} /></RowIcon></td>
              </tr>
            );
          })}
          {input.accelLoads.length === 0 && <EmptyRow colSpan={7}>하중 줄이 없습니다. [하중 줄 추가] 로 넣으세요.</EmptyRow>}
        </tbody>
      </GridTable>
      <AddRowButton onClick={onAdd}>하중 줄 추가</AddRowButton>
    </div>
  );
}

// ── 5. Manifold Load ─────────────────────────────────────────
const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const LOAD_COLS = [
  { key: 'fx', label: 'Fx', unit: 'N' },
  { key: 'fy', label: 'Fy', unit: 'N' },
  { key: 'fz', label: 'Fz', unit: 'N' },
  { key: 'mxz', label: 'Mxz', unit: 'Nm' },
  { key: 'my', label: 'My', unit: 'Nm' },
];

export function ManifoldTable({ input, onChange, onRemove, onAdd }) {
  const lineUids = new Set(input.lines.map(l => l.uid));
  const used = new Set(input.manifold.map(m => m.size).filter(Boolean));
  return (
    <div>
      <GridTable minWidth={860} caption="Manifold load">
        <colgroup>
          <col style={{ width: 150 }} />
          <col style={{ width: 150 }} />
          {LOAD_COLS.map(c => <col key={c.key} />)}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>System</th>
            <th className={th}>Pipe size</th>
            {LOAD_COLS.map(c => <th key={c.key} className={`${th} text-right`}>{c.label}<HeadUnit>({c.unit})</HeadUnit></th>)}
            <th className={th}><span className="sr-only">삭제</span></th>
          </tr>
        </thead>
        <tbody>
          {input.manifold.map((m, i) => {
            const loads = manifoldLoadsFor(m.size);
            const missingLine = !lineUids.has(m.lineUid);
            return (
              <tr key={m.uid}>
                <td className={cell}>
                  <GridSelect
                    value={missingLine ? '' : m.lineUid}
                    onChange={val => onChange(m.uid, { lineUid: val })}
                    options={input.lines.map(l => ({ value: l.uid, label: l.lineNo || '(번호 없음)' }))}
                    ariaLabel={`${i + 1}번째 Manifold System`}
                    placeholder="선택 안 함"
                    warn={missingLine}
                  />
                </td>
                <td className={cell}>
                  <GridSelect
                    value={m.size}
                    onChange={val => onChange(m.uid, { size: val })}
                    options={MANIFOLD_SIZES.map(s => ({ value: s.size, label: manifoldSizeLabel(s.size) }))}
                    ariaLabel={`${i + 1}번째 Pipe size`}
                    placeholder="선택 안 함"
                    warn={!loads}
                  />
                </td>
                {LOAD_COLS.map(c => (
                  <td key={c.key} className={`${GRID_LINE} bg-slate-50 px-3 text-right align-middle text-sm tabular-nums ${loads ? 'text-slate-800' : 'text-slate-400'}`}>
                    {loads ? fmt(loads[c.key]) : '-'}
                  </td>
                ))}
                <td className={`${GRID_LINE} px-1 text-center align-middle`}><RowIcon label={`${i + 1}번째 Manifold 줄 삭제`} onClick={() => onRemove(m.uid)} danger><Trash2 size={15} /></RowIcon></td>
              </tr>
            );
          })}
          {input.manifold.length === 0 && <EmptyRow colSpan={8}>System 이 없습니다. [System 추가] 로 넣으세요.</EmptyRow>}
        </tbody>
      </GridTable>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddRowButton onClick={onAdd}>System 추가</AddRowButton>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-600">
          <Lock size={12} aria-hidden="true" /> 회색 칸은 Pipe size 로 정해지는 표준 허용 하중입니다(고칠 수 없음). Fx = Lateral, Fy = Axial, Fz = Vertical, My = Mt(torque).
        </p>
      </div>

      <details className="mt-5 rounded-lg border border-slate-300 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">표준 허용 하중표 보기 (Allowable loads for manifold support, Table 4.5)</summary>
        <div className="border-t border-slate-200 p-4">
          <p className="mb-2 text-xs text-slate-600">Mx, Mz = Mxz/√2 는 보고서 표에 나가지 않고 계산값으로 함께 저장됩니다.</p>
          <GridTable minWidth={700} caption="Allowable loads for manifold support">
            <thead>
              <tr>
                {['Connection Dia. (mm)', 'Fx (N)', 'Fy ext (N)', 'Fz (N)', 'Mxz (Nm)', 'Mt (Nm)', 'Mx, Mz (Nm)'].map((h, idx) => (
                  <th key={h} className={`${th} ${idx ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MANIFOLD_SIZES.map(s => {
                const l = manifoldLoadsFor(s.size);
                const on = used.has(s.size);
                return (
                  <tr key={s.size} className={on ? 'bg-blue-50' : ''}>
                    <td className={`${GRID_LINE} px-3 py-2 text-sm font-semibold text-slate-800`}>
                      {s.size}{on && <span className="ml-2 text-[11px] font-bold text-blue-700">사용 중</span>}
                    </td>
                    {['fx', 'fy', 'fz', 'mxz', 'my', 'mx'].map(k => (
                      <td key={k} className={`${GRID_LINE} px-3 py-2 text-right text-sm tabular-nums text-slate-700`}>{fmt(l[k])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </GridTable>
        </div>
      </details>
    </div>
  );
}
