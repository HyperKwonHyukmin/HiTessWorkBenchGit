import React from 'react';
import { Bot, ArrowRight, FileText } from 'lucide-react';

export default function AiAssistantHub({ setCurrentMenu }) {
  return (
    <div className="max-w-7xl mx-auto pb-16 animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#002554] tracking-tight flex items-center gap-3">
          <Bot className="text-purple-600" size={32} /> AI Lab Assistant
        </h1>
        <p className="text-slate-500 mt-2">최신 인공지능 기술을 활용하여 업무 생산성을 극대화하십시오.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* Hi-Lab Insight 챗봇 카드 */}
        <div 
          onClick={() => setCurrentMenu('Hi-Lab Insight')}
          className="group bg-white p-8 rounded-2xl border border-gray-200 shadow-sm hover:shadow-xl hover:border-purple-400 transition-all duration-300 cursor-pointer flex flex-col h-full"
        >
          <div className="w-14 h-14 rounded-xl bg-purple-100 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <FileText className="text-purple-600" size={28} />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-purple-600 transition-colors">
              Hi-Lab Insight
            </h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-4">
              C:\Users\HHI\Desktop\reports_data 경로의 사내 연구 보고서 및 기술 문서를 학습하여 엔지니어의 질문에 답변하는 RAG 챗봇입니다.
            </p>
            <div className="flex flex-wrap gap-2 mt-auto">
              <span className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">LLM</span>
              <span className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">RAG</span>
            </div>
          </div>
          <div className="mt-8 flex items-center text-purple-600 font-bold text-sm">
            Launch Chatbot <ArrowRight size={16} className="ml-2 group-hover:translate-x-2 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
}