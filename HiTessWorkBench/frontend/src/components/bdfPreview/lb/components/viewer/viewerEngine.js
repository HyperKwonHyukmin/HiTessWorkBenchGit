/**
 * BDF 3D 뷰어 엔진(설계 §7.3, 04c) — three.js 는 이 파일 한 곳에만 둔다.
 *
 * WorkBench `FeModelViewer.jsx`·`utils/feModelCamera.js` 에서 이식했고, 04c 에서 Model Builder Studio 의
 * 확인 기능(3D 단면·연결 그룹·절점 점검·자르기·원근·축 표시)을 더했다.
 *  · 온디맨드 렌더: 상시 루프를 돌리지 않고 카메라·표시 상태가 바뀔 때만 한 프레임 그린다.
 *    OrbitControls 의 damping 도 끈다(조작이 끝나는 즉시 화면이 멎어야 온디맨드가 성립한다).
 *    렌더 한 번에 새 객체를 만들지 않는다(축 표시도 미리 만든 객체만 쓴다).
 *  · 카메라에 붙인 조명: 시점을 돌려도 면 밝기가 변하지 않는다(직교·원근 전환 때 조명을 옮겨 붙인다).
 *  · 조작: 왼쪽 회전, 가운데 확대, 오른쪽 이동, zoomToCursor.
 *  · webglcontextlost 복구.
 *  · ⚠ StrictMode 함정: dispose 에서 예약된 프레임 번호를 반드시 0 으로 되돌린다. StrictMode(dev) 는
 *    effect 를 setup→cleanup→setup 으로 두 번 돌리는데, 0 으로 돌리지 않으면 이후 requestRender() 가
 *    'if (frame) return' 에 걸려 영원히 한 프레임도 예약하지 않는다(캔버스가 비어 보인다).
 *
 * 그룹 숨김·그룹 색은 재질을 다시 만들지 않고 셰이더로 한다: 절점마다 그룹 번호(lbGroup 속성)를 두고,
 * 그룹별 보이기 표(1×N 텍스처)를 정점 셰이더가 읽어 숨긴 그룹의 정점을 화면 밖으로 보낸다.
 * 한 요소의 절점은 모두 같은 그룹이라(연결 그룹의 정의) 요소 단위로 깔끔하게 사라진다.
 *
 * 계약(ModelViewer 와 테스트의 가짜 엔진이 같은 모양을 쓴다):
 *   setModel(geometry, { edges, extras }) · setGroupVisible(pid, visible) · setEdges(visible)
 *   setMarkers({ rbe2, rbe3, conm2, spc }) · setView(presetId) · fit() · pickAt(clientX, clientY) → { kind, index }|null
 *   highlight({ kind, index }|null) · dispose()
 *   04c: setGroupsVisible(mask) · setColorMode(mode) · setRenderMode(mode, { onProgress }) → Promise
 *        setNodes({ visible, classes }) · setClip({ axis, position, flip }|null) · setProjection('ortho'|'persp')
 *        setIsolate({ kind, index }|null) · frameNodes(indices)
 *   06: setNodeSet(indices|null, { color }) — 절점 묶음 강조(해석 검증의 고정 노드). null 이면 지운다.
 *   07(비교 화면): getCameraState() · setCameraState(state) · onCameraChange(cb) → 해제 함수
 *        setPidHighlight(pids|null) → 찾은 PID 수. 카메라 상태 모양은 lib/cameraSync.js.
 *   16(판 변경 보기): setDiff(spec|null) · setDiffLayers(layers) · setDiffFocus(focus|null) · frameDiff()
 *        spec = { buffers(diffIndexBuffers), rigid(rigidIndexBuffers), nodes{added,moved,spc}, elemClass, ghost(ghostGeometry) }
 *        — 변경 없는 부분은 기존 PID 묶음을 회색·반투명으로, 바뀐 것은 공유 위치 버퍼 + 범주 인덱스 버퍼로 덮어 그린다.
 *        피킹 결과에 { kind: 'ghost', index }(삭제 요소·강체 = spec.ghost.items 순번) · { kind: 'ghost-node', index } 가 더해진다.
 *   extras = { blocks, groups(computeGroups), check(classifyNodes), rigids(listRigids), plan(planSections), orient, offsets }
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { computeFrame, nodeBounds, perspectiveDistance, VIEW_PRESETS } from '../../lib/viewFrame.js';
import { decodePick } from '../../lib/modelGeometry.js';
import {
  AXIS_COLORS, DIFF_COLORS, GROUP_COLORS, MARKER_COLORS, NO_GROUP_COLOR, NODE_CLASS_COLORS, SELECTION_COLORS,
  cardColor, pidColor, sectionColor,
} from '../../lib/pidPalette.js';
import { fillBeamFrames } from '../../lib/beamFrame.js';
import { elementNodeIndices, rigidNodes } from '../../lib/modelIndex.js';
import { orthoZoom } from '../../lib/cameraSync.js';

// Model Builder Studio(ThreeViewport) 와 같은 바탕·축 표시 바탕. ⚠ index.css 토큰 --color-viewer 와 같은 값.
const BACKGROUND = 0x1a1a2e;
const GIZMO_BACKGROUND = 0x0d0d1a;
const MARKER_SIZES = { conm2: 8, spc: 7 };
const NODE_PX = 6;
/** 강조 절점 묶음(06 고정 노드) 점 크기 — SPC 마커(7)보다 크게. */
const NODE_SET_PX = 10;
// 선택 강조 — Studio SelectionHighlight.js 크기: 부재 코어 6px·외곽 10px, 절점 코어 14px·외곽 18px.
const SEL = { core: SELECTION_COLORS.core, outline: SELECTION_COLORS.outline, elemPx: 6, elemOutlinePx: 10, nodePx: 14, nodeOutlinePx: 18 };
// 면·단면 재질 — Studio 원통·3D 단면 모드와 같은 MeshStandardMaterial 값
const STANDARD = { metalness: 0.15, roughness: 0.55, flatShading: true };
const PICK_SIZE = 5;
/** 절점 화면 피킹 반경(CSS px) */
const NODE_PICK_PX = 7;
const UP = new THREE.Vector3(0, 0, 1);
const FOV = 35;
const GIZMO_PX = 92;
const GIZMO_MARGIN = 10;
/** 단면 행렬을 한 번에 채우는 개수 — 그 사이에 화면이 진행률을 그린다. */
const SECTION_CHUNK = 20000;
/** PID 강조(07)에서 1D 를 화면 고정 굵기 선으로 그리는 상한 — 넘으면 1px 선. */
const PID_FAT_LIMIT = 200000;
const EDGE_NEUTRAL = 0x0b0b16;
const EMPTY_PLANES = [];

function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => { if (!m.userData?.sharedMap) m.map?.dispose?.(); m.dispose(); });
  });
}

/** GPU 에 올린 뒤 CPU 쪽 배열을 버린다(피킹 기하는 다시 읽지 않는다). this = BufferAttribute. */
function dropArray() {
  this.array = null;
}

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

/** 둥근 점(강조·선택만 보기) — 작은 원 텍스처 하나를 같이 쓴다. */
let discTexture = null;
function disc() {
  if (discTexture) return discTexture;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  }
  discTexture = new THREE.CanvasTexture(c);
  return discTexture;
}
/** 빈 고리(삭제 절점) — 색약 보조 모양. */
let ringTexture = null;
function ring() {
  if (ringTexture) return ringTexture;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ringTexture = new THREE.CanvasTexture(c);
  return ringTexture;
}
const nextTick = () => new Promise((r) => { setTimeout(r, 0); });

/* ── 셰이더 고리: 그룹 숨김·그룹 색·절점 분류 ─────────────────────────────────────── */

const VERT_PARS = /* glsl */`
attribute float lbGroup;
varying float vLbGroup;
uniform sampler2D uGroupVis;
uniform float uGroupVisW;
uniform float uNoGroup;
`;
const VERT_HIDE = /* glsl */`
vLbGroup = lbGroup;
{
  float lbG = lbGroup < -0.5 ? uNoGroup : lbGroup;
  ivec2 lbC = ivec2(int(mod(lbG, uGroupVisW)), int(floor(lbG / uGroupVisW)));
  if (texelFetch(uGroupVis, lbC, 0).r < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FRAG_PARS = /* glsl */`
varying float vLbGroup;
uniform float uColorByGroup;
uniform vec3 uGroupPalette[${GROUP_COLORS.length}];
uniform vec3 uNoGroupColor;
`;
const FRAG_GROUP_COLOR = /* glsl */`
if (uColorByGroup > 0.5) {
  diffuseColor.rgb = vLbGroup < -0.5 ? uNoGroupColor
    : uGroupPalette[int(mod(floor(vLbGroup + 0.5), ${GROUP_COLORS.length}.0))];
}
`;
const NODE_VERT_PARS = /* glsl */`
attribute float lbClass;
varying float vLbClass;
uniform vec3 uClassMask;
uniform float uDepthBias;
`;
const NODE_VERT = /* glsl */`
vLbClass = lbClass;
{
  int lbK = int(lbClass + 0.5);
  float lbOn = lbK == 0 ? uClassMask.x : lbK == 1 ? uClassMask.y : uClassMask.z;
  if (lbOn < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // 깊이만 카메라 쪽으로 당긴다 — 절점이 1D 단면·쉘 면에 파묻히지 않게(화면 위치는 그대로).
  gl_Position.z -= uDepthBias * gl_Position.w;
}
`;
const NODE_FRAG_PARS = /* glsl */`
varying float vLbClass;
uniform vec3 uClassColors[3];
`;
const NODE_FRAG = /* glsl */`
{
  vec2 lbP = gl_PointCoord * 2.0 - 1.0;
  float lbR = dot(lbP, lbP);
  if (lbR > 1.0) discard;
  int lbK = int(vLbClass + 0.5);
  vec3 lbCol = lbK == 0 ? uClassColors[0] : lbK == 1 ? uClassColors[1] : uClassColors[2];
  // 바깥 고리를 어둡게 — 밝은 쉘 위에서도 점의 모양이 보이게
  diffuseColor.rgb = lbR > 0.45 ? lbCol * 0.42 : lbCol;
}
`;

/**
 * 재질에 그룹 고리를 단다. colorable = 그룹 색 칠하기에 참여(면·1D), node = 절점 점 모양.
 * uniforms 는 모델마다 하나(공유)라 값만 바꾸면 모든 재질이 따라온다.
 */
function hook(material, uniforms, { colorable = false, node = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const vs = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}${node ? NODE_VERT_PARS : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_HIDE}${node ? NODE_VERT : ''}`);
    let fs = shader.fragmentShader;
    if (colorable || node) {
      fs = fs.replace('#include <common>', `#include <common>\n${FRAG_PARS}${node ? NODE_FRAG_PARS : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${node ? NODE_FRAG : FRAG_GROUP_COLOR}`);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => `lb:${colorable ? 'c' : ''}${node ? 'n' : ''}`;
  return material;
}

/** 단면 윤곽 → x∈[0,1] 로 밀어낸 기하(국부 좌표 x, y, z). 인스턴스 행렬이 놓는다. */
function extrudeProfile(profile) {
  const rings = [profile.outer, ...(profile.hole ? [profile.hole] : [])];
  const n = rings.reduce((s, r) => s + r.length, 0);
  const pos = new Float32Array(n * 2 * 3);
  let v = 0;
  const ringStart = [];
  for (const ring of rings) {
    ringStart.push(v);
    for (const [y, z] of ring) {
      pos[v * 3] = 0; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      pos[(v + n) * 3] = 1; pos[(v + n) * 3 + 1] = y; pos[(v + n) * 3 + 2] = z;
      v += 1;
    }
  }
  const idx = [];
  rings.forEach((ring, ri) => {
    const s = ringStart[ri];
    for (let i = 0; i < ring.length; i += 1) {
      const a = s + i; const b = s + ((i + 1) % ring.length);
      idx.push(a, b, b + n, a, b + n, a + n);
    }
  });
  // 마구리 — 바깥 윤곽 + 구멍을 삼각형으로
  const contour = profile.outer.map(([y, z]) => new THREE.Vector2(y, z));
  const holes = profile.hole ? [profile.hole.map(([y, z]) => new THREE.Vector2(y, z))] : [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    idx.push(a, c, b, a + n, b + n, c + n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** 축 표시(gizmo) — 축 선 셋 + X·Y·Z 글자. 한 번 만들고 렌더마다 카메라 회전만 따라간다. */
function createGizmo() {
  const scene = new THREE.Scene();
  const axes = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]];
  const pos = []; const col = [];
  for (const [k, d] of axes) {
    const c = new THREE.Color(AXIS_COLORS[k]);
    pos.push(0, 0, 0, ...d);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })));
  for (const [k, d] of axes) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = '600 46px "Pretendard Variable", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = AXIS_COLORS[k];
      ctx.fillText(k.toUpperCase(), 32, 34);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.position.set(d[0] * 1.3, d[1] * 1.3, d[2] * 1.3);
    sprite.scale.setScalar(0.62);
    scene.add(sprite);
  }
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, -10, 10);
  return { scene, camera };
}

export function createViewerEngine(container) {
  const width0 = container.clientWidth || 800;
  const height0 = container.clientHeight || 500;

  // 렌더러 생성 실패(WebGL 없음)는 그대로 던진다 — 화면이 "3D 를 표시할 수 없습니다"로 받는다.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(width0, height0, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  // feModelCamera.createFeOrthographicCamera 와 같은 모양. 실제 범위는 setView 가 잡는다.
  const aspect0 = width0 / height0;
  const ortho = new THREE.OrthographicCamera(-aspect0, aspect0, 1, -1, -100, 100);
  const persp = new THREE.PerspectiveCamera(FOV, aspect0, 0.1, 1000);
  // ⚠ camera.up 은 늘 +Z 로 둔다. OrbitControls 는 생성 시점의 up 으로 회전 기준을 고정하므로,
  //   평면도에서 up 을 +Y 로 바꾸면 이후 회전이 엉뚱한 축을 돈다. 평면도의 ↑Y 는 applyFrame 이
  //   카메라를 -Y 쪽으로 아주 조금 기울여 만든다.
  ortho.up.copy(UP);
  persp.up.copy(UP);
  let camera = ortho;

  // 조명 — Studio ThreeViewport 와 같은 값: 반구광 1.25 + 주변광 0.28 + 주광 0.55 + 차가운 테두리광 0.35,
  // 그리고 카메라에 붙인 헤드라이트 1.0(시점을 돌려도 보는 쪽 면이 늘 밝다).
  scene.add(new THREE.HemisphereLight(0xd8eaff, 0x3d3d48, 1.25));
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
  keyLight.position.set(4, -5, 7);
  const rimLight = new THREE.DirectionalLight(0x9fc8ff, 0.35);
  rimLight.position.set(-5, 4, 5);
  scene.add(keyLight, rimLight);
  const lights = new THREE.Group();
  const headLight = new THREE.DirectionalLight(0xffffff, 1.0);
  headLight.position.set(0.5, 1, 0.5);
  lights.add(headLight);
  camera.add(lights);
  scene.add(ortho, persp);

  const gizmo = createGizmo();
  let clipPlanes = EMPTY_PLANES;
  const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  let frame = 0;
  function drawGizmo() {
    renderer.clippingPlanes = EMPTY_PLANES;
    renderer.autoClear = false;
    // 축 표시 자리만 더 깊은 바탕으로 칠한다(Studio 와 같은 인셋).
    renderer.setScissorTest(true);
    renderer.setScissor(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_PX, GIZMO_PX);
    renderer.setViewport(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_PX, GIZMO_PX);
    renderer.setClearColor(GIZMO_BACKGROUND, 1);
    renderer.clear();
    renderer.setScissorTest(false);
    renderer.setClearColor(BACKGROUND, 1);
    gizmo.camera.quaternion.copy(camera.quaternion);
    gizmo.camera.updateMatrixWorld();
    renderer.render(gizmo.scene, gizmo.camera);
    const { w, h } = viewSize();
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;
    renderer.clippingPlanes = clipPlanes;
  }
  const renderFrame = () => {
    frame = 0;
    renderer.clippingPlanes = clipPlanes;
    renderer.render(scene, camera);
    if (geometry) drawGizmo();
  };
  const requestRender = () => {
    if (frame) return;
    frame = requestAnimationFrame(renderFrame);
  };

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.addEventListener('change', requestRender);

  // 카메라 바뀜 알림(07 비교 화면 동기화) — 사용자가 돌리거나 시점·맞춤으로 바뀔 때만.
  // setCameraState 가 옮기는 동안은 알리지 않는다(동기화가 서로를 되부르는 고리를 막는다).
  const cameraListeners = new Set();
  let cameraSilent = 0;
  const emitCamera = () => { if (!cameraSilent) for (const cb of cameraListeners) cb(); };
  controls.addEventListener('change', emitCamera);

  // 모델 상태
  let geometry = null;
  let extras = null;
  let positionAttr = null;
  let groupAttr = null;               // 절점마다 그룹 번호(lbGroup)
  let uniforms = null;                // 모델 공유 셰이더 값
  let visTexture = null;
  let modelRoot = null;               // PID 묶음들
  const groupObjs = new Map();        // pid → { root, shell, edges, beams, beamMats, shellMats, edgeMat }
  const hiddenPids = new Set();
  let edgesOn = true;
  let colorMode = 'pid';
  let renderMode = 'line';
  let markerRoot = null;
  const markerObjs = {};              // rbe2·rbe3·conm2·spc → Object3D
  let markerState = { rbe2: true, rbe3: true, conm2: true, spc: true };
  let nodePoints = null;
  let nodeSetObj = null;              // 강조할 절점 묶음(06 해석 검증 고정 노드)
  let nodeState = { visible: false, classes: [true, true, true] };
  let section = null;                 // { root, meshes: [{ mesh, bucket, mat }], pick: Map(pid → Group) }
  let sectionJob = 0;                 // 진행 중인 단면 만들기 표(바뀌면 그만둔다)
  let groupMask = null;               // Uint8Array(groupCount + 1) — 마지막 칸 = 그룹 없음(항상 보임)
  let highlightObj = null;
  let pidHighlightObj = null;         // PID 강조(07 비교 패널의 속성 행)
  let isolate = null;                 // { obj, nodes }
  let clip = null;
  let pick = null;                    // { scene, groups: Map(pid → Object3D), rigid: { rbe2, rbe3 }, target }
  let diff = null;                    // 16 판 변경 보기 — { spec, layers, root, layer: {key: Object3D[]}, pick, section, focus }

  function viewSize() {
    return { w: container.clientWidth || 1, h: container.clientHeight || 1 };
  }

  function disposePick() {
    if (!pick) return;
    disposeTree(pick.scene);
    pick.target.dispose();
    pick = null;
  }

  /* ── 피킹 장면: 불러온 뒤 한가할 때 만든다. 그 전에 클릭이 오면 pickAt 이 바로 만든다. ── */
  let idleHandle = null;
  const hasIdle = typeof window.requestIdleCallback === 'function';
  function cancelIdlePick() {
    if (idleHandle == null) return;
    if (hasIdle) window.cancelIdleCallback(idleHandle); else clearTimeout(idleHandle);
    idleHandle = null;
  }

  // 브라우저의 WebGL 문맥 상한에 걸려 문맥을 잃으면 기본 동작은 '영구 정지'다. 복구되면 다시 그린다.
  const onContextLost = (e) => { e.preventDefault(); cancelAnimationFrame(frame); frame = 0; cancelIdlePick(); };
  // 피킹 기하는 올린 뒤 CPU 배열을 버렸으므로 문맥이 돌아오면 새로 만든다.
  const onContextRestored = () => {
    frame = 0;
    disposePick();
    if (geometry) scheduleIdlePick();
    requestRender();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /** 공유 위치·그룹 속성 + 인덱스로 만든 기하. */
  function indexedGeometry(index) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', positionAttr);
    g.setAttribute('lbGroup', groupAttr);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }

  function clearHighlight() {
    if (!highlightObj) return;
    scene.remove(highlightObj);
    disposeTree(highlightObj);
    highlightObj = null;
  }

  function clearIsolate() {
    if (!isolate) return;
    scene.remove(isolate.obj);
    disposeTree(isolate.obj);
    isolate = null;
  }

  function clearPidHighlight() {
    if (!pidHighlightObj) return;
    scene.remove(pidHighlightObj);
    disposeTree(pidHighlightObj);
    pidHighlightObj = null;
  }

  function clearNodeSet() {
    if (!nodeSetObj) return;
    scene.remove(nodeSetObj);
    disposeTree(nodeSetObj);
    nodeSetObj = null;
  }

  function clearSection() {
    sectionJob += 1;
    if (!section) return;
    scene.remove(section.root);
    disposeTree(section.root);
    for (const root of section.pick.values()) { root.removeFromParent(); disposeTree(root); }
    section = null;
  }

  function clearModel() {
    cancelIdlePick();
    clearHighlight();
    clearIsolate();
    clearNodeSet();
    clearPidHighlight();
    clearDiff();
    clearSection();
    disposePick();
    if (modelRoot) { scene.remove(modelRoot); disposeTree(modelRoot); modelRoot = null; }
    if (markerRoot) { scene.remove(markerRoot); disposeTree(markerRoot); markerRoot = null; }
    if (nodePoints) { scene.remove(nodePoints); disposeTree(nodePoints); nodePoints = null; }
    visTexture?.dispose();
    visTexture = null;
    groupObjs.clear();
    hiddenPids.clear();
    for (const k of Object.keys(markerObjs)) delete markerObjs[k];
    geometry = null;
    extras = null;
    positionAttr = null;
    groupAttr = null;
    uniforms = null;
    groupMask = null;
    renderMode = 'line';
  }

  /* ── 카메라 ─────────────────────────────────────────────────────────────────────── */

  /** dir 방향에서 center 둘레 반지름 r 을 화면에 맞춘다(직교·원근 공통). */
  function applyFrame(dir, presetUp, center = [0, 0, 0], r = geometry?.radius) {
    if (!geometry) return;
    const { w, h } = viewSize();
    const aspect = w / h;
    const d = new THREE.Vector3(...dir).normalize();
    const c = new THREE.Vector3(...center);
    const R = geometry.radius;
    if (camera === ortho) {
      const f = computeFrame({ dir: d.toArray(), up: presetUp }, r, aspect);
      ortho.left = -f.halfWidth;
      ortho.right = f.halfWidth;
      ortho.top = f.halfHeight;
      ortho.bottom = -f.halfHeight;
      // 앞뒤 자르기 범위는 모델 전체 기준(작은 대상을 맞춰도 나머지가 잘리지 않게)
      ortho.near = -(R * 20 + r * 4);
      ortho.far = r * 4 + R * 20;
      ortho.zoom = 1;
      ortho.position.copy(c).addScaledVector(d, r * 4);
    } else {
      const dist = perspectiveDistance(r, FOV, aspect);
      persp.aspect = aspect;
      persp.near = Math.max(dist * 1e-3, R * 1e-5);
      persp.far = dist + R * 8;
      persp.position.copy(c).addScaledVector(d, dist);
    }
    // 시선이 Z 와 거의 나란하면(평면도) up=+Z 로는 화면 위쪽이 정해지지 않는다.
    // presetUp 반대쪽으로 아주 조금 물러서면 화면 위쪽이 presetUp 이 된다(→X·↑Y).
    if (Math.abs(d.dot(UP)) > 0.999) {
      const tilt = new THREE.Vector3(...presetUp).normalize().multiplyScalar(-r * 4e-3);
      camera.position.add(tilt);
    }
    camera.up.copy(UP);
    controls.target.copy(c);
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  /** 지금 시선 방향과 화면 위쪽을 유지한 채 다시 맞춘다. */
  function reframe(center, r) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() === 0) dir.set(...VIEW_PRESETS.iso.dir);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    applyFrame(dir.normalize().toArray(), screenUp.toArray(), center, r);
  }

  function setActiveCamera(next) {
    if (next === camera || !geometry) return;
    const target = controls.target.clone();
    const dir = camera.position.clone().sub(target);
    const dist = dir.length() || geometry.radius * 4;
    dir.normalize();
    const { w, h } = viewSize();
    const aspect = w / h;
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    if (next === persp) {
      // 직교 화면 높이를 그대로 담는 거리
      const halfH = (ortho.top - ortho.bottom) / (2 * ortho.zoom);
      const d = halfH / tanHalf;
      persp.aspect = aspect;
      persp.near = Math.max(d * 1e-3, geometry.radius * 1e-5);
      persp.far = d + geometry.radius * 8;
      persp.position.copy(target).addScaledVector(dir, d);
    } else {
      const halfH = dist * tanHalf;
      ortho.top = halfH; ortho.bottom = -halfH;
      ortho.left = -halfH * aspect; ortho.right = halfH * aspect;
      ortho.zoom = 1;
      ortho.near = -geometry.radius * 24;
      ortho.far = geometry.radius * 24;
      ortho.position.copy(target).addScaledVector(dir, geometry.radius * 4);
    }
    next.quaternion.copy(camera.quaternion);
    next.up.copy(UP);
    next.add(lights);
    camera = next;
    camera.updateProjectionMatrix();
    controls.object = camera;
    controls.target.copy(target);
    controls.update();
    requestRender();
  }

  /* ── 보이기·색 ──────────────────────────────────────────────────────────────────── */

  function sectionActive() {
    return renderMode === 'section' && !!section?.ready;
  }

  /** 범위(카드)별 재질 색 — 색 기준에 따라. 그룹 색은 셰이더가 칠한다. */
  function rangeColor(pid, card, sectionType) {
    if (diff) return DIFF_COLORS.unchanged;          // 16 — 변경 보기에서 변경 없는 부분은 회색
    if (colorMode === 'type') return cardColor(card);
    if (colorMode === 'section') return sectionColor(sectionType);
    return pidColor(pid);
  }

  function applyColors() {
    if (!uniforms) return;
    uniforms.uColorByGroup.value = colorMode === 'group' && !diff ? 1 : 0;
    const plan = extras?.plan;
    for (const [pid, o] of groupObjs) {
      const ranges = plan?.ranges.get(pid) || [];
      o.beamMats.forEach((m, i) => m.color.set(rangeColor(pid, o.beamCards[i], ranges[i]?.type || 'LINE')));
      o.shellMats.forEach((m, i) => m.color.set(rangeColor(pid, o.shellCards[i], 'SHELL')));
      if (o.edgeMat) {
        // 경계선은 은은하게 — 면 색을 어둡게 한 선(PID) 또는 바탕 쪽 어두운 선.
        if (colorMode === 'pid' && !diff) o.edgeMat.color.set(pidColor(pid)).multiplyScalar(0.4);
        else o.edgeMat.color.setHex(EDGE_NEUTRAL);
      }
    }
    for (const s of section?.meshes || []) s.mat.color.set(rangeColor(s.bucket.pid, s.bucket.card, s.bucket.section.type));
    requestRender();
  }

  function applyVisibility() {
    const sec = sectionActive();
    const iso = !!isolate;
    if (modelRoot) modelRoot.visible = !iso;
    for (const [pid, o] of groupObjs) {
      const on = !hiddenPids.has(pid);
      o.root.visible = on;
      if (o.edges) o.edges.visible = edgesOn;
      // 3D 단면이 켜지면 단면을 가진 범위의 선만 숨긴다(숨김 재질 = 마지막 칸).
      if (o.beams) {
        const ranges = extras?.plan?.ranges.get(pid) || [];
        o.beams.geometry.groups.forEach((gr, i) => {
          gr.materialIndex = sec && ranges[i]?.sectioned ? o.beamMats.length : i;
        });
      }
      const p = pick?.groups.get(pid);
      if (p) {
        p.visible = on && !iso;
        const lines = p.userData.lines;
        if (lines) {
          const ranges = extras?.plan?.ranges.get(pid) || [];
          lines.geometry.groups.forEach((gr, i) => { gr.materialIndex = sec && ranges[i]?.sectioned ? 1 : 0; });
        }
      }
      const sp = section?.pick.get(pid);
      if (sp) sp.visible = on && sec && !iso;
    }
    if (section) {
      section.root.visible = sec && !iso;
      for (const s of section.meshes) s.mesh.visible = !hiddenPids.has(s.bucket.pid);
    }
    for (const [k, obj] of Object.entries(markerObjs)) obj.visible = !!markerState[k];
    if (markerRoot) markerRoot.visible = !iso;
    if (nodeSetObj) nodeSetObj.visible = !iso;
    if (pidHighlightObj) pidHighlightObj.visible = !iso;
    if (pick?.rigid) {
      for (const k of ['rbe2', 'rbe3']) if (pick.rigid[k]) pick.rigid[k].visible = !!markerState[k] && !iso;
    }
    if (nodePoints) {
      nodePoints.visible = nodeState.visible && !iso;
      uniforms.uClassMask.value.set(...nodeState.classes.map((v) => (v ? 1 : 0)));
      uniforms.uDepthBias.value = sec ? 0.004 : 0.0015;
    }
    if (diff) applyDiffVisibility(sec, iso);
    requestRender();
  }

  function buildGroupTexture(count) {
    // 그룹 수 + '그룹 없음' 한 칸. 폭 4096 까지 한 줄, 넘으면 여러 줄.
    const n = count + 1;
    const w = Math.min(n, 4096);
    const h = Math.ceil(n / w);
    const data = new Uint8Array(w * h);
    data.fill(255, 0, n);
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    groupMask = data;
    return { tex, w };
  }

  function buildMarkers(g) {
    markerRoot = new THREE.Group();
    const lines = (k, index) => {
      if (!index.length) return;
      const obj = new THREE.LineSegments(indexedGeometry(index),
        hook(new THREE.LineBasicMaterial({ color: MARKER_COLORS[k] }), uniforms));
      obj.renderOrder = 2;
      markerObjs[k] = obj;
      markerRoot.add(obj);
    };
    const points = (k, index) => {
      if (!index.length) return;
      // 크기는 화면 고정(sizeAttenuation 끔) — 확대해도 점이 커지지 않는다.
      const obj = new THREE.Points(indexedGeometry(index), hook(new THREE.PointsMaterial({
        color: MARKER_COLORS[k], size: MARKER_SIZES[k], sizeAttenuation: false,
      }), uniforms));
      obj.renderOrder = 3;
      markerObjs[k] = obj;
      markerRoot.add(obj);
    };
    lines('rbe2', g.rigid.rbe2);
    lines('rbe3', g.rigid.rbe3);
    points('conm2', g.masses);
    points('spc', g.spcs);
    scene.add(markerRoot);
  }

  function buildNodePoints() {
    const n = geometry.positions.length / 3;
    const cls = new Float32Array(n);
    const src = extras?.check?.cls;
    if (src) for (let i = 0; i < n; i += 1) cls[i] = src[i];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', positionAttr);
    g.setAttribute('lbGroup', groupAttr);
    g.setAttribute('lbClass', new THREE.BufferAttribute(cls, 1));
    const mat = hook(new THREE.PointsMaterial({ color: 0xffffff, size: NODE_PX, sizeAttenuation: false }), uniforms, { node: true });
    nodePoints = new THREE.Points(g, mat);
    nodePoints.renderOrder = 4;
    nodePoints.visible = false;
    scene.add(nodePoints);
  }

  /* ── 피킹 ───────────────────────────────────────────────────────────────────────── */

  /** 피킹 장면 — 인덱스를 풀어 쓴 삼각형·선분에 요소 순번 색을 칠한다. */
  function buildPick() {
    const pscene = new THREE.Scene();
    const groups = new Map();
    const pos = geometry.positions;
    const ng = extras?.groups?.nodeGroup;
    const meshMat = hook(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
      // 선분이 면에 묻히지 않게 면을 살짝 뒤로 민다(화면 장면과 같은 규칙).
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }), uniforms);
    const lineMat = hook(new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }), uniforms);
    const offMat = new THREE.LineBasicMaterial({ visible: false });
    const fill = (index, elemOf, perElem, base = 0) => {
      const n = index.length;
      const p = new Float32Array(n * 3);
      const c = new Uint8Array(n * 3);
      const gr = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        const v = index[i];
        const o = i * 3;
        p[o] = pos[v * 3];
        p[o + 1] = pos[v * 3 + 1];
        p[o + 2] = pos[v * 3 + 2];
        gr[i] = ng ? ng[v] : 0;
        // encodePick 과 같은 셈(순번+1 → 24비트 RGB). 꼭짓점마다 배열을 만들지 않게 풀어 쓴다.
        const id = base + elemOf[(i / perElem) | 0] + 1;
        c[o] = id & 255;
        c[o + 1] = (id >> 8) & 255;
        c[o + 2] = (id >> 16) & 255;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3).onUpload(dropArray));
      // 정규화 Uint8 — 셰이더가 바이트/255 를 그대로 받아 왕복이 정확하다.
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3, true).onUpload(dropArray));
      geo.setAttribute('lbGroup', new THREE.BufferAttribute(gr, 1).onUpload(dropArray));
      // ⚠ 배열을 버리기 전에 경계 구를 미리 세어 둔다. three r184 는 렌더 정렬 때 geometry 를
      // 올린(=배열을 버린) 다음 computeBoundingSphere() 를 부르므로, 여기서 안 세 두면
      // "Cannot read properties of null" 로 쉘 피킹이 통째로 실패한다(E2E 실측).
      geo.computeBoundingSphere();
      return geo;
    };
    const add = (root, obj) => {
      // 배열을 버린 뒤에는 경계 구를 셀 수 없다. 5×5 만 그리므로 시야 절두체 잘라 내기는 끈다
      // (끄지 않으면 미리 올리기 때 화면 밖 묶음이 올라가지 않는다).
      obj.frustumCulled = false;
      root.add(obj);
    };
    for (const grp of geometry.groups) {
      const root = new THREE.Group();
      if (grp.shell.length) add(root, new THREE.Mesh(fill(grp.shell, grp.shellElem, 3), meshMat));
      if (grp.beams.length) {
        const geo = fill(grp.beams, grp.beamElem, 2);
        // 범위마다 [보임, 숨김] 재질을 고른다 — 3D 단면일 때 단면이 있는 범위는 단면 쪽이 피킹을 맡는다.
        (grp.beamRanges || [{ start: 0, count: grp.beams.length }]).forEach((r) => geo.addGroup(r.start, r.count, 0));
        const lines = new THREE.LineSegments(geo, [lineMat, offMat]);
        root.userData.lines = lines;
        add(root, lines);
      }
      groups.set(grp.pid, root);
      pscene.add(root);
    }
    // RBE — 순번 = total + RBE 순번
    const rigid = {};
    const rg = extras?.rigids;
    if (rg && extras.blocks.rigid_lines?.length) {
      const lines = extras.blocks.rigid_lines;
      for (const [k, kind] of [['rbe2', 0], ['rbe3', 1]]) {
        const rows = [];
        for (let i = 0; i < rg.ofLine.length; i += 1) if (extras.blocks.rigid_kinds[i] === kind) rows.push(i);
        if (!rows.length) continue;
        const index = new Uint32Array(rows.length * 2);
        const of = new Int32Array(rows.length);
        rows.forEach((i, j) => { index[j * 2] = lines[i * 3 + 1]; index[j * 2 + 1] = lines[i * 3 + 2]; of[j] = rg.ofLine[i]; });
        const obj = new THREE.LineSegments(fill(index, of, 2, geometry.total), lineMat);
        add(pscene, obj);
        rigid[k] = obj;
      }
    }
    const target = new THREE.WebGLRenderTarget(PICK_SIZE, PICK_SIZE, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    pick = { scene: pscene, groups, rigid, target };
    // 단면이 이미 있으면 그 피킹도 붙인다.
    if (section) for (const [pid, root] of section.pick) groups.get(pid)?.add(root);
    applyVisibility();
  }

  /** (x, y) CSS 픽셀 둘레 PICK_SIZE 칸만 피킹 대상에 그리고 픽셀을 읽는다. */
  function renderPick(x, y, w, h, scene0 = pick.scene, target = pick.target) {
    const half = (PICK_SIZE - 1) / 2;
    const prevColorSpace = renderer.outputColorSpace;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const buf = new Uint8Array(PICK_SIZE * PICK_SIZE * 4);
    try {
      camera.updateMatrixWorld();
      camera.setViewOffset(w, h, x - half, y - half, PICK_SIZE, PICK_SIZE);
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clippingPlanes = clipPlanes;
      renderer.clear();
      renderer.render(scene0, camera);
      renderer.readRenderTargetPixels(target, 0, 0, PICK_SIZE, PICK_SIZE, buf);
    } finally {
      renderer.setRenderTarget(null);
      renderer.outputColorSpace = prevColorSpace;
      renderer.setClearColor(prevClear, prevAlpha);
      camera.clearViewOffset();
    }
    return buf;
  }

  /** 피킹 장면을 한 번 그려 GPU 에 올린다 — 올리면 CPU 배열이 버려져 메모리가 준다. */
  function warmPick() {
    if (!pick || renderer.getContext().isContextLost()) return;
    const objs = [...pick.groups.values(), ...Object.values(pick.rigid)];
    const saved = objs.map((obj) => obj.visible);
    for (const obj of objs) obj.visible = true;
    const planes = clipPlanes;
    clipPlanes = EMPTY_PLANES;
    try {
      const { w, h } = viewSize();
      renderPick(0, 0, w, h);
    } finally {
      clipPlanes = planes;
      objs.forEach((obj, i) => { obj.visible = saved[i]; });
    }
  }

  function scheduleIdlePick() {
    cancelIdlePick();
    const run = () => {
      idleHandle = null;
      if (!geometry || pick) return;
      buildPick();
      warmPick();
    };
    idleHandle = hasIdle ? window.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200);
  }

  const _pv = new THREE.Matrix4();
  /** 화면 고정 절점 피킹(CPU) — 보이는 절점 중 누른 자리에서 NODE_PICK_PX 안의 가장 가까운 것. */
  function pickNode(x, y, w, h) {
    if (!nodePoints?.visible || !geometry) return null;
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _pv.elements;
    const pos = geometry.positions;
    const ng = extras?.groups?.nodeGroup;
    const cls = extras?.check?.cls;
    const nNo = groupMask ? groupMask.length : 0;
    const r2 = NODE_PICK_PX * NODE_PICK_PX;
    let best = null; let bestD = Infinity; let bestZ = Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i += 1) {
      if (cls && !nodeState.classes[cls[i]]) continue;
      if (groupMask && ng) {
        const g = ng[i] < 0 ? (extras.groups.count) : ng[i];
        if (g < nNo && groupMask[g] === 0) continue;
      }
      const px = pos[i * 3]; const py = pos[i * 3 + 1]; const pz = pos[i * 3 + 2];
      if (clipPlanes.length && clipPlane.normal.x * px + clipPlane.normal.y * py + clipPlane.normal.z * pz + clipPlane.constant < 0) continue;
      const cw = e[3] * px + e[7] * py + e[11] * pz + e[15];
      if (cw <= 0) continue;
      const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / cw * 0.5 + 0.5) * w;
      const sy = (1 - ((e[1] * px + e[5] * py + e[9] * pz + e[13]) / cw * 0.5 + 0.5)) * h;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d > r2) continue;
      const z = (e[2] * px + e[6] * py + e[10] * pz + e[14]) / cw;
      // 거의 같은 거리면 앞의 것
      if (d < bestD - 1 || (Math.abs(d - bestD) <= 1 && z < bestZ)) { best = i; bestD = d; bestZ = z; }
    }
    return best;
  }

  /* ── 3D 단면 ────────────────────────────────────────────────────────────────────── */

  async function buildSection(onProgress) {
    const job = ++sectionJob;
    const plan = extras?.plan;
    const root = new THREE.Group();
    root.visible = false;
    const pickRoots = new Map();
    const meshes = [];
    const total = plan?.beams || 0;
    const src = {
      positions: geometry.positions, beams: extras.blocks.beams,
      orient: extras.orient || null, offsets: extras.offsets || null,
    };
    const eg = extras.groups?.elemGroup;
    let done = 0;
    let fallbacks = 0;
    onProgress?.(0);
    for (const b of plan?.buckets || []) {
      const n = b.rows.length;
      const geo = extrudeProfile(b.profile);
      const grp = new Float32Array(n);
      for (let i = 0; i < n; i += 1) grp[i] = eg ? eg[b.elems[i]] : 0;
      geo.setAttribute('lbGroup', new THREE.InstancedBufferAttribute(grp, 1));
      const mat = hook(new THREE.MeshStandardMaterial({ color: pidColor(b.pid), side: THREE.DoubleSide, ...STANDARD }),
        uniforms, { colorable: true });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      const arr = mesh.instanceMatrix.array;
      for (let from = 0; from < n; from += SECTION_CHUNK) {
        const to = Math.min(n, from + SECTION_CHUNK);
        fallbacks += fillBeamFrames(src, b.rows, arr, from, to);
        done += to - from;
        if (total > SECTION_CHUNK) {
          onProgress?.(done / total);
          await nextTick();
          if (job !== sectionJob) { geo.dispose(); mat.dispose(); disposeTree(root); return null; }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      root.add(mesh);
      // 피킹 — 같은 행렬·그룹 속성을 쓰고 인스턴스 색에 요소 순번을 싣는다.
      const pc = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const id = b.elems[i] + 1;
        pc[i * 3] = (id & 255) / 255;
        pc[i * 3 + 1] = ((id >> 8) & 255) / 255;
        pc[i * 3 + 2] = ((id >> 16) & 255) / 255;
      }
      const pmat = hook(new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), uniforms);
      const pmesh = new THREE.InstancedMesh(geo, pmat, n);
      pmesh.instanceMatrix = mesh.instanceMatrix;
      pmesh.instanceColor = new THREE.InstancedBufferAttribute(pc, 3);
      pmesh.frustumCulled = false;
      let proot = pickRoots.get(b.pid);
      if (!proot) { proot = new THREE.Group(); pickRoots.set(b.pid, proot); }
      proot.add(pmesh);
      meshes.push({ mesh, bucket: b, mat });
    }
    if (job !== sectionJob) { disposeTree(root); return null; }
    scene.add(root);
    section = { root, meshes, pick: pickRoots, ready: true, fallbacks };
    if (pick) for (const [pid, proot] of pickRoots) pick.groups.get(pid)?.add(proot);
    onProgress?.(1);
    return section;
  }

  /* ── 강조·선택만 보기 ───────────────────────────────────────────────────────────── */

  const at = (v) => {
    const p = geometry.positions;
    return [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
  };

  /** 화면 고정 굵기 선(px) — 선택 강조용. 해상도는 resize 가 맞춘다. */
  const fatMats = new Set();
  function fatLines(segs, color, px, opacity, order) {
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    const mat = new LineMaterial({ color, linewidth: px, transparent: true, opacity, depthTest: false, worldUnits: false });
    const { w, h } = viewSize();
    mat.resolution.set(w, h);
    fatMats.add(mat);
    mat.addEventListener('dispose', () => fatMats.delete(mat));
    const obj = new LineSegments2(g, mat);
    obj.renderOrder = order;
    return obj;
  }

  function lineObject(segs, color, depthTest) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest }));
    return obj;
  }

  function pointObject(nodes, color, size, depthTest, opacity = 1) {
    return pointObjectXYZ(nodes.flatMap(at), color, size, depthTest, opacity);
  }

  /** 좌표([x,y,z, …])로 둥근 점(16 고스트 절점·이동 전 위치). map = 점 텍스처(기본 둥근 점). */
  function pointObjectXYZ(xyz, color, size, depthTest, opacity = 1, map = disc()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
    // map 은 공유 텍스처라 disposeTree 가 지우지 않게 userData 로 표시한다.
    const mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, depthTest, map, alphaTest: 0.5,
      transparent: opacity < 1, opacity,
    });
    mat.userData.sharedMap = true;
    return new THREE.Points(g, mat);
  }

  const normSel = (sel) => (sel == null ? null : typeof sel === 'number' ? { kind: 'element', index: sel } : sel);

  /** 선택 대상의 절점과 선분(요소 테두리·RBE 줄). */
  function selectionShape(sel) {
    if (!geometry || !extras) return null;
    if (sel.kind === 'element') {
      if (sel.index < 0 || sel.index >= geometry.total) return null;
      const nodes = elementNodeIndices(extras, geometry, sel.index);
      const segs = nodes.length === 2 ? [...at(nodes[0]), ...at(nodes[1])]
        : nodes.flatMap((v, i) => [...at(v), ...at(nodes[(i + 1) % nodes.length])]);
      return { nodes, segs, beam: nodes.length === 2 };
    }
    if (sel.kind === 'node') return { nodes: [sel.index], segs: [], beam: false };
    // 16 — 삭제된 것(앞 판, 고스트 좌표)
    const gh = diff?.spec?.ghost;
    if (sel.kind === 'ghost' && gh && sel.index < gh.items.length) {
      const it = gh.items[sel.index];
      const gat = (v) => [gh.positions[v * 3], gh.positions[v * 3 + 1], gh.positions[v * 3 + 2]];
      const v = it.nodes;
      let segs;
      if (it.type === 'rigid') segs = v.slice(1).flatMap((o) => [...gat(v[0]), ...gat(o)]);
      else if (v.length === 2) segs = [...gat(v[0]), ...gat(v[1])];
      else segs = v.flatMap((o, i) => [...gat(o), ...gat(v[(i + 1) % v.length])]);
      return { nodes: [], segs, beam: v.length === 2, points: it.type === 'rigid' ? gat(v[0]) : null };
    }
    if (sel.kind === 'ghost-node' && gh && sel.index < gh.nodes.length) {
      const v = gh.nodes[sel.index];
      return { nodes: [], segs: [], beam: false, points: [gh.positions[v * 3], gh.positions[v * 3 + 1], gh.positions[v * 3 + 2]] };
    }
    if (sel.kind === 'rbe' && extras.rigids && sel.index < extras.rigids.count) {
      const nodes = rigidNodes(extras, extras.rigids, sel.index);
      const segs = nodes.slice(1).flatMap((v) => [...at(nodes[0]), ...at(v)]);
      return { nodes, segs, beam: false };
    }
    return null;
  }

  /** 절점에 붙은 요소 순번(선택만 보기 — 절점이면 이웃 요소까지 보여 준다). */
  function elementsAtNode(v) {
    const out = [];
    for (let e = 0; e < geometry.total; e += 1) if (elementNodeIndices(extras, geometry, e).includes(v)) out.push(e);
    return out;
  }

  /** 요소 순번 → PID(lbm 블록에서). */
  function elemPid(e) {
    const row = geometry.elemRow[e];
    const k = geometry.elemKind[e];
    const b = extras.blocks;
    return k === 0 ? b.beams[row * 4 + 1] : k === 1 ? b.tris[row * 5 + 1] : b.quads[row * 6 + 1];
  }

  /** 요소 하나를 화면 색 그대로 그린 물체(선택만 보기). 3D 단면이면 그 단면으로. */
  function solidElement(e, root) {
    const nodes = elementNodeIndices(extras, geometry, e);
    if (nodes.length === 2) {
      if (sectionActive()) {
        const s = section.meshes.find((m) => m.bucket.elems.includes(e));
        if (s) {
          const k = s.bucket.elems.indexOf(e);
          const mesh = new THREE.Mesh(s.mesh.geometry.clone(), new THREE.MeshStandardMaterial({
            color: s.mat.color, side: THREE.DoubleSide, ...STANDARD,
          }));
          mesh.geometry.deleteAttribute('lbGroup');
          mesh.matrixAutoUpdate = false;
          mesh.matrix.fromArray(s.mesh.instanceMatrix.array, k * 16);
          root.add(mesh);
          return;
        }
      }
      root.add(lineObject([...at(nodes[0]), ...at(nodes[1])], pidColor(elemPid(e)), true));
      return;
    }
    const tri = nodes.length === 3 ? [nodes] : [[nodes[0], nodes[1], nodes[2]], [nodes[0], nodes[2], nodes[3]]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat().flatMap(at), 3));
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: pidColor(elemPid(e)), side: THREE.DoubleSide, ...STANDARD,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })));
  }

  /* ── 판 변경 보기(16) ───────────────────────────────────────────────────────────── */

  /** 기존 PID 묶음(·3D 단면) 재질을 회색 반투명으로 흐리거나 되돌린다. 깊이를 쓰지 않아 뒤의 바뀐 것이 가려지지 않는다. */
  function setDim(m, on, opacity) {
    if (m.transparent !== on) { m.transparent = on; m.needsUpdate = true; }
    m.opacity = on ? opacity : 1;
    m.depthWrite = !on;
  }
  function dimBase(on) {
    for (const o of groupObjs.values()) {
      for (const m of o.shellMats) setDim(m, on, 0.16);
      for (const m of o.beamMats) setDim(m, on, 0.34);
      if (o.edgeMat) { o.edgeMat.opacity = on ? 0.14 : 0.55; o.edgeMat.depthWrite = !on; }
    }
    for (const s of section?.meshes || []) setDim(s.mat, on, 0.14);
  }

  /** 점선(1px) — 선분마다 0→8 거리를 줘 길이와 무관하게 선분마다 점 네 개. index = 쌍, pos = 좌표 배열. */
  function dashedLines(pos, index, color, opacity, order) {
    const n = index.length / 2;
    const p = new Float32Array(n * 6);
    const d = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 2; k += 1) {
        const v = index[i * 2 + k];
        p[i * 6 + k * 3] = pos[v * 3]; p[i * 6 + k * 3 + 1] = pos[v * 3 + 1]; p[i * 6 + k * 3 + 2] = pos[v * 3 + 2];
      }
      d[i * 2 + 1] = 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('lineDistance', new THREE.BufferAttribute(d, 1));
    const obj = new THREE.LineSegments(g, new THREE.LineDashedMaterial({
      color, dashSize: 1, gapSize: 1, transparent: opacity < 1, opacity, depthWrite: false,
    }));
    obj.renderOrder = order;
    return obj;
  }

  /** 인덱스 쌍 → 화면 고정 굵기 선(LineSegments2) 좌표. */
  function segsOf(pos, index) {
    const out = new Float32Array(index.length * 3);
    for (let i = 0; i < index.length; i += 1) {
      const v = index[i];
      out[i * 3] = pos[v * 3]; out[i * 3 + 1] = pos[v * 3 + 1]; out[i * 3 + 2] = pos[v * 3 + 2];
    }
    return out;
  }

  /** 화면 고정 굵기 선 — 깊이 검사를 한다(바뀐 것끼리는 앞뒤가 맞게). dashed 면 선분마다 점선. */
  function widthLines(segs, color, px, order, { opacity = 1, dashed = false } = {}) {
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    const mat = new LineMaterial({ color, linewidth: px, transparent: opacity < 1, opacity, worldUnits: false });
    const { w, h } = viewSize();
    mat.resolution.set(w, h);
    fatMats.add(mat);
    mat.addEventListener('dispose', () => fatMats.delete(mat));
    const obj = new LineSegments2(g, mat);
    if (dashed) {
      obj.computeLineDistances();
      // 선분 평균 길이의 1/8 씩 — 길이와 무관하게 선분마다 점 네 개쯤
      let len = 0;
      const n = segs.length / 6;
      for (let i = 0; i < n; i += 1) {
        len += Math.hypot(segs[i * 6 + 3] - segs[i * 6], segs[i * 6 + 4] - segs[i * 6 + 1], segs[i * 6 + 5] - segs[i * 6 + 2]);
      }
      const unit = Math.max(len / Math.max(n, 1) / 8, 1e-9);
      mat.dashed = true;
      mat.dashSize = unit;
      mat.gapSize = unit;
    }
    obj.renderOrder = order;
    return obj;
  }

  /** 피킹용 풀어 쓴 기하 — 꼭짓점마다 순번 색(base + itemOf[프리미티브] + 1). */
  function pickFill(pos, index, itemOf, perItem, base) {
    const n = index.length;
    const p = new Float32Array(n * 3);
    const c = new Uint8Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const v = index[i];
      p[i * 3] = pos[v * 3]; p[i * 3 + 1] = pos[v * 3 + 1]; p[i * 3 + 2] = pos[v * 3 + 2];
      const id = base + itemOf[(i / perItem) | 0] + 1;
      c[i * 3] = id & 255; c[i * 3 + 1] = (id >> 8) & 255; c[i * 3 + 2] = (id >> 16) & 255;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3, true));
    g.computeBoundingSphere();
    return g;
  }

  function clearDiffFocus() {
    if (!diff?.focus) return;
    scene.remove(diff.focus);
    disposeTree(diff.focus);
    diff.focus = null;
  }

  function clearDiffSection() {
    if (!diff?.section) return;
    scene.remove(diff.section);
    disposeTree(diff.section);
    diff.section = null;
  }

  function clearDiff() {
    if (!diff) return;
    clearDiffFocus();
    clearDiffSection();
    scene.remove(diff.root);
    disposeTree(diff.root);
    disposeTree(diff.pick);
    diff.target.dispose();
    diff = null;
  }

  /** 3D 단면 — 바뀐 1D 는 단면 묶음마다 InstancedMesh 하나(단면 기하 공유·행렬 복사·instanceColor 로 범주 색). */
  function buildDiffSection() {
    clearDiffSection();
    if (!diff || !section?.ready) return;
    const cls = diff.spec.elemClass;
    if (!cls) return;
    const root = new THREE.Group();
    const eg = extras?.groups?.elemGroup;
    const mat = hook(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, ...STANDARD }), uniforms);
    const color = new THREE.Color();
    for (const s of section.meshes) {
      const elems = s.bucket.elems;
      for (const c of [1, 2]) {
        const ks = [];
        for (let k = 0; k < elems.length; k += 1) if (cls[elems[k]] === c) ks.push(k);
        if (!ks.length) continue;
        const src = s.mesh.geometry;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', src.getAttribute('position'));
        g.setIndex(src.getIndex());
        const grp = new Float32Array(ks.length);
        ks.forEach((k, j) => { grp[j] = eg ? eg[elems[k]] : 0; });
        g.setAttribute('lbGroup', new THREE.InstancedBufferAttribute(grp, 1));
        const mesh = new THREE.InstancedMesh(g, mat, ks.length);
        mesh.frustumCulled = false;
        const from = s.mesh.instanceMatrix.array;
        const to = mesh.instanceMatrix.array;
        color.set(c === 1 ? DIFF_COLORS.added : DIFF_COLORS.changed);
        ks.forEach((k, j) => {
          for (let q = 0; q < 16; q += 1) to[j * 16 + q] = from[k * 16 + q];
          mesh.setColorAt(j, color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.layer = c === 1 ? 'added' : 'changed';
        root.add(mesh);
      }
    }
    diff.section = root;
    scene.add(root);
  }

  function applyDiffVisibility(sec, iso) {
    const L = diff.layers;
    const showBase = L.unchanged && !L.onlyChanged;
    if (modelRoot) modelRoot.visible = !iso && showBase;
    if (section) section.root.visible = sec && !iso && showBase;
    // 변경 보기에서는 RBE·질량·SPC 마커를 끈다(마젠타·초록이 범주 색과 겹친다) — 강체 변경은 범주 선으로 그린다.
    if (markerRoot) markerRoot.visible = false;
    if (pick?.rigid) for (const k of ['rbe2', 'rbe3']) if (pick.rigid[k]) pick.rigid[k].visible = false;
    for (const [key, objs] of Object.entries(diff.layer)) for (const o of objs) o.visible = !!L[key] && !iso;
    for (const o of diff.pick.children) o.visible = !!L[o.userData.layer];
    if (diff.section) {
      diff.section.visible = sec && !iso;
      for (const m of diff.section.children) m.visible = !!L[m.userData.layer];
    }
    if (diff.focus) diff.focus.visible = !iso;
  }

  function buildDiff(spec) {
    const root = new THREE.Group();
    const pscene = new THREE.Scene();
    const layer = { added: [], changed: [], removed: [], moved: [], spc: [] };
    const pos = geometry.positions;
    const total = geometry.total;
    const rc = extras?.rigids?.count || 0;
    const meshPick = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    const linePick = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
    const addPick = (obj, key) => { obj.userData.layer = key; obj.frustumCulled = false; pscene.add(obj); };
    const put = (key, obj) => { layer[key].push(obj); root.add(obj); };

    // 추가·변경(뒤 판) — 공유 위치 버퍼 + 범주 인덱스
    for (const [c, key] of [[1, 'added'], [2, 'changed']]) {
      const color = DIFF_COLORS[key];
      const b = spec.buffers?.[c];
      if (b?.shell.length) {
        put(key, new THREE.Mesh(indexedGeometry(b.shell), hook(new THREE.MeshStandardMaterial({
          color, side: THREE.DoubleSide, ...STANDARD, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        }), uniforms)));
        addPick(new THREE.Mesh(pickFill(pos, b.shell, b.shellElem, 3, 0), meshPick), key);
      }
      if (b?.edges.length) {
        const e = new THREE.LineSegments(indexedGeometry(b.edges),
          hook(new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.45) }), uniforms));
        e.renderOrder = 1;
        put(key, e);
      }
      if (b?.beams.length) {
        put(key, widthLines(segsOf(pos, b.beams), color, 3, 3));
        addPick(new THREE.LineSegments(pickFill(pos, b.beams, b.beamElem, 2, 0), linePick), key);
      }
      const r = spec.rigid?.[c];
      if (r?.segs.length) {
        put(key, widthLines(segsOf(pos, r.segs), color, 2, 3));
        addPick(new THREE.LineSegments(pickFill(pos, r.segs, r.item, 2, total), linePick), key);
      }
    }
    // 절점 — 추가(초록 원) · 이동(주황 원) · 구속 변경(주황 네모). 화면 고정 크기, 맨 위.
    const nodePts = (key, index, color, map) => {
      if (!index?.length) return;
      const m = hook(new THREE.PointsMaterial({
        color, size: 9, sizeAttenuation: false, depthTest: false, map, alphaTest: map ? 0.5 : 0,
      }), uniforms);
      if (map) m.userData.sharedMap = true;
      const obj = new THREE.Points(indexedGeometry(Uint32Array.from(index)), m);
      obj.renderOrder = 7;
      put(key, obj);
    };
    nodePts('added', spec.nodes?.added, DIFF_COLORS.added, disc());
    nodePts('moved', spec.nodes?.moved, DIFF_COLORS.changed, disc());
    nodePts('spc', spec.nodes?.spc, DIFF_COLORS.changed, null);

    // 삭제(앞 판 고스트) — 반투명 면 + 점선 테두리·선, 빈 고리 절점
    const gh = spec.ghost;
    if (gh && gh.positions.length) {
      const gpos = gh.positions;
      const base = total + rc;
      const red = DIFF_COLORS.removed;
      if (gh.shell.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
        g.setIndex(new THREE.BufferAttribute(gh.shell, 1));
        const face = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: red, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide,
        }));
        face.renderOrder = 4;
        put('removed', face);
        addPick(new THREE.Mesh(pickFill(gpos, gh.shell, gh.shellItem, 3, base), meshPick), 'removed');
      }
      if (gh.edges.length) put('removed', dashedLines(gpos, gh.edges, red, 0.95, 5));
      if (gh.beams.length) {
        put('removed', widthLines(segsOf(gpos, gh.beams), red, 2, 5, { dashed: true }));
        addPick(new THREE.LineSegments(pickFill(gpos, gh.beams, gh.beamItem, 2, base), linePick), 'removed');
      }
      if (gh.rigid.length) {
        put('removed', widthLines(segsOf(gpos, gh.rigid), red, 2, 5, { dashed: true }));
        addPick(new THREE.LineSegments(pickFill(gpos, gh.rigid, gh.rigidItem, 2, base), linePick), 'removed');
      }
      if (gh.nodes.length) {
        const xyz = new Float32Array(gh.nodes.length * 3);
        gh.nodes.forEach((v, i) => { xyz[i * 3] = gpos[v * 3]; xyz[i * 3 + 1] = gpos[v * 3 + 1]; xyz[i * 3 + 2] = gpos[v * 3 + 2]; });
        const pts = pointObjectXYZ(xyz, red, 11, false, 1, ring());
        pts.material.userData.sharedMap = true;
        pts.renderOrder = 7;
        put('removed', pts);
      }
    }
    scene.add(root);
    const target = new THREE.WebGLRenderTarget(PICK_SIZE, PICK_SIZE, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    return { spec, layers: { added: true, changed: true, removed: true, moved: true, spc: true, unchanged: true, onlyChanged: false },
             root, layer, pick: pscene, target, section: null, focus: null };
  }

  /** 바뀐 절점(추가·이동·구속, 삭제 고스트) 화면 거리 피킹 — 켜진 범주만. */
  function pickDiffNode(x, y, w, h) {
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _pv.elements;
    const r2 = NODE_PICK_PX * NODE_PICK_PX;
    let best = null; let bestD = Infinity;
    const scan = (pos, list, make) => {
      for (let j = 0; j < list.length; j += 1) {
        const i = list[j];
        const px = pos[i * 3]; const py = pos[i * 3 + 1]; const pz = pos[i * 3 + 2];
        if (clipPlanes.length && clipPlane.normal.x * px + clipPlane.normal.y * py + clipPlane.normal.z * pz + clipPlane.constant < 0) continue;
        const cw = e[3] * px + e[7] * py + e[11] * pz + e[15];
        if (cw <= 0) continue;
        const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / cw * 0.5 + 0.5) * w;
        const sy = (1 - ((e[1] * px + e[5] * py + e[9] * pz + e[13]) / cw * 0.5 + 0.5)) * h;
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d <= r2 && d < bestD) { bestD = d; best = make(i, j); }
      }
    };
    const L = diff.layers;
    const nd = diff.spec.nodes || {};
    for (const k of ['added', 'moved', 'spc']) if (L[k] && nd[k]?.length) scan(geometry.positions, nd[k], (i) => ({ kind: 'node', index: i }));
    const gh = diff.spec.ghost;
    if (L.removed && gh?.nodes.length) scan(gh.positions, gh.nodes, (_i, j) => ({ kind: 'ghost-node', index: j }));
    return best;
  }

  /** 바뀐 요소·강체·고스트를 먼저 고른다. @returns 선택 | null(고를 것 없음) | undefined(없음 — 일반 피킹으로) */
  function pickDiff(clientX, clientY, rect, x, y, w, h) {
    const node = pickDiffNode(clientX - rect.left, clientY - rect.top, w, h);
    if (node) return node;
    const buf = renderPick(x, y, w, h, diff.pick, diff.target);
    const half = (PICK_SIZE - 1) / 2;
    const total = geometry.total;
    const rc = extras?.rigids?.count || 0;
    const limit = total + rc + (diff.spec.ghost?.items.length || 0);
    let best = null; let bestD = Infinity;
    for (let py = 0; py < PICK_SIZE; py += 1) {
      for (let px = 0; px < PICK_SIZE; px += 1) {
        const o = (py * PICK_SIZE + px) * 4;
        const idx = decodePick(buf[o], buf[o + 1], buf[o + 2]);
        if (idx === null || idx >= limit) continue;
        const d = (px - half) ** 2 + (py - half) ** 2;
        if (d < bestD) { bestD = d; best = idx; }
      }
    }
    // 변경 없는 부분이 숨어 있으면 일반 피킹으로 넘기지 않는다(보이지 않는 것이 골라지지 않게)
    if (best == null) return diff.layers.onlyChanged || !diff.layers.unchanged ? null : undefined;
    if (best < total) return { kind: 'element', index: best };
    if (best < total + rc) return { kind: 'rbe', index: best - total };
    return { kind: 'ghost', index: best - total - rc };
  }

  function resize() {
    if (!container.clientWidth || !container.clientHeight) return;
    const { w, h } = viewSize();
    const aspect = w / h;
    // computeFrame 과 같은 규칙: 짧은 쪽 반폭을 유지한다(넓은 화면은 세로, 좁은 화면은 가로).
    // resizeFeOrthographicCamera 처럼 세로만 유지하면 좁은 화면에서 모델 옆이 잘린다.
    const keep = Math.max(Math.min((ortho.right - ortho.left) / 2, (ortho.top - ortho.bottom) / 2), 1e-9);
    const cx = (ortho.right + ortho.left) / 2;
    const cy = (ortho.top + ortho.bottom) / 2;
    const hw = aspect >= 1 ? keep * aspect : keep;
    const hh = aspect >= 1 ? keep : keep / aspect;
    ortho.left = cx - hw;
    ortho.right = cx + hw;
    ortho.top = cy + hh;
    ortho.bottom = cy - hh;
    ortho.updateProjectionMatrix();
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    for (const m of fatMats) m.resolution.set(w, h);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    requestRender();
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);

  // 창을 배율이 다른 모니터로 옮기면 devicePixelRatio 가 바뀐다 — resolution 질의로 따라간다.
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDprChange);
    dprQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    dprQuery?.addEventListener?.('change', onDprChange);
  }
  function onDprChange() {
    watchDpr();
    renderer.setPixelRatio(pixelRatio());
    resize();
  }
  watchDpr();

  requestRender();

  return {
    setModel(g, { edges = true, extras: ex = null } = {}) {
      clearModel();
      geometry = g;
      extras = ex;
      edgesOn = edges;
      positionAttr = new THREE.BufferAttribute(g.positions, 3);
      const n = g.positions.length / 3;
      const ng = new Float32Array(n);
      const src = ex?.groups?.nodeGroup;
      if (src) for (let i = 0; i < n; i += 1) ng[i] = src[i];
      groupAttr = new THREE.BufferAttribute(ng, 1);
      const groupCount = ex?.groups?.count || 0;
      const { tex, w } = buildGroupTexture(groupCount);
      visTexture = tex;
      uniforms = {
        uGroupVis: { value: tex },
        uGroupVisW: { value: w },
        uNoGroup: { value: groupCount },
        uColorByGroup: { value: 0 },
        uGroupPalette: { value: GROUP_COLORS.map((c) => new THREE.Color(c)) },
        uNoGroupColor: { value: new THREE.Color(NO_GROUP_COLOR) },
        uClassMask: { value: new THREE.Vector3(1, 1, 1) },
        uClassColors: { value: NODE_CLASS_COLORS.map((c) => new THREE.Color(c)) },
        uDepthBias: { value: 0.0015 },
      };
      modelRoot = new THREE.Group();
      const hidden = new THREE.LineBasicMaterial({ visible: false });
      for (const grp of g.groups) {
        const root = new THREE.Group();
        const o = { root, shell: null, edges: null, beams: null, beamMats: [], shellMats: [], beamCards: [], shellCards: [], edgeMat: null };
        if (grp.shell.length) {
          const geo = indexedGeometry(grp.shell);
          const ranges = grp.shellRanges?.length ? grp.shellRanges : [{ card: '', start: 0, count: grp.shell.length }];
          ranges.forEach((r, i) => {
            geo.addGroup(r.start, r.count, i);
            // flatShading — 법선 속성 없이 화면 미분으로 면 법선을 구한다(메모리 절약, 요소 면이 또렷하다).
            o.shellMats.push(hook(new THREE.MeshStandardMaterial({
              color: grp.color, side: THREE.DoubleSide, ...STANDARD,
              polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            }), uniforms, { colorable: true }));
            o.shellCards.push(r.card);
          });
          o.shell = new THREE.Mesh(geo, o.shellMats);
          root.add(o.shell);
        }
        if (grp.edges.length) {
          o.edgeMat = hook(new THREE.LineBasicMaterial({
            color: new THREE.Color(grp.color).multiplyScalar(0.45), transparent: true, opacity: 0.55,
          }), uniforms);
          o.edges = new THREE.LineSegments(indexedGeometry(grp.edges), o.edgeMat);
          o.edges.renderOrder = 1;
          root.add(o.edges);
        }
        if (grp.beams.length) {
          const geo = indexedGeometry(grp.beams);
          const ranges = grp.beamRanges?.length ? grp.beamRanges : [{ card: '', start: 0, count: grp.beams.length }];
          ranges.forEach((r, i) => {
            geo.addGroup(r.start, r.count, i);
            o.beamMats.push(hook(new THREE.LineBasicMaterial({ color: grp.color }), uniforms, { colorable: true }));
            o.beamCards.push(r.card);
          });
          o.beams = new THREE.LineSegments(geo, [...o.beamMats, hidden]);
          root.add(o.beams);
        }
        groupObjs.set(grp.pid, o);
        modelRoot.add(root);
      }
      scene.add(modelRoot);
      buildMarkers(g);
      buildNodePoints();
      applyColors();
      applyVisibility();
      applyFrame(VIEW_PRESETS.iso.dir, VIEW_PRESETS.iso.up);
      scheduleIdlePick();
    },

    setGroupVisible(pid, visible) {
      if (visible) hiddenPids.delete(pid); else hiddenPids.add(pid);
      applyVisibility();
    },

    /** 연결 그룹 보이기 — mask[i] 가 거짓이면 그룹 i 를 숨긴다. */
    setGroupsVisible(mask) {
      if (!groupMask || !visTexture) return;
      const n = Math.min(mask.length, groupMask.length - 1);
      for (let i = 0; i < n; i += 1) groupMask[i] = mask[i] ? 255 : 0;
      visTexture.needsUpdate = true;
      requestRender();
    },

    setEdges(visible) {
      edgesOn = !!visible;
      applyVisibility();
    },

    setMarkers(state) {
      markerState = { ...markerState, ...state };
      applyVisibility();
    },

    setNodes(state) {
      nodeState = { ...nodeState, ...state };
      applyVisibility();
    },

    /** 절점 묶음 강조 — SPC 마커와 같은 화면 고정 점이지만 더 크고, 가려지지 않게 맨 위에 그린다(그룹 숨김은 따른다). */
    setNodeSet(indices, { color = MARKER_COLORS.spc } = {}) {
      clearNodeSet();
      if (geometry && indices?.length) {
        nodeSetObj = new THREE.Points(indexedGeometry(Uint32Array.from(indices)), hook(new THREE.PointsMaterial({
          color, size: NODE_SET_PX, sizeAttenuation: false, depthTest: false,
        }), uniforms));
        nodeSetObj.renderOrder = 6;
        scene.add(nodeSetObj);
      }
      applyVisibility();
    },

    setColorMode(mode) {
      colorMode = mode;
      applyColors();
    },

    /** 'line' | 'section'. 단면은 처음 켤 때 만든다(큰 모델은 조각으로 — onProgress(0..1)). */
    async setRenderMode(mode, { onProgress } = {}) {
      if (!geometry) return { fallbacks: 0 };
      renderMode = mode === 'section' ? 'section' : 'line';
      if (renderMode === 'section' && !section) {
        const built = await buildSection(onProgress);
        if (!built) return { fallbacks: 0, cancelled: true };
        if (diff) { dimBase(true); buildDiffSection(); }
        applyColors();
      }
      applyVisibility();
      return { fallbacks: section?.fallbacks || 0 };
    },

    /** 축 평면 자르기 — axis 'x'|'y'|'z', position 0..1(모델 범위 안 위치), flip = 반대쪽을 남긴다. */
    setClip(c) {
      clip = c && c.axis ? c : null;
      if (!clip || !geometry) {
        clipPlanes = EMPTY_PLANES;
      } else {
        const k = { x: 0, y: 1, z: 2 }[clip.axis];
        const b = geometry.bounds || { min: [-geometry.radius, -geometry.radius, -geometry.radius], max: [geometry.radius, geometry.radius, geometry.radius] };
        const v = b.min[k] + (b.max[k] - b.min[k]) * Math.min(Math.max(clip.position, 0), 1);
        const nrm = [0, 0, 0];
        nrm[k] = clip.flip ? 1 : -1;
        clipPlane.normal.set(...nrm);
        clipPlane.constant = clip.flip ? -v : v;
        clipPlanes = [clipPlane];
      }
      requestRender();
    },

    setProjection(mode) {
      setActiveCamera(mode === 'persp' ? persp : ortho);
    },

    setView(presetId) {
      const p = VIEW_PRESETS[presetId] || VIEW_PRESETS.iso;
      if (isolate?.bounds) applyFrame(p.dir, p.up, isolate.bounds.center, isolate.bounds.radius);
      else applyFrame(p.dir, p.up);
    },

    fit() {
      if (!geometry) return;
      if (isolate?.bounds) reframe(isolate.bounds.center, isolate.bounds.radius);
      else reframe([0, 0, 0], geometry.radius);
    },

    /** 절점 순번들로 화면을 맞춘다(그룹으로 이동·찾기). 대상만 꽉 차면 모델 속 위치를 잃으므로 모델의 12% 를 최소로. */
    frameNodes(indices) {
      if (!geometry) return;
      const b = nodeBounds(geometry.positions, indices, geometry.radius * 0.12);
      if (b) reframe(b.center, b.radius * 1.15);
    },

    pickAt(clientX, clientY) {
      if (!geometry) return null;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(Math.round(rect.width), 1);
      const h = Math.max(Math.round(rect.height), 1);
      const x = Math.floor(clientX - rect.left);
      const y = Math.floor(clientY - rect.top);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      // 선택만 보기 중에는 그 대상 말고 고르지 않는다.
      if (isolate) return null;
      if (diff) {
        const hit = pickDiff(clientX, clientY, rect, x, y, w, h);
        if (hit !== undefined) { requestRender(); return hit; }
      }
      const node = pickNode(clientX - rect.left, clientY - rect.top, w, h);
      if (node != null) return { kind: 'node', index: node };
      if (!pick) { cancelIdlePick(); buildPick(); }
      const half = (PICK_SIZE - 1) / 2;
      const buf = renderPick(x, y, w, h);
      // 가운데에서 가장 가까운, 빈 곳이 아닌 픽셀
      let best = null;
      let bestD = Infinity;
      const limit = geometry.total + (extras?.rigids?.count || 0);
      for (let py = 0; py < PICK_SIZE; py += 1) {
        for (let px = 0; px < PICK_SIZE; px += 1) {
          const o = (py * PICK_SIZE + px) * 4;
          const idx = decodePick(buf[o], buf[o + 1], buf[o + 2]);
          if (idx === null || idx >= limit) continue;
          const d = (px - half) ** 2 + (py - half) ** 2;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      requestRender();
      if (best == null) return null;
      return best < geometry.total ? { kind: 'element', index: best } : { kind: 'rbe', index: best - geometry.total };
    },

    highlight(selection) {
      clearHighlight();
      const sel = normSel(selection);
      if (!sel || !geometry) { requestRender(); return; }
      const shape = selectionShape(sel);
      if (!shape) { requestRender(); return; }
      // Studio SelectionHighlight 와 같은 모양 — 어두운 외곽(0x001318, 0.5)을 깔고 시안 코어(0x00E5FF, 0.8)를 덮는다.
      // 다른 요소에 가려지지 않게 깊이 검사를 끄고 맨 위에 그린다.
      const group = new THREE.Group();
      if (shape.segs.length) {
        group.add(fatLines(shape.segs, SEL.outline, SEL.elemOutlinePx, 0.5, 10));
        group.add(fatLines(shape.segs, SEL.core, SEL.elemPx, 0.8, 11));
      }
      if (sel.kind !== 'element' && (shape.points || shape.nodes.length)) {
        // 절점은 그 점, RBE 는 기준 절점에 둥근 표시(16 고스트는 좌표로)
        const xyz = shape.points || (sel.kind === 'node' ? shape.nodes : shape.nodes.slice(0, 1)).flatMap(at);
        const outline = pointObjectXYZ(xyz, SEL.outline, SEL.nodeOutlinePx, false, 0.5);
        outline.renderOrder = 12;
        const core = pointObjectXYZ(xyz, SEL.core, SEL.nodePx, false, 0.8);
        core.renderOrder = 13;
        group.add(outline, core);
      }
      highlightObj = group;
      scene.add(group);
      requestRender();
    },

    /** 선택만 보기 — 대상(절점이면 그 절점을 쓰는 요소까지)만 남기고 나머지를 감춘다. null 이면 해제. */
    setIsolate(selection) {
      clearIsolate();
      const sel = normSel(selection);
      if (sel && geometry && extras) {
        const shape = selectionShape(sel);
        if (shape) {
          const root = new THREE.Group();
          const elems = sel.kind === 'element' ? [sel.index] : sel.kind === 'node' ? elementsAtNode(sel.index) : [];
          for (const e of elems) solidElement(e, root);
          if (sel.kind === 'rbe') {
            const kind = extras.rigids.kind[sel.index] === 0 ? 'rbe2' : 'rbe3';
            root.add(lineObject(shape.segs, MARKER_COLORS[kind], true));
          }
          const nodes = new Set(shape.nodes);
          for (const e of elems) for (const v of elementNodeIndices(extras, geometry, e)) nodes.add(v);
          root.add(pointObject([...nodes], NODE_CLASS_COLORS[0], 6, true));
          scene.add(root);
          isolate = { obj: root, bounds: nodeBounds(geometry.positions, [...nodes], geometry.radius * 0.04) };
        }
      }
      applyVisibility();
    },

    /** 지금 카메라(07) — 엔진 좌표. view = 화면 짧은 쪽 반폭(모델 단위). 모델이 없으면 null. */
    getCameraState() {
      if (!geometry) return null;
      const { w, h } = viewSize();
      const aspect = w / h;
      const dist = camera.position.distanceTo(controls.target);
      const tanHalf = Math.tan((FOV * Math.PI) / 360);
      const view = camera === ortho
        ? Math.min((ortho.right - ortho.left) / 2, (ortho.top - ortho.bottom) / 2) / ortho.zoom
        : dist * tanHalf * Math.min(1, aspect);
      return {
        projection: camera === ortho ? 'ortho' : 'persp',
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(),
        view,
        radius: geometry.radius,
        center: [...geometry.center],
      };
    },

    /**
     * 다른 칸의 카메라를 옮겨 받는다(07, lib/cameraSync.syncCamera 결과). 직교는 view 로 zoom 을 다시 센다 —
     * 화면 틀(반폭·반높이)은 칸마다 다르므로 zoom 값을 그대로 복사하면 배율이 어긋난다. 이때는 알리지 않는다.
     */
    setCameraState(s) {
      if (!geometry || !s?.position || !s?.target) return;
      cameraSilent += 1;
      try {
        if (s.projection && (s.projection === 'persp') !== (camera === persp)) setActiveCamera(s.projection === 'persp' ? persp : ortho);
        const R = geometry.radius;
        const target = new THREE.Vector3(...s.target);
        const pos = new THREE.Vector3(...s.position);
        if (camera === persp && s.projection === 'ortho' && s.view > 0) {
          // 직교 → 원근으로 받으면 보이는 크기가 같아지는 거리로
          const { w, h } = viewSize();
          const d = s.view / (Math.tan((FOV * Math.PI) / 360) * Math.min(1, w / h));
          pos.sub(target).normalize().multiplyScalar(d).add(target);
        }
        camera.position.copy(pos);
        controls.target.copy(target);
        if (camera === ortho) {
          ortho.zoom = orthoZoom((ortho.right - ortho.left) / 2, (ortho.top - ortho.bottom) / 2, s.view);
          // 앞뒤 자르기 범위 — 모델 중심(원점)에서 카메라까지 + 모델 전체
          const reach = pos.length() + R * 20;
          ortho.near = -reach;
          ortho.far = reach;
        } else {
          const d = pos.distanceTo(target);
          persp.near = Math.max(d * 1e-3, R * 1e-5);
          persp.far = pos.length() + R * 8;
        }
        camera.up.copy(UP);
        camera.updateProjectionMatrix();
        controls.update();
      } finally {
        cameraSilent -= 1;
      }
      requestRender();
    },

    /** 카메라가 바뀔 때 부를 함수를 단다(사용자 조작·시점·맞춤·투영). @returns 해제 함수 */
    onCameraChange(cb) {
      cameraListeners.add(cb);
      return () => cameraListeners.delete(cb);
    },

    /**
     * PID 강조(07) — 그 PID 의 1D 는 굵은 선, 쉘은 반투명 면 + 테두리로 맨 위에 그린다. null·빈 목록이면 지운다.
     * @returns {number} 모델에서 찾은 PID 수
     */
    setPidHighlight(pids) {
      clearPidHighlight();
      const want = new Set((pids || []).map(Number));
      let found = 0;
      if (geometry && want.size) {
        const root = new THREE.Group();
        for (const grp of geometry.groups) {
          if (!want.has(grp.pid)) continue;
          found += 1;
          if (grp.beams.length) {
            const n = grp.beams.length / 2;
            if (n <= PID_FAT_LIMIT) {
              const segs = new Float32Array(n * 6);
              const p = geometry.positions;
              for (let i = 0; i < grp.beams.length; i += 1) {
                const v = grp.beams[i];
                segs[i * 3] = p[v * 3]; segs[i * 3 + 1] = p[v * 3 + 1]; segs[i * 3 + 2] = p[v * 3 + 2];
              }
              root.add(fatLines(segs, SEL.outline, SEL.elemOutlinePx, 0.5, 8));
              root.add(fatLines(segs, SEL.core, 3, 0.95, 9));
            } else {
              const obj = new THREE.LineSegments(indexedGeometry(grp.beams),
                hook(new THREE.LineBasicMaterial({ color: SEL.core, depthTest: false }), uniforms));
              obj.renderOrder = 9;
              root.add(obj);
            }
          }
          if (grp.shell.length) {
            const face = new THREE.Mesh(indexedGeometry(grp.shell), hook(new THREE.MeshBasicMaterial({
              color: SEL.core, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
            }), uniforms));
            face.renderOrder = 8;
            root.add(face);
          }
          if (grp.edges.length) {
            const edges = new THREE.LineSegments(indexedGeometry(grp.edges),
              hook(new THREE.LineBasicMaterial({ color: SEL.core, depthTest: false, transparent: true, opacity: 0.9 }), uniforms));
            edges.renderOrder = 9;
            root.add(edges);
          }
        }
        if (root.children.length) {
          pidHighlightObj = root;
          scene.add(root);
        }
      }
      applyVisibility();
      return found;
    },

    /**
     * 판 변경 보기(16) 켜기·끄기 — spec(lib/revisionDiff3d.js 결과) | null. 켜면 변경 없는 부분을 회색 반투명으로 흐리고
     * 바뀐 것만 범주 색으로 덮어 그린다. 끄면 원래 색·마커로 돌아간다. 모델을 바꾸면(setModel) 저절로 꺼진다.
     */
    setDiff(spec) {
      const layers = diff?.layers;
      clearDiff();
      if (geometry && spec) {
        diff = buildDiff(spec);
        if (layers) diff.layers = layers;
        if (sectionActive()) buildDiffSection();
        dimBase(true);
      } else {
        dimBase(false);
      }
      applyColors();
      applyVisibility();
    },

    /** 범주 켜기/끄기 — { added, changed, removed, moved, spc, unchanged, onlyChanged } 일부만 줘도 된다. */
    setDiffLayers(layers) {
      if (!diff) return;
      diff.layers = { ...diff.layers, ...layers };
      applyVisibility();
    },

    /**
     * 고른 것의 '이동 전' 모양 — { points: [x,y,z,…](옅은 고리), segs: [x,y,z, x,y,z, …](옅은 점선), arrow: { from, to } }.
     * 좌표는 뷰어 좌표(b 의 bbox 중심 기준). null 이면 지운다.
     */
    setDiffFocus(focus) {
      if (!diff) return;
      clearDiffFocus();
      if (focus) {
        const root = new THREE.Group();
        if (focus.segs?.length) root.add(widthLines(Float32Array.from(focus.segs), NODE_CLASS_COLORS[0], 2, 8, { opacity: 0.75, dashed: true }));
        if (focus.arrow) {
          const { from, to } = focus.arrow;
          root.add(widthLines(Float32Array.from([...from, ...to]), DIFF_COLORS.changed, 2, 8, { opacity: 0.9, dashed: true }));
        }
        if (focus.points?.length) {
          const pts = pointObjectXYZ(focus.points, NODE_CLASS_COLORS[0], 12, false, 0.7, ring());
          pts.renderOrder = 9;
          root.add(pts);
        }
        diff.focus = root;
        scene.add(root);
      }
      applyVisibility();
    },

    /** 바뀐 곳(추가·변경·이동·구속 절점 + 삭제 고스트)으로 화면을 맞춘다. 맞출 것이 없으면 false. */
    frameDiff() {
      if (!geometry || !diff) return false;
      const sp = diff.spec;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let n = 0;
      const take = (p, i) => {
        for (let k = 0; k < 3; k += 1) {
          const v = p[i * 3 + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
        n += 1;
      };
      for (const i of sp.frameNodes || []) take(geometry.positions, i);
      const gp = sp.ghost?.positions;
      if (gp) for (let i = 0; i < gp.length / 3; i += 1) take(gp, i);
      if (!n) return false;
      const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
      const r = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, geometry.radius * 0.12);
      reframe(center, r * 1.15);
      return true;
    },

    dispose() {
      cameraListeners.clear();
      cancelAnimationFrame(frame);
      // ⚠ 반드시 0 으로 되돌린다(머리 주석의 StrictMode 함정).
      frame = 0;
      resizeObserver?.disconnect();
      dprQuery?.removeEventListener?.('change', onDprChange);
      dprQuery = null;
      controls.removeEventListener('change', requestRender);
      controls.removeEventListener('change', emitCamera);
      controls.dispose();
      clearModel();
      disposeTree(scene);
      disposeTree(gizmo.scene);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
