import React, { useState } from 'react';
import { Download, CheckCircle, Clock, Package, BookOpen, Wrench, Cpu, FileText, LayoutGrid } from 'lucide-react';
import { API_BASE_URL } from '../../config';

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

  const filtered = activeCategory === 'all'
    ? DOWNLOADS
    : DOWNLOADS.filter(d => d.category === activeCategory);

  const handleDownload = (item) => {
    const url = `${API_BASE_URL}/api/download/program/${encodeURIComponent(item.filename)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
                      <button
                        onClick={() => handleDownload(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                      >
                        <Download size={12} />다운로드
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
