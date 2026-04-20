/// <summary>
/// 해석 결과(BDF) 3D 뷰어 컴포넌트입니다.
/// (수정) C# 엔진의 자리수 초과(Column Overflow), Double 포맷(D) 변환 오류 등을 방어하는 Robust BDF 파서를 적용했습니다.
/// </summary>
import React, { useState, useEffect, useRef, Fragment } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
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

  const [showNodes, setShowNodes] = useState(true);
  const [isWireframe, setIsWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const controlsRef      = useRef(null);
  const nodesMeshRef     = useRef(null);
  const elementsGroupRef = useRef(null);
  const threeCleanupRef  = useRef(null);

  // ==========================================
  // 1. 초기 3D 모델 렌더링 및 BDF 파싱
  // ==========================================
  useEffect(() => {
    if (!isOpen || !project || !project.result_info || !project.result_info.bdf) return;
    
    let renderer, scene, camera, controls;
    let animationId;

    const initViewer = async () => {
      setLoading(true);
      try {
        const response = await downloadFileText(project.result_info.bdf);
        const bdfText = response.data;

        // 2. BDF 파싱 (Robust Parser)
        const nodes = {};
        const elements = [];
        const lines = bdfText.split(/\r?\n/); // Windows/Unix 개행 모두 호환

        // (개선) Nastran 부동소수점 파서: 쉼표 제거, D(Double) 포맷 지원
        const parseNastranFloat = (str) => {
          if (!str || !str.trim()) return 0;
          let s = str.trim().toUpperCase().replace(/,/g, '').replace('D', 'E');
          if (s.includes('E')) {
             const val = parseFloat(s);
             return isNaN(val) ? 0 : val;
          }
          s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
          const val = parseFloat(s);
          return isNaN(val) ? 0 : val;
        };

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trimEnd();
          if (!line || line.startsWith('$')) continue;

          // [노드 파싱]
          if (line.startsWith('GRID')) {
             const isCsv = line.includes(',') && line.split(',').length > 3;

             if (isCsv) {
                const p = line.split(',');
                const id = parseInt(p[1]);
                if (!isNaN(id)) {
                   nodes[id] = [parseNastranFloat(p[3]), parseNastranFloat(p[4]), parseNastranFloat(p[5])];
                }
             } else if (line.startsWith('GRID*')) {
                // Large Format (16자리)
                const paddedLine = line.padEnd(72, ' ');
                const id = parseInt(paddedLine.substring(8, 24));
                const x = parseNastranFloat(paddedLine.substring(40, 56));
                const y = parseNastranFloat(paddedLine.substring(56, 72));
                
                let z = 0;
                let nextLine = lines[i+1] ? lines[i+1].trimEnd() : "";
                if (nextLine.startsWith('*')) {
                   z = parseNastranFloat(nextLine.padEnd(24, ' ').substring(8, 24));
                   i++; // 다음 줄(Continuation) 건너뛰기
                }
                if (!isNaN(id)) nodes[id] = [x, y, z];
             } else {
                // Standard Format (8자리)
                const paddedLine = line.padEnd(48, ' ');
                let id = parseInt(paddedLine.substring(8, 16));
                let x = parseNastranFloat(paddedLine.substring(24, 32));
                let y = parseNastranFloat(paddedLine.substring(32, 40));
                let z = parseNastranFloat(paddedLine.substring(40, 48));

                // [핵심] C# 엔진의 자리수 오버플로우 발생 시 공백 기준 스플릿으로 자동 복구 (Smart Fallback)
                if (isNaN(id) || isNaN(x) || isNaN(y) || isNaN(z)) {
                    const tokens = line.trim().split(/\s+/);
                    if (tokens.length >= 5 && tokens[0] === 'GRID') {
                        id = parseInt(tokens[1]);
                        z = parseNastranFloat(tokens[tokens.length - 1]);
                        y = parseNastranFloat(tokens[tokens.length - 2]);
                        x = parseNastranFloat(tokens[tokens.length - 3]);
                    }
                }
                
                if (!isNaN(id)) nodes[id] = [x, y, z];
             }
          } 
          // [요소 파싱]
          else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
             const isCsv = line.includes(',') && line.split(',').length > 3;
             
             if (isCsv) {
                const p = line.split(',');
                const n1 = parseInt(p[3]);
                const n2 = parseInt(p[4]);
                if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2]);
             } else if (line.startsWith('CROD*') || line.startsWith('CBAR*') || line.startsWith('CBEAM*')) {
                const paddedLine = line.padEnd(72, ' ');
                const n1 = parseInt(paddedLine.substring(40, 56));
                const n2 = parseInt(paddedLine.substring(56, 72));
                if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2]);
             } else {
                const paddedLine = line.padEnd(40, ' ');
                let n1 = parseInt(paddedLine.substring(24, 32));
                let n2 = parseInt(paddedLine.substring(32, 40));

                // Smart Fallback
                if (isNaN(n1) || isNaN(n2)) {
                    const tokens = line.trim().split(/\s+/);
                    if (tokens.length >= 5) {
                        n1 = parseInt(tokens[3]);
                        n2 = parseInt(tokens[4]);
                    }
                }
                
                if (!isNaN(n1) && !isNaN(n2)) elements.push([n1, n2]);
             }
          }
        }

        const nKeys = Object.keys(nodes);
        setNodeCount(nKeys.length);
        setElementCount(elements.length);

        // 3. Three.js Scene Setup
        const threeSetup = createThreeScene(mountRef.current, { zUp: true });
        scene    = threeSetup.scene;
        camera   = threeSetup.camera;
        renderer = threeSetup.renderer;
        controls = threeSetup.controls;
        controlsRef.current   = controls;
        threeCleanupRef.current = threeSetup.cleanup;

        // 4. 모델 구축
        const modelGroup = new THREE.Group();
        elementsGroupRef.current = new THREE.Group();
        modelGroup.add(elementsGroupRef.current);

        const tempBox = new THREE.Box3();
        Object.values(nodes).forEach(pos => tempBox.expandByPoint(new THREE.Vector3(...pos)));
        const tempSize = new THREE.Vector3();
        tempBox.getSize(tempSize);
        const maxDim = Math.max(tempSize.x, tempSize.y, tempSize.z) || 1000;

        const rodRadius = maxDim * 0.0015;

        if (nKeys.length > 0) {
          const sphereGeo = new THREE.SphereGeometry(rodRadius * 1.8, 12, 12);
          const sphereMat = new THREE.MeshStandardMaterial({
            color: 0xffa040,
            metalness: 0.9,
            roughness: 0.1,
            emissive: 0xcc4400,
            emissiveIntensity: 0.6,
          });
          
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
          nodesMeshRef.current = instancedNodes;
        }

        const cylinderGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
        cylinderGeo.rotateX(Math.PI / 2);
        const cylinderMat = new THREE.MeshStandardMaterial({
          color: 0x66ccff,
          metalness: 0.85,
          roughness: 0.15,
          emissive: 0x0044aa,
          emissiveIntensity: 0.35,
        });

        elements.forEach(([n1, n2]) => {
          if (nodes[n1] && nodes[n2]) {
            const p1 = new THREE.Vector3(...nodes[n1]);
            const p2 = new THREE.Vector3(...nodes[n2]);
            const distanceLine = p1.distanceTo(p2);
            
            const mesh = new THREE.Mesh(cylinderGeo, cylinderMat);
            mesh.position.copy(p1).lerp(p2, 0.5);
            mesh.scale.set(1, 1, distanceLine);
            mesh.lookAt(p2);
            
            elementsGroupRef.current.add(mesh);
          }
        });

        scene.add(modelGroup);

        // 5. Bounding Box & 동적 Auto-Fit Camera 계산
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const actualMaxDim = Math.max(size.x, size.y, size.z) || 1000;
        const fovInRadians = (camera.fov * Math.PI) / 180;
        const cameraDistance = Math.abs(actualMaxDim / Math.sin(fovInRadians / 2)) * 1.5;

        camera.near = actualMaxDim / 10000;
        camera.far = cameraDistance * 100;
        camera.updateProjectionMatrix();
        
        camera.position.set(
          center.x + cameraDistance * 0.7, 
          center.y - cameraDistance * 0.7, 
          center.z + cameraDistance * 0.7
        );
        
        controls.target.copy(center);
        controls.maxDistance = cameraDistance * 10;
        camera.lookAt(center);
        controls.saveState();

        // 6. Animation Loop
        const modelCenter = new THREE.Vector3();
        new THREE.Box3().setFromObject(modelGroup).getCenter(modelCenter);
        threeSetup.startAnimate(modelCenter, maxDim);
        
      } catch (err) {
        console.error("Three.js Viewer Error:", err);
      } finally {
        setLoading(false);
      }
    };

    setShowNodes(true);
    setIsWireframe(false);
    setAutoRotate(false);
    initViewer();

    return () => {
      threeCleanupRef.current?.();
      threeCleanupRef.current  = null;
      controlsRef.current      = null;
      nodesMeshRef.current     = null;
      elementsGroupRef.current = null;
    };
  }, [isOpen, project]);
  
  useEffect(() => {
    if (nodesMeshRef.current) {
      nodesMeshRef.current.visible = showNodes;
    }
  }, [showNodes]);

  useEffect(() => {
    if (elementsGroupRef.current) {
      elementsGroupRef.current.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = isWireframe;
        }
      });
    }
  }, [isWireframe]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 2.0; 
    }
  }, [autoRotate]);

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
            
            <div className="absolute top-4 left-6 z-10 pointer-events-none flex flex-col gap-1">
               <h3 className="text-brand-accent font-bold tracking-widest text-xl drop-shadow-md flex items-center gap-2">
                 <Box size={24} className="text-white"/> BDF 3D Viewer
               </h3>
               <p className="text-slate-300 text-xs font-mono bg-black/50 px-2 py-1 rounded w-fit mt-1">
                 Total Nodes: {nodeCount} | Total Members: {elementCount}
               </p>
            </div>

            <button onClick={onClose} className="absolute top-4 right-6 z-10 text-white hover:text-red-400 cursor-pointer bg-black/50 p-2 rounded-full transition-colors"><X size={24} /></button>

            {!loading && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
                <button 
                  onClick={() => setShowNodes(!showNodes)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                >
                  {showNodes ? <Eye size={20} className="mb-1" /> : <EyeOff size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Nodes</span>
                </button>

                <button 
                  onClick={() => setIsWireframe(!isWireframe)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${isWireframe ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                >
                  {isWireframe ? <LayoutGrid size={20} className="mb-1" /> : <Hexagon size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Frame</span>
                </button>

                <div className="w-px bg-slate-700 mx-1 my-2"></div>

                <button 
                  onClick={() => setAutoRotate(!autoRotate)}
                  className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors cursor-pointer ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                >
                  {autoRotate ? <PauseCircle size={20} className="mb-1" /> : <PlayCircle size={20} className="mb-1" />}
                  <span className="text-[9px] font-bold uppercase tracking-wider">Rotate</span>
                </button>

                <button 
                  onClick={resetCamera}
                  className="flex flex-col items-center justify-center w-16 h-14 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer"
                >
                  <RotateCcw size={20} className="mb-1" />
                  <span className="text-[9px] font-bold uppercase tracking-wider">Reset</span>
                </button>
              </div>
            )}

            <div className="absolute bottom-6 right-6 z-10 bg-slate-900/80 backdrop-blur-md p-3 rounded-xl border border-slate-700 pointer-events-none text-right shadow-lg">
              <h4 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest border-b border-slate-700 pb-1">Mouse Controls</h4>
              <p className="text-[11px] text-slate-200 mb-1">Left Click & Drag : <span className="text-blue-400 font-bold">Rotate</span></p>
              <p className="text-[11px] text-slate-200 mb-1">Right Click & Drag : <span className="text-emerald-400 font-bold">Pan</span></p>
              <p className="text-[11px] text-slate-200">Mouse Wheel : <span className="text-yellow-400 font-bold">Zoom</span></p>
            </div>

            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-brand-accent font-mono bg-slate-900/80 backdrop-blur-sm">
                <RefreshCw size={48} className="animate-spin mb-4" />
                Parsing BDF and Generating 3D Solid Model...
              </div>
            )}
            
            <div ref={mountRef} className="w-full h-full cursor-move" />
            
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
}