import React, { useState } from 'react';
import { SlidersHorizontal, LayoutGrid, List } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import AppCard from '../../components/ui/AppCard';
import AppListRow from '../../components/ui/AppListRow';
import PageHeader from '../../components/ui/PageHeader';
import FilterTabs from '../../components/ui/FilterTabs';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import GuideButton from '../../components/ui/GuideButton';
import AdminGateModal from '../../components/ui/AdminGateModal';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import { staggerContainer, cardEntrance } from '../../utils/motion';

export default function ParametricApps() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();
  const [gateApp, setGateApp] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('hitess_app_view_mode') ?? 'grid');

  const handleViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('hitess_app_view_mode', mode);
  };

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
  const filtered = activeCategory === "All"
    ? parametricData
    : parametricData.filter(item => item.category === activeCategory);

  const activeApps = filtered.filter(item => !item.devStatus || item.devStatus === 'Active');
  const developingApps = filtered.filter(item => item.devStatus && item.devStatus !== 'Active');

  const makeAppProps = (item) => {
    const IconComponent = item.icon;
    const iconColorClass = item.color.replace('bg-', 'text-');
    const isRestricted = (item.devStatus === 'Developing' || item.devStatus === 'Planned') && !getIsAdmin();
    return {
      app: {
        title: item.title,
        description: item.description,
        icon: <IconComponent className={iconColorClass} size={viewMode === 'list' ? 22 : 28} />,
        iconBg: item.color,
        tags: item.tags,
        devStatus: item.devStatus,
        contributor: item.contributor,
      },
      accentColor: 'emerald',
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
      <AnimatedGrid className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${dimmed ? 'opacity-60' : ''}`}>
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
        title="Parametric Apps"
        icon={SlidersHorizontal}
        subtitle="설계 파라미터를 직접 입력하여 계산 결과를 즉시 확인하세요."
        accentColor="emerald"
        actions={<GuideButton guideTitle="[파라메트릭] Parametric Apps — 도구 소개" variant="dark" />}
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
