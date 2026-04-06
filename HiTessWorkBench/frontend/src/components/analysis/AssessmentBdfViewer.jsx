import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import {
  Eye, EyeOff, LayoutGrid, Hexagon, CheckCircle2,
  PlayCircle, PauseCircle, RotateCcw, Maximize2, Minimize2
} from 'lucide-react';

export default function AssessmentBdfViewer({ nodes, elements, resultData }) {
  const mountRef = useRef(null);

  const [showNodes, setShowNodes] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showResult, setShowResult] = useState(true);
  const [activeLcIdx, setActiveLcIdx] = useState(-1);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef(null);
  const controlsRef = useRef(null);
  const nodesMeshRef = useRef(null);
  const elementsGroupRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const cameraRef = useRef(null);
  const instanceToEidRef = useRef([]);

  const lcList = useMemo(() => {
    if (!resultData?.loadCases) return [];
    return resultData.loadCases.map((lc, i) => ({ idx: i, id: lc.loadCaseIndex, label: `LC${lc.loadCaseIndex}` }));
  }, [resultData]);

  const assessmentToColor = (val) => {
    const v = Math.min(val, 1.5);
    if (v < 0.5)  return new THREE.Color().setHSL(0.60, 1.0, 0.50);
    if (v < 0.8)  return new THREE.Color().setHSL(0.40 - (v - 0.5) * 0.8, 1.0, 0.50);
    if (v < 1.0)  return new THREE.Color().setHSL(0.10 - (v - 0.8) * 0.5, 1.0, 0.50);
    return new THREE.Color().setHSL(0.0, 1.0, 0.50);
  };

  const assessmentMap = useMemo(() => {
    if (!resultData?.loadCases) return null;
    const map = {};
    if (activeLcIdx === -1) {
      resultData.loadCases.forEach(lc => {
        (lc.elementAssessment || []).forEach(row => {
          const eid = Number(row.element);
          const val = parseFloat(row.assessment) || 0;
          if (!(eid in map) || val > map[eid]) map[eid] = { assessment: val, result: val >= 1.0 ? 'FAIL' : 'OK' };
        });
      });
    } else {
      const lc = resultData.loadCases[activeLcIdx];
      if (lc) {
        (lc.elementAssessment || []).forEach(row => {
          const eid = Number(row.element);
          map[eid] = { assessment: parseFloat(row.assessment) || 0, result: row.result || 'OK' };
        });
      }
    }
    return map;
  }, [resultData, activeLcIdx]);

  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    const onMouseMove = (e) => {
      const rect = el.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (!cameraRef.current || !elementsGroupRef.current) { setHoverInfo(null); return; }
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const intersects = raycasterRef.current.intersectObject(elementsGroupRef.current);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        const eid = instanceToEidRef.current[instanceId];
        if (eid != null && assessmentMap && assessmentMap[eid]) {
          setHoverInfo({ x: e.clientX - rect.left, y: e.clientY - rect.top, eid, assessment: assessmentMap[eid].assessment, result: assessmentMap[eid].result });
        } else if (eid != null) {
          setHoverInfo({ x: e.clientX - rect.left, y: e.clientY - rect.top, eid, assessment: null, result: null });
        } else { setHoverInfo(null); }
      } else { setHoverInfo(null); }
    };
    const onMouseLeave = () => setHoverInfo(null);
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseleave', onMouseLeave);
    return () => { el.removeEventListener('mousemove', onMouseMove); el.removeEventListener('mouseleave', onMouseLeave); };
  }, [assessmentMap]);

  const toggleFullscreen = () => {
    if (!isFullscreen) { containerRef.current?.requestFullscreen?.(); }
    else { document.exitFullscreen?.(); }
  };
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const nodeKeys = Object.keys(nodes);
    if (!mountRef.current || nodeKeys.length === 0) return;
    let renderer, scene, camera, controls, animationId;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b);
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(1, 1, 2);
    scene.add(dirLight);
    const modelGroup = new THREE.Group();
    const tempBox = new THREE.Box3();
    Object.values(nodes).forEach(pos => tempBox.expandByPoint(new THREE.Vector3(...pos)));
    const size = new THREE.Vector3();
    tempBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1000;
    const rodRadius = maxDim * 0.0015;
    const sphereGeo = new THREE.SphereGeometry(rodRadius * 1.8, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0xFF3333, roughness: 0.3, metalness: 0.2 });
    const instancedNodes = new THREE.InstancedMesh(sphereGeo, sphereMat, nodeKeys.length);
    const dummyNode = new THREE.Object3D();
    nodeKeys.forEach((key, index) => {
      const [x, y, z] = nodes[key]; dummyNode.position.set(x, y, z); dummyNode.updateMatrix();
      instancedNodes.setMatrixAt(index, dummyNode.matrix);
    });
    instancedNodes.instanceMatrix.needsUpdate = true;
    instancedNodes.visible = false;
    modelGroup.add(instancedNodes);
    nodesMeshRef.current = instancedNodes;
    if (elements.length > 0) {
      const cylinderGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
      cylinderGeo.rotateX(Math.PI / 2);
      const hasColorResult = assessmentMap && Object.keys(assessmentMap).length > 0 && showResult;
      const cylinderMat = new THREE.MeshStandardMaterial({ color: hasColorResult ? 0xffffff : 0x7dd3fc, roughness: 0.4, metalness: 0.3 });
      const instancedElements = new THREE.InstancedMesh(cylinderGeo, cylinderMat, elements.length);
      instancedElements.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(elements.length * 3), 3);
      const dummyElem = new THREE.Object3D();
      const defaultColor = new THREE.Color(hasColorResult ? 0x94a3b8 : 0x7dd3fc);
      const eidMapping = [];
      let validElemCount = 0;
      elements.forEach(([n1, n2, eid]) => {
        if (nodes[n1] && nodes[n2]) {
          const p1 = new THREE.Vector3(...nodes[n1]);
          const p2 = new THREE.Vector3(...nodes[n2]);
          const distance = p1.distanceTo(p2);
          dummyElem.position.copy(p1).lerp(p2, 0.5);
          dummyElem.scale.set(1, 1, distance);
          dummyElem.lookAt(p2);
          dummyElem.updateMatrix();
          instancedElements.setMatrixAt(validElemCount, dummyElem.matrix);
          if (hasColorResult && eid != null && assessmentMap[eid]) {
            instancedElements.setColorAt(validElemCount, assessmentToColor(assessmentMap[eid].assessment));
          } else { instancedElements.setColorAt(validElemCount, defaultColor); }
          eidMapping.push(eid);
          validElemCount++;
        }
      });
      instanceToEidRef.current = eidMapping;
      instancedElements.count = validElemCount;
      instancedElements.instanceMatrix.needsUpdate = true;
      if (instancedElements.instanceColor) instancedElements.instanceColor.needsUpdate = true;
      modelGroup.add(instancedElements);
      elementsGroupRef.current = instancedElements;
    }
    scene.add(modelGroup);
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.saveState();
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
      }
    });
    resizeObserver.observe(mountRef.current);
    const animate = () => { animationId = requestAnimationFrame(animate); controls.update(); dirLight.position.copy(camera.position); renderer.render(scene, camera); };
    animate();
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
          else object.material.dispose();
        }
      });
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
      if (mountRef.current && renderer.domElement) { try { mountRef.current.removeChild(renderer.domElement); } catch(e) {} }
    };
  }, [nodes, elements, assessmentMap, showResult]);

  useEffect(() => { if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes; }, [showNodes]);
  useEffect(() => { if (elementsGroupRef.current?.material) elementsGroupRef.current.material.wireframe = isWireframe; }, [isWireframe]);
  useEffect(() => { if (controlsRef.current) { controlsRef.current.autoRotate = autoRotate; controlsRef.current.autoRotateSpeed = 2.0; } }, [autoRotate]);

  const hasResult = assessmentMap && Object.keys(assessmentMap).length > 0;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-900">
      <div ref={mountRef} className="w-full h-full bg-slate-900 cursor-move" />

      <button onClick={toggleFullscreen} className="absolute top-3 z-20 cursor-pointer bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 p-1.5 rounded-lg transition-colors shadow"
        style={{ right: hasResult && showResult ? '10.5rem' : '0.75rem' }} title={isFullscreen ? '전체화면 종료' : '전체화면'}>
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {hoverInfo && (
        <div className="absolute z-20 pointer-events-none bg-slate-950/90 backdrop-blur border border-slate-600 rounded-lg px-3 py-2 shadow-xl"
          style={{ left: hoverInfo.x + 14, top: hoverInfo.y - 10, transform: 'translateY(-100%)' }}>
          <div className="text-[10px] text-slate-400 font-mono mb-0.5">Element <span className="text-white font-bold">{hoverInfo.eid}</span></div>
          {hoverInfo.assessment !== null ? (
            <>
              <div className="text-[10px] font-mono"><span className="text-slate-400">Assessment: </span>
                <span className={`font-bold ${hoverInfo.assessment >= 1.0 ? 'text-red-400' : hoverInfo.assessment >= 0.8 ? 'text-amber-400' : 'text-emerald-400'}`}>{hoverInfo.assessment.toFixed(4)}</span></div>
              <div className="text-[10px] font-mono"><span className="text-slate-400">Result: </span>
                <span className={`font-bold ${hoverInfo.result === 'OK' ? 'text-emerald-400' : 'text-red-400'}`}>{hoverInfo.result}</span></div>
            </>
          ) : <div className="text-[10px] text-slate-500 font-mono">No assessment data</div>}
        </div>
      )}

      {hasResult && showResult && lcList.length > 0 && (
        <div className="absolute top-3 left-3 z-10 flex gap-1 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 p-1.5 shadow-lg">
          <button onClick={() => setActiveLcIdx(-1)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${activeLcIdx === -1 ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>Envelope</button>
          {lcList.map(lc => (
            <button key={lc.idx} onClick={() => setActiveLcIdx(lc.idx)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${activeLcIdx === lc.idx ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>{lc.label}</button>
          ))}
        </div>
      )}

      {hasResult && showResult && (
        <div className="absolute top-3 right-3 z-10 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 px-3 py-2.5 pointer-events-none shadow-lg">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">{activeLcIdx === -1 ? 'Envelope (Max)' : lcList[activeLcIdx]?.label || 'Assessment'}</p>
          <div className="flex flex-col gap-1">
            {[
              { label: '≥ 1.00  FAIL', color: 'hsl(0,100%,50%)',   text: 'text-red-400' },
              { label: '0.80 ~ 1.00', color: 'hsl(20,100%,50%)',  text: 'text-orange-400' },
              { label: '0.50 ~ 0.80', color: 'hsl(80,100%,50%)',  text: 'text-yellow-400' },
              { label: '< 0.50  PASS', color: 'hsl(216,100%,50%)', text: 'text-blue-400' },
              { label: 'No Data',      color: '#64748b',            text: 'text-slate-400' },
            ].map(({ label, color, text }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className={`text-[10px] font-mono ${text}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
        <button onClick={() => setShowNodes(!showNodes)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
          {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
        </button>
        <button onClick={() => setIsWireframe(!isWireframe)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${isWireframe ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
          {isWireframe ? <LayoutGrid size={18} className="mb-1" /> : <Hexagon size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Frame</span>
        </button>
        {hasResult && (
          <>
            <div className="w-px bg-slate-700 mx-1 my-2" />
            <button onClick={() => setShowResult(!showResult)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showResult ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              <CheckCircle2 size={18} className="mb-1" />
              <span className="text-[8px] font-bold uppercase tracking-wider">Result</span>
            </button>
          </>
        )}
        <div className="w-px bg-slate-700 mx-1 my-2" />
        <button onClick={() => setAutoRotate(!autoRotate)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
          {autoRotate ? <PauseCircle size={18} className="mb-1" /> : <PlayCircle size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Rotate</span>
        </button>
        <button onClick={() => controlsRef.current?.reset()} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer">
          <RotateCcw size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">Reset</span>
        </button>
      </div>
    </div>
  );
}
