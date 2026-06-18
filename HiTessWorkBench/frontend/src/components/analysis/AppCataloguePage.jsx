import React, { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboard, ANALYSIS_DATA, getAppMenuName } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import AppCard from '../ui/AppCard';
import AppListRow from '../ui/AppListRow';
import PageHeader from '../ui/PageHeader';
import FilterTabs from '../ui/FilterTabs';
import AnimatedGrid from '../ui/AnimatedGrid';
import AdminGateModal from '../ui/AdminGateModal';
import { staggerContainer, cardEntrance } from '../../utils/motion';

const colorToAccent = (colorClass = '') => {
  if (colorClass.includes('cyan')) return 'cyan';
  if (colorClass.includes('violet')) return 'violet';
  if (colorClass.includes('emerald')) return 'emerald';
  if (colorClass.includes('indigo')) return 'indigo';
  if (colorClass.includes('teal')) return 'teal';
  if (colorClass.includes('amber')) return 'amber';
  if (colorClass.includes('purple')) return 'purple';
  return 'blue';
};

const FILE_CATEGORY_ORDER = ['Truss', 'Pipe', 'Lifting', 'Mooring Fitting', 'Passage', 'PDF'];

export default function AppCataloguePage({
  mode,
  title,
  subtitle,
  icon: HeaderIcon,
  accentColor = 'blue',
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptySubtitle,
}) {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const { favorites, toggleFavorite, setAssessmentPageState } = useDashboard();
  const [activeCategory, setActiveCategory] = useState('All');
  const [gateApp, setGateApp] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('hitess_app_view_mode') ?? 'grid');

  const apps = ANALYSIS_DATA.filter(item => item.mode === mode);
  const categorySet = new Set(apps.map(item => item.category));
  const orderedCategories = mode === 'File'
    ? [
        ...FILE_CATEGORY_ORDER.filter(category => categorySet.has(category)),
        ...[...categorySet].filter(category => !FILE_CATEGORY_ORDER.includes(category)),
      ]
    : [...categorySet];
  const categories = ['All', ...orderedCategories];
  const filtered = activeCategory === 'All' ? apps : apps.filter(item => item.category === activeCategory);
  const activeApps = filtered.filter(item => !item.devStatus || item.devStatus === 'Active');
  const developingApps = filtered.filter(item => item.devStatus && item.devStatus !== 'Active');

  const handleViewMode = (nextMode) => {
    setViewMode(nextMode);
    localStorage.setItem('hitess_app_view_mode', nextMode);
  };

  const handleStart = (appTitle) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === appTitle);
    if (appMeta && (appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    const menuName = getAppMenuName(appTitle);
    // 실제 페이지가 등록된 앱(hasPage)은 Developing 상태여도 진입 허용(관리자 게이트는 위에서 처리).
    // 페이지가 없는 미구현 앱만 '준비 중' 안내. (menuName===title 은 대부분 앱이 충족하므로 판별 기준으로 부적합)
    if (!appMeta?.hasPage && appMeta?.devStatus && appMeta.devStatus !== 'Active') {
      showToast(`'${appTitle}' 앱은 현재 준비 중입니다.`, 'info');
      return;
    }
    if (appTitle === 'Truss Structural Assessment' && setAssessmentPageState) {
      setAssessmentPageState({});
    }
    setCurrentMenu(menuName);
  };

  const makeAppProps = (item) => {
    const IconComponent = item.icon;
    const isRestricted = (item.devStatus === 'Developing' || item.devStatus === 'Planned') && !getIsAdmin();
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
      accentColor: colorToAccent(item.color),
      isRestricted,
      isFavorite: favorites.includes(item.title),
      onFavorite: () => toggleFavorite(item.title),
      onStart: () => handleStart(item.title),
    };
  };

  const renderSection = (sectionApps, dimmed = false) => {
    if (sectionApps.length === 0) return null;
    if (viewMode === 'list') {
      return (
        <motion.div
          className={`flex flex-col gap-2.5 ${dimmed ? 'opacity-60' : ''}`}
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {sectionApps.map(item => (
            <motion.div key={item.title} variants={cardEntrance}>
              <AppListRow {...makeAppProps(item)} />
            </motion.div>
          ))}
        </motion.div>
      );
    }
    return (
      <AnimatedGrid className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${dimmed ? 'opacity-60' : ''}`}>
        {sectionApps.map(item => <AppCard key={item.title} {...makeAppProps(item)} />)}
      </AnimatedGrid>
    );
  };

  const viewToggle = (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      <button
        onClick={() => handleViewMode('grid')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
        title="Grid view"
      >
        <LayoutGrid size={15} />
      </button>
      <button
        onClick={() => handleViewMode('list')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
        title="List view"
      >
        <List size={15} />
      </button>
    </div>
  );

  const EmptyStateIcon = EmptyIcon || HeaderIcon;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      <PageHeader
        title={title}
        icon={HeaderIcon}
        subtitle={subtitle}
        accentColor={accentColor}
      />

      {apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <EmptyStateIcon size={48} className="text-slate-200 mb-4" />
          <p className="font-bold text-slate-500 text-sm">{emptyTitle || '준비 중인 앱이 곧 추가될 예정입니다.'}</p>
          {emptySubtitle && <p className="text-xs mt-1">{emptySubtitle}</p>}
        </div>
      ) : (
        <>
          <FilterTabs categories={categories} active={activeCategory} onChange={setActiveCategory} rightSlot={viewToggle} />
          {renderSection(activeApps)}
          {developingApps.length > 0 && (
            <>
              {activeApps.length > 0 && (
                <div className="flex items-center gap-3 my-8">
                  <div className="flex-1 border-t border-slate-200" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">개발 중</span>
                  <div className="flex-1 border-t border-slate-200" />
                </div>
              )}
              {renderSection(developingApps, activeApps.length > 0)}
            </>
          )}
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
