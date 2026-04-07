import React, { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import GuideButton from '../../components/ui/GuideButton';

export default function ParametricApps() {
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();

  const handleStart = (appTitle) => {
    if (appTitle === "Mast Post Assessment") {
      setCurrentMenu('Mast Post Assessment');
    } else if (appTitle === "Jib Rest Assessment") {
      setCurrentMenu('Jib Rest Assessment');
    } else {
      alert(`[안내] '${appTitle}' 앱은 현재 개발 중입니다.`);
    }
  };

  const parametricData = ANALYSIS_DATA.filter(item => item.mode === "Parametric");
  const categories = ["All", ...new Set(parametricData.map(item => item.category))];
  const filteredApps = activeCategory === "All"
    ? parametricData
    : parametricData.filter(item => item.category === activeCategory);

  return (
    <div className="max-w-7xl mx-auto pb-16">

      <PageHeader
        title="Parametric Apps"
        icon={SlidersHorizontal}
        subtitle="설계 파라미터를 직접 입력하여 계산 결과를 즉시 확인하세요."
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
