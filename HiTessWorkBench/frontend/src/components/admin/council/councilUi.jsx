// 협의체 과제 현황 화면이 같이 쓰는 모양(단추, 입력칸)과 상태 원. 화면 = pages/Administration/AutomationCouncil.jsx
export const BTN = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 h-8 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer';
export const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-3 h-8 text-sm font-bold text-white transition-colors hover:bg-brand-blue-light disabled:opacity-50 cursor-pointer';
export const BTN_DANGER = 'inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 cursor-pointer';
export const ICON_BTN = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 cursor-pointer';
export const INPUT = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15';
export const LABEL = 'block text-xs font-semibold text-slate-600';
export const SEG_WRAP = 'flex rounded-md border border-slate-200 bg-white p-0.5';
export const segBtn = (on) => 'h-7 rounded px-2.5 text-xs font-semibold cursor-pointer ' + (on ? 'bg-blue-50 text-brand-blue' : 'text-slate-600 hover:bg-slate-50');

/** 한글 조합 중의 Enter 인가(조합을 끝내는 Enter 가 저장으로 이어지지 않게). */
export const isComposing = (e) => e.nativeEvent?.isComposing || e.keyCode === 229;

/** 항목 상태 원: 예정 = 빈 원, 진행 = 반 찬 원, 완료 = 찬 원에 체크(Team Planner 와 같은 모양). */
export function ItemGlyph({ status, size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <circle cx="9" cy="9" r="7" fill={status === 'done' ? color : 'none'} stroke={color} strokeWidth="1.8" />
      {status === 'doing' && <path d="M9 2a7 7 0 0 1 0 14z" fill={color} />}
      {status === 'done' && <path d="M5.6 9.2l2.3 2.3 4.5-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
