/// <summary>
/// 관리자 All Projects '여러 건 보내기' — 고른 권상 해석들을 미리 보고(보낼 파일·경고·못 보내는 사유)
/// 한 건씩 차례로 LogBook '정리 대기'로 보낸다. 해석 1건 = LogBook 묶음 1개(합치지 않는다).
/// 계획: docs/plans/2026-11-06-all-projects-bulk-logbook-send.md
/// </summary>
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Loader2, Send, XCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { exportProjectToLogbook, planBulkLogbookExport } from '../../api/adminProjects';
import { formatBytes } from '../../utils/adminProjectFiles';
import { describeSendOutcome, initialPlanChecks, summarizePlan } from '../../utils/bulkLogbookSend';
import { useLogbookLauncher } from '../analysis/runFrame/LogbookImportButton';

const OUTCOME_STYLE = {
  sent: { cls: 'text-emerald-700', Icon: CheckCircle2 },
  duplicate: { cls: 'text-amber-700', Icon: AlertTriangle },
  failed: { cls: 'text-red-700', Icon: XCircle },
};

export default function BulkLogbookSendModal({ ids, onClose, onDone }) {
  const { showToast } = useToast();
  const isOpen = Array.isArray(ids) && ids.length > 0;
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcomes, setOutcomes] = useState({});
  const stopRef = useRef(false);
  const { open: openLogbookInbox } = useLogbookLauncher({
    next: 'inbox', showToast, openedMessage: 'LogBook 정리 대기 화면을 열었습니다.',
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setPlan(null); setError(null); setOutcomes({}); setProgress({ done: 0, total: 0 });
    setLoading(true);
    planBulkLogbookExport(ids)
      .then(({ data }) => {
        if (cancelled) return;
        const items = data.items || [];
        setPlan(items);
        setChecked(initialPlanChecks(items));
      })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e?.message || '미리 보기를 만들지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, ids]);

  const items = useMemo(() => plan || [], [plan]);
  // 보낼 수: 이미 보낸 기록은 빼고 센다(멈춘 뒤 이어 보내기)
  const pending = useMemo(() => new Set([...checked].filter(id => !['sent', 'duplicate'].includes(outcomes[id]?.state))),
    [checked, outcomes]);
  const summary = useMemo(() => summarizePlan(items, pending), [items, pending]);
  const finished = progress.total > 0 && progress.done === progress.total && !sending;

  // 이미 보낸(또는 전부 중복이던) 기록 — 멈춘 뒤 다시 보낼 때 또 보내지 않는다
  const isDone = (id) => ['sent', 'duplicate'].includes(outcomes[id]?.state);

  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const send = async () => {
    const queue = items.filter(it => it.ok && checked.has(it.id) && !isDone(it.id));
    if (!queue.length || sending) return;
    stopRef.current = false;
    setSending(true);
    setProgress({ done: 0, total: queue.length });
    let sent = 0;
    for (const it of queue) {
      if (stopRef.current) break;
      setOutcomes(prev => ({ ...prev, [it.id]: { state: 'running', text: '보내는 중…' } }));
      let outcome;
      try {
        const { data } = await exportProjectToLogbook(it.id, { paths: it.files.map(f => f.path), title: it.title });
        outcome = describeSendOutcome({ data });
      } catch (e) {
        outcome = describeSendOutcome({ error: e });
      }
      if (outcome.state === 'sent') sent += 1;
      setOutcomes(prev => ({ ...prev, [it.id]: outcome }));
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setSending(false);
    onDone?.();
    showToast(`LogBook 으로 ${sent}건 보냈습니다.`, sent ? 'success' : 'warning', 6000);
    // 정리 대기 창은 끝에 한 번만 연다(건마다 열지 않는다)
    if (sent) openLogbookInbox();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={sending ? () => {} : onClose}
      title="LogBook 으로 여러 건 보내기"
      size="xl"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-600">
            {sending || finished
              ? <>진행 <span className="font-bold text-slate-800">{progress.done} / {progress.total}</span></>
              : <>보낼 기록 <span className="font-bold text-slate-800">{summary.count}</span>건 · {formatBytes(summary.bytes)} · 결과 세트 있음 {summary.withResult}건 · Wire 없음 {summary.withoutWire}건</>}
          </p>
          <div className="ml-auto flex gap-2">
            {sending ? (
              <Button variant="secondary" size="md" onClick={() => { stopRef.current = true; }}>지금 건까지만 보내고 멈추기</Button>
            ) : (
              <Button variant="secondary" size="md" onClick={onClose}>{finished ? '닫기' : '취소'}</Button>
            )}
            {!finished && (
              <Button variant="primary" size="md" isLoading={sending} disabled={!summary.count || sending || loading} onClick={send}>
                {!sending && <Send size={15} aria-hidden="true" />}
                {sending ? '보내는 중…' : `${summary.count}건 LogBook 으로 보내기`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3 p-6">
        <p className="text-xs leading-relaxed text-slate-600">
          기록마다 <b>입력 BDF + Wire 모델 세트 + 구조 해석 결과 세트</b>(구조 해석 전이면 원본 모델만)를 LogBook <b>정리 대기</b> 묶음 하나로 보냅니다(기록끼리 합치지 않음).
          같은 모델을 여러 번 돌린 기록은 가장 최근 것만 체크해 두었습니다. 확정은 LogBook 에서 합니다.
        </p>
        {loading && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" size={24} /></div>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {plan && (
          <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-bold text-slate-600">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">묶음 이름</th>
                  <th className="px-3 py-2">파일</th>
                  <th className="px-3 py-2">Wire</th>
                  <th className="px-3 py-2">결과 세트</th>
                  <th className="px-3 py-2">확인할 것 · 결과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(it => {
                  const outcome = outcomes[it.id];
                  const style = OUTCOME_STYLE[outcome?.state];
                  const warn = it.ok && (it.warnings?.length > 0 || it.olderRunOf);
                  return (
                    <tr key={it.id} className={!it.ok ? 'bg-slate-50 text-slate-500' : warn ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked.has(it.id)}
                          disabled={!it.ok || sending || finished || isDone(it.id)}
                          onChange={() => toggle(it.id)}
                          aria-label={`#${it.id} 보내기 선택`}
                          className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <span className="block font-mono text-[11px] text-slate-500">#{it.id}</span>
                        <span className="block truncate font-semibold text-slate-800" title={it.title || ''}>{it.title || '-'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {it.ok ? `${it.files.length}개 · ${formatBytes(it.totalBytes)}` : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {/* 옛 서버 응답에는 hasWire 가 없다 — 모르면 '-'(Wire 가 있는 기록을 '없음' 으로 보이지 않게) */}
                        {it.ok && it.hasWire === true ? <span className="text-emerald-700">있음</span>
                          : it.ok && it.hasWire === false ? <span className="text-amber-700">없음(원본 모델만)</span> : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {it.ok ? (it.hasResult ? <span className="text-emerald-700">있음</span> : <span className="text-slate-500">없음</span>) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {outcome ? (
                          <span className={`inline-flex items-center gap-1 ${style?.cls || 'text-slate-600'}`}>
                            {outcome.state === 'running'
                              ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                              : style && <style.Icon size={12} aria-hidden="true" />}
                            {outcome.text}
                          </span>
                        ) : !it.ok ? (
                          <span>{it.reason}</span>
                        ) : (
                          <span className="text-amber-800">
                            {[it.olderRunOf ? `같은 모델의 옛 실행(최신 #${it.olderRunOf})` : null, ...(it.warnings || [])].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {finished && (
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <BookOpen size={13} aria-hidden="true" /> 보낸 묶음은 LogBook 정리 대기에서 분류·확정합니다(여러 자료 분류 한꺼번에 사용 가능).
          </p>
        )}
      </div>
    </Modal>
  );
}
