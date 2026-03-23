/// <summary>
/// 관리자 전용 시스템 환경설정 및 라이브 모니터링 대시보드.
/// 백엔드 API와 연동하여 실제 CPU, Memory, DB Latency를 3초 주기로 가져옵니다.
/// </summary>
import React, { useState, useEffect } from 'react';
import { Settings, Server, HardDrive, Cpu, Activity, AlertTriangle, Power, Save } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../../config'; // (폴더 위치에 따라 '../../config' 일 수 있습니다. 에러나면 점 개수를 조절해주세요)

export default function SystemSettings() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  
  // ✅ 실제 서버 상태를 담을 State
  const [sysStats, setSysStats] = useState({
    cpu_usage: 0,
    memory_used_gb: 0,
    memory_total_gb: 0,
    db_status: "Checking...",
    latency_ms: 0
  });

  // ✅ 3초마다 서버 상태를 가져오는 (Polling) 로직
  useEffect(() => {
    const fetchSystemStatus = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/system/status`);
        setSysStats(response.data);
      } catch (error) {
        console.error("System status fetch error:", error);
        setSysStats(prev => ({
          ...prev,
          db_status: "Disconnected",
          latency_ms: 0
        }));
      }
    };

    fetchSystemStatus();
    const intervalId = setInterval(fetchSystemStatus, 3000);
    return () => clearInterval(intervalId);
  }, []);

  const memPercent = sysStats.memory_total_gb > 0 
    ? (sysStats.memory_used_gb / sysStats.memory_total_gb) * 100 
    : 0;

  return (
    <div className="max-w-7xl mx-auto pb-10 animate-fade-in-up">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#002554] flex items-center gap-3">
            <Settings className="text-slate-600" size={32} /> System Settings
          </h1>
          <p className="text-slate-500 mt-2">시스템 전역 환경 변수 및 실시간 서버 리소스를 모니터링합니다.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full text-xs font-bold shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Live Monitoring Active
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 1. 실시간 시스템 모니터링 패널 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
             <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
               <Activity size={18} className="text-blue-500"/> Server Resource Monitoring (Real-Time)
             </h3>
             <div className="grid grid-cols-3 gap-4">
                
                {/* CPU 정보 */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 transition-all">
                   <div className="flex items-center gap-2 text-slate-500 mb-2"><Cpu size={16}/> CPU Usage</div>
                   <div className="text-2xl font-extrabold text-slate-800">
                     {sysStats.cpu_usage}<span className="text-sm font-medium text-slate-500">%</span>
                   </div>
                   <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${sysStats.cpu_usage > 80 ? 'bg-red-500' : 'bg-blue-500'}`} 
                        style={{ width: `${sysStats.cpu_usage}%` }}
                      ></div>
                   </div>
                </div>

                {/* Memory 정보 */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 transition-all">
                   <div className="flex items-center gap-2 text-slate-500 mb-2"><HardDrive size={16}/> Memory</div>
                   <div className="text-2xl font-extrabold text-slate-800">
                     {sysStats.memory_used_gb}<span className="text-sm font-medium text-slate-500"> / {sysStats.memory_total_gb} GB</span>
                   </div>
                   <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${memPercent > 80 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                        style={{ width: `${memPercent}%` }}
                      ></div>
                   </div>
                </div>

                {/* DB 정보 */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 transition-all">
                   <div className="flex items-center gap-2 text-slate-500 mb-2"><Server size={16}/> DB Status</div>
                   <div className={`text-xl font-bold flex items-center gap-2 mt-1 ${sysStats.db_status === 'Connected' ? 'text-emerald-600' : 'text-red-600'}`}>
                     {sysStats.db_status === 'Connected' ? (
                       <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span>
                     ) : (
                       <span className="h-3 w-3 rounded-full bg-red-500"></span>
                     )}
                     {sysStats.db_status}
                   </div>
                   <p className="text-xs text-slate-400 mt-2 font-mono">
                     Latency: <span className={sysStats.latency_ms > 100 ? 'text-red-400 font-bold' : 'text-slate-600'}>{sysStats.latency_ms}ms</span>
                   </p>
                </div>
             </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
             <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-2">
               <AlertTriangle size={18} className="text-orange-500"/> Danger Zone
             </h3>
             <div className="flex items-center justify-between bg-red-50 border border-red-100 p-4 rounded-xl">
               <div>
                 <h4 className="font-bold text-red-700">시스템 점검 모드 (Maintenance Mode)</h4>
                 <p className="text-xs text-red-600 mt-1">활성화 시, 관리자를 제외한 일반 사용자의 로그인이 즉시 차단됩니다.</p>
               </div>
               <button 
                 onClick={() => setMaintenanceMode(!maintenanceMode)}
                 className={`px-4 py-2 font-bold text-sm rounded-lg flex items-center gap-2 transition-colors cursor-pointer ${maintenanceMode ? 'bg-red-600 text-white shadow-md' : 'bg-white text-red-600 border border-red-200 hover:bg-red-100'}`}
               >
                 <Power size={16}/> {maintenanceMode ? '점검 모드 해제' : '점검 모드 켜기'}
               </button>
             </div>
          </div>
        </div>

        {/* 2. 전역 설정 패널 */}
        <div className="space-y-6">
          <div className="bg-[#002554] rounded-2xl shadow-sm p-6 text-white">
             <h3 className="text-sm font-bold text-blue-200 uppercase tracking-wider mb-4">Master Data Config</h3>
             <p className="text-xs text-blue-100/70 mb-6 leading-relaxed">
               회원가입 창 등에 노출되는 공통 부서 목록(Department)이나 직급 체계를 관리합니다. (추후 DB 연동 예정)
             </p>
             
             <div className="space-y-3">
               <label className="text-xs font-bold text-blue-300">기본 부서 목록 관리 (JSON)</label>
               <textarea 
                 className="w-full h-40 bg-[#001b3d] border border-blue-800 rounded-lg p-3 text-xs font-mono text-emerald-400 outline-none focus:border-emerald-500 resize-none"
                 defaultValue={'[\n  "구조시스템연구실",\n  "선장설계부",\n  "선체설계부",\n  "기장설계부"\n]'}
               />
             </div>
             
             <button className="w-full mt-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-lg flex justify-center items-center gap-2 transition-colors cursor-pointer">
               <Save size={16}/> 설정 저장
             </button>
          </div>
        </div>

      </div>
    </div>
  );
}