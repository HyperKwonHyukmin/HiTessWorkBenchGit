/**
 * DrawingLoadBcPanel — 하중(FORCE) / 경계조건(SPC) 입력 패널.
 *
 * 컨셉:
 *   - 노드 선택은 3D 뷰어에서 드래그/클릭으로 수행 (selectionMode 로 제어).
 *   - "하중 추가"/"경계조건 추가" 를 누르면 선택 모드 진입 → 노드 선택 →
 *     값 입력 후 "추가" 로 세트 확정. 다중 세트 지원.
 *   - 하중: Fx/Fy/Fz (N). 경계조건: 6자유도 체크 (기본 전부 구속).
 *
 * 상태(selectionMode, 현재 선택 노드, loadSets/bcSets)는 부모(DrawingToAnalysis)가 소유.
 * 이 패널은 값 입력 로컬 상태(fx/fy/fz/dof)만 보유한다.
 */
import React, { useState } from 'react';
import {
  Anchor, MoveUpRight, Plus, X, MousePointerClick, Check, Ban, Spline, Layers, Share2,
} from 'lucide-react';

const DOF_LABELS = [
  { k: '1', label: 'TX' },
  { k: '2', label: 'TY' },
  { k: '3', label: 'TZ' },
  { k: '4', label: 'RX' },
  { k: '5', label: 'RY' },
  { k: '6', label: 'RZ' },
];

export default function DrawingLoadBcPanel({
  mode,                    // 'lug' | 'support' — Lug=Hole RBE2, Support=Area RBE3 노출
  selectionMode,           // 'none' | 'load' | 'bc' | 'rbe3'
  selectedNodeIds,         // 현재 선택 중인 노드 id 배열
  loadSets,                // [{ nodes, fx, fy, fz }]
  bcSets,                  // [{ nodes, dof }]
  holeRbe,                 // { center, ringNodeIds, fx, fy, fz } | null
  rbe3Sets,                // [{ refId, center, nodeIds }] — Area 하중분배(Block Support)
  loadCases,               // [{ name, bcIndices, loadIndices, includeRbe }]
  onStartSelection,        // (target:'load'|'bc'|'rbe3') => void
  onCancelSelection,       // () => void
  onCommitLoad,            // ({ nodes, fx, fy, fz }) => void
  onCommitBc,              // ({ nodes, dof }) => void
  onCommitRbe3,            // (nodeIds[]) => void
  onRemoveLoad,            // (index) => void
  onRemoveBc,              // (index) => void
  onRemoveRbe3,            // (index) => void
  onCreateHoleRbe,         // () => void
  onRemoveHoleRbe,         // () => void
  onAddLoadCase,           // () => void
  onRemoveLoadCase,        // (i) => void
  onRenameLoadCase,        // (i, name) => void
  onToggleLcBc,            // (i, bcIdx) => void
  onToggleLcLoad,          // (i, loadIdx) => void
  disabled,
}) {
  const [fx, setFx] = useState('0');
  const [fy, setFy] = useState('0');
  const [fz, setFz] = useState('0');
  const [dofSet, setDofSet] = useState(new Set(['1', '2', '3', '4', '5', '6']));

  const selCount = (selectedNodeIds || []).length;

  const resetInputs = () => {
    setFx('0'); setFy('0'); setFz('0');
    setDofSet(new Set(['1', '2', '3', '4', '5', '6']));
  };

  const toggleDof = (k) => {
    setDofSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const handleCommitLoad = () => {
    onCommitLoad?.({
      nodes: [...(selectedNodeIds || [])],
      fx: Number(fx) || 0,
      fy: Number(fy) || 0,
      fz: Number(fz) || 0,
    });
    resetInputs();
  };

  const handleCommitBc = () => {
    const dof = DOF_LABELS.map((d) => d.k).filter((k) => dofSet.has(k)).join('') || '123456';
    onCommitBc?.({ nodes: [...(selectedNodeIds || [])], dof });
    resetInputs();
  };

  const handleCommitRbe3 = () => {
    onCommitRbe3?.([...(selectedNodeIds || [])]);
    resetInputs();
  };

  const handleCancel = () => { resetInputs(); onCancelSelection?.(); };

  const numCls =
    'w-full text-xs font-mono px-2 py-1 rounded border border-slate-200 bg-white text-right ' +
    'focus:outline-none focus:ring-1 focus:ring-cyan-300 disabled:bg-slate-50';

  // 노드 목록 tooltip (길면 일부만)
  const nodeTip = (nodes) => {
    const arr = nodes || [];
    const head = arr.slice(0, 40).join(', ');
    return `노드 ${arr.length}개: ${head}${arr.length > 40 ? ' …' : ''}`;
  };

  // 단계 번호 배지
  const StepNum = ({ n, color }) => (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold text-white shrink-0 ${color}`}>
      {n}
    </span>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-gradient-to-r from-cyan-50 to-white border-b border-cyan-100 flex items-center gap-1.5">
        <MousePointerClick size={13} className="text-cyan-600" />
        <span className="text-[11px] font-bold text-slate-700">하중 / 경계조건</span>
        <span className="text-[10px] text-slate-400 ml-auto">3D 뷰어에서 노드 선택</span>
      </div>

      <div className="p-3 space-y-3">
        {/* 진행 순서 안내 */}
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <span className="font-bold text-slate-600">진행</span> ① 경계조건 → ② 하중 → ③ Load Case 조합 → 구조 해석 실행
        </p>

        {/* 조작 안내 — 노드 선택 모드일 때만 노출 */}
        {selectionMode !== 'none' && (
          <div className="rounded-lg bg-cyan-50 border border-cyan-200 px-2.5 py-1.5 text-[11px] text-slate-600 leading-relaxed">
            <span className="font-bold text-cyan-700">조작</span> — 왼쪽 버튼=<b>회전</b>, 영역 선택은{' '}
            <b className="text-cyan-700">Shift+드래그</b>, 단일 노드는 <b>클릭</b>. (우클릭=팬, 휠=줌)
          </div>
        )}

        {/* ───────── Lug Hole RBE (Lug 전용) — 경계조건·하중보다 먼저 ───────── */}
        {mode === 'lug' && (
          <>
            <section>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Spline size={12} className="text-pink-600" />
                <span className="text-[11px] font-bold text-slate-600">Lug Hole RBE <span className="text-slate-400 font-normal">(선택)</span></span>
                <span className="text-[10px] font-mono text-slate-400 ml-auto">{holeRbe ? '생성됨' : '없음'}</span>
              </div>

              {!holeRbe ? (
                <button
                  type="button"
                  onClick={() => onCreateHoleRbe?.()}
                  disabled={disabled || selectionMode !== 'none'}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-pink-200 bg-pink-50 hover:bg-pink-100 text-pink-700 text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={12} /> Lug Hole RBE 생성
                </button>
              ) : (
                <div className="rounded-xl border border-pink-200 bg-pink-50/60 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-pink-700">중심 독립노드 + ring 종속 (강체)</span>
                    <button onClick={() => onRemoveHoleRbe?.()} disabled={disabled}
                            className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-40">
                      <X size={13} />
                    </button>
                  </div>
                  <p className="text-[11px] font-mono text-slate-500">
                    ring {(holeRbe.ringNodeIds || []).length} nodes · 중심노드 <span className="font-bold text-pink-700">#{holeRbe.centerId}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    하중은 자동 적용되지 않습니다. 아래 <b className="text-cyan-700">② 하중</b> 영역에서 뷰어의
                    중심노드(<span className="font-mono">#{holeRbe.centerId}</span>, 마젠타 구)를 선택해 Force 를 주면
                    하중 조합(LC)에 넣을 수 있습니다.
                  </p>
                </div>
              )}
            </section>
            <div className="border-t border-slate-100" />
          </>
        )}

        {/* ───────── Area RBE3 (Block Support 전용) — 넓은 영역 총합 하중 분배 ───────── */}
        {mode === 'support' && (
          <>
            <section>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Share2 size={12} className="text-sky-600" />
                <span className="text-[11px] font-bold text-slate-600">하중 분배 RBE3 <span className="text-slate-400 font-normal">(선택)</span></span>
                <span className="text-[10px] font-mono text-slate-400 ml-auto">{(rbe3Sets || []).length} 세트</span>
              </div>

              {/* 기존 RBE3 세트 */}
              {(rbe3Sets || []).length > 0 && (
                <div className="space-y-1 mb-1.5">
                  {(rbe3Sets || []).map((r, i) => (
                    <div key={i} title={nodeTip(r.nodeIds)}
                         className="flex items-center gap-2 px-2 py-1 rounded-lg bg-sky-50 border border-sky-100 text-[11px] cursor-help">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                      <span className="text-slate-600 font-semibold">RBE3 #{i + 1}</span>
                      <span className="text-slate-400 font-mono">{(r.nodeIds || []).length} nodes</span>
                      <span className="text-sky-700 font-mono ml-auto">기준 #{r.refId}</span>
                      <button onClick={() => onRemoveRbe3?.(i)} disabled={disabled}
                              className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-40 shrink-0">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectionMode === 'rbe3' ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-700">선택된 영역 노드</span>
                    <span className="text-[11px] font-mono font-bold text-sky-700">{selCount}개</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    넓은 영역에 <b>총합 하중</b>을 줄 때 사용합니다. 영역을 묶으면 무게중심에
                    <b className="text-sky-700"> 기준노드</b>가 생기고, 아래 <b className="text-cyan-700">② 하중</b>에서
                    그 기준노드에 <b>총 Force</b>를 한 번만 주면 RBE3 가 영역으로 자동 분배합니다(강성 영향 없음).
                  </p>
                  <div className="flex gap-1.5">
                    <button onClick={handleCancel}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[11px] font-semibold hover:bg-slate-50">
                      <Ban size={11} /> 취소
                    </button>
                    <button onClick={handleCommitRbe3} disabled={selCount === 0}
                            className="flex-[2] flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                      <Check size={11} /> 이 영역으로 RBE3 생성
                    </button>
                  </div>
                  {selCount === 0 && (
                    <p className="text-[11px] text-amber-600 text-center">뷰어에서 하중을 분배할 영역을 선택하세요.</p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartSelection?.('rbe3')}
                  disabled={disabled || (selectionMode !== 'none' && selectionMode !== 'rbe3')}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={12} /> 하중 분배 영역 선택 (RBE3)
                </button>
              )}
            </section>
            <div className="border-t border-slate-100" />
          </>
        )}

        {/* ───────── ① 경계조건 ───────── */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <StepNum n="①" color="bg-emerald-500" />
            <Anchor size={12} className="text-emerald-600" />
            <span className="text-[11px] font-bold text-slate-600">경계조건 (구속)</span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto">{(bcSets || []).length} 세트</span>
          </div>

          {/* 기존 BC 세트 */}
          <div className="space-y-1 mb-1.5">
            {(bcSets || []).map((bc, i) => (
              <div key={i} title={nodeTip(bc.nodes)}
                   className="flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] cursor-help">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-slate-600 font-semibold">BC #{i + 1}</span>
                <span className="text-slate-400 font-mono">{bc.nodes.length} nodes</span>
                <span className="text-emerald-700 font-mono ml-auto">dof {bc.dof}</span>
                <button onClick={() => onRemoveBc?.(i)} disabled={disabled}
                        className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-40">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {selectionMode === 'bc' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-700">선택된 노드</span>
                <span className="text-[11px] font-mono font-bold text-emerald-700">{selCount}개</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {DOF_LABELS.map((d) => (
                  <button
                    key={d.k}
                    type="button"
                    onClick={() => toggleDof(d.k)}
                    className={`py-1 rounded text-[10px] font-bold font-mono border transition-colors ${
                      dofSet.has(d.k)
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleCancel}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[11px] font-semibold hover:bg-slate-50">
                  <Ban size={11} /> 취소
                </button>
                <button onClick={handleCommitBc} disabled={selCount === 0}
                        className="flex-[2] flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  <Check size={11} /> 경계조건 추가
                </button>
              </div>
              {selCount === 0 && (
                <p className="text-[11px] text-amber-600 text-center">뷰어에서 구속할 노드를 선택하세요.</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onStartSelection?.('bc')}
              disabled={disabled || (selectionMode !== 'none' && selectionMode !== 'bc')}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} /> 경계조건 추가
            </button>
          )}
        </section>

        <div className="border-t border-slate-100" />

        {/* ───────── ② 하중 ───────── */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <StepNum n="②" color="bg-cyan-500" />
            <MoveUpRight size={12} className="text-cyan-600" />
            <span className="text-[11px] font-bold text-slate-600">하중 (Force, N)</span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto">{(loadSets || []).length} 세트</span>
          </div>

          {/* 기존 Load 세트 */}
          <div className="space-y-1 mb-1.5">
            {(loadSets || []).map((ls, i) => (
              <div key={i} title={nodeTip(ls.nodes)}
                   className="flex items-center gap-2 px-2 py-1 rounded-lg bg-cyan-50 border border-cyan-100 text-[11px] cursor-help">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />
                <span className="text-slate-600 font-semibold">Load #{i + 1}</span>
                <span className="text-slate-400 font-mono">{ls.nodes.length} nodes</span>
                <span className="text-cyan-700 font-mono ml-auto truncate" title={`Fx ${ls.fx} / Fy ${ls.fy} / Fz ${ls.fz}`}>
                  ({ls.fx}, {ls.fy}, {ls.fz})
                </span>
                <button onClick={() => onRemoveLoad?.(i)} disabled={disabled}
                        className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-40 shrink-0">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {selectionMode === 'load' ? (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-700">선택된 노드</span>
                <span className="text-[11px] font-mono font-bold text-cyan-700">{selCount}개</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[['Fx', fx, setFx], ['Fy', fy, setFy], ['Fz', fz, setFz]].map(([lbl, val, set]) => (
                  <label key={lbl} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-mono text-slate-400 text-center">{lbl}</span>
                    <input
                      type="text" inputMode="decimal"
                      value={val}
                      onChange={(e) => {
                        const r = e.target.value;
                        if (r === '' || r === '-' || /^-?[0-9]*\.?[0-9]*$/.test(r)) set(r);
                      }}
                      className={numCls}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 text-center">선택 노드 각각에 동일한 힘 벡터를 적용합니다.</p>
              <div className="flex gap-1.5">
                <button onClick={handleCancel}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[11px] font-semibold hover:bg-slate-50">
                  <Ban size={11} /> 취소
                </button>
                <button onClick={handleCommitLoad}
                        disabled={selCount === 0 || (Number(fx) === 0 && Number(fy) === 0 && Number(fz) === 0)}
                        className="flex-[2] flex items-center justify-center gap-1 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  <Check size={11} /> 하중 추가
                </button>
              </div>
              {(selCount === 0 || (Number(fx) === 0 && Number(fy) === 0 && Number(fz) === 0)) && (
                <p className="text-[11px] text-amber-600 text-center">
                  {selCount === 0 ? '뷰어에서 하중을 줄 노드를 선택하세요.' : 'Fx / Fy / Fz 중 하나 이상 입력하세요.'}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onStartSelection?.('load')}
              disabled={disabled || (selectionMode !== 'none' && selectionMode !== 'load')}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={12} /> 하중 추가
            </button>
          )}
        </section>

        <div className="border-t border-slate-100" />

        {/* ───────── ③ Load Case (조합) ───────── */}
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <StepNum n="③" color="bg-indigo-500" />
            <Layers size={12} className="text-indigo-600" />
            <span className="text-[11px] font-bold text-slate-600">Load Case (SUBCASE)</span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto">{(loadCases || []).length} LC</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug mb-1.5">
            경계조건·하중을 조합해 해석 케이스를 만듭니다. LC 마다 SUBCASE 1개가 생성됩니다.
            LC 를 만들지 않으면 전체를 1개 케이스로 자동 처리합니다.
          </p>

          <div className="space-y-1.5 mb-1.5">
            {(loadCases || []).map((lc, i) => (
              <div key={i} className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-indigo-500 font-mono shrink-0">#{i + 1}</span>
                  <input
                    type="text"
                    value={lc.name}
                    onChange={(e) => onRenameLoadCase?.(i, e.target.value)}
                    placeholder={`LC${i + 1}`}
                    className="flex-1 min-w-0 text-[11px] font-semibold px-1.5 py-0.5 rounded border border-indigo-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  <button onClick={() => onRemoveLoadCase?.(i)} disabled={disabled}
                          className="text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-40 shrink-0">
                    <X size={13} />
                  </button>
                </div>

                {/* 경계조건 선택 칩 */}
                <div className="flex items-start gap-1.5">
                  <Anchor size={11} className="text-emerald-500 mt-1 shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {(bcSets || []).length === 0
                      ? <span className="text-[10px] text-slate-400">경계조건 없음</span>
                      : (bcSets || []).map((_, bi) => {
                          const on = lc.bcIndices.includes(bi);
                          return (
                            <button key={bi} type="button" onClick={() => onToggleLcBc?.(i, bi)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border transition-colors ${
                                on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-300'
                              }`}>BC{bi + 1}</button>
                          );
                        })}
                  </div>
                </div>

                {/* 하중 선택 칩 */}
                <div className="flex items-start gap-1.5">
                  <MoveUpRight size={11} className="text-cyan-500 mt-1 shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {(loadSets || []).map((_, li) => {
                      const on = lc.loadIndices.includes(li);
                      return (
                        <button key={li} type="button" onClick={() => onToggleLcLoad?.(i, li)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border transition-colors ${
                            on ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-400 border-slate-200 hover:border-cyan-300'
                          }`}>L{li + 1}</button>
                      );
                    })}
                    {(loadSets || []).length === 0 && (
                      <span className="text-[10px] text-slate-400">하중 없음</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onAddLoadCase?.()}
            disabled={disabled || (bcSets || []).length === 0}
            title={(bcSets || []).length === 0 ? '먼저 경계조건을 추가하세요.' : 'Load Case 추가'}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} /> Load Case 추가
          </button>
        </section>
      </div>
    </div>
  );
}
