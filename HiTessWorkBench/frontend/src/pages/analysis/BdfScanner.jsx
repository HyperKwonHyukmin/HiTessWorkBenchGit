/// <summary>
/// BDF Scanner — BDF 파일 유효성 검증 및 Nastran F06 요약 페이지.
/// Route B 스코프: CSV 없이 BDF만 입력, 모델 정보/검증/F06 요약 결과를 탭으로 표시.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Play, Terminal, FileSearch, AlertTriangle, Info, FileText } from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { usePolling } from '../../hooks/usePolling';
import { requestBdfScanner, downloadFileText } from '../../api/analysis';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

export default function BdfScanner() {
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();

  const [bdfFile, setBdfFile] = useState(null);
  const [useNastran, setUseNastran] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPollingJobId, setCurrentPollingJobId] = useState(null);
  const [resultData, setResultData] = useState(null); // { ModelInfo, Validation, F06Summary }
  const [activeTab, setActiveTab] = useState('Validation');
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const lastMsgRef = useRef('');

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  usePolling({
    jobId: currentPollingJobId,
    maxRetries: 240, // Nastran 해석 시 최대 6분
    onProgress: (data) => {
      const { progress: p, message } = data;
      setProgress(p);
      if (message !== lastMsgRef.current) {
        lastMsgRef.current = message;
        setStatusMessage(message);
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: `[${p}%] ${message}`, type: 'warning' }]);
      }
    },
    onComplete: async (data) => {
      setCurrentPollingJobId(null);
      setIsRunning(false);
      setProgress(100);
      setStatusMessage('스캔 완료');
      addLog('BDF 스캔 완료.', 'success');

      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');

      if (!project?.result_info) return;

      const keyMap = {
        JSON_ModelInfo: 'ModelInfo',
        JSON_Validation: 'Validation',
        JSON_F06Summary: 'F06Summary',
      };

      const filesToLoad = Object.entries(project.result_info)
        .filter(([key]) => keyMap[key])
        .map(([key, path]) => ({ tab: keyMap[key], path }));

      if (filesToLoad.length === 0) {
        addLog('[안내] 생성된 JSON 결과 파일이 없습니다.', 'warning');
        return;
      }

      addLog(`JSON 결과 ${filesToLoad.length}건 로드 중...`, 'info');

      const parsed = {};
      await Promise.allSettled(
        filesToLoad.map(async ({ tab, path }) => {
          try {
            const res = await downloadFileText(path);
            parsed[tab] = JSON.parse(res.data);
          } catch {
            addLog(`[경고] ${tab} 결과 파일 로드 실패.`, 'error');
          }
        })
      );

      setResultData(parsed);
      // 기본 탭: Validation 우선, 없으면 ModelInfo
      setActiveTab(parsed.Validation ? 'Validation' : 'ModelInfo');
      addLog('결과 렌더링 완료.', 'success');
    },
    onError: (errData) => {
      setCurrentPollingJobId(null);
      setIsRunning(false);
      const msg = errData?.timeout ? '시간 초과 (6분). 서버 상태를 확인하세요.' : '스캔 실패.';
      addLog(msg, 'error');
    },
  });

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.bdf') && !ext.endsWith('.dat')) {
      alert('BDF 또는 DAT 파일만 업로드 가능합니다.');
      return;
    }
    setBdfFile(file);
    setResultData(null);
    setLogs([{ time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 선택됨.`, type: 'info' }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const runAnalysis = async () => {
    if (!bdfFile || isRunning) return;
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    setResultData(null);
    setLogs([]);
    lastMsgRef.current = '';

    const userStr = localStorage.getItem('user');
    const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

    const formData = new FormData();
    formData.append('bdf_file', bdfFile);
    formData.append('employee_id', employeeId);
    formData.append('use_nastran', useNastran);
    formData.append('source', 'Workbench');

    try {
      const res = await requestBdfScanner(formData);
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startGlobalJob?.(jobId, 'BDF Scanner');
      setCurrentPollingJobId(jobId);
    } catch {
      setIsRunning(false);
      addLog('서버 요청 실패.', 'error');
    }
  };

  const tabs = [
    { key: 'ModelInfo', label: 'Model Info', icon: Info },
    { key: 'Validation', label: 'Validation', icon: AlertTriangle },
    ...(useNastran ? [{ key: 'F06Summary', label: 'F06 Summary', icon: FileText }] : []),
  ];

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('File-Based Apps')}
            className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-brand-blue hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FileSearch size={22} className="text-teal-600" />
              BDF Scanner
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">BDF 모델 유효성 검증 및 Nastran F06 요약</p>
          </div>
        </div>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[360px] shrink-0 flex flex-col gap-4">
          {/* 파일 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700 mb-3">BDF 파일 선택</p>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragOver ? 'border-teal-400 bg-teal-50' : 'border-slate-300 hover:border-teal-400 hover:bg-slate-50'
              }`}
            >
              <Upload size={28} className="mx-auto mb-2 text-slate-400" />
              {bdfFile ? (
                <div>
                  <p className="text-sm font-semibold text-slate-700 truncate">{bdfFile.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{formatBytes(bdfFile.size)}</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-500">클릭하거나 파일을 드래그하세요</p>
                  <p className="text-xs text-slate-400 mt-1">.bdf / .dat</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".bdf,.dat"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {/* Nastran 옵션 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700 mb-3">해석 옵션</p>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={useNastran}
                onChange={(e) => setUseNastran(e.target.checked)}
                disabled={isRunning}
                className="mt-0.5 w-4 h-4 accent-teal-600 cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-slate-700 group-hover:text-teal-700 transition-colors">
                  Nastran 해석 실행
                </p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  BDF 검증 후 Nastran을 실행하여 F06 결과에서 오류·경고를 추출합니다.
                </p>
              </div>
            </label>
          </div>

          {/* 실행 버튼 */}
          <button
            onClick={runAnalysis}
            disabled={!bdfFile || isRunning}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
              !bdfFile || isRunning
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 text-white hover:bg-teal-700 cursor-pointer shadow-md hover:shadow-lg'
            }`}
          >
            <Play size={16} />
            {isRunning ? '스캔 실행 중...' : '스캔 실행'}
          </button>

          {/* 진행률 */}
          {(isRunning || progress > 0) && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>{statusMessage}</span>
                <span className="font-bold text-teal-600">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 오른쪽 메인 영역 */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* 결과 탭 */}
          {resultData ? (
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0">
              {/* 탭 헤더 */}
              <div className="flex border-b border-slate-200 px-4 pt-3 gap-1 shrink-0">
                {tabs.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    disabled={!resultData[key]}
                    className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      activeTab === key
                        ? 'border-teal-500 text-teal-700 bg-teal-50'
                        : resultData[key]
                        ? 'border-transparent text-slate-500 hover:text-slate-700'
                        : 'border-transparent text-slate-300 cursor-not-allowed'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                    {!resultData[key] && <span className="text-xs text-slate-300">(없음)</span>}
                  </button>
                ))}
              </div>
              {/* 탭 내용 */}
              <div className="flex-1 overflow-auto p-4 min-h-0">
                {resultData[activeTab] ? (
                  <pre className="text-xs font-mono text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                    {JSON.stringify(resultData[activeTab], null, 2)}
                  </pre>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                    결과 없음
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center">
              <div className="text-center text-slate-400">
                <FileSearch size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">BDF 파일을 업로드하고 스캔을 실행하세요.</p>
              </div>
            </div>
          )}

          {/* 실행 콘솔 */}
          {logs.length > 0 && (
            <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4 h-44 shrink-0 overflow-y-auto">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={14} className="text-slate-400" />
                <span className="text-xs text-slate-400 font-mono">Console</span>
              </div>
              {logs.map((log, i) => (
                <p key={i} className={`text-xs font-mono leading-relaxed ${LOG_COLORS[log.type] || 'text-slate-300'}`}>
                  <span className="text-slate-500 mr-2">{log.time}</span>
                  {log.message}
                </p>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
