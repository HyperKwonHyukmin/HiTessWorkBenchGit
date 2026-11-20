// PSA 평가보고서 — 검토 결과 창. 보고서와 따로, 지금 입력으로 서버가 만든 기록을 본다(POST /review).
// 내용과 색 = 검토용 Word 와 같은 기록(백엔드 psa_report_review.Trace). 색 정의 원본은 서버 기록의 kinds.
// 묶기와 단계 연결 규칙 = utils/psaReport.js(summarizeReview, reviewStepOf).
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, FileDown } from 'lucide-react';
import Modal from '../../ui/Modal';
import { REVIEW_KINDS, summarizeReview, reviewStepOf } from '../../../utils/psaReport';

const GRID = 'border-b border-slate-200';
const KIND_ORDER = ['input', 'calc', 'figure', 'missing'];

// 옛 서버(kinds 없음)용 예비 색 — 서버 KIND_FILL 과 같은 값
const FALLBACK_FILL = { input: '#DCE9F8', calc: '#DDF2DD', figure: '#E9E1F5', missing: '#FBD9B5' };

function kindsOf(review) {
  const out = {};
  KIND_ORDER.forEach(k => {
    const s = review?.kinds?.[k];
    out[k] = { label: s?.label || REVIEW_KINDS[k]?.label || k, fill: s?.fill || FALLBACK_FILL[k], meaning: s?.meaning || '' };
  });
  return out;
}

function KindChip({ kind, kinds }) {
  const k = kinds[kind] || { label: kind, fill: '#F1F5F9' };
  return (
    <span className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: k.fill }}>
      {k.label}
    </span>
  );
}

/** 왼쪽 레일 '검토' 아래 색 범례 — 검토용 Word 와 검토 창이 같은 색을 쓴다. */
export function ReviewColorKey({ review = null }) {
  const kinds = kindsOf(review);
  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5 px-1" aria-label="검토 색 구분">
      {KIND_ORDER.map(k => <li key={k}><KindChip kind={k} kinds={kinds} /></li>)}
    </ul>
  );
}

function ItemTable({ items, kinds, onGoStep }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup><col style={{ width: '34%' }} /><col style={{ width: '24%' }} /><col style={{ width: 112 }} /><col /></colgroup>
      <thead>
        <tr className="text-left text-xs text-slate-600">
          <th className={`${GRID} px-3 py-1.5 font-semibold`}>위치</th>
          <th className={`${GRID} px-3 py-1.5 font-semibold`}>보고서에 들어간 값</th>
          <th className={`${GRID} px-3 py-1.5 font-semibold`}>구분</th>
          <th className={`${GRID} px-3 py-1.5 font-semibold`}>가져온 곳 / 필요한 자료</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => {
          const step = it.kind === 'missing' ? reviewStepOf(it.source) : null;
          return (
            <tr key={`${it.where}-${i}`} className="align-top">
              <td className={`${GRID} px-3 py-1.5 text-slate-900`}>{it.where}</td>
              <td className={`${GRID} break-words px-3 py-1.5 text-slate-700`}>{it.value || <span className="text-slate-500">(빈칸)</span>}</td>
              <td className={`${GRID} px-3 py-1.5`}><KindChip kind={it.kind} kinds={kinds} /></td>
              <td className={`${GRID} break-words px-3 py-1.5 text-slate-700`}>
                {it.source}
                {step && (
                  <button
                    type="button"
                    onClick={() => onGoStep(step)}
                    className="ml-2 inline-flex items-center gap-0.5 rounded text-xs font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    채우러 가기 <ArrowRight size={12} aria-hidden="true" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * review = 서버 기록, loading/error = 만들기 상태
 * onGoStep(stepId) = 그 단계로 가며 창을 닫는다, onDownload = 검토용 Word 받기(downloading = 만드는 중)
 */
export default function PsaReviewPanel({ isOpen, onClose, review, loading, error, onGoStep, onDownload, downloading = false }) {
  const kinds = useMemo(() => kindsOf(review), [review]);
  const [shown, setShown] = useState(null); // null = 모든 색, 아니면 그 색만
  const filtered = useMemo(() => {
    if (!review || !shown) return review;
    return { ...review, items: (review.items || []).filter(it => it.kind === shown) };
  }, [review, shown]);
  const sum = useMemo(() => summarizeReview(filtered), [filtered]);
  const all = useMemo(() => summarizeReview(review), [review]);
  const counts = useMemo(() => {
    const c = {};
    (review?.items || []).forEach(it => { c[it.kind] = (c[it.kind] || 0) + 1; });
    return c;
  }, [review]);
  const [open, setOpen] = useState({});
  const [showFixed, setShowFixed] = useState(false);
  const go = (step) => { onClose(); onGoStep(step); };
  const filled = (review?.items || []).length - all.missing.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="screen"
      title="검토 결과"
      footer={onDownload && review && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600">검토용 Word 는 같은 자리를 이 색으로 칠하고, 맨 끝에 점검표를 붙입니다.</p>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-wait disabled:opacity-60"
          >
            <FileDown size={15} aria-hidden="true" /> {downloading ? '검토용 Word 만드는 중' : '검토용 Word 받기'}
          </button>
        </div>
      )}
    >
      {loading && <p className="py-8 text-center text-sm text-slate-600" role="status">지금 입력으로 검토 결과를 만드는 중입니다.</p>}
      {!loading && error && <p className="py-8 text-center text-sm text-red-800" role="alert">{error}</p>}
      {!loading && !error && review && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-slate-600"><span>{review.generated} 입력 기준</span><span className="ml-3">{review.filename}</span></p>
              <p className="mt-1 text-base font-bold text-slate-900">
                <span>채운 자리 {filled}곳</span>
                <span className={`ml-4 ${all.missing.length ? 'text-amber-800' : 'text-emerald-800'}`}>자료 없는 자리 {all.missing.length}곳</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="색으로 거르기">
              <button
                type="button"
                onClick={() => setShown(null)}
                aria-pressed={shown === null}
                className={`rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${shown === null ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                전체 {(review.items || []).length}
              </button>
              {KIND_ORDER.map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setShown(s => (s === k ? null : k))}
                  aria-pressed={shown === k}
                  disabled={!counts[k]}
                  title={kinds[k].meaning}
                  className={`rounded-md border px-2 py-1 text-xs font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40 ${shown === k ? 'border-slate-800 ring-1 ring-slate-800' : 'border-transparent'}`}
                  style={{ backgroundColor: kinds[k].fill }}
                >
                  {kinds[k].label} {counts[k] || 0}
                </button>
              ))}
              <span className="ml-1 text-xs text-slate-600">색 없음 = 서식 그대로</span>
            </div>
          </div>

          {sum.missing.length > 0 && (
            <section aria-labelledby="psa-review-missing">
              <h3 id="psa-review-missing" className="mb-1.5 text-sm font-bold text-amber-900">자료가 없는 자리: 보고서에 빈칸이나 Not provided 로 나갑니다</h3>
              <div className="overflow-x-auto rounded-lg border border-amber-200 bg-amber-50/40">
                <ItemTable items={sum.missing} kinds={kinds} onGoStep={go} />
              </div>
            </section>
          )}

          <section aria-labelledby="psa-review-groups">
            <h3 id="psa-review-groups" className="mb-1.5 text-sm font-bold text-slate-900">
              보고서 순서대로{shown ? <span className="ml-2 font-normal text-slate-600">({kinds[shown].label}만)</span> : null}
            </h3>
            {sum.groups.length === 0 ? (
              <p className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-600">이 색의 자리가 없습니다.</p>
            ) : (
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {sum.groups.map(g => {
                  const isOpen = shown ? open[g.name] !== false : !!open[g.name]; // 색으로 걸렀으면 펼친 채로
                  return (
                    <div key={g.name}>
                      <button
                        type="button"
                        onClick={() => setOpen(o => ({ ...o, [g.name]: !isOpen }))}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
                      >
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                          {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}{g.name}
                        </span>
                        <span className="text-xs tabular-nums text-slate-600">
                          {g.items.length - g.missing}곳 채움{g.missing ? <span className="ml-2 font-semibold text-amber-800">자료 없음 {g.missing}</span> : null}
                        </span>
                      </button>
                      {isOpen && <div className="overflow-x-auto border-t border-slate-200"><ItemTable items={g.items} kinds={kinds} onGoStep={go} /></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {review.templateFixed?.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowFixed(v => !v)}
                aria-expanded={showFixed}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {showFixed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                서식 그대로인 자리 {review.templateFixed.length}곳: 호선이 달라도 바뀌지 않으니 직접 확인
              </button>
              {showFixed && (
                <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
                  {review.templateFixed.map(f => <li key={f.where}>{f.where} <span className="text-slate-500">({f.note})</span></li>)}
                </ul>
              )}
            </section>
          )}

          {review.warnings?.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-bold text-slate-900">만들면서 생긴 경고</h3>
              <ul className="list-disc pl-5 text-sm text-amber-900">{review.warnings.map(w => <li key={w}>{w}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
