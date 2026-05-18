/// <summary>
/// 페이지 상단의 그라디언트 배너 컨테이너.
///
/// 10+ 개 페이지가 반복하던 외부 그라디언트 박스 + 배경 장식 원 2개 +
/// 내부 flex justify-between 레이아웃을 단일 컴포넌트로 흡수한다.
///
/// 페이지마다 다른 부분(색상/아이콘/제목/버튼 등) 은 gradient prop 과
/// children 으로 그대로 받는다.
///
/// 사용 예:
///   <PageBanner gradient="from-brand-blue via-teal-900 to-teal-700">
///     <div className="flex items-center gap-4">
///       <button onClick={onBack}>...</button>
///       <h1>BDF Scanner</h1>
///     </div>
///     <div className="flex items-center gap-2">
///       <button onClick={...}>이력</button>
///       <GuideButton ... />
///     </div>
///   </PageBanner>
/// </summary>
import React from 'react';

export default function PageBanner({ gradient, className = '', children }) {
  return (
    <div className={`relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r ${gradient} overflow-hidden shrink-0 ${className}`}>
      <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
        <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
        <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
      </div>
      <div className="relative flex items-center justify-between">
        {children}
      </div>
    </div>
  );
}
