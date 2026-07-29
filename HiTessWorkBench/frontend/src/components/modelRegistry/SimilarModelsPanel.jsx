import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Compass, Info, Loader2 } from 'lucide-react';

import { Badge } from '../ui';
import { QualityBadge } from './QualityLevelGuide';
import { getSimilarModels } from '../../api/modelRegistry';
import {
  extractApiError,
  formatNumber,
  outcomeInfo,
} from '../../utils/modelRegistryUtils';

/**
 * 비슷한 모델 — **근거를 함께 보여 주는** 추천.
 *
 * 제목 검색으로는 같은 형상을 다른 이름으로 등록한 모델을 절대 못 찾는다.
 * 그렇다고 "비슷합니다"만 내놓으면 구조 해석에서는 아무도 쓰지 않는다 —
 * 그래서 서버가 차원별 기여도를 함께 주고, 여기서 그대로 편다.
 *
 * 값이 없어 비교하지 못한 차원은 **숨기지 않고 사유와 함께 표시**한다.
 * 근거가 4개인 0.80 과 1개인 0.99 는 전혀 다른 이야기이기 때문이다.
 *
 * @param {string} modelUid
 * @param {boolean} active - 화면에 실제로 보이는가(닫힌 모달에서 요청하지 않게)
 * @param {(uid: string) => void} [onSelect] - 추천 모델을 열 때
 */
export default function SimilarModelsPanel({ modelUid, active = true, onSelect }) {
  const [state, setState] = useState('idle');   // idle | loading | loaded | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openUid, setOpenUid] = useState(null); // 근거를 펼친 항목

  const load = useCallback(async () => {
    if (!modelUid) return;
    setState('loading');
    setError(null);
    try {
      const res = await getSimilarModels(modelUid, { limit: 5 });
      setData(res.data);
      setState('loaded');
    } catch (e) {
      setError(extractApiError(e, '비슷한 모델을 찾지 못했습니다.').message);
      setState('error');
    }
  }, [modelUid]);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  const items = data?.items ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
          <Compass size={14} className="shrink-0 text-slate-400" />
          비슷한 모델
        </h4>
        {state === 'loaded' && data?.comparedCount > 0 && (
          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
            {formatNumber(data.comparedCount)}건 비교
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
        형상 지표로 찾습니다 — <b className="text-slate-600">'같은 모양'이지 '같은 용도'가 아닙니다.</b>
      </p>

      {state === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">찾는 중…</span>
        </div>
      )}

      {state === 'error' && (
        <p className="py-5 text-center text-xs text-slate-500">{error}</p>
      )}

      {state === 'loaded' && items.length === 0 && (
        <p className="py-5 text-center text-[11px] leading-relaxed text-slate-500">
          비교할 만한 모델이 아직 없습니다.
          {data?.skippedThinBasis > 0 && (
            <>
              <br />
              형상 정보가 부족해 {data.skippedThinBasis}건은 순위에서 제외했습니다.
            </>
          )}
        </p>
      )}

      {state === 'loaded' && items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.map((item) => {
            const open = openUid === item.model_uid;
            const pct = Math.round((item.score ?? 0) * 100);
            const o = outcomeInfo(item.designOutcome);
            return (
              <li
                key={item.model_uid}
                className="rounded-lg border border-slate-200 transition-colors hover:border-slate-300"
              >
                <div className="flex items-center gap-2.5 px-3 py-2">
                  {/* 점수는 숫자와 막대를 함께 — 막대만 두면 근소한 차이가 과장돼 보인다 */}
                  <div className="w-12 shrink-0">
                    <p className="text-right text-xs font-bold tabular-nums text-slate-800">{pct}%</p>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-blue"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelect?.(item.model_uid)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title={`${item.title} 열기`}
                  >
                    <p className="truncate text-xs font-semibold text-slate-800">{item.title}</p>
                    <p className="truncate text-[10px] tabular-nums text-slate-500">
                      노드 {formatNumber(item.nodeCount)} · 요소 {formatNumber(item.elementCount)}
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <QualityBadge level={item.qualityLevel} withCode={false} />
                    <Badge variant={o.variant} size="sm">{o.label}</Badge>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpenUid(open ? null : item.model_uid)}
                    aria-expanded={open}
                    className="shrink-0 cursor-pointer rounded p-1 text-slate-400 transition-colors hover:text-brand-blue"
                    title="유사 근거 보기"
                  >
                    <Info size={13} />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-slate-100 px-3 py-2.5">
                    <p className="mb-1.5 text-[10px] font-semibold text-slate-500">
                      항목별 일치도
                    </p>
                    <ul className="space-y-1">
                      {item.basis.map((b) => (
                        <li key={b.key} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-[10px] text-slate-600">{b.label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-slate-400"
                              style={{ width: `${Math.round(b.similarity * 100)}%` }}
                            />
                          </div>
                          <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                            {Math.round(b.similarity * 100)}%
                            <span className="ml-1 text-slate-300">×{b.weight}</span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    {/* 비교하지 못한 항목을 숨기면 점수를 실제보다 신뢰하게 된다 */}
                    {item.skipped?.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
                        {item.skipped.map((s) => (
                          <li key={s.key} className="text-[10px] leading-relaxed text-amber-700">
                            <b>{s.label}</b> 제외 — {s.reason}
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelect?.(item.model_uid)}
                      className="mt-2 flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-brand-blue hover:underline"
                    >
                      이 모델 열기 <ArrowRight size={11} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state === 'loaded' && data?.note && (
        <p className="mt-2.5 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-400">
          {data.note}
        </p>
      )}
    </section>
  );
}
