import React, { useState } from 'react';
import { Info, UploadCloud } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import Button from '../../components/ui/Button';
import AdminGateModal from '../../components/ui/AdminGateModal';
import GuideButton from '../../components/ui/GuideButton';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

export default function NewAnalysis() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite, setAssessmentPageState } = useDashboard();
  const [gateApp, setGateApp] = useState(null); // { title, devStatus }

  const handleStart = (categoryTitle) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === categoryTitle);
    if (appMeta && (appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    if (categoryTitle === "Truss Model Builder") {
      setCurrentMenu('Truss Analysis');
    } else if (categoryTitle === "Truss Structural Assessment") {
      if (setAssessmentPageState) setAssessmentPageState({});
      setCurrentMenu('Truss Structural Assessment');
    } else if (categoryTitle === "HiTess ModelFlow") {
      setCurrentMenu('HiTess ModelFlow');
    } else {
      showToast(`${categoryTitle} 기능은 현재 준비 중입니다.`, 'info');
    }
  };

  const fileBasedData = ANALYSIS_DATA.filter(item => item.mode === "File");
  const categories = ["All", ...new Set(fileBasedData.map(item => item.category))];
  const filteredAnalyses = activeCategory === "All"
    ? fileBasedData
    : fileBasedData.filter(item => item.category === activeCategory);

  return (
    <div className="max-w-7xl mx-auto pb-16">

      <PageHeader
        title="File-Based Apps"
        icon={UploadCloud}
        subtitle="수행하고자 하는 파일 업로드 기반 해석 모델을 선택하십시오."
        actions={<GuideButton guideTitle="해석 앱 유형 안내 — 어떤 것을 선택해야 하나요?" variant="dark" />}
      />

      <FilterTabs
        categories={categories}
        active={activeCategory}
        onChange={setActiveCategory}
      />

      <AnimatedGrid>
        {filteredAnalyses.map((item) => {
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
              accentColor="blue"
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

      {/* 하단 도움말 배너 */}
      <div className="mt-16 bg-slate-50 rounded-2xl p-8 border border-dashed border-slate-300 flex flex-col md:flex-row items-center gap-6">
        <div className="p-4 bg-white rounded-full shadow-sm text-blue-500">
          <Info size={32} />
        </div>
        <div>
          <h3 className="font-bold text-slate-700">도움이 필요하신가요?</h3>
          <p className="text-sm text-slate-500 mt-1">
            해석 유형 선택이 어렵다면 사내 기술 표준 가이드를 참고하거나 시스템 솔루션 팀에 문의하십시오.
          </p>
        </div>
        <Button variant="secondary" size="sm" className="md:ml-auto" onClick={() => setCurrentMenu('User Guide')}>
          View Guide
        </Button>
      </div>

    </div>
  );
}
