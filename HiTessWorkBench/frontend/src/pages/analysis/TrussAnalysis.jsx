/// <summary>
/// 파일 기반(File-Based)의 비동기 트러스 모델 구축 패널입니다.
/// (수정) 해석 완료 시 XLSX 파일의 다이렉트 다운로드 및 JSON 데이터의 테이블 렌더링 기능을 추가했습니다.
/// </summary>
import React, { useState, useRef, useEffect, Fragment } from 'react';
import { requestTrussAnalysis, downloadFileBlob } from '../../api/analysis';
import { extractFilename } from '../../utils/fileHelper';
import { usePolling } from '../../hooks/usePolling';
import { Dialog, Transition } from '@headlessui/react';
import { 
  ArrowLeft, Upload, Play, Download, Trash2, Database,
  RefreshCw, FileSpreadsheet, Terminal, Layers,
  Box, GitMerge, CheckCircle2, AlertCircle, Maximize2, X, FileText,
  FileOutput, XCircle, Clock, Eye
} from 'lucide-react';

import BdfViewerModal from '../../components/modals/BdfViewerModal';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useFileParser, parseCsvText } from '../../hooks/useFileParser';

export default function TrussAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const [nodeFile, setNodeFile] = useState(null);
  const [memberFile, setMemberFile] = useState(null);
  const [nodeData, setNodeData] = useState([]);
  const [memberData, setMemberData] = useState([]);
  const [logs, setLogs] = useState([]); 
  const [detailedLogs, setDetailedLogs] = useState([]); 
  
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0); 
  const [statusMessage, setStatusMessage] = useState(''); 

  const [activeTab, setActiveTab] = useState('node'); 
  
  // (추가) 파싱된 JSON 결과 데이터를 담을 State
  const [resultJsonData, setResultJsonData] = useState(null);
  
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [analysisResultData, setAnalysisResultData] = useState(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);  
  const [is3DViewerOpen, setIs3DViewerOpen] = useState(false); 
  
  const logEndRef = useRef(null);
  const lastMsgRef = useRef('');
  const [currentJobId, setCurrentJobId] = useState(null);

  usePolling({
    jobId: currentJobId,
    interval: 1500,
    maxRetries: 120,
    onProgress: ({ progress, message }) => {
      setProgress(progress);
      setStatusMessage(message);
      if (message !== lastMsgRef.current) {
        addLog(`[${progress}%] ${message}`, 'warning');
        lastMsgRef.current = message;
      }
    },
    onComplete: async ({ progress, message, engine_log, project }) => {
      setProgress(progress);
      setStatusMessage(message);
      setIsRunning(false);
      setCurrentJobId(null);
      addLog('MODEL BUILDING COMPLETED SUCCESSFULLY.', 'success');
      addLog('결과가 DB에 기록되었습니다.', 'info');
      if (engine_log) {
        addDetailedLog('*** HITESS WORKBENCH SOLVER OUTPUT ***');
        addDetailedLog(engine_log);
      }
      setAnalysisResultData(project);
      if (project?.result_info) {
        const jsonKey = Object.keys(project.result_info).find(k => project.result_info[k].endsWith('.json'));
        if (jsonKey) {
          addLog('JSON 결과 데이터를 파싱 중입니다...', 'info');
          try {
            const res = await downloadFileBlob(project.result_info[jsonKey]);
            const text = await res.data.text();
            setResultJsonData(JSON.parse(text));
            setActiveTab('result');
            addLog('결과 테이블 렌더링 완료.', 'success');
          } catch (e) {
            console.error("JSON Fetch/Parse Error:", e);
            addLog('JSON 결과를 화면에 표시하는 데 실패했습니다.', 'error');
          }
        }
      }
    },
    onError: (err) => {
      setIsRunning(false);
      setCurrentJobId(null);
      if (err?.timeout) {
        addLog('해석 시간 초과 (3분). 서버 상태를 확인하세요.', 'error');
      } else if (err?.engine_log) {
        addLog('ENGINE EXECUTION FAILED.', 'error');
        addDetailedLog(err.engine_log);
      } else {
        addLog('STATUS CHECK FAILED.', 'error');
      }
    }
  });

  const numNodes = nodeData.length > 1 ? nodeData.length - 1 : 0;
  const numMembers = memberData.length > 1 ? memberData.length - 1 : 0;
  const isDataReady = numNodes > 0 && numMembers > 0;

  useEffect(() => { 
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [logs]);

  const downloadTemplate = (type) => {
    let content = "";
    let filename = "";
    if (type === 'node') {
      content = "Node_ID,X_Coord,Y_Coord,Z_Coord\n1,0,0,0\n2,1000,0,0\n3,0,1000,0";
      filename = "Template_Node.csv";
    } else {
      content = "Member_ID,Start_Node,End_Node,Area,Material_ID\n1,1,2,15.5,1\n2,2,3,15.5,1";
      filename = "Template_Member.csv";
    }
    const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCsvParsed = (rows, file, setter, type) => {
    setter(rows);
    addLog(`[DATA] ${type.toUpperCase()} 데이터 로드 완료 (${rows.length - 1}행)`, 'info');
    addDetailedLog(`PARSING ${file.name} ... OK (${rows.length - 1} Entries)`);
  };

  const handleCsvError = (err, file) => {
    addLog(`[ERROR] ${file.name} 파싱 실패: ${err.message}`, 'error');
  };

  const { readFile: readNodeFile } = useFileParser(
    parseCsvText,
    (rows, file) => handleCsvParsed(rows, file, setNodeData, 'node'),
    handleCsvError
  );
  const { readFile: readMemberFile } = useFileParser(
    parseCsvText,
    (rows, file) => handleCsvParsed(rows, file, setMemberData, 'member'),
    handleCsvError
  );

  const handleFile = (file, type) => {
    if (!file || !file.name.endsWith('.csv')) { alert('CSV 파일만 업로드 가능합니다!'); return; }
    if (type === 'node') { setNodeFile(file); readNodeFile(file); }
    else { setMemberFile(file); readMemberFile(file); }
    setActiveTab(type);
  };

  const handleDrop = (e, type) => { 
    e.preventDefault(); 
    handleFile(e.dataTransfer.files[0], type); 
  };
  
  const addLog = (message, type = 'info') => { 
    const time = new Date().toLocaleTimeString(); 
    setLogs(prev => [...prev, { time, message, type }]); 
  };
  
  const addDetailedLog = (message) => { 
    const time = new Date().toISOString(); 
    setDetailedLogs(prev => [...prev, `[${time}] ${message}`]); 
  };
  
  const clearLogs = () => { 
    setLogs([]); 
    setDetailedLogs([]); 
  };

  // 해석 서버 요청 로직
  const runAnalysis = async () => {
    if (!nodeFile || !memberFile) return;
    
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버에 작업 요청 중...');
    setAnalysisResultData(null);
    setResultJsonData(null); // (추가) 재실행 시 기존 결과 초기화
    setIsResultModalOpen(false);
    setIs3DViewerOpen(false);
    setLogs([]);
    setDetailedLogs([]); 
    
    addLog('System Check OK. Requesting Analysis Job...', 'info');
    
    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    const formData = new FormData();
    formData.append('node_file', nodeFile);
    formData.append('member_file', memberFile);
    formData.append('employee_id', employeeId);
    formData.append('source', 'Workbench');

    try {
      const requestRes = await requestTrussAnalysis(formData);

      const jobId = requestRes.data.job_id;
      if (!jobId) throw new Error("서버로부터 Job ID를 받지 못했습니다.");

      addLog(`Job submitted successfully. [Job ID: ${jobId}]`, 'info');
      lastMsgRef.current = '';
      setCurrentJobId(jobId);

    } catch (error) {
      addLog('SERVER COMMUNICATION FAILED.', 'error');
      addDetailedLog(error.response ? `SERVER ERROR [${error.response.status}]` : `NETWORK ERROR: ${error.message}`);
      setIsRunning(false);
    }
  };

  // ==========================================
  // (신규) 다이렉트 엑셀 다운로드 핸들러
  // ==========================================
  const handleDirectExcelDownload = async () => {
    if (!analysisResultData?.result_info) return;
    const excelKey = Object.keys(analysisResultData.result_info).find(k => analysisResultData.result_info[k].endsWith('.xlsx') || analysisResultData.result_info[k].endsWith('.csv'));
    
    if (excelKey) {
      const filePath = analysisResultData.result_info[excelKey];
      try {
        const response = await downloadFileBlob(filePath);
        const filename = extractFilename(filePath);
        const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } catch (error) {
        console.error("Excel download failed", error);
        alert("엑셀 파일 다운로드에 실패했습니다.");
      }
    } else {
      // 엑셀이 명시적으로 없을 경우엔 기존 폴더/모달을 엽니다.
      setIsResultModalOpen(true);
    }
  };

  const canRun = nodeFile && memberFile && !isRunning;
  
  const downloadSummaryLog = () => {
    if (logs.length === 0) return alert('다운로드할 로그가 없습니다.');
    const logText = logs.map(l => `[${l.time}] ${l.message}`).join('\n');
    downloadFile(logText, `Summary_Log_${new Date().getTime()}.txt`);
  };
  
  const downloadDetailedLog = () => {
    if (detailedLogs.length === 0) return alert('상세 로그가 없습니다.');
    const logText = detailedLogs.join('\n');
    downloadFile(logText, `Detailed_Raw_Log_${new Date().getTime()}.out`);
  };

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-[#002554] via-[#003a7a] to-blue-700 overflow-hidden shrink-0">
        <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
          <div className="absolute -right-6 -top-6 w-48 h-48 bg-white rounded-full" />
          <div className="absolute right-24 bottom-0 w-24 h-24 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentMenu('File-Based Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Truss Model Builder</h1>
              <p className="text-sm text-blue-200/80 mt-0.5">Node 및 Member CSV 데이터를 기반으로 구조 해석 모델을 구축합니다.</p>
            </div>
          </div>
          <GuideButton guideTitle="[파일] Truss Model Builder — CSV로 트러스 모델 만들기" variant="dark" />
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* LEFT PANE */}
        <div className="w-full lg:w-[400px] flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-3 flex justify-between items-center">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2"><Database size={14}/> 1. Data Input</h3>
              <div className="flex gap-2">
                <button onClick={() => downloadTemplate('node')} className="text-[10px] bg-white/20 text-white px-2 py-1 rounded border border-white/10 hover:bg-white/30 transition-colors cursor-pointer flex items-center gap-1"><Download size={10}/> Node 양식</button>
                <button onClick={() => downloadTemplate('member')} className="text-[10px] bg-white/20 text-white px-2 py-1 rounded border border-white/10 hover:bg-white/30 transition-colors cursor-pointer flex items-center gap-1"><Download size={10}/> Member 양식</button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <UploadDropzone type="node" title="Node Data" file={nodeFile} rowCount={numNodes} onDrop={(e) => handleDrop(e, 'node')} onChange={(e) => handleFile(e.target.files[0], 'node')} />
              <UploadDropzone type="member" title="Member Data" file={memberFile} rowCount={numMembers} onDrop={(e) => handleDrop(e, 'member')} onChange={(e) => handleFile(e.target.files[0], 'member')} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Box size={14}/> 2. Model Summary
              </h3>
            </div>
            <div className="p-5">
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><GitMerge size={16} className="text-indigo-400" /> Total Nodes</div>
                  <span className="font-mono font-bold text-brand-blue">{numNodes.toLocaleString()} EA</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-2 text-sm text-slate-600 font-medium"><Layers size={16} className="text-cyan-400" /> Total Members</div>
                  <span className="font-mono font-bold text-brand-blue">{numMembers.toLocaleString()} EA</span>
                </div>
                <div className={`mt-2 flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed text-sm font-bold transition-colors ${isDataReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-300 text-slate-500'}`}>
                  {isDataReady ? <><CheckCircle2 size={18} /> Ready to Build</> : <><AlertCircle size={18} /> Awaiting CSV Data</>}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button 
              onClick={runAnalysis} 
              disabled={!canRun} 
              className={`relative w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-3 transition-all duration-300 shadow-lg overflow-hidden ${
                !canRun 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                  : isRunning 
                    ? 'bg-[#001b3d] text-white cursor-wait'
                    : 'bg-brand-blue hover:bg-brand-blue-dark text-white hover:-translate-y-1 cursor-pointer'
              }`}
            >
              {isRunning && (
                <div className="absolute left-0 top-0 bottom-0 bg-blue-600 transition-all duration-500 ease-out opacity-80" style={{ width: `${progress}%` }}></div>
              )}
              <div className="relative z-10 flex items-center gap-3 drop-shadow-md">
                {isRunning ? <RefreshCw className="animate-spin" size={24} /> : <Play size={24} fill="currentColor" />}
                {isRunning ? `${progress}% - ${statusMessage || '생성 중...'}` : 'BDF 생성 시작'}
              </div>
            </button>
            
            {/* (수정) 결과 액션 버튼: 엑셀 직접 다운로드 지원 */}
            {analysisResultData && analysisResultData.status === "Success" && (
              <div className="flex flex-col gap-2 animate-fade-in-up mt-1">
                <div className="flex gap-2">
                  <button onClick={handleDirectExcelDownload} className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-sm cursor-pointer">
                    <FileSpreadsheet size={18} /> 결과 BDF 다운로드
                  </button>
                  <button onClick={() => setIs3DViewerOpen(true)} className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-brand-blue text-white hover:bg-brand-blue-dark transition-colors shadow-lg cursor-pointer">
                    <Eye size={18} /> 3D 시각화
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE */}
        <div className="flex-1 flex flex-col gap-6 min-h-0">
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="flex items-end border-b border-slate-200 bg-gradient-to-r from-indigo-900 to-blue-800 px-4 pt-3 gap-1">
              <TabButton active={activeTab === 'node'} onClick={() => setActiveTab('node')} icon={Database} label="Node Preview" count={numNodes} />
              <TabButton active={activeTab === 'member'} onClick={() => setActiveTab('member')} icon={Layers} label="Member Preview" count={numMembers} />
              {resultJsonData && (
                <TabButton active={activeTab === 'result'} onClick={() => setActiveTab('result')} icon={FileText} label="Result Viewer" count={Array.isArray(resultJsonData) ? resultJsonData.length : 1} />
              )}
            </div>
            <div className="flex-1 overflow-auto bg-white custom-scrollbar relative">
              {activeTab === 'node' && <DataTable data={nodeData} emptyMsg="Node CSV 파일을 업로드하면 데이터를 미리볼 수 있습니다." />}
              {activeTab === 'member' && <DataTable data={memberData} emptyMsg="Member CSV 파일을 업로드하면 데이터를 미리볼 수 있습니다." />}
              {activeTab === 'result' && <JsonDataTable data={resultJsonData} emptyMsg="결과 데이터가 없습니다." />}
            </div>
          </div>

          <div className="h-64 bg-[#0F172A] rounded-2xl shadow-xl border border-slate-700 flex flex-col overflow-hidden shrink-0">
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4">
              <div className="flex items-center gap-2"><Terminal size={14} className="text-slate-400" /><span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">System Console</span></div>
              <div className="flex gap-3">
                <button onClick={() => setIsLogModalOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-bold cursor-pointer"><Maximize2 size={12}/> 상세 로그 보기</button>
                <button onClick={downloadSummaryLog} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"><Download size={14}/> Save</button>
                <button onClick={clearLogs} className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 cursor-pointer"><Trash2 size={14}/> Clear</button>
              </div>
            </div>
            <div className="flex-1 p-4 font-mono text-[13px] overflow-y-auto custom-scrollbar">
              {logs.length === 0 ? <p className="text-slate-600">Waiting for task execution...</p> : logs.map((log, i) => (
                <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-[#00E600] font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'}`}>
                  <span className="text-slate-500 mr-3">[{log.time}]</span>{log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* 모달 1: 텍스트 로그 */}
      <Transition appear show={isLogModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[100]" onClose={() => setIsLogModalOpen(false)}>
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-5xl h-[80vh] flex flex-col rounded-2xl bg-[#0F172A] border border-slate-700">
              <div className="bg-slate-800 px-6 py-4 flex justify-between items-center border-b border-slate-700 shrink-0">
                <Dialog.Title as="h3" className="text-lg font-bold text-white flex items-center gap-2"><FileText className="text-blue-400" /> Detailed System Log</Dialog.Title>
                <button onClick={() => setIsLogModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={24} /></button>
              </div>
              <div className="flex-1 p-6 overflow-auto bg-black font-mono text-xs text-slate-300 whitespace-pre-wrap">
                {detailedLogs.join('\n')}
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      {/* 모달 2: 전체 결과 파일 다운로드 */}
      <ProjectDetailModal project={isResultModalOpen ? analysisResultData : null} onClose={() => setIsResultModalOpen(false)} />
      
      {/* 모달 3: 3D BDF 뷰어 */}
      <BdfViewerModal isOpen={is3DViewerOpen} project={analysisResultData} onClose={() => setIs3DViewerOpen(false)} />

    </div>
  );
}

// ==========================================
// Helper Components
// ==========================================

// (신규) JSON 기반 동적 테이블 렌더러
function JsonDataTable({ data, emptyMsg }) {
  if (!data) return <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><Database size={48} className="mb-4 opacity-20" /><p className="text-sm">{emptyMsg}</p></div>;
  
  let tableData = [];
  // 1. JSON 최상위가 배열인 경우 (일반적인 행/열 구조)
  if (Array.isArray(data)) {
    tableData = data;
  } 
  // 2. JSON 최상위가 객체인 경우
  else if (typeof data === 'object') {
    // 혹시 객체 내부에 배열이 들어있는지 탐색 ("Results": [...] 등)
    const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
    if (arrayKey) {
      tableData = data[arrayKey];
    } else {
      // 순수 객체라면 Key-Value 형태로 평탄화(Flatten)하여 표시
      tableData = Object.entries(data).map(([key, value]) => ({ 
        Key: key, 
        Value: typeof value === 'object' ? JSON.stringify(value) : String(value) 
      }));
    }
  }

  if (tableData.length === 0) return <div className="p-4 text-center text-slate-500">표시할 데이터가 없습니다.</div>;

  const headers = Object.keys(tableData[0]);

  return (
    <table className="w-full text-left text-sm font-mono whitespace-nowrap">
      <thead className="sticky top-0 bg-slate-50 shadow-sm z-10">
        <tr>
          {headers.map((h, i) => <th key={i} className="px-6 py-3 text-brand-blue font-bold uppercase tracking-wider text-xs border-b border-slate-200">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tableData.map((row, i) => (
          <tr key={i} className="hover:bg-blue-50/50 transition-colors">
            {headers.map((h, j) => <td key={j} className="px-6 py-2.5 text-slate-700">{String(row[h])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


const StatusBadge = ({ status }) => {
  const styles = {
    Success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Solving: "bg-blue-100 text-blue-700 border-blue-200 animate-pulse",
    Failed: "bg-red-100 text-red-700 border-red-200",
    Pending: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const icons = {
    Success: <CheckCircle2 size={12} className="mr-1" />,
    Solving: <Clock size={12} className="mr-1" />,
    Failed: <XCircle size={12} className="mr-1" />,
    Pending: <AlertCircle size={12} className="mr-1" />,
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center w-fit ${styles[status] || styles.Pending}`}>
      {icons[status] || icons.Pending}
      {status}
    </span>
  );
};

const ProjectDetailModal = ({ project, onClose }) => {
  if (!project) return null;

  const handleDownload = async (filePath) => {
    if (!filePath) return;
    try {
      const response = await downloadFileBlob(filePath);
      const filename = filePath.split('\\').pop().split('/').pop();
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
      alert("파일 다운로드에 실패했습니다.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        
        {/* Header */}
        <div className="bg-brand-blue p-6 text-white flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-white/20 text-blue-100 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                ID: {project.id}
              </span>
              <span className="text-blue-200 text-xs">| {new Date(project.created_at).toLocaleString()}</span>
            </div>
            <h2 className="text-xl font-bold leading-tight">{project.project_name || 'Unnamed Project'}</h2>
            <p className="text-blue-200 text-xs mt-1 font-mono">{project.program_name}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors cursor-pointer">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Analysis Status</h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Execution Status</span>
              <StatusBadge status={project.status} />
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Module</span>
              <div className="font-bold text-slate-700 flex items-center gap-2">
                <Box size={16} className="text-blue-500"/> {project.program_name}
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Requester ID</span>
              <div className="font-bold text-slate-700">{project.employee_id}</div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400 block mb-1">Execution Date</span>
              <div className="text-slate-700 font-bold text-sm">{new Date(project.created_at).toLocaleDateString()}</div>
            </div>
          </div>

          {/* Input Files */}
          {project.input_info && Object.keys(project.input_info).length > 0 && (
            <>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 mt-4">Input Data (CSV)</h3>
              <div className="space-y-2 mb-6">
                {Object.entries(project.input_info).map(([key, path]) => (
                  <button key={key} onClick={() => handleDownload(path)} className="w-full flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-100 text-slate-500 rounded-lg group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                        <Database size={18} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-700 uppercase">{key}</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-sm" title={path}>{path}</p>
                      </div>
                    </div>
                    <Download size={18} className="text-slate-300 group-hover:text-blue-600" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Result Files */}
          {project.status === 'Success' && project.result_info && Object.keys(project.result_info).length > 0 && (
            <>
              <h3 className="text-sm font-bold text-brand-green uppercase tracking-wider mb-3">Analysis Results</h3>
              <div className="space-y-2">
                {Object.entries(project.result_info).map(([key, path]) => (
                  <button key={key} onClick={() => handleDownload(path)} className="w-full flex items-center justify-between p-4 border border-green-200 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all group cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 text-green-600 rounded-lg group-hover:bg-green-500 group-hover:text-white transition-colors">
                        <FileOutput size={20} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-700 uppercase">{key} File</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-sm">{path}</p>
                      </div>
                    </div>
                    <Download size={18} className="text-slate-300 group-hover:text-green-600" />
                  </button>
                ))}
              </div>
            </>
          )}

          {project.status === 'Failed' && (
             <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mt-4">
                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                <div>
                  <h4 className="text-sm font-bold text-red-700">Analysis Failed</h4>
                  <p className="text-xs text-red-600 mt-1">
                    해석 중 오류가 발생하여 결과 파일이 생성되지 않았습니다. System Console 로그를 확인해 주세요.
                  </p>
                </div>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

function UploadDropzone({ type, title, file, rowCount, onDrop, onChange }) {
  const inputRef = useRef(null);
  const isUploaded = !!file;
  return (
    <div onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => inputRef.current?.click()} className={`relative p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isUploaded ? 'border-brand-accent/50 bg-green-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'}`}>
      <input type="file" accept=".csv" className="hidden" ref={inputRef} onChange={onChange} />
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${isUploaded ? 'bg-brand-accent/20 text-brand-accent' : 'bg-slate-100 text-slate-400'}`}>{isUploaded ? <FileSpreadsheet size={24} /> : <Upload size={24} />}</div>
        <div className="flex-1"><h4 className="text-sm font-bold text-slate-700">{title}</h4><p className="text-xs text-slate-500 truncate">{isUploaded ? file.name : 'Click to upload'}</p></div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-t-lg font-bold text-sm flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap ${
        active
          ? 'bg-white text-brand-blue shadow-sm'
          : 'text-blue-200 hover:text-white hover:bg-white/10'
      }`}
    >
      <Icon size={16} /> {label}
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-blue-100 text-blue-600' : 'bg-white/20 text-white'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function DataTable({ data, emptyMsg }) {
  if (!data || data.length === 0) return <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400"><Database size={48} className="mb-4 opacity-20" /><p className="text-sm">{emptyMsg}</p></div>;
  return (
    <table className="w-full text-left text-sm font-mono whitespace-nowrap">
      <thead className="sticky top-0 bg-white shadow-sm z-10"><tr>{data[0].map((h, i) => <th key={i} className="px-6 py-3 text-slate-500 font-bold uppercase tracking-wider text-xs border-b">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{data.slice(1).map((row, i) => <tr key={i} className="hover:bg-slate-50">{row.map((cell, j) => <td key={j} className="px-6 py-2 text-slate-700">{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}