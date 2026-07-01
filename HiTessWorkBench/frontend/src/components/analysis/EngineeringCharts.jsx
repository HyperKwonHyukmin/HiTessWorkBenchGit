import React, { Suspense, lazy } from 'react';

const EngineeringChartsCore = lazy(() => import('./EngineeringChartsCore'));

export default function EngineeringCharts(props) {
  return (
    <Suspense fallback={<div className="h-72 rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />}>
      <EngineeringChartsCore {...props} />
    </Suspense>
  );
}
