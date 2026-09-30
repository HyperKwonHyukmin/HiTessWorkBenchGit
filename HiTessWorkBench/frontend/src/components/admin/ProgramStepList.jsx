/// <summary>
/// 프로그램 통계 행 아래에 붙는 '세부 검토' 한 줄.
/// 권상 App(GroupModuleUnit·SidePassage)은 Studio 안의 세부 검토(자세안정성 평가·권상 위치 최적화·
/// Unit 구조 해석)를 부모 App 한 줄로 합산해 보여 주고, 그 내역을 여기서 풀어 준다.
/// 백엔드가 steps 를 빈 배열로 주는 App 에서는 아무것도 그리지 않는다.
/// </summary>
import React from 'react';

export default function ProgramStepList({ steps, className = '' }) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 whitespace-normal ${className}`}>
      {steps.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-slate-300" aria-hidden="true">·</span>}
          <span>{s.label}</span>
          <span className="font-bold text-slate-700 tabular-nums">{s.count.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}
