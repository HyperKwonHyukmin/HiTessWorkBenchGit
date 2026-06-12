/**
 * DashboardFab — 대시보드 전용 바로가기 버튼 (홍보영상 / 뉴스레터)
 *
 * 디자인 원칙:
 * - "+" 단일 버튼은 무엇인지 인지가 어렵다 → 텍스트 라벨이 항상 보이는 두 개의 알약형 버튼으로 구성.
 * - 가로(횡방향) 정렬로 세로 점유를 줄여 하단의 프로젝트 이력 테이블을 가리지 않는다.
 * - 집중형 엔지니어링 도구에 어울리도록 차분한 Trust Blue(#002554)/슬레이트 톤 사용.
 * - 우측 하단 고정. GlobalJobTray(z-[99999])와 겹치지 않도록 z-[9990] 사용하고,
 *   대시보드에서는 GlobalJobTray 를 이 버튼 행(높이 약 36px) 위로 올린다(DashboardContext: bottom-16).
 */
import React from 'react';
import { Play, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

const ITEMS = [
  {
    key: 'video',
    label: '홍보영상',
    icon: Play,
    title: 'HiTESS WorkBench 소개 영상 재생',
    fillIcon: true,
    colorClass: 'bg-[#002554] hover:bg-[#003580] active:bg-[#001a3d]',
  },
  {
    key: 'newsletter',
    label: '뉴스레터',
    icon: FileText,
    title: '발행된 뉴스레터 아카이브 열기',
    fillIcon: false,
    colorClass: 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800',
  },
];

export default function DashboardFab({ onOpenVideo, onOpenNewsletter }) {
  const handleClick = (key) => {
    if (key === 'video') onOpenVideo();
    if (key === 'newsletter') onOpenNewsletter();
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[9990] flex flex-row items-center gap-2.5"
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
            className={`inline-flex items-center gap-2 h-9 pl-3 pr-3.5 rounded-full ${item.colorClass} text-white text-xs font-bold shadow-lg border border-white/10 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2`}
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
