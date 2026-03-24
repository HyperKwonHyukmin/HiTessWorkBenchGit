/// <summary>
/// 해석 결과(BDF) 3D 뷰어 컴포넌트입니다.
/// (개선) InstancedMesh를 통한 노드 렌더링 최적화, UI 토글 기능, 와이어프레임 뷰, 카메라 리셋, 자동 회전 등 
/// 상용 CAD 수준의 UX 및 그래픽 파이프라인 최적화를 적용했습니다.
/// </summary>
import React, { useState, useEffect, useRef, Fragment } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Dialog, Transition } from '@headlessui/react';
import {
  X, Box, RefreshCw, Eye, EyeOff,
  Hexagon, LayoutGrid, RotateCcw, PlayCircle, PauseCircle
} from 'lucide-react';
import { downloadFileText } from '../../api/analysis';

export default function BdfViewerModal({ isOpen, project, onClose }) {
  const mountRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [elementCount, setElementCount] = useState(0);

  // ---------------------------------------------------------
  // [신규] UX 상태 관리 및 Three.js 객체 참조 Ref
  // ---------------------------------------------------------
  const [showNodes, setShowNodes] = useState(true);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  // Three.js 핵심 객체들을 리렌더링 없이 조작하기 위해 useRef로 보관
  const controlsRef = useRef(null);
  const nodesMeshRef = useRef(null);
  const elementsGroupRef = useRef(null);

  // ==========================================
  // 1. 초기 3D 모델 렌더링 및 BDF 파싱 (1회 실행)
  // ==========================================
  useEffect(() => {
    if (!isOpen || !project || !project.result_info || !project.result_info.bdf) return;
    
    let renderer, scene, camera, controls;
    let animationId;

    const initViewer = async () => {
      setLoading(true);
      try {
        // 1. BDF 파일 로드
        const response = await downloadFileText(project.result_info.bdf);
        const bdfText = response.data;

        // 2. BDF 파싱
        const nodes = {};
        const elements = [];
        const lines = bdfText.split('\n');

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
              nodes[parseInt(p[1])] = [parseFloat(p[3]), parseFloat(p[4]), parseFloat(p[5])];
            } else {
              const id = parseInt(line.substring(8, 16));
              const x = parseNastranFloat(line.substring(24, 32));
              const y = parseNastranFloat(line.substring(32, 40));
              const z = parseNastranFloat(line.substring(40, 48));
              if (!isNaN(id)) nodes[id] = [x, y, z];
            }
          } else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
            if (line.includes(',')) {
              const p = line.split(',');
              elements.push([parseInt(p[3]), parseInt(p[4])]); 
            } else {
              const n1 = parseInt(line.substring(24, 32));
              const n2 = parseInt(line.substring(32, 40));
              if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2]);
            }
          }
        });

        const nKeys = Object.keys(nodes);
        setNodeCount(nKeys.length);
        setElementCount(elements.length);

        // 3. Three.js Scene Setup
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
        controlsRef.current = controls; // Ref에 저장

        // 조명 셋팅
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(1, 1, 2);
        scene.add(dirLight);

        // 4. 모델 구축
        const modelGroup = new THREE.Group();
        elementsGroupRef.current = new THREE.Group(); // 부재들만 담을 그룹
        modelGroup.add(elementsGroupRef.current);

        // 사이즈 계산
        const tempBox = new THREE.Box3();
        Object.values(nodes).forEach(pos => tempBox.expandByPoint(new THREE.Vector3(...pos)));
        const size = new THREE.Vector3();
        tempBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1000;
        
        const rodRadius = maxDim * 0.0015; 

        // -----------------------------------------------------
        // ✅ [핵심 개선 1] InstancedMesh를 이용한 초고속 구형 노드 생성
        // -----------------------------------------------------
        if (nKeys.length > 0) {
          const sphereGeo = new THREE.SphereGeometry(rodRadius * 1.8, 16, 16);
          const sphereMat = new THREE.MeshStandardMaterial({ 
            color: 0xFF3333, 
            roughness: 0.3,
            metalness: 0.2
          });
          
          // 단 한 번의 Draw Call로 모든 구형 노드를 렌더링
          const instancedNodes = new THREE.InstancedMesh(sphereGeo, sphereMat, nKeys.length);
          const dummyObject = new THREE.Object3D();

          nKeys.forEach((key, index) => {
            const [x, y, z] = nodes[key];
            dummyObject.position.set(x, y, z);
            dummyObject.updateMatrix();
            instancedNodes.setMatrixAt(index, dummyObject.matrix);
          });

          instancedNodes.instanceMatrix.needsUpdate = true;
          modelGroup.add(instancedNodes);
          nodesMeshRef.current = instancedNodes; // Ref에 저장하여 빠른 On/Off 지원
        }

        // 4-3. Elements (실린더)
        const cylinderGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
        cylinderGeo.rotateX(Math.PI / 2); 
        const cylinderMat = new THREE.MeshStandardMaterial({ 
          color: 0x3b82f6, 
          roughness: 0.3, 
          metalness: 0.7 
        });

        elements.forEach(([n1, n2]) => {
          if (nodes[n1] && nodes[n2]) {
            const p1 = new THREE.Vector3(...nodes[n1]);
            const p2 = new THREE.Vector3(...nodes[n2]);
            const distance = p1.distanceTo(p2);
            
            const mesh = new THREE.Mesh(cylinderGeo, cylinderMat);
            mesh.position.copy(p1).lerp(p2, 0.5);
            mesh.scale.set(1, 1, distance);
            mesh.lookAt(p2);
            
            elementsGroupRef.current.add(mesh);
          }
        });

        scene.add(modelGroup);

        // 5. Bounding Box & Auto-Fit Camera 계산
        const box = new THREE.Box3().setFromObject(modelGroup);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
        controls.target.copy(center);
        camera.lookAt(center);
        controls.saveState(); // ✅ 카메라 초기 상태 저장 (리셋 기능을 위함)

        // 6. Animation Loop
        const animate = () => {
          animationId = requestAnimationFrame(animate);
          controls.update();
          dirLight.position.copy(camera.position);
          renderer.render(scene, camera);
        };
        animate();
        
      } catch (err) {
        console.error("Three.js Viewer Error:", err);
      } finally {
        setLoading(false);
      }
    };

    // 상태 초기화
    setShowNodes(true);
    setIsWireframe(false);
    setAutoRotate(false);
    initViewer();

    // Cleanup
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (scene) {
        scene.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(mat => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        });
      }
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss(); 
      }
      if (mountRef.current && renderer && renderer.domElement) {
        try { mountRef.current.removeChild(renderer.domElement); } catch(e) {}
      }
      controlsRef.current = null;
      nodesMeshRef.current = null;
      elementsGroupRef.current = null;
    };
  }, [isOpen, project]);

  // ==========================================
  // 2. 가벼운 UX 상태 변경 처리 (리렌더링 없음)
  // ==========================================
  
  // 노드 보이기/숨기기 즉각 반응
  useEffect(() => {
    if (nodesMeshRef.current) {
      nodesMeshRef.current.visible = showNodes;
    }
  }, [showNodes]);

  // 와이어프레임 모드 즉각 반응
  useEffect(() => {
    if (elementsGroupRef.current) {
      elementsGroupRef.current.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = isWireframe;
        }
      });
    }
  }, [isWireframe]);

  // 자동 회전 토글
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0; // 회전 속도 조절
    }
  }, [autoRotate]);

  // 카메라 뷰 초기화 함수
  const resetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <Dialog.Panel className="w-full h-full bg-slate-900 rounded-2xl flex flex-col border border-slate-700 overflow-hidden shadow-2xl relative">
            
            {/* 상단 툴바 UI */}
            <div className="absolute top-4 left-6 z-10 pointer-events-none flex flex-col gap-1">
               <h3 className="text-[#00E600] font-bold tracking-widest text-xl drop-shadow-md flex items-center gap-2">
                 <Box size={24} className="text-white"/> BDF 3D Viewer
               </h3>
               <p className="text-slate-300 text-xs font-mono bg-black/50 px-2 py-1 rounded w-fit mt-1">
                 Total Nodes: {nodeCount} | Total Members: {elementCount}
               </p>
            </div>

            <button onClick={onClose} className="absolute top-4 right-6 z-10 text-white hover:text-red-400 cursor-pointer bg-black/50 p-2 rounded-full transition-colors"><X size={24} /></button>

            {/* ✅ [핵심 개선 3] 화면 중앙 하단 플로팅 UX 컨트롤 패널 */}
            {!loading && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
                {/* 노드 켜기/끄기 */}
                <button 
                  onClick={() => setShowNodes(!showNodes)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                  title="노드 표시 전환"
                >
                  {showNodes ? <Eye size={20} className="mb-1" /> : <EyeOff size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Nodes</span>
                </button>

                {/* 솔리드/와이어프레임 전환 */}
                <button 
                  onClick={() => setIsWireframe(!isWireframe)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${isWireframe ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                  title="와이어프레임 보기 전환"
                >
                  {isWireframe ? <LayoutGrid size={20} className="mb-1" /> : <Hexagon size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Frame</span>
                </button>

                <div className="w-px bg-slate-700 mx-1 my-2"></div>

                {/* 자동 회전(턴테이블) 토글 */}
                <button 
                  onClick={() => setAutoRotate(!autoRotate)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                  title="자동 회전 (Turn-table)"
                >
                  {autoRotate ? <PauseCircle size={20} className="mb-1" /> : <PlayCircle size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Rotate</span>
                </button>

                {/* 카메라 뷰 리셋 */}
                <button 
                  onClick={resetCamera}
                  className="flex flex-col items-center justify-center w-16 h-14 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer"
                  title="초기 뷰로 되돌리기"
                >
                  <RotateCcw size={20} className="mb-1" />
                  <span className="text-[9px] font-bold uppercase tracking-wider">Reset</span>
                </button>
              </div>
            )}

            {/* 우측 하단: 마우스 컨트롤 안내 */}
            <div className="absolute bottom-6 right-6 z-10 bg-slate-900/80 backdrop-blur-md p-3 rounded-xl border border-slate-700 pointer-events-none text-right shadow-lg">
              <h4 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest border-b border-slate-700 pb-1">Mouse Controls</h4>
              <p className="text-[11px] text-slate-200 mb-1">Left Click & Drag : <span className="text-blue-400 font-bold">Rotate</span></p>
              <p className="text-[11px] text-slate-200 mb-1">Right Click & Drag : <span className="text-emerald-400 font-bold">Pan</span></p>
              <p className="text-[11px] text-slate-200">Mouse Wheel : <span className="text-yellow-400 font-bold">Zoom</span></p>
            </div>

            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-[#00E600] font-mono bg-slate-900/80 backdrop-blur-sm">
                <RefreshCw size={48} className="animate-spin mb-4" />
                Parsing BDF and Generating 3D Solid Model...
              </div>
            )}
            
            {/* 3D 렌더링 캔버스 */}
            <div ref={mountRef} className="w-full h-full cursor-move" />
            
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}