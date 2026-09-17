import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Maximize2, Minimize2, Anchor } from 'lucide-react';
import FeModelViewer from './FeModelViewer';
import { downloadFileText, getModuleOceanViewerModel } from '../../api/analysis';
import {
  RAMP, OVER_COLOR, NO_DATA_COLOR, DIMMED_COLOR, HIGHLIGHT_COLOR,
  buildBeamColors, indexByElementId, elementMidpoint,
  buildNodalBeamColors, nodalDisplacementArrays, deformedPositions, autoDeformScale,
} from '../../utils/stressColorMap';
import { selectionPoints } from '../../utils/supportSelection';
import { transformModulePoint } from '../../utils/feGeometry';

/**
 * 요소 응력 색맵 모달 — "최대 응력 2215.7 MPa" 가 **모델 어디에서** 나온 값인지 보여 준다.
 *
 * 요약 카드의 숫자와 상위 20개 표만으로는 과응력 부재의 위치를 짚을 수 없다.
 * 색맵은 그 숫자를 형상 위에 되돌려 놓아, 국부 집중인지 전역 문제인지 한눈에 가른다.
 *
 * 데이터 두 갈래:
 *   · 요소별 응력 — 결과 JSON 파일의 elements[] (DB 에는 안 실린다. 열 때만 받는다)
 *   · 지오메트리  — 2단계 뷰어 슬림 모델. beams 선분과 beamIds 가 1:1 로 대응한다.
 * 둘을 elementId 로 이어 선분마다 색을 칠한다.
 */

const css = (rgb) => `rgb(${rgb.map(v => Math.round(v)).join(',')})`;

// 볼 수 있는 결과 종류. 응력은 요소 값, 변위는 절점 값이라 색 계산 경로가 다르다.
const VIEWS = [
  { id: 'stress', label: '응력 (사용률)', unit: 'MPa' },
  { id: 'dispMag', label: '변위 — 합성 |T|', unit: 'mm', key: 'mag' },
  { id: 'dispX',   label: '변위 — X (종방향)', unit: 'mm', key: 'tx' },
  { id: 'dispY',   label: '변위 — Y (횡방향)', unit: 'mm', key: 'ty' },
  { id: 'dispZ',   label: '변위 — Z (연직)',   unit: 'mm', key: 'tz' },
];
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0)
  : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

export default function StressColorMapModal({
  open, onClose, stress, modelJsonPath, moduleModel, supportIdx, placement,
}) {
  const [elements, setElements] = useState(null);
  const [dispNodes, setDispNodes] = useState(null);
  const [model, setModel]       = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [onlyExceed, setOnlyExceed] = useState(false);
  // 소구경 배관은 판정에서 뺀 요소다. 켜 두면 색맵·표에서 함께 감춘다 — 이들이
  // 응력 상위를 독차지해 정작 봐야 할 구조 부재가 표에서 밀려나기 때문이다.
  const [hideExcluded, setHideExcluded] = useState(true);
  const [maximized, setMaximized] = useState(false);
  // 표에서 고른 부재 — 색맵에서 흰색으로 짚고 카메라를 그리로 옮긴다.
  const [focusEid, setFocusEid] = useState(null);
  const [showSupports, setShowSupports] = useState(true);
  const [view, setView] = useState('stress');
  // 변형 배율. null 이면 '자동'(최대 변위가 모델 대각선의 5% 로 보이는 값).
  const [deformScale, setDeformScale] = useState(null);
  const [showUndeformed, setShowUndeformed] = useState(true);

  const allowable = stress?.allowableMPa || 0;
  const summary = stress?.summary;
  // 포락한 하중조건 수 — 1개면 예전과 똑같이 아무 표식도 붙이지 않는다.
  const loadCaseCount = stress?.loadCases?.length
    || Object.keys(stress?.perLoadCase || {}).length || 1;
  // 요약은 작업 레코드에 이미 실려 있어 모달을 열자마자 쓸 수 있다.
  const dispSummary = stress?.displacementSummary;

  // Esc 로 닫기 — 전체화면 오버레이라 닫는 길이 X 하나뿐이면 답답하다.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    (async () => {
      setBusy(true);
      setError(null);
      try {
        // ① 요소별 응력 — 결과 JSON 파일에만 있다(2천여 개라 작업 레코드에 싣지 않는다).
        if (!elements) {
          const res = await downloadFileText(stress.resultJson);
          // axios 는 responseType:'text' 여도 기본 transformResponse 가 JSON 을 파싱한다.
          // 서버/버전에 따라 문자열로 올 수도 있어 양쪽을 모두 받는다.
          const raw = res?.data;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (cancelled) return;
          if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) {
            throw new Error('결과 JSON 에 요소별 응력(elements)이 없습니다. '
              + '이 결과는 색맵 지원 이전 버전에서 만들어졌습니다 — 해석을 다시 수행하세요.');
          }
          setElements(parsed.elements);
          // 변위는 같은 파일 안에 있다 — 없으면 색맵 지원 이전 결과다(응력만 보여 준다).
          setDispNodes(parsed.displacement?.nodes || []);
        }

        // ② 지오메트리 — beamIds 가 있어야 선분과 요소를 이을 수 있다.
        //    2단계에서 받아 둔 모델이 구 스키마면 여기서 다시 받는다.
        if (!model) {
          if (moduleModel?.beamIds?.length) {
            setModel(moduleModel);
          } else if (modelJsonPath) {
            const res = await getModuleOceanViewerModel(modelJsonPath, 'Module Unit');
            if (cancelled) return;
            if (!res.data?.beamIds?.length) {
              throw new Error('모델 페이로드에 요소 ID(beamIds)가 없습니다. 백엔드를 최신 코드로 재시작하세요.');
            }
            setModel(res.data);
          } else {
            throw new Error('모델 경로를 찾을 수 없습니다. 1단계 검증 결과가 필요합니다.');
          }
        }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || e?.message || '알 수 없는 오류');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, stress?.resultJson, modelJsonPath, moduleModel]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 결과는 정반 전역좌표계에서 계산된다. 원본 Module Unit 형상과 변위벡터도 같은
  // 회전/이동을 적용해야 응력 위치·지지점·변형방향이 실제 해석 BDF 와 일치한다.
  const placedModel = useMemo(() => {
    if (!model || !placement?.anchor || !placement?.deckCenter) return model;
    const positions = Float32Array.from(model.positions || []);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const p = transformModulePoint({ x: positions[i], y: positions[i + 1], z: positions[i + 2] }, placement);
      positions[i] = p.x; positions[i + 1] = p.y; positions[i + 2] = p.z;
      lo[0] = Math.min(lo[0], p.x); lo[1] = Math.min(lo[1], p.y); lo[2] = Math.min(lo[2], p.z);
      hi[0] = Math.max(hi[0], p.x); hi[1] = Math.max(hi[1], p.y); hi[2] = Math.max(hi[2], p.z);
    }
    return { ...model, positions, bounds: { min: lo, max: hi } };
  }, [model, placement]);

  const placedDispNodes = useMemo(() => {
    if (!dispNodes?.length) return dispNodes;
    const th = (Number(placement?.rotationZDeg || 0) * Math.PI) / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    return dispNodes.map(d => ({
      ...d,
      t1: d.t1 * cs - d.t2 * sn,
      t2: d.t1 * sn + d.t2 * cs,
    }));
  }, [dispNodes, placement?.rotationZDeg]);

  // 판정 제외 요소가 있는가 — 없으면 토글 자체를 띄우지 않는다.
  const excludedCount = useMemo(
    () => (elements || []).reduce((n, e) => n + (e.excluded ? 1 : 0), 0), [elements]);
  const shownElements = useMemo(
    () => (hideExcluded && excludedCount > 0
      ? (elements || []).filter(e => !e.excluded) : elements),
    [elements, hideExcluded, excludedCount],
  );
  // 감춘 요소는 usageOf 에서도 빠져 색맵이 '결과 없음' 회색으로 그린다 — 선분을
  // 지우지는 않으므로 형상에 구멍이 나지 않는다.
  const usageOf = useMemo(() => indexByElementId(shownElements), [shownElements]);

  const viewDef = VIEWS.find(v => v.id === view) || VIEWS[0];
  const isDisp = viewDef.id !== 'stress';
  const hasDisp = Boolean(dispNodes?.length);

  // 절점 변위를 positions 인덱스 순서로 편다(응력은 요소 값이라 이 경로를 안 탄다).
  const nodal = useMemo(
    () => (placedModel && hasDisp ? nodalDisplacementArrays(placedModel, placedDispNodes) : null),
    [placedModel, placedDispNodes, hasDisp],
  );

  // 선택한 성분의 값 범위. 합성은 0 부터, 부호가 있는 성분은 실제 min~max 를 편다.
  const range = useMemo(() => {
    if (!nodal || !isDisp) return null;
    const arr = nodal[viewDef.key];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    if (!Number.isFinite(lo)) return { lo: 0, hi: 0 };
    return viewDef.key === 'mag' ? { lo: 0, hi } : { lo, hi };
  }, [nodal, isDisp, viewDef.key]);

  const autoScale = useMemo(
    () => autoDeformScale(placedModel?.bounds, nodal ? Math.max(...nodal.mag, 0) : 0),
    [placedModel, nodal],
  );
  const effectiveScale = isDisp ? (deformScale ?? autoScale) : 0;

  // 표에서 고른 부재를 변위 화면에서도 흰색으로 짚어 준다.
  const highlightSegments = useMemo(() => {
    if (focusEid == null || !placedModel?.beamIds) return undefined;
    const set = new Set();
    placedModel.beamIds.forEach((id, i) => { if (id === focusEid) set.add(i); });
    return set;
  }, [focusEid, placedModel]);

  // 선분마다 양 끝 정점 2개 × RGB 3 — FeModelViewer 가 인덱스를 풀어 그대로 쓴다.
  const [beamColors, colorError] = useMemo(() => {
    if (!placedModel) return [null, null];
    try {
      if (isDisp) {
        if (!nodal || !range) return [null, null];
        return [buildNodalBeamColors(placedModel.beams, nodal[viewDef.key],
          { ...range, highlightSegments }), null];
      }
      if (!shownElements) return [null, null];
      return [buildBeamColors(placedModel.beams, placedModel.beamIds, usageOf,
        { onlyExceed, highlightElementId: focusEid }), null];
    } catch (e) {
      // 길이 불일치 = 색이 통째로 밀린 상태다. 잘못된 그림을 보여 주느니 알린다.
      return [null, e.message];
    }
  }, [placedModel, shownElements, usageOf, onlyExceed, focusEid, isDisp, nodal, range, viewDef.key, highlightSegments]);

  // 변형 형상 — 원형상 좌표에 배율×변위를 더한 별도 모델을 만든다.
  const deformedModel = useMemo(() => {
    if (!placedModel || !isDisp || !nodal || !(effectiveScale > 0)) return null;
    return { ...placedModel, positions: deformedPositions(placedModel.positions, nodal, effectiveScale) };
  }, [placedModel, isDisp, nodal, effectiveScale]);

  // 마커 세 갈래 — 최대 응력 부재, 표에서 고른 부재, 그리고 경계조건(지지점).
  // 경계조건이 어디였는지 함께 보여야 "왜 여기가 붉은가"를 판단할 수 있다.
  const markers = useMemo(() => {
    // 변형 형상을 그릴 때는 마커도 그 좌표를 따라야 부재 위에 얹힌다.
    // (지지점은 SPC 로 변위가 0 이라 어느 쪽이든 같은 자리다.)
    const shown = deformedModel || placedModel;
    if (!shown) return [];
    const out = [];
    if (showSupports && supportIdx?.size) {
      selectionPoints(shown, supportIdx).forEach(p => {
        out.push({ x: p.x, y: p.y, z: p.z, color: '#22c55e', size: 11 });
      });
    }
    if (summary && !isDisp) {
      const mid = elementMidpoint(shown, summary.maxStressElementId);
      if (mid) out.push({ ...mid, color: '#f87171', size: 13 });
    }
    if (focusEid != null) {
      const mid = elementMidpoint(shown, focusEid);
      if (mid) out.push({ ...mid, color: '#ffffff', size: 15 });
    }
    return out;
  }, [placedModel, deformedModel, summary, focusEid, supportIdx, showSupports, isDisp]);

  const focusTarget = useMemo(() => {
    const shown = deformedModel || placedModel;
    if (focusEid == null || !shown) return null;
    const mid = elementMidpoint(shown, focusEid);
    return mid ? { ...mid, radius: 1500 } : null;
  }, [focusEid, placedModel, deformedModel]);

  const parts = useMemo(() => {
    if (!placedModel) return [];
    const out = [];
    // 원형상은 옅은 유령으로 깔아 변형량을 눈으로 비교할 수 있게 한다.
    if (deformedModel && showUndeformed) {
      out.push({
        id: 'mu-undeformed', name: '원형상', model: placedModel, color: '#64748b', opacity: 0.28,
        colorKey: 'ghost',
      });
    }
    out.push({
      id: 'mu-result',
      name: deformedModel ? `변형 형상 (×${Math.round(effectiveScale)})` : 'Module Unit',
      model: deformedModel || placedModel,
      color: '#8aa0b8',
      beamColors,
      // 색·좌표가 바뀌면 지오메트리를 다시 만들어야 한다(배열은 참조 비교가 안 된다).
      colorKey: `${view}:${shownElements ? shownElements.length : 0}:${onlyExceed ? 'ex' : 'all'}`
        + `:${focusEid ?? ''}:${effectiveScale.toFixed(3)}`,
    });
    return out;
  }, [placedModel, deformedModel, showUndeformed, beamColors, view, shownElements,
      onlyExceed, focusEid, effectiveScale]);

  if (!open) return null;

  const exceedRatio = summary && summary.elementCount
    ? (summary.exceedCount / summary.elementCount) * 100 : 0;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm
                     ${maximized ? 'p-0' : 'p-4'}`}>
      <div className={`flex flex-col bg-white shadow-2xl overflow-hidden
                       ${maximized ? 'w-full h-full rounded-none' : 'w-full max-w-[1400px] h-[88vh] rounded-2xl'}`}>
        {/* 머리말 */}
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">
              {isDisp ? '절점 변위 분포' : '요소 응력 분포'}
            </h3>
            <p className="text-[11px] text-slate-500 truncate">
              {isDisp
                ? `과정 1 — Module Unit 부재 · ${viewDef.label} · 변형 형상 ×${Math.round(effectiveScale)} 과장`
                : `과정 1 — Module Unit 부재 · 허용응력 ${allowable.toLocaleString()} MPa 기준 사용률 색맵`}
              {/* 여러 조건을 포락한 결과에서는 '지금 보는 그림이 어느 하중상태인가' 가
                  값만큼 중요하다. 변위는 지배 조건 하나의 변형장이고, 응력은 부재마다
                  최악 조건을 고른 합성이라 **한 하중상태의 그림이 아니다.** */}
              {loadCaseCount > 1 && (
                <span className="ml-1 font-semibold text-slate-600">
                  {isDisp
                    ? `· ${dispSummary?.loadCase || '지배 조건'} 변형장`
                    : `· ${loadCaseCount}개 조건 포락(부재별 최악)`}
                </span>
              )}
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
        {summary && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
            <label className="flex items-center gap-1.5 shrink-0">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">결과</span>
              <select
                value={view}
                onChange={(e) => setView(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold
                           text-slate-700 cursor-pointer focus:border-blue-400 focus:outline-none"
              >
                {VIEWS.map(v => (
                  <option key={v.id} value={v.id} disabled={v.id !== 'stress' && !hasDisp}>
                    {v.label}{v.id !== 'stress' && !hasDisp ? ' (없음)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {isDisp ? (
              <>
                <Stat label="최대 변위" value={`${fmt(range?.hi ?? 0)} mm`} />
                {viewDef.key === 'mag' && dispSummary && (
                  <Stat label="최대 절점" value={`ID ${dispSummary.maxNodeId}`} />
                )}
                {viewDef.key !== 'mag' && <Stat label="최소" value={`${fmt(range?.lo ?? 0)} mm`} />}
                {dispSummary && (
                  <Stat
                    label="성분별 최대 |X·Y·Z|"
                    value={`${fmt(dispSummary.maxAbsT1Mm)} · ${fmt(dispSummary.maxAbsT2Mm)} · ${fmt(dispSummary.maxAbsT3Mm)} mm`}
                  />
                )}
              </>
            ) : (
              <>
                <Stat label="최대 응력" value={`${summary.maxStressMPa.toLocaleString(undefined, { maximumFractionDigits: 1 })} MPa`} bad={summary.maxUsage > 1} />
                <Stat label="최대 사용률" value={`${summary.maxUsage.toFixed(2)}`} bad={summary.maxUsage > 1} />
                <Stat label="최대 부재" value={`EID ${summary.maxStressElementId}`} />
                <Stat
                  label="허용 초과"
                  value={`${summary.exceedCount.toLocaleString()} / ${summary.elementCount.toLocaleString()} (${exceedRatio.toFixed(1)}%)`}
                  bad={summary.exceedCount > 0}
                />
              </>
            )}

            {!isDisp && (
            <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyExceed}
                onChange={(e) => setOnlyExceed(e.target.checked)}
                className="accent-red-600 cursor-pointer"
              />
              허용 초과 부재만 강조
            </label>
            )}
            {!isDisp && excludedCount > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideExcluded}
                  onChange={(e) => setHideExcluded(e.target.checked)}
                  className="accent-slate-600 cursor-pointer"
                />
                판정 제외 배관 감추기 ({excludedCount.toLocaleString()})
              </label>
            )}
            {supportIdx?.size > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showSupports}
                  onChange={(e) => setShowSupports(e.target.checked)}
                  className="accent-emerald-600 cursor-pointer"
                />
                <Anchor size={11} className="text-emerald-600" />
                경계조건 {supportIdx.size}점
              </label>
            )}
          </div>
        )}

        {/* 변형 배율 — 실제 36mm 급 변형은 14.6m 모델에서 그냥은 안 보인다. */}
        {isDisp && hasDisp && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 border-b border-slate-100 bg-white shrink-0">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">변형 배율</span>
            <input
              type="range"
              min={0}
              max={Math.max(autoScale * 5, 1)}
              step={Math.max(autoScale / 50, 0.01)}
              value={effectiveScale}
              onChange={(e) => setDeformScale(Number(e.target.value))}
              className="w-64 accent-blue-600 cursor-pointer"
            />
            <span className="text-[11px] font-mono font-bold text-blue-600 w-16">
              ×{effectiveScale >= 10 ? Math.round(effectiveScale) : effectiveScale.toFixed(1)}
            </span>
            <button
              onClick={() => setDeformScale(null)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-md text-slate-500
                         hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
              title={`자동 = 최대 변위가 모델 크기의 5% 로 보이는 배율 (×${Math.round(autoScale)})`}
            >
              자동으로
            </button>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUndeformed}
                onChange={(e) => setShowUndeformed(e.target.checked)}
                className="accent-slate-500 cursor-pointer"
              />
              원형상 겹쳐 보기
            </label>
            <span className="text-[10px] text-slate-400">
              실제 최대 변위 {fmt(dispSummary?.maxMagMm ?? 0)} mm — 화면은 과장된 형상입니다.
            </span>
          </div>
        )}

        {/* 본문 */}
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 relative">
            <FeModelViewer
              parts={parts}
              markers={markers}
              focusTarget={focusTarget}
              initialShowRigids
              loading={busy}
              loadingLabel="요소 응력을 불러오는 중..."
              error={error || colorError}
            />
            {markers.length > 0 && !busy && !error && (
              <div className="absolute left-3 bottom-3 flex flex-col gap-1 rounded-lg bg-slate-900/85 px-2.5 py-2
                              text-[10px] text-slate-200 pointer-events-none">
                {showSupports && supportIdx?.size > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Dot color="#22c55e" /> 경계조건(지지점) {supportIdx.size}점
                  </span>
                )}
                {summary && !isDisp && (
                  <span className="flex items-center gap-1.5">
                    <Dot color="#f87171" /> 최대 응력 부재 EID {summary.maxStressElementId}
                  </span>
                )}
                {focusEid != null && (
                  <span className="flex items-center gap-1.5">
                    <Dot color="#ffffff" /> 선택 부재 EID {focusEid}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 범례 + 상위 부재 */}
          <div className="w-64 shrink-0 border-l border-slate-200 flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                {isDisp ? `${viewDef.label} 범례` : '사용률 범례'}
              </p>
              <div
                className="h-3 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${RAMP.map(([t, c]) => `${css(c)} ${t * 100}%`).join(', ')})`,
                }}
              />
              {isDisp ? (
                <>
                  <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
                    <span>{fmt(range?.lo ?? 0)}</span>
                    <span>{fmt(((range?.lo ?? 0) + (range?.hi ?? 0)) / 2)}</span>
                    <span>{fmt(range?.hi ?? 0)} mm</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {focusEid != null && <LegendRow color={css(HIGHLIGHT_COLOR)} label={`선택한 부재 (EID ${focusEid})`} />}
                    {showUndeformed && <LegendRow color="#64748b" label="원형상 (겹쳐 보기)" />}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    색은 <b>해석 최댓값 기준 정규화</b>입니다 — 허용 변위 판정은 하지 않습니다
                    (기준이 선사·선주마다 달라 임의로 정하면 거짓 합불이 됩니다).
                    형상은 <b>×{Math.round(effectiveScale)} 과장</b>이며 실제 변형이 아닙니다.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
                    <span>0.0</span><span>0.5</span><span>1.0 (허용)</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <LegendRow color={css(OVER_COLOR)} label="허용응력 초과 (사용률 > 1.0)" />
                    <LegendRow color={css(NO_DATA_COLOR)}
                      label={hideExcluded && excludedCount > 0
                        ? '응력 결과 없는 요소 · 판정 제외 배관' : '응력 결과 없는 요소'} />
                    {onlyExceed && <LegendRow color={css(DIMMED_COLOR)} label="가라앉힌 합격 부재" />}
                    {focusEid != null && <LegendRow color={css(HIGHLIGHT_COLOR)} label={`선택한 부재 (EID ${focusEid})`} />}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    색은 <b>사용률 = 응력 / {allowable.toLocaleString()} MPa</b> 입니다.
                    빔 요소 응력은 축력+굽힘 합성 수직응력이며 전단·비틀림은 빠져 있습니다.
                  </p>
                </>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                응력 상위 부재
              </p>
              {!elements && !busy && (
                <p className="text-[11px] text-slate-400">불러오지 못했습니다.</p>
              )}
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold py-1">EID</th>
                    <th className="text-right font-semibold py-1">MPa</th>
                    <th className="text-right font-semibold py-1">사용률</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {(shownElements || []).slice(0, 40).map(e => (
                    <tr
                      key={e.elementId}
                      onClick={() => setFocusEid(prev => (prev === e.elementId ? null : e.elementId))}
                      title="클릭하면 이 부재를 3D 에서 흰색으로 짚고 카메라를 옮깁니다"
                      className={`border-b border-slate-50 cursor-pointer transition-colors
                                  ${focusEid === e.elementId
                                    ? 'bg-slate-800 text-white'
                                    : 'hover:bg-slate-100'}`}
                    >
                      <td className={`py-0.5 ${focusEid === e.elementId ? 'text-white' : 'text-slate-600'}`}>
                        {e.elementId}
                      </td>
                      <td className={`py-0.5 text-right ${focusEid === e.elementId ? 'text-white' : 'text-slate-700'}`}>
                        {e.stressMPa.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className={`py-0.5 text-right font-bold ${e.usage > 1 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {e.usage.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {stress?.quality?.trustworthy === false && (
          <div className="shrink-0 flex items-start gap-2 px-5 py-2 border-t border-amber-200 bg-amber-50">
            <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[10px] text-amber-800 leading-relaxed">
              이 모델에는 특이 자유도가 있습니다.
              {stress.quality.governingContaminated
                ? ' 최대 응력 부재가 그 영향권 안이라 색맵의 최댓값도 허수일 수 있습니다.'
                : ' 최대 응력 부재는 영향권 밖이지만, 특이 절점 주변 부재의 색은 신뢰할 수 없습니다.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, bad }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className={`text-[11px] font-mono font-bold ${bad ? 'text-red-600' : 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

function Dot({ color }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}
