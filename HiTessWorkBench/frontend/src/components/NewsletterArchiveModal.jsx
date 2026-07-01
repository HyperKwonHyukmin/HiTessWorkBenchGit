/**
 * NewsletterArchiveModal — 뉴스레터 아카이브 열람 모달
 *
 * 레이아웃: 마스터-디테일 (좌: 목록 / 우: 미리보기)
 * 미리보기 방식: 페이지별 PNG 를 <img> 로 표시한다.
 *   - PDF iframe 은 Electron 내장 PDF 뷰어 의존성 때문에 환경에 따라 빈 화면이 되지만,
 *     PNG <img> 는 브라우저·Electron 어디서나 안정적으로 렌더된다.
 *   - PNG 는 fetch 로 받아 same-origin blob: URL 로 변환(CSP img-src 의 blob: 허용으로 표시).
 * 다운로드 버튼: 원본 PDF 를 그대로 받는다(blob 저장).
 */
import React, { useState, useEffect, useRef, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, FileText, Download, Calendar, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import {
  getNewsletters,
  getNewsletterPagesUrl,
  getNewsletterPageUrl,
  getNewsletterDownloadUrl,
} from '../api/newsletters';

/** 발행일 포매터: ISO 날짜 → YYYY.MM.DD */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

export default function NewsletterArchiveModal({ isOpen, onClose }) {
  const [newsletters, setNewsletters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  // 미리보기(페이지 PNG blob URL 목록) 상태
  const [pages, setPages] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const objectUrlsRef = useRef([]);

  // 모달이 열릴 때마다 목록 로드
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    setSelected(null);
    getNewsletters()
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : [];
        setNewsletters(data);
        if (data.length > 0) setSelected(data[0]); // 첫 항목 자동 선택
      })
      .catch(() => setError('뉴스레터 목록을 불러오는 데 실패했습니다.'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // 선택 항목 변경 시 페이지 PNG 들을 blob 으로 받아 표시
  useEffect(() => {
    if (!isOpen || !selected) {
      setPages([]);
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    setPages([]);
    (async () => {
      try {
        const metaRes = await fetch(getNewsletterPagesUrl(selected.id));
        if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
        const { pageCount } = await metaRes.json();
        const urls = await Promise.all(
          Array.from({ length: pageCount }, async (_, i) => {
            const r = await fetch(getNewsletterPageUrl(selected.id, i + 1));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const blob = await r.blob();
            return URL.createObjectURL(blob);
          })
        );
        if (cancelled) {
          urls.forEach(URL.revokeObjectURL);
          return;
        }
        // 이전 페이지 URL 정리 후 교체
        objectUrlsRef.current.forEach(URL.revokeObjectURL);
        objectUrlsRef.current = urls;
        setPages(urls);
      } catch {
        if (!cancelled) {
          setPreviewError('미리보기를 불러올 수 없습니다.');
          setPages([]);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, selected?.id]);

  // 언마운트 시 모든 objectURL 정리
  useEffect(() => () => {
    objectUrlsRef.current.forEach(URL.revokeObjectURL);
    objectUrlsRef.current = [];
  }, []);

  // 원본 PDF 다운로드 (blob 으로 받아 저장 — Electron 에서도 확실히 동작)
  const handleDownload = async () => {
    if (!selected) return;
    try {
      const res = await fetch(getNewsletterDownloadUrl(selected.id));
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selected.file_name || `newsletter_${selected.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // 실패 시 새 창으로 직접 열기(폴백)
      window.open(getNewsletterDownloadUrl(selected.id), '_blank', 'noopener');
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        {/* 배경 오버레이 */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-250"
            enterFrom="opacity-0 scale-95 translate-y-4"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-5xl h-[82vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">

              {/* 모달 헤더 */}
              <div
                className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0"
                style={{ background: 'linear-gradient(90deg, #002554 0%, #003580 100%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 border border-white/15">
                    <FileText size={16} className="text-blue-200" />
                  </div>
                  <div>
                    <Dialog.Title className="text-white font-bold text-sm leading-tight">
                      뉴스레터 아카이브
                    </Dialog.Title>
                    <p className="text-slate-300 text-[11px]">발행된 뉴스레터를 열람하고 다운로드하세요</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="뉴스레터 아카이브 닫기"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 본문: 마스터-디테일 */}
              <div className="flex flex-1 min-h-0">

                {/* 좌측: 목록 패널 */}
                <div className="w-64 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50 overflow-y-auto">
                  {loading && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm py-10">
                      <Loader2 size={22} className="animate-spin text-blue-400" />
                      <span>목록 불러오는 중...</span>
                    </div>
                  )}
                  {!loading && error && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-red-500 text-sm p-4 text-center">
                      <AlertCircle size={20} />
                      <span>{error}</span>
                    </div>
                  )}
                  {!loading && !error && newsletters.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm p-4 text-center">
                      <FileText size={22} className="opacity-40" />
                      <span>등록된 뉴스레터가 없습니다.</span>
                    </div>
                  )}
                  {!loading && !error && newsletters.map((item) => {
                    const isSelected = selected?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelected(item)}
                        className={`w-full text-left px-4 py-3 border-b border-slate-200 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${
                          isSelected ? 'bg-[#002554] text-white' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                        aria-selected={isSelected}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${isSelected ? 'text-blue-200' : 'text-blue-500'}`}>
                            Newsletter
                          </span>
                          {isSelected && <ChevronRight size={12} className="text-blue-200" />}
                        </div>
                        <p className={`text-xs font-bold leading-tight mb-1 line-clamp-2 ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                          {item.title}
                        </p>
                        {item.issue_date && (
                          <div className={`flex items-center gap-1 text-[10px] ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                            <Calendar size={10} />
                            <span>{formatDate(item.issue_date)}</span>
                          </div>
                        )}
                        {item.description && (
                          <p className={`text-[10px] mt-1 line-clamp-2 leading-relaxed ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                            {item.description}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 우측: 미리보기 패널 (페이지 PNG) */}
                <div className="flex-1 flex flex-col min-w-0 bg-slate-100">
                  {!selected && !loading && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                      <FileText size={36} className="opacity-25" />
                      <p className="text-sm">좌측 목록에서 뉴스레터를 선택하세요</p>
                    </div>
                  )}
                  {selected && (
                    <>
                      {/* 미리보기 헤더 */}
                      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{selected.title}</p>
                          {selected.issue_date && (
                            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <Calendar size={10} /> {formatDate(selected.issue_date)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={handleDownload}
                          className="shrink-0 ml-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#002554] hover:bg-[#003580] active:bg-[#001a3d] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                          aria-label="뉴스레터 PDF 다운로드"
                        >
                          <Download size={12} />
                          PDF 다운로드
                        </button>
                      </div>

                      {/* 페이지 이미지 스크롤 영역 */}
                      <div className="flex-1 min-h-0 overflow-y-auto bg-slate-200/60 p-4">
                        {previewLoading && (
                          <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 text-sm">
                            <Loader2 size={22} className="animate-spin text-blue-400" />
                            <span>미리보기 생성 중...</span>
                          </div>
                        )}
                        {!previewLoading && previewError && (
                          <div className="h-full flex flex-col items-center justify-center gap-2 text-red-500 text-sm text-center">
                            <AlertCircle size={20} />
                            <span>{previewError}</span>
                            <button onClick={handleDownload} className="mt-1 text-xs font-bold text-blue-600 hover:underline">
                              대신 PDF 다운로드하기
                            </button>
                          </div>
                        )}
                        {!previewLoading && !previewError && pages.length > 0 && (
                          <div className="flex flex-col items-center gap-4">
                            {pages.map((url, i) => (
                              <img
                                key={i}
                                src={url}
                                alt={`${selected.title} ${i + 1}페이지`}
                                loading="lazy"
                                decoding="async"
                                className="w-full max-w-3xl bg-white shadow-lg rounded ring-1 ring-slate-900/10"
                                draggable={false}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
