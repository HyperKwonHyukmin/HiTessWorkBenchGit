import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import {
  Eye, EyeOff, PlayCircle, PauseCircle, RotateCcw, Maximize2, Minimize2, Weight, Crosshair,
} from 'lucide-react';

export default function BdfModelViewer({ modelData, cogPosition = null }) {
  const mountRef     = useRef(null);
  const containerRef = useRef(null);
  const controlsRef  = useRef(null);
  const nodesMeshRef = useRef(null);
  const conm2MeshRef = useRef(null);
  const cogMarkerRef = useRef(null);
  const rendererRef  = useRef(null);

  // 씬 재빌드 신호 — sceneVersion이 바뀌면 COG useEffect가 마커를 재삽입
  const [sceneVersion, setSceneVersion] = useState(0);
  // 씬 빌드 후 COG 마커 삽입에 필요한 참조
  const mainGroupRef  = useRef(null);
  const maxDimRef     = useRef(1000);
  const rodRadiusRef  = useRef(5);

  const [showNodes,  setShowNodes]  = useState(false);
  const [showConm2,  setShowConm2]  = useState(false);
  const [showCog,    setShowCog]    = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // showCog를 ref로도 유지 — COG 마커 생성 시 현재 값 참조
  const showCogRef = useRef(true);

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

  /* ── Three.js 씬 (COG 제외) ───────────────────────────── */
  // cogPosition은 의존성에 포함하지 않음 → 카메라 상태가 COG 도착 시 유지됨
  useEffect(() => {
    if (!mountRef.current || Object.keys(nodesDict).length === 0) return;

    const el = mountRef.current;
    const { scene, camera, renderer, controls, startAnimate, cleanup } =
      createThreeScene(el, { zUp: true });
    rendererRef.current = renderer;
    controlsRef.current = controls;

    /* bounding box → rodRadius */
    const tmpBox = new THREE.Box3();
    Object.values(nodesDict).forEach(p =>
      tmpBox.expandByPoint(new THREE.Vector3(...p)));
    const sz = new THREE.Vector3();
    tmpBox.getSize(sz);
    const maxDim    = Math.max(sz.x, sz.y, sz.z) || 1000;
    const rodRadius = maxDim * 0.0015;

    maxDimRef.current    = maxDim;
    rodRadiusRef.current = rodRadius;

    const group = new THREE.Group();

    /* ── 노드 구체 (초기 비표시) ── */
    const nodeIds = Object.keys(nodesDict);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0xffa040, metalness: 0.9, roughness: 0.1,
      emissive: 0xcc4400, emissiveIntensity: 0.6,
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
        color: 0x66ccff, metalness: 0.85, roughness: 0.15,
        emissive: 0x0044aa, emissiveIntensity: 0.35,
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

    /* ── CONM2 : 정팔면체 마커 ── */
    const validConm2 = conm2Nodes.filter(c => nodesDict[c.nodeId]);
    if (validConm2.length > 0) {
      const geo = new THREE.OctahedronGeometry(rodRadius * 4, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffcc00, metalness: 0.3, roughness: 0.3,
        emissive: 0x997700, emissiveIntensity: 0.9,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validConm2.length);
      const d = new THREE.Object3D();
      validConm2.forEach((c, i) => {
        d.position.set(...nodesDict[c.nodeId]); d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.visible = false;
      conm2MeshRef.current = inst;
      group.add(inst);
    }

    /* ── SPC 경계조건 : 박스 마커 ── */
    const validSpc = spcNodeIds.filter(nid => nodesDict[nid]);
    if (validSpc.length > 0) {
      const geo = new THREE.BoxGeometry(rodRadius * 3.5, rodRadius * 3.5, rodRadius * 3.5);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x44ff88, metalness: 0.3, roughness: 0.4,
        emissive: 0x00cc55, emissiveIntensity: 1.0,
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
    mainGroupRef.current = group;

    /* 카메라 초기화 */
    const box    = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.saveState();

    startAnimate(center, maxDim);

    // 씬 재빌드 완료 신호 → COG useEffect가 마커를 재삽입
    setSceneVersion(v => v + 1);

    return () => {
      mainGroupRef.current = null;
      cogMarkerRef.current = null;
      cleanup();
      rendererRef.current = null;
    };
  }, [nodesDict, beamElems, rbe2Pairs, conm2Nodes, spcNodeIds]);

  /* ── COG 마커 — 씬 재빌드나 cogPosition 변경 시 갱신 ──── */
  // 씬 빌드와 분리되어 있으므로 카메라가 리셋되지 않음
  useEffect(() => {
    const group = mainGroupRef.current;
    if (!group) return;

    // 기존 마커 제거 및 메모리 해제
    if (cogMarkerRef.current) {
      group.remove(cogMarkerRef.current);
      cogMarkerRef.current.traverse(child => {
        child.geometry?.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      cogMarkerRef.current = null;
    }

    if (!cogPosition) return;

    const maxDim    = maxDimRef.current;
    const rodRadius = rodRadiusRef.current;
    const cx = cogPosition.x, cy = cogPosition.y, cz = cogPosition.z;
    const markerR = maxDim * 0.018;
    const halfLen = maxDim * 0.07;
    const axisR   = rodRadius * 0.6;

    const cogGroup = new THREE.Group();

    // 황금 구체
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(markerR, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 1.2,
        metalness: 0.15, roughness: 0.15,
      })
    );
    sphere.position.set(cx, cy, cz);
    cogGroup.add(sphere);

    // 외부 링
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(markerR * 2.0, markerR * 0.15, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.7,
        metalness: 0.1, roughness: 0.3,
      })
    );
    ring.position.set(cx, cy, cz);
    cogGroup.add(ring);

    // 3축 크로스헤어 실린더 — X(빨강) / Y(초록) / Z(파랑)
    const makeAxis = (color, rotX, rotZ) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(axisR, axisR, halfLen * 2, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 })
      );
      mesh.rotation.set(rotX, 0, rotZ);
      mesh.position.set(cx, cy, cz);
      return mesh;
    };
    cogGroup.add(makeAxis(0xff4444, 0,           Math.PI / 2)); // X 축
    cogGroup.add(makeAxis(0x44ff66, 0,           0));           // Y 축
    cogGroup.add(makeAxis(0x4499ff, Math.PI / 2, 0));           // Z 축

    cogGroup.visible = showCogRef.current;
    group.add(cogGroup);
    cogMarkerRef.current = cogGroup;
  }, [cogPosition, sceneVersion]);

  /* ── 토글 sideeffects ─────────────────────────────────── */
  useEffect(() => {
    if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes;
  }, [showNodes]);

  useEffect(() => {
    if (conm2MeshRef.current) conm2MeshRef.current.visible = showConm2;
  }, [showConm2]);

  useEffect(() => {
    showCogRef.current = showCog;
    if (cogMarkerRef.current) cogMarkerRef.current.visible = showCog;
  }, [showCog]);

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
    ...(cogPosition ? [{ color: '#ffcc00', label: 'COG 무게중심 ✦' }] : []),
  ];

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-900">
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

      {/* COG 좌표 오버레이 */}
      {cogPosition && (
        <div className="absolute top-12 right-3 z-10 bg-slate-900/85 backdrop-blur rounded-xl border border-yellow-500/30 px-3 py-2.5 pointer-events-none shadow-lg">
          <p className="text-[9px] font-bold text-yellow-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
            COG 무게중심
          </p>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[9px] font-mono">
            <span className="text-red-400">X</span>
            <span className="text-green-400">Y</span>
            <span className="text-blue-400">Z</span>
            <span className="text-slate-200">{cogPosition.x.toFixed(0)}</span>
            <span className="text-slate-200">{cogPosition.y.toFixed(0)}</span>
            <span className="text-slate-200">{cogPosition.z.toFixed(0)}</span>
          </div>
        </div>
      )}

      {/* 컨트롤 툴바 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
        <button
          onClick={() => setShowNodes(v => !v)}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
        >
          {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
        </button>

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

        {cogPosition && (
          <button
            onClick={() => setShowCog(v => !v)}
            title="COG 무게중심 마커 표시/숨김"
            className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${
              showCog
                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            <Crosshair size={18} className="mb-1" />
            <span className="text-[8px] font-bold uppercase tracking-wider">COG</span>
          </button>
        )}

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
