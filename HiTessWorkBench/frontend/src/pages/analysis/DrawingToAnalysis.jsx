/// <summary>
/// DrawingToAnalysis — 설계 도면(PDF) → 구조 해석 모델 변환.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Play, FileText, Info, Construction, CheckCircle2, RefreshCw, Download, Terminal } from 'lucide-react';
import PageBanner from '../../components/ui/PageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import { requestDrawingToAnalysis, downloadFileBlob } from '../../api/analysis';

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DrawingToAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();
  const { showToast } = useToast();
  const [pdfFile, setPdfFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resultInfo, setResultInfo] = useState(null);
  const [analysisDbId, setAnalysisDbId] = useState(null);
  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);

  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob,
    setLogs, setStatusMessage, setIsRunning, setProgress,
  } = useAnalysisJob({
    startGlobalJob,
    pollingMaxRetries: 400,
    successLogMessage: 'BDF 변환 완료.',
    errorLogMessage: 'BDF 변환 실패.',
    timeoutLogMessage: '시간 초과 (10분). PDF 또는 서버 상태를 확인하세요.',
    onComplete: async (data) => {
      setStatusMessage('변환 완료');
      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');
      if (project?.result_info) {
        setResultInfo(project.result_info);
        setAnalysisDbId(project.id);
      }
    },
  });

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      showToast('PDF 파일만 업로드 가능합니다.', 'error');
      return;
    }
    setPdfFile(file);
    setResultInfo(null);
    setAnalysisDbId(null);
    setLogs([{ time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 선택됨.`, type: 'info' }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleRun = async () => {
    if (!pdfFile || isRunning) return;
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    setResultInfo(null);
    setAnalysisDbId(null);
    setLogs([]);

    const formData = new FormData();
    formData.append('pdf_file', pdfFile);
    formData.append('employee_id', employeeId);
    formData.append('mesh_size', '10');
    formData.append('source', 'Workbench');

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
              DrawingToAnalysis
            </h1>
            <p className="text-sm text-blue-200/80 mt-0.5">설계 도면(PDF)을 구조 해석 모델로 변환</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/25 border border-emerald-300/50 text-emerald-100 text-[11px] font-bold">
            <CheckCircle2 size={12} /> LUG PDF 지원
          </span>
        </div>
      </PageBanner>

      {/* 지원 범위 안내 */}
      <div className="flex items-start gap-3 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl shrink-0">
        <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 leading-relaxed">
          <span className="font-bold">현재 지원 범위</span>
          {' — '}LUG 도면 PDF를 rule-based 파이프라인으로 해석하여 업로드된 작업 폴더 안에 `lug_model.bdf`를 생성합니다.
        </div>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <div className="w-[360px] shrink-0 flex flex-col gap-4">
          {/* PDF 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-3">
              <p className="text-xs font-bold text-white uppercase tracking-widest">도면 PDF 선택</p>
            </div>
            <div className="p-5">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <Upload size={28} className="mx-auto mb-2 text-slate-400" />
                {pdfFile ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 truncate">{pdfFile.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatBytes(pdfFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-slate-500">클릭하거나 PDF를 드래그하세요</p>
                    <p className="text-xs text-slate-400 mt-1">.pdf</p>
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
                  className="mt-2 w-full text-[11px] text-slate-400 hover:text-rose-500 font-bold transition-colors disabled:opacity-50"
                >
                  파일 제거
                </button>
              )}
            </div>
          </div>

          {/* 실행 버튼 */}
          <button
            type="button"
            onClick={handleRun}
            disabled={!pdfFile || isRunning}
            title={!pdfFile ? 'PDF 파일을 먼저 선택하세요' : 'PDF를 BDF로 변환'}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
              !pdfFile || isRunning
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md hover:shadow-lg'
            }`}
          >
            {isRunning ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            {isRunning ? '변환 중...' : 'BDF 변환 실행'}
          </button>

          <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-sm overflow-hidden min-h-[220px] flex flex-col">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Terminal size={14} /> 실행 로그
              </span>
              <span className="text-[11px] text-slate-400">{progress}%</span>
            </div>
            {isRunning && (
              <div className="h-1 bg-slate-800">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="p-4 overflow-auto text-xs font-mono space-y-1 flex-1">
              {statusMessage && <div className="text-sky-300">{statusMessage}</div>}
              {logs.length === 0 ? (
                <div className="text-slate-500">대기 중...</div>
              ) : logs.map((log, idx) => (
                <div key={idx} className={log.type === 'error' ? 'text-red-300' : log.type === 'success' ? 'text-emerald-300' : 'text-slate-300'}>
                  <span className="text-slate-500">[{log.time}]</span> {log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* 오른쪽 본문 영역 */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center overflow-auto">
          {resultInfo ? (
            <div className="w-full max-w-2xl px-6 py-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50">
                  <CheckCircle2 size={24} className="text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">변환 완료</h2>
                  <p className="text-xs text-slate-500 mt-0.5">BDF와 보조 결과 파일이 작업 폴더에 생성되었습니다.</p>
                </div>
              </div>
              <div className="space-y-2.5 text-xs">
                {analysisDbId && (
                  <div className="text-slate-500">Analysis ID: <span className="font-mono text-slate-800">{analysisDbId}</span></div>
                )}
                {resultEntries.map(([key, path]) => (
                  <div key={key} className="grid grid-cols-[120px_1fr_auto] gap-3 items-center">
                    <span className="font-bold text-slate-500 uppercase tracking-wider">{key}</span>
                    <span className="font-mono text-slate-700 break-all bg-slate-50 px-2 py-1.5 rounded border border-slate-200">{path}</span>
                    <button
                      type="button"
                      onClick={() => downloadResult(path)}
                      className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                      title="다운로드"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center px-6 py-12 max-w-md">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
                <Construction size={28} className="text-blue-500" />
              </div>
              <h2 className="text-base font-bold text-slate-700 mb-1.5">PDF를 선택하고 변환을 실행하세요</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                변환이 완료되면 이 영역에 생성된 BDF, 메시 JSON, 미리보기 PNG 경로가 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
