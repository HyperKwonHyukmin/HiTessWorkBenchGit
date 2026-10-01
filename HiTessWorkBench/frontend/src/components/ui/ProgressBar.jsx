import React from 'react';

/**
 * 해석 진행 막대 — 앱마다 따로 그리던 track + fill 을 하나로 (2026-10-01).
 *
 * status
 *  - running : 진행 중. 옅은 빛이 흐른다(index.css .progress-flow) — 작업이 살아 있다는 표시.
 *  - success : 초록으로 바뀌고 100% 로 찬다.
 *  - failed  : 빨강. 폭은 멈춘 지점 그대로(다 끝난 것처럼 보이지 않게).
 *  - idle    : 흐름 없이 값만.
 * 색 전환·폭 변화는 transition 으로 부드럽게, 동작 줄이기면 index.css 전역 규칙이 즉시 끝낸다.
 */
const TONE = {
  blue: 'bg-blue-500', // 앱 화면들이 쓰던 진행 막대 색(500)에 맞춘다
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
};
const TRACK = {
  blue: 'bg-blue-100',
  sky: 'bg-sky-100',
  amber: 'bg-amber-100',
  emerald: 'bg-emerald-100',
  violet: 'bg-violet-100',
  teal: 'bg-teal-100',
};
const SIZE = { xs: 'h-1', sm: 'h-1.5', md: 'h-2', lg: 'h-2.5' };

export default function ProgressBar({
  value = 0,
  status = 'running',
  tone = 'blue',
  size = 'md',
  className = '',
  trackClassName,
  label = '진행률',
}) {
  const pct = status === 'success' ? 100 : Math.max(0, Math.min(100, Number(value) || 0));
  const fill = status === 'success' ? 'bg-emerald-500'
    : status === 'failed' ? 'bg-red-500'
      : (TONE[tone] || TONE.blue);
  const track = trackClassName
    || (status === 'success' ? 'bg-emerald-100' : status === 'failed' ? 'bg-red-100' : (TRACK[tone] || 'bg-slate-100'));
  return (
    <div
      className={`${SIZE[size] || SIZE.md} overflow-hidden rounded-full transition-colors duration-300 ${track} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${fill} ${status === 'running' ? 'progress-flow' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
