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
 */
export default function FilterTabs({ categories = [], active, onChange }) {
  const layoutId = useId();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-slate-200 pb-5">
      {categories.map(category => {
        const isActive = active === category;
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
            <span className="relative z-10">{category}</span>
          </button>
        );
      })}
    </div>
  );
}
