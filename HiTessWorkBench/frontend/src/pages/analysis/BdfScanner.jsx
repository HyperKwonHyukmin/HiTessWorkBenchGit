/// <summary>
/// BDF Scanner — BDF 파일 유효성 검증 및 Nastran F06 요약 페이지.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Play, Terminal, FileSearch, AlertOctagon, Info, History } from 'lucide-react';
import ChangelogModal from '../../components/ui/ChangelogModal';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { usePolling } from '../../hooks/usePolling';
import { requestBdfScanner, downloadFileText } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import SolverCredit from '../../components/ui/SolverCredit';
import BdfModelViewer from '../../components/analysis/BdfModelViewer';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

export default function BdfScanner() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();
  const [changelogOpen, setChangelogOpen] = useState(false);

  const [bdfFile, setBdfFile] = useState(null);
  const [useNastran, setUseNastran] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPollingJobId, setCurrentPollingJobId] = useState(null);
  const [modelData, setModelData] = useState(null);
  const [step1Data, setStep1Data] = useState(null);
  const [step2Data, setStep2Data] = useState(null);
  const [unsupportedElements, setUnsupportedElements] = useState(null); // { CQUAD4: 3, ... }
  const [isDragOver, setIsDragOver] = useState(false);

  // 2D / 3D 요소 카드 타입 목록
  const UNSUPPORTED_TYPES = new Set([
    'CQUAD4','CQUAD8','CQUADR','CTRIA3','CTRIA6','CTRIAR', // 2D Shell
    'CHEXA','CTETRA','CPENTA','CPYRAM','CHEXA20','CTETRA10', // 3D Solid
  ]);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const lastMsgRef = useRef('');

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  usePolling({
    jobId: currentPollingJobId,
    maxRetries: 240,
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

      const result_info = project.result_info;
      addLog('JSON 결과 로드 중...', 'info');

      await Promise.allSettled(
        Object.entries(result_info).map(async ([key, path]) => {
          if (!path) return;
          try {
            const res = await downloadFileText(path);
            const parsed = JSON.parse(res.data);

            const isStep1 = key === 'JSON_Validation' || path.endsWith('_validation_step1.json');
            const isStep2 = key === 'JSON_F06Summary'  || path.endsWith('_validation_step2.json');
            const isModel = key === 'JSON_ModelInfo'   || (!isStep1 && !isStep2 && path.endsWith('.json'));

            if (isStep1) {
              setStep1Data(parsed);
            } else if (isStep2) {
              setStep2Data(parsed);
            } else if (isModel && parsed.grids && parsed.elements) {
              // 2D/3D 요소 감지
              const found = {};
              parsed.elements.forEach(el => {
                if (UNSUPPORTED_TYPES.has(el.cardType)) {
                  found[el.cardType] = (found[el.cardType] || 0) + 1;
                }
              });
              if (Object.keys(found).length > 0) {
                setUnsupportedElements(found);
                addLog(`[경고] 지원하지 않는 2D/3D 요소 감지: ${Object.entries(found).map(([k,v]) => `${k}(${v})`).join(', ')}`, 'error');
              } else {
                setModelData(parsed);
              }
            }
          } catch {
            addLog(`[경고] ${key} 결과 파일 로드 실패.`, 'error');
          }
        })
      );

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
      showToast('BDF 또는 DAT 파일만 업로드 가능합니다.', 'warning');
      return;
    }
    setBdfFile(file);
    setModelData(null);
    setStep1Data(null);
    setStep2Data(null);
    setUnsupportedElements(null);
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
    setModelData(null);
    setStep1Data(null);
    setStep2Data(null);
    setUnsupportedElements(null);
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

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasResult = !!(modelData || step1Data || step2Data);
  const hasUnsupported = !!(unsupportedElements && Object.keys(unsupportedElements).length > 0);

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-teal-900 to-teal-700 overflow-hidden shrink-0">
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
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <FileSearch size={18} className="text-teal-300" />
                BDF Scanner
              </h1>
              <p className="text-sm text-teal-200/80 mt-0.5">BDF 모델 유효성 검증 및 Nastran F06 요약</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setChangelogOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer">
              <History size={14} /> 이력
            </button>
            <GuideButton guideTitle="[생산성] BDF Scanner — BDF 파일 유효성 검증" variant="dark" />
          </div>
        </div>
      </div>

      {/* ── 1D 전용 안내 배너 ── */}
      <div className="flex items-start gap-3 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl shrink-0">
        <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700 leading-relaxed">
          <span className="font-bold">현재 1D 요소만 지원합니다</span>
          {' — '}CBEAM, CBAR, CROD, RBE2, CONM2 기반 모델에 대해 검증합니다.
          <span className="text-amber-500 ml-1">2D Shell / 3D Solid 요소 지원은 향후 구현 예정입니다.</span>
        </div>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[360px] shrink-0 flex flex-col gap-4">
          {/* 파일 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-teal-700 to-teal-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">BDF 파일 선택</p>
            </div>
            <div className="p-5">
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
          </div>

          {/* 해석 옵션 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">해석 옵션</p>
            </div>
            <div className="p-5">
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
                    <br />
                    <span className="text-teal-600 font-medium">Step 1 + Step 2</span> 결과가 모두 표시됩니다.
                  </p>
                </div>
              </label>
              {!useNastran && (
                <p className="mt-3 text-[11px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  미체크 시 <span className="font-medium text-slate-600">Step 1</span> (BDF 기본 검토)만 실행됩니다.
                </p>
              )}
            </div>
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
          {/* 3D 모델 뷰어 */}
          <div className="flex-1 rounded-2xl border overflow-hidden min-h-0"
               style={{ minHeight: '280px', borderColor: hasUnsupported ? '#7f1d1d' : '#334155' }}>
            {hasUnsupported ? (
              <div className="bg-red-950/80 flex flex-col items-center justify-center h-full gap-4 px-8">
                <AlertOctagon size={48} className="text-red-400" />
                <div className="text-center">
                  <p className="text-base font-bold text-red-300 mb-1">지원하지 않는 요소 감지 — 시각화 불가</p>
                  <p className="text-xs text-red-400/80 mb-3">
                    이 BDF에는 현재 지원하지 않는 2D Shell / 3D Solid 요소가 포함되어 있습니다.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {Object.entries(unsupportedElements).map(([type, count]) => (
                      <span key={type} className="bg-red-900/60 border border-red-700 text-red-200 text-xs font-mono px-3 py-1 rounded-lg">
                        {type}: {count}개
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-4">
                    2D/3D 요소 지원은 향후 구현 예정입니다. 현재는 1D 전용 모델만 사용 가능합니다.
                  </p>
                </div>
              </div>
            ) : modelData ? (
              <BdfModelViewer modelData={modelData} />
            ) : (
              <div className="bg-slate-900 flex items-center justify-center h-full">
                <div className="text-center text-slate-600">
                  <FileSearch size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">스캔 완료 후 3D 모델이 표시됩니다.</p>
                </div>
              </div>
            )}
          </div>

          {/* 검증 결과 로그 또는 실행 콘솔 */}
          <div className="flex-1 min-h-0" style={{ minHeight: '220px' }}>
            {hasResult ? (
              <ValidationStepLog
                step1Data={step1Data}
                step2Data={step2Data}
                useNastran={useNastran}
              />
            ) : logs.length > 0 ? (
              <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4 h-full overflow-y-auto">
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
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center h-full">
                <div className="text-center text-slate-400">
                  <FileSearch size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">BDF 파일을 업로드하고 스캔을 실행하세요.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <SolverCredit contributor="권혁민" />
      <ChangelogModal programKey="BdfScanner" title="BDF Scanner" isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
