/**
 * SolveResultsPanel — Nastran 해석 결과의 요소별·절점별 값 표 (Drawing to Analysis 결과 화면 맨 아래).
 *
 * 2026-11-16 결과 화면 정리(사용자 지적 '가독성 떨어지고 불편, 응력이 먼저'):
 *   - 케이스 고르기와 3D 색(응력/변위) 전환은 위쪽 케이스 요약 표(SolveCaseSummary)로 옮겼다.
 *   - 늘 펼쳐 둔다(사용자 결정 — 접지 말 것). [요소 응력 | 절점 변위], 머리 클릭으로 정렬, 기본은 큰 값이 위, 최대 행에 '최대' 글자.
 *   - 요소 응력 행을 누르면 3D 가 그 요소로 간다(onFocusElement). 고른 행은 Trust Blue 바탕.
 *
 * 단위: 길이 = mm, 응력 = MPa(N/mm²). 표시값은 부모가 계산해 rows 로 전달.
 */
import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

const num = (v, d = 3) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: d });
};

const SortIcon = ({ col, sortCol, sortDir }) => {
  if (col !== sortCol) return <ChevronsUpDown size={11} className="text-slate-300 ml-0.5 inline" />;
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="text-[#002554] ml-0.5 inline" />
    : <ChevronDown size={11} className="text-[#002554] ml-0.5 inline" />;
};

/** 범용 정렬 — 원본 배열 불변 */
const sortRows = (rows, col, dir) => {
  if (!col) return rows;
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const an = Number(a[col]), bn = Number(b[col]);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * factor;
    return String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * factor;
  });
};

export default function SolveResultsPanel({
  field,                    // 'disp' | 'vm' — 처음 볼 탭
  caseLabel = '',           // 지금 보는 케이스 이름
  focusedElementId = null,  // 3D 에서 고른 요소(행 강조)
  onFocusElement,           // (elementId) => void
  dispRows = [],            // [{ pointId, t1, t2, t3, mag }]
  stressRows = [],          // [{ elementId, elementType, vonMises }]
}) {
  const [tab, setTab] = useState(field === 'disp' ? 'disp' : 'stress');
  React.useEffect(() => { setTab(field === 'disp' ? 'disp' : 'stress'); }, [field]);

  const [dispSort, setDispSort] = useState({ col: 'mag', dir: 'desc' });
  const [stressSort, setStressSort] = useState({ col: 'vonMises', dir: 'desc' });

  const sortedDispRows = useMemo(() => sortRows(dispRows, dispSort.col, dispSort.dir), [dispRows, dispSort]);
  const sortedStressRows = useMemo(() => sortRows(stressRows, stressSort.col, stressSort.dir), [stressRows, stressSort]);

  const maxDispId = useMemo(() => (dispRows.length
    ? dispRows.reduce((mx, r) => (Number(r.mag) > Number(mx.mag) ? r : mx)).pointId : null), [dispRows]);
  const maxStressId = useMemo(() => (stressRows.length
    ? stressRows.reduce((mx, r) => (Number(r.vonMises) > Number(mx.vonMises) ? r : mx)).elementId : null), [stressRows]);

  const sortBy = (setter, idCols) => (col) => setter((s) => (s.col === col
    ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: idCols.includes(col) ? 'asc' : 'desc' }));
  const onDispSort = sortBy(setDispSort, ['pointId']);
  const onStressSort = sortBy(setStressSort, ['elementId', 'elementType']);

  const ThSort = ({ col, sort, onSort, align = 'right', children }) => (
    <th
      scope="col"
      aria-sort={sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-1.5 font-semibold text-slate-600 sticky top-0 bg-slate-50 border-b border-slate-200 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button type="button" onClick={() => onSort(col)} className="inline-flex items-center gap-0.5 hover:text-slate-900">
        {children}
        <SortIcon col={col} sortCol={sort.col} sortDir={sort.dir} />
      </button>
    </th>
  );

  const TabBtn = ({ value, count, children }) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`px-3 h-9 text-[12px] font-semibold border-b-2 transition-colors ${
        tab === value ? 'border-[#002554] text-[#002554]' : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children} <span className="font-normal text-slate-500 tabular-nums">{count.toLocaleString()}</span>
    </button>
  );

  const td = 'px-3 py-1 tabular-nums text-slate-700 whitespace-nowrap';
  const maxTag = <span className="ml-1.5 text-[11px] font-semibold text-amber-800">최대</span>;

  return (
    <div className="flex flex-col h-full bg-white">
      <div role="tablist" aria-label="값 표" className="flex items-center px-2 border-b border-slate-200 shrink-0">
        <TabBtn value="stress" count={stressRows.length}>요소 응력</TabBtn>
        <TabBtn value="disp" count={dispRows.length}>절점 변위</TabBtn>
        <span className="ml-2 text-[12px] text-slate-500 truncate">{caseLabel}</span>
        <span className="ml-auto pr-2 text-[11px] text-slate-500 whitespace-nowrap">
          {tab === 'stress' ? '행을 누르면 3D 에서 그 요소로 갑니다' : '단위 mm'}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        {tab === 'stress' ? (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr>
                <ThSort col="elementId" sort={stressSort} onSort={onStressSort} align="left">요소</ThSort>
                <ThSort col="elementType" sort={stressSort} onSort={onStressSort} align="left">종류</ThSort>
                <ThSort col="vonMises" sort={stressSort} onSort={onStressSort}>von Mises (MPa)</ThSort>
              </tr>
            </thead>
            <tbody>
              {sortedStressRows.length === 0 ? (
                <tr><td className="px-3 py-4 text-center text-slate-500" colSpan={3}>응력 값이 없습니다. 쉘 요소 STRESS 출력이 없었을 수 있습니다.</td></tr>
              ) : sortedStressRows.map((r) => {
                const isMax = r.elementId === maxStressId;
                const on = focusedElementId != null && Number(r.elementId) === Number(focusedElementId);
                const strong = on || isMax;
                return (
                  <tr
                    key={r.elementId}
                    onClick={() => onFocusElement?.(r.elementId)}
                    aria-selected={on}
                    className={`border-b border-slate-100 cursor-pointer ${on ? 'bg-[#002554]/[0.08]' : isMax ? 'bg-amber-50 hover:bg-amber-100/70' : 'hover:bg-slate-50'}`}
                  >
                    <td className={`${td} text-left ${strong ? 'font-semibold text-slate-900' : ''}`}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onFocusElement?.(r.elementId); }}
                        className={`outline-none focus-visible:underline ${on ? 'text-[#002554]' : ''}`}
                      >
                        E{r.elementId}
                      </button>
                      {isMax && maxTag}
                    </td>
                    <td className={`${td} text-left text-slate-500`}>{r.elementType}</td>
                    <td className={`${td} text-right ${strong ? 'font-semibold text-slate-900' : ''}`}>
                      {r.vonMises == null ? '—' : Number(r.vonMises).toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr>
                <ThSort col="pointId" sort={dispSort} onSort={onDispSort} align="left">절점</ThSort>
                <ThSort col="t1" sort={dispSort} onSort={onDispSort}>X</ThSort>
                <ThSort col="t2" sort={dispSort} onSort={onDispSort}>Y</ThSort>
                <ThSort col="t3" sort={dispSort} onSort={onDispSort}>Z</ThSort>
                <ThSort col="mag" sort={dispSort} onSort={onDispSort}>합성 |U| (mm)</ThSort>
              </tr>
            </thead>
            <tbody>
              {sortedDispRows.length === 0 ? (
                <tr><td className="px-3 py-4 text-center text-slate-500" colSpan={5}>변위 값이 없습니다.</td></tr>
              ) : sortedDispRows.map((r) => {
                const isMax = r.pointId === maxDispId;
                return (
                  <tr key={r.pointId} className={`border-b border-slate-100 ${isMax ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                    <td className={`${td} text-left ${isMax ? 'font-semibold text-slate-900' : ''}`}>N{r.pointId}{isMax && maxTag}</td>
                    <td className={`${td} text-right`}>{num(r.t1)}</td>
                    <td className={`${td} text-right`}>{num(r.t2)}</td>
                    <td className={`${td} text-right`}>{num(r.t3)}</td>
                    <td className={`${td} text-right ${isMax ? 'font-semibold text-slate-900' : ''}`}>{num(r.mag)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
