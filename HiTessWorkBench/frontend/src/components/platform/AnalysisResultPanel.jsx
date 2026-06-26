import React from 'react';
import { AlertCircle, CheckCircle2, Download, FileText, RotateCcw } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { API_BASE_URL } from '../../config';
import { getAuthHeaders } from '../../utils/auth';

function statusVariant(status) {
  if (status === 'Success') return 'success';
  if (status === 'Failed' || status === 'Interrupted') return 'error';
  if (status === 'Pending') return 'warning';
  return 'info';
}

function collectFiles(resultInfo) {
  if (!resultInfo || typeof resultInfo !== 'object') return [];
  return Object.entries(resultInfo)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .filter(([, value]) => /[\\/]|\.([a-z0-9]{2,6})$/i.test(value))
    .map(([key, value]) => ({ key, path: value }));
}

export default function AnalysisResultPanel({ job, compact = false, onNavigate, onRetry }) {
  if (!job) return null;
  const resultInfo = job.project?.result_info || job.result_info || {};
  const files = collectFiles(resultInfo);
  const isSuccess = job.status === 'Success';
  const isFailed = job.status === 'Failed' || job.status === 'Interrupted';

  const handleDownload = async (path) => {
    const res = await fetch(`${API_BASE_URL}/api/download?filepath=${encodeURIComponent(path)}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split(/[\\/]/).pop() || 'result';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={`rounded-xl border ${compact ? 'border-slate-700 bg-slate-900/50 p-3' : 'border-slate-200 bg-white p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 size={16} className="text-emerald-500" />
            ) : isFailed ? (
              <AlertCircle size={16} className="text-red-500" />
            ) : (
              <RotateCcw size={16} className="animate-spin text-blue-500" />
            )}
            <h3 className={`truncate text-sm font-bold ${compact ? 'text-white' : 'text-slate-800'}`}>
              {job.menu || job.project?.program_name || 'Analysis Job'}
            </h3>
          </div>
          <p className={`mt-1 line-clamp-2 text-xs ${compact ? 'text-slate-300' : 'text-slate-500'}`}>
            {job.message || job.job_message || (isSuccess ? '해석이 완료되었습니다.' : '작업 상태를 확인 중입니다.')}
          </p>
        </div>
        <Badge variant={statusVariant(job.status)} size="sm" dot>{job.status || 'Running'}</Badge>
      </div>

      {!isSuccess && !isFailed && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${job.progress || 0}%` }} />
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.slice(0, compact ? 3 : 8).map(file => (
            <button
              type="button"
              key={`${file.key}-${file.path}`}
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(file.path).catch((err) => console.error('[result-download] failed', err));
              }}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                compact
                  ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <FileText size={13} className="shrink-0" />
                <span className="truncate font-medium">{file.key}</span>
              </span>
              <Download size={13} className="shrink-0" />
            </button>
          ))}
        </div>
      )}

      {!compact && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {onRetry && isFailed && <Button variant="secondary" size="sm" onClick={onRetry}>다시 실행</Button>}
          {onNavigate && <Button variant="primary" size="sm" onClick={() => onNavigate(job.menu)}>작업 화면으로 이동</Button>}
        </div>
      )}
    </section>
  );
}
