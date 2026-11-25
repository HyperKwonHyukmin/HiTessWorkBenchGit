// 협의체 과제 보드 — 예정, 진행, 완료 열. Team Planner(E:\Apps\team-planner src/views/Board.tsx)를 옮긴 것이다.
// 카드는 두 가지다: 항목 카드(과제 아래 할 일)와 과제 카드(항목이 아직 없는 과제 — 검토 중인 과제도 '예정'에 보이게, 사용자 결정 2026-11-25).
// 카드를 다른 열로 끌어 놓으면 상태가 바뀌고, '담당별 줄'에서는 다른 사람 칸으로 끌어 담당까지 바꾼다.
import { useMemo, useState } from 'react';
import { Plus, Star } from 'lucide-react';
import {
  COLUMN_TASK_STATUS, ITEM_STATUS, ITEM_STATUS_ORDER, NEXT_ITEM_STATUS, NO_ASSIGNEE, TASK_BOARD_COLUMN, assigneeLanes, assigneeOf,
  boardColumn, boardEntries, boardTaskCards, boardTaskColumn, ownerOf,
} from '../../../utils/councilTasks';
import { deptColor } from '../../../utils/councilTimeline';
import { Assignee, ICON_BTN, ItemDue, ItemGlyph, SELECT, SEG_WRAP, StatusBadge, TaskDue, segBtn } from './councilUi';

const DRAG_TYPE = 'application/x-council-item';   // 값 = 'item:<id>' 또는 'task:<id>'
const COL_HINT = { todo: '검토 중인 과제, 시작 전 항목', doing: '개발 중인 과제, 하는 중인 항목', done: '최근 2주 완료' };
const carries = (e) => Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE);

function Card({ entry, now, busy, hideWho, dragging, onDragStart, onDragEnd, onCycle, onOpen }) {
  const { item, task } = entry;
  const done = item.status === 'done';
  return (
    <li
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, 'item:' + item.id); e.dataTransfer.effectAllowed = 'move'; onDragStart('item:' + item.id); }}
      onDragEnd={onDragEnd}
      className={'rounded-lg border border-slate-200 bg-white p-2 pr-3 shadow-sm transition-[border-color,box-shadow,opacity] hover:border-slate-400 hover:shadow cursor-grab active:cursor-grabbing ' +
        (dragging ? 'opacity-40' : '')}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onCycle(item)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-slate-100 cursor-pointer"
          aria-label={ITEM_STATUS[item.status] + ' 상태입니다. 누르면 ' + ITEM_STATUS[NEXT_ITEM_STATUS[item.status]] + ' 상태로 바꿉니다'}
        >
          <ItemGlyph status={item.status} />
        </button>
        <button type="button" onClick={() => onOpen(task, item)} className="min-w-0 flex-1 py-1 text-left cursor-pointer">
          <span className={'line-clamp-2 text-sm leading-snug ' + (done ? 'text-slate-500 line-through decoration-slate-300' : 'font-semibold text-slate-900 hover:text-brand-blue')}>
            {item.important && <Star size={13} className="mr-1 inline -mt-0.5 text-amber-600" fill="currentColor" aria-label="중요" />}
            {item.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-600">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: deptColor(task.department) }} aria-hidden="true" />
            <span className="min-w-0 truncate">{task.title}</span>
          </span>
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 pl-9">
        {hideWho ? <span /> : <Assignee name={assigneeOf(item)} />}
        <ItemDue item={item} now={now} />
      </div>
    </li>
  );
}

/** 과제 카드: 항목이 아직 없는 과제. 누르면 과제 상세로 간다. 상태는 과제 상태(검토 중 등)를 그대로 보인다. */
function TaskCard({ task, now, busy, hideWho, dragging, onDragStart, onDragEnd, onSelect }) {
  const closed = task.status === 'done';
  return (
    <li
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, 'task:' + task.id); e.dataTransfer.effectAllowed = 'move'; onDragStart('task:' + task.id); }}
      onDragEnd={onDragEnd}
      className={'rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-[border-color,box-shadow,opacity] hover:border-slate-400 hover:shadow cursor-grab active:cursor-grabbing ' +
        (dragging ? 'opacity-40' : '')}
    >
      <button type="button" onClick={() => onSelect(task)} className="block w-full text-left cursor-pointer" title="과제 상세 보기">
        <span className={'line-clamp-2 text-sm leading-snug ' + (closed ? 'text-slate-500' : 'font-semibold text-slate-900 hover:text-brand-blue')}>
          {task.important && <Star size={13} className="mr-1 inline -mt-0.5 text-amber-600" fill="currentColor" aria-label="중요" />}
          {task.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-600">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: deptColor(task.department) }} aria-hidden="true" />
          <span className="min-w-0 truncate">{task.department}</span>
        </span>
      </button>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={task.status} />
        {!hideWho && task.owner && <Assignee name={task.owner} />}
        <span className="ml-auto"><TaskDue task={task} now={now} /></span>
      </div>
    </li>
  );
}

function ColHead({ status, count, onAdd }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2.5 pt-3">
      <ItemGlyph status={status} size={20} />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-baseline gap-2 text-base font-bold text-slate-900">
          {ITEM_STATUS[status]} <span className="text-sm font-semibold tabular-nums text-slate-500">{count}</span>
        </h2>
        <p className="text-xs text-slate-500">{COL_HINT[status]}</p>
      </div>
      {onAdd && (
        <button type="button" onClick={onAdd} className={ICON_BTN} aria-label={ITEM_STATUS[status] + ' 항목 추가'} title="항목 추가"><Plus size={17} /></button>
      )}
    </div>
  );
}

export default function CouncilBoard({ tasks, now, busy, onMoveItem, onMoveTask, onCycleItem, onOpenItem, onNewItem, onSelectTask }) {
  const [lanes, setLanes] = useState(false);       // false = 상태별, true = 담당별 줄
  const [who, setWho] = useState('');              // 담당 거르기('' = 모두)
  const [over, setOver] = useState(null);          // 끌어 올린 칸
  const [draggingId, setDraggingId] = useState(null);

  const names = useMemo(() => assigneeLanes(tasks, true, now), [tasks, now]);
  const picked = names.includes(who) ? who : '';
  const entries = useMemo(() => boardEntries(tasks, now, picked), [tasks, now, picked]);
  const taskCards = useMemo(() => boardTaskCards(tasks, now, picked), [tasks, now, picked]);
  const byId = useMemo(() => new Map(boardEntries(tasks, now).map((e) => ['item:' + e.item.id, e])), [tasks, now]);
  const taskById = useMemo(() => new Map(tasks.map((t) => ['task:' + t.id, t])), [tasks]);

  const drop = (e, status, assignee) => {
    e.preventDefault();
    setOver(null);
    setDraggingId(null);
    const key = e.dataTransfer.getData(DRAG_TYPE);
    const task = taskById.get(key);
    if (task) {
      // 과제 카드: 다른 열로 옮길 때만 과제 상태를 바꾼다(같은 열 안의 시험 운영, 보류는 그대로 둔다).
      const patch = {};
      if ((TASK_BOARD_COLUMN[task.status] || 'todo') !== status) patch.status = COLUMN_TASK_STATUS[status];
      if (assignee !== undefined && ownerOf(task) !== assignee) patch.owner = assignee === NO_ASSIGNEE ? '' : assignee;
      if (Object.keys(patch).length) onMoveTask(task, patch);
      return;
    }
    const entry = byId.get(key);
    if (!entry) return;
    const patch = {};
    if (entry.item.status !== status) patch.status = status;
    if (assignee !== undefined && assigneeOf(entry.item) !== assignee) patch.assignee = assignee === NO_ASSIGNEE ? '' : assignee;
    if (Object.keys(patch).length) onMoveItem(entry.item, patch);
  };
  const target = (key, status, assignee) => ({
    onDragOver: (e) => { if (carries(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e) => drop(e, status, assignee),
  });
  const cardProps = { now, busy, onDragStart: setDraggingId, onDragEnd: () => { setDraggingId(null); setOver(null); }, onCycle: onCycleItem, onOpen: onOpenItem };
  const dropClass = (key) => (over === key ? ' border-brand-blue bg-blue-50/60 outline-2 outline-dashed -outline-offset-4 outline-brand-blue/60' : '');
  const taskCardProps = { now, busy, onDragStart: setDraggingId, onDragEnd: cardProps.onDragEnd, onSelect: onSelectTask };
  const total = entries.length + taskCards.length;
  /** 한 칸의 카드: 항목 카드 먼저(마감이 있는 할 일), 그 아래 과제 카드. */
  const cell = (status, name, hideWho) => {
    const items = boardColumn(entries, status, name);
    const cards = boardTaskColumn(taskCards, status, name);
    return {
      count: items.length + cards.length,
      nodes: [
        ...items.map((entry) => <Card key={'i' + entry.item.id} entry={entry} hideWho={hideWho} dragging={draggingId === 'item:' + entry.item.id} {...cardProps} />),
        ...cards.map((t) => <TaskCard key={'t' + t.id} task={t} hideWho={hideWho} dragging={draggingId === 'task:' + t.id} {...taskCardProps} />),
      ],
    };
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className={SEG_WRAP} role="group" aria-label="보드 보기">
          <button type="button" onClick={() => setLanes(false)} aria-pressed={!lanes} className={segBtn(!lanes)}>상태별</button>
          <button type="button" onClick={() => setLanes(true)} aria-pressed={lanes} className={segBtn(lanes)}>담당별 줄</button>
        </div>
        <label>
          <span className="sr-only">담당 거르기</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} className={SELECT}>
            <option value="">모든 담당</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <p className="text-[13px] text-slate-600">
          {lanes ? '카드를 다른 칸으로 끌어 놓으면 상태와 담당이 함께 바뀝니다.' : '카드를 다른 열로 끌어 놓으면 상태가 바뀝니다. 항목이 없는 과제는 과제 카드로 보입니다.'}
        </p>
      </div>

      {total === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
          보일 카드가 없습니다. 열 머리의 + 를 눌러 항목을 추가하세요.
        </p>
      )}

      {!lanes ? (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {ITEM_STATUS_ORDER.map((s) => {
            const col = cell(s, '', false);
            return (
              <section key={s} aria-label={ITEM_STATUS[s]} {...target(s, s)} className={'min-h-[280px] rounded-xl border border-slate-200 bg-slate-50 px-3 pb-3 transition-colors' + dropClass(s)}>
                <ColHead status={s} count={col.count} onAdd={s === 'done' ? null : () => onNewItem(null, { status: s, assignee: picked && picked !== NO_ASSIGNEE ? picked : '' })} />
                <ul className="flex flex-col gap-2">{col.nodes}</ul>
                {col.count === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-7 text-center text-[13px] text-slate-500">여기로 카드를 끌어 놓으세요</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" role="table" aria-label="담당별 보드">
          <div className="grid min-w-[900px] grid-cols-[150px_repeat(3,minmax(0,1fr))] border-b border-slate-200 bg-slate-50" role="row">
            <span className="px-3 py-2.5 text-[13px] font-bold text-slate-600" role="columnheader">담당</span>
            {ITEM_STATUS_ORDER.map((s) => (
              <span key={s} role="columnheader" className="flex items-center gap-2 border-l border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900">
                <ItemGlyph status={s} size={16} /> {ITEM_STATUS[s]}
                <span className="text-[13px] font-semibold tabular-nums text-slate-500">{cell(s, '', false).count}</span>
              </span>
            ))}
          </div>
          {(picked ? [picked] : names).map((name) => (
            <div key={name} className="grid min-w-[900px] grid-cols-[150px_repeat(3,minmax(0,1fr))] border-b border-slate-200 last:border-b-0" role="row">
              <div className="px-3 py-3 text-sm font-bold text-slate-900" role="rowheader">{name}</div>
              {ITEM_STATUS_ORDER.map((s) => {
                const key = name + ':' + s;
                return (
                  <div key={s} role="cell" {...target(key, s, name)} className={'min-h-[72px] border-l border-slate-200 p-2 transition-colors' + dropClass(key)}>
                    <ul className="flex flex-col gap-2">{cell(s, name, true).nodes}</ul>
                    {s !== 'done' && (
                      <button type="button" onClick={() => onNewItem(null, { status: s, assignee: name === NO_ASSIGNEE ? '' : name })}
                        className="mt-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                        aria-label={name + ' ' + ITEM_STATUS[s] + ' 항목 추가'}>
                        <Plus size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {names.length === 0 && <p className="p-8 text-center text-sm text-slate-600">과제나 항목이 생기면 담당별로 줄이 나뉩니다.</p>}
        </div>
      )}
    </div>
  );
}
