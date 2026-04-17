import React, { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import GuideButton from '../../components/ui/GuideButton';
import AdminGateModal from '../../components/ui/AdminGateModal';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

export default function ParametricApps() {
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
    if (appTitle === "Mast Post Assessment") {
      setCurrentMenu('Mast Post Assessment');
    } else if (appTitle === "Jib Rest Assessment") {
      setCurrentMenu('Jib Rest Assessment');
    } else if (appTitle === "Column Buckling Load Calculator") {
      setCurrentMenu('Column Buckling Load Calculator');
    } else {
      showToast(`'${appTitle}' 앱은 현재 개발 중입니다.`, 'info');
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
        accentColor="emerald"
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
              accentColor="emerald"
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
