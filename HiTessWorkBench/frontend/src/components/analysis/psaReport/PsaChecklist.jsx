// PSA 평가보고서 — 보고서에 필요한 파일 체크리스트.
// key-in 값은 표에서 직접 넣고, 여기 항목은 Line 마다 올린 결과 엑셀의 시트로 들어와야 한다(2026-11-19 엑셀 하나 = Line 하나).
// 판별은 서버(services/psa_report_files.py), 선택 규칙은 utils/psaReport.js(lineChecklist, autoPick).
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, ChevronDown, Loader2 } from 'lucide-react';
import {
  CHECKLIST_KINDS, lineChecklist, lineModelCount, modelLabel, kindsForLine,
  lineCheckState, checklistBusy, CHECK_BUSY_STATES,
} from '../../../utils/psaReport';

const GRID = 'border border-slate-200';
const th = `${GRID} bg-slate-100 px-3 py-2 text-left align-bottom text-xs font-semibold text-slate-700`;

const STATUS = {
  ok: { Icon: CheckCircle2, cls: 'text-emerald-700', label: '있음' },
  choose: { Icon: AlertTriangle, cls: 'text-amber-700', label: '고르기' },
  missing: { Icon: XCircle, cls: 'text-red-700', label: '없음' },
};

const baseName = (p) => String(p || '').split('/').pop();

// Line 확인 상태 → 줄 이름 옆 글, 칸 글, 상세 안내. 끝나기 전에는 '없음' 대신 진행 상태를 보인다
// (2026-11-18 사용자: 올리는 중에 ? 가 떠서 있다는 건지 없다는 건지 헷갈림)
const STATE_TEXT = {
  uploading: { row: '올리는 중', cell: '올리는 중', detail: '결과 엑셀을 서버에 올리고 있습니다. 끝나면 시트를 찾습니다.' },
  waiting: { row: '올릴 차례', cell: '대기', detail: '앞 Line 을 올리는 중입니다. 차례가 오면 이 Line 을 올립니다.' },
  checking: { row: '시트 찾는 중', cell: '찾는 중', detail: '서버가 이 Line 엑셀에서 보고서에 쓸 시트를 찾고 있습니다.' },
  error: { row: '확인 실패', cell: '확인 실패', detail: '파일을 확인하지 못했습니다. 위의 [다시 확인]을 누르세요.' },
  lost: { row: '서버에 없음', cell: '서버에 없음', detail: '서버 작업 폴더에서 이 Line 엑셀을 찾지 못했습니다. [다시 확인]을 누르거나 1단계에서 엑셀을 다시 고르세요.' },
  noFolder: { row: '엑셀 없음', cell: '엑셀 없음', detail: '결과 엑셀이 없습니다. 1단계에서 엑셀을 고르세요.' },
};

const REASON = {
  only: '후보 하나',
  model: '자동: 모델 번호(NO.k)',
  newest: '자동: 가장 최근에 내보냄',
  chosen: '직접 고름',
};

const fmtDate = (iso) => (iso ? String(iso).replace('T', ' ') : '');

/** 파일 내용 정보 한 줄 — 엑셀은 CAESAR 머리글, PDF 는 쪽수 */
function metaText(meta) {
  if (!meta) return '';
  const parts = [];
  if (meta.exportedAt) parts.push(`${fmtDate(meta.exportedAt)} 내보냄`);
  if (meta.job) parts.push(`Job ${meta.job}`);
  if (meta.loadCases) parts.push(`하중 경우 ${meta.loadCases}`);
  if (meta.supports) parts.push(`지지 ${meta.supports}`);
  if (meta.pages) parts.push(`${meta.pages}쪽`);
  return parts.join(', ');
}

function optionText(path, meta) {
  const info = metaText(meta);
  return info ? `${baseName(path)}  (${info})` : path;
}

function FileCell({ row, onChoose, ariaLabel, metaOf }) {
  const st = STATUS[row.status];
  const info = metaText(row.meta);
  const detail = (
    <div className="px-2.5 pb-1.5 text-[11px] leading-snug">
      {info && <p className="truncate text-slate-600" title={info}>{info}</p>}
      {row.reason && row.candidates.length > 1 && <p className="text-slate-500">{REASON[row.reason]}</p>}
      {row.warnings?.map(w => (
        <p key={w} className="font-semibold text-amber-800">{w}</p>
      ))}
    </div>
  );
  if (row.candidates.length > 1) {
    return (
      <div className={row.selected ? '' : 'bg-amber-50'}>
        <div className="relative">
          <select
            value={row.selected || ''}
            onChange={e => onChoose(e.target.value)}
            aria-label={ariaLabel}
            title={row.selected || '후보 중 하나를 고르세요'}
            className={`block h-9 w-full cursor-pointer appearance-none truncate bg-transparent pl-8 pr-8 text-sm hover:bg-blue-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${row.selected ? 'text-slate-900' : 'font-semibold text-amber-900'}`}
          >
            <option value="">후보 {row.candidates.length}개 중 고르기</option>
            {row.candidates.map(c => <option key={c} value={c}>{optionText(c, metaOf(c))}</option>)}
          </select>
          <st.Icon size={15} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${st.cls}`} aria-hidden="true" />
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        </div>
        {row.selected && detail}
      </div>
    );
  }
  return (
    <div className={row.status === 'missing' ? 'bg-red-50' : ''}>
      <div className="flex h-9 items-center gap-1.5 px-2.5 text-sm" title={row.selected || ''}>
        <st.Icon size={15} className={`shrink-0 ${st.cls}`} aria-hidden="true" />
        <span className={`truncate ${row.status === 'missing' ? 'font-semibold text-red-800' : 'text-slate-800'}`}>
          {row.selected ? baseName(row.selected) : '없음'}
        </span>
      </div>
      {row.selected && detail}
    </div>
  );
}

/** 한 Line 의 종류별 상태 묶음 — 모델 여럿이면 가장 나쁜 상태와 '있음 수/전체' */
function cellSummary(rows) {
  if (!rows.length) return null;
  const ok = rows.filter(r => r.status === 'ok').length;
  const status = rows.some(r => r.status === 'missing') ? 'missing' : rows.some(r => r.status === 'choose') ? 'choose' : 'ok';
  return { status, ok, total: rows.length };
}

const OVERVIEW_COLS = [
  ...CHECKLIST_KINDS.filter(k => !k.lineLevel).map(k => ({ key: k.key, label: k.label, kinds: [k.key] })),
  { key: 'nozzle', label: 'Nozzle', kinds: CHECKLIST_KINDS.filter(k => k.lineLevel).map(k => k.key) },
].filter(c => c.kinds.length);

/** 한 Line 의 자세한 표(모델 × 파일 종류) */
function LineDetail({ line, scan, rows, state, onChoose }) {
  const metaOf = (p) => scan?.meta?.[p];
  const kinds = kindsForLine(line);
  const modelKinds = kinds.filter(k => !k.lineLevel);
  const lineKinds = kinds.filter(k => k.lineLevel);
  const count = lineModelCount(line);
  const rowFor = (kind, model) => rows.find(r => r.kind === kind && r.model === model);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="min-w-0 text-sm">
          <span className="font-semibold text-slate-900">{line.lineNo || '(번호 없음)'}</span>
          <span className="ml-2 text-slate-600">{line.pipeLine}</span>
          {scan?.unreadable?.length > 0 && (
            <span className="ml-2 text-xs text-slate-500" title={scan.unreadable.join('\n')}>읽지 못한 엑셀 {scan.unreadable.length}개(DRM 등)</span>
          )}
        </p>
        {line.folder?.name && <p className="truncate text-xs text-slate-600" title={line.folder.name}>엑셀 {line.folder.name}</p>}
      </div>
      {state !== 'ready' ? (
        <p className={`flex items-center gap-2 px-3 py-4 text-sm ${CHECK_BUSY_STATES.includes(state) ? 'text-slate-700' : 'text-red-800'}`} role="status">
          {CHECK_BUSY_STATES.includes(state) && <Loader2 size={15} className="animate-spin text-blue-600" aria-hidden="true" />}
          {STATE_TEXT[state]?.detail}
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse border-hidden" style={{ minWidth: 760 }}>
          <colgroup>
            <col style={{ width: 96 }} />
            {modelKinds.map(k => <col key={k.key} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={th}>모델</th>
              {modelKinds.map(k => (
                <th key={k.key} className={th} title={`${k.file} → 보고서 ${k.report}`}>
                  {k.label}<span className="block text-[11px] font-medium text-slate-500">{k.report}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }, (_, i) => (
              <tr key={i}>
                <th scope="row" className={`${GRID} bg-slate-50 px-3 text-left text-sm font-semibold text-slate-800`}>{modelLabel(line, i)}</th>
                {modelKinds.map(k => (
                  <td key={k.key} className={`${GRID} p-0`}>
                    <FileCell row={rowFor(k.key, i)} ariaLabel={`${modelLabel(line, i)} ${k.label} 파일`} metaOf={metaOf} onChoose={p => onChoose(line.uid, k.key, i, p)} />
                  </td>
                ))}
              </tr>
            ))}
            {lineKinds.length > 0 && (
              <tr>
                <th scope="row" className={`${GRID} bg-slate-50 px-3 text-left text-xs font-semibold text-slate-700`}>노즐 검토</th>
                <td colSpan={modelKinds.length} className={`${GRID} p-0`}>
                  <div className="grid grid-cols-2">
                    {lineKinds.map(k => (
                      <div key={k.key} className="border-r border-slate-200 last:border-r-0" title={`${k.file} → 보고서 ${k.report}`}>
                        <p className="px-2.5 pt-1.5 text-[11px] font-semibold text-slate-600">{k.label}</p>
                        <FileCell row={rowFor(k.key, 0)} ariaLabel={`${line.lineNo} ${k.label} 파일`} metaOf={metaOf} onChoose={p => onChoose(line.uid, k.key, 0, p)} />
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/**
 * summary = checklistSummary 결과, checklist = 서버 targets(없으면 확인 전).
 * 위 = Line 한 줄씩 요약(스크롤 없이 한눈에), 아래 = 고른 Line 하나의 자세한 표.
 */
export default function PsaChecklist({ input, checklist, summary, loading, error, onRefresh, onChoose, focus, topBusy = false, pending = false }) {
  const total = summary.missing.length + summary.choose.length;
  const flags = { loading, topBusy, error, pending };
  const busy = checklistBusy(input, checklist, flags) && !error;
  const perLine = input.lines.map(line => {
    const state = lineCheckState(line, checklist, flags);
    const scan = state === 'ready' ? checklist[line.folder.target] : undefined;
    const rows = lineChecklist(line, scan, summary.projectHull);
    const bad = !scan || rows.some(r => r.status !== 'ok');
    return { line, scan, rows, bad, state };
  });
  const countOf = (st) => perLine.filter(p => p.state === st).length;
  const busyText = [
    ['uploading', '올리는 중'], ['waiting', '올릴 차례'], ['checking', '파일 찾는 중'], ['ready', '확인 끝'],
  ].filter(([st]) => countOf(st)).map(([st, t]) => `${t} ${countOf(st)}`).join(', ');
  const [selUid, setSelUid] = useState(null);
  // 바깥(보고서 만들기에서 막힘)이 펼칠 Line 을 알려 오면 그 줄로 — focus.n 이 바뀔 때마다
  useEffect(() => { if (focus?.uid) setSelUid(focus.uid); }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // 기본으로 펼칠 줄: 고를 칸이 있는 Line(보고서를 막는다) → 다른 문제가 있는 Line → 첫 줄
  const sel = perLine.find(p => p.line.uid === selUid)
    || perLine.find(p => p.rows.some(r => r.status === 'choose'))
    || perLine.find(p => p.bad) || perLine[0];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-3xl text-xs text-slate-600">
          Line 줄을 누르면 아래에 그 Line 의 파일이 자세히 나옵니다. 후보가 여럿인 칸은 아래 표에서 고릅니다.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> 다시 확인
        </button>
      </div>

      <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-700" aria-label="표시 뜻">
        {[['ok', '파일 찾음'], ['choose', '후보 여럿, 직접 선택'], ['missing', '없어도 진행 가능']].map(([k, text]) => {
          const st = STATUS[k];
          return (
            <li key={k} className="inline-flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 font-semibold ${st.cls}`}><st.Icon size={13} aria-hidden="true" />{st.label}</span>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
      <div
        role="status"
        aria-live="polite"
        className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
          busy ? 'border-blue-200 bg-blue-50 text-blue-900'
            : summary.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'}`}
      >
        {busy ? <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
          : summary.ready ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
        <div className="min-w-0">
          {busy && input.lines.length ? (
            <>
              <p className="font-semibold">파일을 확인하는 중입니다. 끝나면 표가 채워집니다.</p>
              <p className="mt-0.5 text-xs">{busyText || '서버에 묻는 중'} (Line {perLine.length}개)</p>
            </>
          )
          : error ? <p className="font-semibold">파일을 확인하지 못했습니다: {error}</p>
            : !input.lines.length ? <p className="font-semibold">Piping line 이 없습니다. 1단계에서 결과 엑셀을 고르세요.</p>
              : !checklist ? <p className="font-semibold">{loading ? '서버에서 파일을 확인하는 중입니다.' : '결과 엑셀을 올리면 필요한 시트를 확인합니다.'}</p>
                : summary.ready ? (
                  <p className="font-semibold">
                    필요한 파일이 모두 있습니다.
                    {summary.warnings.length > 0 && <span className="ml-1 font-normal">확인할 경고 {summary.warnings.length}건(실행은 막지 않음)</span>}
                  </p>
                )
                  : (
                    <>
                      <p className="font-semibold">
                        {summary.noFolder.length > 0 && `결과 엑셀이 없는 Line ${summary.noFolder.length}개`}
                        {summary.noFolder.length > 0 && total > 0 && ', '}
                        {summary.missing.length > 0 && `빠진 파일 ${summary.missing.length}개`}
                        {summary.missing.length > 0 && summary.choose.length > 0 && ', '}
                        {summary.choose.length > 0 && `후보 중 고를 파일 ${summary.choose.length}개`}
                      </p>
                      {summary.choose.length > 0 ? (
                        <p className="mt-0.5 text-xs">후보가 여러 개인 칸은 아래 표에서 골라야 보고서를 만들 수 있습니다. 빠진 파일은 승인하면 '자료 없음'으로 적고 진행합니다.</p>
                      ) : summary.missing.length > 0 && (
                        <p className="mt-0.5 text-xs">빠진 파일이 있어도 보고서를 만들 수 있습니다. [보고서 만들기]에서 한 번 승인하면 그 자리를 '자료 없음'으로 적습니다.</p>
                      )}
                      {summary.warnings.length > 0 && <p className="mt-0.5 text-xs">확인할 경고 {summary.warnings.length}건(다른 호선 Job, 서로 다른 해석본 등). 실행은 막지 않습니다.</p>}
                    </>
                  )}
        </div>
      </div>

      {perLine.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-300">
            <table className="w-full border-collapse border-hidden text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th className={th}>Line</th>
                  {OVERVIEW_COLS.map(c => <th key={c.key} className={`${th} text-center`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {perLine.map(({ line, rows, state }) => {
                  const active = sel?.line.uid === line.uid;
                  return (
                    <tr
                      key={line.uid}
                      onClick={() => setSelUid(line.uid)}
                      className={`cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <th scope="row" className={`${GRID} px-3 py-1.5 text-left font-normal`}>
                        <button
                          type="button"
                          onClick={() => setSelUid(line.uid)}
                          aria-pressed={active}
                          className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                        >
                          <span className={`font-semibold ${active ? 'text-blue-800' : 'text-slate-900'}`}>{line.lineNo || '(번호 없음)'}</span>
                          {state === 'ready' ? <span className="ml-2 text-xs text-slate-500">{line.pipeLine}</span>
                            : CHECK_BUSY_STATES.includes(state) ? (
                              <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                                <Loader2 size={12} className="animate-spin" aria-hidden="true" />{STATE_TEXT[state].row}
                              </span>
                            )
                              : <span className="ml-2 text-xs font-semibold text-red-700">{STATE_TEXT[state].row}</span>}
                        </button>
                      </th>
                      {OVERVIEW_COLS.map(c => {
                        const mine = rows.filter(r => c.kinds.includes(r.kind));
                        if (!mine.length) return <td key={c.key} className={`${GRID} px-2 py-1.5 text-center text-slate-400`}>–</td>;
                        if (state !== 'ready') {
                          return (
                            <td key={c.key} className={`${GRID} px-2 py-1.5 text-center text-xs ${CHECK_BUSY_STATES.includes(state) ? 'text-slate-500' : 'bg-slate-50 text-slate-500'}`}>
                              {STATE_TEXT[state].cell}
                            </td>
                          );
                        }
                        const cs = cellSummary(mine);
                        const st = STATUS[cs.status];
                        return (
                          <td key={c.key} className={`${GRID} px-2 py-1.5 text-center ${cs.status === 'missing' ? 'bg-red-50' : cs.status === 'choose' ? 'bg-amber-50' : ''}`}>
                            <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${st.cls}`}>
                              <st.Icon size={14} aria-hidden="true" />
                              {cs.total > 1 ? `${cs.ok}/${cs.total}` : st.label}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sel && (
            <div className="mt-4">
              <LineDetail line={sel.line} scan={sel.scan} rows={sel.rows} state={sel.state} onChoose={onChoose} />
            </div>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        시트 찾는 규칙: {CHECKLIST_KINDS.map(k => `${k.label} = ${k.file}`).join(' / ')}. 수계산 엑셀은 원본이 아니라 뺍니다.
      </p>
    </section>
  );
}
