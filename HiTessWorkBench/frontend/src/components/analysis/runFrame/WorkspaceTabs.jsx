/**
 * 작업 탭 — 한 앱 페이지에서 해석 과정 여러 개를 동시에 진행하는 틀(Model Builder · GMU 권상 공용).
 *
 * 구성: WorkspaceTabBar(폴더 탭) + WorkspaceFrame(활성 탭과 이어지는 작업 영역 + 머리) +
 *       useWorkspaceStore(저장·활성·추가·닫기 + Job Center 카드 → 탭 이동).
 * 탭 규칙(번호·이름·메뉴 재진입)은 utils/appWorkspaces 의 kit 가 정한다.
 *
 * 폴더 탭 형태 — 활성 탭은 아래 작업 영역(bg-slate-50)과 같은 배경으로 이어지고, 비활성 탭은 한 단계
 * 어둡게 뒤로 물러난다. 작업마다 번호·색 칩(1~4)을 고정해 탭·Job Center·Studio 창 제목('작업 N · …')을
 * 눈으로 짝지을 수 있게 한다.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, X } from 'lucide-react';

// 작업 번호별 색. 흰 숫자 대비가 충분한 600~700 단계만 쓴다.
const SLOT_CHIP_CLASS = {
  1: 'bg-blue-600',
  2: 'bg-teal-700',
  3: 'bg-violet-600',
  4: 'bg-rose-600',
};

// 상태는 색만으로 구분하지 않는다 — 아이콘 모양 + 글자(툴팁·작업 영역 머리)를 함께 둔다.
// text 는 앱마다 statusText 로 바꿀 수 있다(예: GMU 의 ready = '권상 검토 단계').
export const WORKSPACE_STATUS_META = {
  running:   { text: '실행 중',     icon: Loader2,      cls: 'text-blue-600 animate-spin' },
  failed:    { text: '실행 실패',   icon: AlertCircle,  cls: 'text-red-600' },
  delivered: { text: '산출물 받음', icon: CheckCircle2, cls: 'text-emerald-600' },
  ready:     { text: '확인 단계',   dot: 'bg-blue-600' },
  idle:      { text: '입력 전',     dot: 'bg-slate-400' },
};

const statusMeta = (status, statusText) => {
  const meta = WORKSPACE_STATUS_META[status] || WORKSPACE_STATUS_META.idle;
  const text = statusText?.[status];
  return text ? { ...meta, text } : meta;
};

function SlotChip({ slotNo, size = 'sm' }) {
  const dim = size === 'lg' ? 'h-7 w-7 text-sm' : 'h-5 w-5 text-[11px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white ${dim} ${SLOT_CHIP_CLASS[slotNo] || 'bg-slate-600'}`}
      aria-hidden="true"
    >
      {slotNo}
    </span>
  );
}

function StatusMark({ meta }) {
  if (meta.icon) {
    const Icon = meta.icon;
    return <Icon size={13} className={`shrink-0 ${meta.cls}`} aria-hidden="true" />;
  }
  return <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />;
}

/**
 * @param {{ items: Array<{id, slotNo, label, title, status}>, activeId: string, ariaLabel: string,
 *           onActivate: Function, onClose: Function, onAdd: Function, canAdd: boolean, max: number,
 *           statusText?: object }} props
 */
export function WorkspaceTabBar({ items, activeId, ariaLabel, onActivate, onClose, onAdd, canAdd, max, statusText }) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto border-b border-slate-300 px-2">
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-0 items-end gap-1">
        {items.map((item) => {
          const selected = item.id === activeId;
          const meta = statusMeta(item.status, statusText);
          return (
            <div
              key={item.id}
              className={`group relative flex max-w-[280px] items-center rounded-t-lg border transition-colors ${
                selected
                  // 활성 탭: 작업 영역(bg-slate-50)과 같은 배경 + 아래 테두리를 지워 영역과 한 덩어리로 보이게.
                  ? '-mb-px border-slate-300 border-b-slate-50 bg-slate-50 py-1 text-slate-900'
                  : 'border-transparent bg-slate-200/80 py-0.5 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
              }`}
            >
              <button
                type="button"
                role="tab"
                id={`ws-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`ws-panel-${item.id}`}
                onClick={() => onActivate(item.id)}
                title={`${item.title} — ${meta.text}`}
                className="flex min-w-0 items-center gap-2 rounded-tl-lg py-1.5 pl-2.5 pr-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 cursor-pointer"
              >
                <SlotChip slotNo={item.slotNo} />
                <span className={`truncate ${selected ? 'font-bold' : 'font-semibold'}`}>{item.label}</span>
                <StatusMark meta={meta} />
                <span className="sr-only">(작업 {item.slotNo}, {meta.text})</span>
              </button>
              <button
                type="button"
                onClick={() => onClose(item.id)}
                aria-label={`작업 ${item.slotNo} ${item.label} 탭 닫기`}
                title="작업 탭 닫기"
                className="mr-1.5 rounded p-1 text-slate-500 hover:bg-slate-300/60 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd
          ? '다른 모델로 새 작업을 엽니다. 작업마다 Studio 창이 따로 뜹니다.'
          : `작업은 최대 ${max}개까지 열 수 있습니다. 끝난 작업 탭을 닫으세요.`}
        className="mb-1 ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent cursor-pointer"
      >
        <Plus size={14} aria-hidden="true" /> 새 작업
      </button>
    </div>
  );
}

/**
 * 작업 영역 — 활성 탭과 같은 배경·테두리로 이어 붙여 '이 탭의 내용'임을 보이게 한다.
 * 머리에 지금 보고 있는 작업(작업 N · 이름 · 상태)을 둔다. children 은 탭마다 하나씩
 * renderWorkspace(item) 로 그리고 활성 탭만 보인다(숨은 탭도 언마운트하지 않는다).
 */
export function WorkspaceFrame({ items, activeId, statusText, renderWorkspace }) {
  const active = items.find((t) => t.id === activeId) || items[0];
  const meta = active ? statusMeta(active.status, statusText) : null;
  return (
    <div className="rounded-b-xl border border-t-0 border-slate-300 bg-slate-50 px-3 pb-5 pt-4 sm:px-4">
      {active && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 pb-3">
          <SlotChip slotNo={active.slotNo} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-slate-900">
              작업 {active.slotNo} <span className="font-normal text-slate-400">·</span> {active.label}
            </p>
            <p className="text-xs text-slate-600">
              {meta.text}
              {items.length > 1 && ' · 이 작업의 Studio 창 제목도 같은 이름으로 열립니다'}
            </p>
          </div>
        </div>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`ws-panel-${item.id}`}
          aria-labelledby={`ws-tab-${item.id}`}
          hidden={item.id !== activeId}
        >
          {renderWorkspace(item)}
        </div>
      ))}
    </div>
  );
}

/**
 * 탭 저장소 훅. rawStore/setRawStore 는 DashboardContext 의 그 앱 상태(값·세터, 세터는 함수형 업데이트 지원).
 * 반환: store(정규화), storeRef, update, saveState(id, state), focusWorkspace(id), getSaved(id), addWorkspace().
 * Job Center 카드를 누르면(`workbench:job-slot-focus`) 그 해석을 돌린 탭으로 간다.
 */
export function useWorkspaceStore({ rawStore, setRawStore, kit }) {
  const store = useMemo(() => kit.normalize(rawStore), [kit, rawStore]);
  const storeRef = useRef(store);
  storeRef.current = store;

  // 처음 들어왔거나 예전 단일 페이지 상태가 남아 있으면 탭 형태로 한 번 저장해 둔다(탭 id 고정 —
  // 다음 렌더에서 작업 화면이 다시 마운트되지 않게). 함수형으로 쓴다 — 같은 커밋에서 메뉴 재진입
  // 처리(kit.freshEntry)가 먼저 탭을 만들었으면 그것을 존중한다.
  useEffect(() => {
    const isStoreShape = (v) => v && Array.isArray(v.workspaces) && v.workspaces.length > 0;
    if (!isStoreShape(rawStore)) setRawStore?.((prev) => (isStoreShape(prev) ? prev : store));
  }, [rawStore, store, setRawStore]);

  const update = useCallback((fn) => setRawStore?.((prev) => fn(prev)), [setRawStore]);
  const saveState = useCallback((id, state) => update((prev) => kit.save(prev, id, state)), [kit, update]);
  const focusWorkspace = useCallback((id) => update((prev) => kit.activate(prev, id)), [kit, update]);
  const getSaved = useCallback((id) => storeRef.current.states[id] ?? null, []);
  const addWorkspace = useCallback(() => update((prev) => kit.add(prev)), [kit, update]);

  useEffect(() => {
    const onFocus = (e) => {
      const slot = e.detail?.slot;
      if (!slot || !storeRef.current.workspaces.some((ws) => ws.id === slot)) return;
      focusWorkspace(slot);
    };
    window.addEventListener('workbench:job-slot-focus', onFocus);
    return () => window.removeEventListener('workbench:job-slot-focus', onFocus);
  }, [focusWorkspace]);

  return { store, storeRef, update, saveState, focusWorkspace, getSaved, addWorkspace };
}
