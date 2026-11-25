// 협의체 과제의 항목(할 일) 목록, 마일스톤, 항목 편집 창. Team Planner 의 Task 줄을 옮긴 것이다:
// 상태 원을 누르면 예정 → 진행 → 완료, 이름을 쓰고 Enter 로 바로 추가, 줄을 누르면 편집 창.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, Star, Trash2, X } from 'lucide-react';
import Modal from '../../ui/Modal';
import {
  EMPTY_ITEM_FORM, ITEM_STATUS, ITEM_STATUS_ORDER, MILESTONE_PRESETS, NEXT_ITEM_STATUS, changedFields, defaultItemDue,
  formFromItem, itemDueInfo, itemPayload, itemStats, localDay, sortItems,
} from '../../../utils/councilTasks';
import { BTN, BTN_DANGER, BTN_PRIMARY, ICON_BTN, INPUT, LABEL, ItemGlyph, isComposing } from './councilUi';

const DONE_SHOWN = 3;   // 끝난 항목은 처음에 이만큼만 보인다

function ItemRow({ item, now, busy, onCycle, onOpen }) {
  const due = itemDueInfo(item, now);
  const done = item.status === 'done';
  const tone = due.late ? 'text-red-700' : item.status === 'doing' ? 'text-brand-blue' : done ? 'text-slate-400' : 'text-slate-500';
  return (
    <li className="flex items-center gap-1.5 py-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => onCycle(item)}
        className={'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-slate-100 cursor-pointer ' + tone}
        aria-label={ITEM_STATUS[item.status] + ' 상태입니다. 누르면 ' + ITEM_STATUS[NEXT_ITEM_STATUS[item.status]] + '(으)로 바꿉니다'}
        title={ITEM_STATUS[item.status] + ' → ' + ITEM_STATUS[NEXT_ITEM_STATUS[item.status]]}
      >
        <ItemGlyph status={item.status} />
      </button>
      <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-50 cursor-pointer">
        {item.important && <Star size={13} className="shrink-0 text-amber-600" fill="currentColor" aria-label="중요" />}
        <span className={'min-w-0 flex-1 truncate text-sm ' + (done ? 'text-slate-400 line-through decoration-slate-300' : 'font-medium text-slate-900')}>{item.title}</span>
        {item.assignee && <span className="max-w-[96px] shrink-0 truncate text-xs text-slate-500">{item.assignee}</span>}
        <span className={'shrink-0 text-xs tabular-nums ' + (due.late ? 'font-bold text-red-700' : due.soon ? 'font-bold text-blue-800' : 'text-slate-500')}>
          {due.late && <AlertTriangle size={11} className="mr-0.5 inline -mt-0.5" aria-hidden="true" />}
          {due.text}
        </span>
        {!done && <span className="w-[42px] shrink-0 text-right text-xs tabular-nums text-slate-400">{item.due_date.slice(5)}</span>}
      </button>
    </li>
  );
}

/** 과제 상세의 항목 구역. */
export function ItemList({ task, now, busy, onAdd, onCycle, onOpen, onNew }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => defaultItemDue(now));
  const [showDone, setShowDone] = useState(false);
  const sendingRef = useRef(false);
  useEffect(() => { setTitle(''); setShowDone(false); }, [task.id]);

  const stats = itemStats(task, now);
  const sorted = sortItems(task.items);
  const open = sorted.filter((i) => i.status !== 'done');
  const done = sorted.filter((i) => i.status === 'done');
  const doneShown = showDone ? done : done.slice(0, DONE_SHOWN);

  const quickAdd = async () => {
    const text = title;
    if (!text.trim() || !due || busy || sendingRef.current) return;
    sendingRef.current = true;
    try {
      const ok = await onAdd(task, { ...EMPTY_ITEM_FORM, title: text.trim(), due_date: due, assignee: task.owner || '' });
      if (ok) setTitle((t) => (t === text ? '' : t));
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <section className="mt-5 border-t border-slate-200 pt-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-slate-900">항목 <span className="tabular-nums text-slate-500">{stats.total}</span></h3>
        <span className="text-xs tabular-nums text-slate-500">
          예정 {stats.todo}, 진행 {stats.doing}, 완료 {stats.done}
          {stats.late > 0 && <b className="ml-1.5 text-red-700">지연 {stats.late}</b>}
        </span>
      </div>
      {stats.total === 0 && <p className="mt-2 text-sm text-slate-400">아직 항목이 없습니다. 이 과제에서 할 일을 아래에 적어 추가하세요.</p>}
      {open.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100">
          {open.map((i) => <ItemRow key={i.id} item={i} now={now} busy={busy} onCycle={onCycle} onOpen={onOpen} />)}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 focus-within:border-brand-blue">
        <Plus size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); quickAdd(); } }}
          maxLength={200}
          placeholder="항목 이름을 쓰고 Enter"
          aria-label="새 항목 이름"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="새 항목 마감일" className="h-7 shrink-0 rounded border border-slate-200 px-1.5 text-xs tabular-nums text-slate-700 focus:border-brand-blue focus:outline-none" />
        <button type="button" onClick={() => onNew(task)} className="shrink-0 rounded px-1.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer" title="담당, 시작일, 메모까지 넣어 추가">
          자세히
        </button>
      </div>
      {done.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-slate-100">
            {doneShown.map((i) => <ItemRow key={i.id} item={i} now={now} busy={busy} onCycle={onCycle} onOpen={onOpen} />)}
          </ul>
          {done.length > DONE_SHOWN && (
            <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-1 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
              {showDone ? '끝난 항목 접기' : '끝난 항목 ' + (done.length - DONE_SHOWN) + '건 더 보기'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** 과제 상세의 마일스톤 구역. */
export function MilestoneList({ task, now, busy, onAdd, onDelete }) {
  const [date, setDate] = useState(() => localDay(now));
  const [title, setTitle] = useState('');
  useEffect(() => { setTitle(''); }, [task.id]);
  const today = localDay(now);
  const add = async () => {
    const text = title;
    if (!text.trim() || !date || busy) return;
    // 응답을 기다리는 동안 다음 이름을 적었으면 지우지 않는다.
    if (await onAdd(task, { date, title: text.trim() })) setTitle((t) => (t === text ? '' : t));
  };
  const list = task.milestones || [];
  return (
    <section className="mt-5 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-bold text-slate-900">마일스톤 <span className="tabular-nums text-slate-500">{list.length}</span></h3>
      {list.length > 0 && (
        <ul className="mt-2 space-y-1">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className={'inline-block h-2.5 w-2.5 shrink-0 rotate-45 ' + (m.date < today ? 'bg-slate-300' : 'bg-brand-blue')} aria-hidden="true" />
              <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-600">{m.date}</span>
              <span className={'min-w-0 flex-1 truncate ' + (m.date < today ? 'text-slate-500' : 'font-medium text-slate-900')}>{m.title}</span>
              <button type="button" onClick={() => onDelete(m)} className={ICON_BTN + ' h-7 w-7 hover:text-red-700'} aria-label={m.title + ' 마일스톤 지우기'} title="지우기">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="마일스톤 날짜" className="h-[34px] w-[136px] shrink-0 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-800 focus:border-brand-blue focus:outline-none" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); add(); } }}
          list="council-milestone-presets"
          maxLength={100}
          placeholder="예: 시제품 시연"
          aria-label="마일스톤 이름"
          className="h-[34px] min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-brand-blue focus:outline-none"
        />
        <datalist id="council-milestone-presets">{MILESTONE_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
        <button type="button" onClick={add} disabled={busy || !title.trim() || !date} className={BTN + ' shrink-0'}>추가</button>
      </div>
    </section>
  );
}

/**
 * 항목 편집 창(새 항목, 고치기 같이 씀). 목록과 타임라인 양쪽에서 연다.
 * state = { task, item?: 고칠 항목, draft?: 새 항목의 처음 값 }
 */
export function ItemEditor({ state, assignees, busy, onSave, onDelete, onClose }) {
  const editing = !!state?.item;
  const [form, setForm] = useState(EMPTY_ITEM_FORM);
  const [error, setError] = useState('');
  const key = state ? (state.item ? 'i' + state.item.id : 'n' + state.task.id + (state.draft?.due_date || '')) : '';
  useEffect(() => {
    if (!state) return;
    setError('');
    setForm(state.item ? formFromItem(state.item) : { ...EMPTY_ITEM_FORM, assignee: state.task.owner || '', ...state.draft });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const body = itemPayload(form);
    if (!body.title) { setError('항목 이름을 입력하세요.'); return; }
    if (!body.due_date) { setError('마감일을 입력하세요.'); return; }
    if (body.start_date && body.start_date > body.due_date) { setError('시작일이 마감일보다 늦습니다.'); return; }
    setError('');
    if (editing) {
      // 바뀐 칸만 보낸다 — 창을 연 뒤 다른 관리자가 고친 칸을 되돌리지 않게.
      const changes = changedFields(itemPayload(formFromItem(state.item)), body);
      if (Object.keys(changes).length === 0) { onClose(); return; }
      await onSave(state.task, state.item, changes);
    } else {
      await onSave(state.task, null, body);
    }
  };

  return (
    <Modal isOpen={!!state} onClose={onClose} title={editing ? '항목 고치기' : '새 항목'} size="lg">
      {state && (
        <form onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Enter' && isComposing(e)) e.preventDefault(); }} className="space-y-3 p-5">
          <p className="truncate text-xs font-semibold text-slate-500">{state.task.department}, {state.task.title}</p>
          <label className={LABEL}>
            항목 이름 <span className="text-red-600">*</span>
            <input autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} className={INPUT + ' mt-1'} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              담당
              <input value={form.assignee} onChange={(e) => set('assignee', e.target.value)} maxLength={100} list="council-assignees" placeholder="예: 홍길동 책임" className={INPUT + ' mt-1'} />
              <datalist id="council-assignees">{(assignees || []).map((a) => <option key={a} value={a} />)}</datalist>
            </label>
            <div className={LABEL}>
              상태
              <div className="mt-1 flex gap-1" role="group" aria-label="항목 상태">
                {ITEM_STATUS_ORDER.map((s) => (
                  <button key={s} type="button" onClick={() => set('status', s)} aria-pressed={form.status === s}
                    className={'h-[34px] flex-1 rounded-md text-sm font-semibold cursor-pointer ' + (form.status === s ? 'bg-brand-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                    {ITEM_STATUS[s]}
                  </button>
                ))}
              </div>
            </div>
            <label className={LABEL}>
              시작일(선택)
              <input type="date" value={form.start_date} max={form.due_date || undefined} onChange={(e) => set('start_date', e.target.value)} className={INPUT + ' mt-1'} />
            </label>
            <label className={LABEL}>
              마감일 <span className="text-red-600">*</span>
              <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className={INPUT + ' mt-1'} />
            </label>
          </div>
          <p className="text-xs text-slate-500">시작일을 넣으면 타임라인에 기간 막대로, 비우면 마감일에 점으로 보입니다.</p>
          <label className={LABEL}>
            메모
            <textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={4} maxLength={2000} className={INPUT + ' mt-1 resize-y'} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={!!form.important} onChange={(e) => set('important', e.target.checked)} className="h-4 w-4 accent-amber-600" />
            중요 항목으로 표시
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            {editing && (
              <button type="button" onClick={() => onDelete(state.item)} disabled={busy} className={BTN_DANGER}><Trash2 size={14} /> 지우기</button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} disabled={busy} className={BTN}>취소</button>
            <button type="submit" disabled={busy} className={BTN_PRIMARY}>{busy ? '저장 중…' : editing ? '저장' : '추가'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
