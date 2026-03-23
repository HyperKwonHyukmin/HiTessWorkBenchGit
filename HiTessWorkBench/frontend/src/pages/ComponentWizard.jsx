/// <summary>
/// 대화형 1D Beam 구조 해석 설정 및 3D 뷰어 컴포넌트입니다. (Simple Beam Analyzer)
/// [개선] 사용자가 입력한 모델링 조건(단면, 경계, 하중)을 외부 해석 엔진에서 사용할 수 있도록
/// 실행 시 JSON 포맷으로 구조화하여 즉시 다운로드하는 기능을 추가했습니다.
/// </summary>
import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { 
  Box, Activity, Plus, Trash2, ShieldCheck, ArrowDown, Play, RefreshCw, SlidersHorizontal, DownloadCloud
} from 'lucide-react';

// ==========================================
// 1. 메인 컴포넌트
// ==========================================
export default function ComponentWizard() {
  const mountRef = useRef(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelGroupRef = useRef(null); 

  // --- 상태 관리 ---
  const [beamType, setBeamType] = useState('I');
  const [params, setParams] = useState({
    length: 1000,
    dim1: 100, // W or D
    dim2: 200, // H or t (for TUBE)
    dim3: 10,  // tf
    dim4: 8,   // tw
  });

  const [loads, setLoads] = useState([{ pos: 500, mag: 2000 }]);
  const [boundaries, setBoundaries] = useState([{ pos: 0, type: 'Fix' }]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState({ maxStress: 0, maxDisp: 0, area: 0, inertia: 0 });

  // 실시간 유효성 검증 에러 상태
  const [validationErrors, setValidationErrors] = useState([]);

  // ==========================================
  // 2. 실시간 유효성 검증 (Validation)
  // ==========================================
  useEffect(() => {
    const errors = [];
    const length = Number(params.length) || 0;
    const dim1 = Number(params.dim1) || 0;
    const dim2 = Number(params.dim2) || 0;
    const dim3 = Number(params.dim3) || 0;
    const dim4 = Number(params.dim4) || 0;
    
    // 기본 치수 검증
    if (length <= 0) errors.push("부재 길이는 0보다 커야 합니다.");
    if (dim1 <= 0 || dim2 <= 0) errors.push("기본 치수(W, H, D 등)는 0보다 커야 합니다.");

    // 단면 특성별 논리적 기하 검증
    if (beamType === 'TUBE') {
      if (dim2 >= dim1 / 2) errors.push(`TUBE의 두께(t: ${dim2})는 반경(D/2: ${dim1/2})보다 작아야 합니다.`);
    }
    if (beamType === 'I' || beamType === 'CHAN') {
      if (dim3 >= dim2 / 2) errors.push(`Flange 두께(tf: ${dim3})는 전체 높이의 절반(H/2: ${dim2/2})보다 작아야 합니다.`);
      if (dim4 >= dim1) errors.push(`Web 두께(tw: ${dim4})는 전체 폭(W: ${dim1})보다 작아야 합니다.`);
    }
    if (beamType === 'H') {
      if (dim3 >= dim1 / 2) errors.push(`Flange 두께(tf: ${dim3})는 전체 폭의 절반(W/2: ${dim1/2})보다 작아야 합니다.`);
      if (dim4 >= dim2) errors.push(`Web 두께(tw: ${dim4})는 전체 높이(H: ${dim2})보다 작아야 합니다.`);
    }
    if (['L', 'T'].includes(beamType)) {
      if (dim3 >= dim2) errors.push(`Flange 두께(tf: ${dim3})는 전체 높이(H: ${dim2})보다 작아야 합니다.`);
      if (dim4 >= dim1) errors.push(`Web 두께(tw: ${dim4})는 전체 폭(W: ${dim1})보다 작아야 합니다.`);
    }

    // 경계조건 위치 검증
    boundaries.forEach((bc, i) => {
       const p = Number(bc.pos) || 0;
       if (p < 0 || p > length) errors.push(`경계조건 #${i+1} 위치(${p}mm)가 부재 길이를 벗어납니다.`);
    });
    
    // 하중 위치 검증
    loads.forEach((load, i) => {
       const p = Number(load.pos) || 0;
       if (p < 0 || p > length) errors.push(`하중 #${i+1} 위치(${p}mm)가 부재 길이를 벗어납니다.`);
    });

    setValidationErrors(errors);
  }, [params, beamType, loads, boundaries]);

  // ==========================================
  // 3. 입력 핸들러 및 JSON 내보내기 로직
  // ==========================================
  const handleBeamTypeChange = (e) => {
    const type = e.target.value;
    setBeamType(type);
    setShowResult(false);

    const newParams = { ...params };
    switch (type) {
      case 'BAR': newParams.dim1 = 50; newParams.dim2 = 100; break;
      case 'I': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 10; newParams.dim4 = 8; break;
      case 'H': newParams.dim1 = 200; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 15; break;
      case 'CHAN': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 10; break;
      case 'L':
      case 'T': newParams.dim1 = 100; newParams.dim2 = 100; newParams.dim3 = 10; newParams.dim4 = 10; break;
      case 'ROD': newParams.dim1 = 100; break;
      case 'TUBE': newParams.dim1 = 100; newParams.dim2 = 20; break;
      default: break;
    }
    setParams(newParams);
  };

  const handleRunAnalysis = () => {
    // 유효성 에러가 있으면 실행 차단
    if (validationErrors.length > 0) return;

    setIsAnalyzing(true);
    setShowResult(false);

    // -----------------------------------------------------
    // ✅ [핵심 추가] 외부 해석 프로그램을 위한 JSON 다운로드 로직
    // -----------------------------------------------------
    try {
      const exportData = {
        metadata: {
          module: "Simple Beam Analyzer",
          timestamp: new Date().toISOString(),
          version: "1.0.0"
        },
        model: {
          beamType: beamType,
          dimensions: {
            length: Number(params.length) || 0,
            dim1: Number(params.dim1) || 0,
            dim2: Number(params.dim2) || 0,
            dim3: Number(params.dim3) || 0,
            dim4: Number(params.dim4) || 0,
          },
          boundaries: boundaries.map(b => ({
            position: Number(b.pos) || 0,
            type: b.type
          })),
          loads: loads.map(l => ({
            position: Number(l.pos) || 0,
            magnitude: Number(l.mag) || 0
          }))
        }
      };

      // JSON 문자열을 Blob 객체로 변환
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      
      // 가상의 a 태그를 생성하여 다운로드 트리거
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BeamModel_${new Date().getTime()}.json`;
      document.body.appendChild(link);
      link.click();
      
      // 메모리 정리
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("JSON 내보내기 실패:", err);
      alert("JSON 파일 생성 중 오류가 발생했습니다.");
    }

    // -----------------------------------------------------
    // 기존의 시각화 모의(Mock) 해석 로직
    // -----------------------------------------------------
    try {
      setTimeout(() => {
        setIsAnalyzing(false);
        setShowResult(true);
        
        const d1 = Number(params.dim1) || 0;
        const d2 = Number(params.dim2) || 0;
        const d3 = Number(params.dim3) || 0;
        const d4 = Number(params.dim4) || 0;
        
        let areaVal = 0;
        if (beamType === 'TUBE') areaVal = Math.PI*(Math.pow(d1/2,2) - Math.pow((d1/2 - d2), 2));
        else if (beamType === 'I') areaVal = (d1 * d3 * 2) + ((d2 - 2 * d3) * d4);
        else if (beamType === 'H') areaVal = (d2 * d3 * 2) + ((d1 - 2 * d3) * d4);
        else areaVal = d1 * d2;

        setResultData({
          maxStress: Math.random() * 200 + 100, 
          maxDisp: Math.random() * 20 + 5,      
          area: areaVal || 0,
          inertia: (d1 * Math.pow(d2, 3)) / 12 
        });
      }, 1500);
    } catch (error) {
      console.error("Analysis Request Failed:", error);
      setIsAnalyzing(false);
    }
  };

  // ==========================================
  // 4. Three.js 렌더링
  // ==========================================
  const createTextSprite = (message) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = "Bold 50px Arial";
    const metrics = context.measureText(message);
    canvas.width = metrics.width + 20;
    canvas.height = 70;
    context.font = "Bold 50px Arial";
    context.fillStyle = "rgba(255, 51, 51, 1.0)"; 
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width * 0.4, canvas.height * 0.4, 1);
    return sprite;
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsLayoutReady(true), 400); 
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLayoutReady || !mountRef.current) return;

    let width = mountRef.current.clientWidth || 800;
    let height = mountRef.current.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0B1120); 
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    renderer.shadowMap.enabled = true; 
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1000, 2000, 1000);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const length = Number(params.length) || 0.1;
    const dim1 = Number(params.dim1) || 0.1;
    const dim2 = Number(params.dim2) || 0.1;
    const dim3 = Number(params.dim3) || 0.1;
    const dim4 = Number(params.dim4) || 0.1;

    const isCylindrical = beamType === 'ROD' || beamType === 'TUBE';
    const maxHeight = isCylindrical ? dim1 / 2 : dim2 / 2;

    const gridHelper = new THREE.GridHelper(length * 2, 40, 0x334155, 0x1e293b);
    gridHelper.position.set(0, -maxHeight - 20, 0); 
    modelGroup.add(gridHelper);

    let geometry;
    const extrudeSettings = { depth: length, bevelEnabled: false, steps: 40 };

    if (beamType === 'BAR') {
      geometry = new THREE.BoxGeometry(length, dim2, dim1, 40, 1, 1);
    } 
    else if (beamType === 'ROD') {
      geometry = new THREE.CylinderGeometry(dim1/2, dim1/2, length, 32);
      geometry.rotateZ(Math.PI / 2);
    } 
    else {
      const shape = new THREE.Shape();
      const w = dim1, h = dim2, tf = dim3, tw = dim4;

      if (beamType === 'I') {
        shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf);
        shape.lineTo(tw/2, -h/2 + tf); shape.lineTo(tw/2, h/2 - tf); shape.lineTo(w/2, h/2 - tf);
        shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, h/2 - tf);
        shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2 + tf); shape.lineTo(-w/2, -h/2 + tf);
        shape.lineTo(-w/2, -h/2);
      }
      else if (beamType === 'H') {
        shape.moveTo(-w/2, -h/2); shape.lineTo(-w/2 + tf, -h/2); shape.lineTo(-w/2 + tf, -tw/2);
        shape.lineTo(w/2 - tf, -tw/2); shape.lineTo(w/2 - tf, -h/2); shape.lineTo(w/2, -h/2);
        shape.lineTo(w/2, h/2); shape.lineTo(w/2 - tf, h/2); shape.lineTo(w/2 - tf, tw/2);
        shape.lineTo(-w/2 + tf, tw/2); shape.lineTo(-w/2 + tf, h/2); shape.lineTo(-w/2, h/2);
        shape.lineTo(-w/2, -h/2);
      }
      else if (beamType === 'L') {
        shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf);
        shape.lineTo(-w/2 + tw, -h/2 + tf); shape.lineTo(-w/2 + tw, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2);
      } 
      else if (beamType === 'T') {
        shape.moveTo(-tw/2, -h/2); shape.lineTo(tw/2, -h/2); shape.lineTo(tw/2, h/2 - tf);
        shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2);
        shape.lineTo(-w/2, h/2 - tf); shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2);
      } 
      else if (beamType === 'CHAN') {
        shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(-w/2 + tw, -h/2 + tf);
        shape.lineTo(-w/2 + tw, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2);
        shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2);
      } 
      else if (beamType === 'TUBE') {
        shape.absarc(0, 0, dim1/2, 0, Math.PI * 2, false);
        const innerRadius = (dim1/2) - dim2; 
        if (innerRadius > 0) {
           const holePath = new THREE.Path();
           holePath.absarc(0, 0, innerRadius, 0, Math.PI * 2, true); 
           shape.holes.push(holePath);
        }
      }

      geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometry.center(); 
      geometry.rotateY(Math.PI / 2);
    }

    const material = new THREE.MeshStandardMaterial({
      color: showResult ? 0xffffff : 0x00E600,
      emissive: showResult ? 0x000000 : 0x001100,
      roughness: 0.3, metalness: 0.6,
      vertexColors: showResult, side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.EdgesGeometry(geometry, 15);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.3, transparent: true }));
    mesh.add(line);
    modelGroup.add(mesh);

    // 경계조건 (Boundaries)
    boundaries.forEach(bc => {
      const isFix = bc.type === 'Fix';
      const bColor = isFix ? 0x3b82f6 : 0xf59e0b; 
      const coneHeight = Math.max(dim1 * 1.5, 60);
      const sphereRadius = Math.max(dim1 * 0.6, 30);
      
      const bcGeo = isFix ? new THREE.ConeGeometry(dim1*0.8, coneHeight, 16) : new THREE.SphereGeometry(sphereRadius, 32, 32);
      const bcMat = new THREE.MeshStandardMaterial({ color: bColor, roughness: 0.5, metalness: 0.8 }); 
      const bcMesh = new THREE.Mesh(bcGeo, bcMat);
      
      const posVal = Number(bc.pos) || 0;
      const xPos = posVal - (length / 2); 
      const yPos = isFix ? (-maxHeight - coneHeight/2) : (-maxHeight - sphereRadius);
      bcMesh.position.set(xPos, yPos, 0);
      modelGroup.add(bcMesh);
    });

    // 하중 (Loads)
    loads.forEach(load => {
      const magVal = Number(load.mag) || 0;
      const posVal = Number(load.pos) || 0;
      const isDown = magVal > 0; 
      
      const arrowGroup = new THREE.Group();
      const baseLen = Math.max(120, Math.min(400, Math.abs(magVal) * 0.2));
      const headLen = baseLen * 0.25;
      const shaftLen = baseLen - headLen;
      const radius = baseLen * 0.05; 
      const headRadius = radius * 2.5; 

      const mat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x440000 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, shaftLen, 16), mat);
      const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLen, 16), mat);
      const textLabel = createTextSprite(`${Math.abs(magVal)} N`);

      if (isDown) {
        head.position.set(0, headLen/2, 0); head.rotation.z = Math.PI; 
        shaft.position.set(0, headLen + shaftLen/2, 0);
        arrowGroup.position.set(posVal - length/2, maxHeight, 0);
        textLabel.position.set(0, baseLen + 30, 0); 
      } else {
        head.position.set(0, -headLen/2, 0);
        shaft.position.set(0, -(headLen + shaftLen/2), 0);
        arrowGroup.position.set(posVal - length/2, -maxHeight, 0);
        textLabel.position.set(0, -baseLen - 30, 0);
      }

      arrowGroup.add(shaft, head, textLabel); 
      modelGroup.add(arrowGroup);
    });

    // 결과 (Gradient Colors)
    if (showResult) {
      const positions = geometry.attributes.position;
      const colors = [];
      const colorObj = new THREE.Color();

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const normalizedX = (x + length / 2) / length;
        const displacement = Math.sin(normalizedX * Math.PI) * 50; 
        positions.setY(i, positions.getY(i) - displacement);

        const normalizedStress = Math.abs(Math.sin((x / length) * Math.PI));
        colorObj.setHSL((1 - normalizedStress) * 0.6, 1.0, 0.5);
        colors.push(colorObj.r, colorObj.g, colorObj.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      positions.needsUpdate = true;
    }

    const viewDist = Math.max(length, 400); 
    camera.position.set(viewDist * 0.7, viewDist * 0.5, viewDist * 0.9);
    controls.target.set(0, 0, 0);
    controls.update();

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    });
    resizeObserver.observe(mountRef.current);

    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update(); 
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      if (mountRef.current && renderer.domElement) {
        try { mountRef.current.removeChild(renderer.domElement); } catch(e) {}
      }
      renderer.dispose();
    };
  }, [isLayoutReady, params, beamType, loads, boundaries, showResult]);


  // ==========================================
  // 5. 컴포넌트 렌더링
  // ==========================================
  return (
    <div className="grid grid-cols-[400px_1fr] w-full h-[calc(100vh-100px)] min-h-[600px] bg-slate-950 p-4 gap-4 animate-fade-in-up rounded-2xl shadow-inner overflow-hidden relative">
      
      {!isLayoutReady && (
        <div className="col-span-2 absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-[#00E600]">
          <RefreshCw className="animate-spin mb-4" size={48} />
          <p className="font-mono font-bold tracking-widest uppercase">Initializing 3D Engine...</p>
        </div>
      )}

      {/* --- 좌측 설정 패널 --- */}
      <div className="flex flex-col h-full overflow-y-auto custom-scrollbar bg-slate-900 rounded-xl border border-slate-800 shadow-2xl relative z-10">
        
        <div className="p-4 border-b border-slate-800 bg-slate-800/50 sticky top-0 z-20 backdrop-blur-md">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <SlidersHorizontal size={18} className="text-[#00E600]" /> Analysis Setup
          </h2>
        </div>

        <div className="p-5 space-y-8">
          {/* 단면 형상 */}
          <section>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2">
                <Box size={14} /> Cross Section
              </h3>
              <div className="w-16 h-16 bg-slate-800 border border-slate-700 rounded-lg p-1 flex items-center justify-center">
                 <SectionGuide type={beamType} />
              </div>
            </div>

            <select 
              value={beamType} 
              onChange={handleBeamTypeChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-bold mb-4 outline-none focus:border-[#00E600] transition-colors cursor-pointer"
            >
              <option value="I">I-Beam</option>
              <option value="H">H-Beam</option>
              <option value="BAR">BAR (Solid Box)</option>
              <option value="L">L-Beam (Angle)</option>
              <option value="T">T-Beam</option>
              <option value="CHAN">Channel (C-Shape)</option>
              <option value="ROD">ROD (Solid Cylinder)</option>
              <option value="TUBE">TUBE (Hollow Pipe)</option>
            </select>

            <div className="space-y-1">
              <InputRow label="Length (L)" value={params.length} unit="mm" onChange={(e) => setParams({...params, length: e.target.value})} />
              
              {beamType === 'ROD' && <InputRow label="Diameter (D)" value={params.dim1} unit="mm" onChange={(e) => setParams({...params, dim1: e.target.value})} />}
              {beamType === 'TUBE' && (
                <>
                  <InputRow label="Outer Dia (D)" value={params.dim1} unit="mm" onChange={(e) => setParams({...params, dim1: e.target.value})} />
                  <InputRow label="Thickness (t)" value={params.dim2} unit="mm" onChange={(e) => setParams({...params, dim2: e.target.value})} />
                </>
              )}
              {['BAR', 'I', 'H', 'L', 'T', 'CHAN'].includes(beamType) && (
                <>
                  <InputRow label="Width (W)" value={params.dim1} unit="mm" onChange={(e) => setParams({...params, dim1: e.target.value})} />
                  <InputRow label="Height (H)" value={params.dim2} unit="mm" onChange={(e) => setParams({...params, dim2: e.target.value})} />
                </>
              )}
              {['I', 'H', 'L', 'T', 'CHAN'].includes(beamType) && (
                <>
                  <InputRow label="Flange Thk (tf)" value={params.dim3} unit="mm" onChange={(e) => setParams({...params, dim3: e.target.value})} />
                  <InputRow label="Web Thk (tw)" value={params.dim4} unit="mm" onChange={(e) => setParams({...params, dim4: e.target.value})} />
                </>
              )}
            </div>
          </section>

          {/* 경계 조건 */}
          <section className="border-t border-slate-800 pt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck size={14} /> Boundaries
              </h3>
              <button onClick={() => setBoundaries([...boundaries, { pos: (Number(params.length)||0)/2, type: 'Hinge' }])} className="text-slate-400 hover:text-blue-400 transition-colors"><Plus size={16}/></button>
            </div>
            <div className="space-y-2">
              {boundaries.map((bc, idx) => (
                <div key={idx} className="flex gap-1 items-center bg-slate-950 p-1.5 rounded-lg border border-slate-800">
                  <div className="relative flex-1">
                    <input 
                      type="number" value={bc.pos} onChange={(e) => { const n = [...boundaries]; n[idx].pos = e.target.value; setBoundaries(n); }} 
                      className="w-full bg-transparent px-2 py-1 text-sm text-white outline-none font-mono text-right pr-8" 
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">mm</span>
                  </div>
                  <select value={bc.type} onChange={e => { const n = [...boundaries]; n[idx].type = e.target.value; setBoundaries(n); }} className="w-24 bg-slate-800 rounded px-2 py-1 text-xs text-white outline-none">
                    <option value="Fix">Fix</option>
                    <option value="Hinge">Hinge</option>
                  </select>
                  <button onClick={() => setBoundaries(boundaries.filter((_, i) => i !== idx))} className="p-1 text-slate-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
          </section>

          {/* 하중 조건 */}
          <section className="border-t border-slate-800 pt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2">
                <ArrowDown size={14} /> Static Loads
              </h3>
              <button onClick={() => setLoads([...loads, { pos: (Number(params.length)||0)/2, mag: 2000 }])} className="text-slate-400 hover:text-red-400 transition-colors"><Plus size={16}/></button>
            </div>
            <div className="space-y-2">
              {loads.map((load, idx) => (
                <div key={idx} className="flex gap-1 items-center bg-slate-950 p-1.5 rounded-lg border border-slate-800">
                  <div className="relative flex-1">
                    <input type="number" value={load.pos} onChange={e => { const n = [...loads]; n[idx].pos = e.target.value; setLoads(n); }} className="w-full bg-transparent px-2 py-1 text-sm text-white outline-none font-mono text-right pr-8" />
                    <span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">mm</span>
                  </div>
                  <div className="relative flex-1">
                    <input type="number" value={load.mag} onChange={e => { const n = [...loads]; n[idx].mag = e.target.value; setLoads(n); }} className="w-full bg-transparent px-2 py-1 text-sm text-red-400 outline-none font-mono text-right pr-6" />
                    <span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">N</span>
                  </div>
                  <button onClick={() => setLoads(loads.filter((_, i) => i !== idx))} className="p-1 text-slate-500 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 입력 유효성 경고 패널 */}
        {validationErrors.length > 0 && (
          <div className="mx-4 mb-4 p-3 bg-red-950/50 border border-red-800 rounded-lg animate-fade-in-up">
            <p className="text-xs font-bold text-red-400 mb-1 flex items-center gap-1">
              <ShieldCheck size={14} /> 입력 유효성 경고
            </p>
            <ul className="list-disc list-inside text-[11px] text-red-300 space-y-0.5">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-auto p-4 border-t border-slate-800 bg-slate-900 sticky bottom-0">
          <button 
            onClick={handleRunAnalysis}
            disabled={validationErrors.length > 0} 
            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all 
              ${validationErrors.length > 0 
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-none'
                : showResult 
                  ? 'bg-emerald-600 text-white shadow-none hover:shadow-lg' 
                  : 'bg-[#00E600] text-[#002554] shadow-[0_0_15px_rgba(0,230,0,0.2)] hover:shadow-[0_0_25px_rgba(0,230,0,0.4)]'
              }`}
          >
            {isAnalyzing ? (
              <RefreshCw className="animate-spin" size={18} />
            ) : (
              showResult ? <Activity size={18} /> : <DownloadCloud size={18} />
            )}
            {/* ✅ 버튼 텍스트 변경: JSON 다운로드를 명시 */}
            {showResult ? 'Recalculate Model' : '해석 실행 및 JSON 내보내기'}
          </button>
        </div>
      </div>

      {/* --- 우측 3D 캔버스 영역 --- */}
      <div className="relative h-full bg-black rounded-xl border border-slate-800 overflow-hidden z-0 shadow-2xl">
        <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-move" />
        
        {showResult && (
          <div className="absolute top-6 right-6 bg-slate-900/80 backdrop-blur-md p-5 rounded-xl border border-slate-700 shadow-2xl animate-fade-in-up z-10 pointer-events-auto min-w-[200px]">
             <p className="text-xs font-bold text-[#00E600] mb-3 uppercase tracking-widest border-b border-slate-700 pb-2 flex items-center gap-2">
               <Activity size={14}/> Result Summary
             </p>
             <div className="space-y-3 font-mono">
                <ResultRow label="Max Stress" value={resultData.maxStress.toFixed(1)} unit="MPa" color="text-red-400" />
                <ResultRow label="Max Disp." value={resultData.maxDisp.toFixed(1)} unit="mm" color="text-yellow-400" />
                <div className="h-px bg-slate-800 my-2"></div>
                <ResultRow label="Area" value={resultData.area.toFixed(0)} unit="mm²" color="text-slate-300" />
                <ResultRow label="Inertia (I)" value={resultData.inertia.toExponential(2)} unit="mm⁴" color="text-slate-300" />
             </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ====================================================
// Helper Components
// ====================================================
function InputRow({ label, value, unit, onChange }) {
  return (
    <div className="flex items-center justify-between bg-slate-900 border border-transparent hover:border-slate-700 rounded p-1 transition-colors group">
      <span className="text-[11px] text-slate-400 pl-2 group-hover:text-slate-300 transition-colors w-2/5 truncate">{label}</span>
      <div className="flex items-center w-3/5 bg-slate-950 border border-slate-800 rounded px-2 focus-within:border-[#00E600] transition-colors">
        <input type="number" value={value} onChange={onChange} className="w-full bg-transparent py-1 text-sm text-[#00E600] font-bold outline-none font-mono text-right" />
        <span className="text-[10px] text-slate-600 font-mono ml-1 w-6 text-right">{unit}</span>
      </div>
    </div>
  );
}

function ResultRow({ label, value, unit, color }) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-sm font-bold ${color} text-right flex-1`}>{value} <span className="text-[10px] text-slate-500 font-normal">{unit}</span></span>
    </div>
  );
}

function SectionGuide({ type }) {
  const s = { stroke: '#475569', strokeWidth: 2, fill: 'none' };
  const t = { fill: '#00E600', fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold' };
  
  const getSvgContent = () => {
    switch (type) {
      case 'I': return (
        <><path d="M 20,20 L 80,20 M 20,80 L 80,80 M 50,20 L 50,80" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>
      );
      case 'H': return (
        <><path d="M 20,20 L 20,80 M 80,20 L 80,80 M 20,50 L 80,50" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="45" y="45" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>
      );
      case 'BAR': return (
        <><rect x="20" y="25" width="60" height="50" {...s} fill="#1e293b" /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text></>
      );
      case 'L': return (
        <><path d="M 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="95" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="45" {...t}>tw</text><text x="65" y="70" {...t}>tf</text></>
      );
      case 'T': return (
        <><path d="M 20,20 L 80,20 M 50,20 L 50,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="30" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>
      );
      case 'CHAN': return (
        <><path d="M 80,20 L 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>
      );
      case 'TUBE': return (
        <><circle cx="50" cy="50" r="35" {...s} /><circle cx="50" cy="50" r="25" {...s} /><text x="45" y="55" {...t}>D</text><text x="80" y="55" {...t}>t</text></>
      );
      case 'ROD': return (
        <><circle cx="50" cy="50" r="35" {...s} fill="#1e293b" /><text x="45" y="55" {...t}>D</text></>
      );
      default: return null;
    }
  };

  return <svg viewBox="0 0 100 100" className="w-full h-full opacity-80">{getSvgContent()}</svg>;
}