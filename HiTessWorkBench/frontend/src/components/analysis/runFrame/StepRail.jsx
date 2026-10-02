import React from 'react';

/**
 * 파일 기반 해석 앱 공통 틀 — 왼쪽 단계 레일.
 *
 * 각 단계는 <button> 이라 Tab·Enter 로 이동할 수 있다. 상태는 점 색 + 글자 라벨을 함께 쓴다
 * (색만으로 판정하지 않는다). 단계 상태는 페이지가 '실제 사건'(실행 성공·확인·다운로드 등)으로만
 * 바꿔야 한다 — 탭을 열었다고 완료로 바꾸지 말 것.
 *
 * steps: [{ id, title, icon, status, hint? }]
 *   status: 'wait' | 'running' | 'done' | 'review' | 'error' | 'disabled'
 */
export const STEP_STATUS = {
  wait:     { dot: 'bg-white border-2 border-slate-300',      text: 'text-slate-600',   label: '대기' },
  running:  { dot: 'bg-blue-600 ring-4 ring-blue-100',        text: 'text-blue-700',    label: '진행 중' },
  done:     { dot: 'bg-emerald-600',                          text: 'text-emerald-700', label: '완료' },
  review:   { dot: 'bg-amber-500',                            text: 'text-amber-800',   label: '검토 필요' },
  error:    { dot: 'bg-red-600',                              text: 'text-red-700',     label: '실패' },
  disabled: { dot: 'bg-slate-200',                            text: 'text-slate-500',   label: '해당 없음' },
};

export default function StepRail({ steps, activeIdx, onSelect, disabled = false }) {
  return (
    <ol className="flex flex-col" aria-label="작업 단계">
      {steps.map((step, idx) => {
        const cfg = STEP_STATUS[step.status] ?? STEP_STATUS.wait;
        const Icon = step.icon;
        const isActive = idx === activeIdx;
        const isLast = idx === steps.length - 1;
        return (
          <li key={step.id} className="flex items-stretch gap-3">
            <div className="flex w-3 shrink-0 flex-col items-center pt-[15px]">
              <span className={`h-3 w-3 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
              {!isLast && (
                <span
                  className={`my-1 w-px flex-1 ${step.status === 'done' ? 'bg-emerald-500' : 'bg-slate-200'}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelect?.(idx)}
              disabled={disabled}
              aria-current={isActive ? 'step' : undefined}
              className={`mb-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50
                disabled:cursor-not-allowed
                ${isActive
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-transparent hover:border-slate-200 hover:bg-slate-50 cursor-pointer'}`}
            >
              {Icon && <Icon size={15} className={`shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-500'}`} aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isActive ? 'text-blue-800' : 'text-slate-800'}`}>
                  {idx + 1}. {step.title}
                </span>
                <span className={`block truncate text-xs font-semibold ${cfg.text}`}>
                  {step.hint ?? cfg.label}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
