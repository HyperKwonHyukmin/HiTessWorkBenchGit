/**
 * @fileoverview BDF 입력 검증 결과 뷰어
 *
 * HiTessModelBuilder 의 CSV 입력 검증 패널(CsvAuditPanel) 과 동일한 시각 형식을 사용한다.
 *  1) Hero 요약 (좌측 원형 게이지 + 우측 핵심 지표 3개)
 *  2) 카드 분류 (Grid / Element / Rigid / Property / Material 등 KindBar)
 *  3) 검출 이슈 분포 (free-end / isolated / multi-group … horizontal bar)
 *  4) 좌표 범위 / 미사용 항목 (보조 박스)
 *  5) 행 단위 검증 상세 (FilterPills + 접이식 테이블)
 *  6) 전체 판정 배너
 */
import React, { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight,
  AlertOctagon, History, AlertCircle, Move3d, Wrench as WrenchIcon,
} from 'lucide-react';

/* ── 카드 종류별 아이콘/라벨 ─────────────────────────────────── */
const CARD_KIND_META = {
  grid:      { icon: '⚙️', label: 'Grid (절점)' },
  element:   { icon: '🏗️', label: 'Element (요소)' },
  property:  { icon: '🧩', label: 'Property (물성)' },
  material:  { icon: '🔬', label: 'Material (재질)' },
  pointMass: { icon: '⚖️', label: 'Point Mass' },
  load:      { icon: '⚡', label: 'Load (하중)' },
  boundaryCondition: { icon: '⚓', label: 'Boundary' },
  subcase:   { icon: '🧪', label: 'Subcase' },
  param:     { icon: '🛠️', label: 'Param' },
};

/* ── KindBar — CsvAuditPanel 의 KindBar 와 시각적 동등 ───────── */
function KindBar({ label, icon, count, errorCount = 0, warnCount = 0, breakdown }) {
  const hasIssue = errorCount > 0 || warnCount > 0;
  const total = count + errorCount + warnCount;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none">{icon}</span>
          <span className="text-sm font-bold text-slate-700">{label}</span>
        </div>
        {count > 0
          ? <span className={`text-xs font-bold font-mono ${hasIssue ? 'text-amber-600' : 'text-emerald-600'}`}>
              {hasIssue ? '⚠' : '✓'}
            </span>
          : <span className="text-xs text-slate-300 italic">없음</span>
        }
      </div>

      {count > 0 && (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-800 font-mono leading-none">{count.toLocaleString()}</span>
            <span className="text-xs text-slate-400">개</span>
          </div>

          {/* 스택 막대 — 정상/경고/오류 */}
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-700 rounded-l-full"
              style={{ width: `${(count / Math.max(total, 1)) * 100}%` }}
            />
            {warnCount > 0 && (
              <div className="h-full bg-amber-400 transition-all duration-700"
                   style={{ width: `${(warnCount / Math.max(total, 1)) * 100}%` }} />
            )}
            {errorCount > 0 && (
              <div className="h-full bg-red-400 transition-all duration-700 rounded-r-full"
                   style={{ width: `${(errorCount / Math.max(total, 1)) * 100}%` }} />
            )}
          </div>

          {(warnCount > 0 || errorCount > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              {warnCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-700">
                  <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> 경고 {warnCount.toLocaleString()}
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> 오류 {errorCount.toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* 카드 종류 breakdown */}
          {breakdown && Object.keys(breakdown).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100">
              {Object.entries(breakdown).map(([k, v]) => (
                <span key={k} className="text-[10px] font-mono text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                  {k}: <strong className="text-slate-700">{v.toLocaleString()}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── IssueBar — IgnoreReasonRow 와 시각적 동등 ──────────────── */
function IssueBar({ label, count, maxCount, severity = 'warning' }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const colorMap = {
    warning: { track: 'bg-amber-50',   bar: 'bg-amber-400',   text: 'text-amber-700' },
    error:   { track: 'bg-red-50',     bar: 'bg-red-400',     text: 'text-red-700' },
  };
  const c = colorMap[severity] || colorMap.warning;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-700 w-56 shrink-0 truncate" title={label}>{label}</span>
      <div className={`flex-1 ${c.track} rounded-full h-2.5 overflow-hidden`}>
        <div className={`h-full ${c.bar} rounded-full transition-all duration-700`}
             style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-bold font-mono ${c.text} w-12 text-right shrink-0`}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

/* ── FilterPills ─────────────────────────────────────────────── */
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
          : <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${isCopyright ? 'text-slate-400' : 'text-amber-500'}`} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold font-mono ${
              isFatal ? 'text-red-700' : isCopyright ? 'text-slate-500' : 'text-amber-700'
            }`}>
              {isFatal ? 'FATAL' : 'WARNING'} — Line {msg.lineNumber}
            </span>
            {isCopyright && <span className="text-[10px] text-slate-400 font-mono">(저작권 고지)</span>}
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
  const isFailed = step1Data.status === 'error';

  // pass-rate: 검증 오류/경고가 0 이면 100%, 아니면 (전체 카드 - 결함 카드) / 전체 비율로 시각화
  const totalCards = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
  const issues = (summary.totalErrors || 0) + (summary.totalWarnings || 0);
  // 단순 시각화: 오류 0+경고 0 -> 100%, 그 외에는 issue/totalCards 비율을 반대로
  const passRate = totalCards > 0
    ? Math.max(0, Math.min(100, Math.round(100 - (issues / totalCards) * 100 * 5))) // 5x weighting
    : (issues === 0 ? 100 : 0);

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
  if (orphanCount   > 0) issueItems.push({ key: 'orphan',    label: '미참조 GRID (orphan — element/rigid/CONM2 어디에서도 참조 안 함)', count: orphanCount,   severity: 'error' });
  if (isolatedCnt   > 0) issueItems.push({ key: 'isolated',  label: '고립 GRID (connectivity 그래프 edge 0)',                          count: isolatedCnt,   severity: 'error' });
  if (zeroLenCount  > 0) issueItems.push({ key: 'zeroLen',   label: '길이 0 요소',                                                     count: zeroLenCount,  severity: 'error' });
  if (disconnGroups > 0) issueItems.push({ key: 'disconn',   label: `분리 그룹 (메인 외 추가 ${disconnGroups}개 — 단일 그룹 권장)`,    count: disconnGroups, severity: 'warning' });
  if (shortLenCount > 0) issueItems.push({ key: 'shortLen',  label: '짧은 요소 (수치 안정성 영향)',                                    count: shortLenCount, severity: 'warning' });
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

  return (
    <div className="space-y-4 w-full min-w-0">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          A. Hero 검증 요약 (CSV 형식)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className={`rounded-2xl border px-5 py-4 shadow-sm ${
        isFailed ? 'bg-red-50 border-red-200' : 'bg-gradient-to-br from-slate-50 to-white border-slate-200'
      }`}>
        <div className="flex items-start gap-5">
          {/* 좌측: 원형 게이지 */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#e2e8f0" strokeWidth="7" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={isFailed ? '#ef4444' : (summary.totalWarnings ?? 0) > 0 ? '#f59e0b' : '#10b981'}
                  strokeWidth="7"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - passRate / 100)}`}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-base font-bold font-mono leading-none ${isFailed ? 'text-red-600' : 'text-slate-800'}`}>
                  {passRate}%
                </span>
              </div>
            </div>
            <span className="text-xs text-slate-400 font-medium">건전도</span>
          </div>

          {/* 우측: 핵심 지표 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {isFailed
                ? <AlertCircle size={15} className="text-red-600 shrink-0" />
                : <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
              <span className={`text-sm font-bold ${isFailed ? 'text-red-700' : 'text-emerald-700'}`}>
                {isFailed ? 'BDF 검증 실패' : 'BDF 입력 검증 완료'}
              </span>
              {step1Data.sourceFile && (
                <span className="text-xs font-mono text-slate-400 ml-1 truncate">— {step1Data.sourceFile}</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold font-mono text-slate-800 leading-none">{totalCards.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-0.5">전체 카드</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold font-mono leading-none ${(summary.totalWarnings ?? 0) > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                  {(summary.totalWarnings ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">경고</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold font-mono leading-none ${(summary.totalErrors ?? 0) > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                  {(summary.totalErrors ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">오류</p>
              </div>
            </div>

            {(summary.parserWarnings ?? 0) > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-sky-600 font-semibold">
                <Info size={12} /> 파서 경고 {(summary.parserWarnings).toLocaleString()}건 — 미인식 카드 검토 필요
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          B. 카드 분류 (KindBar 5칼럼)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">카드 분류 — Bdf Card Counts</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KindBar
            label={CARD_KIND_META.grid.label} icon={CARD_KIND_META.grid.icon}
            count={counts.grid || 0}
            errorCount={orphanCount + isolatedCnt}
          />
          <KindBar
            label={CARD_KIND_META.element.label} icon={CARD_KIND_META.element.icon}
            count={counts.element || 0}
            warnCount={shortLenCount}
            errorCount={zeroLenCount}
            breakdown={ps.elementBreakdown}
          />
          <KindBar
            label={CARD_KIND_META.property.label} icon={CARD_KIND_META.property.icon}
            count={counts.property || 0}
            warnCount={ps.orphanProperties || 0}
            breakdown={ps.propertyBreakdown}
          />
          <KindBar
            label={CARD_KIND_META.material.label} icon={CARD_KIND_META.material.icon}
            count={counts.material || 0}
            warnCount={ps.orphanMaterials || 0}
            breakdown={ps.materialBreakdown}
          />
          {!!counts.pointMass && (
            <KindBar
              label={CARD_KIND_META.pointMass.label} icon={CARD_KIND_META.pointMass.icon}
              count={counts.pointMass || 0}
            />
          )}
          {!!counts.load && (
            <KindBar
              label={CARD_KIND_META.load.label} icon={CARD_KIND_META.load.icon}
              count={counts.load || 0}
              breakdown={ps.loadBreakdown}
            />
          )}
          {!!counts.boundaryCondition && (
            <KindBar
              label={CARD_KIND_META.boundaryCondition.label} icon={CARD_KIND_META.boundaryCondition.icon}
              count={counts.boundaryCondition || 0}
              breakdown={ps.bcBreakdown}
            />
          )}
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          C. 검출 이슈 분포 (있을 때만)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {issueItems.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl px-4 py-4 shadow-sm">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-3">
            검출 이슈 분포 — {issueItems.reduce((s, i) => s + i.count, 0).toLocaleString()}건
          </p>
          <div className="space-y-2.5">
            {issueItems.map(it => (
              <IssueBar
                key={it.key}
                label={it.label}
                count={it.count}
                maxCount={maxIssue}
                severity={it.severity}
              />
            ))}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          D. 좌표 범위 (보조 정보)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {ps.boundingBox && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Move3d size={11} /> 좌표 범위 (Bounding Box)
          </p>
          <div className="grid grid-cols-3 gap-3">
            {['x', 'y', 'z'].map(a => (
              <div key={a} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] font-bold text-sky-600 font-mono uppercase mb-0.5">{a}</p>
                <p className="text-xs text-slate-700 font-mono">
                  {Number(ps.boundingBox[`${a}Min`]).toLocaleString()} ~ {Number(ps.boundingBox[`${a}Max`]).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          E. 검증 상세 (FilterPills + 접이식 테이블)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {allRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm w-full max-w-full min-w-0">
          <button
            onClick={() => setShowRows(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">검증 상세</span>
              <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {allRows.length.toLocaleString()}건
              </span>
              {!showRows && <span className="text-[11px] text-slate-400 ml-1">— 클릭하여 자세히 보기</span>}
            </div>
            <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showRows ? 'rotate-180' : ''}`} />
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
                <span className="ml-auto text-xs font-mono text-slate-400">
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
                            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>
                              {(r.severity || '').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 truncate" title={r.message}>
                            {r.fieldName && <span className="text-slate-400 mr-1">({r.fieldName})</span>}
                            {r.message}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length > 1000 && (
                  <p className="text-center text-xs text-slate-400 py-3 italic border-t border-slate-100">
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

export default function ValidationStepLog({ step1Data, step2Data, useNastran }) {
  const f06Messages = step2Data?.f06Summary?.messages || [];
  const fatals   = f06Messages.filter(m => m.level === 'fatal');
  const warnings = f06Messages.filter(m => m.level === 'warning');

  return (
    <div className="bg-white p-5 space-y-6">
      {/* ── Step 1 — CSV 입력 검증 형식 ── */}
      {step1Data && <Step1View step1Data={step1Data} />}

      {/* ── Step 2 — F06 (Nastran 토글 ON 시) ── */}
      {useNastran && step2Data && (
        <div className="pt-5 border-t border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-purple-600 font-mono">Step 2 — Nastran F06 검증</span>
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
              <p className="text-xs font-bold text-red-700 uppercase tracking-widest mb-2">Fatal 메시지 ({fatals.length}건)</p>
              {fatals.map((msg, i) => <F06Message key={i} msg={msg} />)}
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">Warning 메시지 ({warnings.length}건)</p>
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
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
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
