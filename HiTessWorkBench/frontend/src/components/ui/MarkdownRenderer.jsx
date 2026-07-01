import React, { Suspense, lazy } from 'react';

const MarkdownRendererCore = lazy(() => import('./MarkdownRendererCore'));

export default function MarkdownRenderer(props) {
  if (!props.content) return null;

  return (
    <Suspense fallback={<div className="text-sm text-slate-500">문서를 불러오는 중입니다...</div>}>
      <MarkdownRendererCore {...props} />
    </Suspense>
  );
}
