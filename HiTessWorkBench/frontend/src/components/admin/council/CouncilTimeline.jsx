// 협의체 과제 타임라인 — 과제마다 한 줄, 항목은 막대(시작 ~ 마감) 또는 점(마감일만), 마일스톤은 마름모.
// Team Planner(E:\Apps\team-planner src/views/Timeline.tsx)의 '과제 일정' 보기를 옮긴 것이다.
// 끌어서 옮기기는 넣지 않았다 — 되돌리기가 없는 화면이라 실수로 일정이 바뀌는 것을 막으려고(막대를 누르면 편집 창).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  KR_HOLIDAYS, WEEKDAY_KO, ZOOM, ZOOM_ORDER, addDays, deptColor, isWeekend, mondayOf, monthSpans, rangeLabel,
  layoutBars, rowContent, shortDate, snapCol, spanCols, visibleDays, weekday,
} from '../../../utils/councilTimeline';
import { ITEM_STATUS, STATUS_META, compareTasks, departmentCounts, isClosed, itemStats, localDay } from '../../../utils/councilTasks';
import { BTN, ICON_BTN, ItemGlyph, SEG_WRAP, segBtn } from './councilUi';

const HEAD_W = 248;      // 왼쪽 과제 칸 폭
const LANE = 26;         // 막대 한 줄 높이
const BAR_H = 22;
const ROW_MIN = 52;
const GROUP_H = 28;
const POINT_W = 190;     // 시작일 없는 항목의 이름 폭(이만큼 자리를 잡아 다른 막대와 겹치지 않게)
const STRIP_H = 20;      // 줄 맨 위의 마일스톤, 과제 기간 띠 자리

const defaultStart = (zoom, today) => addDays(mondayOf(today), zoom === 'week' ? 0 : zoom === 'month' ? -7 : -14);

export default function CouncilTimeline({ tasks, now, onOpenItem, onNewItem, onSelectTask }) {
  const today = localDay(now);
  const [zoom, setZoom] = useState('month');
  const [start, setStart] = useState(() => defaultStart('month', today));
  const [hideWeekends, setHideWeekends] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const scrollRef = useRef(null);
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

  const groups = useMemo(() => {
    const list = [...tasks].sort((a, b) => compareTasks(a, b, now));
    return departmentCounts(list).map(({ name }) => ({
      name,
      color: deptColor(name),
      tasks: list.filter((t) => ((t.department || '').trim() || '부서 미정') === name),
    }));
  }, [tasks, now]);

  const changeZoom = (next) => { setZoom(next); setStart(defaultStart(next, today)); };
  const colClass = (d) => {
    const weekStart = d === first || weekday(d) === 1;
    return (isWeekend(d) || KR_HOLIDAYS[d] ? 'bg-slate-100/70 ' : '') + (d === today ? 'bg-blue-100/60 ' : '') +
      'border-l ' + (weekStart ? 'border-slate-300' : zoom === 'quarter' ? 'border-transparent' : 'border-slate-100');
  };
  const background = (
    <div className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
      {days.map((d) => <div key={d} className={'h-full shrink-0 ' + colClass(d)} style={{ width: dw }} />)}
    </div>
  );

  const renderBar = (task, bar, top, color) => {
    const it = bar.item;
    const { i, j } = bar;
    const done = it.status === 'done';
    const late = !done && it.due_date < today;
    const c = late ? '#b91c1c' : done ? '#94a3b8' : color;
    const tip = [it.title, it.assignee, ITEM_STATUS[it.status] + (late ? ' (지연)' : ''),
      (it.start_date ? it.start_date + ' ~ ' : '마감 ') + it.due_date, it.note].filter(Boolean).join('\n');
    const open = (e) => { e.stopPropagation(); onOpenItem(task, it); };
    if (bar.point) {
      // 시작일 없는 항목: 마감일 칸에 마름모와 이름(기간처럼 보이지 않게 막대를 그리지 않는다).
      const flip = bar.flip;
      const center = i * dw + dw / 2;
      return (
        <button
          key={bar.id}
          type="button"
          onClick={open}
          title={tip}
          className={'absolute flex items-center gap-1.5 rounded px-0.5 text-xs hover:bg-white/80 cursor-pointer ' + (flip ? 'flex-row-reverse' : '')}
          style={flip ? { right: width - center - 7, top, height: BAR_H, maxWidth: POINT_W } : { left: center - 7, top, height: BAR_H, maxWidth: POINT_W }}
        >
          <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 border-2" style={{ borderColor: c, background: done ? c : it.status === 'doing' ? c : '#fff' }} aria-hidden="true" />
          <span className={'min-w-0 truncate ' + (done ? 'text-slate-400 line-through' : late ? 'font-semibold text-red-800' : 'font-medium text-slate-800')}>{it.title}</span>
          {it.assignee && <span className="shrink-0 text-slate-500">{it.assignee}</span>}
        </button>
      );
    }
    const w = Math.max(14, (j - i + 1) * dw - 3);
    const cutL = bar.start < first;
    const cutR = bar.end > last;
    const bg = late ? '#fef2f2' : done ? '#f1f5f9' : it.status === 'doing' ? 'color-mix(in srgb, ' + color + ' 16%, white)' : '#ffffff';
    return (
      <button
        key={bar.id}
        type="button"
        onClick={open}
        title={tip}
        className={'absolute flex items-center gap-1.5 overflow-hidden border px-1.5 text-left text-xs hover:brightness-95 cursor-pointer ' +
          (cutL ? 'rounded-l-none border-l-0 ' : 'rounded-l-full ') + (cutR ? 'rounded-r-none border-r-0' : 'rounded-r-full')}
        style={{ left: i * dw + 1, width: w, top, height: BAR_H, borderColor: c, background: bg, color: late ? '#991b1b' : done ? '#94a3b8' : '#0f1f38' }}
      >
        <ItemGlyph status={it.status} size={13} color={c} />
        <span className={'min-w-0 truncate ' + (done ? 'line-through' : 'font-semibold')}>{it.title}</span>
        {it.assignee && w > 150 && <span className="shrink-0 opacity-70">{it.assignee}</span>}
        {w > 200 && <span className="ml-auto shrink-0 tabular-nums opacity-70">{shortDate(it.due_date)}</span>}
      </button>
    );
  };

  const renderRow = (task, color) => {
    const { bars, lateBefore, milestones } = rowContent(task, first, last, today, showDone);
    const { placed, count } = layoutBars(bars, days, last, pointCols);
    const band = task.start_date && task.due_date ? spanCols(days, task.start_date, task.due_date, false, last) : null;
    const dueCol = snapCol(days, task.due_date, last);
    const h = Math.max(ROW_MIN, STRIP_H + count * LANE + 6);
    const stats = itemStats(task, now);
    const closed = isClosed(task.status);
    const jumpToLate = () => setStart(mondayOf(lateBefore.map((i) => i.due_date).sort()[0]));
    const onTrack = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const col = Math.min(days.length - 1, Math.max(0, Math.floor((e.clientX - rect.left) / dw)));
      onNewItem(task, days[col]);
    };
    return (
      <div key={task.id} className="flex border-b border-slate-200" style={{ height: h }}>
        <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-slate-200 bg-white px-3" style={{ width: HEAD_W }}>
          <button type="button" onClick={() => onSelectTask(task)} className={'truncate text-left text-sm font-semibold hover:underline cursor-pointer ' + (closed ? 'text-slate-500' : 'text-slate-900')} title={task.title + ' (과제 상세 보기)'}>
            {task.title}
          </button>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0 font-semibold text-slate-600">{(STATUS_META[task.status] || STATUS_META.reviewing).label}</span>
            <span className="min-w-0 truncate">{task.owner || '담당 미정'}</span>
            <span className="ml-auto shrink-0 tabular-nums">남은 {stats.todo + stats.doing}</span>
            {lateBefore.length > 0 && (
              <button type="button" onClick={jumpToLate} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-50 px-1 font-bold text-red-700 hover:bg-red-100 cursor-pointer" title="보이는 기간보다 앞에 마감이 지난 항목입니다. 누르면 그 주로 옮깁니다.">
                <AlertTriangle size={11} aria-hidden="true" /> {lateBefore.length}
              </button>
            )}
          </div>
        </div>
        <div className="relative shrink-0 cursor-cell" style={{ width }} onClick={onTrack} title="빈 곳을 누르면 그날 마감인 항목을 추가합니다">
          {background}
          {band && (
            <div className="pointer-events-none absolute h-1 rounded-full" style={{ left: band[0] * dw + 2, width: Math.max(4, (band[1] - band[0] + 1) * dw - 4), top: 9, background: color, opacity: 0.3 }} aria-hidden="true" />
          )}
          {dueCol >= 0 && (
            <div className="pointer-events-none absolute w-0.5 rounded" style={{ left: dueCol * dw + dw - 2, top: 4, height: 14, background: color }} title={'과제 목표일 ' + task.due_date} />
          )}
          {milestones.map((m) => {
            const col = snapCol(days, m.date, last);   // 주말을 숨겼으면 앞 금요일 칸에
            if (col < 0) return null;
            return (
              <div key={m.id} className="absolute flex items-center gap-1" style={{ left: col * dw + dw / 2 - 5, top: 4 }} title={m.date + ' ' + m.title} onClick={(e) => e.stopPropagation()}>
                <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 bg-brand-blue" aria-hidden="true" />
                {zoom !== 'quarter' && <span className="max-w-[120px] truncate text-[11px] font-semibold leading-none text-brand-blue">{m.title}</span>}
              </div>
            );
          })}
          {placed.map((b) => renderBar(task, b, STRIP_H + b.lane * LANE + 2, color))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className={ICON_BTN + ' border border-slate-200 bg-white'} onClick={() => setStart((s) => addDays(s, -z.step))} aria-label="이전 기간"><ChevronLeft size={16} /></button>
          <button type="button" className={BTN} onClick={() => setStart(defaultStart(zoom, today))}>오늘</button>
          <button type="button" className={ICON_BTN + ' border border-slate-200 bg-white'} onClick={() => setStart((s) => addDays(s, z.step))} aria-label="다음 기간"><ChevronRight size={16} /></button>
        </div>
        <span className="text-sm font-semibold tabular-nums text-slate-800">{rangeLabel(first, last)}</span>
        <div className={SEG_WRAP + ' ml-auto'} role="group" aria-label="확대">
          {ZOOM_ORDER.map((k) => (
            <button key={k} type="button" onClick={() => changeZoom(k)} aria-pressed={zoom === k} className={segBtn(zoom === k)}>{ZOOM[k].label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={hideWeekends} onChange={(e) => setHideWeekends(e.target.checked)} className="h-3.5 w-3.5 accent-[#002554]" /> 주말 숨기기
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-3.5 w-3.5 accent-[#002554]" /> 끝난 항목 보기
        </label>
      </div>

      <div ref={scrollRef} className="max-h-[calc(100vh-250px)] min-h-[240px] overflow-auto rounded-lg border border-slate-200 bg-white">
        <div style={{ width: HEAD_W + width }}>
          {/* 머리글: 달, 날 */}
          <div className="sticky top-0 z-20 flex border-b border-slate-300 bg-white">
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-slate-200 bg-white px-3 pb-1.5 text-xs font-semibold text-slate-600" style={{ width: HEAD_W }}>
              과제 <b className="ml-1 tabular-nums text-slate-900">{tasks.length}</b>
            </div>
            <div style={{ width }}>
              <div className="flex h-6 border-b border-slate-100">
                {months.map((m) => (
                  <div key={m.label} className="shrink-0 whitespace-nowrap border-l border-slate-300 text-xs font-bold leading-6 text-slate-700" style={{ width: m.n * dw }}>
                    {/* 옆으로 넘겨도 그 달 이름이 왼쪽에 붙어 보인다 */}
                    <span className="sticky inline-block bg-white px-1.5" style={{ left: HEAD_W }}>{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex h-9">
                {days.map((d) => {
                  const wd = WEEKDAY_KO[weekday(d)];
                  const hol = KR_HOLIDAYS[d];
                  const showNum = zoom !== 'quarter' || weekday(d) === 1;
                  const red = hol || weekday(d) === 0;
                  return (
                    <div key={d} className={'flex shrink-0 flex-col items-center justify-center overflow-hidden ' + colClass(d)} style={{ width: dw }} title={d + ' (' + wd + ')' + (hol ? ' ' + hol : '')}>
                      {showNum && (
                        <b className={'text-xs tabular-nums leading-4 ' + (d === today ? 'rounded bg-brand-blue px-1 text-white' : red ? 'text-red-700' : 'text-slate-800')}>{Number(d.slice(8))}</b>
                      )}
                      {zoom !== 'quarter' && (
                        <small className={'max-w-full truncate px-0.5 text-[10px] leading-3 ' + (red ? 'text-red-600' : 'text-slate-500')}>{zoom === 'week' && hol ? hol : wd}</small>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {tasks.length === 0 && <p className="p-10 text-center text-sm text-slate-500">조건에 맞는 과제가 없습니다.</p>}

          {groups.map((g) => (
            <div key={g.name}>
              <div className="flex border-b border-slate-200 bg-slate-50" style={{ height: GROUP_H }}>
                <div className="sticky left-0 z-10 flex items-center gap-2 bg-slate-50 px-3 text-xs font-bold text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} aria-hidden="true" />
                  {g.name} <span className="tabular-nums font-semibold text-slate-500">{g.tasks.length}</span>
                </div>
              </div>
              {g.tasks.map((t) => renderRow(t, g.color))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        막대 = 시작일부터 마감일까지인 항목, 마름모 테두리 = 마감일만 있는 항목, 파란 마름모 = 마일스톤, 옅은 띠 = 과제 기간, 세로 눈금 = 과제 목표일.
        막대를 누르면 고치고, 빈 곳을 누르면 그날 마감인 항목을 추가합니다. 과제 이름을 누르면 과제 상세로 갑니다.
      </p>
    </div>
  );
}
