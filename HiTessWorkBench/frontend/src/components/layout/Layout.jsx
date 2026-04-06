import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import { LogOut, User, Search, ChevronLeft, ChevronRight, Server } from 'lucide-react';
import { API_BASE_URL, setApiBaseUrl } from '../../config';
import { useServerStatus } from '../../hooks/useServerStatus';
import { ANALYSIS_DATA } from '../../contexts/DashboardContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';

// ✅ 파라미터에 goBack 등 히스토리 관련 props 추가
export default function Layout({ 
  children, onLogout, currentMenu, setCurrentMenu, 
  goBack, goForward, canGoBack, canGoForward 
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [userInfo, setUserInfo] = useState({ name: 'User', position: 'Engineer', is_admin: false });
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(API_BASE_URL);
  const isServerOnline = useServerStatus();

  // 검색
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // 검색 가능한 전체 항목: 사이드바 메뉴 + ANALYSIS_DATA 앱
  const MENU_ITEMS = [
    { label: 'Dashboard',        menu: 'Dashboard' },
    { label: 'File-Based Apps',  menu: 'File-Based Apps' },
    { label: 'Interactive Apps', menu: 'Interactive Apps' },
    { label: 'Parametric Apps',  menu: 'Parametric Apps' },
    { label: 'API Apps',         menu: 'API Apps' },
    { label: 'My Projects',      menu: 'My Projects' },
    { label: 'Notice & Updates', menu: 'Notice & Updates' },
    { label: 'User Guide',       menu: 'User Guide' },
  ];

  // mode → 목록 페이지 메뉴명
  const modeToMenu = { File: 'File-Based Apps', Interactive: 'Interactive Apps', Parametric: 'Parametric Apps' };

  const searchResults = searchTerm.trim().length < 1 ? [] : [
    ...MENU_ITEMS.filter(m => m.label.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(m => ({ label: m.label, sub: '메뉴', menu: m.menu })),
    ...ANALYSIS_DATA.filter(a =>
      a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.description.toLowerCase().includes(searchTerm.toLowerCase())
    ).map(a => ({ label: a.title, sub: a.category, menu: modeToMenu[a.mode] || 'Dashboard' })),
  ].slice(0, 8);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
            
            <div ref={searchRef} className="relative hidden lg:block ml-4">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search menus & apps..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setShowDropdown(false); setSearchTerm(''); } }}
                className="pl-9 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-[9999] overflow-hidden">
                  {searchResults.map((item, i) => (
                    <button
                      key={i}
                      onMouseDown={() => { setCurrentMenu(item.menu); setSearchTerm(''); setShowDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer border-b border-slate-50 last:border-0"
                    >
                      <span className="text-sm font-medium text-slate-800 truncate">{item.label}</span>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap shrink-0">{item.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => { setServerUrlInput(API_BASE_URL); setIsServerModalOpen(true); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              title="서버 주소 설정"
            >
              <span className={`h-2 w-2 rounded-full ${isServerOnline ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
              <span className={`text-xs font-bold hidden sm:block ${isServerOnline ? 'text-emerald-600' : 'text-red-500'}`}>
                {isServerOnline ? 'Online' : 'Offline'}
              </span>
              <Server size={16} className="text-slate-400" />
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

      {/* 서버 주소 설정 모달 */}
      <Modal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        title="서버 연결 설정"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setIsServerModalOpen(false)}>
              취소
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                if (serverUrlInput.trim()) {
                  setApiBaseUrl(serverUrlInput);
                  setIsServerModalOpen(false);
                }
              }}
            >
              저장 및 적용
            </Button>
          </div>
        }
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">백엔드 서버의 주소를 입력하세요. 변경 즉시 적용됩니다.</p>
          <Input
            label="서버 URL"
            type="text"
            value={serverUrlInput}
            onChange={(e) => setServerUrlInput(e.target.value)}
            placeholder="http://10.133.122.70:8000"
            className="font-mono"
          />
        </div>
      </Modal>
    </div>
  );
}