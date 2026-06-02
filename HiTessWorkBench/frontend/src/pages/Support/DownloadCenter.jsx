import React, { useState } from 'react';
import axios from 'axios';
import { Download, CheckCircle, Clock, Package, BookOpen, Wrench, Cpu, FileText, LayoutGrid, RefreshCw, FolderInput } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { getAuthHeaders } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

const DOWNLOADS = [
  {
    name: 'HiTESS BEAM',
    category: 'Software',
    description: '1D Beam 구조해석을 위한 사용자 데스크탑 어플리케이션.',
    version: 'v1.0.0',
    status: 'stable',
    filename: 'HiTESSBEAM.zip',
    size: '131 MB',
    updatedAt: '2026-04-20',
  },
  {
    name: 'Server 주소 설정 (ServerIP.txt)',
    category: 'Utility',
    description: '외부/레거시 프로그램이 HiTESS 서버 주소를 인식하도록 사용하는 설정 파일입니다. "C:\\temp 적용"을 누르면 사용자 PC의 C:\\temp 폴더에 바로 배치됩니다.',
    version: '-',
    status: 'stable',
    filename: 'ServerIP.txt',
    size: '-',
    updatedAt: '2026-06-02',
    applyToTemp: true, // 이 행은 'C:\temp 적용' 버튼을 추가로 노출 (Electron 전용)
  },
];

const STATUS_CONFIG = {
  stable: { label: 'Stable', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  beta:   { label: 'Beta',   className: 'bg-amber-100  text-amber-700  border border-amber-200'  },
  dev:    { label: 'Dev',    className: 'bg-slate-100  text-slate-500  border border-slate-200'  },
};

const CATEGORIES = [
  { key: 'all',          label: '전체',      icon: LayoutGrid, color: 'text-slate-600',  activeColor: 'bg-slate-700  text-white' },
  { key: 'Software',     label: '소프트웨어', icon: Cpu,        color: 'text-blue-600',   activeColor: 'bg-blue-600   text-white' },
  { key: 'User Guide',   label: '사용가이드', icon: BookOpen,   color: 'text-emerald-600', activeColor: 'bg-emerald-600 text-white' },
  { key: 'Utility',      label: '유틸리티',   icon: Wrench,     color: 'text-orange-600', activeColor: 'bg-orange-500 text-white' },
  { key: 'Report',       label: '보고서',     icon: FileText,   color: 'text-pink-600',   activeColor: 'bg-pink-500   text-white' },
];

const CATEGORY_BADGE = {
  'Software':   'bg-blue-50    text-blue-700',
  'User Guide': 'bg-emerald-50 text-emerald-700',
  'Utility':    'bg-orange-50  text-orange-700',
  'Report':     'bg-pink-50    text-pink-700',
  'Solver':     'bg-violet-50  text-violet-700',
};

export default function DownloadCenter() {
  const [hoveredRow, setHoveredRow]     = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [downloading, setDownloading]   = useState(null); // filename | null
  const [progress, setProgress]         = useState(0);    // 0~100
  const [applying, setApplying]         = useState(null); // C:\temp 적용 중인 filename | null
  const { showToast } = useToast();

  // C:\temp 직접 쓰기는 Electron(데스크탑 앱)에서만 가능. 브라우저(dev)에서는 버튼을 숨긴다.
  const isElectron = !!(typeof window !== 'undefined' && window.electron?.invoke);

  const filtered = activeCategory === 'all'
    ? DOWNLOADS
    : DOWNLOADS.filter(d => d.category === activeCategory);

  const handleDownload = async (item) => {
    if (downloading) return;
    setDownloading(item.filename);
    setProgress(0);
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/download/program/${encodeURIComponent(item.filename)}`,
        {
          headers: getAuthHeaders(),
          responseType: 'blob',
          onDownloadProgress: (e) => {
            if (e.total) {
              setProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        }
      );
      const blobUrl = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showToast(`다운로드 완료 — ${item.filename}`, 'success');
    } catch (err) {
      const status = err?.response?.status;
      let detailMsg = err?.message || '다운로드 실패';
      // blob 응답 안의 detail 추출 시도
      try {
        if (err?.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed?.detail) detailMsg = parsed.detail;
        } else if (err?.response?.data?.detail) {
          detailMsg = err.response.data.detail;
        }
      } catch { /* parse 실패 시 기본 메시지 유지 */ }
      showToast(`[${status || 'ERR'}] ${detailMsg}`, 'error');
    } finally {
      setDownloading(null);
      setProgress(0);
    }
  };

  // ServerIP.txt 의 최신 내용을 백엔드에서 받아 사용자 PC 의 C:\temp 에 바로 적용한다.
  // 레거시/외부 프로그램이 시작 시 C:\temp\ServerIP.txt 를 읽어 서버 주소를 찾는다.
  const handleApplyToTemp = async (item) => {
    if (applying || downloading) return;
    if (!isElectron) {
      showToast('C:\\temp 적용은 데스크탑 앱에서만 가능합니다. 일반 다운로드를 이용해 주세요.', 'info');
      return;
    }
    setApplying(item.filename);
    try {
      // responseType:'text' — 텍스트 파일이므로 내용을 문자열로 받는다.
      const res = await axios.get(
        `${API_BASE_URL}/api/download/program/${encodeURIComponent(item.filename)}`,
        { headers: getAuthHeaders(), responseType: 'text' }
      );
      const content = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      const result = await window.electron.invoke('place-server-ip', { content });
      if (result?.ok) {
        showToast(`적용 완료 — ${result.path}`, 'success');
      } else {
        showToast(`적용 실패 — ${result?.error || '알 수 없는 오류'}`, 'error');
      }
    } catch (err) {
      const status = err?.response?.status;
      let detailMsg = err?.message || '적용 실패';
      try {
        if (err?.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed?.detail) detailMsg = parsed.detail;
        } else if (typeof err?.response?.data === 'string' && err.response.data) {
          detailMsg = err.response.data;
        } else if (err?.response?.data?.detail) {
          detailMsg = err.response.data.detail;
        }
      } catch { /* 기본 메시지 유지 */ }
      showToast(`[${status || 'ERR'}] ${detailMsg}`, 'error');
    } finally {
      setApplying(null);
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
      <div className="flex flex-wrap gap-3 mb-5">
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

      {/* 카테고리 필터 탭 */}
      <div className="flex flex-wrap gap-2 mb-5">
        {CATEGORIES.map(({ key, label, icon: Icon, color, activeColor }) => {
          const isActive = activeCategory === key;
          const count = key === 'all' ? DOWNLOADS.length : DOWNLOADS.filter(d => d.category === key).length;
          return (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                isActive
                  ? `${activeColor} border-transparent shadow-sm`
                  : `bg-white ${color} border-slate-200 hover:border-slate-300 hover:bg-slate-50`
              }`}
            >
              <Icon size={13} />
              {label}
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 테이블 카드 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Available Packages
          </h2>
          {activeCategory !== 'all' && (
            <span className="text-xs text-slate-400">{filtered.length}개 항목</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '640px' }}>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-5 py-3 text-left font-semibold" style={{ width: '20%' }}>프로그램</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap" style={{ width: '10%' }}>분류</th>
                <th className="px-5 py-3 text-left font-semibold">설명</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap" style={{ width: '7%' }}>버전</th>
                <th className="px-4 py-3 text-center font-semibold" style={{ width: '7%' }}>상태</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap" style={{ width: '10%' }}>다운로드</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400 text-sm">
                    해당 카테고리에 등록된 항목이 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => (
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
                      {item.size && item.size !== '-' && <span className="text-xs text-slate-400">{item.size}</span>}
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{item.updatedAt}</span>
                    </div>
                  </td>

                  {/* 분류 */}
                  <td className="px-4 py-4 text-center align-top">
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${CATEGORY_BADGE[item.category] ?? 'bg-slate-100 text-slate-600'}`}>
                      {CATEGORIES.find(c => c.key === item.category)?.label ?? item.category}
                    </span>
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
                      (() => {
                        const isThisDownloading = downloading === item.filename;
                        const isThisApplying = applying === item.filename;
                        const busy = !!downloading || !!applying;
                        const showApply = item.applyToTemp && isElectron;
                        return (
                          <div className="flex flex-col items-stretch gap-1.5">
                            {showApply && (
                              <button
                                onClick={() => handleApplyToTemp(item)}
                                disabled={busy}
                                title="C:\temp 폴더에 ServerIP.txt 를 바로 적용합니다."
                                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                                  isThisApplying
                                    ? 'bg-blue-500 text-white cursor-wait'
                                    : busy
                                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                      : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                                }`}
                              >
                                {isThisApplying ? (
                                  <>
                                    <RefreshCw size={12} className="animate-spin" />적용 중
                                  </>
                                ) : (
                                  <>
                                    <FolderInput size={12} />C:\temp 적용
                                  </>
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleDownload(item)}
                              disabled={busy}
                              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                                isThisDownloading
                                  ? 'bg-blue-500 text-white cursor-wait'
                                  : busy
                                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    : showApply
                                      ? 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer'
                                      : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                              }`}
                            >
                              {isThisDownloading ? (
                                <>
                                  <RefreshCw size={12} className="animate-spin" />
                                  {progress > 0 ? `${progress}%` : '다운로드 중'}
                                </>
                              ) : (
                                <>
                                  <Download size={12} />다운로드
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })()
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
