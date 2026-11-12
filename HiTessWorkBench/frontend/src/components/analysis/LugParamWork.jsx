/**
 * 표준집 러그 치수 작업 — 미리 변환한 치수로 형상을 보여 주고, 치수와 하중을 고친 뒤 해석한다.
 *
 * 2026-11-12 통합(사용자 결정): 예전에는 도면 찾기 모달 안에서 형상과 하중을 고치고(LugParamEditor), 결과는 본창에서 봤다.
 * 이제 모달은 도면 고르기만 하고, 이 파일의 상태 훅과 부품을 Drawing to Analysis 본창이 쓴다
 *   ① 도면 → ② 치수 → ③ 하중 및 경계 → ④ 결과, 가운데 3D 는 [형상 | 해석 결과] 전환.
 * 계획 docs/plans/2026-11-12-lug-param-catalogue-plan.md. 형상 계산은 서버(엔진 모듈 import, 수십 ms).
 * 하중 검사와 화살표는 결과 화면 '하중 값 고치기'(utils/lugshellEdits.js)와 같은 규칙을 쓴다.
 * 칸에 마우스를 올리거나 누르면 3D 에서 그 치수(케이스)를 강조한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { getDrawingBookParams, buildLugGeometry } from '../../api/analysis';
import { LOAD_COLORS, boundaryLines, changedFields, designLoadSummary, parseFieldValue } from '../../utils/lugGeometry';
import { LUGSHELL_EDIT_LIMITS, lugshellLoadArrows, validateLugshellForm } from '../../utils/lugshellEdits';
import LugGeometryView from './LugGeometryView';

const errText = (err) => {
  const d = err?.response?.data?.detail;
  // FastAPI 는 없는 경로에 detail 'Not Found' 를 붙인다 → 서버가 새 경로를 모름(재시작·업데이트 필요)
  if (err?.response?.status === 404 && (!d || d === 'Not Found')) return '서버가 아직 치수 편집을 모릅니다. 백엔드를 다시 시작하거나 서버를 업데이트해 주세요.';
  return typeof d === 'string' ? d : (err?.message || '요청 실패');
};

// ③ 하중 및 경계 단계로 옮겨 보이는 칸 (나머지는 ② 치수)
const isLoadField = (f) => f.kind === 'load' || f.kind === 'factor' || f.name === 'pin_d';
const MAX_CASES = 8;          // 백엔드 drawing_to_analysis_service.MAX_LOAD_CASES 와 같게
const MESH_LIMITS = [2, 50];  // 백엔드 LugParamsRunRequest.mesh_size 와 같게
// p_kn 빈 글자 = 안전하중 × g × DAF (케이스마다 크기를 따로 넣으면 그 값)
const caseRows = (design) => (design?.load_cases || []).map((c) => ({ id: c.id, alpha_deg: String(c.alpha_deg), beta_deg: String(c.beta_deg), p_kn: '' }));
const asText = (vals) => Object.fromEntries(Object.entries(vals || {}).map(([k, v]) => [k, String(v)]));

/**
 * 치수 작업 상태. item = 표준집 항목(없으면 쉼), initial = 페이지에 저장해 둔 { pdfPage, values, cases, meshSize }
 * (같은 도면이면 고치던 값을 되살린다), onPersist = 바뀔 때마다 그 값을 페이지 저장소로.
 */
export function useLugParamWork({ item, initial = null, onPersist = null }) {
  const [base, setBase] = useState(null);         // 서버 응답(표준집 치수, 칸, 형상)
  const [values, setValues] = useState({});       // 칸에 보이는 글자
  const [design, setDesign] = useState(null);
  const [mass, setMass] = useState(null);
  const [error, setError] = useState('');         // 불러오기 실패
  const [shapeError, setShapeError] = useState(''); // 치수 모순
  const [busy, setBusy] = useState(false);
  const [marks, setMarks] = useState({});         // 치수 칸 이름 → { plates, lines } (옛 서버면 빈 값)
  const [focusField, setFocusField] = useState(null);
  const [hoverField, setHoverField] = useState(null); // 마우스를 올린 칸 — 누른 칸보다 먼저 보인다
  const [cases, setCases] = useState([]);         // [{id, alpha_deg, beta_deg, p_kn}] 글자
  const [focusCase, setFocusCase] = useState(null);
  const [hoverCase, setHoverCase] = useState(null);
  const [meshSize, setMeshSize] = useState('10');
  const seq = useRef(0);
  const newCaseNo = useRef(0);
  const initialRef = useRef(initial);
  const pdfPage = item?.pdfPage ?? null;

  useEffect(() => {
    if (pdfPage == null) { setBase(null); return undefined; }
    let cancelled = false;
    setBase(null);
    setError('');
    getDrawingBookParams(pdfPage)
      .then((r) => {
        if (cancelled) return;
        const saved = initialRef.current?.pdfPage === pdfPage ? initialRef.current : null;
        setBase(r.data);
        setValues(saved?.values || asText(r.data.values));
        setDesign(r.data.design);
        setMass(r.data.mass_kg);
        setMarks(r.data.marks || {});
        const restored = saved?.cases || caseRows(r.data.design);
        setCases(restored);
        // 새 케이스 번호는 남은 것 중 가장 큰 번호 다음 — 개수로 세면 중간을 지운 뒤 번호가 겹친다
        newCaseNo.current = restored.reduce((m, c) => Math.max(m, Number(/^LC_NEW(\d+)$/.exec(String(c.id))?.[1] || 0)), 0);
        setMeshSize(saved?.meshSize || String(r.data.design?.analysis?.mesh_size ?? 10));
      })
      .catch((e) => { if (!cancelled) setError(errText(e)); });
    return () => { cancelled = true; };
  }, [pdfPage]);

  useEffect(() => {
    if (base && pdfPage != null) onPersist?.({ pdfPage, values, cases, meshSize });
  }, [base, pdfPage, values, cases, meshSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => {
    if (!base) return {};
    const out = {};
    for (const f of base.fields) {
      if (values[f.name] === undefined) continue;
      out[f.name] = parseFieldValue(f, values[f.name]);
    }
    return out;
  }, [base, values]);
  const changed = useMemo(() => (base ? changedFields(base.values, parsed) : []), [base, parsed]);

  // 치수를 고치면 잠깐 기다렸다가 형상만 다시 만든다 (입력 중 매 글자마다 묻지 않게)
  useEffect(() => {
    if (!base) return undefined;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      buildLugGeometry(base.form, parsed, base.code)
        .then((r) => {
          if (my !== seq.current) return;
          setDesign(r.data.design);
          setMass(r.data.mass_kg);
          setMarks(r.data.marks || {});
          setShapeError('');
        })
        .catch((e) => { if (my === seq.current) setShapeError(errText(e)); })
        .finally(() => { if (my === seq.current) setBusy(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [base, parsed]);

  const resetValues = () => base && setValues(asText(base.values));

  const loadSummary = useMemo(() => designLoadSummary(design), [design]);
  const loadForm = useMemo(() => ({
    swl_t: values.swl_t ?? '',
    daf: values.daf || '1',
    pin_d: values.pin_d || String(loadSummary.pin_d ?? ''),
    cases,
  }), [values, cases, loadSummary.pin_d]);
  const holeD = Number(parsed.hole_d);
  const loadErrors = useMemo(() => {
    const e = validateLugshellForm(loadForm, holeD);
    for (const c of cases) {
      const b = Number(c.beta_deg);
      if (Number.isFinite(b) && Math.abs(b) >= 90) e[`${c.id}.beta_deg`] = 'β 는 ±90 미만';
    }
    const m = Number(meshSize);
    if (!(m >= MESH_LIMITS[0] && m <= MESH_LIMITS[1])) e.mesh = `${MESH_LIMITS[0]}~${MESH_LIMITS[1]} mm`;
    if (!cases.length) e.cases = '케이스가 하나는 있어야 합니다';
    return e;
  }, [loadForm, holeD, cases, meshSize]);
  const arrows = useMemo(() => lugshellLoadArrows(loadSummary, loadForm)
    .map((a) => ({ ...a, color: LOAD_COLORS[a.index % LOAD_COLORS.length] })), [loadSummary, loadForm]);
  const fixedLines = useMemo(() => (design ? boundaryLines(design).map((b) => b.line) : null), [design]);
  const fixedCount = useMemo(() => new Set((design?.boundary || []).map((b) => b.plate)).size, [design]);
  const casesChanged = JSON.stringify(cases) !== JSON.stringify(caseRows(base?.design));
  const g = Number(loadSummary.g) || 9.81;
  const pKN = Number(values.swl_t) * g * Number(values.daf || 1);   // 크기를 비워 둔 케이스가 쓰는 값
  const pKNText = Number.isFinite(pKN) && pKN > 0 ? pKN.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '';

  // 서버로 보낼 값. 케이스를 안 바꿨으면 cases 를 보내지 않는다(서버가 형식 기본 케이스를 그대로 씀)
  const payload = useMemo(() => ({
    values: parsed,
    meshSize: Number(meshSize),
    cases: casesChanged ? cases.map((c) => ({
      id: c.id, alpha_deg: Number(c.alpha_deg), beta_deg: Number(c.beta_deg),
      ...(String(c.p_kn).trim() !== '' ? { p_kn: Number(c.p_kn) } : {}),
    })) : null,
  }), [parsed, meshSize, casesChanged, cases]);
  const signature = useMemo(() => JSON.stringify(payload), [payload]);

  return {
    item, base, values, setValues, parsed, changed, design, mass, error, shapeError, busy, marks,
    focusField, setFocusField, hoverField, setHoverField, shownField: hoverField ?? focusField,
    cases, setCases, focusCase, setFocusCase, hoverCase, setHoverCase, shownCase: hoverCase ?? focusCase,
    meshSize, setMeshSize, resetValues,
    loadSummary, loadErrors, loadsOk: Object.keys(loadErrors).length === 0, arrows, fixedLines, fixedCount,
    casesChanged, pKNText, payload, signature, newCaseNo,
    ready: Boolean(base) && !busy && !shapeError,
  };
}

const inputCls = 'h-7 px-1.5 rounded border text-right font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-[#002554]/15';

function FieldRow({ work, f, showLoadErrors = false }) {
  const { values, setValues, changed, marks, shownField, setFocusField, setHoverField, loadErrors } = work;
  const isChanged = changed.includes(f.name);
  const err = showLoadErrors ? loadErrors[f.name] : null;
  return (
    <tr className={`align-middle ${shownField === f.name && marks[f.name] ? 'bg-orange-50' : ''}`}
      onMouseEnter={() => setHoverField(f.name)} onMouseLeave={() => setHoverField((cur) => (cur === f.name ? null : cur))}>
      <td className="py-1 pr-2 text-slate-600 leading-tight">
        {f.label}
        {err && <span className="block text-[11px] text-rose-700">{err}</span>}
      </td>
      <td className="py-1 w-28">
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode={f.kind === 'text' ? 'text' : 'decimal'}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
            onFocus={() => setFocusField(f.name)}
            onBlur={() => setFocusField((cur) => (cur === f.name ? null : cur))}
            aria-label={f.label}
            placeholder={f.optional ? '없음' : ''}
            className={`w-full ${inputCls} ${err ? 'border-rose-400 bg-rose-50' : isChanged ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-white'}`}
          />
          <span className="w-4 text-[11px] text-slate-500">{f.unit}</span>
        </div>
      </td>
    </tr>
  );
}

/** ② 치수 — 형상 치수 표. 칸에 마우스를 올리면 3D 에서 그 치수를 보여 준다. */
export function LugShapeFields({ work }) {
  const { base, mass, changed, resetValues } = work;
  if (!base) return null;
  const review = base.review || [];
  return (
    <div className="text-[12px]">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-slate-500">칸에 마우스를 올리면 3D 에서 그 치수를 보여 줍니다</span>
        {mass != null && <span className="text-slate-600 shrink-0">질량 {mass.toFixed(1)} kg</span>}
      </div>
      <table className="w-full">
        <tbody>{base.fields.filter((f) => !isLoadField(f)).map((f) => <FieldRow key={f.name} work={work} f={f} />)}</tbody>
      </table>
      {changed.length > 0 && (
        <p className="mt-2 text-amber-800">
          표준집 값과 다른 값 {changed.length}개. 결과의 확인 항목에 남습니다.
          <button type="button" onClick={resetValues} className="ml-2 inline-flex items-center gap-0.5 text-slate-600 hover:text-[#002554]">
            <RotateCcw size={11} /> 표준집 값으로
          </button>
        </p>
      )}
      {review.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-700">도면에서 읽을 때 남은 확인 항목 {review.length}</summary>
          <ul className="mt-1 space-y-1 text-slate-600 leading-snug">
            {review.map((r, i) => <li key={i}>{r.note}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** ③ 하중 및 경계 — 안전하중, DAF, 핀 지름, 케이스(각도, 크기 kN), 경계 표시, 메시 크기 */
export function LugLoadsForm({ work }) {
  const {
    base, cases, setCases, loadErrors, shownCase, setFocusCase, setHoverCase, casesChanged, pKNText,
    fixedCount, meshSize, setMeshSize, newCaseNo,
  } = work;
  if (!base) return null;
  const [aLo, aHi] = LUGSHELL_EDIT_LIMITS.alpha_deg;
  const setCase = (id, key, v) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, [key]: v } : c)));
  const addCase = () => {
    newCaseNo.current += 1;
    setCases((cs) => [...cs, { id: `LC_NEW${newCaseNo.current}`, alpha_deg: '0', beta_deg: '0', p_kn: '' }]);
  };
  const caseInput = (c, key, label, extra = {}) => (
    <input
      type="text" inputMode="decimal" value={c[key]} aria-label={label} {...extra}
      onChange={(e) => setCase(c.id, key, e.target.value)}
      onFocus={() => setFocusCase(c.id)}
      onBlur={() => setFocusCase((cur) => (cur === c.id ? null : cur))}
      className={`${key === 'p_kn' ? 'w-[4.5rem]' : 'w-12'} ${inputCls}
        ${loadErrors[`${c.id}.${key}`] ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'}`}
    />
  );
  return (
    <div className="space-y-4 text-[12px]">
      <section>
        <h3 className="font-semibold text-slate-800 mb-1">하중</h3>
        <table className="w-full"><tbody>{base.fields.filter(isLoadField).map((f) => <FieldRow key={f.name} work={work} f={f} showLoadErrors />)}</tbody></table>
        {pKNText && (
          <p className="mt-1 text-slate-500">기본 핀 하중 {pKNText} kN (안전하중 × g × DAF). 케이스마다 '크기' 칸에 따로 넣을 수 있습니다.</p>
        )}
      </section>
      <section>
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-semibold text-slate-800">하중 케이스</h3>
          <span className="text-[11px] text-slate-500">α 판 면 안 {aLo}~{aHi}°, β 판 면 밖</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[11px] text-slate-500">
              <th className="text-left font-normal">케이스</th>
              <th className="font-normal">α °</th>
              <th className="font-normal">β °</th>
              <th className="font-normal">크기 kN</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c, i) => {
              const errs = [loadErrors[`${c.id}.alpha_deg`], loadErrors[`${c.id}.beta_deg`], loadErrors[`${c.id}.p_kn`]].filter(Boolean);
              return (
                <tr key={c.id} className={`align-middle ${shownCase === c.id ? 'bg-slate-50' : ''}`}
                  onMouseEnter={() => setHoverCase(c.id)} onMouseLeave={() => setHoverCase((cur) => (cur === c.id ? null : cur))}>
                  <td className="py-1 pr-1 whitespace-nowrap">
                    <span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ background: LOAD_COLORS[i % LOAD_COLORS.length] }} />
                    LC{i + 1}
                    {c.id.startsWith('LC_NEW') && <span className="ml-1 text-[11px] text-amber-700">새</span>}
                    {errs.length > 0 && <span className="block text-[11px] text-rose-700 whitespace-normal">{errs.join(', ')}</span>}
                  </td>
                  <td className="py-1 text-center">{caseInput(c, 'alpha_deg', `LC${i + 1} α`)}</td>
                  <td className="py-1 text-center">{caseInput(c, 'beta_deg', `LC${i + 1} β`)}</td>
                  <td className="py-1 text-center">{caseInput(c, 'p_kn', `LC${i + 1} 하중 크기 kN`, { placeholder: pKNText, title: '비우면 안전하중 × g × DAF' })}</td>
                  <td className="py-1 text-right">
                    <button type="button" onClick={() => setCases((cs) => cs.filter((x) => x.id !== c.id))} disabled={cases.length <= 1}
                      title="이 케이스 빼기" aria-label={`LC${i + 1} 빼기`} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={addCase} disabled={cases.length >= MAX_CASES}
            className="inline-flex items-center gap-1 text-slate-700 hover:text-[#002554] disabled:opacity-40">
            <Plus size={12} /> 케이스 더하기
          </button>
          {casesChanged && (
            <button type="button" onClick={() => setCases(caseRows(base.design))}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-[#002554]">
              <RotateCcw size={11} /> 기본 케이스로
            </button>
          )}
        </div>
        {loadErrors.cases && <p className="mt-1 text-[11px] text-rose-700">{loadErrors.cases}</p>}
        <p className="mt-1 text-[11px] text-slate-500">기본 각도는 엔진이 정한 임시값입니다. 도면의 사용 조건에 맞게 확인해 주세요.</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-800 mb-1">경계</h3>
        <p className="text-slate-600">바닥(높이 0)에 닿는 판 {fixedCount}장 고정</p>
      </section>
      <section>
        <h3 className="font-semibold text-slate-800 mb-1">메시</h3>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600">
            요소 크기
            {loadErrors.mesh && <span className="block text-[11px] text-rose-700">{loadErrors.mesh}</span>}
          </span>
          <div className="flex items-center gap-1">
            <input type="text" inputMode="decimal" value={meshSize} onChange={(e) => setMeshSize(e.target.value)} aria-label="메시 요소 크기"
              className={`w-20 ${inputCls} ${loadErrors.mesh ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white'}`} />
            <span className="w-4 text-[11px] text-slate-500">mm</span>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">핀 구멍 둘레는 엔진이 더 잘게 나눕니다. 메시는 해석 실행 때 만듭니다.</p>
      </section>
    </div>
  );
}

/** 가운데 3D — 형상(메시 아님). showLoads 면 하중 화살표와 바닥 고정을 함께 그린다. */
export function LugWorkView({ work, showLoads }) {
  const { item, base, error, design, marks, shownField, shownCase, arrows, fixedLines, loadSummary, busy, shapeError } = work;
  const loads3d = useMemo(() => (showLoads ? { center: loadSummary.pin_center, arrows, focusId: shownCase } : null),
    [showLoads, loadSummary.pin_center, arrows, shownCase]);
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
        <AlertCircle size={22} className="text-rose-600" />
        <p className="text-[13px] text-rose-800">{error}</p>
      </div>
    );
  }
  if (!base) return <div className="h-full flex items-center justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>;
  return (
    <div className="h-full relative">
      <LugGeometryView design={design} fitKey={item?.pdfPage} mark={shownField ? marks[shownField] : null}
        loads={loads3d} fixedLines={showLoads ? fixedLines : null} />
      {shownField && marks[shownField] && (
        <div className="absolute right-3 bottom-3 rounded-md bg-white/90 px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm">
          <span className="inline-block w-3 h-0.5 bg-[#e8590c] align-middle mr-1.5" />
          {base.fields.find((f) => f.name === shownField)?.label}
        </div>
      )}
      {showLoads && (
        <ul className="absolute right-3 top-3 rounded-md bg-white/90 px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm space-y-0.5">
          {arrows.map((a) => (
            <li key={a.id} className={!shownCase || shownCase === a.id ? '' : 'opacity-40'}>
              <span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ background: a.color }} />
              {a.tag} · {a.kN}
            </li>
          ))}
          <li><span className="inline-block w-3 h-0.5 bg-red-600 align-middle mr-1.5" />고정 (바닥)</li>
        </ul>
      )}
      {(busy || shapeError) && (
        <div className={`absolute left-3 top-3 max-w-[70%] rounded-md px-2.5 py-1.5 text-[12px] shadow-sm
          ${shapeError ? 'bg-rose-50 border border-rose-200 text-rose-800' : 'bg-white/90 text-slate-600'}`}>
          {shapeError ? `${shapeError} 3D 는 마지막으로 맞았던 형상입니다.` : '형상 다시 그리는 중...'}
        </div>
      )}
    </div>
  );
}
