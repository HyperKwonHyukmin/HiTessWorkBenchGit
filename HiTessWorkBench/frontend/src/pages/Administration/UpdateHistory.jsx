/// <summary>
/// 관리자 Update History — WorkBench 에 더해지고 바뀐 것을 최근 것부터(달 묶음 타임라인).
/// 내용은 서버 app/changelog/changelog.json 이라 json 만 고치면 exe 재배포 없이 바뀐다.
/// '새 항목' = 이 PC 에서 지난번에 이 화면을 연 뒤 더해진 것(utils/updateHistory).
/// </summary>
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, RefreshCw, Search, SearchX } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FeedbackState from '../../components/ui/FeedbackState';
import { getAdminUpdates } from '../../api/adminUpdates';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  UPDATE_KINDS, groupByMonth, itemKey, listMonths, matchesUpdate, newIndexes, readSeen, splitHits, writeSeen,
} from '../../utils/updateHistory';

const SEEN_KEY = 'wb_admin_updates_seen';
const MENU = 'Update History';
const ALL_MONTHS = 'all';

function Hits({ text, q }) {
  return splitHits(text, q).map((part, i) => (part.hit
    ? <mark key={i} className="rounded-sm bg-amber-100 px-px text-inherit">{part.text}</mark>
    : <React.Fragment key={i}>{part.text}</React.Fragment>));
}

// 세로 선은 달 묶음의 첫 점에서 시작해 마지막 점에서 끝난다(점 중심 = 19px).
function railClass(isFirst, isLast) {
  if (isFirst && isLast) return 'hidden';
  if (isFirst) return 'top-[19px] bottom-0';
  if (isLast) return 'top-0 h-[19px]';
  return 'top-0 bottom-0';
}

function UpdateItem({ it, isNew, showDate, isFirst, isLast, q }) {
  return (
    <li className="grid grid-cols-[5.5rem_1.25rem_minmax(0,1fr)]">
      <span className="pt-3.5 font-mono text-xs text-slate-500">{showDate ? it.date : ''}</span>
      <span className="relative" aria-hidden="true">
        <span className={`absolute left-[9px] w-px bg-slate-200 ${railClass(isFirst, isLast)}`} />
        <span className={`absolute left-[5px] top-[15px] h-[9px] w-[9px] rounded-full border-[1.5px] ${
          isNew ? 'border-brand-blue bg-brand-blue' : 'border-slate-300 bg-white'
        }`} />
      </span>
      <div className="min-w-0 py-3 pl-1.5 pr-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-slate-800"><Hits text={it.title} q={q} /></span>
          {isNew && <Badge variant="notify" size="sm">새 항목</Badge>}
          <Badge variant="neutral" size="sm">{it.kind}</Badge>
          {it.status && <Badge variant="warning" size="sm" dot>{it.status}</Badge>}
        </div>
        {it.summary && <p className="mt-1 text-sm leading-relaxed text-slate-700"><Hits text={it.summary} q={q} /></p>}
        {it.points?.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-600 marker:text-slate-400">
            {it.points.map((p) => <li key={p}><Hits text={p} q={q} /></li>)}
          </ul>
        )}
        {(it.version || it.screen) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {it.version && <span className="font-mono">v{it.version}</span>}
            {it.screen && <span>화면: {it.screen}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function UpdateHistory() {
  const { currentMenu } = useNavigation();
  const [items, setItems] = useState([]);
  const [fresh, setFresh] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(false);
  // 고른 달 — null 이면 아직 안 골랐다(가장 최근 달을 보인다), ALL_MONTHS 면 전체 기간.
  const [monthPick, setMonthPick] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getAdminUpdates({ signal });
      if (signal?.aborted) return;
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      setFresh(newIndexes(list, readSeen(SEEN_KEY)));
      if (list[0]) writeSeen(SEEN_KEY, itemKey(list[0]));   // 다음 방문의 '새 항목' 기준
    } catch (e) {
      if (signal?.aborted) return;
      setError(e?.response?.data?.detail || e?.message || '업데이트 이력을 불러오지 못했습니다.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // '/' 로 찾기 칸(Ctrl+K 는 전역 명령 팔레트). 관리자 페이지도 keep-alive 일 수 있어 이 화면일 때만 반응한다.
  useEffect(() => {
    const onKey = (e) => {
      if (currentMenu !== MENU || !inputRef.current) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
        || e.target?.isContentEditable;
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current.focus();
        inputRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);

  const months = useMemo(() => listMonths(items), [items]);
  // 고른 달이 새로 고침 뒤 목록에서 사라졌으면 가장 최근 달로 돌아간다.
  const month = monthPick === ALL_MONTHS ? ''
    : months.some((m) => m.month === monthPick) ? monthPick : (months[0]?.month || '');

  const rows = useMemo(
    () => items.map((it, index) => ({ it, index })).filter(({ it }) => matchesUpdate(it, { month, kind, q, pending })),
    [items, month, kind, q, pending],
  );
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  // 달 탭의 건수는 '분류·찾기·확인 남음'을, 분류 버튼의 건수는 '달·찾기·확인 남음'을 반영한다.
  const monthCounts = useMemo(() => {
    const base = items.filter((it) => matchesUpdate(it, { kind, q, pending }));
    return { all: base.length, ...Object.fromEntries(months.map((m) => [m.month, base.filter((it) => it.date?.startsWith(m.month)).length])) };
  }, [items, months, kind, q, pending]);
  const kindCounts = useMemo(() => {
    const base = items.filter((it) => matchesUpdate(it, { month, q, pending }));
    return Object.fromEntries(['', ...UPDATE_KINDS].map((k) => [k, k ? base.filter((it) => it.kind === k).length : base.length]));
  }, [items, month, q, pending]);
  const kinds = UPDATE_KINDS.filter((k) => items.some((it) => it.kind === k));
  const pendingCount = items.filter((it) => matchesUpdate(it, { month }) && it.status).length;
  const filtering = Boolean(kind || pending || q.trim());
  const elsewhere = month && filtering ? monthCounts.all - rows.length : 0;   // 다른 달에 맞는 항목
  const clearFilters = () => { setKind(''); setQ(''); setPending(false); inputRef.current?.focus(); };

  return (
    <div className="mx-auto max-w-4xl pb-28">
      <PageHeader
        title="Update History"
        icon={History}
        subtitle="WorkBench 에 더해지고 바뀐 것을 최근 것부터 보여 줍니다."
        accentColor="violet"
        actions={(
          <button
            type="button"
            onClick={() => load()}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> 새로 고침
          </button>
        )}
      />

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => load()} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
            다시 시도
          </button>
        </div>
      ) : loading && items.length === 0 ? (
        <FeedbackState variant="loading" title="업데이트 이력을 불러오는 중" compact />
      ) : items.length === 0 ? (
        <FeedbackState
          title="아직 기록한 업데이트가 없습니다"
          message="서버 app/changelog/changelog.json 에 항목을 넣으면 여기에 최근 것부터 쌓입니다."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-6">
          <p className="mb-3 text-xs text-slate-600">
            최근 업데이트 <span className="font-mono">{items[0].date}</span>
            {fresh.size > 0 && <> · <strong className="font-semibold text-slate-800">지난번에 본 뒤 새 항목 {fresh.size}건</strong></>}
          </p>

          <div role="group" aria-label="달" className="-mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
            {[...months, { month: ALL_MONTHS, label: '전체 기간' }].map((m) => {
              const active = m.month === ALL_MONTHS ? month === '' : month === m.month;
              return (
                <button
                  key={m.month}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMonthPick(m.month)}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'border-brand-blue font-bold text-brand-blue'
                      : 'border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-800'
                  }`}
                >
                  {m.label}
                  <span className="ml-1.5 font-mono text-xs font-normal text-slate-500">
                    {m.month === ALL_MONTHS ? monthCounts.all : monthCounts[m.month] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="relative min-w-[14rem] flex-1">
              <span className="sr-only">이력 찾기</span>
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); clearFilters(); } }}
                placeholder="제목·설명·버전·화면으로 찾기"
                autoComplete="off"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              />
              <kbd className="pointer-events-none absolute right-2 top-2 rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-[11px] text-slate-500 max-sm:hidden" aria-hidden="true">/</kbd>
            </label>
            <div role="group" aria-label="분류" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5">
              {['', ...kinds].map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    kind === k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {k || '전체'} <span className="ml-0.5 font-mono font-normal text-slate-500">{kindCounts[k] ?? 0}</span>
                </button>
              ))}
            </div>
            {pendingCount > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="h-3.5 w-3.5 accent-brand-blue" />
                확인 남음만 <span className="font-mono text-slate-500">{pendingCount}</span>
              </label>
            )}
          </div>

          <p role="status" className="mt-2 min-h-[1.25rem] text-xs text-slate-500">
            {filtering && (
              <>
                {rows.length}건 ·{' '}
                <button type="button" onClick={clearFilters} className="text-blue-600 underline underline-offset-2 hover:no-underline">
                  거르기 지우기
                </button>
                {elsewhere > 0 && (
                  <>
                    {' · '}다른 달에 {elsewhere}건 더{' '}
                    <button type="button" onClick={() => setMonthPick(ALL_MONTHS)} className="text-blue-600 underline underline-offset-2 hover:no-underline">
                      전체 기간에서 보기
                    </button>
                  </>
                )}
              </>
            )}
          </p>

          {rows.length === 0 ? (
            <FeedbackState
              icon={SearchX}
              title="맞는 항목이 없습니다"
              message={elsewhere > 0 ? `이 달에는 없고, 다른 달에 ${elsewhere}건 있습니다.` : '찾는 글자나 분류를 바꿔 보세요.'}
              compact
            >
              <div className="flex flex-wrap justify-center gap-2">
                {elsewhere > 0 && (
                  <button type="button" onClick={() => setMonthPick(ALL_MONTHS)} className="rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-blue-dark">
                    전체 기간에서 보기
                  </button>
                )}
                <button type="button" onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  거르기 지우기
                </button>
              </div>
            </FeedbackState>
          ) : groups.map((g) => (
            <section key={g.month || 'none'} aria-label={g.label} className="mt-2">
              {/* 한 달만 볼 때는 위 달 탭이 제목 역할을 한다 — 전체 기간일 때만 달 제목 */}
              {!month && (
                <h2 className="mt-4 text-sm font-bold text-slate-800">
                  {g.label} <span className="ml-1 text-xs font-normal text-slate-500">{g.rows.length}건</span>
                </h2>
              )}
              <ol>
                {g.rows.map(({ it, index }, i) => (
                  <UpdateItem
                    key={`${itemKey(it)}#${index}`}
                    it={it}
                    isNew={fresh.has(index)}
                    showDate={i === 0 || g.rows[i - 1].it.date !== it.date}
                    isFirst={i === 0}
                    isLast={i === g.rows.length - 1}
                    q={q}
                  />
                ))}
              </ol>
            </section>
          ))}

          <p className="mt-6 border-t border-slate-100 pt-3 text-xs text-slate-500">
            '새 항목'은 이 PC 에서 지난번에 이 화면을 연 때를 기준으로 합니다. 내용 원본은 서버의{' '}
            <span className="font-mono">app/changelog/changelog.json</span> 이고, 고치면 exe 재배포 없이 바로 반영됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
