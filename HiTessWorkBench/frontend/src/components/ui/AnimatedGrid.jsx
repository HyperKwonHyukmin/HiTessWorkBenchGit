// 스태거 애니메이션 카드 그리드 래퍼
// staggerContainer + cardEntrance variants를 자동 적용
import React from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, cardEntrance } from '../../utils/motion';

/**
 * AnimatedGrid
 * children으로 전달된 각 요소를 stagger 애니메이션으로 표시합니다.
 * children은 반드시 motion을 지원하는 컴포넌트(또는 motion.div로 래핑)여야 합니다.
 *
 * @param {string} [className] - 그리드 className (기본: 3열 그리드)
 * @param {React.ReactNode} children
 */
export default function AnimatedGrid({ children, className }) {
  const gridClass = className ?? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8';

  return (
    <motion.div
      className={gridClass}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {React.Children.map(children, (child) => {
        if (!child) return null;
        // 각 child를 cardEntrance variants를 가진 motion.div로 감쌉니다
        return (
          <motion.div variants={cardEntrance} className="h-full">
            {child}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
