import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, Loader2, RefreshCw, FileText, FileCog,
  FileBarChart2, AlertCircle, PackageOpen,
} from 'lucide-react';
import { getGroupModuleUnitArtifacts, downloadFileBlob } from '../../api/analysis';
import { downloadBlob } from '../../utils/fileHelper';
import { useToast } from '../../contexts/ToastContext';

// 파일 용량 표시 (best-effort — DRM at-rest 시 약간의 오차 가능)
function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 산출물 그룹 정의 — 백엔드 kind 와 일치. 해당 kind 가 하나도 없으면 그룹 헤더는 숨김.
const GROUPS = [
  { title: '모델 BDF',     kinds: ['liftingBdf', 'editedBdf'] },
  { title: 'Nastran 결과', kinds: ['f06', 'op2'] },
];

const KIND_ICON = {
  liftingBdf: FileText,
  editedBdf:  FileCog,
  f06:        FileText,
  op2:        FileBarChart2,
};

/**
 * Group & Module Unit 권상 구조해석 Step3 상단 카드.
 * parent BDF 폴더에서 존재하는 lifting 산출물(_lifting.bdf/_edited.bdf/_lifting.f06/_lifting.op2)을
 * 조회해 다운로드 버튼으로 노출한다. 구조해석은 Studio 에서 비동기로 끝나므로 "새로고침"으로 갱신.
 */
export default function ResultArtifactsCard({ parentAnalysisId }) {
  const { showToast } = useToast();
  const [state, setState] = useState('idle'); // idle | loading | loaded | error
  const [artifacts, setArtifacts] = useState([]);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null); // 다운로드 중인 kind

  const fetchArtifacts = useCallback(async () => {
    if (!parentAnalysisId) { setState('idle'); return; }
    setState('loading');
    setError(null);
    try {
      const res = await getGroupModuleUnitArtifacts(parentAnalysisId);
      setArtifacts(res.data?.artifacts ?? []);
      setState('loaded');
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      setError(detail);
      setState('error');
    }
  }, [parentAnalysisId]);

  useEffect(() => { fetchArtifacts(); }, [fetchArtifacts]);

  const handleDownload = async (art) => {
    setDownloading(art.kind);
    try {
      const res = await downloadFileBlob(art.path);
      downloadBlob(res.data, art.fileName);
    } catch (e) {
      const detail = e?.response?.status === 404
        ? '파일을 찾을 수 없습니다 — 다시 새로고침해 주세요.'
        : (e?.message || '다운로드 실패');
      showToast(detail, 'error');
    } finally {
      setDownloading(null);
    }
  };

  const byKind = Object.fromEntries(artifacts.map(a => [a.kind, a]));

  return (
    <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageOpen size={14} className="text-blue-600" />
          <h2 className="text-xs font-bold text-slate-700">산출물 다운로드</h2>
          <span className="text-[10px] text-slate-400">— 최종 모델 BDF · Nastran F06/OP2</span>
        </div>
        <button
          onClick={fetchArtifacts}
          disabled={!parentAnalysisId || state === 'loading'}
          className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={10} className={state === 'loading' ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      <div className="p-4">
        {/* parent 없음 — 검증 선행 안내 */}
        {state === 'idle' && (
          <p className="text-xs text-slate-400 text-center py-3">
            BDF 입력 검증을 먼저 완료하세요.
          </p>
        )}

        {/* 로딩 */}
        {state === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-3 text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">산출물 확인 중...</span>
          </div>
        )}

        {/* 오류 */}
        {state === 'error' && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle size={14} className="text-red-500 shrink-0" />
            <p className="text-[11px] text-red-600">{error}</p>
          </div>
        )}

        {/* 로드 완료, 산출물 없음 */}
        {state === 'loaded' && artifacts.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-3 leading-relaxed">
            아직 산출물이 없습니다.<br />
            Studio에서 권상 구조 해석을 수행한 뒤 <b className="text-slate-500">새로고침</b>하세요.
          </p>
        )}

        {/* 로드 완료, 산출물 있음 — 그룹별 버튼 */}
        {state === 'loaded' && artifacts.length > 0 && (
          <div className="space-y-3">
            {GROUPS.map(group => {
              const items = group.kinds.map(k => byKind[k]).filter(Boolean);
              if (items.length === 0) return null;
              return (
                <div key={group.title}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{group.title}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map(art => {
                      const Icon = KIND_ICON[art.kind] ?? FileText;
                      const busy = downloading === art.kind;
                      return (
                        <button
                          key={art.kind}
                          onClick={() => handleDownload(art)}
                          disabled={busy}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 transition-colors cursor-pointer text-left disabled:opacity-50 disabled:cursor-wait"
                        >
                          <Icon size={18} className="text-blue-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-700 truncate">{art.label}</p>
                            <p className="text-[10px] text-slate-400 font-mono truncate" title={art.fileName}>
                              {art.fileName}{art.sizeBytes != null ? ` · ${formatSize(art.sizeBytes)}` : ''}
                            </p>
                          </div>
                          {busy
                            ? <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
                            : <Download size={14} className="text-slate-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
