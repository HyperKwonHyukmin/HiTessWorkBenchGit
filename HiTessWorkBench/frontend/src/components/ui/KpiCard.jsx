import React from 'react';

/**
 * KpiCard — 관리 페이지 상단 통계 카드의 표준 컴포넌트.
 *
 * DESIGN.md의 "카드에 1px 초과 colored border-left 장식 스트라이프 금지" 규칙을 준수한다.
 * 색은 아이콘 타일에만 제한적으로 쓰고, 카드 본문/테두리는 중립 톤을 유지한다.
 * (기존 AnalysisStatsDashboard의 border-l-4 스트라이프 버전을 대체·표준화한 것.)
 *
 * @param {string}            props.label  - 지표 라벨
 * @param {React.ReactNode}   props.value  - 지표 값(숫자 또는 노드)
 * @param {string}            [props.sub]  - 보조 설명
 * @param {React.ElementType} [props.icon] - lucide-react 아이콘
 * @param {'blue'|'emerald'|'amber'|'violet'|'slate'|'rose'|'cyan'} [props.color='blue'] - 아이콘 타일 톤
 */
const KPI_ICON_TONE = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-600',
  cyan: 'bg-cyan-50 text-cyan-600',
};

export function KpiCard({ label, value, sub, icon: Icon, color = 'blue' }) {
  const tone = KPI_ICON_TONE[color] || KPI_ICON_TONE.blue;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500 truncate">{sub}</p>}
        </div>
        {Icon && (
          <div className={`shrink-0 rounded-lg p-2 ${tone}`} aria-hidden="true">
            <Icon size={20} />
          </div>
        )}
      </div>
    </div>
  );
}

export default KpiCard;
