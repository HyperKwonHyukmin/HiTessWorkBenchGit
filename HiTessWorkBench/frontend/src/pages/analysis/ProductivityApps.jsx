import React, { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';

export default function ProductivityApps() {
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();

  const handleStart = (appTitle) => {
    if (appTitle === "BDF Scanner") {
      setCurrentMenu('BDF Scanner');
    } else {
      alert(`[안내] ${appTitle} 앱은 현재 개발 중입니다.`);
    }
  };

  const productivityData = ANALYSIS_DATA.filter(item => item.mode === "Productivity");
  const categories = ["All", ...new Set(productivityData.map(item => item.category))];
  const filteredApps = activeCategory === "All"
    ? productivityData
    : productivityData.filter(item => item.category === activeCategory);

  return (
    <div className="max-w-7xl mx-auto pb-16">

      <PageHeader
        title="Productivity Apps"
        icon={Wrench}
        subtitle="업무 효율을 높이는 유틸리티 도구 모음입니다."
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
              accentColor="teal"
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
