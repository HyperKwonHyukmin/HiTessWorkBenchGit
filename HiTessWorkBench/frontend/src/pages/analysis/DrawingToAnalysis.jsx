/// <summary>
/// DrawingToAnalysis — 설계 도면(PDF) → 구조 해석 모델 변환.
/// </summary>
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowLeft, Upload, Play, FileText, Info, Construction, CheckCircle2, RefreshCw, Download, RotateCcw, AlertCircle, Lightbulb, FileSearch } from 'lucide-react';
import PageBanner from '../../components/ui/PageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import { requestDrawingToAnalysis, downloadFileBlob, runDrawingCatalogue } from '../../api/analysis';
import ShellModelViewer from '../../components/analysis/ShellModelViewer';
import DrawingCatalogueModal from '../../components/analysis/DrawingCatalogueModal';
import DrawingParamsPanel from '../../components/analysis/DrawingParamsPanel';

/** 파일명 / 카테고리에서 lug/support 모드 결정 — 백엔드 분류 규칙과 동일 */
const resolveDrawingMode = (categoryOrFilename) => {
  const s = String(categoryOrFilename || '').toLowerCase();
  if (s.includes('support') || s.startsWith('bs_') || s.startsWith('bs.') || s === 'bs') return 'support';
  return 'lug';
};

/** mode 별 기본 mesh size — Support 는 30, Lug 는 10 */
const defaultMeshSize = (mode) => (mode === 'support' ? 30.0 : 10.0);

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DrawingToAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob, clearGlobalJob } = useDashboard();
  const { showToast } = useToast();
  const [pdfFile, setPdfFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resultInfo, setResultInfo] = useState(null);
  const [analysisDbId, setAnalysisDbId] = useState(null);
  const [modelData, setModelData] = useState(null);
  const [modelLoadError, setModelLoadError] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [paramsJson, setParamsJson] = useState(null);
  const [modelMode,  setModelMode]  = useState('lug'); // 'lug' | 'support'
  const [highlightedParam, setHighlightedParam] = useState(null);
  const fileInputRef = useRef(null);

  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob,
    reset, setLogs, setStatusMessage, setIsRunning, setProgress,
  } = useAnalysisJob({
    startGlobalJob,
    pollingMaxRetries: 400,
    successLogMessage: 'BDF 변환 완료.',
    errorLogMessage: '',          // 단순 한 줄 메시지 비활성 — onError 에서 상세 출력
    timeoutLogMessage: '시간 초과 (10분). PDF 또는 서버 상태를 확인하세요.',
    onComplete: async (data) => {
      setStatusMessage('변환 완료');
      setFailureReason('');
      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');
      if (project?.result_info) {
        setResultInfo(project.result_info);
        setAnalysisDbId(project.id);
      }
    },
    onError: (errData) => {
      // 타임아웃은 useAnalysisJob 이 timeoutLogMessage 로 이미 처리
      if (errData?.timeout) {
        setFailureReason('처리 시간이 초과되었습니다 (10분). PDF 또는 서버 상태를 확인하세요.');
        return;
      }
      const engineLog = errData?.engine_log || '';
      const project   = errData?.project;
      // 백엔드가 합성한 '🚫 변환 실패 — ...' 헤더를 그대로 노출
      const firstLine = engineLog.split('\n').find((l) => l.trim()) || 'BDF 변환에 실패했습니다.';
      setFailureReason(firstLine.replace(/^🚫\s*변환\s*실패\s*—\s*/, ''));
      // 엔진 로그 본문은 각 줄을 분리해서 차례대로 로그에 출력 (사용자가 원인 파악 가능)
      if (engineLog) {
        engineLog.split('\n').forEach((line) => {
          const t = line.trim();
          if (!t) return;
          const level = /\[error\]|🚫|failed/i.test(t) ? 'error'
                      : /\[warning\]|warning/i.test(t) ? 'warning'
                      : 'info';
          addLog(t, level);
        });
      } else {
        addLog('서버에서 추가 메시지를 받지 못했습니다.', 'error');
      }
      // 실패 시에도 diagnostic.json 등 진단 파일을 다운로드 가능하게 노출
      if (project?.result_info) {
        setResultInfo(project.result_info);
        setAnalysisDbId(project.id);
      }
    },
  });

  const resetDrawingPage = () => {
    reset();
    clearGlobalJob();
    setPdfFile(null);
    setIsDragOver(false);
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    setModelMode('lug');
    setHighlightedParam(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      showToast('PDF 파일만 업로드 가능합니다.', 'error');
      return;
    }
    const mode = resolveDrawingMode(file.name);
    setPdfFile(file);
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    setModelMode(mode);
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: `[FILE] ${file.name} 선택됨. (mode=${mode})`,
      type: 'info',
    }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleRun = async () => {
    if (!pdfFile || isRunning) return;
    const mode = resolveDrawingMode(pdfFile.name);
    const meshSize = defaultMeshSize(mode);
    setModelMode(mode);
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    setLogs([]);

    const formData = new FormData();
    formData.append('pdf_file', pdfFile);
    formData.append('employee_id', employeeId);
    formData.append('mesh_size', String(meshSize));
    formData.append('source', 'Workbench');
    formData.append('mode', mode);

    try {
      const res = await requestDrawingToAnalysis(formData);
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, 'DrawingToAnalysis');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (err?.message || '요청 실패');
      setIsRunning(false);
      addLog(`서버 요청 실패: ${msg}`, 'error');
      showToast(`요청 실패: ${msg}`, 'error');
    }
  };

  /** 카탈로그 모달에서 PDF 선택 → 카탈로그 변환 API 호출 */
  const handleCatalogueSelect = async (filename, category) => {
    if (!filename || isRunning) return;
    const mode = resolveDrawingMode(category || filename);
    const meshSize = defaultMeshSize(mode);
    setPdfFile(null);
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    setModelMode(mode);
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: `[CATALOGUE] '${filename}' 선택됨. (mode=${mode}, mesh_size=${meshSize})`,
      type: 'info',
    }]);
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');

    try {
      const res = await runDrawingCatalogue(filename, { employeeId, meshSize });
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, 'DrawingToAnalysis');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (err?.message || '요청 실패');
      setIsRunning(false);
      addLog(`서버 요청 실패: ${msg}`, 'error');
      showToast(`카탈로그 변환 요청 실패: ${msg}`, 'error');
    }
  };

  const downloadResult = async (path) => {
    if (!path) return;
    try {
      const res = await downloadFileBlob(path);
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = path.split(/[\\/]/).pop() || 'drawing-to-analysis-result';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      showToast('파일 다운로드 실패', 'error');
    }
  };

  const resultEntries = resultInfo
    ? Object.entries(resultInfo).filter(([, path]) => typeof path === 'string' && path)
    : [];

  useEffect(() => {
    const loadModelJson = async () => {
      if (!resultInfo?.model_json) {
        setModelData(null);
        setModelLoadError('');
        return;
      }
      try {
        setModelLoadError('');
        const res = await downloadFileBlob(resultInfo.model_json);
        const text = await res.data.text();
        setModelData(JSON.parse(text));
      } catch (error) {
        setModelData(null);
        setModelLoadError(error?.message || '모델 JSON 로드 실패');
      }
    };
    loadModelJson();
  }, [resultInfo?.model_json]);

  // 설계 파라미터 JSON 자동 로드 (변환/재구축 완료 시)
  useEffect(() => {
    const path = resultInfo?.params_json;
    if (!path) {
      setParamsJson(null);
      return;
    }
    (async () => {
      try {
        const res = await downloadFileBlob(path);
        const text = await res.data.text();
        setParamsJson(JSON.parse(text));
      } catch {
        setParamsJson(null);
      }
    })();
  }, [resultInfo?.params_json]);

  /** 모델 재구축 시작 → 동일한 폴링 흐름 재사용 */
  const handleRebuildStarted = (jobId) => {
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('재구축 작업 요청됨...');
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    addLog(`[REBUILD] 새 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
    startJob(jobId, 'DrawingRebuild');
  };

  /** Support 재구축에 필요한 원본 PDF 경로
   *  → 백엔드가 work_dir(=재구축의 parent) 안에서 자동 탐색하므로 frontend 는 null 만 보낸다.
   */
  const originalPdfPath = null;

  /** 작업 폴더 (재구축 요청에 필요) */
  /** 작업 폴더 = 결과 파일 경로의 dirname.
   *  재구축 결과는 <원본>/rebuild_<ts>/ 인데, 그 안의 BDF dirname 을 또 work_dir 로 쓰면
   *  중첩(<원본>/rebuild_a/rebuild_b/) 이 되므로 마지막 /rebuild_.../ 세그먼트는 제거.
   */
  const workDir = useMemo(() => {
    const probe = resultInfo?.bdf || resultInfo?.params_json || resultInfo?.diagnostic_json;
    if (!probe) return null;
    let dir = probe.replace(/[\\/][^\\/]+$/, '');
    // 끝이 /rebuild_<timestamp> 이면 한 단계 위로
    dir = dir.replace(/[\\/]rebuild_\d{8}_\d{6}$/, '');
    return dir;
  }, [resultInfo?.bdf, resultInfo?.params_json, resultInfo?.diagnostic_json]);

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <PageBanner gradient="from-brand-blue via-blue-900 to-blue-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('File-Based Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <FileText size={18} className="text-blue-300" />
              Drawing to Analysis
            </h1>
            <p className="text-sm text-blue-200/80 mt-0.5">설계 도면(PDF)을 구조 해석 BDF 모델로 변환</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetDrawingPage}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} /> 초기화
          </button>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/25 border border-emerald-300/50 text-emerald-100 text-[11px] font-bold">
            <CheckCircle2 size={12} /> LUG / Support
          </span>
        </div>
      </PageBanner>

      {/* 지원 범위 안내 */}
      <div className="flex items-start gap-2.5 mb-4 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl shrink-0">
        <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          <span className="font-bold">지원 범위</span>
          {' — '}LUG 및 Block Support 도면(벡터 PDF)을 rule-based 파이프라인으로 파싱하여 shell BDF를 생성합니다.
          DRM 적용 또는 스캔 이미지 PDF는 지원하지 않습니다.
        </p>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[340px] shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">

          {/* 카탈로그 + 업로드를 하나의 입력 카드로 통합 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* 섹션 1: 카탈로그 */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">샘플 카탈로그</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5 pl-3.5">
                서버에 등록된 표준 도면 PDF를 선택해 바로 변환합니다.
              </p>
              <button
                type="button"
                onClick={() => setCatalogueOpen(true)}
                disabled={isRunning}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed text-violet-700 text-xs font-bold transition-colors cursor-pointer"
              >
                <FileSearch size={13} /> 카탈로그 열기
              </button>
            </div>

            <div className="mx-4 border-t border-slate-100" />

            {/* 섹션 2: 직접 업로드 */}
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">도면 PDF 직접 업로드</span>
              </div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl py-5 px-4 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-blue-400 bg-blue-50'
                    : pdfFile
                    ? 'border-blue-300 bg-blue-50/50'
                    : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <Upload size={22} className={`mx-auto mb-1.5 ${pdfFile ? 'text-blue-400' : 'text-slate-300'}`} />
                {pdfFile ? (
                  <div>
                    <p className="text-xs font-semibold text-blue-700 truncate px-2">{pdfFile.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatBytes(pdfFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-slate-500">클릭하거나 PDF를 드래그하세요</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">.pdf 파일</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {pdfFile && (
                <button
                  type="button"
                  onClick={() => { setPdfFile(null); setResultInfo(null); setAnalysisDbId(null); }}
                  disabled={isRunning}
                  className="mt-1.5 w-full text-[11px] text-slate-400 hover:text-rose-500 font-semibold transition-colors disabled:opacity-50"
                >
                  파일 제거
                </button>
              )}
            </div>
          </div>

          {/* 초기화 + 실행 — 사이드바 내 고정 접근 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetDrawingPage}
              disabled={isRunning}
              title="페이지 상태를 처음처럼 초기화"
              className="shrink-0 px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCcw size={13} /> 초기화
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={!pdfFile || isRunning}
              title={!pdfFile ? 'PDF 파일을 먼저 선택하거나 카탈로그에서 선택하세요' : 'PDF를 해석 모델로 변환'}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                !pdfFile || isRunning
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md hover:shadow-lg'
              }`}
            >
              {isRunning ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
              {isRunning ? '변환 중...' : '해석 모델 변환'}
            </button>
          </div>

          {/* 진행률 표시 — 실행 중일 때만 */}
          {isRunning && (
            <div className="bg-slate-900 rounded-2xl border border-slate-700 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                  <RefreshCw size={10} className="animate-spin text-blue-400" />
                  진행 중...
                </span>
                <span className="text-[10px] font-mono text-blue-400 font-bold">{progress}%</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all rounded-full" style={{ width: `${progress}%` }} />
              </div>
              {statusMessage && (
                <p className="mt-2 text-[10px] text-sky-300 font-mono truncate">{statusMessage}</p>
              )}
            </div>
          )}

          {/* 설계 파라미터 패널 */}
          {paramsJson && workDir && (
            <DrawingParamsPanel
              params={paramsJson}
              mode={modelMode}
              workDir={workDir}
              originalPdfPath={originalPdfPath}
              employeeId={employeeId}
              onRebuildStarted={handleRebuildStarted}
              onFieldFocus={setHighlightedParam}
              highlightedKey={highlightedParam}
              disabled={isRunning}
            />
          )}
        </div>

        {/* 오른쪽 본문 영역 */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center overflow-hidden">
          {failureReason ? (
            <FailurePanel
              reason={failureReason}
              resultEntries={resultEntries}
              analysisDbId={analysisDbId}
              onDownload={downloadResult}
              onReset={resetDrawingPage}
            />
          ) : resultInfo ? (
            <div className="w-full h-full flex flex-col min-h-0">
              {/* 변환 완료 헤더 — 정보 밀도 개선 */}
              <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-800">변환 완료</h2>
                      {analysisDbId && (
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                          ID {analysisDbId}
                        </span>
                      )}
                      {modelMode && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          modelMode === 'support'
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {modelMode}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {modelData
                        ? `Shell 요소 모델 렌더링 완료 — 좌측 파라미터 편집 후 재구축 가능`
                        : '모델 JSON을 불러오는 중입니다...'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {resultEntries.filter(([key]) => ['bdf', 'model_json'].includes(key)).map(([key, path]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => downloadResult(path)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-bold transition-colors"
                      title={`${key} 다운로드`}
                    >
                      <Download size={12} /> {key === 'bdf' ? 'BDF' : 'JSON'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {modelLoadError ? (
                  <div className="h-full flex items-center justify-center text-sm text-rose-500 gap-2">
                    <AlertCircle size={16} />
                    {modelLoadError}
                  </div>
                ) : (
                  <ShellModelViewer
                    modelData={modelData}
                    paramsJson={paramsJson}
                    mode={modelMode}
                    highlightParam={highlightedParam}
                  />
                )}
              </div>
            </div>
          ) : (
            /* 빈 상태 */
            <div className="text-center px-8 py-12 max-w-sm">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 mb-5">
                <Construction size={26} className="text-blue-500" />
              </div>
              <h2 className="text-base font-bold text-slate-700 mb-2">PDF를 선택하고 변환을 실행하세요</h2>
              <p className="text-xs text-slate-500 leading-relaxed mb-5">
                좌측 <span className="font-semibold text-violet-600">카탈로그</span>에서 표준 도면을 둘러보거나,
                직접 PDF를 업로드한 뒤 변환을 시작하세요.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                <div className="flex items-start gap-1.5 bg-slate-50 rounded-lg p-2.5 text-left">
                  <FileSearch size={12} className="text-violet-400 shrink-0 mt-0.5" />
                  <span>카탈로그에서<br />표준 도면 선택</span>
                </div>
                <div className="flex items-start gap-1.5 bg-slate-50 rounded-lg p-2.5 text-left">
                  <Upload size={12} className="text-blue-400 shrink-0 mt-0.5" />
                  <span>로컬 PDF<br />직접 업로드</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <DrawingCatalogueModal
        isOpen={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        onSelect={handleCatalogueSelect}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   변환 실패 패널 — 사용자 친화 메시지 + 해결책 + 진단 파일 다운로드
   ──────────────────────────────────────────────────────────────────────── */

function FailurePanel({ reason, resultEntries, analysisDbId, onDownload, onReset }) {
  const diagnostic = resultEntries.find(([k]) => k === 'diagnostic_json');
  const reasonText = reason || 'BDF 변환에 실패했습니다.';
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="px-5 py-3 border-b border-rose-100 flex items-center justify-between shrink-0 bg-gradient-to-r from-rose-50 to-orange-50">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100">
            <AlertCircle size={19} className="text-rose-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-rose-700">변환 실패</h2>
            <p className="text-[11px] text-rose-500 mt-0.5">서버에서 PDF → BDF 변환을 완료하지 못했습니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {analysisDbId && <span className="text-[11px] text-slate-400 font-mono">ID {analysisDbId}</span>}
          {diagnostic && (
            <button
              type="button"
              onClick={() => onDownload(diagnostic[1])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-100 text-rose-700 text-[11px] font-bold transition-colors"
              title="진단 정보 다운로드 (관리자 분석용)"
            >
              <Download size={13} /> diagnostic.json
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-bold transition-colors"
          >
            <RotateCcw size={13} /> 다시 시도
          </button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-[11px] font-bold text-rose-500 uppercase tracking-widest mb-1">실패 사유</p>
          <p className="text-sm font-semibold text-rose-700 leading-relaxed">{reasonText}</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={14} className="text-amber-600" />
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest">조치 방법</p>
          </div>
          <ul className="text-xs text-amber-900 leading-relaxed space-y-1.5">
            <li className="flex gap-2"><span className="text-amber-500">①</span>
              <span><b>DRM/보안 PDF</b>는 변환할 수 없습니다. 회사 DRM이 적용된 PDF는 해제 후 다시 업로드하세요.</span>
            </li>
            <li className="flex gap-2"><span className="text-amber-500">②</span>
              <span><b>스캔 이미지 PDF</b>는 지원하지 않습니다. 원본 CAD에서 출력된 <b>벡터 형식</b> PDF를 사용하세요.</span>
            </li>
            <li className="flex gap-2"><span className="text-amber-500">③</span>
              <span>현재 지원되는 <b>LUG 표준 도면</b> 형식인지 확인하세요. (사각/원형 LUG)</span>
            </li>
            <li className="flex gap-2"><span className="text-amber-500">④</span>
              <span>위 항목으로 해결이 안 되면 <b>diagnostic.json</b>을 다운로드하여 관리자에게 전달하세요.</span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">자세한 로그</p>
          <p className="text-xs text-slate-600">좌측 패널의 실행 로그에서 단계별 진행 상황과 에러 원인을 확인할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
