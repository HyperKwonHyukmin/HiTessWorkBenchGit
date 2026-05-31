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

const NO_RESULT_GRAY = 0x444b57;         // 결과값 없는 요소 색

/** Jet 컬러맵: t(0..1) → [r,g,b] (0..1). blue→cyan→green→yellow→red. */
function jetRGB(t) {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, 0, 0, 1], [0.25, 0, 1, 1], [0.50, 0, 1, 0], [0.75, 1, 1, 0], [1.00, 1, 0, 0],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, r0, g0, b0] = stops[i];
    const [p1, r1, g1, b1] = stops[i + 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0 || 1);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [1, 0, 0];
}
// 범례 그라디언트 (아래=min=파랑 → 위=max=빨강)
const LEGEND_GRADIENT = 'linear-gradient(to top, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';

/** 결과값 표시 포맷 — 큰/작은 값은 지수, 중간은 소수 2자리. */
function fmtResultValue(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-2)) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

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
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // 가독성 향상: 어두운 외곽선 + 굵은 글자
  ctx.font = 'bold 104px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 64, 70);
  ctx.fillStyle = hexColor;
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.55, 0.55, 1);
  return sprite;
}

/** 텍스트 pill 스프라이트 (경계조건 자유도 라벨 등). aspect 4:1 캔버스. */
function makeTextPillSprite(text, fgColor, bgColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const r = 14;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(256, 0, 256, 64, r);
  ctx.arcTo(256, 64, 0, 64, r);
  ctx.arcTo(0, 64, 0, 0, r);
  ctx.arcTo(0, 0, 256, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fgColor;
  ctx.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.renderOrder = 1001;
  return sprite;
}

/** 입체 화살표(원기둥 shaft + 원뿔 head). dir 방향, 화살촉 끝이 tip 에 오도록 배치. */
function buildForceArrow(dir, tip, len, color) {
  const g = new THREE.Group();
  const headLen = len * 0.34;
  const shaftLen = Math.max(len - headLen, len * 0.4);
  const headR = len * 0.13;
  const shaftR = len * 0.05;
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.97 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 12), mat);
  shaft.position.y = shaftLen / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headLen, 18), mat);
  head.position.y = shaftLen + headLen / 2;
  g.add(shaft);
  g.add(head);
  // 로컬 +Y 축이 base→tip 방향이 되도록 회전, base 를 tip 에서 dir 반대로 len 만큼.
  const ndir = dir.clone().normalize();
  const base = tip.clone().addScaledVector(ndir, -len);
  g.position.copy(base);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ndir);
  g.traverse((o) => { if (o.isMesh) o.renderOrder = 999; });
  return g;
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

export default function ShellModelViewer({
  modelData, paramsJson, mode, highlightParam,
  // ── 하중/경계조건 노드 선택 (선택적) ──
  selectionMode = 'none',          // 'none' | 'load' | 'bc' | 'rbe3'
  selectedNodeIds = null,          // 현재 선택 중인 노드 id 배열 (controlled)
  onSelectionChange = null,        // (idsArray) => void
  loadSets = null,                 // [{ nodes:[id], fx, fy, fz }]  글리프 렌더
  bcSets = null,                   // [{ nodes:[id], dof }]         글리프 렌더
  holeRbe = null,                  // { center:{x,y,z}, ringNodeIds:[id], fx, fy, fz }  RBE2 시각화
  rbe3Sets = null,                 // [{ refId, center:{x,y,z}, nodeIds:[id] }]  RBE3 시각화
  swapYZ = false,                  // 표시 데이터가 Y↔Z 스왑된 프레임인지 (Lug)
  // ── 결과 컨투어 (선택적) ──
  resultField = 'none',            // 'none' | 'disp' | 'vm'
  elementValues = null,            // { [elementId]: number }  활성 필드의 요소별 대표값
  valueRange = null,               // [min, max]
  valueLabel = '',                 // 범례 제목 (예: 'von Mises (MPa)')
  valueUnit = '',                  // 값 단위 (예: 'MPa', 'mm')
}) {
  const outerRef       = useRef(null);
  const mountRef       = useRef(null);
  const gizmoRef       = useRef(null);
  const sceneApiRef    = useRef(null);
  const meshGroupRef   = useRef(null);
  const nodeMarkersRef = useRef(null);
  const boundsRef      = useRef({ center: new THREE.Vector3(), maxDim: 1000 });
  const elementMetaRef = useRef([]);
  const modelBoundsRef = useRef(null); // { xMin, xMax, yMin, yMax, zMin, zMax }

  // ── 노드 선택용 refs (이벤트 핸들러가 최신값을 stale 없이 읽도록) ──
  const nodePositionsRef     = useRef([]);   // [{ id, x, y, z }]
  const selectionModeRef     = useRef(selectionMode);
  const selectedIdsRef       = useRef(new Set());
  const onSelectionChangeRef = useRef(onSelectionChange);
  const resultFieldRef       = useRef(resultField);
  const elementValuesRef     = useRef(elementValues);

  // UI 상태
  const [showElements, setShowElements] = useState(true);
  const [showNodes, setShowNodes]       = useState(false);
  const [useThickness, setUseThickness] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [selectedInfo, setSelectedInfo]   = useState(null);
  const [hoverInfo, setHoverInfo]         = useState(null);
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [dragRect, setDragRect]           = useState(null); // 화면 좌표 고무줄 박스 {x,y,w,h}

  const selecting = selectionMode !== 'none';

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
      controlsType: 'trackball',   // 극점에서 멈추지 않는 무한 자유 회전
    });
    sceneApiRef.current = api;
    const { scene, camera, controls, startAnimate, cleanup } = api;

    scene.background = new THREE.Color(COLORS.background);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

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
    const nodePositions = [];
    nodeMap.forEach((n) => {
      dummy.position.set(n.x, n.y, n.z);
      dummy.updateMatrix();
      nodeInst.setMatrixAt(i++, dummy.matrix);
      nodePositions.push({ id: n.id, x: n.x, y: n.y, z: n.z });
    });
    nodeInst.instanceMatrix.needsUpdate = true;
    nodeInst.visible = selectionModeRef.current !== 'none';
    nodeMarkersRef.current = nodeInst;
    nodePositionsRef.current = nodePositions;
    scene.add(nodeInst);

    // ── 노드 선택/글리프 그룹 ────────────────────────────────
    const nodeSelGroup = new THREE.Group();
    nodeSelGroup.name = 'nodeSelection';
    nodeSelGroup.renderOrder = 1000;
    scene.add(nodeSelGroup);

    const glyphGroup = new THREE.Group();
    glyphGroup.name = 'loadBcGlyphs';
    glyphGroup.renderOrder = 997;
    scene.add(glyphGroup);

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
      gizmoCamera.position.set(0, 0, 5);
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
        sprite.position.copy(dir.clone().multiplyScalar(1.5));
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

    // ── 노드 선택 유틸 ──────────────────────────────────────
    const projVec = new THREE.Vector3();
    const projectNodeToClient = (n, rect) => {
      projVec.set(n.x, n.y, n.z).project(camera);
      if (projVec.z < -1 || projVec.z > 1) return null; // 카메라 뒤/밖
      return {
        sx: rect.left + (projVec.x * 0.5 + 0.5) * rect.width,
        sy: rect.top + (-projVec.y * 0.5 + 0.5) * rect.height,
      };
    };
    const emitSelection = () => {
      const arr = Array.from(selectedIdsRef.current);
      onSelectionChangeRef.current?.(arr);
    };
    const selectNodesInBox = (minX, minY, maxX, maxY) => {
      const rect = api.renderer.domElement.getBoundingClientRect();
      const set = selectedIdsRef.current;
      let added = 0;
      for (const n of nodePositionsRef.current) {
        const p = projectNodeToClient(n, rect);
        if (!p) continue;
        if (p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY) {
          set.add(n.id);
          added += 1;
        }
      }
      if (added > 0) emitSelection();
    };
    const toggleNearestNode = (clientX, clientY) => {
      const rect = api.renderer.domElement.getBoundingClientRect();
      let best = null; let bestD = 14; // px 임계
      for (const n of nodePositionsRef.current) {
        const p = projectNodeToClient(n, rect);
        if (!p) continue;
        const d = Math.hypot(p.sx - clientX, p.sy - clientY);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (!best) return;
      const set = selectedIdsRef.current;
      if (set.has(best.id)) set.delete(best.id); else set.add(best.id);
      emitSelection();
    };

    let boxSelecting = false;
    let boxStart = null;

    const onPointerDown = (e) => {
      if (e.button === 0 && selectionModeRef.current !== 'none') {
        if (e.shiftKey) {
          // Shift + 좌드래그 = 영역(박스) 선택. 그동안 OrbitControls 회전 잠시 끔.
          boxSelecting = true;
          boxStart = { x: e.clientX, y: e.clientY };
          if (api.controls) api.controls.enabled = false;
          const rect = api.renderer.domElement.getBoundingClientRect();
          setDragRect({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 });
          return;
        }
        // Shift 없는 좌클릭: 회전(OrbitControls)에 맡기되, 이동 없는 클릭이면 노드 토글
        downPos = { x: e.clientX, y: e.clientY };
        return;
      }
      if (selectionModeRef.current === 'none') {
        downPos = { x: e.clientX, y: e.clientY }; // element pick (선택 모드 아님)
      }
    };
    const onPointerUp = (e) => {
      if (boxSelecting) {
        boxSelecting = false;
        if (api.controls) api.controls.enabled = true;
        const moved = Math.hypot(e.clientX - boxStart.x, e.clientY - boxStart.y);
        if (moved > DRAG_THRESHOLD) {
          const minX = Math.min(boxStart.x, e.clientX);
          const maxX = Math.max(boxStart.x, e.clientX);
          const minY = Math.min(boxStart.y, e.clientY);
          const maxY = Math.max(boxStart.y, e.clientY);
          selectNodesInBox(minX, minY, maxX, maxY);
        }
        boxStart = null;
        setDragRect(null);
        return;
      }
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      const wasSelecting = selectionModeRef.current !== 'none';
      downPos = null;
      if (moved > DRAG_THRESHOLD) return; // 드래그(회전)였음 → 선택 동작 없음
      if (wasSelecting) {
        toggleNearestNode(e.clientX, e.clientY); // 정지 클릭 → 단일 노드 토글
      } else {
        const result = pickAt(e.clientX, e.clientY);
        setSelectedInfo(result ? { ...result.element, nodes: result.nodes } : null);
      }
    };
    const onPointerMove = (e) => {
      if (boxSelecting && boxStart) {
        // 오버레이는 컨테이너(캔버스) 로컬 좌표로 그린다.
        const rect = api.renderer.domElement.getBoundingClientRect();
        const sx = boxStart.x - rect.left, sy = boxStart.y - rect.top;
        const cx = e.clientX - rect.left,  cy = e.clientY - rect.top;
        setDragRect({
          x: Math.min(sx, cx),
          y: Math.min(sy, cy),
          w: Math.abs(cx - sx),
          h: Math.abs(cy - sy),
        });
        return;
      }
      if (selectionModeRef.current !== 'none') {
        // Shift 누르면 영역 선택 가능 표시(crosshair), 아니면 회전(기본 커서)
        api.renderer.domElement.style.cursor = e.shiftKey ? 'crosshair' : 'default';
        return;
      }
      if (downPos) return;
      const result = pickAt(e.clientX, e.clientY);
      if (result && resultFieldRef.current !== 'none') {
        const val = elementValuesRef.current?.[result.element.id];
        setHoverInfo({ id: result.element.id, type: result.element.type, value: val });
      } else {
        setHoverInfo(result ? { id: result.element.id, type: result.element.type } : null);
      }
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

  /* ── 토글: Node 표시 (선택 모드에서는 항상 표시) ─────────────────── */
  useEffect(() => {
    const inst = nodeMarkersRef.current;
    if (inst) inst.visible = showNodes || selectionMode !== 'none';
  }, [showNodes, selectionMode]);

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
    // computeParamHighlight 는 원본(BDF) 프레임 가정으로 작성됨.
    // 표시 데이터가 스왑된 경우(lug): 표시 bounds → 원본 bounds 로 언스왑해 계산한 뒤
    // 결과 좌표를 다시 표시 프레임으로 스왑한다.
    const db = modelBoundsRef.current;
    const calcBounds = swapYZ
      ? { xMin: db.xMin, xMax: db.xMax, yMin: db.zMin, yMax: db.zMax, zMin: db.yMin, zMax: db.yMax }
      : db;
    const positions = computeParamHighlight(highlightParam, paramsJson, calcBounds, mode);
    if (!positions || positions.length === 0) return;
    if (swapYZ) {
      for (let i = 0; i < positions.length; i += 3) {
        const t = positions[i + 1]; positions[i + 1] = positions[i + 2]; positions[i + 2] = t;
      }
    }

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
  }, [highlightParam, paramsJson, mode, swapYZ]);

  /* ── 노드 선택: ref 동기화 ───────────────────────────────────── */
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  useEffect(() => {
    selectedIdsRef.current = new Set((selectedNodeIds || []).map(Number));
  }, [selectedNodeIds]);

  /* ── 노드 선택: 모드 ref 동기화 ──────────────────────────────────
     좌클릭은 항상 회전(OrbitControls 기본 LEFT=ROTATE 유지). 영역 선택은
     Shift+드래그일 때만 회전을 잠시 끄고 박스 선택을 수행한다(핸들러에서 처리). */
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => { resultFieldRef.current = resultField; }, [resultField]);
  useEffect(() => { elementValuesRef.current = elementValues; }, [elementValues]);

  /* ── 결과 컨투어: 요소별 색 재지정 (vertexColors 재작성) ─────────── */
  useEffect(() => {
    const mg = meshGroupRef.current;
    if (!mg) return;
    const meta = elementMetaRef.current || [];
    const vals = elementValues || {};
    const [vmin, vmax] = valueRange || [0, 1];
    const span = (vmax - vmin) || 1;
    const tmp = new THREE.Color();
    mg.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const idxAttr = geo?.getAttribute?.('elementIndex');
      const colAttr = geo?.getAttribute?.('color');
      if (!idxAttr || !colAttr) return;
      for (let v = 0; v < idxAttr.count; v++) {
        const el = meta[Math.round(idxAttr.array[v])]?.element;
        let r, g, b;
        if (resultField === 'none' || !el) {
          tmp.setHex(el && el.nodeIds && el.nodeIds.length === 4 ? COLORS.quad : COLORS.tri);
          r = tmp.r; g = tmp.g; b = tmp.b;
        } else {
          const val = vals[el.id];
          if (val == null) { tmp.setHex(NO_RESULT_GRAY); r = tmp.r; g = tmp.g; b = tmp.b; }
          else { [r, g, b] = jetRGB((val - vmin) / span); }
        }
        colAttr.array[3 * v] = r; colAttr.array[3 * v + 1] = g; colAttr.array[3 * v + 2] = b;
      }
      colAttr.needsUpdate = true;
    });
  }, [resultField, elementValues, valueRange, modelData]);

  /* ── 노드 선택: 선택된 노드 하이라이트 ─────────────────────────── */
  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) return;
    const group = api.scene.getObjectByName('nodeSelection');
    if (!group) return;
    while (group.children.length) {
      const cc = group.children.pop();
      cc.geometry?.dispose?.();
      cc.material?.dispose?.();
    }
    const ids = (selectedNodeIds || []).map(Number);
    if (ids.length === 0) return;
    const r = (boundsRef.current?.maxDim || 200) * 0.0075;
    const geo = new THREE.SphereGeometry(r, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: selectionMode === 'bc' ? 0x22c55e : selectionMode === 'rbe3' ? 0x0ea5e9 : 0xf97316,
      depthTest: false, transparent: true, opacity: 0.95,
    });
    const idSet = new Set(ids);
    const pts = nodePositionsRef.current.filter((n) => idSet.has(n.id));
    const inst = new THREE.InstancedMesh(geo, mat, pts.length);
    inst.renderOrder = 1001;
    const dummy = new THREE.Object3D();
    pts.forEach((n, k) => {
      dummy.position.set(n.x, n.y, n.z);
      dummy.updateMatrix();
      inst.setMatrixAt(k, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }, [selectedNodeIds, selectionMode]);

  /* ── 노드 선택: 확정된 하중/경계조건 글리프 ─────────────────────── */
  useEffect(() => {
    const api = sceneApiRef.current;
    if (!api) return;
    const group = api.scene.getObjectByName('loadBcGlyphs');
    if (!group) return;
    while (group.children.length) {
      const cc = group.children.pop();
      cc.geometry?.dispose?.();
      cc.material?.dispose?.();
    }
    const posById = new Map(nodePositionsRef.current.map((n) => [n.id, n]));
    const maxDim = boundsRef.current?.maxDim || 200;

    // 경계조건 글리프 — 초록 삼각형(3면 피라미드) 심볼 + 자유도(dof) 라벨
    const bcGeo = new THREE.ConeGeometry(maxDim * 0.013, maxDim * 0.022, 3);
    const bcMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, transparent: true, opacity: 0.92 });
    (bcSets || []).forEach((bc) => {
      const pts = (bc.nodes || []).map((id) => posById.get(Number(id))).filter(Boolean);
      if (!pts.length) return;
      const inst = new THREE.InstancedMesh(bcGeo, bcMat, pts.length);
      inst.renderOrder = 998;
      const dummy = new THREE.Object3D();
      let cx = 0, cy = 0, cz = 0;
      pts.forEach((n, k) => {
        dummy.position.set(n.x, n.y, n.z); dummy.updateMatrix(); inst.setMatrixAt(k, dummy.matrix);
        cx += n.x; cy += n.y; cz += n.z;
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);

      // 자유도 라벨 — 세트 노드 중심에 'dof 123456' pill 표시
      const dof = String(bc.dof || '123456');
      const label = makeTextPillSprite(`dof ${dof}`, '#6ee7b7', 'rgba(5,46,22,0.85)');
      const w = maxDim * 0.16;
      label.scale.set(w, w * 0.25, 1);            // 256:64 = 4:1
      label.position.set(cx / pts.length, cy / pts.length, cz / pts.length + maxDim * 0.03);
      group.add(label);
    });

    // 하중 글리프 — 입체 주황 화살표(눈에 잘 띄게) + 크기(N) 라벨.
    const FORCE_COLOR = 0xff7a18;
    const arrowLen = maxDim * 0.2;
    (loadSets || []).forEach((ls) => {
      const fx = Number(ls.fx || 0), fy = Number(ls.fy || 0), fz = Number(ls.fz || 0);
      const mag = Math.hypot(fx, fy, fz);
      if (mag === 0) return;
      const dir = new THREE.Vector3(fx, fy, fz).normalize();
      let cx = 0, cy = 0, cz = 0, cnt = 0;
      (ls.nodes || []).forEach((id) => {
        const n = posById.get(Number(id));
        if (!n) return;
        const tip = new THREE.Vector3(n.x, n.y, n.z);
        group.add(buildForceArrow(dir, tip, arrowLen, FORCE_COLOR));
        cx += n.x; cy += n.y; cz += n.z; cnt += 1;
      });
      if (cnt > 0) {
        // 크기 라벨 — 화살표 꼬리(노드 반대편) 위쪽에 표시
        const txt = `${Math.round(mag).toLocaleString()} N`;
        const label = makeTextPillSprite(txt, '#fff7ed', 'rgba(124,45,18,0.92)');
        const w = maxDim * 0.18;
        label.scale.set(w, w * 0.25, 1);
        const c = new THREE.Vector3(cx / cnt, cy / cnt, cz / cnt).addScaledVector(dir, -arrowLen * 1.22);
        label.position.copy(c);
        group.add(label);
      }
    });

    // ── Lug Hole RBE2 스파이더 시각화 ──────────────────────────
    if (holeRbe && holeRbe.center && (holeRbe.ringNodeIds || []).length) {
      const c = holeRbe.displayCenter || holeRbe.center;   // 표시는 띄운 위치(선택 편의)
      const ringPts = holeRbe.ringNodeIds.map((id) => posById.get(Number(id))).filter(Boolean);

      // 스포크 — 중심에서 각 ring 노드로
      const spokePos = [];
      ringPts.forEach((n) => { spokePos.push(c.x, c.y, c.z, n.x, n.y, n.z); });
      if (spokePos.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(spokePos, 3));
        const spokes = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({
          color: 0xf472b6, depthTest: false, transparent: true, opacity: 0.55,
        }));
        spokes.renderOrder = 998;
        group.add(spokes);
      }

      // 중심 독립노드 — 마젠타 구 (하중 영역에서 선택 대상)
      const cs = new THREE.Mesh(
        new THREE.SphereGeometry(maxDim * 0.014, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0xec4899, depthTest: false }),
      );
      cs.position.set(c.x, c.y, c.z);
      cs.renderOrder = 1000;
      group.add(cs);
    }

    // ── Area RBE3 시각화 (하늘색 스파이더 + 기준노드 구) ───────────
    (rbe3Sets || []).forEach((r) => {
      if (!r || !r.center || !(r.nodeIds || []).length) return;
      const c = r.displayCenter || r.center;   // 표시는 띄운 위치(선택 편의)
      const pts = r.nodeIds.map((id) => posById.get(Number(id))).filter(Boolean);

      // 스포크 — 기준노드에서 각 영역 노드로 (RBE2 와 구분되는 하늘색)
      const spokePos = [];
      pts.forEach((n) => { spokePos.push(c.x, c.y, c.z, n.x, n.y, n.z); });
      if (spokePos.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(spokePos, 3));
        const spokes = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({
          color: 0x38bdf8, depthTest: false, transparent: true, opacity: 0.45,
        }));
        spokes.renderOrder = 997;
        group.add(spokes);
      }

      // 기준노드(REFGRID) — 하늘색 구 (하중 영역에서 선택 대상)
      const cs = new THREE.Mesh(
        new THREE.SphereGeometry(maxDim * 0.014, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0x0ea5e9, depthTest: false }),
      );
      cs.position.set(c.x, c.y, c.z);
      cs.renderOrder = 1000;
      group.add(cs);
    });
  }, [loadSets, bcSets, holeRbe, rbe3Sets]);

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
    // trackball 자유 회전으로 up 축이 틀어진 상태에서도 프리셋 뷰가 깔끔하도록 up 재설정.
    // top(−Z 시선)은 up=+Y, 그 외는 up=+Z.
    api.camera.up.set(0, 0, 1);
    if (preset === 'top') api.camera.up.set(0, 1, 0);
    api.camera.position.set(pos[0], pos[1], pos[2]);
    api.camera.lookAt(center);
    api.controls.target?.copy(center);
    api.controls.update();
  }, []);

  /* ── 키보드 단축키: F=Fit(ISO), A=Top, S=Front, D=Right ──────────
     입력 필드에 포커스가 있거나 수식어 키가 눌린 경우는 무시한다. */
  useEffect(() => {
    const KEY_MAP = { f: 'iso', a: 'top', s: 'front', d: 'right' };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const preset = KEY_MAP[e.key.toLowerCase()];
      if (!preset) return;
      e.preventDefault();
      setCameraView(preset);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCameraView]);

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
            { key: 'top',   label: 'Top',   hot: 'A' },
            { key: 'front', label: 'Front', hot: 'S' },
            { key: 'right', label: 'Right', hot: 'D' },
          ].map(({ key, label, hot }) => (
            <button
              key={key}
              onClick={() => setCameraView(key)}
              title={hot ? `${label} (${hot})` : label}
              className="px-2 py-1 rounded-md text-[10px] font-semibold text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 transition-colors"
            >
              {label}{hot && <span className="ml-0.5 text-[8px] text-slate-500">{hot}</span>}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setCameraView('iso')}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600/80 hover:bg-blue-600 text-white flex items-center gap-1.5 shadow-md transition-colors"
            title="Fit View (F)"
          >
            <Maximize2 size={11} /> Fit <span className="text-[9px] text-blue-200">F</span>
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
          {resultField !== 'none' && 'value' in hoverInfo && (
            <span className="ml-1.5 text-cyan-300">
              · {fmtResultValue(hoverInfo.value)} {valueUnit}
            </span>
          )}
        </div>
      )}

      {/* ── 결과 컨투어 범례 ─────────────────────────────────────── */}
      {resultField !== 'none' && valueRange && (
        <div className="absolute left-3 bottom-3 rounded-lg bg-slate-900/85 backdrop-blur border border-slate-700/70 shadow-xl px-2.5 py-2">
          <div className="text-[10px] font-bold text-slate-200 mb-1.5 text-center">{valueLabel}</div>
          <div className="flex items-stretch gap-1.5 h-32">
            <div className="w-3.5 rounded-sm border border-slate-600/60" style={{ background: LEGEND_GRADIENT }} />
            <div className="flex flex-col justify-between text-[9px] font-mono text-slate-300 py-0.5">
              <span>{fmtResultValue(valueRange[1])}</span>
              <span>{fmtResultValue((valueRange[0] + valueRange[1]) / 2)}</span>
              <span>{fmtResultValue(valueRange[0])}</span>
            </div>
          </div>
          <div className="text-[8px] text-slate-500 text-center mt-1">{valueUnit}</div>
        </div>
      )}

      {/* ── 도움말 ─────────────────────────────────────────────── */}
      <div className="absolute right-3 bottom-3 rounded-lg bg-slate-900/70 backdrop-blur border border-slate-700/60 shadow-md px-2.5 py-1.5 text-[9px] text-slate-400 font-mono">
        {selecting
          ? <div>LMB: 회전 · <span className="text-cyan-300 font-bold">Shift+드래그: 영역 선택</span> · Click: 노드 토글 · RMB: 팬 · 휠: 줌 · <span className="text-blue-300">F</span>:Fit <span className="text-blue-300">A/S/D</span>:Top/Front/Right</div>
          : <div>LMB: 회전 · RMB: 팬 · 휠: 줌 · Click: 선택 · <span className="text-blue-300">F</span>:Fit <span className="text-blue-300">A/S/D</span>:Top/Front/Right</div>}
      </div>

      {/* ── 선택 모드 배너 ──────────────────────────────────────── */}
      {selecting && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-3 rounded-lg px-3 py-1.5 text-[11px] font-bold shadow-lg border backdrop-blur flex items-center gap-2 ${
          selectionMode === 'bc'
            ? 'bg-emerald-900/80 border-emerald-500/50 text-emerald-100'
            : selectionMode === 'rbe3'
              ? 'bg-sky-900/80 border-sky-500/50 text-sky-100'
              : 'bg-cyan-900/80 border-cyan-500/50 text-cyan-100'
        }`}>
          <Crosshair size={13} />
          {selectionMode === 'bc' ? '경계조건' : selectionMode === 'rbe3' ? 'RBE3 영역' : '하중'} 노드 선택 중
          <span className="ml-1 px-1.5 py-0.5 rounded bg-black/30 font-mono">
            {(selectedNodeIds || []).length}개 선택
          </span>
        </div>
      )}

      {/* ── 고무줄 박스 (컨테이너 로컬 좌표, absolute) ──────────── */}
      {dragRect && dragRect.w > 1 && dragRect.h > 1 && (
        <div
          className="absolute z-50 pointer-events-none border-2 border-dashed bg-cyan-400/10 border-cyan-300"
          style={{ left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h }}
        />
      )}
    </div>
  );
}
