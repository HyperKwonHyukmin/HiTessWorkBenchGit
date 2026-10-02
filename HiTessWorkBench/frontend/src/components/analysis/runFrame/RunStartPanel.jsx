import React, { useEffect, useState } from 'react';
import { ArrowRight, FileInput, History, Loader2 } from 'lucide-react';
import { getAnalysisHistory } from '../../../api/analysis';
import { FAILED_STATUSES, inputFileLabel, resultHighlight } from '../../../utils/dashboardResults';
import { canOpenResult } from '../../../utils/resultReentry';

/**
 * 공통 틀 — 첫 화면(입력 전) 아래쪽. 입력 칸만 덩그러니 있으면 작업면이 비어 보여서,
 * 꾸밈 대신 실제로 쓰는 정보 두 가지를 둔다.
 *   1) 진행 순서 — 단계마다 무엇을 보고 무엇이 나오는지(StepRail 의 단계 이름과 같은 순서)
 *   2) 이 앱의 내 최근 실행 — 그 실행의 입력을 지금 입력으로 불러오거나, 결과를 바로 다시 연다
 *
 * steps:       [{ title, detail }]
 * programName: 해석 기록의 program_name (예: 'GroupModuleUnit')
 * onOpen:      (analysisId) => void  — 페이지의 applyResultReentry
 * onUseInput:  (record) => Promise|void — 그 실행의 서버 보관 입력을 이 페이지 입력 칸에 채운다
 * hasInput:    (record) => boolean     — 기록에 불러올 입력 경로가 있는가(앱마다 input_info 키가 다르다)
 * 입력은 실패한 실행에서도 불러올 수 있다(고쳐서 다시 돌리는 경우가 흔하다). 단 보관 기간이 지나 파일이 지워졌으면 끈다.
 */
const TONE = {
  ok: 'bg-emerald-50 text-emerald-800',
  warn: 'bg-amber-50 text-amber-900',
  ng: 'bg-red-50 text-red-800',
  info: 'bg-slate-100 text-slate-700',
};

const pad = (n) => String(n).padStart(2, '0');
const fmtWhen = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function statusChip(record) {
  if (FAILED_STATUSES.has(record.status)) return { tone: 'ng', label: '실패' };
  if (record.status !== 'Success') return { tone: 'info', label: '진행 중' };
  return resultHighlight(record) ?? { tone: 'info', label: '완료' };
}

export default function RunStartPanel({ steps, programName, onOpen, onUseInput, hasInput, limit = 5 }) {
  const [records, setRecords] = useState(null); // null = 불러오는 중
  const [error, setError] = useState(false);
  const [loadingId, setLoadingId] = useState(null); // 입력을 받아 오는 중인 기록

  const loadInput = async (record) => {
    setLoadingId(record.id);
    try { await onUseInput(record); } finally { setLoadingId(null); }
  };

  useEffect(() => {
    let cancelled = false;
    let employeeId = null;
    try { employeeId = JSON.parse(localStorage.getItem('user') || 'null')?.employee_id ?? null; } catch { /* 세션 없음 */ }
    if (!employeeId) { setRecords([]); return undefined; }
    getAnalysisHistory(employeeId, 0, limit, { program_name: programName })
      .then(res => { if (!cancelled) setRecords(res.data?.items ?? []); })
      .catch(() => { if (!cancelled) { setRecords([]); setError(true); } });
    return () => { cancelled = true; };
  }, [programName, limit]);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section aria-labelledby="run-start-steps" className="min-w-0">
        <h3 id="run-start-steps" className="mb-2 text-sm font-bold text-slate-800">진행 순서</h3>
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 px-3 py-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="text-xs leading-relaxed text-slate-600">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="run-start-recent" className="min-w-0">
        <h3 id="run-start-recent" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <History size={14} className="text-slate-500" aria-hidden="true" /> 내 최근 실행
        </h3>
        <div className="rounded-lg border border-slate-200">
          {records === null ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-600">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" /> 불러오는 중…
            </p>
          ) : records.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-600">
              {error ? '실행 이력을 불러오지 못했습니다.' : '아직 이 앱을 실행한 기록이 없습니다. 처음이라면 왼쪽 ‘샘플로 실행’으로 흐름을 먼저 볼 수 있습니다.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {records.map(r => {
                const chip = statusChip(r);
                const openable = canOpenResult(r);
                const inputReady = !!onUseInput && r.files_available !== false && r.status !== 'Running' && r.status !== 'Pending' && (hasInput ? hasInput(r) : true);
                const name = inputFileLabel(r) || r.project_name || '이름 없는 실행';
                return (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-[76px] shrink-0 font-mono text-xs tabular-nums text-slate-600">{fmtWhen(r.created_at)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800" title={name}>{name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[chip.tone] ?? TONE.info}`}>{chip.label}</span>
                    {onUseInput && (
                      <button
                        type="button"
                        onClick={() => loadInput(r)}
                        disabled={!inputReady || loadingId != null}
                        title={inputReady ? '이 실행에 쓴 입력 파일을 지금 입력 칸에 넣습니다' : r.files_available === false ? '보관 기간이 지나 파일이 삭제됐습니다' : '불러올 입력 파일이 없습니다'}
                        className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                      >
                        {loadingId === r.id
                          ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                          : <FileInput size={12} aria-hidden="true" />}
                        입력 불러오기
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpen(r.id)}
                      disabled={!openable}
                      title={openable ? '이 결과를 이 화면에서 엽니다' : r.files_available === false ? '보관 기간이 지나 파일이 삭제됐습니다' : '열 수 있는 결과가 없습니다'}
                      className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                    >
                      결과 열기 <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
