import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
  Maximize2, Minimize2, Crosshair, Box, Grid3x3, Loader2,
  AlertTriangle, Eye, EyeOff, Camera, Layers, HelpCircle,
} from 'lucide-react';
import { buildTriangleIndices, buildShellEdgeIndices, toIndexArray } from '../../utils/feGeometry';

/**
 * 유한요소 모델 뷰어 — 상용 FE 전처리 GUI 의 조작 감각을 목표로 한 컴포넌트.
 *
 * 설계 의도:
 *  · **온디맨드 렌더** — 상시 애니메이션 루프를 돌리지 않고 카메라/상태가 바뀔 때만 그린다.
 *    6만 요소 모델에서 유휴 GPU 사용을 0 으로 만들고, 조명이 흔들리지 않아 형상 판독이 안정적이다.
 *    (같은 이유로 OrbitControls 의 damping 도 끈다 — FE GUI 의 절도 있는 회전감.)
 *  · **카메라 고정 조명** — 라이트를 카메라에 붙여 어느 방향에서 봐도 면 밝기가 일정하다.
 *  · **요소 경계선 분리** — 면(Mesh)과 요소 경계선(LineSegments)을 따로 만들어
 *    쉐이딩/와이어프레임 표시 모드를 지오메트리 재생성 없이 전환한다.
 *
 * parts 계약 (페이지가 배치 계산 결과를 넘긴다):
 *   { id, name, color, model, anchor?, position?, rotationZ?, visible?, opacity? }
 *   - model    : 백엔드 슬림 지오메트리 { positions, quads, trias, beams, rigids, bounds, ... }
 *   - anchor   : 지오메트리에서 뺄 기준점 [x,y,z]. 회전 중심이자 position 의 기준이 된다.
 *   - position : 그룹 배치 위치 [x,y,z]
 *   - rotationZ: Z축 회전(도)
 */

// 화면 방향 프리셋 — 이름은 조선/구조 도면 관례(정면=X, 측면=Y, 평면=Z)를 따른다.
const VIEW_PRESETS = {
  iso:    { dir: [ 1, -1,  0.75], up: [0, 0, 1], label: 'ISO',  key: 'I' },
  top:    { dir: [ 0,  0,  1],    up: [1, 0, 0], label: '평면', key: '1' },
  bottom: { dir: [ 0,  0, -1],    up: [1, 0, 0], label: '저면', key: '2' },
  front:  { dir: [ 0, -1,  0],    up: [0, 0, 1], label: '정면', key: '3' },
  back:   { dir: [ 0,  1,  0],    up: [0, 0, 1], label: '배면', key: '4' },
  right:  { dir: [ 1,  0,  0],    up: [0, 0, 1], label: '우측', key: '5' },
  left:   { dir: [-1,  0,  0],    up: [0, 0, 1], label: '좌측', key: '6' },
};

const DISPLAY_MODES = [
  { id: 'shadedEdges', label: '쉐이딩+경계선' },
  { id: 'shaded',      label: '쉐이딩' },
  { id: 'wireframe',   label: '와이어프레임' },
];

const BG_TOP    = '#243347';
const BG_BOTTOM = '#0d1420';

/** 세로 그라디언트 배경 — 단색보다 깊이감이 살고 밝은 면/어두운 면이 모두 읽힌다. */
function makeBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 슬림 모델 페이로드 → three.js 오브젝트 묶음.
 * 반환된 group 은 씬에 바로 넣을 수 있고, 표시 토글에 필요한 핸들을 함께 돌려준다.
 */
function buildPartObjects(model, { color, anchor }) {
  const positions = Float32Array.from(model.positions || []);
  const nodeCount = positions.length / 3;

  // anchor 를 빼서 회전 중심과 배치 기준점을 그룹 원점으로 옮긴다.
  if (anchor) {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i]     -= anchor[0];
      positions[i + 1] -= anchor[1];
      positions[i + 2] -= anchor[2];
    }
  }

  const group = new THREE.Group();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const baseColor = new THREE.Color(color);

  // ── 쉘 면 ────────────────────────────────────────────────
  let mesh = null;
  const triIndices = buildTriangleIndices(model.quads || [], model.trias || []);
  if (triIndices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', posAttr);
    geom.setIndex(new THREE.BufferAttribute(toIndexArray(triIndices, nodeCount), 1));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const material = new THREE.MeshLambertMaterial({
      color: baseColor,
      side: THREE.DoubleSide,
      transparent: false,
      // 경계선이 면에 파묻혀 점선처럼 끊기는 것(z-fighting)을 막는다.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    mesh = new THREE.Mesh(geom, material);
    group.add(mesh);
  }

  // ── 요소 경계선 ──────────────────────────────────────────
  let edges = null;
  const edgeIndices = buildShellEdgeIndices(model.quads || [], model.trias || [], nodeCount);
  if (edgeIndices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', posAttr);
    geom.setIndex(new THREE.BufferAttribute(toIndexArray(edgeIndices, nodeCount), 1));
    const material = new THREE.LineBasicMaterial({
      color: baseColor.clone().multiplyScalar(0.45),
      transparent: true,
      opacity: 0.85,
    });
    edges = new THREE.LineSegments(geom, material);
    group.add(edges);
  }

  // ── 1D 요소(빔) ──────────────────────────────────────────
  let beams = null;
  if (model.beams?.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', posAttr);
    geom.setIndex(new THREE.BufferAttribute(toIndexArray(model.beams, nodeCount), 1));
    geom.computeBoundingSphere();
    const material = new THREE.LineBasicMaterial({ color: baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.55) });
    beams = new THREE.LineSegments(geom, material);
    group.add(beams);
  }

  // ── 강체 요소(RBE2 등) ───────────────────────────────────
  let rigids = null;
  if (model.rigids?.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', posAttr);
    geom.setIndex(new THREE.BufferAttribute(toIndexArray(model.rigids, nodeCount), 1));
    const material = new THREE.LineBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.75 });
    rigids = new THREE.LineSegments(geom, material);
    rigids.visible = false; // 수천 개라 기본은 숨김 — 필요할 때만 켠다.
    group.add(rigids);
  }

  // ── 절점 ─────────────────────────────────────────────────
  const nodeGeom = new THREE.BufferGeometry();
  nodeGeom.setAttribute('position', posAttr);
  const nodes = new THREE.Points(
    nodeGeom,
    new THREE.PointsMaterial({ color: '#ffd166', size: 2.4, sizeAttenuation: false }),
  );
  nodes.visible = false;
  group.add(nodes);

  return { group, mesh, edges, beams, rigids, nodes };
}

/** 코너 축 표시기(triad) 씬. 메인 씬과 독립적으로 유지된다. */
function createAxisTriad() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.up.set(0, 0, 1);
  const group = new THREE.Group();
  const axes = [
    { dir: [1, 0, 0], color: '#ff6b6b' },
    { dir: [0, 1, 0], color: '#51cf66' },
    { dir: [0, 0, 1], color: '#4dabf7' },
  ];
  axes.forEach(({ dir, color }) => {
    const v = new THREE.Vector3(...dir);
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), v.clone().multiplyScalar(1.1)]);
    group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color })));
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.32, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    cone.position.copy(v.clone().multiplyScalar(1.25));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    group.add(cone);
  });
  scene.add(group);
  return { scene, camera };
}

export default function FeModelViewer({
  parts = [],
  loading = false,
  loadingLabel = '모델을 불러오는 중...',
  error = null,
  errorAction = null,     // 오류 화면 아래에 붙일 조치 버튼(예: 다시 시도)
  overlay = null,           // 뷰포트 위에 겹쳐 그릴 커스텀 노드 (범례·안내 등)
  showGridDefault = true,
  // 썸네일 모드 — 툴바·파트 목록·상태바를 모두 숨기고 카메라 조작도 끈다.
  // 정반 타입 선택 카드처럼 '형상만 보여 주는' 정적 미리보기에 쓴다.
  // (드래그 회전을 살려 두면 카드 클릭 선택과 제스처가 충돌한다.)
  chrome = true,
}) {
  // ⚠ 루트의 min-h 는 낮게 유지한다 — 부모 컨테이너의 안쪽 높이보다 커지면
  //    부모 overflow-hidden 에 우하단 파트 패널과 하단 상태바가 잘린다.
  const containerRef = useRef(null);
  const mountRef     = useRef(null);
  const sceneRef     = useRef(null);
  const cameraRef    = useRef(null);
  const rendererRef  = useRef(null);
  const controlsRef  = useRef(null);
  const gridRef      = useRef(null);
  const triadRef     = useRef(null);
  const frameRef     = useRef(0);
  const boundsRef    = useRef({ center: new THREE.Vector3(), radius: 1000, box: new THREE.Box3() });
  // partId -> buildPartObjects 결과. 표시 토글이 지오메트리를 다시 만들지 않도록 보관한다.
  const partObjectsRef = useRef(new Map());

  const [displayMode,  setDisplayMode]  = useState('shadedEdges');
  const [showGrid,     setShowGrid]     = useState(showGridDefault);
  const [showNodes,    setShowNodes]    = useState(false);
  const [showRigids,   setShowRigids]   = useState(false);
  const [orthographic, setOrthographic] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hidden,       setHidden]       = useState(() => new Set());
  const [readout,      setReadout]      = useState(null);

  /* ── 온디맨드 렌더 ─────────────────────────────────────── */
  const renderFrame = useCallback(() => {
    frameRef.current = 0;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(scene, camera);

    // 코너 축 표시기 — 같은 렌더러의 우하단 영역에만 그린다.
    const triad = triadRef.current;
    if (triad) {
      const size = Math.round(Math.min(120, Math.max(72, renderer.domElement.clientWidth * 0.11)));
      const pad = 12;
      renderer.setScissorTest(true);
      renderer.setViewport(pad, pad, size, size);
      renderer.setScissor(pad, pad, size, size);
      // autoClear=false 라 깊이 버퍼에 메인 씬 값이 남아 있다 —
      // 지우지 않으면 모델 뒤에 가려 축 표시기가 안 보인다.
      renderer.clearDepth();
      triad.camera.position.copy(camera.position).sub(boundsRef.current.center).normalize().multiplyScalar(4);
      triad.camera.up.copy(camera.up);
      triad.camera.lookAt(0, 0, 0);
      renderer.render(triad.scene, triad.camera);
      renderer.setScissorTest(false);
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      renderer.setViewport(0, 0, w, h);
    }
  }, []);

  const requestRender = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  /* ── 씬 초기화 (마운트 1회) ─────────────────────────────── */
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;

    const width  = el.clientWidth  || 800;
    const height = el.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = makeBackgroundTexture();

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 5_000_000);
    camera.up.set(0, 0, 1);
    camera.position.set(1, -1, 0.75).multiplyScalar(1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    // 조명은 카메라에 붙인다 — 시점을 돌려도 면 밝기가 변하지 않아 형상 판독이 안정적이다.
    const key  = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.4, 0.6, 1);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.9);
    fill.position.set(-0.7, -0.3, 0.4);
    camera.add(key, fill);
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.0));

    const controls = new OrbitControls(camera, renderer.domElement);
    // damping 을 끄면 조작이 끝나는 즉시 화면이 멎는다 → 온디맨드 렌더가 성립하고
    // 회전감도 상용 FE GUI 처럼 절도 있게 떨어진다.
    controls.enableDamping = false;
    // 썸네일 모드는 카드 클릭이 곧 선택이므로 카메라 조작을 막는다.
    controls.enabled = chrome;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.addEventListener('change', requestRender);

    const grid = new THREE.GridHelper(1000, 40, 0x3f5570, 0x2b3a4e);
    grid.rotation.x = Math.PI / 2;   // GridHelper 는 Y-up 기준이라 Z-up 씬에서는 눕혀야 한다.
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    scene.add(grid);

    // 이 앱은 keep-alive 페이지마다 3D 뷰어를 붙들고 있어 브라우저의 WebGL 컨텍스트 상한에
    // 걸릴 수 있다. 컨텍스트를 잃으면 기본 동작은 '영구 정지'라, 복구 시 다시 그리도록 잡아 둔다.
    const canvas = renderer.domElement;
    const onContextLost = (e) => { e.preventDefault(); cancelAnimationFrame(frameRef.current); frameRef.current = 0; };
    const onContextRestored = () => { frameRef.current = 0; requestRender(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    gridRef.current = grid;
    // 썸네일 모드에서는 축 표시기도 생략한다 — 작은 카드에서는 형상만 보이는 게 낫다.
    triadRef.current = chrome ? createAxisTriad() : null;

    const resizeObserver = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const cam = cameraRef.current;
      if (cam.isOrthographicCamera) {
        const halfH = (cam.top - cam.bottom) / 2;
        cam.left = -halfH * (w / h);
        cam.right = halfH * (w / h);
      } else {
        cam.aspect = w / h;
      }
      cam.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(el);

    requestRender();

    return () => {
      cancelAnimationFrame(frameRef.current);
      // ⚠ 반드시 0 으로 되돌린다. StrictMode(dev) 는 마운트 시 effect 를
      //    setup→cleanup→setup 으로 두 번 돌린다. 여기서 초기화하지 않으면 두 번째 setup
      //    이후 requestRender() 가 'if (frameRef.current) return' 에 걸려 **영원히 한 프레임도
      //    예약하지 않는다** → 캔버스가 새까맣게 비어 보인다(배경 그라디언트조차 안 그려짐).
      frameRef.current = 0;
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      scene.traverse(obj => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach(m => m.dispose());
      });
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      triadRef.current?.scene.traverse(obj => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach(m => m.dispose());
      });
      triadRef.current = null;
      renderer.dispose();
      renderer.forceContextLoss?.();
      try { el.removeChild(renderer.domElement); } catch { /* 이미 제거됨 */ }
      sceneRef.current = null;
      partObjectsRef.current.clear();
    };
    // requestRender 는 안정 참조(useCallback[renderFrame]) — 씬은 마운트 시 1회만 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 카메라 배치 ───────────────────────────────────────── */
  /**
   * 주어진 시선 방향에서 모델이 화면을 꽉 채우도록 카메라를 놓는다.
   *
   * ⚠ 바운딩 '구'로 거리를 잡으면 안 된다. 정반처럼 납작하고 넓은 모델은 대각선 반지름이
   *   정면도의 실제 높이보다 2~3배 커서, 모델이 화면 한가운데 조그맣게 박힌다.
   *   여기서는 바운딩박스 8개 꼭짓점을 화면 축(가로/세로/깊이)에 투영해
   *   그 방향에서 실제로 필요한 화각만큼만 물러선다.
   */
  const frameCamera = useCallback((dirArr, upArr) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const el = mountRef.current;
    if (!camera || !controls || !el) return;

    const { center, box } = boundsRef.current;
    if (!box || box.isEmpty()) return;

    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const dir = new THREE.Vector3(...dirArr).normalize();      // 중심 → 카메라
    const upHint = new THREE.Vector3(...upArr).normalize();
    // 카메라 로컬축: X(화면 오른쪽) = up × dir, Y(화면 위) = dir × X
    const right = new THREE.Vector3().crossVectors(upHint, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();

    let hx = 0, hy = 0, hz = 0;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).sub(center);
      hx = Math.max(hx, Math.abs(corner.dot(right)));
      hy = Math.max(hy, Math.abs(corner.dot(up)));
      hz = Math.max(hz, Math.abs(corner.dot(dir)));
    }

    const pad = 1.1;   // 화면 가장자리에 살짝 여백
    let distance;
    if (camera.isOrthographicCamera) {
      const halfH = Math.max(hy, hx / aspect) * pad;
      camera.top = halfH; camera.bottom = -halfH;
      camera.left = -halfH * aspect; camera.right = halfH * aspect;
      distance = hz * 2 + Math.max(hx, hy, hz);
    } else {
      const vfov = (camera.fov * Math.PI) / 360;
      const hfov = Math.atan(Math.tan(vfov) * aspect);
      distance = Math.max(hy * pad / Math.tan(vfov), hx * pad / Math.tan(hfov)) + hz;
    }

    camera.up.copy(upHint);
    camera.position.copy(center).addScaledVector(dir, distance);
    controls.target.copy(center);
    camera.near = Math.max(distance / 5000, 0.01);
    camera.far  = distance + Math.max(hx, hy, hz) * 8;
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }, [requestRender]);

  const applyView = useCallback((presetId) => {
    const preset = VIEW_PRESETS[presetId] ?? VIEW_PRESETS.iso;
    frameCamera(preset.dir, preset.up);
  }, [frameCamera]);

  /** 현재 시점 방향을 유지한 채 다시 화면에 맞춘다(상용 GUI 의 Fit 동작). */
  const fitView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() === 0) { applyView('iso'); return; }
    frameCamera(dir.normalize().toArray(), camera.up.toArray());
  }, [frameCamera, applyView]);

  /* ── 파트 지오메트리 구축 ──────────────────────────────── */
  // parts 의 model/anchor 가 바뀔 때만 재구축한다(위치·회전·표시 변경은 아래 effect 들이 담당).
  const partsSignature = useMemo(
    () => parts.map(p => `${p.id}:${p.model ? p.model.nodeCount : 'x'}:${(p.anchor || []).join(',')}:${p.color}`).join('|'),
    [parts],
  );

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const store = partObjectsRef.current;
    const liveIds = new Set(parts.filter(p => p.model).map(p => p.id));

    // 사라진 파트 정리
    for (const [id, entry] of store) {
      if (liveIds.has(id)) continue;
      scene.remove(entry.group);
      entry.group.traverse(obj => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach(m => m.dispose());
      });
      store.delete(id);
    }

    // 새 파트 구축
    parts.forEach(part => {
      if (!part.model || store.has(part.id)) return;
      const entry = buildPartObjects(part.model, { color: part.color || '#8aa0b8', anchor: part.anchor });
      store.set(part.id, entry);
      scene.add(entry.group);
    });

    if (store.size === 0) {
      requestRender();
      return;
    }

    // 전체 바운딩 — 카메라 프리셋과 그리드 크기의 기준.
    const box = new THREE.Box3();
    parts.forEach(part => {
      const entry = store.get(part.id);
      if (!entry) return;
      entry.group.position.set(...(part.position || [0, 0, 0]));
      entry.group.rotation.z = THREE.MathUtils.degToRad(part.rotationZ || 0);
      entry.group.updateMatrixWorld(true);
      box.expandByObject(entry.group);
    });
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    boundsRef.current = { center, radius: Math.max(size.length() / 2, 1), box: box.clone() };

    const grid = gridRef.current;
    if (grid) {
      const span = Math.max(size.x, size.y) * 1.6;
      grid.scale.setScalar(span / 1000);
      grid.position.set(center.x, center.y, box.min.z);
    }

    setReadout({
      dims: [size.x, size.y, size.z],
      min: box.min.toArray(),
      max: box.max.toArray(),
    });

    applyView('iso');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsSignature]);

  /* ── 배치(위치/회전) 갱신 — 지오메트리 재사용 ───────────── */
  const transformSignature = useMemo(
    () => parts.map(p => `${p.id}:${(p.position || []).join(',')}:${p.rotationZ || 0}`).join('|'),
    [parts],
  );

  useEffect(() => {
    const store = partObjectsRef.current;
    if (store.size === 0) return;
    const box = new THREE.Box3();
    parts.forEach(part => {
      const entry = store.get(part.id);
      if (!entry) return;
      entry.group.position.set(...(part.position || [0, 0, 0]));
      entry.group.rotation.z = THREE.MathUtils.degToRad(part.rotationZ || 0);
      entry.group.updateMatrixWorld(true);
      box.expandByObject(entry.group);
    });
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      // Fit 이 항상 '지금 배치'를 기준으로 동작하도록 경계를 함께 갱신한다.
      boundsRef.current = {
        center: box.getCenter(new THREE.Vector3()),
        radius: Math.max(size.length() / 2, 1),
        box: box.clone(),
      };
      setReadout({ dims: [size.x, size.y, size.z], min: box.min.toArray(), max: box.max.toArray() });
    }
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformSignature]);

  /* ── 표시 상태 반영 ────────────────────────────────────── */
  useEffect(() => {
    const store = partObjectsRef.current;
    parts.forEach(part => {
      const entry = store.get(part.id);
      if (!entry) return;
      const partVisible = !hidden.has(part.id);
      entry.group.visible = partVisible;
      if (entry.mesh) {
        entry.mesh.visible = displayMode !== 'wireframe';
        const opacity = part.opacity ?? 1;
        entry.mesh.material.opacity = opacity;
        entry.mesh.material.transparent = opacity < 1;
        entry.mesh.material.depthWrite = opacity >= 1;
      }
      if (entry.edges)  entry.edges.visible  = displayMode !== 'shaded';
      if (entry.rigids) entry.rigids.visible = showRigids;
      if (entry.nodes)  entry.nodes.visible  = showNodes;
    });
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, showNodes, showRigids, hidden, partsSignature,
      parts.map(p => p.opacity ?? 1).join(',')]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
    requestRender();
  }, [showGrid, requestRender]);

  /* ── 투영 전환 (원근 ↔ 정투영) ─────────────────────────── */
  useEffect(() => {
    const old = cameraRef.current;
    const scene = sceneRef.current;
    const controls = controlsRef.current;
    const el = mountRef.current;
    if (!old || !scene || !controls || !el) return;
    if (orthographic === !!old.isOrthographicCamera) return;

    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const { radius } = boundsRef.current;
    const next = orthographic
      ? new THREE.OrthographicCamera(-radius * 1.15 * aspect, radius * 1.15 * aspect, radius * 1.15, -radius * 1.15, 0.1, radius * 100)
      : new THREE.PerspectiveCamera(45, aspect, Math.max(radius / 5000, 0.01), radius * 100);

    next.up.copy(old.up);
    next.position.copy(old.position);
    // 조명은 카메라의 자식이다 — 카메라를 갈아끼울 때 함께 옮겨야 화면이 어두워지지 않는다.
    [...old.children].forEach(child => next.add(child));
    scene.remove(old);
    scene.add(next);
    cameraRef.current = next;
    controls.object = next;
    next.lookAt(controls.target);
    next.updateProjectionMatrix();
    controls.update();
    requestRender();
  }, [orthographic, requestRender]);

  /* ── 전체화면 ─────────────────────────────────────────── */
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ── 키보드 단축키 ────────────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();
      if (key === 'F') { fitView(); return; }
      const found = Object.entries(VIEW_PRESETS).find(([, v]) => v.key === key);
      if (found) { applyView(found[0]); e.preventDefault(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [applyView, fitView]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const saveScreenshot = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderFrame();
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `fe-model-${Date.now()}.png`;
    a.click();
  };

  const togglePart = (id) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1));
  const loadedParts = parts.filter(p => p.model);
  const totals = loadedParts.reduce((acc, p) => ({
    nodes: acc.nodes + (p.model.nodeCount || 0),
    shells: acc.shells + (p.model.quadCount || 0) + (p.model.triaCount || 0),
    beams: acc.beams + (p.model.beamCount || 0),
  }), { nodes: 0, shells: 0, beams: 0 });

  const btn = 'px-2 py-1 rounded-md text-[10px] font-bold transition-colors cursor-pointer border';
  const btnIdle = 'bg-slate-800/70 border-slate-600/60 text-slate-300 hover:bg-slate-700 hover:text-white';
  const btnOn = 'bg-blue-600 border-blue-400 text-white';

  // 썸네일 모드는 min-h 를 두지 않는다 — 카드의 고정 높이보다 캔버스가 커지면
  // 넘쳐 흘러 카드 제목과 Spec 첫 행을 덮어 버린다.
  const rootMinH = chrome ? 'min-h-[240px]' : 'min-h-0';

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative w-full h-full ${rootMinH} bg-slate-900 outline-none`}
    >
      <div ref={mountRef} className="absolute inset-0" />

      {/* ── 상단 툴바 ── */}
      {chrome && (
      <div className="absolute top-2 left-2 right-2 flex flex-wrap items-start gap-2 pointer-events-none">
        <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 backdrop-blur px-1.5 py-1 border border-slate-700/70 pointer-events-auto">
          <span className="px-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">뷰</span>
          {Object.entries(VIEW_PRESETS).map(([id, preset]) => (
            <button
              key={id}
              onClick={() => applyView(id)}
              title={`${preset.label} (${preset.key})`}
              className={`${btn} ${btnIdle}`}
            >
              {preset.label}
            </button>
          ))}
          <button onClick={fitView} title="현재 시점에서 전체 맞춤 (F)" className={`${btn} ${btnIdle} flex items-center gap-1`}>
            <Crosshair size={10} /> 맞춤
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 backdrop-blur px-1.5 py-1 border border-slate-700/70 pointer-events-auto">
          <span className="px-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">표시</span>
          {DISPLAY_MODES.map(mode => (
            <button
              key={mode.id}
              onClick={() => setDisplayMode(mode.id)}
              className={`${btn} ${displayMode === mode.id ? btnOn : btnIdle}`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 backdrop-blur px-1.5 py-1 border border-slate-700/70 pointer-events-auto ml-auto">
          <button onClick={() => setOrthographic(v => !v)} title="원근 / 정투영 전환" className={`${btn} ${orthographic ? btnOn : btnIdle}`}>
            <Box size={10} className="inline mr-0.5" />{orthographic ? '정투영' : '원근'}
          </button>
          <button onClick={() => setShowGrid(v => !v)} title="바닥 격자" className={`${btn} ${showGrid ? btnOn : btnIdle}`}>
            <Grid3x3 size={10} />
          </button>
          <button onClick={() => setShowNodes(v => !v)} title="절점 표시" className={`${btn} ${showNodes ? btnOn : btnIdle}`}>
            절점
          </button>
          <button onClick={() => setShowRigids(v => !v)} title="강체 요소(RBE) 표시" className={`${btn} ${showRigids ? btnOn : btnIdle}`}>
            강체
          </button>
          <button onClick={saveScreenshot} title="화면 저장 (PNG)" className={`${btn} ${btnIdle}`}>
            <Camera size={10} />
          </button>
          <button onClick={toggleFullscreen} title="전체화면" className={`${btn} ${btnIdle}`}>
            {isFullscreen ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
          </button>
          <button
            title={'좌드래그 회전 · 우드래그 이동 · 휠 확대\nF 전체 맞춤 · I 등각 · 1~6 표준뷰'}
            className={`${btn} ${btnIdle} cursor-help`}
          >
            <HelpCircle size={10} />
          </button>
        </div>
      </div>
      )}

      {/* ── 파트 목록 ── */}
      {chrome && loadedParts.length > 0 && (
        <div className="absolute bottom-2 right-2 w-52 rounded-lg bg-slate-900/85 backdrop-blur border border-slate-700/70 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-700/70">
            <Layers size={11} className="text-slate-400" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">구성 파트</span>
          </div>
          {loadedParts.map(part => {
            // 파트별 요소 수는 툴팁으로 뺀다 — 패널이 낮아야 짧은 뷰포트에서 잘리지 않는다.
            const shells = (part.model.quadCount || 0) + (part.model.triaCount || 0);
            const stats = `절점 ${(part.model.nodeCount || 0).toLocaleString()} · 쉘 ${shells.toLocaleString()} · 빔 ${(part.model.beamCount || 0).toLocaleString()}`;
            return (
              <button
                key={part.id}
                onClick={() => togglePart(part.id)}
                title={`${part.name}
${stats}
(클릭하여 표시/숨김)`}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800/70 transition-colors cursor-pointer text-left"
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: part.color }} />
                <span className={`flex-1 min-w-0 text-[10px] font-semibold truncate ${hidden.has(part.id) ? 'text-slate-600 line-through' : 'text-slate-200'}`}>
                  {part.name}
                </span>
                <span className="text-[9px] font-mono text-slate-500 shrink-0">{shells ? `${Math.round(shells / 1000)}k` : `${Math.round((part.model.beamCount || 0) / 1000)}k`}</span>
                {hidden.has(part.id)
                  ? <EyeOff size={11} className="text-slate-600 shrink-0" />
                  : <Eye size={11} className="text-slate-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {/* ── 하단 상태바 ── */}
      {/* 좌하단 축 표시기(약 140px)와 우하단 파트 패널(약 220px) 사이에만 놓는다. */}
      {chrome && (
      <div className="absolute bottom-2 left-[140px] right-[228px] flex items-end pointer-events-none">
        <div className="rounded-lg bg-slate-900/80 backdrop-blur border border-slate-700/70 px-2.5 py-1.5 max-w-full">
          <p className="text-[9px] font-mono text-slate-400 truncate">
            절점 {totals.nodes.toLocaleString()} · 쉘 {totals.shells.toLocaleString()} · 빔 {totals.beams.toLocaleString()}
          </p>
          {readout && (
            <p className="text-[9px] font-mono text-slate-500 mt-0.5 truncate">
              전체 치수 {fmt(readout.dims[0])} × {fmt(readout.dims[1])} × {fmt(readout.dims[2])} mm
            </p>
          )}
        </div>
      </div>
      )}

      {overlay}

      {/* ── 로딩 / 오류 ── */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/70 backdrop-blur-sm">
          <Loader2 size={30} className="animate-spin text-blue-400" />
          <p className="text-xs font-semibold text-slate-300">{loadingLabel}</p>
        </div>
      )}
      {!loading && error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80 px-8 text-center">
          <AlertTriangle size={30} className="text-amber-400" />
          <p className="text-xs font-semibold text-amber-200">모델을 표시할 수 없습니다</p>
          <p className="text-[11px] text-slate-400 max-w-md leading-relaxed">{error}</p>
          {errorAction}
        </div>
      )}
    </div>
  );
}
