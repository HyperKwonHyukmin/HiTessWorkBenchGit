import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  AlertTriangle, Box, Loader2, Maximize2, Minimize2, RotateCcw, Scissors,
} from 'lucide-react';

import { createThreeScene } from '../../hooks/useThreeScene';
import { getRegistryModelGeometry } from '../../api/modelRegistry';
import { extractApiError, formatNumber } from '../../utils/modelRegistryUtils';

/**
 * 등록 모델 3D 미리보기.
 *
 * 왜 필요한가: 라이브러리에서 모델을 고르는 일은 본질적으로 형상을 보는 일이다.
 * 노드 9,893개·요소 10,027개라는 숫자는 "내가 찾던 그 모델인가"에 답해 주지 않는다.
 *
 * 왜 라인으로 그리는가: 미리보기는 판별용이지 해석용이 아니다. 실린더 메시로 그리면
 * 1만 요소에서 눈에 띄게 느려지지만, LineSegments 는 단일 draw call 이라 즉시 뜬다.
 * 자세히 볼 일이 생기면 그때 전용 Studio 를 여는 것이 맞다.
 *
 * 로딩은 `active` 가 true 가 된 뒤에만 시작한다 — 상세 모달을 열 때마다 수 MB 를
 * 받아 오면 미리보기를 안 볼 사람까지 느려진다.
 *
 * @param {string}  modelUid
 * @param {number}  [revision] - 생략하면 최신
 * @param {boolean} active - 실제로 화면에 보이는가(탭이 열렸는가)
 */
export default function RegistryModelPreview3D({ modelUid, revision, active = true }) {
  const mountRef = useRef(null);
  const containerRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const frameRef = useRef({ center: null, maxDim: 1 });

  const [phase, setPhase] = useState('idle');   // idle | loading | ready | error
  const [geometry, setGeometry] = useState(null);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── 데이터 ────────────────────────────────────────────────────────────
  // 요청 세대 번호 — 늦게 도착한 응답이 다른 모델의 화면을 덮어쓰지 않게 한다.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!modelUid) return;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setPhase('loading');
    setError(null);
    try {
      const res = await getRegistryModelGeometry(
        modelUid, revision ? { revision } : {},
      );
      if (seq !== seqRef.current) return;
      setGeometry(res.data);
      setPhase('ready');
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(extractApiError(e, '미리보기를 불러오지 못했습니다.'));
      setPhase('error');
    }
  }, [modelUid, revision]);

  useEffect(() => {
    if (!active) return undefined;
    load();
    return () => { seqRef.current += 1; };
  }, [active, load]);

  // ── 전처리: 선분 좌표 배열 ────────────────────────────────────────────
  const buffers = useMemo(() => {
    if (!geometry?.nodes) return null;
    const nodes = geometry.nodes;

    const fill = (pairs) => {
      const out = new Float32Array(pairs.length * 6);
      let i = 0;
      for (const pair of pairs) {
        const a = nodes[pair[0]];
        const b = nodes[pair[1]];
        if (!a || !b) continue;
        out[i++] = a[0]; out[i++] = a[1]; out[i++] = a[2];
        out[i++] = b[0]; out[i++] = b[1]; out[i++] = b[2];
      }
      // 건너뛴 쌍이 있으면 뒤쪽에 0 좌표가 남아 원점까지 선이 그어진다 — 잘라 낸다.
      return i === out.length ? out : out.slice(0, i);
    };

    const points = [];
    for (const id of geometry.pointMasses ?? []) {
      const p = nodes[id];
      if (p) points.push(p[0], p[1], p[2]);
    }

    return {
      elements: fill(geometry.elements ?? []),
      rigids: fill(geometry.rigids ?? []),
      pointMasses: new Float32Array(points),
      nodeCount: Object.keys(nodes).length,
    };
  }, [geometry]);

  // ── 씬 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current || !buffers || buffers.elements.length === 0) return undefined;

    const { scene, camera, controls, startAnimate, cleanup } =
      createThreeScene(mountRef.current, { zUp: true, bloomStrength: 0.22 });
    controlsRef.current = controls;
    cameraRef.current = camera;

    const group = new THREE.Group();

    const addLines = (array, color, opacity = 1) => {
      if (!array.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(array, 3));
      const mat = new THREE.LineBasicMaterial({
        color, transparent: opacity < 1, opacity,
      });
      group.add(new THREE.LineSegments(geo, mat));
    };

    addLines(buffers.elements, 0x66ccff);
    // 강체(RBE2)는 구조 부재가 아니라 구속이다 — 색을 갈라 놓지 않으면 형상을 오독한다.
    addLines(buffers.rigids, 0xff7755, 0.75);

    if (buffers.pointMasses.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(buffers.pointMasses, 3));
      group.add(new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffcc00, size: 4, sizeAttenuation: false,
      })));
    }

    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1000;
    frameRef.current = { center, maxDim };

    camera.position.set(center.x + maxDim, center.y - maxDim, center.z + maxDim * 0.8);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.saveState();

    startAnimate(center, maxDim);

    return () => {
      controlsRef.current = null;
      cameraRef.current = null;
      cleanup();
    };
  }, [buffers]);

  // ── 시점 ──────────────────────────────────────────────────────────────
  const setView = (view) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { center, maxDim } = frameRef.current;
    if (!center) return;
    const d = maxDim * 1.6;
    const offsets = {
      iso: [d * 0.7, -d * 0.7, d * 0.55],
      top: [0, 0, d],
      front: [0, -d, 0],
      side: [d, 0, 0],
    };
    const [dx, dy, dz] = offsets[view] ?? offsets.iso;
    camera.position.set(center.x + dx, center.y + dy, center.z + dz);
    controls.target.copy(center);
    camera.lookAt(center);
    controls.update();
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const counts = geometry?.counts;
  const drawable = buffers && buffers.elements.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
    >
      <div ref={mountRef} className="absolute inset-0 cursor-move" />

      {/* ── 상태 오버레이 ── */}
      {phase !== 'ready' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-900/90 px-6 text-center">
          {phase === 'loading' && (
            <>
              <Loader2 size={28} className="animate-spin text-sky-400" />
              <p className="text-sm font-semibold text-slate-200">형상을 불러오는 중…</p>
              <p className="text-[11px] text-slate-400">
                저장된 정규화 모델이 없으면 서버가 BDF 를 다시 읽습니다. 몇 분 걸릴 수 있습니다.
              </p>
            </>
          )}
          {phase === 'idle' && <p className="text-xs text-slate-400">미리보기 준비 중…</p>}
          {phase === 'error' && (
            <>
              <AlertTriangle size={28} className="text-amber-400" />
              <p className="max-w-md text-sm font-semibold text-slate-200">{error?.message}</p>
              {error?.code === 'GEOMETRY_UNAVAILABLE' ? (
                <p className="max-w-md text-[11px] leading-relaxed text-slate-400">
                  이 모델은 형상을 복원할 파일 없이 등록되었습니다.
                  다시 등록할 때 「정규화 모델 JSON」을 함께 보관하면 미리보기가 생깁니다.
                </p>
              ) : (
                <button
                  onClick={load}
                  className="mt-1 cursor-pointer rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                >
                  다시 시도
                </button>
              )}
            </>
          )}
        </div>
      )}

      {phase === 'ready' && !drawable && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-900/90 px-6 text-center">
          <Box size={28} className="text-slate-500" />
          <p className="text-sm font-semibold text-slate-300">그릴 수 있는 선 요소가 없습니다</p>
          <p className="max-w-md text-[11px] leading-relaxed text-slate-400">
            절점 {formatNumber(counts?.nodeTotal)}개는 확인했지만, 두 절점을 잇는 요소를
            찾지 못했습니다. 쉘·솔리드만으로 이루어진 모델일 수 있습니다.
          </p>
        </div>
      )}

      {/* ── 좌상단: 규모 · 범례 ── */}
      {phase === 'ready' && drawable && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2.5 backdrop-blur">
          <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 font-mono text-[10px]">
            <span className="text-slate-400">절점</span>
            <span className="text-right tabular-nums text-slate-100">
              {formatNumber(counts?.nodeShown)}
            </span>
            <span className="text-slate-400">요소</span>
            <span className="text-right tabular-nums text-slate-100">
              {formatNumber(counts?.elementShown)}
            </span>
            {counts?.rigidShown > 0 && (
              <>
                <span className="text-slate-400">강체</span>
                <span className="text-right tabular-nums text-slate-100">
                  {formatNumber(counts.rigidShown)}
                </span>
              </>
            )}
          </div>
          <div className="mt-2 space-y-1 border-t border-slate-700/60 pt-2">
            <Legend color="#66ccff" label="구조 요소" />
            {counts?.rigidShown > 0 && <Legend color="#ff7755" label="강체 연결(RBE)" />}
            {counts?.pointMassShown > 0 && <Legend color="#ffcc00" label="집중 질량" />}
          </div>
          {geometry?.unit && (
            <p className="mt-2 border-t border-slate-700/60 pt-1.5 font-mono text-[9px] text-slate-500">
              단위 {geometry.unit}
            </p>
          )}
        </div>
      )}

      {/* 잘렸으면 반드시 말한다 — 조용히 일부만 보여 주면 "요소가 이것뿐"으로 읽힌다 */}
      {phase === 'ready' && geometry?.truncated && (
        <div className="absolute right-3 top-3 z-10 flex max-w-[280px] items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-950/80 px-2.5 py-2 backdrop-blur">
          <Scissors size={12} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[10px] leading-relaxed text-amber-200">
            모델이 커서 일부만 그렸습니다
            ({formatNumber(counts?.elementShown)}/{formatNumber(counts?.elementTotal)} 요소).
            전체 형상은 해석 Studio 에서 확인하세요.
          </p>
        </div>
      )}

      {/* ── 하단 툴바 ── */}
      {phase === 'ready' && drawable && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/85 p-1 backdrop-blur">
          <ViewButton onClick={() => setView('iso')}>등각</ViewButton>
          <ViewButton onClick={() => setView('top')}>평면</ViewButton>
          <ViewButton onClick={() => setView('front')}>정면</ViewButton>
          <ViewButton onClick={() => setView('side')}>측면</ViewButton>
          <span className="mx-0.5 h-5 w-px bg-slate-600" />
          <ViewButton onClick={() => controlsRef.current?.reset()} title="처음 시점으로">
            <RotateCcw size={13} />
          </ViewButton>
          <ViewButton onClick={toggleFullscreen} title={isFullscreen ? '전체화면 종료' : '전체화면'}>
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </ViewButton>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-0.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      <span className="font-mono text-[9px] text-slate-300">{label}</span>
    </div>
  );
}

function ViewButton({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 min-w-[34px] cursor-pointer items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
    >
      {children}
    </button>
  );
}
