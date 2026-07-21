import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import { AlertTriangle, Command, LogOut, User, Search, ChevronLeft, ChevronRight, Server, Monitor } from 'lucide-react';
import { API_BASE_URL, setApiBaseUrl } from '../../config';
import { version as CLIENT_VERSION } from '../../../package.json';
import { useServerHealth } from '../../hooks/useServerStatus';
import { useRemoteSessions } from '../../hooks/useRemoteSessions';
import { ANALYSIS_DATA, getAppMenuName } from '../../contexts/DashboardContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { useRecentActivity } from '../../contexts/RecentActivityContext';
import { verifyAdminGate } from '../../api/admin';
import AdminPasswordGateModal from '../ui/AdminPasswordGateModal';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EnvironmentDiagnosticsModal from '../platform/EnvironmentDiagnosticsModal';
import CommandPalette from '../platform/CommandPalette';
import { ADMIN_MENUS } from '../../constants/adminMenus';

const ADMIN_GATE_SESSION_KEY = 'admin_gate_unlocked';
const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
const GROUP_MENU_BY_MODE = { File: 'File-Based Apps', Interactive: 'Interactive Apps', Parametric: 'Parametric Apps', Productivity: 'Productivity Apps' };

// ✅ 파라미터에 goBack 등 히스토리 관련 props 추가
export default function Layout({ 
  children, onLogout, currentMenu, setCurrentMenu, 
  goBack, goForward, canGoBack, canGoForward 
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  // AuthContext 의 reactive user 에서 직접 헤더 표시값을 파생한다.
  // 비로그인 상태일 때만 기본 placeholder 사용.
  const { user: authUser } = useAuth();
  const userInfo = authUser
    ? { name: authUser.name || 'User', position: authUser.position || 'Engineer', is_admin: !!authUser.is_admin }
    : { name: 'User', position: 'Engineer', is_admin: false };
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(API_BASE_URL);
  const [currentServerUrl, setCurrentServerUrl] = useState(API_BASE_URL);
  const serverHealth = useServerHealth();
  const remoteSessions = useRemoteSessions(10000, { enabled: userInfo.is_admin });
  const [remoteChecking, setRemoteChecking] = useState(false);
  const isServerOnline = serverHealth.isOnline;
  const { events: networkEvents, clearEvents: clearNetworkEvents } = useNetwork();
  const { recentApps, recordAppVisit } = useRecentActivity();
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [pendingMenu, setPendingMenu] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState('');

  const getServerHost = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return url.replace(/^https?:\/\//, '');
    }
  };

  const serverStatusClasses = {
    online: 'bg-emerald-500 text-emerald-600',
    degraded: 'bg-amber-400 text-amber-600',
    unreliable: 'bg-orange-500 text-orange-600',
    offline: 'bg-red-500 text-red-500',
  };
  const statusClass = serverStatusClasses[serverHealth.level] || serverStatusClasses.offline;
  // 배지는 '현재 활성 연결' 기준 — 원격 사용자가 접속을 끊으면(세션 Disc) 다음 폴링에 사라진다.
  const activeRemoteSessions = remoteSessions.remoteSessions.filter(s => s.is_active);
  const remoteSessionCount = activeRemoteSessions.length;
  const primaryRemoteSession = activeRemoteSessions[0] || null;
  const hasActiveRemote = remoteSessionCount > 0;
  const primaryRemoteLabel = primaryRemoteSession?.display_name
    ? `${primaryRemoteSession.display_name} 서버 원격 사용중`
    : '원격 접속 없음';
  const handleRemoteCheck = async () => {
    setRemoteChecking(true);
    try {
      await remoteSessions.checkNow(true); // 캐시 무시하고 즉시 재조회
    } finally {
      setRemoteChecking(false);
    }
  };
  const remoteSessionSummary = remoteSessions.remoteSessions
    .map(session => {
      const ip = session.ip_address ? ` / ${session.ip_address}` : '';
      const owner = session.ip_owner ? `${session.ip_owner} ` : '';
      return `${owner}${session.username}${ip} (${session.state})`;
    })
    .join('\n');
  const activeRdpIpSummary = remoteSessions.activeRdpClientIps?.length
    ? `\n현재 RDP IP: ${remoteSessions.activeRdpClientIps.join(', ')}`
    : '';

  // 검색
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // 검색 가능한 전체 항목: 사이드바 메뉴 + ANALYSIS_DATA 앱
  const menuItems = useMemo(() => [
    { label: 'Dashboard', menu: 'Dashboard' },
    { label: 'File-Based Apps', menu: 'File-Based Apps' },
    { label: 'Interactive Apps', menu: 'Interactive Apps' },
    { label: 'Parametric Apps', menu: 'Parametric Apps' },
    { label: 'Productivity Apps', menu: 'Productivity Apps' },
    { label: 'My Projects', menu: 'My Projects' },
    { label: 'Notice & Updates', menu: 'Notice & Updates' },
    { label: 'User Requests', menu: 'User Requests' },
    { label: 'User Guide', menu: 'User Guide' },
    { label: 'Download Center', menu: 'Download Center' },
    ...(userInfo.is_admin ? [
      { label: 'User Management', menu: 'User Management' },
      { label: 'Analysis Management', menu: 'Analysis Management' },
      { label: 'System Management', menu: 'System Management' },
      { label: 'Usage Reports', menu: 'Usage Reports' },
      { label: 'API Apps', menu: 'API Apps' },
    ] : []),
  ], [userInfo.is_admin]);

  const searchResults = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (query.length < 1) return [];
    return [
      ...menuItems.filter(m => m.label.toLowerCase().includes(query))
        .map(m => ({ label: m.label, sub: '메뉴', menu: m.menu })),
      ...ANALYSIS_DATA.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query)
      ).map(a => ({ label: a.title, sub: a.category, menu: getAppMenuName(a.title) })),
    ].slice(0, 8);
  }, [menuItems, searchTerm]);

  // 브레드크럼용 그룹 — 현재 메뉴가 특정 앱이면 상위 그룹 메뉴를 계산한다(Sidebar와 동일 규칙).
  const breadcrumbGroup = useMemo(() => {
    const app = ANALYSIS_DATA.find(item => getAppMenuName(item.title) === currentMenu || item.title === currentMenu);
    return app ? GROUP_MENU_BY_MODE[app.mode] : null;
  }, [currentMenu]);

  const toggleSidebar = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const handleNavigate = useCallback((menu) => {
    const app = ANALYSIS_DATA.find(item => getAppMenuName(item.title) === menu || item.title === menu);
    if (app) {
      const routeMenu = getAppMenuName(app.title);
      sessionStorage.setItem(ANALYSIS_MENU_FRESH_ENTRY_KEY, JSON.stringify({ menu: routeMenu, at: Date.now() }));
      window.dispatchEvent(new CustomEvent('workbench:analysis-fresh-entry', { detail: { menu: routeMenu } }));
    }

    if (ADMIN_MENUS.has(menu)) {
      if (!userInfo.is_admin) return;
      if (sessionStorage.getItem(ADMIN_GATE_SESSION_KEY)) {
        setCurrentMenu(menu);
        return;
      }
      setPendingMenu(menu);
      setGateError('');
      setIsGateOpen(true);
      return;
    }
    setCurrentMenu(menu);
  }, [setCurrentMenu, userInfo.is_admin]);

  useEffect(() => {
    const app = ANALYSIS_DATA.find(item => getAppMenuName(item.title) === currentMenu || item.title === currentMenu);
    if (app) {
      recordAppVisit(currentMenu, app.title, { mode: app.mode, category: app.category });
    }
  }, [currentMenu, recordAppVisit]);

  const handleGateClose = useCallback(() => {
    setIsGateOpen(false);
    setPendingMenu(null);
    setGateError('');
  }, []);

  const handleGateConfirm = useCallback(async (password) => {
    setGateLoading(true);
    setGateError('');
    try {
      await verifyAdminGate(password);
      sessionStorage.setItem(ADMIN_GATE_SESSION_KEY, String(Date.now()));
      setIsGateOpen(false);
      if (pendingMenu) setCurrentMenu(pendingMenu);
      setPendingMenu(null);
    } catch (err) {
      setGateError(err?.response?.data?.detail || '비밀번호 확인 중 오류가 발생했습니다.');
    } finally {
      setGateLoading(false);
    }
  }, [pendingMenu, setCurrentMenu]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen min-w-[320px] bg-slate-50 overflow-hidden">
      <Sidebar 
        isCollapsed={isCollapsed} 
        toggleSidebar={toggleSidebar} 
        isAdmin={userInfo.is_admin} 
        currentMenu={currentMenu}
        onNavigate={handleNavigate}
      />

      <div className="flex-1 flex flex-col min-w-0 transition-all duration-300">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 shadow-sm z-10">
          <div className="flex items-center gap-2 lg:gap-4 window-no-drag min-w-0 flex-1">
            
            {/* ✅ [신규] 브라우저 스타일 뒤로/앞으로 가기 버튼 그룹 */}
            <div className="hidden md:flex items-center gap-1 bg-slate-100/80 border border-slate-200 p-1 rounded-lg mr-1 lg:mr-2 shrink-0">
              <button 
                onClick={goBack} 
                disabled={!canGoBack}
                className={`p-1 rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
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
                className={`p-1 rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  canGoForward 
                    ? 'text-slate-600 hover:bg-white hover:shadow-sm cursor-pointer' 
                    : 'text-slate-300 cursor-not-allowed opacity-50'
                }`}
                title="앞으로 가기"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="hidden md:flex items-center gap-1.5 min-w-0 max-w-[16rem] xl:max-w-[26rem]">
              {breadcrumbGroup && breadcrumbGroup !== currentMenu && (
                <>
                  <button
                    onClick={() => handleNavigate(breadcrumbGroup)}
                    className="text-sm font-semibold text-slate-400 hover:text-blue-600 truncate shrink-0 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={`${breadcrumbGroup}로 이동`}
                  >
                    {breadcrumbGroup}
                  </button>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" aria-hidden="true" />
                </>
              )}
              <h2 className="text-base lg:text-lg font-bold text-slate-700 truncate min-w-0" title={currentMenu}>
                {currentMenu}
              </h2>
            </div>
            
            <div ref={searchRef} className="relative ml-0 md:ml-2 lg:ml-4 min-w-0 shrink">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search menus & apps..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setShowDropdown(false); setSearchTerm(''); } }}
                className="pl-9 pr-3 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-36 sm:w-48 lg:w-64 max-w-[34vw] min-w-0"
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-[9999] overflow-hidden">
                  {searchResults.map((item, i) => (
                    <button
                      key={i}
                      onMouseDown={() => { handleNavigate(item.menu); setSearchTerm(''); setShowDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer border-b border-slate-50 last:border-0"
                    >
                      <span className="text-sm font-medium text-slate-800 truncate">{item.label}</span>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap shrink-0">{item.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden xl:inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              title="Command Palette (Ctrl+K)"
            >
              <Command size={14} />
              <span>Ctrl K</span>
            </button>
            {recentApps.length > 0 && (
              <div className="hidden 2xl:flex max-w-[420px] items-center gap-1.5 overflow-hidden">
                <span className="shrink-0 text-[10px] font-black text-slate-400">최근 사용 앱</span>
                {recentApps.slice(0, 3).map(app => (
                  <button
                    key={app.menu}
                    type="button"
                    onClick={() => handleNavigate(app.menu)}
                    className="max-w-[108px] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    title={`최근 사용: ${app.label}`}
                  >
                    {app.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0 min-w-0">
            {userInfo.is_admin && (
              <button
                type="button"
                onClick={handleRemoteCheck}
                disabled={remoteChecking}
                className={`inline-flex max-w-[210px] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors disabled:opacity-70 ${
                  hasActiveRemote
                    ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
                title={`원격 접속 상태 — 클릭 시 즉시 확인\n${remoteSessionSummary || '현재 활성 원격 세션 없음'}${activeRdpIpSummary}\n조회: ${remoteSessions.ipLookupStatus || 'unknown'}${remoteSessions.checkedAt ? `\n확인: ${remoteSessions.checkedAt}` : ''}`}
              >
                <Monitor size={15} className={`shrink-0 ${remoteChecking ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline truncate">{remoteChecking ? '확인 중…' : primaryRemoteLabel}</span>
                {remoteSessionCount > 1 && (
                  <span className="rounded-full bg-amber-600 px-1.5 text-[10px] leading-4 text-white">
                    {remoteSessionCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setIsDiagnosticsOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
              title={`서버 상태 진단 (${currentServerUrl})`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${statusClass.split(' ')[0]} ${!isServerOnline ? 'animate-pulse' : ''}`} />
              <div className="hidden lg:flex flex-col items-start leading-none gap-0.5">
                <span className={`text-[10px] font-bold ${statusClass.split(' ')[1]}`}>
                  {serverHealth.label}
                  {serverHealth.latencyMs != null ? ` · ${serverHealth.latencyMs}ms` : ''}
                </span>
                <span className="hidden xl:block text-[10px] text-slate-500 font-mono max-w-[9rem] truncate">
                  {getServerHost(currentServerUrl)}
                </span>
                <span className="hidden 2xl:block text-[10px] text-slate-400 font-mono">
                  v{CLIENT_VERSION}
                </span>
              </div>
              <Server size={16} className="text-slate-400" />
            </button>
            {networkEvents.length > 0 && (
              <button
                onClick={() => setIsDiagnosticsOpen(true)}
                className="relative rounded-lg p-2 text-amber-500 hover:bg-amber-50"
                title={`최근 API 오류 ${networkEvents.length}건`}
              >
                <AlertTriangle size={17} />
                <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-4 text-white">
                  {Math.min(networkEvents.length, 9)}
                </span>
              </button>
            )}
            <div className="h-6 w-px bg-gray-200 mx-0.5 lg:mx-1"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden xl:block">
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

        <main className={`flex-1 p-4 sm:p-5 lg:p-6 bg-surface min-w-0 ${
          currentMenu === 'Dashboard'
            ? 'overflow-hidden'
            : 'overflow-y-auto [scrollbar-gutter:stable]'
        }`}>
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
                  setCurrentServerUrl(serverUrlInput);
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
            placeholder="http://10.14.42.145:9091"
            className="font-mono"
          />
        </div>
      </Modal>
      <EnvironmentDiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        health={serverHealth}
        networkEvents={networkEvents}
        onRecheck={serverHealth.checkNow}
        onClearNetworkEvents={clearNetworkEvents}
        onOpenServerSettings={() => {
          setServerUrlInput(currentServerUrl);
          setIsDiagnosticsOpen(false);
          setIsServerModalOpen(true);
        }}
      />
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        menuItems={menuItems}
        onNavigate={handleNavigate}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        onOpenServerSettings={() => {
          setServerUrlInput(currentServerUrl);
          setIsServerModalOpen(true);
        }}
      />
      <AdminPasswordGateModal
        isOpen={isGateOpen}
        onClose={handleGateClose}
        onConfirm={handleGateConfirm}
        isLoading={gateLoading}
        error={gateError}
      />
    </div>
  );
}
