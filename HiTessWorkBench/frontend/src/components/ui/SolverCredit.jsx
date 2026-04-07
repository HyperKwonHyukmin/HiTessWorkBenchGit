import { User } from 'lucide-react';

/**
 * 솔버 개발 기여자를 표시하는 미니 푸터 컴포넌트.
 * flex-col 레이아웃에서도 shrink-0으로 고정 표시됩니다.
 */
export default function SolverCredit({ contributor = '권혁민' }) {
  return (
    <div className="shrink-0 flex items-center justify-center gap-2 py-3 text-sm text-slate-500 border-t border-slate-100 mt-2">
      <User size={15} className="text-slate-400" />
      <span>Solver Contributed by <span className="font-bold text-slate-700">{contributor}</span></span>
    </div>
  );
}
