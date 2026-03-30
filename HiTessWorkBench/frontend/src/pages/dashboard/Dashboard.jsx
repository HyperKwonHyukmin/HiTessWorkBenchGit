/// <summary>
/// 메인 대시보드 UI 컴포넌트입니다.
/// 최상단에 로드맵 배너를 배치하고 View 계층에서만 데이터를 로컬라이징하여 렌더링합니다.
/// </summary>
import React, { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { getQueueStatus } from '../../api/admin';
import { getAnalysisHistory } from '../../api/analysis';
import { 
  MoreVertical, Activity, FileText, Server, CheckCircle2, 
  ArrowUpRight, Star, CalendarDays, Database, Map, Rocket, 
  Wrench, Clock, X, ChevronRight
} from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext';

// ---------------------------------------------------------
// [신규] View Layer용 로컬라이징 딕셔너리
// ---------------------------------------------------------
const MODE_KO = {
  File: "파일 기반",
  Interactive: "대화형 앱"
};

// ---------------------------------------------------------
// UI Helper Components
// ---------------------------------------------------------
const EngineeringStatCard = ({ title, value, subtext, icon: Icon, color }) => (
  <div className="relative bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between hover:shadow-lg hover:border-blue-300 transition-all duration-200 group">
    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-400">
      <ArrowUpRight size={18} />
    </div>
    <div>
      <h3 className="text-gray-600 text-sm font-bold tracking-tight group-hover:text-blue-600 transition-colors">
        {title}
      </h3>
      <div className="mt-2 flex items-center space-x-2 mb-1">
        <span className="text-2xl font-extrabold text-slate-800 tracking-tight">{value}</span>
      </div>
      <p className="text-xs font-medium text-slate-400">{subtext}</p>
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-10 group-hover:bg-opacity-20 transition-all`}>
      <Icon size={22} className={color.replace('bg-', 'text-')} />
    </div>
  </div>
);

const FavoriteCard = ({ title, icon: Icon, color, desc, onClick }) => (
  <button onClick={onClick} className="flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-500 hover:-translate-y-1 transition-all group w-full text-center h-full relative overflow-hidden cursor-pointer">
    <div className="absolute top-3 right-3 text-yellow-400">
      <Star size={16} fill="currentColor" />
    </div>
    <div className={`p-4 rounded-full ${color} text-white mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
      <Icon size={28} />
    </div>
    <h3 className="font-bold text-slate-700 text-sm">{title}</h3>
    <p className="text-xs text-gray-400 mt-1 truncate max-w-full px-2">{desc}</p>
  </button>
);

const ProjectRow = ({ id, name, type, status, date }) => {
  const statusStyles = {
    Success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Failed: 'bg-red-100 text-red-700 border-red-200',
    Pending: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  const statusKo = {
    Success: '해석 완료',
    Failed: '해석 실패',
    Pending: '대기 중'
  };

  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-slate-50 transition-colors group">
      <td className="py-3 px-4 font-mono text-xs text-gray-500 text-center">{id}</td>
      <td className="py-3 px-4">
        <div className="flex items-center">
          <FileText size={16} className="text-slate-400 mr-2 group-hover:text-blue-600 transition-colors" />
          <span className="font-bold text-sm text-slate-700 group-hover:text-blue-600 transition-colors">
            {name || '이름 없는 프로젝트'}
          </span>
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500 font-mono">
        <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">{type}</span>
      </td>
      <td className="py-3 px-4">
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusStyles[status] || statusStyles.Pending}`}>
          {statusKo[status] || status}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-gray-400 text-right">{new Date(date).toLocaleString()}</td>
      <td className="py-3 px-4 text-center">
        <button className="text-gray-300 hover:text-gray-600 cursor-pointer"><MoreVertical size={16} /></button>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------
// 로드맵 관련 컴포넌트
// ---------------------------------------------------------
const StatusBadge = ({ status }) => {
  if (status === 'Active') return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold flex items-center gap-1"><Rocket size={12}/> 서비스 중</span>;
  if (status === 'Developing') return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded text-[10px] font-bold flex items-center gap-1"><Wrench size={12}/> 개발 중</span>;
  return <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-bold flex items-center gap-1"><Clock size={12}/> 출시 예정</span>;
};

const AppRoadmapBanner = ({ onOpenModal }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const activeCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Active').length;
  const devCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Developing').length;
  const planCount = ANALYSIS_DATA.filter(a => a.devStatus === 'Planned').length;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % ANALYSIS_DATA.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const currentApp = ANALYSIS_DATA[currentIndex];
  const AppIcon = currentApp.icon;

  return (
    <div 
      onClick={onOpenModal}
      className="bg-gradient-to-r from-[#002554] to-indigo-900 rounded-xl shadow-lg border border-indigo-500/30 overflow-hidden cursor-pointer hover:shadow-xl transition-all group mb-6 flex flex-col md:flex-row relative"
    >
      <Map size={120} className="absolute -left-10 -bottom-10 text-white/5 rotate-12 pointer-events-none" />
      <div className="p-5 md:w-1/3 border-b md:border-b-0 md:border-r border-white/10 relative z-10 flex flex-col justify-center">
        <h3 className="text-white font-bold text-sm flex items-center gap-2 mb-1">
          <Map size={16} className="text-blue-300"/> Workbench 해석 앱 로드맵
        </h3>
        <p className="text-blue-200/70 text-xs mb-3">플랫폼 내 해석 모듈 통합 개발 현황</p>
        <div className="flex gap-2 text-[10px] font-bold">
          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">서비스 중: {activeCount}</span>
          <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded border border-blue-500/30">개발 중: {devCount}</span>
          <span className="px-2 py-1 bg-slate-500/20 text-slate-300 rounded border border-slate-500/30">예정: {planCount}</span>
        </div>
      </div>
      <div className="p-5 md:flex-1 relative overflow-hidden flex items-center">
        <div key={currentApp.title} className="animate-fade-in-up flex items-start gap-4 w-full">
           <div className={`p-3 rounded-xl bg-white/10 text-white shrink-0 shadow-inner border border-white/5`}>
             <AppIcon size={24} />
           </div>
           <div className="flex-1 min-w-0">
             <div className="flex items-center gap-2 mb-1">
               {/* 뷰 계층에서 영문 Key를 한국어로 매핑하여 렌더링 */}
               <span className="text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-300/30 tracking-wider">
                 {MODE_KO[currentApp.mode] || currentApp.mode}
               </span>
               <h4 className="text-white font-bold text-sm truncate">{currentApp.title}</h4>
               <StatusBadge status={currentApp.devStatus} />
             </div>
             <p className="text-blue-100/70 text-xs line-clamp-2 pr-8">{currentApp.description}</p>
           </div>
        </div>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 group-hover:text-white transition-colors flex items-center gap-1 text-xs font-bold">
          상세 보기 <ChevronRight size={16}/>
        </div>
      </div>
    </div>
  );
};

const RoadmapModal = ({ isOpen, onClose }) => {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-5xl bg-slate-50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#002554] p-5 flex justify-between items-center text-white shrink-0">
              <div>
                <Dialog.Title className="font-bold text-lg flex items-center gap-2">
                  <Map size={20} className="text-blue-400"/> HiTESS Workbench 로드맵
                </Dialog.Title>
                <p className="text-xs text-blue-200 mt-1">플랫폼 내 도입 예정 및 개발 중인 해석 앱들의 전체 현황입니다.</p>
              </div>
              <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
               {['Active', 'Developing', 'Planned'].map((statusGroup) => {
                 const apps = ANALYSIS_DATA.filter(a => a.devStatus === statusGroup);
                 if (apps.length === 0) return null;
                 const groupTitle = statusGroup === 'Active' ? '현재 서비스 중' 
                                  : statusGroup === 'Developing' ? '개발 진행 중' 
                                  : '개발 예정';
                 return (
                   <div key={statusGroup} className="mb-8 last:mb-0">
                     <h3 className="text-sm font-bold text-slate-700 tracking-wide border-b border-slate-200 pb-2 mb-4 flex items-center gap-2">
                        {statusGroup === 'Active' && <Rocket size={16} className="text-emerald-500"/>}
                        {statusGroup === 'Developing' && <Wrench size={16} className="text-blue-500"/>}
                        {statusGroup === 'Planned' && <Clock size={16} className="text-slate-400"/>}
                        {groupTitle} ({apps.length})
                     </h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {apps.map((app, idx) => (
                         <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                           <div className="flex justify-between items-start mb-3">
                             <div className="p-2.5 bg-slate-50 text-slate-600 rounded-lg border border-slate-100">
                               <app.icon size={20} />
                             </div>
                             {/* 뷰 계층 매핑 적용 */}
                             <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                               {MODE_KO[app.mode] || app.mode}
                             </span>
                           </div>
                           <h4 className="font-bold text-slate-800 text-sm mb-1">{app.title}</h4>
                           <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mb-3">{app.description}</p>
                           <div className="flex flex-wrap gap-1 mt-auto">
                              {app.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-50 text-slate-500 border border-slate-100 rounded">{tag}</span>
                              ))}
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 );
               })}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
};

// ---------------------------------------------------------
// MAIN DASHBOARD COMPONENT
// ---------------------------------------------------------
export default function Dashboard({ setCurrentMenu }) {
  const { favorites } = useDashboard();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [queueStatus, setQueueStatus] = useState({ running: 0, pending: 0, limit: 2 });
  const [isRoadmapModalOpen, setIsRoadmapModalOpen] = useState(false);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await getQueueStatus();
        setQueueStatus(res.data);
      } catch (error) {
        console.error("Queue Status fetch error", error);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const userStr = localStorage.getItem('user');
        const employeeId = userStr ? JSON.parse(userStr).employee_id : null;
        if (!employeeId) return;

        const response = await getAnalysisHistory(employeeId);
        const sortedData = response.data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setProjects(sortedData);
      } catch (error) {
        console.error("이력 불러오기 실패:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const totalExecutions = projects.length;
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyUsageCount = projects.filter(p => {
    const d = new Date(p.created_at);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const handleFavoriteClick = (title) => {
    const targetApp = ANALYSIS_DATA.find(a => a.title === title);
    if (targetApp && targetApp.devStatus !== 'Active') {
      alert(`[안내] '${title}' 앱은 현재 개발 중이거나 출시 예정인 모듈입니다.`);
      return;
    }

    if (title === "Truss Model Builder") {
      setCurrentMenu('Truss Analysis');
    } else if (title === "Simple Beam Assessment") {
      setCurrentMenu('Simple Beam A'); 
    } else {
      alert(`[안내] ${title} 기능은 현재 준비 중입니다.`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10 animate-fade-in-up">
      
      {/* 1. Page Header */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">HiTESS Workbench 종합 현황</h1>
          <p className="text-sm text-gray-500 mt-1">실행 중인 시뮬레이션 상태 및 시스템 리소스를 확인하세요.</p>
        </div>
        <div className="text-right">
           <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200 shadow-sm">
             <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
             해석 서버 연결됨
           </span>
        </div>
      </div>

      {/* 2. Roadmap Banner (최상단) */}
      <AppRoadmapBanner onOpenModal={() => setIsRoadmapModalOpen(true)} />
      <RoadmapModal isOpen={isRoadmapModalOpen} onClose={() => setIsRoadmapModalOpen(false)} />

      {/* 3. KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 relative overflow-hidden group hover:border-blue-300 transition-colors">
          <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Server size={100} />
          </div>
          <h3 className="text-gray-600 text-sm font-bold tracking-tight flex items-center gap-2 mb-3">
            <Activity size={16} className="text-blue-500" /> 해석 서버 부하 현황
          </h3>
          <p className="text-[11px] text-gray-400 font-bold mb-2">현재 서버 구동 현황</p>
          <div className="text-2xl font-extrabold text-slate-800 tracking-tight mb-2">
            {queueStatus.running} <span className="text-sm text-slate-400 font-medium">/ {queueStatus.limit} 구동 중</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-3">
            <div 
              className={`h-full transition-all duration-500 ${queueStatus.running >= queueStatus.limit ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${(queueStatus.running / queueStatus.limit) * 100}%` }}
            ></div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
            <Activity size={14} className={queueStatus.pending > 0 ? "text-orange-500" : "text-slate-400"} />
            대기 중인 큐: <span className={queueStatus.pending > 0 ? "text-orange-600" : "text-slate-500"}>{queueStatus.pending} 건</span>
          </div>
        </div>

        <EngineeringStatCard 
          title="월간 해석 수행 건수" 
          value={`${monthlyUsageCount} 건`} 
          subtext="이번 달 실행된 전체 프로젝트" 
          icon={CalendarDays} 
          color="bg-indigo-500"
        />
        <EngineeringStatCard 
          title="누적 해석 수행 건수" 
          value={`${totalExecutions} 건`}
          subtext="지금까지 실행된 총 프로젝트 내역" 
          icon={Database} 
          color="bg-blue-500"
        />
      </div>

      {/* 4. Quick Actions (Favorites) */}
      <div className="space-y-4 pt-4 border-t border-slate-200 border-dashed">
        <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
          <Star size={16} className="text-yellow-500" fill="currentColor" /> 자주 사용하는 앱 (즐겨찾기)
        </h2>
        
        {favorites.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-slate-400 text-sm shadow-sm flex flex-col items-center">
            <div className="p-4 bg-slate-50 rounded-full mb-4">
              <Star size={32} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-500 mb-1">즐겨찾기 항목이 없습니다.</p>
            <p>New Analysis 메뉴에서 자주 사용하는 해석에 별(★)을 눌러 대시보드에 추가해 보세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {favorites.map(favTitle => {
              const analysisInfo = ANALYSIS_DATA.find(a => a.title === favTitle);
              if (!analysisInfo) return null;
              return (
                <FavoriteCard 
                  key={favTitle}
                  title={analysisInfo.title} 
                  desc={analysisInfo.description} 
                  icon={analysisInfo.icon} 
                  color={analysisInfo.color} 
                  onClick={() => handleFavoriteClick(analysisInfo.title)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Tracking (Recent Projects) */}
      <div className="pt-4 border-t border-slate-200 border-dashed">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-bold text-slate-600 flex items-center gap-2">
            <Activity size={16} /> 최근 수행 프로젝트 이력
          </h2>
          <button onClick={() => setCurrentMenu('My Project')} className="text-xs font-bold text-blue-600 hover:underline cursor-pointer">
            전체 이력 보기 →
          </button>
        </div>
        
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold w-24 text-center">ID</th>
                  <th className="py-3 px-4 font-bold">프로젝트명</th>
                  <th className="py-3 px-4 font-bold">모듈 (유형)</th>
                  <th className="py-3 px-4 font-bold">진행 상태</th>
                  <th className="py-3 px-4 font-bold text-right">수행 일시</th>
                  <th className="py-3 px-4 font-bold text-center w-16">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="py-10 text-center text-slate-400 text-sm">
                      <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2"></div>
                      <p>이력 데이터를 불러오는 중입니다...</p>
                    </td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-10 text-center text-slate-400 text-sm">최근 수행된 프로젝트 내역이 없습니다.</td>
                  </tr>
                ) : (
                  projects.slice(0, 5).map((project) => (
                    <ProjectRow key={project.id} id={project.id} name={project.project_name} type={project.program_name} status={project.status} date={project.created_at} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}