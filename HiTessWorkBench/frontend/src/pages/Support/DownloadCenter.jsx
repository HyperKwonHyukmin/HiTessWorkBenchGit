import React, { useState } from 'react';
import { Download, CheckCircle, Clock, Package, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../../config';

const DOWNLOADS = [];

const STATUS_CONFIG = {
  stable: { label: 'Stable', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  beta:   { label: 'Beta',   className: 'bg-amber-100  text-amber-700  border border-amber-200'  },
  dev:    { label: 'Dev',    className: 'bg-slate-100  text-slate-500  border border-slate-200'  },
};

const CATEGORY_COLORS = {
  'Software':      'bg-blue-50   text-blue-700',
  'Solver':        'bg-violet-50 text-violet-700',
  'Pre-processor': 'bg-cyan-50   text-cyan-700',
  'Utility':       'bg-orange-50 text-orange-700',
  'Report':        'bg-pink-50   text-pink-700',
};

export default function DownloadCenter() {
  const [hoveredRow, setHoveredRow] = useState(null);
  const [loadingFile, setLoadingFile] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleDownload = async (item) => {
    if (loadingFile) return;
    setErrorMsg(null);
    setLoadingFile(item.filename);

    try {
      const url = `${API_BASE_URL}/api/download/program/${encodeURIComponent(item.filename)}`;
      const res = await fetch(url);

      if (!res.ok) {
        let detail = '파일을 찾을 수 없습니다. 관리자에게 문의하세요.';
        try {
          const json = await res.json();
          if (json?.detail) detail = json.detail;
        } catch (_) { /* ignore */ }
        setErrorMsg(detail);
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setErrorMsg('서버에 연결할 수 없습니다. 서버 상태를 확인하세요.');
    } finally {
      setLoadingFile(null);
    }
  };

  return (
    <div className="w-full min-w-0 pb-10 animate-fade-in-up">
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-blue tracking-tight flex items-center gap-3">
          <Download className="text-blue-500 shrink-0" size={28} />
          Download Center
        </h1>
        <p className="text-slate-500 mt-2 text-sm">
          HiTess 관련 프로그램 및 도구를 다운로드하세요. 최신 버전 사용을 권장합니다.
        </p>
      </div>

      {/* 통계 뱃지 */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <Package size={15} className="text-blue-500 shrink-0" />
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">총 {DOWNLOADS.length}개 패키지</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <CheckCircle size={15} className="text-emerald-500 shrink-0" />
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Stable {DOWNLOADS.filter(d => d.status === 'stable').length}개
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <Clock size={15} className="text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
            준비중 {DOWNLOADS.filter(d => !d.filename).length}개
          </span>
        </div>
      </div>

      {/* 오류 알림 배너 */}
      {errorMsg && (
        <div className="flex items-start gap-3 mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="ml-auto text-red-400 hover:text-red-600 cursor-pointer"
          >✕</button>
        </div>
      )}

      {/* 테이블 카드 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Available Packages
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '640px' }}>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-5 py-3 text-left font-semibold" style={{ width: '22%' }}>프로그램</th>
                <th className="px-5 py-3 text-left font-semibold">설명</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap" style={{ width: '7%' }}>버전</th>
                <th className="px-4 py-3 text-center font-semibold" style={{ width: '7%' }}>상태</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap" style={{ width: '10%' }}>다운로드</th>
              </tr>
            </thead>
            <tbody>
              {DOWNLOADS.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-400 text-sm">
                    등록된 다운로드 항목이 없습니다.
                  </td>
                </tr>
              )}
              {DOWNLOADS.map((item, idx) => (
                <tr
                  key={item.name}
                  className={`border-b border-slate-50 transition-colors ${
                    hoveredRow === idx
                      ? 'bg-blue-50/40'
                      : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                  }`}
                  onMouseEnter={() => setHoveredRow(idx)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  {/* 프로그램명 + 메타 */}
                  <td className="px-5 py-4 align-top">
                    <div className="font-semibold text-slate-800 whitespace-nowrap">{item.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${CATEGORY_COLORS[item.category] ?? 'bg-slate-100 text-slate-600'}`}>
                        {item.category}
                      </span>
                      {item.size !== '-' && <span className="text-xs text-slate-400">{item.size}</span>}
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{item.updatedAt}</span>
                    </div>
                  </td>

                  {/* 설명 */}
                  <td className="px-5 py-4 text-slate-500 text-xs leading-relaxed align-top min-w-0">
                    <span className="block" style={{ wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                      {item.description}
                    </span>
                  </td>

                  {/* 버전 */}
                  <td className="px-4 py-4 text-center align-top">
                    <span className="font-mono text-slate-600 text-xs bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">
                      {item.version}
                    </span>
                  </td>

                  {/* 상태 */}
                  <td className="px-4 py-4 text-center align-top">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_CONFIG[item.status].className}`}>
                      {STATUS_CONFIG[item.status].label}
                    </span>
                  </td>

                  {/* 다운로드 버튼 */}
                  <td className="px-4 py-4 text-center align-top">
                    {item.filename ? (
                      <button
                        onClick={() => handleDownload(item)}
                        disabled={loadingFile === item.filename}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                          loadingFile === item.filename
                            ? 'bg-blue-300 text-white cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                        }`}
                      >
                        {loadingFile === item.filename
                          ? <><Clock size={12} className="animate-spin" />받는 중...</>
                          : <><Download size={12} />다운로드</>
                        }
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 text-slate-400 text-xs font-medium rounded-lg cursor-not-allowed whitespace-nowrap">
                        <Clock size={12} />
                        준비중
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 하단 안내 */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100">
          <p className="text-xs text-slate-400" style={{ wordBreak: 'keep-all' }}>
            * 다운로드에 문제가 있거나 특정 버전이 필요한 경우 시스템 관리자에게 문의하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
