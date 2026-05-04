import React, { useState, useMemo } from 'react';
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
  GraduationCap,
  Settings,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Webhook,
  Download,
  BookMarked,
} from 'lucide-react';
import AdminPasswordGateModal from '../ui/AdminPasswordGateModal';
import { verifyAdminGate } from '../../api/admin';

const ADMIN_CATEGORIES = ['ADMINISTRATION'];
const SESSION_KEY = 'admin_gate_unlocked';

export default function Sidebar({ isCollapsed, toggleSidebar, isAdmin, currentMenu, setCurrentMenu }) {

  const [isGateOpen, setIsGateOpen] = useState(false);
  const [pendingMenu, setPendingMenu] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState('');

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
          { icon: GraduationCap, label: "Academic Apps" },
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
          { icon: ShieldAlert, label: "User Management" },
          { icon: BarChart3, label: "Analysis Management" },
          { icon: Settings, label: "System Management" },
          { icon: Webhook, label: "API Apps" },
          { icon: BookMarked, label: "Developer Runbooks" },
        ]
      });
    }

    return items;
  }, [isAdmin]);

  const isAdminMenu = (sectionCategory) => ADMIN_CATEGORIES.includes(sectionCategory);

  const handleMenuClick = (label, sectionCategory) => {
    if (isAdminMenu(sectionCategory)) {
      // 이미 이번 세션에서 인증된 경우 바로 이동
      if (sessionStorage.getItem(SESSION_KEY)) {
        setCurrentMenu(label);
        return;
      }
      // 미인증 → 게이트 모달 표시
      setPendingMenu(label);
      setGateError('');
      setIsGateOpen(true);
      return;
    }
    setCurrentMenu(label);
  };

  const handleGateClose = () => {
    setIsGateOpen(false);
    setPendingMenu(null);
    setGateError('');
  };

  const handleGateConfirm = async (password) => {
    setGateLoading(true);
    setGateError('');
    try {
      await verifyAdminGate(password);
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));
      setIsGateOpen(false);
      setGateError('');
      if (pendingMenu) setCurrentMenu(pendingMenu);
      setPendingMenu(null);
    } catch (err) {
      const msg = err?.response?.data?.detail || '비밀번호 확인 중 오류가 발생했습니다.';
      setGateError(msg);
    } finally {
      setGateLoading(false);
    }
  };

  return (
    <aside className={`h-full bg-brand-blue text-white flex flex-col transition-all duration-300 shadow-xl z-40 relative ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}>

      <div className="h-16 flex items-center justify-center border-b border-brand-blue-dark relative shrink-0">
        {isCollapsed ? (
          <span className="text-xl font-bold text-brand-accent">H</span>
        ) : (
          <h1 className="text-xl font-bold tracking-wider">
            HiTESS <span className="text-brand-accent text-sm font-light">Workbench</span>
          </h1>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto pt-6 pb-2 custom-scrollbar">
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
                      onClick={() => handleMenuClick(item.label, section.category)}
                      className={`w-full flex items-center px-4 py-2 transition-colors relative group cursor-pointer ${
                        isActive
                          ? 'bg-brand-accent text-brand-blue font-bold'
                          : 'text-slate-300 hover:bg-brand-blue-dark hover:text-white'
                      }`}
                    >
                      {isActive && isCollapsed && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-accent"></div>
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

      <div className="p-4 border-t border-brand-blue-dark bg-brand-blue/80 shrink-0">
        {!isCollapsed && (
          <p className="text-[10px] text-white/30 text-center mb-3 leading-relaxed select-none">
            © 2026 Kwon Hyuk Min<br/>All rights reserved.
          </p>
        )}
        <button onClick={toggleSidebar} className="w-full flex items-center justify-center p-2 rounded bg-brand-blue-dark hover:bg-brand-blue-dark/80 text-white transition-colors cursor-pointer">
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <AdminPasswordGateModal
        isOpen={isGateOpen}
        onClose={handleGateClose}
        onConfirm={handleGateConfirm}
        isLoading={gateLoading}
        error={gateError}
      />
    </aside>
  );
}
