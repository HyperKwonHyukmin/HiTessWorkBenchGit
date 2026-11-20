// PSA 평가보고서 자동화 프로그램 — 입력 규칙과 기본값.
// 화면(PsaReportAutomation.jsx)은 상태를 보여 주고 고치기만 하고, 줄 번호, 연동 삭제, 빈 칸 세기,
// 입력 파일 읽기 같은 규칙은 모두 여기 둔다(테스트 psaReport.test.js).
// 결정 원본 = docs/plans/2026-11-17-psa-report-automation-plan.md

// 2 = Process Condition 이 글자에서 '숫자 + 고정 단위' 구조로 바뀜(2026-11-17).
// 3 = Process 표 설명 기본 문단(DEFAULT_PROCESS_NOTES)이 생김 — 2판 이하에서 비어 있으면 채운다.
// 4 = Displacement, Acceleration 기본값(보고서 Table 2.4~2.6) — 3판 이하에서 그 표가 모두 비어 있으면 채운다.
// 5 = Line 에 modelCount(해석 모델 수, TD06 = 4)와 files(체크리스트에서 고른 파일)가 생김.
export const PSA_INPUT_VERSION = 6; // 6 = 보고서 정보(docInfo), 개정 이력, Line 재질과 두께

// Process Condition 표 아래 문단(보고서 Table 2.3 설명). 사용자가 고칠 수 있다.
export const DEFAULT_PROCESS_NOTES = [
  'The analysis was carried out under design pressure and maximum/minimum temperature conditions. Also ambient temperature considered for this calculation is 21℃.',
  '(*) marked Min./Max. operating temperature for liquid main is applied to the specific part as follows.',
  '- Min. operating temperature(-196℃) : From cargo manifold end to double shut valve',
  '- Max. operating temperature(45℃) : From cargo manifold end to double shut valve & From each liquid dome nozzle to each isolation valve',
  '(**) marked in compressor room, Min./Max. operating temperature, Pressure, Fluid type and Density is applied differently for each pipe lines in compressor room.',
].join('\n');
export const COMP_RM = 'COMP.RM';

let uidSeq = 0;
export const newUid = (prefix = 'r') => {
  uidSeq += 1;
  return `${prefix}${Date.now().toString(36)}${uidSeq.toString(36)}`;
};

// ── 1. Scope of Piping Lines ─────────────────────────────────
const DEFAULT_LINES = [
  ['TD01', 'Liquid Main'],
  ['TD02', 'Vapour & Gas Main'],
  ['TD03', 'Stripping & Spray Main'],
  ['TD04', 'Condensate Return'],
  ['TD05', 'Fuel Gas Supply'],
  ['TD06', 'Tank Vent No.1/2/3/4'],
  [COMP_RM, 'In Compressor Room'],
];

// ── 2. Process Condition (보고서 Table 2.3 값) ───────────────
// 숫자 칸 = { a, b, join } — a 가 주 값, b 는 둘째 값(join 이 있을 때만).
//   join '' = 값 하나 · 'range' = a ~ b(범위) · 'and' = a & b(두 유체) · 'alt' = a 와 보조 값 b(*)
// 단위는 칸 밖에 고정되고, 보고서는 formatValueCell 로 숫자마다 단위를 붙여 찍는다.
export const VALUE_JOINS = [
  { value: 'range', label: '~ 범위', symbol: '~' },
  { value: 'and', label: '& 둘 다', symbol: '&' },
  { value: 'alt', label: '(*) 보조 값', symbol: '(*)' },
];
export const FLUID_OPTIONS = ['LNG', 'NG', 'LNG & NG'];
export const INSULATION_OPTIONS = ['A', 'N/A', 'N/A & A'];

export const PROCESS_FIELDS = [
  { key: 'minTemp', label: 'Min. operating temperature', short: 'Min. temp.', kind: 'value', unit: '°C' },
  { key: 'maxTemp', label: 'Max. operating temperature', short: 'Max. temp.', kind: 'value', unit: '°C' },
  { key: 'pressure', label: 'Pressure (Design)', short: 'Pressure (Design)', kind: 'value', unit: 'barg' },
  { key: 'fluid', label: 'Fluid', short: 'Fluid', kind: 'select', options: FLUID_OPTIONS },
  { key: 'density', label: 'Density', short: 'Density', kind: 'value', unit: 'kg/m³' },
  { key: 'insulation', label: 'Insulation Application', short: 'Insulation', kind: 'select', options: INSULATION_OPTIONS },
];

const v = (a, b = '', join = '') => ({ a, b, join });
const LNG = { fluid: 'LNG', density: v('500'), insulation: 'A' };
const DEFAULT_PROCESS = {
  TD01: { minTemp: v('-163', '-196', 'alt'), maxTemp: v('80', '45', 'alt'), pressure: v('10'), ...LNG },
  TD02: { minTemp: v('-163'), maxTemp: v('45'), pressure: v('10'), fluid: 'NG', density: v('25'), insulation: 'A' },
  TD03: { minTemp: v('-163'), maxTemp: v('45'), pressure: v('10'), ...LNG },
  TD04: { minTemp: v('-163'), maxTemp: v('45'), pressure: v('10'), ...LNG },
  TD05: { minTemp: v('-163'), maxTemp: v('45'), pressure: v('19'), ...LNG },
  TD06: { minTemp: v('-158'), maxTemp: v('80'), pressure: v('0.35'), fluid: 'NG', density: v('25'), insulation: 'N/A' },
  [COMP_RM]: {
    minTemp: v('-196', '-18', 'range'),
    maxTemp: v('35.9', '112', 'range'),
    pressure: v('0.87', '15', 'range'),
    fluid: 'LNG & NG',
    density: v('500', '25', 'and'),
    insulation: 'N/A & A',
  },
};

export const emptyValueCell = () => v('');
/** 모델별로 나눈 Line(TD06-1)의 원래 번호(TD06) — 기본값은 원래 번호를 따른다. */
export const baseLineNo = (lineNo) => String(lineNo ?? '').trim().toUpperCase().replace(/^(TD\d+)-\d+$/, '$1');
// 기본값 객체를 줄마다 새로 만든다(같은 객체를 여러 줄이 나눠 쓰지 않게).
const defaultProcessRow = (lineNo) => JSON.parse(JSON.stringify({
  ...emptyProcessRow(), ...(DEFAULT_PROCESS[lineNo] || DEFAULT_PROCESS[baseLineNo(lineNo)] || {}),
}));
export const emptyProcessRow = () => Object.fromEntries(
  PROCESS_FIELDS.map(f => [f.key, f.kind === 'value' ? emptyValueCell() : '']),
);

/** 숫자 칸 → 보고서 글자. 'alt' 는 두 줄(보고서 표에서 줄바꿈). 빈 칸이면 ''. */
export function formatValueCell(cell, unit) {
  const a = String(cell?.a ?? '').trim();
  const b = String(cell?.b ?? '').trim();
  if (!a) return '';
  // 보고서 표기: -163°C · 10barg · 500 kg/m³
  const u = unit === 'kg/m³' ? ' kg/m³' : unit;
  const one = (x) => `${x}${u}`;
  if (!cell.join || !b) return one(a);
  if (cell.join === 'range') return `${one(a)} ~ ${one(b)}`;
  if (cell.join === 'and') return `${one(a)} & ${one(b)}`;
  return `${one(a)}\n${one(b)}(*)`;
}

/** Process 한 줄 → 보고서 칸 글자 { minTemp, maxTemp, pressure, fluid, density, insulation } */
export const formatProcessRow = (row) => Object.fromEntries(PROCESS_FIELDS.map(f => [
  f.key, f.kind === 'value' ? formatValueCell(row?.[f.key], f.unit) : String(row?.[f.key] ?? ''),
]));

// ── 3. Displacement (8칸 고정, mm/m) ─────────────────────────
// group = 보고서 표에서 합쳐 보이는 묶음, lines = 오른쪽 설명 칸(고정 글자).
export const DISPLACEMENT_ROWS = [
  { key: 'tdSeaHog', position: 'Trunk Deck', condition: 'Sea-going', state: 'Hogging', lines: 'Vapour / Gas / Relief / Condensate / Fuel Gas' },
  { key: 'tdSeaSag', position: 'Trunk Deck', condition: 'Sea-going', state: 'Sagging', lines: 'Vapour / Gas / Relief / Condensate / Fuel Gas' },
  { key: 'tdTermHog', position: 'Trunk Deck', condition: 'Terminal (Harbour)', state: 'Hogging', lines: 'Liquid / Spray' },
  { key: 'tdTermSag', position: 'Trunk Deck', condition: 'Terminal (Harbour)', state: 'Sagging', lines: 'Liquid / Spray' },
  { key: 'crSeaHog', position: 'Compressor Room', condition: 'Sea-going', state: 'Hogging', lines: 'All Lines' },
  { key: 'crSeaSag', position: 'Compressor Room', condition: 'Sea-going', state: 'Sagging', lines: 'All Lines' },
  { key: 'sun', position: 'Sun effect', condition: '', state: '', lines: 'All Lines (only for Trunk Deck)' },
  { key: 'cold', position: 'Cold effect', condition: '', state: '', lines: 'All Lines (only for Trunk Deck)' },
];

// ── 5. Manifold Load (표준 허용 하중, Table 4.5) ──────────────
// fx = Lateral, fy = Axial(Fy ext), fz = Vertical, mxz, my = Mt(torque moment)
export const MANIFOLD_SIZES = [
  { size: '100', fx: 20000, fy: 35000, fz: 30000, mxz: 9300, my: 1500 },
  { size: '150', fx: 30000, fy: 50000, fz: 50000, mxz: 25000, my: 1500 },
  { size: '200', fx: 35000, fy: 55000, fz: 55000, mxz: 35000, my: 2500 },
  { size: '250', fx: 45000, fy: 60000, fz: 60000, mxz: 60000, my: 3000 },
  { size: '300/350', fx: 50000, fy: 80000, fz: 80000, mxz: 90000, my: 4000 },
  { size: '400', fx: 75000, fy: 100000, fz: 100000, mxz: 130000, my: 5000 },
  { size: '500', fx: 100000, fy: 150000, fz: 150000, mxz: 200000, my: 6000 },
];

export const manifoldSizeLabel = (size) => (size ? `${size}A` : '');

/** Pipe size → 표준 하중. Mx = Mz = Mxz/√2(소수 1자리, 저장용). 모르는 size 면 null. */
export function manifoldLoadsFor(size) {
  const row = MANIFOLD_SIZES.find(r => r.size === size);
  if (!row) return null;
  const mxMz = Math.round((row.mxz / Math.SQRT2) * 10) / 10;
  return { fx: row.fx, fy: row.fy, fz: row.fz, mxz: row.mxz, my: row.my, mx: mxMz, mz: mxMz };
}

// ── 3, 4 단계 기본값 (보고서 Table 2.4 Displacement, 2.5 Calculation Position, 2.6 Uniform Acceleration Loads) ──
// 숫자는 부호 없이 저장한다(보고서는 양수에 + 를 붙여 찍는다).
export const DEFAULT_DISPLACEMENT = {
  tdSeaHog: '0.81', tdSeaSag: '-0.87',
  tdTermHog: '0.55', tdTermSag: '-0.50',
  crSeaHog: '0.81', crSeaSag: '-0.87',
  sun: '0.29', cold: '-0.47',
};

function defaultAcceleration() {
  const trunk = { uid: newUid('P'), discipline: 'Trunk Deck', x: '57000', y: '8190', z: '37800' };
  const comp = { uid: newUid('P'), discipline: 'Cargo Compressor Room', x: '77150', y: '3200', z: '44000' };
  return {
    accelPositions: [trunk, comp],
    accelLoads: [
      { uid: newUid('A'), positionUid: trunk.uid, loadCondition: 'Sea-going Condition', lines: 'Vapour & Gas / Relief / Condensate / Fuel Gas', x: '0.31', y: '1.255', z: '0.579' },
      { uid: newUid('A'), positionUid: trunk.uid, loadCondition: 'Terminal Condition', lines: 'Liquid / Spray', x: '0.155', y: '0.6275', z: '0.2895' },
      { uid: newUid('A'), positionUid: comp.uid, loadCondition: 'Sea-going Condition', lines: 'All Lines', x: '0.345', y: '1.391', z: '0.429' },
    ],
  };
}

// ── 보고서 정보(표지, 호선 문장 등) ──────────────────────────
// 호선과 대상마다 달라 서식에 박아 둘 수 없는 값. 서버 규칙 = 백엔드 services/psa_report_docx.py(_Report.cover).
// 비워 두면 보고서 그 자리에 '[Not provided]' 가 찍힌다(서식의 견본 호선 글자를 남기지 않는다).
export const DEFAULT_MATERIAL = 'A312 TP316L';
export const DEFAULT_WALL = 'Sch. 10s';
export const DOC_INFO_GROUPS = [
  { title: '표지', fields: [
    { key: 'title', label: 'Title', hint: '표지의 문서 제목', wide: true },
    { key: 'hullLabel', label: '호선 표기 (본문)', hint: "본문 '(Hull No. …)' 와 파일 이름에 씁니다. 예: 3441s" },
    { key: 'hullNo', label: 'Hull No. (표지)', hint: '시리즈면 범위로. 예: 3441-3444' },
    { key: 'client', label: 'Client', hint: '선주' },
    { key: 'project', label: 'Project', hint: '예: 174K LNG Carrier' },
    { key: 'shipClass', label: 'Ship Classification', hint: '예: BV' },
    { key: 'date', label: 'Date', hint: '예: 2026.11.18' },
    { key: 'revisionNo', label: 'Revision No.', hint: '예: ORI, 100' },
    { key: 'latestRevisionDate', label: 'Latest Revision Date', hint: '예: 2026.11.18' },
    { key: 'department', label: 'Department', hint: '예: Hull Outfitting Design Department' },
    { key: 'preparedBy', label: 'Prepared by', hint: '이름(연락처)' },
    { key: 'reviewedBy', label: 'Reviewed by' },
    { key: 'approvedBy', label: 'Approved by' },
    { key: 'status', label: 'Status', options: ['Preliminary', 'Intermediate', 'Final'] },
    { key: 'secretLevel', label: 'Secret Level', options: ['Confidential', 'Secret', 'Top Secret'] },
  ] },
  { title: '본문에 들어가는 기준', fields: [
    { key: 'software', label: '해석 프로그램', hint: '1장과 2.2 문장. 예: CAESAR II 2018' },
    { key: 'accelClass', label: '가속도 기준 선급', hint: '2.8 문장의 선급. 예: LR' },
    { key: 'accelRuleRef', label: '가속도 기준 규정', hint: '예: LR SHIP Part3,Chapter 9,Sec.9' },
    { key: 'pidDrawingNo', label: 'P&ID 도면 번호', hint: '부록 A Reference. 예: 2T-7412-004' },
  ] },
];
export const DOC_INFO_FIELDS = DOC_INFO_GROUPS.flatMap(g => g.fields);

const todayDots = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export function defaultDocInfo() {
  const info = Object.fromEntries(DOC_INFO_FIELDS.map(f => [f.key, '']));
  return { ...info, date: todayDots(), latestRevisionDate: todayDots(), revisionNo: 'ORI', status: 'Preliminary', secretLevel: 'Confidential', software: 'CAESAR II 2018' };
}

/** 최상단 폴더 이름의 호선(네 자리)으로 비어 있는 호선 칸과 제목을 채운다. 이미 적은 값은 건드리지 않는다. */
export function fillDocInfoFromFolder(input) {
  const hull = /(\d{4})/.exec(String(input.sourceFolder ?? ''))?.[1];
  if (!hull) return input;
  const cur = input.docInfo || defaultDocInfo();
  const next = { ...cur };
  if (blank(cur.hullLabel)) next.hullLabel = hull;
  if (blank(cur.hullNo)) next.hullNo = hull;
  if (blank(cur.title)) next.title = `H${hull} Design Basis of Pipe Stress Analysis for Cargo Systems`;
  return { ...input, docInfo: next };
}

export const lineMaterial = (l) => (l.material == null ? DEFAULT_MATERIAL : l.material);
export const lineWall = (l) => (l.wallThickness == null ? DEFAULT_WALL : l.wallThickness);

/** 보고서 정보 단계의 빈 칸 — { empty, labels } (개정 이력 없음, Line 재질과 두께 빈 칸 포함) */
export function docInfoSummary(input) {
  const info = input.docInfo || {};
  const labels = DOC_INFO_FIELDS.filter(f => blank(info[f.key])).map(f => f.label);
  // 개정 이력은 내용(Contents)을 적은 줄이 하나는 있어야 한다
  if (!(input.revisions || []).some(r => !blank(r.contents))) labels.push('개정 이력');
  input.lines.forEach(l => {
    if (blank(lineMaterial(l))) labels.push(`${l.lineNo} Material`);
    if (blank(lineWall(l))) labels.push(`${l.lineNo} Wall thickness`);
  });
  return { empty: labels.length, labels };
}

// ── 기본 입력 전체 ───────────────────────────────────────────
export function createDefaultInput() {
  const lines = DEFAULT_LINES.map(([lineNo, pipeLine]) => ({
    uid: newUid('L'), lineNo, pipeLine, folder: null, modelCount: lineNo === 'TD06' ? 4 : 1, files: {},
  }));
  const process = {};
  lines.forEach(l => { process[l.uid] = defaultProcessRow(l.lineNo); });

  const { accelPositions, accelLoads } = defaultAcceleration();

  const byNo = (no) => lines.find(l => l.lineNo === no)?.uid ?? '';
  return {
    version: PSA_INPUT_VERSION,
    workspace: null,
    lines,
    figureFolder: null,
    othersFolder: null, // 최상단 폴더로 올릴 때 최상단 파일과 못 맞춘 폴더(서버 Others)
    sourceFolder: '', // 최상단 폴더 이름(예 '3441 PSA REPORT') — 기준 호선을 읽는다
    process,
    processNotes: DEFAULT_PROCESS_NOTES,
    reportExclusions: [], // 사용자가 승인하고 뺀 자료(보고서에 '자료 없음'으로 남길 항목)
    docInfo: defaultDocInfo(),
    revisions: [{ uid: newUid('R'), no: '0', date: todayDots(), contents: '' }],
    displacement: { ...DEFAULT_DISPLACEMENT },
    accelPositions,
    accelLoads,
    manifold: [
      { uid: newUid('M'), lineUid: byNo('TD01'), size: '400' },
      { uid: newUid('M'), lineUid: byNo('TD02'), size: '400' },
    ],
  };
}

/** 새로 열 때의 입력 — Piping line 은 비우고(최상단 폴더나 줄 추가로 채움) 나머지 기본값은 그대로. */
export function createBlankInput() {
  return { ...createDefaultInput(), lines: [], process: {}, manifold: [] };
}

/** Manifold 가 비었을 때 TD01, TD02 가 있으면 400A 기본 줄을 넣는다(createDefaultInput 과 같은 기본값). */
function withDefaultManifold(input) {
  if (input.manifold.length) return input;
  const rows = ['TD01', 'TD02']
    .map(no => input.lines.find(l => String(l.lineNo).trim().toUpperCase() === no))
    .filter(Boolean)
    .map(l => ({ uid: newUid('M'), lineUid: l.uid, size: '400' }));
  return rows.length ? { ...input, manifold: rows } : input;
}

// ── Scope 줄 조작 ─────────────────────────────────────────────
const TD_RE = /^TD(\d+)$/i;
export const isCompRm = (line) => String(line?.lineNo ?? '').trim().toUpperCase() === COMP_RM;

/** 가장 큰 TD 번호 + 1 (두 자리). TD 줄이 없으면 TD01. */
export function nextTdLineNo(lines) {
  let max = 0;
  for (const l of lines) {
    const m = TD_RE.exec(String(l.lineNo ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `TD${String(max + 1).padStart(2, '0')}`;
}

/** 새 TD 줄을 COMP.RM 바로 위(없으면 끝)에 넣는다. Process 는 빈 줄. */
export function addLine(input) {
  const line = { uid: newUid('L'), lineNo: nextTdLineNo(input.lines), pipeLine: '', folder: null, modelCount: 1, files: {} };
  const lines = [...input.lines];
  const compIdx = lines.findIndex(isCompRm);
  lines.splice(compIdx >= 0 ? compIdx : lines.length, 0, line);
  return { ...input, lines, process: { ...input.process, [line.uid]: defaultProcessRow(line.lineNo) } };
}

/** COMP.RM 이 없을 때만 끝에 다시 넣는다(기본 Process 값 포함). */
export function addCompRmLine(input) {
  if (input.lines.some(isCompRm)) return input;
  const line = { uid: newUid('L'), lineNo: COMP_RM, pipeLine: 'In Compressor Room', folder: null, modelCount: 1, files: {} };
  return {
    ...input,
    lines: [...input.lines, line],
    process: { ...input.process, [line.uid]: defaultProcessRow(COMP_RM) },
  };
}

export function moveLine(input, uid, delta) {
  const idx = input.lines.findIndex(l => l.uid === uid);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= input.lines.length) return input;
  const lines = [...input.lines];
  [lines[idx], lines[to]] = [lines[to], lines[idx]];
  return { ...input, lines };
}

/** 이 Line 을 지우면 함께 지워질 Manifold 줄 수. */
export const manifoldRowsUsingLine = (input, uid) => input.manifold.filter(m => m.lineUid === uid).length;

/** Line 삭제 = Process 줄과 그 Line 의 Manifold 줄도 함께. */
export function removeLine(input, uid) {
  const { [uid]: _drop, ...process } = input.process;
  return {
    ...input,
    lines: input.lines.filter(l => l.uid !== uid),
    process,
    manifold: input.manifold.filter(m => m.lineUid !== uid),
  };
}

// ── Acceleration Position 삭제 ────────────────────────────────
export const loadsUsingPosition = (input, uid) => input.accelLoads.filter(a => a.positionUid === uid).length;

/** Position 을 지우면 그것을 고른 Load 줄의 Discipline 은 '선택 안 함'으로 비운다(줄은 남김). */
export function removePosition(input, uid) {
  return {
    ...input,
    accelPositions: input.accelPositions.filter(p => p.uid !== uid),
    accelLoads: input.accelLoads.map(a => (a.positionUid === uid ? { ...a, positionUid: '' } : a)),
  };
}

// ── 값 검사와 빈 칸 세기 ──────────────────────────────────────
const REAL_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const blank = (v) => String(v ?? '').trim() === '';
/** 빈 칸은 '숫자 아님'이 아니다(빈 칸은 따로 센다). */
export const isRealOrBlank = (v) => blank(v) || REAL_RE.test(String(v).trim());

export function duplicateLineNos(lines) {
  const seen = new Map();
  lines.forEach(l => {
    const k = String(l.lineNo ?? '').trim().toUpperCase();
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  });
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/** 단계별 { empty, invalid, extra } — 레일 표시용. */
export function stepSummary(input) {
  const countXyz = (rows) => rows.reduce((acc, r) => {
    ['x', 'y', 'z'].forEach(k => {
      if (blank(r[k])) acc.empty += 1;
      else if (!isRealOrBlank(r[k])) acc.invalid += 1;
    });
    return acc;
  }, { empty: 0, invalid: 0 });

  const dup = duplicateLineNos(input.lines);
  const scope = {
    empty: input.lines.reduce((n, l) => n + (blank(l.lineNo) ? 1 : 0) + (blank(l.pipeLine) ? 1 : 0), 0),
    invalid: input.lines.filter(l => dup.has(String(l.lineNo ?? '').trim().toUpperCase())).length,
    noFolder: input.lines.filter(l => !folderReady(l.folder)).length,
  };

  const process = input.lines.reduce((acc, l) => {
    const row = input.process[l.uid] || {};
    PROCESS_FIELDS.forEach(f => {
      if (f.kind === 'select') {
        if (blank(row[f.key])) acc.empty += 1;
        return;
      }
      const c = row[f.key] || {};
      const parts = c.join ? [c.a, c.b] : [c.a];
      parts.forEach(x => {
        if (blank(x)) acc.empty += 1;
        else if (!isRealOrBlank(x)) acc.invalid += 1;
      });
    });
    return acc;
  }, { empty: 0, invalid: 0 });

  const displacement = DISPLACEMENT_ROWS.reduce((acc, r) => {
    const v = input.displacement[r.key];
    if (blank(v)) acc.empty += 1;
    else if (!isRealOrBlank(v)) acc.invalid += 1;
    return acc;
  }, { empty: 0, invalid: 0 });

  const pos = countXyz(input.accelPositions);
  const load = countXyz(input.accelLoads);
  const accel = {
    empty: pos.empty + load.empty
      + input.accelPositions.filter(p => blank(p.discipline)).length
      + input.accelLoads.filter(a => !input.accelPositions.some(p => p.uid === a.positionUid)).length,
    invalid: pos.invalid + load.invalid,
  };

  const lineUids = new Set(input.lines.map(l => l.uid));
  const manifold = {
    empty: input.manifold.reduce((n, m) => n + (lineUids.has(m.lineUid) ? 0 : 1) + (manifoldLoadsFor(m.size) ? 0 : 1), 0),
    invalid: 0,
  };

  const doc = docInfoSummary(input);
  return { scope, process, displacement, accel, manifold, docinfo: { empty: doc.empty, invalid: 0 } };
}

/**
 * 보고서 만들기 직전 검사 — 단계별로 모은다. 반환 [{ step, text, level }].
 *   level 'block' = 고치기 전에는 만들지 않음(Line 없음, Line No. 빈 칸이나 중복, 숫자가 아닌 값, 아직 '고르기'인 파일).
 *   level 'skip'  = 사용자가 승인하면 그 자료를 빼고 만듦(빠진 파일, 결과 폴더 없는 Line, 빈 칸). 보고서 그 자리에 '자료 없음'.
 * '고르기'를 막는 이유: 고르지 않으면 다른 해석본(온도 조건 등)이 조용히 들어갈 수 있다(사용자 결정 2026-11-17).
 * fileCheck = checklistSummary 결과.
 */
export function reportProblems(input, fileCheck, figureCheck = null) {
  const out = [];
  const block = (step, text) => out.push({ step, text, level: 'block' });
  const skip = (step, text) => out.push({ step, text, level: 'skip' });
  const sum = stepSummary(input);
  const list = (arr) => `${arr.slice(0, 4).map(m => `${m.lineNo} ${m.label}`).join(', ')}${arr.length > 4 ? ` 외 ${arr.length - 4}개` : ''}`;

  if (!input.lines.length) block('scope', 'Piping line 이 없습니다. 결과 엑셀을 고르거나 줄을 추가하세요.');
  const noNo = input.lines.filter(l => blank(l.lineNo)).length;
  if (noNo) block('scope', `Line No. 가 빈 줄 ${noNo}개`);
  if (sum.scope.invalid) block('scope', `Line No. 중복 ${sum.scope.invalid}줄`);
  const noPipe = input.lines.filter(l => blank(l.pipeLine)).length;
  if (noPipe) skip('scope', `Pipe Line 이름 빈 칸 ${noPipe}개`);

  if (input.lines.length && fileCheck) {
    // 후보가 여럿인 칸은 공학적 선택(예 -196℃ 판과 -163℃ 판)이라 대신 고르지 않는다 — 무엇을 해야 하는지 문구로 말하고, 화면이 그 Line 을 펼친다
    if (fileCheck.choose.length) {
      out.push({
        step: 'files', level: 'block', kind: 'choose', lineUid: fileCheck.choose[0].uid ?? null,
        text: `파일 후보가 여러 개인 칸 ${fileCheck.choose.length}개를 골라야 합니다: ${list(fileCheck.choose)}`,
      });
    }
    if (fileCheck.noFolder.length) skip('files', `결과 엑셀이 없는 Line: ${fileCheck.noFolder.join(', ')}`);
    if (fileCheck.missing.length) skip('files', `빠진 파일 ${fileCheck.missing.length}개: ${list(fileCheck.missing)}`);
  }
  const doc = docInfoSummary(input);
  if (doc.empty) skip('docinfo', `보고서 정보 빈 칸 ${doc.empty}개: ${doc.labels.slice(0, 4).join(', ')}${doc.labels.length > 4 ? ` 외 ${doc.labels.length - 4}개` : ''}`);
  // figureCheck = { missing: [그림 자리 이름] } (서버가 그림 폴더에서 이름으로 찾은 결과)
  if (figureCheck?.missing?.length) {
    skip('figures', `없는 그림 ${figureCheck.missing.length}개: ${figureCheck.missing.slice(0, 3).join(', ')}${figureCheck.missing.length > 3 ? ` 외 ${figureCheck.missing.length - 3}개` : ''}`);
  }
  [['process', 'Process Condition'], ['displacement', 'Displacement'], ['accel', 'Acceleration'], ['manifold', 'Manifold Load']].forEach(([id, title]) => {
    if (sum[id].invalid) block(id, `${title}: 숫자가 아닌 값 ${sum[id].invalid}칸`);
    if (sum[id].empty) skip(id, `${title}: 빈 칸 ${sum[id].empty}개`);
  });
  return out;
}

// ── 입력 파일(JSON) ───────────────────────────────────────────
// 폴더는 이름과 파일 수만 남는다(브라우저는 경로를 주지 않는다) — 불러오면 stale = 다시 선택 필요.
const folderMeta = (f) => (f ? {
  name: String(f.name ?? ''),
  fileCount: Number(f.fileCount) || 0,
  totalBytes: Number(f.totalBytes) || 0,
  ...(f.target ? { target: String(f.target) } : {}),
} : null);

/** 서버에 다 올라가 쓸 수 있는 폴더인가(다시 선택 필요, 올리기 실패가 아님). */
export const folderReady = (f) => !!(f && f.target && !f.stale && !f.incomplete);

export function serializeInput(input) {
  return JSON.stringify({
    app: 'PSA 평가보고서 자동화 프로그램',
    ...input,
    version: PSA_INPUT_VERSION,
    savedAt: new Date().toISOString(),
    // 재질과 두께는 화면 기본값을 그대로 적어 둔다 — 서버는 이 파일만 읽는다
    lines: input.lines.map(l => ({ ...l, folder: folderMeta(l.folder), material: lineMaterial(l), wallThickness: lineWall(l) })),
    docInfo: { ...defaultDocInfo(), ...(input.docInfo || {}) },
    revisions: (input.revisions || []).map(r => ({ no: str(r.no), date: str(r.date), contents: str(r.contents) })),
    figureFolder: folderMeta(input.figureFolder),
    othersFolder: folderMeta(input.othersFolder),
    sourceFolder: String(input.sourceFolder ?? ''),
    manifold: input.manifold.map(m => ({ ...m, loads: manifoldLoadsFor(m.size) })),
    // 보고서가 그대로 쓰는 표기(단위 포함). 입력이 원본이고 이것은 읽기 편의용이다.
    report: {
      process: input.lines.map(l => ({ lineNo: l.lineNo, ...formatProcessRow(input.process[l.uid]) })),
    },
  }, null, 2);
}

const str = (v) => (v == null ? '' : String(v));
// 불러온 직후에는 '확인 전'(stale). 화면이 서버에 물어 reconcileFolders 로 풀어 준다.
const staleFolder = (f) => (f && f.name ? { ...folderMeta(f), stale: true } : null);

const allBlank = (vals) => vals.every(x => !String(x ?? '').trim());
/** 4판 전 입력: Displacement 가 모두 비었으면 기본값, Acceleration 숫자가 모두 비었으면 기본 표로. 하나라도 적었으면 그대로. */
function fillOldDefaults(version, { displacement, accelPositions, accelLoads }) {
  if (version >= 4) return { displacement, accelPositions, accelLoads };
  const disp = allBlank(Object.values(displacement)) ? { ...DEFAULT_DISPLACEMENT } : displacement;
  const nums = [...accelPositions, ...accelLoads].flatMap(r => [r.x, r.y, r.z]);
  const accel = allBlank(nums) ? defaultAcceleration() : { accelPositions, accelLoads };
  return { displacement: disp, ...accel };
}

/** 저장된 체크리스트 선택 { kind: [경로…] } — 모양이 틀린 것은 버린다. */
function readFiles(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.entries(raw).forEach(([k, v]) => {
    if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'string' ? x : ''));
  });
  return out;
}

const JOIN_SET = new Set(VALUE_JOINS.map(j => j.value));
/** 저장된 숫자 칸 읽기. 1판(글자, 예 '-196°C ~ -18°C', '0.87barg\n~15barg')도 숫자를 뽑아 옮긴다. */
export function readValueCell(raw) {
  if (raw && typeof raw === 'object') {
    const join = JOIN_SET.has(raw.join) ? raw.join : '';
    return { a: str(raw.a), b: join ? str(raw.b) : '', join };
  }
  const text = str(raw);
  const nums = text.match(/[-+]?\d+(?:\.\d+)?/g) || [];
  if (nums.length < 2) return { a: nums[0] ?? '', b: '', join: '' };
  const join = text.includes('~') ? 'range' : text.includes('&') ? 'and' : 'alt';
  return { a: nums[0], b: nums[1], join };
}

/** JSON 글 → 입력 상태. 모양이 틀리면 Error(사용자에게 보일 문구). */
export function parseInputFile(text) {
  if (String(text).startsWith('HHIDRMC')) {
    throw new Error('회사 DRM 으로 암호화된 파일이라 읽을 수 없습니다. 평문 사본으로 다시 불러와 주세요.');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아닙니다. 이 화면에서 저장한 입력 파일인지 확인해 주세요.');
  }
  if (!raw || !Array.isArray(raw.lines)) {
    throw new Error('PSA 입력 파일이 아닙니다(Line 목록이 없음).');
  }
  const lines = raw.lines.map(l => ({
    uid: str(l.uid) || newUid('L'),
    lineNo: str(l.lineNo),
    pipeLine: str(l.pipeLine),
    folder: staleFolder(l.folder),
    modelCount: Number(l.modelCount) >= 1 ? Math.min(8, Math.floor(Number(l.modelCount))) : (str(l.lineNo).trim().toUpperCase() === 'TD06' ? 4 : 1),
    files: readFiles(l.files),
    ...(l.material == null ? {} : { material: str(l.material) }),
    ...(l.wallThickness == null ? {} : { wallThickness: str(l.wallThickness) }),
  }));
  // 6판 전 입력에는 보고서 정보가 없다 → 기본값(날짜, Status 등)만 채우고 나머지는 빈 칸
  const rawInfo = raw.docInfo && typeof raw.docInfo === 'object' ? raw.docInfo : {};
  const docInfo = { ...defaultDocInfo(), ...Object.fromEntries(DOC_INFO_FIELDS.filter(f => rawInfo[f.key] != null).map(f => [f.key, str(rawInfo[f.key])])) };
  const revisions = (Array.isArray(raw.revisions) ? raw.revisions : []).map(r => ({
    uid: newUid('R'), no: str(r.no), date: str(r.date), contents: str(r.contents),
  }));
  const process = {};
  lines.forEach((l, i) => {
    const src = raw.process?.[raw.lines[i]?.uid] || {};
    process[l.uid] = Object.fromEntries(PROCESS_FIELDS.map(f => [
      f.key, f.kind === 'value' ? readValueCell(src[f.key]) : str(src[f.key]).replace(/\s*\n\s*/g, ' ').trim(),
    ]));
  });
  const displacement = Object.fromEntries(DISPLACEMENT_ROWS.map(r => [r.key, str(raw.displacement?.[r.key])]));
  const accelPositions = (Array.isArray(raw.accelPositions) ? raw.accelPositions : []).map(p => ({
    uid: str(p.uid) || newUid('P'), discipline: str(p.discipline), x: str(p.x), y: str(p.y), z: str(p.z),
  }));
  const accelLoads = (Array.isArray(raw.accelLoads) ? raw.accelLoads : []).map(a => ({
    uid: str(a.uid) || newUid('A'), positionUid: str(a.positionUid), loadCondition: str(a.loadCondition),
    lines: str(a.lines), x: str(a.x), y: str(a.y), z: str(a.z),
  }));
  const manifold = (Array.isArray(raw.manifold) ? raw.manifold : []).map(m => ({
    uid: str(m.uid) || newUid('M'), lineUid: str(m.lineUid), size: manifoldLoadsFor(str(m.size)) ? str(m.size) : '',
  }));
  const ws = str(raw.workspace);
  return {
    version: PSA_INPUT_VERSION,
    workspace: WORKSPACE_RE.test(ws) ? ws : null,
    lines,
    figureFolder: staleFolder(raw.figureFolder),
    othersFolder: staleFolder(raw.othersFolder),
    sourceFolder: str(raw.sourceFolder),
    process,
    processNotes: (!str(raw.processNotes).trim() && (Number(raw.version) || 1) < 3) ? DEFAULT_PROCESS_NOTES : str(raw.processNotes),
    ...fillOldDefaults(Number(raw.version) || 1, { displacement, accelPositions, accelLoads }),
    manifold,
    reportExclusions: Array.isArray(raw.reportExclusions) ? raw.reportExclusions.map(str).filter(Boolean) : [],
    docInfo,
    revisions,
  };
}

/** 폴더 선택(webkitdirectory) 결과 FileList → { name, fileCount, totalBytes } */
export function summarizePickedFolder(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return null;
  const first = files[0].webkitRelativePath || files[0].name;
  const name = first.includes('/') ? first.split('/')[0] : first;
  return { name, fileCount: files.length, totalBytes: files.reduce((n, f) => n + (f.size || 0), 0) };
}

// ── 서버 작업 폴더와 업로드 ──────────────────────────────────
// 서버 규칙 사본 = 백엔드 routers/psa_report.py (_WORKSPACE_RE, _TARGET_RE). 한쪽을 고치면 양쪽 다.
export const WORKSPACE_RE = /^\d{8}_\d{6}_[^_\/]+_PsaReport$/;
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,39}$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export const FIGURE_TARGET = 'Figures';

/** Line No. → 서버 폴더 이름. 쓸 수 없으면 null. */
export function serverFolderName(lineNo) {
  const t = String(lineNo ?? '').trim();
  if (!TARGET_RE.test(t) || /[. ]$/.test(t) || RESERVED_RE.test(t)) return null;
  if (['figures', 'others'].includes(t.toLowerCase())) return null; // 그림 폴더, 기타 폴더와 겹침
  return t;
}

/** webkitRelativePath 'Top/a/b.f06' → 'a/b.f06'(고른 폴더 이름은 뺀다). */
export function relativeInsidePicked(file) {
  const p = String(file.webkitRelativePath || file.name || '');
  const parts = p.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
}

/** 업로드 묶음: 파일 수 maxFiles, 합계 maxBytes 를 넘지 않게(큰 파일 하나는 혼자 한 묶음). */
export function planBatches(files, { maxFiles = 50, maxBytes = 100 * 1024 * 1024 } = {}) {
  const batches = [];
  let cur = [];
  let bytes = 0;
  for (const f of files) {
    const size = f.size || 0;
    if (cur.length && (cur.length >= maxFiles || bytes + size > maxBytes)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/**
 * 서버에 남은 대상 폴더와 화면 상태를 맞춘다.
 * targets = { TD01: {fileCount,totalBytes}, … } / null = 작업 폴더가 없어짐(30일 정리 등).
 */
export function reconcileFolders(input, targets) {
  const fix = (f) => {
    if (!f) return f;
    if (!targets || !f.target || !targets[f.target]) return { ...f, stale: true };
    const t = targets[f.target];
    const { stale: _s, incomplete: _i, uploading: _u, ...rest } = f;
    // 고를 때 센 파일 수보다 서버에 적으면 올리다 끊긴 것(앱을 닫았거나 오류).
    if (t.fileCount < (Number(f.fileCount) || 0)) return { ...rest, incomplete: true };
    return { ...rest, fileCount: t.fileCount, totalBytes: t.totalBytes };
  };
  return {
    ...input,
    workspace: targets ? input.workspace : null,
    lines: input.lines.map(l => ({ ...l, folder: fix(l.folder) })),
    figureFolder: fix(input.figureFolder),
    othersFolder: fix(input.othersFolder),
  };
}

// ── 결과 엑셀로 Line 만들기 (2026-11-19 사용자 지시 — 프로젝트 폴더 통째 올리기 폐기) ──
// 엑셀 하나 = Line 하나. 파일 이름으로 Line No. 를 정하고, 사용자가 표에서 고친다.
//   'TD-01.xlsx', 'TD_01 LIQUID.xlsx' → TD01 · 'TD-06_1.xlsx', 'TD-06-1.xlsx' → TD06-1(모델별 Line 을 따로)
//   'Compressor Room.xlsx', 'COMP RM.xlsx' → COMP.RM · 그 밖의 이름 → 파일 이름(서버 폴더로 쓸 수 있게 다듬음)
// 서버는 Line 폴더에 그 엑셀 하나를 올리고, Restraint 와 응력 요약(Code Compliance 또는 Legacy 시트)을 같은 파일에서 읽는다.
const TD_FILE_RE = /^\s*TD[\s._-]*0*(\d{1,3})(?:[\s._-]+0*(\d{1,2}))?(?!\d)\s*[-_.]?\s*(.*)$/i;
const COMP_FOLDER_RE = /^\s*comp(?:ressor)?[\s._-]*(?:room|rm)\b/i;
const DEFAULT_PIPE_LINE = Object.fromEntries(DEFAULT_LINES);

/** CAESAR 같은 프로그램이 남기는 임시 파일(올리지 않음) */
export const isTempFile = (path) => {
  const base = String(path).split('/').pop() || '';
  return base.startsWith('~$') || /\.tmp$/i.test(base);
};

export const isExcelFile = (name) => /\.xlsx$/i.test(String(name ?? '')) && !isTempFile(name);

/** 파일 이름(확장자 포함 가능) → { lineNo, pipeLine } / Line 번호 꼴이 아니면 null */
export function lineFromExcelName(name) {
  const n = String(name ?? '').replace(/\.xlsx$/i, '');
  const td = TD_FILE_RE.exec(n);
  if (td) {
    const base = `TD${td[1].padStart(2, '0')}`;
    const sub = td[2] ? Number(td[2]) : null;
    const rest = td[3].trim();
    let pipeLine = rest || DEFAULT_PIPE_LINE[base] || '';
    // 기본 이름의 'No.1/2/3/4' 는 나눈 모델 번호로(Tank Vent No.1/2/3/4 → Tank Vent No.2)
    if (sub && !rest) pipeLine = pipeLine.replace(/No\.\s*\d+(?:\s*\/\s*\d+)+/i, `No.${sub}`);
    return { lineNo: sub ? `${base}-${sub}` : base, pipeLine };
  }
  if (COMP_FOLDER_RE.test(n)) return { lineNo: COMP_RM, pipeLine: DEFAULT_PIPE_LINE[COMP_RM] };
  return null;
}

/** Line 번호 꼴이 아닌 파일 이름 → 서버 폴더로 쓸 수 있는 Line No.(못 쓰는 글자는 _, 40자) */
function lineNoFromPlainName(name) {
  const t = String(name ?? '').replace(/\.xlsx$/i, '').replace(/[^A-Za-z0-9 ._()-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '').slice(0, 40).replace(/[. ]+$/, '');
  return serverFolderName(t) ? t : '';
}

/** 정렬 열쇠: TD 번호, 나눈 모델 번호. COMP.RM 과 그 밖의 이름은 뒤로. */
function lineSortKey(lineNo) {
  const m = /^TD(\d+)(?:-(\d+))?$/i.exec(String(lineNo ?? '').trim());
  if (m) return [0, Number(m[1]), Number(m[2] || 0)];
  return [String(lineNo).trim().toUpperCase() === COMP_RM ? 2 : 1, 0, 0];
}
const cmpKey = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * 고른 엑셀들 → 계획 { assign: [{ lineUid|null, lineNo, pipeLine, file }], skipped: [이름] }.
 * 같은 Line No. 가 이미 있으면 그 줄의 엑셀을 바꾸고(lineUid), 없으면 새 줄. 같은 번호가 둘이면 뒤 파일에 ' (2)'.
 */
export function planExcelFiles(lines, fileList) {
  const all = Array.from(fileList || []);
  const files = all.filter(f => isExcelFile(f.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { numeric: true }));
  const byNo = new Map(lines.map(l => [String(l.lineNo ?? '').trim().toUpperCase(), l]));
  const used = new Set();
  const assign = [];
  files.forEach((f, i) => {
    const hit = lineFromExcelName(f.name);
    let lineNo = hit?.lineNo || lineNoFromPlainName(f.name) || `Line ${i + 1}`;
    for (let k = 2; used.has(lineNo.toUpperCase()); k += 1) lineNo = `${hit?.lineNo || lineNo.replace(/ \(\d+\)$/, '')} (${k})`;
    used.add(lineNo.toUpperCase());
    const line = byNo.get(lineNo.toUpperCase());
    assign.push({ lineUid: line?.uid ?? null, lineNo, pipeLine: hit?.pipeLine ?? '', file: f });
  });
  return { assign, skipped: all.filter(f => !isExcelFile(f.name)).map(f => f.name) };
}

/** 계획 적용(상태만): 새 Line 은 번호 순 자리에(Process 기본값은 원래 번호 기준), Manifold 기본 줄. lineNo → uid 도 돌려준다. */
export function applyExcelPlan(input, plan) {
  let next = input;
  plan.assign.filter(a => !a.lineUid).forEach(a => {
    const line = { uid: newUid('L'), lineNo: a.lineNo, pipeLine: a.pipeLine, folder: null, modelCount: 1, files: {} };
    const lines = [...next.lines];
    const key = lineSortKey(a.lineNo);
    const at = lines.findIndex(l => cmpKey(lineSortKey(l.lineNo), key) > 0);
    lines.splice(at < 0 ? lines.length : at, 0, line);
    next = { ...next, lines, process: { ...next.process, [line.uid]: defaultProcessRow(a.lineNo) } };
  });
  next = withDefaultManifold(next);
  const uidByNo = Object.fromEntries(next.lines.map(l => [String(l.lineNo).trim().toUpperCase(), l.uid]));
  return { input: next, uidByNo };
}

/** 서버 폴더 이름 — Line No. 그대로, 다른 줄이 이미 쓰면 ' (2)' 를 붙인다. 못 쓰면 null. */
export function uniqueServerFolder(lines, lineUid, lineNo) {
  const t = serverFolderName(lineNo);
  if (!t) return null;
  const taken = new Set(lines.filter(l => l.uid !== lineUid && l.folder?.target).map(l => l.folder.target.toUpperCase()));
  let name = t;
  for (let k = 2; taken.has(name.toUpperCase()); k += 1) name = serverFolderName(`${t.slice(0, 34)} (${k})`) || `L${k}`;
  return name;
}

// ── 보고서에 필요한 파일 체크리스트 ───────────────────────────
// 서버 규칙 원본 = 백엔드 services/psa_report_files.py(파일 판별). 여기는 표시 이름, 필요 항목, 선택 규칙.
// key-in 값은 화면에서 직접 넣고, 아래 항목은 Line 결과 폴더 안의 파일로 들어와야 한다. 하나라도 없으면 보고서를 만들지 않는다.
// 2026-11-19: Line 마다 결과 엑셀 하나 — 보고서 생성기가 쓰는 두 가지만 본다(ISO, Input Echo, 노즐 엑셀은 생성기가 쓰지 않음).
export const CHECKLIST_KINDS = [
  { key: 'restraint', label: 'Restraint Summary', file: "CAESAR II 'Restraint Summary Extended' 시트", report: '6.x 최대 반력, 모멘트, 변위 표' },
  { key: 'codeCompliance', label: 'Stress Summary', file: "'Code Compliance' 또는 'Stress Summary (Legacy)' 시트", report: '6.x Stress summary 표' },
];
const MODEL_KINDS = CHECKLIST_KINDS.filter(k => !k.lineLevel).map(k => k.key);

export const MAX_MODELS = 8;
/** Line 의 해석 모델 수(TD06 Tank Vent 는 No.1~4 모델 4개). */
export const lineModelCount = (line) => Math.min(MAX_MODELS, Math.max(1, Number(line?.modelCount) || 1));
export const modelLabel = (line, i) => (lineModelCount(line) > 1 ? `${line.lineNo}-${i + 1}` : String(line.lineNo ?? ''));
export const kindsForLine = (line) => CHECKLIST_KINDS.filter(k => !k.compOnly || isCompRm(line));

/** 후보에서 자동으로 고를 수 있으면 그 경로(모델이 여럿이면 경로에 NO.k 가 든 하나), 아니면 null. */
export function autoPick(candidates, modelIndex, modelCount, meta) {
  return autoPickInfo(candidates, modelIndex, modelCount, meta).path;
}

/**
 * 가장 최근에 내보낸 후보 — 후보가 모두 **같은 Job(같은 모델을 여러 번 내보낸 것)** 이고 내보낸 날이 있으며 가장 최근이 하나일 때만.
 * Job 이 섞여 있으면 다른 모델일 수 있어 고르지 않는다(3441 COMP.RM 에서 하위 배관 CR08 파일이 '가장 최근'으로 뽑혔다).
 */
function newestExported(candidates, meta) {
  if (!meta || candidates.some(p => !meta[p]?.exportedAt || !meta[p]?.job)) return null;
  if (new Set(candidates.map(p => meta[p].job)).size > 1) return null;
  const sorted = [...candidates].sort((a, b) => String(meta[b].exportedAt).localeCompare(String(meta[a].exportedAt)));
  return sorted.length > 1 && meta[sorted[0]].exportedAt === meta[sorted[1]].exportedAt ? null : sorted[0];
}

/**
 * 자동 선택과 그 이유. reason = only(후보 하나) · model(경로의 NO.k) · newest(가장 최근에 내보냄) · null(고르기 필요)
 * meta = 서버가 준 파일 정보 { 경로: { exportedAt, job, … } }
 */
export function autoPickInfo(candidates, modelIndex, modelCount, meta) {
  if (!candidates?.length) return { path: null, reason: null };
  let pool = candidates;
  if (modelCount > 1) {
    const k = modelIndex + 1;
    const re = new RegExp(`(^|[^a-z0-9])no[.\\s_-]*0*${k}(?![0-9])`, 'i');
    pool = candidates.filter(p => re.test(p));
    if (pool.length === 1) return { path: pool[0], reason: 'model' };
    if (pool.length === 0) return { path: null, reason: null };
  } else if (candidates.length === 1) {
    return { path: candidates[0], reason: 'only' };
  }
  const newest = newestExported(pool, meta);
  return newest ? { path: newest, reason: 'newest' } : { path: null, reason: null };
}

/** 기준 호선 — 최상단 폴더 이름의 앞 4자리 숫자(H3441 도 됨), 없으면 고른 파일들의 Job 호선 중 가장 많은 것. 다른 호선 파일을 알리는 기준. */
export function projectHullOf(input, checklist) {
  const fromFolder = /^\s*H?(\d{4})(?!\d)/i.exec(String(input.sourceFolder ?? ''));
  if (fromFolder) return fromFolder[1];
  const counts = {};
  input.lines.forEach(l => {
    const scan = l.folder?.target ? checklist?.[l.folder.target] : undefined;
    if (!scan) return;
    lineChecklist(l, scan).forEach(r => {
      const h = r.selected && scan.meta?.[r.selected]?.jobHull;
      if (h) counts[h] = (counts[h] || 0) + 1;
    });
  });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best.length && (best.length === 1 || best[0][1] > best[1][1]) ? best[0][0] : null;
}

/**
 * 한 Line 의 체크리스트 줄들.
 * scan = 서버 /checklist 의 targets[폴더] ({ kinds, unreadable }) 또는 undefined(폴더 없음).
 * 반환 [{ kind, model, label, candidates, selected, status: ok | choose | missing }]
 */
export function lineChecklist(line, scan, projectHull = null) {
  const count = lineModelCount(line);
  const meta = scan?.meta || {};
  const rows = [];
  kindsForLine(line).forEach(k => {
    const slots = k.lineLevel ? 1 : count;
    for (let i = 0; i < slots; i += 1) {
      const candidates = scan?.kinds?.[k.key] || [];
      const chosen = line.files?.[k.key]?.[i];
      const auto = autoPickInfo(candidates, i, k.lineLevel ? 1 : count, meta);
      const keep = chosen && candidates.includes(chosen);
      const selected = keep ? chosen : auto.path;
      const reason = keep && chosen !== auto.path ? 'chosen' : (selected ? auto.reason : null);
      const warnings = [];
      const m = selected ? meta[selected] : null;
      if (m?.jobHull && projectHull && m.jobHull !== projectHull) {
        warnings.push(`Job 호선 ${m.jobHull} (다른 파일은 ${projectHull})`);
      }
      rows.push({
        kind: k.key,
        model: i,
        label: k.lineLevel ? k.label : `${k.label}${count > 1 ? ` (${modelLabel(line, i)})` : ''}`,
        candidates,
        selected,
        reason,
        meta: m,
        warnings,
        status: selected ? 'ok' : candidates.length ? 'choose' : 'missing',
      });
    }
  });
  // 같은 모델의 Restraint 와 Code Compliance 가 서로 다른 해석본(Job 이름)인지
  for (let i = 0; i < count; i += 1) {
    const r = rows.find(x => x.kind === 'restraint' && x.model === i);
    const c = rows.find(x => x.kind === 'codeCompliance' && x.model === i);
    if (r?.meta?.job && c?.meta?.job && r.meta.job !== c.meta.job) {
      c.warnings.push('Restraint 와 Job 이 다름(다른 해석본일 수 있음)');
    }
  }
  return rows;
}

/** 전체 요약 { ready, missing: [{lineNo, label}], choose: [...], noFolder: [lineNo] }. checklist 가 없으면(서버 확인 전) ready = false. */
export function checklistSummary(input, checklist) {
  const missing = [];
  const choose = [];
  const noFolder = [];
  const warnings = [];
  const projectHull = projectHullOf(input, checklist);
  input.lines.forEach(l => {
    const scan = l.folder?.target ? checklist?.[l.folder.target] : undefined;
    if (!folderReady(l.folder) || !scan) noFolder.push(l.lineNo);
    lineChecklist(l, folderReady(l.folder) ? scan : undefined, projectHull).forEach(r => {
      if (r.status === 'missing') missing.push({ lineNo: l.lineNo, label: r.label });
      if (r.status === 'choose') choose.push({ lineNo: l.lineNo, label: r.label, uid: l.uid, kind: r.kind, model: r.model });
      r.warnings.forEach(w => warnings.push({ lineNo: l.lineNo, label: r.label, text: w }));
    });
  });
  // 경고는 실행을 막지 않는다(사용자가 알고 고른 경우가 있다)
  return { ready: !!checklist && input.lines.length > 0 && !missing.length && !choose.length && !noFolder.length, missing, choose, noFolder, warnings, projectHull };
}

/**
 * Line 하나의 파일 확인 상태 — 화면이 '없음'과 '아직 모름'을 구별하려고 쓴다.
 * uploading = 올리는 중 · waiting = 최상단 폴더를 올리는 동안 차례 기다림 · checking = 서버가 파일을 찾는 중(또는 찾기 전)
 * error = 확인 실패 · lost = 확인은 끝났는데 서버에 그 폴더가 없음 · noFolder = 결과 폴더 없음
 * ready = 확인 끝(있음/없음/고르기를 믿어도 됨). pending = 마지막 확인 뒤 폴더가 바뀌어 아직 다시 확인하지 않음.
 */
export function lineCheckState(line, checklist, { loading = false, topBusy = false, error = '', pending = false } = {}) {
  const f = line.folder;
  if (f?.uploading) return 'uploading';
  if (!f && topBusy) return 'waiting';
  if (!folderReady(f)) return 'noFolder';
  if (checklist?.[f.target] && !pending) return 'ready';
  if (loading || pending) return 'checking';
  if (error) return 'error';
  // 확인이 끝났는데도 서버 결과에 없으면 '찾는 중'에 영영 머물지 않게 따로 알린다
  return checklist?.[f.target] ? 'ready' : 'lost';
}

export const CHECK_BUSY_STATES = ['uploading', 'waiting', 'checking'];

/** 올리기나 파일 찾기가 아직 끝나지 않았나 — 끝나기 전의 '없음'은 판정이 아니다. */
export function checklistBusy(input, checklist, flags = {}) {
  if (flags.topBusy || flags.loading) return true;
  return input.lines.some(l => CHECK_BUSY_STATES.includes(lineCheckState(l, checklist, flags)));
}

/** 자동으로 정해지는 선택을 입력값(line.files)에 적는다 — 저장된 JSON 만으로 보고서가 어떤 파일을 쓸지 알 수 있게. */
export function applyChecklistSelections(input, checklist) {
  let changed = false;
  const lines = input.lines.map(l => {
    const scan = l.folder?.target ? checklist?.[l.folder.target] : undefined;
    if (!scan) return l;
    const files = {};
    lineChecklist(l, scan).forEach(r => {
      if (!files[r.kind]) files[r.kind] = [];
      files[r.kind][r.model] = r.selected || '';
    });
    if (JSON.stringify(files) === JSON.stringify(l.files || {})) return l;
    changed = true;
    return { ...l, files };
  });
  return changed ? { ...input, lines } : input;
}

/** 사용자가 후보 중 하나를 고름 */
export function chooseChecklistFile(input, lineUid, kind, model, path) {
  return {
    ...input,
    lines: input.lines.map(l => {
      if (l.uid !== lineUid) return l;
      const arr = [...(l.files?.[kind] || [])];
      arr[model] = path;
      return { ...l, files: { ...(l.files || {}), [kind]: arr } };
    }),
  };
}

export const MODEL_CHECKLIST_KINDS = MODEL_KINDS;


// ── 검토 결과(지금 입력으로 서버가 만든 채운 자리 기록, POST /review) ─────────
// 기록 원본 = 백엔드 psa_report_review.Trace(검토용 docx 의 색, 점검표와 같은 내용).
// 색은 서버 기록의 kinds 가 원본이고, 아래는 옛 서버(kinds 없음)용 예비값이다.
export const REVIEW_KINDS = {
  input: { label: '입력값', chip: 'bg-[#DCE9F8] text-slate-900' },
  calc: { label: '원본 파일 계산', chip: 'bg-[#DDF2DD] text-slate-900' },
  figure: { label: '올린 그림', chip: 'bg-[#E9E1F5] text-slate-900' },
  missing: { label: '자료 없음', chip: 'bg-[#FBD9B5] text-slate-900' },
};

/** 아직 고르지 않은 파일 칸 → 서버로 보낼 [{lineNo, kind, model}] (검토에서 '자료 없음' 이유로 적는다) */
export function pendingChoices(fileCheck) {
  return (fileCheck?.choose || [])
    .filter(c => c.kind)
    .map(c => ({ lineNo: c.lineNo, kind: c.kind, model: c.model || 0 }));
}

/** 검토(웹 창, 검토용 Word)를 막는 항목 — 최종 보고서와 같되 '고르기'는 막지 않는다(검토에서 자료 없음으로 보임). */
export function reviewBlocks(problems) {
  return (problems || []).filter(p => p.level === 'block' && p.kind !== 'choose');
}

/** 기록의 위치 글 → 보고서 묶음 이름(장 단위). 6장은 Line 까지. */
export function reviewGroupOf(where) {
  const w = String(where || '');
  if (/^(표지|Revision|호선 문장|결론 문장)/.test(w)) return '표지와 초록';
  if (/^(2\.|Table 2\.|Figure 2\.|1장, 2\.2)/.test(w)) return '2장 Design conditions'; // '1장, 2.2 …' 는 2장 쪽에 둔다
  if (/^(1장|Table 1\.|Figure 1\.)/.test(w)) return '1장 Introduction';
  const m = /^6장 (?:Table 6\.\d+ \S+ \S+ \(([^)]+)\)|Figure 6\.\d+ Piping model for (\S+)|(\S+) ›)/.exec(w);
  if (m) {
    const name = (m[1] || m[2] || m[3] || '').replace(/-\d+$/, '').replace(/^Compressor Room$/, 'COMP.RM');
    return `6장 ${name}`;
  }
  if (w.startsWith('6장')) return '6장 Stress analysis';
  if (w.startsWith('7장')) return '7장 Nozzle load';
  if (w.startsWith('부록')) return '부록';
  return '기타';
}

/** 필요한 자료 글 → 그 자료를 넣는 화면 단계(id). 못 정하면 null. */
export function reviewStepOf(need) {
  const n = String(need || '');
  if (/보고서 정보/.test(n)) return 'docinfo';
  if (/그림 폴더|그림 2개|노즐 하중 표/.test(n)) return 'figures';
  if (/Code Compliance|Restraint|CAESAR/.test(n)) return 'files';
  if (/Process Condition/.test(n)) return 'process';
  if (/Displacement/.test(n)) return 'displacement';
  if (/Acceleration/.test(n)) return 'accel';
  if (/Manifold/.test(n)) return 'manifold';
  if (/Scope|재질|두께/.test(n)) return /재질|두께/.test(n) ? 'docinfo' : 'scope';
  return null;
}

/** 기록 → { missing: [...], groups: [{ name, items, missing }] } — 묶음은 보고서 순서. */
export function summarizeReview(review) {
  const items = Array.isArray(review?.items) ? review.items : [];
  const order = [];
  const byName = new Map();
  items.forEach(it => {
    const name = reviewGroupOf(it.where);
    if (!byName.has(name)) { byName.set(name, []); order.push(name); }
    byName.get(name).push(it);
  });
  const rank = (name) => {
    const list = ['표지와 초록', '1장', '2장', '6장', '7장', '부록', '기타'];
    const i = list.findIndex(k => name.startsWith(k));
    return i < 0 ? list.length : i;
  };
  const groups = order
    .map((name, i) => ({ name, i, items: byName.get(name) }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.i - b.i)
    .map(({ name, items: list }) => ({ name, items: list, missing: list.filter(x => x.kind === 'missing').length }));
  return { missing: items.filter(x => x.kind === 'missing'), groups };
}
