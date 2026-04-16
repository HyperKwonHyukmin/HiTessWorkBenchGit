import React, { useState, useEffect, useMemo } from 'react';
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
  Bot,
  Library,
  Settings,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Webhook,
  Download
} from 'lucide-react';

export default function Sidebar({ isCollapsed, toggleSidebar, isAdmin, currentMenu, setCurrentMenu }) {

  const [isResearchLab, setIsResearchLab] = useState(false);

  useEffect(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user.department === '구조시스템연구실' || user.company === '구조시스템연구실') {
          setIsResearchLab(true);
        }
      }
    } catch (error) {
      console.error("Failed to parse user info in Sidebar:", error);
    }
  }, []);

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

    if (isResearchLab) {
      items.push({
        category: "RESEARCH & AI",
        items: [
          { icon: Bot, label: "AI Based Apps" },
          { icon: Library, label: "Knowledge Archive" },
        ]
      });
    }

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
          { icon: ShieldAlert, label: "User Management" },
          { icon: BarChart3, label: "Analysis Management" },
          { icon: Settings, label: "System Settings" },
          { icon: Webhook, label: "API Apps" }
        ]
      });
    }

    return items;
  }, [isAdmin, isResearchLab]);

  const handleMenuClick = (label) => {
    setCurrentMenu(label);
  };

  return (
    <aside className={`h-full bg-[#002554] text-white flex flex-col transition-all duration-300 shadow-xl z-40 relative ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}>

      <div className="h-16 flex items-center justify-center border-b border-[#003366] relative shrink-0">
        {isCollapsed ? (
          <span className="text-xl font-bold text-[#00E600]">H</span>
        ) : (
          <h1 className="text-xl font-bold tracking-wider">
            HiTESS <span className="text-[#00E600] text-sm font-light">Workbench</span>
          </h1>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {menuItems.map((section, idx) => (
          <div key={idx} className="mb-4">
            {!isCollapsed && (
              <div className={`px-6 mb-2 text-xs font-bold uppercase tracking-wider ${
                section.category === "ADMINISTRATION" ? "text-red-400" : "text-slate-400"
              }`}>
                {section.category}
              </div>
            )}
            <ul>
              {section.items.map((item, i) => {
                const isActive = currentMenu === item.label;

                return (
                  <li key={i}>
                    <button
                      onClick={() => handleMenuClick(item.label)}
                      className={`w-full flex items-center px-4 py-2 transition-colors relative group cursor-pointer ${
                        isActive
                          ? 'bg-[#00E600] text-brand-blue font-bold'
                          : 'text-slate-300 hover:bg-[#003366] hover:text-white'
                      }`}
                    >
                      {isActive && isCollapsed && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00E600]"></div>
                      )}

                      <div className={`${isCollapsed ? 'mx-auto' : 'mr-3'}`}>
                         <item.icon size={20} className={section.category === "ADMINISTRATION" && !isActive ? "text-red-400/70 group-hover:text-red-400" : ""} />
                      </div>

                      {!isCollapsed && (
                        <span className="text-sm">{item.label}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-[#003366] bg-[#001f45] shrink-0">
        <button onClick={toggleSidebar} className="w-full flex items-center justify-center p-2 rounded bg-[#003366] hover:bg-brand-blue-dark text-white transition-colors cursor-pointer">
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
