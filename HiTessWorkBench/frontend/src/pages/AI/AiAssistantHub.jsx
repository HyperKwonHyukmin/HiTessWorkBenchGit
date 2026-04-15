import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { ANALYSIS_DATA } from '../../contexts/DashboardContext';
import { useDashboard } from '../../contexts/DashboardContext';
import AppCard from '../../components/ui/AppCard';
import PageHeader from '../../components/ui/PageHeader';
import AnimatedGrid from '../../components/ui/AnimatedGrid';
import AdminGateModal from '../../components/ui/AdminGateModal';

const getIsAdmin = () => {
  try { return JSON.parse(localStorage.getItem('user') || '{}').is_admin === true; } catch { return false; }
};

export default function AiAssistantHub() {
  const { favorites, toggleFavorite } = useDashboard();
  const [gateApp, setGateApp] = useState(null);

  const aiApps = ANALYSIS_DATA.filter(item => item.mode === 'AI');

  const handleStart = (appTitle) => {
    const appMeta = ANALYSIS_DATA.find(a => a.title === appTitle);
    if (appMeta && (appMeta.devStatus === 'Developing' || appMeta.devStatus === 'Planned') && !getIsAdmin()) {
      setGateApp({ title: appMeta.title, devStatus: appMeta.devStatus });
      return;
    }
    alert(`[안내] '${appTitle}' 앱은 현재 준비 중입니다.`);
  };

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <PageHeader
        title="AI Based Apps"
        icon={Bot}
        subtitle="최신 인공지능 기술을 활용하여 구조 해석 업무 생산성을 극대화하십시오."
      />

      {aiApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Bot size={48} className="text-slate-200 mb-4" />
          <p className="font-bold text-slate-500 text-sm">준비 중인 AI 서비스가 곧 추가될 예정입니다.</p>
          <p className="text-xs mt-1">새로운 AI 도구를 기대해 주세요.</p>
        </div>
      ) : (
        <AnimatedGrid>
          {aiApps.map((item) => {
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
                accentColor="purple"
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