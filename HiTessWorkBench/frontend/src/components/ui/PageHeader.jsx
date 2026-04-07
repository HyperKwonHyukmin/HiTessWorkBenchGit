/// <summary>
/// 페이지 상단 표준 헤더 컴포넌트입니다.
/// 그라디언트 배경의 히어로 배너 스타일로 시각적 앵커를 제공합니다.
/// title(필수), icon, subtitle, actions(우측 버튼/요소)를 지원합니다.
/// </summary>
import React from 'react';

/**
 * PageHeader 컴포넌트
 *
 * @param {object}           props
 * @param {string}           props.title            - 페이지 제목 (필수)
 * @param {React.ElementType} [props.icon]          - 좌측에 표시할 lucide-react 아이콘 컴포넌트
 * @param {string}           [props.subtitle]       - 제목 아래 보조 설명 텍스트
 * @param {React.ReactNode}  [props.actions]        - 우측에 배치할 버튼 등 액션 요소
 */
export default function PageHeader({ title, icon: Icon, subtitle, actions }) {
  return (
    <div className="relative mb-8 -mx-6 -mt-6 px-8 py-7 bg-gradient-to-r from-[#002554] via-[#003366] to-indigo-800 overflow-hidden">
      {/* 데코레이티브 배경 요소 */}
      <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
        <div className="absolute -right-8 -top-8 w-64 h-64 bg-white rounded-full" />
        <div className="absolute right-32 bottom-0 w-32 h-32 bg-white rounded-full" />
      </div>

      <div className="relative flex justify-between items-start max-w-7xl mx-auto">
        {/* 좌측: 아이콘 + 제목/부제목 */}
        <div className="flex items-start gap-4">
          {Icon && (
            <div
              className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-white border border-white/10 shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <Icon size={22} />
            </div>
          )}

          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-blue-200/80 mt-1.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* 우측: 액션 영역 */}
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
