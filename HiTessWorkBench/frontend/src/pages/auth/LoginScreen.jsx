import React, { useState, useEffect, useCallback } from 'react';
import { User, ArrowRight, ShieldCheck, AlertCircle, Clock, WifiOff, DownloadCloud, AlertTriangle, Construction, RefreshCw, Settings, Server } from 'lucide-react';
import RegisterModal from '../../components/modals/RegisterModal';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { checkVersion, login } from '../../api/auth';
import { useAuth } from '../../contexts/AuthContext';
import { API_BASE_URL, DEFAULT_API_BASE_URL, setApiBaseUrl } from '../../config';
import { version as CLIENT_VERSION } from '../../../package.json';
const structureBgUrl = "https://images.unsplash.com/photo-1553653841-453082536a9d?q=80&w=1000&auto=format&fit=crop";

export default function LoginScreen({ onLoginSuccess }) {
  const { login: authLogin } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // 상태 관리
  const [isServerLive, setIsServerLive] = useState(null);
  const [isVersionMismatch, setIsVersionMismatch] = useState(false);
  const [serverVersion, setServerVersion] = useState('');
  const [serverErrorReason, setServerErrorReason] = useState('');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [downloadState, setDownloadState] = useState(null); // null | 'downloading' | 'done' | 'error'
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [currentServerUrl, setCurrentServerUrl] = useState(API_BASE_URL);
  const [serverUrlInput, setServerUrlInput] = useState(API_BASE_URL);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [serverSettingsError, setServerSettingsError] = useState('');

  const serverHost = (() => {
    try { return new URL(currentServerUrl).host; } catch { return currentServerUrl; }
  })();

  const checkServerConnection = useCallback(async () => {
    setIsCheckingServer(true);
    setServerErrorReason('');
    try {
      const response = await checkVersion({ retries: 1, timeout: 5000 });
      const fetchedServerVersion = response.data.version;
      setServerVersion(fetchedServerVersion);
      setIsServerLive(true);
      setIsVersionMismatch(fetchedServerVersion !== CLIENT_VERSION);
      if (fetchedServerVersion !== CLIENT_VERSION) {
        console.warn(`Version Mismatch! Client: ${CLIENT_VERSION}, Server: ${fetchedServerVersion}`);
      }
      return true;
    } catch (error) {
      console.error("Server Check Failed:", error);
      setIsServerLive(false);
      setIsVersionMismatch(false);
      if (error.code === 'ECONNABORTED') {
        setServerErrorReason('연결 시간 초과');
      } else if (error.code === 'ERR_NETWORK' || !error.response) {
        setServerErrorReason('서버에 연결할 수 없음');
      } else if (error.response?.status === 503) {
        setServerErrorReason('서버 점검 중');
      } else {
        setServerErrorReason(`HTTP ${error.response?.status ?? '오류'}`);
      }
      return false;
    } finally {
      setIsCheckingServer(false);
    }
  }, []);

  const applyServerUrl = async () => {
    const candidate = serverUrlInput.trim().replace(/\/$/, '');
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    } catch {
      setServerSettingsError('http:// 또는 https://로 시작하는 올바른 서버 URL을 입력하세요.');
      return;
    }
    setServerSettingsError('');
    setApiBaseUrl(candidate);
    setCurrentServerUrl(candidate);
    setIsServerSettingsOpen(false);
    setIsServerLive(null);
    await checkServerConnection();
  };

  // [초기화] 서버 상태 및 버전 체크
  useEffect(() => {
    checkServerConnection();

    const savedId = localStorage.getItem('savedEmployeeId');
    if (savedId) setEmployeeId(savedId);

    const removeListener = window.electron?.onMessage('download-progress', (data) => {
      if (data.done) {
        setDownloadState(data.error ? 'error' : 'done');
        setDownloadProgress(100);
      } else if (data.progress >= 0) {
        setDownloadState('downloading');
        setDownloadProgress(data.progress);
      }
    });
    return () => { if (removeListener) removeListener(); };

  }, [checkServerConnection]);

  const handleInputChange = (e) => {
    setEmployeeId(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isVersionMismatch) return; 

    setIsLoading(true);
    setErrorMsg('');

    localStorage.setItem('savedEmployeeId', employeeId);

    try {
      const response = await login(employeeId);

      // AuthContext 가 localStorage 4개 키 (user/session_token/user_login_at/user_last_active)
      // 일괄 세팅 + state 갱신을 캡슐화한다.
      const { token, ...userObj } = response.data;
      authLogin(userObj, token);
      onLoginSuccess();

    } catch (error) {
      console.error('Login Error:', error);
      
      if (!error.response) {
        try {
          await checkVersion();
          setIsServerLive(true);
          setErrorMsg("로그인 요청이 일시적으로 실패했습니다. 다시 시도해주세요.");
        } catch {
          setIsServerLive(false);
          setErrorMsg("서버 응답이 없습니다.");
        }
      } else {
        if (error.response.status === 404) {
          setErrorMsg("등록되지 않은 사번입니다.");
        } 
        else if (error.response.status === 403) {
          setErrorMsg("PENDING_APPROVAL");
        }
        else if (error.response.status === 503) {
          setErrorMsg("MAINTENANCE_MODE");
        }
        else {
          setErrorMsg(`로그인 오류: ${error.response.status}`);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-brand-gray font-sans overflow-hidden relative">
      
      {/* 1. 좌측 브랜딩 패널 */}
      <div className="hidden lg:flex w-1/3 relative flex-col p-12 text-white overflow-hidden bg-brand-blue">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img src={structureBgUrl} alt="Structure" decoding="async" className="w-full h-full object-cover opacity-50 mix-blend-overlay grayscale contrast-125 transform scale-105" />
          <div className="absolute inset-0 bg-gradient-to-b from-brand-blue/90 via-brand-blue/40 to-brand-blue/90"></div>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center pointer-events-none">
          <div className="mb-8">
            <img src={`${import.meta.env.BASE_URL}icon.ico`} alt="HiTESS WorkBench" decoding="async" className="h-12 w-auto object-contain" />
          </div>
           <h1 className="text-4xl font-extrabold leading-tight text-white drop-shadow-md">
            HiTESS <br/> <span className="text-brand-accent">WorkBench</span>
          </h1>
          <div className="h-1.5 w-20 bg-brand-green mt-8 rounded-full"></div>
          <p className="mt-4 text-xs text-blue-200 opacity-60 font-mono">
            Client v{CLIENT_VERSION}
          </p>
        </div>

        <div className="relative z-10 mt-auto pointer-events-none">
           <h3 className="text-lg font-bold mb-2 text-white">System Solution Team</h3>
           <p className="text-slate-300 text-xs font-light leading-relaxed">Structural System Research Department<br/>Hyundai Maritime Research Institute</p>
        </div>
      </div>

      {/* 2. 우측 로그인 폼 */}
      <div className="flex-1 flex flex-col justify-center items-center p-10 bg-white shadow-xl relative z-50">
        <div className="absolute top-6 right-6 transition-all duration-500 ease-in-out">
          {isServerLive === true && !isVersionMismatch && (
            <div className="flex flex-col items-end space-y-1 animate-fade-in-down">
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-xs font-bold text-green-700 tracking-wide">Server v{serverVersion}</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono pr-1">{serverHost}</span>
            </div>
          )}
          {isServerLive === false && (
            <div className="flex flex-col items-end space-y-1">
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full shadow-sm">
                <WifiOff className="h-4 w-4 text-red-500" />
                <span className="text-xs font-bold text-red-600">Offline</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono pr-1">{serverHost}</span>
              {serverErrorReason && (
                <span className="text-[10px] text-red-400 font-medium pr-1">{serverErrorReason}</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setServerUrlInput(currentServerUrl);
                  setIsServerSettingsOpen(true);
                }}
                className="mt-1 inline-flex items-center gap-1 rounded-md text-[10px] font-bold text-slate-500 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30"
              >
                <Settings size={11} />
                연결 설정
              </button>
            </div>
          )}
          {isServerLive === null && (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full shadow-sm">
              <span className="animate-spin h-3 w-3 border-2 border-slate-300 border-t-slate-500 rounded-full"></span>
              <span className="text-xs text-slate-400 font-mono">{serverHost}</span>
            </div>
          )}
        </div>

        <div className="w-full max-w-md space-y-8">
          {isVersionMismatch ? (
            <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-8 text-center shadow-lg animate-pulse-slow">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mb-4">
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-red-700 mb-2">업데이트 필요</h2>
              <p className="text-sm text-red-600 mb-6 leading-relaxed">
                클라이언트 버전이 서버와 일치하지 않습니다.<br/>
                안정적인 서비스를 위해 업데이트가 필요합니다.
              </p>
              <div className="bg-white p-3 rounded-lg border border-red-100 text-xs text-slate-500 mb-6 font-mono">
                <div className="flex justify-between mb-1">
                  <span>Your Version:</span>
                  <span className="font-bold text-red-500">{CLIENT_VERSION}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1">
                  <span>Server Version:</span>
                  <span className="font-bold text-green-600">{serverVersion}</span>
                </div>
              </div>
              <button
                disabled={downloadState === 'downloading'}
                className="w-full flex items-center justify-center py-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors shadow-md"
                onClick={async () => {
                  const url = `${API_BASE_URL}/api/download/client`;
                  if (window.electron?.invoke) {
                    setDownloadState('downloading');
                    setDownloadProgress(0);
                    try {
                      await window.electron.invoke('download-client', url);
                    } catch {
                      setDownloadState('error');
                    }
                  } else {
                    window.location.href = url;
                  }
                }}
              >
                <DownloadCloud className="mr-2 h-5 w-5" />
                {downloadState === 'downloading'
                  ? `다운로드 중... ${downloadProgress}%`
                  : downloadState === 'done'
                  ? '다운로드 완료!'
                  : downloadState === 'error'
                  ? '다운로드 실패 — 재시도'
                  : '최신 버전 다운로드'}
              </button>
              {downloadState === 'downloading' && (
                <div className="w-full bg-red-100 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              )}
              {downloadState === 'done' && (
                <p className="text-xs text-green-600 text-center mt-2 font-medium">
                  다운로드 폴더에서 설치 파일을 실행하세요.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="text-center lg:text-left">
                <h2 className="whitespace-nowrap text-2xl sm:text-3xl font-bold text-slate-800">Hi-TESS Workbench Access</h2>
                <p className="mt-2 text-sm text-slate-500 font-medium">사번을 입력하여 접속하십시오.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {isServerLive === false && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-3">
                      <Server size={19} className="mt-0.5 shrink-0 text-red-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-red-800">서버 연결을 복구해야 로그인할 수 있습니다.</p>
                        <p className="mt-1 text-xs leading-relaxed text-red-700">
                          주소와 사내망 연결 상태를 확인한 뒤 재시도하세요. 현재 주소는{' '}
                          <span className="break-all font-mono font-semibold">{currentServerUrl}</span> 입니다.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            isLoading={isCheckingServer}
                            onClick={checkServerConnection}
                          >
                            <RefreshCw size={14} />
                            다시 연결
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setServerUrlInput(currentServerUrl);
                              setIsServerSettingsOpen(true);
                            }}
                          >
                            <Settings size={14} />
                            서버 주소 변경
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {errorMsg && (
                  <div className={`p-4 rounded-lg border flex items-start animate-pulse ${
                    errorMsg === "PENDING_APPROVAL"
                      ? "bg-yellow-50 border-yellow-200 text-yellow-700"
                      : errorMsg === "MAINTENANCE_MODE"
                      ? "bg-orange-50 border-orange-200 text-orange-700"
                      : "bg-red-50 border-red-200 text-red-600"
                  }`}>
                    {errorMsg === "PENDING_APPROVAL"
                      ? <Clock className="mr-3 h-5 w-5 flex-shrink-0" />
                      : errorMsg === "MAINTENANCE_MODE"
                      ? <Construction className="mr-3 h-5 w-5 flex-shrink-0" />
                      : <AlertCircle className="mr-3 h-5 w-5 flex-shrink-0" />}
                    <div className="flex-1">
                      {errorMsg === "PENDING_APPROVAL" ? (
                        <div>
                          <span className="font-bold block text-sm">승인 대기 중입니다.</span>
                          <span className="text-xs opacity-90">관리자 승인 후 접속 가능합니다.</span>
                        </div>
                      ) : errorMsg === "MAINTENANCE_MODE" ? (
                        <div>
                          <span className="font-bold block text-sm">시스템 점검 중입니다.</span>
                          <span className="text-xs opacity-90">현재 서버 점검으로 일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.</span>
                        </div>
                      ) : (
                        <span className="text-sm font-bold block">{errorMsg}</span>
                      )}

                      {errorMsg.includes("등록되지 않은") && (
                        <button type="button" onClick={() => setIsRegisterOpen(true)} className="mt-2 w-full py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded">
                          신규 회원가입 진행하기
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-brand-blue uppercase mb-2">사번 입력</label>
                    <div className="relative group z-10">
                      <User className="absolute left-3 top-3.5 h-5 w-5 text-slate-400 group-focus-within:text-brand-green transition-colors z-20" />
                      <input
                        type="text"
                        required
                        autoFocus 
                        className="block w-full pl-10 pr-3 py-4 border-2 border-slate-200 rounded-lg focus:border-brand-green focus:ring-0 outline-none transition-all text-slate-800 text-lg font-medium placeholder:text-base placeholder:font-normal relative z-10 bg-transparent"
                        placeholder="사번 입력"
                        value={employeeId}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || isServerLive !== true}
                  className={`w-full flex justify-center items-center py-4 px-4 text-sm font-bold rounded-lg text-white shadow-md transition-all transform hover:-translate-y-1 mt-4 cursor-pointer relative z-10 ${
                    isLoading || isServerLive !== true ? 'bg-gray-400 cursor-not-allowed hover:transform-none' : 'bg-brand-green hover:shadow-lg'
                  }`}
                >
                  {isLoading ? (
                    <span className="flex items-center"><span className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>Checking Info...</span>
                  ) : (
                    <span className="flex items-center text-base tracking-widest">ACCESS WORKBENCH <ArrowRight className="ml-2 h-5 w-5" /></span>
                  )}
                </button>
              </form>

              <div className="text-center text-sm text-slate-500">
                계정이 없으신가요? 
                <button onClick={() => setIsRegisterOpen(true)} className="ml-2 font-bold text-brand-blue hover:underline cursor-pointer">
                  신규 등록
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100 flex justify-center">
                <div className="flex items-center space-x-2 text-xs text-slate-400 font-medium">
                    <ShieldCheck size={14} /> <span>© 2026 Kwon Hyuk min . All rights reserved.</span>
                </div>
              </div>
            </>
          )}
        </div>
        
        <RegisterModal isOpen={isRegisterOpen} onClose={() => setIsRegisterOpen(false)} initialEmployeeId={employeeId} />
        <Modal
          isOpen={isServerSettingsOpen}
          onClose={() => setIsServerSettingsOpen(false)}
          title="로그인 서버 연결 설정"
          size="md"
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setServerUrlInput(DEFAULT_API_BASE_URL);
                  setServerSettingsError('');
                }}
              >
                기본 주소 복원
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="md" onClick={() => setIsServerSettingsOpen(false)}>
                  취소
                </Button>
                <Button type="button" variant="primary" size="md" onClick={applyServerUrl}>
                  저장 후 연결 확인
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 p-6">
            <p className="text-sm leading-relaxed text-slate-600">
              팀 공용 FastAPI 서버 주소를 입력하세요. 연결 확인이 성공하면 로그인 버튼이 활성화됩니다.
            </p>
            <Input
              label="서버 URL"
              value={serverUrlInput}
              onChange={(event) => {
                setServerUrlInput(event.target.value);
                setServerSettingsError('');
              }}
              placeholder="http://10.14.42.145:9091"
              error={serverSettingsError}
              className="font-mono"
              autoFocus
            />
          </div>
        </Modal>
      </div>
    </div>
  );
}
