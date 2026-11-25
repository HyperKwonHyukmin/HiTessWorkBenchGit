// 협의체 과제 타임라인 — Team Planner(E:\Apps\team-planner src/views/Timeline.tsx)를 옮긴 것이다.
// 보기 둘: 과제(과제마다 한 줄, 의뢰 부서로 묶음) / 담당(사람마다 한 줄).
// 항목은 막대(시작 ~ 마감) 또는 마름모(마감일만), 마일스톤은 파란 마름모. 막대를 끌면 날짜가 옮겨지고, 양 끝을 끌면 늘어난다.
// 담당 보기에서는 다른 사람 줄로 끌어 담당을 바꾼다. 누르기만 하면 편집 창. 옮긴 뒤에는 화면 아래 알림의 '되돌리기'로 되돌린다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  KR_HOLIDAYS, WEEKDAY_KO, ZOOM, ZOOM_ORDER, addDays, deptColor, isWeekend, layoutBars, mondayOf, monthSpans, rangeLabel,
  rowContent, snapCol, spanCols, toDays, visibleDays, weekday,
} from '../../../utils/councilTimeline';
import {
  ITEM_STATUS, NO_ASSIGNEE, STATUS_META, assigneeLanes, assigneeOf, compareTasks, departmentCounts, isClosed, localDay, mdDate,
} from '../../../utils/councilTasks';
import { BTN, ICON_BTN, ItemGlyph, SEG_WRAP, segBtn } from './councilUi';

const HEAD_W = 280;      // 왼쪽 이름 칸 폭
const LANE = 30;         // 막대 한 줄 높이
const BAR_H = 26;
const ROW_EMPTY = 38;    // 그릴 것이 없는 줄
const ROW_MIN = 48;
const GROUP_H = 30;
const POINT_W = 190;     // 시작일 없는 항목의 이름 폭(이만큼 자리를 잡아 다른 막대와 겹치지 않게)
const STRIP_H = 18;      // 줄 맨 위의 마일스톤, 과제 기간 띠 자리
const INK = '#0f1f38';

const defaultStart = (zoom, today) => addDays(mondayOf(today), zoom === 'week' ? 0 : zoom === 'month' ? -7 : -14);

export default function CouncilTimeline({ tasks, now, busy, onOpenItem, onNewItem, onSelectTask, onMoveItem }) {
  const today = localDay(now);
  const [mode, setMode] = useState('task');             // task(과제) | person(담당)
  const [zoom, setZoom] = useState('month');
  const [start, setStart] = useState(() => defaultStart('month', today));
  const [hideWeekends, setHideWeekends] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [drag, setDrag] = useState(null);                // { item, type, origin, col, row, moved }
  const scrollRef = useRef(null);
  const datesRef = useRef(null);
  const draggedRef = useRef(false);
  const [avail, setAvail] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - HEAD_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const z = ZOOM[zoom];
  const days = useMemo(() => visibleDays(start, zoom, hideWeekends), [start, zoom, hideWeekends]);
  const first = days[0];
  // 주말을 숨기면 마지막 보이는 날은 금요일이지만 기간은 그 주 일요일까지다(그 토, 일 항목은 금요일 칸에 붙인다).
  const last = addDays(start, z.span - 1);
  // 칸이 화면보다 좁으면 화면 폭에 맞춰 넓힌다.
  const dw = Math.max(z.width, Math.floor(avail / days.length) || 0);
  const width = days.length * dw;
  const months = useMemo(() => monthSpans(days), [days]);
  const pointCols = Math.ceil(POINT_W / dw);
  const todayCol = days.indexOf(today);

  const taskOf = useMemo(() => {
    const map = new Map();
    for (const t of tasks) for (const i of t.items || []) map.set(i.id, t);
    return map;
  }, [tasks]);

  // ── 끌기: 옮기기(move), 왼쪽 끝(left), 오른쪽 끝(right) ──
  const dateAt = (col) => (col < 0 ? addDays(first, col) : col >= days.length ? addDays(days[days.length - 1], col - days.length + 1) : days[col]);
  const colFromX = (clientX) => Math.floor((clientX - (datesRef.current?.getBoundingClientRect().left ?? 0)) / dw);
  const preview = (d) => {
    const s0 = d.item.start_date || d.item.due_date;
    const e0 = d.item.due_date;
    const delta = toDays(dateAt(d.col)) - toDays(dateAt(d.origin));
    if (d.type === 'move') return { start: addDays(s0, delta), end: addDays(e0, delta) };
    if (d.type === 'left') { const s = addDays(s0, delta); return { start: s > e0 ? e0 : s, end: e0 }; }
    const e = addDays(e0, delta);
    return { start: s0, end: e < s0 ? s0 : e };
  };
  const finishDrag = (d) => {
    const task = taskOf.get(d.item.id);
    if (!d.moved) { if (task) onOpenItem(task, d.item); return; }
    draggedRef.current = true;
    setTimeout(() => { draggedRef.current = false; }, 0);
    const p = preview(d);
    const patch = {};
    if (p.end !== d.item.due_date) patch.due_date = p.end;
    if (d.item.start_date && p.start !== d.item.start_date) patch.start_date = p.start;
    if (mode === 'person' && d.row !== 'p:' + assigneeOf(d.item)) patch.assignee = d.row === 'p:' + NO_ASSIGNEE ? '' : d.row.slice(2);
    if (Object.keys(patch).length) onMoveItem(d.item, patch);
  };
  const startDrag = (e, item, type, row) => {
    if (e.button !== 0 || busy) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = colFromX(e.clientX);
    const sx = e.clientX;
    const sy = e.clientY;
    let cur = { item, type, origin, col: origin, row, moved: false };
    setDrag(cur);
    const move = (ev) => {
      const moved = cur.moved || Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4;
      let nextRow = cur.row;
      if (type === 'move' && mode === 'person') {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-tl-row]');
        if (hit?.dataset.tlRow) nextRow = hit.dataset.tlRow;
      }
      cur = { ...cur, col: colFromX(ev.clientX), row: nextRow, moved };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      finishDrag(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const live = drag?.moved ? { id: drag.item.id, row: drag.row, ...preview(drag) } : null;
  /** 끄는 중인 항목은 미리보기 날짜로 바꿔 그린다. */
  const withLive = (items, rowKey) => {
    if (!live) return items;
    const out = [];
    for (const it of items) {
      if (it.id !== live.id) { out.push(it); continue; }
      if (mode === 'person' && live.row !== rowKey) continue;       // 다른 줄로 끌려 나감
      out.push({ ...it, start_date: it.start_date ? live.start : null, due_date: live.end });
    }
    if (mode === 'person' && live.row === rowKey && !items.some((it) => it.id === live.id)) {
      out.push({ ...drag.item, start_date: drag.item.start_date ? live.start : null, due_date: live.end });
    }
    return out;
  };

  // ── 줄 구성 ──
  const rows = useMemo(() => {
    if (mode === 'person') {
      return [{ group: null, rows: assigneeLanes(tasks).map((name) => ({
        key: 'p:' + name, name,
        items: tasks.flatMap((t) => (t.items || []).filter((i) => assigneeOf(i) === name)),
      })) }];
    }
    const list = [...tasks].sort((a, b) => compareTasks(a, b, now));
    return departmentCounts(list).map(({ name }) => ({
      group: name,
      color: deptColor(name),
      rows: list.filter((t) => ((t.department || '').trim() || '부서 미정') === name).map((t) => ({ key: 't:' + t.id, task: t, items: t.items || [] })),
    }));
  }, [tasks, mode, now]);
  const rowCount = rows.reduce((n, g) => n + g.rows.length, 0);

  const changeZoom = (next) => { setZoom(next); setStart(defaultStart(next, today)); };

  // 배경: 주말과 공휴일 음영, 주 경계선(2주 보기에서는 날 경계선도). 줄마다 같은 것을 깐다.
  const background = useMemo(() => (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {days.map((d, i) => {
        const off = isWeekend(d) || KR_HOLIDAYS[d];
        const weekStart = i > 0 && weekday(d) === 1;
        if (!off && !weekStart && zoom !== 'week') return null;
        return (
          <div key={d} className={'absolute inset-y-0 ' + (off ? 'bg-slate-100/80 ' : '') + (weekStart ? 'border-l border-slate-300' : zoom === 'week' && i > 0 ? 'border-l border-slate-100' : '')}
            style={{ left: i * dw, width: dw }} />
        );
      })}
      {todayCol >= 0 && <div className="absolute inset-y-0 bg-blue-100/50" style={{ left: todayCol * dw, width: dw }} />}
      {todayCol >= 0 && <div className="absolute inset-y-0 w-0.5 bg-brand-blue" style={{ left: todayCol * dw + dw / 2 - 1 }} />}
    </div>
  ), [days, dw, zoom, todayCol]);

  const renderBar = (bar, top, rowKey) => {
    const it = bar.item;
    const task = taskOf.get(it.id);
    const color = deptColor(task?.department);
    const { i, j } = bar;
    const done = it.status === 'done';
    const late = !done && it.due_date < today;
    const c = late ? '#b91c1c' : done ? '#94a3b8' : color;
    const ghost = live?.id === it.id;
    const tip = [it.title, mode === 'person' ? task?.title : assigneeOf(it), ITEM_STATUS[it.status] + (late ? ' (지연)' : ''),
      (it.start_date ? it.start_date + ' ~ ' : '마감 ') + it.due_date, it.note].filter(Boolean).join('\n');
    const common = {
      type: 'button',
      title: ghost ? undefined : tip,
      onPointerDown: (e) => startDrag(e, it, 'move', rowKey),
      onClick: (e) => e.stopPropagation(),
      onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && task) { e.preventDefault(); onOpenItem(task, it); } },
    };
    const textCls = done ? 'text-slate-500 line-through decoration-slate-400' : late ? 'font-semibold text-red-800' : 'font-semibold';
    if (bar.point) {
      // 시작일 없는 항목: 마감일 칸에 마름모와 이름(기간처럼 보이지 않게 막대를 그리지 않는다).
      const center = i * dw + dw / 2;
      return (
        <button
          key={bar.id}
          {...common}
          className={'absolute z-[2] flex touch-none items-center gap-1.5 rounded px-0.5 text-[13px] hover:bg-white cursor-grab active:cursor-grabbing ' +
            (bar.flip ? 'flex-row-reverse ' : '') + (ghost ? 'opacity-80 ring-2 ring-brand-blue' : '')}
          style={bar.flip ? { right: width - center - 7, top, height: BAR_H, maxWidth: POINT_W, color: INK } : { left: center - 7, top, height: BAR_H, maxWidth: POINT_W, color: INK }}
        >
          <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 border-2" style={{ borderColor: c, background: it.status === 'todo' ? '#fff' : c }} aria-hidden="true" />
          <span className={'min-w-0 truncate ' + textCls}>{it.title}</span>
        </button>
      );
    }
    const w = Math.max(16, (j - i + 1) * dw - 3);
    const cutL = bar.start < first;
    const cutR = bar.end > last;
    const fill = late ? '#fef2f2' : done ? '#f1f5f9' : 'color-mix(in srgb, ' + color + ' ' + (it.status === 'doing' ? '18%' : '6%') + ', white)';
    return (
      <div
        key={bar.id}
        className={'absolute z-[2] flex touch-none items-center overflow-hidden border text-[13px] ' +
          (cutL ? 'rounded-l-none border-l-0 ' : 'rounded-l-md ') + (cutR ? 'rounded-r-none border-r-0 ' : 'rounded-r-md ') + (ghost ? 'opacity-80 ring-2 ring-brand-blue' : 'hover:brightness-[0.97]')}
        style={{ left: i * dw + 1, width: w, top, height: BAR_H, background: fill, borderColor: 'color-mix(in srgb, ' + c + ' 55%, white)', color: 'color-mix(in srgb, ' + c + ' 70%, ' + INK + ')' }}
      >
        {!cutL && <span className="absolute inset-y-0 left-0 z-[1] w-2 cursor-ew-resize" onPointerDown={(e) => startDrag(e, it, 'left', rowKey)} onClick={(e) => e.stopPropagation()} aria-hidden="true" />}
        <button {...common} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left cursor-grab active:cursor-grabbing">
          <ItemGlyph status={it.status} size={14} color={c} />
          <span className={'min-w-0 truncate ' + textCls}>{it.title}</span>
          {w > 170 && <span className="ml-auto shrink-0 pl-2 text-xs font-medium tabular-nums opacity-75">{mdDate(it.due_date)}</span>}
        </button>
        {!cutR && <span className="absolute inset-y-0 right-0 z-[1] w-2 cursor-ew-resize" onPointerDown={(e) => startDrag(e, it, 'right', rowKey)} onClick={(e) => e.stopPropagation()} aria-hidden="true" />}
      </div>
    );
  };

  const renderRow = (row, color) => {
    const { task } = row;
    const { bars, lateBefore, milestones } = rowContent({ items: withLive(row.items, row.key), milestones: task?.milestones }, first, last, today, showDone);
    const { placed, count } = layoutBars(bars, days, last, pointCols);
    const band = task?.start_date && task?.due_date ? spanCols(days, task.start_date, task.due_date, false, last) : null;
    const dueCol = task ? snapCol(days, task.due_date, last) : -1;
    const strip = milestones.length > 0 || band || dueCol >= 0;
    const top0 = strip ? STRIP_H : 6;
    const empty = placed.length === 0 && !strip;
    const h = empty ? ROW_EMPTY : Math.max(ROW_MIN, top0 + count * LANE + 6);
    const open = row.items.filter((i) => i.status !== 'done').length;
    const closed = task ? isClosed(task.status) : false;
    const jumpToLate = () => setStart(mondayOf(lateBefore.map((i) => i.due_date).sort()[0]));
    const onTrack = (e) => {
      if (draggedRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const col = Math.min(days.length - 1, Math.max(0, Math.floor((e.clientX - rect.left) / dw)));
      if (task) onNewItem(task, { due_date: days[col] });
      else onNewItem(null, { due_date: days[col], assignee: row.name === NO_ASSIGNEE ? '' : row.name });
    };
    const msCols = milestones.map((m) => snapCol(days, m.date, last));
    return (
      <div key={row.key} className="flex border-b border-slate-200" style={{ height: h }}>
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3" style={{ width: HEAD_W }}>
          {task ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: (STATUS_META[task.status] || STATUS_META.reviewing).dot }} title={(STATUS_META[task.status] || STATUS_META.reviewing).label} />
              <button type="button" onClick={() => onSelectTask(task)} className={'min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-brand-blue hover:underline cursor-pointer ' + (closed ? 'text-slate-500' : 'text-slate-900')}
                title={task.title + ' (' + (STATUS_META[task.status] || STATUS_META.reviewing).label + ', 과제 상세 보기)'}>
                {task.title}
              </button>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{row.name}</span>
          )}
          {open > 0 && <span className="shrink-0 text-[13px] tabular-nums text-slate-600" title="남은(예정, 진행) 항목">{open}</span>}
          {lateBefore.length > 0 && (
            <button type="button" onClick={jumpToLate} className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded bg-red-50 px-1.5 text-xs font-bold text-red-700 hover:bg-red-100 cursor-pointer"
              title="보이는 기간보다 앞에 마감이 지난 항목입니다. 누르면 그 주로 옮깁니다.">
              <AlertTriangle size={12} aria-hidden="true" /> {lateBefore.length}
            </button>
          )}
        </div>
        <div className="relative shrink-0 cursor-cell" style={{ width }} data-tl-row={row.key} onClick={onTrack}>
          {background}
          {band && <div className="pointer-events-none absolute z-[1] h-1 rounded-full" style={{ left: band[0] * dw + 2, width: Math.max(4, (band[1] - band[0] + 1) * dw - 4), top: 8, background: color, opacity: 0.35 }} aria-hidden="true" />}
          {dueCol >= 0 && <div className="absolute z-[1] w-0.5 rounded" style={{ left: dueCol * dw + dw - 2, top: 3, height: 13, background: color }} title={'과제 목표일 ' + task.due_date} />}
          {milestones.map((m, k) => {
            const col = msCols[k];
            if (col < 0) return null;
            // 이름은 다음 마일스톤과 겹치지 않을 때만 쓴다(겹치면 마름모만, 이름은 마우스를 올리면).
            const next = msCols.slice(k + 1).find((c) => c >= 0);
            const room = zoom !== 'quarter' && (next === undefined || (next - col) * dw > 110);
            return (
              <div key={m.id} className="absolute z-[1] flex items-center gap-1" style={{ left: col * dw + dw / 2 - 5, top: 3 }} title={m.date + ' ' + m.title} onClick={(e) => e.stopPropagation()}>
                <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 bg-brand-blue ring-2 ring-white" aria-hidden="true" />
                {room && <span className="max-w-[104px] truncate rounded bg-white/90 px-0.5 text-xs font-semibold leading-none text-brand-blue">{m.title}</span>}
              </div>
            );
          })}
          {placed.map((b) => renderBar(b, top0 + b.lane * LANE + 1, row.key))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className={SEG_WRAP} role="group" aria-label="줄 기준">
          <button type="button" onClick={() => setMode('task')} aria-pressed={mode === 'task'} className={segBtn(mode === 'task')}>과제</button>
          <button type="button" onClick={() => setMode('person')} aria-pressed={mode === 'person'} className={segBtn(mode === 'person')}>담당</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={BTN} onClick={() => setStart(defaultStart(zoom, today))}>오늘</button>
          <button type="button" className={ICON_BTN + ' h-9 w-9 border border-slate-300 bg-white'} onClick={() => setStart((s) => addDays(s, -z.step))} aria-label="이전 기간"><ChevronLeft size={17} /></button>
          <button type="button" className={ICON_BTN + ' h-9 w-9 border border-slate-300 bg-white'} onClick={() => setStart((s) => addDays(s, z.step))} aria-label="다음 기간"><ChevronRight size={17} /></button>
          <label>
            <span className="sr-only">이 날짜가 든 주로 이동</span>
            <input type="date" value={start} onChange={(e) => { if (e.target.value) setStart(mondayOf(e.target.value)); }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-700 focus:border-brand-blue focus:outline-none" />
          </label>
        </div>
        <span className="text-sm font-semibold tabular-nums text-slate-800">{rangeLabel(first, last)}</span>
        <div className={SEG_WRAP + ' ml-auto'} role="group" aria-label="확대">
          {ZOOM_ORDER.map((k) => (
            <button key={k} type="button" onClick={() => changeZoom(k)} aria-pressed={zoom === k} className={segBtn(zoom === k)}>{ZOOM[k].label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={hideWeekends} onChange={(e) => setHideWeekends(e.target.checked)} className="h-4 w-4 accent-[#002554]" /> 주말 숨기기
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-4 w-4 accent-[#002554]" /> 끝난 항목 보기
        </label>
      </div>

      <div ref={scrollRef} className={'max-h-[calc(100vh-240px)] min-h-[240px] overflow-auto rounded-xl border border-slate-200 bg-white ' + (drag?.moved ? 'select-none' : '')}>
        <div style={{ width: HEAD_W + width }}>
          {/* 머리글: 달, 날 */}
          <div className="sticky top-0 z-20 flex border-b border-slate-300 bg-white">
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-2 text-[13px] font-semibold text-slate-600" style={{ width: HEAD_W }}>
              {mode === 'task' ? '과제' : '담당'} <b className="ml-1.5 tabular-nums text-slate-900">{rowCount}</b>
              <span className="ml-auto text-xs font-medium text-slate-500">남은 항목</span>
            </div>
            <div ref={datesRef} style={{ width }}>
              <div className="flex h-7">
                {months.map((m) => (
                  <div key={m.label} className="shrink-0 whitespace-nowrap border-l border-slate-300 text-[13px] font-bold leading-7 text-slate-800" style={{ width: m.n * dw }}>
                    {/* 옆으로 넘겨도 그 달 이름이 왼쪽에 붙어 보인다 */}
                    <span className="sticky inline-block bg-white px-2" style={{ left: HEAD_W }}>{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex h-10">
                {days.map((d, i) => {
                  const wd = WEEKDAY_KO[weekday(d)];
                  const hol = KR_HOLIDAYS[d];
                  const showNum = zoom !== 'quarter' || weekday(d) === 1;
                  const red = hol || weekday(d) === 0;
                  const weekStart = i > 0 && weekday(d) === 1;
                  return (
                    <div key={d} className={'flex shrink-0 flex-col items-center justify-center overflow-hidden ' + (weekStart ? 'border-l border-slate-300 ' : '') + (isWeekend(d) || hol ? 'bg-slate-100/80' : '')}
                      style={{ width: dw }} title={d + ' (' + wd + ')' + (hol ? ' ' + hol : '')}>
                      {showNum && (
                        <b className={'text-[13px] tabular-nums leading-5 ' + (d === today ? 'rounded bg-brand-blue px-1.5 text-white' : red ? 'text-red-700' : 'text-slate-800')}>{Number(d.slice(8))}</b>
                      )}
                      {zoom !== 'quarter' && (
                        <span className={'max-w-full truncate px-0.5 text-xs leading-4 ' + (red ? 'text-red-700' : 'text-slate-600')}>{zoom === 'week' && hol ? hol : wd}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {rowCount === 0 && (
            <p className="p-10 text-center text-sm text-slate-600">
              {mode === 'person' ? '아직 항목이 없습니다. 과제 보기에서 줄의 빈 곳을 눌러 항목을 추가하세요.' : '조건에 맞는 과제가 없습니다.'}
            </p>
          )}

          {rows.map((g) => (
            <div key={g.group || 'all'}>
              {g.group && (
                <div className="flex border-b border-slate-200 bg-slate-50" style={{ height: GROUP_H }}>
                  <div className="sticky left-0 z-10 flex items-center gap-2 bg-slate-50 px-3 text-[13px] font-bold text-slate-800">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} aria-hidden="true" />
                    {g.group} <span className="font-semibold tabular-nums text-slate-500">{g.rows.length}</span>
                  </div>
                </div>
              )}
              {g.rows.map((r) => renderRow(r, g.color))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
        막대를 끌면 날짜가 옮겨지고, 양 끝을 끌면 기간이 늘거나 줄어듭니다{mode === 'person' ? '. 다른 사람 줄로 끌면 담당이 바뀝니다' : ''}. 막대를 누르면 고치고, 빈 곳을 누르면 그날 마감인 항목을 추가합니다.
        막대 색은 의뢰 부서, 파란 마름모는 마일스톤입니다.
      </p>
    </div>
  );
}
