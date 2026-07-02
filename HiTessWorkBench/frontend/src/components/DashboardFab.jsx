/**
 * DashboardFab — 대시보드 전용 보조 자료 바로가기 (HiTESS Story / News Letter)
 *
 * 디자인 원칙:
 * - "+" 단일 버튼은 무엇인지 인지가 어렵다 → 텍스트 라벨이 항상 보이는 두 개의 알약형 버튼으로 구성.
 * - 가로(횡방향) 정렬로 세로 점유를 줄인다.
 * - 플랫폼 소개 헤더에서는 과한 CTA보다 조용한 outline 버튼군으로 통일한다.
 * - 플랫폼 소개 & 로드맵 헤더의 보조 액션으로 배치한다.
 */
import React from 'react';
import { Play, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

const ACTION_COLOR_CLASS = 'border-slate-200 bg-white text-slate-700 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100';

const ITEMS = [
  {
    key: 'video',
    label: 'HiTESS Story',
    icon: Play,
    title: 'HiTESS Story 영상 선택',
    fillIcon: true,
    colorClass: ACTION_COLOR_CLASS,
  },
  {
    key: 'newsletter',
    label: 'News Letter',
    icon: FileText,
    title: 'News Letter 아카이브 열기',
    fillIcon: false,
    colorClass: ACTION_COLOR_CLASS,
  },
];

export default function DashboardFab({ onOpenVideo, onOpenNewsletter, className = '' }) {
  const handleClick = (key) => {
    if (key === 'video') onOpenVideo();
    if (key === 'newsletter') onOpenNewsletter();
  };

  return (
    <div
      className={`flex flex-row items-center justify-end gap-1 ${className}`}
      aria-label="바로가기"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <motion.button
            key={item.key}
            onClick={() => handleClick(item.key)}
            title={item.title}
            aria-label={item.title}
            className={`inline-flex h-8 items-center gap-2 rounded-lg border pl-3 pr-3.5 text-xs font-bold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${item.colorClass}`}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            <Icon size={15} fill={item.fillIcon ? 'currentColor' : 'none'} />
            <span className="whitespace-nowrap">{item.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
