import React, { useState } from 'react';
import { Info, UploadCloud } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
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
        {filteredAnalyses.map((item, index) => {
          // ANALYSIS_DATA의 icon(컴포넌트)을 JSX로 변환하여 AppCard에 전달
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
              accentColor="blue"
              isFavorite={favorites.includes(item.title)}
              onFavorite={() => toggleFavorite(item.title)}
              onStart={() => handleStart(item.title)}
            />
          );
        })}
      </div>

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
