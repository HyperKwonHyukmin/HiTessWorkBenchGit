/// <summary>
/// 대시보드 및 전체 해석 앱의 메타데이터를 관리하는 전역 Context입니다.
/// (개선) 새로 개발된 'Truss Structural Assessment' 앱을 File-Based 카테고리에 추가했습니다.
/// </summary>
import React, { createContext, useState, useEffect, useContext } from 'react';
import { Layers, Ruler, Ship, Activity, ShieldCheck, Box, Square, FileText } from 'lucide-react';

export const ANALYSIS_DATA = [
  // --- [1] File-Based Analysis ---
  {
    mode: "File", 
    category: "트러스(Truss)",
    title: "Truss Model Builder",
    description: "Truss 설계 정보를 활용하여 Truss의 구조 해석 모델을 자동으로 구축합니다.",
    icon: Layers,
    color: "bg-cyan-600",
    tags: ["트러스", "모델생성"],
    devStatus: "Active" 
  },
  // ✅ [신규 앱 추가] Truss Structural Assessment
  {
    mode: "File", 
    category: "트러스(Truss)",
    title: "Truss Structural Assessment",
    description: "BDF 모델 파일을 업로드하여 구조적 건전성을 즉시 평가하고 3D로 시각화합니다.",
    icon: FileText,
    color: "bg-purple-600",
    tags: ["BDF", "구조평가", "3D시각화"],
    devStatus: "Active" 
  },
  {
    mode: "File", 
    category: "권상(Lifting)",
    title: "Group & Unit 권상 구조 해석",
    description: "Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.",
    icon: Layers,
    color: "bg-emerald-600",
    tags: ["유닛", "블록", "국부강도"],
    devStatus: "Developing"
  },
  {
    mode: "File", 
    category: "배관(Pipe)",
    title: "Pipe 구조 해석",
    description: "배관 시스템의 지지대 및 진동에 대한 전반적인 구조 해석을 수행합니다.",
    icon: Activity,
    color: "bg-indigo-600",
    tags: ["배관", "파운데이션", "진동"],
    devStatus: "Planned"
  },
  {
    mode: "File", 
    category: "전선해석",
    title: "Whole Ship Analysis",
    description: "선박 전체 모델에 대한 전역 강도 및 항해 조건별 응답을 통합 해석합니다.",
    icon: Ship,
    color: "bg-slate-800",
    tags: ["전선해석", "선체보", "전체모델"],
    devStatus: "Planned"
  },
  {
    mode: "File", 
    category: "기타",
    title: "구조 최적화 (Optimization)",
    description: "중량 절감 및 구조 효율성 극대화를 위한 AI 기반 최적화 프로세스를 진행합니다.",
    icon: ShieldCheck,
    color: "bg-orange-600",
    tags: ["중량절감", "위상최적화", "민감도"],
    devStatus: "Planned"
  },

  // --- [2] Interactive Apps ---
  {
    mode: "Interactive", 
    category: "1D 빔(Beam)",
    title: "Simple Beam Analyzer", 
    description: "단면 형상과 치수를 직접 입력하여 단순 보(Beam)의 응력 및 처짐을 실시간으로 평가합니다.",
    icon: Ruler,
    color: "bg-blue-600",
    tags: ["1D요소", "굽힘응력", "실시간"],
    devStatus: "Active"
  },
  {
    mode: "Interactive", 
    category: "러그(Lug)",
    title: "Lifting Lug Evaluator",
    description: "Lifting Lug의 상세 치수와 작용 하중을 입력하여 러그의 구조 강도를 즉각 평가합니다.",
    icon: Box,
    color: "bg-emerald-600",
    tags: ["러그", "권상하중", "실시간"],
    devStatus: "Developing"
  },
  {
    mode: "Interactive", 
    category: "평판(Plate)",
    title: "2D Plate Analyzer",
    description: "평판의 두께와 보강재 제원을 설정하여 좌굴(Buckling) 및 국부 강도를 평가합니다.",
    icon: Square,
    color: "bg-indigo-600",
    tags: ["평판", "좌굴", "실시간"],
    devStatus: "Planned"
  }
];

const DashboardContext = createContext();

export function DashboardProvider({ children }) {
  const [stats, setStats] = useState({ activeTasks: 1, runningOnServer: 8, monthlyUsage: 42 });
  const [favorites, setFavorites] = useState(["Simple Beam Analyzer", "Truss Model Builder"]); 

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
    setFavorites(prev => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  return (
    <DashboardContext.Provider value={{ stats, favorites, toggleFavorite }}>
      {children}
    </DashboardContext.Provider>
  );
}

export const useDashboard = () => useContext(DashboardContext);