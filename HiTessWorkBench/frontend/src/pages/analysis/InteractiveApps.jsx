import React, { useState } from 'react';
import { ArrowRight, Info, Zap, PenTool, Star } from 'lucide-react';
import { useDashboard, ANALYSIS_DATA } from '../../contexts/DashboardContext'; 

const AppCard = ({ title, description, icon: Icon, color, tags, isFav, onToggleFav, onClick }) => (
  <div 
    onClick={onClick}
    className="group relative bg-white p-8 rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl hover:border-blue-400 transition-all duration-300 cursor-pointer flex flex-col h-full animate-fade-in-up"
  >
    <button 
      onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
      className="absolute top-6 right-6 z-10 text-slate-300 hover:scale-110 transition-transform outline-none cursor-pointer"
      title={isFav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
    >
      <Star size={24} fill={isFav ? "#eab308" : "transparent"} color={isFav ? "#eab308" : "currentColor"} />
    </button>
    <div className={`w-14 h-14 rounded-xl ${color} bg-opacity-10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
      <Icon className={`${color.replace('bg-', 'text-')}`} size={28} />
    </div>
    <div className="flex-1">
      <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed mb-4">{description}</p>
      <div className="flex flex-wrap gap-2 mt-auto">
        {tags.map((tag, i) => (
          <span key={i} className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">{tag}</span>
        ))}
      </div>
    </div>
    <div className="mt-8 flex items-center text-blue-600 font-bold text-sm">
      Open App <ArrowRight size={16} className="ml-2 group-hover:translate-x-2 transition-transform" />
    </div>
  </div>
);

export default function InteractiveApps({ setCurrentMenu }) {
  const [activeCategory, setActiveCategory] = useState("All");
  const { favorites, toggleFavorite } = useDashboard();

  const handleStart = (appTitle) => {
    if (appTitle === "Simple Beam Assessment") {
      setCurrentMenu('Simple Beam Assessment'); // ✅ 빔 해석기로 이동!
    } else {
      alert(`[안내] ${appTitle} 앱은 현재 개발 중입니다.`);
    }
  };

  // ✅ Interactive 앱만 필터링
  const interactiveData = ANALYSIS_DATA.filter(item => item.mode === "Interactive");
  const categories = ["All", ...new Set(interactiveData.map(item => item.category))];

  const filteredApps = activeCategory === "All" 
    ? interactiveData 
    : interactiveData.filter(item => item.category === activeCategory);

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <div className="mb-8 text-center md:text-left">
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
          <PenTool className="text-blue-600" size={32} /> Interactive Apps
        </h1>
        <p className="text-slate-500 mt-2">웹 UI에서 치수와 파라미터를 직접 입력하여 실시간으로 결과를 확인하세요.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-gray-200 pb-5">
        {categories.map(category => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`cursor-pointer px-6 py-2.5 rounded-md text-sm font-bold tracking-wide transition-all duration-200 ${
              activeCategory === category
                ? 'bg-[#002554] text-white shadow-md border border-[#002554]'
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 shadow-sm'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredApps.map((item, index) => (
          <AppCard 
            key={index} title={item.title} description={item.description} icon={item.icon} color={item.color} tags={item.tags}
            isFav={favorites.includes(item.title)} onToggleFav={() => toggleFavorite(item.title)} onClick={() => handleStart(item.title)} 
          />
        ))}
      </div>
    </div>
  );
}