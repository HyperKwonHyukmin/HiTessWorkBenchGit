import React, { useCallback, useMemo, useState } from 'react';
import { LayoutGrid, List, Search, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { getAppMenuName, useAnalysisPageState, useAppCatalogue, useFavorites } from '../../contexts/DashboardContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useNavigation } from '../../contexts/NavigationContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import AppSettingsModal from '../admin/AppSettingsModal';
import AppCard from '../ui/AppCard';
import AppListRow from '../ui/AppListRow';
import PageHeader from '../ui/PageHeader';
import FilterTabs from '../ui/FilterTabs';
import AnimatedGrid from '../ui/AnimatedGrid';
import AdminGateModal from '../ui/AdminGateModal';
import FeedbackState from '../ui/FeedbackState';
import Input from '../ui/Input';
import { staggerContainer, cardEntrance } from '../../utils/motion';

const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';

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
const matchesSearch = (item, query) => {
  if (!query) return true;
  const source = [
    item.title,
    item.description,
    item.category,
    item.contributor,
    ...(item.tags || []),
    ...(item.sampleFiles || []).flatMap(sample => [sample.label, sample.guideTitle]),
    ...(item.relatedApps || []),
    ...(item.inputFormats || []),
    ...(item.outputFormats || []),
    item.workflow,
  ].filter(Boolean).join(' ').toLowerCase();

  return source.includes(query);
};

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
  const { favorites, toggleFavorite } = useFavorites();
  const { setAssessmentPageState, clearAnalysisPageState } = useAnalysisPageState();
  const [activeCategory, setActiveCategory] = useState('All');
  const [gateApp, setGateApp] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('hitess_app_view_mode') ?? 'grid');
  const [searchTerm, setSearchTerm] = useState('');

  // 관리자 오버라이드가 반영된 실효 카탈로그를 쓴다(ANALYSIS_DATA 직접 참조 금지 —
  // 그러면 App Settings 에서 바꾼 상태가 목록에 반영되지 않는다).
  const { apps: catalogue, getBlock } = useAppCatalogue();
  const overrides = useAppSettings();
  const isAdmin = getIsAdmin();
  const [settingsTitle, setSettingsTitle] = useState(null);

  const apps = useMemo(
    () => catalogue.filter(item => item.mode === mode),
    [catalogue, mode],
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const searchedApps = useMemo(
    () => apps.filter(item => matchesSearch(item, normalizedSearch)),
    [apps, normalizedSearch],
  );
  const categories = useMemo(() => {
    const categorySet = new Set(apps.map(item => item.category));
    const orderedCategories = mode === 'File'
      ? [
          ...FILE_CATEGORY_ORDER.filter(category => categorySet.has(category)),
          ...[...categorySet].filter(category => !FILE_CATEGORY_ORDER.includes(category)),
        ]
      : [...categorySet];
    return ['All', ...orderedCategories];
  }, [apps, mode]);
  const categoryCounts = useMemo(() => {
    const counts = { All: searchedApps.length };
    categories.forEach(category => {
      if (category === 'All') return;
      counts[category] = searchedApps.filter(item => item.category === category).length;
    });
    return counts;
  }, [categories, searchedApps]);
  const filtered = useMemo(
    () => activeCategory === 'All' ? searchedApps : searchedApps.filter(item => item.category === activeCategory),
    [activeCategory, searchedApps],
  );
  const activeApps = useMemo(
    () => filtered.filter(item => !item.devStatus || item.devStatus === 'Active'),
    [filtered],
  );
  const developingApps = useMemo(
    () => filtered.filter(item => item.devStatus && item.devStatus !== 'Active'),
    [filtered],
  );

  const handleViewMode = useCallback((nextMode) => {
    setViewMode(nextMode);
    localStorage.setItem('hitess_app_view_mode', nextMode);
  }, []);

  const handleStart = useCallback((appTitle) => {
    const appMeta = catalogue.find(a => a.title === appTitle);
    const block = appMeta && !getIsAdmin() ? getBlock(appMeta) : null;
    if (block) {
      setGateApp({
        title: appMeta.title,
        devStatus: appMeta.devStatus,
        reason: block.reason,
        message: block.message,
      });
      return;
    }
    const menuName = getAppMenuName(appTitle);
    // 실제 페이지가 등록된 앱(hasPage)은 Developing 상태여도 진입 허용(관리자 게이트는 위에서 처리).
    // 페이지가 없는 미구현 앱만 '준비 중' 안내. (menuName===title 은 대부분 앱이 충족하므로 판별 기준으로 부적합)
    if (!appMeta?.hasPage && appMeta?.devStatus && appMeta.devStatus !== 'Active') {
      showToast(`'${appTitle}' 앱은 현재 준비 중입니다.`, 'info');
      return;
    }
    if (appMeta?.hasPage) {
      sessionStorage.setItem(ANALYSIS_MENU_FRESH_ENTRY_KEY, JSON.stringify({ menu: menuName, at: Date.now() }));
      window.dispatchEvent(new CustomEvent('workbench:analysis-fresh-entry', { detail: { menu: menuName } }));
      clearAnalysisPageState?.(appMeta.title);
    }
    if (appTitle === 'Truss Structural Assessment' && setAssessmentPageState) {
      setAssessmentPageState({});
    }
    setCurrentMenu(menuName);
  }, [catalogue, clearAnalysisPageState, getBlock, setAssessmentPageState, setCurrentMenu, showToast]);

  const makeAppProps = useCallback((item) => {
    const IconComponent = item.icon;
    const isRestricted = !isAdmin && Boolean(getBlock(item));
    return {
      app: {
        title: item.title,
        description: item.description,
        icon: <IconComponent className="text-white" size={viewMode === 'list' ? 20 : 24} />,
        iconBg: item.color,
        tags: item.tags,
        inputFormats: item.inputFormats || [],
        outputFormats: item.outputFormats || [],
        devStatus: item.devStatus,
        contributor: item.contributor,
      },
      accentColor: colorToAccent(item.color),
      isRestricted,
      isFavorite: favorites.includes(item.title),
      onFavorite: () => toggleFavorite(item.title),
      onStart: () => handleStart(item.title),
      // 관리자에게만 톱니바퀴가 붙는다.
      onSettings: isAdmin ? () => setSettingsTitle(item.title) : undefined,
    };
  }, [favorites, getBlock, handleStart, isAdmin, toggleFavorite, viewMode]);

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
      <AnimatedGrid className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-start gap-6 ${dimmed ? 'opacity-60' : ''}`}>
        {sectionApps.map(item => <AppCard key={item.title} {...makeAppProps(item)} />)}
      </AnimatedGrid>
    );
  };

  const viewToggle = (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      <button
        onClick={() => handleViewMode('grid')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
        title="Grid view"
      >
        <LayoutGrid size={15} />
      </button>
      <button
        onClick={() => handleViewMode('list')}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
        title="List view"
      >
        <List size={15} />
      </button>
    </div>
  );

  const EmptyStateIcon = EmptyIcon || HeaderIcon;
  const hasFilteredResults = activeApps.length > 0 || developingApps.length > 0;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      <PageHeader
        title={title}
        icon={HeaderIcon}
        subtitle={subtitle}
        accentColor={accentColor}
      />

      {apps.length === 0 ? (
        <FeedbackState
          icon={EmptyStateIcon}
          title={emptyTitle || '준비 중인 앱이 곧 추가될 예정입니다.'}
          message={emptySubtitle}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full lg:max-w-md">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="앱, 파일 형식, 태그, 담당자로 검색"
                leftIcon={Search}
                aria-label="앱 검색"
              />
            </div>
            <div className="flex items-center justify-between gap-3 lg:justify-end">
              <span className="text-xs font-bold text-slate-500">
                {filtered.length} / {apps.length} apps
              </span>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
                >
                  <X size={14} />
                  검색 초기화
                </button>
              )}
            </div>
          </div>

          <FilterTabs
            categories={categories}
            active={activeCategory}
            onChange={setActiveCategory}
            counts={categoryCounts}
            rightSlot={viewToggle}
          />

          {!hasFilteredResults ? (
            <FeedbackState
              icon={Search}
              title="검색 결과가 없습니다."
              message="검색어를 줄이거나 다른 카테고리를 선택해 보세요."
            />
          ) : (
            <>
              {renderSection(activeApps)}
              {developingApps.length > 0 && (
                <>
                  {activeApps.length > 0 && (
                    <div className="flex items-center gap-3 my-8">
                      <div className="flex-1 border-t border-slate-200" />
                      <span className="text-xs font-bold text-slate-500">개발 중</span>
                      <div className="flex-1 border-t border-slate-200" />
                    </div>
                  )}
                  {renderSection(developingApps, activeApps.length > 0)}
                </>
              )}
            </>
          )}
        </>
      )}

      <AdminGateModal
        isOpen={!!gateApp}
        onClose={() => setGateApp(null)}
        appTitle={gateApp?.title}
        devStatus={gateApp?.devStatus}
        reason={gateApp?.reason}
        message={gateApp?.message}
      />

      {isAdmin && (
        <AppSettingsModal
          isOpen={Boolean(settingsTitle)}
          onClose={() => setSettingsTitle(null)}
          app={settingsTitle ? catalogue.find(a => a.title === settingsTitle) : null}
          setting={settingsTitle ? overrides[settingsTitle] : undefined}
        />
      )}
    </div>
  );
}

