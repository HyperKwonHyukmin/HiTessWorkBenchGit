import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

// 구조 판정(합격/불합격) 공용 배지.
// 디자인 시스템 규칙: 판정은 색 + 아이콘 + 텍스트 3중으로 표기한다(색맹·고대비 사용자 대응, 색 단독 금지).
//   ok=true  → 초록 OK (CheckCircle2)
//   ok=false → 빨강 NG (XCircle)
// 기존에 OkBadge(MastPost/JibRest)·StatusBadge(DTypeLug) 등 페이지별로 중복 정의되던 것을 통합.

const SIZES = {
  sm: { box: 'px-2 py-0.5 text-[10px] gap-1', icon: 11 },
  md: { box: 'px-2.5 py-1 text-xs gap-1.5', icon: 13 },
};

export default function VerdictBadge({
  ok,
  okLabel = 'OK',
  ngLabel = 'NG',
  size = 'sm',
  className = '',
}) {
  const s = SIZES[size] ?? SIZES.sm;
  const Icon = ok ? CheckCircle2 : XCircle;
  const tone = ok
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : 'bg-red-100 text-red-700 border-red-200';

  return (
    <span className={`inline-flex items-center font-bold border rounded-full ${s.box} ${tone} ${className}`}>
      <Icon size={s.icon} className="shrink-0" aria-hidden="true" />
      {ok ? okLabel : ngLabel}
    </span>
  );
}
