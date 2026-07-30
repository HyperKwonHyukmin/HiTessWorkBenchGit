import React from 'react';

/**
 * 입력 → 출력 형식을 한 줄로 보여준다.
 *
 * 예전에는 Input 칩 줄 / Output 칩 줄 / 태그 줄이 따로 있어 카드 아래 절반이 칩으로 막혔다.
 * 해석 앱의 본질은 '무엇을 넣으면 무엇이 나오는가' 하나이므로 화살표 한 줄로 합친다.
 *
 * 그리드 카드(AppCard)와 리스트 행(AppListRow)이 같은 컴포넌트를 쓴다 — 뷰 토글은
 * 밀도만 바꿔야 하고 정보량까지 바뀌면 같은 앱이 다른 물건으로 보인다.
 */
export default function FormatFlow({
  inputLabel = 'Input',
  inputFormats = [],
  outputFormats = [],
  className = '',
}) {
  if (inputFormats.length === 0 && outputFormats.length === 0) return null;
  const hasBoth = inputFormats.length > 0 && outputFormats.length > 0;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[11.5px] ${className}`}>
      {inputFormats.length === 0 && (
        <span className="font-semibold text-slate-500">{inputLabel}</span>
      )}
      {inputFormats.map(format => (
        <span
          key={format}
          className="rounded-md bg-slate-100 px-2 py-0.5 font-bold tracking-wide text-slate-700"
        >
          {format}
        </span>
      ))}
      {hasBoth && <span className="px-0.5 text-slate-300" aria-hidden="true">→</span>}
      {outputFormats.map(format => (
        <span
          key={`out-${format}`}
          className="rounded-md bg-slate-50 px-2 py-0.5 font-semibold text-slate-500"
        >
          {format}
        </span>
      ))}
      {/* 화살표는 장식이므로 스크린리더에는 관계를 말로 전달한다. */}
      {hasBoth && (
        <span className="sr-only">
          {`입력 ${inputFormats.join(', ')} · 출력 ${outputFormats.join(', ')}`}
        </span>
      )}
    </div>
  );
}
