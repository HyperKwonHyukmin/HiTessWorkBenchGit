/// <summary>
/// Truss Model Builder — Node·Member CSV 로 트러스 구조 해석 모델(BDF)을 만든다.
/// 화면은 파일 기반 해석 앱 공통 틀(docs/standards/file-based-app-page-standard.md)을 따른다:
///   왼쪽 레일(단계·입력 요약·실행) + 오른쪽 작업면(진행 → 판정 → 다음 행동 → 단계 본문 → 실행 기록).
/// 단계 = CSV 입력 → 모델 확인(3D) → BDF 받기. 판정 규칙은 utils/trussVerdict.
/// </summary>
import React, { useState, useRef, useEffect, Fragment } from 'react';
import { requestTrussAnalysis, getTrussSamplePreview, downloadFileBlob, getAnalysisById } from '../../api/analysis';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import { extractFilename } from '../../utils/fileHelper';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import { Dialog, Transition } from '@headlessui/react';
import {
  Download, Database, Layers, Box, CheckCircle2, AlertCircle, Maximize2, X, FileText,
  FileOutput, Eye, ChevronsRight, RefreshCw, FilePlus2, FileCheck2, Loader2, Trash2,
} from 'lucide-react';

import BdfViewerModal from '../../components/modals/BdfViewerModal';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useFileParser, parseCsvText } from '../../hooks/useFileParser';
import SolverCredit from '../../components/ui/SolverCredit';
import { useToast } from '../../contexts/ToastContext';
import { buildFormData } from '../../utils/fileHelper';
import FileDropzone from '../../components/ui/FileDropzone';
import FeedbackState from '../../components/ui/FeedbackState';
import StatusBadge from '../../components/ui/StatusBadge';
import { useDashboardFilesHandoff, useDashboardAutoRun } from '../../utils/dashboardFileHandoff';
import { useResultReentry } from '../../utils/resultReentry';
import { computeTrussBuilderVerdict } from '../../utils/trussVerdict';
import {
  StepRail, InputSummary, VerdictHeader, KeyFigures, NextActionBar, JobProgressCard,
  RunStartPanel, RunLogPanel,
} from '../../components/analysis/runFrame';

const MENU_NAME = 'Truss Analysis';   // App.jsx 라우팅 메뉴명
const PAGE_KEY = 'Truss Model Builder'; // 페이지 상태·전역 작업 라벨(기존 값 유지)
const STEP_DEFS = [
  { id: 'input', title: 'CSV 입력', icon: Database },
  { id: 'model', title: '모델 확인', icon: Box },
  { id: 'deliver', title: 'BDF 받기', icon: FileOutput },
];
const STEP_INDEX = Object.fromEntries(STEP_DEFS.map((s, i) => [s.id, i]));
const CARD_RE = /^(GRID|CBAR|CROD|CBEAM)$/i;

/**
 * CSV 행 → 표. Truss 입력 CSV 는 머리글 없이 'GRID,1,…' / 'CBAR,1,…' 로 바로 시작한다.
 * 예전에는 첫 줄을 무조건 머리글로 써서 데이터 한 줄이 머리글로 올라가고 개수가 1 적게 나왔다.
 * 첫 칸이 카드 이름이거나 숫자면 머리글이 없는 것으로 보고 '열 N' 머리글을 붙인다.
 */
function csvTable(rows) {
  if (!rows || rows.length === 0) return { header: [], body: [] };
  const first = String(rows[0][0] ?? '').replace(/^\uFEFF/, '').trim();
  const headerless = CARD_RE.test(first) || (first !== '' && Number.isFinite(Number(first)));
  if (headerless) {
    const width = Math.max(...rows.slice(0, 50).map(r => r.length));
    return { header: Array.from({ length: width }, (_, i) => `열 ${i + 1}`), body: rows };
  }
  return { header: rows[0], body: rows.slice(1) };
}

const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');

export default function TrussAnalysis() {
  const { showToast } = useToast();
  const { setCurrentMenu, currentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const { startGlobalJob, clearGlobalJob } = dashboardCtx;
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};
  const [nodeFile, setNodeFile] = useState(savedPageState.nodeFile ?? null);
  const [memberFile, setMemberFile] = useState(savedPageState.memberFile ?? null);
  const [nodeData, setNodeData] = useState(savedPageState.nodeData ?? []);
  const [memberData, setMemberData] = useState(savedPageState.memberData ?? []);
  const [detailedLogs, setDetailedLogs] = useState(savedPageState.detailedLogs ?? []);

  const [activeTab, setActiveTab] = useState(savedPageState.activeTab === 'member' ? 'member' : 'node');

  // 결과 JSON(엔진이 낼 때만) — 모델 확인 단계에 표로 보인다.
  const [resultJsonData, setResultJsonData] = useState(savedPageState.resultJsonData ?? null);

  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [analysisResultData, setAnalysisResultData] = useState(savedPageState.analysisResultData ?? null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [is3DViewerOpen, setIs3DViewerOpen] = useState(false);
  const [isSamplePreviewLoading, setIsSamplePreviewLoading] = useState(false);

  // 공통 틀 상태 — 단계 화면·실패·실제 사건(3D 확인·BDF 받기)
  const [activeIdx, setActiveIdx] = useState(savedPageState.activeIdx ?? 0);
  const [runFailed, setRunFailed] = useState(savedPageState.runFailed ?? false);
  const [failureLog, setFailureLog] = useState(savedPageState.failureLog ?? '');
  const [modelViewed, setModelViewed] = useState(savedPageState.modelViewed ?? false);
  const [delivered, setDelivered] = useState(savedPageState.delivered ?? false);
  const [runStartedAt, setRunStartedAt] = useState(savedPageState.runStartedAt ?? null);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  const addDetailedLog = (message) => {
    const time = new Date().toISOString();
    setDetailedLogs(prev => [...prev, `[${time}] ${message}`]);
  };

  // 작업 상태 + 폴링은 훅이 담당. success/error 메시지가 동적이므로
  // successLogMessage/errorLogMessage 는 빈 문자열로 두고 콜백에서 직접 처리.
  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob,
    reset: resetJob,
    setLogs, setStatusMessage, setIsRunning, setProgress,
  } = useAnalysisJob({
    startGlobalJob,
    clearGlobalJob,
    savedState: savedPageState,
    setSavedState: (patch) => dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, patch),
    pollingInterval: 1500,
    pollingMaxRetries: 120,
    successLogMessage: '',
    errorLogMessage: '',
    timeoutLogMessage: '해석 시간 초과 (3분). 서버 상태를 확인하세요.',
    onComplete: async ({ progress: jobProgress, message, engine_log, project }) => {
      setProgress(jobProgress);
      setStatusMessage(message);
      addLog('MODEL BUILDING COMPLETED SUCCESSFULLY.', 'success');
      addLog('결과가 DB에 기록되었습니다.', 'info');
      if (engine_log) {
        addDetailedLog('*** HITESS WORKBENCH SOLVER OUTPUT ***');
        addDetailedLog(engine_log);
      }
      setAnalysisResultData(project);
      setRunFailed(false);
      setFailureLog('');
      // 실행이 끝나면 판정 화면(모델 확인)으로 넘어간다(공통 틀 규칙).
      setActiveIdx(STEP_INDEX.model);
      if (project?.result_info) {
        const jsonKey = Object.keys(project.result_info).find(k => String(project.result_info[k]).endsWith('.json'));
        if (jsonKey) {
          addLog('JSON 결과 데이터를 파싱 중입니다...', 'info');
          try {
            const res = await downloadFileBlob(project.result_info[jsonKey]);
            const text = await res.data.text();
            setResultJsonData(JSON.parse(text));
            addLog('결과 테이블 렌더링 완료.', 'success');
          } catch (e) {
            console.error("JSON Fetch/Parse Error:", e);
            addLog('JSON 결과를 화면에 표시하는 데 실패했습니다.', 'error');
          }
        }
      }
    },
    onError: (err) => {
      setRunFailed(true);
      setFailureLog(err?.engine_log || '');
      setActiveIdx(STEP_INDEX.input);
      // 타임아웃은 훅이 자동 로그. 그 외 케이스만 페이지가 분기 처리.
      if (err?.timeout) return;
      if (err?.engine_log) {
        addLog('ENGINE EXECUTION FAILED.', 'error');
        addDetailedLog(err.engine_log);
      } else {
        addLog('STATUS CHECK FAILED.', 'error');
      }
    },
  });

  const nodeTable = csvTable(nodeData);
  const memberTable = csvTable(memberData);
  const numNodes = nodeTable.body.length;
  const numMembers = memberTable.body.length;
  const isDataReady = numNodes > 0 && numMembers > 0;

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      nodeFile,
      memberFile,
      nodeData,
      memberData,
      detailedLogs,
      activeTab,
      resultJsonData,
      analysisResultData,
      activeIdx, runFailed, failureLog, modelViewed, delivered, runStartedAt,
    });
  }, [nodeFile, memberFile, nodeData, memberData, detailedLogs, activeTab, resultJsonData, analysisResultData,
    activeIdx, runFailed, failureLog, modelViewed, delivered, runStartedAt]);

  // 경과 시간 — 진행 카드 한 곳에만 보인다.
  useEffect(() => {
    if (!isRunning || !runStartedAt) { setElapsedSecs(0); return undefined; }
    const tick = () => setElapsedSecs(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isRunning, runStartedAt]);

  const handleCsvParsed = (rows, file, setter, type) => {
    setter(rows);
    const count = csvTable(rows).body.length;
    addLog(`[DATA] ${type.toUpperCase()} 데이터 로드 완료 (${count}행)`, 'info');
    addDetailedLog(`PARSING ${file.name} ... OK (${count} Entries)`);
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
    if (!file || !file.name.endsWith('.csv')) { showToast('CSV 파일만 업로드 가능합니다.', 'warning'); return; }
    if (type === 'node') { setNodeFile(file); readNodeFile(file); }
    else { setMemberFile(file); readMemberFile(file); }
    setActiveTab(type);
  };

  const detectFileType = (filename) => {
    const upper = filename.toUpperCase();
    if (upper.includes('NODE')) return 'node';
    if (upper.includes('WAY') || upper.includes('MEMBER')) return 'member';
    return null;
  };

  const autoAssignFiles = (files) => {
    let nodeF = null, memberF = null;
    for (const file of files) {
      const type = detectFileType(file.name);
      if (type === 'node' && !nodeF) nodeF = file;
      else if (type === 'member' && !memberF) memberF = file;
    }
    if (!nodeF && !memberF && files.length >= 2) {
      [nodeF, memberF] = files;
      showToast('파일명 자동 감지 실패 — 순서대로 Node/Member에 배정했습니다.', 'warning');
    }
    if (nodeF) handleFile(nodeF, 'node');
    if (memberF) handleFile(memberF, 'member');
    if (nodeF && memberF)
      showToast(`자동 매핑 완료 — Node: ${nodeF.name} / Member: ${memberF.name}`, 'success');
  };

  // 대시보드 '새 해석 시작'에 놓은 파일을 이어받는다(이 화면의 업로드 처리와 같은 경로)
  useDashboardFilesHandoff(MENU_NAME, (files) => {
    if (files.length >= 2) autoAssignFiles(files);
    else handleFile(files[0], detectFileType(files[0].name) || 'node');
  }, ['.csv']);

  const clearLogs = () => {
    setLogs([]);
    setDetailedLogs([]);
  };

  /** 상태 초기화(토스트 없음) — '새 입력으로 시작'·결과 다시 열기·입력 불러오기가 같이 쓴다. */
  const resetState = () => {
    resetJob();
    setNodeFile(null);
    setMemberFile(null);
    setNodeData([]);
    setMemberData([]);
    setDetailedLogs([]);
    setActiveTab('node');
    setResultJsonData(null);
    setAnalysisResultData(null);
    setIsLogModalOpen(false);
    setIsResultModalOpen(false);
    setIs3DViewerOpen(false);
    setIsSamplePreviewLoading(false);
    setStatusMessage('');
    setProgress(0);
    setActiveIdx(0);
    setRunFailed(false);
    setFailureLog('');
    setModelViewed(false);
    setDelivered(false);
    setRunStartedAt(null);
    dashboardCtx?.clearAnalysisPageState?.(PAGE_KEY);
  };

  const resetPage = () => {
    resetState();
    showToast('Truss Model Builder가 초기 상태로 되돌아갔습니다.', 'success');
  };

  /** 새 실행 직전 공통 준비 — 직접 실행·샘플 실행이 같이 쓴다. */
  const beginRun = (message) => {
    setIsRunning(true);
    setProgress(0);
    setStatusMessage(message);
    setAnalysisResultData(null);
    setResultJsonData(null);
    setIsResultModalOpen(false);
    setIs3DViewerOpen(false);
    setLogs([]);
    setDetailedLogs([]);
    setRunFailed(false);
    setFailureLog('');
    setModelViewed(false);
    setDelivered(false);
    setRunStartedAt(Date.now());
  };

  // 해석 서버 요청 로직
  const runAnalysis = async () => {
    if (!nodeFile || !memberFile) return;
    beginRun('서버에 작업 요청 중...');
    addLog('System Check OK. Requesting Analysis Job...', 'info');

    const formData = buildFormData({
      node_file: nodeFile,
      member_file: memberFile,
      employee_id: employeeId,
      source: 'Workbench',
    });
    try {
      const requestRes = await requestTrussAnalysis(formData);

      const jobId = requestRes.data.job_id;
      if (!jobId) throw new Error("서버로부터 Job ID를 받지 못했습니다.");

      addLog(`Job submitted successfully. [Job ID: ${jobId}]`, 'info');
      startJob(jobId, PAGE_KEY);
    } catch (error) {
      addLog('SERVER COMMUNICATION FAILED.', 'error');
      const detail = error.response ? `SERVER ERROR [${error.response.status}]` : `NETWORK ERROR: ${error.message}`;
      addDetailedLog(detail);
      setIsRunning(false);
      setRunFailed(true);
      setFailureLog(`[원인] 서버 요청이 실패했습니다 (${detail}).\n[조치] 서버 연결 상태를 확인한 뒤 다시 실행하세요.`);
    }
  };

  // 샘플 실행 — 공통 컴포넌트(SampleRunButton)가 호출하는 콜백 묶음.
  // 사용 기록(activity log) / 통계 / MyProjects 이력에는 남지 않음.
  const sampleBeforeRun = () => {
    beginRun('샘플 파일로 작업 요청 중...');
    addLog('Sample run requested — 사내 표준 NODE/WAY CSV 사용', 'info');
  };
  const sampleOnJobSubmitted = (jobId) => {
    addLog(`Sample job submitted. [Job ID: ${jobId}]`, 'info');
    startJob(jobId, PAGE_KEY);
  };
  const sampleOnError = (status, detail) => {
    if (status === 429) {
      addLog('Sample run rejected — daily limit reached.', 'warning');
    } else {
      addLog('SAMPLE RUN FAILED.', 'error');
      addDetailedLog(status ? `SERVER ERROR [${status}] ${detail}` : `NETWORK ERROR: ${detail}`);
      setRunFailed(true);
      setFailureLog(`[원인] 샘플 실행 요청이 실패했습니다: ${detail}`);
    }
    setIsRunning(false);
  };

  const openSamplePreview = async () => {
    setIsSamplePreviewLoading(true);
    try {
      const res = await getTrussSamplePreview();
      const nextNodeData = res.data?.node?.rows || [];
      const nextMemberData = res.data?.member?.rows || [];
      setNodeData(nextNodeData);
      setMemberData(nextMemberData);
      setNodeFile({ name: res.data?.node?.filename || 'Sample NODE.csv', sample: true });
      setMemberFile({ name: res.data?.member?.filename || 'Sample WAY.csv', sample: true });
      setActiveTab('node');
      setActiveIdx(STEP_INDEX.input);
      addLog(`[SAMPLE] 미리보기 로드 완료 — Node ${csvTable(nextNodeData).body.length}행 / Member ${csvTable(nextMemberData).body.length}행`, 'success');
    } catch (error) {
      const detail = error?.response?.data?.detail || error.message;
      addLog(`[SAMPLE] 미리보기 로드 실패: ${detail}`, 'error');
      showToast('샘플 CSV 미리보기를 불러오지 못했습니다.', 'error');
    } finally {
      setIsSamplePreviewLoading(false);
    }
  };

  /** 서버 파일 → File (입력 다시 쓰기용). */
  const fetchAsFile = async (path) => {
    const res = await downloadFileBlob(path);
    return new File([res.data], baseName(path), { type: 'text/csv' });
  };

  /** 서버에 보관된 입력 CSV 두 개를 입력 칸에 채운다. */
  const loadServerInputs = async (input) => {
    if (!input?.node_csv || !input?.member_csv) throw new Error('이 실행에는 Node·Member CSV 정보가 없습니다.');
    const [nodeF, memberF] = await Promise.all([fetchAsFile(input.node_csv), fetchAsFile(input.member_csv)]);
    handleFile(nodeF, 'node');
    handleFile(memberF, 'member');
    setActiveTab('node');
  };

  // ── 지난 결과 다시 열기(My Projects·대시보드·최근 실행) ─────────────
  const applyResultReentry = async (analysisId) => {
    try {
      const { data: rec } = await getAnalysisById(analysisId);
      if (rec.program_name !== 'TrussModelBuilder') throw new Error('Truss Model Builder 기록이 아닙니다.');
      if (rec.files_available === false) throw new Error('결과 파일이 보관 기간이 지나 삭제되었습니다.');
      if (!rec.result_info?.bdf) throw new Error('이 기록에는 결과 BDF 정보가 없습니다.');
      resetState();
      try { await loadServerInputs(rec.input_info); } catch { /* 입력이 없어도 결과는 연다 */ }
      setAnalysisResultData(rec);
      setActiveIdx(STEP_INDEX.model);
      const when = rec.created_at ? new Date(rec.created_at).toLocaleString('ko-KR') : '';
      showToast(`지난 결과를 열었습니다${when ? ` (${when})` : ''}.`, 'success');
    } catch (e) {
      showToast(`결과를 열지 못했습니다: ${e?.response?.data?.detail || e.message}`, 'error');
    }
  };
  useResultReentry(MENU_NAME, applyResultReentry);

  // ── 최근 실행의 입력 불러오기 ─────────────────────────────────────
  const applyRecentInput = async (record) => {
    try {
      const input = record?.input_info || {};
      if (!input.node_csv || !input.member_csv) throw new Error('이 실행에는 Node·Member CSV 정보가 없습니다.');
      resetState();
      await loadServerInputs(input);
      showToast('최근 실행의 Node·Member CSV 를 불러왔습니다.', 'success');
    } catch (e) {
      showToast(`입력을 불러오지 못했습니다: ${e?.response?.status === 404 ? '서버에 파일이 없습니다' : e.message}`, 'error');
    }
  };

  // ── 결과 BDF 받기 ──────────────────────────────────────────────
  // 예전 '결과 BDF 다운로드' 버튼은 xlsx/csv 키를 찾다가 없으면 파일 목록 모달을 열었다
  // (이 앱의 결과는 BDF 하나라 항상 모달이 떴다). 이제 BDF 를 바로 받고, 없을 때만 모달을 연다.
  const resultBdfPath = analysisResultData?.result_info?.bdf || null;
  const downloadResultBdf = async () => {
    if (!resultBdfPath) { setIsResultModalOpen(true); return; }
    try {
      const response = await downloadFileBlob(resultBdfPath);
      const filename = extractFilename(resultBdfPath);
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setDelivered(true);
    } catch (error) {
      console.error("BDF download failed", error);
      showToast(error?.response?.status === 404 ? '결과 파일이 서버에 없습니다(보관 기간 만료).' : 'BDF 다운로드에 실패했습니다.', 'error');
    }
  };

  const open3DViewer = () => {
    setIs3DViewerOpen(true);
    setModelViewed(true);
  };

  const canRun = nodeFile && memberFile && !nodeFile.sample && !memberFile.sample && !isRunning;

  // 대시보드에서 넘겨받은 파일로 입력이 갖춰지면 실행까지 바로 이어간다
  useDashboardAutoRun(MENU_NAME, (canRun && nodeFile) || null, runAnalysis);

  const downloadSummaryLog = () => {
    if (logs.length === 0) { showToast('다운로드할 로그가 없습니다.', 'warning'); return; }
    const logText = logs.map(l => `[${l.time}] ${l.message}`).join('\n');
    downloadFile(logText, `Summary_Log_${new Date().getTime()}.txt`);
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

  /* ── 파생 상태 ─────────────────────────────────────────────────── */
  const hasResult = analysisResultData?.status === 'Success';
  const verdict = computeTrussBuilderVerdict({ jobFailed: runFailed, project: analysisResultData, report: failureLog });
  const isSample = !!(nodeFile?.sample || memberFile?.sample);

  const displaySteps = STEP_DEFS.map((def) => {
    if (def.id === 'input') {
      if (isRunning) return { ...def, status: 'running', hint: '생성 중' };
      if (verdict.level === 'fail') return { ...def, status: 'error', hint: '생성 실패' };
      if (verdict.level === 'pass') return { ...def, status: 'done', hint: 'BDF 생성됨' };
      if (isDataReady) return { ...def, status: 'wait', hint: isSample ? '샘플 미리보기' : '실행 대기' };
      return { ...def, status: 'wait' };
    }
    if (def.id === 'model') {
      if (verdict.level !== 'pass') return { ...def, status: 'wait' };
      return modelViewed ? { ...def, status: 'done', hint: '3D 확인함' } : { ...def, status: 'wait', hint: '3D 확인 전' };
    }
    if (verdict.level !== 'pass') return { ...def, status: 'wait' };
    return delivered ? { ...def, status: 'done', hint: 'BDF 받음' } : { ...def, status: 'wait', hint: '받기 전' };
  });
  const activeStep = displaySteps[activeIdx] ?? displaySteps[0];

  const inputItems = [
    { key: 'node', label: 'Node', fileName: nodeFile?.name || null, state: nodeFile ? (numNodes > 0 ? 'ok' : 'warn') : 'empty', note: nodeFile ? `${numNodes.toLocaleString()}행` : undefined },
    { key: 'member', label: 'Member', fileName: memberFile?.name || null, state: memberFile ? (numMembers > 0 ? 'ok' : 'warn') : 'empty', note: memberFile ? `${numMembers.toLocaleString()}행` : undefined },
  ];

  /* ── 실행 버튼 — 주 버튼 1개 + Ctrl+Enter ─────────────────────────── */
  const runAction = {
    label: hasResult || runFailed ? '다시 생성' : 'BDF 생성 실행',
    icon: hasResult || runFailed ? RefreshCw : ChevronsRight,
    onClick: runAnalysis,
    enabled: !!canRun,
  };
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (currentMenu !== MENU_NAME) return; // keep-alive 라 다른 화면에서도 살아 있다
      const a = runActionRef.current;
      if (!a.enabled) return;
      e.preventDefault();
      a.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);
  const runHint = isRunning ? null
    : isSample ? '샘플 미리보기는 실행할 수 없습니다. \u2018샘플로 실행\u2019을 쓰세요.'
      : !nodeFile || !memberFile ? 'Node·Member CSV 를 올리면 열립니다.' : null;

  /* ── 다음 행동 ───────────────────────────────────────────────────── */
  const backToInput = { label: '입력으로 돌아가기', icon: FileCheck2, onClick: () => setActiveIdx(STEP_INDEX.input) };
  const nextAction = (() => {
    if (isRunning) return null;
    if (activeStep.id === 'input') {
      if (verdict.level !== 'pass') return null;
      return {
        note: '모델이 만들어졌습니다. 3D 로 형상을 확인하세요.',
        primary: { label: '모델 확인으로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.model) },
      };
    }
    if (verdict.level !== 'pass') {
      return { note: '먼저 Node·Member CSV 로 BDF 를 생성하세요.', primary: backToInput };
    }
    if (activeStep.id === 'model') {
      return {
        note: modelViewed ? '형상을 확인했다면 BDF 를 받으세요.' : '부재 연결과 형상을 3D 로 확인하세요.',
        primary: modelViewed
          ? { label: 'BDF 받기로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.deliver) }
          : { label: '3D 로 보기', icon: Eye, onClick: open3DViewer },
        secondary: modelViewed
          ? [{ key: '3d', label: '3D 다시 보기', icon: Eye, onClick: open3DViewer }]
          : [{ key: 'deliver', label: 'BDF 받기로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.deliver) }],
      };
    }
    return {
      note: delivered ? 'BDF 를 받았습니다. 구조 평가는 하중·Case Control 을 넣은 BDF 로 Truss Structural Assessment 에서 진행합니다.' : '결과 BDF 를 받으세요.',
      primary: { label: 'BDF 받기', icon: Download, onClick: downloadResultBdf },
      secondary: [{ key: 'files', label: '입력·결과 파일 전체', icon: FileText, onClick: () => setIsResultModalOpen(true) }],
    };
  })();

  // 샘플 실행은 입력 칸이 비어 있을 수 있다 — 그때는 개수 없이 결과 파일만 적는다.
  const verdictSummary = verdict.level !== 'pass' ? null
    : isDataReady
      ? `Node ${numNodes.toLocaleString()} · Member ${numMembers.toLocaleString()} → ${baseName(resultBdfPath)}`
      : `결과 ${baseName(resultBdfPath)}`;

  const isStartScreen = activeStep.id === 'input' && !nodeFile && !memberFile && !isRunning && !analysisResultData && !runFailed;
  const previewTabs = [
    { key: 'node', label: 'Node', count: numNodes, table: nodeTable, empty: 'Node CSV 를 올리면 여기에 표로 보입니다.' },
    { key: 'member', label: 'Member', count: numMembers, table: memberTable, empty: 'Member CSV 를 올리면 여기에 표로 보입니다.' },
  ];
  const activePreview = previewTabs.find(t => t.key === activeTab) ?? previewTabs[0];

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    // pb-28: 화면 오른쪽 아래 전역 작업·메시지 도크가 마지막 버튼을 가리지 않게 여백을 둔다.
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">

      <FileBasedPageBanner
        title="Truss Model Builder"
        subtitle="Node 및 Member CSV 데이터를 기반으로 구조 해석 모델을 구축합니다."
        icon={Layers}
        guideTitle="[파일] Truss Model Builder — CSV로 트러스 모델 만들기"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      <div className="flex flex-col items-stretch gap-5 px-1 xl:flex-row">

        {/* ── 왼쪽 레일: 단계 · 입력 요약 · 실행 ── */}
        <aside className={`flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0 ${isStartScreen ? '' : 'xl:self-start'}`}>
          <StepRail steps={displaySteps} activeIdx={activeIdx} onSelect={setActiveIdx} />

          {activeStep.id !== 'input' && (
            <>
              <div className="h-px bg-slate-100" />
              <InputSummary items={inputItems} />
            </>
          )}

          <div className="h-px bg-slate-100" />
          <div className="space-y-2">
            <button
              type="button"
              onClick={runAction.onClick}
              disabled={!runAction.enabled}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isRunning
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> 생성 중…</>
                : <><runAction.icon size={15} aria-hidden="true" /> {runAction.label}</>}
            </button>
            {runHint ? (
              <p className="text-center text-xs text-slate-600">{runHint}</p>
            ) : !isRunning && (
              <p className="text-center text-[11px] text-slate-600">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl</kbd>
                {' + '}
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Enter</kbd>
                {' 로도 실행합니다'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
              {(nodeFile || memberFile || analysisResultData || runFailed) && (
                <button
                  type="button"
                  onClick={resetPage}
                  disabled={isRunning || isSamplePreviewLoading}
                  className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                >
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <button
                type="button"
                onClick={openSamplePreview}
                disabled={isSamplePreviewLoading || isRunning}
                className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
              >
                {isSamplePreviewLoading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                샘플 CSV 보기
              </button>
              <SampleRunButton
                appKey="truss"
                variant="link"
                label="샘플로 실행"
                disabled={isRunning}
                onBeforeRun={sampleBeforeRun}
                onJobSubmitted={sampleOnJobSubmitted}
                onError={sampleOnError}
              />
            </div>
          </div>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {isRunning && (
            <JobProgressCard
              title="모델 생성 중"
              message={statusMessage}
              progress={progress}
              elapsed={elapsedSecs}
              note="다른 화면으로 이동해도 계속 진행됩니다. 오른쪽 아래 작업 카드로 돌아올 수 있습니다."
            />
          )}

          {!isRunning && verdict.level && (
            <VerdictHeader
              level={verdict.level}
              title={verdict.title}
              summary={verdictSummary}
              reasons={verdict.reasons}
            />
          )}
          {nextAction && <NextActionBar {...nextAction} />}

          <section className={`flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-5 py-4 ${isStartScreen ? 'flex-1' : ''}`}>
            <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-100 pb-3">
              <activeStep.icon size={15} className="text-slate-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            <div className="min-w-0 space-y-4">
              {activeStep.id === 'input' && (
                <>
                  <p className="text-sm text-slate-700">
                    칸에 하나씩 놓거나, 두 파일을 한 번에 놓으면 파일명(NODE / WAY·MEMBER)을 보고 자동으로 나눕니다.
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <UploadDropzone title="Node CSV" file={nodeFile} rowCount={numNodes} disabled={isRunning} onFiles={(incomingFiles) => {
                      const files = incomingFiles.filter(f => f.name.endsWith('.csv'));
                      if (files.length === 0) { showToast('CSV 파일만 업로드 가능합니다.', 'warning'); return; }
                      files.length >= 2 ? autoAssignFiles(files) : handleFile(files[0], 'node');
                    }} />
                    <UploadDropzone title="Member CSV (WAY)" file={memberFile} rowCount={numMembers} disabled={isRunning} onFiles={(incomingFiles) => {
                      const files = incomingFiles.filter(f => f.name.endsWith('.csv'));
                      if (files.length === 0) { showToast('CSV 파일만 업로드 가능합니다.', 'warning'); return; }
                      files.length >= 2 ? autoAssignFiles(files) : handleFile(files[0], 'member');
                    }} />
                  </div>

                  {isStartScreen ? (
                    <RunStartPanel
                      programName="TrussModelBuilder"
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => !!(r.input_info?.node_csv && r.input_info?.member_csv)}
                      steps={[
                        { title: 'CSV 입력', detail: 'Node(GRID) · Member(WAY) CSV 를 읽어 표로 보여 주고, 둘 다 있으면 BDF 를 생성합니다.' },
                        { title: '모델 확인', detail: '만들어진 모델의 부재 연결과 형상을 3D 로 확인합니다.' },
                        { title: 'BDF 받기', detail: '결과 BDF 를 받습니다. 하중·Case Control 을 더해 Truss Structural Assessment 로 평가합니다.' },
                      ]}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2" role="tablist" aria-label="CSV 미리보기">
                        {previewTabs.map(t => (
                          <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`-mb-px flex items-center gap-1.5 rounded-t-md border px-3 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer ${activeTab === t.key ? 'border-slate-200 border-b-white bg-white text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                          >
                            {t.label}
                            {t.count > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-700">{t.count.toLocaleString()}</span>}
                          </button>
                        ))}
                        {isSample && <span className="ml-auto pb-1.5 text-[11px] font-semibold text-slate-600">사내 샘플 미리보기</span>}
                      </div>
                      <div className="relative h-[clamp(280px,48vh,560px)] overflow-auto">
                        <DataTable table={activePreview.table} emptyMsg={activePreview.empty} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeStep.id === 'model' && (
                hasResult ? (
                  <>
                    <KeyFigures items={[
                      { key: 'n', label: 'Node', value: numNodes.toLocaleString(), unit: 'EA', sub: '입력 CSV 기준' },
                      { key: 'm', label: 'Member', value: numMembers.toLocaleString(), unit: 'EA', sub: '입력 CSV 기준' },
                      { key: 'bdf', label: '결과 BDF', value: baseName(resultBdfPath) || '—' },
                    ]} />
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                      <Eye size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">3D 모델 보기</p>
                        <p className="text-xs text-slate-600">결과 BDF 를 3D 로 그립니다. 부재 연결이 끊긴 곳이나 좌표가 튄 Node 를 찾을 때 씁니다.</p>
                      </div>
                      <button
                        type="button"
                        onClick={open3DViewer}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                      >
                        <Eye size={13} aria-hidden="true" /> {modelViewed ? '3D 다시 보기' : '3D 로 보기'}
                      </button>
                    </div>
                    {resultJsonData && (
                      <div className="relative h-[clamp(260px,40vh,480px)] overflow-auto rounded-lg border border-slate-200">
                        <JsonDataTable data={resultJsonData} emptyMsg="결과 데이터가 없습니다." />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-600">BDF 를 생성하면 여기서 모델을 확인합니다.</p>
                )
              )}

              {activeStep.id === 'deliver' && (
                hasResult ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <FileOutput size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800" title={resultBdfPath || ''}>{baseName(resultBdfPath)}</p>
                        <p className="text-xs text-slate-600">결과 BDF · Nastran 입력</p>
                      </div>
                      {delivered && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} aria-hidden="true" /> 받음</span>}
                      <button
                        type="button"
                        onClick={downloadResultBdf}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                      >
                        <Download size={13} aria-hidden="true" /> 받기
                      </button>
                    </li>
                    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <FileText size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">입력·결과 파일 전체</p>
                        <p className="text-xs text-slate-600">서버에 보관된 입력 CSV 와 결과 파일을 하나씩 받습니다.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsResultModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                      >
                        <FileText size={13} aria-hidden="true" /> 목록 열기
                      </button>
                    </li>
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">BDF 를 생성하면 여기서 받습니다.</p>
                )
              )}
            </div>
          </section>

          <RunLogPanel
            logs={logs}
            open={runFailed}
            note={runFailed ? '실패 원인은 위 판정과 상세 로그에서 확인' : undefined}
            actions={logs.length > 0 || detailedLogs.length > 0 ? [
              { key: 'detail', label: '상세 로그', icon: Maximize2, onClick: () => setIsLogModalOpen(true) },
              { key: 'save', label: '저장', icon: Download, onClick: downloadSummaryLog },
              { key: 'clear', label: '지우기', icon: Trash2, onClick: clearLogs, disabled: isRunning },
            ] : []}
          />
        </main>
      </div>

      <SolverCredit contributor="권혁민" />

      {/* 모달 1: 상세 로그(엔진 원문) */}
      <Transition appear show={isLogModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[100]" onClose={() => setIsLogModalOpen(false)}>
          <div className="fixed inset-0 bg-black/60" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="flex h-[80vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
                <Dialog.Title as="h3" className="flex items-center gap-2 text-base font-bold text-slate-800"><FileText size={16} className="text-slate-600" /> 상세 로그 (엔진 출력 원문)</Dialog.Title>
                <button type="button" onClick={() => setIsLogModalOpen(false)} aria-label="닫기" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"><X size={20} /></button>
              </div>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 p-5 font-mono text-xs text-slate-800">
                {detailedLogs.length > 0 ? detailedLogs.join('\n') : '상세 로그가 없습니다.'}
              </pre>
            </Dialog.Panel>
          </div>
        </Dialog>
      </Transition>

      {/* 모달 2: 입력·결과 파일 전체 다운로드 */}
      <ProjectDetailModal
        project={isResultModalOpen ? analysisResultData : null}
        onClose={() => setIsResultModalOpen(false)}
        onDownloaded={(kind) => { if (kind === 'result') setDelivered(true); }}
      />

      {/* 모달 3: 3D BDF 뷰어 */}
      <BdfViewerModal
        isOpen={is3DViewerOpen}
        project={analysisResultData}
        onClose={() => setIs3DViewerOpen(false)}
        initialShowNodes={false}
      />
    </div>
  );
}

// ==========================================
// Helper Components
// ==========================================

// JSON 기반 동적 테이블 렌더러(엔진이 결과 JSON 을 낼 때)
function JsonDataTable({ data, emptyMsg }) {
  if (!data) return <FeedbackState className="absolute inset-0" icon={Database} title={emptyMsg} />;

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

  if (tableData.length === 0) return <div className="p-4 text-center text-slate-600">표시할 데이터가 없습니다.</div>;

  const headers = Object.keys(tableData[0]);

  return (
    <table className="w-full whitespace-nowrap text-left font-mono text-xs">
      <thead className="sticky top-0 z-10 bg-slate-50">
        <tr>
          {headers.map((h, i) => <th key={i} className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-700">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tableData.map((row, i) => (
          <tr key={i} className="hover:bg-slate-50">
            {headers.map((h, j) => <td key={j} className="px-4 py-1.5 text-slate-800">{String(row[h])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


const ProjectDetailModal = ({ project, onClose, onDownloaded }) => {
  const { showToast } = useToast();
  if (!project) return null;

  const handleDownload = async (filePath, kind) => {
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
      onDownloaded?.(kind);
    } catch (error) {
      console.error("Download failed:", error);
      showToast('파일 다운로드에 실패했습니다.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl animate-slide-up">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-600">ID {project.id} · {new Date(project.created_at).toLocaleString()}</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900">{project.project_name || 'Unnamed Project'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 overflow-y-auto p-6">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <StatusBadge status={project.status} /> <span>{project.program_name}</span> <span className="text-slate-500">·</span> <span>{project.employee_id}</span>
          </div>

          {/* Input Files */}
          {project.input_info && Object.keys(project.input_info).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">입력 CSV</h3>
              <div className="space-y-2">
                {Object.entries(project.input_info).map(([key, path]) => (
                  <FileRow key={key} label={key} path={path} icon={Database} onClick={() => handleDownload(path, 'input')} />
                ))}
              </div>
            </div>
          )}

          {/* Result Files */}
          {project.status === 'Success' && project.result_info && Object.keys(project.result_info).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-800">결과 파일</h3>
              <div className="space-y-2">
                {Object.entries(project.result_info).map(([key, path]) => (
                  <FileRow key={key} label={`${key} 파일`} path={path} icon={FileOutput} onClick={() => handleDownload(path, 'result')} />
                ))}
              </div>
            </div>
          )}

          {project.status === 'Failed' && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={18} />
              <div>
                <h4 className="text-sm font-bold text-red-800">생성 실패</h4>
                <p className="mt-1 text-xs text-red-800">
                  해석 중 오류가 발생하여 결과 파일이 생성되지 않았습니다. 실행 기록을 확인해 주세요.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

function FileRow({ label, path, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
    >
      <Icon size={16} className="shrink-0 text-slate-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="truncate text-[11px] text-slate-600" title={path}>{path}</p>
      </div>
      <Download size={16} className="shrink-0 text-slate-500 group-hover:text-blue-700" aria-hidden="true" />
    </button>
  );
}

function UploadDropzone({ title, file, rowCount, onFiles, disabled }) {
  return (
    <FileDropzone
      title={title}
      file={file}
      accept=".csv"
      multiple
      disabled={disabled}
      helperText={rowCount > 0 ? `${rowCount.toLocaleString()}행 읽음` : '.csv'}
      onFiles={onFiles}
    />
  );
}

function DataTable({ table, emptyMsg }) {
  if (!table || table.body.length === 0) return <FeedbackState className="absolute inset-0" icon={Database} title={emptyMsg} />;
  return (
    <table className="w-full whitespace-nowrap text-left font-mono text-xs">
      <thead className="sticky top-0 z-10 bg-slate-50">
        <tr>
          <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-600">#</th>
          {table.header.map((h, i) => <th key={i} className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-700">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {table.body.map((row, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="px-3 py-1.5 text-right text-slate-500">{i + 1}</td>
            {row.map((cell, j) => <td key={j} className="px-4 py-1.5 text-slate-800">{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
