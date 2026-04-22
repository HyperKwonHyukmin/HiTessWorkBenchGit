import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  UploadCloud, ArrowLeft, ChevronDown,
  ChevronsRight,
  FileSpreadsheet, Wrench, ShieldCheck, Cpu, FileBarChart2,
  X, CheckCircle2, AlertCircle, Loader2,
  Eye, EyeOff, PlayCircle, PauseCircle, RotateCcw, Maximize2, Minimize2, Weight, Unlink, Anchor, Frame, Link,
  Download, AlertOctagon, RefreshCw, History
} from 'lucide-react';
import ChangelogModal from '../../components/ui/ChangelogModal';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { API_BASE_URL } from '../../config';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import GuideButton from '../../components/ui/GuideButton';
import { useToast } from '../../contexts/ToastContext';
import { getAuthHeaders, handleUnauthorized } from '../../utils/auth';
import { downloadFileBlob } from '../../api/analysis';

const triggerBlobDownload = async (filepath) => {
  const res = await downloadFileBlob(filepath);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filepath.split(/[\\/]/).pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ── 연결 그룹 색상 팔레트 ─────────────────────────────────────
const GROUP_PALETTE     = [0x6366f1, 0xf97316, 0xec4899, 0x22c55e, 0xeab308, 0x06b6d4, 0xf43f5e, 0xa855f7];
const GROUP_PALETTE_CSS = ['#6366f1','#f97316','#ec4899','#22c55e','#eab308','#06b6d4','#f43f5e','#a855f7'];
const GROUP_GHOST_HEX   = 0x9aa0b0;

// ── Three.js FEM 모델 뷰어 ────────────────────────────────────
// mode: 'raw'    → 2단계 (자유노드 표시, BC 없음)
//       'healed' → 3단계 (BC/SPC 경계조건 표시, 자유노드 없음)
function FemModelViewer({
  jsonPath, connectivityPath, mode = 'raw',
  rbeEditMode = false,
  selectedRbeNode = null,
  manualRbePairs = [],
  onNodePick = null,
  onRigidsLoad = null,
  blockedNodeIds = null,
  onCancelSelection = null,
  onDeleteGroup = null,
  groupDeleteSelectMode = false,
}) {
  const isHealed = mode === 'healed';

  const containerRef = useRef(null); // 전체화면 대상
  const mountRef     = useRef(null); // canvas 마운트
  const controlsRef  = useRef(null);
  const nodesMeshRef     = useRef(null);
  const conm2MeshRef     = useRef(null);
  const freeNodeMeshRef  = useRef(null);
  const bcMeshRef        = useRef(null); // 경계조건 (healed 모드)
  const rbe2MeshRef      = useRef(null); // RBE2 강체
  const pipeMeshRef      = useRef(null);
  const supportMeshRef   = useRef(null);
  const threeRef         = useRef(null); // { cleanup, scene, camera, controls, maxDim }
  const elemIdToInstanceRef = useRef({}); // { elemId: { mesh, idx } }
  // RBE 픽킹용 보조 refs
  const nodesDataRef        = useRef(null);  // { nodeId: {x,y,z} }
  const nodeIdxMapRef       = useRef([]);    // nodeIds 배열 (instanceId → nodeId)
  const rodRadiusRef        = useRef(5);
  const manualRbe2MeshRef   = useRef(null);
  const selectedHighlightRef = useRef(null);
  const uboltConnectedMeshRef = useRef(null);
  const uboltOrphanMeshRef    = useRef(null);

  const [viewState,    setViewState]    = useState('idle'); // 'idle'|'loading'|'ready'|'error'
  const [errorMsg,     setErrorMsg]     = useState('');
  const [inViewerWarning, setInViewerWarning] = useState(null); // 전체화면용 인뷰어 경고
  const [showNodes,     setShowNodes]     = useState(false);
  const [showConm2,     setShowConm2]     = useState(false);
  const [showFreeNodes, setShowFreeNodes] = useState(false);
  const [showBc,        setShowBc]        = useState(false);
  const [showPipe,      setShowPipe]      = useState(true);
  const [showSupport,   setShowSupport]   = useState(true);
  const [showUbolts,    setShowUbolts]    = useState(true);
  const [autoRotate,    setAutoRotate]    = useState(false);
  const [isFullscreen,  setIsFullscreen]  = useState(false);
  const [conm2Count,    setConm2Count]    = useState(0);
  const [freeNodeCount, setFreeNodeCount] = useState(0);
  const [bcCount,       setBcCount]       = useState(0);
  const [pipeCount,     setPipeCount]     = useState(0);
  const [supportCount,  setSupportCount]  = useState(0);
  const [uboltStats,    setUboltStats]    = useState(null); // {total, connected, orphan}
  // 연결 그룹
  const [connectivityGroups, setConnectivityGroups] = useState([]);
  const [groupColorMode,     setGroupColorMode]     = useState(false);
  const [selectedGroupId,    setSelectedGroupId]    = useState(null);
  const [isolateMode,        setIsolateMode]        = useState(false);

  // 전체화면 토글
  const toggleFullscreen = () => {
    if (!isFullscreen) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 토글 sideeffect — ref를 통해 직접 visible 조작 (씬 재빌드 불필요)
  useEffect(() => {
    if (nodesMeshRef.current) nodesMeshRef.current.visible = showNodes;
  }, [showNodes]);
  useEffect(() => {
    if (uboltConnectedMeshRef.current) uboltConnectedMeshRef.current.visible = showUbolts;
    if (uboltOrphanMeshRef.current)    uboltOrphanMeshRef.current.visible    = showUbolts;
  }, [showUbolts]);
  useEffect(() => {
    if (conm2MeshRef.current) conm2MeshRef.current.visible = showConm2;
  }, [showConm2]);
  useEffect(() => {
    if (freeNodeMeshRef.current) freeNodeMeshRef.current.visible = showFreeNodes;
  }, [showFreeNodes]);
  useEffect(() => {
    if (bcMeshRef.current) bcMeshRef.current.visible = showBc;
  }, [showBc]);
  useEffect(() => {
    if (pipeMeshRef.current) pipeMeshRef.current.visible = showPipe;
  }, [showPipe]);
  useEffect(() => {
    if (supportMeshRef.current) supportMeshRef.current.visible = showSupport;
  }, [showSupport]);
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
      controlsRef.current.autoRotateSpeed = 1.5;
    }
  }, [autoRotate]);

  // Three.js 씬 빌드
  useEffect(() => {
    if (!jsonPath || !mountRef.current) return;

    const destroy = () => {
      if (!threeRef.current) return;
      const sc = threeRef.current.scene;
      // overlay meshes 먼저 정리 (scene이 살아있을 때)
      [manualRbe2MeshRef, selectedHighlightRef].forEach(ref => {
        if (ref.current) {
          sc?.remove(ref.current);
          ref.current.geometry?.dispose();
          ref.current.material?.dispose();
          ref.current = null;
        }
      });
      // userData에 보관된 여분 material dispose (cleanup의 traverse는 현재 material만 처리)
      [pipeMeshRef, supportMeshRef, rbe2MeshRef].forEach(ref => {
        const m = ref.current;
        m?.userData?.standardMat?.dispose();
        m?.userData?.basicMat?.dispose();
      });
      threeRef.current.cleanup();
      controlsRef.current       = null;
      nodesMeshRef.current      = null;
      conm2MeshRef.current      = null;
      freeNodeMeshRef.current   = null;
      bcMeshRef.current         = null;
      pipeMeshRef.current       = null;
      supportMeshRef.current    = null;
      rbe2MeshRef.current         = null;
      uboltConnectedMeshRef.current = null;
      uboltOrphanMeshRef.current    = null;
      elemIdToInstanceRef.current = {};
      nodesDataRef.current      = null;
      nodeIdxMapRef.current     = [];
      threeRef.current          = null;
    };
    destroy();

    let cancelled = false;
    setViewState('loading');
    setErrorMsg('');

    fetch(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(jsonPath)}`, { headers: getAuthHeaders() })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        if (cancelled || !mountRef.current) return;
        const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
        const fem = JSON.parse(clean);
        onRigidsLoad?.(fem.rigids || {});

        const el = mountRef.current;

        const { scene, camera, renderer, controls, startAnimate, cleanup } =
          createThreeScene(el, { zUp: true });
        controlsRef.current = controls;

        // 노드 맵 + bounding box
        const nodes = fem.nodes || {};
        const tmpBox = new THREE.Box3();
        Object.values(nodes).forEach(n =>
          tmpBox.expandByPoint(new THREE.Vector3(n.x, n.y, n.z))
        );
        const sz = new THREE.Vector3();
        tmpBox.getSize(sz);
        const maxDim    = Math.max(sz.x, sz.y, sz.z) || 1000;
        const rodRadius = maxDim * 0.0015;

        const group = new THREE.Group();

        // ── 배관 / 서포트 빔 (classification 기준) ───────────
        const pipeElems = [], supportElems = [];
        Object.entries(fem.elements || {}).forEach(([eid, elem]) => {
          const [n1, n2] = elem.nodeIds || [];
          if (!nodes[n1] || !nodes[n2]) return;
          if (elem.classification === 'Pipe') {
            pipeElems.push({ n1, n2, elemId: eid });
          } else {
            supportElems.push({ n1, n2, elemId: eid });
          }
        });
        setPipeCount(pipeElems.length);
        setSupportCount(supportElems.length);

        const idxMap = {}; // elemId → { mesh, idx }
        const buildBeams = (elems, color, emissive) => {
          if (elems.length === 0) return null;
          const geo = new THREE.CylinderGeometry(rodRadius, rodRadius, 1, 8);
          geo.rotateX(Math.PI / 2);
          // 분류별 모드용: glow 있는 화려한 standard material
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff, metalness: 0.85, roughness: 0.15,
            emissive, emissiveIntensity: 0.35,
          });
          // 그룹 모드용: 조명 무관 basic material → instanceColor가 순수하게 선명히 표시됨
          const basicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
          const inst = new THREE.InstancedMesh(geo, mat, elems.length);
          inst.userData.standardMat = mat;
          inst.userData.basicMat    = basicMat;
          const d = new THREE.Object3D();
          const baseColor = new THREE.Color(color);
          elems.forEach((e, i) => {
            const p1 = new THREE.Vector3(nodes[e.n1].x, nodes[e.n1].y, nodes[e.n1].z);
            const p2 = new THREE.Vector3(nodes[e.n2].x, nodes[e.n2].y, nodes[e.n2].z);
            d.position.copy(p1).lerp(p2, 0.5);
            d.scale.set(1, 1, p1.distanceTo(p2));
            d.lookAt(p2); d.updateMatrix();
            inst.setMatrixAt(i, d.matrix);
            inst.setColorAt(i, baseColor); // instanceColor 버퍼 초기화
            if (e.elemId != null) idxMap[e.elemId] = { mesh: inst, idx: i };
          });
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          inst.userData.elemIds          = elems.map(e => String(e.elemId));
          inst.userData.originalMatrices = new Float32Array(inst.instanceMatrix.array);
          group.add(inst);
          return inst;
        };
        const pipeInst    = buildBeams(pipeElems,    0x6ee7b7, 0x0a7a4a);
        const supportInst = buildBeams(supportElems, 0x66ccff, 0x0044aa);
        if (pipeInst)    { pipeMeshRef.current    = pipeInst;    }
        if (supportInst) { supportMeshRef.current = supportInst; }

        // ── 노드 구체 (붉은색, 기본 On) ─────────────────────
        const nodeIds = Object.keys(nodes);
        const nodeMat = new THREE.MeshStandardMaterial({
          color: 0xff3333, metalness: 0.5, roughness: 0.3,
          emissive: 0x880000, emissiveIntensity: 0.5,
          depthTest: false, // element 빔 depth buffer를 무시 → 빔 뒤 노드도 항상 표시
        });
        const instNodes = new THREE.InstancedMesh(
          new THREE.SphereGeometry(rodRadius * 1.12, 8, 8), nodeMat, nodeIds.length
        );
        const dN = new THREE.Object3D();
        nodeIds.forEach((k, i) => {
          const n = nodes[k];
          dN.position.set(n.x, n.y, n.z); dN.updateMatrix();
          instNodes.setMatrixAt(i, dN.matrix);
        });
        instNodes.instanceMatrix.needsUpdate = true;
        instNodes.renderOrder = 1; // element 빔보다 나중에 렌더링 → 겹침 시 노드 우선
        instNodes.visible = showNodes;
        nodesMeshRef.current = instNodes;
        group.add(instNodes);

        // ── RBE2 강체 — 일반 / U-bolt 연결 / U-bolt 미연결 3분류 ─
        const rbe2Pairs    = []; // 일반 RBE2 (isUbolt 없거나 false)
        const uboltPairs   = []; // 연결된 U-bolt (isUbolt=true + dep 존재)
        const uboltOrphans = []; // 미연결 U-bolt (isUbolt=true + dep 없음)

        Object.entries(fem.rigids || {}).forEach(([rid, r]) => {
          const ind  = r.independentNodeId;
          if (!nodes[ind]) return;
          const deps = r.dependentNodeIds || [];
          if (r.isUbolt && deps.length === 0) {
            uboltOrphans.push({ n1: ind, rigidId: String(rid) });
            return;
          }
          deps.forEach(dep => {
            if (!nodes[dep]) return;
            const pair = { n1: ind, n2: dep, rigidId: String(rid) };
            if (r.isUbolt) uboltPairs.push(pair);
            else           rbe2Pairs.push(pair);
          });
        });

        // U-bolt 통계 노출 (Info 배지 + 부모 콜백)
        const uboltTotal = uboltPairs.length + uboltOrphans.length;
        if (uboltTotal > 0) {
          setUboltStats({ total: uboltTotal, connected: uboltPairs.length, orphan: uboltOrphans.length });
        } else {
          setUboltStats(null);
        }

        // 일반 RBE2
        if (rbe2Pairs.length > 0) {
          const geo = new THREE.CylinderGeometry(rodRadius * 0.5, rodRadius * 0.5, 1, 6);
          geo.rotateX(Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff, metalness: 0.5, roughness: 0.4,
            emissive: 0x881100, emissiveIntensity: 0.4,
          });
          const basicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
          const inst = new THREE.InstancedMesh(geo, mat, rbe2Pairs.length);
          inst.userData.standardMat = mat;
          inst.userData.basicMat    = basicMat;
          const d = new THREE.Object3D();
          const rbeColor = new THREE.Color(0xff6644);
          rbe2Pairs.forEach((e, i) => {
            const p1 = new THREE.Vector3(nodes[e.n1].x, nodes[e.n1].y, nodes[e.n1].z);
            const p2 = new THREE.Vector3(nodes[e.n2].x, nodes[e.n2].y, nodes[e.n2].z);
            d.position.copy(p1).lerp(p2, 0.5);
            d.scale.set(1, 1, p1.distanceTo(p2));
            d.lookAt(p2); d.updateMatrix();
            inst.setMatrixAt(i, d.matrix);
            inst.setColorAt(i, rbeColor);
          });
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          inst.userData.rigidIds         = rbe2Pairs.map(p => p.rigidId);
          inst.userData.originalMatrices = new Float32Array(inst.instanceMatrix.array);
          rbe2MeshRef.current = inst;
          group.add(inst);
        }

        // 연결된 U-bolt — 청록색 실린더
        if (uboltPairs.length > 0) {
          const geo = new THREE.CylinderGeometry(rodRadius * 0.55, rodRadius * 0.55, 1, 8);
          geo.rotateX(Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffee00, metalness: 0.3, roughness: 0.3,
            emissive: 0xcc9900, emissiveIntensity: 0.7,
          });
          const inst = new THREE.InstancedMesh(geo, mat, uboltPairs.length);
          const d2 = new THREE.Object3D();
          const ubColor = new THREE.Color(0xffee00);
          uboltPairs.forEach((e, i) => {
            const p1 = new THREE.Vector3(nodes[e.n1].x, nodes[e.n1].y, nodes[e.n1].z);
            const p2 = new THREE.Vector3(nodes[e.n2].x, nodes[e.n2].y, nodes[e.n2].z);
            d2.position.copy(p1).lerp(p2, 0.5);
            d2.scale.set(1, 1, p1.distanceTo(p2));
            d2.lookAt(p2); d2.updateMatrix();
            inst.setMatrixAt(i, d2.matrix);
            inst.setColorAt(i, ubColor);
          });
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          inst.userData.rigidIds = uboltPairs.map(p => p.rigidId);
          inst.visible = showUbolts;
          uboltConnectedMeshRef.current = inst;
          group.add(inst);
        }

        // 미연결 U-bolt — 빨간 경광등 마커 (Icosahedron)
        if (uboltOrphans.length > 0) {
          const geo = new THREE.IcosahedronGeometry(rodRadius * 3.5, 0);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xff00cc, metalness: 0.3, roughness: 0.2,
            emissive: 0xaa0088, emissiveIntensity: 0.9,
          });
          const inst = new THREE.InstancedMesh(geo, mat, uboltOrphans.length);
          const d3 = new THREE.Object3D();
          uboltOrphans.forEach((e, i) => {
            d3.position.set(nodes[e.n1].x, nodes[e.n1].y, nodes[e.n1].z);
            d3.scale.set(1, 1, 1);
            d3.quaternion.identity();
            d3.updateMatrix();
            inst.setMatrixAt(i, d3.matrix);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.userData.rigidIds = uboltOrphans.map(o => o.rigidId);
          inst.renderOrder = 2;
          inst.visible = showUbolts;
          uboltOrphanMeshRef.current = inst;
          group.add(inst);
        }

        if (!isHealed) {
          // ── 자유노드 (raw 모드: element에 1번만 사용된 노드, 기본 Off) ─
          const nodeUsage = {};
          Object.values(fem.elements || {}).forEach(elem => {
            (elem.nodeIds || []).forEach(nid => { nodeUsage[nid] = (nodeUsage[nid] || 0) + 1; });
          });
          const freeNodeIds = Object.keys(nodes).filter(id => nodeUsage[id] === 1);
          setFreeNodeCount(freeNodeIds.length);
          if (freeNodeIds.length > 0) {
            const geo = new THREE.OctahedronGeometry(rodRadius * 2.5, 0);
            const mat = new THREE.MeshStandardMaterial({ color: 0x00ffff, metalness: 0.2, roughness: 0.3, emissive: 0x006666, emissiveIntensity: 0.6 });
            const inst = new THREE.InstancedMesh(geo, mat, freeNodeIds.length);
            const dF = new THREE.Object3D();
            freeNodeIds.forEach((id, i) => {
              const n = nodes[id]; dF.position.set(n.x, n.y, n.z); dF.updateMatrix();
              inst.setMatrixAt(i, dF.matrix);
            });
            inst.instanceMatrix.needsUpdate = true;
            inst.visible = false; // 기본 Off
            freeNodeMeshRef.current = inst;
            group.add(inst);
          }
        } else {
          // ── 경계조건 BC/SPC (healed 모드: JSON boundaryConditions, 기본 On) ─
          const spcIds   = (fem.boundaryConditions || {}).spcNodeIds || [];
          const validSpc = spcIds.filter(id => nodes[id]);
          setBcCount(validSpc.length);
          if (validSpc.length > 0) {
            const geo = new THREE.BoxGeometry(rodRadius * 3.5, rodRadius * 3.5, rodRadius * 3.5);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff69b4, metalness: 0.3, roughness: 0.4, emissive: 0xaa2266, emissiveIntensity: 0.5 });
            const inst = new THREE.InstancedMesh(geo, mat, validSpc.length);
            const dB = new THREE.Object3D();
            validSpc.forEach((nid, i) => {
              const n = nodes[nid]; dB.position.set(n.x, n.y, n.z); dB.updateMatrix();
              inst.setMatrixAt(i, dB.matrix);
            });
            inst.instanceMatrix.needsUpdate = true;
            inst.visible = false; // 기본 Off
            bcMeshRef.current = inst;
            group.add(inst);
          }
        }

        // ── CONM2 점질량 (노란 정팔면체, 기본 Off) ───────────
        const validConm2 = Object.values(fem.pointMasses || {}).filter(c => nodes[c.nodeId]);
        setConm2Count(validConm2.length);
        if (validConm2.length > 0) {
          const geo = new THREE.OctahedronGeometry(rodRadius * 4, 0);
          const mat = new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.3, roughness: 0.3, emissive: 0x886600, emissiveIntensity: 0.6 });
          const inst = new THREE.InstancedMesh(geo, mat, validConm2.length);
          const d = new THREE.Object3D();
          validConm2.forEach((c, i) => {
            const n = nodes[c.nodeId]; d.position.set(n.x, n.y, n.z); d.updateMatrix();
            inst.setMatrixAt(i, d.matrix);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.visible = false; // 기본 Off
          conm2MeshRef.current = inst;
          group.add(inst);
        }

        scene.add(group);

        // 카메라 자동 맞춤
        const box    = new THREE.Box3().setFromObject(group);
        const center = new THREE.Vector3();
        box.getCenter(center);
        camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
        controls.target.copy(center);
        camera.lookAt(center);
        controls.saveState();

        elemIdToInstanceRef.current = idxMap;
        nodesDataRef.current  = nodes;
        nodeIdxMapRef.current = nodeIds;
        rodRadiusRef.current  = rodRadius;
        threeRef.current = { cleanup, camera, controls, maxDim, scene };
        startAnimate(center, maxDim);
        if (!cancelled) setViewState('ready');
      })
      .catch(err => {
        if (!cancelled) { setViewState('error'); setErrorMsg(err.message || '모델 로드 실패'); }
      });

    return () => { cancelled = true; destroy(); };
  }, [jsonPath]);

  // ConnectivityGroups JSON 로드
  useEffect(() => {
    if (!connectivityPath) { setConnectivityGroups([]); return; }
    fetch(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(connectivityPath)}`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setConnectivityGroups(data.Groups || []))
      .catch(() => setConnectivityGroups([]));
  }, [connectivityPath]);

  // selectedGroupId가 갱신된 connectivityGroups에 없으면 선택·격리 해제
  // (Group 삭제 후 stale ID로 인해 남은 그룹이 GHOST 색상으로 표시되는 현상 방지)
  useEffect(() => {
    if (selectedGroupId !== null
        && connectivityGroups.length > 0
        && !connectivityGroups.some(g => g.Id === selectedGroupId)) {
      setSelectedGroupId(null);
      setIsolateMode(false);
    }
  }, [connectivityGroups, selectedGroupId]);

  // RBE 편집 모드 ON 시 노드 자동 표시
  useEffect(() => {
    if (rbeEditMode) setShowNodes(true);
  }, [rbeEditMode]);

  // 선택된 노드 하이라이트 (노란 구체 overlay)
  useEffect(() => {
    if (viewState !== 'ready') return;
    const sc    = threeRef.current?.scene;
    const nodes = nodesDataRef.current;
    if (!sc) return;
    if (selectedHighlightRef.current) {
      sc.remove(selectedHighlightRef.current);
      selectedHighlightRef.current.geometry?.dispose();
      selectedHighlightRef.current.material?.dispose();
      selectedHighlightRef.current = null;
    }
    if (!selectedRbeNode?.nodeId) return;
    const n = nodes?.[String(selectedRbeNode.nodeId)];
    if (!n) return;
    const r   = (rodRadiusRef.current || 5) * 2.8;
    const geo = new THREE.SphereGeometry(r, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(n.x, n.y, n.z);
    sc.add(mesh);
    selectedHighlightRef.current = mesh;
  }, [selectedRbeNode, viewState]);

  // 수동 RBE2 페어 렌더링 (amber InstancedMesh overlay)
  useEffect(() => {
    if (viewState !== 'ready') return;
    const sc    = threeRef.current?.scene;
    const nodes = nodesDataRef.current;
    if (!sc) return;
    if (manualRbe2MeshRef.current) {
      sc.remove(manualRbe2MeshRef.current);
      manualRbe2MeshRef.current.geometry?.dispose();
      manualRbe2MeshRef.current.material?.dispose();
      manualRbe2MeshRef.current = null;
    }
    const validPairs = manualRbePairs.filter(
      p => nodes?.[String(p.indep)] && nodes?.[String(p.dep)]
    );
    if (validPairs.length === 0) return;
    const r   = (rodRadiusRef.current || 5) * 0.9;
    const geo = new THREE.CylinderGeometry(r, r, 1, 6);
    geo.rotateX(Math.PI / 2);
    const mat   = new THREE.MeshBasicMaterial({ color: 0xfbbf24, toneMapped: false });
    const inst  = new THREE.InstancedMesh(geo, mat, validPairs.length);
    const d     = new THREE.Object3D();
    const amber = new THREE.Color(0xfbbf24);
    validPairs.forEach((p, i) => {
      const p1 = new THREE.Vector3(nodes[String(p.indep)].x, nodes[String(p.indep)].y, nodes[String(p.indep)].z);
      const p2 = new THREE.Vector3(nodes[String(p.dep)].x,   nodes[String(p.dep)].y,   nodes[String(p.dep)].z);
      d.position.copy(p1).lerp(p2, 0.5);
      d.scale.set(1, 1, p1.distanceTo(p2));
      d.lookAt(p2); d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      inst.setColorAt(i, amber);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    sc.add(inst);
    manualRbe2MeshRef.current = inst;
  }, [manualRbePairs, viewState]);

  // 그룹 색상 모드 ON/OFF 전환 시 색상 적용/복원
  useEffect(() => {
    const map = elemIdToInstanceRef.current;
    if (!map || Object.keys(map).length === 0) return;
    const meshSet = new Set(Object.values(map).map(e => e.mesh));

    const rbe2 = rbe2MeshRef.current;
    const paintMesh = (mesh, hex) => {
      if (!mesh) return;
      const c = new THREE.Color(hex);
      for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    // 머티리얼 교체: 분류별=MeshStandardMaterial(glow), 그룹별=MeshBasicMaterial(조명 무관, 선명)
    const swapMaterial = (mesh, toGroupMode) => {
      if (!mesh) return;
      const target = toGroupMode ? mesh.userData.basicMat : mesh.userData.standardMat;
      if (target && mesh.material !== target) mesh.material = target;
    };

    if (!groupColorMode) {
      // 분류별 원래 색상 복원
      const PIPE_COL    = new THREE.Color(0x6ee7b7);
      const SUPPORT_COL = new THREE.Color(0x66ccff);
      Object.values(map).forEach(({ mesh, idx }) => {
        mesh.setColorAt(idx, mesh === pipeMeshRef.current ? PIPE_COL : SUPPORT_COL);
      });
      meshSet.forEach(mesh => { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
      paintMesh(rbe2MeshRef.current,          0xff6644);
      paintMesh(uboltConnectedMeshRef.current, 0xffee00);
      swapMaterial(pipeMeshRef.current,    false);
      swapMaterial(supportMeshRef.current, false);
      swapMaterial(rbe2MeshRef.current,    false);
      setSelectedGroupId(null);
      return;
    }

    // 그룹 색상 적용
    const GHOST = new THREE.Color(GROUP_GHOST_HEX);
    Object.values(map).forEach(({ mesh, idx }) => mesh.setColorAt(idx, GHOST));
    connectivityGroups.forEach((g, gi) => {
      const col = new THREE.Color(GROUP_PALETTE[gi % GROUP_PALETTE.length]);
      const active = selectedGroupId === null || selectedGroupId === g.Id;
      const finalCol = active ? col : GHOST;
      (g.ElementIds || []).forEach(eid => {
        const entry = map[String(eid)];
        if (entry) entry.mesh.setColorAt(entry.idx, finalCol);
      });
    });
    meshSet.forEach(mesh => { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
    paintMesh(rbe2MeshRef.current,          GROUP_GHOST_HEX);
    paintMesh(uboltConnectedMeshRef.current, GROUP_GHOST_HEX);
    // MeshBasicMaterial로 교체 → 조명 무관하게 instanceColor가 선명히 표시됨
    swapMaterial(pipeMeshRef.current,    true);
    swapMaterial(supportMeshRef.current, true);
    swapMaterial(rbe2MeshRef.current,    true);
  }, [groupColorMode, selectedGroupId, connectivityGroups, viewState]);

  // 격리 모드 — 선택 그룹에 속하지 않은 인스턴스의 매트릭스를 zero-scale로 덮어 숨김
  useEffect(() => {
    if (viewState !== 'ready') return;
    const ZERO_ELS = new THREE.Matrix4().makeScale(0, 0, 0).elements;

    const applyIsolation = (mesh, memberSet, keyList) => {
      if (!mesh || !mesh.userData.originalMatrices || !keyList) return;
      const orig = mesh.userData.originalMatrices;
      const arr  = mesh.instanceMatrix.array;
      for (let i = 0; i < keyList.length; i++) {
        const keep = memberSet === null || memberSet.has(keyList[i]);
        if (keep) {
          for (let j = 0; j < 16; j++) arr[i * 16 + j] = orig[i * 16 + j];
        } else {
          for (let j = 0; j < 16; j++) arr[i * 16 + j] = ZERO_ELS[j];
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    const selected = connectivityGroups.find(g => g.Id === selectedGroupId);
    const doIsolate = isolateMode && !!selected;
    const beamSet  = doIsolate ? new Set((selected.ElementIds || []).map(String)) : null;
    const rigidSet = doIsolate ? new Set((selected.RigidIds   || []).map(String)) : null;

    applyIsolation(pipeMeshRef.current,             beamSet,  pipeMeshRef.current?.userData.elemIds);
    applyIsolation(supportMeshRef.current,          beamSet,  supportMeshRef.current?.userData.elemIds);
    applyIsolation(rbe2MeshRef.current,             rigidSet, rbe2MeshRef.current?.userData.rigidIds);
    applyIsolation(uboltConnectedMeshRef.current,   rigidSet, uboltConnectedMeshRef.current?.userData.rigidIds);
  }, [isolateMode, selectedGroupId, connectivityGroups, viewState]);

  // 그룹 선택 시 카메라를 해당 그룹의 BBox로 이동 (fly-to)
  useEffect(() => {
    if (viewState !== 'ready' || selectedGroupId === null) return;
    const three = threeRef.current;
    if (!three?.camera || !three?.controls) return;
    const selected = connectivityGroups.find(g => g.Id === selectedGroupId);
    const bbox = selected?.BBox;
    if (!bbox?.Min || !bbox?.Max) return;

    const min = new THREE.Vector3(bbox.Min.X, bbox.Min.Y, bbox.Min.Z);
    const max = new THREE.Vector3(bbox.Max.X, bbox.Max.Y, bbox.Max.Z);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const diag   = max.clone().sub(min).length();

    const cam      = three.camera;
    const controls = three.controls;
    const dir = cam.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, -1, 0.8);
    dir.normalize();

    // 1개짜리 그룹은 diag가 매우 작으므로 모델 전체 크기(maxDim)로 최소 거리 보장
    const distance = Math.max(diag * 2.2, (three.maxDim || 1000) * 0.15);
    cam.position.copy(center).add(dir.multiplyScalar(distance));
    controls.target.copy(center);
    controls.update();
  }, [selectedGroupId, connectivityGroups, viewState]);

  // RBE 편집 모드: 노드 클릭 → 픽킹
  const handleNodeClick = (event) => {
    if (!rbeEditMode || !nodesMeshRef.current || !threeRef.current?.camera) return;
    const el = mountRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    const y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x, y }, threeRef.current.camera);
    const hits = raycaster.intersectObject(nodesMeshRef.current);
    if (!hits.length) return;
    const instanceId = hits[0].instanceId;
    if (instanceId == null) return;
    const ids = nodeIdxMapRef.current;
    if (!ids?.length || instanceId >= ids.length) return;
    const nodeId = ids[instanceId];
    if (nodeId == null) return;
    // 차단 노드(기존 RBE2 구성)를 뷰어 내부에서도 감지 → 전체화면에서도 경고 표시
    if (blockedNodeIds?.has(String(nodeId))) {
      setInViewerWarning(`Node ${nodeId}는 기존 RBE2 요소를 구성하는 노드입니다`);
      setTimeout(() => setInViewerWarning(null), 3000);
    }
    onNodePick?.(String(nodeId));
  };

  const LEGEND = [
    { color: '#6ee7b7', label: 'Pipe (배관)' },
    { color: '#66ccff', label: 'Support (구조물)' },
    { color: '#ff6644', label: 'RBE2 (강체)' },
    ...(uboltStats && uboltStats.total > 0
      ? [{ color: '#ffee00', label: `U-bolt 연결 (${uboltStats.connected}개) ━` }]
      : []),
    ...(uboltStats && uboltStats.orphan > 0
      ? [{ color: '#ff00cc', label: `U-bolt 미연결 (${uboltStats.orphan}개) ◆` }]
      : []),
    { color: '#ff3333', label: 'Node (토글) ●' },
    ...(isHealed
      ? [{ color: '#ff69b4', label: 'BC/SPC (경계조건) ■' }]
      : [{ color: '#00ffff', label: 'Free Node (토글) ◆' }]
    ),
    { color: '#ffcc00', label: 'CONM2 (점질량) ◆' },
    ...(manualRbePairs.length > 0 ? [{ color: '#fbbf24', label: `RBE2 (사용자 ${manualRbePairs.length}개) ━` }] : []),
  ];

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0a0a1a]">
      {/* Three.js 마운트 */}
      <div
        ref={mountRef}
        className={`absolute inset-0 overflow-hidden ${rbeEditMode ? 'cursor-crosshair' : 'cursor-move'}`}
        onClick={rbeEditMode ? handleNodeClick : undefined}
        onContextMenu={rbeEditMode ? (e) => { e.preventDefault(); if (selectedRbeNode) onCancelSelection?.(); } : undefined}
      />

      {/* 로딩 */}
      {viewState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a1a]/90 z-10">
          <Loader2 size={24} className="animate-spin text-blue-400" />
          <span className="text-[11px] text-slate-400">FEM 모델 로딩 중...</span>
        </div>
      )}

      {/* 에러 */}
      {viewState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a1a]/95 z-10">
          <AlertCircle size={22} className="text-red-400" />
          <span className="text-[11px] text-red-400 text-center px-4">{errorMsg}</span>
        </div>
      )}

      {viewState === 'ready' && (<>
        {/* 전체화면 버튼 (우상단) */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? '전체화면 종료' : '전체화면'}
          className="absolute top-3 right-3 z-20 bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 p-1.5 rounded-lg transition-colors cursor-pointer shadow"
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {/* 모드 안내 오버레이 (상단 중앙, 전체화면에서도 유지) */}
        {rbeEditMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none">
            <div className="bg-amber-500/90 backdrop-blur text-white px-4 py-2 rounded-xl shadow-lg border border-amber-300 whitespace-nowrap">
              <p className="text-[11px] font-bold text-center">
                {selectedRbeNode
                  ? `Node ${selectedRbeNode.nodeId} 선택됨 — 두 번째 노드를 클릭 / 우클릭으로 해제`
                  : '첫 번째 노드를 클릭하세요'}
              </p>
            </div>
          </div>
        )}
        {groupDeleteSelectMode && !rbeEditMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none">
            <div className="bg-red-500/90 backdrop-blur text-white px-4 py-2 rounded-xl shadow-lg border border-red-400 whitespace-nowrap">
              <p className="text-[11px] font-bold text-center">
                Connectivity 패널에서 그룹을 선택 후 삭제 버튼을 클릭하세요
              </p>
            </div>
          </div>
        )}

        {/* 인뷰어 경고 (전체화면에서도 표시) */}
        {inViewerWarning && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none">
            <div className="bg-red-500/90 backdrop-blur text-white px-4 py-2 rounded-xl shadow-lg border border-red-400 whitespace-nowrap">
              <p className="text-[11px] font-bold text-center">⚠ {inViewerWarning}</p>
            </div>
          </div>
        )}

        {/* 연결 그룹 패널 (우측, 전체화면 버튼 아래) */}
        {connectivityGroups.length > 0 && (
          <div className="absolute top-11 right-3 z-10 w-52 bg-slate-900/90 backdrop-blur rounded-xl border border-slate-700 shadow-xl overflow-hidden">
            {/* 헤더 — 분류별/그룹별 토글 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Connectivity
              </span>
              <button
                onClick={() => setGroupColorMode(v => !v)}
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                  groupColorMode
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {groupColorMode ? '그룹별' : '분류별'}
              </button>
            </div>

            {/* 그룹 목록 */}
            <div className="max-h-52 overflow-y-auto py-1">
              {connectivityGroups.map((g, gi) => {
                const css   = GROUP_PALETTE_CSS[gi % GROUP_PALETTE_CSS.length];
                const isActive = selectedGroupId === g.Id;
                return (
                  <button
                    key={g.Id}
                    onClick={() => {
                      if (selectedGroupId === g.Id) {
                        setGroupColorMode(false);
                        setSelectedGroupId(null);
                        setIsolateMode(false);
                      } else {
                        if (!groupColorMode) setGroupColorMode(true);
                        setSelectedGroupId(g.Id);
                        setShowNodes(true);
                        if (nodesMeshRef.current) nodesMeshRef.current.visible = true;
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                      isActive ? 'bg-slate-700/80' : 'hover:bg-slate-800'
                    }`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/20"
                         style={{ backgroundColor: css }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-bold truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
                        Group {g.Id}
                      </p>
                      <p className="text-[9px] text-slate-500 font-mono">
                        {g.ElementCount.toLocaleString()}개 요소 · {g.NodeCount.toLocaleString()}개 노드
                      </p>
                    </div>
                    {isActive && <div className="w-1 h-4 rounded-full bg-violet-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* 격리 토글 + 전체 보기 */}
            {selectedGroupId !== null && (
              <div className="border-t border-slate-700">
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">격리 모드</span>
                  <button
                    onClick={() => setIsolateMode(v => !v)}
                    title="선택 그룹만 표시"
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                      isolateMode
                        ? 'bg-amber-500 text-slate-900'
                        : 'bg-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {isolateMode ? 'ON' : 'OFF'}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setGroupColorMode(false);
                    setSelectedGroupId(null);
                    setIsolateMode(false);
                  }}
                  className="w-full text-[9px] font-bold text-slate-400 hover:text-white transition-colors cursor-pointer text-center py-1.5 border-t border-slate-700"
                >
                  모두 보기
                </button>
                {onDeleteGroup && (() => {
                  const g = connectivityGroups.find(x => x.Id === selectedGroupId);
                  const elementCount = (g?.ElementIds || []).length;
                  const rigidCount   = (g?.RigidIds   || []).length;
                  return (elementCount + rigidCount) > 0 ? (
                    <button
                      onClick={() => {
                        if (!window.confirm(
                          `Group ${g.Id}의 ${elementCount}개 element + ${rigidCount}개 rigid를 BDF에서 삭제합니다.\n` +
                          `되돌리려면 처음부터 다시 실행해야 합니다. 계속하시겠습니까?`
                        )) return;
                        onDeleteGroup(g.Id, g.ElementIds || [], g.RigidIds || []);
                      }}
                      className="w-full text-[9px] font-bold text-red-400 hover:text-white hover:bg-red-500/80 transition-colors cursor-pointer text-center py-1.5 border-t border-slate-700"
                    >
                      이 그룹 Element 삭제
                    </button>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        )}

        {/* 범례 (좌상단) */}
        <div className="absolute top-3 left-3 z-10 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 px-3 py-2.5 pointer-events-none shadow-lg">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Legend</p>
          <div className="flex flex-col gap-1">
            {(groupColorMode ? connectivityGroups.map((g, gi) => ({
              color: GROUP_PALETTE_CSS[gi % GROUP_PALETTE_CSS.length],
              label: `Group ${g.Id} (${g.ElementCount}개)`,
            })) : LEGEND).map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-4 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[10px] font-mono text-slate-300">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* U-bolt 상태 배지 (좌하단) */}
        {uboltStats && uboltStats.total > 0 && (
          <div className="absolute bottom-20 left-3 z-10 pointer-events-none">
            <div className={`backdrop-blur rounded-xl px-3 py-2 border shadow-lg ${
              uboltStats.orphan > 0
                ? 'bg-purple-950/90 border-fuchsia-700'
                : 'bg-slate-900/90 border-slate-700'
            }`}>
              <p className="text-[10px] font-bold text-slate-300">
                U-bolt
                <span className="text-yellow-400 ml-2 font-mono">{uboltStats.connected}</span>
                <span className="text-slate-500 mx-1">연결</span>
                {uboltStats.orphan > 0 && (
                  <span className="text-fuchsia-400 font-mono ml-1">⚠ {uboltStats.orphan} 미연결</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* 컨트롤 툴바 (하단 중앙) */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-slate-800/80 backdrop-blur-md p-2 rounded-2xl border border-slate-700 shadow-2xl">
          {/* Support 토글 */}
          <button
            onClick={() => supportCount > 0 && setShowSupport(v => !v)}
            disabled={supportCount === 0}
            title={supportCount === 0 ? 'Support 없음' : `서포트 ${supportCount}개`}
            className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors
              ${supportCount === 0
                ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                : showSupport
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 cursor-pointer'
                : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'}`}
          >
            <Frame size={18} className="mb-1" />
            <span className="text-[8px] font-bold uppercase tracking-wider">Stru</span>
          </button>

          {/* Node 토글 */}
          <button
            onClick={() => setShowNodes(v => !v)}
            className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer
              ${showNodes ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
            title="노드 표시 토글"
          >
            {showNodes ? <Eye size={18} className="mb-1" /> : <EyeOff size={18} className="mb-1" />}
            <span className="text-[8px] font-bold uppercase tracking-wider">Nodes</span>
          </button>

          {/* 자유노드(raw) / BC 경계조건(healed) 토글 */}
          {!isHealed ? (
            <button
              onClick={() => freeNodeCount > 0 && setShowFreeNodes(v => !v)}
              disabled={freeNodeCount === 0}
              title={freeNodeCount === 0 ? '자유노드 없음' : `자유노드 ${freeNodeCount}개 (element 1회 연결)`}
              className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors
                ${freeNodeCount === 0
                  ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                  : showFreeNodes
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 cursor-pointer'
                  : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'}`}
            >
              <Unlink size={18} className="mb-1" />
              <span className="text-[8px] font-bold uppercase tracking-wider">Free</span>
            </button>
          ) : (
            <button
              onClick={() => bcCount > 0 && setShowBc(v => !v)}
              disabled={bcCount === 0}
              title={bcCount === 0 ? 'BC 없음' : `경계조건 ${bcCount}개`}
              className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors
                ${bcCount === 0
                  ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                  : showBc
                  ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30 cursor-pointer'
                  : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'}`}
            >
              <Anchor size={18} className="mb-1" />
              <span className="text-[8px] font-bold uppercase tracking-wider">BC</span>
            </button>
          )}

          {/* CONM2 토글 */}
          <button
            onClick={() => conm2Count > 0 && setShowConm2(v => !v)}
            disabled={conm2Count === 0}
            title={conm2Count === 0 ? 'CONM2 없음' : `점질량 ${conm2Count}개`}
            className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors
              ${conm2Count === 0
                ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                : showConm2
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 cursor-pointer'
                : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'}`}
          >
            <Weight size={18} className="mb-1" />
            <span className="text-[8px] font-bold uppercase tracking-wider">Mass</span>
          </button>

          {/* U-bolt 토글 */}
          {uboltStats && uboltStats.total > 0 && (
            <button
              onClick={() => setShowUbolts(v => !v)}
              title={`U-bolt ${uboltStats.total}개 (연결 ${uboltStats.connected} · 미연결 ${uboltStats.orphan})`}
              className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer
                ${showUbolts
                  ? uboltStats.orphan > 0
                    ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30'
                    : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'bg-slate-700 text-slate-400 hover:text-white'}`}
            >
              <Link size={18} className="mb-1" />
              <span className="text-[8px] font-bold uppercase tracking-wider">U-bolt</span>
            </button>
          )}

          {/* 자동 회전 */}
          <button
            onClick={() => setAutoRotate(v => !v)}
            className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors cursor-pointer
              ${autoRotate ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
          >
            {autoRotate ? <PauseCircle size={18} className="mb-1" /> : <PlayCircle size={18} className="mb-1" />}
            <span className="text-[8px] font-bold uppercase tracking-wider">Rotate</span>
          </button>

          {/* 카메라 리셋 */}
          <button
            onClick={() => controlsRef.current?.reset()}
            className="flex flex-col items-center justify-center w-14 h-12 rounded-xl bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer"
          >
            <RotateCcw size={18} className="mb-1" />
            <span className="text-[8px] font-bold uppercase tracking-wider">Reset</span>
          </button>
        </div>
      </>)}
    </div>
  );
}

// ── 단계 정의 ──────────────────────────────────────────────────
const INITIAL_STEPS = [
  { id: 'csv-validation', title: 'CSV 입력 검증',     sub: '',                      icon: FileSpreadsheet, status: 'wait' },
  { id: 'model-qc',       title: '모델 알고리즘 적용', sub: 'HiTESS Heal 알고리즘', icon: ShieldCheck,     status: 'wait' },
  { id: 'nastran',        title: 'Nastran을 통한 검증', sub: 'F06 파싱 및 결과 검증', icon: Cpu,             status: 'wait' },
];

const STATUS_CONFIG = {
  wait:     { dot: 'bg-white border-2 border-slate-300',                         badge: 'bg-slate-100 text-slate-500',  label: '대기' },
  running:  { dot: 'bg-blue-500 border-2 border-blue-500 animate-pulse',         badge: 'bg-blue-100 text-blue-700',    label: '실행 중' },
  done:     { dot: 'bg-green-500 border-2 border-green-500',                     badge: 'bg-green-100 text-green-800',  label: '완료' },
  error:    { dot: 'bg-red-600 border-2 border-red-600',                         badge: 'bg-red-100 text-red-700',      label: '오류' },
  skip:     { dot: 'bg-slate-300 border-2 border-slate-300',                     badge: 'bg-slate-100 text-slate-400',  label: '건너뜀' },
  disabled: { dot: 'bg-slate-100 border-2 border-slate-200',                     badge: 'bg-slate-100 text-slate-300',  label: '범위 밖' },
};

// ── 로그 파서 ──────────────────────────────────────────────────
function parseModelBuilderLog(rawText) {
  // 신규 엔진은 각 줄을 2번 출력함 → 연속 중복 줄 제거
  const lines = rawText.split('\n');
  const deduped = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 || lines[i] !== lines[i - 1]) deduped.push(lines[i]);
  }
  const text = deduped.join('\n');

  const num = (re) => { const m = text.match(re); return m ? parseInt(m[1].replace(/,/g, '')) : 0; };

  // ── 타임스탬프 ─────────────────────────────────────────────
  const timeMatch = text.match(/\[(\d{2}:\d{2}:\d{2})/);
  const time = timeMatch ? timeMatch[1] : '';

  // ── CSV 파싱 결과 — [통과] 구조  : 1231/1231행 성공 ─────────
  const parseCsvRow = (kw) => {
    const re = new RegExp(`\\[통과\\]\\s+${kw}\\s*:\\s*(\\d+)\\/(\\d+)행 성공`);
    const m  = text.match(re);
    if (!m) return null;
    const ok = parseInt(m[1]), total = parseInt(m[2]);
    return { ok, total, fail: total - ok };
  };
  const struParse  = parseCsvRow('구조');
  const pipeParse  = parseCsvRow('배관');
  const equipParse = parseCsvRow('장비');
  const parseResult = (struParse || pipeParse || equipParse)
    ? { stru: struParse, pipe: pipeParse, equip: equipParse }
    : null;

  // ── 경고: 질량 0 장비 ─────────────────────────────────────
  const zeroMassEquip = [...text.matchAll(/\[경고\] 질량이 0인 장비가 포함됨: '([^']+)'/g)]
    .map(m => m[1]);

  // ── 경고: 파서 경고 ───────────────────────────────────────
  const parserWarnings = [...text.matchAll(/\[파서 경고\] (.+)/g)].map(m => m[1].trim());

  // ── 생성 누락 (분류) ──────────────────────────────────────
  const creationOmissions = [...text.matchAll(/\[생성 누락\] (.+)/g)].map(m => m[1].trim());
  // 알 수 없는 배관 타입별로 그루핑
  const unknownTypeMap = {};
  const zeroLengthSet  = new Set();
  const otherOmissions = [];
  creationOmissions.forEach(s => {
    const typeM = s.match(/알 수 없는 배관 타입\((\w+)\).*Name:\s*'([^']+)'/);
    const zeroM = s.match(/시작점과 끝점이 같아.*Name:\s*'([^']+)'/);
    if (typeM) {
      const t = typeM[1];
      if (!unknownTypeMap[t]) unknownTypeMap[t] = [];
      if (!unknownTypeMap[t].includes(typeM[2])) unknownTypeMap[t].push(typeM[2]); // 중복 ID 제거
    } else if (zeroM) {
      zeroLengthSet.add(zeroM[1]); // 중복 제거
    } else {
      otherOmissions.push(s);
    }
  });
  const unknownTypes = Object.entries(unknownTypeMap).map(([type, ids]) => ({ type, ids }));
  const zeroLengthIds = [...zeroLengthSet];

  // ── 구조물 단면 분류 — "- ANGLE (ㄱ형강) : 690" ──────────
  const struSections = [...text.matchAll(/^\s*-\s+(\w+)\s+\(([^)]+)\)\s*:\s*(\d+)/gm)]
    .map(m => ({ code: m[1].trim(), name: m[2].trim(), count: parseInt(m[3]) }))
    .filter(s => s.code !== 'Unknown' && s.count > 0);

  // ── FE 초기 모델 통계 — "* Total Nodes : 3685" ───────────
  const totalNodes    = num(/\*\s+Total Nodes\s*:\s*([\d,]+)/);
  const totalElements = num(/\*\s+Total Elements\s*:\s*([\d,]+)/);
  const totalProps    = num(/\*\s+Total Properties\s*:\s*([\d,]+)/);
  const totalMats     = num(/\*\s+Total Materials\s*:\s*([\d,]+)/);

  // ── CSV → FE 변환 요약 ────────────────────────────────────
  const struConv  = text.match(/구조 부재\s*:\s*CSV\s*([\d,]+)개\s*→\s*FE 요소\s*([\d,]+)개/);
  const pipeConv  = text.match(/배관\s*:\s*CSV\s*([\d,]+)개 항목\s*→\s*FE 요소\s*([\d,]+)개/);
  const equipConv = text.match(/장비\s*:\s*CSV\s*([\d,]+)개\s*→\s*PointMass\s*([\d,]+)개/);
  const uboltConv = text.match(/UBOLT\s*:\s*배관 CSV에서\s*UBOLT\s*([\d,]+)개 생성/);
  const initModel = text.match(/초기 모델\s*:\s*노드\s*([\d,]+)개\s*\/\s*요소\s*([\d,]+)개\s*\/\s*강체\s*([\d,]+)개/);
  const p = (s) => parseInt((s || '0').replace(/,/g, ''));

  const feConversion = {
    stru:  struConv  ? { csv: p(struConv[1]),  fe: p(struConv[2])  } : null,
    pipe:  pipeConv  ? { csv: p(pipeConv[1]),  fe: p(pipeConv[2])  } : null,
    equip: equipConv ? { csv: p(equipConv[1]), fe: p(equipConv[2]) } : null,
    ubolt: uboltConv ? p(uboltConv[1]) : 0,
    initNodes:    initModel ? p(initModel[1]) : totalNodes,
    initElements: initModel ? p(initModel[2]) : totalElements,
    initRbes:     initModel ? p(initModel[3]) : 0,
  };

  // ── buildStats (FE 모델 통계 카드용) ─────────────────────
  const buildStats = [
    feConversion.initNodes    && { label: 'GRID',  sub: '노드',   count: feConversion.initNodes    },
    feConversion.initElements && { label: 'CBEAM', sub: '요소',   count: feConversion.initElements },
    feConversion.initRbes     && { label: 'RBE2',  sub: '강체',   count: feConversion.initRbes     },
    totalMats                 && { label: 'MAT1',  sub: '재료',   count: totalMats                 },
    totalProps                && { label: 'PBEAM', sub: '단면',   count: totalProps                },
  ].filter(Boolean);

  // ── STAGE별 결과 파싱 (stage 2 이상에서 등장) ─────────────
  const stageResults = [];
  const stagePattern = /={4,}\s*STAGE_(\d{2})\s*={4,}/g;
  const stageMatches = [...text.matchAll(stagePattern)];
  stageMatches.forEach((match, idx) => {
    const stageNum = parseInt(match[1], 10);
    const start    = match.index + match[0].length;
    const end      = idx + 1 < stageMatches.length ? stageMatches[idx + 1].index : text.length;
    const block    = text.slice(start, end);
    const checks   = [];
    const checkPat = /\[?(통과|경고)\]?\s+(\S+)\s+-\s+([^:：]+)\s*[:：]\s*(.+)/g;
    for (const cm of block.matchAll(checkPat)) {
      checks.push({ type: cm[1] === '통과' ? 'pass' : 'warn', code: cm[2].trim(), name: cm[3].trim(), msg: cm[4].trim() });
    }
    const safetyCount = (block.match(/안전망 작동/g) || []).length;
    if (safetyCount > 0) checks.push({ type: 'warn', code: 'SAFETY', name: '안전망 작동', msg: `독립 그룹 SPC 강제 할당 ${safetyCount}건` });
    const bdfMatch    = block.match(/\[Export\] BDF 추출 완료[:\s]+(\S+\.bdf)/i);
    stageResults.push({ stage: stageNum, checks, bdfExported: !!bdfMatch, bdfFile: bdfMatch ? bdfMatch[1] : null });
  });

  return {
    parseResult,
    warnings: {
      creationOmissions,
      unknownTypes,
      zeroLengthIds,
      otherOmissions,
      zeroMassEquip,
      parserWarnings,
      total: creationOmissions.length + zeroMassEquip.length + parserWarnings.length,
    },
    buildStats,
    struSections,
    feConversion,
    time,
    stageResults,
  };
}

// ── CSV 파일 유형 감지 ──────────────────────────────────────────

// 1단계: 파일명으로 유형 추측
const CSV_TYPE_KEYWORDS = {
  stru:  ['stru', 'struct', 'str', 'structural', 'structure', '구조'],
  pipe:  ['pipe', 'pip', 'piping', '배관'],
  equip: ['equip', 'equipment', 'eq', 'eqp', '장비', 'cargo', 'load', 'weight', 'mass'],
};

// 파일명에서 타입 키워드를 제거한 base 이름 추출
// 예: 'Ship_stru.csv' + stru 키워드 → { base: 'ship', keyword: 'stru' }
function extractBaseAndKeyword(filename, keywords) {
  const lower = filename.replace(/\.csv$/i, '').toLowerCase();
  // 긴 키워드부터 매칭해야 'structure'가 'str'보다 먼저 잡힘
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    const re = new RegExp(`[_\\-\\.\\s]?${kw}[_\\-\\.\\s]?`, 'i');
    if (re.test(lower)) {
      const base = lower.replace(re, '').replace(/[_\-\.\s]+$/, '').replace(/^[_\-\.\s]+/, '');
      return { base, keyword: kw };
    }
  }
  return null;
}

function guessTypeFromFilename(filename) {
  const lower = filename.toLowerCase();
  for (const [type, keywords] of Object.entries(CSV_TYPE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return type;
  }
  return null;
}

// 2단계: CSV 첫 행(헤더)을 읽어 필수 컬럼 존재 여부로 유형 검증
const CSV_REQUIRED_COLS = {
  stru:  ['ori'],       // 구조물 CSV 필수 컬럼 — ori(방향) 컬럼
  pipe:  ['outdia'],    // 배관 CSV 필수 컬럼 — outDia(외경) 컬럼
  equip: ['cog'],       // 장비 CSV 필수 컬럼 — cog(무게중심) 컬럼
};
function readCsvHeader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      const firstLine = clean.split(/\r?\n/)[0] || '';
      const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
      resolve(cols);
    };
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}
async function detectCsvType(file) {
  const cols = await readCsvHeader(file);
  for (const [type, required] of Object.entries(CSV_REQUIRED_COLS)) {
    if (required.every(r => cols.some(c => c.includes(r)))) return type;
  }
  return null;
}

// ── CSV 업로드 존 ───────────────────────────────────────────────
// multiple=true 이면 여러 파일 선택 허용 (stru 존에서 일괄 선택 시 자동 분류)
function CsvDropZone({ label, required, file, fileError, onFile, onClear, multiple = false, onMultipleFiles }) {
  const inputRef = useRef(null);
  const isWarn = fileError?.startsWith('__warn__');
  const displayError = isWarn ? fileError.slice(8) : fileError;

  const handleSingleFile = (f) => {
    if (!f) return;
    if (!f.name.endsWith('.csv')) {
      showToast('CSV 파일(.csv)만 업로드 가능합니다.', 'warning');
      return;
    }
    onFile(f);
  };

  const handleFileList = (fileList) => {
    const csvFiles = Array.from(fileList).filter(f => f.name.endsWith('.csv'));
    if (csvFiles.length === 0) return;
    if (csvFiles.length === 1) {
      handleSingleFile(csvFiles[0]);
    } else if (multiple && onMultipleFiles) {
      // 여러 파일: 자동 분류 핸들러로 전달
      onMultipleFiles(csvFiles);
    } else {
      handleSingleFile(csvFiles[0]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFileList(e.dataTransfer.files);
  };

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden transition-colors
      ${fileError && !isWarn ? 'border-red-300' : isWarn ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={13} className={fileError && !isWarn ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-400'} />
          <span className="text-xs font-semibold text-slate-700">{label}</span>
          {required
            ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">필수</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium">선택</span>
          }
        </div>
        {file && (
          <button onClick={onClear} className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
            <X size={13} />
          </button>
        )}
      </div>
      {file ? (
        <div className="flex flex-col items-center justify-center gap-0.5 px-3 py-3 text-center">
          {fileError && !isWarn
            ? <AlertCircle size={15} className="text-red-500 shrink-0 mb-0.5" />
            : isWarn
            ? <AlertCircle size={15} className="text-amber-400 shrink-0 mb-0.5" />
            : <CheckCircle2 size={15} className="text-green-500 shrink-0 mb-0.5" />
          }
          <p className="text-[10px] font-semibold text-slate-700 truncate w-full text-center">{file.name}</p>
          {fileError && !isWarn
            ? <p className="text-[10px] text-red-500 leading-tight text-center">{displayError}</p>
            : isWarn
            ? <p className="text-[10px] text-amber-500 leading-tight text-center">{displayError}</p>
            : <p className="text-[10px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
          }
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1 py-3.5 cursor-pointer hover:bg-blue-50/40 transition-colors text-center"
        >
          <UploadCloud size={18} className="text-slate-300" />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {multiple
              ? <>드롭하거나<br /><span className="text-blue-600 font-medium">클릭하여 선택</span><br /><span className="text-slate-300">여러 파일 동시 선택 가능</span></>
              : <>드롭하거나<br /><span className="text-blue-600 font-medium">클릭하여 선택</span></>
            }
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple={multiple}
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFileList(e.target.files); }}
          />
        </div>
      )}
    </div>
  );
}

// ── Detail Panels ───────────────────────────────────────────────
function DetailCSV({ struFile, setStruFile, pipeFile, setPipeFile, equiFile, setEquiFile,
                     struError, pipeError, equiError, setStruError, setPipeError, setEquiError,
                     onAutoAssign, onMultipleFiles }) {
  const isReady = !!struFile && !struError && !pipeError && !equiError;
  const hasError = struError || pipeError || equiError;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <CsvDropZone
          label="Structural (stru)" required
          file={struFile} fileError={struError}
          onFile={(f) => onAutoAssign(f, 'stru')}
          onClear={() => { setStruFile(null); setStruError(null); }}
          multiple={true}
          onMultipleFiles={onMultipleFiles}
        />
        <CsvDropZone
          label="Piping (pipe)" required={false}
          file={pipeFile} fileError={pipeError}
          onFile={(f) => onAutoAssign(f, 'pipe')}
          onClear={() => { setPipeFile(null); setPipeError(null); }}
        />
        <CsvDropZone
          label="Equipment (equi)" required={false}
          file={equiFile} fileError={equiError}
          onFile={(f) => onAutoAssign(f, 'equip')}
          onClear={() => { setEquiFile(null); setEquiError(null); }}
        />
      </div>
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors
        ${hasError ? 'bg-red-50 border-red-200 text-red-700'
          : isReady ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
        {hasError
          ? <><AlertCircle size={13} /> 파일 형식 오류를 확인하세요</>
          : isReady
          ? <><CheckCircle2 size={13} /> 필수 파일 준비 완료 — 실행 가능</>
          : <><AlertCircle size={13} /> Structural CSV 파일이 필요합니다</>
        }
      </div>
    </div>
  );
}

function DetailConvert({ logData, bdfResult }) {
  if (!logData) {
    return (
      <div className="flex items-center gap-2 py-2 text-slate-400">
        <Wrench size={14} className="opacity-30 shrink-0" />
        <span className="text-xs">초기 BDF 추출 완료 후 결과가 여기에 표시됩니다.</span>
      </div>
    );
  }
  const { buildStats } = logData;
  const bdfName = bdfResult?.bdfPath ? bdfResult.bdfPath.replace(/\\/g, '/').split('/').pop() : null;
  return (
    <div className="space-y-3">
      <Section label="FE 모델 현황">
        <div className="grid grid-cols-3 gap-2">
          {buildStats.map(({ label, sub, count }) => (
            <div key={label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center shadow-sm">
              <p className="text-base font-bold text-slate-700 leading-none">{count.toLocaleString()}</p>
              <p className="text-[10px] font-semibold text-blue-600 mt-0.5">{label}</p>
              <p className="text-[10px] text-slate-400">{sub}</p>
            </div>
          ))}
        </div>
      </Section>
      {bdfName && (
        <Section label="생성된 파일">
          <OptCard>
            <OptRow label="BDF 파일">
              <span className="text-[10px] text-slate-500 font-mono truncate max-w-[240px]" title={bdfResult.bdfPath}>
                {bdfName}
              </span>
            </OptRow>
          </OptCard>
        </Section>
      )}
    </div>
  );
}

const ALGO_STAGES = [
  { id: 0, label: '초기 상태 (힐링 없음)',            desc: '' },
  { id: 1, label: '기존 노드 기반 요소 분할',          desc: '' },
  { id: 2, label: '교차 요소 분할 + 단락 요소 제거',   desc: '' },
  { id: 3, label: '짧은 요소 병합 + 일직선 노드 정리', desc: '' },
  { id: 4, label: '자유단 노드 연장',                 desc: '수렴 반복, 최대 10회' },
  { id: 5, label: '연결 그룹 위치 이동',               desc: '수렴 반복, 최대 10회' },
  { id: 6, label: 'RBE2 강체 요소 자동 연결',          desc: '' },
  { id: 7, label: 'U-Bolt 연결 + 강체 최종 정리',      desc: '' },
];

function DetailAlgorithm({ jobStatus, logData }) {
  const isRunning = jobStatus?.status === 'Running' || jobStatus?.status === 'Pending';
  const isDone    = jobStatus?.status === 'Success';
  const isFailed  = jobStatus?.status === 'Failed';
  const progress  = jobStatus?.progress ?? 0;

  // 실제 로그 기반 완료 스테이지 수 (있으면 우선, 없으면 progress 추정)
  const completedFromLog = logData?.stageResults?.length ?? -1;
  const activeStage = isDone
    ? 7
    : completedFromLog >= 0
    ? completedFromLog          // 로그에 등장한 STAGE 수 = 완료된 스테이지 수
    : isRunning
    ? Math.min(7, Math.floor(progress / 14))
    : -1;

  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">알고리즘 단계</p>
      <div className="space-y-0.5">
        {ALGO_STAGES.map(({ id, label, desc }) => {
          const isChecked = isDone || (isRunning && id < activeStage);
          const isCurrent = isRunning && id === activeStage;
          const isErrored = isFailed && id === activeStage;
          return (
            <div
              key={id}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all duration-300
                ${isCurrent ? 'bg-blue-50 border border-blue-100' : ''}
                ${isChecked ? 'bg-green-50/40' : ''}
                ${isErrored ? 'bg-red-50 border border-red-100' : ''}
              `}
            >
              {/* 체크 박스 */}
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all duration-300
                ${isChecked ? 'bg-green-500 border-green-500'
                  : isCurrent ? 'border-blue-400'
                  : isErrored ? 'border-red-400'
                  : 'border-slate-200 bg-white'
                }`}
              >
                {isChecked && (
                  <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                {isErrored  && <div className="w-1.5 h-1.5 rounded-full bg-red-500" />}
              </div>

              {/* 레이블 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono shrink-0
                    ${isChecked ? 'text-green-600' : isCurrent ? 'text-blue-500' : 'text-slate-300'}`}
                  >S{id}</span>
                  <span className={`text-xs leading-tight
                    ${isChecked ? 'text-green-700 font-medium'
                      : isCurrent ? 'text-blue-700 font-semibold'
                      : isErrored ? 'text-red-600'
                      : 'text-slate-500'
                    }`}>
                    {label}
                  </span>
                </div>
                {desc && <p className="text-[10px] text-slate-400 ml-5">{desc}</p>}
              </div>

              {/* 상태 아이콘 */}
              {isChecked && <CheckCircle2 size={11} className="text-green-400 shrink-0" />}
              {isCurrent && <Loader2 size={11} className="text-blue-400 animate-spin shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── STAGE별 알고리즘 로그 패널 ──────────────────────────────────
function AlgorithmLogPanel({ logData, jobStatus, processLog, engineLog }) {
  const isRunning  = jobStatus?.status === 'Running' || jobStatus?.status === 'Pending';
  const isFailed   = jobStatus?.status === 'Failed';
  const stages     = logData?.stageResults ?? [];
  const [expanded, setExpanded] = useState(null); // 펼쳐진 STAGE id

  if (stages.length === 0) {
    if (isFailed && engineLog) {
      return (
        <div className="h-full flex flex-col gap-2 px-3 py-3">
          <div className="flex items-center gap-1.5 text-red-600">
            <span className="text-xs font-bold">실행 오류</span>
          </div>
          <pre className="flex-1 overflow-auto text-[10px] font-mono leading-relaxed text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 whitespace-pre-wrap break-all">
            {engineLog}
          </pre>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        {isRunning
          ? <><Loader2 size={16} className="animate-spin text-blue-400" /><p className="text-[11px] text-slate-400">알고리즘 실행 중...</p></>
          : <p className="text-[11px] text-slate-400">알고리즘 실행 후 단계별 로그가 여기에 표시됩니다.</p>
        }
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-2 space-y-1">
      {/* ProcessLog 배너 */}
      {processLog && (
        <div className={`mb-2 px-3 py-2 rounded-xl border text-xs font-medium ${
          processLog.exitReason === 'Completed'
            ? 'bg-green-50 border-green-200 text-green-700'
            : processLog.exitReason === 'EarlyStop'
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <span className="font-bold">
            {processLog.exitReason === 'Completed' ? '✓ 정상 완료'
              : processLog.exitReason === 'EarlyStop' ? '⚠ 조기 종료'
              : `✗ 오류 (Stage ${processLog.errorStage ?? '?'})`}
          </span>
          {processLog.errorMessage && (
            <p className="text-[10px] mt-1 font-mono opacity-90">{processLog.errorMessage}</p>
          )}
          {processLog.stages?.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] opacity-80">
              {processLog.stages.map(s => (
                <span key={s.id}>
                  {s.name}: {s.elapsedMs >= 1000
                    ? `${(s.elapsedMs / 1000).toFixed(1)}s`
                    : `${s.elapsedMs}ms`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {stages.map(({ stage, checks, bdfExported, bdfFile }) => {
        const warnCount  = checks.filter(c => c.type === 'warn').length;
        const passCount  = checks.filter(c => c.type === 'pass').length;
        const isOpen     = expanded === stage;
        const isLastRunning = isRunning && stage === stages[stages.length - 1].stage;

        return (
          <div key={stage} className="border border-slate-100 rounded-lg overflow-hidden">
            {/* 헤더 */}
            <button
              onClick={() => setExpanded(isOpen ? null : stage)}
              className="w-full flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
            >
              {/* 완료/진행 아이콘 */}
              {isLastRunning
                ? <Loader2 size={12} className="text-blue-400 animate-spin shrink-0" />
                : <CheckCircle2 size={12} className="text-green-400 shrink-0" />
              }
              <span className="text-[11px] font-bold text-slate-600 font-mono">STAGE_{String(stage).padStart(2, '0')}</span>
              <div className="flex items-center gap-1.5 ml-auto">
                {passCount > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                    통과 {passCount}
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    경고 {warnCount}
                  </span>
                )}
                {bdfExported && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">BDF</span>
                )}
                <ChevronDown size={10} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* 상세 내용 */}
            {isOpen && (
              <div className="px-3 py-2 space-y-0.5 bg-white">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {c.type === 'pass'
                      ? <CheckCircle2 size={10} className="text-green-400 mt-0.5 shrink-0" />
                      : <AlertCircle  size={10} className="text-amber-400 mt-0.5 shrink-0" />
                    }
                    <div className="min-w-0">
                      <span className={`text-[9px] font-mono font-bold mr-1.5
                        ${c.type === 'pass' ? 'text-slate-400' : 'text-amber-600'}`}>
                        {c.code}
                      </span>
                      <span className={`text-[10px] leading-tight
                        ${c.type === 'pass' ? 'text-slate-500' : 'text-amber-800 font-medium'}`}>
                        {c.name && `${c.name}: `}{c.msg}
                      </span>
                    </div>
                  </div>
                ))}
                {bdfFile && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                    <span className="text-[9px] text-blue-500 font-mono">✓ {bdfFile}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailNastran({
  nastranStatus, nastranStep1, nastranStep2,
  bdfResult, uboltBdfResult, rbeResult,
  uboltStep1, uboltStep2,
  uboltRunning, hasFatal, stage3Meta,
  nastranTab, setNastranTab,
  onUboltRetry,
}) {
  const isRunning = nastranStatus?.status === 'Running' || nastranStatus?.status === 'Pending';
  const hasUboltResult = !!uboltStep1;
  const hasPivotFatal = useMemo(() => {
    const msgs = nastranStep2?.f06Summary?.messages || [];
    return msgs.some(m =>
      m.level === 'fatal' &&
      (m.message || '').toUpperCase().includes('PIVOT RATIOS IN MATRIX KLL')
    );
  }, [nastranStep2]);

  // 다운로드 버튼
  const DownloadBtn = ({ path, label }) => {
    if (!path) return null;
    const filename = path.split(/[\\/]/).pop();
    return (
      <button
        onClick={() => triggerBlobDownload(path)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors cursor-pointer"
        title={filename}
      >
        <Download size={11} />
        {label}
      </button>
    );
  };

  // 실행 전 대기 상태
  if (!nastranStep1 && !isRunning && !nastranStatus) {
    return (
      <div className="flex items-center gap-2 py-2 text-slate-400">
        <Cpu size={14} className="opacity-30" />
        <span className="text-xs">Stage 3 완료 후 Nastran 해석이 자동 시작됩니다.</span>
      </div>
    );
  }

  // 실행 중
  if (isRunning) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 py-1">
          <Loader2 size={13} className="animate-spin text-blue-500" />
          <span className="text-xs text-blue-600 font-medium">
            {nastranStatus?.message || 'Nastran 해석 실행 중...'}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${nastranStatus?.progress || 0}%` }}
          />
        </div>
      </div>
    );
  }

  const activeS1 = nastranTab === 'rigid' ? uboltStep1 : nastranStep1;
  const activeS2 = nastranTab === 'rigid' ? uboltStep2 : nastranStep2;
  const totalErrors = activeS1?.summary?.totalErrors ?? 0;
  const f06Fatals   = activeS2?.summary?.f06Fatals   ?? 0;
  const f06Warnings = activeS2?.summary?.f06Warnings ?? 0;

  return (
    <div className="space-y-3">
      {/* 탭 선택기 (두 결과 모두 존재 시) */}
      {hasUboltResult && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['normal', '일반 (U-Bolt 해제)'], ['rigid', 'Rigid (U-Bolt 고정)']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setNastranTab(val)}
              className={`flex-1 text-xs py-1 rounded-md font-medium transition-colors ${
                nastranTab === val
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* FATAL 배너 + 재시도 버튼 */}
      {hasFatal && !hasUboltResult && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertOctagon size={13} className="text-red-500" />
            <span className="text-xs font-bold text-red-700">Nastran FATAL 오류 감지</span>
          </div>
          <p className="text-xs text-red-600 mb-2 leading-relaxed">
            U-bolt RBE2 DOF를 Rigid(123456)로 고정하여 재시도할 수 있습니다.
          </p>
          <button
            onClick={onUboltRetry}
            disabled={uboltRunning || !stage3Meta}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg transition-colors cursor-pointer"
          >
            {uboltRunning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {uboltRunning ? 'Rigid 모드 실행 중...' : 'U-bolt Rigid 모드로 재시도'}
          </button>
          {hasPivotFatal && (
            <p className="text-[10px] text-red-600 mt-2 leading-relaxed bg-red-100/60 rounded-lg px-2 py-1.5">
              💡 U-bolt 연결 노드의 자유도가 구속되지 않아 발생하는 메커니즘(Mechanism) 오류입니다.
              Rigid 모드로 재시도하면 DOF 123456을 강제 구속하여 해석을 계속합니다.
            </p>
          )}
        </div>
      )}

      {/* U-bolt 재시도 진행 중 */}
      {uboltRunning && !hasUboltResult && (
        <div className="flex items-center gap-2 py-1 text-orange-600">
          <Loader2 size={13} className="animate-spin" />
          <span className="text-xs">U-bolt Rigid 모드 BDF 재생성 및 Nastran 해석 중...</span>
        </div>
      )}

      {/* F06 요약 카드 */}
      {activeS1 && (
        <Section label="검증 요약">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '검증 오류', value: totalErrors, color: totalErrors > 0 ? 'text-red-600' : 'text-slate-600' },
              { label: 'F06 Fatal', value: f06Fatals,   color: f06Fatals > 0   ? 'text-red-600' : 'text-slate-600' },
              { label: 'F06 Warning', value: f06Warnings, color: f06Warnings > 0 ? 'text-yellow-600' : 'text-slate-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                <div className={`text-lg font-bold ${color}`}>{value}</div>
                <div className="text-[10px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* BDF 다운로드 — 최종본 (RBE2 반영 시 그 버전, 아니면 원본) */}
      {(bdfResult?.bdfPath || uboltBdfResult?.bdfPath || rbeResult?.bdfPath) && (
        <Section label="BDF 다운로드">
          <div className="flex flex-wrap gap-2">
            <DownloadBtn
              path={rbeResult?.bdfPath || bdfResult?.bdfPath}
              label={rbeResult?.bdfPath ? '일반 BDF (Freed, RBE2 반영)' : '일반 BDF (Freed)'}
            />
            <DownloadBtn path={uboltBdfResult?.bdfPath} label="Rigid BDF (U-Bolt 고정)" />
          </div>
        </Section>
      )}
    </div>
  );
}

function DetailReport() {
  return (
    <>
      <Section label="보고서 형식">
        <OptCard>
          {[
            ['Excel (.xlsx) — 응력/변위 테이블', true],
            ['HTML — 인터랙티브 결과 뷰어', true],
            ['Word (.docx) — 공식 보고서 템플릿', false],
          ].map(([label, checked]) => (
            <label key={label} className="flex items-center gap-2 text-sm text-slate-600 py-1 cursor-pointer">
              <input type="checkbox" defaultChecked={checked} className="accent-blue-600 w-3.5 h-3.5" />
              {label}
            </label>
          ))}
        </OptCard>
      </Section>
      <Section label="저장 경로">
        <OptCard>
          <OptRow label="출력 폴더">
            <button className="text-xs px-3 py-1 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer text-slate-600">찾아보기</button>
          </OptRow>
          <OptRow label="파일명 규칙">
            <select className="text-xs px-2 py-1 border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option>케이스번호_날짜</option>
              <option>수동 입력</option>
            </select>
          </OptRow>
        </OptCard>
      </Section>
    </>
  );
}

// ── 공용 소형 컴포넌트 ──────────────────────────────────────────
function Section({ label, children }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      {children}
    </div>
  );
}
function OptCard({ children }) {
  return <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-1 shadow-sm">{children}</div>;
}
function OptRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 whitespace-nowrap">{label}</span>
      {children}
    </div>
  );
}
function StatCard({ num, label, variant }) {
  const numColor = variant === 'good' ? 'text-green-700' : variant === 'warn' ? 'text-amber-600' : 'text-slate-700';
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center shadow-sm">
      <p className={`text-2xl font-bold ${numColor}`}>{num}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}
function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200
        ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200
        ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

// ── 접기/펼치기 섹션 헤더 ──────────────────────────────────────
function CollapseSection({ label, open, onToggle, children, accent }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors
          ${accent === 'amber'
            ? 'bg-amber-50 border border-amber-200 hover:bg-amber-100'
            : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
          }`}
      >
        <span className={`text-[10px] font-bold uppercase tracking-widest ${accent === 'amber' ? 'text-amber-700' : 'text-slate-500'}`}>
          {label}
        </span>
        <span className={`text-[10px] ${accent === 'amber' ? 'text-amber-400' : 'text-slate-400'}`}>
          {open ? '▲ 닫기' : '▼ 펼치기'}
        </span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

// ── CSV 파싱 로그 패널 ──────────────────────────────────────────
function CsvLogPanel({ logData, jobStatus }) {
  const [showWarnings,  setShowWarnings]  = useState(true);
  const [showBuild,     setShowBuild]     = useState(true);
  const [showStru,      setShowStru]      = useState(true);
  const [showConv,      setShowConv]      = useState(true);
  const [showZeroMass,  setShowZeroMass]  = useState(false);
  const [showZeroLen,   setShowZeroLen]   = useState(false);

  // 실행 중 / 대기 중
  if (jobStatus?.status === 'Running' || jobStatus?.status === 'Pending') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 size={28} className="text-blue-500 animate-spin" />
        <p className="text-xs font-semibold text-blue-600">{jobStatus.message}</p>
        <div className="w-48 bg-slate-100 rounded-full h-1.5">
          <div className="h-full bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${jobStatus.progress}%` }} />
        </div>
        <p className="text-[10px] text-slate-300">{jobStatus.progress}%</p>
      </div>
    );
  }

  if (!logData) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-300 px-6 text-center">
        <FileSpreadsheet size={32} className="opacity-30" />
        <p className="text-xs leading-relaxed">
          CSV 파일을 업로드하고 <span className="font-semibold text-violet-400">Model Builder 실행</span>을 누르면<br />파싱 결과가 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  const { parseResult, warnings, buildStats, struSections, feConversion, time } = logData;
  const maxCount  = struSections.length > 0 ? Math.max(...struSections.map(s => s.count)) : 1;
  const isFailed  = jobStatus?.status === 'Failed';
  const warnTotal = warnings.total;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-3 space-y-2">

      {/* ① 상태 배너 */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isFailed ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
        {isFailed
          ? <AlertCircle size={13} className="text-red-600 shrink-0" />
          : <CheckCircle2 size={13} className="text-green-600 shrink-0" />}
        <span className={`text-xs font-bold ${isFailed ? 'text-red-700' : 'text-green-700'}`}>
          {isFailed ? 'CSV 검증 실패' : 'CSV 파싱 & FE 빌드 완료'}
        </span>
        {warnTotal > 0 && (
          <>
            <span className="h-3 w-px bg-slate-200" />
            <AlertCircle size={12} className="text-amber-500 shrink-0" />
            <span className="text-xs text-amber-600 font-medium">경고·누락 {warnTotal}건</span>
          </>
        )}
        {time && <span className="ml-auto text-[10px] font-mono text-slate-400">{time}</span>}
      </div>

      {/* ② CSV 파싱 결과 카드 */}
      {parseResult && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">CSV 파싱 결과</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '구조물 CSV', icon: '🏗️', data: parseResult.stru  },
              { label: '배관 CSV',   icon: '🔧', data: parseResult.pipe  },
              { label: '장비 CSV',   icon: '⚙️', data: parseResult.equip },
            ].map(({ label, icon, data }) => data && (
              <div key={label} className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                <p className="text-[10px] text-slate-400 mb-0.5">{icon} {label}</p>
                <p className="text-lg font-bold text-slate-800 leading-none">{data.ok.toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">/ {data.total.toLocaleString()}행</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] font-medium text-green-600">✓ 성공</span>
                  {data.fail > 0 && <span className="text-[10px] font-medium text-red-500">✗ {data.fail}건</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ③ CSV → FE 변환 요약 */}
      {feConversion && (feConversion.stru || feConversion.pipe || feConversion.equip) && (
        <CollapseSection label="CSV → FE 변환 요약" open={showConv} onToggle={() => setShowConv(v => !v)}>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-3 py-1.5 text-left font-bold text-slate-500">구분</th>
                  <th className="px-3 py-1.5 text-right font-bold text-slate-500">CSV 입력</th>
                  <th className="px-2 py-1.5 text-center text-slate-300">→</th>
                  <th className="px-3 py-1.5 text-right font-bold text-slate-500">FE 생성</th>
                  <th className="px-3 py-1.5 text-right font-bold text-slate-500">차이</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {feConversion.stru && (() => {
                  const diff = feConversion.stru.fe - feConversion.stru.csv;
                  return (
                    <tr key="stru">
                      <td className="px-3 py-1.5 font-semibold text-slate-600">🏗️ 구조 부재</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{feConversion.stru.csv.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center text-slate-300">→</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-700">{feConversion.stru.fe.toLocaleString()}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-blue-500' : 'text-slate-300'}`}>
                        {diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : '—'}
                      </td>
                    </tr>
                  );
                })()}
                {feConversion.pipe && (() => {
                  const diff = feConversion.pipe.fe - feConversion.pipe.csv;
                  return (
                    <tr key="pipe">
                      <td className="px-3 py-1.5 font-semibold text-slate-600">🔧 배관</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{feConversion.pipe.csv.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center text-slate-300">→</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-700">{feConversion.pipe.fe.toLocaleString()}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-blue-500' : 'text-slate-300'}`}>
                        {diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : '—'}
                      </td>
                    </tr>
                  );
                })()}
                {feConversion.equip && (() => {
                  const diff = feConversion.equip.fe - feConversion.equip.csv;
                  return (
                    <tr key="equip">
                      <td className="px-3 py-1.5 font-semibold text-slate-600">⚙️ 장비 (→PointMass)</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{feConversion.equip.csv.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center text-slate-300">→</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-700">{feConversion.equip.fe.toLocaleString()}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-blue-500' : 'text-slate-300'}`}>
                        {diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : '—'}
                      </td>
                    </tr>
                  );
                })()}
                {feConversion.ubolt > 0 && (
                  <tr>
                    <td className="px-3 py-1.5 font-semibold text-slate-600">🔩 U-BOLT</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-500">—</td>
                    <td className="px-2 py-1.5 text-center text-slate-300">→</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-700">{feConversion.ubolt.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-[9px] text-slate-400">2단계 연결</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapseSection>
      )}

      {/* ④ FE 초기 모델 통계 */}
      {buildStats.length > 0 && (
        <CollapseSection label="FE 초기 모델 통계" open={showBuild} onToggle={() => setShowBuild(v => !v)}>
          <div className="grid grid-cols-3 gap-2">
            {buildStats.map(({ label, sub, count }) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-center shadow-sm">
                <p className="text-sm font-bold text-slate-700 leading-none">{count.toLocaleString()}</p>
                <p className="text-[10px] font-semibold text-blue-600 mt-0.5">{label}</p>
                <p className="text-[10px] text-slate-400">{sub}</p>
              </div>
            ))}
          </div>
        </CollapseSection>
      )}

      {/* ⑤ 구조물 단면 분류 */}
      {struSections.length > 0 && (
        <CollapseSection label="구조물 단면 분류" open={showStru} onToggle={() => setShowStru(v => !v)}>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-2 shadow-sm">
            {struSections.map(({ code, name, count }) => (
              <div key={code} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 w-12 shrink-0">{code}</span>
                <span className="text-[10px] text-slate-400 w-16 shrink-0 truncate">{name}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full transition-all duration-700" style={{ width: `${(count / maxCount) * 100}%` }} />
                </div>
                <span className="text-[10px] font-bold text-slate-600 w-10 text-right">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CollapseSection>
      )}

      {/* ⑥ 경고 & 생성 누락 */}
      {warnTotal > 0 && (
        <CollapseSection label={`⚠ 경고 & 생성 누락 (${warnTotal}건)`} accent="amber" open={showWarnings} onToggle={() => setShowWarnings(v => !v)}>
          <div className="space-y-2">

            {/* 파서 경고 */}
            {warnings.parserWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-amber-700 mb-1">[파서 경고] — {warnings.parserWarnings.length}건</p>
                <div className="space-y-0.5 max-h-20 overflow-y-auto custom-scrollbar">
                  {warnings.parserWarnings.map((item, i) => (
                    <p key={i} className="text-[10px] font-mono text-slate-600">{item}</p>
                  ))}
                </div>
              </div>
            )}

            {/* 질량 0 장비 */}
            {warnings.zeroMassEquip.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2.5">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowZeroMass(v => !v)}
                >
                  <p className="text-[10px] font-bold text-yellow-700">
                    ⚠ 질량 0 장비 — {warnings.zeroMassEquip.length}건
                  </p>
                  <span className="text-[9px] text-yellow-500">{showZeroMass ? '▲' : '▼'}</span>
                </button>
                <p className="text-[9px] text-yellow-600 mt-0.5">운용 하중(Op. Mass)이 0인 장비 — 연결은 생성되나 하중 기여 없음</p>
                {showZeroMass && (
                  <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                    {warnings.zeroMassEquip.map((id, i) => (
                      <p key={i} className="text-[10px] font-mono text-slate-500 bg-white/60 rounded px-1.5 py-0.5">{id}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 알 수 없는 배관 타입 */}
            {warnings.unknownTypes.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-orange-700 mb-1.5">
                  [생성 누락] 미지원 배관 타입 — {warnings.unknownTypes.reduce((s, t) => s + t.ids.length, 0)}건
                </p>
                <div className="space-y-1.5">
                  {warnings.unknownTypes.map(({ type, ids }) => (
                    <div key={type} className="bg-white/70 border border-orange-100 rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded font-mono">{type}</span>
                        <span className="text-[10px] text-slate-500">{ids.length}개 요소 생성 취소</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ids.map((id, i) => (
                          <span key={i} className="text-[9px] font-mono text-slate-400 bg-slate-50 border border-slate-100 rounded px-1">{id}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 길이 0 요소 */}
            {warnings.zeroLengthIds.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowZeroLen(v => !v)}
                >
                  <p className="text-[10px] font-bold text-red-700">
                    [생성 누락] 길이 0 요소 (시작 = 끝) — {warnings.zeroLengthIds.length}건
                  </p>
                  <span className="text-[9px] text-red-400">{showZeroLen ? '▲' : '▼'}</span>
                </button>
                <p className="text-[9px] text-red-500 mt-0.5">시작점과 끝점 좌표가 동일하여 요소 생성 불가</p>
                {showZeroLen && (
                  <div className="mt-1.5 flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                    {warnings.zeroLengthIds.map((id, i) => (
                      <span key={i} className="text-[9px] font-mono text-slate-500 bg-white border border-red-100 rounded px-1.5 py-0.5">{id}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 기타 누락 */}
            {warnings.otherOmissions.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-slate-600 mb-1">[생성 누락] 기타 — {warnings.otherOmissions.length}건</p>
                <div className="space-y-0.5 max-h-16 overflow-y-auto custom-scrollbar">
                  {warnings.otherOmissions.map((item, i) => (
                    <p key={i} className="text-[10px] font-mono text-slate-500">{item}</p>
                  ))}
                </div>
              </div>
            )}

          </div>
        </CollapseSection>
      )}

    </div>
  );
}

// ── 단계별 로그 패널 매핑 ───────────────────────────────────────
function DefaultLogPanel({ stepTitle }) {
  return (
    <div className="h-full flex items-center justify-center text-slate-300">
      <p className="text-xs">{stepTitle} 실행 시 로그가 여기에 표시됩니다.</p>
    </div>
  );
}

const LOG_MAP = {
  'csv-validation': CsvLogPanel,
};

const DETAIL_MAP = {
  'csv-validation': DetailCSV,
  'model-qc':       DetailAlgorithm,
  'nastran':        DetailNastran,
};

// ── 메인 컴포넌트 ──────────────────────────────────────────────
export default function HiTessModelBuilder() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});
  const globalJob      = dashboardCtx?.globalJob      || null;
  // 이전 페이지 방문 시 저장된 스냅샷 (있으면 복원, 없으면 초기값)
  const saved = dashboardCtx?.modelBuilderPageState;

  const [changelogOpen, setChangelogOpen] = useState(false);
  const [hasRunOnce,    setHasRunOnce]    = useState(() => saved?.hasRunOnce ?? false);
  const [steps, setSteps]           = useState(() => saved?.steps || INITIAL_STEPS.map(s => ({ ...s })));
  const [activeIdx, setActiveIdx]   = useState(() => saved?.activeIdx ?? 0);
  const [meshSize, setMeshSize]     = useState(() => saved?.meshSize ?? '500');
  const [useNastran,    setUseNastran]    = useState(() => saved?.useNastran    ?? true);
  const [manualRbeMode, setManualRbeMode] = useState(() => saved?.manualRbeMode ?? true);
  const [processLog,    setProcessLog]    = useState(() => saved?.processLog    ?? null);

  // CSV 파일 (DetailCSV에서 lift-up)
  const [struFile,  setStruFile]  = useState(() => saved?.struFile  ?? null);
  const [pipeFile,  setPipeFile]  = useState(() => saved?.pipeFile  ?? null);
  const [equiFile,  setEquiFile]  = useState(() => saved?.equiFile  ?? null);
  // CSV 파일 검증 오류
  const [struError, setStruError] = useState(() => saved?.struError ?? null);
  const [pipeError, setPipeError] = useState(() => saved?.pipeError ?? null);
  const [equiError, setEquiError] = useState(() => saved?.equiError ?? null);

  // 작업 상태
  const [jobStatus,   setJobStatus]   = useState(() => saved?.jobStatus  ?? null);
  const [logData,     setLogData]     = useState(() => saved?.logData    ?? null);
  const [engineLog,   setEngineLog]   = useState(() => saved?.engineLog  ?? null);
  const [bdfResult,   setBdfResult]   = useState(() => saved?.bdfResult  ?? null);
  const pollRef = useRef(null);

  // ── Stage 4 (Nastran) 상태 ──
  const [nastranJobId,  setNastranJobId]  = useState(() => saved?.nastranJobId  ?? null);
  const [nastranStatus, setNastranStatus] = useState(() => saved?.nastranStatus ?? null);
  const [nastranStep1,  setNastranStep1]  = useState(() => saved?.nastranStep1  ?? null);
  const [nastranStep2,  setNastranStep2]  = useState(() => saved?.nastranStep2  ?? null);
  const nastranPollRef = useRef(null);

  // ── U-bolt 재시도 상태 ──
  const [uboltJobId,       setUboltJobId]       = useState(() => saved?.uboltJobId       ?? null);
  const [uboltNastranJobId,setUboltNastranJobId] = useState(() => saved?.uboltNastranJobId ?? null);
  const [uboltBdfResult,   setUboltBdfResult]   = useState(() => saved?.uboltBdfResult   ?? null);
  const [uboltStep1,       setUboltStep1]       = useState(() => saved?.uboltStep1       ?? null);
  const [uboltStep2,       setUboltStep2]       = useState(() => saved?.uboltStep2       ?? null);
  const [uboltRunning,     setUboltRunning]     = useState(() => saved?.uboltRunning     ?? false);
  const uboltPollRef = useRef(null);

  // ── 탭 & 메타 ──
  const [nastranTab,  setNastranTab]  = useState(() => saved?.nastranTab  ?? 'normal');
  const [stage3Meta,  setStage3Meta]  = useState(() => saved?.stage3Meta  ?? null);

  // ── 알고리즘 단계 패널 접힘 상태 ──
  const [algoDetailOpen, setAlgoDetailOpen] = useState(false);
  const [algoStepsOpen,  setAlgoStepsOpen]  = useState(false);

  // ── 수동 RBE2 편집 ──
  const [rbeEditMode,       setRbeEditMode]       = useState(false);
  const [selectedRbeNode,   setSelectedRbeNode]   = useState(null); // { nodeId }
  const [manualRbePairs,    setManualRbePairs]     = useState(() => saved?.manualRbePairs ?? []);
  const [rbeRunning,        setRbeRunning]         = useState(false);
  const [rbeResult,         setRbeResult]          = useState(() => saved?.rbeResult ?? null);
  const [rbeBlockedNodeIds, setRbeBlockedNodeIds]  = useState(() => new Set());
  const rbePollRef = useRef(null);
  const [groupDeleteRunning,    setGroupDeleteRunning]    = useState(false);
  const [groupDeleteSelectMode, setGroupDeleteSelectMode] = useState(() => saved?.groupDeleteSelectMode ?? false);
  const groupDeletePollRef = useRef(null);

  const handleRigidsLoad = useCallback((rigids) => {
    const blocked = new Set();
    Object.values(rigids || {}).forEach(r => {
      if (r.independentNodeId != null) blocked.add(String(r.independentNodeId));
      (r.dependentNodeIds || []).forEach(d => blocked.add(String(d)));
    });
    setRbeBlockedNodeIds(blocked);
  }, []);

  const startGroupDeletePolling = (jobId) => {
    clearInterval(groupDeletePollRef.current);
    groupDeletePollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'Success' && data.json_path) {
          clearInterval(groupDeletePollRef.current);
          setGroupDeleteRunning(false);
          setBdfResult({ bdfPath: data.bdf_path ?? null, jsonPath: data.json_path, connectivityPath: data.connectivity_path ?? null });
          setRbeResult(null);
          setManualRbePairs([]);
          setRbeBlockedNodeIds(new Set());
          // groupDeleteSelectMode는 유지 — 연속 삭제 가능. 종료는 사용자가 헤더 버튼으로 명시적으로 해제.
          showToast('그룹 element 삭제 및 BDF 재생성 완료', 'success');
          // 자동 Nastran 체이닝 없음 — 사용자가 2단계에서 결과 확인 후 "수정 없이 Nastran 실행"으로 명시적 진입
        } else if (data.status === 'Failed') {
          clearInterval(groupDeletePollRef.current);
          setGroupDeleteRunning(false);
          showToast(`그룹 삭제 실패: ${data.message || '알 수 없는 오류'}`, 'error');
        }
      } catch (_) {}
    }, 1500);
  };

  const handleDeleteGroup = useCallback(async (groupId, elementIds, rigidIds) => {
    const sourceBdf = rbeResult?.bdfPath || bdfResult?.bdfPath;
    if (!sourceBdf || !stage3Meta?.work_dir) {
      showToast('삭제할 BDF 경로가 없습니다.', 'warning');
      return;
    }
    const allIds = [...(elementIds || []), ...(rigidIds || [])];
    if (allIds.length === 0) return;
    setGroupDeleteRunning(true);
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/group-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          bdf_path:    sourceBdf,
          work_dir:    stage3Meta.work_dir,
          element_ids: allIds,
          employee_id: user.employee_id || 'unknown',
          source:      'Workbench',
          group_id:    groupId,
        }),
      });
      if (!res.ok) {
        handleUnauthorized?.(res.status);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '그룹 삭제 요청 실패');
      }
      const { job_id } = await res.json();
      startGroupDeletePolling(job_id);
    } catch (e) {
      setGroupDeleteRunning(false);
      showToast(`그룹 삭제 실패: ${e.message}`, 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rbeResult, bdfResult, stage3Meta, useNastran]);

  const _rbeModelReady = !!(bdfResult?.jsonPath || rbeResult?.jsonPath);

  // ── 상태 스냅샷: 렌더마다 갱신 → 언마운트 시 context에 저장 ──
  const snapshotRef = useRef({});
  useEffect(() => {
    snapshotRef.current = {
      hasRunOnce, steps, activeIdx, meshSize, useNastran, manualRbeMode,
      processLog, struFile, pipeFile, equiFile,
      struError, pipeError, equiError,
      jobStatus, logData, engineLog, bdfResult,
      nastranJobId, nastranStatus, nastranStep1, nastranStep2,
      uboltJobId, uboltNastranJobId, uboltBdfResult, uboltStep1, uboltStep2, uboltRunning,
      nastranTab, stage3Meta,
      manualRbePairs, rbeResult, groupDeleteSelectMode,
    };
  });

  // 마운트: 이탈 중 작업이 완료됐으면 최종 결과를 서버에서 한 번 fetch
  // 언마운트: 스냅샷을 context에 저장
  useEffect(() => {
    const gj = dashboardCtx?.globalJob;
    if (saved?.jobStatus?.status === 'Running' && gj?.menu === 'HiTess Model Builder') {
      if (gj.status === 'Success' || gj.status === 'Failed') {
        fetch(`${API_BASE_URL}/api/analysis/status/${gj.jobId}`, { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : Promise.reject(r.status))
          .then(data => {
            setJobStatus(data);
            if (data.status === 'Success') {
              setSteps(prev => prev.map((s, i) => i > 1 ? s : { ...s, status: 'done' }));
              if (data.log_content) setLogData(parseModelBuilderLog(data.log_content));
              if (data.process_log) setProcessLog(data.process_log);
              if (data.bdf_path || data.json_path) setBdfResult({
                bdfPath: data.bdf_path ?? null,
                jsonPath: data.json_path ?? null,
                connectivityPath: data.connectivity_path ?? null,
              });
              if (data.stru_path) setStage3Meta({
                stru_path:  data.stru_path,
                pipe_path:  data.pipe_path  || null,
                equip_path: data.equip_path || null,
                work_dir:   data.work_dir,
              });
            } else if (data.status === 'Failed') {
              setSteps(prev => prev.map((s, i) => i > 1 ? s : { ...s, status: 'error' }));
              setEngineLog(data.engine_log || data.message || '알 수 없는 오류');
            }
          })
          .catch(() => setJobStatus({ status: 'Failed', progress: 0, message: '상태 조회 실패' }));
      } else if (gj.status === 'Running') {
        startPolling(gj.jobId, saved.useNastran ?? false, saved.manualRbeMode ?? false);
      }
    }
    return () => {
      dashboardCtx?.setModelBuilderPageState?.(null);
    };
  }, []);

  const activeStep    = steps[activeIdx];
  const doneCount     = steps.filter(s => s.status === 'done').length;
  const DetailPanel   = DETAIL_MAP[activeStep?.id] ?? (() => null);
  const LogPanel      = LOG_MAP[activeStep?.id] ?? (() => <DefaultLogPanel stepTitle={activeStep?.title} />);
  const isCSVStep       = activeStep?.id === 'csv-validation';
  const isAlgorithmStep = activeStep?.id === 'model-qc';
  const isNastranStep   = activeStep?.id === 'nastran';

  // FATAL 감지: nastranStep2에 fatal 메시지 존재 여부
  const hasFatal = useMemo(() => {
    const msgs = nastranStep2?.f06Summary?.messages || [];
    return msgs.some(m => m.level === 'fatal');
  }, [nastranStep2]);

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (nastranPollRef.current) clearInterval(nastranPollRef.current);
    if (uboltPollRef.current) clearInterval(uboltPollRef.current);
    if (rbePollRef.current) clearInterval(rbePollRef.current);
    if (groupDeletePollRef.current) clearInterval(groupDeletePollRef.current);
  }, []);

  // 폴링 — currentUseNastran: 실행 시점의 useNastran 값 (클로저 캡처)
  const startPolling = (jobId, currentUseNastran, currentManualRbeMode = false) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        setJobStatus(data);

        // 실행 중: 진행률 기반 단계 전환
        if (data.status === 'Running') {
          const p = data.progress || 0;
          setSteps(prev => prev.map((s, i) => {
            if (i === 0) return { ...s, status: p >= 40 ? 'done'    : 'running' };
            if (i === 1) return { ...s, status: p >= 40 ? 'running' : 'wait' };
            return s;
          }));
          if (p >= 40) setActiveIdx(1);
          else setActiveIdx(0);
        }

        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;

          // csv + model-qc 단계 상태 업데이트
          setSteps(prev => prev.map((s, i) => {
            if (i > 1) return s;
            return { ...s, status: data.status === 'Success' ? 'done' : 'error' };
          }));

          if (data.status === 'Success') {
            setActiveIdx(1);
            if (data.bdf_path || data.json_path) {
              setBdfResult({ bdfPath: data.bdf_path ?? null, jsonPath: data.json_path ?? null, connectivityPath: data.connectivity_path ?? null });
            }

            // Stage3 메타 저장 (U-bolt 재시도용)
            if (data.stru_path) {
              setStage3Meta({
                stru_path:  data.stru_path,
                pipe_path:  data.pipe_path  || null,
                equip_path: data.equip_path || null,
                work_dir:   data.work_dir,
              });
            }

            // Nastran 토글 ON + 해석 모델 수정 모드 OFF일 때만 자동 시작
            if (currentUseNastran && !currentManualRbeMode && data.bdf_path && data.work_dir) {
              setSteps(prev => prev.map((s, i) =>
                i === 2 ? { ...s, status: 'running' } : s
              ));
              setActiveIdx(2);
              triggerNastranScan(data.bdf_path, data.work_dir);
            }
          }

          if (data.log_content) {
            setLogData(parseModelBuilderLog(data.log_content));
          }
          if (data.process_log) {
            setProcessLog(data.process_log);
          }
          if (data.status === 'Failed') {
            setEngineLog(data.engine_log || data.message || '알 수 없는 오류');
          }
        }
      } catch (_) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1500);
  };

  // Electron 환경에서 같은 폴더의 CSV를 스캔하여 pipe/equip 자동 배치
  // file.path는 Electron이 File 객체에 추가하는 절대 경로
  // options.skipPipe / options.skipEquip: 이미 사용자가 채운 슬롯은 건드리지 않음
  // 반환값: 자동 배치된 타입 배열 (e.g. ['pipe', 'equip'])
  const scanSiblingCsvs = async (struFile, options = {}) => {
    if (!struFile || !window.electron?.invoke) return []; // 브라우저 환경이면 스킵

    // Electron 32+에서는 webUtils.getPathForFile 사용, 구버전 fallback
    const struPath = window.electron.getPathForFile?.(struFile) || struFile.path || '';
    if (!struPath) return [];

    const dirPath = struPath.replace(/[/\\][^/\\]+$/, ''); // dirname
    let siblings;
    try {
      siblings = await window.electron.invoke('list-dir-csvs', dirPath);
    } catch { return []; }
    if (!siblings?.length) return [];

    const setters = {
      stru:  [setStruFile,  setStruError],
      pipe:  [setPipeFile,  setPipeError],
      equip: [setEquiFile,  setEquiError],
    };

    // stru 파일의 base 이름 추출 (예: 'Ship_stru.csv' → 'ship')
    const struInfo = extractBaseAndKeyword(struFile.name, CSV_TYPE_KEYWORDS.stru);
    const placed = [];

    for (const { name, filePath } of siblings) {
      if (name === struFile.name) continue; // stru 자신은 건너뜀

      // 파일명으로 타입 추측
      const guessed = guessTypeFromFilename(name);
      if (guessed === 'stru') continue; // stru는 건너뜀

      // 파일명으로 감지된 경우 조기 검사
      if (guessed) {
        if (!setters[guessed]) continue;
        if (guessed === 'pipe'  && options.skipPipe)  continue;
        if (guessed === 'equip' && options.skipEquip) continue;
        // base name 매칭: stru 파일과 동일한 base여야 자동 선택
        if (struInfo) {
          const sibInfo = extractBaseAndKeyword(name, CSV_TYPE_KEYWORDS[guessed] || []);
          if (sibInfo && sibInfo.base !== struInfo.base) continue; // base 불일치면 스킵
        }
      } else {
        // 파일명 키워드 미매칭 — base name 포함 여부로 안전 필터링
        if (struInfo && !name.toLowerCase().includes(struInfo.base)) continue;
      }

      // Electron IPC로 파일 내용 읽기 → File 객체 생성
      let buffer;
      try { buffer = await window.electron.invoke('read-file-buffer', filePath); } catch { continue; }
      if (!buffer) continue;

      const siblingFile = new File([buffer], name, { type: 'text/csv' });

      // 헤더 검증: guessed가 있으면 일치 확인, 없으면 헤더만으로 결정
      let headerType = null;
      try { headerType = await detectCsvType(siblingFile); } catch { /* skip */ }
      const finalType = headerType || guessed;
      if (!finalType || finalType === 'stru') continue;
      if (!setters[finalType]) continue;
      // 파일명 추측과 헤더가 둘 다 있는데 다르면 스킵 (신뢰도 낮음)
      if (guessed && headerType && guessed !== headerType) continue;

      // 헤더로 결정된 타입에도 skip 옵션 적용
      if (finalType === 'pipe'  && options.skipPipe)  continue;
      if (finalType === 'equip' && options.skipEquip) continue;

      const [setFile, setErrFn] = setters[finalType] || [];
      if (setFile) {
        setFile(siblingFile);
        if (setErrFn) setErrFn(null);
        placed.push(finalType);
      }
    }

    return placed;
  };

  // CSV 파일 자동 분류 + 2단계 헤더 검증
  // slotHint: 사용자가 드롭한 존('stru'|'pipe'|'equip')
  const handleAutoAssign = async (file, slotHint) => {
    // stru 배치 전 다른 슬롯 현황 스냅샷 (나중에 skipPipe/skipEquip 판단에 사용)
    const prevPipe  = pipeFile;
    const prevEquip = equiFile;

    // 1단계: 파일명으로 실제 유형 추측
    const guessed = guessTypeFromFilename(file.name);

    // 파일명 힌트와 드롭 존이 다르면 경고 후 자동 재배치
    const effectiveType = guessed || slotHint; // 추측 불가 시 드롭 존 기준

    // 2단계: CSV 헤더 읽어 유형 검증
    let headerType = null;
    try {
      headerType = await detectCsvType(file);
    } catch (_) {
      // 헤더 읽기 실패 시 파일명 기준으로 진행
    }

    // 최종 결정: 헤더 유형 > 파일명 유형 > 드롭 존 기준
    const finalType = headerType || guessed || slotHint;

    // 드롭 존과 최종 유형이 다를 때 경고 생성
    const makeError = (slot, actual) => {
      if (!actual || slot === actual) return null;
      const labels = { stru: 'Structural', pipe: 'Piping', equip: 'Equipment' };
      return `${labels[actual] ?? actual} CSV로 감지됨. 올바른 칸에 배치되었습니다.`;
    };

    // 이전 같은 유형 슬롯 초기화 후 최종 유형 슬롯에 배치
    const setters = {
      stru:  [setStruFile,  setStruError],
      pipe:  [setPipeFile,  setPipeError],
      equip: [setEquiFile,  setEquiError],
    };

    // 헤더 기반 타입이 확정됐고 드롭 존과 다르면 → 경고와 함께 올바른 슬롯으로 이동
    if (finalType !== slotHint) {
      // 드롭 존 슬롯은 초기화
      const [, setErr] = setters[slotHint] || [];
      if (setErr) setErr(null);

      // 올바른 슬롯에 배치
      const [setFile, setErr2] = setters[finalType] || [];
      if (setFile) {
        setFile(file);
        // 드롭 존이 달랐음을 표시
        if (setErr2) setErr2(makeError(slotHint, finalType));
      } else {
        // 알 수 없는 유형 → 드롭 존에 그냥 배치 + 경고
        const [setFileSlot, setErrSlot] = setters[slotHint] || [];
        if (setFileSlot) { setFileSlot(file); }
        if (setErrSlot)  { setErrSlot('파일 유형을 자동 인식할 수 없습니다. CSV 구조를 확인하세요.'); }
      }
    } else {
      // 드롭 존과 유형 일치 → 정상 배치
      const [setFile, setErr] = setters[slotHint] || [];
      if (setFile) setFile(file);
      // 헤더 감지 성공 시 에러 없음, 실패 시 경고
      if (setErr) {
        if (headerType && headerType === slotHint) {
          setErr(null);
        } else if (!headerType && guessed === slotHint) {
          setErr(null);
        } else if (!headerType && !guessed) {
          // 헤더·파일명 모두 인식 불가 → 경고만 표시 (실행은 차단하지 않음)
          setErr('__warn__CSV 헤더/파일명 자동 인식 불가. 올바른 파일인지 확인하세요.');
        } else {
          setErr(null);
        }
      }
    }

    // stru 파일 확정 시 동일 폴더의 pipe/equip 형제 CSV 자동 배치
    if (finalType === 'stru') {
      const placed = await scanSiblingCsvs(file, {
        skipPipe:  !!prevPipe,
        skipEquip: !!prevEquip,
      });
      if (placed.length > 0) {
        showToast(`동일 폴더에서 CSV ${placed.length}개를 자동 배치했습니다.`, 'success');
      }
    }
  };

  // 여러 CSV 파일 일괄 자동 분류 (stru 존에서 여러 파일 선택 시 호출)
  const handleMultipleFiles = async (files) => {
    let assignedStru = null;
    // 각 파일을 분류 (파일명·헤더 기반)
    for (const file of files) {
      let headerType = null;
      try { headerType = await detectCsvType(file); } catch (_) {}
      const guessed   = guessTypeFromFilename(file.name);
      const finalType = headerType || guessed;

      if (!finalType) continue;

      const setters = {
        stru:  [setStruFile,  setStruError],
        pipe:  [setPipeFile,  setPipeError],
        equip: [setEquiFile,  setEquiError],
      };
      const [setFile, setErr] = setters[finalType] || [];
      if (setFile) {
        setFile(file);
        if (setErr) setErr(null);
        if (finalType === 'stru') assignedStru = file;
      }
    }

    // stru가 포함됐고 빈 슬롯이 있으면 형제 CSV 자동 감지
    if (assignedStru) {
      const placed = await scanSiblingCsvs(assignedStru, {
        skipPipe:  !!pipeFile,
        skipEquip: !!equiFile,
      });
      if (placed.length > 0) {
        showToast(`동일 폴더에서 CSV ${placed.length}개를 자동 배치했습니다.`, 'success');
      }
    }
  };

  // Model Builder 실행 (전체 파이프라인 한 번에)
  const handleRunModelBuilder = async () => {
    if (!struFile) { showToast('Structural CSV 파일이 필요합니다.', 'warning'); return; }
    // __warn__ 접두어는 경고(황색) 표시용 — 실행 차단 대상 아님
    const isHardError = (e) => e && !e.startsWith('__warn__');
    if (isHardError(struError) || isHardError(pipeError) || isHardError(equiError)) {
      showToast('파일 형식 오류를 먼저 해결하세요.', 'warning'); return;
    }
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // ── 진단 로그 ──────────────────────────────────────────────
    const authHeaders = getAuthHeaders();
    console.group('[ModelBuilder] 요청 진단');
    console.log('서버 URL :', API_BASE_URL);
    console.log('Auth 헤더 :', authHeaders);
    console.log('user (localStorage) :', user);
    console.log('struFile :', struFile?.name, struFile?.size, 'bytes');
    console.log('pipeFile :', pipeFile?.name ?? '없음');
    console.log('equiFile :', equiFile?.name ?? '없음');
    console.groupEnd();
    // ────────────────────────────────────────────────────────────

    const formData = new FormData();
    formData.append('stru_file', struFile);
    if (pipeFile) formData.append('pipe_file', pipeFile);
    if (equiFile) formData.append('equip_file', equiFile);
    formData.append('employee_id', user.employee_id || 'unknown');
    formData.append('stop_mode', '7');
    formData.append('mesh_size', meshSize || '500');
    formData.append('csvdebug', 'true');
    formData.append('femodeldebug', 'true');
    formData.append('pipelinedebug', 'true');
    formData.append('spc_z_band', '-1');
    setHasRunOnce(true);

    // 상태 초기화
    setActiveIdx(0);
    setLogData(null);
    setBdfResult(null);
    if (nastranPollRef.current) { clearInterval(nastranPollRef.current); nastranPollRef.current = null; }
    if (uboltPollRef.current)   { clearInterval(uboltPollRef.current);   uboltPollRef.current   = null; }
    setNastranJobId(null); setNastranStatus(null);
    setNastranStep1(null); setNastranStep2(null);
    setUboltJobId(null); setUboltNastranJobId(null);
    setUboltBdfResult(null); setUboltStep1(null); setUboltStep2(null);
    setUboltRunning(false); setNastranTab('normal'); setStage3Meta(null);
    setSteps(prev => prev.map((s, i) => {
      if (i === 0) return { ...s, status: 'running' };
      return { ...s, status: 'wait' };
    }));
    setJobStatus({ status: 'Running', progress: 10, message: '파일 전송 중...' });

    try {
      const res  = await fetch(`${API_BASE_URL}/api/analysis/modelflow/request`, { method: 'POST', body: formData, headers: getAuthHeaders() });
      if (!res.ok) {
        handleUnauthorized(res.status);
        let detail = `HTTP ${res.status}`;
        try { const b = await res.json(); detail += ` — ${b.detail ?? JSON.stringify(b)}`; } catch {}
        throw new Error(detail);
      }
      const data = await res.json();
      startPolling(data.job_id, useNastran, manualRbeMode);
      startGlobalJob(data.job_id, 'HiTess Model Builder');
    } catch (e) {
      setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error' } : s));
      setJobStatus({ status: 'Failed', progress: 0, message: `서버 연결 실패: ${e.message}` });
      setEngineLog(`[요청 실패]\n서버: ${API_BASE_URL}\n오류: ${e.message}`);
    }
  };

  const goStep = (idx) => {
    if (idx < 0 || idx >= steps.length) return;
    setActiveIdx(idx);
  };

  // 전체 초기화 — 모든 상태를 최초 진입 상태로 복원
  const handleReset = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (nastranPollRef.current) { clearInterval(nastranPollRef.current); nastranPollRef.current = null; }
    if (uboltPollRef.current) { clearInterval(uboltPollRef.current); uboltPollRef.current = null; }
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setActiveIdx(0);
    setMeshSize('500');
    setUseNastran(true);
    setManualRbeMode(true);
    setProcessLog(null);
    setStruFile(null);
    setPipeFile(null);
    setEquiFile(null);
    setStruError(null);
    setPipeError(null);
    setEquiError(null);
    setJobStatus(null);
    setLogData(null);
    setEngineLog(null);
    setBdfResult(null);
    // Stage 4 초기화
    setNastranJobId(null);
    setNastranStatus(null);
    setNastranStep1(null);
    setNastranStep2(null);
    setUboltJobId(null);
    setUboltNastranJobId(null);
    setUboltBdfResult(null);
    setUboltStep1(null);
    setUboltStep2(null);
    setUboltRunning(false);
    setNastranTab('normal');
    setStage3Meta(null);
    setHasRunOnce(false);
    setRbeEditMode(false);
    setSelectedRbeNode(null);
    setManualRbePairs([]);
    setRbeRunning(false);
    setRbeResult(null);
    setRbeBlockedNodeIds(new Set());
    if (rbePollRef.current) { clearInterval(rbePollRef.current); rbePollRef.current = null; }
    setGroupDeleteRunning(false);
    setGroupDeleteSelectMode(false);
    if (groupDeletePollRef.current) { clearInterval(groupDeletePollRef.current); groupDeletePollRef.current = null; }
    dashboardCtx?.clearGlobalJob?.();
  };

  // ── Stage 4: Nastran 해석 함수들 ──────────────────────────────

  // validation JSON 파일을 /api/download 엔드포인트로 fetch하여 파싱
  const loadValidationJsons = async (resultInfo, target) => {
    const [setS1, setS2] = target === 'normal'
      ? [setNastranStep1, setNastranStep2]
      : [setUboltStep1,   setUboltStep2];

    for (const [key, path] of Object.entries(resultInfo)) {
      if (!path || typeof path !== 'string') continue;
      try {
        const res = await fetch(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(path)}`, { headers: getAuthHeaders() });
        if (!res.ok) continue;
        const text = await res.text();
        const parsed = JSON.parse(text);
        if (key === 'JSON_Validation') setS1(parsed);
        else if (key === 'JSON_F06Summary') setS2(parsed);
      } catch { /* skip */ }
    }
  };

  // BdfScanner 결과 폴링
  const startNastranPolling = (jobId) => {
    if (nastranPollRef.current) clearInterval(nastranPollRef.current);
    nastranPollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        setNastranStatus(data);
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(nastranPollRef.current);
          nastranPollRef.current = null;
          setSteps(prev => prev.map((s, i) =>
            i === 2 ? { ...s, status: data.status === 'Success' ? 'done' : 'error' } : s
          ));
          if (data.status === 'Success' && data.project?.result_info) {
            await loadValidationJsons(data.project.result_info, 'normal');
          }
        }
      } catch {
        clearInterval(nastranPollRef.current);
        nastranPollRef.current = null;
      }
    }, 1500);
  };

  // Stage 4 BdfScanner 실행 요청
  const triggerNastranScan = async (bdfPath, workDir) => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const body = new URLSearchParams({
      bdf_path:    bdfPath,
      work_dir:    workDir,
      employee_id: user.employee_id || 'unknown',
    });
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/nastran-request`, {
        method: 'POST', body, headers: getAuthHeaders(),
      });
      if (!res.ok) { handleUnauthorized(res.status); throw new Error(`HTTP ${res.status}`); }
      const data = await res.json();
      setNastranJobId(data.job_id);
      startNastranPolling(data.job_id);
    } catch (e) {
      setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'error' } : s));
      setNastranStatus({ status: 'Failed', message: `Nastran 요청 실패: ${e.message}` });
    }
  };

  // U-bolt BdfScanner 결과 폴링
  const startUboltNastranPolling = (jobId) => {
    if (uboltPollRef.current) clearInterval(uboltPollRef.current);
    uboltPollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(uboltPollRef.current);
          uboltPollRef.current = null;
          setUboltRunning(false);
          if ((data.status === 'Success' || data.status === 'Failed') && data.project?.result_info) {
            await loadValidationJsons(data.project.result_info, 'rigid');
            setNastranTab('rigid'); // step1이라도 존재하면 rigid 탭으로 전환
          }
        }
      } catch {
        clearInterval(uboltPollRef.current);
        uboltPollRef.current = null;
        setUboltRunning(false);
      }
    }, 1500);
  };

  // U-bolt Model Builder 결과 폴링 (BDF 재생성 완료 후 BdfScanner 체이닝)
  const startUboltModelflowPolling = (jobId) => {
    if (uboltPollRef.current) clearInterval(uboltPollRef.current);
    uboltPollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(uboltPollRef.current);
          uboltPollRef.current = null;
          if (data.status === 'Success' && data.bdf_path) {
            setUboltBdfResult({ bdfPath: data.bdf_path ?? null, jsonPath: data.json_path ?? null });
            // BdfScanner --nastran 체이닝
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const body = new URLSearchParams({
              bdf_path:    data.bdf_path,
              work_dir:    data.work_dir,
              employee_id: user.employee_id || 'unknown',
            });
            try {
              const scanRes = await fetch(`${API_BASE_URL}/api/analysis/modelflow/nastran-request`, {
                method: 'POST', body, headers: getAuthHeaders(),
              });
              if (scanRes.ok) {
                const scanData = await scanRes.json();
                setUboltNastranJobId(scanData.job_id);
                startUboltNastranPolling(scanData.job_id);
              } else {
                setUboltRunning(false);
              }
            } catch {
              setUboltRunning(false);
            }
          } else {
            setUboltRunning(false);
          }
        }
      } catch {
        clearInterval(uboltPollRef.current);
        uboltPollRef.current = null;
        setUboltRunning(false);
      }
    }, 1500);
  };

  // 수동 RBE2 노드 픽킹 핸들러
  const handleNodePick = (nodeId) => {
    if (rbeBlockedNodeIds.has(String(nodeId))) {
      showToast(`Node ${nodeId}는 기존 RBE2 요소를 구성하는 노드입니다. 선택할 수 없습니다.`, 'warning');
      if (selectedRbeNode) setSelectedRbeNode(null);
      return;
    }
    if (!selectedRbeNode) {
      setSelectedRbeNode({ nodeId });
      showToast(`Node ${nodeId} 선택됨. 연결할 두 번째 노드를 클릭하세요.`, 'info');
    } else {
      if (String(nodeId) === String(selectedRbeNode.nodeId)) {
        showToast('같은 노드를 두 번 선택할 수 없습니다.', 'warning');
        setSelectedRbeNode(null);
        return;
      }
      const alreadyExists = manualRbePairs.some(
        p => (String(p.indep) === String(selectedRbeNode.nodeId) && String(p.dep) === String(nodeId)) ||
             (String(p.indep) === String(nodeId) && String(p.dep) === String(selectedRbeNode.nodeId))
      );
      if (alreadyExists) {
        showToast('이미 등록된 노드 조합입니다.', 'warning');
        setSelectedRbeNode(null);
        return;
      }
      setManualRbePairs(prev => [...prev, { indep: selectedRbeNode.nodeId, dep: nodeId, dof: '123456' }]);
      setSelectedRbeNode(null);
      showToast(`RBE2 페어 추가: Node ${selectedRbeNode.nodeId} ↔ Node ${nodeId}`, 'success');
    }
  };

  // RBE retry 폴링 (BdfScanner 완료 후 rbeResult 세팅)
  const startRbePolling = (jobId) => {
    if (rbePollRef.current) clearInterval(rbePollRef.current);
    rbePollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`, { headers: getAuthHeaders() });
        if (!res.ok) { handleUnauthorized(res.status); return; }
        const data = await res.json();
        if (data.status === 'Success' || data.status === 'Failed') {
          clearInterval(rbePollRef.current);
          rbePollRef.current = null;
          setRbeRunning(false);
          if (data.status === 'Success' && data.json_path) {
            setRbeResult({ bdfPath: data.bdf_path ?? null, jsonPath: data.json_path, connectivityPath: data.connectivity_path ?? null });
            setManualRbePairs([]);
            setSelectedRbeNode(null);
            setRbeEditMode(false);
            showToast('RBE2 페어가 BDF에 반영되어 모델이 업데이트됐습니다.', 'success');
            // rbe-retry BDF는 서브폴더(rbe_retry_{ts}/)에 있으므로 data.work_dir을 우선 사용
            const chainWorkDir = data.work_dir || stage3Meta?.work_dir;
            if (useNastran && data.bdf_path && chainWorkDir) {
              setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'running' } : s));
              setActiveIdx(2);
              triggerNastranScan(data.bdf_path, chainWorkDir);
            }
          } else {
            showToast('RBE2 BDF 재생성 실패: ' + (data.message || '오류'), 'error');
          }
        }
      } catch {
        clearInterval(rbePollRef.current);
        rbePollRef.current = null;
        setRbeRunning(false);
      }
    }, 1500);
  };

  const handleSkipRbeRunNastran = () => {
    if (!bdfResult?.bdfPath || !stage3Meta?.work_dir) return;
    setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, status: 'running' } : s));
    setActiveIdx(2);
    triggerNastranScan(bdfResult.bdfPath, stage3Meta.work_dir);
  };

  const handleApplyRbePairs = async () => {
    // 이미 재생성된 BDF가 있으면 그 위에 추가 적용 (반복 수행 지원)
    const sourceBdf = rbeResult?.bdfPath || bdfResult?.bdfPath;
    if (!sourceBdf || !stage3Meta?.work_dir || manualRbePairs.length === 0) return;
    setRbeRunning(true);
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/rbe-retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          bdf_path:    sourceBdf,
          work_dir:    stage3Meta.work_dir,
          pairs:       manualRbePairs,
          employee_id: user.employee_id || 'unknown',
        }),
      });
      if (!res.ok) { handleUnauthorized(res.status); throw new Error(`HTTP ${res.status}`); }
      const data = await res.json();
      startRbePolling(data.job_id);
    } catch {
      setRbeRunning(false);
      showToast('RBE2 재생성 요청 실패', 'error');
    }
  };

  // U-bolt 재시도 핸들러
  const handleUboltRetry = async () => {
    if (!stage3Meta) return;
    setUboltRunning(true);
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const body = new URLSearchParams();
    body.append('stru_path',   stage3Meta.stru_path);
    body.append('work_dir',    stage3Meta.work_dir);
    body.append('employee_id', user.employee_id || 'unknown');
    if (stage3Meta.pipe_path)  body.append('pipe_path',  stage3Meta.pipe_path);
    if (stage3Meta.equip_path) body.append('equip_path', stage3Meta.equip_path);
    try {
      const res = await fetch(`${API_BASE_URL}/api/analysis/modelflow/ubolt-retry`, {
        method: 'POST', body, headers: getAuthHeaders(),
      });
      if (!res.ok) { handleUnauthorized(res.status); throw new Error(`HTTP ${res.status}`); }
      const data = await res.json();
      setUboltJobId(data.job_id);
      startUboltModelflowPolling(data.job_id);
    } catch {
      setUboltRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-brand-blue-dark to-blue-700 overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentMenu('File-Based Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <UploadCloud size={20} className="opacity-80" />
                HiTess Model Builder
              </h1>
              <p className="text-sm text-blue-200/80 mt-0.5">CSV부터 Nastran 해석까지 FEM 파이프라인 전 과정을 관리합니다.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              <History size={14} /> 이력
            </button>
            <GuideButton guideTitle="[파일] HiTess Model Builder — CSV→BDF→Nastran FEM 파이프라인" variant="dark" />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 gap-5 min-h-0">

        {/* ── Left Panel ── */}
        <div className="w-96 shrink-0 flex flex-col gap-3">

          {/* 스텝퍼 */}
          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">파이프라인</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3">
              {steps.map((step, idx) => {
                const StepIcon       = step.icon;
                const effectiveStatus = (step.id === 'nastran' && !useNastran && step.status === 'wait') ? 'disabled' : step.status;
                const cfg            = STATUS_CONFIG[effectiveStatus];
                const isActive       = idx === activeIdx;
                const isLast   = idx === steps.length - 1;

                return (
                  <div key={step.id} className="flex items-stretch">

                    {/* ① 타임라인: dot + 수직선 */}
                    <div className="flex flex-col items-center w-7 shrink-0 pt-4">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${cfg.dot}`} />
                      {!isLast && (
                        <div className="flex-1 w-0.5 my-1 transition-colors duration-300 rounded-full bg-violet-400" />
                      )}
                    </div>

                    {/* ② 스텝 카드 */}
                    <div
                      className={`flex-1 mb-2 ml-2 rounded-xl border px-3.5 py-3 transition-all duration-200 cursor-pointer
                        ${effectiveStatus === 'disabled'
                          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-default'
                          : isActive
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      onClick={() => effectiveStatus !== 'disabled' && goStep(idx)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <StepIcon size={13} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                          <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                            {idx + 1}. {step.title}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap ${cfg.badge}`}>
                          {effectiveStatus === 'disabled' ? '비활성' : isActive && step.status === 'wait' ? '선택됨' : cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 pl-5">{step.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 실행 버튼 푸터 */}
            <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
              <button
                onClick={handleRunModelBuilder}
                disabled={jobStatus?.status === 'Running' || jobStatus?.status === 'Pending'}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-blue-dark active:bg-brand-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                {(jobStatus?.status === 'Running' || jobStatus?.status === 'Pending')
                  ? <><Loader2 size={15} className="animate-spin" /> 실행 중...</>
                  : <><ChevronsRight size={16} /> Model Builder 실행</>
                }
              </button>
              <button
                onClick={handleReset}
                disabled={!hasRunOnce || jobStatus?.status === 'Running' || jobStatus?.status === 'Pending'}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>

          {/* ── 해석 설정 패널 ── */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">해석 공통 설정</p>
            <div className="space-y-3">
              {/* Mesh Size */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-700">Mesh Size</p>
                  <p className="text-[10px] text-slate-400">기본 요소 크기 (mm)</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={meshSize}
                    onChange={(e) => setMeshSize(e.target.value)}
                    step="10"
                    min="10"
                    className="w-24 text-right text-xs px-2 py-1.5 border border-slate-200 bg-white text-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors cursor-text"
                  />
                  <span className="text-xs text-slate-400">mm</span>
                </div>
              </div>
              <div className="h-px bg-slate-100" />
              {/* 해석 모델 수정 토글 */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-700">해석 모델 수정</p>
                  <p className="text-[10px] text-slate-400">Model Builder 완료 후 2단계에서 RBE 연결 · Group 삭제 수행</p>
                </div>
                <Toggle checked={manualRbeMode} onChange={setManualRbeMode} />
              </div>
              {manualRbeMode && useNastran && (
                <div className="text-[10px] px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-700">
                  수정 완료 후 BDF 재생성을 클릭하면 Nastran이 자동 실행됩니다.
                </div>
              )}
              {manualRbeMode && !useNastran && (
                <div className="text-[10px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500">
                  Model Builder 완료 후 2단계에서 모델 수정 및 BDF 재생성을 수행합니다.
                </div>
              )}
              <div className="h-px bg-slate-100" />
              {/* Nastran 검증 토글 */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-700">Nastran을 통한 검증</p>
                  <p className="text-[10px] text-slate-400">Model Builder 완료 후 Nastran 검증 실행</p>
                </div>
                <Toggle checked={useNastran} onChange={setUseNastran} />
              </div>
              {useNastran && !manualRbeMode && (
                <div className="text-[10px] px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-blue-600">
                  BDF 생성 완료 후 Nastran 검증 절차가 자동으로 시작됩니다.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">

          {/* 상단: 단계 설정 패널 (알고리즘 단계에서는 별도 collapsible로 대체) */}
          {!isAlgorithmStep && (
            <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-700">{activeIdx + 1}. {activeStep.title}</h2>
                {activeStep.sub && <span className="text-[10px] text-slate-400">— {activeStep.sub}</span>}
              </div>
              <div className="p-4">
                {isCSVStep
                  ? <DetailCSV
                      struFile={struFile} setStruFile={setStruFile}
                      pipeFile={pipeFile} setPipeFile={setPipeFile}
                      equiFile={equiFile} setEquiFile={setEquiFile}
                      struError={struError} setStruError={setStruError}
                      pipeError={pipeError} setPipeError={setPipeError}
                      equiError={equiError} setEquiError={setEquiError}
                      onAutoAssign={handleAutoAssign}
                      onMultipleFiles={handleMultipleFiles}
                    />
                  : isNastranStep
                  ? <DetailNastran
                      nastranStatus={nastranStatus}
                      nastranStep1={nastranStep1}
                      nastranStep2={nastranStep2}
                      bdfResult={bdfResult}
                      uboltBdfResult={uboltBdfResult}
                      rbeResult={rbeResult}
                      uboltStep1={uboltStep1}
                      uboltStep2={uboltStep2}
                      uboltRunning={uboltRunning}
                      hasFatal={hasFatal}
                      stage3Meta={stage3Meta}
                      nastranTab={nastranTab}
                      setNastranTab={setNastranTab}
                      onUboltRetry={handleUboltRetry}
                    />
                  : <DetailPanel />
                }
              </div>
            </div>
          )}

          {/* CSV 단계: 파싱 로그가 전체 남은 공간 차지 (3D 뷰어 숨김) */}
          {isCSVStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">파싱 결과 로그</span>
                <div className="flex items-center gap-2">
                  {jobStatus?.status === 'Success' && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">완료</span></>}
                  {jobStatus?.status === 'Failed'  && <><div className="w-1.5 h-1.5 rounded-full bg-red-400"   /><span className="text-[10px] text-red-400">실패</span></>}
                  {(jobStatus?.status === 'Running' || jobStatus?.status === 'Pending') && <><Loader2 size={11} className="animate-spin text-blue-500" /><span className="text-[10px] text-blue-500">실행 중</span></>}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <CsvLogPanel logData={logData} jobStatus={jobStatus} />
              </div>
            </div>
          )}

          {/* 알고리즘 단계: 모델 알고리즘 적용(collapsible) + 단계별 검사 결과(collapsible) + 3D 뷰어(flex-1) */}
          {isAlgorithmStep && (
            <>
              {/* 모델 알고리즘 적용 (접기/펼치기, 기본 접힘) */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setAlgoDetailOpen(v => !v)}
                  className="flex items-center justify-between px-4 py-2.5 w-full text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold text-slate-700">{activeIdx + 1}. {activeStep.title}</h2>
                    {activeStep.sub && <span className="text-[10px] text-slate-400">— {activeStep.sub}</span>}
                  </div>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${algoDetailOpen ? 'rotate-180' : ''}`} />
                </button>
                {algoDetailOpen && (
                  <div className="border-t border-slate-100 p-4">
                    <DetailAlgorithm jobStatus={jobStatus} logData={logData} />
                  </div>
                )}
              </div>

              {/* 단계별 검사 결과 (접기/펼치기, 기본 접힘) */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setAlgoStepsOpen(v => !v)}
                  className="flex items-center justify-between px-4 py-2.5 w-full text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">단계별 검사 결과</span>
                    {jobStatus?.status === 'Success' && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">완료</span></>}
                    {jobStatus?.status === 'Failed'  && <><div className="w-1.5 h-1.5 rounded-full bg-red-400"   /><span className="text-[10px] text-red-400">실패</span></>}
                    {(jobStatus?.status === 'Running' || jobStatus?.status === 'Pending') && <><Loader2 size={11} className="animate-spin text-blue-400" /><span className="text-[10px] text-blue-400">실행 중</span></>}
                  </div>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${algoStepsOpen ? 'rotate-180' : ''}`} />
                </button>
                {algoStepsOpen && (
                  <div className="border-t border-slate-100 overflow-y-auto" style={{ maxHeight: '240px' }}>
                    <AlgorithmLogPanel logData={logData} jobStatus={jobStatus} processLog={processLog} engineLog={engineLog} />
                  </div>
                )}
              </div>

              {/* 3D 뷰어 (나머지 공간 전부) */}
              <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">3D 모델 뷰어</span>
                    {rbeResult && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">RBE2 반영됨</span>}
                    {(rbeResult?.bdfPath || bdfResult?.bdfPath) && (
                      <button
                        onClick={() => triggerBlobDownload(rbeResult?.bdfPath || bdfResult.bdfPath)}
                        className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors cursor-pointer"
                        title={(rbeResult?.bdfPath || bdfResult?.bdfPath).split(/[\\/]/).pop()}
                      >
                        <Download size={10} />
                        {rbeResult?.bdfPath ? 'BDF 다운로드 (RBE2 반영)' : 'BDF 다운로드'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 모델 수정 모드 버튼 — manualRbeMode=ON일 때 RBE연결/Group삭제 버튼 2종, OFF일 때 RBE연결 단독 */}
                    {(bdfResult?.jsonPath || rbeResult?.jsonPath) && (
                      <>
                        <button
                          onClick={() => {
                            const next = !rbeEditMode;
                            setRbeEditMode(next);
                            if (!next) setSelectedRbeNode(null);
                            if (next) setGroupDeleteSelectMode(false);
                          }}
                          title={rbeEditMode ? 'RBE 연결 모드 종료' : '노드를 클릭해 RBE2 페어를 추가합니다'}
                          className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                            rbeEditMode
                              ? 'bg-amber-500 text-white border-amber-400'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-600'
                          }`}
                        >
                          {rbeEditMode ? '● RBE 연결 중' : 'RBE 연결'}
                        </button>
                        {manualRbeMode && (
                          <button
                            onClick={() => {
                              const next = !groupDeleteSelectMode;
                              setGroupDeleteSelectMode(next);
                              if (next) { setRbeEditMode(false); setSelectedRbeNode(null); }
                            }}
                            title={groupDeleteSelectMode ? 'Group 삭제 모드 종료' : 'Connectivity 패널에서 그룹을 선택해 삭제합니다'}
                            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                              groupDeleteSelectMode
                                ? 'bg-red-500 text-white border-red-400'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-red-300 hover:text-red-600'
                            }`}
                          >
                            {groupDeleteSelectMode ? '● Group 삭제 중' : 'Group 삭제'}
                          </button>
                        )}
                        {manualRbeMode && useNastran && !rbeRunning && !groupDeleteRunning &&
                         manualRbePairs.length === 0 && !rbeEditMode && !groupDeleteSelectMode && (
                          <button
                            onClick={handleSkipRbeRunNastran}
                            title="현재 BDF로 Nastran 해석을 바로 실행합니다"
                            className="text-[11px] font-bold px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg border border-blue-400 transition-colors cursor-pointer"
                          >
                            Nastran 실행
                          </button>
                        )}
                      </>
                    )}
                    {bdfResult?.jsonPath
                      ? <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">모델 준비됨</span></>
                      : jobStatus?.status === 'Running' || jobStatus?.status === 'Pending'
                      ? <><Loader2 size={11} className="animate-spin text-blue-400" /><span className="text-[10px] text-blue-400">알고리즘 실행 중...</span></>
                      : <><div className="w-1.5 h-1.5 rounded-full bg-slate-300" /><span className="text-[10px] text-slate-400">알고리즘 실행 대기</span></>
                    }
                  </div>
                </div>

                {/* ── RBE 통합 액션 바 ─────────────────────────────────────────── */}
                {/* 편집 모드 활성 또는 페어 등록 시에만 표시 */}
                {(rbeEditMode || manualRbePairs.length > 0) && (
                  <div className="shrink-0 bg-amber-50 border-b border-amber-100">
                    {/* 상태 행 */}
                    <div className="px-4 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${rbeEditMode ? 'bg-amber-500 animate-pulse' : 'bg-amber-300'}`} />
                          <p className="text-[11px] font-bold text-amber-800 leading-tight">
                            {rbeEditMode
                              ? selectedRbeNode
                                ? `Node ${selectedRbeNode.nodeId} 선택됨 — 두 번째 노드를 클릭하세요 (다른 그룹)`
                                : 'RBE 편집 중 — 뷰어에서 연결할 첫 번째 노드(빨간 구체)를 클릭하세요'
                              : `RBE2 페어 ${manualRbePairs.length}개 등록됨 — BDF 재생성을 클릭하세요`
                            }
                          </p>
                        </div>
                        {!selectedRbeNode && manualRbePairs.length === 0 && useNastran && rbeEditMode && (
                          <p className="text-[10px] text-amber-600 mt-0.5 ml-4">
                            페어 등록 완료 후 BDF 재생성 클릭 → Nastran 자동 실행
                          </p>
                        )}
                      </div>
                      {/* 액션 버튼 */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {manualRbePairs.length > 0 ? (
                          <>
                            <button
                              onClick={handleApplyRbePairs}
                              disabled={rbeRunning || !(bdfResult?.bdfPath || rbeResult?.bdfPath)}
                              className="text-[11px] font-bold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-200 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                            >
                              {rbeRunning
                                ? <><Loader2 size={12} className="animate-spin" /> 재생성 중...</>
                                : useNastran
                                  ? `BDF 재생성 후 Nastran 해석 수행 (${manualRbePairs.length}쌍)`
                                  : `BDF 재생성 (${manualRbePairs.length}쌍)`
                              }
                            </button>
                            <button
                              onClick={() => { setManualRbePairs([]); setSelectedRbeNode(null); }}
                              className="text-[10px] text-slate-400 hover:text-red-500 cursor-pointer px-1.5 py-1 rounded transition-colors"
                            >
                              전체삭제
                            </button>
                          </>
                        ) : (
                          useNastran && manualRbeMode && !rbeRunning && !groupDeleteRunning && (
                            <button
                              onClick={handleSkipRbeRunNastran}
                              className="text-[10px] font-bold px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                            >
                              Nastran 실행
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    {/* 페어 칩 목록 */}
                    {manualRbePairs.length > 0 && (
                      <div className="px-4 pb-2.5 flex flex-wrap gap-1">
                        {manualRbePairs.map((p, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 text-[9px] font-mono bg-white text-amber-800 px-2 py-0.5 rounded-full border border-amber-200 shadow-sm">
                            Node {p.indep} ↔ Node {p.dep}
                            <button onClick={() => setManualRbePairs(prev => prev.filter((_, i) => i !== idx))} className="text-amber-400 hover:text-red-600 cursor-pointer ml-0.5">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 min-h-0 rounded-b-2xl overflow-hidden relative">
                  {rbeRunning && (
                    <div className="absolute inset-0 z-30 bg-slate-900/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 rounded-b-2xl">
                      <Loader2 size={28} className="animate-spin text-amber-400" />
                      <p className="text-[12px] font-bold text-amber-300">BDF 재생성 중...</p>
                      <p className="text-[10px] text-slate-400">RBE2 카드를 BDF에 반영하고 있습니다</p>
                    </div>
                  )}
                  {groupDeleteRunning && (
                    <div className="absolute inset-0 z-30 bg-slate-900/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 rounded-b-2xl">
                      <Loader2 size={28} className="animate-spin text-red-400" />
                      <p className="text-[12px] font-bold text-red-300">그룹 삭제 처리 중...</p>
                      <p className="text-[10px] text-slate-400">BDF에서 element를 제거하고 재스캔 중입니다</p>
                    </div>
                  )}
                  {(rbeResult?.jsonPath || bdfResult?.jsonPath)
                    ? <FemModelViewer
                        jsonPath={rbeResult?.jsonPath || bdfResult.jsonPath}
                        mode="healed"
                        connectivityPath={rbeResult?.connectivityPath || bdfResult?.connectivityPath}
                        rbeEditMode={rbeEditMode && !rbeRunning}
                        selectedRbeNode={selectedRbeNode}
                        manualRbePairs={manualRbePairs}
                        onNodePick={handleNodePick}
                        onRigidsLoad={handleRigidsLoad}
                        blockedNodeIds={rbeBlockedNodeIds}
                        onCancelSelection={() => setSelectedRbeNode(null)}
                        onDeleteGroup={groupDeleteSelectMode && !groupDeleteRunning ? handleDeleteGroup : null}
                        groupDeleteSelectMode={groupDeleteSelectMode}
                      />
                    : (
                      <div className="w-full h-full bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 flex flex-col items-center justify-center gap-3">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-slate-700">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                        </svg>
                        <p className="text-[11px] text-slate-600 text-center leading-relaxed">
                          알고리즘 적용 완료 후<br />3D 모델이 여기에 렌더링됩니다.
                        </p>
                      </div>
                    )
                  }
                </div>
              </div>
            </>
          )}

          {/* Nastran 단계: 검증 결과 전체 화면 (3D 뷰어 없음) */}
          {isNastranStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nastran 검증 결과</span>
                <div className="flex items-center gap-2">
                  {(() => {
                    const _badgeStep1 = nastranTab === 'rigid' ? uboltStep1 : nastranStep1;
                    const _badgeStep2 = nastranTab === 'rigid' ? uboltStep2 : nastranStep2;
                    return (
                      <>
                        {_badgeStep1?.status && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            _badgeStep2?.summary?.f06Fatals > 0
                              ? 'bg-red-50 text-red-600 border-red-200'
                              : _badgeStep2?.summary?.f06Warnings > 0
                              ? 'bg-yellow-50 text-yellow-600 border-yellow-200'
                              : 'bg-green-50 text-green-600 border-green-200'
                          }`}>
                            {_badgeStep2?.summary?.f06Fatals > 0 ? 'FATAL' : _badgeStep2?.summary?.f06Warnings > 0 ? 'WARNING' : 'PASS'}
                          </span>
                        )}
                        {_badgeStep1 && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">검증 완료</span></>}
                      </>
                    );
                  })()}
                  {(nastranStatus?.status === 'Running' || nastranStatus?.status === 'Pending') &&
                    <><Loader2 size={11} className="animate-spin text-blue-400" /><span className="text-[10px] text-blue-400">실행 중</span></>
                  }
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-slate-950 rounded-b-2xl">
                {(() => {
                  const _activeStep1 = nastranTab === 'rigid' ? uboltStep1 : nastranStep1;
                  const _activeStep2 = nastranTab === 'rigid' ? uboltStep2 : nastranStep2;
                  const _isLoading   = nastranStatus?.status === 'Running' || nastranStatus?.status === 'Pending' || uboltRunning;
                  if (_activeStep1) {
                    return <ValidationStepLog step1Data={_activeStep1} step2Data={_activeStep2} useNastran={true} />;
                  }
                  if (_isLoading) {
                    return (
                      <div className="flex flex-col items-center justify-center h-full gap-3">
                        <Loader2 size={24} className="animate-spin text-blue-500" />
                        <p className="text-xs text-slate-400">
                          {uboltRunning ? 'U-bolt Rigid BDF 재생성 및 Nastran 해석 중...' : (nastranStatus?.message || 'Nastran 해석 중...')}
                        </p>
                        {nastranStatus?.progress != null && (
                          <div className="w-48 bg-slate-800 rounded-full h-1.5">
                            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${nastranStatus.progress}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <Cpu size={24} className="text-slate-700" />
                      <p className="text-xs text-slate-600">Stage 3 완료 후 Nastran 해석이 자동 시작됩니다.</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 그 외 단계 (보고서 등): 3D 뷰어(flex-1) + 로그(280px) */}
          {!isCSVStep && !isAlgorithmStep && !isNastranStep && (
            <>
              {/* 3D 뷰어 (주 공간) */}
              <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center px-4 py-2 border-b border-slate-100 shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">3D 모델 뷰어</span>
                </div>
                <div className="flex-1 min-h-0 rounded-b-2xl overflow-hidden">
                  {bdfResult?.jsonPath
                    ? <FemModelViewer jsonPath={bdfResult.jsonPath} connectivityPath={bdfResult?.connectivityPath} />
                    : (
                      <div className="w-full h-full bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 flex flex-col items-center justify-center gap-3">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-slate-700">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                        </svg>
                        <p className="text-[11px] text-slate-600 text-center leading-relaxed">
                          BDF 변환 완료 후<br />3D 모델이 여기에 렌더링됩니다.
                        </p>
                      </div>
                    )
                  }
                </div>
              </div>

              {/* 단계별 로그 (하단 고정) */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" style={{ height: '280px' }}>
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">실행 로그</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    <span className="text-[10px] text-slate-400">대기</span>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <LogPanel />
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      <ChangelogModal programKey="HiTessModelBuilder" title="HiTess Model Builder" isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
