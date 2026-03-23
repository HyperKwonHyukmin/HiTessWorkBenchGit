import React, { useState, useEffect } from 'react';
import { User, ArrowRight, ShieldCheck, AlertCircle, Clock, Wifi, WifiOff, DownloadCloud, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import logoCI from '../assets/images/HHI_white2_ko.png';
import RegisterModal from '../components/RegisterModal';
import { API_BASE_URL } from '../config'; 

// ==========================================
// [설정] 클라이언트 버전
// ==========================================
const CLIENT_VERSION = "1.0.0"; 
const structureBgUrl = "https://images.unsplash.com/photo-1553653841-453082536a9d?q=80&w=1000&auto=format&fit=crop";

export default function LoginScreen({ onLoginSuccess }) {
  const [employeeId, setEmployeeId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // 상태 관리
  const [isServerLive, setIsServerLive] = useState(null); 
  const [isVersionMismatch, setIsVersionMismatch] = useState(false); 
  const [serverVersion, setServerVersion] = useState(''); 
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  // [초기화] 서버 상태 및 버전 체크
  useEffect(() => {
    const initCheck = async () => {
      try {
        // [수정 포인트 1] 작은따옴표(') 대신 백틱(`) 사용
        const response = await axios.get(`${API_BASE_URL}/api/version`); // <--- 여기!
        
        const fetchedServerVersion = response.data.version;
        setServerVersion(fetchedServerVersion);
        setIsServerLive(true);

        if (fetchedServerVersion !== CLIENT_VERSION) {
          console.warn(`Version Mismatch! Client: ${CLIENT_VERSION}, Server: ${fetchedServerVersion}`);
          setIsVersionMismatch(true); 
        } else {
          setIsVersionMismatch(false);
        }

      } catch (error) {
        console.error("Server Check Failed:", error);
        setIsServerLive(false);
      }
    };

    initCheck();

    const savedId = localStorage.getItem('savedEmployeeId');
    if (savedId) setEmployeeId(savedId);

  }, []);

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
      // [수정 포인트 2] 작은따옴표(') 대신 백틱(`) 사용
      const response = await axios.post(`${API_BASE_URL}/api/login`, { // <--- 여기!
        employee_id: employeeId
      });

      console.log('Login Success:', response.data);
      localStorage.setItem('user', JSON.stringify(response.data));
      onLoginSuccess(); 

    } catch (error) {
      console.error('Login Error:', error);
      
      if (!error.response) {
         setIsServerLive(false);
         setErrorMsg("서버 응답이 없습니다.");
      } else {
        if (error.response.status === 404) {
          setErrorMsg("등록되지 않은 사번입니다.");
        } 
        else if (error.response.status === 403) {
          setErrorMsg("PENDING_APPROVAL"); 
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
      <div className="hidden lg:flex w-1/3 relative flex-col p-12 text-white overflow-hidden" style={{ backgroundColor: '#002554' }}>
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img src={structureBgUrl} alt="Structure" className="w-full h-full object-cover opacity-50 mix-blend-overlay grayscale contrast-125 transform scale-105" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#002554]/90 via-[#002554]/40 to-[#002554]/90"></div>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center pointer-events-none">
           <div className="mb-8">
             <img src={logoCI} alt="HD Hyundai CI" className="h-10 w-auto object-contain" />
           </div>
           <h1 className="text-4xl font-extrabold leading-tight text-white drop-shadow-md">
            HiTESS <br/> <span style={{ color: '#00E600' }}>WorkBench</span>
          </h1>
          <div className="h-1.5 w-20 bg-[#008233] mt-8 rounded-full"></div>
          <p className="mt-4 text-xs text-blue-200 opacity-60 font-mono">
            Client v{CLIENT_VERSION}
          </p>
        </div>

        <div className="relative z-10 mt-auto pointer-events-none">
           <h3 className="text-lg font-bold mb-2 text-white">System Solution Team</h3>
           <p className="text-gray-300 text-xs font-light leading-relaxed">Structural System Research Department<br/>Hyundai Maritime Research Institute</p>
        </div>
      </div>

      {/* 2. 우측 로그인 폼 */}
      <div className="flex-1 flex flex-col justify-center items-center p-10 bg-white shadow-xl relative z-50">
        <div className="absolute top-6 right-6 transition-all duration-500 ease-in-out">
          {isServerLive === true && !isVersionMismatch && (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full shadow-sm animate-fade-in-down">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-bold text-green-700 tracking-wide">Server v{serverVersion}</span>
            </div>
          )}
          {isServerLive === false && (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full shadow-sm">
              <WifiOff className="h-4 w-4 text-red-500" />
              <span className="text-xs font-bold text-red-600">Offline</span>
            </div>
          )}
        </div>

        <div className="w-full max-w-sm space-y-8">
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
              <div className="bg-white p-3 rounded-lg border border-red-100 text-xs text-gray-500 mb-6 font-mono">
                <div className="flex justify-between mb-1">
                  <span>Your Version:</span>
                  <span className="font-bold text-red-500">{CLIENT_VERSION}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1">
                  <span>Server Version:</span>
                  <span className="font-bold text-green-600">{serverVersion}</span>
                </div>
              </div>
              <button 
                className="w-full flex items-center justify-center py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors shadow-md"
                onClick={() => alert("사내 포털에서 최신 설치 파일을 다운로드 해주세요.")}
              >
                <DownloadCloud className="mr-2 h-5 w-5" />
                최신 버전 다운로드
              </button>
            </div>
          ) : (
            <>
              <div className="text-center lg:text-left">
                <h2 className="text-3xl font-bold text-slate-800">Hi-TESS Access</h2>
                <p className="mt-2 text-sm text-gray-500 font-medium">사번을 입력하여 접속하십시오.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {errorMsg && (
                  <div className={`p-4 rounded-lg border flex items-start animate-pulse ${
                    errorMsg === "PENDING_APPROVAL" 
                      ? "bg-yellow-50 border-yellow-200 text-yellow-700" 
                      : "bg-red-50 border-red-200 text-red-600"
                  }`}>
                    {errorMsg === "PENDING_APPROVAL" ? <Clock className="mr-3 h-5 w-5 flex-shrink-0" /> : <AlertCircle className="mr-3 h-5 w-5 flex-shrink-0" />}
                    <div className="flex-1">
                      {errorMsg === "PENDING_APPROVAL" ? (
                        <div>
                          <span className="font-bold block text-sm">승인 대기 중입니다.</span>
                          <span className="text-xs opacity-90">관리자 승인 후 접속 가능합니다.</span>
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
                    <label className="block text-xs font-bold text-[#003087] uppercase mb-2">Employee ID</label>
                    <div className="relative group z-10">
                      <User className="absolute left-3 top-3.5 h-5 w-5 text-gray-400 group-focus-within:text-[#008233] transition-colors z-20" />
                      <input
                        type="text"
                        required
                        autoFocus 
                        className="block w-full pl-10 pr-3 py-4 border-2 border-gray-200 rounded-lg focus:border-[#008233] focus:ring-0 outline-none transition-all text-slate-800 text-lg font-medium placeholder:text-base placeholder:font-normal relative z-10 bg-transparent"
                        placeholder="사번 입력"
                        value={employeeId}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || isServerLive === false}
                  className={`w-full flex justify-center items-center py-4 px-4 text-sm font-bold rounded-lg text-white shadow-md transition-all transform hover:-translate-y-1 mt-4 cursor-pointer relative z-10 ${
                    isLoading || isServerLive === false ? 'bg-gray-400 cursor-not-allowed hover:transform-none' : 'bg-[#008233] hover:shadow-lg'
                  }`}
                >
                  {isLoading ? (
                    <span className="flex items-center"><span className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>Checking Info...</span>
                  ) : (
                    <span className="flex items-center text-base tracking-widest">ACCESS WORKBENCH <ArrowRight className="ml-2 h-5 w-5" /></span>
                  )}
                </button>
              </form>

              <div className="text-center text-sm text-gray-500">
                계정이 없으신가요? 
                <button onClick={() => setIsRegisterOpen(true)} className="ml-2 font-bold text-[#003087] hover:underline cursor-pointer">
                  신규 등록
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-100 flex justify-center">
                <div className="flex items-center space-x-2 text-xs text-gray-400 font-medium">
                    <ShieldCheck size={14} /> <span>© 2026 Kwon Hyuk min . All rights reserved.</span>
                </div>
              </div>
            </>
          )}
        </div>
        
        <RegisterModal isOpen={isRegisterOpen} onClose={() => setIsRegisterOpen(false)} initialEmployeeId={employeeId} />
      </div>
    </div>
  );
}