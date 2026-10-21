/// <summary>
/// All Projects — 작업 폴더 BDF 의 3D 미리보기(LogBook 보내기 전에 모델을 확인).
/// 엔진·계산은 LogBook 뷰어 사본(lb/), 화면 껍데기만 WorkBench 문법으로 새로 짰다.
/// 부모(AdminProjectDetailModal)가 headlessui Dialog 라 이것도 중첩 Dialog 로 띄운다 —
/// 그래야 이 안을 누르는 것이 부모의 '바깥 클릭'으로 잡혀 부모가 닫히지 않는다.
/// </summary>
import { useMemo, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { ChevronDown, ChevronRight, Focus, Loader2, LocateFixed, Scan, X } from 'lucide-react';
import { getAdminModelPreview } from '../../api/adminProjects';
import { formatBytes } from '../../utils/adminProjectFiles';
import { useBdfPreview } from './useBdfPreview';
import { COLOR_MODES, COLOR_MODE_LABELS, legendItems } from './lb/lib/legend.js';
import { beamOrientInfo, elementInfo, nodeInfo, rigidInfo, sectionLabel } from './lb/lib/elementInfo.js';
import { NODE_CLASS_KEYS, NODE_CLASS_LABELS, nodesOfClass } from './lb/lib/nodeCheck.js';
import { MARKER_COLORS, NODE_CLASS_COLORS, groupColor } from './lb/lib/pidPalette.js';
import { VIEW_PRESETS } from './lb/lib/viewFrame.js';

const num = (n) => Number(n).toLocaleString('ko-KR');
const fmtLen = (n) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const VIEW_ITEMS = Object.entries(VIEW_PRESETS).map(([id, p]) => ({ id, label: p.label, keys: p.keys }));
const RENDER_ITEMS = [{ id: 'line', label: '선' }, { id: 'section', label: '3D 단면' }];
const PROJECTION_ITEMS = [{ id: 'ortho', label: '직교' }, { id: 'persp', label: '원근' }];
const COLOR_ITEMS = COLOR_MODES.map((id) => ({ id, label: id === 'section' ? '단면' : id === 'type' ? '요소' : COLOR_MODE_LABELS[id] }));
const MARKER_KEYS = [['rbe2', 'RBE2'], ['rbe3', 'RBE3'], ['conm2', 'CONM2'], ['spc', 'SPC']];
const PANEL_TABS = [{ id: 'model', label: '모델' }, { id: 'group', label: '그룹' }, { id: 'check', label: '절점 점검' }];
const CLASS_HELP = { shared: '요소 2개 이상 또는 RBE', free: '요소 1개에만 연결', orphan: '연결된 요소 없음' };

/* ── 밝은 패널 부품 ─────────────────────────────────────────────────────────────── */

function Segmented({ items, value, onChange, disabled, label, dark = false }) {
  return (
    <div role="radiogroup" aria-label={label}
         className={`inline-flex items-center gap-0.5 rounded-md p-0.5 ${dark ? '' : 'bg-slate-100'}`}>
      {items.map((t) => {
        const on = t.id === value;
        const cls = dark
          ? (on ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white')
          : (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900');
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} disabled={disabled}
                  onClick={() => onChange(t.id)}
                  title={t.keys ? `${t.label} (${t.keys.map((k) => k.toUpperCase()).join('·')})` : undefined}
                  className={`h-7 whitespace-nowrap rounded px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children, aside = null, grow = false }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`flex flex-col border-b border-slate-200 ${grow && open ? 'min-h-0 flex-1' : 'shrink-0'}`}>
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                className="-ml-1 inline-flex h-7 items-center gap-1 rounded px-1 text-xs font-bold text-slate-700 hover:bg-slate-100">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          {title}
        </button>
        {aside && <div className="ml-auto flex items-center gap-1">{aside}</div>}
      </div>
      {open && <div className={grow ? 'flex min-h-0 flex-1 flex-col' : 'px-3 pb-3'}>{children}</div>}
    </section>
  );
}

function LinkButton({ onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

function LayerRow({ checked, onChange, label, count, swatch, keyHint, disabled }) {
  return (
    <label className={`flex h-7 items-center gap-2 text-xs ${disabled ? 'text-slate-500' : 'cursor-pointer text-slate-800'}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
             className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed" />
      {swatch && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="shrink-0 font-mono tabular-nums text-slate-500">{num(count)}</span>}
      {keyHint && <kbd className="shrink-0 rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-600">{keyHint}</kbd>}
    </label>
  );
}

function PidList({ v }) {
  const groups = v.model?.geometry.groups || [];
  return (
    <ul aria-label="PID" className="min-h-0 flex-1 overflow-y-auto py-1">
      {groups.map((g) => {
        const label = sectionLabel(v.model.lbm.header.properties?.[g.pid]);
        const on = !v.hidden.has(g.pid);
        return (
          <li key={g.pid}>
            <label title={label || undefined} className="flex h-8 cursor-pointer items-center gap-2 px-3 text-xs hover:bg-slate-50">
              <input type="checkbox" checked={on} onChange={() => v.toggleGroup(g.pid)} aria-label={`PID ${g.pid} 표시`}
                     className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600" />
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: g.color, opacity: on ? 1 : 0.35 }} />
              <span className={`w-10 shrink-0 truncate font-mono ${on ? 'text-slate-900' : 'text-slate-500'}`}>{g.pid}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-slate-600">{label}</span>
              <span className="shrink-0 font-mono tabular-nums text-slate-500">{num(g.count)}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function GroupList({ v }) {
  const groups = v.model?.groups.groups || [];
  if (!groups.length) return <p className="px-3 py-3 text-xs text-slate-500">요소가 없어 그룹이 없습니다</p>;
  return (
    <ul aria-label="연결 그룹" className="min-h-0 flex-1 overflow-y-auto py-1">
      {groups.map((g) => {
        const on = !v.groupHidden.has(g.index);
        const name = `그룹 ${g.index + 1}`;
        return (
          <li key={g.index} className="group flex h-11 items-center gap-2 px-3 hover:bg-slate-50">
            <input type="checkbox" checked={on} onChange={() => v.toggleConnGroup(g.index)} aria-label={`${name} 표시`}
                   className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600" />
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: groupColor(g.index), opacity: on ? 1 : 0.35 }} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-xs ${on ? 'text-slate-900' : 'text-slate-500'}`}>
                {name}{g.index === 0 && groups.length > 1 && <span className="ml-1.5 text-slate-500">주 구조</span>}
              </p>
              <p className="truncate text-[11px] tabular-nums text-slate-500">
                요소 {num(g.elements)} · 절점 {num(g.nodes)}{g.rigids > 0 && ` · RBE ${num(g.rigids)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button type="button" onClick={() => v.soloConnGroup(g.index)} aria-label={`${name}만 보기`} title="이 그룹만 보기"
                      className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"><Focus size={14} /></button>
              <button type="button" onClick={() => v.frameConnGroup(g.index)} aria-label={`${name}로 이동`} title="그룹으로 이동"
                      className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"><LocateFixed size={14} /></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function NodeCheck({ v }) {
  const check = v.model?.check;
  if (!check) return null;
  const ids = v.model.lbm.blocks.node_ids;
  return (
    <div className="flex flex-col gap-2">
      <LayerRow checked={v.nodes.visible} onChange={() => v.setNodes({ visible: !v.nodes.visible })} label="절점 표시" keyHint="N" />
      <ul aria-label="절점 점검" className="flex flex-col">
        {NODE_CLASS_KEYS.map((key, c) => {
          const count = check.counts[key];
          const list = c === 0 || count === 0 ? [] : nodesOfClass(check, c, 12);
          return (
            <li key={key} className="flex flex-col gap-1 border-t border-slate-200 py-2 first:border-t-0">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={v.nodes.classes[c]} disabled={!v.nodes.visible}
                       onChange={() => v.setNodes({ classes: v.nodes.classes.map((x, i) => (i === c ? !x : x)) })}
                       aria-label={`${NODE_CLASS_LABELS[key]} 절점 표시`}
                       className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed" />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" style={{ background: NODE_CLASS_COLORS[c] }} />
                <span className="text-slate-900">{NODE_CLASS_LABELS[key]}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{CLASS_HELP[key]}</span>
                <span className="shrink-0 font-mono tabular-nums text-slate-700">{num(count)}</span>
              </label>
              {list.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-[42px]">
                  {list.map((n) => (
                    <button key={n} type="button" onClick={() => v.select({ kind: 'node', index: n }, { frame: true })} title="이 절점으로 이동"
                            className={`h-6 rounded px-1.5 font-mono text-[11px] ${v.selection?.kind === 'node' && v.selection.index === n
                              ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                      {ids[n]}
                    </button>
                  ))}
                  {count > list.length && <span className="self-center text-[11px] text-slate-500">외 {num(count - list.length)}개</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
      {rows.filter(Boolean).map(([k, val, mono]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className={`min-w-0 break-words text-slate-900 ${mono ? 'font-mono' : ''}`}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

function SelectionInfo({ v }) {
  const sel = v.selection;
  const m = v.model;
  if (!sel || !m) return <p className="text-xs text-slate-500">3D 에서 요소·절점·RBE 를 누르면 정보가 보입니다.</p>;
  if (sel.kind === 'node') {
    const info = nodeInfo(m.lbm, m.geometry, sel.index, { check: m.check, groups: m.groups });
    return (
      <Rows rows={[
        ['절점', info.id, true],
        ['좌표', info.xyz.map(fmtLen).join(', '), true],
        ['연결', `요소 ${num(info.degree)}개`],
        ['점검', NODE_CLASS_LABELS[NODE_CLASS_KEYS[info.cls]]],
        ['그룹', info.group >= 0 ? `그룹 ${info.group + 1}` : '없음'],
        info.spc != null && ['SPC', info.spc, true],
        info.mass != null && ['CONM2', info.mass, true],
      ]} />
    );
  }
  if (sel.kind === 'rbe') {
    const info = rigidInfo(m.lbm, m.rigids, sel.index);
    const shown = info.others.slice(0, 24);
    return (
      <Rows rows={[
        ['EID', info.eid, true],
        ['카드', info.card, true],
        [info.card === 'RBE3' ? '기준' : '독립', info.center, true],
        [info.card === 'RBE3' ? '연결' : '종속', `${num(info.others.length)}개`],
        ['절점', `${shown.join(', ')}${info.others.length > shown.length ? ' …' : ''}`, true],
      ]} />
    );
  }
  const info = elementInfo(m.lbm, m.geometry, sel.index);
  const orient = beamOrientInfo(m.lbm, m.geometry, sel.index);
  return (
    <Rows rows={[
      ['EID', info.eid, true],
      ['카드', info.card, true],
      ['PID', info.pid, true],
      ['단면', info.section || '—', true],
      info.thickness != null && ['두께', info.thickness, true],
      ['재료', info.material || '—', true],
      ['절점', info.nodes.join(', '), true],
      info.length != null && ['길이', fmtLen(info.length), true],
      orient?.v && ['방향 v', orient.v, true],
      orient?.offset && ['오프셋', orient.offset, true],
      ['그룹', `그룹 ${m.groups.elemGroup[sel.index] + 1}`],
    ]} />
  );
}

/* ── 어두운 뷰포트 부품 ─────────────────────────────────────────────────────────── */

function DarkButton({ pressed, onClick, title, icon: Icon, children, disabled }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={pressed} disabled={disabled}
            className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40
              ${pressed ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-white/15" />;

function Toolbar({ v }) {
  const ready = v.ready;
  return (
    <div role="toolbar" aria-label="뷰 도구"
         className="flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-white/10 bg-[#24243a] p-0.5 shadow-md">
      <Segmented dark label="시점" items={VIEW_ITEMS} value={v.view} onChange={v.changeView} disabled={!ready} />
      <Sep />
      <DarkButton onClick={v.fit} title="화면 맞춤 (F)" icon={Scan} disabled={!ready}>맞춤</DarkButton>
      <Sep />
      <Segmented dark label="투영" items={PROJECTION_ITEMS} value={v.projection} onChange={v.setProjection} disabled={!ready} />
      <Sep />
      <Segmented dark label="표시 방식" items={RENDER_ITEMS} value={v.renderMode} onChange={v.setRenderMode} disabled={!ready} />
      <Sep />
      <DarkButton pressed={v.isolated} onClick={() => v.setIsolate(!v.isolated)} icon={Focus} disabled={!ready || !v.selection}
                  title={v.selection ? '선택한 것만 보기' : '먼저 요소나 절점을 누르세요'}>
        선택만 보기
      </DarkButton>
    </div>
  );
}

function Legend({ v }) {
  const m = v.model;
  const legend = useMemo(() => (m ? legendItems({
    mode: v.colorMode, table: m.table, elemGroup: m.groups.elemGroup, groupCount: m.groups.count,
    hiddenPids: v.hidden, hiddenGroups: v.groupHidden,
  }) : null), [m, v.colorMode, v.hidden, v.groupHidden]);
  if (!legend || v.isolated || !legend.items.length) return null;
  return (
    <div role="group" aria-label="범례"
         className="absolute bottom-3 right-3 z-10 w-[208px] rounded-lg border border-white/10 bg-[#24243a] px-2.5 py-2 text-xs text-slate-300 shadow-md">
      <p className="font-semibold text-white">{legend.title}</p>
      <ul className="mt-1.5 flex max-h-[min(34vh,280px)] flex-col gap-0.5 overflow-y-auto">
        {legend.items.map((it) => (
          <li key={it.key} className="flex h-5 items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color, opacity: it.hidden ? 0.3 : 1 }} />
            <span className={`min-w-0 flex-1 truncate ${it.hidden ? 'text-slate-500 line-through' : ''}`}>{it.label}</span>
            <span className="shrink-0 font-mono tabular-nums text-slate-400">{num(it.count)}</span>
          </li>
        ))}
        {legend.rest && (
          <li className="flex h-5 items-center pl-[18px] text-slate-400">외 {num(legend.rest.count)}개 · 요소 {num(legend.rest.elements)}</li>
        )}
      </ul>
    </div>
  );
}

function Viewport({ v }) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-[#1a1a2e]">
      <div ref={v.surfaceRef} tabIndex={0} role="application"
           aria-label="3D 모델. F 화면 맞춤, A·S·D·I 시점, E 경계선, N 절점, P 직교·원근, Esc 선택 해제"
           onPointerDown={v.onPointerDown} onPointerUp={v.onPointerUp}
           className="absolute inset-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400">
        {/* 엔진이 캔버스를 붙이는 자리 — React 자식을 두지 않는다. */}
        <div ref={v.mountRef} className="absolute inset-0" />
      </div>
      {v.state.status === 'loading' && (
        <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
          <Loader2 size={22} className="animate-spin" aria-hidden="true" />
          <span className="text-xs">서버에서 BDF 를 읽어 3D 로 바꾸는 중… 큰 모델은 수십 초 걸립니다.</span>
        </div>
      )}
      {v.state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p role="alert" className="max-w-md rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{v.state.error}</p>
        </div>
      )}
      {v.sectionProgress != null && (
        <div role="status" className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex justify-center">
          <span className="rounded bg-[#24243a] px-2 py-0.5 text-xs text-slate-300">단면 만드는 중 {Math.round(v.sectionProgress * 100)}%</span>
        </div>
      )}
      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-24px)]"><Toolbar v={v} /></div>
      {v.ready && <Legend v={v} />}
    </div>
  );
}

/* ── 대화상자 ──────────────────────────────────────────────────────────────────── */

/**
 * @param {object} p
 * @param {number} p.analysisId
 * @param {Array<{path, folder, rel, size}>} p.files   미리볼 수 있는 BDF 목록(오가기용). 첫 화면은 initialPath.
 * @param {string|null} p.initialPath                 null 이면 닫힘
 * @param {Set<string>} p.selected                    LogBook 으로 보낼 파일(부모 상태)
 * @param {(path: string) => void} p.onToggleSelected
 * @param {() => void} p.onClose
 */
export default function BdfPreviewDialog({ analysisId, files, initialPath, selected, onToggleSelected, onClose }) {
  const open = !!initialPath;
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 p-3 md:p-5">
        {open && (
          <PreviewPanel key={initialPath} analysisId={analysisId} files={files} initialPath={initialPath}
                        selected={selected} onToggleSelected={onToggleSelected} onClose={onClose} />
        )}
      </div>
    </Dialog>
  );
}

function PreviewPanel({ analysisId, files, initialPath, selected, onToggleSelected, onClose }) {
  const [path, setPath] = useState(initialPath);
  const [tab, setTab] = useState('model');
  const file = files.find((f) => f.path === path) || { path, rel: path.split(/[\\/]/).pop() };
  const v = useBdfPreview({
    sourceKey: `${analysisId}::${path}`,
    load: async (signal) => (await getAdminModelPreview(analysisId, path, { signal })).data,
  });
  const ready = v.ready;
  const m = v.model;

  const changeTab = (t) => {
    setTab(t);
    if (t === 'group' && ready && v.colorMode === 'pid') v.setColorMode('group');
  };
  const status = !m ? '' : tab === 'model'
    ? `PID ${num(m.geometry.groups.length)} · 요소 ${num(m.geometry.total)} · 절점 ${num(m.geometry.positions.length / 3)}`
    : tab === 'group'
      ? (m.groups.count > 1 ? `그룹 ${num(m.groups.count)} · 주 구조에서 떨어진 그룹 ${num(m.groups.count - 1)}` : `그룹 ${num(m.groups.count)} · 모두 이어져 있습니다`)
      : `자유단 ${num(m.check.counts.free)} · 고립 ${num(m.check.counts.orphan)}`;
  const warnings = m?.lbm.header.warnings || [];
  const unsupported = m?.lbm.header.unsupported;
  const unsupportedText = unsupported && typeof unsupported === 'object'
    ? Object.entries(unsupported).map(([k, n]) => `${k} ${num(n)}`).join(', ') : '';

  return (
    <DialogPanel onKeyDown={(e) => v.handleKey(e)}
                 className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-4 py-2.5">
        <DialogTitle className="text-sm font-bold text-slate-800">BDF 3D 미리보기</DialogTitle>
        {files.length > 1 ? (
          <select value={path} onChange={(e) => setPath(e.target.value)} aria-label="볼 BDF"
                  className="max-w-[420px] truncate rounded-md border border-slate-200 px-2 py-1 font-mono text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
            {files.map((f) => <option key={f.path} value={f.path}>{f.rel}</option>)}
          </select>
        ) : (
          <span className="truncate font-mono text-xs text-slate-600" title={file.rel}>{file.rel}</span>
        )}
        {file.size != null && <span className="text-[11px] tabular-nums text-slate-500">{formatBytes(file.size)}</span>}
        <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <input type="checkbox" checked={selected.has(path)} onChange={() => onToggleSelected(path)}
                 className="h-4 w-4 cursor-pointer accent-blue-600" />
          LogBook 으로 보낼 파일에 포함
        </label>
        <button type="button" onClick={onClose} aria-label="닫기" title="닫기"
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><X size={18} /></button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="모델 패널" className="flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <div role="tablist" aria-label="패널" className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-2">
            {PANEL_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => changeTab(t.id)}
                      className={`-mb-px border-b-2 px-2 pb-1.5 text-xs font-bold ${tab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="flex min-h-8 shrink-0 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11px] tabular-nums text-slate-600">{status}</p>
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {ready && tab === 'model' && (
              <>
                <Section title="색 기준">
                  <Segmented label="색 기준" items={COLOR_ITEMS} value={v.colorMode} onChange={v.setColorMode} />
                </Section>
                <Section title="레이어">
                  <LayerRow checked={v.edges} onChange={v.toggleEdges} label="요소 경계선" keyHint="E" />
                  <LayerRow checked={v.nodes.visible} onChange={() => v.setNodes({ visible: !v.nodes.visible })} label="절점"
                            count={m.geometry.positions.length / 3} keyHint="N" />
                  {MARKER_KEYS.filter(([key]) => v.markerCounts[key] > 0).map(([key, label]) => (
                    <LayerRow key={key} checked={v.markers[key]} onChange={() => v.toggleMarker(key)} label={label}
                              count={v.markerCounts[key]} swatch={MARKER_COLORS[key]} />
                  ))}
                </Section>
                <Section title="PID" grow aside={(
                  <>
                    <LinkButton disabled={v.hidden.size === 0} onClick={() => v.setAllPids(true)}>모두 보이기</LinkButton>
                    <LinkButton disabled={v.hidden.size === m.geometry.groups.length} onClick={() => v.setAllPids(false)}>모두 숨기기</LinkButton>
                  </>
                )}>
                  <PidList v={v} />
                </Section>
              </>
            )}
            {ready && tab === 'group' && (
              <>
                <p className="shrink-0 px-3 pt-2.5 text-xs text-slate-600">부재·쉘·RBE 로 이어진 것끼리 묶었습니다. 그룹 1 이 가장 큰 덩어리입니다.</p>
                <div className="flex shrink-0 justify-end gap-1 px-3 pt-1">
                  <LinkButton disabled={v.groupHidden.size === 0} onClick={() => v.setAllConnGroups(true)}>모두 보이기</LinkButton>
                </div>
                <GroupList v={v} />
              </>
            )}
            {ready && tab === 'check' && <div className="p-3"><NodeCheck v={v} /></div>}
          </div>
          {m && (warnings.length > 0 || unsupportedText) && (
            <details className="shrink-0 border-t border-slate-200 px-3 py-2 text-[11px] text-amber-800">
              <summary className="cursor-pointer font-semibold">변환 경고 {num(warnings.length)}{unsupportedText && ' · 미지원 카드 있음'}</summary>
              <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 font-mono text-slate-600">
                {unsupportedText && <li>그리지 않은 카드: {unsupportedText}</li>}
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </aside>

        <Viewport v={v} />

        <aside aria-label="선택 정보" className="hidden w-[260px] shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
          <h3 className="flex h-9 shrink-0 items-center border-b border-slate-200 px-3 text-xs font-bold text-slate-700">
            {v.selection?.kind === 'node' ? '선택 절점' : v.selection?.kind === 'rbe' ? '선택 RBE' : '선택 요소'}
          </h3>
          <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5"><SelectionInfo v={v} /></div>
          {v.selection && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-slate-200 px-2 py-2">
              <LinkButton onClick={v.frameSelection}>이동</LinkButton>
              <LinkButton onClick={() => v.setIsolate(!v.isolated)}>{v.isolated ? '전체 보기' : '선택만 보기'}</LinkButton>
              <span className="ml-auto" />
              <LinkButton onClick={() => v.select(null)}>해제</LinkButton>
            </div>
          )}
        </aside>
      </div>
    </DialogPanel>
  );
}
