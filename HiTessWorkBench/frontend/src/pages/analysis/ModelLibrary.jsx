import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, GitCompare, RefreshCw, RotateCcw, Search, Split, X } from 'lucide-react';

import { Badge, FeedbackState, FilterTabs, PageHeader } from '../../components/ui';
import ModelDetailModal from '../../components/modelRegistry/ModelDetailModal';
import ModelCompareModal from '../../components/modelRegistry/ModelCompareModal';
import ModelInsightDashboard from '../../components/modelRegistry/ModelInsightDashboard';
import { QualityBadge } from '../../components/modelRegistry/QualityLevelGuide';
import {
  getRegisteredModel,
  getRegistryInsights,
  listRegisteredModels,
} from '../../api/modelRegistry';
import { isAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';
import {
  MODEL_FAMILIES,
  buildListParams,
  extractApiError,
  familyLabel,
  formatNumber,
  formatUtilization,
  outcomeInfo,
  qualityLabelWithCode,
  utilizationVariant,
} from '../../utils/modelRegistryUtils';

const TABS = ['등록 모델', 'Insight'];
const MAX_COMPARE = 2;

const PAGE_SIZE = 20;

const QUALITY_FILTERS = ['All', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4'];
const OUTCOME_FILTERS = [
  { value: 'All', label: '설계 결과 전체' },
  { value: 'pass', label: '통과' },
  { value: 'mixed', label: '부분 통과' },
  { value: 'fail', label: '미통과' },
  { value: 'unknown', label: '미해석' },
];
// 백엔드 값은 active/archived 지만 화면에서는 '삭제'로 부른다(modelRegistryUtils 참조).
const STATUS_FILTERS = [
  { value: 'active', label: '사용 중' },
  { value: 'archived', label: '삭제됨' },
];

// 계열 필터 — '미지정' 옵션은 두지 않는다. 이 변경 이후 신규 등록본에는 계열이 항상 채워지고,
// SQL exact-match 로는 "null 또는 어휘 밖"을 표현할 수 없다. 미지정 확인은 Insight 에서 한다.
const FAMILY_FILTERS = [
  { value: 'All', label: '전체' },
  ...MODEL_FAMILIES,
];

const SELECT_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 ' +
  'transition-colors hover:border-slate-400 ' +
  'focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20';

/**
 * Model Library — 관리자가 선별해 등록한 BDF 모델 라이브러리.
 *
 * 검색/필터/페이지네이션은 전부 서버가 처리한다(전체를 받아 클라이언트에서 거르지 않는다).
 * 등록은 각 해석 앱의 산출물 화면에서 관리자가 명시적으로 수행한다 — 여기서는 조회만 한다.
 *
 * 표 설계: 「모델 품질」과 「설계 결과」를 **그룹 헤더로 갈라 놓는다.**
 * 한 줄로 이어 붙이면 품질 등급이 설계 통과의 원인처럼 읽히는데, 둘은 독립된 축이다.
 */
export default function ModelLibrary() {
  const { showToast } = useToast();
  const canManage = isAdmin();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState('loading');   // loading | loaded | error
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('All');
  const [quality, setQuality] = useState('All');
  const [outcome, setOutcome] = useState('All');
  const [status, setStatus] = useState('active');

  const [selected, setSelected] = useState(null);   // 상세 모달 대상
  const [detailLoading, setDetailLoading] = useState(false);

  const [tab, setTab] = useState(TABS[0]);
  const [insights, setInsights] = useState(null);
  const [insightState, setInsightState] = useState('idle'); // idle | loading | loaded | error
  const [insightError, setInsightError] = useState(null);
  // Insight 하단(계열 스코프)에서 보고 있는 계열. null 이면 서버가 최다 계열을 고른다.
  const [insightFamily, setInsightFamily] = useState(null);

  // 비교 대상 — 최대 2개. uid 만 담아 두고 열 때 상세를 받아온다.
  const [compareUids, setCompareUids] = useState([]);
  const [comparePair, setComparePair] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const fetchModels = useCallback(async (signal) => {
    setState((s) => (s === 'loaded' ? 'loaded' : 'loading'));
    setError(null);
    try {
      const params = buildListParams({
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        query: search,
        modelType: family,
        qualityLevel: quality,
        designOutcome: outcome,
        status,
      });
      const res = await listRegisteredModels(params, { signal });
      if (signal?.aborted) return;
      setRows(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
      setState('loaded');
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'CanceledError') return;
      setError(extractApiError(e, '목록을 불러오지 못했습니다.').message);
      setState('error');
    }
  }, [page, search, family, quality, outcome, status]);

  // 검색어 입력은 250ms 디바운스, 필터 변경은 즉시. 이전 요청은 취소한다.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => fetchModels(controller.signal), search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fetchModels, search]);

  // 필터가 바뀌면 1페이지로 되돌린다.
  useEffect(() => { setPage(1); }, [search, family, quality, outcome, status]);

  // status 스코프가 바뀌면 계열 선택을 놓는다. 이전 계열이 새 스코프에 없으면
  // 선택기 value 가 options 에 없어 화면이 서로 다른 말을 하게 된다(서버가 최다 계열을 고른다).
  useEffect(() => { setInsightFamily(null); }, [status]);

  // Insight 는 탭을 실제로 열 때만 계산한다(목록만 볼 사람에게 부담을 주지 않는다).
  useEffect(() => {
    if (tab !== 'Insight') return undefined;
    const controller = new AbortController();
    (async () => {
      setInsightState('loading');
      setInsightError(null);
      try {
        const res = await getRegistryInsights(
          insightFamily ? { status, family: insightFamily } : { status },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setInsights(res.data);
        setInsightState('loaded');
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'CanceledError') return;
        setInsightError(extractApiError(e, '통계를 불러오지 못했습니다.').message);
        setInsightState('error');
      }
    })();
    return () => controller.abort();
  }, [tab, status, insightFamily]);

  const toggleCompare = (uid) => {
    setCompareUids((prev) => {
      if (prev.includes(uid)) return prev.filter((u) => u !== uid);
      if (prev.length >= MAX_COMPARE) {
        showToast(`비교는 최대 ${MAX_COMPARE}개까지 선택할 수 있습니다.`, 'info');
        return prev;
      }
      return [...prev, uid];
    });
  };

  const openCompare = async () => {
    if (compareUids.length !== MAX_COMPARE) return;
    setCompareLoading(true);
    try {
      const [left, right] = await Promise.all(
        compareUids.map((uid) => getRegisteredModel(uid).then((r) => r.data)),
      );
      setComparePair({ left, right });
    } catch (e) {
      showToast(extractApiError(e, '비교 대상을 불러오지 못했습니다.').message, 'error');
    } finally {
      setCompareLoading(false);
    }
  };

  /**
   * 상세 열기.
   *
   * `keepOpen` 은 **이미 모달이 떠 있는 상태에서 다른 모델로 갈아탈 때** 쓴다.
   * 그때도 detailLoading 을 켜면 모달이 통째로 닫혔다 다시 열려 화면이 번쩍인다
   * (`isOpen` 이 `!detailLoading` 에 걸려 있기 때문). 이전 내용을 잠깐 더 두고 교체한다.
   */
  const openDetail = async (modelUid, { keepOpen = false } = {}) => {
    if (!keepOpen) setDetailLoading(true);
    try {
      const res = await getRegisteredModel(modelUid);
      setSelected(res.data);
    } catch (e) {
      showToast(extractApiError(e, '상세 정보를 불러오지 못했습니다.').message, 'error');
    } finally {
      if (!keepOpen) setDetailLoading(false);
    }
  };

  const refresh = () => {
    const controller = new AbortController();
    fetchModels(controller.signal);
  };

  const resetFilters = () => {
    setSearch('');
    setFamily('All');
    setQuality('All');
    setOutcome('All');
    setStatus('active');
  };

  const filtersActive =
    Boolean(search) || family !== 'All' || quality !== 'All' || outcome !== 'All' || status !== 'active';

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNumbers = useMemo(() => {
    const out = [];
    for (let p = 1; p <= totalPages; p += 1) {
      if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) out.push(p);
    }
    return out;
  }, [totalPages, page]);

  // 비교 칩에 제목을 보여주기 위한 조회용 맵(현재 페이지에 없으면 uid 로 폴백).
  const titleByUid = useMemo(
    () => Object.fromEntries(rows.map((m) => [m.model_uid, m.title])),
    [rows],
  );

  return (
    <div className="p-4 sm:p-5 lg:p-6">
      <PageHeader
        title="Model Library"
        icon={Database}
        subtitle="관리자가 선별해 영구 보관한 해석 모델 라이브러리 — 30일 정리 대상이 아닙니다."
        accentColor="indigo"
        actions={
          <button
            onClick={refresh}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
          >
            <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} />
            새로고침
          </button>
        }
      />

      <div className="mx-auto max-w-7xl">
        <div className="mb-4">
          <FilterTabs categories={TABS} active={tab} onChange={setTab} />
        </div>

        {tab === 'Insight' && (
          <ModelInsightDashboard
            data={insights}
            loading={insightState === 'loading'}
            error={insightError}
            onFamilyChange={setInsightFamily}
          />
        )}

        {tab === '등록 모델' && (
        <>
        {/* ── 검색 · 필터 툴바 ── */}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="ds-search" className="mb-1 block text-[11px] font-semibold text-slate-600">
                검색
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="ds-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="제목·설명 검색"
                  className={`${SELECT_CLASS} pl-9`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[720px] lg:shrink-0 lg:grid-cols-4">
              <FilterSelect
                id="ds-family"
                label="모델 계열"
                value={family}
                onChange={setFamily}
                options={FAMILY_FILTERS}
              />
              <FilterSelect
                id="ds-quality"
                label="모델 품질"
                value={quality}
                onChange={setQuality}
                options={QUALITY_FILTERS.map((k) => ({
                  value: k,
                  // 필터는 평문과 Q 코드가 둘 다 필요하다 — 문서·기존 화면과 이어져야 한다.
                  label: k === 'All' ? '전체' : qualityLabelWithCode(k),
                }))}
              />
              <FilterSelect
                id="ds-outcome"
                label="설계 결과"
                value={outcome}
                onChange={setOutcome}
                options={OUTCOME_FILTERS.map((o) => ({
                  value: o.value,
                  label: o.value === 'All' ? '전체' : o.label,
                }))}
              />
              <FilterSelect
                id="ds-status"
                label="상태"
                value={status}
                onChange={setStatus}
                options={STATUS_FILTERS}
              />
            </div>
          </div>

          {filtersActive && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-semibold text-slate-500">적용된 조건</span>
              {search && <FilterChip label={`검색 "${search}"`} onClear={() => setSearch('')} />}
              {family !== 'All' && (
                <FilterChip
                  label={familyLabel(family)}
                  onClear={() => setFamily('All')}
                />
              )}
              {quality !== 'All' && (
                <FilterChip
                  label={qualityLabelWithCode(quality)}
                  onClear={() => setQuality('All')}
                />
              )}
              {outcome !== 'All' && (
                <FilterChip
                  label={`설계 ${outcomeInfo(outcome).label}`}
                  onClear={() => setOutcome('All')}
                />
              )}
              {status !== 'active' && (
                <FilterChip label="삭제됨" onClear={() => setStatus('active')} />
              )}
              <button
                onClick={resetFilters}
                className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-brand-blue"
              >
                <RotateCcw size={11} /> 초기화
              </button>
            </div>
          )}
        </div>

        {/* ── 목록 ── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-bold text-slate-800">
              등록 모델
              {state === 'loaded' && (
                <span className="ml-2 text-xs font-medium tabular-nums text-slate-500">
                  {total.toLocaleString()}건
                </span>
              )}
            </p>
            {/* 두 축이 독립임을 표 위에서 한 번 못박는다 */}
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Split size={12} className="shrink-0 text-slate-400" />
              「모델 품질」(검증 정도)과 「설계 결과」(허용치 만족)는 서로 독립된 축입니다
            </p>
          </div>

          {state === 'loading' && (
            <FeedbackState variant="loading" title="불러오는 중…" />
          )}

          {state === 'error' && (
            <FeedbackState variant="error" title="목록을 불러오지 못했습니다" message={error} />
          )}

          {state === 'loaded' && rows.length === 0 && (
            <FeedbackState
              variant="empty"
              title={filtersActive ? '조건에 맞는 모델이 없습니다' : '등록된 모델이 없습니다'}
              message={
                filtersActive
                  ? '검색어나 필터를 바꿔 보세요.'
                  : canManage
                    ? '해석 결과 화면에서 「Model Library 에 등록」을 눌러 모델을 보관하세요.'
                    : '관리자가 모델을 등록하면 여기에 표시됩니다.'
              }
            />
          )}

          {state === 'loaded' && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  {/* 1행: 축 그룹 — 품질/설계를 시각적으로 갈라 놓는다 */}
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                    <th colSpan={4} className="px-4 py-2 text-left">모델</th>
                    <th colSpan={1} className="border-l border-slate-200 px-4 py-2 text-left">
                      모델 품질
                    </th>
                    <th colSpan={2} className="border-l border-slate-200 px-4 py-2 text-left">
                      설계 결과
                    </th>
                    <th colSpan={2} className="border-l border-slate-200 px-4 py-2 text-left">
                      출처
                    </th>
                  </tr>
                  {/* 2행: 실제 열 이름 */}
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] text-slate-500">
                    <Th className="w-10" aria-label="비교 선택" />
                    <Th>제목</Th>
                    <Th className="text-right">노드</Th>
                    <Th className="text-right">요소</Th>
                    <Th divider>등급</Th>
                    <Th divider>판정</Th>
                    <Th className="text-right">사용률</Th>
                    <Th divider>원 프로그램</Th>
                    <Th>등록일</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const o = outcomeInfo(m.design_outcome);
                    const picked = compareUids.includes(m.model_uid);
                    return (
                      <tr
                        key={m.model_uid}
                        onClick={() => openDetail(m.model_uid)}
                        className={[
                          'cursor-pointer border-b border-slate-100 transition-colors last:border-0',
                          picked ? 'bg-brand-blue/5 hover:bg-brand-blue/10' : 'hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <Td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => toggleCompare(m.model_uid)}
                            aria-label={`${m.title} 비교 선택`}
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-blue focus:ring-brand-blue/30"
                          />
                        </Td>
                        <Td>
                          <p className="font-semibold text-slate-800">{m.title}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {familyLabel(m.model_type)}
                            {m.tags?.length > 0 && ` · ${m.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}`}
                          </p>
                        </Td>
                        <Td className="text-right tabular-nums text-slate-600">
                          {formatNumber(m.node_count)}
                        </Td>
                        <Td className="text-right tabular-nums text-slate-600">
                          {formatNumber(m.element_count)}
                        </Td>
                        <Td divider><QualityBadge level={m.quality_level} /></Td>
                        <Td divider><Badge variant={o.variant} size="sm">{o.label}</Badge></Td>
                        <Td className="text-right">
                          {m.max_utilization == null ? (
                            <span className="text-slate-400">-</span>
                          ) : (
                            <Badge variant={utilizationVariant(m.max_utilization)} size="sm">
                              {formatUtilization(m.max_utilization)}
                            </Badge>
                          )}
                        </Td>
                        <Td divider className="text-xs text-slate-600">
                          {m.source_program_name || '-'}
                        </Td>
                        <Td className="text-xs tabular-nums text-slate-600">
                          {m.created_at ? new Date(m.created_at).toLocaleDateString('ko-KR') : '-'}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 페이지네이션 ── */}
        {state === 'loaded' && total > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500 tabular-nums">
              총 {total.toLocaleString()}건 · {page}/{totalPages} 페이지
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  이전
                </PageBtn>
                {pageNumbers.map((p, i) => (
                  <React.Fragment key={p}>
                    {i > 0 && pageNumbers[i - 1] !== p - 1 && (
                      <span className="px-1 text-slate-400">…</span>
                    )}
                    <PageBtn onClick={() => setPage(p)} active={p === page}>{p}</PageBtn>
                  </React.Fragment>
                ))}
                <PageBtn
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  다음
                </PageBtn>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>

      {/* ── 비교 선택 바 — 최대 2개 ── */}
      {tab === '등록 모델' && compareUids.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-xl">
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">
            {compareUids.length}/{MAX_COMPARE} 선택됨
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            {compareUids.map((uid) => (
              <span
                key={uid}
                className="flex min-w-0 items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-[11px] text-slate-600"
                title={titleByUid[uid] ?? uid}
              >
                <span className="max-w-[140px] truncate">{titleByUid[uid] ?? uid}</span>
                <button
                  onClick={() => toggleCompare(uid)}
                  className="shrink-0 cursor-pointer rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                  aria-label="비교 대상에서 제외"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={openCompare}
            disabled={compareUids.length !== MAX_COMPARE || compareLoading}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand-blue px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitCompare size={13} /> 비교하기
          </button>
          <button
            onClick={() => setCompareUids([])}
            className="shrink-0 cursor-pointer text-slate-400 transition-colors hover:text-slate-600"
            aria-label="선택 해제"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <ModelCompareModal
        isOpen={Boolean(comparePair)}
        onClose={() => setComparePair(null)}
        left={comparePair?.left}
        right={comparePair?.right}
      />

      <ModelDetailModal
        isOpen={Boolean(selected) && !detailLoading}
        onClose={() => setSelected(null)}
        model={selected}
        canManage={canManage}
        onChanged={() => {
          refresh();
          if (selected) openDetail(selected.model_uid, { keepOpen: true });
        }}
        // 유사 모델을 누르면 같은 모달에서 그 모델로 갈아탄다. 모달을 겹쳐 쌓으면
        // 몇 단계 들어왔는지 알 수 없고 닫기가 미로가 된다.
        onOpenModel={(uid) => openDetail(uid, { keepOpen: true })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 표시용 소형 컴포넌트                                                 */
/* ------------------------------------------------------------------ */

function FilterSelect({ id, label, value, onChange, options }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-slate-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function FilterChip({ label, onClear }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-[11px] text-slate-600">
      <span className="max-w-[180px] truncate">{label}</span>
      <button
        onClick={onClear}
        className="cursor-pointer rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        aria-label={`${label} 조건 해제`}
      >
        <X size={11} />
      </button>
    </span>
  );
}

/** 그룹 경계에는 세로 구분선을 둔다 — 축이 다르다는 것을 눈으로 알게. */
function Th({ children, className = '', divider = false, ...rest }) {
  return (
    <th
      className={[
        'px-4 py-2 font-semibold',
        divider ? 'border-l border-slate-200' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '', divider = false, ...rest }) {
  return (
    <td
      className={[
        'px-4 py-3',
        divider ? 'border-l border-slate-100' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </td>
  );
}

function PageBtn({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'min-w-[32px] rounded-lg border px-2.5 py-1.5 text-xs font-medium tabular-nums transition-colors',
        active
          ? 'border-brand-blue bg-brand-blue text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
