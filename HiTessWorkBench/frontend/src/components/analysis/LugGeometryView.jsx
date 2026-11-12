import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createThreeScene } from '../../hooks/useThreeScene';
import { designToPlates, plateBounds } from '../../utils/lugGeometry';

/**
 * 러그 형상 3D 보기 — 설계 JSON 의 판을 두께 있는 면으로 그린다(메시 아님, 2026-11-12).
 * 치수를 고치면 모델만 바꾸고 카메라는 그대로 둔다. fitKey(고른 러그)가 바뀔 때만 카메라를 맞춘다.
 * mark = 지금 고르는 치수 칸이 정하는 { plates:[판 id], lines:[[p0,p1]…] } — 그 판만 진하게, 나머지는 흐리게, 치수선은 늘 앞에.
 * loads = { center, arrows:[{id, dir, color, magN?, kN?}], focusId } — 핀 중심에서 하중 방향 화살표(하중 및 경계 단계).
 *   화살표 길이는 가장 큰 하중에 비례(최소 절반), 끝에 'LC1 490.5 kN' 글자.
 * fixedLines = [[p0,p1]…] — 고정 경계(바닥) 빨간 선. 둘 다 판에 가려지지 않게 맨 앞에 그린다.
 */
const ROLE_COLOR = { main: 0x5b7fa6, doubler: 0xc9a227, stiffener: 0x3f9e8f };
const MARK_COLOR = 0xe8590c;
const FIXED_COLOR = 0xdc2626;

function plateMesh(p) {
  const shape = new THREE.Shape(p.outline.map(([a, b]) => new THREE.Vector2(a, b)));
  for (const h of p.holes) shape.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: p.t, bevelEnabled: false, curveSegments: 1 });
  const u = new THREE.Vector3(...p.u);
  const v = new THREE.Vector3(...p.v);
  const n = new THREE.Vector3(...p.n);
  const o = new THREE.Vector3(...p.origin).addScaledVector(n, -p.t / 2);   // 판 가운데가 판 평면
  const m = new THREE.Matrix4().makeBasis(u, v, n).setPosition(o);
  geo.applyMatrix4(m);
  const g = new THREE.Group();
  g.userData.plateId = p.id;
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: ROLE_COLOR[p.role] ?? 0x8899aa, metalness: 0.15, roughness: 0.65, side: THREE.DoubleSide,
  })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x1e293b })));
  return g;
}

/** 치수선: 선 + 양 끝점. 깊이 검사를 끄고 맨 앞에 그린다(판에 가려지지 않게). */
function markLines(lines, size) {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: MARK_COLOR, depthTest: false, transparent: true });
  const dotMat = new THREE.MeshBasicMaterial({ color: MARK_COLOR, depthTest: false, transparent: true });
  const dotGeo = new THREE.SphereGeometry(Math.max(size * 0.008, 1.5), 12, 8);
  for (const [a, b] of lines) {
    const pa = new THREE.Vector3(...a);
    const pb = new THREE.Vector3(...b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), lineMat);
    line.renderOrder = 999;
    g.add(line);
    for (const p of [pa, pb]) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(p);
      dot.renderOrder = 999;
      g.add(dot);
    }
  }
  return g;
}

/** 화살표 끝 글자 — 화면에서 늘 앞에 보이게 깊이 검사를 끈 스프라이트. 크기는 모델 크기 비례. */
function textSprite(text, color, height) {
  const font = 44;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${font}px sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = w;
  canvas.height = font + 20;
  ctx.font = `bold ${font}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

/** 하중 화살표 + 고정 선. 화살표는 핀 중심에서 하중 방향으로(핀이 끌려가는 쪽), 고른 케이스는 진하게. */
function loadOverlay(loads, fixedLines, size) {
  const g = new THREE.Group();
  const front = (o) => { o.renderOrder = 998; o.traverse((x) => { if (x.material) { x.material.depthTest = false; x.material.transparent = true; } }); return o; };
  if (loads?.center && loads.arrows?.length) {
    const c = new THREE.Vector3(...loads.center);
    const full = size * 0.42;
    const maxN = Math.max(...loads.arrows.map((a) => a.magN || 0), 0);
    for (const a of loads.arrows) {
      const dir = new THREE.Vector3(...a.dir).normalize();
      const focus = !loads.focusId || loads.focusId === a.id;
      const len = maxN > 0 && a.magN ? full * (0.5 + 0.5 * (a.magN / maxN)) : full;
      const arrow = new THREE.ArrowHelper(dir, c, len, new THREE.Color(a.color).getHex(), full * 0.16, full * 0.07);
      front(arrow);
      arrow.line.material.opacity = focus ? 1 : 0.3;
      arrow.cone.material.opacity = focus ? 1 : 0.3;
      g.add(arrow);
      if (a.kN) {
        const label = textSprite(`LC${a.index + 1} ${a.kN}`, a.color, size * 0.035);
        label.position.copy(c).addScaledVector(dir, len + size * 0.04);
        label.material.opacity = focus ? 1 : 0.35;
        g.add(label);
      }
    }
  }
  if (fixedLines?.length) {
    const mat = new THREE.LineBasicMaterial({ color: FIXED_COLOR });
    const tickLen = size * 0.03;
    for (const [a, b] of fixedLines) {
      const pa = new THREE.Vector3(...a);
      const pb = new THREE.Vector3(...b);
      const pts = [pa, pb];
      // 고정 표시 빗금: 선을 따라 아래로 짧은 사선
      const n = Math.max(2, Math.round(pa.distanceTo(pb) / (tickLen * 1.5)));
      const seg = [];
      for (let k = 0; k <= n; k += 1) {
        const p = pa.clone().lerp(pb, k / n);
        seg.push(p, p.clone().add(new THREE.Vector3(0, 0, -tickLen)).addScaledVector(pb.clone().sub(pa).normalize(), -tickLen * 0.6));
      }
      g.add(front(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)));
      g.add(front(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), mat)));
    }
  }
  return g;
}

function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { mt.map?.dispose(); mt.dispose(); });
  });
}

export default function LugGeometryView({ design, fitKey, mark = null, loads = null, fixedLines = null, className = '' }) {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  const modelRef = useRef(null);
  const markRef = useRef(null);
  const loadRef = useRef(null);
  const sizeRef = useRef(1000);
  const fittedRef = useRef(null);

  useEffect(() => {
    const ctx = createThreeScene(mountRef.current, { zUp: true, theme: 'light', backgroundColor: 0xeef2f7, bloomStrength: 0 });
    ctxRef.current = ctx;
    ctx.startAnimate(new THREE.Vector3(), 1000);
    return () => {
      if (modelRef.current) disposeGroup(modelRef.current);
      if (markRef.current) disposeGroup(markRef.current);
      if (loadRef.current) disposeGroup(loadRef.current);
      markRef.current = null;
      loadRef.current = null;
      ctx.cleanup();
      ctxRef.current = null;
      modelRef.current = null;
      // 장면을 새로 만들면 카메라도 새것이라 다시 맞춰야 한다(StrictMode 이중 실행에서 회색 화면만 보이던 원인).
      fittedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (modelRef.current) {
      ctx.scene.remove(modelRef.current);
      disposeGroup(modelRef.current);
      modelRef.current = null;
    }
    if (!design) return;
    const plates = designToPlates(design);
    const group = new THREE.Group();
    for (const p of plates) group.add(plateMesh(p));
    ctx.scene.add(group);
    modelRef.current = group;
    const b = plateBounds(plates);
    sizeRef.current = Math.max(b.size, 1);
    if (fittedRef.current !== fitKey) {
      fittedRef.current = fitKey;
      const c = new THREE.Vector3(...b.center);
      const d = Math.max(b.size, 1);
      ctx.controls.target.copy(c);
      ctx.camera.position.set(c.x + d * 1.1, c.y - d * 1.6, c.z + d * 0.8);   // 앞(−Y)에서 비스듬히
      ctx.camera.near = d / 1000;
      ctx.camera.far = d * 100;
      ctx.camera.updateProjectionMatrix();
      ctx.controls.update();
    }
  }, [design, fitKey]);

  // 치수 칸 강조: 고른 판은 그대로, 나머지 판은 흐리게 + 치수선 (모델을 다시 만들지 않고 재질만 바꾼다)
  useEffect(() => {
    const ctx = ctxRef.current;
    const model = modelRef.current;
    if (!ctx || !model) return;
    if (markRef.current) {
      ctx.scene.remove(markRef.current);
      disposeGroup(markRef.current);
      markRef.current = null;
    }
    const on = new Set(mark?.plates || []);
    const dim = on.size > 0;
    for (const plate of model.children) {
      const hit = on.has(plate.userData.plateId);
      for (const o of plate.children) {
        o.material.transparent = dim && !hit;
        o.material.opacity = dim && !hit ? (o.isMesh ? 0.18 : 0.25) : 1;
        o.material.depthWrite = !(dim && !hit);
        if (o.isMesh) o.material.emissive?.setHex(dim && hit ? 0x3a1a00 : 0x000000);
        o.material.needsUpdate = true;
      }
    }
    if (mark?.lines?.length) {
      markRef.current = markLines(mark.lines, sizeRef.current);
      ctx.scene.add(markRef.current);
    }
  }, [mark, design]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (loadRef.current) {
      ctx.scene.remove(loadRef.current);
      disposeGroup(loadRef.current);
      loadRef.current = null;
    }
    if (!loads && !fixedLines?.length) return;
    loadRef.current = loadOverlay(loads, fixedLines, sizeRef.current);
    ctx.scene.add(loadRef.current);
  }, [loads, fixedLines, design]);

  return <div ref={mountRef} className={`w-full h-full min-h-[240px] ${className}`} />;
}
