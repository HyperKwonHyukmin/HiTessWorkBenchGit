import React, { useState } from 'react';
import { PenTool } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import GuideButton from '../../components/ui/GuideButton';

export default function InteractiveApps() {
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();

  const handleStart = (appTitle) => {
    if (appTitle === "Simple Beam Assessment") {
      setCurrentMenu('Simple Beam Assessment');
    } else {
      alert(`[안내] ${appTitle} 앱은 현재 개발 중입니다.`);
    }
  };

  const interactiveData = ANALYSIS_DATA.filter(item => item.mode === "Interactive");
  const categories = ["All", ...new Set(interactiveData.map(item => item.category))];
  const filteredApps = activeCategory === "All"
    ? interactiveData
    : interactiveData.filter(item => item.category === activeCategory);

  return (
    <div className="max-w-7xl mx-auto pb-16">

      <PageHeader
        title="Interactive Apps"
        icon={PenTool}
        subtitle="UI에서 설계 정보를 직접 입력하여 실시간으로 결과를 확인하세요."
        actions={<GuideButton guideTitle="해석 앱 유형 안내 — 어떤 것을 선택해야 하나요?" />}
      />

      {/* 카테고리 필터 탭 */}
      <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-slate-200 pb-5">
        {categories.map(category => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`cursor-pointer px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide transition-all duration-200 ${
              activeCategory === category
                ? 'bg-brand-blue text-white shadow-md border border-brand-blue'
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 shadow-sm'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* 앱 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredApps.map((item, index) => {
          const IconComponent = item.icon;
          const iconColorClass = item.color.replace('bg-', 'text-');
          const appData = {
            title: item.title,
            description: item.description,
            icon: <IconComponent className={iconColorClass} size={28} />,
            iconBg: item.color,
            tags: item.tags,
            devStatus: item.devStatus === 'Active' ? 'stable' : 'dev',
          };
          return (
            <AppCard
              key={index}
              app={appData}
              accentColor="violet"
              isFavorite={favorites.includes(item.title)}
              onFavorite={() => toggleFavorite(item.title)}
              onStart={() => handleStart(item.title)}
            />
          );
        })}
      </div>
    </div>
  );
}
