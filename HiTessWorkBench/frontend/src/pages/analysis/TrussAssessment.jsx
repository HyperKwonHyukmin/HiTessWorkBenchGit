/// <summary>
/// 파일 기반(File-Based)의 Truss Structural Assessment (트러스 구조 평가) 패널입니다.
/// (수정) 해석 중 버튼 UI 최적화, 완료 시 엑셀 다운로드 창 자동 팝업, JSON 객체 파싱(데이터 없음 버그 해결) 기능이 모두 추가되었습니다.
/// </summary>
import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { requestAssessment, getJobStatus, downloadFileBlob, exportAssessmentXlsx } from '../../api/analysis';
import { useDashboard } from '../../contexts/DashboardContext';
import { 
  ArrowLeft, Upload, Play, Database, RefreshCw, Layers,
  Box, GitMerge, CheckCircle2, AlertCircle, Eye, EyeOff,
  Terminal, Hexagon, LayoutGrid, RotateCcw, PlayCircle, PauseCircle,
  FileText, Maximize2, Download, Tag, X, FileOutput, XCircle, Clock
} from 'lucide-react';

// ==========================================
// [내장 컴포넌트] 실시간 BDF 3D 뷰어
// ==========================================
const EmbeddedBdfViewer = ({ nodes, elements }) => {
  const mountRef = useRef(null);
  
  const [showNodes, setShowNodes] = useState(true);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const controlsRef = useRef(null);
  const nodesMeshRef = useRef(null);
  const elementsGroupRef = useRef(null);

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
    modelGroup.add(instancedNodes);
    nodesMeshRef.current = instancedNodes;

    if (elements.length > 0) {
      const cylinderGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
      cylinderGeo.rotateX(Math.PI / 2); 
      const cylinderMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.7 });

      const instancedElements = new THREE.InstancedMesh(cylinderGeo, cylinderMat, elements.length);
      const dummyElem = new THREE.Object3D();

      let validElemCount = 0;
      elements.forEach(([n1, n2]) => {
        if (nodes[n1] && nodes[n2]) {
          const p1 = new THREE.Vector3(...nodes[n1]); const p2 = new THREE.Vector3(...nodes[n2]);
          const distance = p1.distanceTo(p2);
          dummyElem.position.copy(p1).lerp(p2, 0.5); dummyElem.scale.set(1, 1, distance); dummyElem.lookAt(p2); dummyElem.updateMatrix();
          instancedElements.setMatrixAt(validElemCount, dummyElem.matrix);
          validElemCount++;
        }
      });
      instancedElements.count = validElemCount;
      instancedElements.instanceMatrix.needsUpdate = true;
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

    const handleResize = () => {
      if (!mountRef.current) return;
      const newWidth = mountRef.current.clientWidth; const newHeight = mountRef.current.clientHeight;
      camera.aspect = newWidth / newHeight; camera.updateProjectionMatrix(); renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    const animate = () => { animationId = requestAnimationFrame(animate); controls.update(); dirLight.position.copy(camera.position); renderer.render(scene, camera); };
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
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
      if (mountRef.current && renderer.domElement) { try { mountRef.current.removeChild(renderer.domElement); } catch(e) {} }
    };
  }, [nodes, elements]);

  useEffect(() => { if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes; }, [showNodes]);
  useEffect(() => { if (elementsGroupRef.current && elementsGroupRef.current.material) { elementsGroupRef.current.material.wireframe = isWireframe; } }, [isWireframe]);
  useEffect(() => { if (controlsRef.current) { controlsRef.current.autoRotate = autoRotate; controlsRef.current.autoRotateSpeed = 2.0; } }, [autoRotate]);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full bg-slate-900 cursor-move" />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
        <button onClick={() => setShowNodes(!showNodes)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
          {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
        </button>
        <button onClick={() => setIsWireframe(!isWireframe)} className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer ${isWireframe ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
          {isWireframe ? <LayoutGrid size={18} className="mb-1" /> : <Hexagon size={18} className="mb-1" />}
          <span className="text-[8px] font-bold uppercase tracking-wider">Frame</span>
        </button>
        <div className="w-px bg-slate-700 mx-1 my-2"></div>
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
};


// ==========================================
// 메인 앱 컴포넌트
// ==========================================
export default function TrussAssessment({ setCurrentMenu }) {
  // 글로벌 Context 및 상태 관리
  const dashboardCtx = useDashboard();
  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});
  
  const assessmentPageState = dashboardCtx?.assessmentPageState || {};
  const { 
    bdfFile = null, nodes = {}, elements = [], nodeTableData = [], elemTableData = [], 
    logs = [], detailedLogs = [], isRunning = false, progress = 0, statusMessage = '', 
    activeTab = '3d', currentJobId = null, resultJsonData = null, activeResultCase = null,
    projectData = null // 해석 완료 후 모달에 띄울 프로젝트 정보
  } = assessmentPageState;

  const updateState = (newState) => {
    if (dashboardCtx?.setAssessmentPageState) {
      dashboardCtx.setAssessmentPageState(prev => ({ ...(prev || {}), ...newState }));
    }
  };

  // [신규] 완료 시 엑셀 다운로드 창 팝업 제어용 로컬 상태
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // 컴포넌트 언마운트 시 폴링 인터벌 정리
  useEffect(() => {
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  const numNodes = Object.keys(nodes).length;
  const numMembers = elements.length;
  const isDataReady = numNodes > 0 && numMembers > 0;

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const parseNastranFloat = (str) => {
    if (!str || !str.trim()) return 0;
    let s = str.trim().toUpperCase();
    if (s.includes('E')) return parseFloat(s);
    s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
    return parseFloat(s) || 0;
  };

  const parseBDF = (text) => {
    const parsedNodes = {}; const parsedElements = [];
    const lines = text.split('\n');

    lines.forEach(line => {
      if (line.startsWith('GRID')) {
        const id = parseInt(line.substring(8, 16));
        const x = parseNastranFloat(line.substring(24, 32));
        const y = parseNastranFloat(line.substring(32, 40));
        const z = parseNastranFloat(line.substring(40, 48));
        if (!isNaN(id)) parsedNodes[id] = [x, y, z];
      } else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
        const n1 = parseInt(line.substring(24, 32));
        const n2 = parseInt(line.substring(32, 40));
        if (!isNaN(n1) && !isNaN(n2)) parsedElements.push([n1, n2]);
      }
    });

    const nTable = [["Node ID", "X", "Y", "Z"]];
    Object.keys(parsedNodes).slice(0, 100).forEach(key => nTable.push([key, ...parsedNodes[key].map(v => v.toFixed(2))]));

    const eTable = [["Element", "Start Node", "End Node"]];
    parsedElements.slice(0, 100).forEach((el, idx) => eTable.push([idx + 1, el[0], el[1]]));

    const time = new Date().toLocaleTimeString();
    const newLogs = [...logs, { time, message: `[DATA] BDF 파싱 완료. (Nodes: ${Object.keys(parsedNodes).length}, Elements: ${parsedElements.length})`, type: 'success' }];

    updateState({ 
      nodes: parsedNodes, elements: parsedElements, 
      nodeTableData: nTable, elemTableData: eTable, 
      logs: newLogs, activeTab: '3d' 
    });
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.bdf') && !file.name.toLowerCase().endsWith('.dat')) { 
        alert('BDF 또는 DAT 파일만 업로드 가능합니다!'); 
        return; 
    }
    
    const time = new Date().toLocaleTimeString();
    const newLogs = [...logs, { time, message: `[FILE] ${file.name} 업로드됨. 파싱 중...`, type: 'info' }];
    // 파일 업로드 시 이전 프로젝트 데이터 초기화
    updateState({ bdfFile: file, logs: newLogs, resultJsonData: null, activeResultCase: null, projectData: null });
    setIsResultModalOpen(false);

    const reader = new FileReader();
    reader.onload = (e) => parseBDF(e.target.result);
    reader.readAsText(file);
  };

  const runAnalysis = async () => {
    if (!bdfFile) return;
    
    updateState({ 
      isRunning: true, progress: 0, statusMessage: '서버 요청 중...', 
      logs: [], detailedLogs: [], resultJsonData: null, projectData: null 
    });
    setIsResultModalOpen(false);
    
    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    const formData = new FormData();
    formData.append('bdf_file', bdfFile);
    formData.append('employee_id', employeeId);
    formData.append('source', 'Workbench');

    try {
      const requestRes = await requestAssessment(formData);
      const jobId = requestRes.data.job_id;
      
      const time = new Date().toLocaleTimeString();
      let updatedLogs = [{ time, message: `[JOB] 해석 작업 큐 등록 완료. (Job ID: ${jobId})`, type: 'success' }];
      updateState({ logs: updatedLogs, currentJobId: jobId });

      startGlobalJob(jobId, 'Truss Structural Assessment');
      
      let lastMsg = '';
      let retryCount = 0;
      pollIntervalRef.current = setInterval(async () => {
        retryCount++;
        if (retryCount > 120) {
          clearInterval(pollIntervalRef.current);
          updateState({ isRunning: false, logs: [...updatedLogs, { time: new Date().toLocaleTimeString(), message: '해석 시간 초과 (3분). 서버 상태를 확인하세요.', type: 'error' }] });
          return;
        }
        try {
          const targetJobId = assessmentPageState.currentJobId || jobId;
          if (!targetJobId) { clearInterval(pollIntervalRef.current); return; }

          const statusRes = await getJobStatus(targetJobId);
          const { status, progress: jobProgress, message, engine_log, project } = statusRes.data;

          if (message !== lastMsg) {
             updatedLogs = [...updatedLogs, { time: new Date().toLocaleTimeString(), message: `[${jobProgress}%] ${message}`, type: 'warning' }];
             lastMsg = message;
          }

          updateState({ progress: jobProgress, statusMessage: message, logs: updatedLogs });

          if (status === 'Success' || status === 'Failed') {
            clearInterval(pollIntervalRef.current);
            updateState({ isRunning: false });
            
            if (status === 'Success') {
              let finalLogs = [...updatedLogs, { time: new Date().toLocaleTimeString(), message: '구조 평가 해석 완료.', type: 'success' }];
              updateState({ logs: finalLogs, projectData: project });
              
              // 자동 팝업 제거 — 사용자가 Assessment Results 탭에서 직접 확인
              
              if (engine_log) updateState({ detailedLogs: [...detailedLogs, `*** SOLVER OUTPUT ***\n${engine_log}`] });

              if (project?.result_info) {
                 const jsonFiles = Object.entries(project.result_info)
                   .filter(([key, path]) => typeof path === 'string' && path.toLowerCase().endsWith('.json'))
                   .map(([key, path]) => ({ key: key.replace(/^JSON_/i, ''), path }));

                 if (jsonFiles.length > 0) {
                    finalLogs = [...finalLogs, { time: new Date().toLocaleTimeString(), message: `JSON 결과 ${jsonFiles.length}건 수신. 파싱 중...`, type: 'info' }];
                    updateState({ logs: finalLogs, activeTab: 'result' });

                    try {
                        const parsedResultsMap = {};
                        await Promise.all(jsonFiles.map(async (fileInfo) => {
                            const res = await downloadFileBlob(fileInfo.path);
                            const text = await res.data.text();
                            parsedResultsMap[fileInfo.key] = JSON.parse(text);
                        }));

                        const caseNames = Object.keys(parsedResultsMap);
                        finalLogs = [...finalLogs, { time: new Date().toLocaleTimeString(), message: '결과 테이블 렌더링 완료.', type: 'success' }];
                        
                        updateState({ 
                            resultJsonData: parsedResultsMap, 
                            activeResultCase: caseNames[0],
                            logs: finalLogs 
                        });
                    } catch (e) {
                        console.error("JSON Fetch Error:", e);
                        updateState({ logs: [...finalLogs, { time: new Date().toLocaleTimeString(), message: 'JSON 파싱 오류 발생.', type: 'error' }] });
                    }
                 } else {
                    updateState({ logs: [...finalLogs, { time: new Date().toLocaleTimeString(), message: '[안내] 생성된 JSON 결과 파일이 없습니다.', type: 'warning' }] });
                 }
              }
            } else {
              updateState({ logs: [...updatedLogs, { time: new Date().toLocaleTimeString(), message: '해석 실패.', type: 'error' }] });
            }
          }
        } catch (pollError) {
          console.error("Polling Error:", pollError); clearInterval(pollIntervalRef.current); updateState({ isRunning: false });
        }
      }, 1500);

    } catch (error) {
      updateState({ isRunning: false, logs: [...logs, { time: new Date().toLocaleTimeString(), message: '서버 요청 실패.', type: 'error' }] });
    }
  };

  const downloadDetailedLog = () => {
    if (detailedLogs.length === 0) return alert('상세 로그가 없습니다.');
    const blob = new Blob([detailedLogs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Detailed_Log_${new Date().getTime()}.out`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentMenu('File-Based Apps')} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-[#002554] hover:bg-slate-50 transition-colors cursor-pointer"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-[#002554] tracking-tight flex items-center gap-3"><Layers className="text-blue-500"/> Truss Structural Assessment</h1>
            <p className="text-sm text-slate-500 mt-1">BDF 모델 파일을 업로드하여 구조적 건전성을 즉시 평가합니다.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* LEFT PANE - Input & Summary */}
        <div className="w-full lg:w-[400px] flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
              <Database size={16} className="text-blue-500"/> 1. Model Input (.bdf)
            </h3>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} 
              onDragOver={e => e.preventDefault()} 
              className={`relative p-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all ${bdfFile ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'}`}
            >
              <input type="file" accept=".bdf,.dat" className="hidden" ref={fileInputRef} onChange={(e) => handleFile(e.target.files[0])} />
              <div className="flex flex-col items-center gap-2 relative z-10 pointer-events-none">
                <div className={`p-3 rounded-full ${bdfFile ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{bdfFile ? <CheckCircle2 size={28} /> : <Upload size={28} />}</div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700">{bdfFile ? 'File Uploaded' : 'Drag & Drop BDF'}</h4>
                  <p className="text-xs text-slate-500 mt-1 truncate max-w-[250px]">{bdfFile ? bdfFile.name : 'Click to browse'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Box size={16} className="text-slate-500"/> 2. Model Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><GitMerge size={16} className="text-indigo-400" /> Parsed Nodes</div><span className="font-mono font-bold text-[#002554]">{numNodes.toLocaleString()} EA</span></div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><Layers size={16} className="text-cyan-400" /> Parsed Elements</div><span className="font-mono font-bold text-[#002554]">{numMembers.toLocaleString()} EA</span></div>
              <div className={`mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed text-sm font-bold ${isDataReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>{isDataReady ? <><CheckCircle2 size={18} /> Model Ready</> : <><AlertCircle size={18} /> Awaiting BDF Data</>}</div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100 border-dashed flex flex-col gap-3">
            {/* 해석 결과 저장 버튼 */}
            {projectData ? (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setIsResultModalOpen(true)}
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-amber-50 border-2 border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-500 hover:-translate-y-0.5 transition-all cursor-pointer shadow-sm"
                >
                  <FileOutput size={18} className="text-amber-500"/>
                  해석 결과 저장
                </button>
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                  클릭하면 해석 결과를 Excel 파일로 다운로드할 수 있습니다.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-slate-50 border-2 border-dashed border-slate-200 text-slate-300 select-none">
                  <FileOutput size={18}/>
                  해석 결과 저장
                </div>
                <p className="text-[10px] text-slate-300 text-center">해석 완료 후 활성화됩니다.</p>
              </div>
            )}

            {/* Run 버튼 */}
            <button
              onClick={runAnalysis}
              disabled={!isDataReady || isRunning}
              className={`relative w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-3 transition-all duration-300 shadow-lg overflow-hidden ${
                !isDataReady
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : isRunning
                    ? 'bg-[#001b3d] text-white cursor-wait'
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

        {/* RIGHT PANE - 3D View / Data / Result */}
        <div className="flex-1 flex flex-col gap-6 min-h-0">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-4 gap-2 shrink-0 z-10 overflow-x-auto custom-scrollbar">
              <TabButton active={activeTab === '3d'} onClick={() => updateState({activeTab: '3d'})} icon={Eye} label="3D Preview" />
              <TabButton active={activeTab === 'node'} onClick={() => updateState({activeTab: 'node'})} icon={Database} label="Input Nodes" />
              <TabButton active={activeTab === 'member'} onClick={() => updateState({activeTab: 'member'})} icon={Layers} label="Input Elements" />
              {resultJsonData && (
                 <TabButton active={activeTab === 'result'} onClick={() => updateState({activeTab: 'result'})} icon={FileText} label="Assessment Results" color="emerald" />
              )}
            </div>
            
            <div className="flex-1 relative bg-white overflow-hidden">
              {activeTab === '3d' && (isDataReady ? <EmbeddedBdfViewer nodes={nodes} elements={elements} /> : <EmptyState msg="BDF 업로드 시 3D 모델이 렌더링됩니다." Icon={Box}/>)}
              {activeTab === 'node' && (isDataReady ? <DataTable data={nodeTableData} title="Node coordinates preview" /> : <EmptyState msg="BDF 업로드 시 Node 데이터를 볼 수 있습니다." Icon={Database}/>)}
              {activeTab === 'member' && (isDataReady ? <DataTable data={elemTableData} title="Element connectivity preview" /> : <EmptyState msg="BDF 업로드 시 Element 데이터를 볼 수 있습니다." Icon={Layers}/>)}
              {activeTab === 'result' && resultJsonData && (
                <MultiJsonViewer 
                    resultsMap={resultJsonData} 
                    activeCase={activeResultCase} 
                    setActiveCase={(caseName) => updateState({ activeResultCase: caseName })} 
                />
              )}
            </div>
          </div>

          {/* Console */}
          <div className="h-48 bg-[#0F172A] rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2"><Terminal size={14} className="text-slate-400"/><span className="text-xs font-mono font-bold text-slate-300uppercase tracking-widest">Execution Console</span></div>
              {detailedLogs.length > 0 && <button onClick={downloadDetailedLog} className="text-xs text-blue-400 hover:text-blue-300 font-bold cursor-pointer flex items-center gap-1"><Download size={12}/> Download Output</button>}
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
      
      {/* [신규] 결과 파일(엑셀 등) 다운로드 팝업 모달 */}
      {isResultModalOpen && (
        <ProjectDetailModal 
            project={projectData} 
            onClose={() => setIsResultModalOpen(false)} 
        />
      )}
      
    </div>
  );
}

// ==========================================
// Helper Components
// ==========================================

function MultiJsonViewer({ resultsMap, activeCase, setActiveCase }) {
    const caseNames = useMemo(() => Object.keys(resultsMap), [resultsMap]);
    const currentData = resultsMap[activeCase];
    const isLoadCaseFormat = currentData?.loadCases !== undefined;

    return (
        <div className="flex flex-col h-full bg-white">
            {/* 파일이 여러 개일 때만 파일 탭 표시 */}
            {caseNames.length > 1 && (
                <div className="flex gap-2 p-3 border-b border-slate-100 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
                    {caseNames.map(name => (
                        <button
                            key={name} onClick={() => setActiveCase(name)}
                            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${activeCase === name ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'}`}
                        >
                            <Tag size={14} /> {name}
                        </button>
                    ))}
                </div>
            )}
            <div className="flex-1 relative overflow-hidden bg-white">
                {isLoadCaseFormat
                    ? <LoadCaseViewer data={currentData} />
                    : <DynamicJsonDataTable data={currentData} emptyMsg={`${activeCase}에 표시할 데이터가 없습니다.`} />
                }
            </div>
        </div>
    );
}

// ==========================================
// Load Case 전용 뷰어 (caseCount + loadCases 구조)
// ==========================================
function LoadCaseViewer({ data }) {
    // ── 모든 LC × 섹션 조합을 플랫 탭 목록으로 빌드 ──
    const tabs = useMemo(() => {
        if (!data?.loadCases) return [];
        const sections = [
            { key: 'summary',  label: 'Summary',    icon: Database, getData: lc => lc.summary           || [] },
            { key: 'elements', label: 'Elements',   icon: Layers,   getData: lc => lc.elementAssessment || [] },
            { key: 'panel',    label: 'Panel',      icon: GitMerge, getData: lc => lc.distributionPanel || [] },
            { key: 'support',  label: 'Support',    icon: Box,      getData: lc => lc.sideSupport        || [] },
        ];
        const result = [];
        data.loadCases.forEach((lc, lcIdx) => {
            sections.forEach(({ key, label, icon, getData }) => {
                const rows = getData(lc);
                if (rows.length === 0) return;
                const failCount = rows.filter(r => r.result && r.result !== 'OK').length;
                result.push({
                    id:        `${lcIdx}-${key}`,
                    lcIdx,
                    lcId:      lc.loadCaseIndex,
                    section:   key,
                    label:     `LC${lc.loadCaseIndex} ${label}`,
                    icon,
                    rows,
                    failCount,
                    isFirstOfLc: !result.some(t => t.lcIdx === lcIdx),
                });
            });
        });
        return result;
    }, [data]);

    const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');

    // data가 바뀌면 첫 탭으로 초기화
    useEffect(() => { if (tabs.length > 0) setActiveTabId(tabs[0].id); }, [data]);

    if (!tabs.length) return <EmptyState msg="Load Case 데이터가 없습니다." Icon={FileText} />;

    const activeTab  = tabs.find(t => t.id === activeTabId) ?? tabs[0];
    const activeLc   = data.loadCases[activeTab.lcIdx];
    const elemData   = activeLc?.elementAssessment || [];
    const panelData  = activeLc?.distributionPanel || [];
    const totalElem  = elemData.length;
    const failedElem = elemData.filter(r => r.result !== 'OK').length;
    const maxAssmt   = totalElem > 0 ? Math.max(...elemData.map(r => parseFloat(r.assessment) || 0)) : 0;
    const passRate   = totalElem > 0 ? (((totalElem - failedElem) / totalElem) * 100).toFixed(1) : '—';
    const panelFail  = panelData.filter(r => r.result !== 'OK').length;

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden bg-white">

            {/* ── 플랫 탭 바 (모든 LC × 섹션) ── */}
            <div className="flex gap-0.5 px-2 pt-2 bg-slate-50 border-b border-slate-200 shrink-0 overflow-x-auto custom-scrollbar">
                {tabs.map((tab, i) => {
                    const isActive  = tab.id === activeTabId;
                    const isFail    = tab.failCount > 0;
                    // LC 경계에 구분선 추가
                    const prevTab   = tabs[i - 1];
                    const showDivider = i > 0 && prevTab?.lcIdx !== tab.lcIdx;
                    return (
                        <React.Fragment key={tab.id}>
                            {showDivider && <div className="w-px bg-slate-300 mx-1 my-1.5 shrink-0" />}
                            <button
                                onClick={() => setActiveTabId(tab.id)}
                                className={`relative px-3 py-2 rounded-t-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                                    isActive
                                        ? isFail
                                            ? 'bg-white text-red-600 border border-b-white border-slate-200 shadow-sm -mb-px'
                                            : 'bg-white text-emerald-700 border border-b-white border-slate-200 shadow-sm -mb-px'
                                        : isFail
                                            ? 'text-red-500 hover:bg-red-50 border border-transparent'
                                            : 'text-slate-500 hover:bg-slate-200 border border-transparent'
                                }`}
                            >
                                <tab.icon size={11} className="shrink-0"/>
                                {tab.label}
                                {isFail && (
                                    <span className="inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black">
                                        {tab.failCount}
                                    </span>
                                )}
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* ── 통계 바 (활성 LC 기준) ── */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-100 shrink-0 flex-wrap">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1">LC {activeTab.lcId}</span>
                <StatBadge label="Members"     value={`${totalElem.toLocaleString()} ea`} color="blue" />
                <StatBadge label="Member FAIL" value={failedElem}  color={failedElem > 0 ? 'red' : 'green'} />
                <StatBadge label="Pass Rate"   value={`${passRate}%`} color={parseFloat(passRate) >= 100 ? 'green' : 'amber'} />
                <StatBadge label="Max Assess." value={maxAssmt.toFixed(2)} color={maxAssmt >= 1.0 ? 'red' : maxAssmt >= 0.8 ? 'amber' : 'green'} />
                {panelData.length > 0 && <>
                    <div className="w-px h-8 bg-slate-200 mx-1"/>
                    <StatBadge label="Panel" value={`${panelData.length} ea`} color="blue" />
                    <StatBadge label="Panel FAIL" value={panelFail} color={panelFail > 0 ? 'red' : 'green'} />
                </>}
                {(activeLc?.sideSupport || []).length > 0 && <>
                    <div className="w-px h-8 bg-slate-200 mx-1"/>
                    <StatBadge label="Side Support" value={`${activeLc.sideSupport.length} ea`} color="slate" />
                </>}
            </div>

            {/* ── 테이블 ── */}
            <div className="flex-1 relative overflow-hidden">
                <AssessmentTable key={activeTab.id} data={activeTab.rows} />
            </div>
        </div>
    );
}

function StatBadge({ label, value, color }) {
    const palette = {
        blue:  'bg-blue-50  text-blue-700  border-blue-200',
        green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        red:   'bg-red-50   text-red-700   border-red-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        slate: 'bg-slate-50 text-slate-600 border-slate-200',
    };
    return (
        <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg border min-w-[72px] ${palette[color] || palette.slate}`}>
            <span className="text-[9px] font-bold uppercase tracking-wider opacity-60 whitespace-nowrap">{label}</span>
            <span className="text-sm font-black font-mono">{value}</span>
        </div>
    );
}

function AssessmentTable({ data }) {
    const [sortConfig, setSortConfig] = useState(null);

    if (!data || data.length === 0) return <EmptyState msg="데이터가 없습니다." Icon={FileText} />;

    const headers = Object.keys(data[0]);

    const sortedData = sortConfig
        ? [...data].sort((a, b) => {
            const an = parseFloat(a[sortConfig.key]);
            const bn = parseFloat(b[sortConfig.key]);
            if (!isNaN(an) && !isNaN(bn)) return sortConfig.dir === 'asc' ? an - bn : bn - an;
            return sortConfig.dir === 'asc'
                ? String(a[sortConfig.key]).localeCompare(String(b[sortConfig.key]))
                : String(b[sortConfig.key]).localeCompare(String(a[sortConfig.key]));
        })
        : data;

    const handleSort = (col) => {
        setSortConfig(prev =>
            prev?.key === col
                ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { key: col, dir: 'asc' }
        );
    };

    const formatCell = (header, val) => {
        if (val === null || val === undefined) return '—';
        if (header === 'result') return val;
        const num = parseFloat(val);
        if (!isNaN(num)) {
            if (['element','set','property','leg','support','loadCaseIndex'].includes(header)) return String(Math.round(num));
            return num.toFixed(2);
        }
        return String(val);
    };

    const getCellClass = (header, val, row) => {
        if (header === 'assessment') {
            const n = parseFloat(val);
            if (n >= 1.0) return 'text-red-600 font-bold';
            if (n >= 0.8) return 'text-amber-600 font-bold';
            return 'text-slate-700';
        }
        // Distribution Panel: reactionForce를 선택된 패널 허용값과 비교
        if (header === 'reactionForce' && row) {
            const rf = parseFloat(val) || 0;
            const panelType = row.panel || '';
            const allowKey = panelType === 'BF-02' ? 'allowBF02'
                           : panelType === 'BF-06' ? 'allowBF06'
                           : 'allowBF03';
            const allow = parseFloat(row[allowKey]) || Infinity;
            const ratio = rf / allow;
            if (ratio >= 1.0) return 'text-red-600 font-bold';
            if (ratio >= 0.8) return 'text-amber-600 font-bold';
        }
        return 'text-slate-700';
    };

    // 컬럼 배경: assessment 열에 gradient-bar 느낌을 위해 별도 처리
    const getColHeader = (h) => {
        const map = {
            // 트러스 부재
            element: 'Element', set: 'Set', property: 'Property',
            axial: 'Axial', bending: 'Bending',
            allowAxial: 'Allow Axial', allowBending: 'Allow Bending',
            assessment: 'Assessment', result: 'Result',
            // Distribution Panel
            leg: 'Leg', condition: 'Condition',
            reactionForce: 'Reaction Force',
            allowBF03: 'Allow BF-03', allowBF02: 'Allow BF-02', allowBF06: 'Allow BF-06',
            panel: 'Panel Type',
            // Side Support
            support: 'Support Node', reaction: 'Reaction',
            // 공통
            loadCaseId: 'LC',
        };
        return map[h] || h;
    };

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="px-4 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-emerald-700">
                    {sortedData.length.toLocaleString()}개 항목
                </span>
                {sortConfig && (
                    <button onClick={() => setSortConfig(null)} className="text-[11px] text-slate-400 hover:text-red-500 cursor-pointer flex items-center gap-1">
                        <RotateCcw size={10}/> 정렬 초기화
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left text-sm font-mono whitespace-nowrap">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                        <tr>
                            <th className="px-3 py-3 text-slate-400 font-bold text-xs border-b border-emerald-200 w-10 text-center">#</th>
                            {headers.map((h) => (
                                <th
                                    key={h}
                                    onClick={() => handleSort(h)}
                                    className={`px-4 py-3 font-bold uppercase tracking-wider text-xs border-b border-emerald-200 cursor-pointer hover:bg-emerald-100 select-none ${
                                        h === 'result' ? 'text-center text-emerald-800' : 'text-emerald-800'
                                    }`}
                                >
                                    <span className="flex items-center gap-1">
                                        {getColHeader(h)}
                                        {sortConfig?.key === h
                                            ? (sortConfig.dir === 'asc' ? ' ↑' : ' ↓')
                                            : <span className="text-slate-300 text-[10px]">⇅</span>}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                        {sortedData.map((row, i) => {
                            const isFail = row.result !== 'OK';
                            return (
                                <tr key={i} className={`hover:bg-emerald-50/60 transition-colors ${isFail ? 'bg-red-50/40' : ''}`}>
                                    <td className="px-3 py-2 text-slate-400 text-xs text-center">{i + 1}</td>
                                    {headers.map((h) => (
                                        <td key={h} className={`px-4 py-2 ${getCellClass(h, row[h], row)}`}>
                                            {h === 'result' ? (
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-black ${
                                                    row[h] === 'OK'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {row[h] === 'OK' ? <CheckCircle2 size={10} className="mr-1"/> : <AlertCircle size={10} className="mr-1"/>}
                                                    {row[h]}
                                                </span>
                                            ) : formatCell(h, row[h])}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// [핵심 개선] Object 형태의 JSON을 인식하여 스마트하게 배열로 펼치는 로직 + 정렬/포맷팅 강화
function DynamicJsonDataTable({ data, emptyMsg }) {
    const [sortConfig, setSortConfig] = useState(null);

    if (!data) return <EmptyState msg={emptyMsg} Icon={FileText} />;

    let tableData = [];
    if (Array.isArray(data)) {
        tableData = data;
    } else if (typeof data === 'object') {
        const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
        if (arrayKey) {
            tableData = data[arrayKey];
        } else {
            tableData = Object.entries(data).map(([key, value]) => ({
                Key: key,
                Value: typeof value === 'object' ? JSON.stringify(value) : String(value)
            }));
        }
    }

    if (tableData.length === 0) return <EmptyState msg={emptyMsg} Icon={FileText} />;

    const headers = Object.keys(tableData[0]);

    // 컬럼 클릭 정렬
    const handleSort = (col) => {
        setSortConfig(prev =>
            prev?.key === col
                ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { key: col, dir: 'asc' }
        );
    };

    const sortedData = sortConfig
        ? [...tableData].sort((a, b) => {
            const aNum = parseFloat(a[sortConfig.key]);
            const bNum = parseFloat(b[sortConfig.key]);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return sortConfig.dir === 'asc' ? aNum - bNum : bNum - aNum;
            }
            return sortConfig.dir === 'asc'
                ? String(a[sortConfig.key]).localeCompare(String(b[sortConfig.key]))
                : String(b[sortConfig.key]).localeCompare(String(a[sortConfig.key]));
        })
        : tableData;

    // 숫자 포맷팅: 정수는 그대로, 소수는 소수점 4자리
    const formatCell = (val) => {
        if (val === null || val === undefined) return '-';
        if (typeof val === 'object') return JSON.stringify(val);
        const num = parseFloat(val);
        if (!isNaN(num) && String(val).trim() !== '') {
            return Number.isInteger(num) ? String(num) : num.toFixed(2);
        }
        return String(val);
    };

    // Ratio / Utilization / DCR 계열 컬럼에서 1.0 이상이면 빨간색 강조
    const isHighValue = (header, val) => {
        const lh = header.toLowerCase();
        if (lh.includes('ratio') || lh.includes('util') || lh.includes('dcr') || lh.includes('ur')) {
            const num = parseFloat(val);
            return !isNaN(num) && num >= 1.0;
        }
        return false;
    };

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden bg-white">
            {/* 상단 요약 바 */}
            <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-emerald-700">
                    전체 <span className="text-emerald-900">{sortedData.length.toLocaleString()}</span>개 항목
                    {' · '}
                    <span className="text-emerald-600">{headers.length}개 컬럼</span>
                </span>
                {sortConfig && (
                    <button
                        onClick={() => setSortConfig(null)}
                        className="text-xs text-slate-400 hover:text-red-500 cursor-pointer flex items-center gap-1"
                    >
                        <RotateCcw size={11}/> 정렬 초기화
                    </button>
                )}
            </div>

            {/* 테이블 */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left text-sm font-mono whitespace-nowrap">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 text-slate-400 font-bold text-xs border-b border-emerald-200 w-12 text-center">#</th>
                            {headers.map((h, i) => (
                                <th
                                    key={i}
                                    onClick={() => handleSort(h)}
                                    className="px-5 py-3 text-emerald-800 font-bold uppercase tracking-wider text-xs border-b border-emerald-200 cursor-pointer hover:bg-emerald-100 select-none"
                                >
                                    <span className="flex items-center gap-1">
                                        {h}
                                        {sortConfig?.key === h
                                            ? (sortConfig.dir === 'asc' ? ' ↑' : ' ↓')
                                            : <span className="text-slate-300 text-[10px]">⇅</span>
                                        }
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                        {sortedData.map((row, i) => (
                            <tr key={i} className="hover:bg-emerald-50/60 transition-colors">
                                <td className="px-4 py-2 text-slate-400 text-xs text-center">{i + 1}</td>
                                {headers.map((h, j) => (
                                    <td
                                        key={j}
                                        className={`px-5 py-2 ${
                                            isHighValue(h, row[h])
                                                ? 'text-red-600 font-bold bg-red-50'
                                                : 'text-slate-700'
                                        }`}
                                    >
                                        {formatCell(row[h])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const ProjectDetailModal = ({ project, onClose }) => {
  if (!project) return null;

  const [downloading, setDownloading] = useState({});

  // JSON → XLSX 변환 다운로드 (서버 메모리에서 생성 → DRM 미적용)
  const handleXlsxDownload = async (jsonPath, label) => {
    setDownloading(prev => ({ ...prev, [label]: true }));
    try {
      const response = await exportAssessmentXlsx(jsonPath);
      const baseName = jsonPath.split('\\').pop().split('/').pop().replace(/\.json$/i, '');
      const filename  = `${baseName}_Results.xlsx`;
      const blobUrl   = window.URL.createObjectURL(new Blob([response.data]));
      const link      = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Excel export failed:', error);
      alert('Excel 파일 생성에 실패했습니다.');
    } finally {
      setDownloading(prev => ({ ...prev, [label]: false }));
    }
  };

  const jsonFiles = project.result_info
    ? Object.entries(project.result_info).filter(([k]) => k.startsWith('JSON_'))
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">

        {/* 헤더 */}
        <div className="bg-[#002554] p-5 text-white flex justify-between items-start shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="text-emerald-400"/> 해석 완료 및 파일 다운로드
            </h2>
            <p className="text-blue-200 text-xs mt-1 font-mono">Job ID: {project.id}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors cursor-pointer">
            <X size={20}/>
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto">
          {jsonFiles.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-4">
                아래 버튼을 클릭하면 JSON 결과를 기반으로 Excel 파일을 생성하여 다운로드합니다.<br/>
                <span className="text-slate-400">시트 구성: Load Case별 Summary / Element Assessment / Distribution Panel / Side Support</span>
              </p>
              {jsonFiles.map(([key, jsonPath]) => {
                const label     = key.replace(/^JSON_/i, '');
                const isLoading = downloading[label];
                return (
                  <button
                    key={key}
                    onClick={() => handleXlsxDownload(jsonPath, label)}
                    disabled={isLoading}
                    className={`w-full flex items-center justify-between p-4 border-2 rounded-xl transition-all group cursor-pointer ${
                      isLoading
                        ? 'border-emerald-300 bg-emerald-50 cursor-wait'
                        : 'border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl transition-colors ${
                        isLoading
                          ? 'bg-emerald-200 text-emerald-700'
                          : 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white'
                      }`}>
                        {isLoading
                          ? <RefreshCw size={20} className="animate-spin"/>
                          : <FileOutput size={20}/>
                        }
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-700">{label}.xlsx</p>
                        <p className="text-[10px] text-slate-400">
                          {isLoading ? 'DRM 문제로 XLSX 파일 직접 생성 중..' : '클릭하여 Excel 다운로드'}
                        </p>
                      </div>
                    </div>
                    <Download size={18} className={`transition-colors ${isLoading ? 'text-emerald-400' : 'text-slate-300 group-hover:text-emerald-600'}`}/>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">결과 파일이 없습니다.</div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end shrink-0">
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold bg-[#002554] text-white hover:bg-[#003366] rounded-lg transition-colors cursor-pointer">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

function TabButton({ active, onClick, icon: Icon, label, color }) {
  const activeColor = color === 'emerald' ? 'text-emerald-700 border-t-emerald-600 bg-emerald-50/30' : 'text-[#002554] border-t-[#002554]';
  return (
    <button onClick={onClick} className={`px-4 py-2.5 rounded-t-lg font-bold text-sm flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap ${active ? `bg-white ${activeColor} border-t-2 border-x border-slate-200` : 'text-slate-500 hover:bg-slate-200 border-t-2 border-transparent border-x border-transparent'}`}>
      <Icon size={16} /> {label}
    </button>
  );
}

function EmptyState({ msg, Icon }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-white">
      <Icon size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-bold text-center px-10 leading-relaxed">{msg}</p>
    </div>
  );
}

function DataTable({ data, title }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-auto custom-scrollbar bg-white">
      <table className="w-full text-left text-sm font-mono whitespace-nowrap bg-white">
        <thead className="sticky top-0 bg-slate-50 shadow-sm z-10">
          <tr>{data[0].map((h, i) => <th key={i} className="px-6 py-3 text-slate-600 font-bold uppercase tracking-wider text-xs border-b">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.slice(1).map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {row.map((cell, j) => <td key={j} className="px-6 py-2 text-slate-700">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-2 text-center text-[11px] text-slate-400 bg-slate-50 border-t border-slate-100 sticky bottom-0 z-10">
        {title} | 성능을 위해 상위 100개 항목만 표시합니다.
      </div>
    </div>
  );
}