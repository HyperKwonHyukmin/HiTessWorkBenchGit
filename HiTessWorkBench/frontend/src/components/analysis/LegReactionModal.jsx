import React, { useEffect, useMemo, useState } from 'react';
import { X, Maximize2, Minimize2, AlertTriangle, CheckCircle2, MousePointerClick } from 'lucide-react';
import FeModelViewer from './FeModelViewer';
import { getJungbanViewerModel } from '../../api/analysis';
import { RAMP } from '../../utils/stressColorMap';
import {
  buildLegReactionModel, buildLegBeamColors, buildReactionArrows,
  legIndexFromNodeIndex, legTopIndex, legBottomIndex, kN, kNm,
  DEFAULT_COLUMN_HEIGHT_MM,
} from '../../utils/legReactionModel';

/**
 * Leg 반력 결과 모달.
 *
 * 해석은 정반 실형상 + Module Unit 합본으로 풀지만, 여기서는 반력이 나온 자리만 뽑아
 * **개요도**로 그린다(합본 전체를 띄우면 정작 보려는 것이 묻힌다).
 * 기둥은 정반 Leg 자리에서 Module Unit 을 받는 높이까지의 실물이고, CoG 에서 뻗는 선은
 * 하중 쏠림을 읽으라고 그은 표시선이다. 표의 숫자만으로는 어느 Leg 가 어디인지 알 수 없어
 * **Leg 를 찍으면 그 자리의 반력**을 띄운다.
 *
 * 정반 실형상은 방향을 잡기 위한 배경으로만 겹친다(해석에는 들어가지 않았다).
 */

const css = (rgb) => `rgb(${rgb.map(v => Math.round(v)).join(',')})`;

export default function LegReactionModal({ open, onClose, legReaction }) {
  const [maximized, setMaximized] = useState(false);
  const [selected, setSelected] = useState(null);      // Leg 순번(0-based)
  const [showArrows, setShowArrows] = useState(true);
  const [showDeck, setShowDeck] = useState(true);
  const [deck, setDeck] = useState(null);

  const legs = legReaction?.legs || [];
  const cogMm = legReaction?.cogMm;
  // 기둥 높이는 Leg 마다 다를 수 있어 그리기는 각 Leg 의 zTopMm 이 맡는다.
  // 여기 값은 화살표 길이·카메라 반경 같은 "크기 감각"용 대표값이다.
  const columnHeightMm = legReaction?.legColumnHeightsMm?.[0] ?? DEFAULT_COLUMN_HEIGHT_MM;
  const check = legReaction?.check;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 정반 실형상은 방향 판독용 배경이다 — 없으면 그냥 안 그린다(해석과 무관).
  useEffect(() => {
    if (!open || deck || !legReaction?.deckType) return undefined;
    let cancelled = false;
    getJungbanViewerModel(legReaction.deckType)
      .then(res => { if (!cancelled) setDeck(res.data); })
      .catch(() => { /* 배경일 뿐이라 실패해도 결과 판독에 지장이 없다 */ });
    return () => { cancelled = true; };
  }, [open, deck, legReaction?.deckType]);

  const model = useMemo(
    () => buildLegReactionModel(legs, cogMm, columnHeightMm),
    [legs, cogMm, columnHeightMm],
  );

  const beamColors = useMemo(
    () => buildLegBeamColors(legs, { selectedIndex: selected }),
    [legs, selected],
  );

  // 반력 벡터 — 크기를 눈으로 비교할 수 있게 화살표(선분)로 얹는다.
  const arrowModel = useMemo(() => {
    if (!showArrows || !legs.length) return null;
    const arrows = buildReactionArrows(legs, columnHeightMm);
    const positions = [];
    const beams = [];
    arrows.forEach((a, i) => {
      positions.push(...a.from, ...a.to);
      beams.push(i * 2, i * 2 + 1);
    });
    return {
      name: '반력 벡터', positions, beams, rigids: [], quads: [], trias: [],
      nodeCount: positions.length / 3, beamCount: arrows.length,
      quadCount: 0, triaCount: 0, rigidCount: 0,
      bounds: model?.bounds,
    };
  }, [showArrows, legs, columnHeightMm, model]);

  const parts = useMemo(() => {
    const out = [];
    if (deck && showDeck) {
      out.push({ id: 'deck', name: '정반 (배경)', model: deck, color: '#475569', opacity: 0.22, colorKey: 'deck' });
    }
    if (model) {
      out.push({
        id: 'legs', name: 'Leg 반력 개요도', model, color: '#8aa0b8', beamColors,
        colorKey: `legs:${selected ?? ''}`,
      });
    }
    if (arrowModel) {
      out.push({ id: 'arrows', name: '반력 벡터', model: arrowModel, color: '#f472b6', colorKey: 'arrows' });
    }
    return out;
  }, [deck, showDeck, model, beamColors, selected, arrowModel]);

  // 찍기 — 기둥 상단·하단 어느 쪽을 찍어도 같은 Leg 로 친다. 한 번에 하나만 고른다.
  const pick = useMemo(() => {
    if (!model) return null;
    const current = new Set();
    if (selected != null) {
      current.add(legTopIndex(selected));
      current.add(legBottomIndex(selected));
    }
    return {
      partId: 'legs',
      selected: current,
      onChange: (next) => {
        const added = [...next].filter(i => !current.has(i));
        if (!added.length) { setSelected(null); return; }
        const leg = legIndexFromNodeIndex(added[added.length - 1]);
        setSelected(leg != null && leg < legs.length ? leg : null);
      },
    };
  }, [model, selected, legs.length]);

  const markers = useMemo(() => {
    if (!model) return [];
    const out = legs.map((leg, i) => ({
      x: leg.x, y: leg.y, z: leg.z ?? 0,
      color: i === selected ? '#ffffff' : '#38bdf8',
      size: i === selected ? 16 : 11,
    }));
    if (cogMm) out.push({ x: cogMm[0], y: cogMm[1], z: cogMm[2], color: '#facc15', size: 14 });
    return out;
  }, [model, legs, selected, cogMm]);

  const focusTarget = useMemo(() => {
    if (selected == null || !legs[selected]) return null;
    const leg = legs[selected];
    return { x: leg.x, y: leg.y, z: leg.z ?? 0, radius: columnHeightMm };
  }, [selected, legs, columnHeightMm]);

  if (!open) return null;

  const chosen = selected != null ? legs[selected] : null;
  const maxResultant = Math.max(...legs.map(l => Math.abs(l.resultantN)), 1);

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm
                     ${maximized ? 'p-0' : 'p-4'}`}>
      <div className={`flex flex-col bg-white shadow-2xl overflow-hidden
                       ${maximized ? 'w-full h-full rounded-none' : 'w-full max-w-[1400px] h-[88vh] rounded-2xl'}`}>
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">정반 Leg 반력</h3>
            <p className="text-[11px] text-slate-500 truncate">
정반 Leg 절점의 실제 SPC 반력입니다(개요도) · Leg 를 클릭하면 그 자리의 반력을 봅니다
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setMaximized(v => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              title={maximized ? '창 크기로' : '전체 화면'}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              title="닫기 (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 요약 띠 */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
          <Stat label="Leg" value={`${legs.length}개`} />
          <Stat label="최대 합력" value={`${kN(maxResultant)} kN`} strong />
          <Stat label="합산 중량" value={`${(legReaction?.totalMassT ?? 0).toFixed(2)} t`} />
          {legReaction?.accelG && (
            <Stat
              label="가속도"
              value={`(${legReaction.accelG.ax}, ${legReaction.accelG.ay}, ${legReaction.accelG.az}) g`}
            />
          )}
          {check && (
            <span
              title={check.ok ? undefined
                : 'Σ반력 = 합산 중량 × 가속도 가 맞지 않습니다. 화면 합산 중량은 BDF 의 '
                  + '단면·두께·밀도와 CONM2 로 계산한 값이라, 모델에 비구조질량(NSM)이나 '
                  + 'CONM2 질량중심 오프셋이 있으면 해석이 실제로 실은 질량과 다릅니다.'}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg
                              ${check.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700 cursor-help'}`}>
              {check.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              평형 검산 {check.ok ? '통과' : '실패'} (상대오차 {check.maxRelError.toExponential(1)})
            </span>
          )}
          <div className="ml-auto flex items-center gap-4">
            <Toggle checked={showArrows} onChange={setShowArrows} label="반력 벡터" accent="accent-pink-500" />
            <Toggle checked={showDeck} onChange={setShowDeck} label="정반 겹쳐 보기" accent="accent-slate-500" />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 relative">
            <FeModelViewer
              parts={parts}
              pick={pick}
              markers={markers}
              focusTarget={focusTarget}
              initialShowRigids
              error={model ? null
                : (legs.length && !cogMm
                  ? '이 결과는 Leg 모델 보기 지원 이전 버전입니다 — 해석을 다시 수행하면 모델이 표시됩니다.'
                  : 'Leg 반력 결과가 없습니다.')}
            />
            {model && (
              <div className="absolute left-3 bottom-3 flex flex-col gap-1 rounded-lg bg-slate-900/85 px-2.5 py-2
                              text-[10px] text-slate-200 pointer-events-none">
                <span className="flex items-center gap-1.5"><Dot color="#38bdf8" /> Leg (기둥 하단 = 구속점·용접부)</span>
                <span className="flex items-center gap-1.5"><Dot color="#facc15" /> 합산 무게중심</span>
                {showArrows && <span className="flex items-center gap-1.5"><Dot color="#f472b6" /> 반력 벡터(최대 기준 정규화)</span>}
                <span className="flex items-center gap-1.5 text-slate-400 mt-0.5">
                  <MousePointerClick size={11} /> Leg 를 클릭하면 반력이 표시됩니다
                </span>
              </div>
            )}
          </div>

          <div className="w-80 shrink-0 border-l border-slate-200 flex flex-col min-h-0">
            {/* 선택한 Leg 상세 */}
            <div className="p-3 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">선택한 Leg</p>
              {chosen ? (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-slate-800">Leg {chosen.index}</span>
                    <span className="text-[11px] font-mono text-slate-500">절점 {chosen.jungbanNodeId}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Detail label="위치 X" value={`${chosen.x.toLocaleString()} mm`} />
                    <Detail label="위치 Y" value={`${chosen.y.toLocaleString()} mm`} />
                    <Detail label="FX" value={`${kN(chosen.fxN)} kN`} />
                    <Detail label="FY" value={`${kN(chosen.fyN)} kN`} />
                    <Detail label="FZ" value={`${kN(chosen.fzN)} kN`} />
                    <Detail label="합력 |R|" value={`${kN(chosen.resultantN)} kN`} strong />
                  </div>
                  {/* ⚠ 반력 모멘트는 N·mm 다. kN·m 로 보이려면 1e6 으로 나눠야 한다 —
                      kN() 은 1e3 이라 그대로 쓰면 라벨과 값이 1,000배 어긋난다. */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                    <Detail label="MX" value={`${kNm(chosen.mxNmm)} kN·m`} />
                    <Detail label="MY" value={`${kNm(chosen.myNmm)} kN·m`} />
                    <Detail label="MZ" value={`${kNm(chosen.mzNmm)} kN·m`} />
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-400">
                    전체 최대 대비 {((Math.abs(chosen.resultantN) / maxResultant) * 100).toFixed(0)}%.
                    이 값이 <b>과정 2 · 용접부 강도 평가</b>의 입력이 됩니다.
                  </p>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    선택 해제
                  </button>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  3D 화면에서 Leg 를 클릭하거나 아래 표의 행을 누르세요.
                  기둥 상단·하단 어느 쪽을 찍어도 같은 Leg 로 잡힙니다.
                </p>
              )}
            </div>

            {/* 범례 */}
            <div className="px-3 py-2 border-b border-slate-100">
              <div
                className="h-2.5 rounded-full"
                style={{ background: `linear-gradient(to right, ${RAMP.map(([t, c]) => `${css(c)} ${t * 100}%`).join(', ')})` }}
              />
              <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
                <span>0</span><span>{kN(maxResultant)} kN (최대)</span>
              </div>
            </div>

            {/* 전체 표 */}
            <div className="flex-1 min-h-0 overflow-auto p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">전체 Leg</p>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold py-1">Leg</th>
                    <th className="text-right font-semibold py-1">FZ</th>
                    <th className="text-right font-semibold py-1">|R| kN</th>
                    <th className="text-right font-semibold py-1">비율</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {legs.map((leg, i) => (
                    <tr
                      key={leg.index}
                      onClick={() => setSelected(prev => (prev === i ? null : i))}
                      className={`border-b border-slate-50 cursor-pointer transition-colors
                                  ${selected === i ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
                    >
                      <td className={`py-0.5 ${selected === i ? 'text-white' : 'text-slate-600'}`}>{leg.index}</td>
                      <td className={`py-0.5 text-right ${selected === i ? 'text-white' : 'text-slate-700'}`}>
                        {kN(leg.fzN)}
                      </td>
                      <td className={`py-0.5 text-right font-bold ${selected === i ? 'text-white' : 'text-slate-800'}`}>
                        {kN(leg.resultantN)}
                      </td>
                      <td className={`py-0.5 text-right ${selected === i ? 'text-white' : 'text-slate-400'}`}>
                        {((Math.abs(leg.resultantN) / maxResultant) * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className={`text-[11px] font-mono font-bold ${strong ? 'text-blue-600' : 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-400 truncate">{label}</p>
      <p className={`text-[11px] font-mono truncate ${strong ? 'font-bold text-blue-600' : 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

function Toggle({ checked, onChange, label, accent }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`${accent} cursor-pointer`}
      />
      {label}
    </label>
  );
}

function Dot({ color }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}
