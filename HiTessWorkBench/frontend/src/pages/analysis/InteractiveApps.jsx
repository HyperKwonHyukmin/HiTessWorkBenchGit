import React, { useState } from 'react';
import { PenTool } from 'lucide-react';
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

export default function InteractiveApps() {
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
    if (appTitle === "Simple Beam Assessment") {
      setCurrentMenu('Simple Beam Assessment');
    } else if (appTitle === "Section Property Calculator") {
      setCurrentMenu('Section Property Calculator');
    } else {
      showToast(`'${appTitle}' 앱은 현재 개발 중입니다.`, 'info');
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
        accentColor="violet"
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
              accentColor="violet"
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
