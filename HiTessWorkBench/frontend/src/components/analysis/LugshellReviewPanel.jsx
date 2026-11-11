/**
 * LugshellReviewPanel — 새 러그 엔진(LugShell) 결과: 도면에서 읽은 값 + 해석 하중(그 자리에서 고침) + 실행.
 *
 * 엔진은 값마다 도면 글자·기하·주석을 대조해 상태를 붙인다(엔진 문서 lugshell/docs/extraction.md):
 *   mismatch      글자 ≠ 도면 기하 (도면을 복사해 숫자만 고친 경우 등) → 가장 먼저 확인
 *   missing       도면에 없음 → 임시값 사용 (DAF·하중 각도·핀 지름·경계 D6)
 *   single_source 출처가 하나 (재질·안전하중 등)
 *   user_fixed    사용자가 이 화면에서 고친 값
 * 자동 통과(auto_ok) 항목은 review[] 에 없다. 수계산 판정 기준은 아직 임시(D4)라 UC 는 참고값이다.
 *
 * 화면 규칙(2026-11-11 사용자 지적 '고치는 곳을 찾기 어렵다·AI 느낌'):
 *   - 확인 항목과 입력칸을 한 줄에 둔다 — 'DAF 임시값'을 읽은 그 자리에서 고친다.
 *   - 상태는 알약 배지 대신 값 옆의 짧은 글자. 색은 임시값(주황)·도면과 다름(빨강)에만.
 *   - 주 버튼은 하나: 고친 값이 있으면 [고친 값으로 다시 만들기], 없으면 [이 하중으로 해석].
 *     고친 값이 반영되기 전에는 해석을 막는다(옛 하중으로 해석하는 실수 방지).
 */
import { useEffect, useMemo, useState } from 'react';
import { diffLugshellEdits, initialLugshellForm, validateLugshellForm } from '../../utils/lugshellEdits';

// 엔진 추적 이름 → 화면 이름 (입력칸으로 보이지 않는 나머지 확인 항목용)
const NAME = {
  scale: '축척', height: '높이', lap_length: 'lap 길이', lap_to_pin: 'lap 선 → 핀 중심', lap_to_corner: 'lap 선 → 모서리',
  arc_R: '원호 R', hole_d: '핀 구멍', main_t: '판 두께', material: '재질', swl_t: '안전하중', daf: 'DAF',
  load_angles: '하중 방향', boundary: '경계조건', pin_d: '핀 지름', outline_shape: '외곽 형상',
  self_weight: '자중', lap_line: 'lap 선', pin_center_u: '핀 중심 위치',
};
// 입력칸이나 고정 줄에서 따로 보여 주는 항목 — '그 밖에 확인할 것'에서 뺀다
const SHOWN_INLINE = new Set(['swl_t', 'daf', 'pin_d', 'load_angles', 'boundary', 'material']);

// 상태 → 값 옆 짧은 글자. 색은 사람이 손봐야 하는 것(임시값·다름)에만.
const STATE = {
  mismatch: { text: '도면과 다름', cls: 'text-rose-700 font-semibold' },
  missing: { text: '임시값', cls: 'text-amber-700 font-semibold' },
  single_source: { text: '도면 1곳', cls: 'text-slate-500' },
  user_fixed: { text: '고친 값', cls: 'text-slate-700 font-semibold' },
};

// 하중 케이스 id → 읽기 쉬운 이름 (모르는 id 는 그대로)
const CASE_NAME = { LC1_axial: '축방향', LC2_inplane_30: '면내 기울어짐', LC3_outplane_5: '면외 기울어짐' };

function parseNote(note = '') {
  const i = note.indexOf(':');
  if (i < 0) return { key: '', why: note };
  return { key: note.slice(0, i).trim(), why: note.slice(i + 1).trim() };
}

const fmt = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${v}${unit}`);

function Section({ title, aside, children }) {
  return (
    <section className="px-4 py-3 border-t border-slate-100 first:border-t-0">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[12px] font-bold text-slate-800">{title}</h3>
        {aside && <span className="text-[11px] text-slate-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function StateTag({ state }) {
  const s = STATE[state];
  if (!s) return <span className="text-[11px] text-slate-500 whitespace-nowrap">도면</span>;
  return <span className={`text-[11px] whitespace-nowrap ${s.cls}`}>{s.text}</span>;
}

function NumInput({ value, onChange, err, label, edited, className = 'w-16' }) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={!!err}
      title={err || ''}
      className={`${className} h-7 px-1.5 rounded-md border text-right font-mono text-[12px] outline-none
        focus:border-[#002554] focus:ring-2 focus:ring-[#002554]/15
        ${err ? 'border-rose-500 text-rose-900 bg-rose-50'
          : edited ? 'border-[#002554]/60 text-slate-900 bg-[#002554]/[0.04]'
            : 'border-slate-300 text-slate-800 bg-white hover:border-slate-400'}`}
    />
  );
}

export default function LugshellReviewPanel({ summary, resultInfo, onDownload, onRedo, onSolve, onFormChange, busy = false }) {
  const s = summary || {};
  const review = Array.isArray(s.review) ? s.review : [];
  const byKey = useMemo(() => {
    const m = {};
    for (const r of review) {
      const { key, why } = parseNote(r.note);
      if (key && !m[key]) m[key] = { state: r.status, why };
    }
    return m;
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps -- review 는 summary 에서 나온다
  const others = review
    .map((r) => ({ ...parseNote(r.note), state: r.status }))
    .filter((r) => !SHOWN_INLINE.has(r.key));

  const base = useMemo(() => initialLugshellForm(summary), [summary]);
  const [form, setForm] = useState(base);
  useEffect(() => { setForm(base); }, [base]);
  // 입력 중인 값을 3D 하중 화살표에 바로 보이게 페이지로 올린다 (다시 만들기 전 미리 보기)
  useEffect(() => { onFormChange?.(form); }, [form]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = base.cases.length > 0; // 옛 서버 요약(케이스 값 없음)이면 읽기만
  const errs = editable ? validateLugshellForm(form, Number(s.hole_d)) : {};
  const edits = editable ? diffLugshellEdits(s, form) : null;
  const hasErr = Object.keys(errs).length > 0;
  const editCount = edits
    ? ['swl_t', 'daf', 'pin_d'].filter((k) => k in edits).length + (edits.cases?.length || 0)
    : 0;

  const isEdited = (key) => !!edits && key in edits;
  const caseEdited = (id, k) => !!edits?.cases?.some((c) => c.id === id && k in c);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setCase = (id, key, value) =>
    setForm((f) => ({ ...f, cases: f.cases.map((c) => (c.id === id ? { ...c, [key]: value } : c)) }));

  const hc = s.handcalc_max;
  const files = [
    ['design_json', '설계 JSON'],
    ['handcalc_json', '수계산'],
    ['trace_json', '값별 출처'],
    ['bdf', 'BDF'],
  ].filter(([k]) => resultInfo?.[k]);

  // 하중 줄 하나: 이름 | 입력칸 단위 | 상태 글자, 아래에 임시값·다름의 이유
  const loadRow = (key, label, unit, input) => {
    const info = byKey[key];
    const state = isEdited(key) ? 'user_fixed' : info?.state;
    const showWhy = info && (state === 'missing' || state === 'mismatch');
    return (
      <div key={key} className="py-1.5">
        <div className="grid grid-cols-[1fr_auto_64px] items-center gap-2">
          <span className="text-[12px] text-slate-700">{label}</span>
          <span className="flex items-center gap-1">{input}<span className="w-5 text-[11px] text-slate-500">{unit}</span></span>
          <span className="text-right"><StateTag state={state} /></span>
        </div>
        {errs[key] && <p className="mt-0.5 text-[11px] text-rose-700">{errs[key]}</p>}
        {showWhy && !errs[key] && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{info.why}</p>}
      </div>
    );
  };

  const anglesInfo = byKey.load_angles;
  const anglesEdited = !!edits?.cases?.length;
  const caseErrs = Object.entries(errs).filter(([k]) => k.includes('.'));

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <Section
        title="도면에서 읽은 형상"
        aside={`${s.template === 'lapping_lug' ? 'lap 러그' : s.template || ''} · 축척 ${fmt(s.scale)}`}
      >
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[12px]">
          <dt className="text-slate-600">판 두께</dt><dd className="text-right font-mono text-slate-900">{fmt(s.thickness, ' mm')}</dd>
          <dt className="text-slate-600">핀 구멍</dt><dd className="text-right font-mono text-slate-900">Ø{fmt(s.hole_d)}</dd>
          <dt className="text-slate-600">재질</dt>
          <dd className="text-right">
            <span className="font-mono text-slate-900">{fmt(s.material)}</span>
            {byKey.material?.why && <span className="block text-[11px] text-slate-500">{byKey.material.why}</span>}
          </dd>
        </dl>
      </Section>

      <Section title="해석 하중" aside={editable ? (editCount ? `${editCount}곳 고침` : '값을 눌러 고칠 수 있습니다') : null}>
        {editable ? (
          <div className="divide-y divide-slate-100">
            {loadRow('swl_t', '안전하중 SWL', 't',
              <NumInput label="안전하중 SWL" value={form.swl_t} onChange={(v) => set('swl_t', v)} err={errs.swl_t} edited={isEdited('swl_t')} />)}
            {loadRow('daf', 'DAF', '',
              <NumInput label="DAF" value={form.daf} onChange={(v) => set('daf', v)} err={errs.daf} edited={isEdited('daf')} />)}
            {loadRow('pin_d', `핀 지름 (구멍 Ø${fmt(s.hole_d)})`, 'mm',
              <NumInput label="핀 지름" value={form.pin_d} onChange={(v) => set('pin_d', v)} err={errs.pin_d} edited={isEdited('pin_d')} />)}

            <div className="py-1.5">
              <div className="grid grid-cols-[1fr_auto_64px] items-center gap-2">
                <span className="text-[12px] text-slate-700">하중 방향</span>
                <span className="flex gap-1 text-[11px] text-slate-500">
                  <span className="w-14 text-right" title="판 안에서 기울어진 각도">면내 α°</span>
                  <span className="w-14 text-right" title="판 밖으로 기울어진 각도">면외 β°</span>
                </span>
                <span className="text-right"><StateTag state={anglesEdited ? 'user_fixed' : anglesInfo?.state} /></span>
              </div>
              {form.cases.map((c, i) => (
                <div key={c.id} className="grid grid-cols-[1fr_auto_64px] items-center gap-2 mt-1">
                  <span className="text-[12px] text-slate-600 truncate" title={c.id}>
                    LC{i + 1} {CASE_NAME[c.id] || c.id}
                  </span>
                  <span className="flex gap-1">
                    {['alpha_deg', 'beta_deg'].map((k) => (
                      <NumInput
                        key={k}
                        className="w-14"
                        label={`LC${i + 1} ${k === 'alpha_deg' ? '면내 α' : '면외 β'}`}
                        value={c[k]}
                        onChange={(v) => setCase(c.id, k, v)}
                        err={errs[`${c.id}.${k}`]}
                        edited={caseEdited(c.id, k)}
                      />
                    ))}
                  </span>
                  <span />
                </div>
              ))}
              {caseErrs.length > 0 && <p className="mt-1 text-[11px] text-rose-700">각도는 -90~90 사이로 넣으세요.</p>}
              {!caseErrs.length && anglesInfo?.state === 'missing' && !anglesEdited && (
                <p className="mt-1 text-[11px] leading-snug text-slate-500">도면에 하중 방향이 없어 기본 세 경우로 검토합니다. 실제 슬링 각도가 다르면 고치세요.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-slate-600">안전하중 {fmt(s.swl_t, ' t')} · 하중 케이스 {s.load_cases?.length || 0}개 (이 서버에서는 고칠 수 없습니다)</p>
        )}
      </Section>

      {byKey.boundary && (
        <Section title="경계조건">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] leading-snug text-slate-700">{byKey.boundary.why}</p>
            <StateTag state={byKey.boundary.state} />
          </div>
        </Section>
      )}

      {others.length > 0 && (
        <Section title="그 밖에 확인할 것">
          <ul className="space-y-1">
            {others.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-[12px] leading-snug">
                <span><span className="text-slate-800">{NAME[r.key] || r.key}</span><span className="text-slate-500"> — {r.why}</span></span>
                <StateTag state={r.state} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hc && (
        <Section title="수계산" aside="판정 기준 미정(D4) · 참고값">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-slate-600">최대 UC · {hc.check} · {hc.case}</span>
            <span className={`font-mono text-[15px] font-bold ${hc.uc > 1 ? 'text-rose-700' : 'text-slate-900'}`}>
              {hc.uc.toFixed(2)}
            </span>
          </div>
          {editCount > 0 && <p className="mt-1 text-[11px] text-slate-500">고친 값은 다시 만든 뒤에 반영됩니다.</p>}
        </Section>
      )}

      <div className="px-4 py-3 border-t border-slate-100 space-y-2">
        {editCount > 0 ? (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm(base)}
                disabled={busy}
                className="h-9 px-3 rounded-lg border border-slate-300 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                되돌리기
              </button>
              <button
                type="button"
                onClick={() => !hasErr && onRedo?.(edits)}
                disabled={busy || hasErr || !onRedo}
                className="flex-1 h-9 rounded-lg bg-[#002554] text-white text-[13px] font-bold hover:bg-[#003366] disabled:bg-slate-200 disabled:text-slate-500"
              >
                고친 값으로 다시 만들기
              </button>
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              도면은 다시 읽지 않고 모델·수계산만 새로 만듭니다(약 30초). 해석은 그다음에 합니다.
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onSolve?.()}
            disabled={busy || !onSolve}
            title="도면에서 만든 하중 케이스와 lap 구역 고정을 그대로 Nastran 해석"
            className="w-full h-9 rounded-lg bg-[#002554] text-white text-[13px] font-bold hover:bg-[#003366] disabled:bg-slate-200 disabled:text-slate-500"
          >
            이 하중으로 해석{s.load_cases?.length ? ` (${s.load_cases.length}케이스)` : ''}
          </button>
        )}
        {files.length > 0 && (
          <p className="text-[11px] text-slate-500">
            파일 받기:{' '}
            {files.map(([k, label], i) => (
              <span key={k}>
                {i > 0 && <span className="text-slate-300"> · </span>}
                <button type="button" onClick={() => onDownload?.(resultInfo[k])} className="text-slate-700 underline underline-offset-2 hover:text-[#002554]">
                  {label}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
