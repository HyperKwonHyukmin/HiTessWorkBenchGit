import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { beamExtras, lbmVersion, parseLbm } from './lb/lib/lbm.js';
import { buildGeometry } from './lb/lib/modelGeometry.js';
import { computeGroups } from './lb/lib/modelGroups.js';
import { classifyNodes } from './lb/lib/nodeCheck.js';
import { createIdIndex, elementNodeIndices, elementTable, listRigids, rigidNodes } from './lb/lib/modelIndex.js';
import { planSections } from './lb/lib/sectionPlan.js';
import { VIEW_KEYS } from './lb/lib/viewFrame.js';

/**
 * BDF 3D 미리보기 상태 + 엔진 연결.
 * LogBook `components/viewer/useModelViewer.js` 를 옮긴 것 — 다른 점은 둘뿐이다:
 *  · 모델 바이트는 load(signal) → ArrayBuffer 로 받는다(LogBook 은 /files/{id}/model.lbm 고정).
 *  · LogBook 의 찾기(Ctrl+F)·해석 검증 강조·비교 화면용 상태는 뺐다.
 * 엔진 계약은 lb/components/viewer/viewerEngine.js 머리말.
 */

/** 요소가 이보다 많으면 경계선을 기본으로 끈다(LogBook 과 같은 값). */
export const EDGE_LIMIT = 200_000;
const CLICK_SLOP = 4;
const DEFAULT_MARKERS = { rbe2: true, rbe3: true, conm2: true, spc: true };
const DEFAULT_NODES = { visible: false, classes: [true, true, true] };
const DEFAULT_CLIP = { on: false, axis: 'x', position: 0.5, flip: false };

const createEngine = async (container) => {
  const { createViewerEngine } = await import('./lb/components/viewer/viewerEngine.js');
  return createViewerEngine(container);
};

function rigidCount(lbm, kind, card) {
  const c = lbm.header.counts?.[card];
  if (c != null) return c;
  const lines = lbm.blocks.rigid_lines || [];
  const kinds = lbm.blocks.rigid_kinds || [];
  const eids = new Set();
  for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === kind) eids.add(lines[i * 3]);
  return eids.size;
}

/** axios 오류(arraybuffer 응답)에서 서버 detail 을 꺼낸다. */
export function previewErrorText(err) {
  const data = err?.response?.data;
  if (data instanceof ArrayBuffer && data.byteLength) {
    try {
      const detail = JSON.parse(new TextDecoder().decode(data))?.detail;
      if (typeof detail === 'string') return detail;
    } catch { /* JSON 이 아니면 아래 기본 문구 */ }
  }
  if (err?.code === 'ECONNABORTED') return '변환이 너무 오래 걸려 멈췄습니다. 모델이 매우 크면 파일을 받아 확인하세요.';
  if (err?.message && !err?.response) return `서버에 연결하지 못했습니다(${err.message}).`;
  return '모델을 불러오지 못했습니다.';
}

const normSel = (r) => (r == null ? null : typeof r === 'number' ? { kind: 'element', index: r } : r);
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * @param {{ load: (signal: AbortSignal) => Promise<ArrayBuffer>, sourceKey: string }} p
 *   sourceKey 가 바뀌면 모델을 다시 받는다(load 함수의 정체성은 보지 않는다).
 */
export function useBdfPreview({ load, sourceKey }) {
  const mountRef = useRef(null);
  const surfaceRef = useRef(null);
  const engineRef = useRef(null);
  const downRef = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [model, setModel] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [groupHidden, setGroupHidden] = useState(() => new Set());
  const [edges, setEdges] = useState(true);
  const [markers, setMarkers] = useState(DEFAULT_MARKERS);
  const [nodes, setNodesState] = useState(DEFAULT_NODES);
  const [view, setViewState] = useState('iso');
  const [colorMode, setColorModeState] = useState('pid');
  const [renderMode, setRenderModeState] = useState('line');
  const [sectionProgress, setSectionProgress] = useState(null);
  const [projection, setProjectionState] = useState('ortho');
  const [clip, setClipState] = useState(DEFAULT_CLIP);
  const [selection, setSelection] = useState(null);
  const [isolated, setIsolated] = useState(false);
  const isolatedRef = useRef(false);

  useEffect(() => {
    if (!sourceKey) return undefined;
    let alive = true;
    const controller = new AbortController();
    setState({ status: 'loading', error: '' });
    setModel(null); setSelection(null); setHidden(new Set()); setGroupHidden(new Set()); setViewState('iso');
    setMarkers(DEFAULT_MARKERS); setNodesState(DEFAULT_NODES); setColorModeState('pid'); setRenderModeState('line');
    setSectionProgress(null); setProjectionState('ortho'); setClipState(DEFAULT_CLIP); setIsolated(false);
    isolatedRef.current = false;
    // 엔진(three 묶음 + WebGL 준비)은 모델을 받는 동안 함께 만든다.
    const enginePromise = new Promise((resolve) => { resolve(createEngine(mountRef.current)); });
    enginePromise.catch(() => {});
    let adopted = false;
    let released = false;
    const releaseEngine = () => {
      if (released) return;
      released = true;
      enginePromise.then((e) => e?.dispose(), () => {});
    };
    (async () => {
      let m;
      try {
        const lbm = parseLbm(await loadRef.current(controller.signal));
        const geometry = buildGeometry(lbm);
        const groups = computeGroups(lbm);
        const check = classifyNodes(lbm);
        const rigids = listRigids(lbm);
        const plan = planSections(lbm, geometry);
        const { orient, offsets } = beamExtras(lbm);
        m = {
          lbm, geometry, groups, check, rigids, plan, orient, offsets,
          version: lbmVersion(lbm),
          table: elementTable(lbm, geometry),
          index: createIdIndex(lbm, geometry, rigids),
          beams: (lbm.blocks.beams?.length || 0) / 4,
        };
      } catch (err) {
        releaseEngine();
        if (alive) setState({ status: 'error', error: err?.response || err?.code ? previewErrorText(err) : (err?.message || '모델을 읽지 못했습니다.') });
        return;
      }
      let engine;
      try { engine = await enginePromise; } catch {
        if (alive) setState({ status: 'error', error: '이 PC 에서 3D 를 표시할 수 없습니다(WebGL2 를 만들지 못함).' });
        return;
      }
      if (!alive) return;
      adopted = true;
      released = true;
      engineRef.current = engine;
      const withEdges = m.geometry.total <= EDGE_LIMIT;
      engine.setModel(m.geometry, {
        edges: withEdges,
        extras: {
          blocks: m.lbm.blocks, groups: m.groups, check: m.check, rigids: m.rigids, plan: m.plan,
          orient: m.orient, offsets: m.offsets,
        },
      });
      setEdges(withEdges);
      setModel(m);
      setState({ status: 'ready', error: '' });
    })();
    return () => {
      alive = false;
      controller.abort();
      if (adopted) {
        engineRef.current?.dispose();
        engineRef.current = null;
      } else {
        releaseEngine();
      }
    };
  }, [sourceKey]);

  const ready = state.status === 'ready';
  const engine = () => engineRef.current;

  const markerCounts = useMemo(() => (model ? {
    rbe2: rigidCount(model.lbm, 0, 'RBE2'),
    rbe3: rigidCount(model.lbm, 1, 'RBE3'),
    conm2: model.geometry.masses.length,
    spc: new Set(model.geometry.spcs).size,
  } : {}), [model]);

  const visibleSel = useCallback((sel, pids, grps) => {
    if (!sel || !model) return true;
    if (sel.kind === 'element') {
      return !pids.has(model.table.pid[sel.index]) && !grps.has(model.groups.elemGroup[sel.index]);
    }
    const node = sel.kind === 'node' ? sel.index : model.rigids.center[sel.index];
    return !grps.has(model.groups.nodeGroup[node]);
  }, [model]);

  const selectionNodes = useCallback((sel) => {
    if (!sel || !model) return [];
    if (sel.kind === 'element') return elementNodeIndices(model.lbm, model.geometry, sel.index);
    if (sel.kind === 'node') return [sel.index];
    if (sel.kind === 'rbe') return rigidNodes(model.lbm, model.rigids, sel.index);
    return [];
  }, [model]);

  const select = useCallback((raw, { frame = false } = {}) => {
    const sel = normSel(raw);
    setSelection(sel);
    engineRef.current?.highlight(sel);
    if (sel && frame) engineRef.current?.frameNodes(selectionNodes(sel));
    if (isolatedRef.current) {
      engineRef.current?.setIsolate(sel);
      if (!sel) { isolatedRef.current = false; setIsolated(false); }
    }
  }, [selectionNodes]);

  const dropHiddenSelection = (pids, grps) => {
    if (selection && !visibleSel(selection, pids, grps)) select(null);
  };

  const toggleGroup = (pid) => {
    const next = new Set(hidden);
    const show = next.has(pid);
    if (show) next.delete(pid); else next.add(pid);
    setHidden(next);
    engine()?.setGroupVisible(pid, show);
    if (!show) dropHiddenSelection(next, groupHidden);
  };
  const setAllPids = (visible) => {
    const groups = model?.geometry.groups || [];
    for (const g of groups) engine()?.setGroupVisible(g.pid, visible);
    const next = visible ? new Set() : new Set(groups.map((g) => g.pid));
    setHidden(next);
    if (!visible) dropHiddenSelection(next, groupHidden);
  };

  const applyGroupHidden = (next) => {
    setGroupHidden(next);
    const n = model?.groups.count || 0;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) mask[i] = next.has(i) ? 0 : 1;
    engine()?.setGroupsVisible(mask);
    dropHiddenSelection(hidden, next);
  };
  const toggleConnGroup = (i) => {
    const next = new Set(groupHidden);
    if (next.has(i)) next.delete(i); else next.add(i);
    applyGroupHidden(next);
  };
  const setAllConnGroups = (visible) => {
    const n = model?.groups.count || 0;
    applyGroupHidden(visible ? new Set() : new Set(Array.from({ length: n }, (_, i) => i)));
  };
  const soloConnGroup = (i) => {
    const n = model?.groups.count || 0;
    const next = new Set();
    for (let k = 0; k < n; k += 1) if (k !== i) next.add(k);
    applyGroupHidden(next);
  };
  const frameConnGroup = (i) => {
    const ng = model?.groups.nodeGroup;
    if (ng) engine()?.frameNodes((n) => ng[n] === i);
  };

  const changeView = (id) => {
    setViewState(id);
    engine()?.setView(id);
  };
  const fit = () => engine()?.fit();
  const toggleEdges = () => {
    const next = !edges;
    setEdges(next);
    engine()?.setEdges(next);
  };
  const toggleMarker = (key) => {
    const next = { ...markers, [key]: !markers[key] };
    setMarkers(next);
    engine()?.setMarkers(next);
  };
  const setNodes = (patch) => {
    const next = { ...nodes, ...patch };
    setNodesState(next);
    engine()?.setNodes(next);
  };
  const setColorMode = (mode) => {
    setColorModeState(mode);
    engine()?.setColorMode(mode);
  };
  const setRenderMode = async (mode) => {
    if (mode === renderMode && sectionProgress == null) return;
    setRenderModeState(mode);
    const eng = engine();
    if (!eng?.setRenderMode) return;
    if (mode === 'section') setSectionProgress(0);
    try {
      await eng.setRenderMode(mode, { onProgress: (p) => setSectionProgress(p) });
    } finally {
      setSectionProgress(null);
    }
  };
  const setProjection = (mode) => {
    setProjectionState(mode);
    engine()?.setProjection(mode);
  };
  const setClip = (patch) => {
    const next = { ...clip, ...patch };
    setClipState(next);
    engine()?.setClip(next.on ? next : null);
  };
  const setIsolate = (on) => {
    const value = on && !!selection;
    isolatedRef.current = value;
    setIsolated(value);
    engine()?.setIsolate(value ? selection : null);
  };
  const frameSelection = () => {
    if (selection) engine()?.frameNodes(selectionNodes(selection));
  };

  function onPointerDown(e) {
    if (e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY };
    if (e.target === surfaceRef.current || mountRef.current?.contains(e.target)) surfaceRef.current?.focus({ preventScroll: true });
  }
  function onPointerUp(e) {
    const down = downRef.current;
    downRef.current = null;
    if (!down || e.button !== 0 || !ready) return;
    if (Math.abs(e.clientX - down.x) > CLICK_SLOP || Math.abs(e.clientY - down.y) > CLICK_SLOP) return;
    if (!(e.target === surfaceRef.current || mountRef.current?.contains(e.target))) return;
    const hit = normSel(engine()?.pickAt(e.clientX, e.clientY) ?? null);
    if (!hit && isolated) return;
    select(hit);
  }

  /**
   * 단축키 — F 화면 맞춤, I·1·2·3·A·S·D 시점, E 경계선, N 절점, P 직교/원근, Esc 선택 해제.
   * Esc 는 선택이 있을 때만 먹는다(없으면 대화상자가 닫히게 둔다). @returns {boolean} 처리했으면 true
   */
  function handleKey(e) {
    if (!ready || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'f') fit();
    else if (VIEW_KEYS[k]) changeView(VIEW_KEYS[k]);
    else if (k === 'e') toggleEdges();
    else if (k === 'n') setNodes({ visible: !nodes.visible });
    else if (k === 'p') setProjection(projection === 'ortho' ? 'persp' : 'ortho');
    else if (k === 'Escape' && (isolated || selection)) {
      if (isolated) setIsolate(false); else select(null);
    } else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  return {
    state, ready, model, hidden, groupHidden, edges, markers, markerCounts, nodes, view, colorMode, renderMode,
    sectionProgress, projection, clip, selection, isolated,
    mountRef, surfaceRef,
    select, toggleGroup, setAllPids, toggleConnGroup, setAllConnGroups, soloConnGroup, frameConnGroup,
    changeView, fit, toggleEdges, toggleMarker, setNodes, setColorMode, setRenderMode, setProjection, setClip,
    setIsolate, frameSelection, handleKey, onPointerDown, onPointerUp,
  };
}
