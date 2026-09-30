import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock, LayoutGrid, List, Search, Star, X } from 'lucide-react';
import { findAppByAnyName, getAppMenuName, useAnalysisPageState, useAppCatalogue, useFavorites } from '../../contexts/DashboardContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useNavigation } from '../../contexts/NavigationContext';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import AppSettingsModal from '../admin/AppSettingsModal';
import AppCard from '../ui/AppCard';
import AppListRow, { AppListHeader } from '../ui/AppListRow';
import FilterTabs from '../ui/FilterTabs';
import AdminGateModal from '../ui/AdminGateModal';
import FeedbackState from '../ui/FeedbackState';
import { buildCatalogueGroups, buildCategoryTabs } from '../../utils/appCatalogueGroups';

const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
// '개발 중' 섹션 펼침 여부 — 기본은 접힘. 이 페이지는 오늘 쓸 앱을 고르는 곳이고,
// 아직 못 쓰는 앱이 화면 절반을 차지하면 목적이 흐려진다.
const DEV_SECTION_KEY = 'hitess_dev_section_open';
// 보기 방식(카드/목록). 기본은 카드. 예전 키 'hitess_app_view_mode' 는 일부러 읽지 않는다 —
// 개편 전 화면에서 고른 값이라 그대로 따르면 새 기본 화면을 한 번도 못 보는 사용자가 생긴다.
const VIEW_MODE_KEY = 'hitess_app_view_mode_v2';

// 머리글 오른쪽의 개수 칩 — 대시보드 인사 줄의 상태 칩과 같은 모양이다.
function HeaderChip({ icon: Icon, label, value }) {
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-3 text-xs font-semibold text-white">
      <Icon size={14} className="opacity-80" aria-hidden="true" />
      <span className="text-blue-100">{label}</span>
      <span className="text-sm font-extrabold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * 카드의 '연계' 한 줄. 같은 series 안의 앞뒤 단계가 있으면 그것(이전/다음), 없으면 relatedApps.
 * 카탈로그 전체(모든 모드)에서 찾는다 — 연계 앱이 다른 모드에 있어도 이름은 보여 준다.
 */
function buildLink(item, catalogue) {
  if (item.series) {
    const chain = catalogue.filter(a => a.mode === item.mode && a.series === item.series);
    const index = chain.findIndex(a => a.title === item.title);
    if (index > 0) return { label: '이전', names: [chain[index - 1].title] };
    if (index >= 0 && index < chain.length - 1) return { label: '다음', names: [chain[index + 1].title] };
  }
  const related = (item.relatedApps || []).filter(Boolean);
  return related.length ? { label: '연계', names: related } : null;
}

// 페이지 머리글 아이콘 타일 — 앱 데이터의 모드 시그니처 색(ANALYSIS_DATA color)과 같은 값이다.
const MODE_TILE = {
  blue: 'bg-blue-600',
  violet: 'bg-violet-600',
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
};

// 목록 한 장. 대시보드의 '내 작업' 카드와 같은 문법(흰 표면·1px 테두리·행 구분선)이다.
function ListSurface({ children }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {children}
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
  const [viewMode, setViewMode] = useState(() => (localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid'));
  const [searchTerm, setSearchTerm] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const { recentApps } = useRecentActivity();
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
  // 즐겨찾기가 하나도 없으면 '즐겨찾기만' 은 의미가 없으니 꺼진 것으로 본다
  // (켜 둔 채 마지막 별을 풀어도 빈 화면에 갇히지 않는다).
  const hasFavorites = useMemo(
    () => apps.some(item => favorites.includes(item.title)),
    [apps, favorites],
  );
  const showFavoritesOnly = favoritesOnly && hasFavorites;
  const scopedApps = useMemo(
    () => (showFavoritesOnly ? searchedApps.filter(item => favorites.includes(item.title)) : searchedApps),
    [favorites, searchedApps, showFavoritesOnly],
  );
  // 탭 숫자는 '그 탭을 누르면 지금 보이는 앱 수' 다(개발 중은 섹션을 펼쳤을 때만 센다).
  const { categories, counts: categoryCounts } = useMemo(
    () => buildCategoryTabs(scopedApps, {
      categoryOrder: mode === 'File' ? FILE_CATEGORY_ORDER : [],
      includeDeveloping: devOpen,
    }),
    [devOpen, mode, scopedApps],
  );
  // 고른 탭이 사라졌으면(검색·즐겨찾기·개발 중 접기) All 로 본다.
  const effectiveCategory = categories.includes(activeCategory) ? activeCategory : 'All';
  const filtered = useMemo(
    () => (effectiveCategory === 'All' ? scopedApps : scopedApps.filter(item => item.category === effectiveCategory)),
    [effectiveCategory, scopedApps],
  );
  // 앱별 마지막 방문 시각(최근 사용 기록은 최신순, 최대 8건).
  const lastUsedAt = useMemo(() => {
    const map = Object.create(null);
    for (const item of recentApps || []) {
      const found = findAppByAnyName(item.label || item.menu);
      if (found && map[found.title] === undefined) map[found.title] = item.at;
    }
    return map;
  }, [recentApps]);
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
  const activeCardEntries = useMemo(() => {
    if (!groupedActive) return activeApps.map(item => ({ item, continuesPrevious: false }));
    return groupedActive.categories.flatMap(category => [
      ...category.seriesClusters.flatMap(cluster =>
        cluster.apps.map((item, index) => ({ item, continuesPrevious: index > 0 }))),
      ...category.singles.map(item => ({ item, continuesPrevious: false })),
    ]);
  }, [activeApps, groupedActive]);
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
    localStorage.setItem(VIEW_MODE_KEY, nextMode);
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
        category: item.category,
        art: item.art,
        icon: <IconComponent size={20} />,
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
  }, [favorites, getBlock, handleStart, isAdmin, toggleFavorite]);

  // ── 카드 뷰 ──
  // 카테고리별로 줄을 끊지 않고 한 그리드에 이어 놓는다. 앱 1개짜리 카테고리(배관·권상)에
  // 줄을 따로 주면 4칸 중 3칸이 비기 때문이다. 카테고리는 카드 아래 줄이 말하고, 탭으로 거른다.
  // 흐림(opacity) 처리는 쓰지 않는다 — 상태는 카드의 '개발중' 배지가 말하고, 흐림은 대비만 떨어뜨린다.
  const renderCards = (entries) => {
    if (entries.length === 0) return null;
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-4">
        {entries.map(({ item }) => (
          <AppCard
            key={item.title}
            {...makeAppProps(item)}
            link={buildLink(item, catalogue)}
            lastUsedAt={lastUsedAt[item.title]}
          />
        ))}
      </div>
    );
  };

  // ── 목록 뷰 ──
  const renderRow = (item, extra = {}) => {
    const { app, isRestricted, isFavorite, onFavorite, onStart, onSettings } = makeAppProps(item);
    return (
      <AppListRow
        key={item.title}
        app={app}
        isRestricted={isRestricted}
        isFavorite={isFavorite}
        lastUsedAt={lastUsedAt[item.title]}
        onFavorite={onFavorite}
        onStart={onStart}
        onSettings={onSettings}
        {...extra}
      />
    );
  };

  // 카테고리가 여러 장의 카드로 흩어지지 않게 한 장에 모으고, 카테고리는 띠 한 줄로 구분한다.
  // 앱 1개짜리 카테고리도 띠 + 한 행이라 빈 칸이 생기지 않는다.
  const renderGroupedList = (groups) => (
    <ListSurface>
      <AppListHeader />
      {groups.categories.map(category => (
        <section key={category.name} aria-label={category.name} className="divide-y divide-slate-100">
          {/* 카테고리 탭을 고른 상태에서는 띠가 탭과 중복되므로 생략한다. */}
          {effectiveCategory === 'All' && (
            <h2 className="bg-slate-50 px-4 py-1.5 text-xs font-bold text-slate-600">{category.name}</h2>
          )}
          {category.seriesClusters.map(cluster =>
            cluster.apps.map((item, index) => renderRow(item, {
              continuesPrevious: index > 0,
              leadsNext: index < cluster.apps.length - 1,
            })))}
          {category.singles.map(item => renderRow(item))}
        </section>
      ))}
    </ListSurface>
  );

  // 소제목 없는 목록(File 외 모드·개발 중 섹션). All 탭에서는 이름 옆에 카테고리를 붙인다.
  const renderFlatList = (listApps, { withHeader = true } = {}) => {
    if (listApps.length === 0) return null;
    return (
      <ListSurface>
        {withHeader && <AppListHeader />}
        {listApps.map(item => renderRow(item, { showCategory: effectiveCategory === 'All' }))}
      </ListSurface>
    );
  };

  const viewButtonClass = (active) => [
    'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer outline-none',
    'focus-visible:ring-2 focus-visible:ring-brand-blue/40',
    active ? 'bg-white shadow-sm text-slate-700' : 'text-slate-500 hover:text-slate-700',
  ].join(' ');
  const viewToggle = (
    <div className="flex h-9 items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="보기 방식">
      <button
        type="button"
        onClick={() => handleViewMode('grid')}
        className={viewButtonClass(viewMode === 'grid')}
        aria-pressed={viewMode === 'grid'}
        aria-label="카드로 보기"
        title="카드"
      >
        <LayoutGrid size={15} />
      </button>
      <button
        type="button"
        onClick={() => handleViewMode('list')}
        className={viewButtonClass(viewMode === 'list')}
        aria-pressed={viewMode === 'list'}
        aria-label="목록으로 보기"
        title="목록"
      >
        <List size={15} />
      </button>
    </div>
  );

  const EmptyStateIcon = EmptyIcon || HeaderIcon;
  const hasFilteredResults = activeApps.length > 0 || developingApps.length > 0;

  const isList = viewMode === 'list';
  const renderActive = () => {
    if (activeApps.length === 0) return null;
    if (!isList) return renderCards(activeCardEntries);
    return isGroupedCatalogue && groupedActive ? renderGroupedList(groupedActive) : renderFlatList(activeApps);
  };
  const activeCount = apps.filter(item => !item.devStatus || item.devStatus === 'Active').length;

  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      {/* 머리글 — 대시보드 인사 줄과 같은 틀(둥근 네이비 막대 + 오른쪽 칩). */}
      <header className="relative mb-4 overflow-hidden rounded-2xl border border-brand-blue/10 bg-gradient-to-r from-brand-blue via-[#07315d] to-slate-900 shadow-sm">
        {HeaderIcon && (
          <HeaderIcon
            size={96}
            className="pointer-events-none absolute -right-5 -top-6 rotate-12 text-white/[0.035]"
            aria-hidden="true"
          />
        )}
        <div className="relative flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {HeaderIcon && (
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ring-1 ring-white/20 ${MODE_TILE[accentColor] ?? MODE_TILE.blue}`}
                aria-hidden="true"
              >
                <HeaderIcon size={19} />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold tracking-tight text-white">{title}</h1>
              {subtitle && <p className="mt-0.5 text-xs font-medium text-blue-100">{subtitle}</p>}
            </div>
          </div>
          {apps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <HeaderChip icon={CheckCircle2} label="서비스 중" value={activeCount} />
              {apps.length - activeCount > 0 && (
                <HeaderChip icon={Clock} label="개발 중" value={apps.length - activeCount} />
              )}
            </div>
          )}
        </div>
      </header>

      {/* 도구줄 — 왼쪽은 무엇을 볼지(카테고리), 오른쪽은 어떻게 볼지(거르기·보기 방식). */}
      {apps.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* 카테고리가 하나뿐이면 고를 것이 없으므로 탭을 그리지 않는다. */}
          {categories.length > 2 ? (
            <FilterTabs
              dense
              categories={categories}
              active={effectiveCategory}
              onChange={setActiveCategory}
              counts={categoryCounts}
            />
          ) : <span />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-60">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="형식·태그·담당자로 거르기"
                aria-label="앱 목록 거르기"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-[13px] text-slate-800 placeholder-slate-500 outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="검색어 지우기"
                  className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {hasFavorites && (
              <button
                type="button"
                onClick={() => setFavoritesOnly(prev => !prev)}
                aria-pressed={showFavoritesOnly}
                className={[
                  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-bold transition-colors cursor-pointer outline-none',
                  'focus-visible:ring-2 focus-visible:ring-amber-400',
                  showFavoritesOnly
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                <Star
                  size={14}
                  className={showFavoritesOnly ? 'text-amber-500' : 'text-slate-400'}
                  fill={showFavoritesOnly ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
                즐겨찾기만
              </button>
            )}
            {viewToggle}
          </div>
        </div>
      )}

      {apps.length === 0 ? (
        <FeedbackState
          icon={EmptyStateIcon}
          title={emptyTitle || '준비 중인 앱이 곧 추가될 예정입니다.'}
          message={emptySubtitle}
        />
      ) : (
        <>
          {!hasFilteredResults ? (
            <FeedbackState
              icon={Search}
              title={searchTerm ? '검색 결과가 없습니다.' : '조건에 맞는 앱이 없습니다.'}
              message={searchTerm
                ? '검색어를 줄이거나 다른 카테고리를 선택해 보세요.'
                : '즐겨찾기만 보기를 끄거나 다른 카테고리를 선택해 보세요.'}
            />
          ) : (
            <>
              {renderActive()}
              {developingApps.length > 0 && (
                <div className={activeApps.length > 0 ? 'mt-5' : ''}>
                  <button
                    type="button"
                    onClick={handleDevToggle}
                    aria-expanded={devOpen}
                    className={`${isList ? 'mb-2' : 'mb-3'} flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left transition-colors hover:bg-slate-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40`}
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
                  {devOpen && (isList
                    ? renderFlatList(developingApps, { withHeader: activeApps.length === 0 })
                    : renderCards(developingApps.map(item => ({ item, continuesPrevious: false }))))}
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

