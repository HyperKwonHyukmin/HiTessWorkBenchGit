import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid, Layers, List, Search, Star, X } from 'lucide-react';
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
import { buildCatalogueGroups } from '../../utils/appCatalogueGroups';

const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
// '개발 중' 섹션 펼침 여부 — 기본은 접힘. 이 페이지는 오늘 쓸 앱을 고르는 곳이고,
// 아직 못 쓰는 앱이 화면 절반을 차지하면 목적이 흐려진다.
const DEV_SECTION_KEY = 'hitess_dev_section_open';

/**
 * 그룹 섹션 소제목. '개발 중' 헤더와 같은 시각 언어(굵은 slate-700)를 쓰되, 누르는 곳이
 * 아니므로 버튼 껍데기 없이 구분선만 곁들인다.
 *
 * 개수는 일부러 붙이지 않는다 — 펼쳐진 섹션은 카드가 곧 개수이고, 필터 탭의 숫자는 개발 중까지
 * 포함한 전체라 나란히 두면 '배관 2 / 배관 1' 처럼 어긋나 보인다. 개수가 필요한 곳은 내용이
 * 보이지 않는 접힌 '개발 중' 섹션뿐이다.
 */
function SectionHeading({ label }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <h3 className="text-sm font-bold text-slate-700">{label}</h3>
      <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
    </div>
  );
}

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

// 탭 노출 순서. 카테고리는 '무엇을 해석하는가' 한 축으로 통일해 3개로 묶었다
// (이전 7개는 구조물·공정·파일형식이 축으로 섞여 있었고 5개가 항목 1개짜리였다).
const FILE_CATEGORY_ORDER = ['구조 모델', '배관', '권상·의장', '운송'];
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
  const [devOpen, setDevOpen] = useState(() => localStorage.getItem(DEV_SECTION_KEY) === 'open');

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
  // 즐겨찾기를 목록 맨 위로 올린다. 별을 눌러도 화면이 그대로면 사용자는 저장이 됐는지
  // 알 수 없고, 매일 같은 앱만 쓰는 실무자에게 가장 값싼 가속기가 보상 없이 방치된다.
  const sortFavoritesFirst = useCallback(
    (list) => [...list].sort((a, b) => {
      const diff = (favorites.includes(b.title) ? 1 : 0) - (favorites.includes(a.title) ? 1 : 0);
      return diff !== 0 ? diff : 0; // 동순위는 카탈로그 정의 순서를 유지한다.
    }),
    [favorites],
  );
  // File 모드만 그룹으로 보여준다. 다른 모드는 카테고리당 앱이 1~2개뿐이라
  // 소제목을 붙이면 앱 1개짜리 제목만 늘어나 오히려 시끄러워진다.
  const isGroupedCatalogue = mode === 'File';
  const activeApps = useMemo(
    () => {
      const list = filtered.filter(item => !item.devStatus || item.devStatus === 'Active');
      // 그룹 모드에서는 즐겨찾기를 맨 위 별도 섹션으로 빼므로, 목록 자체는 정의 순서를
      // 지켜야 Truss 처럼 붙어 있어야 할 앱이 갈라지지 않는다.
      return isGroupedCatalogue ? list : sortFavoritesFirst(list);
    },
    [filtered, isGroupedCatalogue, sortFavoritesFirst],
  );
  const groupedActive = useMemo(
    () => (isGroupedCatalogue
      ? buildCatalogueGroups(activeApps, { favorites, categoryOrder: FILE_CATEGORY_ORDER })
      : null),
    [activeApps, favorites, isGroupedCatalogue],
  );
  const developingApps = useMemo(
    () => sortFavoritesFirst(filtered.filter(item => item.devStatus && item.devStatus !== 'Active')),
    [filtered, sortFavoritesFirst],
  );

  const handleDevToggle = useCallback(() => {
    setDevOpen(prev => {
      const next = !prev;
      localStorage.setItem(DEV_SECTION_KEY, next ? 'open' : 'closed');
      return next;
    });
  }, []);

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

  // 흐림(opacity) 처리는 쓰지 않는다 — 상태는 카드의 '개발중' 배지가 말하고,
  // 흐림은 대비만 떨어뜨린다(slate-500 본문이 60%면 실효 대비 2.6:1).
  const renderSection = (sectionApps) => {
    if (sectionApps.length === 0) return null;
    if (viewMode === 'list') {
      return (
        <motion.div
          className="flex flex-col gap-2.5"
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
      <AnimatedGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-start gap-6">
        {sectionApps.map(item => <AppCard key={item.title} {...makeAppProps(item)} />)}
      </AnimatedGrid>
    );
  };

  // 서비스 중인 앱을 즐겨찾기 → 카테고리 → series 묶음 순으로 그린다.
  // 개발 중 앱은 여기 들어오지 않는다 — 아래 별도 섹션에 따로 모으고, 서비스로 전환되면
  // devStatus 만 바뀌어도 자연히 이 그룹 체계에 편입된다.
  // 묶음 상자는 카드를 여러 장 품으므로 그리드에서 그만큼 폭을 차지해야 한다. 그래야 상자와
  // 단독 앱이 같은 행을 나눠 쓰고 오른쪽에 빈 칸이 남지 않는다.
  // (예전에는 상자와 단독 앱을 각각 별도 그리드로 그려서, 3열에 다 들어갈 3장을 2줄로 쌓았다.)
  const seriesSpanClass = (count) => {
    if (count <= 1) return '';
    if (count === 2) return 'md:col-span-2 lg:col-span-2';
    return 'md:col-span-2 lg:col-span-3';
  };

  const renderSeriesLabel = (series) => (
    <p className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-600">
      <Layers size={13} aria-hidden="true" />
      {series}
    </p>
  );

  const renderCategoryBody = (category) => {
    // 목록 뷰는 한 줄에 하나씩이라 그리드를 합칠 이유가 없다. 기존 구조를 그대로 쓴다.
    if (viewMode === 'list') {
      return (
        <div className="flex flex-col gap-5">
          {category.seriesClusters.map(cluster => (
            <div key={cluster.series} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              {renderSeriesLabel(cluster.series)}
              {renderSection(cluster.apps)}
            </div>
          ))}
          {category.singles.length > 0 && renderSection(category.singles)}
        </div>
      );
    }
    // col-span 은 그리드 자식에 붙어야 한다. AnimatedGrid 는 자식을 래퍼로 한 번 더 감싸
    // 폭 지정이 먹지 않으므로, 여기서는 같은 variants 로 그리드를 직접 구성한다.
    return (
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-start gap-6"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {category.seriesClusters.map(cluster => (
          <motion.div
            key={cluster.series}
            variants={cardEntrance}
            className={seriesSpanClass(cluster.apps.length)}
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              {renderSeriesLabel(cluster.series)}
              <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-5">
                {cluster.apps.map(item => <AppCard key={item.title} {...makeAppProps(item)} />)}
              </div>
            </div>
          </motion.div>
        ))}
        {category.singles.map(item => (
          <motion.div key={item.title} variants={cardEntrance} className="h-full">
            <AppCard {...makeAppProps(item)} />
          </motion.div>
        ))}
      </motion.div>
    );
  };

  const renderGroupedActive = (groups) => (
    <div className="flex flex-col gap-8">
      {groups.favoriteApps.length > 0 && (
        // 즐겨찾기는 카드를 다시 그리지 않고 칩 한 줄로 압축한다. 같은 카드를 두 번 그리면
        // 화면만 길어지는데, 여기서 필요한 건 '자주 쓰는 앱으로 바로 가기' 하나뿐이다.
        // 앱은 원래 카테고리 자리에 그대로 남아 Truss 같은 묶음에 구멍이 나지 않는다.
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Star size={13} className="text-amber-400" fill="currentColor" aria-hidden="true" />
            즐겨찾기
          </span>
          {groups.favoriteApps.map(item => (
            <button
              key={item.title}
              type="button"
              onClick={() => handleStart(item.title)}
              aria-label={`${item.title} 열기`}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:border-brand-blue/40 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
      {groups.categories.map(category => (
        <section key={category.name}>
          {/* 카테고리 탭을 고른 상태에서는 제목이 탭과 중복되므로 생략한다. */}
          {activeCategory === 'All' && <SectionHeading label={category.name} />}
          {renderCategoryBody(category)}
        </section>
      ))}
    </div>
  );

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
              {isGroupedCatalogue && groupedActive
                ? renderGroupedActive(groupedActive)
                : renderSection(activeApps)}
              {developingApps.length > 0 && (
                <div className={activeApps.length > 0 ? 'mt-10' : ''}>
                  <button
                    type="button"
                    onClick={handleDevToggle}
                    aria-expanded={devOpen}
                    className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                  >
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-slate-500 transition-transform duration-200 ${devOpen ? '' : '-rotate-90'}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-bold text-slate-700">개발 중</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                      {developingApps.length}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">
                      {devOpen ? '접기' : '펼쳐 보기'}
                    </span>
                  </button>
                  {devOpen && renderSection(developingApps)}
                </div>
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

