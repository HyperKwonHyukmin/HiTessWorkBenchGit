/**
 * Independent Tank Assessment (Interactive App)
 *  - 좌측: 모든 입력 섹션을 한 컬럼에 세로로 배치 (탭 없이 한 화면)
 *  - 우측: three.js 뷰어 (sticky) — Z-up, 직육면체 6면 plate + 보강재 ring 라인
 *  - 입력 필드별 유효성 검사 + 가이드 힌트 제공. Job Submission 은 모든 검사 통과 시 활성화.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Line2 }                from 'three/examples/jsm/lines/Line2';
import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2';
import { LineGeometry }         from 'three/examples/jsm/lines/LineGeometry';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial';
import {
  Box, Ruler, Layers, Wind, ArrowLeft, Play, Plus, Trash2,
  Settings2, Activity, Eye, Anchor, AlertCircle
} from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
import PageBanner from '../../components/ui/PageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';

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

// 보강재 배치 검증 (간격/갯수 + 축길이 의존)
const validateStiffener = (state, axisLen) => {
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
// 공통 입력 UI (컴팩트 + 검증 표시)
// ────────────────────────────────────────────────────────────
const NumInput = ({ value, onChange, unit, placeholder, validation, className = '', disabled = false }) => {
  const isErr = validation && !validation.ok;
  const borderCls = isErr
    ? 'border-red-300 focus-within:border-red-500'
    : 'border-slate-200 focus-within:border-violet-500';
  return (
    <div className={className}>
      <div className={`flex items-center border ${borderCls} rounded-lg overflow-hidden bg-white transition-colors ${disabled ? 'opacity-50' : ''}`}>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-bold text-slate-800 outline-none bg-transparent"
        />
        {unit && <span className="px-2 py-1.5 bg-slate-50 text-slate-500 text-[10px] font-bold border-l border-slate-200">{unit}</span>}
      </div>
      {validation && (
        <p className={`mt-0.5 text-[10px] leading-tight ${isErr ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
          {isErr ? `⚠ ${validation.msg}` : validation.hint}
        </p>
      )}
    </div>
  );
};

const Select = ({ value, onChange, options, className = '' }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className={`bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-violet-500 cursor-pointer ${className}`}
  >
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const SectionCard = ({ title, icon: Icon, children }) => (
  <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
    <div className="bg-gradient-to-r from-violet-700 to-violet-600 px-4 py-2 flex items-center gap-2">
      <Icon size={12} className="text-white" />
      <h2 className="text-[10.5px] font-bold text-white uppercase tracking-wider">{title}</h2>
    </div>
    <div className="p-4 space-y-3">{children}</div>
  </div>
);

const FieldLabel = ({ children }) => (
  <label className="block text-[10.5px] font-bold text-slate-500 mb-1 tracking-tight">{children}</label>
);

// ────────────────────────────────────────────────────────────
// three.js 뷰어
// ────────────────────────────────────────────────────────────
function IndependentTankViewer({ L, B, D, topOpen, stiffeners }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1126);

    const camera = new THREE.PerspectiveCamera(40, w / h, 1, 1_000_000);
    camera.up.set(0, 0, 1);
    camera.position.set(4000, -4500, 2800);

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 50;

    scene.add(new THREE.AmbientLight(0x4a5670, 1.5));
    const key  = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1500, -2000, 2000); scene.add(key);
    const fill = new THREE.DirectionalLight(0x6a8cd4, 0.9);
    fill.position.set(-1500, 1500, 800); scene.add(fill);
    const rim  = new THREE.DirectionalLight(0xa78bfa, 0.5);
    rim.position.set(0, 2000, -500); scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);

    sceneRef.current = { scene, camera, renderer, controls };
    groupRef.current = group;

    let rafId = 0;
    const tick = () => {
      controls.update();
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

    const gridSize = Math.max(Ln, Bn) * 2;
    const grid = new THREE.GridHelper(gridSize, 20, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(Ln / 2, Bn / 2, 0);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    group.add(grid);

    const axes = new THREE.AxesHelper(Math.min(Ln, Bn, Dn) * 0.4);
    group.add(axes);

    // 뷰포트 크기 (LineMaterial resolution 용)
    const vp = new THREE.Vector2(ctx.renderer.domElement.width, ctx.renderer.domElement.height);

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x6f9fd8, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, metalness: 0.15, roughness: 0.55,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      depthWrite: false,
    });
    // plate edge — Line2 (픽셀 두께)
    const edgeMat = new LineMaterial({
      color: 0xbfd9ff, linewidth: 1.4, transparent: true, opacity: 0.9,
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

    // 보강재 — Line2 (픽셀 두께, plate 위에 항상 또렷이 보이도록 depthTest 끔)
    const stfMat = new LineMaterial({
      color: 0xfbbf24, linewidth: 2.4, transparent: true, opacity: 1.0,
      resolution: vp.clone(), worldUnits: false, depthTest: false,
    });
    const addRect = (corners) => {
      const flat = [];
      corners.forEach(([x, y, z]) => flat.push(x, y, z));
      flat.push(corners[0][0], corners[0][1], corners[0][2]); // 닫힌 사각형
      const lg = new LineGeometry();
      lg.setPositions(flat);
      const line = new Line2(lg, stfMat);
      line.computeLineDistances();
      line.renderOrder = 3; // edge 위에 그려져 가려지지 않음
      group.add(line);
    };

    const positionsAlong = (axisLen, conf) => {
      if (!conf) return [];
      const v = Number(conf.value) || 0;
      if (v <= 0) return [];
      let count = 0;
      if (conf.countMode === 'count') count = Math.floor(v);
      else count = Math.max(0, Math.floor(axisLen / v) - 1);
      if (count <= 0) return [];
      const step = axisLen / (count + 1);
      return Array.from({ length: count }, (_, i) => step * (i + 1));
    };

    positionsAlong(Ln, stiffeners?.L).forEach(x => {
      addRect([[x, 0, 0], [x, Bn, 0], [x, Bn, Dn], [x, 0, Dn]]);
    });
    positionsAlong(Bn, stiffeners?.B).forEach(y => {
      addRect([[0, y, 0], [Ln, y, 0], [Ln, y, Dn], [0, y, Dn]]);
    });
    positionsAlong(Dn, stiffeners?.D).forEach(z => {
      addRect([[0, 0, z], [Ln, 0, z], [Ln, Bn, z], [0, Bn, z]]);
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
  }, [L, B, D, topOpen, stiffeners]);

  return <div ref={mountRef} className="w-full h-full" />;
}

// ────────────────────────────────────────────────────────────
// 메인 페이지
// ────────────────────────────────────────────────────────────
export default function IndependentTankAssessment() {
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();

  // ── Geometry
  const [dimL, setDimL] = useState(2000);
  const [dimB, setDimB] = useState(1000);
  const [dimD, setDimD] = useState(500);
  const [tp, setTp] = useState(10);
  const [tcorr, setTcorr] = useState(1);
  const [topOpen, setTopOpen] = useState('closed');
  const [stfL, setStfL] = useState({ type: 'uniform', countMode: 'count',    value: 3 });
  const [stfB, setStfB] = useState({ type: 'uniform', countMode: 'interval', value: 500 });
  const [stfD, setStfD] = useState({ type: 'uniform', countMode: 'count',    value: 2 });
  const [stfType, setStfType] = useState('Flat');
  const [stfDim1, setStfDim1] = useState(75);
  const [stfDim2, setStfDim2] = useState(9);
  const [stfSide, setStfSide] = useState('Outside');

  // ── Boundary & Load
  const [airVentH, setAirVentH] = useState(2500);
  const [accX, setAccX] = useState(0.3);
  const [accY, setAccY] = useState(0.8);
  const [accZ, setAccZ] = useState(0.6);
  const [bcMode, setBcMode] = useState('auto');
  const [bcRows, setBcRows] = useState([]);

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

  const allValid = [vL, vB, vD, vTp, vTcorr, vStfH, vStfT, vAx, vAy, vAz, vAirV,
    vStfArr.L, vStfArr.B, vStfArr.D].every(v => v.ok);

  const addBcRow    = () => setBcRows([...bcRows, { x: 0, y: 0 }]);
  const removeBcRow = (idx) => setBcRows(bcRows.filter((_, i) => i !== idx));
  const updateBcRow = (idx, key, val) => setBcRows(bcRows.map((r, i) => i === idx ? { ...r, [key]: val } : r));

  // 보강재 모드 전환 시 적정 기본값으로 자동 갱신
  const setStfMode = (state, set) => (mode) => {
    if (mode === state.countMode) return;
    set({ ...state, countMode: mode, value: defaultStfValue(mode) });
  };

  const axisRow = (label, state, set, validation) => (
    <div className="space-y-1">
      <div className="grid grid-cols-[18px_1fr_1fr_1fr] items-center gap-1.5">
        <span className="text-[11px] font-extrabold text-slate-500">{label}</span>
        <Select
          value={state.type}
          onChange={v => set({ ...state, type: v })}
          options={[{ value: 'uniform', label: '등간격' }, { value: 'custom', label: '사용자입력' }]}
        />
        <Select
          value={state.countMode}
          onChange={setStfMode(state, set)}
          options={[{ value: 'interval', label: '간격' }, { value: 'count', label: '갯수' }]}
        />
        <div>
          <div className={`flex items-center border rounded-lg overflow-hidden bg-white transition-colors ${
            validation.ok
              ? 'border-slate-200 focus-within:border-violet-500'
              : 'border-red-300 focus-within:border-red-500'
          }`}>
            <input
              type="number"
              value={state.value}
              onChange={e => set({ ...state, value: e.target.value })}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-bold text-slate-800 outline-none bg-transparent"
            />
            <span className="px-2 py-1.5 bg-slate-50 text-slate-500 text-[10px] font-bold border-l border-slate-200">
              {state.countMode === 'interval' ? 'mm' : 'EA'}
            </span>
          </div>
        </div>
      </div>
      <p className={`pl-6 text-[10px] leading-tight ${validation.ok ? 'text-slate-400' : 'text-red-500 font-bold'}`}>
        {validation.ok ? validation.hint : `⚠ ${validation.msg}`}
      </p>
    </div>
  );

  const handleJobSubmit = () => {
    if (!allValid) {
      showToast('입력값을 확인하세요. 빨간색으로 표시된 항목이 있습니다.', 'error');
      return;
    }
    const payload = {
      geometry: {
        L: Number(dimL), B: Number(dimB), D: Number(dimD),
        plate: { tp: Number(tp), tcorr: Number(tcorr) },
        topOpen,
        stiffeners: {
          L: stfL, B: stfB, D: stfD,
          section: { type: stfType, dim1: Number(stfDim1), dim2: Number(stfDim2), side: stfSide },
        },
      },
      boundaryLoad: {
        airVentHeight: Number(airVentH),
        acceleration: { x: Number(accX), y: Number(accY), z: Number(accZ) },
        bcMode, bcRows,
      },
    };
    // eslint-disable-next-line no-console
    console.log('[IndependentTankAssessment] Job Submission payload', payload);
    showToast('Job Submission (placeholder) — 콘솔에서 입력 JSON을 확인하세요.', 'info');
  };

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">

      <PageBanner gradient="from-brand-blue via-violet-900 to-violet-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('Interactive Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Box size={18} className="text-violet-300" />
              Independent Tank Assessment
            </h1>
            <p className="text-sm text-violet-200/80 mt-0.5">독립 탱크 치수·판두께·보강재·경계조건을 입력하여 구조 해석 모델을 구축합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!allValid && (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/20 border border-red-300/40 text-red-100 text-[10px] font-bold">
              <AlertCircle size={11}/> 입력값 확인 필요
            </span>
          )}
          <button
            onClick={handleJobSubmit}
            disabled={!allValid}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-bold transition-colors shadow ${
              allValid
                ? 'bg-violet-500 hover:bg-violet-400 cursor-pointer'
                : 'bg-slate-500/50 cursor-not-allowed opacity-70'
            }`}
          >
            <Play size={14} /> Job Submission
          </button>
          <GuideButton guideTitle="[대화형] Independent Tank Assessment — 독립 탱크 모델링" variant="dark" />
        </div>
      </PageBanner>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">

        {/* ───── 좌측 입력 패널 (한 화면) ───── */}
        <div className="space-y-3">

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest">Geometry</span>
            <div className="flex-1 border-t border-violet-200/60" />
          </div>

          <SectionCard title="탱크 치수" icon={Ruler}>
            <div className="grid grid-cols-3 gap-2">
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

          <SectionCard title="판 두께 / Top Open" icon={Layers}>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel>tp</FieldLabel>
                <NumInput value={tp} onChange={setTp} unit="mm" validation={vTp} />
              </div>
              <div>
                <FieldLabel>tcorr</FieldLabel>
                <NumInput value={tcorr} onChange={setTcorr} unit="mm" validation={vTcorr} />
              </div>
              <div>
                <FieldLabel>Top Open</FieldLabel>
                <Select
                  value={topOpen}
                  onChange={setTopOpen}
                  options={[{ value: 'closed', label: '폐쇄형' }, { value: 'open', label: '개방형' }]}
                  className="w-full"
                />
                <p className="mt-0.5 text-[10px] leading-tight text-slate-400">상판 유무</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="보강재 배치" icon={Settings2}>
            <div className="space-y-2">
              {axisRow('L', stfL, setStfL, vStfArr.L)}
              {axisRow('B', stfB, setStfB, vStfArr.B)}
              {axisRow('D', stfD, setStfD, vStfArr.D)}
            </div>
          </SectionCard>

          <SectionCard title="보강재 치수" icon={Activity}>
            {/* 1행: 단면 단독 */}
            <div>
              <FieldLabel>단면 형상</FieldLabel>
              <Select
                value={stfType}
                onChange={setStfType}
                options={[
                  { value: 'Flat', label: 'Flat bar' },
                  { value: 'L',    label: 'L-Angle' },
                  { value: 'T',    label: 'T-Bar' },
                ]}
                className="w-full"
              />
            </div>
            {/* 2행: h | t | 방향 */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel>h (높이)</FieldLabel>
                <NumInput value={stfDim1} onChange={setStfDim1} unit="mm" validation={vStfH} />
              </div>
              <div>
                <FieldLabel>t (두께)</FieldLabel>
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
                <p className="mt-0.5 text-[10px] leading-tight text-slate-400">판 기준</p>
              </div>
            </div>
          </SectionCard>

          <div className="flex items-center gap-2 pt-3">
            <span className="text-[10px] font-extrabold text-violet-600 uppercase tracking-widest">Boundary &amp; Load</span>
            <div className="flex-1 border-t border-violet-200/60" />
          </div>

          <SectionCard title="에어 벤트" icon={Wind}>
            <div>
              <FieldLabel>Air vent height</FieldLabel>
              <NumInput value={airVentH} onChange={setAirVentH} unit="mm" validation={vAirV} />
            </div>
          </SectionCard>

          <SectionCard title="가속도" icon={Activity}>
            <div className="grid grid-cols-3 gap-2">
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

          <SectionCard title="경계조건" icon={Anchor}>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={bcMode}
                onChange={setBcMode}
                options={[{ value: 'auto', label: '자동' }, { value: 'manual', label: '수동' }]}
              />
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold transition-colors cursor-pointer"
              >
                <Eye size={13}/> BC Show
              </button>
              {bcMode === 'manual' && (
                <button
                  type="button"
                  onClick={addBcRow}
                  className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plus size={12}/> 행 추가
                </button>
              )}
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[180px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-slate-500 uppercase tracking-wider">
                    <th className="px-3 py-1.5 font-bold text-center w-12">No</th>
                    <th className="px-3 py-1.5 font-bold text-center">x</th>
                    <th className="px-3 py-1.5 font-bold text-center">y</th>
                    {bcMode === 'manual' && <th className="px-2 py-1.5 w-8"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bcRows.length === 0 && (
                    <tr>
                      <td colSpan={bcMode === 'manual' ? 4 : 3} className="px-3 py-4 text-center text-slate-400 text-[11px]">
                        {bcMode === 'auto' ? '자동 모드 — BC Show로 결과 확인' : '행을 추가해 좌표를 입력하세요.'}
                      </td>
                    </tr>
                  )}
                  {bcRows.map((r, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-1 text-center font-bold text-slate-500">{idx + 1}</td>
                      <td className="px-2 py-0.5">
                        <input type="number" value={r.x} onChange={e => updateBcRow(idx, 'x', e.target.value)}
                          className="w-full px-2 py-1 text-sm font-mono text-right outline-none border border-transparent focus:border-violet-300 rounded" />
                      </td>
                      <td className="px-2 py-0.5">
                        <input type="number" value={r.y} onChange={e => updateBcRow(idx, 'y', e.target.value)}
                          className="w-full px-2 py-1 text-sm font-mono text-right outline-none border border-transparent focus:border-violet-300 rounded" />
                      </td>
                      {bcMode === 'manual' && (
                        <td className="px-1 text-center">
                          <button onClick={() => removeBcRow(idx)} className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"><Trash2 size={12}/></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

        </div>

        {/* ───── 우측 3D 뷰어 (sticky) ───── */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-inner h-[calc(100vh-160px)] min-h-[560px] overflow-hidden relative">
            <IndependentTankViewer
              L={Number(dimL)} B={Number(dimB)} D={Number(dimD)}
              topOpen={topOpen === 'open'}
              stiffeners={{ L: stfL, B: stfB, D: stfD }}
            />

            <div className="absolute top-3 left-3 bg-slate-900/75 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] text-slate-200 font-mono shadow">
              <span className="text-violet-300">L × B × D</span> = {dimL} × {dimB} × {dimD} mm
              {topOpen === 'open' && <span className="ml-2 text-amber-300">· Top Open</span>}
            </div>

            <div className="absolute top-3 right-3 bg-slate-900/75 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-1.5 text-[10px] space-y-0.5 shadow">
              <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#bfd9ff]"/><span className="text-slate-300">Plate edge</span></div>
              <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#fbbf24]"/><span className="text-slate-300">Stiffener</span></div>
            </div>

            <div className="absolute bottom-3 right-3 bg-slate-900/75 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-1.5 text-[10px] text-slate-400 font-mono">
              마우스: 회전 / 휠: 줌 / 우클릭: 패닝
            </div>

            <div className="absolute bottom-3 left-3 bg-slate-900/75 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] text-slate-200 font-mono shadow">
              <span className="text-violet-300">{stfType}</span> {stfDim1}×{stfDim2} · {stfSide}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
