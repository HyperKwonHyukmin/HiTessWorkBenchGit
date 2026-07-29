import React, { useState } from 'react';
import { Check, ChevronDown, HelpCircle } from 'lucide-react';

import { Badge } from '../ui';
import { QUALITY_LADDER, qualityInfo } from '../../utils/modelRegistryUtils';

/**
 * 품질 등급 표기와 설명.
 *
 * 문제: 'Q3' 는 이 기능을 만든 사람만 읽는다. 처음 보는 사용자에게 Q 코드는
 * 등급인지 버전인지조차 알 수 없는 기호다.
 *
 * 해법 세 가지를 한 파일에 모은다.
 *  1. `QualityBadge`  — 평문을 크게, Q 코드를 작게. 코드는 버리지 않는다(문서·필터와 이어져야 한다).
 *  2. `QualityLadder` — 5칸 사다리. **누적 조건**이라는 사실이 핵심이라 세로로 쌓아 보여 준다.
 *  3. `QualityHelp`   — 접히는 설명. 아는 사람에게는 안 보이고, 모르는 사람은 한 번 눌러 편다.
 */

/** 평문 + 코드 배지. 표·목록처럼 좁은 자리에서 쓴다. */
export function QualityBadge({ level, size = 'sm', withCode = true }) {
  const q = qualityInfo(level);
  return (
    <Badge variant={q.variant} size={size}>
      <span className="inline-flex items-baseline gap-1">
        {q.label}
        {withCode && q.code && q.code !== q.label && (
          <span className="font-mono text-[9px] opacity-60">{q.code}</span>
        )}
      </span>
    </Badge>
  );
}

/**
 * 등급 사다리.
 *
 * 위 칸은 아래 칸 조건을 모두 포함한다 — 그래서 `requirement` 에 '+' 를 붙여 쓴다.
 * 현재 등급 아래 칸들은 '이미 통과한 조건'이므로 체크로 표시한다.
 */
export function QualityLadder({ current, compact = false }) {
  const currentRank = qualityInfo(current).rank;

  return (
    <ol className="space-y-1">
      {QUALITY_LADDER.map((key) => {
        const q = qualityInfo(key);
        const isCurrent = key === current;
        const passed = currentRank >= 0 && q.rank < currentRank;
        return (
          <li
            key={key}
            className={[
              'flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
              isCurrent
                ? 'border-brand-blue/40 bg-brand-blue/5'
                : 'border-transparent bg-slate-50/60',
            ].join(' ')}
          >
            <span
              className={[
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                isCurrent
                  ? 'bg-brand-blue text-white'
                  : passed
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-slate-200 text-slate-500',
              ].join(' ')}
              aria-hidden="true"
            >
              {passed ? <Check size={10} /> : q.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                <span className={isCurrent ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}>
                  {q.label}
                </span>
                <span className="font-mono text-[9px] text-slate-400">{q.code}</span>
                {isCurrent && (
                  <span className="text-[10px] font-semibold text-brand-blue">현재 등급</span>
                )}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                {q.requirement}
              </p>
              {!compact && (
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                  {q.description}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 접히는 등급 설명.
 *
 * 기본은 닫힘이다 — 매번 펼쳐 두면 아는 사람에게는 다섯 줄짜리 소음이 된다.
 * 대신 '등급이 뭔가요?' 라는 질문을 눈에 보이게 둔다.
 */
export function QualityHelp({ current, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-semibold text-slate-600 transition-colors hover:text-brand-blue"
      >
        <HelpCircle size={12} className="shrink-0 text-slate-400" />
        등급은 어떻게 정해지나요?
        <ChevronDown
          size={12}
          className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-2.5 py-2.5">
          <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
            아래로 갈수록 조건이 쌓입니다. 위 등급은 아래 등급 조건을 모두 만족합니다.
            <br />
            <b className="text-slate-600">설계가 통과했는지와는 무관합니다</b> — 그건 「설계 결과」가 따로 답합니다.
          </p>
          <QualityLadder current={current} />
        </div>
      )}
    </div>
  );
}
