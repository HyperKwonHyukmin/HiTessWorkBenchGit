/// <summary>
/// Truss Structural Assessment 오케스트레이터.
/// 서브컴포넌트: AssessmentBdfViewer, MultiJsonViewer(AssessmentResultTable), AssessmentProjectModal
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { requestAssessment, downloadFileBlob } from '../../api/analysis';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { usePolling } from '../../hooks/usePolling';
import AssessmentBdfViewer from '../../components/analysis/AssessmentBdfViewer';
import MultiJsonViewer from '../../components/analysis/AssessmentResultTable';
import AssessmentProjectModal from '../../components/analysis/AssessmentProjectModal';
import GuideButton from '../../components/ui/GuideButton';
import {
  ArrowLeft, Upload, Play, Database, RefreshCw, Layers,
  Box, GitMerge, CheckCircle2, AlertCircle, Eye,
  Terminal, FileText, FileOutput, Download
} from 'lucide-react';

export default function TrussAssessment() {
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});

  const assessmentPageState = dashboardCtx?.assessmentPageState || {};
  const {
    bdfFile = null, nodes = {}, elements = [], nodeTableData = [], elemTableData = [],
    logs = [], detailedLogs = [], isRunning = false, progress = 0, statusMessage = '',
    activeTab = '3d', currentJobId = null, resultJsonData = null, activeResultCase = null,
    projectData = null,
  } = assessmentPageState;

  const updateState = (newState) => {
    if (dashboardCtx?.setAssessmentPageState) {
      dashboardCtx.setAssessmentPageState(prev => ({ ...(prev || {}), ...newState }));
    }
  };

  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentPollingJobId, setCurrentPollingJobId] = useState(null);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const lastMsgRef = useRef('');

  useEffect(() => {
    if (isRunning) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    }
    return () => { if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current); };
  }, [isRunning]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  usePolling({
    jobId: currentPollingJobId,
    onProgress: (data) => {
      const { progress: jobProgress, message } = data;
      if (message !== lastMsgRef.current) {
        lastMsgRef.current = message;
        dashboardCtx.setAssessmentPageState(prev => ({
          ...(prev || {}),
          progress: jobProgress,
          statusMessage: message,
          logs: [...(prev?.logs || []), { time: new Date().toLocaleTimeString(), message: `[${jobProgress}%] ${message}`, type: 'warning' }],
        }));
      } else {
        updateState({ progress: jobProgress, statusMessage: message });
      }
    },
    onComplete: async (data) => {
      setCurrentPollingJobId(null);
      const { engine_log, project } = data;
      let finalLogs = [...logs, { time: new Date().toLocaleTimeString(), message: '구조 평가 해석 완료.', type: 'success' }];
      updateState({ isRunning: false, logs: finalLogs, projectData: project });
      if (engine_log) updateState({ detailedLogs: [...detailedLogs, `*** SOLVER OUTPUT ***\n${engine_log}`] });

      if (project?.result_info) {
        const jsonFiles = Object.entries(project.result_info)
          .filter(([, path]) => typeof path === 'string' && path.toLowerCase().endsWith('.json'))
          .map(([key, path]) => ({ key: key.replace(/^JSON_/i, ''), path }));

        if (jsonFiles.length > 0) {
          finalLogs = [...finalLogs, { time: new Date().toLocaleTimeString(), message: `JSON 결과 ${jsonFiles.length}건 수신. 파싱 중...`, type: 'info' }];
          updateState({ logs: finalLogs, activeTab: 'result' });

          const results = await Promise.allSettled(jsonFiles.map(async (f) => {
            const res = await downloadFileBlob(f.path);
            const text = await res.data.text();
            return { key: f.key, data: JSON.parse(text) };
          }));

          const parsedResultsMap = {};
          results.forEach((r, idx) => {
            if (r.status === 'fulfilled') {
              parsedResultsMap[r.value.key] = r.value.data;
            } else {
              finalLogs = [...finalLogs, { time: new Date().toLocaleTimeString(), message: `[경고] ${jsonFiles[idx].key} 결과 파일 로드 실패.`, type: 'error' }];
            }
          });

          const caseNames = Object.keys(parsedResultsMap);
          if (caseNames.length > 0) {
            finalLogs = [...finalLogs, { time: new Date().toLocaleTimeString(), message: '결과 테이블 렌더링 완료.', type: 'success' }];
            updateState({ resultJsonData: parsedResultsMap, activeResultCase: caseNames[0], logs: finalLogs });
          } else {
            updateState({ logs: [...finalLogs, { time: new Date().toLocaleTimeString(), message: '모든 JSON 결과 파일 로드에 실패했습니다.', type: 'error' }] });
          }
        } else {
          updateState({ logs: [...finalLogs, { time: new Date().toLocaleTimeString(), message: '[안내] 생성된 JSON 결과 파일이 없습니다.', type: 'warning' }] });
        }
      }
    },
    onError: (errData) => {
      setCurrentPollingJobId(null);
      const msg = errData?.timeout ? '해석 시간 초과 (3분). 서버 상태를 확인하세요.' : '해석 실패.';
      updateState({ isRunning: false, logs: [...logs, { time: new Date().toLocaleTimeString(), message: msg, type: 'error' }] });
    },
  });

  const parseNastranFloat = (str) => {
    if (!str || !str.trim()) return 0;
    let s = str.trim().toUpperCase();
    if (s.includes('E')) return parseFloat(s);
    s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
    return parseFloat(s) || 0;
  };

  const parseBDF = (text) => {
    const parsedNodes = {}; const parsedElements = [];
    text.split('\n').forEach(line => {
      if (line.startsWith('GRID')) {
        const id = parseInt(line.substring(8, 16));
        if (!isNaN(id)) parsedNodes[id] = [parseNastranFloat(line.substring(24, 32)), parseNastranFloat(line.substring(32, 40)), parseNastranFloat(line.substring(40, 48))];
      } else if (line.startsWith('CROD') || line.startsWith('CBAR') || line.startsWith('CBEAM')) {
        const eid = parseInt(line.substring(8, 16));
        const n1 = parseInt(line.substring(24, 32));
        const n2 = parseInt(line.substring(32, 40));
        if (!isNaN(n1) && !isNaN(n2)) parsedElements.push([n1, n2, isNaN(eid) ? null : eid]);
      }
    });
    const nTable = [["Node ID", "X", "Y", "Z"], ...Object.keys(parsedNodes).slice(0, 100).map(k => [k, ...parsedNodes[k].map(v => v.toFixed(2))])];
    const eTable = [["Element", "EID", "Start Node", "End Node"], ...parsedElements.slice(0, 100).map((el, i) => [i + 1, el[2] ?? '-', el[0], el[1]])];
    updateState({ nodes: parsedNodes, elements: parsedElements, nodeTableData: nTable, elemTableData: eTable, activeTab: '3d', logs: [...logs, { time: new Date().toLocaleTimeString(), message: `[DATA] BDF 파싱 완료. (Nodes: ${Object.keys(parsedNodes).length}, Elements: ${parsedElements.length})`, type: 'success' }] });
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.bdf') && !file.name.toLowerCase().endsWith('.dat')) { alert('BDF 또는 DAT 파일만 업로드 가능합니다!'); return; }
    updateState({ bdfFile: file, resultJsonData: null, activeResultCase: null, projectData: null, logs: [...logs, { time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 업로드됨. 파싱 중...`, type: 'info' }] });
    setIsResultModalOpen(false);
    const reader = new FileReader();
    reader.onload = (e) => parseBDF(e.target.result);
    reader.readAsText(file);
  };

  const runAnalysis = async () => {
    if (!bdfFile) return;
    updateState({ isRunning: true, progress: 0, statusMessage: '서버 요청 중...', logs: [], detailedLogs: [], resultJsonData: null, projectData: null });
    setIsResultModalOpen(false);
    lastMsgRef.current = '';
    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';
    const formData = new FormData();
    formData.append('bdf_file', bdfFile);
    formData.append('employee_id', employeeId);
    formData.append('source', 'Workbench');
    try {
      const res = await requestAssessment(formData);
      const jobId = res.data.job_id;
      updateState({ currentJobId: jobId, logs: [{ time: new Date().toLocaleTimeString(), message: `[JOB] 해석 작업 큐 등록 완료. (Job ID: ${jobId})`, type: 'success' }] });
      startGlobalJob(jobId, 'Truss Structural Assessment');
      setCurrentPollingJobId(jobId);
    } catch {
      updateState({ isRunning: false, logs: [...logs, { time: new Date().toLocaleTimeString(), message: '서버 요청 실패.', type: 'error' }] });
    }
  };

  const downloadDetailedLog = () => {
    if (detailedLogs.length === 0) return alert('상세 로그가 없습니다.');
    const blob = new Blob([detailedLogs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Detailed_Log_${Date.now()}.out`; a.click(); URL.revokeObjectURL(url);
  };

  const numNodes = Object.keys(nodes).length;
  const numMembers = elements.length;
  const isDataReady = numNodes > 0 && numMembers > 0;

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentMenu('File-Based Apps')} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-brand-blue hover:bg-slate-50 transition-colors cursor-pointer"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-brand-blue tracking-tight flex items-center gap-3"><Layers className="text-blue-500"/> Truss Structural Assessment</h1>
            <p className="text-sm text-slate-500 mt-1">BDF 모델 파일을 업로드하여 구조적 건전성을 즉시 평가합니다.</p>
          </div>
        </div>
        <GuideButton guideTitle="[파일] Truss Structural Assessment — 트러스 구조 안정성 평가" />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        <div className="w-full lg:w-[400px] flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4"><Database size={16} className="text-blue-500"/> 1. Model Input (.bdf)</h3>
            <div onClick={() => fileInputRef.current?.click()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()}
              className={`relative p-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all ${bdfFile ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'}`}>
              <input type="file" accept=".bdf,.dat" className="hidden" ref={fileInputRef} onChange={(e) => handleFile(e.target.files[0])} />
              <div className="flex flex-col items-center gap-2 relative z-10 pointer-events-none">
                <div className={`p-3 rounded-full ${bdfFile ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{bdfFile ? <CheckCircle2 size={28} /> : <Upload size={28} />}</div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700">{bdfFile ? 'File Uploaded' : 'Drag & Drop BDF'}</h4>
                  <p className="text-xs text-slate-500 mt-1 truncate max-w-[250px]">{bdfFile ? bdfFile.name : 'Click to browse'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Box size={16} className="text-slate-500"/> 2. Model Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><GitMerge size={16} className="text-indigo-400" /> Parsed Nodes</div><span className="font-mono font-bold text-brand-blue">{numNodes.toLocaleString()} EA</span></div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100"><div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><Layers size={16} className="text-cyan-400" /> Parsed Elements</div><span className="font-mono font-bold text-brand-blue">{numMembers.toLocaleString()} EA</span></div>
              <div className={`mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed text-sm font-bold ${isDataReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>{isDataReady ? <><CheckCircle2 size={18} /> Model Ready</> : <><AlertCircle size={18} /> Awaiting BDF Data</>}</div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100 border-dashed flex flex-col gap-3">
            {projectData ? (
              <div className="flex flex-col gap-1">
                <button onClick={() => setIsResultModalOpen(true)} className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-amber-50 border-2 border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-500 hover:-translate-y-0.5 transition-all cursor-pointer shadow-sm">
                  <FileOutput size={18} className="text-amber-500"/> 해석 결과 저장
                </button>
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">클릭하면 해석 결과를 Excel 파일로 다운로드할 수 있습니다.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-slate-50 border-2 border-dashed border-slate-200 text-slate-300 select-none"><FileOutput size={18}/> 해석 결과 저장</div>
                <p className="text-[10px] text-slate-300 text-center">해석 완료 후 활성화됩니다.</p>
              </div>
            )}
            <button onClick={runAnalysis} disabled={!isDataReady || isRunning}
              className={`relative w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-3 transition-all duration-300 shadow-lg overflow-hidden ${!isDataReady ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : isRunning ? 'bg-[#001b3d] text-white cursor-wait' : 'bg-brand-blue hover:bg-brand-blue-dark text-white hover:-translate-y-1 cursor-pointer'}`}>
              {isRunning && <div className="absolute left-0 top-0 bottom-0 bg-blue-600 transition-all duration-500 ease-out opacity-80" style={{ width: `${progress}%` }}></div>}
              <div className="relative z-10 flex items-center gap-3 drop-shadow-md">
                {isRunning ? <RefreshCw className="animate-spin" size={24} /> : <Play size={24} fill="currentColor" />}
                {isRunning ? `${progress}% - ${statusMessage} (${elapsedSeconds}s)` : 'Run Structural Assessment'}
              </div>
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-6 min-h-0">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-4 gap-2 shrink-0 z-10 overflow-x-auto custom-scrollbar">
              <TabButton active={activeTab === '3d'}     onClick={() => updateState({ activeTab: '3d' })}     icon={Eye}      label="3D Preview" />
              <TabButton active={activeTab === 'node'}   onClick={() => updateState({ activeTab: 'node' })}   icon={Database} label="Input Nodes" />
              <TabButton active={activeTab === 'member'} onClick={() => updateState({ activeTab: 'member' })} icon={Layers}   label="Input Elements" />
              {resultJsonData && <TabButton active={activeTab === 'result'} onClick={() => updateState({ activeTab: 'result' })} icon={FileText} label="Assessment Results" color="emerald" />}
            </div>
            <div className="flex-1 relative bg-white overflow-hidden">
              {activeTab === '3d'     && (isDataReady ? <AssessmentBdfViewer nodes={nodes} elements={elements} resultData={resultJsonData && activeResultCase ? resultJsonData[activeResultCase] : null} /> : <EmptyState msg="BDF 업로드 시 3D 모델이 렌더링됩니다." Icon={Box}/>)}
              {activeTab === 'node'   && (isDataReady ? <DataTable data={nodeTableData} title="Node coordinates preview" /> : <EmptyState msg="BDF 업로드 시 Node 데이터를 볼 수 있습니다." Icon={Database}/>)}
              {activeTab === 'member' && (isDataReady ? <DataTable data={elemTableData} title="Element connectivity preview" /> : <EmptyState msg="BDF 업로드 시 Element 데이터를 볼 수 있습니다." Icon={Layers}/>)}
              {activeTab === 'result' && resultJsonData && <MultiJsonViewer resultsMap={resultJsonData} activeCase={activeResultCase} setActiveCase={(c) => updateState({ activeResultCase: c })} />}
            </div>
          </div>

          <div className="h-48 bg-[#0F172A] rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2"><Terminal size={14} className="text-slate-400"/><span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">Execution Console</span></div>
              {detailedLogs.length > 0 && <button onClick={downloadDetailedLog} className="text-xs text-blue-400 hover:text-blue-300 font-bold cursor-pointer flex items-center gap-1"><Download size={12}/> Download Output</button>}
            </div>
            <div className="flex-1 p-4 font-mono text-[13px] overflow-y-auto custom-scrollbar">
              {logs.length === 0 ? <p className="text-slate-600">Waiting for user action...</p> : logs.map((log, i) => (
                <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-[#00E600] font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'}`}>
                  <span className="text-slate-500 mr-3">[{log.time}]</span>{log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {isResultModalOpen && <AssessmentProjectModal project={projectData} onClose={() => setIsResultModalOpen(false)} />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, color }) {
  const activeColor = color === 'emerald' ? 'text-emerald-700 border-t-emerald-600 bg-emerald-50/30' : 'text-brand-blue border-t-brand-blue';
  return (
    <button onClick={onClick} className={`px-4 py-2.5 rounded-t-lg font-bold text-sm flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap ${active ? `bg-white ${activeColor} border-t-2 border-x border-slate-200` : 'text-slate-500 hover:bg-slate-200 border-t-2 border-transparent border-x border-transparent'}`}>
      <Icon size={16} /> {label}
    </button>
  );
}

function EmptyState({ msg, Icon }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-white">
      <Icon size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-bold text-center px-10 leading-relaxed">{msg}</p>
    </div>
  );
}

function DataTable({ data, title }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-auto custom-scrollbar bg-white">
      <table className="w-full text-left text-sm font-mono whitespace-nowrap bg-white">
        <thead className="sticky top-0 bg-slate-50 shadow-sm z-10">
          <tr>{data[0].map((h, i) => <th key={i} className="px-6 py-3 text-slate-600 font-bold uppercase tracking-wider text-xs border-b">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.slice(1).map((row, i) => <tr key={i} className="hover:bg-slate-50">{row.map((cell, j) => <td key={j} className="px-6 py-2 text-slate-700">{cell}</td>)}</tr>)}
        </tbody>
      </table>
      <div className="p-2 text-center text-[11px] text-slate-400 bg-slate-50 border-t border-slate-100 sticky bottom-0 z-10">{title} | 성능을 위해 상위 100개 항목만 표시합니다.</div>
    </div>
  );
}
