import React, { useState } from 'react';
import { UploadCloud, LayoutGrid, List } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import AppListRow from '../../components/ui/AppListRow';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import AdminGateModal from '../../components/ui/AdminGateModal';
import GuideButton from '../../components/ui/GuideButton';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import { staggerContainer, cardEntrance } from '../../utils/motion';

export default function NewAnalysis() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite, setAssessmentPageState } = useDashboard();
  const [gateApp, setGateApp] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('hitess_app_view_mode') ?? 'grid');

  const handleViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('hitess_app_view_mode', mode);
  };

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
    } else if (categoryTitle === "HiTESS Model Builder") {
      setCurrentMenu('HiTESS Model Builder');
    } else if (categoryTitle === "Group & Module Unit 권상 구조 해석") {
      setCurrentMenu('Group & Module Unit 권상 구조 해석');
    } else if (categoryTitle === "HP-SCR 배관응력 해석") {
      setCurrentMenu('HP-SCR 배관응력 해석');
    } else if (categoryTitle === "DrawingToAnalysis") {
      setCurrentMenu('DrawingToAnalysis');
    } else {
      showToast(`${categoryTitle} 기능은 현재 준비 중입니다.`, 'info');
    }
  };

  const fileBasedData = ANALYSIS_DATA.filter(item => item.mode === "File");
  const categories = ["All", ...new Set(fileBasedData.map(item => item.category))];
  const filtered = activeCategory === "All"
    ? fileBasedData
    : fileBasedData.filter(item => item.category === activeCategory);

  const activeApps = filtered.filter(item => !item.devStatus || item.devStatus === 'Active');
  const developingApps = filtered.filter(item => item.devStatus && item.devStatus !== 'Active');

  // item.color ('bg-cyan-600' 등) → accentColor 토큰 추출
  const colorToAccent = (colorClass = '') => {
    if (colorClass.includes('cyan'))    return 'cyan';
    if (colorClass.includes('violet'))  return 'violet';
    if (colorClass.includes('emerald')) return 'emerald';
    if (colorClass.includes('indigo'))  return 'indigo';
    if (colorClass.includes('teal'))    return 'teal';
    if (colorClass.includes('amber'))   return 'amber';
    if (colorClass.includes('purple'))  return 'purple';
    return 'blue';
  };

  const makeAppProps = (item) => {
    const IconComponent = item.icon;
    const accentColor   = colorToAccent(item.color);
    const isRestricted  = (item.devStatus === 'Developing' || item.devStatus === 'Planned') && !getIsAdmin();
    return {
      app: {
        title: item.title,
        description: item.description,
        icon: <IconComponent className="text-white" size={viewMode === 'list' ? 20 : 24} />,
        iconBg: item.color,
        tags: item.tags,
        devStatus: item.devStatus,
        contributor: item.contributor,
      },
      accentColor,
      isRestricted,
      isFavorite: favorites.includes(item.title),
      onFavorite: () => toggleFavorite(item.title),
      onStart: () => handleStart(item.title),
    };
  };

  const renderSection = (apps, dimmed = false) => {
    if (apps.length === 0) return null;
    if (viewMode === 'list') {
      return (
        <motion.div
          className={`flex flex-col gap-2.5 ${dimmed ? 'opacity-60' : ''}`}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {apps.map(item => (
            <motion.div key={item.title} variants={cardEntrance}>
              <AppListRow {...makeAppProps(item)} />
            </motion.div>
          ))}
        </motion.div>
      );
    }
    return (
      <AnimatedGrid className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${dimmed ? 'opacity-60' : ''}`}>
        {apps.map(item => (
          <AppCard key={item.title} {...makeAppProps(item)} />
        ))}
      </AnimatedGrid>
    );
  };

  const viewToggle = (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      <button
        onClick={() => handleViewMode('grid')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <LayoutGrid size={15} />
      </button>
      <button
        onClick={() => handleViewMode('list')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <List size={15} />
      </button>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto pb-16">

      <PageHeader
        title="File-Based Apps"
        icon={UploadCloud}
        subtitle="수행하고자 하는 파일 업로드 기반 해석 모델을 선택하십시오."
        actions={<GuideButton guideTitle="[파일] File-Based Apps — 도구 소개" variant="dark" />}
      />

      <FilterTabs
        categories={categories}
        active={activeCategory}
        onChange={setActiveCategory}
        rightSlot={viewToggle}
      />

      {renderSection(activeApps)}

      {developingApps.length > 0 && (
        <>
          <div className="flex items-center gap-3 my-8">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">개발 중</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>
          {renderSection(developingApps, true)}
        </>
      )}

      <AdminGateModal
        isOpen={!!gateApp}
        onClose={() => setGateApp(null)}
        appTitle={gateApp?.title}
        devStatus={gateApp?.devStatus}
      />

    </div>
  );
}
