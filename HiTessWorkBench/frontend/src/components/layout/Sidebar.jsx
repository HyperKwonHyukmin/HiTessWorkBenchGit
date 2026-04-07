import React, { useState, useEffect, useMemo, Fragment } from 'react';
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
  Lock,
  Key,
  X,
  Webhook
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';

export default function Sidebar({ isCollapsed, toggleSidebar, isAdmin, currentMenu, setCurrentMenu }) {
  
  const [isResearchLab, setIsResearchLab] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [pendingMenu, setPendingMenu] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSecondaryAuthPassed, setIsSecondaryAuthPassed] = useState(false);

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
          { icon: Bot, label: "AI Assistant" },
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

  const handleMenuClick = (category, label) => {
    if (category === "ADMINISTRATION" && !isSecondaryAuthPassed) {
      setPendingMenu(label);     
      setAdminPassword('');      
      setAuthError('');          
      setIsAuthModalOpen(true);  
    } else {
      setCurrentMenu(label);     
    }
  };

  const handleAuthSubmit = (e) => {
    e.preventDefault();
    if (adminPassword === 'str_2006') {
      setIsSecondaryAuthPassed(true);  
      setIsAuthModalOpen(false);       
      setCurrentMenu(pendingMenu);     
    } else {
      setAuthError('접속 비밀번호가 일치하지 않습니다.');
    }
  };

  return (
    <>
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
                        onClick={() => handleMenuClick(section.category, item.label)} 
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

      <Transition appear show={isAuthModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsAuthModalOpen(false)}>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col transform animate-fade-in-up">
              
              <div className="bg-red-600 p-5 flex justify-between items-center text-white">
                <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                  <Lock size={20}/> 관리자 보안 인증
                </Dialog.Title>
                <button onClick={() => setIsAuthModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer">
                  <X size={20}/>
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="p-6 bg-slate-50 space-y-5">
                <p className="text-sm text-slate-600 leading-relaxed font-medium">
                  해당 메뉴는 시스템의 민감한 정보를 포함하고 있습니다.<br/>
                  안전한 접근을 위해 <strong className="text-red-600">2차 접속 비밀번호</strong>를 입력해 주세요.
                </p>
                
                <div>
                  <div className="relative group">
                    <Key className="absolute left-3 top-3.5 h-5 w-5 text-slate-400 group-focus-within:text-red-500 transition-colors" />
                    <input
                      type="password"
                      required
                      autoFocus
                      placeholder="관리자 패스워드 입력"
                      value={adminPassword}
                      onChange={(e) => {
                        setAdminPassword(e.target.value);
                        setAuthError(''); 
                      }}
                      className={`w-full pl-10 pr-3 py-3 border-2 rounded-xl outline-none transition-all text-slate-800 font-bold ${
                        authError ? 'border-red-400 focus:border-red-500 bg-red-50/30' : 'border-slate-200 focus:border-red-500 bg-white'
                      }`}
                    />
                  </div>
                  {authError && (
                    <p className="text-xs text-red-500 font-bold mt-2 animate-pulse">{authError}</p>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setIsAuthModalOpen(false)} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors cursor-pointer">
                    취소
                  </button>
                  <button type="submit" className="px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-md transition-colors cursor-pointer">
                    인증 및 접속
                  </button>
                </div>
              </form>

            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}