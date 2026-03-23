/// <summary>
/// 파일 기반(File-Based)의 Truss Structural Assessment (트러스 구조 평가) 패널입니다.
/// (해결) 누락된 아이콘 임포트를 복구하여 진입 시 발생하는 크래시(파란 화면)를 해결했습니다.
/// (최적화) 부재(Element) 렌더링에도 InstancedMesh를 적용하여 대용량 BDF 모델 업로드 시 브라우저가 멈추는 현상을 원천 차단했습니다.
/// </summary>
import React, { useState, useRef, useEffect, Fragment } from 'react';
import axios from 'axios';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { API_BASE_URL } from '../config';
import { 
  ArrowLeft, Upload, Play, Database, RefreshCw, Layers,
  Box, GitMerge, CheckCircle2, AlertCircle, Eye, EyeOff,
  Terminal, Hexagon, LayoutGrid, RotateCcw, PlayCircle, PauseCircle
} from 'lucide-react';

// ==========================================
// [내장 컴포넌트] 실시간 BDF 3D 뷰어 (초고속 최적화 & UX 컨트롤 내장)
// ==========================================
const EmbeddedBdfViewer = ({ nodes, elements }) => {
  const mountRef = useRef(null);
  
  // UX 상태
  const [showNodes, setShowNodes] = useState(true);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  // Three.js 리소스 참조 (리렌더링 없는 즉각 제어용)
  const controlsRef = useRef(null);
  const nodesMeshRef = useRef(null);
  const elementsGroupRef = useRef(null);

  useEffect(() => {
    const nodeKeys = Object.keys(nodes);
    if (!mountRef.current || nodeKeys.length === 0) return;

    let renderer, scene, camera, controls;
    let animationId;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e293b); 

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000000);
    camera.up.set(0, 0, 1); 

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
    
    // 사이즈 계산 (동적 굵기 적용)
    const tempBox = new THREE.Box3();
    Object.values(nodes).forEach(pos => tempBox.expandByPoint(new THREE.Vector3(...pos)));
    const size = new THREE.Vector3();
    tempBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1000;
    const rodRadius = maxDim * 0.0015; 

    // -----------------------------------------------------
    // 1. 노드 렌더링 (InstancedMesh - 초고속)
    // -----------------------------------------------------
    const createCircleTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d');
      context.beginPath();
      context.arc(16, 16, 16, 0, Math.PI * 2);
      context.fillStyle = '#ffffff'; 
      context.fill();
      return new THREE.CanvasTexture(canvas);
    };

    const sphereGeo = new THREE.SphereGeometry(rodRadius * 1.8, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({ 
      color: 0xFF3333, roughness: 0.3, metalness: 0.2,
      map: createCircleTexture(), transparent: true, alphaTest: 0.5 
    });
    
    const instancedNodes = new THREE.InstancedMesh(sphereGeo, sphereMat, nodeKeys.length);
    const dummyNode = new THREE.Object3D();

    nodeKeys.forEach((key, index) => {
      const [x, y, z] = nodes[key];
      dummyNode.position.set(x, y, z);
      dummyNode.updateMatrix();
      instancedNodes.setMatrixAt(index, dummyNode.matrix);
    });
    instancedNodes.instanceMatrix.needsUpdate = true;
    modelGroup.add(instancedNodes);
    nodesMeshRef.current = instancedNodes;

    // -----------------------------------------------------
    // 2. 멤버(Element) 렌더링 (InstancedMesh 적용 - 브라우저 멈춤 방지)
    // -----------------------------------------------------
    if (elements.length > 0) {
      const cylinderGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
      cylinderGeo.rotateX(Math.PI / 2); 
      const cylinderMat = new THREE.MeshStandardMaterial({ 
        color: 0x3b82f6, roughness: 0.3, metalness: 0.7 
      });

      const instancedElements = new THREE.InstancedMesh(cylinderGeo, cylinderMat, elements.length);
      const dummyElem = new THREE.Object3D();

      let validElemCount = 0;
      elements.forEach(([n1, n2]) => {
        if (nodes[n1] && nodes[n2]) {
          const p1 = new THREE.Vector3(...nodes[n1]);
          const p2 = new THREE.Vector3(...nodes[n2]);
          const distance = p1.distanceTo(p2);
          
          dummyElem.position.copy(p1).lerp(p2, 0.5);
          dummyElem.scale.set(1, 1, distance);
          dummyElem.lookAt(p2);
          dummyElem.updateMatrix();
          
          instancedElements.setMatrixAt(validElemCount, dummyElem.matrix);
          validElemCount++;
        }
      });
      instancedElements.count = validElemCount;
      instancedElements.instanceMatrix.needsUpdate = true;
      modelGroup.add(instancedElements);
      elementsGroupRef.current = instancedElements; // 와이어프레임 제어용
    }

    scene.add(modelGroup);

    // 3. 카메라 자동 피팅
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    
    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.saveState(); // 초기 시점 저장 (리셋 버튼용)

    const handleResize = () => {
      if (!mountRef.current) return;
      const newWidth = mountRef.current.clientWidth;
      const newHeight = mountRef.current.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      dirLight.position.copy(camera.position);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
          else object.material.dispose();
        }
      });
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss(); 
      }
      if (mountRef.current && renderer.domElement) {
        try { mountRef.current.removeChild(renderer.domElement); } catch(e) {}
      }
    };
  }, [nodes, elements]);

  // -----------------------------------------------------
  // UX 스위칭 제어 (리렌더링 없이 GPU 파이프라인에서 즉시 적용)
  // -----------------------------------------------------
  useEffect(() => {
    if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes;
  }, [showNodes]);

  useEffect(() => {
    if (elementsGroupRef.current && elementsGroupRef.current.material) {
      elementsGroupRef.current.material.wireframe = isWireframe;
    }
  }, [isWireframe]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [autoRotate]);

  const resetCamera = () => {
    if (controlsRef.current) controlsRef.current.reset();
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full bg-slate-900 cursor-move" />
      
      {/* 3D 뷰어 하단 플로팅 컨트롤러 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
        <button onClick={() => setShowNodes(!showNodes)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`} title="노드 켜기/끄기">
          {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
        </button>

        <button onClick={() => setIsWireframe(!isWireframe)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${isWireframe ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`} title="와이어프레임 전환">
          {isWireframe ? <LayoutGrid size={18} className="mb-1" /> : <Hexagon size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Frame</span>
        </button>

        <div className="w-px bg-slate-700 mx-1 my-2"></div>

        <button onClick={() => setAutoRotate(!autoRotate)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`} title="자동 회전 토글">
          {autoRotate ? <PauseCircle size={18} className="mb-1" /> : <PlayCircle size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Rotate</span>
        </button>

        <button onClick={resetCamera} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer" title="카메라 위치 초기화">
          <RotateCcw size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">Reset</span>
        </button>
      </div>
    </div>
  );
};


// ==========================================
// 메인 앱 컴포넌트
// ==========================================
export default function TrussAssessment({ setCurrentMenu }) {
  const [bdfFile, setBdfFile] = useState(null);
  
  const [nodes, setNodes] = useState({});
  const [elements, setElements] = useState([]);
  const [nodeTableData, setNodeTableData] = useState([]);
  const [elemTableData, setElemTableData] = useState([]);

  const [logs, setLogs] = useState([]); 
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0); 
  const [statusMessage, setStatusMessage] = useState(''); 

  const [activeTab, setActiveTab] = useState('3d'); 
  const logEndRef = useRef(null);

  const numNodes = Object.keys(nodes).length;
  const numMembers = elements.length;
  const isDataReady = numNodes > 0 && numMembers > 0;

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (message, type = 'info') => { 
    const time = new Date().toLocaleTimeString(); 
    setLogs(prev => [...prev, { time, message, type }]); 
  };

  const parseBDF = (text) => {
    const parsedNodes = {};
    const parsedElements = [];
    const lines = text.split('\n');

    const parseNastranFloat = (str) => {
      if (!str || !str.trim()) return 0;
      let s = str.trim().toUpperCase();
      if (s.includes('E')) return parseFloat(s);
      s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
      return parseFloat(s) || 0;
    };

    lines.forEach(line => {
      if (line.startsWith('GRID')) {
        if (line.includes(',')) {
          const p = line.split(',');
          parsedNodes[parseInt(p[1])] = [parseFloat(p[3]), parseFloat(p[4]), parseFloat(p[5])];
        } else {
          const id = parseInt(line.substring(8, 16));
          const x = parseNastranFloat(line.substring(24, 32));
          const y = parseNastranFloat(line.substring(32, 40));
          const z = parseNastranFloat(line.substring(40, 48));
          if (!isNaN(id)) parsedNodes[id] = [x, y, z];
        }
      } else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
        if (line.includes(',')) {
          const p = line.split(',');
          parsedElements.push([parseInt(p[3]), parseInt(p[4])]); 
        } else {
          const n1 = parseInt(line.substring(24, 32));
          const n2 = parseInt(line.substring(32, 40));
          if (!isNaN(n1) && !isNaN(n2)) parsedElements.push([n1, n2]);
        }
      }
    });

    setNodes(parsedNodes);
    setElements(parsedElements);

    const nTable = [["Node ID", "X", "Y", "Z"]];
    Object.keys(parsedNodes).slice(0, 100).forEach(key => {
      nTable.push([key, ...parsedNodes[key].map(v => v.toFixed(2))]);
    });
    setNodeTableData(nTable);

    const eTable = [["Element", "Start Node", "End Node"]];
    parsedElements.slice(0, 100).forEach((el, idx) => {
      eTable.push([idx + 1, el[0], el[1]]);
    });
    setElemTableData(eTable);

    addLog(`[DATA] BDF 파싱 및 3D 모델 구축 완료. (Nodes: ${Object.keys(parsedNodes).length}, Elements: ${parsedElements.length})`, 'success');
  };

  const handleFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.bdf') && !file.name.toLowerCase().endsWith('.dat')) { 
      alert('BDF 또는 DAT 파일만 업로드 가능합니다!'); 
      return; 
    }
    setBdfFile(file);
    const reader = new FileReader();
    reader.onload = (e) => parseBDF(e.target.result);
    reader.readAsText(file);
  };

  const runAnalysis = async () => {
    if (!bdfFile) return;
    
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버에 파일 전송 및 해석 요청 중...');
    setLogs([]);
    
    addLog('시스템 점검 완료. 백엔드 서버로 BDF 파일을 전송합니다...', 'info');
    
    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    const formData = new FormData();
    formData.append('bdf_file', bdfFile);
    formData.append('employee_id', employeeId);
    formData.append('source', 'Workbench');

    try {
      const requestRes = await axios.post(`${API_BASE_URL}/api/analysis/assessment/request`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const jobId = requestRes.data.job_id;
      addLog(`해석 작업이 성공적으로 큐에 등록되었습니다. [Job ID: ${jobId}]`, 'success');
      
      let lastMsg = '';

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`${API_BASE_URL}/api/analysis/status/${jobId}`);
          const { status, progress, message, engine_log } = statusRes.data;

          setProgress(progress);
          setStatusMessage(message);

          if (message !== lastMsg) {
             addLog(`[${progress}%] ${message}`, 'warning');
             lastMsg = message;
          }

          if (status === 'Success' || status === 'Failed') {
            clearInterval(pollInterval);
            setIsRunning(false);
            
            if (status === 'Success') {
              addLog('구조 평가 해석이 완료되었습니다. 결과가 데이터베이스에 저장되었습니다.', 'success');
              if (engine_log) addLog(`[Server Log] ${engine_log}`);
            } else {
              addLog('해석 엔진 실행 실패.', 'error');
              if (engine_log) addLog(engine_log, 'error');
            }
          }
        } catch (pollError) {
          console.error("Polling Error:", pollError);
          clearInterval(pollInterval);
          setIsRunning(false);
          addLog('서버 상태 조회 실패.', 'error');
        }
      }, 1500);

    } catch (error) {
      addLog('서버 통신 실패. 백엔드가 구동 중인지 확인해 주세요.', 'error');
      setIsRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">
      
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentMenu('File-Based Analysis')} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-[#002554] hover:bg-slate-50 transition-colors cursor-pointer"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-[#002554] tracking-tight">Truss Structural Assessment</h1>
            <p className="text-sm text-slate-500 mt-1">BDF 모델 파일을 업로드하여 구조적 건전성을 즉시 평가합니다.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        <div className="w-full lg:w-[400px] flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
              <Database size={16} className="text-blue-500"/> 1. Model Input (.bdf)
            </h3>
            <div 
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} 
              onDragOver={e => e.preventDefault()} 
              className={`relative p-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all ${bdfFile ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'}`}
            >
              <input type="file" accept=".bdf,.dat" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => handleFile(e.target.files[0])} />
              <div className="flex flex-col items-center gap-2">
                <div className={`p-3 rounded-full ${bdfFile ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                  {bdfFile ? <CheckCircle2 size={28} /> : <Upload size={28} />}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700">{bdfFile ? 'File Uploaded' : 'Upload BDF File'}</h4>
                  <p className="text-xs text-slate-500 mt-1 truncate max-w-[250px]">{bdfFile ? bdfFile.name : 'Drag & drop or click to browse'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Box size={16} className="text-slate-500"/> 2. Parsing Summary
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><GitMerge size={16} className="text-indigo-400" /> Parsed Nodes</div>
                <span className="font-mono font-bold text-[#002554]">{numNodes.toLocaleString()} EA</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><Layers size={16} className="text-cyan-400" /> Parsed Elements</div>
                <span className="font-mono font-bold text-[#002554]">{numMembers.toLocaleString()} EA</span>
              </div>
              <div className={`mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed text-sm font-bold transition-colors ${isDataReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>
                {isDataReady ? <><CheckCircle2 size={18} /> Model Ready</> : <><AlertCircle size={18} /> Awaiting BDF Data</>}
              </div>
            </div>
          </div>

          <div className="mt-auto">
            <button 
              onClick={runAnalysis} 
              disabled={!isDataReady || isRunning} 
              className={`relative w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-3 transition-all duration-300 shadow-lg overflow-hidden ${
                !isDataReady || isRunning
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                  : 'bg-[#002554] hover:bg-[#003366] text-white hover:-translate-y-1 cursor-pointer'
              }`}
            >
              {isRunning && <div className="absolute left-0 top-0 bottom-0 bg-blue-600 transition-all duration-500 ease-out opacity-80" style={{ width: `${progress}%` }}></div>}
              <div className="relative z-10 flex items-center gap-3 drop-shadow-md">
                {isRunning ? <RefreshCw className="animate-spin" size={24} /> : <Play size={24} fill="currentColor" />}
                {isRunning ? `${progress}% - ${statusMessage}` : 'Run Structural Assessment'}
              </div>
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-6 min-h-0">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-4 gap-2 shrink-0 z-10">
              <TabButton active={activeTab === '3d'} onClick={() => setActiveTab('3d')} icon={Eye} label="3D Preview" />
              <TabButton active={activeTab === 'node'} onClick={() => setActiveTab('node')} icon={Database} label="Node Data" />
              <TabButton active={activeTab === 'member'} onClick={() => setActiveTab('member')} icon={Layers} label="Element Data" />
            </div>
            
            <div className="flex-1 relative bg-white">
              {activeTab === '3d' && (
                isDataReady ? <EmbeddedBdfViewer nodes={nodes} elements={elements} /> : <EmptyState msg="BDF 파일을 업로드하면 3D 모델이 렌더링됩니다." />
              )}
              {activeTab === 'node' && (
                isDataReady ? <DataTable data={nodeTableData} /> : <EmptyState msg="BDF 파일을 업로드하면 Node 데이터를 미리볼 수 있습니다." />
              )}
              {activeTab === 'member' && (
                isDataReady ? <DataTable data={elemTableData} /> : <EmptyState msg="BDF 파일을 업로드하면 Element 데이터를 미리볼 수 있습니다." />
              )}
            </div>
          </div>

          <div className="h-48 bg-[#0F172A] rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4">
              <Terminal size={14} className="text-slate-400 mr-2" />
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">Execution Console</span>
            </div>
            <div className="flex-1 p-4 font-mono text-[13px] overflow-y-auto custom-scrollbar">
              {logs.length === 0 ? <p className="text-slate-600">Waiting for user action...</p> : logs.map((log, i) => (
                <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-[#00E600] font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'}`}>
                  <span className="text-slate-500 mr-3">[{log.time}]</span>{log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={`px-4 py-2.5 rounded-t-lg font-bold text-sm flex items-center gap-2 cursor-pointer transition-colors ${active ? 'bg-white text-[#002554] border-t-2 border-t-[#002554] border-x border-slate-200' : 'text-slate-500 hover:bg-slate-200 border-t-2 border-transparent border-x border-transparent'}`}>
      <Icon size={16} /> {label}
    </button>
  );
}

function EmptyState({ msg }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
      <Box size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-bold">{msg}</p>
    </div>
  );
}

function DataTable({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-auto custom-scrollbar">
      <table className="w-full text-left text-sm font-mono whitespace-nowrap">
        <thead className="sticky top-0 bg-slate-100 shadow-sm z-10">
          <tr>
            {data[0].map((h, i) => <th key={i} className="px-6 py-3 text-slate-600 font-bold uppercase tracking-wider text-xs border-b">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.slice(1).map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {row.map((cell, j) => <td key={j} className="px-6 py-2 text-slate-700">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-2 text-center text-xs text-slate-400 bg-slate-50 border-t border-slate-100">
        * 프리뷰는 성능을 위해 상위 100개 항목만 표시합니다.
      </div>
    </div>
  );
}