// PSA 평가보고서 — 보고서 정보 단계(표지, 개정 이력, 본문 기준, Line 별 재질과 두께).
// 호선과 대상마다 달라 서식에 박아 둘 수 없는 값이다. 비워 두면 보고서 그 자리에 '[Not provided]' 가 찍힌다.
// 항목 목록과 기본값 = utils/psaReport.js(DOC_INFO_GROUPS), 보고서에 넣는 자리 = 백엔드 psa_report_docx.py(_Report.cover).
import React from 'react';
import { Trash2 } from 'lucide-react';
import { GridText, AddRowButton } from './PsaInputTables';
import { DOC_INFO_GROUPS, lineMaterial, lineWall, DEFAULT_MATERIAL, DEFAULT_WALL } from '../../../utils/psaReport';

const GRID = 'border border-slate-200';
const th = `${GRID} bg-slate-100 px-3 py-2 text-left align-bottom text-xs font-semibold text-slate-700`;
const labelCell = `${GRID} bg-slate-50 px-3 py-2 align-middle text-sm font-semibold text-slate-800`;
const cell = `${GRID} p-0 align-middle`;
const blankCls = 'bg-amber-50/70'; // 빈 칸 = 보고서에 [Not provided] 로 나가는 자리

function Frame({ children, minWidth = 720 }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
      <table className="w-full table-fixed border-collapse border-hidden" style={{ minWidth }}>{children}</table>
    </div>
  );
}

function Title({ children, hint }) {
  return (
    <div className="mb-2 mt-6 first:mt-0">
      <h3 className="text-sm font-bold text-slate-900">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

function Field({ field, value, onChange }) {
  const empty = !String(value ?? '').trim();
  if (field.options) {
    return (
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        aria-label={field.label}
        className={`block h-10 w-full cursor-pointer bg-transparent px-3 text-sm text-slate-900 hover:bg-blue-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${empty ? blankCls : ''}`}
      >
        <option value="">고르지 않음</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <GridText
      value={value || ''}
      onChange={onChange}
      ariaLabel={field.label}
      placeholder={field.hint || '입력'}
      className={empty ? blankCls : ''}
    />
  );
}

/** 두 항목을 한 줄에(넓은 항목은 한 줄 전체) */
function pairRows(fields) {
  const rows = [];
  let hold = null;
  fields.forEach(f => {
    if (f.wide) { if (hold) { rows.push([hold]); hold = null; } rows.push([f]); return; }
    if (hold) { rows.push([hold, f]); hold = null; } else hold = f;
  });
  if (hold) rows.push([hold]);
  return rows;
}

export default function PsaDocInfo({ input, summary, onInfoChange, onRevisionChange, onRevisionAdd, onRevisionRemove, onLineChange }) {
  const info = input.docInfo || {};
  const revisions = input.revisions || [];
  return (
    <section>
      <div
        role="status"
        className={`mb-4 rounded-lg border px-3 py-2.5 text-sm ${summary.empty ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
      >
        {summary.empty ? (
          <>
            <p className="font-semibold">빈 칸 {summary.empty}개 (노란 칸)</p>
            <p className="mt-0.5 text-xs">
              빈칸으로 두면 보고서에도 빈칸으로 비워집니다(서식에 있던 견본 호선 3441 의 글자는 남기지 않습니다).
              단 '본문에 들어가는 기준'과 Line 재질, 두께는 문장 안에 들어가므로 비우면 [Not provided] 로 적힙니다.
            </p>
            <p className="mt-0.5 text-xs">빈 칸: {summary.labels.slice(0, 8).join(', ')}{summary.labels.length > 8 ? ` 외 ${summary.labels.length - 8}개` : ''}</p>
          </>
        ) : <p className="font-semibold">보고서 정보를 모두 채웠습니다.</p>}
      </div>

      {DOC_INFO_GROUPS.map(group => (
        <div key={group.title}>
          <Title>{group.title}</Title>
          <Frame>
            <colgroup>
              <col style={{ width: 170 }} /><col /><col style={{ width: 170 }} /><col />
            </colgroup>
            <tbody>
              {pairRows(group.fields).map(row => (
                <tr key={row[0].key}>
                  {row.map(f => (
                    <React.Fragment key={f.key}>
                      <th scope="row" className={labelCell} title={f.hint || ''}>{f.label}</th>
                      <td className={cell} colSpan={row.length === 1 ? 3 : 1}>
                        <Field field={f} value={info[f.key]} onChange={v => onInfoChange(f.key, v)} />
                      </td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </Frame>
        </div>
      ))}

      <Title hint="표지 다음 쪽의 Revision Summary 표가 됩니다. 내용(Contents)을 적은 줄만 의미가 있습니다.">개정 이력</Title>
      <Frame minWidth={640}>
        <colgroup>
          <col style={{ width: 90 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 52 }} />
        </colgroup>
        <thead>
          <tr><th className={th}>No.</th><th className={th}>Date</th><th className={th}>Contents</th><th className={th}><span className="sr-only">지우기</span></th></tr>
        </thead>
        <tbody>
          {revisions.length === 0 && (
            <tr><td colSpan={4} className={`${GRID} px-3 py-3 text-sm text-slate-500`}>개정 이력이 없습니다. 아래에서 줄을 추가하세요.</td></tr>
          )}
          {revisions.map(r => (
            <tr key={r.uid}>
              <td className={cell}><GridText value={r.no} onChange={v => onRevisionChange(r.uid, { no: v })} ariaLabel="개정 번호" placeholder="0" col="rev-no" /></td>
              <td className={cell}><GridText value={r.date} onChange={v => onRevisionChange(r.uid, { date: v })} ariaLabel="개정 날짜" placeholder="2026.11.18" col="rev-date" /></td>
              <td className={cell}>
                <GridText
                  value={r.contents}
                  onChange={v => onRevisionChange(r.uid, { contents: v })}
                  ariaLabel="개정 내용"
                  placeholder="예: Originally prepared for Hull no. 3441s"
                  col="rev-contents"
                  className={String(r.contents || '').trim() ? '' : blankCls}
                />
              </td>
              <td className={`${GRID} p-0 text-center align-middle`}>
                <button
                  type="button"
                  onClick={() => onRevisionRemove(r.uid)}
                  aria-label={`개정 ${r.no || ''} 줄 지우기`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </Frame>
      <div className="mt-2"><AddRowButton onClick={onRevisionAdd}>개정 줄 추가</AddRowButton></div>

      <Title hint={`6장 Line 절의 'Material', 'Wall thickness' 줄이 됩니다. 기본값은 ${DEFAULT_MATERIAL}, ${DEFAULT_WALL} 입니다.`}>Line 별 재질과 두께</Title>
      <Frame minWidth={640}>
        <colgroup>
          <col style={{ width: 110 }} /><col /><col style={{ width: '26%' }} /><col style={{ width: '30%' }} />
        </colgroup>
        <thead>
          <tr><th className={th}>Line No.</th><th className={th}>Pipe Line</th><th className={th}>Material</th><th className={th}>Wall thickness</th></tr>
        </thead>
        <tbody>
          {input.lines.length === 0 && (
            <tr><td colSpan={4} className={`${GRID} px-3 py-3 text-sm text-slate-500`}>Piping line 이 없습니다. 1단계에서 프로젝트 폴더를 고르세요.</td></tr>
          )}
          {input.lines.map(l => (
            <tr key={l.uid}>
              <th scope="row" className={labelCell}>{l.lineNo || '(번호 없음)'}</th>
              <td className={`${GRID} px-3 py-2 text-sm text-slate-600`}>{l.pipeLine}</td>
              <td className={cell}>
                <GridText value={lineMaterial(l)} onChange={v => onLineChange(l.uid, { material: v })} ariaLabel={`${l.lineNo} Material`}
                  placeholder={DEFAULT_MATERIAL} col="line-material" className={lineMaterial(l).trim() ? '' : blankCls} />
              </td>
              <td className={cell}>
                <GridText value={lineWall(l)} onChange={v => onLineChange(l.uid, { wallThickness: v })} ariaLabel={`${l.lineNo} Wall thickness`}
                  placeholder={DEFAULT_WALL} col="line-wall" className={lineWall(l).trim() ? '' : blankCls} />
              </td>
            </tr>
          ))}
        </tbody>
      </Frame>
    </section>
  );
}
