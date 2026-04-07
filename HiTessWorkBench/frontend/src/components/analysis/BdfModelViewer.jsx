import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
  Eye, EyeOff, PlayCircle, PauseCircle, RotateCcw, Maximize2, Minimize2, Weight
} from 'lucide-react';

export default function BdfModelViewer({ modelData }) {
  const mountRef    = useRef(null);
  const containerRef = useRef(null);
  const controlsRef  = useRef(null);
  const nodesMeshRef = useRef(null);
  const conm2MeshRef = useRef(null);
  const rendererRef  = useRef(null);

  const [showNodes,    setShowNodes]    = useState(false);
  const [showConm2,    setShowConm2]    = useState(false);
  const [autoRotate,   setAutoRotate]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /* ── 데이터 전처리 ─────────────────────────────────────── */
  const nodesDict = useMemo(() => {
    const d = {};
    (modelData?.grids || []).forEach(g => { d[g.id] = [g.x, g.y, g.z]; });
    return d;
  }, [modelData]);

  const { beamElems, rbe2Pairs, conm2Nodes, spcNodeIds } = useMemo(() => {
    const beamElems = [], rbe2Pairs = [], conm2Nodes = [];
    (modelData?.elements || []).forEach(el => {
      if (['CBEAM', 'CBAR', 'CROD'].includes(el.cardType))
        beamElems.push({ id: el.id, n1: el.nodeIds[0], n2: el.nodeIds[1] });
      else if (el.cardType === 'RBE2')
        (el.dependentNodeIds || []).forEach(dn =>
          rbe2Pairs.push({ id: el.id, n1: el.independentNodeId, n2: dn }));
      else if (el.cardType === 'CONM2')
        conm2Nodes.push({ id: el.id, nodeId: el.nodeId, mass: el.mass });
    });
    const spcSet = new Set();
    (modelData?.boundaryConditions || []).forEach(bc => {
      if (bc.nodeId != null) spcSet.add(bc.nodeId);
      (bc.nodeIds || []).forEach(nid => spcSet.add(nid));
    });
    return { beamElems, rbe2Pairs, conm2Nodes, spcNodeIds: [...spcSet] };
  }, [modelData]);

  /* ── 전체화면 ─────────────────────────────────────────── */
  const toggleFullscreen = () => {
    if (!isFullscreen) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ── Three.js 씬 ──────────────────────────────────────── */
  useEffect(() => {
    if (!mountRef.current || Object.keys(nodesDict).length === 0) return;

    const el = mountRef.current;
    const w  = el.clientWidth  || 800;
    const h  = el.clientHeight || 500;

    /* scene */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);

    /* camera */
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 10_000_000);
    camera.up.set(0, 0, 1);

    /* renderer */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.width  = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    /* controls */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    /* lights */
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 7);
    scene.add(dir);
    const pt = new THREE.PointLight(0x00ccff, 1.5, 0);
    scene.add(pt);

    /* bounding box → rodRadius */
    const tmpBox = new THREE.Box3();
    Object.values(nodesDict).forEach(p =>
      tmpBox.expandByPoint(new THREE.Vector3(...p)));
    const sz = new THREE.Vector3();
    tmpBox.getSize(sz);
    const maxDim    = Math.max(sz.x, sz.y, sz.z) || 1000;
    const rodRadius = maxDim * 0.0015;

    const group = new THREE.Group();

    /* ── 노드 구체 (초기 비표시) ── */
    const nodeIds = Object.keys(nodesDict);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0xffa040, metalness: 0.6, roughness: 0.2,
      emissive: 0xff6600, emissiveIntensity: 0.5,
    });
    const instNodes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(rodRadius * 1.8, 8, 8), nodeMat, nodeIds.length);
    const dN = new THREE.Object3D();
    nodeIds.forEach((k, i) => {
      dN.position.set(...nodesDict[k]); dN.updateMatrix();
      instNodes.setMatrixAt(i, dN.matrix);
    });
    instNodes.instanceMatrix.needsUpdate = true;
    instNodes.visible = false;
    group.add(instNodes);
    nodesMeshRef.current = instNodes;

    /* ── CBEAM / CBAR / CROD ── */
    const validBeams = beamElems.filter(e => nodesDict[e.n1] && nodesDict[e.n2]);
    if (validBeams.length > 0) {
      const geo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x66ccff, metalness: 0.7, roughness: 0.2,
        emissive: 0x0055aa, emissiveIntensity: 0.4,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validBeams.length);
      const d = new THREE.Object3D();
      validBeams.forEach((e, i) => {
        const p1 = new THREE.Vector3(...nodesDict[e.n1]);
        const p2 = new THREE.Vector3(...nodesDict[e.n2]);
        d.position.copy(p1).lerp(p2, 0.5);
        d.scale.set(1, 1, p1.distanceTo(p2));
        d.lookAt(p2); d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    /* ── RBE2 ── */
    const validRbe2 = rbe2Pairs.filter(e => nodesDict[e.n1] && nodesDict[e.n2]);
    if (validRbe2.length > 0) {
      const geo = new THREE.CylinderGeometry(rodRadius * 0.5, rodRadius * 0.5, 1, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff6644, metalness: 0.5, roughness: 0.4,
        emissive: 0x881100, emissiveIntensity: 0.4,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validRbe2.length);
      const d = new THREE.Object3D();
      validRbe2.forEach((e, i) => {
        const p1 = new THREE.Vector3(...nodesDict[e.n1]);
        const p2 = new THREE.Vector3(...nodesDict[e.n2]);
        d.position.copy(p1).lerp(p2, 0.5);
        d.scale.set(1, 1, p1.distanceTo(p2));
        d.lookAt(p2); d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    /* ── CONM2 : 정팔면체 마커 (노드 구체와 구분) ── */
    const validConm2 = conm2Nodes.filter(c => nodesDict[c.nodeId]);
    if (validConm2.length > 0) {
      // OctahedronGeometry → 다이아몬드 형태, 노드 구체와 시각적으로 명확히 구분
      const geo = new THREE.OctahedronGeometry(rodRadius * 4, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffcc00, metalness: 0.3, roughness: 0.3,
        emissive: 0x886600, emissiveIntensity: 0.6,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validConm2.length);
      const d = new THREE.Object3D();
      validConm2.forEach((c, i) => {
        d.position.set(...nodesDict[c.nodeId]); d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.visible = false;          // 초기 비표시
      conm2MeshRef.current = inst;   // ref 저장 → 토글 제어
      group.add(inst);
    }

    /* ── SPC 경계조건 : 작은 박스 마커 ── */
    const validSpc = spcNodeIds.filter(nid => nodesDict[nid]);
    if (validSpc.length > 0) {
      const geo = new THREE.BoxGeometry(rodRadius * 3.5, rodRadius * 3.5, rodRadius * 3.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x44ff88, metalness: 0.3, roughness: 0.4,
        emissive: 0x00aa44, emissiveIntensity: 0.5,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validSpc.length);
      const d = new THREE.Object3D();
      validSpc.forEach((nid, i) => {
        d.position.set(...nodesDict[nid]); d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }

    scene.add(group);

    /* 카메라 초기화 */
    const box    = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.saveState();

    /* ResizeObserver — 전체화면 복귀 포함 */
    const resizeObserver = new ResizeObserver(() => {
      const rw = el.clientWidth;
      const rh = el.clientHeight;
      if (!rw || !rh) return;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
      // 전체화면 복귀 시 canvas 스타일 명시적 리셋
      renderer.domElement.style.width  = '100%';
      renderer.domElement.style.height = '100%';
    });
    resizeObserver.observe(el);

    /* animate */
    let animId;
    let t = 0;
    const radius = maxDim * 0.5;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.008;
      pt.position.set(
        center.x + Math.sin(t) * radius,
        center.y + maxDim * 0.3,
        center.z + Math.cos(t) * radius,
      );
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      scene.traverse(obj => {
        obj.geometry?.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      try { el.removeChild(renderer.domElement); } catch (_) {}
      rendererRef.current = null;
    };
  }, [nodesDict, beamElems, rbe2Pairs, conm2Nodes, spcNodeIds]);

  /* ── 토글 sideeffects ─────────────────────────────────── */
  useEffect(() => {
    if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes;
  }, [showNodes]);

  useEffect(() => {
    if (conm2MeshRef.current) conm2MeshRef.current.visible = showConm2;
  }, [showConm2]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.5;
    }
  }, [autoRotate]);

  const legend = [
    { color: '#66ccff', label: 'CBEAM / CBAR / CROD' },
    { color: '#ff6644', label: 'RBE2 (강체 연결)' },
    { color: '#ffcc00', label: 'CONM2 (집중 질량) ◆' },
    { color: '#44ff88', label: 'SPC (경계 조건) ■' },
    { color: '#ffa040', label: 'Grid Node (토글)' },
  ];

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-900">
      {/* Three.js 마운트 포인트: position relative로 canvas가 내부에 위치 */}
      <div ref={mountRef} className="absolute inset-0 cursor-move overflow-hidden" />

      {/* 전체화면 버튼 */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? '전체화면 종료' : '전체화면'}
        className="absolute top-3 right-3 z-20 bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 p-1.5 rounded-lg transition-colors cursor-pointer shadow"
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {/* 범례 */}
      <div className="absolute top-3 left-3 z-10 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 px-3 py-2.5 pointer-events-none shadow-lg">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Legend</p>
        <div className="flex flex-col gap-1">
          {legend.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-4 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-mono text-slate-300">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 컨트롤 툴바 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
        <button
          onClick={() => setShowNodes(v => !v)}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
        >
          {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
        </button>

        {/* CONM2 집중 질량 토글 — CONM2 없으면 비활성화 */}
        <button
          onClick={() => conm2Nodes.length > 0 && setShowConm2(v => !v)}
          disabled={conm2Nodes.length === 0}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors ${
            conm2Nodes.length === 0
              ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
              : showConm2
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 cursor-pointer'
              : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'
          }`}
          title={conm2Nodes.length === 0 ? 'CONM2 없음' : `집중 질량 ${conm2Nodes.length}개`}
        >
          <Weight size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">Mass</span>
        </button>

        <button
          onClick={() => setAutoRotate(v => !v)}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
        >
          {autoRotate ? <PauseCircle size={18} className="mb-1" /> : <PlayCircle size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Rotate</span>
        </button>
        <button
          onClick={() => controlsRef.current?.reset()}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer"
        >
          <RotateCcw size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">Reset</span>
        </button>
      </div>
    </div>
  );
}
