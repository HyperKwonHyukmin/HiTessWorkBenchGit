import React, { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import AdminGateModal from '../../components/ui/AdminGateModal';
import { isAdmin as getIsAdmin } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

export default function AcademicApps() {
  const { showToast } = useToast();
  const { favorites, toggleFavorite } = useDashboard();
  const [gateApp, setGateApp] = useState(null);

  const academicApps = ANALYSIS_DATA.filter(item => item.mode === 'Academic');

  const handleStart = (appTitle) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === appTitle);
    if (appMeta && (appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    showToast(`'${appTitle}' 앱은 현재 준비 중입니다.`, 'info');
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <PageHeader
        title="Academic Apps"
        icon={GraduationCap}
        subtitle="학술 연구 기반의 AI·고급 알고리즘 해석 앱입니다."
        accentColor="cyan"
      />

      {academicApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <GraduationCap size={48} className="text-slate-200 mb-4" />
          <p className="font-bold text-slate-500 text-sm">준비 중인 Academic 앱이 곧 추가될 예정입니다.</p>
          <p className="text-xs mt-1">새로운 연구 기반 도구를 기대해 주세요.</p>
        </div>
      ) : (
        <AnimatedGrid>
          {academicApps.map((item) => {
            const IconComponent = item.icon;
            const iconColorClass = item.color.replace('bg-', 'text-');
            const isRestricted = (item.devStatus === 'Developing' || item.devStatus === 'Planned') && !getIsAdmin();
            const appData = {
              title: item.title,
              description: item.description,
              icon: <IconComponent className={iconColorClass} size={28} />,
              iconBg: item.color,
              tags: item.tags,
              devStatus: item.devStatus,
              contributor: item.contributor,
            };
            return (
              <AppCard
                key={item.title}
                app={appData}
                accentColor="cyan"
                isRestricted={isRestricted}
                isFavorite={favorites.includes(item.title)}
                onFavorite={() => toggleFavorite(item.title)}
                onStart={() => handleStart(item.title)}
              />
            );
          })}
        </AnimatedGrid>
      )}

      <AdminGateModal
        isOpen={!!gateApp}
        onClose={() => setGateApp(null)}
        appTitle={gateApp?.title}
        devStatus={gateApp?.devStatus}
      />
    </div>
  );
}
