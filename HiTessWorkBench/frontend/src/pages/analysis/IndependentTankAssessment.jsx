/**
 * Independent Tank Assessment (Interactive App)
 *  - 좌측: [Design] / [Boundary/Load] 2-탭 입력 패널
 *  - 우측: three.js 뷰어 — 두 탭에서 항상 표시 (Z-up, 직육면체 6면 plate + 보강재 ring 라인)
 *  - 탭 헤더에 검증 에러 배지 표시 → 어느 탭에 입력 오류가 있는지 즉시 파악
 *  - 입력 필드별 유효성 검사 + 가이드 힌트 제공.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial';
import {
  Box, Ruler, Layers, Wind, Trash2,
  Settings2, Activity, Anchor, AlertCircle
} from 'lucide-react';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import { useNavigation } from '../../contexts/NavigationContext';

// ────────────────────────────────────────────────────────────
// 유효성 검사 헬퍼
//   각 함수는 { ok, msg, hint } 반환. msg = 에러, hint = 정상 시 가이드.
// ────────────────────────────────────────────────────────────
const ok  = (hint)      => ({ ok: true,  hint });
const ng  = (msg)       => ({ ok: false, msg });

const validateNumber = (v, { min, max, allowEmpty = false, name = '값', unit = '' } = {}) => {
  if (v === '' || v === null || v === undefined) {
    if (allowEmpty) return ok();
    return ng('필수');
  }
  const n = Number(v);
  if (!Number.isFinite(n))            return ng('숫자만 가능');
  if (min !== undefined && n < min)   return ng(`${min}${unit} 이상`);
  if (max !== undefined && n > max)   return ng(`${max}${unit} 이하`);
  return ok(`${min ?? '-'}~${max ?? '-'} ${unit}`);
};

// 도메인별 검증 룰
const RULES = {
  dim:     { min: 100, max: 100_000, unit: 'mm', hint: '100 ~ 100,000 mm' },
  tp:      { min: 3,   max: 100,     unit: 'mm', hint: '3 ~ 100 mm' },
  tcorr:   { min: 0,   max: 10,      unit: 'mm', hint: '0 ~ 10 mm, < tp' },
  stfH:    { min: 30,  max: 500,     unit: 'mm', hint: '30 ~ 500 mm' },
  stfT:    { min: 3,   max: 30,      unit: 'mm', hint: '3 ~ 30 mm' },
  acc:     { min: -3,  max: 3,       unit: 'g',  hint: '-3 ~ 3 g' },
  airVent: { min: 100, max: 100_000, unit: 'mm', hint: 'D 이상 권장' },
};

// 보강재 배치 검증 (간격/갯수/커스텀 + 축길이 의존)
const validateStiffener = (state, axisLen) => {
  // ── Custom 모드: customDistances 누적 검증 ──
  if (state.type === 'custom') {
    const list = state.customDistances || [];
    if (list.length === 0) return ng('최소 1개');
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const d = Number(list[i]);
      if (!Number.isFinite(d) || list[i] === '' || list[i] === null) return ng(`${i + 1}번 값 필수`);
      if (d <= 0) return ng(`${i + 1}번 0보다 커야 함`);
      if (d > axisLen) return ng(`${i + 1}번 축길이(${axisLen}) 초과`);
      sum += d;
      if (sum > axisLen) return ng(`누적 ${sum} > 축길이(${axisLen})`);
    }
    return ok(`누적 ${sum} / ${axisLen} mm`);
  }
  // ── 등간격(uniform) 모드 ──
  const v = Number(state.value);
  if (!Number.isFinite(v) || state.value === '') return ng('필수');
  if (state.countMode === 'interval') {
    if (v < 50)              return ng('50 mm 이상');
    if (v > axisLen / 2)     return ng(`축길이/2(${Math.floor(axisLen / 2)}) 이하`);
    return ok(`50 ~ ${Math.floor(axisLen / 2)} mm`);
  }
  // count
  if (!Number.isInteger(v)) return ng('정수');
  if (v < 0)                return ng('0 이상');
  if (v > Math.floor(axisLen / 100)) return ng(`최대 ${Math.floor(axisLen / 100)} EA`);
  return ok(`0 ~ ${Math.floor(axisLen / 100)} EA`);
};

// 모드 전환 시 기본값 (간격: 500 mm, 갯수: 2 EA)
const defaultStfValue = (countMode) => countMode === 'interval' ? 500 : 2;

// ────────────────────────────────────────────────────────────
// 보강재 단면 Shape 빌더 (A × B + C × D)
//   로컬 좌표계 정의:
//     X = 판 표면 위 가로 방향(보강재 길이축에 직교)
//     Y = 판 표면 법선(외측 = +Y)
//   ExtrudeGeometry 의 depth 는 보강재 길이축(local Z) 방향으로 적용된다.
//
//   Flat : A = 높이(h), B = 두께(t).         C/D 미사용.
//   T    : Web A × B + Flange C × D.        Web 가 판에 수직, Flange 가 상단 좌우 대칭.
//   L    : 수직 leg A × B + 수평 leg C × D. 웹 자유단(y=0) 이 판 접촉, 플랜지 상단 +X 한쪽.
// ────────────────────────────────────────────────────────────
const buildSectionShape = (type, A, B, C, D) => {
  const a = Math.max(1,   Number(A) || 1);
  const b = Math.max(0.5, Number(B) || 1);
  const c = Math.max(1,   Number(C) || 1);
  const d = Math.max(0.5, Number(D) || 1);
  const s = new THREE.Shape();
  if (type === 'T') {
    // Web: 두께 b, 높이 a. Flange: 폭 c, 두께 d. 자유단(웹 하단) y=0 가 판 접촉.
    const fw = Math.max(c, b);     // 플랜지가 웹보다 좁아지지 않도록 가드
    const ft = Math.min(d, a);     // 플랜지 두께가 전체 높이를 넘지 않도록 가드
    s.moveTo(-b/2,  0);
    s.lineTo( b/2,  0);
    s.lineTo( b/2,  a - ft);
    s.lineTo( fw/2, a - ft);
    s.lineTo( fw/2, a);
    s.lineTo(-fw/2, a);
    s.lineTo(-fw/2, a - ft);
    s.lineTo(-b/2,  a - ft);
    s.closePath();
  } else if (type === 'L') {
    // 수직 leg (웹): 두께 b, 높이 a. 수평 leg (플랜지): 길이 c, 두께 d.
    // 웹 하단(y=0) 자유단이 판 접촉, 플랜지는 외부 꼭지점에서 +X 로 뻗음.
    const fw = Math.max(c, b);
    const ft = Math.min(d, a);
    s.moveTo(-b/2,        0);                         // 웹 자유단 좌 (외부)
    s.lineTo( b/2,        0);                         // 웹 자유단 우 (내부)
    s.lineTo( b/2,        a - ft);                    // 웹 내측 → 내부 코너
    s.lineTo(-b/2 + fw,   a - ft);                    // 플랜지 하면
    s.lineTo(-b/2 + fw,   a);                         // 플랜지 자유단
    s.lineTo(-b/2,        a);                         // 외부 꼭지점 (apex)
    s.closePath();
  } else {
    // Flat bar: 단순 직사각형 (B × A)
    s.moveTo(-b/2, 0);
    s.lineTo( b/2, 0);
    s.lineTo( b/2, a);
    s.lineTo(-b/2, a);
    s.closePath();
  }
  return s;
};

// 보강재 위치 계산 (등간격: 간격/갯수, 커스텀: 누적 거리)
const positionsAlong = (axisLen, conf) => {
  if (!conf) return [];
  // ── Custom 모드: 누적 거리 → 절대 좌표 ──
  if (conf.type === 'custom') {
    const list = conf.customDistances || [];
    const out = [];
    let cur = 0;
    for (const d of list) {
      const v = Number(d);
      if (!Number.isFinite(v) || v <= 0) continue;
      cur += v;
      if (cur > axisLen) break; // 축길이 초과는 시각화에서 잘라냄 (검증은 별도)
      out.push(cur);
    }
    return out;
  }
  // ── Uniform 모드 ──
  const v = Number(conf.value) || 0;
  if (v <= 0) return [];
  let count = 0;
  if (conf.countMode === 'count') count = Math.floor(v);
  else count = Math.max(0, Math.floor(axisLen / v) - 1);
  if (count <= 0) return [];
  const step = axisLen / (count + 1);
  return Array.from({ length: count }, (_, i) => step * (i + 1));
};

// ────────────────────────────────────────────────────────────
// 공통 입력 UI (컴팩트 + 검증 표시)
// ────────────────────────────────────────────────────────────
const NumInput = ({ value, onChange, unit, placeholder, validation, className = '', disabled = false }) => {
  const isErr = validation && !validation.ok;
  // 에러/정상/비활성 상태별 보더 색상 분기
  const borderCls = isErr
    ? 'border-red-300 focus-within:border-red-400 ring-0 focus-within:ring-1 focus-within:ring-red-200'
    : 'border-slate-200 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-200';
  return (
    <div className={className}>
      <div className={`flex items-stretch border ${borderCls} rounded-lg overflow-hidden bg-white transition-all ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 min-w-0 px-2.5 py-2 text-[13px] font-bold text-slate-800 outline-none bg-transparent leading-none"
        />
        {unit && (
          <span className="flex items-center justify-center px-2 bg-slate-50 text-slate-400 text-[10px] font-bold border-l border-slate-200 min-w-[28px] whitespace-nowrap">
            {unit}
          </span>
        )}
      </div>
      {validation && (
        <p className={`mt-1 text-[10px] leading-tight ${isErr ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
          {isErr ? `⚠ ${validation.msg}` : (validation.hint || ' ')}
        </p>
      )}
    </div>
  );
};

const Select = ({ value, onChange, options, className = '', disabled = false }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    disabled={disabled}
    className={`border rounded-lg px-2.5 py-2 text-[13px] font-bold outline-none transition-all focus:ring-1 focus:ring-violet-200 ${
      disabled
        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
        : 'bg-white border-slate-200 text-slate-700 cursor-pointer focus:border-violet-500'
    } ${className}`}
  >
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

// SectionCard: 헤더는 violet-700→violet-600 그라데이션 + 아이콘 사이즈 상향
const SectionCard = ({ title, icon: Icon, children, className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${className}`}>
    <div className="bg-gradient-to-r from-violet-700 to-violet-600 px-3.5 py-2 flex items-center gap-2">
      <Icon size={13} className="text-violet-200 flex-shrink-0" />
      <h2 className="text-[10.5px] font-extrabold text-white uppercase tracking-wide">{title}</h2>
    </div>
    <div className="p-3.5 space-y-2.5">{children}</div>
  </div>
);

// FieldLabel: 11px 고정 폰트 + 라벨-인풋 간격 확보
const FieldLabel = ({ children }) => (
  <label className="block text-[11px] font-bold text-slate-500 mb-1 tracking-tight">{children}</label>
);

// ────────────────────────────────────────────────────────────
// three.js 뷰어
// ────────────────────────────────────────────────────────────
function IndependentTankViewer({ L, B, D, topOpen, stiffeners, section, onPickPoint, pickedPositions }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);
  const pickedGroupRef = useRef(null);
  const onPickRef = useRef(onPickPoint);

  useEffect(() => { onPickRef.current = onPickPoint; }, [onPickPoint]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 500;

    const scene = new THREE.Scene();
    // 부드러운 세로 그라데이션 배경 (top: deep indigo → bottom: near-black)
    {
      const bgCv = document.createElement('canvas');
      bgCv.width = 2; bgCv.height = 512;
      const bcx = bgCv.getContext('2d');
      const grad = bcx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0,    '#1e1b4b');
      grad.addColorStop(0.55, '#0b1029');
      grad.addColorStop(1,    '#020617');
      bcx.fillStyle = grad;
      bcx.fillRect(0, 0, 2, 512);
      const bgTex = new THREE.CanvasTexture(bgCv);
      bgTex.colorSpace = THREE.SRGBColorSpace;
      bgTex.minFilter = THREE.LinearFilter;
      bgTex.magFilter = THREE.LinearFilter;
      scene.background = bgTex;
    }

    const camera = new THREE.PerspectiveCamera(40, w / h, 1, 1_000_000);
    camera.up.set(0, 0, 1);
    camera.position.set(4000, -4500, 2800);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 50;

    // ── 라이팅: Hemisphere(자연스러운 sky/ground 톤) + 3-point (key/fill/rim)
    const hemi = new THREE.HemisphereLight(0xc5d4f0, 0x1a1f3a, 0.55);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0x2d3550, 0.9));
    const key  = new THREE.DirectionalLight(0xffffff, 1.55);
    key.position.set(1500, -2000, 2200);  scene.add(key);
    const fill = new THREE.DirectionalLight(0x7ab2ff, 0.7);
    fill.position.set(-1800, 1500, 1000); scene.add(fill);
    const rim  = new THREE.DirectionalLight(0xf0abfc, 0.45);  // 후면 보라-핑크 림으로 윤곽 강조
    rim.position.set(0, 2000, -600);      scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const pickedGroup = new THREE.Group();
    scene.add(pickedGroup);

    sceneRef.current = { scene, camera, renderer, controls };
    groupRef.current = group;
    pickedGroupRef.current = pickedGroup;

    // ── Pick 포인트용 raycaster (드래그와 클릭 구분)
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1 };
    const ndc = new THREE.Vector2();
    const downPos = { x: 0, y: 0, t: 0 };
    const onPointerDown = (e) => {
      downPos.x = e.clientX; downPos.y = e.clientY; downPos.t = performance.now();
    };
    const onPointerUp = (e) => {
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      const dt = performance.now() - downPos.t;
      // 드래그(>4px) 또는 길게 누름(>400ms) 은 picking 무시
      if (Math.hypot(dx, dy) > 4 || dt > 400) return;
      const rect = mount.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const pickables = [];
      group.traverse(obj => {
        if (obj.userData && obj.userData.isPickPoint) pickables.push(obj);
      });
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length) {
        const p = hits[0].object.userData.point;
        onPickRef.current?.(p);
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', onPointerUp);

    let rafId = 0;
    const tick = () => {
      controls.update();
      // pick 포인트는 카메라 거리에 따라 일정한 픽셀 크기(작은 FEA 노드)로 유지
      group.traverse(obj => {
        if (obj.userData && obj.userData.isPickPoint) {
          const d = camera.position.distanceTo(obj.position);
          const s = d * 0.0045;
          obj.scale.setScalar(s);
        }
      });
      // 선택된 Node ▲ 마커 — 카메라 거리 보정 + 부드러운 펄스(±6%)
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.06;
      pickedGroup.children.forEach(obj => {
        if (obj.userData && obj.userData.isPickedMarker) {
          const d = camera.position.distanceTo(obj.position);
          const s = d * 0.028 * pulse;
          obj.scale.setScalar(s);
        }
      });
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      // 모든 LineMaterial 의 resolution 동기화 (Line2 픽셀 두께 정확도 보장)
      scene.traverse(obj => {
        if (obj.material && obj.material.isLineMaterial) {
          obj.material.resolution.set(nw, nh);
        }
      });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    const ctx = sceneRef.current;
    if (!group || !ctx) return;

    while (group.children.length) {
      const c = group.children.pop();
      c.traverse?.(n => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
      });
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
    }

    const Ln = Math.max(1, Number(L) || 1);
    const Bn = Math.max(1, Number(B) || 1);
    const Dn = Math.max(1, Number(D) || 1);

    const axes = new THREE.AxesHelper(Math.min(Ln, Bn, Dn) * 0.4);
    group.add(axes);

    // 뷰포트 크기 (LineMaterial resolution 용)
    const vp = new THREE.Vector2(ctx.renderer.domElement.width, ctx.renderer.domElement.height);

    // 판: 시원한 블루-틴트 유리감. 약간의 emissive 로 어두운 영역에서도 형상이 인식됨.
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x7aa5dc, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, metalness: 0.18, roughness: 0.52,
      emissive: 0x1e3a5f, emissiveIntensity: 0.2,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      depthWrite: false,
    });
    // 판 모서리 — 선명한 sky-blue
    const edgeMat = new LineMaterial({
      color: 0x93c5fd, linewidth: 1.6, transparent: true, opacity: 0.95,
      resolution: vp.clone(), worldUnits: false, depthTest: true,
    });

    const addFace = (w, h, pos, rot) => {
      const geom = new THREE.PlaneGeometry(w, h);
      const mesh = new THREE.Mesh(geom, plateMat);
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.renderOrder = 0;
      group.add(mesh);
      // EdgesGeometry → LineSegmentsGeometry (Line2 입력 형식)
      const eg = new THREE.EdgesGeometry(geom);
      const lsg = new LineSegmentsGeometry();
      lsg.setPositions(Array.from(eg.attributes.position.array));
      eg.dispose();
      const line = new LineSegments2(lsg, edgeMat);
      line.position.set(...pos);
      if (rot) line.rotation.set(...rot);
      line.renderOrder = 2;
      line.computeLineDistances();
      group.add(line);
    };

    addFace(Ln, Bn, [Ln / 2, Bn / 2, 0]);
    if (!topOpen) addFace(Ln, Bn, [Ln / 2, Bn / 2, Dn]);
    addFace(Dn, Bn, [0,  Bn / 2, Dn / 2], [0, Math.PI / 2, 0]);
    addFace(Dn, Bn, [Ln, Bn / 2, Dn / 2], [0, Math.PI / 2, 0]);
    addFace(Ln, Dn, [Ln / 2, 0,  Dn / 2], [Math.PI / 2, 0, 0]);
    addFace(Ln, Dn, [Ln / 2, Bn, Dn / 2], [Math.PI / 2, 0, 0]);

    // ── 보강재: 실 단면 형상(Flat / T / L) Extrude 메시
    const stfType = section?.type ?? 'Flat';
    const stfA    = Math.max(1,   Number(section?.A) || 75);
    const stfB    = Math.max(0.5, Number(section?.B) || 9);
    const stfC    = Math.max(1,   Number(section?.C) || 50);
    const stfD    = Math.max(0.5, Number(section?.D) || 9);
    const stfSide = section?.side ?? 'Outside';
    const sideSign = stfSide === 'Inside' ? -1 : 1;
    const stfShape = buildSectionShape(stfType, stfA, stfB, stfC, stfD);

    // 보강재: 따뜻한 코랄/오렌지 메탈 — 시원한 블루 판과 보색 대비, 자체 emissive 로 항상 또렷
    const stfMat = new THREE.MeshStandardMaterial({
      color: 0xfb923c,                       // tailwind orange-400
      metalness: 0.4, roughness: 0.32,
      emissive: 0x7c2d12, emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    });
    const stfEdgeMat = new LineMaterial({
      color: 0xfed7aa, linewidth: 1.2, transparent: true, opacity: 0.9,
      resolution: vp.clone(), worldUnits: false, depthTest: true,
    });

    // 한 segment(직선) 위에 단면을 extrude 하여 배치
    const addStiffenerSegment = (start, end, plateNormal) => {
      const startV = new THREE.Vector3(...start);
      const endV   = new THREE.Vector3(...end);
      const dirV   = endV.clone().sub(startV);
      const length = dirV.length();
      if (length < 1e-3) return;
      dirV.normalize();
      // local Y = 판 법선 (외측이 +Y), local Z = 보강재 길이축 (extrude 방향), local X = 가로축
      const yAxis = new THREE.Vector3(...plateNormal).multiplyScalar(sideSign);
      const xAxis = new THREE.Vector3().crossVectors(yAxis, dirV).normalize();
      const zAxis = dirV;

      const geom = new THREE.ExtrudeGeometry(stfShape, { depth: length, bevelEnabled: false, curveSegments: 1, steps: 1 });
      const mesh = new THREE.Mesh(geom, stfMat);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      m.setPosition(startV);
      mesh.applyMatrix4(m);
      mesh.renderOrder = 1;
      group.add(mesh);

      // 단면 가장자리 윤곽선 — 가독성용
      const eg = new THREE.EdgesGeometry(geom, 1);
      const lsg = new LineSegmentsGeometry();
      lsg.setPositions(Array.from(eg.attributes.position.array));
      eg.dispose();
      const line = new LineSegments2(lsg, stfEdgeMat);
      line.applyMatrix4(m);
      line.computeLineDistances();
      line.renderOrder = 2;
      group.add(line);
    };

    // 한 ring 4개 segment 정의 (start, end, 판 외측 법선)
    const ringX = (x) => [
      { s: [x, 0, 0],  e: [x, Bn, 0],  n: [0, 0, -1] }, // bottom plate
      { s: [x, Bn, 0], e: [x, Bn, Dn], n: [0, 1, 0]  }, // +Y plate
      { s: [x, Bn, Dn],e: [x, 0, Dn],  n: [0, 0, 1]  }, // top plate
      { s: [x, 0, Dn], e: [x, 0, 0],   n: [0, -1, 0] }, // -Y plate
    ];
    const ringY = (y) => [
      { s: [0, y, 0],  e: [Ln, y, 0],  n: [0, 0, -1] },
      { s: [Ln, y, 0], e: [Ln, y, Dn], n: [1, 0, 0]  },
      { s: [Ln, y, Dn],e: [0, y, Dn],  n: [0, 0, 1]  },
      { s: [0, y, Dn], e: [0, y, 0],   n: [-1, 0, 0] },
    ];
    const ringZ = (z) => [
      { s: [0, 0, z],  e: [Ln, 0, z],  n: [0, -1, 0] },
      { s: [Ln, 0, z], e: [Ln, Bn, z], n: [1, 0, 0]  },
      { s: [Ln, Bn, z],e: [0, Bn, z],  n: [0, 1, 0]  },
      { s: [0, Bn, z], e: [0, 0, z],   n: [-1, 0, 0] },
    ];

    const stfX = positionsAlong(Ln, stiffeners?.L);
    const stfY = positionsAlong(Bn, stiffeners?.B);
    const stfZ = positionsAlong(Dn, stiffeners?.D);

    const addRing = (segs) => segs.forEach(({ s, e, n }) => {
      // top open 이면 z=Dn 판이 없으므로 그 segment 도 생략
      if (topOpen && (s[2] === Dn && e[2] === Dn)) return;
      addStiffenerSegment(s, e, n);
    });
    stfX.forEach(x => addRing(ringX(x)));
    stfY.forEach(y => addRing(ringY(y)));
    stfZ.forEach(z => addRing(ringZ(z)));

    // ── Pick 포인트: 박스 꼭지점 + 보강재 ring 교점/모서리 접점
    //   topOpen 인 경우 상판(z=Dn) 위의 모든 점은 제외 (상판 자체가 없음)
    const pickPts = [];
    const pushPt = (pos, kind) => {
      if (topOpen && pos[2] === Dn) return;
      pickPts.push({ pos, kind });
    };

    // 8 corners
    [[0,0,0],[Ln,0,0],[Ln,Bn,0],[0,Bn,0],
     [0,0,Dn],[Ln,0,Dn],[Ln,Bn,Dn],[0,Bn,Dn]].forEach(p => pushPt(p, 'corner'));

    // 보강재 ring 이 박스 모서리(edge)와 만나는 4점
    stfX.forEach(x => [[0,0],[Bn,0],[Bn,Dn],[0,Dn]].forEach(([y,z]) => pushPt([x,y,z], 'ring-edge')));
    stfY.forEach(y => [[0,0],[Ln,0],[Ln,Dn],[0,Dn]].forEach(([x,z]) => pushPt([x,y,z], 'ring-edge')));
    stfZ.forEach(z => [[0,0],[Ln,0],[Ln,Bn],[0,Bn]].forEach(([x,y]) => pushPt([x,y,z], 'ring-edge')));

    // 보강재-보강재 교점 (서로 다른 축 ring 이 박스 표면에서 교차하는 2점씩)
    stfX.forEach(x => stfY.forEach(y => { pushPt([x,y,0],'ring-cross'); pushPt([x,y,Dn],'ring-cross'); }));
    stfX.forEach(x => stfZ.forEach(z => { pushPt([x,0,z],'ring-cross'); pushPt([x,Bn,z],'ring-cross'); }));
    stfY.forEach(y => stfZ.forEach(z => { pushPt([0,y,z],'ring-cross'); pushPt([Ln,y,z],'ring-cross'); }));

    // 중복 제거 (서로 다른 룰에서 같은 점이 생성될 수 있음)
    const seen = new Set();
    const ptKey = (p) => `${p[0].toFixed(2)}_${p[1].toFixed(2)}_${p[2].toFixed(2)}`;
    const uniquePts = pickPts.filter(({ pos, kind }) => {
      const k = ptKey(pos);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(({ pos, kind }) => {
      // corner 우선 — 중복 제거 시 라벨이 약한 것이 살아남을 수 있어 보정
      const isCorner = pos.every((v, i) => v === 0 || v === [Ln, Bn, Dn][i]);
      return { pos, kind: isCorner ? 'corner' : kind };
    });

    // FEA 노드 스타일: 작고 단색 빨강 구 (depthTest on → 가려질 때는 가려져 자연스럽게)
    const sphereGeom = new THREE.SphereGeometry(1, 12, 8); // scale 은 매 프레임 카메라 거리로 조정
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });

    uniquePts.forEach(({ pos, kind }) => {
      const sp = new THREE.Mesh(sphereGeom, nodeMat);
      sp.position.set(...pos);
      sp.renderOrder = 4;
      sp.userData = { isPickPoint: true, point: [pos[0], pos[1], pos[2]], kind };
      group.add(sp);
    });

    const diag = Math.sqrt(Ln * Ln + Bn * Bn + Dn * Dn);
    const cam = ctx.camera;
    const ctrls = ctx.controls;
    ctrls.target.set(Ln / 2, Bn / 2, Dn / 2);
    cam.position.set(Ln / 2 + diag * 1.0, Bn / 2 - diag * 1.2, Dn / 2 + diag * 0.8);
    // 카메라 near/far 범위 축소 → depth 정밀도 ↑ (z-fighting 추가 완화)
    cam.near = Math.max(1, diag * 0.05);
    cam.far  = diag * 10;
    cam.updateProjectionMatrix();
    ctrls.update();
  }, [L, B, D, topOpen, stiffeners, section]);

  // ── 선택된 Node 위에 노란 ▲ 스프라이트 렌더 (분리된 group → BC 변경마다 scene 전체를 재구성하지 않음)
  useEffect(() => {
    const pgroup = pickedGroupRef.current;
    if (!pgroup) return;

    while (pgroup.children.length) {
      const c = pgroup.children.pop();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
    if (!pickedPositions || pickedPositions.length === 0) return;

    // ▲ 텍스처 (1회 생성 후 sprite 공유): 라임 그린 + 어두운 외곽 + 소프트 글로우
    // 색상 선택 근거: 배경(짙은 인디고) + 판(블루) + 보강재(오렌지) 와 모두 보색에 가까워 항상 또렷.
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d');
    cx.clearRect(0, 0, 128, 128);

    // 외곽 글로우 (라임 그린 라디얼 그라데이션)
    const glow = cx.createRadialGradient(64, 62, 28, 64, 62, 62);
    glow.addColorStop(0,    'rgba(190, 242, 100, 0.55)'); // lime-200
    glow.addColorStop(0.55, 'rgba(132, 204, 22, 0.18)');  // lime-500
    glow.addColorStop(1,    'rgba(132, 204, 22, 0)');
    cx.fillStyle = glow;
    cx.fillRect(0, 0, 128, 128);

    // 진한 외곽선 (가독성 보강)
    cx.fillStyle = '#1a2e05'; // 진한 올리브
    cx.beginPath();
    cx.moveTo(64, 14);
    cx.lineTo(114, 106);
    cx.lineTo(14, 106);
    cx.closePath();
    cx.fill();

    // 라임 메인 필
    cx.fillStyle = '#a3e635'; // lime-400
    cx.beginPath();
    cx.moveTo(64, 24);
    cx.lineTo(106, 100);
    cx.lineTo(22, 100);
    cx.closePath();
    cx.fill();

    // 상단 하이라이트 (작은 흰빛 — 광택감)
    cx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    cx.beginPath();
    cx.moveTo(64, 32);
    cx.lineTo(82, 60);
    cx.lineTo(46, 60);
    cx.closePath();
    cx.fill();

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;

    pickedPositions.forEach(p => {
      // depthTest off → 보강재/판 뒤에 가려져도 또렷이 보임 (선택 결과는 항상 가시화)
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      const sp = new THREE.Sprite(mat);
      sp.position.set(p[0], p[1], p[2]);
      sp.renderOrder = 6;
      sp.userData = { isPickedMarker: true };
      pgroup.add(sp);
    });
  }, [pickedPositions]);

  return <div ref={mountRef} className="w-full h-full" />;
}

// ────────────────────────────────────────────────────────────
// 메인 페이지
// ────────────────────────────────────────────────────────────
export default function IndependentTankAssessment() {
  const { setCurrentMenu } = useNavigation();

  // ── Geometry
  const [dimL, setDimL] = useState(2000);
  const [dimB, setDimB] = useState(1000);
  const [dimD, setDimD] = useState(500);
  const [tp, setTp] = useState(10);
  const [tcorr, setTcorr] = useState(1);
  const [topOpen, setTopOpen] = useState('closed');
  const [stfL, setStfL] = useState({ type: 'uniform', countMode: 'count',    value: 3, customDistances: [500] });
  const [stfB, setStfB] = useState({ type: 'uniform', countMode: 'interval', value: 500, customDistances: [500] });
  const [stfD, setStfD] = useState({ type: 'uniform', countMode: 'count',    value: 2, customDistances: [250] });
  const [stfType, setStfType] = useState('Flat');
  // Flat: A(h) × B(t)
  // T   : Web A(h) × B(t) + Flange C(w) × D(t)
  // L   : Vertical leg A × B + Horizontal leg C × D
  const [stfDim1, setStfDim1] = useState(75);  // A
  const [stfDim2, setStfDim2] = useState(9);   // B
  const [stfDim3, setStfDim3] = useState(50);  // C  (T/L 전용)
  const [stfDim4, setStfDim4] = useState(9);   // D  (T/L 전용)
  const [stfSide, setStfSide] = useState('Outside');

  // ── Boundary & Load
  const [airVentH, setAirVentH] = useState(2500);
  const [accX, setAccX] = useState(0.3);
  const [accY, setAccY] = useState(0.8);
  const [accZ, setAccZ] = useState(0.6);
  const [bcRows, setBcRows] = useState([]);
  const [bcMode, setBcMode] = useState('auto'); // 'auto' | 'manual' — 기본: 자동

  // 자동 모드: 탱크 바닥(z=0) 4 꼭짓점을 bcRows로 강제 세팅.
  // L/B 변경 시에도 좌표 자동 갱신.
  useEffect(() => {
    if (bcMode !== 'auto') return;
    const L = Math.round(Number(dimL) || 0);
    const B = Math.round(Number(dimB) || 0);
    setBcRows([
      { x: 0, y: 0, z: 0 },
      { x: L, y: 0, z: 0 },
      { x: L, y: B, z: 0 },
      { x: 0, y: B, z: 0 },
    ]);
  }, [bcMode, dimL, dimB]);

  // ── 검증 결과
  const vL = useMemo(() => validateNumber(dimL, RULES.dim), [dimL]);
  const vB = useMemo(() => validateNumber(dimB, RULES.dim), [dimB]);
  const vD = useMemo(() => validateNumber(dimD, RULES.dim), [dimD]);
  const vTp     = useMemo(() => validateNumber(tp, RULES.tp), [tp]);
  const vTcorr  = useMemo(() => {
    const base = validateNumber(tcorr, RULES.tcorr);
    if (!base.ok) return base;
    if (Number(tcorr) >= Number(tp)) return ng('tp 미만');
    return base;
  }, [tcorr, tp]);
  const vStfH = useMemo(() => validateNumber(stfDim1, RULES.stfH), [stfDim1]);
  const vStfT = useMemo(() => validateNumber(stfDim2, RULES.stfT), [stfDim2]);
  // T/L 형상에서만 평가하는 추가 치수 — Flat 일 때는 무조건 ok 로 처리
  const vStfC = useMemo(() => stfType === 'Flat' ? ok() : validateNumber(stfDim3, RULES.stfH), [stfDim3, stfType]);
  const vStfD = useMemo(() => stfType === 'Flat' ? ok() : validateNumber(stfDim4, RULES.stfT), [stfDim4, stfType]);
  const vAx   = useMemo(() => validateNumber(accX, RULES.acc), [accX]);
  const vAy   = useMemo(() => validateNumber(accY, RULES.acc), [accY]);
  const vAz   = useMemo(() => validateNumber(accZ, RULES.acc), [accZ]);
  const vAirV = useMemo(() => {
    const base = validateNumber(airVentH, RULES.airVent);
    if (!base.ok) return base;
    if (Number(airVentH) < Number(dimD)) return ng('D 이상이어야 함');
    return base;
  }, [airVentH, dimD]);
  const vStfArr = useMemo(() => ({
    L: validateStiffener(stfL, Number(dimL) || 0),
    B: validateStiffener(stfB, Number(dimB) || 0),
    D: validateStiffener(stfD, Number(dimD) || 0),
  }), [stfL, stfB, stfD, dimL, dimB, dimD]);

  // 뷰어 props 메모이즈 (참조 안정화로 불필요한 scene 재구성 방지)
  const viewerStiffeners = useMemo(() => ({ L: stfL, B: stfB, D: stfD }), [stfL, stfB, stfD]);
  const viewerSection    = useMemo(() => ({
    type: stfType,
    A: Number(stfDim1), B: Number(stfDim2),
    C: Number(stfDim3), D: Number(stfDim4),
    side: stfSide,
  }), [stfType, stfDim1, stfDim2, stfDim3, stfDim4, stfSide]);
  const pickedPositions  = useMemo(
    () => bcRows.map(r => [Number(r.x) || 0, Number(r.y) || 0, Number(r.z) || 0]),
    [bcRows]
  );

  const removeBcRow = (idx) => setBcRows(bcRows.filter((_, i) => i !== idx));

  // 3D 뷰어에서 Node 클릭 → 토글 (이미 선택된 좌표면 해제)
  // 자동 모드일 때는 클릭 무시.
  const handlePickPoint = (p) => {
    if (bcMode === 'auto') return;
    const key = (r) => `${Number(r.x).toFixed(1)}_${Number(r.y).toFixed(1)}_${Number(r.z).toFixed(1)}`;
    const newRow = { x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) };
    setBcRows(prev => {
      const idx = prev.findIndex(r => key(r) === key(newRow));
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, newRow];
    });
  };

  // 보강재 모드 전환 시 적정 기본값으로 자동 갱신
  const setStfMode = (state, set) => (mode) => {
    if (mode === state.countMode) return;
    set({ ...state, countMode: mode, value: defaultStfValue(mode) });
  };

  // custom 목록 조작 헬퍼
  const addCustomDistance = (state, set) => () => {
    const list = state.customDistances || [];
    set({ ...state, customDistances: [...list, 500] });
  };
  const removeCustomDistance = (state, set) => () => {
    const list = state.customDistances || [];
    if (list.length <= 1) return; // 최소 1개 유지
    set({ ...state, customDistances: list.slice(0, -1) });
  };
  const setCustomDistanceAt = (state, set) => (idx, val) => {
    const list = [...(state.customDistances || [])];
    list[idx] = val;
    set({ ...state, customDistances: list });
  };

  const axisRow = (label, state, set, validation) => {
    const isErr = !validation.ok;
    const isCustom = state.type === 'custom';
    const inputBorder = isErr
      ? 'border-red-300 focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200'
      : 'border-slate-200 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-200';
    const list = state.customDistances || [];
    return (
      <div className="border border-slate-200/70 rounded-lg bg-slate-50/60 overflow-hidden">
        {/* 축 레이블 + 모드 선택 행 */}
        <div className="flex items-center gap-2 px-2.5 py-2 bg-white border-b border-slate-100">
          {/* 축 레이블 칩 */}
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-violet-600 text-white text-[11px] font-extrabold flex-shrink-0 shadow-sm">
            {label}
          </span>
          <Select
            value={state.type}
            onChange={v => set({ ...state, type: v })}
            options={[{ value: 'uniform', label: '등간격' }, { value: 'custom', label: '커스텀' }]}
            className="flex-1 min-w-0 text-[12px]"
          />
          {isCustom ? (
            /* 목록 개수 표시 + +/- 버튼 (검증 실패 시 + 버튼 차단) */
            <div className="flex-1 min-w-0 flex items-stretch gap-1">
              <div className={`flex-1 min-w-0 flex items-center justify-center px-2 py-1.5 rounded-md border text-[12px] font-bold ${
                isErr
                  ? 'bg-red-50 border-red-200 text-red-600'
                  : 'bg-violet-50 border-violet-200 text-violet-700'
              }`}>
                목록 {list.length}개
              </div>
              <button
                type="button"
                onClick={removeCustomDistance(state, set)}
                disabled={list.length <= 1}
                className={`w-7 flex items-center justify-center rounded-md text-[14px] font-bold border transition ${
                  list.length <= 1
                    ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300'
                }`}
                title="목록 제거"
              >−</button>
              <button
                type="button"
                onClick={addCustomDistance(state, set)}
                disabled={isErr}
                className={`w-7 flex items-center justify-center rounded-md text-[14px] font-bold border transition ${
                  isErr
                    ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300'
                }`}
                title={isErr ? '입력값 오류 — 먼저 해결한 후 추가 가능' : '목록 추가'}
              >+</button>
            </div>
          ) : (
            <Select
              value={state.countMode}
              onChange={setStfMode(state, set)}
              options={[{ value: 'interval', label: '간격(mm)' }, { value: 'count', label: '갯수(EA)' }]}
              className="flex-1 min-w-0 text-[12px]"
            />
          )}
        </div>
        {/* 값 입력 행 */}
        {isCustom ? (
          /* Custom: 목록 개수만큼 누적 거리 입력 행 */
          <div className="px-2.5 py-2 space-y-1.5">
            {list.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-100 text-violet-700 text-[10px] font-extrabold flex-shrink-0">
                  {idx + 1}
                </span>
                <div className={`flex-1 flex items-stretch border border-slate-200 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-200 rounded-lg overflow-hidden bg-white transition-all`}>
                  <input
                    type="number"
                    min="1"
                    value={d}
                    onChange={e => setCustomDistanceAt(state, set)(idx, e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] font-bold text-slate-800 outline-none bg-transparent leading-none"
                    placeholder="누적 거리"
                  />
                  <span className="flex items-center justify-center px-2 bg-slate-50 text-slate-400 text-[10px] font-bold border-l border-slate-200 min-w-[28px]">
                    mm
                  </span>
                </div>
              </div>
            ))}
            <p className={`mt-1 text-[10px] leading-tight ${isErr ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
              {isErr ? `⚠ ${validation.msg}` : (validation.hint || '끝 변에서 각 거리만큼 누적')}
            </p>
          </div>
        ) : (
          <div className="px-2.5 py-2">
            <div className={`flex items-stretch border ${inputBorder} rounded-lg overflow-hidden bg-white transition-all`}>
              <input
                type="number"
                value={state.value}
                onChange={e => set({ ...state, value: e.target.value })}
                className="flex-1 min-w-0 px-2.5 py-2 text-[13px] font-bold text-slate-800 outline-none bg-transparent leading-none"
              />
              <span className="flex items-center justify-center px-2.5 bg-slate-50 text-slate-400 text-[10px] font-bold border-l border-slate-200 min-w-[32px]">
                {state.countMode === 'interval' ? 'mm' : 'EA'}
              </span>
            </div>
            <p className={`mt-1 text-[10px] leading-tight ${isErr ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
              {isErr ? `⚠ ${validation.msg}` : (validation.hint || ' ')}
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── 탭 상태
  const [activeTab, setActiveTab] = useState('design'); // 'design' | 'boundary'

  // 탭별 검증 에러 유무 — 배지 표시용
  const designHasError = ![vL, vB, vD, vTp, vTcorr, vStfH, vStfT, vStfC, vStfD,
    vStfArr.L, vStfArr.B, vStfArr.D].every(v => v.ok);
  const boundaryHasError = ![vAx, vAy, vAz, vAirV].every(v => v.ok);

  return (
    <div className="max-w-[1400px] mx-auto pb-6 animate-fade-in-up">

      <AnalysisPageBanner
        title="Independent Tank Assessment"
        subtitle="독립 탱크 치수·판두께·보강재·경계조건을 입력하여 구조 해석 모델을 구축합니다."
        icon={Box}
        guideTitle="[대화형] Independent Tank Assessment — 독립 탱크 모델링"
        onBack={() => setCurrentMenu('Interactive Apps')}
        backLabel="Interactive Apps로 돌아가기"
        gradient="from-brand-blue via-violet-900 to-violet-700"
        iconClassName="text-violet-300"
        subtitleClassName="text-violet-200/80"
      />

      {/* ═══════════════════════════════════════════════════════
          2컬럼: 좌측 탭 패널 + 우측 3D 뷰어 (항상 표시)
         ═══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-4 items-start mt-0">

        {/* ───── 좌측: 탭 헤더 + 탭 콘텐츠 ───── */}
        <div className="flex flex-col">

          {/* 탭 헤더 — violet 브랜드 강조, 에러 배지 포함 */}
          <div className="flex items-end gap-0 pt-3 pb-0">
            {/* Design 탭 */}
            <button
              type="button"
              onClick={() => setActiveTab('design')}
              className={`
                relative flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-t-xl border-x border-t
                transition-all duration-150 cursor-pointer select-none
                ${activeTab === 'design'
                  ? 'bg-white border-slate-200 text-violet-700 shadow-sm z-10'
                  : 'bg-slate-100/70 border-slate-200/60 text-slate-500 hover:text-violet-600 hover:bg-slate-50'}
              `}
            >
              <Ruler size={12} className="flex-shrink-0" />
              Design
              {/* 에러 배지 */}
              {designHasError && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-extrabold leading-none flex-shrink-0">
                  !
                </span>
              )}
            </button>

            {/* Boundary / Load 탭 */}
            <button
              type="button"
              onClick={() => setActiveTab('boundary')}
              className={`
                relative flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-t-xl border-x border-t ml-1
                transition-all duration-150 cursor-pointer select-none
                ${activeTab === 'boundary'
                  ? 'bg-white border-slate-200 text-violet-700 shadow-sm z-10'
                  : 'bg-slate-100/70 border-slate-200/60 text-slate-500 hover:text-violet-600 hover:bg-slate-50'}
              `}
            >
              <Anchor size={12} className="flex-shrink-0" />
              Boundary / Load
              {/* BC 선택 수 배지 (활성/비활성 공용) */}
              {bcRows.length > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 h-4 rounded-full bg-violet-600 text-white text-[9px] font-extrabold leading-none flex-shrink-0 min-w-[16px]">
                  {bcRows.length}
                </span>
              )}
              {/* 에러 배지 */}
              {boundaryHasError && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-extrabold leading-none flex-shrink-0">
                  !
                </span>
              )}
            </button>

            {/* 탭 하단 구분선 — 활성 탭과 연결감 */}
            <div className="flex-1 border-b border-slate-200 mb-0 self-end" />
          </div>

          {/* 탭 콘텐츠 컨테이너 — 흰 배경, 탭 헤더와 시각적 연결 */}
          <div className="border border-slate-200 rounded-b-xl rounded-tr-xl bg-white shadow-sm overflow-hidden">

            {/* ══ Design 탭 ══ */}
            {activeTab === 'design' && (
              <div className="p-3.5 space-y-3">

                {/* 섹션 디바이더 — Geometry */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest whitespace-nowrap">Geometry</span>
                  <div className="flex-1 border-t border-violet-200/80" />
                </div>

                {/* 탱크 치수 */}
                <SectionCard title="탱크 치수" icon={Ruler}>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <FieldLabel>L (길이)</FieldLabel>
                      <NumInput value={dimL} onChange={setDimL} unit="mm" validation={vL} />
                    </div>
                    <div>
                      <FieldLabel>B (폭)</FieldLabel>
                      <NumInput value={dimB} onChange={setDimB} unit="mm" validation={vB} />
                    </div>
                    <div>
                      <FieldLabel>D (높이)</FieldLabel>
                      <NumInput value={dimD} onChange={setDimD} unit="mm" validation={vD} />
                    </div>
                  </div>
                </SectionCard>

                {/* 판 두께 / Top Open */}
                <SectionCard title="판 두께 / Top Open" icon={Layers}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <FieldLabel>판 두께 (tp)</FieldLabel>
                      <NumInput value={tp} onChange={setTp} unit="mm" validation={vTp} />
                    </div>
                    <div className="min-w-0">
                      <FieldLabel>부식 여유 (tcorr)</FieldLabel>
                      <NumInput value={tcorr} onChange={setTcorr} unit="mm" validation={vTcorr} />
                    </div>
                    <div className="col-span-2 flex items-end gap-3 min-w-0">
                      <div className="flex-1 min-w-0">
                        <FieldLabel>Top Open (상판 유무)</FieldLabel>
                        <Select
                          value={topOpen}
                          onChange={setTopOpen}
                          options={[{ value: 'closed', label: '폐쇄형' }, { value: 'open', label: '개방형' }]}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {/* 섹션 디바이더 — Stiffener */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest whitespace-nowrap">Stiffener</span>
                  <div className="flex-1 border-t border-violet-200/80" />
                </div>

                {/* 보강재 배치 */}
                <SectionCard title="보강재 배치" icon={Settings2}>
                  <div className="space-y-2">
                    {axisRow('L', stfL, setStfL, vStfArr.L)}
                    {axisRow('B', stfB, setStfB, vStfArr.B)}
                    {axisRow('D', stfD, setStfD, vStfArr.D)}
                  </div>
                </SectionCard>

                {/* 보강재 치수 */}
                <SectionCard title="보강재 치수" icon={Activity}>
                  <div>
                    <FieldLabel>단면 형상</FieldLabel>
                    <Select
                      value={stfType}
                      onChange={(v) => {
                        setStfType(v);
                        if (v !== 'Flat') setStfSide('Outside');
                      }}
                      options={[
                        { value: 'Flat', label: 'Flat bar' },
                        { value: 'L',    label: 'L-Angle' },
                        { value: 'T',    label: 'T-Bar' },
                      ]}
                      className="w-full"
                    />
                  </div>

                  {/* Flat: A/B + 방향 3-col */}
                  {stfType === 'Flat' ? (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <FieldLabel>A (높이)</FieldLabel>
                        <NumInput value={stfDim1} onChange={setStfDim1} unit="mm" validation={vStfH} />
                      </div>
                      <div>
                        <FieldLabel>B (두께)</FieldLabel>
                        <NumInput value={stfDim2} onChange={setStfDim2} unit="mm" validation={vStfT} />
                      </div>
                      <div>
                        <FieldLabel>방향</FieldLabel>
                        <Select
                          value={stfSide}
                          onChange={setStfSide}
                          options={[{ value: 'Outside', label: 'Outside' }, { value: 'Inside', label: 'Inside' }]}
                          className="w-full"
                        />
                        <p className="mt-1 text-[10px] leading-tight text-slate-400">판 기준</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] font-bold text-slate-500">단면 치수</span>
                        <span className="font-mono text-[11px] text-violet-600 font-bold">A × B + C × D</span>
                      </div>

                      {/* WEB / 수직 leg */}
                      <div>
                        <div className="text-[10px] font-extrabold tracking-wider text-violet-700 uppercase mb-1">
                          {stfType === 'T' ? '웹 (Web)' : '수직 leg (Vertical)'}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <FieldLabel>A ({stfType === 'T' ? '높이' : 'leg'})</FieldLabel>
                            <NumInput value={stfDim1} onChange={setStfDim1} unit="mm" validation={vStfH} />
                          </div>
                          <div>
                            <FieldLabel>B (두께)</FieldLabel>
                            <NumInput value={stfDim2} onChange={setStfDim2} unit="mm" validation={vStfT} />
                          </div>
                        </div>
                      </div>

                      {/* FLG / 수평 leg */}
                      <div>
                        <div className="text-[10px] font-extrabold tracking-wider text-amber-700 uppercase mb-1">
                          {stfType === 'T' ? '플랜지 (Flange)' : '수평 leg (Horizontal)'}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <FieldLabel>C ({stfType === 'T' ? '폭' : 'leg'})</FieldLabel>
                            <NumInput value={stfDim3} onChange={setStfDim3} unit="mm" validation={vStfC} />
                          </div>
                          <div>
                            <FieldLabel>D (두께)</FieldLabel>
                            <NumInput value={stfDim4} onChange={setStfDim4} unit="mm" validation={vStfD} />
                          </div>
                        </div>
                      </div>

                      {/* 방향 (T/L = Outside 고정) */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <FieldLabel>방향</FieldLabel>
                        <Select
                          value={stfSide}
                          onChange={setStfSide}
                          disabled
                          options={[{ value: 'Outside', label: 'Outside' }]}
                        />
                        <span className="text-[10px] text-slate-400">Flat 만 Inside 가능</span>
                      </div>
                    </div>
                  )}
                </SectionCard>

              </div>
            )}

            {/* ══ Boundary / Load 탭 ══ */}
            {activeTab === 'boundary' && (
              <div className="p-3.5 space-y-3">

                {/* 섹션 디바이더 */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest whitespace-nowrap">Boundary &amp; Load</span>
                  <div className="flex-1 border-t border-violet-200/80" />
                </div>

                {/* ── Air Vent + 가속도: 2컬럼 나란히 ── */}
                <div className="grid grid-cols-2 gap-3">

                  {/* Air Vent */}
                  <SectionCard title="에어 벤트" icon={Wind} className="h-full flex flex-col">
                    <FieldLabel>Air vent height</FieldLabel>
                    <NumInput value={airVentH} onChange={setAirVentH} unit="mm" validation={vAirV} />
                    <p className="text-[10px] text-slate-400 leading-snug mt-auto pt-2">
                      D = <span className="font-bold text-slate-500">{dimD} mm</span> 이상 권장
                    </p>
                  </SectionCard>

                  {/* 가속도 */}
                  <SectionCard title="가속도" icon={Activity} className="h-full flex flex-col">
                    <div className="space-y-2">
                      <div>
                        <FieldLabel>a<sub>x</sub></FieldLabel>
                        <NumInput value={accX} onChange={setAccX} unit="g" validation={vAx} />
                      </div>
                      <div>
                        <FieldLabel>a<sub>y</sub></FieldLabel>
                        <NumInput value={accY} onChange={setAccY} unit="g" validation={vAy} />
                      </div>
                      <div>
                        <FieldLabel>a<sub>z</sub></FieldLabel>
                        <NumInput value={accZ} onChange={setAccZ} unit="g" validation={vAz} />
                      </div>
                    </div>
                  </SectionCard>

                </div>

                {/* ── 경계조건 BC — 풀폭 ── */}
                <SectionCard title="경계조건 (BC Node)" icon={Anchor}>
                  {/* 모드 선택 행: 자동 / 수동 */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">선택 방식</span>
                    <Select
                      value={bcMode}
                      onChange={setBcMode}
                      options={[
                        { value: 'manual', label: '수동 (클릭)' },
                        { value: 'auto',   label: '자동 (탱크 바닥 4 꼭짓점)' },
                      ]}
                      className="flex-1 text-[12px]"
                    />
                  </div>

                  {/* 안내 배너 — 모드별 메시지 분기 */}
                  {bcMode === 'auto' ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200/70">
                      <span className="text-emerald-600 font-bold text-[14px] leading-none">✓</span>
                      <p className="text-[11px] text-emerald-700 leading-snug flex-1">
                        <span className="font-extrabold">자동 모드</span> — 탱크 바닥(z=0)의{' '}
                        <span className="font-extrabold">4개 꼭짓점</span>이 경계조건으로 지정됩니다.
                        L/B 치수가 바뀌면 좌표도 자동 갱신.
                      </p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-100 border-emerald-300 text-emerald-700 whitespace-nowrap">
                        {bcRows.length} EA
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200/70">
                      <span className="text-red-500 font-bold text-[14px] leading-none">●</span>
                      <p className="text-[11px] text-violet-700 leading-snug flex-1">
                        우측 3D 뷰어의 <span className="font-extrabold text-red-600">빨간 Node</span>를 클릭하면{' '}
                        <span className="font-extrabold text-lime-600">▲</span> 마커로 BC가 지정됩니다.
                        <span className="text-violet-500"> 재클릭 시 해제.</span>
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                          bcRows.length > 0
                            ? 'bg-violet-100 border-violet-300 text-violet-700'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}>
                          {bcRows.length} EA
                        </span>
                        {bcRows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setBcRows([])}
                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-500 font-bold transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Trash2 size={10} /> 전체 해제
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* BC 노드 테이블 */}
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-y-auto max-h-[200px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200">
                          <tr className="text-slate-500 uppercase tracking-wider text-[10px]">
                            <th className="px-2 py-1.5 font-bold text-center w-8">#</th>
                            <th className="px-2 py-1.5 font-bold text-right">X</th>
                            <th className="px-2 py-1.5 font-bold text-right">Y</th>
                            <th className="px-2 py-1.5 font-bold text-right">Z</th>
                            <th className="px-1 py-1.5 w-6" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bcRows.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-5 text-center text-slate-400 text-[11px] leading-snug">
                                3D 뷰어에서 빨간 Node 를 클릭해<br />BC 위치를 지정하세요.
                              </td>
                            </tr>
                          ) : bcRows.map((r, idx) => (
                            <tr key={idx} className="hover:bg-violet-50/40 transition-colors">
                              <td className="px-2 py-1.5 text-center font-bold text-slate-400">{idx + 1}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-slate-700">{r.x}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-slate-700">{r.y}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-slate-700">{r.z ?? 0}</td>
                              <td className="px-1 text-center">
                                <button
                                  onClick={() => removeBcRow(idx)}
                                  disabled={bcMode === 'auto'}
                                  className={`p-0.5 transition-colors ${
                                    bcMode === 'auto'
                                      ? 'text-slate-200 cursor-not-allowed'
                                      : 'text-slate-300 hover:text-red-500 cursor-pointer'
                                  }`}
                                  title={bcMode === 'auto' ? '자동 모드에서는 삭제 불가' : '삭제'}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SectionCard>

              </div>
            )}

          </div>{/* end 탭 콘텐츠 컨테이너 */}

        </div>{/* end 좌측 탭 패널 */}

        {/* ───── 우측: 3D 뷰어 — 두 탭 모두에서 항상 표시 ───── */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-inner self-stretch min-h-[520px] min-w-0 overflow-hidden relative mt-3">
            <IndependentTankViewer
              L={Number(dimL)} B={Number(dimB)} D={Number(dimD)}
              topOpen={topOpen === 'open'}
              stiffeners={viewerStiffeners}
              section={viewerSection}
              onPickPoint={handlePickPoint}
              pickedPositions={pickedPositions}
            />

            {/* 뷰어 좌상단: 치수 정보 */}
            <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-sm border border-slate-700/70 rounded-lg px-3 py-1.5 shadow-lg">
              <div className="text-[10px] font-mono leading-snug">
                <span className="text-violet-300 font-bold">L × B × D</span>
                <span className="text-slate-200"> = </span>
                <span className="text-white font-bold">{dimL} × {dimB} × {dimD}</span>
                <span className="text-slate-400"> mm</span>
                {topOpen === 'open' && (
                  <span className="ml-1.5 text-amber-300 font-bold">· Top Open</span>
                )}
              </div>
            </div>

            {/* 뷰어 우상단: 범례 */}
            <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-sm border border-slate-700/70 rounded-lg px-2.5 py-2 shadow-lg space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-[2px] rounded-full bg-[#93c5fd]" />
                <span className="text-[10px] text-slate-300">Plate edge</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-[#fb923c]" />
                <span className="text-[10px] text-slate-300">Stiffener <span className="text-slate-400">({stfType})</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#a3e635] text-[11px] leading-none font-bold">▲</span>
                <span className="text-[10px] text-slate-300">Selected BC</span>
              </div>
            </div>

            {/* 뷰어 좌하단: 보강재 단면 라벨 */}
            <div className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur-sm border border-slate-700/70 rounded-lg px-3 py-1.5 shadow-lg">
              <div className="text-[10px] font-mono leading-snug">
                <span className="text-violet-300 font-bold">{stfType}</span>
                <span className="text-slate-200"> · </span>
                <span className="text-white">
                  {stfType === 'Flat'
                    ? `${stfDim1}×${stfDim2}`
                    : `${stfDim1}×${stfDim2} + ${stfDim3}×${stfDim4}`}
                </span>
                <span className="text-slate-400"> mm · </span>
                <span className="text-slate-300">{stfSide}</span>
              </div>
            </div>

            {/* 뷰어 우하단: 조작 안내 */}
            <div className="absolute bottom-3 right-3 bg-slate-900/75 backdrop-blur-sm border border-slate-700/70 rounded-lg px-2.5 py-1.5 shadow-lg">
              <div className="text-[9.5px] text-slate-400 font-mono leading-snug space-y-0.5">
                <div>드래그: 회전 · 휠: 줌 · 우클릭: 패닝</div>
                <div><span className="text-violet-300 font-bold">노드 클릭</span> → BC 포인트 지정</div>
              </div>
            </div>
        </div>{/* end 우측 뷰어 컬럼 */}

      </div>{/* end 2컬럼 그리드 */}

    </div>
  );
}
