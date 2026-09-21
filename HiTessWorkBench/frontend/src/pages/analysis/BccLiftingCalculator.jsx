// BCC Lifting Calculator
// 면적 중심 기반 자세 안전성을 평가한다.
//
// 원본 : WorkBenchSubModule/BCC Lifting/BCC_Lifting_v0.3.html (v0.3)
// 이식 : 순수 프론트엔드에서 전부 계산된다. 서버 API/파일 업로드 없음.
//
// 알고리즘은 원본과 1:1 로 유지하고 React 래핑만 씌운다.
//  - 뮤터블 상태(`stateRef.current`) = 원본 vanilla JS 의 전역 `S` 오브젝트
//  - 캔버스 이벤트 리스너는 useEffect 로 mount 시 붙이고 unmount 에서 해제
//  - UI 갱신은 상태 변경 함수 안에서 `bump()` (setUiTick) 로 강제 리렌더
//    (수십 곳의 `evaluate()`·`draw()` 흐름을 그대로 유지하기 위한 절충)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PenTool, Image as ImageIcon, Shapes, Target, Activity,
  FileText, Ruler, Sparkles, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import SolverCredit from '../../components/ui/SolverCredit';

const TAU = Math.PI * 2;

// ---------- 디자인 토큰 (다른 Interactive App 과 동일 계열) ----------
const BTN_PRIMARY =
  'w-full py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white ' +
  'shadow-md shadow-emerald-100 transition-all cursor-pointer ' +
  'disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed disabled:shadow-none';
const BTN_SECONDARY =
  'w-full py-2 rounded-lg font-semibold text-xs bg-white border-2 border-slate-200 ' +
  'hover:border-emerald-500 hover:text-emerald-700 text-slate-700 transition-colors cursor-pointer ' +
  'disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700';
const BTN_TOGGLE_ON =
  'w-full py-2 rounded-lg font-semibold text-xs bg-emerald-50 border-2 border-emerald-500 text-emerald-700 transition-colors cursor-pointer';
const INPUT_CLS =
  'w-full px-3 py-2 border-2 border-slate-200 rounded-lg text-sm font-semibold text-slate-800 bg-white ' +
  'focus:outline-none focus:border-emerald-500 transition-colors';

// 카드 · 접을 수 있는 카드 · 세그먼트 버튼 -- 다른 App 의 패널 구조를 그대로 답습
function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-700 to-emerald-600 px-4 py-2.5 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-white" />}
        <h2 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h2>
      </div>
      <div className="p-4 space-y-2.5">{children}</div>
    </div>
  );
}

function CollapsibleCard({ title, icon: Icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-slate-400" />}
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{title}</span>
        </span>
        {open
          ? <ChevronUp size={14} className="text-slate-400" />
          : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div className="border-t border-gray-100 p-4 space-y-2.5">{children}</div>}
    </div>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 py-1.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ' +
        (active
          ? 'bg-white text-emerald-700 shadow-sm'
          : 'text-slate-500 hover:text-slate-700')
      }
    >
      {children}
    </button>
  );
}

const GRADE_STYLES = {
  ok:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  warn: 'bg-amber-50   border-amber-200   text-amber-700',
  bad:  'bg-red-50     border-red-200     text-red-700',
  none: 'bg-slate-50   border-slate-200   text-slate-500',
};
const BAR_FILL = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' };
const MSG_STYLES = {
  ok:   'bg-emerald-50 border-emerald-500 text-emerald-800',
  warn: 'bg-amber-50   border-amber-500   text-amber-800',
  bad:  'bg-red-50     border-red-500     text-red-800',
  info: 'bg-slate-50   border-slate-400   text-slate-700',
};

// ---------- 순수 헬퍼 (원본과 동일) ----------
function polyAreaCentroid(poly) {
  const n = poly.length;
  if (n < 3) return null;
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const cr = p.x * q.y - q.x * p.y;
    A  += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  A = A / 2;
  if (Math.abs(A) < 1e-9) return null;
  return { A: Math.abs(A), c: { x: cx / (6 * A), y: cy / (6 * A) } };
}

function solve3(M, b) {
  const A = M.map((r, i) => [r[0], r[1], r[2], b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    const t = A[c]; A[c] = A[p]; A[p] = t;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

function leastNorm(rows, b) {
  const m = rows[0].length;
  if (m === 0) return null;
  const AAt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += rows[a][k] * rows[c][k];
    AAt[a][c] = s;
  }
  const tr = AAt[0][0] + AAt[1][1] + AAt[2][2];
  for (let a = 0; a < 3; a++) AAt[a][a] += 1e-9 * tr + 1e-12;
  const y = solve3(AAt, b);
  if (!y) return null;
  const P = [];
  for (let k = 0; k < m; k++) P.push(rows[0][k] * y[0] + rows[1][k] * y[1] + rows[2][k] * y[2]);
  return P;
}

// 중량을 모르므로 전체를 100으로 두고 분담 '비율'만 구한다.
// ΣP = 100, ΣPx = 0, ΣPy = 0 의 최소노름 해. 음수(들뜸)면 그 포인트를 빼고 재계산.
function computeShare(c, pts) {
  const W = 100;
  let L = 1;
  for (const g of pts) L = Math.max(L, Math.abs(g.x - c.x), Math.abs(g.y - c.y));
  const xs = pts.map(g => (g.x - c.x) / L), ys = pts.map(g => (g.y - c.y) / L);
  let idx = pts.map((_, i) => i), P = null;
  const lifted = [];
  for (let pass = 0; pass < pts.length; pass++) {
    const rows = [idx.map(() => 1), idx.map(i => xs[i]), idx.map(i => ys[i])];
    const sol = leastNorm(rows, [W, 0, 0]);
    if (!sol) return null;
    let worst = -1, wv = 0;
    sol.forEach((v, k) => { if (v < -1e-6 * W && v < wv) { wv = v; worst = k; } });
    if (worst < 0 || idx.length <= 2) { P = sol; break; }
    lifted.push(idx[worst]);
    idx = idx.filter((_, k) => k !== worst);
  }
  if (!P) return null;
  const share = pts.map(() => 0);
  idx.forEach((i, k) => { share[i] = P[k]; });
  let r0 = -W, r1 = 0, r2 = 0;
  share.forEach((p, i) => { r0 += p; r1 += p * xs[i]; r2 += p * ys[i]; });
  return { share, lifted, res: Math.hypot(r0, r1, r2) / W };
}

// 이상적 배치 = 면적중심을 중심으로 하는 원 위에 포인트가 놓인 상태.
//   radDev : 반경 편차   max|rᵢ − R̄| / R̄
//   maxGap : 최대 각도 간격 (180° 이상이면 중심이 배치 바깥)
function posture(c, pts) {
  const n = pts.length;
  if (n < 2) return null;
  const r = pts.map(p => Math.hypot(p.x - c.x, p.y - c.y));
  const R = r.reduce((a, b) => a + b, 0) / n;
  if (R < 1e-6) return null;
  const radDev = Math.max.apply(null, r.map(v => Math.abs(v - R))) / R;
  const ord = pts.map(p => (Math.atan2(p.y - c.y, p.x - c.x) + TAU) % TAU).sort((a, b) => a - b);
  const gaps = [];
  for (let k = 0; k < n; k++)
    gaps.push(k === n - 1 ? (ord[0] + TAU - ord[k]) : (ord[k + 1] - ord[k]));
  const maxGap = Math.max.apply(null, gaps);
  const cogOut = n === 2 ? (maxGap > Math.PI + 1e-3) : (maxGap > Math.PI - 1e-6);
  return { r, R, radDev, maxGap, cogOut };
}

function gradeOf(po, tolR, tolGapDeg, n) {
  if (po.cogOut) return { g: '불량', cls: 'bad', why: '중심이 체결포인트 바깥(또는 경계)에 있어 들어올리면 기울어집니다' };
  const gapDeg = po.maxGap * 180 / Math.PI;
  const rw = po.radDev <= tolR ? 0 : (po.radDev <= tolR * 2 ? 1 : 2);
  const aw = (n < 3 || gapDeg <= tolGapDeg) ? 0 : 1;
  const w = Math.max(rw, aw);
  if (w === 0) return { g: '양호', cls: 'ok', why: '중심을 기준으로 하는 원 위에 고르게 놓여 있습니다' };
  if (w === 1) return { g: '주의', cls: 'warn', why: rw >= aw ? '중심~포인트 거리가 고르지 않습니다' : '포인트가 한쪽으로 몰려 있습니다' };
  return { g: '불량', cls: 'bad', why: '거리 편차가 커서 들어올릴 때 기울어질 가능성이 높습니다' };
}

function convexHull(pts) {
  const p = pts.map(q => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

function pointInPoly(poly, q) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const OUT_DEF = {
  warns: [
    '표시된 권상 위치는 구조물 형상만을 고려한 권장 위치입니다.',
    '이를 절대적인 기준으로 오인하여 작업하지 않도록 주의하십시오.',
    '현장에서는 반드시 현장 여건, 무게중심 등을 종합 검토 후 권상 위치를 최종 결정해야 합니다.',
  ],
  notes: [
    '평면(2차원) 검토입니다. 높이 방향 무게중심과 슬링 길이 차이는 고려하지 않았습니다.',
    '체결점(Lug)의 높이는 가능한 한 동일하게 계획하십시오. 높이가 다르면 평면 배치가 적절해도 권상 시 기울어질 수 있습니다.',
  ],
};
const OUT_KEY = 'bcc_sheet_text_v2';

// ============ 컴포넌트 ============
export default function BccLiftingCalculator() {
  const { setCurrentMenu } = useNavigation();
  const canvasRef = useRef(null);
  const stageRef  = useRef(null);           // 캔버스 CSS 크기 측정용
  const [uiTick, setUiTick] = useState(0);  // 강제 리렌더 카운터
  const [outFields, setOutFields] = useState(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(OUT_KEY) || 'null'); } catch (e) { v = null; }
    return {
      title: (v && v.title) || 'BCC 권상 자세 안전성 검토결과',
      dwg:   (v && v.dwg)   || '',
      author:(v && v.author)|| '',
    };
  });

  // 원본의 상수 UI 스케일. 결과 시트 출력 때만 오프스크린에서 바꾼다.
  const UI = useRef(1);
  const ctxRef = useRef(null);       // 현재 그리기용 2D context (오프스크린 렌더 때 교체된다)
  const cssSizeRef = useRef(() => ({ w: 800, h: 600 })); // 오프스크린 렌더 때 교체된다

  // 원본 vanilla JS 의 전역 S. 뮤테이션은 그대로 두고 UI 반영 시 bump().
  const stateRef = useRef({
    img: null, iw: 0, ih: 0, invert: false,
    view: { s: 1, tx: 0, ty: 0 },
    parts: [],
    areaC: null, manualC: null,
    pts: [], post: null, share: null,
    ptMode: 'free', ring: null,
    pxPerMm: null,
    tool: null, draftRect: null, draftPoly: [],
    drag: null, panning: null,
    calMode: false, calPts: [], calPx: 0,
    sMode: 'A', cands: [], region: [], suggestions: [],
    tolR: 10, tolGap: 150, nPt: 4, wRad: 50, minGap: 0,
    // 판정/그리기 결과 (UI 반영용)
    grade: { cls: 'none', g: '—', why: '도면을 붙여넣으세요' },
    msgs: [],
    calInfo: '미보정 — 판정은 축척 없이도 정확합니다(비율만 사용). 도면의 치수선 두 끝을 찍고 그 값(예: 1400)을 넣으면 거리를 mm로 볼 수 있습니다.',
    calApplyDisabled: true,
    calBtnText: '두 점 찍기',
    statusText: '이미지 없음',
    // 현재 툴바 가이드 문자열
    toolbarHtml: '',
    // 추천 결과 문구
    suggMsg: '',
  });

  const S = () => stateRef.current;
  const bump = () => setUiTick(t => t + 1);
  const center = () => S().manualC || S().areaC;
  const cssSize = () => cssSizeRef.current();

  // ---------- 좌표 변환 ----------
  const toScreen = p => ({ x: p.x * S().view.s + S().view.tx, y: p.y * S().view.s + S().view.ty });
  const toImage  = p => ({ x: (p.x - S().view.tx) / S().view.s, y: (p.y - S().view.ty) / S().view.s });
  const distText = v => S().pxPerMm ? (v / S().pxPerMm).toFixed(0) + ' mm' : v.toFixed(0) + ' px';
  const areaText = v => {
    if (!S().pxPerMm) return v.toFixed(0) + ' px²';
    const mm2 = v / (S().pxPerMm * S().pxPerMm);
    return (mm2 / 1e6).toFixed(2) + ' m²';
  };
  const up = n => n * UI.current;

  // ---------- 면적중심 재계산 ----------
  const recomputeCentroid = () => {
    let tot = 0, sx = 0, sy = 0;
    for (const pt of S().parts) {
      const r = polyAreaCentroid(pt.poly);
      if (!r) continue;
      const a = r.A * pt.sign;
      tot += a; sx += a * r.c.x; sy += a * r.c.y;
    }
    S().areaC = (tot > 1e-9) ? { x: sx / tot, y: sy / tot, A: tot } : null;
    return S().areaC;
  };

  const afterShapeChange = () => {
    recomputeCentroid();
    if (!center()) {
      S().pts = []; S().ring = null;
      setPtMode('free');
    }
    reprojectAll();
    evaluate();
  };

  // ---------- 도구 ----------
  const setTool = (t) => {
    S().tool = (S().tool === t) ? null : t;
    if (S().tool !== 'poly') S().draftPoly = [];
    if (S().tool !== 'rect') S().draftRect = null;
    const guide = {
      rect: '사각형: 도면 위에서 <b>드래그</b>해 상자를 그립니다. 하나 그리면 자동으로 끝납니다.',
      poly: '다각형: 꼭짓점을 <b>클릭</b>하고 마지막에 <b>Enter</b>(또는 [다각형 닫기]). Backspace 로 한 점 취소, Esc 로 전체 취소.',
      cand: '후보점: 걸 수 있는 위치를 클릭. 우클릭으로 삭제.',
      region: '영역: 꼭짓점을 클릭해 다각형을 그리고 버튼을 다시 눌러 종료.',
    };
    S().toolbarHtml = S().tool ? guide[S().tool] : '';
    if (S().calMode) {
      S().calMode = false;
      S().calBtnText = '두 점 찍기';
    }
    if (canvasRef.current) canvasRef.current.style.cursor = S().tool ? 'crosshair' : 'default';
    bump();
    draw();
  };

  const needImg = () => {
    if (!S().img) { window.alert('먼저 도면 캡처를 붙여넣으세요 (Ctrl+V).'); return false; }
    return true;
  };

  const closePoly = () => {
    if (S().draftPoly.length >= 3) {
      S().parts.push({ poly: S().draftPoly.slice(), sign: 1 });
      S().draftPoly = [];
      afterShapeChange();
      setTool(null);
      return;
    }
    draw();
  };

  // ---------- 이미지 로드 ----------
  const setImage = async (src) => {
    const bmp = await createImageBitmap(src);
    const s = S();
    s.img = bmp; s.iw = bmp.width; s.ih = bmp.height;
    s.parts = []; s.areaC = null; s.manualC = null;
    s.pts = []; s.post = null; s.share = null; s.ring = null;
    s.pxPerMm = null; s.calPts = []; s.calMode = false;
    s.cands = []; s.region = []; s.suggestions = [];
    s.draftRect = null; s.draftPoly = [];
    s.calApplyDisabled = true;
    s.calBtnText = '두 점 찍기';
    s.calInfo = '미보정 — 판정은 축척 없이도 정확합니다(비율만 사용). 도면의 치수선 두 끝을 찍고 그 값(예: 1400)을 넣으면 거리를 mm로 볼 수 있습니다.';
    s.suggMsg = '';
    s.msgs = [];
    s.tool = null;
    bump();
    fitView();
    evaluate();
  };

  const fitView = () => {
    if (!S().img) return;
    const { w, h } = cssSize();
    const s = Math.min(w / S().iw, h / S().ih) * 0.94;
    S().view.s = s; S().view.tx = (w - S().iw * s) / 2; S().view.ty = (h - S().ih * s) / 2;
    draw();
  };

  // 캔버스 크기 (DPR 대응) & 리사이즈 관찰자
  const resize = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const { w, h } = cssSize();
    const dpr = window.devicePixelRatio || 1;
    cv.width  = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxRef.current = ctx;
    draw();
  };

  // ---------- 판정 ----------
  const clampN = () => {
    const n = Math.max(2, Math.min(4, parseInt(S().nPt, 10) || 4));
    S().nPt = n;
    return n;
  };

  const evaluate = () => {
    const msgs = [];
    S().post = null; S().share = null;
    const c = center();

    const setGrade = (cls, g, why) => { S().grade = { cls, g, why }; S().msgs = msgs; };

    if (!S().img) { setGrade('none', '—', '도면을 붙여넣으세요'); bump(); draw(); return; }
    if (!c)       { setGrade('none', '—', '형상을 그려 면적중심을 만드세요'); bump(); draw(); return; }
    if (S().pts.length < 2) { setGrade('none', '—', '[마크 생성]으로 체결 포인트를 배치하세요'); bump(); draw(); return; }

    const tolR   = Math.max(1, parseFloat(S().tolR) || 10) / 100;
    const tolGap = Math.min(179, Math.max(90, parseFloat(S().tolGap) || 150));
    const n = S().pts.length;

    const po = posture(c, S().pts);
    if (!po) { setGrade('none', '—', '포인트가 중심과 겹쳐 있습니다'); bump(); draw(); return; }
    po.tolR = tolR; po.tolGap = tolGap;
    S().post = po;

    const gr = gradeOf(po, tolR, tolGap, n);
    const gapDeg = po.maxGap * 180 / Math.PI;
    if (po.cogOut) {
      msgs.push(['bad', '최대 각도 간격이 ' + gapDeg.toFixed(0) + '° 입니다. ' +
        (n === 2 ? '중심이 두 포인트를 잇는 선 위에 오도록 해야 합니다.'
                 : '중심이 포인트들에 둘러싸이도록 배치해야 합니다.')]);
    } else {
      if (po.radDev > tolR) {
        const far = po.r.map((v, i) => ({ d: (v - po.R) / po.R, i })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
        msgs.push(['warn', '#' + (far.i + 1) + ' 이 평균 반경에서 ' + (far.d >= 0 ? '+' : '') + (far.d * 100).toFixed(0) +
          '% 벗어났습니다. 기준 원(반경 ' + distText(po.R) + ') 쪽으로 ' +
          (far.d > 0 ? '중심 방향으로 당기면' : '바깥으로 밀면') + ' 개선됩니다.']);
      }
      if (n >= 3 && gapDeg > tolGap)
        msgs.push(['warn', '포인트가 한쪽으로 몰려 있습니다 (최대 각도 간격 ' + gapDeg.toFixed(0) + '°).']);
    }

    const sh = computeShare(c, S().pts);
    if (sh && sh.res <= 1e-3) {
      S().share = sh.share;
      if (sh.lifted.length)
        msgs.push(['warn', '체결포인트 ' + sh.lifted.map(i => '#' + (i + 1)).join(', ') + ' 는 하중을 받지 않습니다(들뜸).']);
      const mx = Math.max.apply(null, sh.share);
      msgs.push(['ok', '최대 분담률 ' + mx.toFixed(0) + '% (균등이면 ' + (100 / n).toFixed(0) + '%)']);
    }
    msgs.push(['info', '중량·COG를 받지 못해 <b>평면도 면적중심을 무게중심으로 가정</b>했습니다. 내부 기기가 한쪽에 몰려 있으면 실제 무게중심은 다를 수 있습니다.']);

    setGrade(gr.cls, gr.g, gr.why);
    bump();
    draw();
  };

  // ---------- 체결 포인트 / 원 ----------
  const defaultR = () => {
    const box = partsBBox();
    return box ? Math.max(40, Math.min(box.w, box.h) * 0.45) : Math.min(S().iw, S().ih) * 0.25;
  };
  const ringAt = (c, R, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = TAU * i / n - Math.PI / 2;
      out.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
    }
    return out;
  };
  const toRing = (p) => {
    const c = center();
    const a = Math.atan2(p.y - c.y, p.x - c.x);
    return { x: c.x + S().ring * Math.cos(a), y: c.y + S().ring * Math.sin(a) };
  };
  const reprojectAll = () => {
    const c = center();
    if (!c || S().ptMode !== 'ring' || !S().ring) return;
    S().pts = S().pts.map(toRing);
  };
  const partsBBox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    S().parts.forEach(pt => pt.poly.forEach(p => {
      any = true;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }));
    return any ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
  };
  const setPtMode = (m) => { S().ptMode = m; bump(); };
  const placeMarks = (m) => {
    if (!needImg()) return;
    const c = center();
    if (!c) { window.alert('먼저 형상을 그려 면적중심을 만드세요.'); return; }
    const n = clampN();
    const same = S().pts.length === n;
    if (m === 'ring') {
      const mean = same
        ? S().pts.reduce((sum, p) => sum + Math.hypot(p.x - c.x, p.y - c.y), 0) / n
        : defaultR();
      S().ring = Math.max(1, mean);
      S().pts = same ? S().pts.map(toRing) : ringAt(c, S().ring, n);
    } else {
      S().ring = null;
      if (!same) S().pts = ringAt(c, defaultR(), n);
    }
    setPtMode(m);
    S().msgs = [];
    evaluate();
  };

  // ---------- 축척 ----------
  const startCalibration = () => {
    if (!S().img) return;
    if (S().tool) setTool(null);
    S().calMode = !S().calMode; S().calPts = [];
    S().calBtnText = S().calMode ? '두 점을 클릭하세요…' : '두 점 찍기';
    bump(); draw();
  };
  const applyCalibration = (mmValue) => {
    const mm = parseFloat(mmValue);
    if (!(mm > 0) || !(S().calPx > 0)) return;
    S().pxPerMm = S().calPx / mm;
    S().calInfo = '보정됨: 1 mm = ' + S().pxPerMm.toFixed(4) + ' px  (1 px = ' + (1 / S().pxPerMm).toFixed(2) + ' mm)';
    bump();
    evaluate();
  };

  // ---------- 추천 ----------
  const scoreLayout = (c, pts, wRad, minGap) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < minGap) return null;
    const po = posture(c, pts);
    if (!po || po.cogOut) return null;
    const sr = Math.max(0, 1 - Math.min(1, po.radDev));
    const ideal = TAU / n, span = Math.PI - ideal;
    const sa = span > 1e-9 ? Math.max(0, Math.min(1, 1 - (po.maxGap - ideal) / span)) : 1;
    return { radDev: po.radDev, maxGap: po.maxGap, R: po.R, score: wRad * sr + (1 - wRad) * sa };
  };
  const keyPos = L => L.map(p => Math.round(p.x / 12) + ',' + Math.round(p.y / 12)).sort().join('|');
  const pushTop = (list, item, cap, keyFn) => {
    item.key = keyFn(item);
    const dup = list.findIndex(s => s.key === item.key);
    if (dup >= 0) {
      if (item.score <= list[dup].score) return;
      list.splice(dup, 1);
    }
    list.push(item);
    list.sort((x, y) => y.score - x.score);
    if (list.length > cap) list.length = cap;
  };

  const suggestFromCandidates = (c, n, wRad, minGap) => {
    const K = S().cands.length;
    if (K < n) return { err: '후보점이 ' + K + '개뿐입니다. 체결 포인트 개수(' + n + ') 이상 찍어주세요.' };
    let total = 1;
    for (let i = 0; i < n; i++) total = total * (K - i) / (i + 1);
    if (total > 300000) return { err: '조합 수가 너무 많습니다(' + Math.round(total).toLocaleString() + '). 후보점을 줄이세요.' };
    const top = [], comb = new Array(n);
    let tried = 0, valid = 0;
    (function rec(start, depth) {
      if (depth === n) {
        tried++;
        const pts = comb.map(i => S().cands[i]);
        const sc = scoreLayout(c, pts, wRad, minGap);
        if (sc) {
          valid++;
          pushTop(top, { pts: pts.map(p => ({ x: p.x, y: p.y })), score: sc.score, radDev: sc.radDev, maxGap: sc.maxGap, R: sc.R }, 5, it => keyPos(it.pts));
        }
        return;
      }
      for (let i = start; i <= K - (n - depth); i++) { comb[depth] = i; rec(i + 1, depth + 1); }
    })(0, 0);
    if (!valid) return { err: '유효한 조합이 없습니다 (' + tried.toLocaleString() + '개 검토). 중심이 후보점들에 둘러싸이는지 확인하세요.' };
    return { list: top, note: tried.toLocaleString() + '개 조합 중 유효 ' + valid.toLocaleString() + '개' };
  };

  const suggestInRegion = (c, n, wRad, minGap) => {
    if (S().region.length < 3) return { err: '배치 가능 영역을 먼저 그리세요(꼭짓점 3개 이상).' };
    if (!pointInPoly(S().region, c)) return { err: '면적중심이 영역 밖에 있습니다.' };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    S().region.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    const diag = Math.hypot(x1 - x0, y1 - y0);
    const rnd = mulberry32(20260826);
    const sample = () => {
      for (let t = 0; t < 400; t++) {
        const p = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
        if (pointInPoly(S().region, p)) return p;
      }
      return null;
    };
    const seedRing = k => {
      for (let sc = 0.9; sc > 0.1; sc -= 0.08) {
        const r = diag * 0.5 * sc, out = [];
        for (let i = 0; i < n; i++) {
          const a = TAU * (i / n) + k * 0.7;
          out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
        }
        if (out.every(p => pointInPoly(S().region, p))) return out;
      }
      return null;
    };
    const top = [], STARTS = 24, ITER = 900;
    for (let s = 0; s < STARTS; s++) {
      let pts = s < 4 ? seedRing(s) : null;
      if (!pts) {
        pts = [];
        for (let i = 0; i < n; i++) { const p = sample(); if (!p) break; pts.push(p); }
        if (pts.length < n) continue;
      }
      let cur = scoreLayout(c, pts, wRad, minGap);
      for (let it = 0; it < ITER; it++) {
        const step = diag * (0.22 * Math.pow(1 - it / ITER, 2) + 0.004);
        const k = Math.floor(rnd() * n);
        const trial = pts.map(p => ({ x: p.x, y: p.y }));
        trial[k] = { x: pts[k].x + (rnd() * 2 - 1) * step, y: pts[k].y + (rnd() * 2 - 1) * step };
        if (!pointInPoly(S().region, trial[k])) continue;
        const sc = scoreLayout(c, trial, wRad, minGap);
        if (sc && (!cur || sc.score > cur.score)) { pts = trial; cur = sc; }
      }
      if (cur) pushTop(top, { pts: pts.map(p => ({ x: p.x, y: p.y })), score: cur.score, radDev: cur.radDev, maxGap: cur.maxGap, R: cur.R }, 5, it => 'sc' + Math.round(it.score * 200));
    }
    if (!top.length) return { err: '영역 안에서 유효한 배치를 찾지 못했습니다. 영역을 넓히거나 최소 간격을 줄여보세요.' };
    return { list: top, note: STARTS + '회 탐색' };
  };

  const runSuggest = () => {
    const c = center();
    if (!S().img) { S().suggMsg = 'ERR:도면을 먼저 붙여넣으세요.'; bump(); return; }
    if (!c)       { S().suggMsg = 'ERR:형상을 그려 면적중심을 먼저 만드세요.'; bump(); return; }
    const n = clampN();
    const wRad = parseInt(S().wRad, 10) / 100;
    let minGap = parseFloat(S().minGap) || 0;
    if (minGap > 0 && S().pxPerMm) minGap = minGap * S().pxPerMm;

    S().suggMsg = '계산 중…';
    bump();
    setTimeout(() => {
      const r = S().sMode === 'B' ? suggestInRegion(c, n, wRad, minGap) : suggestFromCandidates(c, n, wRad, minGap);
      if (r.err) { S().suggMsg = 'ERR:' + r.err; S().suggestions = []; bump(); draw(); return; }
      S().suggestions = r.list;
      S().suggMsg = r.note + ' → 상위 ' + r.list.length + '안. 클릭하면 적용됩니다.';
      applySuggestion(0);
      bump();
    }, 20);
  };

  const applySuggestion = (i) => {
    const s = S().suggestions[i];
    if (!s) return;
    S().pts = s.pts.map(p => ({ x: p.x, y: p.y }));
    S().nPt = S().pts.length;
    evaluate();
  };

  // ---------- 렌더 ----------
  const halo = (ctx, path, col, w) => {
    ctx.lineWidth = w + up(2.5); ctx.strokeStyle = 'rgba(255,255,255,.85)';
    path(); ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = col;
    path(); ctx.stroke();
  };
  const tag = (ctx, x, y, t, col, anchor) => {
    const fs = up(11), bh = up(15);
    ctx.font = 'bold ' + fs.toFixed(1) + 'px sans-serif';
    ctx.textAlign = anchor || 'left';
    const w = ctx.measureText(t).width + up(8);
    const bx = anchor === 'center' ? x - w / 2 : x;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(bx, y - fs, w, bh);
    ctx.strokeStyle = col; ctx.lineWidth = up(1);
    ctx.strokeRect(bx, y - fs, w, bh);
    ctx.fillStyle = col;
    ctx.fillText(t, anchor === 'center' ? x : x + up(4), y);
    ctx.textAlign = 'left';
  };

  const drawCenter = (ctx, p) => {
    const r = up(11);
    halo(ctx, () => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); }, '#e02020', up(2));
    halo(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(p.x - r - up(5), p.y); ctx.lineTo(p.x + r + up(5), p.y);
      ctx.moveTo(p.x, p.y - r - up(5)); ctx.lineTo(p.x, p.y + r + up(5));
    }, '#e02020', up(2));
    tag(ctx, p.x + r + 6, p.y - r + 2, S().manualC ? '중심(수동)' : '면적중심', '#e02020');
  };

  const drawPt = (ctx, p, i) => {
    const r = up(9);
    let col = '#1f6fd0';
    if (S().post) {
      const d = Math.abs((S().post.r[i] - S().post.R) / S().post.R);
      col = d > S().post.tolR * 2 ? '#c62828' : (d > S().post.tolR ? '#c26a00' : '#1f6fd0');
    }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
    halo(ctx, () => { ctx.beginPath(); ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r); }, col, up(2));
    halo(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
    }, col, up(1.6));

    let ux = 1, uy = -1;
    const c = center();
    if (c) {
      const cs = toScreen(c), dx = p.x - cs.x, dy = p.y - cs.y, d = Math.hypot(dx, dy);
      if (d > 1) { ux = dx / d; uy = dy / d; }
    }
    let t = '#' + (i + 1);
    if (S().post) {
      const dv = (S().post.r[i] - S().post.R) / S().post.R;
      t += '  ' + (dv >= 0 ? '+' : '') + (dv * 100).toFixed(1) + '%';
      if (S().share) t += '  ' + S().share[i].toFixed(0) + '%';
    }
    ctx.font = 'bold ' + up(11).toFixed(1) + 'px sans-serif';
    const bw = ctx.measureText(t).width + up(8);
    const bx = ux >= 0 ? p.x + r + up(6) : p.x - r - up(6) - bw;
    const by = uy >= 0 ? p.y + r + up(16) : p.y - r - up(6);
    tag(ctx, bx, by, t, col);
  };

  const draw = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { w, h } = cssSize();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e9edf1'; ctx.fillRect(0, 0, w, h);
    if (!S().img) {
      S().statusText = '이미지 없음';
      return;
    }

    ctx.imageSmoothingEnabled = S().view.s < 1;
    ctx.save();
    ctx.translate(S().view.tx, S().view.ty);
    ctx.scale(S().view.s, S().view.s);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S().iw, S().ih);
    if (S().invert) ctx.filter = 'invert(1)';
    ctx.drawImage(S().img, 0, 0);
    ctx.filter = 'none';
    ctx.restore();

    // 형상 파츠
    S().parts.forEach((pt, i) => {
      const ps = pt.poly.map(toScreen);
      const neg = pt.sign < 0;
      ctx.beginPath();
      ps.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = neg ? 'rgba(198,40,40,.16)' : 'rgba(122,86,190,.16)';
      ctx.fill();
      ctx.strokeStyle = neg ? 'rgba(198,40,40,.9)' : 'rgba(122,86,190,.9)';
      ctx.lineWidth = 1.5; ctx.stroke();
      ps.forEach(p => {
        ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
        ctx.strokeStyle = neg ? '#c62828' : '#7a56be'; ctx.lineWidth = 1.2;
        ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
      });
      const mid = toScreen(pt.poly[0]);
      tag(ctx, mid.x + 6, mid.y - 6, (neg ? '−' : '+') + (i + 1), neg ? '#c62828' : '#7a56be');
    });
    // 그리는 중인 도형
    if (S().draftRect) {
      const a = toScreen(S().draftRect.a), b = toScreen(S().draftRect.b);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#7a56be'; ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
    }
    if (S().draftPoly.length) {
      const ps = S().draftPoly.map(toScreen);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#7a56be'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ps.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke(); ctx.setLineDash([]);
      ps.forEach(p => { ctx.fillStyle = '#7a56be'; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); });
    }
    // 추천 영역 / 후보점
    if (S().region.length) {
      const ps = S().region.map(toScreen);
      ctx.fillStyle = 'rgba(0,160,109,.10)'; ctx.strokeStyle = 'rgba(0,160,109,.85)';
      ctx.lineWidth = 1.6; ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ps.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (ps.length > 2) { ctx.closePath(); ctx.fill(); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#00a06d';
      ps.forEach(p => ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5));
    }
    S().cands.forEach((g, i) => {
      const p = toScreen(g);
      halo(ctx, () => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); }, '#5b6672', 1.4);
      ctx.fillStyle = '#5b6672'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), p.x, p.y + 3); ctx.textAlign = 'left';
    });

    const c = center();
    if (S().post && c) {
      const cs = toScreen(c);
      if (S().ptMode === 'ring' && S().ring) {
        const rs = S().ring * S().view.s;
        ctx.setLineDash([5, 4]);
        halo(ctx, () => { ctx.beginPath(); ctx.arc(cs.x, cs.y, rs, 0, TAU); }, '#7a56be', 1.8);
        ctx.setLineDash([]);
        tag(ctx, cs.x, cs.y - rs - 5, 'R ' + distText(S().ring) + '  (테두리를 끌어 조절)', '#7a56be', 'center');
      } else {
        const R = S().post.R * S().view.s, tol = S().post.tolR;
        ctx.strokeStyle = 'rgba(0,160,109,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cs.x, cs.y, R * (1 + tol), 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(cs.x, cs.y, Math.max(0, R * (1 - tol)), 0, TAU); ctx.stroke();
        ctx.setLineDash([6, 4]);
        halo(ctx, () => { ctx.beginPath(); ctx.arc(cs.x, cs.y, R, 0, TAU); }, '#00a06d', 1.6);
        ctx.setLineDash([]);
      }
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(31,111,208,.55)'; ctx.lineWidth = 1;
      S().pts.forEach(g => { const s = toScreen(g); ctx.beginPath(); ctx.moveTo(cs.x, cs.y); ctx.lineTo(s.x, s.y); ctx.stroke(); });
      ctx.setLineDash([]);
    }
    if (S().pts.length >= 3) {
      const hull = convexHull(S().pts).map(toScreen);
      ctx.strokeStyle = 'rgba(31,111,208,.5)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      hull.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
    }
    if (S().calPts.length) {
      const ps = S().calPts.map(toScreen);
      halo(ctx, () => {
        ctx.beginPath();
        ps.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      }, '#c26a00', 1.5);
      ps.forEach(p => ctx.strokeRect(p.x - 3, p.y - 3, 6, 6));
    }
    S().pts.forEach((g, i) => drawPt(ctx, toScreen(g), i));
    if (c) drawCenter(ctx, toScreen(c));

    S().statusText =
      S().iw + '×' + S().ih + ' px · 배율 ' + (S().view.s * 100).toFixed(0) + '%' +
      (S().pxPerMm ? ' · 1px=' + (1 / S().pxPerMm).toFixed(2) + 'mm' : '') +
      (S().invert ? ' · 색 반전' : '');
  };

  // ---------- 결과 시트 (PNG) ----------
  const outSave = (fields) => {
    setOutFields(fields);
    try { localStorage.setItem(OUT_KEY, JSON.stringify(fields)); } catch (e) { /* ignore quota */ }
  };

  const renderScene = (pxW, uiScale) => {
    const sc = pxW / S().iw;
    const w = Math.round(S().iw * sc), h = Math.round(S().ih * sc);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const keepCtx = ctxRef.current, keepView = S().view, keepCssSize = cssSizeRef.current, keepUI = UI.current;
    ctxRef.current = off.getContext('2d');
    S().view = { s: sc, tx: 0, ty: 0 };
    cssSizeRef.current = () => ({ w, h });
    UI.current = uiScale || 1;
    try { draw(); }
    finally {
      ctxRef.current = keepCtx;
      S().view = keepView;
      cssSizeRef.current = keepCssSize;
      UI.current = keepUI;
      draw();
    }
    return off;
  };

  const SF = '"Malgun Gothic","맑은 고딕",sans-serif';
  const sFont = (c, px, bold) => { c.font = (bold ? 'bold ' : '') + px + 'px ' + SF; };
  const sText = (c, x, y, t, px, col, bold, align) => {
    sFont(c, px, bold);
    c.textAlign = align || 'left';
    c.textBaseline = 'top';
    c.fillStyle = col;
    c.fillText(t, x, y);
    c.textAlign = 'left';
  };
  const sWrap = (c, t, px, bold, maxw) => {
    sFont(c, px, bold);
    const toks = [];
    let buf = '';
    for (const ch of t) {
      if (ch === ' ') { if (buf) { toks.push(buf); buf = ''; } toks.push(' '); }
      else if (ch >= '가' && ch <= '힣') { if (buf) { toks.push(buf); buf = ''; } toks.push(ch); }
      else buf += ch;
    }
    if (buf) toks.push(buf);
    const lines = [];
    let line = '';
    for (const tk of toks) {
      const cand = line + tk;
      if (c.measureText(cand.trim()).width > maxw && line.trim()) {
        lines.push(line.trim());
        line = tk === ' ' ? '' : tk;
      } else line = cand;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  };
  const sPara = (c, x, y, t, px, col, maxw, bold, lh, bullet) => {
    lh = lh || 1.45;
    let mw = maxw, bx = x;
    if (bullet) {
      sText(c, x, y, bullet, px, col, bold);
      bx = x + px * 1.15; mw = maxw - px * 1.15;
    }
    for (const ln of sWrap(c, t, px, bold, mw)) {
      sText(c, bx, y, ln, px, col, bold);
      y += Math.round(px * lh);
    }
    return y;
  };
  const sParaH = (c, t, px, maxw, lh, bullet) => {
    lh = lh || 1.45;
    const mw = bullet ? maxw - px * 1.15 : maxw;
    return sWrap(c, t, px, false, mw).length * Math.round(px * lh);
  };
  const sMarkCenter = (c, cx, cy, r) => {
    c.strokeStyle = '#e02020'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
    c.beginPath();
    c.moveTo(cx - r - 4, cy); c.lineTo(cx + r + 4, cy);
    c.moveTo(cx, cy - r - 4); c.lineTo(cx, cy + r + 4);
    c.stroke();
  };
  const sMarkPoint = (c, cx, cy, r) => {
    c.strokeStyle = '#1f6fd0'; c.lineWidth = 2;
    c.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r); c.lineTo(cx, cy + r);
    c.stroke();
  };
  const sWarnIcon = (c, x, y, h) => {
    c.strokeStyle = '#c2443a'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x + h / 2, y); c.lineTo(x + h, y + h * 0.88); c.lineTo(x, y + h * 0.88);
    c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(x + h / 2, y + h * 0.30); c.lineTo(x + h / 2, y + h * 0.60); c.stroke();
    c.fillStyle = '#c2443a';
    c.beginPath(); c.arc(x + h / 2, y + h * 0.73, 2.2, 0, TAU); c.fill();
  };
  const roundRect = (c, x, y, w, h, r) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };

  const sheetData = () => {
    const c = center();
    if (!S().img) return { err: '도면을 먼저 붙여넣으세요.' };
    if (!c || !S().post) return { err: '형상과 체결 포인트를 배치해 판정이 나온 뒤에 저장할 수 있습니다.' };
    const tolR = Math.max(1, parseFloat(S().tolR) || 10) / 100;
    const tolGap = Math.min(179, Math.max(90, parseFloat(S().tolGap) || 150));
    const n = S().pts.length;
    const gr = gradeOf(S().post, tolR, tolGap, n);
    return {
      grade: gr.g, cls: gr.cls,
      radDev: S().post.radDev * 100, radTol: tolR * 100,
      gap: S().post.maxGap * 180 / Math.PI, gapTol: tolGap, n, twoPt: n < 3,
      pts: S().pts.map((p, i) => ({
        n: i + 1,
        dev: (S().post.r[i] - S().post.R) / S().post.R * 100,
        share: S().share ? S().share[i] : null,
      })),
    };
  };

  const buildSheet = () => {
    const D = sheetData();
    if (D.err) { window.alert(D.err); return null; }
    const W = 2400, M = 60, PAD = 34, IND = 30, TOP = 172, LEG = 78, GAP = 44;
    const GC = { ok: '#00a06d', warn: '#c26a00', bad: '#c62828' }[D.cls] || '#68727e';
    const INK = '#1c2430', GREY = '#68727e', LN = '#d8dee4';
    const warns = OUT_DEF.warns, notes = OUT_DEF.notes;

    const meas = document.createElement('canvas').getContext('2d');
    const tw = W - 2 * M - 2 * PAD - IND;
    let blk = 26 + 46;
    warns.forEach(t => { blk += sParaH(meas, t, 22, tw, 1.38, '·') + 6; });
    blk += 10 + 1 + 16;
    notes.forEach(t => { blk += sParaH(meas, t, 17, tw, 1.34, '–') + 5; });
    blk += 22;

    const colW = 1590;
    const scene = renderScene(colW, 1.6);
    const rightH = 120 + 36 + 2 * 120 + 46 + 68 + D.pts.length * 38 + 20;
    const bodyH = Math.max(scene.height + LEG, rightH);
    const H = TOP + bodyH + GAP + blk + 52;

    const cv2 = document.createElement('canvas');
    cv2.width = W; cv2.height = H;
    const c = cv2.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);

    // 머리말
    sText(c, M, 54, outFields.title || 'BCC 권상 자세 안전성 검토결과', 46, INK, true);
    if (outFields.dwg.trim()) sText(c, M, 118, outFields.dwg.trim(), 21, GREY);
    const today = new Date();
    const ymd = today.getFullYear() + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' + String(today.getDate()).padStart(2, '0');
    const meta = [ymd, outFields.author.trim(), 'BCC Lifting v0.3'].filter(Boolean).join(' · ');
    c.textBaseline = 'middle';
    sFont(c, 21, false); c.textAlign = 'right'; c.fillStyle = GREY;
    c.fillText(meta, W - M, 82);
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.strokeStyle = LN; c.lineWidth = 2;
    c.beginPath(); c.moveTo(M, 140); c.lineTo(W - M, 140); c.stroke();

    // 도면
    const ix = M, iy = TOP;
    c.drawImage(scene, ix, iy);
    c.strokeStyle = LN; c.lineWidth = 2;
    c.strokeRect(ix, iy, scene.width, scene.height);

    // 범례
    let lx = ix + 10, ly = iy + scene.height + 26;
    sMarkCenter(c, lx, ly, 9);
    sText(c, lx + 20, ly - 12, '면적중심', 19, GREY);
    sFont(c, 19, false);
    lx = lx + 20 + c.measureText('면적중심').width + 40;
    sMarkPoint(c, lx + 9, ly, 8);
    sText(c, lx + 28, ly - 12, '체결 포인트', 19, GREY);
    sFont(c, 19, false);
    lx = lx + 28 + c.measureText('체결 포인트').width + 40;
    c.strokeStyle = '#00a06d'; c.lineWidth = 2;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(lx + k * 9, ly); c.lineTo(lx + k * 9 + 5, ly); c.stroke(); }
    sText(c, lx + 62, ly - 12, '기준 원 / 허용 밴드', 19, GREY);

    // 우측 요약
    const rx = M + colW + 46, rw = W - M - rx;
    c.fillStyle = '#eef4f2'; c.strokeStyle = LN; c.lineWidth = 2;
    roundRect(c, rx, 172, rw, 120, 12); c.fill(); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const labH = 21 * 1.3, grH = 52 * 1.15, bTop = 232 - (labH + grH) / 2;
    sFont(c, 21, false); c.fillStyle = GREY; c.fillText('자세 안전성 판정', rx + rw / 2, bTop + labH / 2);
    sFont(c, 52, true); c.fillStyle = GC; c.fillText(D.grade, rx + rw / 2, bTop + labH + grH / 2);
    c.textAlign = 'left'; c.textBaseline = 'top';

    const OKC = '#00a06d', WNC = '#c26a00', BDC = '#c62828';
    const colR = D.radDev <= D.radTol ? OKC : (D.radDev <= D.radTol * 2 ? WNC : BDC);
    const colA = D.twoPt ? GREY : (D.gap <= D.gapTol ? OKC : (D.gap < 180 ? WNC : BDC));

    let y = 328;
    const rows = [
      ['반경 편차', D.radDev.toFixed(1) + '%', '허용 ' + D.radTol + '%', D.radDev / D.radTol, colR],
      ['최대 각도 간격', D.twoPt ? '해당 없음' : D.gap.toFixed(0) + '°',
       D.twoPt ? '2점은 평가하지 않음' : '허용 ' + D.gapTol + '°',
       D.twoPt ? 0 : D.gap / 180, colA],
    ];
    for (const [lab, val, tol, frac, col] of rows) {
      sText(c, rx, y, lab, 22, INK, true);
      c.textAlign = 'right'; sFont(c, 22, true); c.fillStyle = col;
      c.fillText(val, rx + rw, y); c.textAlign = 'left';
      y += 34;
      sText(c, rx, y, tol, 18, GREY);
      const gy = y + 32;
      c.fillStyle = '#e6eaee'; roundRect(c, rx, gy, rw, 12, 6); c.fill();
      if (frac > 0) { c.fillStyle = col; roundRect(c, rx, gy, Math.max(6, rw * Math.min(1, frac)), 12, 6); c.fill(); }
      const tick = rx + rw * (lab === '반경 편차' ? 1 : D.gapTol / 180);
      c.strokeStyle = '#59636e'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(tick, gy - 5); c.lineTo(tick, gy + 17); c.stroke();
      y = gy + 54;
    }

    y += 6;
    sText(c, rx, y, '체결 포인트 ' + D.n + '개', 22, INK, true);
    y += 40;
    sText(c, rx, y, '포인트', 18, GREY);
    c.textAlign = 'right';
    sFont(c, 18, false); c.fillStyle = GREY;
    c.fillText('반경편차', rx + rw * 0.60, y);
    c.fillText('분담률', rx + rw, y);
    c.textAlign = 'left';
    y += 28;
    c.strokeStyle = LN; c.lineWidth = 2;
    c.beginPath(); c.moveTo(rx, y); c.lineTo(rx + rw, y); c.stroke();
    y += 12;
    for (const p of D.pts) {
      const bad = Math.abs(p.dev) > D.radTol;
      sText(c, rx, y, '#' + p.n, 21, INK);
      c.textAlign = 'right';
      sFont(c, 21, bad); c.fillStyle = bad ? '#c62828' : INK;
      c.fillText((p.dev >= 0 ? '+' : '') + p.dev.toFixed(1) + '%', rx + rw * 0.60, y);
      sFont(c, 21, false); c.fillStyle = INK;
      c.fillText(p.share === null ? '—' : Math.round(p.share) + '%', rx + rw, y);
      c.textAlign = 'left';
      y += 38;
      c.strokeStyle = '#eef1f4'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(rx, y - 8); c.lineTo(rx + rw, y - 8); c.stroke();
    }

    // 주의 블록
    const by = TOP + bodyH + GAP;
    c.fillStyle = '#fdf0ee'; c.strokeStyle = '#e8bdb6'; c.lineWidth = 2;
    roundRect(c, M, by, W - 2 * M, H - 52 - by, 14); c.fill(); c.stroke();
    const tx = M + PAD;
    let ty = by + 26;
    sWarnIcon(c, tx, ty + 4, 26);
    sText(c, tx + 38, ty, '주의', 26, '#c2443a', true);
    ty += 46;
    warns.forEach(t => { ty = sPara(c, tx, ty, t, 22, INK, tw, true, 1.38, '·') + 6; });
    ty += 10;
    c.strokeStyle = '#e8bdb6'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(W - M - PAD, ty); c.stroke();
    ty += 16;
    notes.forEach(t => { ty = sPara(c, tx, ty, t, 17, GREY, tw, false, 1.34, '–') + 5; });

    return cv2;
  };

  const saveSheet = async () => {
    const cv2 = buildSheet();
    if (!cv2) return;
    const blob = await new Promise(res => cv2.toBlob(res, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'BCC_권상_검토결과.png';
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- 마우스/키보드/붙여넣기 ----------
  const localPt = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (p) => {
    const R = 15;
    for (let i = S().pts.length - 1; i >= 0; i--) {
      const s = toScreen(S().pts[i]);
      if (Math.hypot(s.x - p.x, s.y - p.y) < R) return { t: 'pt', i };
    }
    const c = center();
    if (c) {
      const s = toScreen(c);
      if (Math.hypot(s.x - p.x, s.y - p.y) < R) return { t: 'ctr' };
    }
    for (let i = S().cands.length - 1; i >= 0; i--) {
      const s = toScreen(S().cands[i]);
      if (Math.hypot(s.x - p.x, s.y - p.y) < R) return { t: 'cand', i };
    }
    for (let a = S().parts.length - 1; a >= 0; a--) {
      const poly = S().parts[a].poly;
      for (let b = poly.length - 1; b >= 0; b--) {
        const s = toScreen(poly[b]);
        if (Math.hypot(s.x - p.x, s.y - p.y) < 9) return { t: 'vert', a, b };
      }
    }
    return null;
  };
  const hitRing = (p) => {
    const c = center();
    if (!c || S().ptMode !== 'ring' || !S().ring) return false;
    const cs = toScreen(c);
    return Math.abs(Math.hypot(p.x - cs.x, p.y - cs.y) - S().ring * S().view.s) < 8;
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    // stage 크기 함수 세팅
    cssSizeRef.current = () => {
      const r = cv.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const onPaste = (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); setImage(f); return; }
        }
      }
    };
    const onDragOver = (e) => e.preventDefault();
    const onWinDrop = (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.indexOf('image/') === 0) setImage(f);
    };

    const onContextMenu = (e) => {
      if (!S().img) return;
      e.preventDefault();
      const p = localPt(e);
      for (let i = S().cands.length - 1; i >= 0; i--) {
        const s = toScreen(S().cands[i]);
        if (Math.hypot(s.x - p.x, s.y - p.y) < 15) { S().cands.splice(i, 1); bump(); draw(); return; }
      }
    };

    const onMouseDown = (e) => {
      const p = localPt(e);
      if (S().tool === 'rect') { S().draftRect = { a: toImage(p), b: toImage(p) }; return; }
      if (S().tool === 'poly') { S().draftPoly.push(toImage(p)); draw(); return; }
      if (S().tool === 'cand') { S().cands.push(toImage(p)); bump(); draw(); return; }
      if (S().tool === 'region') { S().region.push(toImage(p)); bump(); draw(); return; }
      if (S().calMode) {
        S().calPts.push(toImage(p));
        if (S().calPts.length === 2) {
          const a = S().calPts[0], b = S().calPts[1];
          S().calPx = Math.hypot(b.x - a.x, b.y - a.y);
          S().calMode = false;
          S().calBtnText = '두 점 다시 찍기';
          S().calApplyDisabled = false;
          S().calInfo = '두 점 거리 = ' + S().calPx.toFixed(1) + ' px. 실제 거리(mm)를 넣고 [적용].';
          bump();
        }
        draw(); return;
      }
      const h = hit(p);
      if (h) { S().drag = h; cv.style.cursor = 'grabbing'; return; }
      if (hitRing(p)) { S().drag = { t: 'ring' }; cv.style.cursor = 'ew-resize'; return; }
      S().panning = { x: e.clientX, y: e.clientY, tx: S().view.tx, ty: S().view.ty };
      cv.style.cursor = 'grabbing';
    };
    const onMouseMove = (e) => {
      const p = localPt(e);
      if (S().tool === 'rect' && S().draftRect) { S().draftRect.b = toImage(p); draw(); return; }
      if (S().drag) {
        const ip = toImage(p);
        switch (S().drag.t) {
          case 'ring': {
            const c = center();
            S().ring = Math.max(1, Math.hypot(ip.x - c.x, ip.y - c.y));
            reprojectAll(); evaluate(); return;
          }
          case 'ctr': S().manualC = ip; reprojectAll(); bump(); evaluate(); return;
          case 'cand': S().cands[S().drag.i] = ip; draw(); return;
          case 'vert': S().parts[S().drag.a].poly[S().drag.b] = ip; afterShapeChange(); return;
          default:
            S().pts[S().drag.i] = (S().ptMode === 'ring' && S().ring) ? toRing(ip) : ip;
            evaluate(); return;
        }
      }
      if (S().panning) {
        S().view.tx = S().panning.tx + (e.clientX - S().panning.x);
        S().view.ty = S().panning.ty + (e.clientY - S().panning.y);
        draw(); return;
      }
      if (S().img && !S().calMode && !S().tool) {
        cv.style.cursor = hit(p) ? 'grab' : (hitRing(p) ? 'ew-resize' : 'default');
      }
    };
    const onMouseUp = () => {
      if (S().tool === 'rect' && S().draftRect) {
        const a = S().draftRect.a, b = S().draftRect.b;
        S().draftRect = null;
        if (Math.abs(a.x - b.x) > 3 && Math.abs(a.y - b.y) > 3) {
          S().parts.push({ poly: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], sign: 1 });
          afterShapeChange();
          setTool(null);
        } else {
          draw();
        }
      }
      S().drag = null; S().panning = null;
      if (!S().tool) cv.style.cursor = 'default';
    };
    const onWheel = (e) => {
      if (!S().img) return;
      e.preventDefault();
      const p = localPt(e), before = toImage(p);
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      S().view.s = Math.max(0.02, Math.min(40, S().view.s * k));
      const after = toScreen(before);
      S().view.tx += p.x - after.x;
      S().view.ty += p.y - after.y;
      draw();
    };
    const onKeyDown = (e) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') fitView();
      if (e.key === 'Enter' && S().tool === 'poly') closePoly();
      if (e.key === 'Backspace') {
        if (S().tool === 'poly' && S().draftPoly.length) { e.preventDefault(); S().draftPoly.pop(); draw(); }
        else if (S().tool === 'region' && S().region.length) { e.preventDefault(); S().region.pop(); bump(); draw(); }
      }
      if (e.key === 'Escape' && S().tool) setTool(null);
    };

    cv.addEventListener('contextmenu', onContextMenu);
    cv.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onWinDrop);

    return () => {
      ro.disconnect();
      cv.removeEventListener('contextmenu', onContextMenu);
      cv.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onWinDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 파일 입력 ----------
  const fileInputRef = useRef(null);
  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setImage(f);
    e.target.value = '';
  };

  // ---------- 파츠 목록 ----------
  const sumInfo = useMemo(() => {
    // 렌더 변경을 감지하기 위해 uiTick 참조
    void uiTick;
    const c = S().areaC;
    if (!c) {
      return {
        cls: 'sum none',
        html: S().parts.length ? '면적이 0입니다. 잘라낼 파츠(−)가 더한 파츠(+)보다 큽니다.' : '형상을 그리면 면적중심이 계산됩니다.',
      };
    }
    return {
      cls: 'sum',
      html: '전체 면적 <b>' + areaText(c.A) + '</b><br>면적중심 ' +
        (S().pxPerMm ? '' : '(이미지 좌표) ') + Math.round(c.x) + ', ' + Math.round(c.y) +
        (S().manualC ? '<br><span style="color:#8a4d00">중심을 수동으로 옮긴 상태입니다.</span>' : ''),
    };
  }, [uiTick]);

  const partsList = useMemo(() => {
    void uiTick;
    return S().parts.map((pt, i) => {
      const r = polyAreaCentroid(pt.poly);
      return {
        i,
        neg: pt.sign < 0,
        label: '파츠 ' + (i + 1) + ' (' + pt.poly.length + '점, ' + (r ? areaText(r.A) : '—') + ')',
      };
    });
  }, [uiTick]);

  // ---------- suggestion 리스트 상태 ----------
  const suggestList = S().suggestions;
  const suggIsErr = S().suggMsg && S().suggMsg.startsWith('ERR:');

  // ---------- Reset ----------
  const doReset = () => {
    const s = S();
    s.img = null; s.parts = []; s.areaC = null; s.manualC = null;
    s.pts = []; s.post = null; s.share = null; s.ring = null;
    s.pxPerMm = null; s.calPts = []; s.cands = []; s.region = []; s.suggestions = [];
    s.draftRect = null; s.draftPoly = []; s.tool = null;
    s.msgs = [];
    s.suggMsg = '';
    bump();
    evaluate();
  };

  // 등급 렌더
  const gradeBox = S().grade;

  // metric 계산
  const radBarWidth = (() => {
    if (!S().post) return 0;
    return Math.min(100, S().post.radDev / (S().post.tolR * 2.5) * 100);
  })();
  const radBarClass = (() => {
    if (!S().post) return 'ok';
    const dev = S().post.radDev, tol = S().post.tolR;
    return dev <= tol ? 'ok' : (dev <= tol * 2 ? 'warn' : 'bad');
  })();
  const angGapDeg = S().post ? S().post.maxGap * 180 / Math.PI : null;
  const angBarWidth = angGapDeg == null ? 0 : Math.min(100, angGapDeg / 180 * 100);
  const angBarClass = (() => {
    if (!S().post || S().pts.length < 3) return 'ok';
    return angGapDeg <= (parseFloat(S().tolGap) || 150) ? 'ok' : (S().post.cogOut ? 'bad' : 'warn');
  })();

  const gradeCls = GRADE_STYLES[gradeBox.cls || 'none'] || GRADE_STYLES.none;
  const tolGapNum = parseFloat(S().tolGap) || 150;

  return (
    <div className="max-w-7xl mx-auto pb-6 animate-fade-in-up">
      <AnalysisPageBanner
        title="BCC Lifting Calculator"
        subtitle="면적중심 기반 자세 안전성을 평가합니다. 도면 위 체결 위치를 시각적으로 선정하세요."
        icon={PenTool}
        onBack={() => setCurrentMenu('Interactive Apps')}
        backLabel="Interactive Apps로 돌아가기"
        gradient="from-brand-blue via-emerald-900 to-emerald-700"
        iconClassName="text-emerald-300"
        subtitleClassName="text-emerald-200/80"
      />

      <div
        className="flex h-[calc(100vh-13rem)] min-h-[620px] bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden bcc-scope"
      >
        <style>{CSS}</style>

        {/* 좌측 입력 사이드바 */}
        <aside className="w-[340px] shrink-0 flex flex-col bg-slate-50 border-r border-slate-200">
          <div className="flex-1 overflow-y-auto p-4 space-y-3 [scrollbar-gutter:stable]">

            {/* 1. 도면 */}
            <SectionCard title="1. 도면" icon={ImageIcon}>
              <button className={BTN_PRIMARY} onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                이미지 파일 선택…
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className={BTN_SECONDARY} onClick={fitView}>화면 맞춤 (F)</button>
                <button className={S().invert ? BTN_TOGGLE_ON : BTN_SECONDARY}
                        onClick={() => { S().invert = !S().invert; draw(); bump(); }}>
                  {S().invert ? '색 반전 (켜짐)' : '색 반전'}
                </button>
              </div>
              <button className={BTN_SECONDARY} onClick={doReset}>전체 초기화</button>
              <input type="file" ref={fileInputRef} accept="image/*" hidden onChange={onFileChange} />
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                캡처 후 이 화면에서 <b className="text-emerald-700">Ctrl+V</b> 또는 파일 드래그&amp;드롭.
              </p>
            </SectionCard>

            {/* 2. 형상 입력 → 면적중심 */}
            <SectionCard title="2. 형상 입력 → 면적중심" icon={Shapes}>
              <div className="grid grid-cols-2 gap-2">
                <button className={S().tool === 'rect' ? BTN_TOGGLE_ON : BTN_SECONDARY}
                        onClick={() => { if (needImg()) setTool('rect'); }}>
                  {S().tool === 'rect' ? '그리는 중… (Esc)' : '사각형 그리기'}
                </button>
                <button className={S().tool === 'poly' ? BTN_TOGGLE_ON : BTN_SECONDARY}
                        onClick={() => { if (needImg()) setTool('poly'); }}>
                  {S().tool === 'poly' ? '그리는 중… (Esc)' : '다각형 그리기'}
                </button>
              </div>
              <button className={BTN_SECONDARY} onClick={closePoly} disabled={S().tool !== 'poly'}>
                다각형 닫기 (Enter)
              </button>

              {partsList.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {partsList.map(p => (
                    <div key={p.i}
                         className={
                           'flex items-center gap-2 rounded-lg border px-2 py-1.5 ' +
                           (p.neg ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')
                         }>
                      <button
                        onClick={() => { S().parts[p.i].sign *= -1; afterShapeChange(); }}
                        className={
                          'w-7 h-7 rounded-md font-bold text-sm flex items-center justify-center transition-colors cursor-pointer ' +
                          (p.neg
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white')
                        }
                        title="부호 반전 (더하기 / 잘라내기)"
                      >
                        {p.neg ? '−' : '+'}
                      </button>
                      <span className="flex-1 text-xs text-slate-700 truncate">{p.label}</span>
                      <button
                        onClick={() => { S().parts.splice(p.i, 1); afterShapeChange(); }}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        title="파츠 삭제"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div
                className={
                  'text-xs rounded-lg px-3 py-2 leading-relaxed border ' +
                  (sumInfo.cls === 'sum none'
                    ? 'bg-slate-50 border-slate-200 text-slate-500'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800')
                }
                dangerouslySetInnerHTML={{ __html: sumInfo.html }}
              />

              {S().manualC && (
                <button className={BTN_SECONDARY}
                        onClick={() => { S().manualC = null; afterShapeChange(); }}>
                  면적중심 위치로 되돌리기
                </button>
              )}
            </SectionCard>

            {/* 3. 체결 포인트 */}
            <SectionCard title="3. 체결 포인트" icon={Target}>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  개수 (2 ~ 4)
                </label>
                <input type="number" value={S().nPt} min="2" max="4" step="1"
                       className={INPUT_CLS}
                       onChange={e => {
                         S().nPt = e.target.value;
                         const n = clampN();
                         if (S().pts.length && S().pts.length !== n) placeMarks(S().ptMode);
                         else evaluate();
                       }} />
              </div>
              <div className="flex bg-slate-100 rounded-lg p-1">
                <SegBtn active={S().ptMode === 'free'} onClick={() => placeMarks('free')}>임의 선택</SegBtn>
                <SegBtn active={S().ptMode === 'ring'} onClick={() => placeMarks('ring')}>원 기준 선택</SegBtn>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed" dangerouslySetInnerHTML={{ __html:
                S().ptMode === 'ring'
                  ? '면적중심 기준 <b>원 위에서만</b> 움직입니다. <b>원 테두리를 끌면</b> 반지름이 바뀌고 포인트가 따라옵니다. 이 방식은 반경 편차가 항상 0%입니다.'
                  : '⊞ 를 도면 위 체결 위치로 <b>자유롭게</b> 드래그하세요. 옮기는 즉시 평가가 갱신됩니다.' }} />
            </SectionCard>

            {/* 4. 자세 안전성 */}
            <SectionCard title="4. 자세 안전성" icon={Activity}>
              <div className={'rounded-xl p-3 text-center border ' + gradeCls}>
                <div className="text-2xl font-extrabold tracking-widest">{gradeBox.g}</div>
                <div className="text-[11px] opacity-80 mt-1 leading-tight">{gradeBox.why}</div>
              </div>

              {/* 반경 편차 metric */}
              <div className="mt-2">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">반경 편차</span>
                    <div className="text-[10px] text-slate-400">중심~포인트 거리가 균일한가</div>
                  </div>
                  <b className="text-[11px] font-bold text-slate-700 whitespace-nowrap pt-0.5">
                    {S().post
                      ? (S().post.radDev * 100).toFixed(1) + '% / 허용 ' + (S().post.tolR * 100).toFixed(0) + '%'
                      : '—'}
                  </b>
                </div>
                <div className="h-2 rounded-full bg-slate-100 relative overflow-hidden">
                  <div className={'h-full rounded-full transition-all ' + (BAR_FILL[radBarClass] || BAR_FILL.ok)}
                       style={{ width: radBarWidth + '%' }} />
                  <div className="absolute top-[-2px] w-0.5 h-3 bg-slate-500" style={{ left: '40%' }} />
                </div>
              </div>

              {/* 최대 각도 간격 metric */}
              <div className="mt-1">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">최대 각도 간격</span>
                    <div className="text-[10px] text-slate-400">한쪽으로 몰리지 않았는가</div>
                  </div>
                  <b className="text-[11px] font-bold text-slate-700 whitespace-nowrap pt-0.5">
                    {S().post && S().pts.length >= 3
                      ? angGapDeg.toFixed(0) + '° / 허용 ' + tolGapNum.toFixed(0) + '°'
                      : (S().pts.length === 2 ? '해당 없음 (2점)' : '—')}
                  </b>
                </div>
                <div className="h-2 rounded-full bg-slate-100 relative overflow-hidden">
                  <div className={'h-full rounded-full transition-all ' + (BAR_FILL[angBarClass] || BAR_FILL.ok)}
                       style={{ width: angBarWidth + '%' }} />
                  <div className="absolute top-[-2px] w-0.5 h-3 bg-slate-500"
                       style={{ left: (tolGapNum / 180 * 100) + '%' }} />
                </div>
              </div>

              {/* 허용 tolerance 입력 */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                    반경 편차 허용 (%)
                  </label>
                  <input type="number" value={S().tolR} min="1" max="100" step="1"
                         className={INPUT_CLS}
                         onChange={e => { S().tolR = e.target.value; evaluate(); }} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                    각도 간격 허용 (°)
                  </label>
                  <input type="number" value={S().tolGap} min="90" max="179" step="5"
                         className={INPUT_CLS}
                         onChange={e => { S().tolGap = e.target.value; evaluate(); }} />
                </div>
              </div>

              {S().msgs.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {S().msgs.map((m, i) => (
                    <div key={i}
                         className={
                           'text-[11px] leading-relaxed px-3 py-2 rounded-lg border-l-4 ' +
                           (MSG_STYLES[m[0]] || MSG_STYLES.info)
                         }
                         dangerouslySetInnerHTML={{ __html: m[1] }} />
                  ))}
                </div>
              )}

              <button className={BTN_PRIMARY} onClick={saveSheet}>결과 시트 저장 (PNG)</button>
            </SectionCard>

            {/* 결과 시트 설정 (접기) */}
            <CollapsibleCard title="결과 시트 설정" icon={FileText}>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                도면 · 판정 요약 · 주의 문구를 한 장으로 묶어 저장합니다. 판정값과 포인트 표는 현재 화면 값으로 자동으로 채워집니다.
              </p>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">제목</label>
                <input type="text" className={INPUT_CLS}
                       value={outFields.title}
                       onChange={e => outSave({ ...outFields, title: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  도면명 (비우면 표시 안 함)
                </label>
                <input type="text" className={INPUT_CLS}
                       value={outFields.dwg}
                       onChange={e => outSave({ ...outFields, dwg: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  작성자 (비우면 표시 안 함)
                </label>
                <input type="text" className={INPUT_CLS}
                       value={outFields.author}
                       onChange={e => outSave({ ...outFields, author: e.target.value })} />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                주의 문구와 참고 각주는 <b className="text-slate-700">고정</b>입니다. 시트에 항상 같은 문구가 들어갑니다.
              </p>
            </CollapsibleCard>

            {/* 축척 보정 (접기) */}
            <CollapsibleCard title="축척 보정 (선택)" icon={Ruler}>
              <button className={S().calMode ? BTN_TOGGLE_ON : BTN_SECONDARY} onClick={startCalibration}>
                {S().calBtnText}
              </button>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  실제 거리 (mm)
                </label>
                <input type="number" id="calMmInput" placeholder="예: 1400" step="1" className={INPUT_CLS} />
              </div>
              <button className={BTN_PRIMARY}
                      disabled={S().calApplyDisabled}
                      onClick={() => {
                        const el = document.getElementById('calMmInput');
                        if (el) applyCalibration(el.value);
                      }}>
                적용
              </button>
              <p className="text-[11px] text-slate-500 leading-relaxed">{S().calInfo}</p>
            </CollapsibleCard>

            {/* 체결 포인트 추천 (접기) */}
            <CollapsibleCard title="체결 포인트 추천 (선택)" icon={Sparkles}>
              <div className="flex bg-slate-100 rounded-lg p-1">
                <SegBtn active={S().sMode === 'A'}
                        onClick={() => {
                          S().sMode = 'A';
                          if (S().tool === 'cand' || S().tool === 'region') setTool(null);
                          bump();
                        }}>후보점 조합</SegBtn>
                <SegBtn active={S().sMode === 'B'}
                        onClick={() => {
                          S().sMode = 'B';
                          if (S().tool === 'cand' || S().tool === 'region') setTool(null);
                          bump();
                        }}>영역 내 자동</SegBtn>
              </div>

              {S().sMode === 'A' ? (
                <>
                  <button className={S().tool === 'cand' ? BTN_TOGGLE_ON : BTN_SECONDARY}
                          onClick={() => { if (needImg()) setTool('cand'); }}>
                    {S().tool === 'cand' ? '그리는 중… (Esc)' : '후보점 추가'}
                  </button>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    클릭으로 후보점 추가(우클릭 삭제). 후보 <b className="text-slate-700">{S().cands.length}</b>개 중 최적 조합을 찾습니다.
                  </p>
                </>
              ) : (
                <>
                  <button className={S().tool === 'region' ? BTN_TOGGLE_ON : BTN_SECONDARY}
                          onClick={() => { if (needImg()) setTool('region'); }}>
                    {S().tool === 'region' ? '그리는 중… (Esc)' : '배치 가능 영역 그리기'}
                  </button>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    클릭으로 다각형을 그리고 버튼을 다시 눌러 종료. 꼭짓점 <b className="text-slate-700">{S().region.length}</b>개.
                  </p>
                </>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  평가 가중치
                </label>
                <input type="range" value={S().wRad} min="0" max="100"
                       onChange={e => { S().wRad = e.target.value; bump(); }}
                       className="w-full accent-emerald-600" />
                <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                  <span>← 각도 균등</span>
                  <span className="font-bold text-slate-700">{100 - S().wRad} : {S().wRad}</span>
                  <span>반경 균일 →</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                  포인트 최소 간격 ({S().pxPerMm ? 'mm' : 'px'})
                </label>
                <input type="number" value={S().minGap} min="0" step="10"
                       className={INPUT_CLS}
                       onChange={e => { S().minGap = e.target.value; }} />
              </div>

              <button className={BTN_PRIMARY} onClick={runSuggest}>추천 실행</button>

              {suggIsErr && (
                <div className={'text-[11px] leading-relaxed px-3 py-2 rounded-lg border-l-4 ' + MSG_STYLES.bad}>
                  {S().suggMsg.slice(4)}
                </div>
              )}
              {!suggIsErr && S().suggMsg && suggestList.length > 0 && (
                <>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{S().suggMsg}</p>
                  {suggestList.map((s, i) => (
                    <div key={i}
                         onClick={() => applySuggestion(i)}
                         className={
                           'rounded-lg border px-3 py-2 text-[11px] leading-relaxed cursor-pointer transition-colors ' +
                           (i === 0
                             ? 'bg-emerald-50 border-emerald-300 hover:border-emerald-500'
                             : 'bg-white border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40')
                         }>
                      <b className={i === 0 ? 'text-emerald-700' : 'text-slate-700'}>
                        {i ? '안 ' + (i + 1) : '★ 최적안'}
                      </b>
                      <span className="text-slate-600"> · 자세점수 {(s.score * 100).toFixed(0)}</span>
                      <div className="mt-1 text-slate-600">
                        <span className="text-slate-400">반경편차</span> {(s.radDev * 100).toFixed(1)}%
                        <span className="mx-1 text-slate-300">·</span>
                        <span className="text-slate-400">각도간격</span> {(s.maxGap * 180 / Math.PI).toFixed(0)}°
                        <span className="mx-1 text-slate-300">·</span>
                        <span className="text-slate-400">반경</span> {distText(s.R)}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {!suggIsErr && S().suggMsg && suggestList.length === 0 && (
                <p className="text-[11px] text-slate-500 leading-relaxed">{S().suggMsg}</p>
              )}
            </CollapsibleCard>
          </div>

          <SolverCredit contributor="권혁민" />
        </aside>

        {/* 캔버스 무대 */}
        <section className="flex-1 relative min-w-0 bg-slate-200/60" ref={stageRef}>
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

          {!S().img && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center text-slate-500">
              <div className="leading-relaxed">
                <div className="flex items-center justify-center gap-2 text-emerald-700 mb-2">
                  <PenTool size={18} />
                  <span className="font-bold text-base">여기에 캡처 이미지를 <span className="text-emerald-600">Ctrl+V</span></span>
                </div>
                <div className="text-xs text-slate-500">또는 파일을 드래그&amp;드롭</div>
              </div>
            </div>
          )}

          {S().toolbarHtml && (
            <div className="absolute left-3 top-3 bg-white/95 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800 max-w-[70%] leading-relaxed shadow-sm"
                 dangerouslySetInnerHTML={{ __html: S().toolbarHtml }} />
          )}

          <div className="absolute left-3 bottom-3 bg-white/95 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] text-slate-500 shadow-sm font-mono">
            {S().statusText}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- Scoped CSS ----------
// dangerouslySetInnerHTML 로 넣는 <b>·<span> 조각 스타일만 남긴다.
// 나머지 시각 요소는 전부 Tailwind 로 이관해 다른 Interactive App 과 톤을 맞췄다.
const CSS = `
.bcc-scope { min-width:0; }
.bcc-scope b { font-weight:700; color:inherit; }
`;
