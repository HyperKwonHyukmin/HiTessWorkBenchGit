import React, { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import AdminGateModal from '../../components/ui/AdminGateModal';
import GuideButton from '../../components/ui/GuideButton';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

export default function ProductivityApps() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();
  const [gateApp, setGateApp] = useState(null);

  const handleStart = (appTitle) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === appTitle);
    if (appMeta && (appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    if (appTitle === "BDF Scanner") {
      setCurrentMenu('BDF Scanner');
    } else {
      showToast(`'${appTitle}' 앱은 현재 개발 중입니다.`, 'info');
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
        accentColor="amber"
        actions={<GuideButton guideTitle="[생산성] Productivity Apps — 도구 소개" variant="dark" />}
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
          const isRestricted = (item.devStatus === 'Developing' || item.devStatus === 'Planned') && !getIsAdmin();
          const appData = {
            title: item.title,
            description: item.description,
            icon: <IconComponent className={iconColorClass} size={28} />,
            iconBg: item.color,
            tags: item.tags,
            devStatus: item.devStatus,
            contributor: item.contributor,
          };
          return (
            <AppCard
              key={item.title}
              app={appData}
              accentColor="amber"
              isRestricted={isRestricted}
              isFavorite={favorites.includes(item.title)}
              onFavorite={() => toggleFavorite(item.title)}
              onStart={() => handleStart(item.title)}
            />
          );
        })}
      </AnimatedGrid>
      <AdminGateModal
        isOpen={!!gateApp}
        onClose={() => setGateApp(null)}
        appTitle={gateApp?.title}
        devStatus={gateApp?.devStatus}
      />
    </div>
  );
}
