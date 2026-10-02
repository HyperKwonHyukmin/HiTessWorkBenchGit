/**
 * @fileoverview BDF 입력 검증 결과 뷰어
 *
 * 공통 틀(runFrame) 문법을 따른다 — 판정 문구는 페이지의 VerdictHeader 가 맡고, 여기는 근거만 보여 준다.
 *  1) 핵심 수치 행(KeyFigures) — 카드 수·경고·오류
 *  2) 카드 분류 표 — 종류별 개수·경고·오류·세부 구성
 *  3) 검출 이슈 분포(있을 때만)
 *  4) 좌표 범위
 *  5) 행 단위 검증 상세(필터 + 접이식 표)
 * BdfScanner · GMU 권상 · Side Passage · 해상 운송이 함께 쓴다.
 */
import React, { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight,
  AlertOctagon, History, Move3d, Wrench as WrenchIcon,
} from 'lucide-react';
import KeyFigures from './runFrame/KeyFigures';

/* ── 카드 종류 라벨 ─────────────────────────────────────────── */
const CARD_KIND_LABEL = {
  grid:      'Grid (절점)',
  element:   'Element (요소)',
  property:  'Property (물성)',
  material:  'Material (재질)',
  pointMass: 'Point Mass',
  load:      'Load (하중)',
  boundaryCondition: 'Boundary',
};

/* ── 카드 분류 표 — 종류마다 한 행. 0 인 경고·오류 칸은 비워 눈이 문제 행에만 가게 한다. ── */
function CardKindTable({ rows }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr className="border-b border-slate-200">
            <th className="px-3 py-2 text-left font-semibold">카드 종류</th>
            <th className="px-3 py-2 text-right font-semibold">개수</th>
            <th className="px-3 py-2 text-right font-semibold">경고</th>
            <th className="px-3 py-2 text-right font-semibold">오류</th>
            <th className="px-3 py-2 text-left font-semibold">구성</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={r.key}>
              <td className="px-3 py-2 font-semibold text-slate-800">{r.label}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{r.count.toLocaleString()}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${r.warn ? 'font-bold text-amber-700' : 'text-slate-500'}`}>{r.warn ? r.warn.toLocaleString() : '—'}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${r.error ? 'font-bold text-red-700' : 'text-slate-500'}`}>{r.error ? r.error.toLocaleString() : '—'}</td>
              <td className="px-3 py-2">
                {r.breakdown && Object.keys(r.breakdown).length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(r.breakdown).map(([k, v]) => (
                      <span key={k} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                        {k} <strong className="text-slate-800">{Number(v).toLocaleString()}</strong>
                      </span>
                    ))}
                  </span>
                ) : <span className="text-xs text-slate-500">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── IssueBar — 이슈별 건수 막대 ─────────────────────────────── */
function IssueBar({ label, count, maxCount, severity = 'warning' }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const colorMap = {
    warning: { track: 'bg-amber-50', bar: 'bg-amber-400', text: 'text-amber-800' },
    error:   { track: 'bg-red-50',   bar: 'bg-red-500',   text: 'text-red-700' },
  };
  const c = colorMap[severity] || colorMap.warning;
  return (
    <div className="flex items-center gap-3">
      <span className="w-72 shrink-0 truncate text-sm text-slate-700" title={label}>{label}</span>
      <div className={`h-2 flex-1 overflow-hidden rounded-full ${c.track}`}>
        <div className={`bar-grow-x h-full rounded-full ${c.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-14 shrink-0 text-right font-mono text-sm font-bold ${c.text}`}>{count.toLocaleString()}</span>
    </div>
  );
}

/* ── FilterPills ─────────────────────────────────────────────── */
function FilterPills({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors
            ${value === o.v ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── F06 메시지 (Step 2) ─────────────────────────────────────── */

function extractUserAction(context) {
  if (!context) return null;
  const idx = context.toUpperCase().indexOf('USER ACTION:');
  if (idx === -1) return null;
  return context.slice(idx + 'USER ACTION:'.length).trim().replace(/^\s+/gm, '').trim();
}

function F06Message({ msg }) {
  const [open, setOpen] = useState(false);
  const isFatal     = msg.level === 'fatal';
  const isCopyright = msg.lineNumber <= 10;
  const userAction  = extractUserAction(msg.context);
  const defaultCollapsed = isCopyright;

  return (
    <div className={`border rounded-xl overflow-hidden mb-2 ${
      isFatal ? 'border-red-200' : isCopyright ? 'border-slate-200' : 'border-amber-200'
    }`}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left cursor-pointer transition-colors ${
          isFatal ? 'bg-red-50 hover:bg-red-100'
          : isCopyright ? 'bg-slate-50 hover:bg-slate-100'
          : 'bg-amber-50 hover:bg-amber-100'
        }`}
      >
        {(open || !defaultCollapsed)
          ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-500" />
          : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-500" />}
        {isFatal
          ? <AlertOctagon size={14} className="mt-0.5 shrink-0 text-red-500" />
          : <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${isCopyright ? 'text-slate-500' : 'text-amber-500'}`} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold font-mono ${
              isFatal ? 'text-red-700' : isCopyright ? 'text-slate-500' : 'text-amber-700'
            }`}>
              {isFatal ? 'FATAL' : 'WARNING'} — Line {msg.lineNumber}
            </span>
            {isCopyright && <span className="text-[11px] text-slate-500 font-mono">(저작권 고지)</span>}
          </div>
          <p className={`text-xs font-mono mt-0.5 break-all ${
            isFatal ? 'text-red-800' : isCopyright ? 'text-slate-500' : 'text-amber-800'
          }`}>
            {msg.message}
          </p>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-200 bg-slate-50">
          {msg.context && (
            <pre className="text-xs font-mono text-slate-600 px-5 py-3 leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
              {msg.context}
            </pre>
          )}
          {userAction && (
            <div className="mx-4 mb-3 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <WrenchIcon size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-700 mb-1">USER ACTION (권장 조치)</p>
                <p className="text-xs font-mono text-amber-800 leading-relaxed">{userAction}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Step 1 — BDF 입력 검증 (CSV 입력 검증 형식)
   ──────────────────────────────────────────────────────────── */

function Step1View({ step1Data }) {
  const [showRows,     setShowRows]     = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter,   setKindFilter]   = useState('all');

  const ps      = step1Data?.parsingSummary || {};
  const summary = step1Data?.summary || {};
  const counts  = ps.cardCounts || {};
  
  const totalCards = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);

  /* ── 검출 이슈 항목 추출 ───────────────────────────────────────
     README (NastranBridge) 의 정의 중:
       - orphan   : element/rigid/CONM2 어디에서도 참조 안 한 GRID (error)
       - isolated : connectivity 그래프 edge 0 (error)
       - free-end : (단순 degree 기반 카운트로 의사결정에 큰 영향 없음 — 표시 안 함) */
  const orphanCount   = ps.orphanNodes      ?? 0;
  const isolatedCnt   = ps.isolatedNodes    ?? 0;
  const disconnGroups = ps.disconnectedGroupCount ?? 0;

  const zeroLenCount  = (step1Data.validationResults || []).filter(v => v.cardType === 'ELEMENT' && v.severity === 'error').length;
  const shortLenCount = (step1Data.validationResults || []).filter(v => v.cardType === 'ELEMENT' && v.severity === 'warning').length;

  const issueItems = [];
  // 미참조·고립 GRID 는 엔진이 오류로 세지 않는다(summary.totalErrors 에 없음) — 판정 머리와 같은 기준으로 '경고'에 둔다.
  if (orphanCount   > 0) issueItems.push({ key: 'orphan',    label: '미참조 GRID — 요소·RBE·CONM2 어디에도 안 쓰임', count: orphanCount,   severity: 'warning' });
  if (isolatedCnt   > 0) issueItems.push({ key: 'isolated',  label: '고립 GRID — 연결된 요소 없음',                   count: isolatedCnt,   severity: 'warning' });
  if (zeroLenCount  > 0) issueItems.push({ key: 'zeroLen',   label: '길이 0 요소',                                                     count: zeroLenCount,  severity: 'error' });
  if (disconnGroups > 0) issueItems.push({ key: 'disconn',   label: `분리 그룹 — 주 구조 외 ${disconnGroups}개`,    count: disconnGroups, severity: 'warning' });
  if (shortLenCount > 0) issueItems.push({ key: 'shortLen',  label: '짧은 요소 — 수치 안정성 영향',                                    count: shortLenCount, severity: 'warning' });
  if ((ps.orphanProperties ?? 0) > 0) issueItems.push({ key: 'orphanProp', label: '미사용 Property', count: ps.orphanProperties, severity: 'warning' });
  if ((ps.orphanMaterials  ?? 0) > 0) issueItems.push({ key: 'orphanMat',  label: '미사용 Material', count: ps.orphanMaterials,  severity: 'warning' });

  const maxIssue = issueItems.length > 0 ? Math.max(...issueItems.map(i => i.count)) : 1;

  /* ── 검증 상세 행 필터 ─────────────────────────────────────── */
  const allRows = step1Data.validationResults || [];
  const filteredRows = allRows
    .filter(r => statusFilter === 'all' || r.severity === statusFilter)
    .filter(r => kindFilter   === 'all' || r.cardType  === kindFilter);

  // 카드 종류 필터 옵션 — 실제 데이터에 등장한 cardType 들
  const kindOptions = [
    { v: 'all', label: '전체' },
    ...Array.from(new Set(allRows.map(r => r.cardType))).filter(Boolean).map(t => ({ v: t, label: t })),
  ];

  const kindRows = [
    { key: 'grid',     count: counts.grid || 0,     warn: orphanCount + isolatedCnt },
    { key: 'element',  count: counts.element || 0,  warn: shortLenCount, error: zeroLenCount, breakdown: ps.elementBreakdown },
    { key: 'property', count: counts.property || 0, warn: ps.orphanProperties || 0, breakdown: ps.propertyBreakdown },
    { key: 'material', count: counts.material || 0, warn: ps.orphanMaterials || 0, breakdown: ps.materialBreakdown },
    { key: 'pointMass', count: counts.pointMass || 0 },
    { key: 'load', count: counts.load || 0, breakdown: ps.loadBreakdown },
    { key: 'boundaryCondition', count: counts.boundaryCondition || 0, breakdown: ps.bcBreakdown },
  ]
    // Grid~Material 은 0 이어도 보인다(빠졌다는 사실이 정보다). 나머지는 있을 때만.
    .filter(r => ['grid', 'element', 'property', 'material'].includes(r.key) || r.count > 0)
    .map(r => ({ ...r, label: CARD_KIND_LABEL[r.key] }));

  const warnTotal = summary.totalWarnings ?? 0;
  const errorTotal = summary.totalErrors ?? 0;

  return (
    <div className="w-full min-w-0 space-y-4">
      <KeyFigures
        items={[
          { key: 'cards', label: '전체 카드', value: totalCards.toLocaleString() },
          { key: 'grid', label: 'Grid', value: (counts.grid || 0).toLocaleString() },
          { key: 'element', label: 'Element', value: (counts.element || 0).toLocaleString() },
          { key: 'warn', label: '경고', value: warnTotal.toLocaleString(), tone: warnTotal > 0 ? 'warn' : 'default', sub: warnTotal > 0 ? '판정 미반영' : null },
          { key: 'error', label: '오류', value: errorTotal.toLocaleString(), tone: errorTotal > 0 ? 'bad' : 'default' },
        ]}
        caption={[
          step1Data.sourceFile && `원본 ${step1Data.sourceFile}`,
          (summary.parserWarnings ?? 0) > 0 && `파서 경고 ${summary.parserWarnings.toLocaleString()}건 — 읽지 못한 카드가 있습니다`,
        ].filter(Boolean).join(' · ') || null}
      />

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-slate-800">카드 분류</h3>
        <CardKindTable rows={kindRows} />
      </section>

      {issueItems.length > 0 && (
        <section className="space-y-2.5 rounded-lg border border-slate-200 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-800">
            검출 이슈 <span className="font-mono text-slate-600">{issueItems.reduce((s, i) => s + i.count, 0).toLocaleString()}건</span>
          </h3>
          {issueItems.map(it => (
            <IssueBar key={it.key} label={it.label} count={it.count} maxCount={maxIssue} severity={it.severity} />
          ))}
        </section>
      )}

      {ps.boundingBox && (
        <section className="rounded-lg border border-slate-200 px-4 py-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Move3d size={14} className="text-slate-600" aria-hidden="true" /> 좌표 범위
          </h3>
          <dl className="grid grid-cols-3 gap-3">
            {['x', 'y', 'z'].map(a => (
              <div key={a} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="font-mono text-xs font-bold text-slate-600">{a.toUpperCase()}</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {Number(ps.boundingBox[`${a}Min`]).toLocaleString()} ~ {Number(ps.boundingBox[`${a}Max`]).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          E. 검증 상세 (FilterPills + 접이식 테이블)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {allRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden w-full max-w-full min-w-0">
          <button
            type="button"
            aria-expanded={showRows}
            onClick={() => setShowRows(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">검증 상세</span>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {allRows.length.toLocaleString()}건
              </span>
              {!showRows && <span className="text-xs text-slate-600 ml-1">카드별 오류·경고 행</span>}
            </div>
            <ChevronDown size={14} className={`text-slate-500 transition-transform duration-200 ${showRows ? 'rotate-180' : ''}`} />
          </button>

          {showRows && (
            <>
              <div className="flex items-center gap-3 px-4 py-2.5 border-t border-b border-slate-100 bg-slate-50 flex-wrap">
                <FilterPills
                  label="종류" value={kindFilter} onChange={setKindFilter}
                  options={kindOptions}
                />
                <span className="text-slate-200">|</span>
                <FilterPills
                  label="심각도" value={statusFilter} onChange={setStatusFilter}
                  options={[
                    { v: 'all',     label: '전체' },
                    { v: 'error',   label: '오류' },
                    { v: 'warning', label: '경고' },
                  ]}
                />
                <span className="ml-auto text-xs font-mono text-slate-500">
                  {filteredRows.length.toLocaleString()} / {allRows.length.toLocaleString()}건
                </span>
              </div>

              <div className="max-h-96 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[120px]" />
                    <col className="w-[110px]" />
                    <col className="w-[80px]" />
                    <col />
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">카드 종류</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">ID</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">심각도</th>
                      <th className="px-3 py-2 text-left  font-semibold text-slate-500">메시지</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredRows.slice(0, 1000).map((r, i) => {
                      const rowBg = r.severity === 'error'   ? 'bg-red-50/60'
                                  : r.severity === 'warning' ? 'bg-amber-50/40' : '';
                      const badge = r.severity === 'error'   ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700';
                      return (
                        <tr key={i} className={`hover:bg-blue-50/30 transition-colors ${rowBg}`}>
                          <td className="px-3 py-1.5 text-slate-600 truncate" title={r.cardType}>{r.cardType}</td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500 truncate" title={r.cardId}>{r.cardId}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>
                              {(r.severity || '').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 truncate" title={r.message}>
                            {r.fieldName && <span className="text-slate-500 mr-1">({r.fieldName})</span>}
                            {r.message}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length > 1000 && (
                  <p className="text-center text-xs text-slate-500 py-3 italic border-t border-slate-100">
                    상위 1,000건만 표시 — 전체 {filteredRows.length.toLocaleString()}건
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

/* ──────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────── */

/** bare: 공통 틀의 단계 본문처럼 바깥에 이미 여백·흰 바탕이 있을 때 겉 여백을 뺀다. */
export default function ValidationStepLog({ step1Data, step2Data, useNastran, bare = false }) {
  const f06Messages = step2Data?.f06Summary?.messages || [];
  const fatals   = f06Messages.filter(m => m.level === 'fatal');
  const warnings = f06Messages.filter(m => m.level === 'warning');

  return (
    <div className={bare ? 'space-y-6' : 'bg-white p-5 space-y-6'}>
      {/* ── Step 1 — CSV 입력 검증 형식 ── */}
      {step1Data && <Step1View step1Data={step1Data} />}

      {/* ── Step 2 — F06 (Nastran 토글 ON 시) ── */}
      {useNastran && step2Data && (
        <div className="pt-5 border-t border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-800">Nastran F06 검증</h3>
              {step2Data.summary?.f06Fatals > 0
                ? <span className="text-xs font-bold px-2.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">FATAL</span>
                : step2Data.summary?.f06Warnings > 0
                ? <span className="text-xs font-bold px-2.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">WARNING</span>
                : <span className="text-xs font-bold px-2.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">PASS</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex flex-col items-center justify-center py-1">
              <span className={`text-3xl font-bold font-mono ${(step2Data.summary?.f06Fatals ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {step2Data.summary?.f06Fatals ?? 0}
              </span>
              <span className="text-xs text-slate-500 mt-1">F06 Fatal</span>
            </div>
            <div className="flex flex-col items-center justify-center py-1">
              <span className={`text-3xl font-bold font-mono ${(step2Data.summary?.f06Warnings ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {step2Data.summary?.f06Warnings ?? 0}
              </span>
              <span className="text-xs text-slate-500 mt-1">F06 Warning</span>
            </div>
          </div>

          {fatals.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-bold text-red-700 mb-2">Fatal 메시지 ({fatals.length}건)</p>
              {fatals.map((msg, i) => <F06Message key={i} msg={msg} />)}
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-700 mb-2">Warning 메시지 ({warnings.length}건)</p>
              {warnings.map((msg, i) => <F06Message key={i} msg={msg} />)}
            </div>
          )}

          {f06Messages.length === 0 && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              <span className="text-sm font-mono text-emerald-700 font-bold">Nastran F06 — Fatal / Warning 없음</span>
            </div>
          )}
        </div>
      )}

      {/* Step2 미실행 안내 */}
      {useNastran && !step2Data && step1Data && (
        <div className="pt-5 border-t border-slate-200">
          <div className="flex items-start gap-2.5 px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-slate-700 mb-0.5">Step 2: Nastran 해석 검토</p>
              <p className="text-xs font-mono text-slate-500">결과 파일을 로드 중이거나 아직 생성되지 않았습니다.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
