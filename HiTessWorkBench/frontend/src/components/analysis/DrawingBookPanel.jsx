/**
 * DrawingBookPanel — 치공구표준집 찾기 (도면 카탈로그 창의 첫 탭).
 *
 * 왼쪽: 검색 · 묶음 · 러그 고르기 도우미(계열 → 하중) · 바로 변환만
 * 가운데: 썸네일 격자(보이는 카드만 불러옴)
 * 오른쪽: 고른 쪽 큰 미리보기 + 정보 + [이 도면 변환]
 *
 * 계획: docs/plans/2026-11-11-drawing-catalogue-search.md (2단계). 규칙(검색·거르기·상태)은 utils/drawingBook.js.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, AlertCircle, Play, RotateCcw } from 'lucide-react';
import { getDrawingBook, drawingBookThumbUrl } from '../../api/analysis';
import { getAuthHeaders } from '../../utils/auth';
import { LUG_FAMILIES, bookItemState, filterBookItems, groupCounts, swlOptions } from '../../utils/drawingBook';

// 받은 썸네일(object URL)은 창을 닫아도 남겨 둔다 — 다시 열 때 서버에 또 묻지 않게
const imageCache = new Map();

function useAuthedImage(url, enabled) {
  const [src, setSrc] = useState(() => imageCache.get(url) || '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // 주소가 바뀌면 앞 그림을 먼저 비운다 — 다른 도면을 고르는 동안·실패했을 때 옛 그림이 새 정보 밑에 남지 않게
    setFailed(false);
    setSrc(imageCache.get(url) || '');
    if (!url || !enabled || imageCache.has(url)) return undefined;
    let cancelled = false;
    fetch(url, { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((blob) => {
        const obj = URL.createObjectURL(blob);
        imageCache.set(url, obj);
        if (!cancelled) setSrc(obj);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url, enabled]);
  return { src, failed };
}

const STATE_TEXT = {
  ready: 'text-emerald-700 font-semibold',
  drawing: 'text-slate-500',
  excluded: 'text-slate-400',
};

function BookCard({ item, selected, onPick, imagesOn }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return undefined;
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  // 도면집을 쓸 수 없으면 그림을 묻지 않는다(실패는 기억하지 않아 카드마다 서버에 다시 묻게 된다)
  const { src, failed } = useAuthedImage(drawingBookThumbUrl(item.pdfPage, 'small'), visible && imagesOn);
  const st = bookItemState(item);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPick(item)}
      aria-pressed={selected}
      className={`text-left rounded-lg border bg-white p-1.5 transition-colors cursor-pointer
        ${selected ? 'border-[#002554] ring-2 ring-[#002554]/25' : 'border-slate-200 hover:border-slate-400'}`}
    >
      <div className="aspect-[595/438] w-full bg-slate-100 rounded overflow-hidden flex items-center justify-center">
        {src ? <img src={src} alt={`${item.code} 도면`} className={`w-full h-full object-contain ${st.id === 'excluded' ? 'opacity-60' : ''}`} />
          : failed ? <span className="text-[11px] text-slate-400">미리보기 없음</span>
            : <Loader2 size={14} className="animate-spin text-slate-300" />}
      </div>
      <div className="mt-1.5 px-0.5">
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-mono text-[12px] font-bold text-slate-900 truncate" title={item.code}>{item.aliases?.[0] || item.code}</span>
          <span className="text-[11px] text-slate-400 shrink-0">{item.bookPage}쪽</span>
        </div>
        <div className="text-[11px] text-slate-600 truncate" title={item.name}>{item.name}</div>
        <div className={`text-[11px] ${STATE_TEXT[st.id]}`}>{st.label}</div>
      </div>
    </button>
  );
}

function DetailPanel({ item, onRun, running, bookAvailable }) {
  const { src, failed } = useAuthedImage(item ? drawingBookThumbUrl(item.pdfPage, 'large') : '', Boolean(item) && bookAvailable);
  if (!item) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center text-[12px] text-slate-500">
        왼쪽에서 찾거나 가운데에서 도면을 고르면 여기에 크게 보입니다.
      </div>
    );
  }
  const st = bookItemState(item);
  const note = {
    ready: '새 엔진이 이 도면의 치수를 읽어 해석 모델과 하중 케이스까지 만듭니다.',
    drawing: '이 계열은 아직 자동 변환 템플릿이 없습니다. 변환하면 "지원하지 않는 형식" 으로 끝날 수 있습니다.',
    excluded: '구매품·반목처럼 구조 해석 대상이 아닌 부재입니다.',
  }[st.id];
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 bg-slate-100 flex items-center justify-center p-2">
        {src ? <img src={src} alt={`${item.code} 도면 미리보기`} className="max-w-full max-h-full object-contain bg-white shadow" />
          : failed ? <span className="text-[12px] text-slate-500">미리보기를 불러오지 못했습니다</span>
            : <Loader2 size={18} className="animate-spin text-slate-400" />}
      </div>
      <div className="px-4 py-3 border-t border-slate-200 space-y-2 bg-white">
        <div>
          <div className="font-mono text-[18px] font-bold text-slate-900 leading-tight">{item.code}</div>
          <div className="text-[12px] text-slate-700">{item.name}</div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          <dt className="text-slate-500">묶음</dt><dd className="text-slate-800">{item.groupLabel}</dd>
          <dt className="text-slate-500">도면 쪽</dt><dd className="text-slate-800">{item.bookPage}쪽 <span className="text-slate-400">(PDF {item.pdfPage}쪽)</span></dd>
          {item.swl_t != null && (<><dt className="text-slate-500">안전하중</dt><dd className="text-slate-800">{item.swl_t} t</dd></>)}
          {item.usage && (<><dt className="text-slate-500">용도</dt><dd className="text-slate-800">{item.usage}</dd></>)}
        </dl>
        <p className={`text-[12px] leading-snug ${st.id === 'ready' ? 'text-emerald-800' : 'text-slate-600'}`}>
          <span className={STATE_TEXT[st.id]}>{st.label}</span> · {note}
        </p>
        <button
          type="button"
          onClick={() => onRun(item)}
          disabled={!st.canRun || running || !bookAvailable}
          className="w-full h-10 rounded-lg bg-[#002554] text-white text-[13px] font-bold hover:bg-[#003366] disabled:bg-slate-200 disabled:text-slate-500 inline-flex items-center justify-center gap-2"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          이 도면 변환
        </button>
      </div>
    </div>
  );
}

export default function DrawingBookPanel({ onRun, running = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [family, setFamily] = useState('');
  const [swl, setSwl] = useState(null);
  const [convertibleOnly, setConvertibleOnly] = useState(false);
  const [picked, setPicked] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getDrawingBook();
      setData(res.data);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError(e?.response?.status === 404 ? '서버가 아직 치공구표준집 찾기를 모릅니다(서버 업데이트 필요).'
        : (typeof detail === 'string' ? detail : e?.message || '치공구표준집을 불러오지 못했습니다'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const items = data?.items || [];
  const results = useMemo(
    () => filterBookItems(items, { query, group, family, swl, convertibleOnly }),
    [items, query, group, family, swl, convertibleOnly],
  );
  const counts = useMemo(() => groupCounts(items), [items]);
  const swls = useMemo(() => (family ? swlOptions(items, family) : []), [items, family]);
  const anyFilter = query || group || family || swl != null || convertibleOnly;
  const resetFilters = () => { setQuery(''); setGroup(''); setFamily(''); setSwl(null); setConvertibleOnly(false); };

  // 결과가 바뀌어 고른 것이 사라지면 고름을 푼다
  useEffect(() => {
    if (picked && !results.some((r) => r.pdfPage === picked.pdfPage)) setPicked(null);
  }, [results, picked]);

  if (loading && !data) {
    return <div className="h-full flex items-center justify-center gap-2 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin" /> 치공구표준집을 불러오는 중...</div>;
  }
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
        <AlertCircle size={24} className="text-rose-600" />
        <p className="text-[13px] text-rose-800">{error}</p>
        <button type="button" onClick={load} className="text-[12px] px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">다시 시도</button>
      </div>
    );
  }

  const status = data?.status || { available: true };

  return (
    <div className="h-full flex flex-col min-h-0">
      {!status.available && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-900">
          {status.reason} 목록은 볼 수 있지만 그림과 변환은 안 됩니다.
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {/* 왼쪽 — 찾기 */}
        <aside className="w-60 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-3 space-y-4">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && results[0]) setPicked(results[0]);
              }}
              placeholder="기호·명칭 (예: L-25, D50, 러그)"
              aria-label="기호나 명칭으로 찾기"
              className="w-full h-8 pl-8 pr-2 rounded-md border border-slate-300 text-[12px] focus:outline-none focus:border-[#002554] focus:ring-2 focus:ring-[#002554]/15"
              autoFocus
            />
          </div>

          <section>
            <h3 className="text-[12px] font-bold text-slate-800 mb-1.5">묶음</h3>
            <div className="space-y-0.5">
              {[{ id: '', label: '전체' }, ...(data?.groups || [])].map((g) => (
                <button
                  key={g.id || 'all'}
                  type="button"
                  onClick={() => { setGroup(g.id); if (g.id !== 'lug') { setFamily(''); setSwl(null); } }}
                  aria-pressed={group === g.id}
                  className={`w-full flex items-center justify-between px-2 py-1 rounded text-[12px] text-left
                    ${group === g.id ? 'bg-[#002554] text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <span className="truncate">{g.label}</span>
                  <span className={group === g.id ? 'text-white/80' : 'text-slate-400'}>{g.id ? counts[g.id] || 0 : items.length}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[12px] font-bold text-slate-800">러그 고르기</h3>
            <p className="text-[11px] text-slate-500 mb-1.5">기호를 모르면 형식과 하중으로 좁힙니다.</p>
            <div className="space-y-0.5">
              {LUG_FAMILIES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { const on = family !== f.id; setFamily(on ? f.id : ''); setSwl(null); if (on) setGroup('lug'); }}
                  aria-pressed={family === f.id}
                  className={`w-full text-left px-2 py-1 rounded text-[12px]
                    ${family === f.id ? 'bg-[#002554] text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  {f.label}{f.hint && <span className={family === f.id ? 'text-white/75' : 'text-slate-400'}> · {f.hint}</span>}
                </button>
              ))}
            </div>
            {swls.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] text-slate-500 mb-1">안전하중 (t)</div>
                <div className="flex flex-wrap gap-1">
                  {swls.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSwl(swl === v ? null : v)}
                      aria-pressed={swl === v}
                      className={`min-w-9 h-7 px-2 rounded border text-[12px] font-mono
                        ${swl === v ? 'border-[#002554] bg-[#002554] text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <label className="flex items-center gap-2 text-[12px] text-slate-700 cursor-pointer">
            <input type="checkbox" checked={convertibleOnly} onChange={(e) => setConvertibleOnly(e.target.checked)} className="accent-[#002554]" />
            바로 변환되는 것만
          </label>
        </aside>

        {/* 가운데 — 결과 */}
        <main className="flex-1 min-w-0 flex flex-col bg-slate-50">
          <div className="px-4 py-2 flex items-center justify-between text-[12px] text-slate-600 border-b border-slate-200 bg-white">
            <span>{results.length}개 <span className="text-slate-400">/ 전체 {items.length}</span></span>
            {anyFilter && (
              <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-slate-600 hover:text-[#002554]">
                <RotateCcw size={12} /> 필터 초기화
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {results.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-1 text-slate-500">
                <p className="text-[13px]">맞는 도면이 없습니다.</p>
                <p className="text-[12px]">기호 일부(예: D-5)나 명칭 낱말로 다시 찾아보세요.</p>
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
                {results.map((it) => (
                  <BookCard key={it.pdfPage} item={it} selected={picked?.pdfPage === it.pdfPage} onPick={setPicked} imagesOn={status.available} />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* 오른쪽 — 고른 도면 */}
        <aside className="w-80 shrink-0 border-l border-slate-200 bg-white">
          <DetailPanel item={picked} onRun={onRun} running={running} bookAvailable={status.available} />
        </aside>
      </div>
    </div>
  );
}
