import React, { useState } from 'react';
import { PenTool } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
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
        actions={<GuideButton guideTitle="해석 앱 유형 안내 — 어떤 것을 선택해야 하나요?" variant="dark" />}
      />

      <FilterTabs
        categories={categories}
        active={activeCategory}
        onChange={setActiveCategory}
      />

      <AnimatedGrid>
        {filteredApps.map((item) => {
          const IconComponent = item.icon;
          const iconColorClass = item.color.replace('bg-', 'text-');
          const appData = {
            title: item.title,
            description: item.description,
            icon: <IconComponent className={iconColorClass} size={28} />,
            iconBg: item.color,
            tags: item.tags,
            devStatus: item.devStatus,
          };
          return (
            <AppCard
              key={item.title}
              app={appData}
              accentColor="violet"
              isFavorite={favorites.includes(item.title)}
              onFavorite={() => toggleFavorite(item.title)}
              onStart={() => handleStart(item.title)}
            />
          );
        })}
      </AnimatedGrid>
    </div>
  );
}
