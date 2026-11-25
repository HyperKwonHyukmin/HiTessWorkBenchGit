/// <summary>
/// 구조해석 자동화 협의체 과제 현황 — 부서가 요청한 자동화 과제와 그 항목(할 일), 일정, 팀장과 실장님 의견.
/// 관리자(is_admin)만 본다. 과제, 항목, 기록의 생성, 수정, 삭제도 관리자 누구나(사용자 결정 2026-11-25).
/// 같은 화면을 WorkBench 관리자 메뉴 'Automation Council' 과 브라우저 주소 /council/ (src/council/CouncilApp.jsx)에서 쓴다.
/// 보기 셋: 과제(목록 + 한 장의 상세), 보드(항목 카드를 예정, 진행, 완료로), 타임라인. Team Planner(E:\Apps\team-planner)를 옮긴 것이다.
/// 계획 docs/plans/2026-11-25-automation-council-tasks-plan.md
/// </summary>
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarRange, ClipboardList, Clock, Copy, ExternalLink, Kanban, ListChecks, MessageSquare, Pencil, Plus,
  RefreshCw, Search, Send, Star, Trash2, X,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import CouncilBoard from '../../components/admin/council/CouncilBoard';
import { ItemEditor, ItemList, MilestoneList } from '../../components/admin/council/CouncilItems';
import CouncilTimeline from '../../components/admin/council/CouncilTimeline';
import {
  BTN, BTN_PRIMARY, ICON_BTN, INPUT, LABEL, SEG_WRAP, SELECT, StatusBadge, StatusSelect, isComposing, segBtn,
} from '../../components/admin/council/councilUi';
import {
  addCouncilItem, addCouncilMilestone, addCouncilNote, councilErrorText, councilPageUrl, createCouncilTask,
  deleteCouncilItem, deleteCouncilMilestone, deleteCouncilNote, deleteCouncilTask, fetchCouncilBoard, seedFirstMeeting,
  updateCouncilItem, updateCouncilNote, updateCouncilTask,
} from '../../api/council';
import {
  EMPTY_TASK_FORM, ITEM_STATUS, NEXT_ITEM_STATUS, NOTE_KIND_META, STATUS_META, STATUS_ORDER, STALE_DAYS, authorLabel,
  changedFields, departmentCounts, dueInfo, filterTasks, formFromTask, formatDateTime, groupTasks, isStale, itemStats,
  knownAssignees, lastActivity, latestUpdate, mdDate, noteCounts, summarize, taskPayload, undoPatch,
} from '../../utils/councilTasks';

const HEADER_BUTTON =
  'flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 cursor-pointer';
const VIEWS = [['list', '과제', ListChecks], ['board', '보드', Kanban], ['timeline', '타임라인', CalendarRange]];

/** 과제 목표일: 정해졌을 때만 보인다(미정은 쓰지 않는다). */
function TaskDue({ task, now }) {
  if (!task.due_date) return null;
  const info = dueInfo(task.due_date, task.status, now);
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13px] tabular-nums" title={'목표일 ' + task.due_date}>
      <span className={info.late ? 'font-bold text-red-700' : info.soon ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}>
        {info.late && <AlertTriangle size={12} className="mr-0.5 inline -mt-0.5" aria-hidden="true" />}
        {info.text === task.due_date ? mdDate(task.due_date) : info.text}
      </span>
      {info.text !== task.due_date && <span className="text-slate-500">{mdDate(task.due_date)}</span>}
    </span>
  );
}

// ── 과제 입력 폼(새 과제, 수정 같이 씀) ─────────────────────────────────────
function TaskForm({ initial, departments, assignees, busy, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(taskPayload(form)); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && isComposing(e)) e.preventDefault(); }}
      className="space-y-3"
    >
      <label className={LABEL}>
        과제 이름 <span className="text-red-600">*</span>
        <input ref={titleRef} value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} className={INPUT + ' mt-1'} required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          의뢰 부서 <span className="text-red-600">*</span>
          <input value={form.department} onChange={(e) => set('department', e.target.value)} maxLength={100} list="council-departments" className={INPUT + ' mt-1'} required />
          <datalist id="council-departments">{departments.map((d) => <option key={d.name} value={d.name} />)}</datalist>
        </label>
        <label className={LABEL}>
          요청자
          <input value={form.requester} onChange={(e) => set('requester', e.target.value)} maxLength={100} placeholder="예: 홍길동 책임" className={INPUT + ' mt-1'} />
        </label>
        <label className={LABEL}>
          담당
          <input value={form.owner} onChange={(e) => set('owner', e.target.value)} maxLength={100} list="council-assignees-form" placeholder="Hi-TESS 개발 담당" className={INPUT + ' mt-1'} />
          <datalist id="council-assignees-form">{(assignees || []).map((a) => <option key={a} value={a} />)}</datalist>
        </label>
        <label className={LABEL}>
          상태
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={INPUT + ' mt-1'}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          시작일(선택)
          <input type="date" value={form.start_date} max={form.due_date || undefined} onChange={(e) => set('start_date', e.target.value)} className={INPUT + ' mt-1'} />
        </label>
        <label className={LABEL}>
          목표일
          <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className={INPUT + ' mt-1'} />
        </label>
        <label className={LABEL + ' col-span-2'}>
          발굴 경로
          <input value={form.source} onChange={(e) => set('source', e.target.value)} maxLength={100} placeholder="예: 2차 회의 (2026-12)" className={INPUT + ' mt-1'} />
        </label>
      </div>
      <label className={LABEL}>
        요청 내용
        <textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={4} maxLength={5000} className={INPUT + ' mt-1 resize-y'} />
      </label>
      <label className={LABEL}>
        다음 단계
        <input value={form.next_step} onChange={(e) => set('next_step', e.target.value)} maxLength={300} placeholder="예: 12월 회의에서 시제품 시연" className={INPUT + ' mt-1'} />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!form.important} onChange={(e) => set('important', e.target.checked)} className="h-4 w-4 accent-amber-600" />
        중요 과제로 표시
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={BTN} disabled={busy}>취소</button>
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>{busy ? '저장 중…' : submitLabel}</button>
      </div>
    </form>
  );
}

// ── 기록 한 줄(의견, 진행 기록) ───────────────────────────────────────────
function NoteItem({ note, onSave, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const meta = NOTE_KIND_META[note.kind] || NOTE_KIND_META.comment;
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className={'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ' + meta.badge}>{meta.label}</span>
        <span className="min-w-0 truncate font-semibold text-slate-800">{authorLabel(note)}</span>
        <span className="shrink-0 tabular-nums text-slate-500">{formatDateTime(note.created_at)}{note.updated_at ? ' (고침)' : ''}</span>
        {!editing && (
          <span className="ml-auto flex">
            <button type="button" className={ICON_BTN} onClick={() => { setText(note.body); setEditing(true); }} aria-label="기록 고치기" title="고치기"><Pencil size={15} /></button>
            <button type="button" className={ICON_BTN + ' hover:text-red-700'} onClick={() => onDelete(note)} aria-label="기록 지우기" title="지우기"><Trash2 size={15} /></button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={5000} className={INPUT + ' resize-y'} />
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN} onClick={() => setEditing(false)} disabled={busy}>취소</button>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !text.trim()} onClick={async () => { if (await onSave(note, text)) setEditing(false); }}>저장</button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{note.body}</p>
      )}
    </li>
  );
}

// ── 오른쪽 상세 ──────────────────────────────────────────────────────────
function TaskDetail({
  task, now, busy, departments, assignees, canItems, onPatch, onDelete, onAddNote, onSaveNote, onDeleteNote,
  onAddItem, onCycleItem, onOpenItem, onNewItem, onAddMilestone, onDeleteMilestone,
}) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState('comment');
  const [draft, setDraft] = useState('');
  const sendingRef = useRef(false);
  useEffect(() => { setEditing(false); setDraft(''); }, [task.id]);

  const submitNote = async () => {
    const text = draft;
    // 응답을 기다리는 동안 다시 누르거나 Ctrl+Enter 를 눌러도 한 번만 보낸다.
    if (!text.trim() || busy || sendingRef.current) return;
    sendingRef.current = true;
    try {
      // 보내는 사이 더 적은 글은 지우지 않는다(보낸 글과 같을 때만 비운다).
      if (await onAddNote(task, kind, text)) setDraft((d) => (d === text ? '' : d));
    } finally {
      sendingRef.current = false;
    }
  };

  if (editing) {
    return (
      <div>
        <h2 className="mb-3 text-base font-bold text-slate-900">과제 고치기</h2>
        <TaskForm
          initial={formFromTask(task)}
          departments={departments}
          assignees={assignees}
          busy={busy}
          submitLabel="저장"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            // 바뀐 칸만 보낸다 — 폼을 연 뒤 다른 관리자가 고친 칸을 되돌리지 않게.
            const changes = changedFields(taskPayload(formFromTask(task)), body);
            if (Object.keys(changes).length === 0) { setEditing(false); return; }
            if (await onPatch(task, changes)) setEditing(false);
          }}
        />
      </div>
    );
  }

  const stale = isStale(task, now);
  const counts = noteCounts(task);
  // 아는 종류(의견, 진행 기록)만 그린다 — 재시작 전의 옛 서버가 보내는 상태 변경 기록은 건너뛴다.
  const notes = task.notes.filter((n) => NOTE_KIND_META[n.kind]);
  return (
    <div>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-600">{task.department}{task.requester ? ', 요청 ' + task.requester : ''}</p>
          <h2 className="mt-1 break-words text-lg font-bold leading-snug text-slate-900">{task.title}</h2>
        </div>
        <button
          type="button"
          onClick={() => onPatch(task, { important: !task.important })}
          className={ICON_BTN + (task.important ? ' text-amber-600 hover:text-amber-700' : '')}
          aria-pressed={!!task.important}
          aria-label={task.important ? '중요 표시 끄기' : '중요 과제로 표시'}
          title={task.important ? '중요 과제' : '중요 과제로 표시'}
          disabled={busy}
        >
          <Star size={17} fill={task.important ? 'currentColor' : 'none'} />
        </button>
        <button type="button" onClick={() => setEditing(true)} className={ICON_BTN} aria-label="과제 고치기" title="고치기"><Pencil size={16} /></button>
        <button type="button" onClick={() => onDelete(task)} className={ICON_BTN + ' hover:text-red-700'} aria-label="과제 지우기" title="지우기"><Trash2 size={16} /></button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusSelect value={task.status} disabled={busy} onChange={(s) => onPatch(task, { status: s })} />
        <TaskDue task={task} now={now} />
        {stale && <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-800"><Clock size={13} aria-hidden="true" /> {STALE_DAYS}일 넘게 변화 없음</span>}
      </div>

      <dl className="mt-4 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-slate-600">담당</dt>
        <dd className="font-medium text-slate-900">{task.owner || <span className="font-normal text-slate-500">정하지 않음</span>}</dd>
        <dt className="text-slate-600">{task.start_date ? '기간' : '목표일'}</dt>
        <dd className="tabular-nums text-slate-900">{task.start_date ? task.start_date + ' ~ ' : ''}{task.due_date || <span className="text-slate-500">정하지 않음</span>}</dd>
        {task.source && (<><dt className="text-slate-600">발굴 경로</dt><dd className="text-slate-900">{task.source}</dd></>)}
        <dt className="text-slate-600">마지막 갱신</dt>
        <dd className="tabular-nums text-slate-900">{formatDateTime(lastActivity(task))}</dd>
      </dl>

      {task.summary && (
        <section className="mt-4">
          <h3 className="text-[13px] font-bold text-slate-600">요청 내용</h3>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{task.summary}</p>
        </section>
      )}
      {task.next_step && (
        <section className="mt-3">
          <h3 className="text-[13px] font-bold text-slate-600">다음 단계</h3>
          <p className="mt-1 break-words text-sm text-slate-800">{task.next_step}</p>
        </section>
      )}

      {canItems ? (
        <>
          <ItemList task={task} now={now} busy={busy} onAdd={onAddItem} onCycle={onCycleItem} onOpen={(item) => onOpenItem(task, item)} onNew={onNewItem} />
          <MilestoneList task={task} now={now} busy={busy} onAdd={onAddMilestone} onDelete={onDeleteMilestone} />
        </>
      ) : (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          항목과 보드, 타임라인은 서버를 다시 시작한 뒤부터 쓸 수 있습니다(서버가 아직 이전 버전입니다).
        </p>
      )}

      <section className="mt-5 border-t border-slate-200 pt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold text-slate-900">의견과 진행 기록</h3>
          <span className="text-[13px] tabular-nums text-slate-600">의견 {counts.comment}, 진행 기록 {counts.progress}</span>
        </div>
        <div className="mt-2 rounded-lg border border-slate-200 p-2 focus-within:border-brand-blue">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isComposing(e)) { e.preventDefault(); submitNote(); } }}
            rows={3}
            maxLength={5000}
            placeholder={kind === 'comment' ? '이 과제에 대한 의견을 남겨 주세요.' : '진행한 내용을 적어 주세요. (예: 12/3 시제품 시연)'}
            className="w-full resize-y bg-transparent px-1.5 py-1 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            aria-label={NOTE_KIND_META[kind].label + ' 내용'}
          />
          <div className="mt-1 flex items-center gap-2">
            <div className={SEG_WRAP} role="group" aria-label="기록 종류">
              {['comment', 'progress'].map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={segBtn(kind === k) + ' h-7 px-2.5 text-[13px]'}>{NOTE_KIND_META[k].label}</button>
              ))}
            </div>
            <span className="ml-auto text-xs text-slate-500">Ctrl + Enter</span>
            <button type="button" onClick={submitNote} disabled={busy || !draft.trim()} className={BTN_PRIMARY + ' h-8'}><Send size={14} /> 등록</button>
          </div>
        </div>
        {notes.length > 0 && (
          <ul className="mt-1 divide-y divide-slate-100">
            {notes.map((n) => <NoteItem key={n.id} note={n} busy={busy} onSave={onSaveNote} onDelete={onDeleteNote} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── 화면 ─────────────────────────────────────────────────────────────────
export default function AutomationCouncil({ browser = false }) {
  const [tasks, setTasks] = useState([]);
  const [phase, setPhase] = useState('loading');   // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);       // { tone: 'ok'|'error', text, undo? }
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState({ status: '', department: '', query: '' });
  const [groupBy, setGroupBy] = useState('department');
  const [view, setView] = useState('list');          // list(과제) | board(보드) | timeline(타임라인)
  const [itemEdit, setItemEdit] = useState(null);    // { task|null, item?, draft? } — 항목 편집 창
  const [confirm, setConfirm] = useState(null);     // { type: 'task'|'note'|'item'|'milestone', target }
  const [now, setNow] = useState(() => new Date());
  const detailRef = useRef(null);
  // 좁은 화면(lg 미만)에서는 상세가 목록 아래로 내려가므로, 고르면 상세로 내려 준다.
  const revealDetail = () => {
    if (window.innerWidth < 1024) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const say = useCallback((tone, text, undo) => setNotice({ tone, text, undo }), []);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), notice.tone === 'error' ? 8000 : notice.undo ? 7000 : 3000);
    return () => clearTimeout(t);
  }, [notice]);

  // 늦게 온 목록 응답이 그 사이 저장한 값을 되돌리지 않게 — 읽기 시작한 뒤 저장이 있었으면 그 응답은 버린다.
  const mutationSeq = useRef(0);
  const loadSeq = useRef(0);
  const [hasAny, setHasAny] = useState(true);
  // 서버가 항목과 마일스톤을 아는가(재시작 전의 옛 서버는 모른다 — 그때는 그 기능을 감춘다).
  const [canItems, setCanItems] = useState(true);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setPhase('loading');
    const mySeq = ++loadSeq.current;
    const startMut = mutationSeq.current;
    try {
      const data = await fetchCouncilBoard();
      if (mySeq !== loadSeq.current || startMut !== mutationSeq.current) return;
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      setHasAny(data?.has_any !== false);
      setCanItems(Array.isArray(data?.features) && data.features.includes('items'));
      setNow(new Date());
      setPhase('ready');
    } catch (err) {
      // 이미 보이는 목록은 지우지 않는다(서버 실패 때 화면 값을 덮어쓰지 않기).
      if (quiet) { say('error', '새로 고치지 못했습니다. ' + councilErrorText(err, '불러오기 실패')); return; }
      setLoadError(councilErrorText(err, '불러오지 못했습니다.'));
      setPhase('error');
    }
  }, [say]);

  useEffect(() => { load(); }, [load]);
  // 다른 관리자가 고친 것을 보이게 — 창으로 돌아오면 조용히 다시 읽는다.
  useEffect(() => {
    const onFocus = () => { if (phase === 'ready') load({ quiet: true }); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, phase]);

  const replaceTask = (row) => setTasks((list) => {
    const i = list.findIndex((t) => t.id === row.id);
    if (i < 0) return [...list, row];
    const next = list.slice();
    next[i] = row;
    return next;
  });

  const run = async (fn, okText, undo) => {
    setBusy(true);
    mutationSeq.current += 1;
    try {
      const result = await fn();
      if (okText) say('ok', okText, undo);
      return result ?? true;
    } catch (err) {
      say('error', councilErrorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const departments = useMemo(() => departmentCounts(tasks), [tasks]);
  const assignees = useMemo(() => knownAssignees(tasks), [tasks]);
  const summary = useMemo(() => summarize(tasks, now), [tasks, now]);
  // 고른 부서의 과제가 다 없어지면(부서를 바꾸거나 지움) 거르기를 푼 것으로 본다 — 선택 상자는 '모든 의뢰 부서'인데 목록만 비는 일을 막는다.
  const department = departments.some((d) => d.name === filter.department) ? filter.department : '';
  const visible = useMemo(() => filterTasks(tasks, { ...filter, department }, now), [tasks, filter, department, now]);
  const groups = useMemo(() => groupTasks(visible, groupBy, now), [visible, groupBy, now]);
  const updatedAt = useMemo(() => latestUpdate(tasks), [tasks]);
  const selected = tasks.find((t) => t.id === selectedId) || null;

  // 처음 열면 맨 위 과제를 고른다.
  useEffect(() => {
    if (phase !== 'ready' || creating || selected) return;
    const first = groups[0]?.tasks[0];
    if (first) setSelectedId(first.id);
  }, [phase, groups, selected, creating]);

  const shareUrl = councilPageUrl();
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); say('ok', '주소를 복사했습니다. 관리자 계정으로 로그인해야 열립니다.'); }
    catch { say('error', '복사하지 못했습니다. 직접 적어 주세요: ' + shareUrl); }
  };
  const openInBrowser = () => {
    if (window.electron?.send) window.electron.send('open-external', shareUrl);
    else window.open(shareUrl, '_blank', 'noopener');
  };
  const startCreate = () => { setView('list'); setCreating(true); setSelectedId(null); revealDetail(); };

  /** 항목을 옮기거나 상태를 바꾼다(보드와 타임라인의 끌기, 상태 원). 알림에 '되돌리기'가 붙는다. */
  const moveItem = (item, patch, okText) => {
    const back = undoPatch(item, patch);
    return run(async () => { replaceTask(await updateCouncilItem(item.id, patch)); return true; }, okText || '옮겼습니다.',
      () => run(async () => { replaceTask(await updateCouncilItem(item.id, back)); return true; }, '되돌렸습니다.'));
  };
  const moveText = (patch) => {
    const parts = [];
    if (patch.status) parts.push('상태 ' + ITEM_STATUS[patch.status]);
    if ('assignee' in patch) parts.push('담당 ' + (patch.assignee || '없음'));
    if (patch.due_date) parts.push((patch.start_date ? mdDate(patch.start_date) + ' ~ ' : '마감 ') + mdDate(patch.due_date));
    else if (patch.start_date) parts.push('시작 ' + mdDate(patch.start_date));
    return '바꿨습니다: ' + parts.join(', ');
  };

  const handlers = {
    onPatch: (task, body) => run(async () => { replaceTask(await updateCouncilTask(task.id, body)); return true; }),
    onDelete: (task) => setConfirm({ type: 'task', target: task }),
    onAddNote: (task, kind, body) => run(async () => { replaceTask(await addCouncilNote(task.id, kind, body.trim())); return true; },
      NOTE_KIND_META[kind].label + '을 남겼습니다.'),
    onSaveNote: (note, body) => run(async () => { replaceTask(await updateCouncilNote(note.id, body.trim())); return true; }),
    onDeleteNote: (note) => setConfirm({ type: 'note', target: note }),
    onAddItem: (task, body) => run(async () => { replaceTask(await addCouncilItem(task.id, body)); return true; }),
    // 상태 원: 예정 → 진행 → 완료 → 예정
    onCycleItem: (item) => moveItem(item, { status: NEXT_ITEM_STATUS[item.status] }, '항목 상태: ' + ITEM_STATUS[NEXT_ITEM_STATUS[item.status]]),
    onMoveItem: (item, patch) => moveItem(item, patch, moveText(patch)),
    onOpenItem: (task, item) => setItemEdit({ task, item }),
    onNewItem: (task, draft) => setItemEdit({ task: task || null, draft: draft || {} }),
    onAddMilestone: (task, body) => run(async () => { replaceTask(await addCouncilMilestone(task.id, body)); return true; }),
    onDeleteMilestone: (ms) => setConfirm({ type: 'milestone', target: ms }),
  };

  const saveItem = async (task, item, body) => {
    const opened = itemEdit;   // 응답이 늦게 와도 그 사이 새로 연 다른 편집 창은 닫지 않는다
    const ok = await run(async () => {
      replaceTask(item ? await updateCouncilItem(item.id, body) : await addCouncilItem(task.id, body));
      return true;
    }, item ? '항목을 고쳤습니다.' : '항목을 추가했습니다.');
    if (ok) setItemEdit((cur) => (cur === opened ? null : cur));
  };

  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.type === 'task') {
      await run(async () => {
        await deleteCouncilTask(c.target.id);
        setTasks((list) => list.filter((t) => t.id !== c.target.id));
        setSelectedId(null);
        return true;
      }, '과제를 지웠습니다.');
    } else if (c.type === 'item') {
      const ok = await run(async () => { replaceTask(await deleteCouncilItem(c.target.id)); return true; }, '항목을 지웠습니다.');
      if (ok) setItemEdit((cur) => (cur?.item?.id === c.target.id ? null : cur));
    } else if (c.type === 'milestone') {
      await run(async () => { replaceTask(await deleteCouncilMilestone(c.target.id)); return true; }, '마일스톤을 지웠습니다.');
    } else {
      await run(async () => { replaceTask(await deleteCouncilNote(c.target.id)); return true; }, '기록을 지웠습니다.');
    }
  };

  const createTask = (body) => run(async () => {
    const row = await createCouncilTask(body);
    replaceTask(row);
    setCreating(false);
    setSelectedId(row.id);
    return true;
  }, '새 과제를 만들었습니다.');

  const seed = async () => {
    const ok = await run(() => seedFirstMeeting(), '1차 회의 수요를 넣었습니다.');
    // 성공 알림 뒤에 다시 읽는다 — 다시 읽기가 실패하면 그 오류가 성공 알림을 덮어 보이게.
    if (ok) await load({ quiet: true });
  };

  const setStatus = (key) => setFilter((f) => ({ ...f, status: f.status === key ? '' : key }));
  // 상태 요약: 테두리 없는 글자 단추 한 줄(0건인 상태는 빼고, 고른 것만 굵게 밑줄).
  const sumBtn = (on) => 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm transition-colors cursor-pointer ' +
    (on ? 'bg-slate-100 font-bold text-slate-900' : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900');
  const wide = view !== 'list';
  const title = '구조해석 자동화 협의체 과제 현황';
  const subtitle = '부서가 요청한 자동화 과제와 진행 상황, 팀장과 실장님 의견을 함께 봅니다.';

  return (
    <div className={browser ? '' : 'pb-16'}>
      {!browser && (
        <PageHeader
          title="Automation Council"
          icon={ClipboardList}
          subtitle={title + '. ' + subtitle}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => load({ quiet: true })} className={HEADER_BUTTON}><RefreshCw size={14} /> 새로 고침</button>
              <button type="button" onClick={copyLink} className={HEADER_BUTTON}><Copy size={14} /> 주소 복사</button>
              <button type="button" onClick={openInBrowser} className={HEADER_BUTTON}><ExternalLink size={14} /> 브라우저로 열기</button>
              <button type="button" onClick={startCreate} className={HEADER_BUTTON}><Plus size={14} /> 새 과제</button>
            </div>
          )}
        />
      )}

      <div className={'mx-auto ' + (wide ? 'max-w-[1760px]' : 'max-w-7xl')}>
        {browser && (
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-brand-blue">{title}</h1>
              <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => load({ quiet: true })} className={BTN}><RefreshCw size={15} /> 새로 고침</button>
              <button type="button" onClick={startCreate} className={BTN_PRIMARY}><Plus size={16} /> 새 과제</button>
            </div>
          </div>
        )}
        {!browser && (
          <p className="mb-3 text-[13px] text-slate-600">
            브라우저 주소: <span className="select-all font-mono text-slate-800">{shareUrl}</span>
            <span className="ml-2">관리자 계정으로 로그인한 사람만 열 수 있습니다.</span>
          </p>
        )}

        {phase === 'loading' && <p className="py-16 text-center text-sm text-slate-600">과제를 불러오는 중입니다…</p>}
        {phase === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-800">{loadError}</p>
            <button type="button" onClick={() => load()} className={BTN + ' mt-3'}>다시 시도</button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            {/* 보기 전환(주 내비게이션) + 찾기 */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200">
              <div className="flex" role="tablist" aria-label="보기">
                {VIEWS.map(([key, label, Icon]) => {
                  const on = view === key;
                  const locked = key !== 'list' && !canItems;
                  return (
                    <button key={key} type="button" role="tab" aria-selected={on} disabled={locked}
                      title={locked ? '서버를 다시 시작한 뒤부터 쓸 수 있습니다' : undefined}
                      onClick={() => { setView(key); if (key !== 'list') setCreating(false); }}
                      className={'-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-4 text-[15px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ' +
                        (on ? 'border-brand-blue font-bold text-brand-blue' : 'border-transparent font-semibold text-slate-600 hover:text-slate-900')}>
                      <Icon size={17} aria-hidden="true" /> {label}
                    </button>
                  );
                })}
              </div>
              <span className="ml-auto pb-1 text-[13px] tabular-nums text-slate-500">마지막 갱신 {updatedAt ? formatDateTime(updatedAt) : '없음'}</span>
            </div>

            {/* 거르기 한 줄: 상태 요약(0건은 뺌), 지연과 멈춤(있을 때만), 의뢰 부서, 찾기 */}
            <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
              <button type="button" className={sumBtn(!filter.status)} onClick={() => setFilter((f) => ({ ...f, status: '' }))} aria-pressed={!filter.status}>
                전체 <b className="tabular-nums">{summary.total}</b>
              </button>
              {STATUS_ORDER.filter((s) => summary.byStatus[s] > 0 || filter.status === s).map((s) => (
                <button key={s} type="button" className={sumBtn(filter.status === s)} onClick={() => setStatus(s)} aria-pressed={filter.status === s}>
                  <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[s].dot }} aria-hidden="true" />
                  {STATUS_META[s].label} <b className="tabular-nums">{summary.byStatus[s]}</b>
                </button>
              ))}
              {(summary.late > 0 || filter.status === 'late') && (
                <button type="button" className={sumBtn(filter.status === 'late') + ' text-red-700 hover:text-red-800'} onClick={() => setStatus('late')} aria-pressed={filter.status === 'late'}>
                  <AlertTriangle size={14} aria-hidden="true" /> 지연 <b className="tabular-nums">{summary.late}</b>
                </button>
              )}
              {(summary.stale > 0 || filter.status === 'stale') && (
                <button type="button" className={sumBtn(filter.status === 'stale') + ' text-amber-800 hover:text-amber-900'} onClick={() => setStatus('stale')} aria-pressed={filter.status === 'stale'}
                  title={STALE_DAYS + '일 넘게 과제도 항목도 기록도 바뀌지 않은 진행 과제'}>
                  <Clock size={14} aria-hidden="true" /> 멈춤 <b className="tabular-nums">{summary.stale}</b>
                </button>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label>
                  <span className="sr-only">의뢰 부서</span>
                  <select value={department} onChange={(e) => setFilter((f) => ({ ...f, department: e.target.value }))} className={SELECT}>
                    <option value="">모든 의뢰 부서</option>
                    {departments.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.count})</option>)}
                  </select>
                </label>
                <label className="relative">
                  <span className="sr-only">과제 찾기</span>
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} placeholder="과제, 항목, 담당 찾기"
                    className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20" />
                </label>
                {view === 'list' && (
                  <div className={SEG_WRAP} role="group" aria-label="묶어 보기">
                    {[['department', '부서별'], ['status', '상태별']].map(([key, label]) => (
                      <button key={key} type="button" onClick={() => setGroupBy(key)} aria-pressed={groupBy === key} className={segBtn(groupBy === key)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {tasks.length === 0 && !creating ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <ClipboardList size={28} className="mx-auto text-slate-400" />
                <p className="mt-3 text-base font-bold text-slate-800">아직 과제가 없습니다</p>
                <p className="mt-1 text-sm text-slate-600">
                  {hasAny ? '새 과제를 만드세요.' : '1차 회의(2026-11-24)에서 나온 부서별 수요 10건을 넣거나 새 과제를 만드세요.'}
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  {!hasAny && <button type="button" onClick={seed} disabled={busy} className={BTN}>1차 회의 수요 10건 넣기</button>}
                  <button type="button" onClick={startCreate} className={BTN_PRIMARY}><Plus size={16} /> 새 과제</button>
                </div>
              </div>
            ) : view === 'board' && canItems ? (
              <div className="mt-4">
                <CouncilBoard tasks={visible} now={now} busy={busy} onMoveItem={handlers.onMoveItem} onCycleItem={handlers.onCycleItem}
                  onOpenItem={handlers.onOpenItem} onNewItem={handlers.onNewItem} />
              </div>
            ) : view === 'timeline' && canItems ? (
              <div className="mt-4">
                <CouncilTimeline tasks={visible} now={now} busy={busy} onMoveItem={handlers.onMoveItem} onOpenItem={handlers.onOpenItem} onNewItem={handlers.onNewItem}
                  onSelectTask={(t) => { setSelectedId(t.id); setView('list'); revealDetail(); }} />
              </div>
            ) : (
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(400px,480px)]">
                {/* 목록 */}
                <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {groups.length === 0 && <p className="p-8 text-center text-sm text-slate-600">조건에 맞는 과제가 없습니다.</p>}
                  {groups.map((g) => (
                    <section key={g.key}>
                      <h2 className="flex items-baseline gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[13px] font-bold text-slate-700">
                        {g.label} <span className="font-semibold tabular-nums text-slate-500">{g.tasks.length}</span>
                      </h2>
                      <ul>
                        {g.tasks.map((t) => {
                          const on = t.id === selectedId && !creating;
                          const c = noteCounts(t);
                          const it = itemStats(t, now);
                          const closed = t.status === 'done' || t.status === 'hold';
                          return (
                            <li key={t.id} className="border-b border-slate-100 last:border-b-0">
                              <button
                                type="button"
                                onClick={() => { setCreating(false); setSelectedId(t.id); revealDetail(); }}
                                aria-current={on ? 'true' : undefined}
                                className={'block w-full px-4 py-3 text-left transition-colors cursor-pointer ' + (on ? 'bg-blue-50' : 'hover:bg-slate-50')}
                              >
                                <div className="flex items-center gap-3">
                                  <span className={'flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold ' + (closed ? 'text-slate-500' : 'text-slate-900')}>
                                    {t.important && <Star size={14} className="shrink-0 text-amber-600" fill="currentColor" aria-label="중요" />}
                                    <span className="truncate">{t.title}</span>
                                  </span>
                                  <TaskDue task={t} now={now} />
                                  <span className="flex w-[100px] shrink-0 justify-start"><StatusBadge status={t.status} /></span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-600">
                                  {groupBy === 'status' && <span className="shrink-0 font-semibold text-slate-700">{t.department}</span>}
                                  {t.owner && <span className="shrink-0">{t.owner}</span>}
                                  {it.total > 0 && (
                                    <span className="shrink-0 tabular-nums" title={'항목 예정 ' + it.todo + ', 진행 ' + it.doing + ', 완료 ' + it.done}>
                                      항목 {it.done}/{it.total}
                                      {it.late > 0 && <b className="ml-1.5 text-red-700">지연 {it.late}</b>}
                                    </span>
                                  )}
                                  {(c.comment > 0 || c.progress > 0) && (
                                    <span className="inline-flex shrink-0 items-center gap-1 tabular-nums"><MessageSquare size={13} aria-hidden="true" /> {c.comment + c.progress}</span>
                                  )}
                                  {isStale(t, now) && <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-800"><Clock size={13} aria-hidden="true" /> 멈춤</span>}
                                  {it.next
                                    ? <span className="min-w-0 truncate">다음 마감 {mdDate(it.next.due_date)} {it.next.title}</span>
                                    : t.next_step && <span className="min-w-0 truncate">다음: {t.next_step}</span>}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>

                {/* 상세 */}
                <aside ref={detailRef} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" aria-label="과제 상세">
                  {creating ? (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-base font-bold text-slate-900">새 과제</h2>
                        <button type="button" onClick={() => setCreating(false)} className={ICON_BTN} aria-label="닫기"><X size={16} /></button>
                      </div>
                      <TaskForm
                        initial={{ ...EMPTY_TASK_FORM, department }}
                        departments={departments}
                        assignees={assignees}
                        busy={busy}
                        submitLabel="만들기"
                        onCancel={() => setCreating(false)}
                        onSubmit={createTask}
                      />
                    </div>
                  ) : selected ? (
                    <TaskDetail key={selected.id} task={selected} now={now} busy={busy} departments={departments} assignees={assignees} canItems={canItems} {...handlers} />
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-600">왼쪽에서 과제를 고르세요.</p>
                  )}
                </aside>
              </div>
            )}
          </>
        )}
      </div>

      {notice && (
        <div role="status" className={'fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ' +
          (notice.tone === 'error' ? 'bg-red-700' : 'bg-brand-blue')}>
          <span>{notice.text}</span>
          {notice.undo && (
            <button type="button" onClick={() => { const undo = notice.undo; setNotice(null); undo(); }}
              className="rounded border border-white/40 px-2 py-0.5 text-[13px] font-bold text-white hover:bg-white/15 cursor-pointer">
              되돌리기
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={doConfirm}
        title={{ task: '과제 지우기', item: '항목 지우기', milestone: '마일스톤 지우기' }[confirm?.type] || '기록 지우기'}
        message={confirm?.type === 'task'
          ? '"' + (confirm?.target?.title || '') + '" 과제를 지웁니다. 목록에서 사라지고 다른 관리자에게도 보이지 않습니다.'
          : confirm?.type === 'item' || confirm?.type === 'milestone'
            ? '"' + (confirm?.target?.title || '') + '"을(를) 지웁니다. 되돌릴 수 없습니다.'
            : '이 기록을 지웁니다. 되돌릴 수 없습니다.'}
        confirmLabel="지우기"
      />

      <ItemEditor
        state={itemEdit}
        tasks={tasks}
        assignees={assignees}
        busy={busy}
        onSave={saveItem}
        onDelete={(item) => setConfirm({ type: 'item', target: item })}
        onClose={() => setItemEdit(null)}
      />
    </div>
  );
}
