import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';

/**
 * 공통 틀 — 실행 기록. 예전 페이지 하단의 검은 콘솔(System/Execution Console)을 대신한다.
 * 사용자가 먼저 읽을 것은 판정 머리의 원인·조치라 기본은 접어 두고, 실패하면 펼쳐서 연다.
 * 콘솔이 하던 일(진행 기록·여러 줄 실패 리포트·저장·상세 로그)은 그대로 한다.
 *
 * logs:       [{ time, message, type: 'info'|'success'|'warning'|'error', block? }]
 *             block=true 는 여러 줄 리포트 — 줄바꿈·들여쓰기를 살려 타임스탬프 없이 그린다.
 * open:       펼침 여부를 페이지가 정하고 싶을 때(실패 시 펼침). 사용자가 접고 펴는 것은 그 뒤 자유.
 * actions:    [{ key, label, icon, onClick }] — 상세 로그 보기·저장·지우기 등
 */
const TYPE_CLS = {
  error: 'text-red-700',
  success: 'text-emerald-700 font-semibold',
  warning: 'text-amber-800',
  info: 'text-slate-700',
};

export default function RunLogPanel({ title = '실행 기록', logs = [], open: openProp = false, actions = [], note }) {
  const [open, setOpen] = useState(openProp);
  // 페이지가 '열어라'(실패 등)로 바꾸면 따른다. 닫힘으로 바뀌는 것은 사용자의 선택을 덮지 않는다.
  useEffect(() => { if (openProp) setOpen(true); }, [openProp]);

  const endRef = useRef(null);
  const lastBlockRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    // 실패 리포트가 방금 붙었다면 리포트 맨 위(원인)로, 아니면 맨 아래로.
    // 기록 칸 안에서만 스크롤한다 — scrollIntoView 는 페이지까지 움직여 맨 위 판정 머리를 화면 밖으로 민다.
    const box = endRef.current?.parentElement;
    if (!box) return;
    const block = logs[logs.length - 1]?.block ? lastBlockRef.current : null;
    box.scrollTop = block ? block.offsetTop - box.offsetTop : box.scrollHeight;
  }, [logs, open]);

  if (logs.length === 0 && actions.length === 0) return null;
  const hasError = logs.some(l => l.type === 'error');

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 text-left text-sm font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
        >
          <Terminal size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
          {title}
          <span className="truncate text-xs font-normal text-slate-600">
            {logs.length > 0 ? `${logs.length}줄${hasError ? ' · 오류 있음' : ''}` : '기록 없음'}
            {note ? ` · ${note}` : ''}
          </span>
          <ChevronDown size={14} className={`ml-auto shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {actions.map(a => (
          <button
            key={a.key}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 cursor-pointer"
          >
            {a.icon && <a.icon size={12} aria-hidden="true" />} {a.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="relative max-h-80 overflow-y-auto border-t border-slate-100 bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed">
          {logs.length === 0
            ? <p className="text-slate-600">아직 기록이 없습니다.</p>
            : logs.map((log, i) => (
              <div key={i} className={`mb-0.5 ${TYPE_CLS[log.type] ?? TYPE_CLS.info}`}>
                {log.block
                  ? <pre ref={i === logs.length - 1 ? lastBlockRef : null} className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{log.message}</pre>
                  : <><span className="mr-2 text-slate-500">[{log.time}]</span>{log.message}</>}
              </div>
            ))}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
