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
    <div className={`relative -mx-4 sm:-mx-5 lg:-mx-6 -mt-4 sm:-mt-5 lg:-mt-6 mb-5 sm:mb-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-5 bg-gradient-to-r ${gradient} overflow-hidden shrink-0 ${className}`}>
      <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
        <div className="absolute right-0 top-0 h-full w-48 -skew-x-12 bg-white" />
        <div className="absolute right-24 bottom-0 h-px w-40 bg-white" />
      </div>
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between min-w-0">
        {children}
      </div>
    </div>
  );
}
