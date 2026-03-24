import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar'; 
// ✅ ChevronLeft, ChevronRight 아이콘 추가
import { LogOut, User, Bell, Search, ChevronLeft, ChevronRight } from 'lucide-react';

// ✅ 파라미터에 goBack 등 히스토리 관련 props 추가
export default function Layout({ 
  children, onLogout, currentMenu, setCurrentMenu, 
  goBack, goForward, canGoBack, canGoForward 
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [userInfo, setUserInfo] = useState({
    name: 'User',
    position: 'Engineer',
    is_admin: false
  });

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        setUserInfo(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error("Failed to load user info:", error);
    }
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar 
        isCollapsed={isCollapsed} 
        toggleSidebar={() => setIsCollapsed(!isCollapsed)} 
        isAdmin={userInfo.is_admin} 
        currentMenu={currentMenu}
        setCurrentMenu={setCurrentMenu}
      />

      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center gap-4 window-no-drag">
            
            {/* ✅ [신규] 브라우저 스타일 뒤로/앞으로 가기 버튼 그룹 */}
            <div className="flex items-center gap-1 bg-slate-100/80 border border-slate-200 p-1 rounded-lg mr-2 hidden md:flex">
              <button 
                onClick={goBack} 
                disabled={!canGoBack}
                className={`p-1 rounded-md transition-all ${
                  canGoBack 
                    ? 'text-slate-600 hover:bg-white hover:shadow-sm cursor-pointer' 
                    : 'text-slate-300 cursor-not-allowed opacity-50'
                }`}
                title="뒤로 가기"
              >
                <ChevronLeft size={18} />
              </button>
              <button 
                onClick={goForward} 
                disabled={!canGoForward}
                className={`p-1 rounded-md transition-all ${
                  canGoForward 
                    ? 'text-slate-600 hover:bg-white hover:shadow-sm cursor-pointer' 
                    : 'text-slate-300 cursor-not-allowed opacity-50'
                }`}
                title="앞으로 가기"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <h2 className="text-lg font-bold text-slate-700 hidden md:block">
              {currentMenu}
            </h2>
            
            <div className="relative hidden lg:block ml-4">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input type="text" placeholder="Search..." className="pl-9 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64" />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 text-gray-500 hover:bg-slate-100 rounded-full relative">
              <Bell size={20} />
              <span className="absolute top-2 right-2 h-2 w-2 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="h-6 w-px bg-gray-200 mx-1"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-slate-800 leading-none">{userInfo.name}</p>
                <p className="text-xs text-slate-500 mt-1 font-medium">{userInfo.position}</p>
              </div>
              <div className="h-9 w-9 bg-blue-100 rounded-full flex items-center justify-center border border-blue-200 text-blue-700">
                <User size={18} />
              </div>
            </div>
            <button onClick={onLogout} className="ml-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[#F8F9FC]">
          {children}
        </main>
      </div>
    </div>
  );
}