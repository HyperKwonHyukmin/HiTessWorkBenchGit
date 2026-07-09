import React, { Suspense, lazy, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { findAppByAnyName } from '../../contexts/DashboardContext';

const ProgramDetailModal = lazy(() => import('../admin/ProgramDetailModal'));

export default function AppUsageStatsButton({ appName }) {
  const { isAdmin } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const app = useMemo(() => findAppByAnyName(appName), [appName]);

  if (!isAdmin || !app) return null;

  const programNames = app.programNames?.length ? app.programNames : [app.title];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
        title={`${app.title} 사용 상세 통계`}
      >
        <BarChart3 size={15} />
        App 통계
      </button>
      {isOpen && (
        <Suspense fallback={null}>
          <ProgramDetailModal
            programName={app.title}
            programNames={programNames}
            onClose={() => setIsOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
