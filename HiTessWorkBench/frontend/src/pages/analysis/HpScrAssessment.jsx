/// <summary>
/// HP-SCR 배관응력 해석 — BDF 업로드 + PSA/POR 양자 선택 + 3D 뷰어 + XLSX 다운로드.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Play, Terminal, Pipette, Info, Download, RotateCcw } from 'lucide-react';
import GuideButton from '../../components/ui/GuideButton';
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
import PageBanner from '../../components/ui/PageBanner';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

const ANALYSIS_MODES = [
  { value: 'PSA', label: 'PSA', desc: '배관응력 해석' },
  { value: 'POR', label: 'POR', desc: '열변형 해석' },
];

const MODE_BUTTON_LABEL = {
  PSA: '배관응력 해석',
  POR: '열변형 해석',
};

/**
 * BDF 토큰화 — 콤마/공백을 모두 구분자로, 주석/빈줄 제외.
 */
function tokenizeBdfLines(bdfText) {
  if (!bdfText) return [];
  return bdfText.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('$'))
    .map(l => l.split(/[\s,]+/).filter(Boolean));
}

/**
 * BDF 텍스트에서 SPC / SPC* / SPC1 / SPC1* 카드를 파싱한다.
 * 반환: [{ nodeId, dof, value }, ...]
 */
function parseSpcCardsFromBdf(bdfText) {
  const out = [];
  for (const tokens of tokenizeBdfLines(bdfText)) {
    const head = tokens[0].toUpperCase();
    if (head === 'SPC' || head === 'SPC*') {
      if (tokens.length < 4) continue;
      const gid = parseInt(tokens[2], 10);
      const dof = String(tokens[3] ?? '').replace(/[^0-9]/g, '');
      const val = parseFloat(tokens[4] ?? '0');
      if (!isFinite(gid) || !dof) continue;
      out.push({ nodeId: gid, dof, value: isFinite(val) ? val : 0 });
    } else if (head === 'SPC1' || head === 'SPC1*') {
      if (tokens.length < 3) continue;
      const dof = String(tokens[2] ?? '').replace(/[^0-9]/g, '');
      if (!dof) continue;
      for (let i = 3; i < tokens.length; i++) {
        const t = tokens[i].toUpperCase();
        if (t === 'THRU') break;
        const gid = parseInt(tokens[i], 10);
        if (isFinite(gid)) out.push({ nodeId: gid, dof, value: 0 });
      }
    }
  }
  return out;
}

/**
 * CBUSH / CBUSH* 카드 파싱.
 * 반환: [{ id, nodeIds:[GA,GB], cardType:'CBUSH' }, ...] — modelData.elements 와 호환
 * 형식: CBUSH EID PID GA GB ...
 */
function parseCbushFromBdf(bdfText) {
  const out = [];
  for (const tokens of tokenizeBdfLines(bdfText)) {
    const head = tokens[0].toUpperCase();
    if (head !== 'CBUSH' && head !== 'CBUSH*') continue;
    if (tokens.length < 5) continue;
    const eid = parseInt(tokens[1], 10);
    const ga  = parseInt(tokens[3], 10);
    const gb  = parseInt(tokens[4], 10);
    if (!isFinite(ga) || !isFinite(gb)) continue;
    out.push({ id: isFinite(eid) ? eid : undefined, nodeIds: [ga, gb], cardType: 'CBUSH' });
  }
  return out;
}

/**
 * FORCE 카드 파싱 — 노드별 벡터를 SID 무관하게 누적합산.
 * 형식: FORCE SID G CID F N1 N2 N3 → 결과 = F * (N1, N2, N3)
 * 반환: [{ nodeId, fx, fy, fz, mag }, ...]
 */
function parseForcesFromBdf(bdfText) {
  const acc = new Map(); // nodeId -> {fx,fy,fz}
  for (const tokens of tokenizeBdfLines(bdfText)) {
    if (tokens[0].toUpperCase() !== 'FORCE') continue;
    if (tokens.length < 8) continue;
    const gid = parseInt(tokens[2], 10);
    const f   = parseFloat(tokens[4]);
    const n1  = parseFloat(tokens[5]);
    const n2  = parseFloat(tokens[6]);
    const n3  = parseFloat(tokens[7]);
    if (!isFinite(gid) || !isFinite(f)) continue;
    const fx = f * (isFinite(n1) ? n1 : 0);
    const fy = f * (isFinite(n2) ? n2 : 0);
    const fz = f * (isFinite(n3) ? n3 : 0);
    const cur = acc.get(gid) || { fx: 0, fy: 0, fz: 0 };
    cur.fx += fx; cur.fy += fy; cur.fz += fz;
    acc.set(gid, cur);
  }
  const out = [];
  acc.forEach((v, nodeId) => {
    const mag = Math.sqrt(v.fx * v.fx + v.fy * v.fy + v.fz * v.fz);
    if (mag > 0) out.push({ nodeId, fx: v.fx, fy: v.fy, fz: v.fz, mag });
  });
  return out;
}

/**
 * TEMP 카드 파싱 — 노드별 온도값. (TEMPD/TEMPRB 등은 미지원)
 * 형식: TEMP SID G T (한 카드에 G,T 쌍 여러 개 가능: G1 T1 G2 T2 G3 T3)
 * 반환: [{ nodeId, T }, ...] (동일 노드 중복 시 마지막 값 우선)
 */
function parseTempsFromBdf(bdfText) {
  const map = new Map();
  for (const tokens of tokenizeBdfLines(bdfText)) {
    if (tokens[0].toUpperCase() !== 'TEMP') continue;
    // SID는 토큰[1], 이후 (G, T) 쌍 반복
    for (let i = 2; i + 1 < tokens.length; i += 2) {
      const gid = parseInt(tokens[i], 10);
      const t   = parseFloat(tokens[i + 1]);
      if (isFinite(gid) && isFinite(t)) map.set(gid, t);
    }
  }
  const out = [];
  map.forEach((T, nodeId) => out.push({ nodeId, T }));
  return out;
}

export default function HpScrAssessment() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();

  const [bdfFile, setBdfFile] = useState(null);
  const [analysisMode, setAnalysisMode] = useState('PSA');
  const [modelData, setModelData] = useState(null);
  const [reportPath, setReportPath] = useState(null);
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

    const formData = new FormData();
    formData.append('bdf_file', bdfFile);
    formData.append('employee_id', employeeId);
    formData.append('analysis_mode', analysisMode);
    formData.append('source', 'Workbench');

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

  const handleReset = () => {
    if (isRunning) return;
    setBdfFile(null);
    setAnalysisMode('PSA');
    setProgress(0);
    setStatusMessage('');
    setLogs([]);
    setJobId(null);
    setModelData(null);
    setReportPath(null);
    setIsDragOver(false);
    setIsDownloading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      <PageBanner gradient="from-brand-blue via-sky-900 to-sky-700">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentMenu('File-Based Apps')}
              className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <Pipette size={18} className="text-sky-300" />
                HP-SCR 배관응력 해석
              </h1>
              <p className="text-sm text-sky-200/80 mt-0.5">배관 BDF 기반 배관응력 · 열변형 해석</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GuideButton guideTitle="[파일] HP-SCR 배관응력 해석 — 사용 안내" variant="dark" />
          </div>
      </PageBanner>

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
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>{statusMessage}</span>
                <span className="font-bold text-sky-600">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
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
