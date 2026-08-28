/**
 * 정반 타입(A/B) 선택 화면.
 *
 * 2단계 진입 시 가장 먼저 뜨는 화면이다. 사용자가 형상과 제원을 보고 고를 수 있도록
 * 카드마다 **실제 BDF 지오메트리로 그린 3D 미리보기**와 자동 산출 제원을 함께 보여 준다.
 *
 * 로딩 전략 — 제원과 지오메트리를 분리해서 받는다.
 *   · 제원 목록(/jungban-decks)은 지오메트리가 없어 즉시 온다 → 카드와 Spec 표를 먼저 그린다.
 *   · 미리보기 지오메트리(/jungban-model)는 타입별로 병렬로 받아 도착하는 대로 채운다.
 *   그래서 사용자는 3D 를 기다리는 동안에도 치수를 읽고 판단할 수 있다.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Layers, Loader2, RefreshCw } from 'lucide-react';
import FeModelViewer from './FeModelViewer';
import { getJungbanDeckTypes, getJungbanViewerModel } from '../../api/analysis';

const PREVIEW_COLOR = '#8d9bb0';

const fmtMm = (v) => (typeof v === 'number' ? `${Math.round(v).toLocaleString()} mm` : '—');
const fmtCount = (v) => (typeof v === 'number' ? v.toLocaleString() : '—');
// 자중은 BDF 단면·두께·밀도에서 산출한 값이다. 못 구했으면 0 이 아니라 '—' 로 둔다.
const fmtTon = (v) => (typeof v === 'number'
  ? `${v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`
  : '—');

function SpecRow({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-100 last:border-b-0">
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <span className={`text-[11px] font-mono truncate ${strong ? 'text-slate-800 font-bold' : 'text-slate-600'}`}>
        {value}
      </span>
    </div>
  );
}

export default function JungbanDeckSelector({ selected, onSelect, deckModelCache }) {
  const [decks, setDecks] = useState(null);   // null = 목록 로딩 중
  const [error, setError] = useState(null);
  // 타입 id -> 슬림 지오메트리. 이미 받아 둔 게 있으면 페이지 캐시에서 재사용한다.
  const [models, setModels] = useState(() => ({ ...(deckModelCache || {}) }));
  const [reloadToken, setReloadToken] = useState(0);

  // ① 제원 목록 — 가볍고 빠르다.
  useEffect(() => {
    let cancelled = false;
    setDecks(null);
    setError(null);
    getJungbanDeckTypes()
      .then((res) => { if (!cancelled) setDecks(res.data?.decks || []); })
      .catch((e) => {
        if (cancelled) return;
        const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
        setError(
          e?.response?.status === 404
            ? `${detail} — 백엔드에 정반 타입 API 가 없습니다. 서버를 최신 코드로 재시작했는지 확인하세요.`
            : detail,
        );
      });
    return () => { cancelled = true; };
  }, [reloadToken]);

  // ② 미리보기 지오메트리 — 타입별 병렬. 도착하는 대로 카드에 채운다.
  useEffect(() => {
    if (!decks) return undefined;
    let cancelled = false;
    decks
      .filter((d) => d.available && !models[d.id])
      .forEach((d) => {
        getJungbanViewerModel(d.id)
          .then((res) => {
            if (cancelled) return;
            if (deckModelCache) deckModelCache[d.id] = res.data;   // 페이지 캐시에 적재
            setModels((prev) => (prev[d.id] ? prev : { ...prev, [d.id]: res.data }));
          })
          .catch(() => { /* 미리보기 실패는 치명적이지 않다 — 제원만으로도 선택할 수 있다 */ });
      });
    return () => { cancelled = true; };
    // models 를 의존성에 넣으면 도착할 때마다 재실행된다 — 위 filter 가 중복을 막으므로 불필요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white border border-slate-200 rounded-2xl p-8">
        <AlertTriangle size={28} className="text-amber-500" />
        <p className="text-sm font-semibold text-slate-700">정반 타입 목록을 불러오지 못했습니다</p>
        <p className="text-xs text-slate-500 text-center max-w-md leading-relaxed">{error}</p>
        <button
          onClick={() => setReloadToken((t) => t + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
        >
          <RefreshCw size={12} /> 다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <Layers size={15} className="text-blue-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">정반 타입 선택</h3>
          <p className="text-[11px] text-slate-400">
            Module Unit 을 올릴 정반을 먼저 고르세요. 선택 후 배치 화면으로 넘어갑니다.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {!decks ? (
          <div className="h-full min-h-[300px] flex flex-col items-center justify-center gap-2 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
            <p className="text-xs font-semibold">정반 타입을 불러오는 중...</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {decks.map((deck) => {
              const isSelected = selected === deck.id;
              const model = models[deck.id];
              const size = deck.size || [];
              return (
                <button
                  key={deck.id}
                  type="button"
                  disabled={!deck.available}
                  onClick={() => deck.available && onSelect(deck.id)}
                  className={`group text-left rounded-2xl border-2 overflow-hidden transition-all ${
                    !deck.available
                      ? 'border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed'
                      : isSelected
                        ? 'border-blue-500 bg-blue-50/40 shadow-md cursor-pointer'
                        : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md cursor-pointer'
                  }`}
                >
                  {/* 미리보기 — 실제 BDF 지오메트리 */}
                  <div className="relative h-44 bg-slate-900">
                    <FeModelViewer
                      chrome={false}
                      showGridDefault={false}
                      loading={deck.available && !model}
                      loadingLabel="미리보기 생성 중..."
                      parts={model ? [{
                        id: `deck-${deck.id}`,
                        name: deck.label,
                        color: PREVIEW_COLOR,
                        model,
                        opacity: 1,
                      }] : []}
                    />
                    {isSelected && (
                      <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-bold shadow">
                        <Check size={11} /> 선택됨
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className={`text-sm font-bold ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                        {deck.label}
                      </h4>
                      <span className="text-[10px] font-mono text-slate-400 truncate">{deck.file}</span>
                    </div>

                    {deck.available ? (
                      <div className="space-y-0">
                        <SpecRow label="길이 (X)" value={fmtMm(size[0])} strong />
                        <SpecRow label="폭 (Y)" value={fmtMm(size[1])} />
                        <SpecRow label="높이 (Z)" value={fmtMm(size[2])} />
                        <SpecRow label="정반 상면 높이" value={fmtMm(deck.topZ)} strong />
                        <SpecRow label="정반 자중" value={fmtTon(deck.massProperties?.totalMassTon)} strong />
                        <SpecRow label="절점 수" value={fmtCount(deck.nodeCount)} />
                        <SpecRow
                          label="요소 수 (쉘 / 빔)"
                          value={`${fmtCount(deck.shellCount)} / ${fmtCount(deck.beamCount)}`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        <AlertTriangle size={13} className="shrink-0 mt-px" />
                        <span className="leading-relaxed">
                          이 타입의 BDF 가 서버에 배치되지 않았습니다.
                          InHouseProgram/ModuleOceanMoving/JungbanBDF/ 에 <b>{deck.file}</b> 을 두고
                          백엔드를 재시작하세요.
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
