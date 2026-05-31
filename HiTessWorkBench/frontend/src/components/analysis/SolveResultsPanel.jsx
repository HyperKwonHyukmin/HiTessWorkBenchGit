/**
 * SolveResultsPanel — Nastran 해석 결과(변위 + 쉘 응력) 컨트롤 + 테이블.
 *
 * - 상단 컨트롤: 컨투어 필드 토글(변위 |U| / 응력), SUBCASE 선택.
 *   필드 토글은 3D 뷰어 컨투어 색을 바꾼다(부모 state).
 * - 하단 테이블: 탭(노드 변위 / 요소 응력)으로 모든 값을 표로 표시.
 *   컬럼 헤더 클릭으로 정렬 가능(asc↔desc 토글).
 *
 * 단위: 길이=mm, 응력=MPa(N/mm²). 표시값은 부모가 계산해 rows 로 전달.
 */
import React, { useMemo, useState } from 'react';
import { Activity, Gauge, Table2, MoveUpRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

const num = (v, d = 3) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: d });
};

/** 정렬 방향 아이콘 */
const SortIcon = ({ col, sortCol, sortDir }) => {
  if (col !== sortCol) return <ChevronsUpDown size={10} className="text-slate-300 ml-0.5 inline" />;
  return sortDir === 'asc'
    ? <ChevronUp size={10} className="text-cyan-500 ml-0.5 inline" />
    : <ChevronDown size={10} className="text-cyan-500 ml-0.5 inline" />;
};

/** 범용 정렬 헬퍼 — 원본 배열 불변, 복사본 반환 */
const sortRows = (rows, col, dir) => {
  if (!col) return rows;
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    // 숫자 비교
    const an = Number(av), bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * factor;
    // 문자열 비교
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor;
  });
};

export default function SolveResultsPanel({
  field,            // 'disp' | 'vm'  (컨투어 필드)
  onField,          // (f) => void
  subcases = [],    // [{ subcaseId }]
  subcaseIdx = 0,
  onSubcase,        // (idx) => void
  dispRows = [],    // [{ pointId, t1, t2, t3, mag }]
  stressRows = [],  // [{ elementId, elementType, vonMises, vmZ1, vmZ2 }]
}) {
  const [tab, setTab] = useState(field === 'vm' ? 'stress' : 'disp');

  // 변위 탭 정렬 상태 — 기본: |U| 내림차순(가장 큰 변위가 위)
  const [dispSortCol, setDispSortCol] = useState('mag');
  const [dispSortDir, setDispSortDir] = useState('desc');

  // 응력 탭 정렬 상태 — 기본: vonMises 내림차순(가장 위험한 값이 위)
  const [stressSortCol, setStressSortCol] = useState('vonMises');
  const [stressSortDir, setStressSortDir] = useState('desc');

  // 필드 토글 시 테이블 탭도 따라가되, 사용자가 탭을 바꾸면 독립 유지
  const fieldSync = useMemo(() => field, [field]);
  React.useEffect(() => { setTab(fieldSync === 'vm' ? 'stress' : 'disp'); }, [fieldSync]);

  // 정렬된 행 (원본 배열 불변)
  const sortedDispRows = useMemo(() => sortRows(dispRows, dispSortCol, dispSortDir), [dispRows, dispSortCol, dispSortDir]);
  const sortedStressRows = useMemo(() => sortRows(stressRows, stressSortCol, stressSortDir), [stressRows, stressSortCol, stressSortDir]);

  // 최대값 행 ID 계산 (강조 표시용)
  const maxDispId = useMemo(() => {
    if (!dispRows.length) return null;
    return dispRows.reduce((mx, r) => (Number(r.mag) > Number(mx.mag) ? r : mx)).pointId;
  }, [dispRows]);
  const maxStressId = useMemo(() => {
    if (!stressRows.length) return null;
    return stressRows.reduce((mx, r) => (Number(r.vonMises) > Number(mx.vonMises) ? r : mx)).elementId;
  }, [stressRows]);

  /** 헤더 클릭 핸들러 */
  const handleDispSort = (col) => {
    if (dispSortCol === col) {
      setDispSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setDispSortCol(col);
      // ID/Type 은 오름차순 기본, 수치 컬럼은 내림차순 기본
      setDispSortDir(col === 'pointId' ? 'asc' : 'desc');
    }
  };
  const handleStressSort = (col) => {
    if (stressSortCol === col) {
      setStressSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setStressSortCol(col);
      setStressSortDir(col === 'elementId' || col === 'elementType' ? 'asc' : 'desc');
    }
  };

  const FieldBtn = ({ value, icon: Icon, children, tooltip }) => (
    <button
      type="button"
      onClick={() => onField?.(value)}
      title={tooltip}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
        field === value
          ? 'bg-cyan-600 text-white shadow'
          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      <Icon size={12} /> {children}
    </button>
  );

  const TabBtn = ({ value, count, children }) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold border-b-2 transition-colors ${
        tab === value
          ? 'border-cyan-500 text-cyan-700'
          : 'border-transparent text-slate-400 hover:text-slate-600'
      }`}
    >
      {children}
      <span className="px-1 rounded bg-slate-100 text-slate-500 font-mono text-[10px]">{count}</span>
    </button>
  );

  // 정렬 가능한 헤더 셀
  const ThSort = ({ col, sortCol, sortDir, onSort, align = 'right', title: tooltip, children }) => (
    <th
      className={`px-2 py-1.5 font-bold text-slate-500 sticky top-0 bg-slate-50 border-b border-slate-200 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(col)}
      title={tooltip}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
      </span>
    </th>
  );

  const td = 'px-2 py-1 font-mono text-slate-700 whitespace-nowrap';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 컨트롤 바 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50/60 shrink-0 flex-wrap gap-y-1.5">
        <Table2 size={13} className="text-slate-500 shrink-0" />
        <span className="text-[11px] font-bold text-slate-600">해석 결과</span>
        <span className="text-[10px] text-slate-400">컨투어</span>
        <div className="flex gap-1">
          <FieldBtn value="disp" icon={Activity} tooltip="절점 변위 크기(|U|) 컨투어">변위 |U|</FieldBtn>
          <FieldBtn value="vm" icon={Gauge} tooltip="쉘 요소 von Mises 응력 컨투어">응력</FieldBtn>
        </div>
        {subcases.length > 1 && (
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
            SUBCASE
            <select
              value={subcaseIdx}
              onChange={(e) => onSubcase?.(Number(e.target.value))}
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-cyan-300"
            >
              {subcases.map((sc, i) => (
                <option key={i} value={i}>#{sc.subcaseId ?? i + 1}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 px-2 border-b border-slate-200 shrink-0 bg-white">
        <TabBtn value="disp" count={dispRows.length}>노드 변위</TabBtn>
        <TabBtn value="stress" count={stressRows.length}>요소 응력</TabBtn>
        <span className="ml-auto pr-2 text-[10px] text-slate-400 flex items-center gap-1">
          <MoveUpRight size={10} /> 단위: mm · MPa
        </span>
      </div>

      {/* 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
        {tab === 'disp' ? (
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr>
                <ThSort col="pointId" sortCol={dispSortCol} sortDir={dispSortDir} onSort={handleDispSort} align="left" title="절점 ID로 정렬">
                  Node
                </ThSort>
                <ThSort col="t1" sortCol={dispSortCol} sortDir={dispSortDir} onSort={handleDispSort} title="T1(X) 변위 (mm)로 정렬">
                  T1 (X)
                </ThSort>
                <ThSort col="t2" sortCol={dispSortCol} sortDir={dispSortDir} onSort={handleDispSort} title="T2(Y) 변위 (mm)로 정렬">
                  T2 (Y)
                </ThSort>
                <ThSort col="t3" sortCol={dispSortCol} sortDir={dispSortDir} onSort={handleDispSort} title="T3(Z) 변위 (mm)로 정렬">
                  T3 (Z)
                </ThSort>
                <ThSort col="mag" sortCol={dispSortCol} sortDir={dispSortDir} onSort={handleDispSort} title="|U| 합성 변위 (mm)로 정렬 — 기본: 내림차순">
                  |U| (mm)
                </ThSort>
              </tr>
            </thead>
            <tbody>
              {sortedDispRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-center text-slate-400 text-[11px]" colSpan={5}>
                    변위 데이터가 없습니다.
                  </td>
                </tr>
              ) : sortedDispRows.map((r) => {
                const isMax = r.pointId === maxDispId;
                return (
                  <tr
                    key={r.pointId}
                    className={`even:bg-slate-50/60 hover:bg-cyan-50 transition-colors ${isMax ? 'bg-cyan-50/70' : ''}`}
                    title={`Node #${r.pointId} — |U| = ${num(r.mag)} mm`}
                  >
                    <td className={`${td} text-left text-cyan-700 ${isMax ? 'font-bold' : 'font-semibold'}`}>
                      {r.pointId}
                      {isMax && (
                        <span className="ml-1 text-[9px] text-cyan-500 font-bold uppercase tracking-wide">MAX</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{num(r.t1)}</td>
                    <td className={`${td} text-right`}>{num(r.t2)}</td>
                    <td className={`${td} text-right`}>{num(r.t3)}</td>
                    <td className={`${td} text-right ${isMax ? 'text-cyan-700 font-bold' : 'text-slate-800 font-semibold'}`}>
                      {num(r.mag)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr>
                <ThSort col="elementId" sortCol={stressSortCol} sortDir={stressSortDir} onSort={handleStressSort} align="left" title="요소 ID로 정렬">
                  Element
                </ThSort>
                <ThSort col="elementType" sortCol={stressSortCol} sortDir={stressSortDir} onSort={handleStressSort} align="left" title="요소 타입으로 정렬">
                  Type
                </ThSort>
                <ThSort col="vonMises" sortCol={stressSortCol} sortDir={stressSortDir} onSort={handleStressSort} title="von Mises 응력 (MPa)로 정렬 — 기본: 내림차순">
                  응력 (MPa)
                </ThSort>
              </tr>
            </thead>
            <tbody>
              {sortedStressRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-center text-slate-400 text-[11px]" colSpan={3}>
                    응력 데이터가 없습니다. (쉘 요소 STRESS 카드가 출력되지 않았을 수 있습니다.)
                  </td>
                </tr>
              ) : sortedStressRows.map((r) => {
                const isMax = r.elementId === maxStressId;
                return (
                  <tr
                    key={r.elementId}
                    className={`even:bg-slate-50/60 hover:bg-orange-50 transition-colors ${isMax ? 'bg-orange-50/70' : ''}`}
                    title={`Element #${r.elementId} (${r.elementType}) — 응력 = ${num(r.vonMises, 2)} MPa`}
                  >
                    <td className={`${td} text-left text-orange-600 ${isMax ? 'font-bold' : 'font-semibold'}`}>
                      {r.elementId}
                      {isMax && (
                        <span className="ml-1 text-[9px] text-orange-500 font-bold uppercase tracking-wide">MAX</span>
                      )}
                    </td>
                    <td className={`${td} text-left text-slate-500`}>{r.elementType}</td>
                    <td className={`${td} text-right ${isMax ? 'text-orange-700 font-bold' : 'text-slate-800 font-semibold'}`}>
                      {num(r.vonMises, 2)}
                    </td>
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
