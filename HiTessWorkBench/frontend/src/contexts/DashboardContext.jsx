/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (신규) 백그라운드 해석 작업을 추적하고 플로팅 위젯을 제공합니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext } from 'react';
import { Layers, Ruler, Ship, Activity, ShieldCheck, Box, Square, FileText, BarChart2, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { API_BASE_URL } from '../config'; 

export const ANALYSIS_DATA = [
  { mode: "File", category: "트러스(Truss)", title: "Truss Model Builder", description: "Truss 설계 정보를 활용하여 구조 해석 모델을 구축합니다.", icon: Layers, color: "bg-cyan-600", tags: ["트러스", "모델생성", "CSV"], devStatus: "Active" },
  { mode: "File", category: "트러스(Truss)", title: "Truss Structural Assessment", description: "Truss BDF 모델을 업로드하여 구조적 안정성을 평가합니다.", icon: Layers, color: "bg-cyan-600", tags: ["트러스", "구조평가", "BDF"], devStatus: "Active" },
  { mode: "File", category: "권상(Lifting)", title: "Group & Unit 권상 구조 해석", description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.", icon: Layers, color: "bg-emerald-600", tags: ["유닛", "블록", "국부강도"], devStatus: "Developing" },
  { mode: "File", category: "배관(Pipe)", title: "Pipe 구조 해석", description: "배관 시스템의 지지대 및 진동에 대한 전반적인 구조 해석을 수행합니다.", icon: Activity, color: "bg-indigo-600", tags: ["배관", "파운데이션", "진동"], devStatus: "Planned" },
  { mode: "File", category: "전선해석", title: "Whole Ship Analysis", description: "선박 전체 모델에 대한 전역 강도 및 항해 조건별 응답을 통합 해석합니다.", icon: Ship, color: "bg-slate-800", tags: ["전선해석", "선체보", "전체모델"], devStatus: "Planned" },
  { mode: "File", category: "기타", title: "구조 최적화 (Optimization)", description: "중량 절감 및 구조 효율성 극대화를 위한 AI 기반 최적화 프로세스를 진행합니다.", icon: ShieldCheck, color: "bg-orange-600", tags: ["중량절감", "위상최적화", "민감도"], devStatus: "Planned" },
  { mode: "File", category: "1D 빔(Beam)", title: "Beam Result Viewer", description: "Simple Beam 해석 결과(JSON/CSV) 파일을 업로드하여 처짐, 모멘트, 전단력, 응력 분포를 시각화합니다.", icon: BarChart2, color: "bg-blue-500", tags: ["1D요소", "결과시각화", "차트"], devStatus: "Active" },
  { mode: "Interactive", category: "1D 빔(Beam)", title: "Simple Beam Assessment", description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 변위을 평가합니다.", icon: Ruler, color: "bg-cyan-600", tags: ["1D요소", "굽힘응력", "실시간"], devStatus: "Active" },
  { mode: "Interactive", category: "러그(Lug)", title: "Lifting Lug Evaluator", description: "Lifting Lug의 상세 치수와 작용 하중을 입력하여 러그의 구조 강도를 즉각 평가합니다.", icon: Box, color: "bg-emerald-600", tags: ["러그", "권상하중", "실시간"], devStatus: "Developing" },
  { mode: "Interactive", category: "평판(Plate)", title: "2D Plate Analyzer", description: "평판의 두께와 보강재 제원을 설정하여 좌굴(Buckling) 및 국부 강도를 평가합니다.", icon: Square, color: "bg-indigo-600", tags: ["평판", "좌굴", "실시간"], devStatus: "Planned" }
];

const DashboardContext = createContext();

export function DashboardProvider({ children, setCurrentMenu }) {
  const [stats, setStats] = useState({ activeTasks: 1, runningOnServer: 8, monthlyUsage: 42 });
  const [favorites, setFavorites] = useState(["Simple Beam Assessment", "Truss Model Builder"]); 

  const [globalJob, setGlobalJob] = useState(null);

  const startGlobalJob = (jobId, menuName) => {
    setGlobalJob({ jobId, menu: menuName, status: 'Running', progress: 0, message: '서버에 작업을 요청하는 중...' });

    const pollStatus = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/analysis/status/${jobId}`);
        const data = await res.json();
        
        setGlobalJob(prev => {
          if (!prev || prev.jobId !== jobId) return prev; 
          return { ...prev, ...data };
        });

        if (data.status !== "Success" && data.status !== "Failed") {
          setTimeout(pollStatus, 1500);
        }
      } catch (err) {
        console.error("Polling Error:", err);
        setGlobalJob(prev => prev ? { ...prev, status: 'Failed', message: '서버 통신 오류 발생' } : prev);
      }
    };
    
    setTimeout(pollStatus, 1000);
  };

  const clearGlobalJob = () => setGlobalJob(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(prev => ({
        activeTasks: Math.floor(Math.random() * 5) + 1,
        runningOnServer: Math.floor(Math.random() * 15),
        monthlyUsage: prev.monthlyUsage + Math.floor(Math.random() * 2)
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleFavorite = (title) => {
    setFavorites(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
  };

  return (
    <DashboardContext.Provider value={{ stats, favorites, toggleFavorite, globalJob, startGlobalJob, clearGlobalJob }}>
      {children}

      {/* 💡 글로벌 해석 추적 위젯 (화면 우측 하단 고정) */}
      {globalJob && (
        <div 
          onClick={() => setCurrentMenu && setCurrentMenu(globalJob.menu)}
          className="fixed bottom-6 right-6 z-[99999] w-[320px] bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.7)] rounded-2xl p-5 cursor-pointer hover:border-blue-500 hover:-translate-y-1 transition-all duration-300 animate-fade-in-up group"
          title="클릭하여 해석 페이지로 돌아가기"
        >
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-2 uppercase tracking-wider">
              {globalJob.status === 'Running' ? <RefreshCw className="animate-spin text-blue-400" size={14}/> :
               globalJob.status === 'Success' ? <CheckCircle className="text-emerald-400" size={14}/> :
               <AlertCircle className="text-red-400" size={14}/>}
              {globalJob.menu}
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); clearGlobalJob(); }} 
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X size={16}/>
            </button>
          </div>
          
          <div className="text-sm font-bold text-white mb-3">
            {globalJob.status === 'Success' ? '해석 완료! 결과를 확인하세요.' : 
             globalJob.status === 'Failed' ? '해석 실패' : globalJob.message}
          </div>
          
          {globalJob.status === 'Running' && (
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${globalJob.progress}%` }}></div>
            </div>
          )}
        </div>
      )}
    </DashboardContext.Provider>
  );
}

// 💡 [에러 원인 수정 완료!] 원래대로 이름 지정 내보내기(named export)로 복구
export const useDashboard = () => useContext(DashboardContext);