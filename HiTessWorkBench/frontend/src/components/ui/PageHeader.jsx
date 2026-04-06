/// <summary>
/// 페이지 상단 표준 헤더 컴포넌트입니다.
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
    <div className="flex justify-between items-start mb-6">
      {/* ── 좌측: 아이콘 + 제목/부제목 ── */}
      <div className="flex items-start gap-3">
        {/* 아이콘 박스 (icon prop이 있을 때만 렌더링) */}
        {Icon && (
          <div
            className="bg-brand-blue/10 p-2.5 rounded-xl text-brand-blue shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <Icon size={20} />
          </div>
        )}

        {/* 제목 + 부제목 그룹 */}
        <div>
          <h1 className="text-2xl font-bold text-brand-blue tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* ── 우측: 액션 영역 (actions prop이 있을 때만 렌더링) ── */}
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
