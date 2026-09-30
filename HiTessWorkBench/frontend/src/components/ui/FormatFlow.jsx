import React from 'react';
import { ArrowRight } from 'lucide-react';

const INPUT_CHIP = 'rounded-md bg-slate-100 px-2 py-0.5 font-bold tracking-wide text-slate-700';
const OUTPUT_CHIP = 'rounded-md bg-slate-50 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-200/70';

// aligned 모드의 열 폭(입력 | 화살표 | 출력). 목록 머리글이 같은 값을 써야 열 이름이 칩 위에 선다.
// 입력 8.75rem = 가장 긴 조합('Direct input' + 'JSON')이 한 줄에 들어가는 폭.
// ⚠ 합계(8.75 + 1 + 11 + 열 간격 0.375×2 = 21.5rem)가 AppListRow ROW_GRID 의 형식 열 폭이다 — 같이 고칠 것.
export const FORMAT_FLOW_ALIGNED_COLS = 'grid-cols-[8.75rem_1rem_11rem]';

/**
 * 입력 → 출력 형식을 한 줄로 보여준다.
 *
 * 예전에는 Input 칩 줄 / Output 칩 줄 / 태그 줄이 따로 있어 카드 아래 절반이 칩으로 막혔다.
 * 해석 앱의 본질은 '무엇을 넣으면 무엇이 나오는가' 하나이므로 화살표 한 줄로 합친다.
 *
 * 그리드 카드(AppCard)와 리스트 행(AppListRow)이 같은 컴포넌트를 쓴다 — 뷰 토글은
 * 밀도만 바꿔야 하고 정보량까지 바뀌면 같은 앱이 다른 물건으로 보인다.
 *
 * aligned: 입력 | 화살표 | 출력을 고정 폭 3열로 놓는다. 목록에서 행마다 화살표가 같은
 *   세로선에 서야 '어느 앱이 BDF 를 받는가' 를 위아래로 훑어 비교할 수 있다.
 */
export default function FormatFlow({
  inputLabel = 'Input',
  inputFormats = [],
  outputFormats = [],
  aligned = false,
  className = '',
}) {
  if (inputFormats.length === 0 && outputFormats.length === 0) {
    // 정렬 모드에서는 빈 칸이라도 자리를 지켜야 뒤 열이 밀리지 않는다.
    return aligned ? <div className={className} aria-hidden="true" /> : null;
  }
  const hasBoth = inputFormats.length > 0 && outputFormats.length > 0;
  // 화살표는 장식이므로 스크린리더에는 관계를 말로 전달한다.
  const spoken = hasBoth && (
    <span className="sr-only">
      {`입력 ${inputFormats.join(', ')} · 출력 ${outputFormats.join(', ')}`}
    </span>
  );

  if (aligned) {
    return (
      <div className={`grid ${FORMAT_FLOW_ALIGNED_COLS} items-center gap-x-1.5 text-[11.5px] ${className}`}>
        <div className="flex flex-wrap justify-end gap-1">
          {inputFormats.map(format => (
            <span key={format} className={INPUT_CHIP}>{format}</span>
          ))}
        </div>
        {hasBoth
          ? <ArrowRight size={12} className="mx-auto text-slate-400" aria-hidden="true" />
          : <span aria-hidden="true" />}
        <div className="flex flex-wrap gap-1">
          {outputFormats.map(format => (
            <span key={`out-${format}`} className={OUTPUT_CHIP}>{format}</span>
          ))}
        </div>
        {spoken}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[11.5px] ${className}`}>
      {inputFormats.length === 0 && (
        <span className="font-semibold text-slate-500">{inputLabel}</span>
      )}
      {inputFormats.map(format => (
        <span key={format} className={INPUT_CHIP}>{format}</span>
      ))}
      {hasBoth && <ArrowRight size={12} className="text-slate-400" aria-hidden="true" />}
      {outputFormats.map(format => (
        <span key={`out-${format}`} className={OUTPUT_CHIP}>{format}</span>
      ))}
      {spoken}
    </div>
  );
}
