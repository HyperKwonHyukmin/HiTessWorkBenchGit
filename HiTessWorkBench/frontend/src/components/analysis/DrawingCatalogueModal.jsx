/**
 * DrawingCatalogueModal — 2단계 카탈로그 모달.
 *
 *   1) 카테고리 선택 (Lug, Bracket, ...)
 *   2) 선택된 카테고리의 PDF 둘러보기 (← / → 페이징 + 라벨 검색)
 *
 * 라벨 규칙(백엔드 _categorize_catalogue_filename):
 *   'Lug_L_25.pdf' → category='Lug',  label='L-25'
 *
 * Props:
 *   - isOpen        boolean
 *   - onClose       () => void
 *   - onSelect      (filename: string) => void
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, Loader2, FileSearch,
  AlertCircle, Image as ImageIcon, FileText, Play, RefreshCw,
  ArrowLeft, Folder, Search, Tag,
} from 'lucide-react';
import { listDrawingCatalogue, drawingCataloguePreviewUrl } from '../../api/analysis';
import { getAuthHeaders } from '../../utils/auth';

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/** 카테고리 표시명: 'BlockSupport' → 'Block Support', 'Lug' → 'Lug' */
const formatCategoryName = (raw) => {
  if (!raw) return '';
  return String(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
};

// 카테고리별 색상 팔레트 (이름 해시 기반 — 결정적이고 일관됨)
const CATEGORY_PALETTE = [
  { from: 'from-violet-500',  to: 'to-purple-600',  text: 'text-violet-700',  ring: 'ring-violet-200',  bg: 'bg-violet-50',  border: 'border-violet-200' },
  { from: 'from-blue-500',    to: 'to-cyan-600',    text: 'text-blue-700',    ring: 'ring-blue-200',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  { from: 'from-emerald-500', to: 'to-teal-600',    text: 'text-emerald-700', ring: 'ring-emerald-200', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { from: 'from-amber-500',   to: 'to-orange-600',  text: 'text-amber-700',   ring: 'ring-amber-200',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  { from: 'from-rose-500',    to: 'to-pink-600',    text: 'text-rose-700',    ring: 'ring-rose-200',    bg: 'bg-rose-50',    border: 'border-rose-200' },
  { from: 'from-indigo-500',  to: 'to-blue-600',    text: 'text-indigo-700',  ring: 'ring-indigo-200',  bg: 'bg-indigo-50',  border: 'border-indigo-200' },
];

const paletteOf = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
};

export default function DrawingCatalogueModal({ isOpen, onClose, onSelect }) {
  // 데이터
  const [items, setItems]           = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const catalogueDirRef = useRef('');

  // 뷰 상태
  const [stage, setStage]         = useState('categories'); // 'categories' | 'pdfs'
  const [selectedCat, setSelCat]  = useState('');
  const [searchQuery, setSearch]  = useState('');
  const [idx, setIdx]             = useState(0);

  // 미리보기
  const [previewUrl, setPreviewUrl]         = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]     = useState('');
  const previewObjectUrlRef = useRef(null);

  // ── 카탈로그 로드 ─────────────────────────────────────────
  const loadCatalogue = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listDrawingCatalogue();
      setItems(res.data?.items ?? []);
      setCategories(res.data?.categories ?? []);
      catalogueDirRef.current = res.data?.catalogue_dir || '';
    } catch (e) {
      setItems([]);
      setCategories([]);
      setError(e?.response?.data?.detail || e?.message || '카탈로그 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadCatalogue();
    // 모달 열 때마다 카테고리 뷰로 시작
    setStage('categories');
    setSelCat('');
    setSearch('');
    setIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── 필터링된 PDF 리스트 (선택 카테고리 + 검색어) ────────────
  const filteredItems = useMemo(() => {
    if (stage !== 'pdfs' || !selectedCat) return [];
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (it.category !== selectedCat) return false;
      if (!q) return true;
      return (
        (it.label || '').toLowerCase().includes(q) ||
        (it.filename || '').toLowerCase().includes(q)
      );
    });
  }, [items, stage, selectedCat, searchQuery]);

  const current = filteredItems[idx] ?? null;

  // 검색어 변경 시 인덱스 리셋
  useEffect(() => { setIdx(0); }, [searchQuery, selectedCat]);

  // ── 미리보기 로드 ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !current) {
      setPreviewUrl('');
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    (async () => {
      try {
        const res = await fetch(drawingCataloguePreviewUrl(current.filename), {
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = url;
        setPreviewUrl(url);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e?.message || '미리보기 로드 실패');
          setPreviewUrl('');
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, current?.filename]);

  useEffect(() => () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }, []);

  // ── 키보드 ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (stage === 'pdfs') setStage('categories');
        else onClose?.();
      } else if (stage === 'pdfs') {
        if (e.key === 'ArrowLeft')  setIdx((p) => Math.max(0, p - 1));
        if (e.key === 'ArrowRight') setIdx((p) => Math.min(filteredItems.length - 1, p + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, stage, filteredItems.length, onClose]);

  const handleSelect = () => {
    if (!current) return;
    onSelect?.(current.filename, current.category);
    onClose?.();
  };

  const goCategory = (name) => {
    setSelCat(name);
    setStage('pdfs');
    setSearch('');
    setIdx(0);
  };

  const guidanceDir = useMemo(
    () => catalogueDirRef.current || 'HiTessWorkBenchBackEnd/InHouseProgram/DrawingToAnalysis/PdfCatalogue/',
    [catalogueDirRef.current], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!isOpen) return null;

  const total = filteredItems.length;
  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-violet-700 to-violet-600 text-white shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {stage === 'pdfs' && (
              <button
                type="button"
                onClick={() => { setStage('categories'); setSelCat(''); setSearch(''); }}
                title="카테고리로 돌아가기 (ESC)"
                className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <FileSearch size={18} />
            <h2 className="text-sm font-bold tracking-tight truncate">
              {stage === 'categories'
                ? '도면 PDF 카탈로그 — 카테고리 선택'
                : <>도면 카탈로그 — <span className="text-violet-100">{formatCategoryName(selectedCat)}</span></>}
            </h2>
            {stage === 'pdfs' && total > 0 && (
              <span className="ml-2 text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/15 border border-white/20">
                {idx + 1} / {total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={loadCatalogue}
              title="새로고침"
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="닫기 (ESC)"
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── PDF 뷰 상단 도구바 ───────────────────────────── */}
        {stage === 'pdfs' && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 shrink-0">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${selectedCat} 카테고리에서 라벨 검색 (예: L-25)`}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
                autoFocus
              />
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-[11px] text-slate-500 hover:text-rose-500 font-bold px-2 py-1 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
              >
                지우기
              </button>
            )}
          </div>
        )}

        {/* ── 본문 ─────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden bg-slate-50 relative">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">카탈로그 로드 중...</span>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-rose-600 max-w-md mx-auto text-center px-6">
              <AlertCircle size={28} />
              <p className="text-sm font-bold">{error}</p>
              <button
                onClick={loadCatalogue}
                className="mt-1 text-xs px-3 py-1.5 rounded-lg border border-rose-300 hover:bg-rose-100 transition-colors"
              >
                다시 시도
              </button>
            </div>
          ) : categories.length === 0 ? (
            <EmptyCatalogue guidanceDir={guidanceDir} />
          ) : stage === 'categories' ? (
            <CategoriesView categories={categories} onPick={goCategory} />
          ) : (
            <PdfBrowserView
              current={current}
              total={total}
              hasPrev={hasPrev}
              hasNext={hasNext}
              previewUrl={previewUrl}
              previewLoading={previewLoading}
              previewError={previewError}
              searchQuery={searchQuery}
              onPrev={() => setIdx((p) => Math.max(0, p - 1))}
              onNext={() => setIdx((p) => Math.min(total - 1, p + 1))}
            />
          )}
        </div>

        {/* ── PDF 액션 푸터 (항상 보임) ─────────────────────── */}
        {stage === 'pdfs' && current && (
          <PdfActionFooter current={current} onSelect={handleSelect} />
        )}

        {/* ── 상태 푸터 ───────────────────────────────────── */}
        <div className="px-5 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span>
            {stage === 'categories'
              ? `${categories.length}개 카테고리 · ${items.length}개 PDF`
              : '← / → 키로 페이지 이동, ESC 로 뒤로 / 닫기'}
          </span>
          {stage === 'pdfs' && total > 0 && (
            <span className="font-mono">{formatCategoryName(selectedCat)} · {total}개</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   하위 컴포넌트
   ──────────────────────────────────────────────────────────────────────── */

function EmptyCatalogue({ guidanceDir }) {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 mb-3">
          <FileText size={26} className="text-blue-500" />
        </div>
        <h3 className="text-sm font-bold text-slate-700 mb-1.5">카탈로그가 비어 있습니다</h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-3">
          백엔드 서버의 아래 폴더에 PDF 파일을 두면 이 목록에 자동으로 나타납니다.
          파일명은 <code className="px-1 py-0.5 bg-slate-100 rounded text-[10px]">카테고리_라벨토큰들.pdf</code> 형식을 권장합니다.
        </p>
        <code className="block text-[10px] text-slate-600 bg-slate-100 border border-slate-200 rounded-md px-3 py-2 break-all font-mono">
          {guidanceDir}
        </code>
      </div>
    </div>
  );
}

function CategoriesView({ categories, onPick }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {categories.map((cat) => {
          const p = paletteOf(cat.name);
          return (
            <button
              key={cat.name}
              type="button"
              onClick={() => onPick(cat.name)}
              className={`group relative rounded-2xl border-2 ${p.border} ${p.bg} hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden text-left`}
            >
              <div className={`bg-gradient-to-br ${p.from} ${p.to} px-5 py-6 text-white`}>
                <Folder size={28} className="opacity-90 mb-3" />
                <div className="text-xl font-bold tracking-tight">{formatCategoryName(cat.name)}</div>
              </div>
              <div className="px-5 py-3 flex items-center justify-between">
                <span className={`text-xs font-semibold ${p.text}`}>
                  {cat.count} 개 도면
                </span>
                <ChevronRight size={16} className={`${p.text} opacity-60 group-hover:translate-x-0.5 transition-transform`} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PdfBrowserView({
  current, total, hasPrev, hasNext,
  previewUrl, previewLoading, previewError,
  searchQuery, onPrev, onNext,
}) {
  if (total === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 px-6 text-center bg-slate-800">
        <Search size={28} className="opacity-50" />
        <p className="text-sm font-bold text-slate-300">
          {searchQuery ? '검색 결과가 없습니다' : '이 카테고리에 PDF가 없습니다'}
        </p>
        {searchQuery && (
          <p className="text-[11px] text-slate-400 font-mono">검색어: &quot;{searchQuery}&quot;</p>
        )}
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="h-full flex items-stretch bg-slate-800">
      {/* 좌 화살표 */}
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev}
        title="이전 (←)"
        className="shrink-0 w-14 flex items-center justify-center hover:bg-slate-700/60 disabled:opacity-25 disabled:cursor-not-allowed transition-colors cursor-pointer group"
      >
        <ChevronLeft size={36} className="text-slate-400 group-hover:text-white transition-colors" />
      </button>

      {/* 미리보기 영역 — 어두운 배경 + 큰 흰 카드 */}
      <div className="flex-1 flex items-center justify-center p-6 min-h-0">
        {previewLoading ? (
          <div className="flex items-center gap-2 text-slate-300">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">미리보기 생성 중...</span>
          </div>
        ) : previewError ? (
          <div className="flex flex-col items-center text-slate-400 gap-2">
            <ImageIcon size={36} className="opacity-60" />
            <p className="text-sm">미리보기를 불러올 수 없습니다.</p>
            <p className="text-[10px] text-slate-500 font-mono">{previewError}</p>
          </div>
        ) : previewUrl ? (
          <div className="bg-white rounded-lg shadow-2xl ring-1 ring-slate-900/30 max-w-full max-h-full flex items-center justify-center overflow-hidden">
            <img
              src={previewUrl}
              alt={current.filename}
              loading="lazy"
              decoding="async"
              className="max-w-full max-h-[72vh] object-contain"
            />
          </div>
        ) : (
          <ImageIcon size={32} className="text-slate-600" />
        )}
      </div>

      {/* 우 화살표 */}
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        title="다음 (→)"
        className="shrink-0 w-14 flex items-center justify-center hover:bg-slate-700/60 disabled:opacity-25 disabled:cursor-not-allowed transition-colors cursor-pointer group"
      >
        <ChevronRight size={36} className="text-slate-400 group-hover:text-white transition-colors" />
      </button>
    </div>
  );
}

/** PDF 뷰 모달 푸터 — 항상 보이는 액션 바 (라벨/메타 + "이 PDF로 변환") */
function PdfActionFooter({ current, onSelect }) {
  if (!current) return null;
  const p = paletteOf(current.category);
  return (
    <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-4 shrink-0">
      <div className="min-w-0 flex items-center gap-3">
        <div className={`inline-flex items-center justify-center w-11 h-11 rounded-xl ${p.bg} ${p.border} border shrink-0`}>
          <Tag size={18} className={p.text} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.bg} ${p.text}`}>
              {formatCategoryName(current.category)}
            </span>
            <p className="text-xl font-bold text-slate-800 font-mono tracking-tight truncate" title={current.label}>
              {current.label}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
            {current.filename}
            <span className="ml-2 text-slate-300">·</span>
            <span className="ml-2">{formatBytes(current.size_bytes)}</span>
            {current.page_count != null && (
              <>
                <span className="ml-2 text-slate-300">·</span>
                <span className="ml-2">{current.page_count} 페이지</span>
              </>
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold shadow-md transition-colors cursor-pointer shrink-0"
      >
        <Play size={14} /> 이 도면으로 변환 시작
      </button>
    </div>
  );
}
