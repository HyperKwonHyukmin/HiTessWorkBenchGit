import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { toPng } from 'html-to-image';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ReferenceLine
} from 'recharts';
import { 
  Box, Activity, Plus, Trash2, ShieldCheck, ArrowDown, RefreshCw, SlidersHorizontal, Play, FileJson, Upload, BarChart2, Camera, Info 
} from 'lucide-react';
import { useDashboard } from '../contexts/DashboardContext'; // 💡 글로벌 작업 관리 가져오기

const engFormat = (val) => {
  if (val === undefined || val === null) return '';
  if (val === 0) return '0';
  const abs = Math.abs(val);
  if (abs >= 10000 || abs < 0.001) return val.toExponential(2);
  return Number.isInteger(val) ? val.toString() : val.toFixed(2);
};

export default function ComponentWizard() {
  const mountRef = useRef(null);
  const captureRef = useRef(null); 
  const rendererRef = useRef(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  const [activeTab, setActiveTab] = useState('modeling');
  const [isCapturing, setIsCapturing] = useState(false); 

  const [toast, setToast] = useState(null); 
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500); 
  };

  const [defScale, setDefScale] = useState(1.0);
  const defScaleRef = useRef(1.0); 
  const handleScaleChange = (e) => {
    const val = parseFloat(e.target.value);
    setDefScale(val);
    defScaleRef.current = val;
  };

  const [beamType, setBeamType] = useState('I');
  const [params, setParams] = useState({ length: 1000, dim1: 100, dim2: 200, dim3: 10, dim4: 8 });
  
  // 💡 [수정] 기본 Force를 -5000N으로 상향
  const [loads, setLoads] = useState([{ pos: 500, fx: 0, fy: 0, fz: -5000 }]);
  const [boundaries, setBoundaries] = useState([{ pos: 0, type: 'Fix', dof: '' }, { pos: 1000, type: 'Hinge', dof: '' }]);
  
  const [validationErrors, setValidationErrors] = useState([]);
  const [dispData, setDispData] = useState([]);
  const [elForceData, setElForceData] = useState([]);
  const [stressData, setStressData] = useState([]);
  const [summaryData, setSummaryData] = useState(null);

  const hasCharts = dispData.length > 0 || elForceData.length > 0 || stressData.length > 0;
  
  // 💡 [수정] 글로벌 Context의 작업 상태 연동
  const { globalJob, startGlobalJob, clearGlobalJob } = useDashboard();
  const isAnalyzing = globalJob?.menu === 'Simple Beam Assessment' && globalJob?.status === 'Running';
  const isReadOnly = hasCharts || isAnalyzing; 

  const handleReset = () => {
    setDispData([]);
    setElForceData([]);
    setStressData([]);
    setSummaryData(null);
    setDefScale(1.0);
    defScaleRef.current = 1.0;
    clearGlobalJob(); // 로컬 리셋 시 글로벌 작업 내역도 삭제
    setActiveTab('modeling');
  };

  const updateBc = (idx, field, value) => {
    const newBc = [...boundaries];
    newBc[idx][field] = value;
    setBoundaries(newBc);
  };

  const updateLoad = (idx, field, value) => {
    const newLoads = [...loads];
    newLoads[idx][field] = value;
    setLoads(newLoads);
  };

  useEffect(() => {
    const errors = [];
    const { length, dim1, dim2, dim3, dim4 } = {
      length: Number(params.length)||0, dim1: Number(params.dim1)||0, 
      dim2: Number(params.dim2)||0, dim3: Number(params.dim3)||0, dim4: Number(params.dim4)||0
    };
    if (length <= 0) errors.push("부재 길이는 0보다 커야 합니다.");
    if (dim1 <= 0 || dim2 <= 0) errors.push("기본 치수(W, H, D 등)는 0보다 커야 합니다.");
    if (beamType === 'TUBE' && dim2 >= dim1 / 2) errors.push(`TUBE 두께는 반경보다 작아야 합니다.`);
    if (['I', 'CHAN'].includes(beamType)) {
      if (dim3 >= dim2 / 2) errors.push(`Flange 두께는 전체 높이 절반보다 작아야 합니다.`);
      if (dim4 >= dim1) errors.push(`Web 두께는 전체 폭보다 작아야 합니다.`);
    }
    boundaries.forEach((bc, i) => { if ((Number(bc.pos)||0) < 0 || (Number(bc.pos)||0) > length) errors.push(`경계조건 #${i+1} 위치가 부재 길이를 벗어납니다.`); });
    loads.forEach((load, i) => { if ((Number(load.pos)||0) < 0 || (Number(load.pos)||0) > length) errors.push(`하중 #${i+1} 위치가 부재 길이를 벗어납니다.`); });
    setValidationErrors(errors);
  }, [params, beamType, loads, boundaries]);

  const mapElementDataWithX = (arr, totalLength) => {
    const uniqueIds = [...new Set(arr.map(a => a.elementId))].sort((a, b) => a - b);
    const numElements = uniqueIds.length;
    const elementLength = numElements > 0 ? totalLength / numElements : 0;
    return arr.map(a => {
      const idx = uniqueIds.indexOf(a.elementId);
      const xPos = (idx + a.dist) * elementLength;
      return { ...a, 'X[mm]': parseFloat(xPos.toFixed(3)) };
    }).sort((a, b) => a['X[mm]'] - b['X[mm]']); 
  };

  const processResultJson = (json) => {
    const modelLength = Number(json.model?.dimensions?.length) || 1000;
    if (json.model && json.model.dimensions) {
      setBeamType(json.model.beamType || 'I');
      setParams({
        length: json.model.dimensions.length || 1000, dim1: json.model.dimensions.dim1 || 100,
        dim2: json.model.dimensions.dim2 || 200, dim3: json.model.dimensions.dim3 || 0, dim4: json.model.dimensions.dim4 || 0,
      });
      if (json.model.boundaries) setBoundaries(json.model.boundaries.map(b => ({ pos: b.position, type: b.type, dof: b.dof || '' })));
      if (json.model.loads) setLoads(json.model.loads.map(l => ({ pos: l.position, fx: l.fx || 0, fy: l.fy || 0, fz: l.fz !== undefined ? l.fz : (l.magnitude ? -l.magnitude : 0) })));
    }

    if (json.result) {
      if (json.result.nodeResults) {
        const mappedDisp = json.result.nodeResults.map(n => ({ 'X[mm]': n.x, 'DispZ[mm]': n.dispZ })).sort((a, b) => a['X[mm]'] - b['X[mm]']);
        setDispData(mappedDisp);
      }
      if (json.result.forceResults) {
        const mappedForces = mapElementDataWithX(json.result.forceResults, modelLength).map(f => ({
          'X[mm]': f['X[mm]'], BendingMoment1: f.bendingMoment1, ShearForce1: f.shearForce1
        }));
        setElForceData(mappedForces);
      }
      if (json.result.elementResults) {
        const mappedStresses = mapElementDataWithX(json.result.elementResults, modelLength).map(e => ({
          'X[mm]': e['X[mm]'], 'S-MAX[MPa]': e.sMax || e.maxStress || 0, 'S-MIN[MPa]': e.sMin || (e.maxStress ? -e.maxStress : 0)
        }));
        setStressData(mappedStresses);
      }
      if (json.result.summary) {
        setSummaryData(json.result.summary);
      }
      setDefScale(1.0);
      defScaleRef.current = 1.0;
      setActiveTab('results');
    }
  };

  const handleJsonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        processResultJson(json);
        if (json.result) showToast("모델 및 해석 결과가 성공적으로 로드되었습니다.", "success");
        else showToast("모델 기하정보가 로드되었습니다. (해석 결과는 없음)", "info");
      } catch (error) { 
        console.error(error);
        showToast("JSON 파싱 오류: 올바른 형식의 파일인지 확인하세요.", "error"); 
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  const handleBeamTypeChange = (e) => {
    if (isReadOnly) return;
    const type = e.target.value;
    setBeamType(type);
    const newParams = { ...params };
    switch (type) {
      case 'BAR': newParams.dim1 = 50; newParams.dim2 = 100; break;
      case 'I': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 10; newParams.dim4 = 8; break;
      case 'H': newParams.dim1 = 200; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 15; break;
      case 'CHAN': newParams.dim1 = 100; newParams.dim2 = 200; newParams.dim3 = 15; newParams.dim4 = 10; break;
      case 'L': case 'T': newParams.dim1 = 100; newParams.dim2 = 100; newParams.dim3 = 10; newParams.dim4 = 10; break;
      case 'ROD': newParams.dim1 = 100; break;
      case 'TUBE': newParams.dim1 = 100; newParams.dim2 = 20; break;
      default: break;
    }
    setParams(newParams);
  };

  // 💡 [수정] 글로벌 백그라운드 작업 시작 트리거
  const handleRunAnalysis = async () => {
    if (validationErrors.length > 0) return;

    try {
      const exportData = {
        metadata: { module: "Simple Beam Assessment", timestamp: new Date().toISOString(), version: "1.0.0" },
        model: {
          beamType: beamType,
          dimensions: { length: Number(params.length), dim1: Number(params.dim1), dim2: Number(params.dim2), dim3: Number(params.dim3), dim4: Number(params.dim4) },
          boundaries: boundaries.map(b => ({ position: Number(b.pos), type: b.type, ...(b.type === 'Custom' ? { dof: b.dof } : {}) })),
          loads: loads.map(l => ({ position: Number(l.pos), fx: Number(l.fx), fy: Number(l.fy), fz: Number(l.fz) }))
        }
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const formData = new FormData();
      formData.append('beam_file', blob, 'beam.json');
      const currentEmployeeId = "A476854"; 
      formData.append('employee_id', currentEmployeeId);
      formData.append('source', 'Workbench');

      const res = await fetch('http://localhost:8000/api/analysis/beam/request', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error(`서버 요청 실패 (${res.status})`);
      const resData = await res.json();
      
      // 전역 작업 상태 시작
      startGlobalJob(resData.job_id, 'Simple Beam Assessment');
      
    } catch (err) { 
      console.error(err); 
      showToast(`해석 요청 중 오류가 발생했습니다.\n${err.message}`, "error");
    }
  };

  // 💡 [신규] 글로벌 작업이 성공으로 바뀌면 결과물 자동 다운로드 및 적용
  useEffect(() => {
    if (globalJob && globalJob.menu === 'Simple Beam Assessment') {
      if (globalJob.status === 'Success' && !hasCharts) {
        const fetchResult = async () => {
          try {
            const resultUrl = `http://localhost:8000/api/download?filepath=${encodeURIComponent(globalJob.result_path)}`;
            const fileRes = await fetch(resultUrl);
            const resultJson = await fileRes.json();
            processResultJson(resultJson);
            showToast("서버 해석이 성공적으로 완료되었습니다.", "success");
          } catch (e) {
            showToast("결과 파일을 불러오는 중 오류가 발생했습니다.", "error");
          }
        };
        fetchResult();
      } else if (globalJob.status === 'Failed' && !hasCharts) {
        showToast(`해석이 실패했습니다.\n${globalJob.engine_log}`, "error");
        clearGlobalJob(); // 실패 시 바로 삭제
      }
    }
  }, [globalJob, hasCharts]);

  const handleCapture = async () => {
    if (!captureRef.current) return;
    setIsCapturing(true); 
    setTimeout(async () => {
      try {
        const dataUrl = await toPng(captureRef.current, { backgroundColor: '#020617', pixelRatio: 2, cacheBust: true });
        const link = document.createElement('a');
        link.download = `HiTess_Full_Report_${new Date().getTime()}.png`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        showToast("이미지 캡처 중 오류가 발생했습니다.", "error");
      } finally {
        setIsCapturing(false); 
      }
    }, 800); 
  };

  // ==========================================
  // Three.js 3D 렌더링 로직
  // ==========================================
  const createTextSprite = (message, color = "rgba(255, 60, 60, 1.0)") => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = "Bold 36px Arial";
    const metrics = context.measureText(message);
    canvas.width = metrics.width + 40;
    canvas.height = 50;
    context.font = "Bold 36px Arial";
    context.fillStyle = color;
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, 38);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(canvas.width * 0.8, canvas.height * 0.8, 1);
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
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100000);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.05;

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1000, 2000, 1000);
    scene.add(dirLight);

    const { length, dim1, dim2, dim3, dim4 } = {
      length: Number(params.length)||1, dim1: Number(params.dim1)||1, 
      dim2: Number(params.dim2)||1, dim3: Number(params.dim3)||1, dim4: Number(params.dim4)||1
    };

    const maxHeight = (beamType === 'ROD' || beamType === 'TUBE') ? dim1 / 2 : dim2 / 2;

    const gridHelper = new THREE.GridHelper(length * 2, 40, 0x334155, 0x1e293b);
    gridHelper.position.set(0, -maxHeight - 20, 0); 
    modelGroup.add(gridHelper);

    let geometry;
    const extrudeSettings = { depth: length, bevelEnabled: false, steps: 100 }; 

    if (beamType === 'BAR') geometry = new THREE.BoxGeometry(length, dim2, dim1, 100, 1, 1);
    else if (beamType === 'ROD') { geometry = new THREE.CylinderGeometry(dim1/2, dim1/2, length, 32, 100); geometry.rotateZ(Math.PI / 2); }
    else {
      const shape = new THREE.Shape();
      const w = dim1, h = dim2, tf = dim3, tw = dim4;
      if (beamType === 'I') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(tw/2, -h/2 + tf); shape.lineTo(tw/2, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, h/2 - tf); shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2 + tf); shape.lineTo(-w/2, -h/2 + tf); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'H') { shape.moveTo(-w/2, -h/2); shape.lineTo(-w/2 + tf, -h/2); shape.lineTo(-w/2 + tf, -tw/2); shape.lineTo(w/2 - tf, -tw/2); shape.lineTo(w/2 - tf, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, h/2); shape.lineTo(w/2 - tf, h/2); shape.lineTo(w/2 - tf, tw/2); shape.lineTo(-w/2 + tf, tw/2); shape.lineTo(-w/2 + tf, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'L') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(-w/2 + tw, -h/2 + tf); shape.lineTo(-w/2 + tw, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'T') { shape.moveTo(-tw/2, -h/2); shape.lineTo(tw/2, -h/2); shape.lineTo(tw/2, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, h/2 - tf); shape.lineTo(-tw/2, h/2 - tf); shape.lineTo(-tw/2, -h/2); }
      else if (beamType === 'CHAN') { shape.moveTo(-w/2, -h/2); shape.lineTo(w/2, -h/2); shape.lineTo(w/2, -h/2 + tf); shape.lineTo(-w/2 + tw, -h/2 + tf); shape.lineTo(-w/2 + tw, h/2 - tf); shape.lineTo(w/2, h/2 - tf); shape.lineTo(w/2, h/2); shape.lineTo(-w/2, h/2); shape.lineTo(-w/2, -h/2); }
      else if (beamType === 'TUBE') { shape.absarc(0, 0, dim1/2, 0, Math.PI * 2, false); const inner = (dim1/2) - dim2; if (inner > 0) { const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole); } }
      
      geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometry.center(); 
      geometry.rotateY(Math.PI / 2);
    }

    const material = new THREE.MeshStandardMaterial({ color: 0x00E600, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide });
    
    if (dispData.length > 0) {
      const positions = geometry.attributes.position;
      geometry.setAttribute('basePosition', positions.clone());
      const targetDispZArray = new Float32Array(positions.count);
      
      const colors = [];
      const colorObj = new THREE.Color();
      const maxDisp = Math.max(...dispData.map(d => Math.abs(d['DispZ[mm]'] || 0)));
      const baseDispScale = maxDisp > 0 ? (length * 0.15) / maxDisp : 1; 

      for(let i=0; i < positions.count; i++) {
        const vx = positions.getX(i);
        const realX = vx + length / 2; 

        let dZ = 0;
        for(let j=0; j < dispData.length - 1; j++) {
           if (realX >= dispData[j]['X[mm]'] && realX <= dispData[j+1]['X[mm]']) {
              const x0 = dispData[j]['X[mm]']; const x1 = dispData[j+1]['X[mm]'];
              const y0 = dispData[j]['DispZ[mm]']; const y1 = dispData[j+1]['DispZ[mm]'];
              const t = (realX - x0) / (x1 - x0 || 1);
              dZ = y0 + t * (y1 - y0);
              break;
           }
        }
        targetDispZArray[i] = dZ * baseDispScale;

        const normalized = maxDisp > 0 ? Math.abs(dZ) / maxDisp : 0;
        colorObj.setHSL((1 - normalized) * 0.65, 1.0, 0.5); 
        colors.push(colorObj.r, colorObj.g, colorObj.b);
      }
      
      geometry.setAttribute('targetDispZ', new THREE.BufferAttribute(targetDispZArray, 1));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      
      material.vertexColors = true; 
      material.color.setHex(0xffffff); 
    }

    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.EdgesGeometry(geometry, 15);
    mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: dispData.length > 0 ? 0.1 : 0.3, transparent: true })));
    modelGroup.add(mesh);

    boundaries.forEach(bc => {
      let bColor = 0xf59e0b; 
      let bcGeo;
      const sphereRadius = Math.max(dim1 * 0.3, 15);
      let yOffset = -maxHeight - sphereRadius;

      if (bc.type === 'Fix') {
         bColor = 0xef4444; 
         const coneHeight = Math.max(dim1 * 0.8, 30);
         bcGeo = new THREE.ConeGeometry(dim1 * 0.4, coneHeight, 16);
         yOffset = -maxHeight - coneHeight/2;
      } else if (bc.type === 'Hinge') {
         bColor = 0x3b82f6; 
         bcGeo = new THREE.SphereGeometry(sphereRadius, 32, 32);
      } else if (bc.type === 'Roller') {
         bColor = 0x10b981; 
         bcGeo = new THREE.CylinderGeometry(sphereRadius, sphereRadius, dim1 * 1.5, 32);
         bcGeo.rotateX(Math.PI / 2); 
      } else {
         bColor = 0x64748b; 
         bcGeo = new THREE.BoxGeometry(sphereRadius*1.5, sphereRadius*1.5, sphereRadius*1.5);
         yOffset = -maxHeight - (sphereRadius*1.5)/2;
      }

      const bcMesh = new THREE.Mesh(bcGeo, new THREE.MeshStandardMaterial({ color: bColor, roughness: 0.5 }));
      bcMesh.position.set((Number(bc.pos) || 0) - length / 2, yOffset, 0);
      modelGroup.add(bcMesh);
    });

    loads.forEach(load => {
      const fx = Number(load.fx) || 0;
      const fy = Number(load.fy) || 0;
      const fz = Number(load.fz) || 0;
      
      const vec = new THREE.Vector3(fx, fz, -fy); 
      const magVal = vec.length();
      if (magVal < 1e-5) return; 

      const dir = vec.clone().normalize();
      const arrowGroup = new THREE.Group();
      
      // 💡 [수정] 화살표 시각적 스케일 크기 하향 조정 (너무 크지 않게)
      const baseLen = Math.max(80, Math.min(200, magVal * 0.015)); 
      const headLen = baseLen * 0.3;
      const shaftLen = baseLen - headLen;
      const radius = baseLen * 0.08; 
      
      const mat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x440000 });
      
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, shaftLen, 16), mat);
      shaft.position.y = -headLen - shaftLen / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.5, headLen, 16), mat);
      head.position.y = -headLen / 2;
      
      arrowGroup.add(shaft, head);

      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      arrowGroup.quaternion.copy(quaternion);

      const hitOffsetY = fz < 0 ? maxHeight : (fz > 0 ? -maxHeight : 0);
      arrowGroup.position.set((Number(load.pos) || 0) - length/2, hitOffsetY, 0);

      const textLabel = createTextSprite(`${parseFloat(magVal.toFixed(2))} N`);
      textLabel.position.set(0, -baseLen - 40, 0); 
      arrowGroup.add(textLabel); 
      
      modelGroup.add(arrowGroup);
    });

    const viewDist = Math.max(length, 400); 
    camera.position.set(viewDist * 0.7, viewDist * 0.5, viewDist * 0.9);
    controls.update();

    const resizeObserver = new ResizeObserver(entries => {
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
      
      if (dispData.length > 0 && geometry) {
        const pos = geometry.attributes.position;
        const basePos = geometry.attributes.basePosition;
        const tDisp = geometry.attributes.targetDispZ;
        
        if (basePos && tDisp) {
          for (let i = 0; i < pos.count; i++) {
             pos.setY(i, basePos.getY(i) + tDisp.getX(i) * defScaleRef.current);
          }
          pos.needsUpdate = true; 
        }
      }

      renderer.render(scene, camera); 
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      if (mountRef.current && renderer.domElement) { try { mountRef.current.removeChild(renderer.domElement); } catch(e) {} }
      renderer.dispose();
    };
  }, [isLayoutReady, params, beamType, loads, boundaries, dispData]);

  // ==========================================
  // 5. 컴포넌트 렌더링
  // ==========================================
  return (
    <div 
      ref={captureRef}
      className={
        isCapturing
          ? "w-[1200px] bg-slate-950 p-12 flex flex-col gap-8 absolute top-0 left-0 z-[9999]"
          : "grid grid-cols-[400px_1fr] w-full h-[calc(100vh-100px)] min-h-[600px] bg-slate-950 p-4 gap-4 rounded-2xl shadow-inner overflow-hidden relative"
      }
    >
      {/* 💡 [수정] Toast 팝업을 화면 정중앙 상단으로 이동하고 크기/그림자 강화 */}
      {toast && (
        <div className={`fixed top-12 left-1/2 -translate-x-1/2 z-[99999] flex items-center gap-4 px-8 py-5 rounded-2xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.7)] border transition-all animate-fade-in-up backdrop-blur-xl ${
          toast.type === 'success' ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-400' :
          toast.type === 'error' ? 'bg-red-950/95 border-red-500/60 text-red-400' :
          'bg-indigo-950/95 border-indigo-500/60 text-indigo-400'
        }`}>
          {toast.type === 'success' && <ShieldCheck size={28} />}
          {toast.type === 'error' && <Activity size={28} />}
          {toast.type === 'info' && <Info size={28} />}
          <span className="text-base font-bold tracking-wide whitespace-pre-line">{toast.message}</span>
        </div>
      )}

      {!isLayoutReady && !isCapturing && (
        <div className="col-span-2 absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-[#00E600]">
          <RefreshCw className="animate-spin mb-4" size={48} />
          <p className="font-mono font-bold tracking-widest uppercase">Initializing Engine...</p>
        </div>
      )}

      {isCapturing && (
        <div className="w-full flex justify-between items-end border-b border-slate-800 pb-6 shrink-0">
           <div>
             <h1 className="text-3xl font-bold text-white tracking-widest">STRUCTURAL ANALYSIS REPORT</h1>
             <p className="text-slate-400 mt-2 text-sm">Generated by HiTESS WorkBench • Simple Beam Assessment</p>
           </div>
           <div className="text-right">
             <p className="text-emerald-400 font-mono text-sm">Date: {new Date().toLocaleString()}</p>
             <p className="text-slate-400 font-mono text-sm mt-1">Beam Type: {beamType} | Length: {params.length}mm</p>
           </div>
        </div>
      )}

      {/* --- 좌측 패널 --- */}
      {!isCapturing && (
        <div className="flex flex-col h-full overflow-hidden bg-slate-900 rounded-xl border border-slate-800 shadow-2xl relative z-10">
          <div className="flex border-b border-slate-800 bg-slate-800/80 sticky top-0 z-20 backdrop-blur-md">
            <button onClick={() => setActiveTab('modeling')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${activeTab === 'modeling' ? 'text-[#00E600] border-b-2 border-[#00E600] bg-slate-800' : 'text-slate-400 hover:text-white'}`}>
              <SlidersHorizontal size={14} className="inline mr-2 mb-0.5"/> Modeling
            </button>
            <button onClick={() => setActiveTab('results')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${activeTab === 'results' ? 'text-[#00E600] border-b-2 border-[#00E600] bg-slate-800' : 'text-slate-400 hover:text-white'}`}>
              <BarChart2 size={14} className="inline mr-2 mb-0.5"/> Analysis Results
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            
            {isReadOnly && activeTab === 'modeling' && (
              <div className="absolute inset-0 bg-slate-900/60 z-10 pointer-events-none rounded-xl backdrop-blur-[1px] flex flex-col items-center pt-20">
                 <div className="bg-slate-800 border border-slate-700 px-4 py-2 rounded-lg text-emerald-400 text-xs font-bold shadow-xl">
                   {isAnalyzing ? "⏳ 서버에서 해석을 수행 중입니다..." : "🔒 해석 결과 적용 중 (입력 수정 불가)"}
                 </div>
              </div>
            )}

            {/* TAB 1: 모델링 */}
            {activeTab === 'modeling' && (
              <div className="p-5 space-y-6">
                
                <div className="flex justify-between items-center bg-indigo-900/20 p-3 rounded-lg border border-indigo-500/30">
                  <span className="text-[11px] font-medium text-indigo-300">Import Model or result.json</span>
                  <label className={`cursor-pointer bg-indigo-600 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1 font-bold shadow-md transition-colors ${isReadOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-500'}`}>
                    <FileJson size={14}/> Load JSON
                    <input type="file" accept=".json" className="hidden" disabled={isReadOnly} onChange={handleJsonUpload} />
                  </label>
                </div>

                <section>
                  <div className="flex justify-between items-end mb-4">
                    <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2"><Box size={14} /> Cross Section</h3>
                    <div className="w-16 h-16 bg-slate-800 border border-slate-700 rounded-lg p-1 flex items-center justify-center"><SectionGuide type={beamType} /></div>
                  </div>
                  <select disabled={isReadOnly} value={beamType} onChange={handleBeamTypeChange} className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-bold mb-4 outline-none ${isReadOnly ? 'opacity-50 cursor-not-allowed' : 'focus:border-[#00E600] cursor-pointer'}`}>
                    <option value="I">I-Beam</option><option value="H">H-Beam</option><option value="BAR">BAR (Solid Box)</option><option value="L">L-Beam (Angle)</option><option value="T">T-Beam</option><option value="CHAN">Channel (C-Shape)</option><option value="ROD">ROD (Solid Cylinder)</option><option value="TUBE">TUBE (Hollow Pipe)</option>
                  </select>
                  <div className="space-y-1">
                    <InputRow label="Length (L)" value={params.length} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, length: e.target.value})} />
                    {beamType === 'ROD' && <InputRow label="Diameter (D)" value={params.dim1} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim1: e.target.value})} />}
                    {beamType === 'TUBE' && (<><InputRow label="Outer Dia (D)" value={params.dim1} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim1: e.target.value})} /><InputRow label="Thickness (t)" value={params.dim2} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim2: e.target.value})} /></>)}
                    {['BAR', 'I', 'H', 'L', 'T', 'CHAN'].includes(beamType) && (<><InputRow label="Width (W)" value={params.dim1} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim1: e.target.value})} /><InputRow label="Height (H)" value={params.dim2} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim2: e.target.value})} /></>)}
                    {['I', 'H', 'L', 'T', 'CHAN'].includes(beamType) && (<><InputRow label="Flange Thk (tf)" value={params.dim3} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim3: e.target.value})} /><InputRow label="Web Thk (tw)" value={params.dim4} unit="mm" disabled={isReadOnly} onChange={(e) => setParams({...params, dim4: e.target.value})} /></>)}
                  </div>
                </section>

                <section className="border-t border-slate-800 pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2"><ShieldCheck size={14} /> Boundaries</h3>
                    {/* 💡 [수정] 기본값 5000 반영 (loads 추가에도 반영) */}
                    {!isReadOnly && <button onClick={() => setBoundaries([...boundaries, { pos: (Number(params.length)||0)/2, type: 'Hinge', dof: '' }])} className="text-slate-400 hover:text-blue-400 cursor-pointer"><Plus size={16}/></button>}
                  </div>
                  <div className="space-y-2">
                    {boundaries.map((bc, idx) => (
                      <div key={idx} className={`flex gap-1 items-center bg-slate-950 p-1.5 rounded-lg border border-slate-800 ${isReadOnly && 'opacity-60'}`}>
                        <div className="relative flex-1"><input type="number" disabled={isReadOnly} value={bc.pos} onChange={e => updateBc(idx, 'pos', e.target.value)} className="w-full bg-transparent px-2 py-1 text-sm text-white outline-none font-mono text-right pr-8 disabled:cursor-not-allowed" /><span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">mm</span></div>
                        <select disabled={isReadOnly} value={bc.type} onChange={e => updateBc(idx, 'type', e.target.value)} className="w-[72px] bg-slate-800 rounded px-1 py-1 text-[11px] text-white outline-none disabled:cursor-not-allowed">
                          <option value="Fix">Fix</option><option value="Hinge">Hinge</option><option value="Roller">Roller</option><option value="Custom">Custom</option>
                        </select>
                        {bc.type === 'Custom' && (
                          <input type="text" disabled={isReadOnly} placeholder="DOF" value={bc.dof || ''} onChange={e => updateBc(idx, 'dof', e.target.value)} className="w-12 bg-slate-900 border border-slate-700 text-white text-[10px] px-1 rounded outline-none text-center font-mono" />
                        )}
                        {!isReadOnly && <button onClick={() => setBoundaries(boundaries.filter((_, i) => i !== idx))} className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"><Trash2 size={14}/></button>}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-t border-slate-800 pt-6 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-bold text-[#00E600] uppercase tracking-wider flex items-center gap-2"><ArrowDown size={14} /> Static Loads</h3>
                    {/* 💡 [수정] Plus 클릭 시에도 fz: -5000 기본 추가 */}
                    {!isReadOnly && <button onClick={() => setLoads([...loads, { pos: (Number(params.length)||0)/2, fx: 0, fy: 0, fz: -5000 }])} className="text-slate-400 hover:text-red-400 cursor-pointer"><Plus size={16}/></button>}
                  </div>
                  <div className="space-y-3">
                    {loads.map((load, idx) => (
                      <div key={idx} className={`flex flex-col gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-800 ${isReadOnly && 'opacity-60'}`}>
                        <div className="flex gap-2 items-center">
                           <span className="text-[10px] text-slate-400 font-bold uppercase w-8 tracking-wider">POS</span>
                           <div className="relative flex-1">
                             <input type="number" disabled={isReadOnly} value={load.pos} onChange={e => updateLoad(idx, 'pos', e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-red-500 px-2 py-1 text-sm text-white outline-none font-mono text-right pr-6 rounded disabled:cursor-not-allowed" />
                             <span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">mm</span>
                           </div>
                           {!isReadOnly && <button onClick={() => setLoads(loads.filter((_, i) => i !== idx))} className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"><Trash2 size={14}/></button>}
                        </div>
                        <div className="flex gap-1.5">
                           {['fx', 'fy', 'fz'].map(axis => (
                             <div key={axis} className="relative flex-1 flex items-center border border-slate-800 rounded bg-slate-900 overflow-hidden focus-within:border-red-500">
                                <span className="text-[9px] font-bold text-slate-500 pl-1.5 uppercase">{axis}</span>
                                <input type="number" disabled={isReadOnly} value={load[axis]} onChange={e => updateLoad(idx, axis, e.target.value)} className="w-full bg-transparent px-1 py-1 text-xs text-red-400 outline-none font-mono text-right disabled:cursor-not-allowed" />
                             </div>
                           ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* TAB 2: 결과 */}
            {activeTab === 'results' && (
              <div className="p-5 space-y-6 h-full flex flex-col">
                <div className="mb-2 text-slate-300 text-sm">
                  <p>해석이 완료된 <strong>result.json</strong> 파일을 업로드하시면 모델 조건과 해석 결과가 한 번에 적용됩니다.</p>
                </div>
                
                {!hasCharts ? (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:bg-slate-800 transition-colors">
                    <Upload size={28} className="text-slate-400 mb-3"/>
                    <span className="text-sm font-bold text-emerald-400 mb-1">Upload result.json</span>
                    <span className="text-[11px] text-slate-500">클릭하여 파일 선택</span>
                    <input type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
                  </label>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-emerald-900/20 border border-emerald-500/30 p-4 rounded-xl">
                      <h4 className="text-sm font-bold text-emerald-400 mb-1 flex items-center gap-2"><Activity size={16}/> 해석 데이터 적용 완료</h4>
                      <p className="text-xs text-emerald-300/70">우측 뷰어에서 3D 변형 형상 및 하단의 응력/단면력 차트를 확인하세요.</p>
                    </div>

                    {summaryData && (
                      <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 mt-2 shadow-lg">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-slate-800 pb-2 mb-3">Analysis Summary</h4>
                        <div className="flex flex-col gap-2.5 text-xs">
                          <SummaryRow label="Total Weight" value={summaryData.totalWeight?.toFixed(2)} unit="kg" />
                          <SummaryRow 
                            label="Max Displacement (Z)" 
                            value={summaryData.maxDispNode?.dispZ?.toFixed(4)} unit="mm" 
                            sub={`@ Node ${summaryData.maxDispNode?.nodeId} (X: ${summaryData.maxDispNode?.x}mm)`} 
                          />
                          <SummaryRow 
                            label="Max Stress" 
                            value={engFormat(summaryData.maxStressElement?.sMax || summaryData.maxStressElement?.maxStress)} unit="MPa" 
                            sub={`@ Element ${summaryData.maxStressElement?.elementId}`} 
                          />
                          <SummaryRow 
                            label="Max Shear Force" 
                            value={engFormat(summaryData.maxShearForceElement?.shearForce1)} unit="N" 
                            sub={`@ Element ${summaryData.maxShearForceElement?.elementId}`} 
                          />
                          <SummaryRow 
                            label="Max Bending Moment" 
                            value={engFormat(summaryData.maxBendingMomentElement?.bendingMoment1)} unit="N·mm" 
                            sub={`@ Element ${summaryData.maxBendingMomentElement?.elementId}`} 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0 z-20">
             {validationErrors.length > 0 && !isReadOnly && (
                <div className="mb-3 p-2 bg-red-950/50 border border-red-800 rounded text-[11px] text-red-300">
                  <strong className="block mb-1">입력 오류:</strong>
                  {validationErrors.map((err, idx) => <div key={idx}>- {err}</div>)}
                </div>
             )}

            {hasCharts ? (
              <button onClick={handleReset} className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800/50 shadow-lg">
                <Trash2 size={18} />
                데이터 초기화 (Clear Results)
              </button>
            ) : isAnalyzing ? (
              <div className="w-full flex flex-col items-center bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-inner">
                <div className="flex justify-between w-full text-[11px] text-emerald-400 font-bold mb-2">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="animate-spin" size={14}/> 
                    {globalJob?.message || "서버 대기 중..."}
                  </span>
                  <span>{globalJob?.progress || 0}%</span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${globalJob?.progress || 0}%` }}>
                  </div>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleRunAnalysis} disabled={validationErrors.length > 0} 
                className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${validationErrors.length > 0 ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-[#00E600] text-[#002554] hover:shadow-[0_0_20px_rgba(0,230,0,0.4)]'}`}
              >
                <Play size={18} className="fill-current" />
                서버에서 해석 실행 (Run)
              </button>
            )}
          </div>
        </div>
      )}

      {/* --- 우측 분할 영역 (3D Viewer & Charts) --- */}
      <div className={`flex flex-col rounded-xl shadow-2xl border border-slate-800 z-0 relative bg-slate-950 transition-all ${
        isCapturing ? 'w-full h-max gap-8 overflow-visible pb-16' : 'h-full overflow-hidden'
      }`}>
        
        {!isCapturing && hasCharts && (
          <button 
            onClick={handleCapture} 
            className="absolute top-4 right-4 z-50 bg-indigo-600/90 hover:bg-indigo-500 p-2.5 rounded-lg border border-indigo-400 text-white transition-colors flex items-center gap-2 shadow-[0_4px_15px_rgba(79,70,229,0.5)] cursor-pointer"
            title="현재 결과 화면을 전체 스크롤 길이에 맞춰 이미지로 저장합니다"
          >
            <Camera size={18}/> <span className="text-xs font-bold tracking-wider">FULL REPORT</span>
          </button>
        )}

        {/* 1) 3D Viewer 영역 */}
        <div className={`relative w-full bg-black transition-all duration-500 shrink-0 ${
          isCapturing ? 'h-[550px] border-b border-slate-800 rounded-xl overflow-hidden' : (hasCharts ? 'h-[45%] border-b border-slate-800' : 'h-full')
        }`}>
          <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-move" />
          
          {hasCharts && (
            <>
              <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 pointer-events-none">
                 <span className="text-[10px] font-bold text-emerald-400">● 3D Deformation Mapped</span>
              </div>
              
              {!isCapturing && (
                <div className="absolute bottom-4 left-4 w-64 bg-slate-900/80 backdrop-blur px-4 py-3 rounded-xl border border-slate-700 flex flex-col gap-2 z-10 shadow-lg pointer-events-auto">
                  <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-emerald-400">Deformation Scale</span>
                      <span className="text-xs font-mono text-white">{defScale.toFixed(1)}x</span>
                  </div>
                  <input type="range" min="0" max="5" step="0.1" value={defScale} onChange={handleScaleChange} className="w-full accent-emerald-500 cursor-pointer" />
                </div>
              )}
            </>
          )}
        </div>

        {/* 2) Engineering Charts 영역 */}
        {hasCharts && (
          <div className={`bg-slate-900 ${
            isCapturing 
              ? 'flex flex-col gap-8 w-full h-max p-0 bg-transparent overflow-visible' 
              : 'h-[55%] overflow-y-auto custom-scrollbar p-6 space-y-6'
          }`}>
            
            {dispData.length > 0 && (
              <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 shrink-0 ${isCapturing ? 'h-[400px]' : 'h-64'}`}>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">DEFLECTION (DispZ)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dispData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                    <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} domain={['auto','auto']} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                    <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
                    <Line isAnimationActive={!isCapturing} type="monotone" dataKey="DispZ[mm]" stroke="#38bdf8" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {elForceData.length > 0 && (
              <div className={isCapturing ? "flex flex-col gap-8 w-full" : "grid grid-cols-2 gap-6 h-64 shrink-0"}>
                
                <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 ${isCapturing ? 'h-[400px]' : ''}`}>
                  <h3 className="text-sm font-bold text-white mb-4 tracking-wider">BENDING MOMENT DIAGRAM (BMD)</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                      <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                      <Area isAnimationActive={!isCapturing} type="linear" dataKey="BendingMoment1" stroke="#f87171" fill="#7f1d1d" fillOpacity={0.6} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 ${isCapturing ? 'h-[400px]' : ''}`}>
                  <h3 className="text-sm font-bold text-white mb-4 tracking-wider">SHEAR FORCE DIAGRAM (SFD)</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={elForceData} margin={{ top: 10, right: 10, left: 30, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                      <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                      <Area isAnimationActive={!isCapturing} type="linear" dataKey="ShearForce1" stroke="#fbbf24" fill="#78350f" fillOpacity={0.6} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

              </div>
            )}

            {stressData.length > 0 && (
              <div className={`bg-slate-950 p-5 rounded-xl border border-slate-800 shrink-0 ${isCapturing ? 'h-[400px]' : 'h-64'}`}>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">STRESS ENVELOPE (Max/Min)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stressData} margin={{ top: 10, right: 20, left: 30, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="X[mm]" stroke="#94a3b8" tick={{fontSize: 11}} type="number" domain={['dataMin', 'dataMax']} />
                    <YAxis stroke="#94a3b8" tick={{fontSize: 11}} tickFormatter={engFormat} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }} itemStyle={{ color: '#f8fafc' }} formatter={(val) => engFormat(val)} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                    <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
                    <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MAX[MPa]" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    <Line isAnimationActive={!isCapturing} type="linear" dataKey="S-MIN[MPa]" stroke="#34d399" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        )}
      </div>

    </div>
  );
}

// ====================================================
// Helper Components
// ====================================================
function InputRow({ label, value, unit, onChange, disabled }) {
  return (
    <div className={`flex items-center justify-between bg-slate-900 border border-transparent rounded p-1 transition-colors group ${disabled ? 'opacity-60' : 'hover:border-slate-700'}`}>
      <span className="text-[11px] text-slate-400 pl-2 group-hover:text-slate-300 w-2/5 truncate">{label}</span>
      <div className={`flex items-center w-3/5 bg-slate-950 border border-slate-800 rounded px-2 ${!disabled && 'focus-within:border-[#00E600]'}`}>
        <input type="number" value={value} onChange={onChange} disabled={disabled} className="w-full bg-transparent py-1 text-sm text-[#00E600] font-bold outline-none font-mono text-right disabled:cursor-not-allowed" />
        <span className="text-[10px] text-slate-600 font-mono ml-1 w-6 text-right">{unit}</span>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, unit, sub }) {
  return (
    <div className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-800">
      <div className="flex flex-col">
        <span className="text-slate-400 font-medium">{label}</span>
        {sub && <span className="text-[10px] text-slate-500 font-mono">{sub}</span>}
      </div>
      <div className="text-right">
        <span className="text-emerald-400 font-bold text-sm">{value || '0'}</span>
        {unit && <span className="text-[10px] text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function SectionGuide({ type }) {
  const s = { stroke: '#475569', strokeWidth: 2, fill: 'none' };
  const t = { fill: '#00E600', fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold' };
  const getSvgContent = () => {
    switch (type) {
      case 'I': return (<><path d="M 20,20 L 80,20 M 20,80 L 80,80 M 50,20 L 50,80" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'H': return (<><path d="M 20,20 L 20,80 M 80,20 L 80,80 M 20,50 L 80,50" {...s} strokeWidth={6} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="45" y="45" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'BAR': return (<><rect x="20" y="25" width="60" height="50" {...s} fill="#1e293b" /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text></>);
      case 'L': return (<><path d="M 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="95" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="45" {...t}>tw</text><text x="65" y="70" {...t}>tf</text></>);
      case 'T': return (<><path d="M 20,20 L 80,20 M 50,20 L 50,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="30" y="55" {...t}>H</text><text x="55" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'CHAN': return (<><path d="M 80,20 L 20,20 L 20,80 L 80,80" {...s} strokeWidth={8} /><text x="45" y="15" {...t}>W</text><text x="5" y="55" {...t}>H</text><text x="25" y="55" {...t}>tw</text><text x="85" y="25" {...t}>tf</text></>);
      case 'TUBE': return (<><circle cx="50" cy="50" r="35" {...s} /><circle cx="50" cy="50" r="25" {...s} /><text x="45" y="55" {...t}>D</text><text x="80" y="55" {...t}>t</text></>);
      case 'ROD': return (<><circle cx="50" cy="50" r="35" {...s} fill="#1e293b" /><text x="45" y="55" {...t}>D</text></>);
      default: return null;
    }
  };
  return <svg viewBox="0 0 100 100" className="w-full h-full opacity-80">{getSvgContent()}</svg>;
}