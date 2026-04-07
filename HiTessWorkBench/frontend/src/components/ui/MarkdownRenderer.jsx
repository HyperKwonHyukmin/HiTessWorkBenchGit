import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 마크다운 콘텐츠를 README.md 스타일로 렌더링하는 공통 컴포넌트.
 * 순수 텍스트도 줄바꿈이 유지되도록 hard line break 전처리를 수행합니다.
 */
export default function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;

  // 순수 텍스트 호환: 단일 \n을 마크다운 hard line break(공백 2개 + \n)로 변환
  // 단, 마크다운 블록 요소(#, -, >, ```, |, 번호 리스트) 앞뒤는 제외
  const processed = content.replace(/([^\n])\n(?!\n|#| |-|\*|>|`|\||[0-9]+\.)([^\n])/g, '$1  \n$2');

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
