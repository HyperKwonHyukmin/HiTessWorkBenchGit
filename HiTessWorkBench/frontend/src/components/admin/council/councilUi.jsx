// 협의체 과제 현황 화면이 같이 쓰는 모양(단추, 입력칸)과 상태 표시. 화면 = pages/Administration/AutomationCouncil.jsx
// 상태는 어디서나 '점 + 글자' 하나로 보인다(DESIGN.md 배지 규칙: 둥근 알약, 점, 글자. 색에만 기대지 않는다).
import { AlertTriangle } from 'lucide-react';
import { STATUS_META, STATUS_ORDER, dueInfo, itemDueInfo, mdDate } from '../../../utils/councilTasks';

export const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 h-9 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer';
export const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 h-9 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-50 cursor-pointer';
export const BTN_DANGER = 'inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 cursor-pointer';
export const ICON_BTN = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 cursor-pointer';
export const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20';
export const SELECT = 'h-9 rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-sm font-medium text-slate-700 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20 cursor-pointer';
export const LABEL = 'block text-xs font-semibold text-slate-600';
export const SEG_WRAP = 'inline-flex rounded-lg bg-slate-100 p-0.5';
export const segBtn = (on) => 'h-8 rounded-md px-3 text-sm font-semibold transition-colors cursor-pointer ' +
  (on ? 'bg-white text-brand-blue shadow-sm' : 'text-slate-600 hover:text-slate-900');

/** 한글 조합 중의 Enter 인가(조합을 끝내는 Enter 가 저장으로 이어지지 않게). */
export const isComposing = (e) => e.nativeEvent?.isComposing || e.keyCode === 229;

/** 과제 상태: 점 + 글자. 움직이는 상태(개발 중, 시험 운영)만 옅은 배경을 받는다. */
export function StatusBadge({ status, className = '' }) {
  const meta = STATUS_META[status] || STATUS_META.reviewing;
  return (
    <span className={'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-semibold ' +
      (meta.badge ? 'border px-2.5 ' + meta.badge + ' ' : '') + meta.text + ' ' + className}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.dot }} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** 과제 상태를 바꾸는 선택 상자 — 지금 상태 하나만 보이고, 누르면 다섯 단계가 펼쳐진다. */
export function StatusSelect({ value, onChange, disabled }) {
  const meta = STATUS_META[value] || STATUS_META.reviewing;
  return (
    <label className={'relative inline-flex h-8 items-center gap-2 rounded-full border bg-white pl-3 pr-1 text-sm font-semibold transition-colors hover:border-slate-400 focus-within:ring-2 focus-within:ring-brand-blue/20 ' +
      (meta.badge || 'border-slate-300') + ' ' + meta.text}>
      <span className="sr-only">진행 상태</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.dot }} aria-hidden="true" />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none bg-transparent pr-6 font-semibold focus:outline-none disabled:cursor-default"
      >
        {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" className="pointer-events-none absolute right-2.5 opacity-60" aria-hidden="true">
        <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

/** 항목 상태 원: 예정 = 빈 원, 진행 = 반 찬 원, 완료 = 찬 원에 체크(Team Planner 와 같은 모양). */
export function ItemGlyph({ status, size = 18, color = '#002554' }) {
  const c = status === 'done' ? '#64748b' : status === 'todo' ? '#94a3b8' : color;
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <circle cx="9" cy="9" r="7" fill={status === 'done' ? c : '#fff'} stroke={c} strokeWidth="1.8" />
      {status === 'doing' && <path d="M9 2a7 7 0 0 1 0 14z" fill={c} />}
      {status === 'done' && <path d="M5.6 9.2l2.3 2.3 4.5-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** 항목의 마감 표시: 지연은 빨강 + 경고 아이콘, 일주일 안이면 진하게, 끝난 것은 날짜만. */
export function ItemDue({ item, now, withDate = true }) {
  const due = itemDueInfo(item, now);
  if (!due.text) return null;
  if (item.status === 'done') return <span className="shrink-0 text-[13px] tabular-nums text-slate-500">{due.text}</span>;
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13px] tabular-nums">
      <span className={due.late ? 'font-bold text-red-700' : due.soon ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}>
        {due.late && <AlertTriangle size={12} className="mr-0.5 inline -mt-0.5" aria-hidden="true" />}
        {due.text}
      </span>
      {withDate && <span className="text-slate-500">{mdDate(item.due_date)}</span>}
    </span>
  );
}

/** 과제 목표일: 정해졌을 때만 보인다(미정은 쓰지 않는다). */
export function TaskDue({ task, now }) {
  if (!task.due_date) return null;
  const info = dueInfo(task.due_date, task.status, now);
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13px] tabular-nums" title={'목표일 ' + task.due_date}>
      <span className={info.late ? 'font-bold text-red-700' : info.soon ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}>
        {info.late && <AlertTriangle size={12} className="mr-0.5 inline -mt-0.5" aria-hidden="true" />}
        {info.text === task.due_date ? mdDate(task.due_date) : info.text}
      </span>
      {info.text !== task.due_date && <span className="text-slate-500">{mdDate(task.due_date)}</span>}
    </span>
  );
}

/** 담당 이름표. */
export function Assignee({ name }) {
  if (!name) return null;
  return <span className="max-w-[120px] shrink-0 truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{name}</span>;
}
