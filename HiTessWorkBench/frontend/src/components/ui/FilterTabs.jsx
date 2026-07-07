// 카테고리 필터 탭 공유 컴포넌트
// NewAnalysis, InteractiveApps, ParametricApps에서 공통으로 사용
import React, { useId } from 'react';
import { motion } from 'framer-motion';

/**
 * FilterTabs
 *
 * @param {string[]} categories   - 탭 레이블 배열
 * @param {string}  active        - 현재 활성 탭
 * @param {(c:string)=>void} onChange - 탭 변경 핸들러
 * @param {Record<string, number>} [counts] - 탭별 항목 수
 */
export default function FilterTabs({ categories = [], active, onChange, rightSlot, counts }) {
  const layoutId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-slate-200 pb-5">
      {categories.map(category => {
        const isActive = active === category;
        const count = counts?.[category];
        return (
          <button
            key={category}
            onClick={() => onChange(category)}
            className={[
              'relative cursor-pointer px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide',
              'transition-colors duration-200 outline-none isolate overflow-hidden',
              'focus-visible:ring-2 focus-visible:ring-brand-blue/40',
              isActive
                ? 'text-white border border-brand-blue shadow-md'
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 shadow-sm',
            ].join(' ')}
          >
            {/* 활성 탭 배경 (layoutId로 슬라이딩) */}
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-brand-blue z-0"
                transition={{ type: 'spring', stiffness: 380, damping: 35 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2">
              <span>{category}</span>
              {typeof count === 'number' && (
                <span
                  className={[
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums',
                    isActive ? 'bg-white/18 text-white' : 'bg-slate-100 text-slate-500',
                  ].join(' ')}
                >
                  {count}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {rightSlot && <div className="ml-auto shrink-0">{rightSlot}</div>}
    </div>
  );
}
