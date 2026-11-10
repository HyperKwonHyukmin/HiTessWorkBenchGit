import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, KeyRound, ArrowRight, ShieldCheck, AlertCircle, Clock, WifiOff, DownloadCloud, AlertTriangle, Construction, RefreshCw, Settings, Server, Laptop } from 'lucide-react';
import RegisterModal from '../../components/modals/RegisterModal';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { checkVersion, getLoginOptions, login, windowsLogin, getDeviceInfo, enrollDevice, deviceLogin, forgetDevice, verifyDeviceCode, resendDeviceCode } from '../../api/auth';
import { isDeviceMode, deviceErrorState, DEVICE_STATE_TEXT, EMAIL_CODE_MESSAGES, cleanEmailCode } from '../../utils/deviceLogin';
import { SAVED_EMPLOYEE_ID_KEY, WINDOWS_AUTO_LOGIN_OFF_KEY, useAuth } from '../../contexts/AuthContext';
import { API_BASE_URL, DEFAULT_API_BASE_URL, setApiBaseUrl } from '../../config';
import { MANUAL_SERVER_URL_KEY, fixPlainHttpsPort } from '../../utils/secureServerUrl';
import { version as CLIENT_VERSION } from '../../../package.json';
import { isServerVersionNewer } from '../../utils/versionCompare';
// 서버 ad_auth.AdResult 값 → 화면 문구. 사번이 맞는지 틀렸는지는 따로 알려 주지 않는다.
const AD_LOGIN_MESSAGES = {
  password_required: '회사 PC 로그인 비밀번호를 입력하세요.',
  invalid_credentials: '사번 또는 비밀번호가 맞지 않습니다.',
  account_locked: '회사 계정이 잠겼습니다. IT 지원팀에 잠금 해제를 요청하세요.',
  password_expired: '회사 PC 비밀번호가 만료되었습니다. Windows 에서 비밀번호를 바꾼 뒤 다시 로그인하세요.',
  account_disabled: '사용할 수 없는 회사 계정입니다. IT 지원팀에 문의하세요.',
  too_many_attempts: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도하세요.',
  auth_unavailable: '사내 계정 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.',
  // Windows 계정 로그인(/api/login/windows)이 안 될 때 — 비밀번호 칸을 연다
  windows_auth_failed: 'Windows 계정으로 확인하지 못했습니다. 비밀번호를 입력하세요.',
  windows_account_not_employee: '이 PC 의 Windows 계정이 사번 계정이 아닙니다. 비밀번호를 입력하세요.',
  windows_account_mismatch: '입력한 사번이 이 PC 의 Windows 계정과 다릅니다. 비밀번호를 입력하세요.',
};

const isAutoLoginOff = () => {
  try { return sessionStorage.getItem(WINDOWS_AUTO_LOGIN_OFF_KEY) === '1'; } catch { return false; }
};

const structureBgUrl ="https://images.unsplash.com/photo-1553653841-453082536a9d?q=80&w=1000&auto=format&fit=crop";

export default function LoginScreen({ onLoginSuccess }) {
  const { login: authLogin } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  // AD 모드일 때만 쓰는 회사 PC 비밀번호. 저장하지 않고 로그인이 끝나면 비운다.
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('employee_id');
  // 서버가 회사 PC 계정 자동 로그인을 받고, 이 앱(Electron)이 부를 수 있을 때만 true
  const [windowsLoginAvailable, setWindowsLoginAvailable] = useState(false);
  const [isWindowsLoading, setIsWindowsLoading] = useState(false);
  // Windows 계정 확인이 안 됐을 때만 비밀번호 칸을 보인다
  const [needPassword, setNeedPassword] = useState(false);
  // 등록한 PC 로그인(회사 도메인에 없는 계열사 PC, 2026-11-10) — 이 PC 는 비밀번호 칸을 보이지 않는다(사용자 결정)
  const [serverDeviceLogin, setServerDeviceLogin] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [deviceState, setDeviceState] = useState(null); // { state, code, verify, emailHint }
  const [emailCode, setEmailCode] = useState('');           // 회사 메일로 받은 6자리
  const deviceMode = isDeviceMode({ authMode, serverDeviceLogin, deviceInfo });
  const autoDeviceTried = useRef(false);
  // 메일 코드 방식 대기 중인가 · 지금 보일 안내 문구
  const emailPending = deviceState?.state === 'pending' && deviceState?.verify === 'email';
  const deviceText = deviceState ? DEVICE_STATE_TEXT[emailPending ? 'pendingEmail' : deviceState.state] : null;
  const deviceBusy = useRef(false); // 등록한 PC 로그인 한 번에 하나만(수동 시도와 15초 재확인이 겹치지 않게)
  const showPassword = authMode === 'ad' && !deviceMode && (!windowsLoginAvailable || needPassword);
  const autoWindowsTried = useRef(false);
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
      // 서버가 더 높을 때만 로그인을 막는다(App.jsx 업데이트 안내와 같은 규칙).
      const needsUpdate = isServerVersionNewer(fetchedServerVersion, CLIENT_VERSION);
      setIsVersionMismatch(needsUpdate);
      if (needsUpdate) {
        console.warn(`Version Mismatch! Client: ${CLIENT_VERSION}, Server: ${fetchedServerVersion}`);
      }
      const options = await getLoginOptions();
      const info = options.deviceLogin ? await getDeviceInfo() : null;
      const onDevicePc = isDeviceMode({ authMode: options.authMode, serverDeviceLogin: options.deviceLogin, deviceInfo: info });
      setAuthMode(options.authMode);
      setServerDeviceLogin(options.deviceLogin);
      setDeviceInfo(info);
      // 도메인에 없는 PC 는 Windows 자동 로그인이 될 수 없다 — 시도하지 않는다(서버에 실패 기록만 쌓인다)
      setWindowsLoginAvailable(options.windowsLogin && !!window.electron?.invoke && !onDevicePc);
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
    const candidate = fixPlainHttpsPort(serverUrlInput);
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    } catch {
      setServerSettingsError('http:// 또는 https://로 시작하는 올바른 서버 URL을 입력하세요.');
      return;
    }
    setServerSettingsError('');
    setApiBaseUrl(candidate);
    // 직접 넣은 주소는 시작 때 HTTPS 로 바꾸지 않는다(145 HTTPS 장애 때 평문으로 되돌리는 비상구)
    try { localStorage.setItem(MANUAL_SERVER_URL_KEY, '1'); } catch { /* 무시 */ }
    setCurrentServerUrl(candidate);
    setIsServerSettingsOpen(false);
    setIsServerLive(null);
    await checkServerConnection();
  };

  // [초기화] 서버 상태 및 버전 체크
  useEffect(() => {
    checkServerConnection();

    const savedId = localStorage.getItem(SAVED_EMPLOYEE_ID_KEY);
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
    setDeviceState(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isVersionMismatch) return;

    // 메일 코드를 넣고 ACCESS 를 누른 경우 — 코드 확인부터
    if (deviceMode && emailPending && emailCode.length === 6) {
      await handleDeviceVerify();
      return;
    }
    // 회사 도메인에 없는 PC(계열사) — 등록한 PC 열쇠로만 들어온다(비밀번호를 묻지 않는다)
    if (deviceMode) {
      await handleDeviceLogin({ expectedId: employeeId });
      return;
    }

    // 비밀번호 칸이 아직 없으면 먼저 Windows 계정으로 확인한다 — 안 되면 그때 비밀번호 칸을 연다.
    if (windowsLoginAvailable && !needPassword) {
      await handleWindowsLogin({ expectedId: employeeId });
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const response = await login(employeeId, authMode === 'ad' ? password : undefined);
      setPassword('');
      finishLogin(response.data);
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
        showLoginError(error.response.status, error.response.data?.detail);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // AuthContext 가 localStorage 4개 키 (user/session_token/user_login_at/user_last_active)
  // 일괄 세팅 + state 갱신을 캡슐화한다.
  const finishLogin = (data) => {
    const { token, ...userObj } = data;
    authLogin(userObj, token);
    localStorage.setItem(SAVED_EMPLOYEE_ID_KEY, userObj.employee_id || employeeId.trim());
    onLoginSuccess();
  };

  const showLoginError = (status, detail) => {
    if (status === 401 || status === 429 || status === 502) {
      setPassword('');
      // 방식 조회(/api/login/options)가 순간 실패해 칸이 숨었어도 서버가 비밀번호를 요구하면 칸을 연다.
      if (detail === 'password_required') setAuthMode('ad');
      setErrorMsg(AD_LOGIN_MESSAGES[detail] || `로그인 오류: ${status}`);
    } else if (status === 404) {
      setErrorMsg("등록되지 않은 사번입니다.");
    } else if (status === 403) {
      setErrorMsg("PENDING_APPROVAL");
    } else if (status === 503) {
      setErrorMsg("MAINTENANCE_MODE");
    } else {
      setErrorMsg(`로그인 오류: ${status}`);
    }
  };

  // Windows 계정으로 로그인(서버 /api/login/windows). 입력(또는 저장)된 사번과 Windows 계정이 같을 때만 들어간다.
  // auto = 화면이 뜰 때 한 번 저절로 — 안 되면 조용히 넘긴다(사용자가 ACCESS 를 누르면 다시 시도).
  // 직접 누른 시도가 안 되면 비밀번호 칸을 연다.
  const handleWindowsLogin = async ({ auto = false, expectedId = '' } = {}) => {
    if (isVersionMismatch || isWindowsLoading) return;
    setIsWindowsLoading(true);
    if (!auto) setErrorMsg('');
    const askPassword = (message) => {
      if (auto) return;
      setNeedPassword(true);
      setErrorMsg(message);
    };
    const target = String(expectedId || '').trim().toUpperCase();
    try {
      // 사번을 같이 보낸다 — 서버가 Windows 계정과 다르면 세션을 만들기 전에 거절한다(windows_account_mismatch)
      const result = await windowsLogin(target);
      console.info('[windows-login] 결과', { auto, status: result?.status, detail: result?.detail, ok: result?.ok });
      // 옛 exe·브라우저·서버에서 꺼짐·사내 주소 아님 → 비밀번호 칸
      if (!result || ['windows_login_disabled', 'invalid_server_url', 'forbidden'].includes(result.detail)) {
        setWindowsLoginAvailable(false);
        return;
      }
      if (result.ok) {
        const who = String(result.data.employee_id || '').toUpperCase();
        if (target && who !== target) { // 서버가 대조하지만 옛 서버에 대비해 한 번 더
          askPassword(AD_LOGIN_MESSAGES.windows_account_mismatch);
          return;
        }
        finishLogin(result.data);
        return;
      }
      // 자동 시도는 성공이 아니면 조용히 둔다 — 저장된 사번이 없을 때 서버의 미가입·승인 대기는
      // 이 PC 의 Windows 계정 이야기라 화면에 띄우면 엉뚱한 사람 결과로 보인다.
      if (auto) return;
      if (result.status === 0) { askPassword('Windows 계정 확인이 늦어지고 있습니다. 비밀번호를 입력하세요.'); return; }
      if (['windows_auth_failed', 'windows_account_not_employee', 'windows_account_mismatch'].includes(result.detail)) {
        askPassword(AD_LOGIN_MESSAGES[result.detail]);
        return;
      }
      // 여기 오는 404·403·503 은 입력한 사번 본인의 결과다(서버가 사번 대조를 통과시킨 뒤라서)
      showLoginError(result.status, result.detail);
    } finally {
      setIsWindowsLoading(false);
    }
  };

  // 대기 화면 상태 — 메일 코드 방식이면 코드 입력 칸, 관리자 방식이면 확인 코드 표시
  const pendingState = (r) => ({
    state: 'pending',
    verify: r?.verify === 'email' ? 'email' : 'admin',
    emailHint: r?.emailHint || '',
    code: r?.code || '',
  });

  // 등록한 PC 로 로그인. auto = 화면이 뜰 때 한 번(실패해도 조용히), quiet = 승인 대기 중 15초마다 다시 확인.
  const handleDeviceLogin = async ({ expectedId = '', auto = false, quiet = false } = {}) => {
    const target = String(expectedId || '').trim().toUpperCase();
    if (!/^[A-Z]\d{5,7}$/.test(target)) {
      if (!auto && !quiet) setErrorMsg('사번을 바르게 입력하세요.');
      return;
    }
    if (deviceBusy.current) return;
    deviceBusy.current = true;
    if (!quiet) { setIsLoading(true); setErrorMsg(''); }
    try {
      const result = await deviceLogin(target);
      if (result.ok) {
        setDeviceState(null);
        finishLogin(result.data);
        return;
      }
      if (!result.registered) {
        if (!auto) setDeviceState({ state: 'unregistered' });
        return;
      }
      const mapped = deviceErrorState(result.status, result.detail);
      if (mapped.forget) await forgetDevice(target);
      if (mapped.state === 'pending') {
        if (quiet) return; // 이미 대기 화면이다
        // 확인 방법·코드는 같은 열쇠로 다시 요청해 받는다(서버가 같은 기기를 돌려주고 메일은 다시 보내지 않는다)
        const enrolled = await enrollDevice(target, deviceInfo);
        setDeviceState(pendingState(enrolled));
        return;
      }
      if (mapped.state === 'disabled') { setServerDeviceLogin(false); return; }
      if (mapped.state === 'error') {
        if (auto || quiet) return;
        if (result.status === 0) setErrorMsg('서버 응답이 없습니다. 잠시 뒤 다시 시도하세요.');
        else showLoginError(result.status, result.detail);
        return;
      }
      if (auto && mapped.state === 'unregistered') return;
      setDeviceState({ state: mapped.state });
    } finally {
      deviceBusy.current = false;
      if (!quiet) setIsLoading(false);
    }
  };

  // 이 PC 등록 요청 — 관리자가 화면의 확인 코드를 직원에게 물어 같을 때만 승인한다.
  const handleDeviceEnroll = async () => {
    const target = employeeId.trim().toUpperCase();
    if (!/^[A-Z]\d{5,7}$/.test(target)) { setErrorMsg('사번을 먼저 바르게 입력하세요.'); return; }
    setIsLoading(true);
    setErrorMsg('');
    let approved = false;
    try {
      let result = await enrollDevice(target, deviceInfo);
      // 해지·거절된 열쇠였다 — enrollDevice 가 열쇠를 버렸으니 새 열쇠로 한 번 더
      if (!result.ok && result.status === 409) result = await enrollDevice(target, deviceInfo);
      if (result.ok) {
        if (result.status === 'approved') approved = true;
        else {
          setEmailCode('');
          setDeviceState(pendingState(result));
          if (result.mailFailed) setErrorMsg('회사 메일 발송에 실패해 관리자 승인으로 바뀌었습니다.');
        }
        return;
      }
      if (result.status === 429) {
        setErrorMsg(result.detail === 'too_many_pending'
          ? '승인을 기다리는 요청이 이미 여럿 있습니다. 관리자에게 문의하세요.'
          : '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.');
      } else if (result.status === 0) {
        setErrorMsg(result.detail === 'unavailable'
          ? '이 PC 에서는 등록 열쇠를 안전하게 저장할 수 없습니다. 관리자에게 문의하세요.'
          : '서버 응답이 없습니다. 잠시 뒤 다시 시도하세요.');
      } else {
        showLoginError(result.status, result.detail);
      }
    } finally {
      setIsLoading(false);
    }
    if (approved) await handleDeviceLogin({ expectedId: target });
  };

  // 메일로 받은 코드 확인 → 승인되면 바로 로그인
  const handleDeviceVerify = async () => {
    const target = employeeId.trim().toUpperCase();
    const code = cleanEmailCode(emailCode);
    if (code.length !== 6) { setErrorMsg('메일의 6자리 코드를 입력하세요.'); return; }
    setIsLoading(true);
    setErrorMsg('');
    let approved = false;
    try {
      const result = await verifyDeviceCode(target, code);
      if (result.ok || result.detail === 'device_approved') approved = true;
      else if (result.status === 0) setErrorMsg('서버 응답이 없습니다. 잠시 뒤 다시 시도하세요.');
      else if (result.detail === 'challenge_stale') setErrorMsg('잠시 뒤 다시 눌러 주세요.');
      else setErrorMsg(EMAIL_CODE_MESSAGES[result.detail] || `확인하지 못했습니다(${result.detail || result.status}).`);
    } finally {
      setIsLoading(false);
    }
    if (approved) { setEmailCode(''); await handleDeviceLogin({ expectedId: target }); }
  };

  const handleDeviceResend = async () => {
    const target = employeeId.trim().toUpperCase();
    setIsLoading(true);
    setErrorMsg('');
    try {
      const result = await resendDeviceCode(target);
      if (result.ok) {
        setEmailCode('');
        setDeviceState(pendingState({
          verify: result.data.verify, emailHint: result.data.email_hint, code: result.data.confirm_code,
        }));
        setErrorMsg(result.data.mail_failed
          ? '회사 메일 발송에 실패해 관리자 승인으로 바뀌었습니다.'
          : '');
      } else if (result.status === 0) {
        setErrorMsg('서버 응답이 없습니다. 잠시 뒤 다시 시도하세요.');
      } else {
        setErrorMsg(EMAIL_CODE_MESSAGES[result.detail] || `보내지 못했습니다(${result.detail || result.status}).`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 관리자 승인 대기 중이면 15초마다 다시 확인 — 승인되면 저절로 들어간다(메일 코드 방식은 직원이 직접 입력)
  useEffect(() => {
    if (deviceState?.state !== 'pending' || deviceState?.verify === 'email') return undefined;
    const target = employeeId.trim().toUpperCase();
    const timer = setInterval(() => { handleDeviceLogin({ expectedId: target, quiet: true }); }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceState?.state, deviceState?.verify, employeeId]);

  // 등록한 PC 는 화면이 뜨면 저장된 사번으로 한 번 자동 로그인(직접 로그아웃한 뒤에는 하지 않는다)
  useEffect(() => {
    if (!deviceMode || isServerLive !== true || isVersionMismatch) return;
    if (autoDeviceTried.current || isAutoLoginOff()) return;
    autoDeviceTried.current = true;
    const saved = localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '';
    if (saved) handleDeviceLogin({ auto: true, expectedId: saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceMode, isServerLive, isVersionMismatch]);

  // 화면이 뜨면 한 번 자동 시도 — 직접 로그아웃한 뒤에는 하지 않는다(다른 계정으로 바꿀 수 있게).
  // 저장된 사번이 있으면 그 사번일 때만 들어간다(공용 PC 에서 다른 사람으로 들어가지 않게).
  useEffect(() => {
    if (!windowsLoginAvailable || isServerLive !== true || isVersionMismatch) return;
    if (autoWindowsTried.current || isAutoLoginOff()) return;
    autoWindowsTried.current = true;
    handleWindowsLogin({ auto: true, expectedId: localStorage.getItem(SAVED_EMPLOYEE_ID_KEY) || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowsLoginAvailable, isServerLive, isVersionMismatch]);

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
                <p className="mt-2 text-sm text-slate-500 font-medium">
                  {showPassword ? '사번과 회사 PC 로그인 비밀번호를 입력하십시오.' : '사번을 입력하여 접속하십시오.'}
                </p>
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

                {deviceMode && deviceText && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" role="status">
                    <div className="flex items-start gap-3">
                      <Laptop size={19} className="mt-0.5 shrink-0 text-brand-blue" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800">{deviceText.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {deviceText.body}
                          {emailPending && deviceState.emailHint ? ` (받는 메일: ${deviceState.emailHint})` : ''}
                        </p>
                        {emailPending && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              aria-label="메일로 받은 6자리 코드"
                              placeholder="6자리 코드"
                              value={emailCode}
                              onChange={(e) => setEmailCode(cleanEmailCode(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                if (e.key === 'Enter') { e.preventDefault(); handleDeviceVerify(); }
                              }}
                              disabled={isLoading}
                              className="w-36 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 font-mono text-lg tracking-[0.3em] text-slate-800 outline-none focus:border-brand-green"
                            />
                            <Button type="button" variant="primary" size="sm" isLoading={isLoading}
                              disabled={emailCode.length !== 6} onClick={handleDeviceVerify}>
                              확인
                            </Button>
                            <button type="button" onClick={handleDeviceResend} disabled={isLoading}
                              className="text-xs font-bold text-brand-blue hover:underline disabled:cursor-wait disabled:opacity-60">
                              코드 다시 보내기
                            </button>
                          </div>
                        )}
                        {deviceState.state === 'pending' && !emailPending && deviceState.code && (
                          <p className="mt-3 font-mono text-2xl font-bold tracking-widest text-brand-blue">{deviceState.code}</p>
                        )}
                        {deviceState.state === 'pending' && (
                          <p className="mt-2 text-[11px] text-slate-500">
                            PC 이름 {deviceInfo?.hostname || '-'}
                            {emailPending ? ' · 메일이 안 보이면 스팸함도 확인하세요.' : ' · 15초마다 승인 여부를 확인합니다.'}
                          </p>
                        )}
                        {emailPending && deviceState.code && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            메일이 끝내 오지 않으면 WorkBench 관리자에게 이 확인 코드를 알려 주세요: <span className="font-mono font-bold text-slate-700">{deviceState.code}</span>
                          </p>
                        )}
                        {deviceText.action && (
                          <div className="mt-3">
                            <Button type="button" variant="primary" size="sm" isLoading={isLoading} onClick={handleDeviceEnroll}>
                              {deviceText.action}
                            </Button>
                          </div>
                        )}
                      </div>
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
                  {showPassword && (
                    <div>
                      <label htmlFor="login-password" className="block text-xs font-bold text-brand-blue uppercase mb-2">비밀번호</label>
                      <div className="relative group z-10">
                        <KeyRound className="absolute left-3 top-3.5 h-5 w-5 text-slate-400 group-focus-within:text-brand-green transition-colors z-20" />
                        <input
                          id="login-password"
                          type="password"
                          required
                          autoComplete="current-password"
                          className="block w-full pl-10 pr-3 py-4 border-2 border-slate-200 rounded-lg focus:border-brand-green focus:ring-0 outline-none transition-all text-slate-800 text-lg font-medium placeholder:text-base placeholder:font-normal relative z-10 bg-transparent"
                          placeholder="회사 PC 로그인 비밀번호"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">회사 Windows 로그인과 같은 비밀번호입니다. WorkBench 는 비밀번호를 저장하지 않습니다.</p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading || isWindowsLoading || isServerLive !== true}
                  className={`w-full flex justify-center items-center py-4 px-4 text-sm font-bold rounded-lg text-white shadow-md transition-all transform hover:-translate-y-1 mt-4 cursor-pointer relative z-10 ${
                    isLoading || isWindowsLoading || isServerLive !== true ? 'bg-gray-400 cursor-not-allowed hover:transform-none' : 'bg-brand-green hover:shadow-lg'
                  }`}
                >
                  {isLoading || isWindowsLoading ? (
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
              placeholder="https://10.14.42.145:9091"
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
