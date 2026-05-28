import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  Box, Layers, Maximize2, Crosshair, Expand, Shrink,
  Circle, Square, Info, ChevronLeft, Sandwich,
} from 'lucide-react';
import { createThreeScene } from '../../hooks/useThreeScene';

/* ──────────────────────────────────────────────────────────────────────────
   상수 / 색상
   ──────────────────────────────────────────────────────────────────────── */

const COLORS = {
  background: 0x0a0f1a,
  quad:       0x3b82f6, // CQUAD4
  tri:        0x10b981, // CTRIA3
  edge:       0x1e293b, // slate-800 — 어두운 배경에 거의 묻혀 element 면이 깔끔하게 보임
  node:       0xef4444, // 노드 = 빨간 구
  selected:   0xf97316,
  axisX:      0xef4444,
  axisY:      0x22c55e,
  axisZ:      0x3b82f6,
};

const NODE_SPHERE_RADIUS_RATIO = 0.0035; // 모델 maxDim 기준
const DEFAULT_SHELL_THICKNESS  = 5.0;    // mm — PSHELL thickness 미정 시 fallback

/* ──────────────────────────────────────────────────────────────────────────
   모델 파싱 유틸
   ──────────────────────────────────────────────────────────────────────── */

function getNodeMap(modelData) {
  const map = new Map();
  (modelData?.nodes || modelData?.grids || []).forEach((node) => {
    map.set(Number(node.id), {
      id: Number(node.id),
      x:  Number(node.x || 0),
      y:  Number(node.y || 0),
      z:  Number(node.z || 0),
    });
  });
  return map;
}

function getShellElements(modelData) {
  return (modelData?.elements || [])
    .map((element) => ({
      id:   Number(element.id),
      type: element.type || element.cardType,
      pid:  element.pid != null ? Number(element.pid) : null,
      nodeIds: (element.nodeIds || [element.startNode, element.endNode].filter(Boolean)).map(Number),
    }))
    .filter((element) => ['CTRIA3', 'CQUAD4'].includes(element.type) && element.nodeIds.length >= 3);
}

/** properties 배열을 id→prop Map 으로. 다양한 key 명을 허용한다. */
function getPropertyMap(modelData) {
  const map = new Map();
  const propsArr = modelData?.properties || modelData?.props || [];
  propsArr.forEach((p) => {
    const id = Number(p.id ?? p.pid ?? p.PID);
    if (Number.isFinite(id)) map.set(id, p);
  });
  return map;
}

/** PSHELL 등에서 thickness 후보 키를 탐색해 양수 값을 반환. 없으면 null. */
function extractThickness(prop) {
  if (!prop) return null;
  const candidates = [prop.thickness, prop.t, prop.T, prop.T1, prop.shellThickness, prop.tShell];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
   ViewCube 라벨 (sprite)
   ──────────────────────────────────────────────────────────────────────── */

function makeAxisLabel(text, hexColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hexColor;
  ctx.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 52);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.32, 0.32, 1);
  return sprite;
}

/* ──────────────────────────────────────────────────────────────────────────
   파라미터 → 모델 좌표 하이라이트 매핑
   모델 좌표: x=[0, lap+neck+R], y=[-h/2, +h/2], z=0 (shell)
   ──────────────────────────────────────────────────────────────────────── */

function buildArcPoints(cx, cy, r, theta0, theta1, segments = 64, z = 0) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t1 = theta0 + (theta1 - theta0) * (i / segments);
    const t2 = theta0 + (theta1 - theta0) * ((i + 1) / segments);
    pts.push(cx + r * Math.cos(t1), cy + r * Math.sin(t1), z);
    pts.push(cx + r * Math.cos(t2), cy + r * Math.sin(t2), z);
  }
  return pts;
}

function buildCirclePoints(cx, cy, r, segments = 64, z = 0) {
  return buildArcPoints(cx, cy, r, 0, 2 * Math.PI, segments, z);
}

/** 하이라이트할 굵은 선들의 BufferGeometry positions (Float32 segments) 반환. */
function computeParamHighlight(paramKey, params, modelBounds, mode) {
  if (!paramKey || !params || !modelBounds) return null;
  const { xMin, xMax, yMin, yMax, zMin, zMax } = modelBounds;

  if (mode === 'lug') {
    const lap   = Number(params.lap_length          ?? 0);
    const neck  = Number(params.neck_length         ?? 0);
    const outR  = Number(params.outer_radius        ?? 0);
    const holeD = Number(params.hole_diameter       ?? 0);
    const lhc   = Number(params.left_to_hole_center ?? 0);
    const thk   = Number(params.thickness           ?? 0);
    const cdx   = Number(params.chamfer_dx          ?? 0);
    const cyP   = Number(params.chamfer_y           ?? 0);

    switch (paramKey) {
      case 'thickness': {
        // Z 방향 두께 — shell 이므로 4개 모서리에서 ±thickness/2 표시
        const t2 = thk / 2;
        const out = [];
        [[xMin, yMin], [xMax, yMin], [xMin, yMax], [xMax, yMax]].forEach(([x, y]) => {
          out.push(x, y, -t2, x, y, t2);
        });
        return out;
      }
      case 'height':
        return [xMin, yMin, 0, xMin, yMax, 0,    // 좌측 수직
                xMin - 30, yMin, 0, xMin - 30, yMax, 0]; // 외부 보조선 (선택)
      case 'lap_length':
        return [
          xMin, yMin, 0, xMin + lap, yMin, 0,    // 하단 가장자리
          xMin, yMax, 0, xMin + lap, yMax, 0,    // 상단 가장자리
        ];
      case 'neck_length':
        return [
          xMin + lap, yMin, 0, xMin + lap + neck, yMin, 0,
          xMin + lap, yMax, 0, xMin + lap + neck, yMax, 0,
        ];
      case 'outer_radius': {
        // 우측 호: 중심 (left_to_hole_center, 0), 반경 outer_radius, theta=-π/2 ~ π/2
        return buildArcPoints(lhc, 0, outR, -Math.PI / 2, Math.PI / 2, 64, 0);
      }
      case 'hole_diameter':
        return buildCirclePoints(lhc, 0, holeD / 2, 64, 0);
      case 'left_to_hole_center':
        return [xMin, 0, 0, lhc, 0, 0];
      case 'chamfer_dx':
        // 좌상단/좌하단 모서리에 dx 가로 측정선 + chamfer 빗변(전체 형상)
        return [
          // 좌하단: 가로 dx 측정선
          xMin, yMin, 0, xMin + cdx, yMin, 0,
          // 좌하단: chamfer 빗변 (xMin, yMin + cy) ↔ (xMin + dx, yMin)
          xMin, yMin + cyP, 0, xMin + cdx, yMin, 0,
          // 좌상단: 가로 dx 측정선
          xMin, yMax, 0, xMin + cdx, yMax, 0,
          // 좌상단: chamfer 빗변
          xMin, yMax - cyP, 0, xMin + cdx, yMax, 0,
        ];
      case 'chamfer_y':
        // 좌상단/좌하단 모서리에 y 세로 측정선 + chamfer 빗변
        return [
          // 좌하단: 세로 y 측정선
          xMin, yMin, 0, xMin, yMin + cyP, 0,
          // 좌하단: chamfer 빗변
          xMin, yMin + cyP, 0, xMin + cdx, yMin, 0,
          // 좌상단: 세로 y 측정선
          xMin, yMax, 0, xMin, yMax - cyP, 0,
          // 좌상단: chamfer 빗변
          xMin, yMax - cyP, 0, xMin + cdx, yMax, 0,
        ];
      default:
        return null;
    }
  }

  if (mode === 'support') {
    // 모델 좌표: x,y = 단면 평면(파이프/플레이트 원), z = 파이프 길이방향
    // SU-145 예: x=[-300, 300], y=[-300, 300], z=[-638, 638]
    const pipeOD  = Number(params.pipe_outer_diameter ?? 0);
    const pipeT   = Number(params.pipe_thickness      ?? 0);
    const topD    = Number(params.top_plate_diameter    ?? 0);
    const botD    = Number(params.bottom_plate_diameter ?? 0);
    const plateT  = Number(params.plate_thickness     ?? 0);
    const rs      = Number(params.rib_size            ?? 0);
    const rt      = Number(params.rib_thickness       ?? 0);
    const srs     = Number(params.small_rib_size      ?? 0);
    const pipeR   = pipeOD / 2;
    const topR    = topD / 2;
    const botR    = botD / 2;

    // 4방향 리브 단위벡터 (±X, ±Y)
    const RIB_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    switch (paramKey) {
      case 'pipe_outer_diameter':
        return [...buildCirclePoints(0, 0, pipeR, 64, zMax),
                ...buildCirclePoints(0, 0, pipeR, 64, zMin),
                ...buildCirclePoints(0, 0, pipeR, 64, 0)];
      case 'pipe_thickness': {
        const ri = Math.max(0, pipeR - pipeT);
        return [...buildCirclePoints(0, 0, pipeR, 64, zMax),
                ...buildCirclePoints(0, 0, ri,    64, zMax),
                ...buildCirclePoints(0, 0, pipeR, 64, zMin),
                ...buildCirclePoints(0, 0, ri,    64, zMin)];
      }
      case 'pipe_length':
        // 파이프 길이방향 4모서리 수직선 + 중심축
        return [pipeR, 0, zMin,  pipeR, 0, zMax,
                -pipeR, 0, zMin, -pipeR, 0, zMax,
                0,  pipeR, zMin, 0,  pipeR, zMax,
                0, -pipeR, zMin, 0, -pipeR, zMax];
      case 'top_plate_diameter':
        // 상부 플레이트 — 위/아래 두 원으로 강조
        return [...buildCirclePoints(0, 0, topR, 64, zMax),
                ...buildCirclePoints(0, 0, topR, 64, zMax - Math.max(plateT, 1))];
      case 'bottom_plate_diameter':
        return [...buildCirclePoints(0, 0, botR, 64, zMin),
                ...buildCirclePoints(0, 0, botR, 64, zMin + Math.max(plateT, 1))];
      case 'plate_thickness': {
        // 상하 플레이트 두께 — 상하 각각 두 원 + 4방향 두께 표시선
        const out = [
          ...buildCirclePoints(0, 0, topR, 64, zMax),
          ...buildCirclePoints(0, 0, topR, 64, zMax - plateT),
          ...buildCirclePoints(0, 0, botR, 64, zMin),
          ...buildCirclePoints(0, 0, botR, 64, zMin + plateT),
        ];
        [[topR, 0], [-topR, 0], [0, topR], [0, -topR]].forEach(([x, y]) => {
          out.push(x, y, zMax, x, y, zMax - plateT);
        });
        [[botR, 0], [-botR, 0], [0, botR], [0, -botR]].forEach(([x, y]) => {
          out.push(x, y, zMin, x, y, zMin + plateT);
        });
        return out;
      }
      case 'rib_size': {
        // 큰 리브 (rib_size, 155mm) — 하부 플레이트 위 (z_bottom + plateT 에서 위로)
        // 형상: 삼각형 radial bracket (파이프 측 수직 + 플레이트 측 수평 + 빗변)
        const ribBotZ = zMin + plateT;       // 하부 플레이트 윗면
        const ribTopZ = ribBotZ + rs;        // 위로 rib_size 만큼
        const out = [];
        RIB_DIRS.forEach(([dx, dy]) => {
          const x0 = dx * pipeR,         y0 = dy * pipeR;          // 파이프 측 (수직 시작)
          const x1 = dx * (pipeR + rs),  y1 = dy * (pipeR + rs);   // 플레이트 측 (수평 끝)
          out.push(x0, y0, ribBotZ, x0, y0, ribTopZ);   // 파이프 측 수직 변
          out.push(x0, y0, ribBotZ, x1, y1, ribBotZ);   // 플레이트 측 수평 변
          out.push(x0, y0, ribTopZ, x1, y1, ribBotZ);   // 빗변 (hypotenuse)
        });
        return out;
      }
      case 'small_rib_size': {
        // 작은 리브 (small_rib_size, 50mm) — 상부 플레이트 아래 (z_top - plateT 에서 아래로)
        // 형상: 삼각형 radial bracket (sign=-1, 위에서 아래로)
        const ribTopZ = zMax - plateT;       // 상부 플레이트 아랫면
        const ribBotZ = ribTopZ - srs;       // 아래로 small_rib_size 만큼
        const out = [];
        RIB_DIRS.forEach(([dx, dy]) => {
          const x0 = dx * pipeR,           y0 = dy * pipeR;
          const x1 = dx * (pipeR + srs),   y1 = dy * (pipeR + srs);
          out.push(x0, y0, ribTopZ, x0, y0, ribBotZ);   // 파이프 측 수직 변
          out.push(x0, y0, ribTopZ, x1, y1, ribTopZ);   // 플레이트 측 수평 변
          out.push(x0, y0, ribBotZ, x1, y1, ribTopZ);   // 빗변
        });
        return out;
      }
      case 'rib_thickness': {
        // 리브 두께는 큰 리브(rib_155x155) + 작은 리브(rib_50x50) 모두 공통 사용.
        // 두 종류 리브 4방향씩 = 총 8개 리브에 ±rt/2 양쪽 면을 표시한다.
        const half = rt / 2;
        const out = [];
        // 큰 리브 (하부)
        const bigBotZ = zMin + plateT;
        const bigTopZ = bigBotZ + rs;
        RIB_DIRS.forEach(([dx, dy]) => {
          const nx = -dy, ny = dx; // 리브 면에 수직인 단위벡터
          [+half, -half].forEach((s) => {
            const ox = nx * s, oy = ny * s;
            const ax = dx * pipeR + ox,         ay = dy * pipeR + oy;
            const bx = dx * (pipeR + rs) + ox,  by = dy * (pipeR + rs) + oy;
            // 삼각형 윤곽 (양쪽 면)
            out.push(ax, ay, bigBotZ, ax, ay, bigTopZ);
            out.push(ax, ay, bigBotZ, bx, by, bigBotZ);
            out.push(ax, ay, bigTopZ, bx, by, bigBotZ);
          });
        });
        // 작은 리브 (상부)
        const smallTopZ = zMax - plateT;
        const smallBotZ = smallTopZ - srs;
        RIB_DIRS.forEach(([dx, dy]) => {
          const nx = -dy, ny = dx;
          [+half, -half].forEach((s) => {
            const ox = nx * s, oy = ny * s;
            const ax = dx * pipeR + ox,           ay = dy * pipeR + oy;
            const bx = dx * (pipeR + srs) + ox,   by = dy * (pipeR + srs) + oy;
            out.push(ax, ay, smallTopZ, ax, ay, smallBotZ);
            out.push(ax, ay, smallTopZ, bx, by, smallTopZ);
            out.push(ax, ay, smallBotZ, bx, by, smallTopZ);
          });
        });
        return out;
      }
      default:
        return null;
    }
  }

  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
   메시 빌드 — 평면 / 두께(prism) 두 가지를 모두 만들어 visibility 로 토글
   ──────────────────────────────────────────────────────────────────────── */

function buildFlatMesh(nodeMap, shellElements) {
  const quadVerts = []; const quadColors = []; const quadIds = [];
  const triVerts  = []; const triColors  = []; const triIds  = [];
  const edgePositions = [];
  const c = new THREE.Color();

  shellElements.forEach((el, idx) => {
    const pts = el.nodeIds.map((nid) => nodeMap.get(nid)).filter(Boolean);
    if (pts.length < 3) return;
    c.setHex(pts.length === 4 ? COLORS.quad : COLORS.tri);

    const push = (a, b, d, V, C, I) => {
      V.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      for (let k = 0; k < 3; k++) { C.push(c.r, c.g, c.b); I.push(idx); }
    };
    if (pts.length === 3) {
      push(pts[0], pts[1], pts[2], triVerts, triColors, triIds);
    } else {
      push(pts[0], pts[1], pts[2], quadVerts, quadColors, quadIds);
      push(pts[0], pts[2], pts[3], quadVerts, quadColors, quadIds);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });

  return assembleMesh('flatMesh', quadVerts, quadColors, quadIds, triVerts, triColors, triIds, edgePositions);
}

function buildThickMesh(nodeMap, shellElements, propMap) {
  const quadVerts = []; const quadColors = []; const quadIds = [];
  const triVerts  = []; const triColors  = []; const triIds  = [];
  const edgePositions = [];
  const c = new THREE.Color();

  const eA = new THREE.Vector3(), eB = new THREE.Vector3(), eC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();

  shellElements.forEach((el, idx) => {
    const pts = el.nodeIds.map((nid) => nodeMap.get(nid)).filter(Boolean);
    if (pts.length < 3) return;

    const thickness = extractThickness(propMap.get(el.pid)) ?? DEFAULT_SHELL_THICKNESS;
    const half = thickness / 2;

    // face normal (첫 삼각형 기준)
    eA.set(pts[0].x, pts[0].y, pts[0].z);
    eB.set(pts[1].x, pts[1].y, pts[1].z);
    eC.set(pts[2].x, pts[2].y, pts[2].z);
    e1.subVectors(eB, eA);
    e2.subVectors(eC, eA);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-12) nrm.set(0, 0, 1); else nrm.normalize();

    c.setHex(pts.length === 4 ? COLORS.quad : COLORS.tri);

    const top    = pts.map((p) => [p.x + nrm.x * half, p.y + nrm.y * half, p.z + nrm.z * half]);
    const bottom = pts.map((p) => [p.x - nrm.x * half, p.y - nrm.y * half, p.z - nrm.z * half]);

    const V = pts.length === 3 ? triVerts  : quadVerts;
    const C = pts.length === 3 ? triColors : quadColors;
    const I = pts.length === 3 ? triIds    : quadIds;
    const push = (a, b, d) => {
      V.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
      for (let k = 0; k < 3; k++) { C.push(c.r, c.g, c.b); I.push(idx); }
    };

    if (pts.length === 3) {
      push(top[0], top[1], top[2]);                  // top
      push(bottom[0], bottom[2], bottom[1]);          // bottom (reverse winding)
      for (let k = 0; k < 3; k++) {                   // side strip
        const n = (k + 1) % 3;
        push(top[k],    bottom[k], bottom[n]);
        push(top[k],    bottom[n], top[n]);
      }
    } else {
      push(top[0], top[1], top[2]);
      push(top[0], top[2], top[3]);
      push(bottom[0], bottom[2], bottom[1]);
      push(bottom[0], bottom[3], bottom[2]);
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        push(top[k],    bottom[k], bottom[n]);
        push(top[k],    bottom[n], top[n]);
      }
    }

    // edges — top / bottom / vertical
    for (let k = 0; k < pts.length; k++) {
      const n = (k + 1) % pts.length;
      edgePositions.push(top[k][0], top[k][1], top[k][2], top[n][0], top[n][1], top[n][2]);
      edgePositions.push(bottom[k][0], bottom[k][1], bottom[k][2], bottom[n][0], bottom[n][1], bottom[n][2]);
      edgePositions.push(top[k][0], top[k][1], top[k][2], bottom[k][0], bottom[k][1], bottom[k][2]);
    }
  });

  return assembleMesh('thickMesh', quadVerts, quadColors, quadIds, triVerts, triColors, triIds, edgePositions);
}

function assembleMesh(name, quadVerts, quadColors, quadIds, triVerts, triColors, triIds, edgePositions) {
  const group = new THREE.Group();
  group.name = name;

  const make = (V, C, I) => {
    if (V.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('elementIndex', new THREE.Float32BufferAttribute(I, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    return new THREE.Mesh(geo, mat);
  };

  const quadMesh = make(quadVerts, quadColors, quadIds);
  const triMesh  = make(triVerts,  triColors,  triIds);
  if (quadMesh) { quadMesh.userData.pickable = true; group.add(quadMesh); }
  if (triMesh)  { triMesh.userData.pickable  = true; group.add(triMesh);  }

  if (edgePositions.length > 0) {
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    const edges = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.35 }),
    );
    edges.name = 'edges';
    group.add(edges);
  }

  return group;
}

/* ──────────────────────────────────────────────────────────────────────────
   메인 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

export default function ShellModelViewer({ modelData, paramsJson, mode, highlightParam }) {
  const outerRef       = useRef(null);
  const mountRef       = useRef(null);
  const gizmoRef       = useRef(null);
  const sceneApiRef    = useRef(null);
  const meshGroupRef   = useRef(null);
  const nodeMarkersRef = useRef(null);
  const boundsRef      = useRef({ center: new THREE.Vector3(), maxDim: 1000 });
  const elementMetaRef = useRef([]);
  const modelBoundsRef = useRef(null); // { xMin, xMax, yMin, yMax, zMin, zMax }

  // UI 상태
  const [showElements, setShowElements] = useState(true);
  const [showNodes, setShowNodes]       = useState(false);
  const [useThickness, setUseThickness] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [selectedInfo, setSelectedInfo]   = useState(null);
  const [hoverInfo, setHoverInfo]         = useState(null);
  const [isFullscreen, setIsFullscreen]   = useState(false);

  /* ── 모델 파싱 ───────────────────────────────────────────────── */
  const { nodeMap, shellElements, propMap, summary } = useMemo(() => {
    const nm  = getNodeMap(modelData);
    const els = getShellElements(modelData);
    const pm  = getPropertyMap(modelData);
    const quadCount = els.filter((e) => e.nodeIds.length === 4).length;
    const triCount  = els.filter((e) => e.nodeIds.length === 3).length;

    // thickness 통계
    let tMin = Infinity, tMax = -Infinity, tWithProp = 0;
    els.forEach((e) => {
      const t = extractThickness(pm.get(e.pid));
      if (t != null) {
        tWithProp += 1;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
    });

    return {
      nodeMap: nm,
      shellElements: els,
      propMap: pm,
      summary: {
        shells: els.length,
        quads:  quadCount,
        tris:   triCount,
        thickness: tWithProp > 0
          ? { min: tMin, max: tMax, withProp: tWithProp, total: els.length }
          : null,
      },
    };
  }, [modelData]);

  /* ── 씬 빌드 ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!mountRef.current || nodeMap.size === 0 || shellElements.length === 0) return undefined;
    const mount = mountRef.current;

    const api = createThreeScene(mount, {
      zUp: true,
      fog: false,
      bloomStrength: 0.18,
      bloomThreshold: 0.85,
    });
    sceneApiRef.current = api;
    const { scene, camera, controls, startAnimate, cleanup } = api;

    scene.background = new THREE.Color(COLORS.background);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enableRotate  = true;
    controls.screenSpacePanning = true;

    // ── 메시: 평면/두께 두 가지를 미리 빌드 ──────────────────
    const meshGroup = new THREE.Group();
    meshGroupRef.current = meshGroup;
    scene.add(meshGroup);

    const flatGroup  = buildFlatMesh(nodeMap, shellElements);
    const thickGroup = buildThickMesh(nodeMap, shellElements, propMap);
    flatGroup.visible  = !useThickness;
    thickGroup.visible = useThickness;
    meshGroup.add(flatGroup);
    meshGroup.add(thickGroup);

    // 요소 메타 (픽킹용)
    elementMetaRef.current = shellElements.map((el) => {
      const pts = el.nodeIds.map((nid) => nodeMap.get(nid)).filter(Boolean);
      return { element: el, nodes: pts };
    });

    // ── BoundingBox / 카메라 ─────────────────────────────────
    const box  = new THREE.Box3().setFromObject(meshGroup);
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    boundsRef.current = { center, maxDim };
    modelBoundsRef.current = {
      xMin: box.min.x, xMax: box.max.x,
      yMin: box.min.y, yMax: box.max.y,
      zMin: box.min.z, zMax: box.max.z,
    };

    // ── 파라미터 하이라이트 그룹 (선언만) ─────────────────
    const paramHighlight = new THREE.Group();
    paramHighlight.name = 'paramHighlight';
    paramHighlight.renderOrder = 998;
    scene.add(paramHighlight);

    // ── 노드 마커 — 빨간 SphereGeometry InstancedMesh ───────
    // 토글 ON 이면 두께 메시 안쪽에 묻혀도 항상 보여야 한다 → depthTest 끔 + renderOrder 최상위.
    const nodeRadius = maxDim * NODE_SPHERE_RADIUS_RATIO;
    const nodeGeo = new THREE.SphereGeometry(nodeRadius, 10, 8);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: COLORS.node,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const nodeInst = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeMap.size);
    nodeInst.name = 'nodeMarkers';
    nodeInst.renderOrder = 999;
    const dummy = new THREE.Object3D();
    let i = 0;
    nodeMap.forEach((n) => {
      dummy.position.set(n.x, n.y, n.z);
      dummy.updateMatrix();
      nodeInst.setMatrixAt(i++, dummy.matrix);
    });
    nodeInst.instanceMatrix.needsUpdate = true;
    nodeInst.visible = false;
    nodeMarkersRef.current = nodeInst;
    scene.add(nodeInst);

    // ── ISO 카메라 초기 위치 ─────────────────────────────────
    camera.position.set(center.x + maxDim * 1.1, center.y - maxDim * 1.2, center.z + maxDim * 0.9);
    camera.near = Math.max(maxDim / 1000, 0.01);
    camera.far  = maxDim * 30;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();

    // ── 하이라이트 그룹 ─────────────────────────────────────
    const highlightGroup = new THREE.Group();
    highlightGroup.name = 'highlight';
    scene.add(highlightGroup);

    // ── ViewCube ────────────────────────────────────────────
    let gizmoRenderer; let gizmoScene; let gizmoCamera; let axisGroup;
    if (gizmoRef.current) {
      gizmoScene  = new THREE.Scene();
      gizmoCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
      gizmoCamera.position.set(0, 0, 4);
      gizmoRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      gizmoRenderer.setSize(112, 112);
      gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      gizmoRef.current.innerHTML = '';
      gizmoRef.current.appendChild(gizmoRenderer.domElement);

      axisGroup = new THREE.Group();
      const makeGizmoAxis = (dir, hex, label) => {
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          dir.clone().multiplyScalar(1.0),
        ]);
        axisGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: hex, linewidth: 2 })));
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.08, 0.22, 18),
          new THREE.MeshBasicMaterial({ color: hex }),
        );
        cone.position.copy(dir.clone().multiplyScalar(1.0));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        axisGroup.add(cone);
        const sprite = makeAxisLabel(label, `#${hex.toString(16).padStart(6, '0')}`);
        sprite.position.copy(dir.clone().multiplyScalar(1.32));
        axisGroup.add(sprite);
      };
      makeGizmoAxis(new THREE.Vector3(1, 0, 0), COLORS.axisX, 'X');
      makeGizmoAxis(new THREE.Vector3(0, 1, 0), COLORS.axisY, 'Y');
      makeGizmoAxis(new THREE.Vector3(0, 0, 1), COLORS.axisZ, 'Z');
      gizmoScene.add(axisGroup);
    }

    // ── 픽킹 ────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc       = new THREE.Vector2();
    let downPos = null;
    const DRAG_THRESHOLD = 4;

    const collectPickables = () => {
      const out = [];
      meshGroup.traverse((o) => { if (o.isMesh && o.visible && o.userData.pickable) out.push(o); });
      return out;
    };

    const getElementFromIntersection = (hit) => {
      if (!hit) return null;
      const face = hit.face;
      const idAttr = hit.object.geometry?.getAttribute?.('elementIndex');
      if (!face || !idAttr) return null;
      const elemIdx = Math.round(idAttr.array[face.a]);
      return elementMetaRef.current[elemIdx] ?? null;
    };

    const pickAt = (clientX, clientY) => {
      const rect = api.renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(collectPickables(), false);
      return getElementFromIntersection(hits[0]);
    };

    const onPointerDown = (e) => { downPos = { x: e.clientX, y: e.clientY }; };
    const onPointerUp   = (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > DRAG_THRESHOLD) return;
      const result = pickAt(e.clientX, e.clientY);
      setSelectedInfo(result ? { ...result.element, nodes: result.nodes } : null);
    };
    const onPointerMove = (e) => {
      if (downPos) return;
      const result = pickAt(e.clientX, e.clientY);
      setHoverInfo(result ? { id: result.element.id, type: result.element.type } : null);
      api.renderer.domElement.style.cursor = result ? 'pointer' : 'default';
    };

    api.renderer.domElement.addEventListener('pointerdown', onPointerDown);
    api.renderer.domElement.addEventListener('pointerup',   onPointerUp);
    api.renderer.domElement.addEventListener('pointermove', onPointerMove);

    // ── 애니메이션 ──────────────────────────────────────────
    startAnimate(center, maxDim, () => {
      if (axisGroup && gizmoRenderer && gizmoScene && gizmoCamera) {
        axisGroup.quaternion.copy(camera.quaternion).invert();
        gizmoRenderer.render(gizmoScene, gizmoCamera);
      }
    });

    return () => {
      api.renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      api.renderer.domElement.removeEventListener('pointerup',   onPointerUp);
      api.renderer.domElement.removeEventListener('pointermove', onPointerMove);
      gizmoRenderer?.dispose();
      cleanup();
      sceneApiRef.current = null;
      meshGroupRef.current = null;
      nodeMarkersRef.current = null;
    };
  }, [nodeMap, shellElements, propMap]);

  /* ── 토글: Element 표시 ────────────────────────────────────────── */
  useEffect(() => {
    const mg = meshGroupRef.current;
    if (!mg) return;
    const flat  = mg.getObjectByName('flatMesh');
    const thick = mg.getObjectByName('thickMesh');
    const activeFlat  = showElements && !useThickness;
    const activeThick = showElements &&  useThickness;
    if (flat)  flat.visible  = activeFlat;
    if (thick) thick.visible = activeThick;
  }, [showElements, useThickness]);

  /* ── 토글: Node 표시 ───────────────────────────────────────────── */
  useEffect(() => {
    const inst = nodeMarkersRef.current;
    if (inst) inst.visible = showNodes;
  }, [showNodes]);

  /* ── 선택 하이라이트 ──────────────────────────────────────────── */
  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) return;
    const highlight = api.scene.getObjectByName('highlight');
    if (!highlight) return;
    while (highlight.children.length) {
      const cc = highlight.children.pop();
      cc.geometry?.dispose?.();
      cc.material?.dispose?.();
    }
    if (!selectedInfo?.nodes) return;
    const pts = selectedInfo.nodes;
    const positions = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k]; const b = pts[(k + 1) % pts.length];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: COLORS.selected, depthTest: false, transparent: true, opacity: 0.95,
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.renderOrder = 999;
    highlight.add(seg);

    pts.forEach((n) => {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(boundsRef.current.maxDim * 0.008, 12, 12),
        new THREE.MeshBasicMaterial({ color: COLORS.selected, depthTest: false }),
      );
      sphere.position.set(n.x, n.y, n.z);
      sphere.renderOrder = 1000;
      highlight.add(sphere);
    });
  }, [selectedInfo]);

  /* ── 파라미터 하이라이트 (필드 클릭/포커스 시 굵은 선) ────────── */
  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) return;
    const group = api.scene.getObjectByName('paramHighlight');
    if (!group) return;
    // 기존 하이라이트 제거
    while (group.children.length) {
      const cc = group.children.pop();
      cc.geometry?.dispose?.();
      cc.material?.dispose?.();
    }
    if (!highlightParam || !paramsJson || !modelBoundsRef.current) return;
    const positions = computeParamHighlight(highlightParam, paramsJson, modelBoundsRef.current, mode);
    if (!positions || positions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // 굵은 선 효과: depthTest 끈 LineSegments + 약간 떨어뜨린 위치는 ring spheres 로 점선처럼
    const mat = new THREE.LineBasicMaterial({
      color: 0xfacc15,         // yellow-400 — 모델 색과 강한 대비
      depthTest: false,
      transparent: true,
      opacity: 1.0,
      linewidth: 4,            // 대부분 브라우저에서 무시되지만 명시
    });
    const segs = new THREE.LineSegments(geo, mat);
    segs.renderOrder = 998;
    group.add(segs);

    // linewidth 가 WebGL 에서 무시되는 점 보완: 같은 선을 작은 sphere 들로 강조
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xfde047, depthTest: false, transparent: true, opacity: 0.95,
    });
    const dotR = (boundsRef.current?.maxDim || 200) * 0.006;
    const dotGeo = new THREE.SphereGeometry(dotR, 8, 6);
    const dummy = new THREE.Object3D();
    const inst = new THREE.InstancedMesh(dotGeo, dotMat, Math.floor(positions.length / 3));
    inst.renderOrder = 999;
    for (let i = 0; i < positions.length; i += 3) {
      dummy.position.set(positions[i], positions[i + 1], positions[i + 2]);
      dummy.updateMatrix();
      inst.setMatrixAt(Math.floor(i / 3), dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }, [highlightParam, paramsJson, mode]);

  /* ── 카메라 프리셋 ─────────────────────────────────────────────── */
  const setCameraView = useCallback((preset) => {
    const api = sceneApiRef.current;
    if (!api) return;
    const { center, maxDim } = boundsRef.current;
    const d = maxDim * 1.6;
    let pos;
    switch (preset) {
      case 'iso':   pos = [center.x + d * 0.7, center.y - d * 0.85, center.z + d * 0.6]; break;
      case 'top':   pos = [center.x, center.y, center.z + d]; break;
      case 'front': pos = [center.x, center.y - d, center.z]; break;
      case 'right': pos = [center.x + d, center.y, center.z]; break;
      default:      pos = [center.x + d * 0.7, center.y - d * 0.85, center.z + d * 0.6];
    }
    api.camera.position.set(pos[0], pos[1], pos[2]);
    api.camera.lookAt(center);
    api.controls.target.copy(center);
    api.controls.update();
  }, []);

  /* ── 전체화면 토글 ─────────────────────────────────────────────── */
  const toggleFullscreen = useCallback(() => {
    const el = outerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === outerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ── 빈 상태 ──────────────────────────────────────────────────── */
  if (!modelData) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-950">
        <Box size={28} className="mb-2" />
        <p className="text-sm font-semibold">PDF를 선택하고 변환을 실행하세요</p>
      </div>
    );
  }

  /* ── 렌더 ─────────────────────────────────────────────────────── */
  return (
    <div ref={outerRef} className="relative w-full h-full min-h-[520px] bg-[#0a0f1a] overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />

      {/* ── 좌측 상단: 토글 + 통계 ──────────────────────────────── */}
      {showInspector && (
        <div className="absolute left-3 top-3 w-[230px] rounded-xl bg-slate-900/85 backdrop-blur border border-slate-700/80 shadow-xl text-slate-200 text-[11px] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/60">
            <div className="flex items-center gap-1.5 font-bold text-slate-100">
              <Layers size={13} className="text-blue-400" /> Shell Model
            </div>
            <button
              onClick={() => setShowInspector(false)}
              className="p-0.5 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-slate-200"
              title="Inspector 숨김"
            >
              <ChevronLeft size={13} />
            </button>
          </div>

          {/* Display 토글 */}
          <div className="px-3 py-2.5 border-b border-slate-700/60 space-y-1.5">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Display</div>
            <label className="flex items-center justify-between gap-2 cursor-pointer select-none px-1 py-0.5 rounded hover:bg-slate-800/60">
              <span className="flex items-center gap-1.5">
                <Square size={11} className="text-blue-400" />
                <span className="text-slate-200">Element</span>
              </span>
              <input
                type="checkbox"
                checked={showElements}
                onChange={(e) => setShowElements(e.target.checked)}
                className="accent-blue-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 cursor-pointer select-none px-1 py-0.5 rounded hover:bg-slate-800/60">
              <span className="flex items-center gap-1.5">
                <Circle size={11} className="text-rose-400 fill-rose-400" />
                <span className="text-slate-200">Node</span>
              </span>
              <input
                type="checkbox"
                checked={showNodes}
                onChange={(e) => setShowNodes(e.target.checked)}
                className="accent-rose-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 cursor-pointer select-none px-1 py-0.5 rounded hover:bg-slate-800/60">
              <span className="flex items-center gap-1.5">
                <Sandwich size={11} className="text-amber-400" />
                <span className="text-slate-200">Thickness</span>
              </span>
              <input
                type="checkbox"
                checked={useThickness}
                onChange={(e) => setUseThickness(e.target.checked)}
                className="accent-amber-500"
              />
            </label>
          </div>

          <div className="p-3 space-y-2">
            {summary.thickness && (
              <div className="pt-2 border-t border-slate-700/60">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Thickness (mm)</div>
                <div className="grid grid-cols-[36px_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
                  <span className="text-amber-300">Min</span>
                  <span className="text-right text-slate-200">{summary.thickness.min.toFixed(2)}</span>
                  <span className="text-amber-300">Max</span>
                  <span className="text-right text-slate-200">{summary.thickness.max.toFixed(2)}</span>
                  <span className="text-amber-300">Cov</span>
                  <span className="text-right text-slate-300">
                    {summary.thickness.withProp} / {summary.thickness.total}
                  </span>
                </div>
              </div>
            )}

            {selectedInfo && (
              <div className="pt-2 border-t border-slate-700/60">
                <div className="flex items-center gap-1 mb-1">
                  <Crosshair size={10} className="text-orange-400" />
                  <span className="text-[10px] font-bold text-orange-300 uppercase tracking-wider">Selected</span>
                </div>
                <div className="grid grid-cols-[58px_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono">
                  <span className="text-slate-400">Type</span>
                  <span className="text-right text-slate-100">{selectedInfo.type}</span>
                  <span className="text-slate-400">EID</span>
                  <span className="text-right text-orange-300">{selectedInfo.id}</span>
                  {selectedInfo.pid != null && (
                    <>
                      <span className="text-slate-400">PID</span>
                      <span className="text-right text-slate-100">{selectedInfo.pid}</span>
                    </>
                  )}
                  {(() => {
                    const t = extractThickness(propMap.get(selectedInfo.pid));
                    return t != null ? (
                      <>
                        <span className="text-slate-400">T</span>
                        <span className="text-right text-amber-300">{t.toFixed(2)} mm</span>
                      </>
                    ) : null;
                  })()}
                  <span className="text-slate-400">Nodes</span>
                  <span className="text-right text-slate-100">{selectedInfo.nodeIds.join(', ')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {!showInspector && (
        <button
          onClick={() => setShowInspector(true)}
          className="absolute left-3 top-3 p-1.5 rounded-lg bg-slate-900/85 backdrop-blur border border-slate-700/80 shadow-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/85 transition-colors"
          title="Inspector 표시"
        >
          <Info size={14} />
        </button>
      )}

      {/* ── 우측 상단: ViewCube + 카메라 프리셋 + Fit + Fullscreen ─── */}
      <div className="absolute right-3 top-3 flex flex-col gap-2 items-end">
        <div ref={gizmoRef} className="w-28 h-28 rounded-xl bg-slate-900/75 backdrop-blur border border-slate-700/80 shadow-xl" />

        <div className="rounded-xl bg-slate-900/85 backdrop-blur border border-slate-700/80 shadow-xl p-1.5 grid grid-cols-4 gap-1">
          {[
            { key: 'iso',   label: 'ISO'   },
            { key: 'top',   label: 'Top'   },
            { key: 'front', label: 'Front' },
            { key: 'right', label: 'Right' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCameraView(key)}
              className="px-2 py-1 rounded-md text-[10px] font-semibold text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setCameraView('iso')}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600/80 hover:bg-blue-600 text-white flex items-center gap-1.5 shadow-md transition-colors"
            title="Fit View"
          >
            <Maximize2 size={11} /> Fit
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700/80 hover:bg-slate-700 text-white flex items-center gap-1.5 shadow-md transition-colors"
            title={isFullscreen ? '전체화면 해제 (ESC)' : '전체화면'}
          >
            {isFullscreen
              ? <><Shrink size={11} /> Exit</>
              : <><Expand size={11} /> Full</>}
          </button>
        </div>
      </div>

      {/* ── 호버 툴팁 ───────────────────────────────────────────── */}
      {hoverInfo && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-slate-900/95 border border-orange-500/40 shadow-lg px-3 py-1 text-[10px] font-mono text-slate-100">
          {hoverInfo.type} <span className="text-orange-300">#{hoverInfo.id}</span>
        </div>
      )}

      {/* ── 도움말 ─────────────────────────────────────────────── */}
      <div className="absolute right-3 bottom-3 rounded-lg bg-slate-900/70 backdrop-blur border border-slate-700/60 shadow-md px-2.5 py-1.5 text-[9px] text-slate-400 font-mono">
        <div>LMB: 회전 · RMB: 팬 · 휠: 줌 · Click: 선택</div>
      </div>
    </div>
  );
}
