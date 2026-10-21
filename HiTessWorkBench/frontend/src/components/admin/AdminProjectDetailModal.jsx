/// <summary>
/// 관리자 All Projects — 해석 1건의 작업 폴더 파일(입력·결과·기타)을 보고 받고,
/// 고른 파일을 Hi-TESS LogBook '정리 대기'로 보낸다(서버끼리 전송).
/// BDF 는 보내기 전에 3D 로 확인할 수 있다(BdfPreviewDialog — LogBook 뷰어 사본).
/// </summary>
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Box, Download, FileWarning, FolderOpen, Loader2, RefreshCw, Send,
} from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import { useToast } from '../../contexts/ToastContext';
import { getDisplayProgramName } from '../../contexts/DashboardContext';
import { exportProjectToLogbook, getAdminProjectFiles } from '../../api/adminProjects';
import { downloadFileBlob } from '../../api/analysis';
import { downloadBlob } from '../../utils/fileHelper';
import {
  defaultExportTitle, describeExportResult, formatBytes, formatShortDateTime, groupFilesByRole,
  isPreviewableBdf, summarizeSelection,
} from '../../utils/adminProjectFiles';
import BdfPreviewDialog from '../bdfPreview/BdfPreviewDialog';
import { useLogbookLauncher } from '../analysis/runFrame/LogbookImportButton';

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

function MetaItem({ label, children, wrap = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold text-slate-800 ${wrap ? 'break-words' : 'truncate'}`}>{children}</dd>
    </div>
  );
}

function FileGroup({ group, selected, onToggle, onToggleAll, onDownload, onPreview, showFolder, downloading }) {
  const sendable = group.files.filter(f => !f.drm);
  const allChecked = sendable.length > 0 && sendable.every(f => selected.has(f.path));
  return (
    <section className="rounded-xl border border-slate-200">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <input
          type="checkbox"
          checked={allChecked}
          disabled={sendable.length === 0}
          onChange={() => onToggleAll(group.files, !allChecked)}
          aria-label={`${group.label} 전체 선택`}
          className="h-4 w-4 cursor-pointer accent-blue-600"
        />
        <h4 className="text-xs font-bold text-slate-700">{group.label}</h4>
        <span className="text-[11px] text-slate-500">{group.files.length}개</span>
      </header>
      <ul className="divide-y divide-slate-100">
        {group.files.map(f => (
          <li key={f.path} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected.has(f.path)}
              disabled={f.drm}
              onChange={() => onToggle(f.path)}
              aria-label={`${f.rel} 선택`}
              className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={`${f.folder}/${f.rel}`}>
              {showFolder && <span className="text-slate-500">{f.folder}/</span>}
              {f.rel}
            </span>
            {f.drm && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                title="회사 DRM 으로 암호화된 파일 — LogBook 이 받지 않습니다">
                <FileWarning size={11} aria-hidden="true" /> DRM
              </span>
            )}
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{formatBytes(f.size)}</span>
            <span className="hidden w-28 shrink-0 text-right text-[11px] tabular-nums text-slate-500 md:inline">
              {formatShortDateTime(f.modified)}
            </span>
            {isPreviewableBdf(f) ? (
              <button
                type="button"
                onClick={() => onPreview(f)}
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                aria-label={`${f.rel} 3D 미리보기`}
                title="3D 미리보기"
              >
                <Box size={14} />
              </button>
            ) : (
              <span className="w-[22px] shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => onDownload(f)}
              disabled={downloading === f.path}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
              aria-label={`${f.rel} 받기`}
              title="받기"
            >
              {downloading === f.path ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminProjectDetailModal({ project, onClose, onExported }) {
  const { showToast } = useToast();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [previewPath, setPreviewPath] = useState(null);
  const { open: openLogbookInbox, launching } = useLogbookLauncher({
    next: 'inbox', showToast, openedMessage: 'LogBook 정리 대기 화면을 열었습니다.',
  });

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await getAdminProjectFiles(project.id);
      setListing(data);
      // 처음에는 아무것도 체크하지 않는다 — 보낼 파일은 관리자가 직접 고른다.
      setSelected(new Set());
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || '파일 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    setListing(null);
    setResult(null);
    setTitle('');
    setNote('');
    setPreviewPath(null);
    load();
  }, [load]);

  const files = useMemo(() => listing?.files || [], [listing]);
  const groups = useMemo(() => groupFilesByRole(files), [files]);
  const summary = useMemo(() => summarizeSelection(files, selected), [files, selected]);
  const showFolder = (listing?.folders?.length || 0) > 1;
  const bdfFiles = useMemo(() => groups.flatMap(g => g.files).filter(isPreviewableBdf), [groups]);
  // 미리보기에서 오갈 목록 — 체크한 BDF 가 있으면 그것만, 없으면 전체 BDF(행의 3D 버튼으로 연 경우 그 파일 포함)
  const checkedBdf = useMemo(() => bdfFiles.filter(f => selected.has(f.path)), [bdfFiles, selected]);
  const previewFiles = useMemo(() => {
    if (!previewPath) return [];
    const base = checkedBdf.length ? checkedBdf : bdfFiles;
    return base.some(f => f.path === previewPath) ? base : bdfFiles;
  }, [previewPath, checkedBdf, bdfFiles]);

  const toggle = (path) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleAll = (groupFiles, on) => setSelected(prev => {
    const next = new Set(prev);
    for (const f of groupFiles) {
      if (f.drm) continue;
      if (on) next.add(f.path); else next.delete(f.path);
    }
    return next;
  });

  const download = async (f) => {
    setDownloading(f.path);
    try {
      const response = await downloadFileBlob(f.path);
      downloadBlob(new Blob([response.data]), f.rel.split('/').pop());
    } catch (e) {
      showToast(e?.response?.status === 404 ? '파일이 없습니다(보관 기간 만료?).' : '파일을 받지 못했습니다.', 'error');
    } finally {
      setDownloading(null);
    }
  };

  const send = async () => {
    if (!summary.count || sending) return;
    setSending(true);
    setResult(null);
    try {
      const { data } = await exportProjectToLogbook(project.id, {
        paths: files.filter(f => selected.has(f.path)).map(f => f.path),
        title: title.trim(),
        note: note.trim(),
      });
      setResult(data);
      showToast(describeExportResult(data), data.state === 'blocked' ? 'warning' : 'success', 6000);
      onExported?.(project.id);
      load();
      // 묶음이 생겼으면 LogBook 창(정리 대기)을 바로 띄운다 — Truss 등의 'LogBook 에서 가져오기' 와 같은 추가 창.
      if (data.state !== 'blocked') openLogbookInbox();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'LogBook 으로 보내지 못했습니다.', 'error', 8000);
    } finally {
      setSending(false);
    }
  };

  const exports = listing?.exports || [];

  return (
    <Modal
      isOpen={!!project}
      onClose={sending ? () => {} : onClose}
      title={project?.project_name || 'Unnamed Project'}
      size="xl"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-600">
            선택 <span className="font-bold text-slate-800">{summary.count}</span>개 ·{' '}
            <span className="tabular-nums">{formatBytes(summary.bytes)}</span>
          </p>
          <div className="ml-auto flex gap-2">
            {checkedBdf.length > 0 && (
              <Button variant="secondary" size="md" onClick={() => setPreviewPath(checkedBdf[0].path)} disabled={sending}>
                <Box size={15} aria-hidden="true" />
                선택한 BDF 3D 보기{checkedBdf.length > 1 ? ` (${checkedBdf.length})` : ''}
              </Button>
            )}
            <Button variant="secondary" size="md" onClick={onClose} disabled={sending}>닫기</Button>
            <Button
              variant="primary"
              size="md"
              isLoading={sending}
              disabled={!summary.count || sending}
              onClick={send}
            >
              {!sending && <Send size={15} aria-hidden="true" />}
              {sending ? '보내는 중…' : 'LogBook 으로 보내기'}
            </Button>
          </div>
        </div>
      }
    >
      {project && (
        <div className="space-y-5 p-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
            <MetaItem label="사용자">
              {project.userName} <span className="font-mono text-xs font-normal text-slate-500">({project.employee_id})</span>
            </MetaItem>
            <MetaItem label="부서">{project.department}</MetaItem>
            <MetaItem label="App" wrap>{getDisplayProgramName(project.program_name)}</MetaItem>
            <MetaItem label="상태"><StatusBadge status={project.status} size="sm" /></MetaItem>
            <MetaItem label="실행 시각">{formatShortDateTime(project.created_at)}</MetaItem>
            <MetaItem label="기록 번호"><span className="font-mono">#{project.id}</span></MetaItem>
            <MetaItem label="파일 보관">
              <StatusBadge status={project.retention?.status || (project.files_available === false ? 'expired' : 'available')} size="sm" />
            </MetaItem>
            <MetaItem label="LogBook">
              {exports.some(x => x.state !== 'failed') ? `${exports.filter(x => x.state !== 'failed').length}번 보냄` : '보낸 적 없음'}
            </MetaItem>
          </dl>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <FolderOpen size={15} className="text-slate-500" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-800">작업 폴더 파일</h3>
              {listing?.folders?.length > 0 && (
                <span className="truncate font-mono text-[11px] text-slate-500" title={listing.folders.map(f => f.name).join('\n')}>
                  {listing.folders.map(f => f.name).join(' · ')}
                </span>
              )}
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                aria-label="다시 불러오기"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            {loading && !listing ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" size={24} /></div>
            ) : error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : files.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                서버에 남은 파일이 없습니다. 보관 기간이 지나 지워졌거나 파일을 남기지 않는 App입니다.
              </p>
            ) : (
              <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                {groups.map(group => (
                  <FileGroup
                    key={group.role}
                    group={group}
                    selected={selected}
                    onToggle={toggle}
                    onToggleAll={toggleAll}
                    onDownload={download}
                    onPreview={(f) => setPreviewPath(f.path)}
                    showFolder={showFolder}
                    downloading={downloading}
                  />
                ))}
                {listing?.truncated && (
                  <p className="text-[11px] text-amber-700">파일이 너무 많아 일부만 보입니다(폴더당 5,000개).</p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen size={15} className="text-brand-blue" aria-hidden="true" />
              <h3 className="text-sm font-bold text-slate-800">Hi-TESS LogBook 으로 보내기</h3>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-600">
              체크한 파일이 내 이름의 LogBook <b>정리 대기</b> 묶음으로 들어가고, 보내면 LogBook 창이 바로 열립니다. 제목·호선 정리와 확정은 LogBook 에서 합니다.
              LogBook 에 이미 있는 것과 똑같은 BDF 와 회사 DRM 으로 암호화된 파일은 받지 않습니다.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-600">묶음 이름</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder={defaultExportTitle(project)}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-600">메모 (선택)</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder="예: 3496 호선 권상 검토 대표 모델"
                  className={inputCls}
                />
              </label>
            </div>
            {result && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                result.state === 'blocked' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}>
                <p>{describeExportResult(result)}</p>
                {result.blocked?.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {result.blocked.map((b, i) => (
                      <li key={i}>{b.name || b.rel || JSON.stringify(b)}</li>
                    ))}
                  </ul>
                )}
                {result.state !== 'blocked' && (
                  <button
                    type="button"
                    onClick={openLogbookInbox}
                    disabled={launching}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {launching ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
                    LogBook 정리 대기 열기
                  </button>
                )}
              </div>
            )}
            {exports.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1 text-[11px] font-bold text-slate-600">보낸 이력</h4>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {exports.map(x => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs">
                      <span className="tabular-nums text-slate-500">{formatShortDateTime(x.created_at)}</span>
                      <span className="font-mono text-slate-600">{x.sent_by}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={x.title}>{x.title}</span>
                      {x.state === 'failed' ? (
                        <span className="text-red-600" title={x.error}>실패 — {x.error}</span>
                      ) : (
                        <span className="text-slate-600">
                          {x.file_count}개 · {formatBytes(x.total_bytes)}
                          {x.state === 'blocked' ? ' · 모두 중복' : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
      <BdfPreviewDialog
        analysisId={project?.id}
        files={previewFiles}
        initialPath={previewPath}
        selected={selected}
        onToggleSelected={toggle}
        onClose={() => setPreviewPath(null)}
      />
    </Modal>
  );
}
