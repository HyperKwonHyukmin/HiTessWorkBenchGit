/// <summary>
/// 관리자 전용 — 개발자가 기억해야 할 빌드/배포/경로/명령어 메모(런북) 관리.
/// 카드 그리드 + 카테고리 탭 + 검색 + 상세 패널(마크다운 렌더 + 경로 열기/명령 복사 액션) + 편집 모달.
/// </summary>
import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { Dialog, Transition, TransitionChild } from '@headlessui/react';
import {
  BookMarked, Plus, Search, RefreshCw, Edit2, Trash2, X,
  Folder, FileText, Server, Globe, ClipboardCopy, ExternalLink,
  Save, Tag, User, Calendar,
} from 'lucide-react';

import {
  getDevRunbooks, createDevRunbook, updateDevRunbook, deleteDevRunbook,
} from '../../api/admin';
import PageHeader from '../../components/ui/PageHeader';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import MarkdownRenderer from '../../components/ui/MarkdownRenderer';
import { useToast } from '../../contexts/ToastContext';

const CATEGORIES = ['All', 'Studio', 'Builder', 'AI', 'Nastran', 'Build', 'Other'];

const KIND_ICON = {
  folder: Folder,
  file:   FileText,
  unc:    Server,
  url:    Globe,
};

const EMPTY_FORM = {
  title: '',
  category: 'Other',
  summary: '',
  paths: [],
  commands: [],
  content: '',
  owner: '',
};


export default function DeveloperRunbooks() {
  const { showToast } = useToast();
  const [runbooks, setRunbooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);   // null=닫힘, {} 또는 runbook=열림
  const [deleteTarget, setDeleteTarget] = useState(null);

  /* ── 로딩 ─────────────────────────────────────────────── */
  const fetchRunbooks = async () => {
    setLoading(true);
    try {
      const res = await getDevRunbooks();
      setRunbooks(res.data || []);
      // 처음 로드 시 첫 항목 자동 선택
      if (res.data?.length && selectedId == null) {
        setSelectedId(res.data[0].id);
      }
    } catch (e) {
      console.error(e);
      showToast('런북 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRunbooks(); /* eslint-disable-next-line */ }, []);

  /* ── 필터/선택 ────────────────────────────────────────── */
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return runbooks
      .filter(r => activeCategory === 'All' || r.category === activeCategory)
      .filter(r => !q
        || (r.title || '').toLowerCase().includes(q)
        || (r.summary || '').toLowerCase().includes(q)
        || (r.content || '').toLowerCase().includes(q));
  }, [runbooks, activeCategory, searchTerm]);

  const selected = useMemo(
    () => runbooks.find(r => r.id === selectedId) || filtered[0] || null,
    [runbooks, selectedId, filtered]
  );

  // 카테고리/검색 결과 변경 시 선택 항목이 결과에서 사라지면 첫 항목으로
  useEffect(() => {
    if (!selected && filtered.length) setSelectedId(filtered[0].id);
  }, [filtered, selected]);

  /* ── CRUD ─────────────────────────────────────────────── */
  const handleSave = async (form) => {
    try {
      if (form.id) {
        await updateDevRunbook(form.id, stripId(form));
        showToast('수정되었습니다.', 'success');
      } else {
        const res = await createDevRunbook(stripId(form));
        showToast('추가되었습니다.', 'success');
        setSelectedId(res.data?.id);
      }
      setEditing(null);
      await fetchRunbooks();
    } catch (e) {
      console.error(e);
      showToast(`저장 실패: ${e.response?.data?.detail || e.message}`, 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDevRunbook(deleteTarget.id);
      showToast('삭제되었습니다.', 'success');
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      await fetchRunbooks();
    } catch (e) {
      console.error(e);
      showToast(`삭제 실패: ${e.response?.data?.detail || e.message}`, 'error');
    }
  };

  /* ── 렌더 ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full bg-slate-50">
      <PageHeader
        title="Developer Runbooks"
        icon={BookMarked}
        subtitle="빌드·배포·경로·명령어 메모. 개발자만 보는 공간."
        accentColor="violet"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchRunbooks}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/90 hover:text-white border border-white/30 hover:border-white/60 rounded-lg transition-colors cursor-pointer"
              title="새로고침"
            >
              <RefreshCw size={13} /> 새로고침
            </button>
            <button
              onClick={() => setEditing({ ...EMPTY_FORM })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-violet-700 hover:bg-violet-50 rounded-lg transition-colors cursor-pointer"
            >
              <Plus size={14} /> 새 런북
            </button>
          </div>
        }
      />

      <div className="flex-1 flex gap-3 p-3 min-h-0">
        {/* ── Left: 카테고리 + 카드 리스트 ── */}
        <div className="w-96 flex flex-col gap-2 min-h-0">
          {/* 검색 */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="제목·요약·본문 검색"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>

          {/* 카테고리 탭 */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(cat => {
              const count = cat === 'All'
                ? runbooks.length
                : runbooks.filter(r => r.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors cursor-pointer ${
                    activeCategory === cat
                      ? 'bg-violet-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-violet-50 border border-slate-200'
                  }`}
                >
                  {cat} <span className="opacity-70">({count})</span>
                </button>
              );
            })}
          </div>

          {/* 카드 리스트 */}
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
            {loading && (
              <div className="text-center text-xs text-slate-400 py-6">로딩 중…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-6">표시할 런북이 없습니다.</div>
            )}
            {filtered.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer border ${
                  selected?.id === r.id
                    ? 'bg-violet-50 border-violet-300 ring-1 ring-violet-300'
                    : 'bg-white border-slate-200 hover:border-violet-200 hover:bg-violet-50/40'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Tag size={10} className="text-violet-500" />
                  <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">
                    {r.category}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-800 mb-0.5 line-clamp-2">
                  {r.title}
                </div>
                {r.summary && (
                  <div className="text-[11px] text-slate-500 line-clamp-2">
                    {r.summary}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: 상세 패널 ── */}
        <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
          {selected ? (
            <RunbookDetail
              runbook={selected}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleteTarget(selected)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
              왼쪽에서 런북을 선택하세요.
            </div>
          )}
        </div>
      </div>

      {/* 편집/추가 모달 */}
      <RunbookEditorModal
        isOpen={editing != null}
        runbook={editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />

      {/* 삭제 확인 */}
      <ConfirmDialog
        isOpen={deleteTarget != null}
        title="런북 삭제"
        message={deleteTarget ? `"${deleteTarget.title}" 을(를) 삭제하시겠습니까?` : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
   상세 패널
   ──────────────────────────────────────────────────────────────────────── */

function RunbookDetail({ runbook, onEdit, onDelete }) {
  const { showToast } = useToast();

  const handleOpenPath = async (value) => {
    try {
      const res = await window.electron?.invoke?.('shell:openPath', value);
      if (!res?.ok) showToast(`경로를 열 수 없습니다: ${res?.error || 'Electron 환경 아님'}`, 'error');
    } catch (e) {
      showToast(`경로 열기 실패: ${e.message}`, 'error');
    }
  };

  const handleCopy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast('클립보드에 복사되었습니다.', 'success');
    } catch (e) {
      showToast(`복사 실패: ${e.message}`, 'error');
    }
  };

  const paths = Array.isArray(runbook.paths) ? runbook.paths : [];
  const commands = Array.isArray(runbook.commands) ? runbook.commands : [];

  return (
    <>
      {/* 헤더 */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider bg-violet-100 px-2 py-0.5 rounded-full">
              {runbook.category}
            </span>
            {runbook.owner && (
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <User size={10} /> {runbook.owner}
              </span>
            )}
            {runbook.updated_at && (
              <span className="flex items-center gap-1 text-[10px] text-slate-400">
                <Calendar size={10} /> {fmtDate(runbook.updated_at)}
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold text-slate-800">{runbook.title}</h2>
          {runbook.summary && (
            <p className="text-sm text-slate-500 mt-1">{runbook.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-violet-700 border border-slate-200 hover:border-violet-300 rounded-lg transition-colors cursor-pointer"
            title="편집"
          >
            <Edit2 size={12} /> 편집
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-slate-400 hover:text-red-600 border border-slate-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer"
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
        {/* 경로 */}
        {paths.length > 0 && (
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">경로</h3>
            <div className="space-y-1.5">
              {paths.map((p, i) => {
                const Icon = KIND_ICON[p.kind] || FileText;
                return (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg group">
                    <Icon size={14} className="text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {p.label && <div className="text-[10px] font-semibold text-slate-500">{p.label}</div>}
                      <div className="text-xs font-mono text-slate-700 truncate" title={p.value}>{p.value}</div>
                    </div>
                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopy(p.value)}
                        className="p-1 text-slate-400 hover:text-violet-600 cursor-pointer"
                        title="복사"
                      >
                        <ClipboardCopy size={12} />
                      </button>
                      <button
                        onClick={() => handleOpenPath(p.value)}
                        className="p-1 text-slate-400 hover:text-violet-600 cursor-pointer"
                        title="탐색기 열기"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 명령어 */}
        {commands.length > 0 && (
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">명령어</h3>
            <div className="space-y-1.5">
              {commands.map((c, i) => (
                <div key={i} className="px-3 py-2 bg-slate-900 rounded-lg group">
                  {c.label && (
                    <div className="text-[10px] font-semibold text-slate-400 mb-0.5">{c.label}</div>
                  )}
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-emerald-300 break-all">{c.value}</code>
                    <button
                      onClick={() => handleCopy(c.value)}
                      className="p-1 text-slate-500 hover:text-emerald-300 opacity-60 group-hover:opacity-100 transition cursor-pointer shrink-0"
                      title="복사"
                    >
                      <ClipboardCopy size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 마크다운 본문 */}
        {runbook.content && (
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">메모</h3>
            <div className="prose prose-sm max-w-none">
              <MarkdownRenderer content={runbook.content} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
   편집/추가 모달
   ──────────────────────────────────────────────────────────────────────── */

function RunbookEditorModal({ isOpen, runbook, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (runbook) {
      setForm({
        ...EMPTY_FORM,
        ...runbook,
        paths: Array.isArray(runbook.paths) ? runbook.paths : [],
        commands: Array.isArray(runbook.commands) ? runbook.commands : [],
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [runbook]);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const updateRow = (key, idx, field, value) => setForm(f => ({
    ...f,
    [key]: f[key].map((row, i) => i === idx ? { ...row, [field]: value } : row),
  }));
  const addRow    = (key, blank) => setForm(f => ({ ...f, [key]: [...f[key], blank] }));
  const removeRow = (key, idx)   => setForm(f => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));

  const isValid = form.title.trim() && form.category;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[9998]" onClose={onClose}>
        <TransitionChild as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <BookMarked size={16} className="text-violet-600" />
                  <h3 className="text-sm font-bold text-slate-800">
                    {form.id ? '런북 편집' : '새 런북'}
                  </h3>
                </div>
                <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer">
                  <X size={18} />
                </button>
              </div>

              {/* 본문 */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                {/* 제목 + 카테고리 + 담당자 */}
                <div className="grid grid-cols-12 gap-3">
                  <Field label="제목" required className="col-span-7">
                    <input value={form.title} onChange={set('title')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400" />
                  </Field>
                  <Field label="카테고리" required className="col-span-3">
                    <select value={form.category} onChange={set('category')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white">
                      {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="담당자" className="col-span-2">
                    <input value={form.owner || ''} onChange={set('owner')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400" />
                  </Field>
                </div>

                {/* 요약 */}
                <Field label="요약 (한 줄)">
                  <input value={form.summary || ''} onChange={set('summary')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400" />
                </Field>

                {/* 경로 */}
                <Field label="경로 (탐색기에서 열림)">
                  <div className="space-y-1.5">
                    {form.paths.map((p, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                        <input placeholder="라벨" value={p.label || ''}
                          onChange={(e) => updateRow('paths', i, 'label', e.target.value)}
                          className="col-span-3 px-2 py-1.5 text-xs border border-slate-200 rounded-md" />
                        <input placeholder="경로 (file/folder/UNC/URL)" value={p.value || ''}
                          onChange={(e) => updateRow('paths', i, 'value', e.target.value)}
                          className="col-span-7 px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-md" />
                        <select value={p.kind || 'file'}
                          onChange={(e) => updateRow('paths', i, 'kind', e.target.value)}
                          className="col-span-1 px-1 py-1.5 text-xs border border-slate-200 rounded-md bg-white">
                          <option value="file">file</option>
                          <option value="folder">folder</option>
                          <option value="unc">unc</option>
                          <option value="url">url</option>
                        </select>
                        <button onClick={() => removeRow('paths', i)}
                          className="col-span-1 p-1.5 text-slate-400 hover:text-red-600 cursor-pointer">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addRow('paths', { label: '', value: '', kind: 'file' })}
                      className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-violet-600 hover:bg-violet-50 border border-dashed border-violet-300 rounded-md cursor-pointer">
                      <Plus size={12} /> 경로 추가
                    </button>
                  </div>
                </Field>

                {/* 명령어 */}
                <Field label="명령어 (한 줄 복사용)">
                  <div className="space-y-1.5">
                    {form.commands.map((c, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                        <input placeholder="라벨" value={c.label || ''}
                          onChange={(e) => updateRow('commands', i, 'label', e.target.value)}
                          className="col-span-3 px-2 py-1.5 text-xs border border-slate-200 rounded-md" />
                        <input placeholder="명령어" value={c.value || ''}
                          onChange={(e) => updateRow('commands', i, 'value', e.target.value)}
                          className="col-span-8 px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-md" />
                        <button onClick={() => removeRow('commands', i)}
                          className="col-span-1 p-1.5 text-slate-400 hover:text-red-600 cursor-pointer">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addRow('commands', { label: '', value: '' })}
                      className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-violet-600 hover:bg-violet-50 border border-dashed border-violet-300 rounded-md cursor-pointer">
                      <Plus size={12} /> 명령어 추가
                    </button>
                  </div>
                </Field>

                {/* 마크다운 본문 */}
                <Field label="메모 (마크다운)">
                  <textarea value={form.content || ''} onChange={set('content')} rows={10}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400 resize-y" />
                </Field>
              </div>

              {/* 푸터 */}
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50">
                <button onClick={onClose}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer">
                  취소
                </button>
                <button onClick={() => onSave(form)} disabled={!isValid}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg cursor-pointer">
                  <Save size={12} /> 저장
                </button>
              </div>
            </Dialog.Panel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
   유틸
   ──────────────────────────────────────────────────────────────────────── */

function Field({ label, required, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return ''; }
}

function stripId(form) {
  const { id, created_at, updated_at, ...rest } = form;
  return rest;
}
