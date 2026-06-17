/// <summary>
/// HP-SCR 배관응력 해석 — BDF 업로드 + PSA/POR 양자 선택 + 3D 뷰어 + XLSX 다운로드.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Terminal, Pipette, Info, Download, RotateCcw } from 'lucide-react';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import {
  requestHpscrAssessment,
  downloadFileText,
  downloadFileBlob,
} from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import SolverCredit from '../../components/ui/SolverCredit';
import BdfModelViewer from '../../components/analysis/BdfModelViewer';
import { buildFormData } from '../../utils/fileHelper';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import JobProgressPanel from '../../components/analysis/JobProgressPanel';
import {
  parseSpcCardsFromBdf,
  parseCbushFromBdf,
  parseForcesFromBdf,
} from '../../utils/bdfPipeParsers';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

const ANALYSIS_MODES = [
  { value: 'POR', label: 'POR', desc: '열변형 해석 (Exp.Joint 발주용)' },
  { value: 'PSA', label: 'PSA', desc: '배관응력 해석' },
];

const MODE_BUTTON_LABEL = {
  PSA: '배관응력 해석',
  POR: '열변형 해석',
};

export default function HpScrAssessment() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const { startGlobalJob, clearGlobalJob } = dashboardCtx;
  const PAGE_KEY = 'HP-SCR 배관응력 해석';
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};

  const [bdfFile, setBdfFile] = useState(savedPageState.bdfFile ?? null);
  const [analysisMode, setAnalysisMode] = useState(savedPageState.analysisMode ?? 'POR');
  const [modelData, setModelData] = useState(savedPageState.modelData ?? null);
  const [reportPath, setReportPath] = useState(savedPageState.reportPath ?? null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);

  // 작업 상태(jobId/isRunning/progress/statusMessage/logs) + 사번 + 폴링은 훅이 담당.
  // success/error 메시지에 analysisMode 가 들어가므로 콜백에서 직접 addLog 한다.
  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob,
    setLogs, setStatusMessage, setIsRunning, setProgress, setJobId,
  } = useAnalysisJob({
    startGlobalJob,
    clearGlobalJob,
    savedState: savedPageState,
    setSavedState: (patch) => dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, patch),
    pollingMaxRetries: 400, // 약 10분
    successLogMessage: '', // 동적 메시지 — onComplete 에서 직접 addLog
    errorLogMessage: '',   // 동적 메시지 — onError 에서 직접 addLog
    timeoutLogMessage: '시간 초과. 서버 상태를 확인하세요.',
    onComplete: async (data) => {
      setStatusMessage('해석 완료');

      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');
      addLog(`HP-SCR ${analysisMode} 해석 완료.`, 'success');

      const result_info = project?.result_info || {};
      if (result_info.XLSX_Report) {
        setReportPath(result_info.XLSX_Report);
        addLog('결과 XLSX 파일 준비 완료.', 'success');
      } else {
        addLog('[경고] 결과 XLSX 파일이 생성되지 않았습니다.', 'error');
      }

      // 3D 뷰어용 모델 JSON 로드 + BDF 의 SPC 카드 파싱하여 boundaryConditions 주입
      if (result_info.JSON_ModelInfo) {
        try {
          const res = await downloadFileText(result_info.JSON_ModelInfo);
          const parsed = JSON.parse(res.data);
          if (parsed?.grids && parsed?.elements) {
            // FemScanner 가 채우지 못한 SPC / CBUSH / FORCE / TEMP 정보를 BDF 원본에서 보강
            if (result_info.bdf) {
              try {
                const bdfRes = await downloadFileText(result_info.bdf);
                const bdfText = bdfRes.data;
                const spcs   = parseSpcCardsFromBdf(bdfText);
                const cbushs = parseCbushFromBdf(bdfText);
                const forces = parseForcesFromBdf(bdfText);
                if (spcs.length > 0) parsed.boundaryConditions = spcs;
                if (cbushs.length > 0) {
                  const existingCbushIds = new Set(
                    (parsed.elements || [])
                      .filter(e => e.cardType === 'CBUSH')
                      .map(e => e.id)
                  );
                  const additions = cbushs.filter(c => !existingCbushIds.has(c.id));
                  if (additions.length > 0) {
                    parsed.elements = [...(parsed.elements || []), ...additions];
                  }
                }
                if (forces.length > 0) parsed.forces = forces;
                addLog(
                  `BDF 보강 완료 — SPC ${spcs.length} · CBUSH ${cbushs.length} · FORCE ${forces.length}`,
                  'success'
                );
              } catch {
                addLog('[경고] BDF 보강 파싱 실패.', 'warning');
              }
            }
            setModelData(parsed);
            addLog('3D 모델 로드 완료.', 'success');
          }
        } catch {
          addLog('[경고] 모델 JSON 로드 실패.', 'error');
        }
      }
    },
    onError: (errData) => {
      setStatusMessage('해석 실패');
      if (errData?.engine_log) addLog(`[SOLVER] ${errData.engine_log.trim()}`, 'info');
      // 타임아웃은 훅이 자동 로그(timeoutLogMessage). 그 외는 mode 가 들어간 동적 메시지.
      if (!errData?.timeout) addLog(`HP-SCR ${analysisMode} 해석 실패.`, 'error');
    },
  });

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      bdfFile, analysisMode, modelData, reportPath,
    });
  }, [bdfFile, analysisMode, modelData, reportPath]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.bdf') && !ext.endsWith('.dat')) {
      showToast('BDF 또는 DAT 파일만 업로드 가능합니다.', 'warning');
      return;
    }
    setBdfFile(file);
    setModelData(null);
    setReportPath(null);
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
    setReportPath(null);
    setLogs([]);

    const formData = buildFormData({
      bdf_file: bdfFile,
      employee_id: employeeId,
      analysis_mode: analysisMode,
      source: 'Workbench',
        });
    try {
      const res = await requestHpscrAssessment(formData);
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, 'HP-SCR 배관응력 해석');
    } catch {
      setIsRunning(false);
      addLog('서버 요청 실패.', 'error');
    }
  };

  // 샘플 실행 콜백 — SampleRunButton 이 호출. analysisMode(PSA/POR)를 그대로 백엔드로 넘김.
  const sampleHpscrBefore = () => {
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('샘플 파일로 작업 요청 중...');
    setModelData(null);
    setReportPath(null);
    setLogs([{ time: new Date().toLocaleTimeString(), message: `[SAMPLE] 사내 표준 ${analysisMode} BDF로 해석 요청`, type: 'info' }]);
  };
  const sampleHpscrSubmitted = (jobId) => {
    addLog(`[JOB] Sample 작업 등록 완료. (Job ID: ${jobId})`, 'success');
    startJob(jobId, 'HP-SCR 배관응력 해석');
  };
  const sampleHpscrError = (st, detail) => {
    setIsRunning(false);
    if (st === 429) {
      addLog('Sample run rejected — daily limit reached.', 'warning');
    } else {
      addLog(`샘플 실행 실패: ${detail}`, 'error');
    }
  };

  const handleReset = () => {
    if (isRunning) return;
    setBdfFile(null);
    setAnalysisMode('POR');
    setProgress(0);
    setStatusMessage('');
    setLogs([]);
    setJobId(null);
    setModelData(null);
    setReportPath(null);
    setIsDragOver(false);
    setIsDownloading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    dashboardCtx?.clearAnalysisPageState?.(PAGE_KEY);
  };

  const handleDownloadReport = async () => {
    if (!reportPath || isDownloading) return;
    setIsDownloading(true);
    try {
      const res = await downloadFileBlob(reportPath);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'HP-SCR-PSA-REPORT.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast('결과 파일 다운로드에 실패했습니다.', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <FileBasedPageBanner
        title="HP-SCR 배관응력 해석"
        subtitle="배관 BDF 기반 배관응력 · 열변형 해석"
        icon={Pipette}
        guideTitle="[파일] HP-SCR 배관응력 해석 — 사용 안내"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* ── 안내 배너 ── */}
      <div className="flex items-start gap-3 mb-4 px-4 py-3 bg-sky-50 border border-sky-200 rounded-xl shrink-0">
        <Info size={16} className="text-sky-500 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-700 leading-relaxed">
          <span className="font-bold">배관 BDF 모델을 업로드하고 해석 종류를 선택하세요.</span>
          {' — '}배관응력 해석(PSA) 또는 열변형 해석(POR)을 선택할 수 있으며,
          공통적으로 <code className="font-mono bg-sky-100 px-1 rounded">HP-SCR-PSA-REPORT.xlsx</code> 결과 리포트가 생성됩니다.
        </div>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[360px] shrink-0 flex flex-col gap-4">
          {/* 파일 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-sky-700 to-sky-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">BDF 파일 선택</p>
            </div>
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-300 hover:border-sky-400 hover:bg-slate-50'
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

          {/* 해석 종류 선택 (PSA / POR) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">해석 종류</p>
            </div>
            <div className="p-5 flex flex-col gap-2.5">
              {ANALYSIS_MODES.map(opt => {
                const checked = analysisMode === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      checked ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'
                    } ${isRunning ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="hpscr-mode"
                      value={opt.value}
                      checked={checked}
                      onChange={() => setAnalysisMode(opt.value)}
                      disabled={isRunning}
                      className="mt-0.5 w-4 h-4 accent-sky-600 cursor-pointer"
                    />
                    <div>
                      <p className={`text-sm font-bold ${checked ? 'text-sky-700' : 'text-slate-700'}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 초기화 버튼 */}
          <button
            onClick={handleReset}
            disabled={isRunning}
            className={`w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all border ${
              isRunning
                ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 hover:text-slate-800 cursor-pointer'
            }`}
          >
            <RotateCcw size={15} />
            초기화
          </button>

          {/* 샘플 실행 — 입력 BDF 없이도 현재 선택된 모드(PSA/POR)로 학습용 해석 체험 */}
          <SampleRunButton
            appKey="hpscr"
            params={{ mode: analysisMode }}
            disabled={isRunning}
            onBeforeRun={sampleHpscrBefore}
            onJobSubmitted={sampleHpscrSubmitted}
            onError={sampleHpscrError}
            label={`샘플 ${analysisMode}로 한 번 돌려보기`}
          />

          {/* 실행 버튼 */}
          <button
            onClick={runAnalysis}
            disabled={!bdfFile || isRunning}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
              !bdfFile || isRunning
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-sky-600 text-white hover:bg-sky-700 cursor-pointer shadow-md hover:shadow-lg'
            }`}
          >
            <Play size={16} />
            {isRunning ? '해석 실행 중...' : MODE_BUTTON_LABEL[analysisMode] || '해석 실행'}
          </button>

          {/* 진행률 */}
          {(isRunning || progress > 0) && (
            <JobProgressPanel message={statusMessage} progress={progress} tone="sky" />
          )}

          {/* 결과 다운로드 */}
          {reportPath && (
            <button
              onClick={handleDownloadReport}
              disabled={isDownloading}
              className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                isDownloading
                  ? 'bg-emerald-100 text-emerald-400 cursor-wait'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer shadow-md hover:shadow-lg'
              }`}
            >
              <Download size={16} />
              {isDownloading ? '다운로드 중...' : 'HP-SCR-PSA-REPORT.xlsx 다운로드'}
            </button>
          )}
        </div>

        {/* 오른쪽 메인 영역 */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* 3D 모델 뷰어 */}
          <div className="flex-1 rounded-2xl border border-slate-700 overflow-hidden min-h-0" style={{ minHeight: '320px' }}>
            {modelData ? (
              <BdfModelViewer modelData={modelData} pipeMode />
            ) : (
              <div className="bg-slate-900 flex items-center justify-center h-full">
                <div className="text-center text-slate-600">
                  <Pipette size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">해석 완료 후 3D 모델이 표시됩니다.</p>
                </div>
              </div>
            )}
          </div>

          {/* 실행 콘솔 */}
          <div className="min-h-0" style={{ height: '220px' }}>
            {logs.length > 0 ? (
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
                  <Pipette size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">BDF 파일을 업로드하고 해석을 실행하세요.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <SolverCredit contributor="김윤환" />
    </div>
  );
}
