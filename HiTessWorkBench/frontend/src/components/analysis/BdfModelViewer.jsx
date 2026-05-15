import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import {
  Eye, EyeOff, PlayCircle, PauseCircle, RotateCcw, Maximize2, Minimize2, Crosshair,
  Tag, Anchor,
} from 'lucide-react';

/* ── 씬 배경용 세로 그라디언트 텍스처 — 모델 시인성 위해 살짝 밝게 ── */
function makeGradientBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0,    '#324966'); // 위: 밝은 스틸 블루
  grad.addColorStop(0.55, '#1c2840'); // 중간: 다크 슬레이트
  grad.addColorStop(1,    '#0a1020'); // 아래: 짙은 네이비 (검정보다 살짝 밝게)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── X/Y/Z 라벨 스프라이트 (Axis Gizmo 용) ── */
function makeAxisLabel(text, color) {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 44px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.45, 0.45, 1);
  return sp;
}

/* ── 텍스트 라벨용 Sprite 생성 헬퍼 ── */
function makeTextSprite(text, { color = '#e2e8f0', bgColor = 'rgba(15,23,42,0.85)', borderColor = '#44ddff', fontSize = 56, padding = 12 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  const textW = ctx.measureText(text).width;
  canvas.width  = Math.ceil(textW + padding * 2 + 4);
  canvas.height = fontSize + padding * 2;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

  ctx.font = `bold ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding + 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

export default function BdfModelViewer({ modelData, cogPosition = null, showLegend = true, pipeMode = false }) {
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

  const [showNodes,     setShowNodes]     = useState(false);
  const [showCog,       setShowCog]       = useState(true);
  const [showSpc,       setShowSpc]       = useState(true);   // SPC 마커 표시 토글 (기본 ON)
  const [showSpcLabels, setShowSpcLabels] = useState(false);  // SPC DOF 텍스트 라벨 — 기본 OFF
  const [autoRotate,    setAutoRotate]    = useState(false);
  const [isFullscreen,  setIsFullscreen]  = useState(false);

  const forcesGroupRef    = useRef(null);
  const spcGroupRef       = useRef(null);
  const spcLabelsGroupRef = useRef(null);
  const gizmoCanvasRef = useRef(null);
  // Gizmo 는 마운트 시 1회만 생성하고 메인 씬 재빌드와 독립적으로 유지
  const gizmoRendererRef = useRef(null);
  const gizmoSceneRef    = useRef(null);
  const gizmoCamRef      = useRef(null);
  const cameraRef        = useRef(null);

  // showCog를 ref로도 유지 — COG 마커 생성 시 현재 값 참조
  const showCogRef = useRef(true);

  /* ── 데이터 전처리 ─────────────────────────────────────── */
  const nodesDict = useMemo(() => {
    const d = {};
    (modelData?.grids || []).forEach(g => { d[g.id] = [g.x, g.y, g.z]; });
    return d;
  }, [modelData]);

  const { beamElems, rbe2Pairs, conm2Nodes, cbushPairs, forces, spcNodeIds, spcDetails, hasDofInfo } = useMemo(() => {
    const beamElems = [], rbe2Pairs = [], conm2Nodes = [], cbushPairs = [];
    (modelData?.elements || []).forEach(el => {
      if (['CBEAM', 'CBAR', 'CROD'].includes(el.cardType))
        beamElems.push({ id: el.id, n1: el.nodeIds[0], n2: el.nodeIds[1] });
      else if (el.cardType === 'RBE2')
        (el.dependentNodeIds || []).forEach(dn =>
          rbe2Pairs.push({ id: el.id, n1: el.independentNodeId, n2: dn }));
      else if (el.cardType === 'CONM2')
        conm2Nodes.push({ id: el.id, nodeId: el.nodeId, mass: el.mass });
      else if (el.cardType === 'CBUSH' && Array.isArray(el.nodeIds) && el.nodeIds.length >= 2)
        cbushPairs.push({ id: el.id, n1: el.nodeIds[0], n2: el.nodeIds[1] });
    });

    const forces = Array.isArray(modelData?.forces) ? modelData.forces : [];

    // nodeId 기준 BC 집계
    const bcs = modelData?.boundaryConditions || [];
    const hasDofInfo = bcs.some(bc => bc.dof != null);
    const bcMap = new Map(); // nodeId -> { dofSet, values, hasEnforced }
    bcs.forEach(bc => {
      const nids = [];
      if (bc.nodeId != null) nids.push(bc.nodeId);
      if (Array.isArray(bc.nodeIds)) bc.nodeIds.forEach(n => nids.push(n));
      const dofStr = bc.dof != null ? String(bc.dof) : '';
      const val    = typeof bc.value === 'number' ? bc.value : 0;
      nids.forEach(nid => {
        if (!bcMap.has(nid)) bcMap.set(nid, { dofSet: new Set(), values: new Map(), hasEnforced: false });
        const entry = bcMap.get(nid);
        for (const ch of dofStr) {
          entry.dofSet.add(ch);
          const prev = entry.values.get(ch) || 0;
          if (Math.abs(val) > Math.abs(prev)) entry.values.set(ch, val);
        }
        if (val !== 0) entry.hasEnforced = true;
      });
    });
    const spcDetails = [];
    bcMap.forEach((entry, nid) => {
      const dofChars = [...entry.dofSet].sort();
      const dofs = dofChars.join('');
      const isFull = ['1','2','3','4','5','6'].every(d => entry.dofSet.has(d));
      const valueEntries = [];
      ['1','2','3','4','5','6'].forEach(d => {
        const v = entry.values.get(d);
        if (v !== undefined && v !== 0) valueEntries.push(`u${d}=${v}`);
      });
      spcDetails.push({ nodeId: nid, dofs, isFull, hasEnforced: entry.hasEnforced, valueEntries });
    });
    const spcNodeIds = [...bcMap.keys()];
    return { beamElems, rbe2Pairs, conm2Nodes, cbushPairs, forces, spcNodeIds, spcDetails, hasDofInfo };
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

    // 더 부드러운 분위기: 세로 그라디언트 배경.
    // 원거리 모델이 어두워지지 않도록 fog 는 사용하지 않는다.
    scene.background = makeGradientBackground();
    scene.fog        = null;

    // ── 추가 조명 / 노출 보정 — 전체 톤을 밝게 ────────────────
    // HemisphereLight: 위(스카이블루)/아래(웜그레이) 부드러운 보조광
    const hemiLight = new THREE.HemisphereLight(0xeaf3ff, 0x6a5040, 1.4);
    scene.add(hemiLight);
    // 추가 ambient — PBR 표면이 너무 어둡게 떨어지지 않도록
    const fillAmbient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(fillAmbient);
    // ACES 톤매핑 노출 상향 (createThreeScene 기본 1.15 → 1.55)
    renderer.toneMappingExposure = 1.55;

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

    /* ── CBEAM / CBAR / CROD ──
       pipeMode=true (HP-SCR): 굵은 metallic 파이프 룩 (smoother cylinder + 더 큰 반경)
       pipeMode=false (BdfScanner 등 기존): 얇은 빔 표시 유지 */
    const validBeams = beamElems.filter(e => nodesDict[e.n1] && nodesDict[e.n2]);
    if (validBeams.length > 0) {
      const beamR     = pipeMode ? rodRadius * 9   : rodRadius;
      const radSeg    = pipeMode ? 18              : 8;
      const beamColor = pipeMode ? 0x9eb5d4        : 0x66ccff; // 파이프는 차가운 스틸 그레이
      const emissive  = pipeMode ? 0x0e1a2e        : 0x0044aa;
      const emInt     = pipeMode ? 0.18            : 0.35;
      const metal     = pipeMode ? 0.92            : 0.85;
      const rough     = pipeMode ? 0.32            : 0.15;
      const geo = new THREE.CylinderGeometry(beamR, beamR, 1, radSeg);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: beamColor, metalness: metal, roughness: rough,
        emissive, emissiveIntensity: emInt,
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

    /* ── CBUSH : 보라색 실린더 (스프링/부싱 연결).
       pipeMode 에서는 굵은 파이프와 시각적 균형을 맞추기 위해 더 두껍게 ── */
    const validCbush = cbushPairs.filter(e => nodesDict[e.n1] && nodesDict[e.n2]);
    if (validCbush.length > 0) {
      const cbushR = pipeMode ? rodRadius * 5 : rodRadius * 2.5;
      const geo = new THREE.CylinderGeometry(cbushR, cbushR, 1, 14);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xb88cff, metalness: 0.4, roughness: 0.35,
        emissive: 0x6b2dff, emissiveIntensity: 0.85,
      });
      const inst = new THREE.InstancedMesh(geo, mat, validCbush.length);
      const d = new THREE.Object3D();
      validCbush.forEach((e, i) => {
        const p1 = new THREE.Vector3(...nodesDict[e.n1]);
        const p2 = new THREE.Vector3(...nodesDict[e.n2]);
        d.position.copy(p1).lerp(p2, 0.5);
        const len = p1.distanceTo(p2);
        // 좌표가 동일(스프링 길이 0) 인 경우 최소 길이를 부여하여 표시
        d.scale.set(1, 1, len > 0 ? len : rodRadius * 12);
        if (len > 0) d.lookAt(p2);
        d.updateMatrix();
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

    /* ── SPC 경계조건 마커 ──
       hasDofInfo=false 인 경우(레거시 BdfScanner 등): 단순 박스
       hasDofInfo=true  인 경우(HP-SCR 등): 풀 구속(123456)=네모, 그 외=삼각형 + DOF 텍스트 라벨 */
    if (!hasDofInfo) {
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
    } else {
      const validBcs = spcDetails.filter(s => nodesDict[s.nodeId]);
      if (validBcs.length > 0) {
        // 마커 크기 — pipeMode 일 때는 파이프 두께(rodRadius*9) 보다 확실히 크게
        const baseR  = pipeMode ? rodRadius * 14 : rodRadius * 6;
        const boxR   = baseR * 1.35;                              // 전구속 박스: 콘보다 더 크게
        const coneR  = baseR * 0.95;
        const coneH  = baseR * 2.1;                                // 콘 높이 (꼭지점→밑면)
        const pipeR  = pipeMode ? rodRadius * 9 : 0;               // 콘 꼭지점이 닿을 파이프 반경
        const boxGeo  = new THREE.BoxGeometry(boxR, boxR, boxR);
        const coneGeo = new THREE.ConeGeometry(coneR, coneH, 4);   // 4각뿔 → 측면 보면 삼각형
        // 전구속 박스: 너무 눈부시지 않도록 emissive 를 큰 폭으로 낮춤
        const boxMat  = new THREE.MeshStandardMaterial({
          color: 0x55cc88, metalness: 0.4, roughness: 0.55,
          emissive: 0x103a22, emissiveIntensity: 0.35,
        });
        const coneMat = new THREE.MeshStandardMaterial({
          color: 0xffb040, metalness: 0.3, roughness: 0.4,
          emissive: 0xcc6600, emissiveIntensity: 1.0,
        });

        // SPC 마커는 별도 그룹으로 묶어 토글 가능
        const spcGroup = new THREE.Group();
        validBcs.forEach(s => {
          const pos = nodesDict[s.nodeId];
          const mesh = new THREE.Mesh(s.isFull ? boxGeo : coneGeo, s.isFull ? boxMat : coneMat);
          if (s.isFull) {
            mesh.position.set(...pos);
          } else {
            // 부분구속 콘: 꼭지점(+Z 방향) 이 배관 바닥에 맞닿도록 아래로 내림
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(pos[0], pos[1], pos[2] - pipeR - coneH / 2);
          }
          spcGroup.add(mesh);
        });
        spcGroup.visible = showSpc;
        spcGroupRef.current = spcGroup;
        group.add(spcGroup);

        // ── DOF 텍스트 라벨 — 별도 group 으로 묶어 토글 가능 + 더 작고 연한 스타일 ──
        const labelsGroup = new THREE.Group();
        // 모델 가림 최소화를 위해 작은 폰트 + 옅은 배경
        const labelScale = (pipeMode ? maxDim * 0.022 : maxDim * 0.018);
        validBcs.forEach(s => {
          const pos = nodesDict[s.nodeId];
          // 컴팩트 표기: DOF 만 노출 (예: "123456", 강제변위 있으면 "123456 u1=24")
          const enforced = s.valueEntries.length > 0 ? ` ${s.valueEntries[0]}` : '';
          const text = `${s.dofs}${enforced}`;
          const borderCol = s.isFull ? '#44ff88aa' : '#ffb040aa';
          const sprite = makeTextSprite(text, {
            borderColor: borderCol,
            color:   '#e2e8f0',
            bgColor: 'rgba(15,23,42,0.55)', // 더 투명한 배경
            fontSize: 40,                    // 56 → 40 (덜 두꺼움)
            padding:  9,
          });
          if (sprite.material) {
            sprite.material.opacity = 0.78; // 살짝 반투명
            sprite.material.transparent = true;
          }
          const aspect = sprite.userData.aspect || 4;
          sprite.scale.set(labelScale * aspect, labelScale, 1);
          // 라벨은 전구속(박스) / 부분구속(콘) 모두 노드 위쪽으로 살짝 띄움
          sprite.position.set(pos[0], pos[1], pos[2] + boxR * 1.4);
          labelsGroup.add(sprite);
        });
        labelsGroup.visible = showSpcLabels;
        spcLabelsGroupRef.current = labelsGroup;
        group.add(labelsGroup);
      }
    }

    /* ── FORCE : 빨간 화살표 (원기둥+콘) ── */
    const validForces = forces.filter(f => nodesDict[f.nodeId] && f.mag > 0);
    if (validForces.length > 0) {
      const maxMag = validForces.reduce((m, f) => Math.max(m, f.mag), 0) || 1;
      const targetLen = maxDim * 0.12; // 최대 화살표 길이(월드 단위)
      const minLen    = maxDim * 0.04;
      const shaftR    = rodRadius * 1.4;
      const headR     = rodRadius * 3.0;
      const headLen   = maxDim * 0.025;

      const forcesGroup = new THREE.Group();
      const shaftGeo = new THREE.CylinderGeometry(shaftR, shaftR, 1, 8);
      const headGeo  = new THREE.ConeGeometry(headR, headLen, 12);
      const arrowMat = new THREE.MeshStandardMaterial({
        color: 0xff4040, metalness: 0.3, roughness: 0.4,
        emissive: 0xaa1111, emissiveIntensity: 0.9,
      });

      validForces.forEach(f => {
        const len = Math.max(minLen, (f.mag / maxMag) * targetLen);
        const dir = new THREE.Vector3(f.fx, f.fy, f.fz).normalize();
        const start = new THREE.Vector3(...nodesDict[f.nodeId]);
        const shaftLen = Math.max(0, len - headLen);

        // 샤프트: 시작점에서 dir 방향으로 shaftLen 만큼
        const shaftMid = start.clone().add(dir.clone().multiplyScalar(shaftLen / 2));
        const shaft = new THREE.Mesh(shaftGeo, arrowMat);
        shaft.position.copy(shaftMid);
        // CylinderGeometry 기본 축은 +Y. dir 로 회전.
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        shaft.scale.set(1, shaftLen || 0.001, 1);
        forcesGroup.add(shaft);

        // 헤드: 샤프트 끝에서 dir 방향
        const headCenter = start.clone().add(dir.clone().multiplyScalar(shaftLen + headLen / 2));
        const head = new THREE.Mesh(headGeo, arrowMat);
        head.position.copy(headCenter);
        head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        forcesGroup.add(head);
      });

      forcesGroup.visible = true; // FORCE 토글 제거됨 — 항상 노출
      forcesGroupRef.current = forcesGroup;
      group.add(forcesGroup);
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

    // 메인 카메라를 ref 로 노출 — gizmo 동기화 onFrame 에서 사용
    cameraRef.current = camera;

    const onFrame = () => {
      const gz = gizmoRendererRef.current;
      const gs = gizmoSceneRef.current;
      const gc = gizmoCamRef.current;
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      if (!gz || !gs || !gc || !cam || !ctrl) return;
      const dir = cam.position.clone().sub(ctrl.target).normalize();
      gc.position.copy(dir.multiplyScalar(3.4));
      gc.up.copy(cam.up);
      gc.lookAt(0, 0, 0);
      gz.render(gs, gc);
    };

    startAnimate(center, maxDim, onFrame);

    // 씬 재빌드 완료 신호 → COG useEffect가 마커를 재삽입
    setSceneVersion(v => v + 1);

    return () => {
      mainGroupRef.current = null;
      cogMarkerRef.current = null;
      forcesGroupRef.current = null;
      spcGroupRef.current = null;
      spcLabelsGroupRef.current = null;
      cameraRef.current = null;
      cleanup();
      rendererRef.current = null;
    };
  }, [nodesDict, beamElems, rbe2Pairs, conm2Nodes, cbushPairs, spcNodeIds, forces, pipeMode]);

  /* ── Axis Gizmo 초기화 — 마운트 시 1회만, 모델 변경과 독립적으로 유지 ── */
  useEffect(() => {
    const gizmoCanvas = gizmoCanvasRef.current;
    if (!gizmoCanvas) return;

    let gizmoRenderer;
    try {
      gizmoRenderer = new THREE.WebGLRenderer({ canvas: gizmoCanvas, alpha: true, antialias: true });
      gizmoRenderer.setSize(96, 96, false);
      gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch (e) {
      console.warn('[BdfModelViewer] Axis Gizmo WebGL init failed:', e);
      return;
    }

    const gizmoScene = new THREE.Scene();
    const gizmoCam   = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    gizmoCam.up.set(0, 0, 1);

    const axisLen = 1.0;
    const axisR   = 0.05;
    const headR   = 0.13;
    const headLen = 0.30;
    const makeAxis = (color, dir, label) => {
      const grp = new THREE.Group();
      const n = dir.clone().normalize();
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(axisR, axisR, axisLen, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      shaft.position.copy(n.clone().multiplyScalar(axisLen / 2));
      grp.add(shaft);

      const head = new THREE.Mesh(
        new THREE.ConeGeometry(headR, headLen, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      head.position.copy(n.clone().multiplyScalar(axisLen + headLen / 2));
      grp.add(head);

      const sprite = makeAxisLabel(label, `#${color.toString(16).padStart(6, '0')}`);
      sprite.position.copy(n.clone().multiplyScalar(axisLen + headLen + 0.15));
      grp.add(sprite);
      return grp;
    };
    gizmoScene.add(makeAxis(0xff5252, new THREE.Vector3(1, 0, 0), 'X'));
    gizmoScene.add(makeAxis(0x4ade80, new THREE.Vector3(0, 1, 0), 'Y'));
    gizmoScene.add(makeAxis(0x60a5fa, new THREE.Vector3(0, 0, 1), 'Z'));
    gizmoScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8 }),
    ));

    gizmoRendererRef.current = gizmoRenderer;
    gizmoSceneRef.current    = gizmoScene;
    gizmoCamRef.current      = gizmoCam;

    return () => {
      gizmoRendererRef.current = null;
      gizmoSceneRef.current    = null;
      gizmoCamRef.current      = null;
      gizmoScene.traverse(obj => {
        obj.geometry?.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
        }
      });
      // 동일 canvas 를 다시 쓸 가능성이 있어 forceContextLoss 는 호출하지 않는다.
      gizmoRenderer.dispose();
    };
  }, []);

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
    if (spcGroupRef.current) spcGroupRef.current.visible = showSpc;
    // 라벨은 SPC 마커가 보일 때만 의미 있음
    if (spcLabelsGroupRef.current) {
      spcLabelsGroupRef.current.visible = showSpc && showSpcLabels;
    }
  }, [showSpc, showSpcLabels]);

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

  // 데이터에 실제로 존재하는 항목만 노출하는 동적 레전드.
  // 사용자 요구: CBEAM / CBUSH / SPC / FORCE / TEMP 5종 위주로 단순화.
  // SPC 항목은 BDF 안에서 발견된 DOF 패턴(예: 123456, 13, 23, 1, 2, 3, 456)을 텍스트로 노출.
  const hasFullSpc    = spcDetails.some(s => s.isFull);
  const hasPartialSpc = spcDetails.some(s => !s.isFull);
  const uniqueDofs    = [...new Set(spcDetails.map(s => s.dofs).filter(Boolean))]
                          .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const spcShape      = hasFullSpc ? 'square' : (hasPartialSpc ? 'triangle' : 'square');
  const spcColor      = hasFullSpc ? '#44ff88' : '#ffb040';
  const spcDofLabel   = uniqueDofs.length > 0
                          ? `SPC (DOF ${uniqueDofs.join(', ')})`
                          : 'SPC (경계 조건)';

  const legend = [
    ...(beamElems.length > 0
      ? [{ color: '#66ccff', shape: 'bar',      label: 'CBEAM (1D 보 요소)' }] : []),
    ...(cbushPairs.length > 0
      ? [{ color: '#b88cff', shape: 'bar',      label: 'CBUSH (스프링/부싱)' }] : []),
    ...(rbe2Pairs.length > 0
      ? [{ color: '#ff6644', shape: 'bar',      label: 'RBE2 (강체 연결)' }] : []),
    ...(conm2Nodes.length > 0
      ? [{ color: '#ffcc00', shape: 'diamond',  label: 'CONM2 (집중 질량)' }] : []),
    ...(spcDetails.length > 0
      ? [{ color: spcColor,  shape: spcShape,   label: spcDofLabel,
          // SPC 는 네모/삼각형 두 종류가 동시에 존재할 수 있으므로 sub-row 로 형태 안내
          extraRows: hasFullSpc && hasPartialSpc
            ? [
                { color: '#44ff88', shape: 'square',   label: '전구속 (123456)' },
                { color: '#ffb040', shape: 'triangle', label: '부분구속 / 강제변위' },
              ]
            : null,
        }]
      : []),
    ...(forces.length > 0
      ? [{ color: '#ff4040', shape: 'arrow',    label: 'FORCE (하중 벡터)' }] : []),
    ...(cogPosition ? [{ color: '#ffcc00', shape: 'star', label: 'COG 무게중심' }] : []),
  ];

  const renderLegendShape = (shape, color) => {
    const common = { backgroundColor: color };
    switch (shape) {
      case 'square':
        return <div className="w-3 h-3 shrink-0 border border-white/30" style={common} />;
      case 'triangle':
        return (
          <div
            className="w-0 h-0 shrink-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderBottom: `11px solid ${color}`,
            }}
          />
        );
      case 'diamond':
        return <div className="w-3 h-3 shrink-0 rotate-45 border border-white/30" style={common} />;
      case 'circle':
        return <div className="w-3 h-3 shrink-0 rounded-full" style={common} />;
      case 'arrow':
        return (
          <div className="flex items-center shrink-0">
            <div className="w-2.5 h-[2px]" style={common} />
            <div
              className="w-0 h-0"
              style={{
                borderTop: '4px solid transparent',
                borderBottom: '4px solid transparent',
                borderLeft: `6px solid ${color}`,
              }}
            />
          </div>
        );
      case 'star':
        return <span className="shrink-0 text-base leading-none" style={{ color }}>✦</span>;
      case 'bar':
      default:
        return <div className="w-4 h-1.5 rounded-sm shrink-0" style={common} />;
    }
  };

  // ── 모델 통계 (HUD 표시용) — 큰 모델에서도 안전하도록 reduce 사용 ───
  const stats = useMemo(() => {
    const keys = Object.keys(nodesDict);
    const nodeCount = keys.length;
    if (nodeCount === 0) return { nodeCount, bbox: null };
    let xMin = Infinity, yMin = Infinity, zMin = Infinity;
    let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
    for (const k of keys) {
      const p = nodesDict[k];
      if (!Array.isArray(p) || p.length < 3) continue;
      const x = p[0], y = p[1], z = p[2];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
    return {
      nodeCount,
      bbox: { dx: xMax - xMin, dy: yMax - yMin, dz: zMax - zMin },
    };
  }, [nodesDict]);
  const fmt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString() : '–';

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

      {/* 좌측 상단 — 레전드 (데이터에 실제로 존재하는 항목만 노출) */}
      {showLegend && legend.length > 0 && (
        <div className="absolute top-3 left-3 z-10 bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 px-3 py-2.5 pointer-events-none shadow-lg max-w-[320px]">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Legend</p>
          <div className="flex flex-col gap-1.5">
            {legend.map(({ color, label, shape, extraRows }) => (
              <div key={label} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-4 flex items-center justify-center">
                    {renderLegendShape(shape, color)}
                  </div>
                  <span className="text-[10px] font-mono text-slate-200 leading-snug break-words">
                    {label}
                  </span>
                </div>
                {Array.isArray(extraRows) && extraRows.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2 pl-5">
                    <div className="w-4 flex items-center justify-center">
                      {renderLegendShape(r.shape, r.color)}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 leading-snug">{r.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 우측 레일 — Stats + (선택) COG */}
      <div className="absolute top-12 right-3 z-10 flex flex-col gap-2 max-w-[240px] pointer-events-none">
        {stats.nodeCount > 0 && (
          <div className="bg-slate-900/85 backdrop-blur rounded-xl border border-slate-700 px-3 py-2.5 shadow-lg">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Model</p>
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[10px] font-mono">
              <span className="text-slate-400">Nodes</span>
              <span className="text-slate-100 text-right tabular-nums">{fmt(stats.nodeCount)}</span>
              {beamElems.length > 0 && (<><span className="text-slate-400">CBEAM</span><span className="text-slate-100 text-right tabular-nums">{fmt(beamElems.length)}</span></>)}
              {cbushPairs.length > 0 && (<><span className="text-slate-400">CBUSH</span><span className="text-slate-100 text-right tabular-nums">{fmt(cbushPairs.length)}</span></>)}
              {rbe2Pairs.length > 0 && (<><span className="text-slate-400">RBE2</span><span className="text-slate-100 text-right tabular-nums">{fmt(rbe2Pairs.length)}</span></>)}
              {conm2Nodes.length > 0 && (<><span className="text-slate-400">CONM2</span><span className="text-slate-100 text-right tabular-nums">{fmt(conm2Nodes.length)}</span></>)}
              {spcDetails.length > 0 && (<><span className="text-slate-400">SPC</span><span className="text-slate-100 text-right tabular-nums">{fmt(spcDetails.length)}</span></>)}
              {forces.length > 0 && (<><span className="text-slate-400">FORCE</span><span className="text-slate-100 text-right tabular-nums">{fmt(forces.length)}</span></>)}
            </div>
            {stats.bbox && (
              <div className="mt-2 pt-2 border-t border-slate-700/60 text-[9px] font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>BBox (mm)</span>
                  <span className="text-slate-300">
                    {fmt(stats.bbox.dx)}×{fmt(stats.bbox.dy)}×{fmt(stats.bbox.dz)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {cogPosition && (
          <div className="bg-slate-900/85 backdrop-blur rounded-xl border border-yellow-500/30 px-3 py-2.5 shadow-lg">
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
      </div>

      {/* Axis Gizmo — 우측 하단 */}
      <div className="absolute bottom-3 right-3 z-10 w-[96px] h-[96px] rounded-xl border border-slate-700 bg-slate-900/70 backdrop-blur-sm shadow-lg pointer-events-none overflow-hidden">
        <canvas ref={gizmoCanvasRef} width={96} height={96} className="block w-full h-full" />
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

        {/* SPC 마커 토글 (전구속 박스 / 부분구속 콘) */}
        <button
          onClick={() => spcDetails.length > 0 && setShowSpc(v => !v)}
          disabled={spcDetails.length === 0}
          title={spcDetails.length === 0 ? 'SPC 없음' : `SPC ${spcDetails.length}개`}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors ${
            spcDetails.length === 0
              ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
              : showSpc
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-pointer'
              : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'
          }`}
        >
          <Anchor size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">SPC</span>
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

        {/* SPC DOF 텍스트 라벨 토글 */}
        <button
          onClick={() => spcDetails.length > 0 && setShowSpcLabels(v => !v)}
          disabled={spcDetails.length === 0}
          title={spcDetails.length === 0 ? 'SPC 라벨 없음' : `SPC 라벨 ${spcDetails.length}개`}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded-xl transition-colors ${
            spcDetails.length === 0
              ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
              : showSpcLabels
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-pointer'
              : 'bg-slate-700 text-slate-400 hover:text-white cursor-pointer'
          }`}
        >
          <Tag size={18} className="mb-1" />
          <span className="text-[8px] font-bold uppercase tracking-wider">Labels</span>
        </button>

        {/* 토글 ↔ 액션 그룹 구분선 */}
        <div className="w-px self-stretch bg-slate-700/70 mx-0.5" />

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
