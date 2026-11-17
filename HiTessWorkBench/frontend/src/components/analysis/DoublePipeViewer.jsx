import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import {
  Layers, PlayCircle, PauseCircle, RotateCcw,
  Maximize2, Minimize2, Grid3x3, Search, X, Loader2,
} from 'lucide-react';
import {
  parseFindQuery, computeGroupOffsets, resolveFind, groupLabel,
} from '../../utils/doublePipeFind';

/* ── 배관 뷰어 전용 세로 그라디언트 배경 ── */
function makeGradientBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#2b3f5c');
  grad.addColorStop(0.55, '#182338');
  grad.addColorStop(1, '#0a1120');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Axis Gizmo 라벨 스프라이트 ── */
function makeAxisLabel(text, color) {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 44px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(0.45, 0.45, 1);
  return sp;
}

/* ── 찾기 강조 이름표(화면 크기 고정) ── */
function makeFindLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
  const w = Math.min(248, ctx.measureText(text).width + 24);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect((256 - w) / 2, 8, w, 48);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, sizeAttenuation: false,
  }));
  sp.scale.set(0.16, 0.04, 1);
  sp.center.set(0.5, -0.15);
  sp.renderOrder = 30;
  return sp;
}

function disposeObject(obj) {
  obj.traverse(o => {
    o.geometry?.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach(m => { m.map?.dispose(); m.dispose(); });
  });
}

const FIND_ELEMENT_COLOR = 0xff2d6f;
const FIND_NODE_COLOR = 0x22d3ee;
const FIND_LABEL_MAX = 40;

/* ── CSV 좌표 문자열("X 34866mm Y -3600mm Z 19384mm") → [x,y,z] ── */
function parseXYZ(str) {
  if (str == null) return null;
  const nums = String(str).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return null;
  return [parseFloat(nums[0]), parseFloat(nums[1]), parseFloat(nums[2])];
}

/* ── Tab1 결과 CSV → 배관 모델(외관/내관/UBOLT 지지) ──
   PipeEditiorCSV(해석 파이프라인)와 동일한 컬럼 규칙으로 파싱하되, 3D 표현을 위해
   부재를 외관(최대 OD)/내관(최소 OD) 그룹으로 나누고, UBOLT 는 U-볼트 클램프로 표현한다. */
function buildPipeModel(columns, rows) {
  if (!Array.isArray(columns) || !Array.isArray(rows) || rows.length === 0) return null;
  const col = (name, idx) => (columns.includes(name) ? name : columns[idx]);
  const cType = col('type', 1);
  const cPos = col('pos', 2);
  const cApos = col('apos', 3);
  const cLpos = col('lpos', 4);
  const cP3 = col('p3Pos', 10);
  const cNormal = col('normal', 8);
  const cOD = col('outDia', 6);
  const cRest = col('rest', 13);

  const rawSegs = []; // {a, b, od}
  const ubolts = [];  // {pos, axis, anchor}

  const seg = (a, b, od) => { if (a && b) rawSegs.push({ a, b, od }); };

  for (const row of rows) {
    const type = String(row[cType] ?? '').trim().toUpperCase();
    const od = Math.abs(parseFloat(row[cOD])) || 0;
    const a = parseXYZ(row[cApos]);
    const b = parseXYZ(row[cLpos]);
    const mid = parseXYZ(row[cPos]);
    if (type === 'TUBI' || type === 'OLET' || type === 'INST') {
      seg(a, b, od);
    } else if (type === 'ELBO' || type === 'BEND') {
      seg(a, mid, od); seg(mid, b, od);
    } else if (type === 'TEE') {
      const c = parseXYZ(row[cP3]);
      seg(a, mid, od); seg(mid, b, od); seg(mid, c, od);
    } else if (type === 'UBOLT') {
      if (a) {
        const dof = String(row[cRest] ?? '').replace(/[^0-9]/g, '');
        const anchor = ['1', '2', '3', '4', '5', '6'].every(d => dof.includes(d));
        const axis = parseXYZ(row[cNormal]);
        ubolts.push({ pos: a, axis, anchor });
      }
    }
  }

  const ods = rawSegs.map(s => s.od).filter(v => v > 0);
  if (rawSegs.length === 0) return null;
  const maxOD = ods.length ? Math.max(...ods) : 1;
  const minOD = ods.length ? Math.min(...ods) : maxOD;
  const threshold = (maxOD + minOD) / 2;
  const twoGroup = maxOD - minOD > 1e-6;

  const outerSegs = [];
  const innerSegs = [];
  for (const s of rawSegs) {
    if (twoGroup && s.od > 0 && s.od < threshold) innerSegs.push(s);
    else outerSegs.push(s);
  }

  // 그룹별 고유 노드(엘보 이음새를 구체로 메워 매끈한 배관 표현)
  const uniqueNodes = (segs) => {
    const map = new Map();
    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        const k = p.map(v => Math.round(v * 10)).join(',');
        if (!map.has(k)) map.set(k, p);
      }
    }
    return [...map.values()];
  };
  const outerNodes = uniqueNodes(outerSegs);
  const innerNodes = uniqueNodes(innerSegs);

  // bbox
  const box = new THREE.Box3();
  for (const s of rawSegs) {
    box.expandByPoint(new THREE.Vector3(...s.a));
    box.expandByPoint(new THREE.Vector3(...s.b));
  }
  ubolts.forEach(u => box.expandByPoint(new THREE.Vector3(...u.pos)));
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1000;

  const outerR = maxDim * 0.0055;
  const innerR = twoGroup ? outerR * Math.min(0.85, Math.max(0.42, minOD / maxOD)) : outerR;

  // U-볼트 클램프 축 = 해당 위치의 가장 가까운 배관 세그먼트 방향(링이 배관을 감싸도록)
  const dirSource = innerSegs.length ? innerSegs : outerSegs;
  const supports = ubolts.map(u => {
    let best = null;
    let bestD = Infinity;
    const p = new THREE.Vector3(...u.pos);
    for (const s of dirSource) {
      const a = new THREE.Vector3(...s.a);
      const b = new THREE.Vector3(...s.b);
      const dA = p.distanceToSquared(a);
      const dB = p.distanceToSquared(b);
      const d = Math.min(dA, dB);
      if (d < bestD) { bestD = d; best = b.clone().sub(a); }
    }
    let axis = best && best.lengthSq() > 1e-6 ? best.normalize() : null;
    if (!axis && u.axis) axis = new THREE.Vector3(...u.axis).normalize();
    if (!axis) axis = new THREE.Vector3(0, 0, 1);
    return { pos: u.pos, axis: [axis.x, axis.y, axis.z], anchor: u.anchor };
  });

  return {
    outerSegs, innerSegs, outerNodes, innerNodes, supports,
    outerR, innerR, twoGroup,
    center: [center.x, center.y, center.z], maxDim,
    bbox: { dx: size.x, dy: size.y, dz: size.z },
    counts: {
      outer: outerSegs.length,
      inner: innerSegs.length,
      anchor: supports.filter(s => s.anchor).length,
      guide: supports.filter(s => !s.anchor).length,
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

// 표준 뷰 방향(Z-up). Top 은 up 축과 시선이 겹치는 특이점이라 미세 Y 오프셋으로 회피.
const VIEW_DIRS = {
  iso: [1, -1, 0.7],
  top: [0, 0.0001, 1],
  front: [0, -1, 0],
  side: [1, 0, 0],
};

// FOV 기반 fit-to-view — 바운딩 스피어 반경과 카메라 화각으로 거리를 계산해 모델을 화면에 꽉 채운다.
// controls.update() 가 방향(특이점 포함)을 안전하게 정렬하므로 수동 lookAt 은 쓰지 않는다.
function frameCameraTo(camera, controls, center, boundRadius, dirArr, padding = 1.3) {
  const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
  if (dir.lengthSq() < 1e-9) dir.set(1, -1, 0.7);
  dir.normalize();
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (boundRadius / Math.max(0.09, Math.sin(fov / 2))) * padding;
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  controls.target.copy(center);
  camera.near = Math.max(dist / 2000, 0.05);
  camera.far = dist * 2000;
  camera.updateProjectionMatrix();
  controls.update();
}

const TOOL_TONE_ON = {
  sky: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

// 뷰어 하단 컨트롤 툴바 버튼 — 컴포넌트 밖에 두어 매 렌더 리마운트를 방지.
function ToolBtn({ active, onClick, disabled, icon: Icon, label, tone = 'sky' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex h-11 w-12 flex-col items-center justify-center rounded-xl border transition-colors ${
        disabled
          ? 'cursor-not-allowed border-transparent bg-slate-800/40 text-slate-600 opacity-40'
          : active
            ? `cursor-pointer ${TOOL_TONE_ON[tone]}`
            : 'cursor-pointer border-transparent bg-slate-700 text-slate-400 hover:text-white'
      }`}
    >
      <Icon size={16} className="mb-0.5" />
      <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
    </button>
  );
}

// 표준 뷰 프리셋용 텍스트 버튼 — 카메라를 해당 방향으로 스냅한다.
function ViewBtn({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} 뷰로 이동`}
      className="flex h-11 min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-transparent bg-slate-700 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-300 transition-colors hover:bg-slate-600 hover:text-white"
    >
      {label}
    </button>
  );
}

// find = 해석 모델(inp) 번호 찾기. 없으면 찾기 칸을 그리지 않는다(Natural Frequency 화면 등).
//   { status: 'idle' | 'loading' | 'ready' | 'error', model, message }
export default function DoublePipeViewer({ columns, rows, find }) {
  const mountRef = useRef(null);
  const containerRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const outerGroupRef = useRef(null);
  const innerGroupRef = useRef(null);
  const supportGroupRef = useRef(null);
  const gridRef = useRef(null);
  const sceneRef = useRef(null);
  const findGroupRef = useRef(null);

  const gizmoCanvasRef = useRef(null);
  const gizmoRendererRef = useRef(null);
  const gizmoSceneRef = useRef(null);
  const gizmoCamRef = useRef(null);

  const [showOuter, setShowOuter] = useState(true);
  const [showInner, setShowInner] = useState(true);
  const [showSupports, setShowSupports] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // WebGL 초기화 실패/컨텍스트 손실 시 앱이 멈추지 않도록 폴백 상태로 전환.
  const [glError, setGlError] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findKind, setFindKind] = useState('element');
  const [findResult, setFindResult] = useState(null);   // { nodes, elements, missing, invalid }

  const model = useMemo(() => buildPipeModel(columns, rows), [columns, rows]);

  /* 전체화면 */
  const toggleFullscreen = () => {
    if (!isFullscreen) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ── 메인 씬 ── */
  useEffect(() => {
    if (!mountRef.current || !model) return undefined;
    setGlError(false); // 새 모델로 재시도 시 이전 오류 상태 해제
    const el = mountRef.current;
    let cleanup = () => {};
    let disposed = false;
    let canvasEl = null;
    let onLost = null;
    let raf = 0;
    try {
    const scene3 = createThreeScene(el, { zUp: true });
    const { scene, camera, renderer, controls } = scene3;
    cleanup = scene3.cleanup;
    sceneRef.current = scene;
    controlsRef.current = controls;
    cameraRef.current = camera;
    // WebGL 컨텍스트 손실(드라이버 리셋 등) 시 프리즈 대신 폴백 UI 로 전환.
    canvasEl = renderer.domElement;
    onLost = (e) => { e.preventDefault(); if (!disposed) setGlError(true); };
    canvasEl.addEventListener('webglcontextlost', onLost, false);

    scene.background = makeGradientBackground();
    scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x5a4636, 1.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    renderer.toneMappingExposure = 1.4;

    const steel = new THREE.MeshStandardMaterial({ color: 0x9fb4d0, metalness: 0.9, roughness: 0.3, emissive: 0x0e1a2e, emissiveIntensity: 0.16 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9a860, metalness: 0.85, roughness: 0.34, emissive: 0x3a2408, emissiveIntensity: 0.2 });
    const anchorMat = new THREE.MeshStandardMaterial({ color: 0x34d399, metalness: 0.55, roughness: 0.32, emissive: 0x0c6b46, emissiveIntensity: 0.55 });
    const guideMat = new THREE.MeshStandardMaterial({ color: 0xf6b73c, metalness: 0.55, roughness: 0.34, emissive: 0x7a4d05, emissiveIntensity: 0.5 });

    // ── 배관 그룹(실린더 세그먼트 + 이음새 구체) ──
    const buildPipeGroup = (segs, nodes, radius, mat) => {
      const group = new THREE.Group();
      if (segs.length > 0) {
        const geo = new THREE.CylinderGeometry(radius, radius, 1, 20);
        const inst = new THREE.InstancedMesh(geo, mat, segs.length);
        const d = new THREE.Object3D();
        segs.forEach((s, i) => {
          const a = new THREE.Vector3(...s.a);
          const b = new THREE.Vector3(...s.b);
          d.position.copy(a).lerp(b, 0.5);
          d.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
          d.scale.set(1, a.distanceTo(b) || radius, 1);
          d.updateMatrix();
          inst.setMatrixAt(i, d.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
      if (nodes.length > 0) {
        const sGeo = new THREE.SphereGeometry(radius, 16, 12);
        const sInst = new THREE.InstancedMesh(sGeo, mat, nodes.length);
        const d = new THREE.Object3D();
        nodes.forEach((p, i) => { d.position.set(...p); d.updateMatrix(); sInst.setMatrixAt(i, d.matrix); });
        sInst.instanceMatrix.needsUpdate = true;
        group.add(sInst);
      }
      return group;
    };

    const outerGroup = buildPipeGroup(model.outerSegs, model.outerNodes, model.outerR, steel);
    outerGroup.visible = showOuter;
    outerGroupRef.current = outerGroup;
    scene.add(outerGroup);

    const innerGroup = buildPipeGroup(model.innerSegs, model.innerNodes, model.innerR, brass);
    innerGroup.visible = showInner;
    innerGroupRef.current = innerGroup;
    scene.add(innerGroup);

    // ── U-볼트 클램프(토러스 링) — anchor(전구속)/guide 분리 ──
    const clampR = (model.innerR || model.outerR) * 1.9;
    const tubeR = clampR * 0.24;
    const supportGroup = new THREE.Group();
    const anchors = model.supports.filter(s => s.anchor);
    const guides = model.supports.filter(s => !s.anchor);
    const buildClamps = (list, mat) => {
      if (list.length === 0) return;
      const geo = new THREE.TorusGeometry(clampR, tubeR, 12, 28);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const d = new THREE.Object3D();
      list.forEach((s, i) => {
        d.position.set(...s.pos);
        d.quaternion.setFromUnitVectors(ZAXIS, new THREE.Vector3(...s.axis).normalize());
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      supportGroup.add(inst);
    };
    buildClamps(anchors, anchorMat);
    buildClamps(guides, guideMat);
    supportGroup.visible = showSupports;
    supportGroupRef.current = supportGroup;
    scene.add(supportGroup);

    // ── 참조 그리드(바닥면) — 공중에 뜬 배관에 방향·규모 기준을 준다.
    // GridHelper 는 기본 XZ 평면이라 X축 90° 회전으로 XY 평면(Z-up)에 눕히고, 모델 최저 Z(바닥)에 배치.
    const center = new THREE.Vector3(...model.center);
    const md = model.maxDim;
    const grid = new THREE.GridHelper(md * 1.8, 18, 0x415472, 0x28344a);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(center.x, center.y, center.z - model.bbox.dz / 2);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.visible = showGrid;
    gridRef.current = grid;
    scene.add(grid);

    // 카메라 초기화 — FOV 기반 fit 프레이밍(ISO)으로 모델을 화면에 꽉 채운다.
    const initBoundR = 0.5 * Math.sqrt(
      model.bbox.dx ** 2 + model.bbox.dy ** 2 + model.bbox.dz ** 2,
    ) || md;
    frameCameraTo(camera, controls, center, initBoundR, VIEW_DIRS.iso);
    controls.saveState();

    const onFrame = () => {
      const gz = gizmoRendererRef.current;
      const gs = gizmoSceneRef.current;
      const gc = gizmoCamRef.current;
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      if (!gz || !gs || !gc || !cam || !ctrl) return;
      const dir = cam.position.clone().sub(ctrl.target).normalize();
      gc.position.copy(dir.multiplyScalar(3.4));
      gc.up.copy(cam.up);
      gc.lookAt(0, 0, 0);
      gz.render(gs, gc);
    };
    // 블룸 컴포저(연속 렌더 시 GPU 부하가 큼)를 쓰지 않고 직접 렌더한다 —
    // 저사양·소프트웨어 렌더링(GPU 가속 비활성) 환경에서 앱이 멈추는 것을 방지.
    controls.target.copy(center);
    const renderLoop = () => {
      raf = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
      onFrame();
    };
    renderLoop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (canvasEl && onLost) canvasEl.removeEventListener('webglcontextlost', onLost);
      outerGroupRef.current = null;
      innerGroupRef.current = null;
      supportGroupRef.current = null;
      gridRef.current = null;
      cameraRef.current = null;
      if (findGroupRef.current) { disposeObject(findGroupRef.current); findGroupRef.current = null; }
      sceneRef.current = null;
      cleanup();
    };
    } catch (err) {
      // WebGL 미지원/초기화 실패 — 폴백 UI 로 안전하게 전환(앱 프리즈 방지).
      console.error('[DoublePipeViewer] 3D 초기화 실패:', err);
      setGlError(true);
      cancelAnimationFrame(raf);
      try { cleanup(); } catch (_) { /* noop */ }
      return undefined;
    }
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Axis Gizmo (마운트 1회) ── */
  useEffect(() => {
    const canvas = gizmoCanvasRef.current;
    if (!canvas) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setSize(84, 84, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch { return undefined; }
    const gscene = new THREE.Scene();
    const gcam = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    gcam.up.set(0, 0, 1);
    const makeAxis = (color, dir, label) => {
      const grp = new THREE.Group();
      const n = dir.clone().normalize();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 16), new THREE.MeshBasicMaterial({ color }));
      shaft.quaternion.setFromUnitVectors(UP, n);
      shaft.position.copy(n.clone().multiplyScalar(0.5));
      grp.add(shaft);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 16), new THREE.MeshBasicMaterial({ color }));
      head.quaternion.setFromUnitVectors(UP, n);
      head.position.copy(n.clone().multiplyScalar(1.15));
      grp.add(head);
      const sprite = makeAxisLabel(label, `#${color.toString(16).padStart(6, '0')}`);
      sprite.position.copy(n.clone().multiplyScalar(1.4));
      grp.add(sprite);
      return grp;
    };
    gscene.add(makeAxis(0xff5252, new THREE.Vector3(1, 0, 0), 'X'));
    gscene.add(makeAxis(0x4ade80, new THREE.Vector3(0, 1, 0), 'Y'));
    gscene.add(makeAxis(0x60a5fa, new THREE.Vector3(0, 0, 1), 'Z'));
    gscene.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: 0x94a3b8 })));
    gizmoRendererRef.current = renderer;
    gizmoSceneRef.current = gscene;
    gizmoCamRef.current = gcam;
    return () => {
      gizmoRendererRef.current = null;
      gizmoSceneRef.current = null;
      gizmoCamRef.current = null;
      gscene.traverse(o => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      renderer.dispose();
    };
  }, []);

  /* 토글 side-effects */
  useEffect(() => { if (outerGroupRef.current) outerGroupRef.current.visible = showOuter; }, [showOuter]);
  useEffect(() => { if (innerGroupRef.current) innerGroupRef.current.visible = showInner; }, [showInner]);
  useEffect(() => { if (supportGroupRef.current) supportGroupRef.current.visible = showSupports; }, [showSupports]);
  useEffect(() => { if (gridRef.current) gridRef.current.visible = showGrid; }, [showGrid]);
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.4;
    }
  }, [autoRotate]);

  const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '–');

  // 바운딩 스피어 반경(뷰 프리셋/Fit 프레이밍용)
  const boundRadius = useMemo(() => {
    if (!model) return 1000;
    const { dx, dy, dz } = model.bbox;
    return 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz) || model.maxDim;
  }, [model]);

  // 표준 뷰로 카메라 스냅
  const applyView = (dir) => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl || !model) return;
    frameCameraTo(cam, ctrl, new THREE.Vector3(...model.center), boundRadius, dir);
  };
  // 현재 시선 방향을 유지한 채 모델을 화면에 다시 꽉 채움
  const fitView = () => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl || !model) return;
    const d = cam.position.clone().sub(ctrl.target);
    applyView(d.lengthSq() > 1e-9 ? [d.x, d.y, d.z] : VIEW_DIRS.iso);
  };

  /* ── 번호 찾기(해석 모델 inp) ── */
  const findModel = find?.status === 'ready' ? find.model : null;
  const findOffsets = useMemo(() => {
    if (!findModel || !model) return null;
    const pts = (segs) => segs.flatMap(sg => [sg.a, sg.b]);
    return computeGroupOffsets(findModel, { outer: pts(model.outerSegs), inner: pts(model.innerSegs) });
  }, [findModel, model]);

  const clearFindHighlight = () => {
    const g = findGroupRef.current;
    if (g) { g.parent?.remove(g); disposeObject(g); findGroupRef.current = null; }
  };

  // 모델이나 해석 모델이 바뀌면 이전 강조는 다른 모델의 것이라 지운다.
  useEffect(() => { clearFindHighlight(); setFindResult(null); }, [model, findModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusPoints = (points) => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl || !model || points.length === 0) return;
    const box = new THREE.Box3();
    points.forEach(p => box.expandByPoint(new THREE.Vector3(...p)));
    const c = new THREE.Vector3(); box.getCenter(c);
    const size = new THREE.Vector3(); box.getSize(size);
    const r = Math.max(size.length() * 0.6, model.maxDim * 0.05);
    const d = cam.position.clone().sub(ctrl.target);
    frameCameraTo(cam, ctrl, c, r, d.lengthSq() > 1e-9 ? [d.x, d.y, d.z] : VIEW_DIRS.iso);
  };

  const drawFindHighlight = (res) => {
    clearFindHighlight();
    const scene = sceneRef.current;
    if (!scene || !model) return;
    const group = new THREE.Group();
    // 요소는 수백 mm 로 짧아 굵게 그리면 구가 요소를 덮는다 — 배관보다 조금만 굵게.
    const tubeR = model.outerR * 1.15;
    const ballR = model.outerR * 1.7;
    // depthTest 끔 — 내관은 외관 안에 있어 가려지므로 강조는 늘 위에 보이게 한다.
    const elMat = new THREE.MeshBasicMaterial({ color: FIND_ELEMENT_COLOR, depthTest: false, transparent: true, opacity: 0.95 });
    const ndMat = new THREE.MeshBasicMaterial({ color: FIND_NODE_COLOR, depthTest: false, transparent: true, opacity: 0.95 });
    const tubeGeo = new THREE.CylinderGeometry(tubeR, tubeR, 1, 14);
    const jointGeo = new THREE.SphereGeometry(tubeR, 12, 10);
    const ballGeo = new THREE.SphereGeometry(ballR, 16, 12);
    const lift = new THREE.Vector3(0, 0, model.outerR * 2.6);
    let labels = 0;
    const addLabel = (text, pos, color) => {
      if (labels >= FIND_LABEL_MAX) return;
      labels += 1;
      const sp = makeFindLabel(text, color);
      sp.position.copy(new THREE.Vector3(...pos).add(lift));
      group.add(sp);
    };
    for (const el of res.elements) {
      const pts = el.path.map(p => new THREE.Vector3(...p));
      let drew = false;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        if (len < 1e-3) continue;
        const m = new THREE.Mesh(tubeGeo, elMat);
        m.position.copy(a).lerp(b, 0.5);
        m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
        m.scale.set(1, len, 1);
        m.renderOrder = 20;
        group.add(m);
        drew = true;
      }
      // 길이 0 인 연결 요소(U-bolt)는 선 대신 구로 보인다.
      (drew ? [pts[0], pts[pts.length - 1]] : pts).forEach(p => {
        const j = new THREE.Mesh(drew ? jointGeo : ballGeo, elMat);
        j.position.copy(p);
        j.renderOrder = 20;
        group.add(j);
      });
      const lo = pts[Math.floor((pts.length - 1) / 2)];
      const hi = pts[Math.ceil((pts.length - 1) / 2)];
      const mid = lo.clone().lerp(hi, 0.5);
      addLabel(el.label, [mid.x, mid.y, mid.z], '#ff2d6f');
    }
    for (const nd of res.nodes) {
      const m = new THREE.Mesh(ballGeo, ndMat);
      m.position.set(...nd.pos);
      m.renderOrder = 21;
      group.add(m);
      addLabel(nd.label, nd.pos, '#22d3ee');
    }
    scene.add(group);
    findGroupRef.current = group;
  };

  const runFind = () => {
    if (!findModel || !findOffsets) return;
    const { items, invalid } = parseFindQuery(findQuery, findKind);
    const res = { ...resolveFind(items, findModel, findOffsets), invalid };
    setFindResult(res);
    drawFindHighlight(res);
    focusPoints([...res.elements.flatMap(e => e.path), ...res.nodes.map(n => n.pos)]);
  };

  const clearFind = () => {
    clearFindHighlight();
    setFindResult(null);
    setFindQuery('');
  };

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900 text-center text-slate-400">
        <div>
          <Layers size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">CSV에서 배관 좌표를 읽지 못했습니다.</p>
        </div>
      </div>
    );
  }

  const legend = [
    { color: '#9fb4d0', label: `Outer Pipe · 외관 (${model.counts.outer})`, on: showOuter, toggle: () => setShowOuter(v => !v) },
    ...(model.twoGroup ? [{ color: '#d9a860', label: `Inner Pipe · 내관 (${model.counts.inner})`, on: showInner, toggle: () => setShowInner(v => !v) }] : []),
    ...(model.counts.anchor > 0 ? [{ color: '#34d399', label: `Anchor · 전구속 (${model.counts.anchor})`, on: showSupports, toggle: () => setShowSupports(v => !v) }] : []),
    ...(model.counts.guide > 0 ? [{ color: '#f6b73c', label: `Guide U-Bolt (${model.counts.guide})`, on: showSupports, toggle: () => setShowSupports(v => !v) }] : []),
  ];

  return (
    <div ref={containerRef} className="relative h-full w-full bg-slate-900">
      <div ref={mountRef} className="absolute inset-0 cursor-move overflow-hidden" />

      {glError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-900 px-6 text-center">
          <Layers size={40} className="mb-3 text-slate-500" />
          <p className="text-sm font-semibold text-slate-200">3D 뷰어를 표시할 수 없습니다</p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-400">
            이 환경에서 3D 그래픽(WebGL)을 사용할 수 없습니다. 상단의{' '}
            <span className="font-semibold text-slate-200">입력 CSV</span> 탭에서 배관 데이터를 표로 확인하세요.
          </p>
        </div>
      )}

      {!glError && (
        <>
      {/* 전체화면 */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? '전체화면 종료' : '전체화면'}
        className="absolute right-3 top-3 z-20 cursor-pointer rounded-lg border border-slate-700 bg-slate-900/80 p-1.5 text-slate-400 shadow backdrop-blur transition-colors hover:border-slate-500 hover:text-white"
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      <div className="absolute left-3 top-3 z-10 flex w-[260px] max-w-[calc(100%-24px)] flex-col gap-2">
      {/* 레전드 — 항목 클릭으로 해당 요소 표시/숨김 토글 */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/85 px-2.5 py-2.5 shadow-lg backdrop-blur">
        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">이중관 배관 모델</p>
        <div className="flex flex-col gap-0.5">
          {legend.map(({ color, label, on, toggle }) => (
            <button
              key={label}
              type="button"
              onClick={toggle}
              title="클릭하여 표시/숨김"
              className={`flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-slate-700/50 ${on ? '' : 'opacity-40'}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-mono text-[11px] leading-snug text-slate-200">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {find && (
        <FindPanel
          find={find}
          query={findQuery}
          setQuery={setFindQuery}
          kind={findKind}
          setKind={setFindKind}
          result={findResult}
          onFind={runFind}
          onClear={clearFind}
          onFocus={focusPoints}
        />
      )}
      </div>

      {/* 통계 */}
      <div className="pointer-events-none absolute right-3 top-12 z-10 rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2.5 shadow-lg backdrop-blur">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Model</p>
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 font-mono text-[11px]">
          <span className="text-slate-400">Segments</span>
          <span className="text-right tabular-nums text-slate-100">{fmt(model.counts.outer + model.counts.inner)}</span>
          <span className="text-slate-400">Supports</span>
          <span className="text-right tabular-nums text-slate-100">{fmt(model.counts.anchor + model.counts.guide)}</span>
        </div>
        <div className="mt-2 border-t border-slate-700/60 pt-2 font-mono text-[10px] text-slate-400">
          <div className="flex justify-between gap-3">
            <span>BBox (mm)</span>
            <span className="text-slate-300">{fmt(model.bbox.dx)}×{fmt(model.bbox.dy)}×{fmt(model.bbox.dz)}</span>
          </div>
        </div>
      </div>

      {/* Axis Gizmo */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 h-[84px] w-[84px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900/70 shadow-lg backdrop-blur-sm">
        <canvas ref={gizmoCanvasRef} width={84} height={84} className="block h-full w-full" />
      </div>

      {/* 컨트롤 툴바 — 뷰 프리셋(어떻게 볼지). 요소 표시/숨김은 좌측 상단 레전드에서. */}
      <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800/80 p-1.5 shadow-2xl backdrop-blur-md">
        <ViewBtn label="ISO" onClick={() => applyView(VIEW_DIRS.iso)} />
        <ViewBtn label="Top" onClick={() => applyView(VIEW_DIRS.top)} />
        <ViewBtn label="Front" onClick={() => applyView(VIEW_DIRS.front)} />
        <ViewBtn label="Side" onClick={() => applyView(VIEW_DIRS.side)} />
        <ViewBtn label="Fit" onClick={fitView} />
        <div className="mx-0.5 w-px self-stretch bg-slate-700/70" />
        <ToolBtn active={showGrid} onClick={() => setShowGrid(v => !v)} icon={Grid3x3} label="Grid" tone="sky" />
        <ToolBtn active={autoRotate} onClick={() => setAutoRotate(v => !v)} icon={autoRotate ? PauseCircle : PlayCircle} label="Rotate" tone="emerald" />
        <ToolBtn active={false} onClick={() => controlsRef.current?.reset()} icon={RotateCcw} label="Reset" />
      </div>
        </>
      )}
    </div>
  );
}

// 번호 찾기 상자 — 범례 바로 아래. 해석이 끝나 해석 모델(inp)을 받은 뒤에만 쓸 수 있다.
function FindPanel({ find, query, setQuery, kind, setKind, result, onFind, onClear, onFocus }) {
  const ready = find.status === 'ready';
  const foundCount = result ? result.elements.length + result.nodes.length : 0;
  const notFound = result ? [...result.missing, ...result.invalid] : [];
  const kindBtn = (value, label) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      aria-pressed={kind === value}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
        kind === value ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-2.5 py-2.5 shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] font-bold text-slate-300">번호 찾기</p>
        <div className="flex rounded-lg bg-slate-800 p-0.5" title="번호만 쓴 항목의 종류">
          {kindBtn('element', 'Element')}
          {kindBtn('node', 'Node')}
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={query}
          disabled={!ready}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') onFind();
            if (e.key === 'Escape') onClear();
          }}
          placeholder={ready ? '예: 46, 47, N12' : '해석 후 사용'}
          aria-label="찾을 Node 또는 Element 번호"
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onFind}
          disabled={!ready || !query.trim()}
          title="찾기 (Enter)"
          aria-label="찾기"
          className="flex items-center justify-center rounded-lg bg-sky-600 px-2.5 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          <Search size={14} />
        </button>
      </div>
      {find.status === 'loading' && (
        <p className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-slate-400">
          <Loader2 size={12} className="animate-spin" /> 해석 모델을 불러오는 중
        </p>
      )}
      {find.status === 'idle' && (
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-slate-400">해석이 끝나면 해석 모델의 Node, Element 번호로 찾을 수 있습니다.</p>
      )}
      {find.status === 'error' && (
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-rose-300">{find.message || '해석 모델을 불러오지 못했습니다.'}</p>
      )}
      {ready && !result && (
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-slate-400">쉼표로 여러 개. N12 = Node, E46 = Element.</p>
      )}
      {result && (
        <div className="mt-2 px-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-300">
              찾음 <span className="font-bold text-white">{foundCount}</span>
              {notFound.length > 0 && <> · 없음 <span className="font-bold text-rose-300">{notFound.length}</span></>}
            </p>
            <button type="button" onClick={onClear} className="flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-white">
              <X size={12} /> 지우기
            </button>
          </div>
          {foundCount > 0 && (
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {result.elements.map(el => (
                <button
                  key={el.label}
                  type="button"
                  onClick={() => onFocus(el.path)}
                  title={`${el.type}${groupLabel(el.group) ? ` · ${groupLabel(el.group)}` : ''} — 눌러서 가기`}
                  className="rounded-md border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[11px] text-rose-200 hover:bg-rose-500/30"
                >
                  {el.label}
                </button>
              ))}
              {result.nodes.map(nd => (
                <button
                  key={nd.label}
                  type="button"
                  onClick={() => onFocus([nd.pos])}
                  title={`${groupLabel(nd.group) || 'Node'} — 눌러서 가기`}
                  className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[11px] text-cyan-200 hover:bg-cyan-500/30"
                >
                  {nd.label}
                </button>
              ))}
            </div>
          )}
          {notFound.length > 0 && (
            <p className="mt-1.5 break-all font-mono text-[11px] leading-snug text-rose-300">없음: {notFound.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
