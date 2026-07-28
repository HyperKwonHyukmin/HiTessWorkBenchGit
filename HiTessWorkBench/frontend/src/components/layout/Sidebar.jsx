import React, { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Home,
  UploadCloud,
  PenTool,
  SlidersHorizontal,
  Wrench,
  FolderOpen,
  Megaphone,
  Lightbulb,
  BookOpen,
  Settings,
  BarChart3,
  LineChart,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Webhook,
  Download,
  MessagesSquare,
} from 'lucide-react';
import { ANALYSIS_DATA, getAppMenuName } from '../../contexts/DashboardContext';

const GROUP_MENU_BY_MODE = {
  File: 'File-Based Apps',
  Interactive: 'Interactive Apps',
  Parametric: 'Parametric Apps',
  Productivity: 'Productivity Apps',
};

const logoIntro = {
  hidden: { opacity: 0, y: -4 },
  visible: { opacity: 1, y: 0 },
};

function Sidebar({ isCollapsed, toggleSidebar, isAdmin, currentMenu, onNavigate, pendingCount = 0 }) {

  const menuItems = useMemo(() => {
    const items = [
      {
        category: "WORKBENCH",
        items: [{ icon: Home, label: "Dashboard" }]
      },
      {
        category: "ANALYSIS",
        items: [
          { icon: UploadCloud, label: "File-Based Apps" },
          { icon: PenTool, label: "Interactive Apps" },
          { icon: SlidersHorizontal, label: "Parametric Apps" },
          { icon: Wrench, label: "Productivity Apps" },
          { icon: FolderOpen, label: "My Projects" },
        ]
      }
    ];

    items.push({
      category: "SUPPORT & COMMUNITY",
      items: [
        { icon: Megaphone, label: "Notice & Updates" },
        { icon: Lightbulb, label: "User Requests" },
        { icon: BookOpen, label: "User Guide" },
        { icon: Download, label: "Download Center" },
      ]
    });

    if (isAdmin) {
      items.push({
        category: "ADMINISTRATION",
        items: [
          { icon: ShieldAlert, label: "User Management", badge: pendingCount },
          { icon: BarChart3, label: "Analysis Management" },
          { icon: Settings, label: "System Management" },
          { icon: LineChart, label: "Usage Reports" },
          { icon: MessagesSquare, label: "App Community" },
          { icon: SlidersHorizontal, label: "App Settings" },
          { icon: Webhook, label: "API Apps" },
        ]
      });
    }

    return items;
  }, [isAdmin, pendingCount]);

  const activeGroupMenu = useMemo(() => {
    const app = ANALYSIS_DATA.find(item => getAppMenuName(item.title) === currentMenu || item.title === currentMenu);
    return app ? GROUP_MENU_BY_MODE[app.mode] : currentMenu;
  }, [currentMenu]);

  return (
    <aside className={`h-full bg-brand-blue text-white flex flex-col transition-all duration-300 shadow-lg z-40 relative ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}>

      <div className={`h-16 flex items-center border-b border-brand-blue-dark relative shrink-0 ${
        isCollapsed ? 'justify-center px-4' : 'justify-start pl-3 pr-2'
      }`}>
        {isCollapsed ? (
          <motion.div
            className="hitess-sidebar-logo-compact"
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.35, ease: 'easeOut' }}
            variants={logoIntro}
          >
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="HiTESS WorkBench"
              decoding="async"
              className="h-9 w-9 object-contain drop-shadow-sm"
            />
          </motion.div>
        ) : (
          <motion.div
            className="hitess-sidebar-logo-lockup"
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.4, ease: 'easeOut' }}
            variants={logoIntro}
          >
            <img
              src={`${import.meta.env.BASE_URL}hitess_logo_lockup_transparent.png`}
              alt="HiTESS WorkBench"
              decoding="async"
              className="h-[2.375rem] w-auto max-w-[13.75rem] object-contain"
            />
          </motion.div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto pt-5 pb-2 sidebar-scrollbar" aria-label="Primary navigation">
        {menuItems.map((section, idx) => (
          <div key={section.category} className="mb-4">
            {!isCollapsed && (
              <div className={`px-6 mb-2 text-[10px] font-black uppercase tracking-wider ${
                section.category === "ADMINISTRATION" ? "text-slate-300/90" : "text-slate-400/90"
              }`}>
                {section.category}
              </div>
            )}
            <ul>
              {section.items.map((item) => {
                const isActive = currentMenu === item.label || activeGroupMenu === item.label;

                return (
                  <li key={item.label}>
                    <button
                      onClick={() => onNavigate(item.label)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center px-4 py-2.5 transition-colors relative group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70 focus-visible:ring-inset ${
                        isActive
                          ? 'bg-white/10 text-white font-bold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                      title={isCollapsed ? item.label : undefined}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-brand-accent"></div>
                      )}

                      <div className={`relative ${isCollapsed ? 'mx-auto' : 'mr-3'} ${isActive ? 'text-brand-accent' : ''}`}>
                         <item.icon size={20} />
                         {/* 접힌 상태: 아이콘 우상단 점 배지 */}
                         {isCollapsed && item.badge > 0 && (
                           <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none ring-2 ring-brand-blue">
                             {item.badge > 9 ? '9+' : item.badge}
                           </span>
                         )}
                      </div>

                      {!isCollapsed && (
                        <span className="text-sm truncate">{item.label}</span>
                      )}
                      {/* 펼친 상태: 라벨 우측 카운트 배지 */}
                      {!isCollapsed && item.badge > 0 && (
                        <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black leading-none animate-pulse">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-brand-blue-dark bg-brand-blue/80 shrink-0">
        {!isCollapsed && (
          <p className="text-[10px] text-white/30 text-center mb-3 leading-relaxed select-none">
            © 2026 Kwon Hyuk Min<br/>All rights reserved.
          </p>
        )}
        <button onClick={toggleSidebar} className="w-full flex items-center justify-center p-2 rounded bg-white/5 hover:bg-white/10 text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70" aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
