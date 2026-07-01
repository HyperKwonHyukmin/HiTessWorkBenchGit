import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownRendererCore({ content, className = '' }) {
  if (!content) return null;

  const processed = content.replace(/([^\n])\n(?!\n|#| |-|\*|>|`|\||[0-9]+\.)([^\n])/g, '$1  \n$2');

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
