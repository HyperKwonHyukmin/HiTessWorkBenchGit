import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { ANALYSIS_DATA } from '../../contexts/DashboardContext';

/**
 * RelatedAppsWidget — 연관 앱을 항상 노출하는 인라인 위젯.
 * 리스트에 max-h + overflow-y-auto를 걸어 앱 수가 늘어도 사이드바를 밀어내지 않는다.
 *
 * @param {string} appTitle - 현재 앱의 title (ANALYSIS_DATA와 일치해야 함)
 */
export default function RelatedAppsWidget({ appTitle }) {
  const { setCurrentMenu } = useNavigation();

  const currentApp = ANALYSIS_DATA.find(a => a.title === appTitle);
  const relatedApps = (currentApp?.relatedApps ?? [])
    .map(title => ANALYSIS_DATA.find(a => a.title === title))
    .filter(Boolean);

  if (!relatedApps.length) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0" />
        연관 앱
      </p>
      <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto">
        {relatedApps.map(app => {
          const Icon = app.icon;
          return (
            <button
              key={app.title}
              onClick={() => setCurrentMenu(app.title)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-transparent hover:border-blue-200 hover:bg-blue-50 transition-colors text-left group cursor-pointer"
            >
              <div className={`w-6 h-6 rounded-lg ${app.color} flex items-center justify-center shrink-0`}>
                <Icon size={12} className="text-white" />
              </div>
              <span className="flex-1 text-xs font-medium text-slate-700 group-hover:text-blue-700 truncate">
                {app.title}
              </span>
              <ArrowUpRight size={12} className="text-slate-300 group-hover:text-blue-400 shrink-0 transition-colors" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
