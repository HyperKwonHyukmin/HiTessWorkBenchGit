import React, { useState } from 'react';
import { Info, UploadCloud } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import Button from '../../components/ui/Button';

export default function NewAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite, setAssessmentPageState } = useDashboard();

  const handleStart = (categoryTitle) => {
    if (categoryTitle === "Truss Model Builder") {
      setCurrentMenu('Truss Analysis');
    } else if (categoryTitle === "Truss Structural Assessment") {
      if (setAssessmentPageState) setAssessmentPageState({});
      setCurrentMenu('Truss Structural Assessment');
    } else if (categoryTitle === "Beam Result Viewer") {
      setCurrentMenu('Beam Result Viewer');
    } else if (categoryTitle === "BDF Scanner") {
      setCurrentMenu('BDF Scanner');
    } else {
      alert(`[안내] ${categoryTitle} 기능은 현재 준비 중입니다.`);
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
              accentColor="blue"
              isFavorite={favorites.includes(item.title)}
              onFavorite={() => toggleFavorite(item.title)}
              onStart={() => handleStart(item.title)}
            />
          );
        })}
      </AnimatedGrid>

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
