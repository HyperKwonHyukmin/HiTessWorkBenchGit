import React, { useState, useRef, useEffect, Fragment } from 'react';
import { chatWithAI, getAIDocuments, triggerIngest } from '../../api/ai';
import { Send, Bot, User, RefreshCw, Database, X, FileText, BarChart2 } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';

export default function HiLabInsight() {
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [messages, setMessages] = useState([
    { role: 'ai', text: '안녕하세요! 사내 기술 보고서 학습 챗봇 **Hi-Lab Insight**입니다. 무엇을 도와드릴까요?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);

  const [targetDoc, setTargetDoc] = useState('all');

  const messagesEndRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
  const [ingestedDocs, setIngestedDocs] = useState({});

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const fetchIngestedDocs = async () => {
    try {
      const res = await getAIDocuments();
      if (res.data.documents) setIngestedDocs(res.data.documents);
    } catch (error) { console.error("문서 현황 로드 실패:", error); }
  };

  useEffect(() => { fetchIngestedDocs(); }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', text: input };

    const chatHistory = messages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text
      }));

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await chatWithAI(userMessage.text, chatHistory, targetDoc);
      setMessages(prev => [...prev, { role: 'ai', text: res.data.answer, sources: res.data.sources }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', text: '죄송합니다. 서버 응답 중 오류가 발생했습니다.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleIngest = async () => {
    setIsIngesting(true);
    try {
      const res = await triggerIngest();
      showToast(res.data.message, 'success');
      refreshTimerRef.current = setTimeout(fetchIngestedDocs, 5000);
    } catch (error) {
      showToast("Ingest 요청에 실패했습니다.", 'error');
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-5xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="bg-white p-4 rounded-t-2xl border border-slate-200 border-b-0 shadow-sm flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><Bot size={24} /></div>
          <div>
            <h2 className="font-bold text-brand-blue text-lg">Hi-Lab Insight</h2>
            <p className="text-xs text-slate-500">Document Scoped Search & Source Verification</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { fetchIngestedDocs(); setIsDocsModalOpen(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors shadow-sm cursor-pointer"><BarChart2 size={16} className="text-blue-500" /> 벡터 반영 현황</button>
          <button onClick={handleIngest} disabled={isIngesting} className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-colors shadow-sm cursor-pointer ${isIngesting ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100'}`}><Database size={16} />{isIngesting ? '백그라운드 학습 중...' : '지식 DB 업데이트'}</button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-slate-50 p-6 overflow-y-auto border border-slate-200 custom-scrollbar flex flex-col gap-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-brand-blue text-white' : 'bg-purple-600 text-white'}`}>
              {msg.role === 'user' ? <User size={16}/> : <Bot size={16}/>}
            </div>

            <div className={`p-4 rounded-2xl shadow-sm text-sm whitespace-pre-wrap leading-relaxed ${msg.role === 'user' ? 'bg-brand-blue text-white rounded-tr-sm' : 'bg-white text-slate-700 border border-slate-200 rounded-tl-sm w-full'}`}>
              <div>{msg.text}</div>

              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-bold text-slate-400 flex items-center gap-1 mb-2">
                    <FileText size={12}/> 참조된 원문 데이터 (클릭하여 검증)
                  </p>
                  {msg.sources.map((src, idx) => (
                    <details key={idx} className="bg-slate-50 rounded-lg border border-slate-200 text-xs overflow-hidden group">
                      <summary className="p-2.5 cursor-pointer font-bold text-slate-600 hover:bg-slate-100 transition-colors flex justify-between items-center outline-none">
                        <span className="truncate pr-4 flex items-center gap-2">
                          <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">문서</span>
                          {src.metadata.source_file} (p.{src.metadata.page + 1})
                        </span>
                        <span className="text-purple-500 shrink-0 bg-purple-50 px-2 py-0.5 rounded font-mono">정확도: {(src.relevance_score * 100).toFixed(1)}%</span>
                      </summary>
                      <div className="p-4 bg-white text-slate-600 font-mono whitespace-pre-wrap border-t border-slate-200 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                        {src.text}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 max-w-[80%]">
            <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0"><Bot size={16}/></div>
            <div className="p-4 bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm flex gap-2 items-center">
              <RefreshCw className="animate-spin text-slate-400" size={16} /> <span className="text-slate-500 text-sm font-bold bg-gradient-to-r from-purple-600 to-blue-500 text-transparent bg-clip-text">검색 및 답변 생성 중...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white p-4 rounded-b-2xl border border-slate-200 border-t-0 shadow-sm shrink-0">
        <form onSubmit={handleSend} className="flex gap-3 items-center relative">

          <select
            value={targetDoc}
            onChange={(e) => setTargetDoc(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl px-3 py-3 outline-none focus:border-purple-400 focus:bg-white transition-colors cursor-pointer max-w-[200px] truncate shadow-sm shrink-0"
            disabled={isLoading}
          >
            <option value="all">📂 전체 문서 검색</option>
            {Object.keys(ingestedDocs).map((doc, idx) => (
              <option key={idx} value={doc}>📄 {doc}</option>
            ))}
          </select>

          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={targetDoc === 'all' ? "전체 문서를 대상으로 궁금한 점을 질문해 보세요..." : `[${targetDoc}] 문서 안에서 질문해 보세요...`}
              className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-4 pr-12 py-3 outline-none focus:border-purple-400 focus:bg-white transition-colors text-sm text-slate-800"
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !input.trim()} className="absolute right-1.5 top-1.5 p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-slate-300 transition-colors cursor-pointer shadow-md">
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>

      {/* 모달: 학습된 문서 (벡터 반영) 현황 */}
      <Transition appear show={isDocsModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsDocsModalOpen(false)}>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] transform animate-fade-in-up">
              <div className="bg-brand-blue p-5 flex justify-between items-center text-white shrink-0">
                <Dialog.Title className="font-bold text-lg flex items-center gap-2"><Database size={20} className="text-brand-accent"/> 지식 DB 벡터 반영 현황</Dialog.Title>
                <button onClick={() => setIsDocsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-lg transition-colors cursor-pointer"><X size={20}/></button>
              </div>
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50">
                {Object.keys(ingestedDocs).length === 0 ? (
                  <div className="text-center py-10 text-slate-400"><FileText size={48} className="mx-auto mb-3 opacity-20"/><p>학습된 문서가 없거나 정보를 불러올 수 없습니다.</p></div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(ingestedDocs).map(([filename, info], idx) => (
                      <div key={idx} className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm flex flex-col gap-3 hover:border-blue-400 transition-colors">
                        <div className="flex justify-between items-start">
                          <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileText size={16} className="text-blue-500"/> {filename}</h3>
                          <div className="flex gap-2 text-xs font-mono font-bold">
                            <span className="px-2 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded">{info.page_count} Pages</span>
                            <span className="px-2 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded">{info.total_chars.toLocaleString()} Chars</span>
                          </div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs text-slate-500 leading-relaxed font-mono line-clamp-2">{info.preview || "미리보기 정보가 없습니다."}</div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1"><div className="bg-gradient-to-r from-blue-400 to-emerald-400 h-full w-full"></div></div>
                        <div className="text-[10px] text-slate-400 text-right font-bold">Vectorization 100% Complete</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
