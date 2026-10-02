/// <summary>
/// Truss Structural Assessment 오케스트레이터.
/// 서브컴포넌트: AssessmentBdfViewer, MultiJsonViewer(AssessmentResultTable), AssessmentProjectModal
/// 화면은 파일 기반 해석 앱 공통 틀(docs/standards/file-based-app-page-standard.md)을 따른다:
///   단계 = BDF 입력 → 평가 결과 → 보고서 저장. 판정 규칙은 utils/trussVerdict.
/// 페이지 상태는 예전처럼 DashboardContext.assessmentPageState 에 둔다(페이지 이탈 후에도 유지).
/// </summary>
import { useState, useRef, useEffect } from 'react';
import { requestAssessment, downloadFileBlob, getAnalysisById } from '../../api/analysis';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { usePolling } from '../../hooks/usePolling';
import AssessmentBdfViewer from '../../components/analysis/AssessmentBdfViewer';
import MultiJsonViewer from '../../components/analysis/AssessmentResultTable';
import AssessmentProjectModal from '../../components/analysis/AssessmentProjectModal';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import SolverCredit from '../../components/ui/SolverCredit';
import { useToast } from '../../contexts/ToastContext';
import {
  Upload, Database, Layers, Box, CheckCircle2, AlertCircle, Eye, FileText, FileOutput, Download,
  Maximize2, Minimize2, ChevronsRight, RefreshCw, FilePlus2, FileCheck2, Loader2, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { buildFormData } from '../../utils/fileHelper';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import { useDashboardFileHandoff, useDashboardAutoRun } from '../../utils/dashboardFileHandoff';
import { useResultReentry } from '../../utils/resultReentry';
import { computeTrussAssessmentVerdict, SIDE_SUPPORT_ALLOWABLE } from '../../utils/trussVerdict';
import {
  StepRail, InputSummary, VerdictHeader, KeyFigures, NextActionBar, JobProgressCard,
  RunStartPanel, RunLogPanel,
} from '../../components/analysis/runFrame';

const MENU_NAME = 'Truss Structural Assessment';
const ANALYSIS_MENU_FRESH_ENTRY_KEY = 'workbench:analysis-menu-fresh-entry';
const ANALYSIS_MENU_RESUME_ENTRY_KEY = 'workbench:analysis-menu-resume-entry';
const MENU_ENTRY_MAX_AGE_MS = 5000;
const STEP_DEFS = [
  { id: 'input', title: 'BDF 입력', icon: Database },
  { id: 'results', title: '평가 결과', icon: FileText },
  { id: 'report', title: '보고서 저장', icon: FileOutput },
];
const STEP_INDEX = Object.fromEntries(STEP_DEFS.map((s, i) => [s.id, i]));
const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');

/** 초기 상태 — 초기화·fresh-entry 가 같이 쓴다. 예전 키는 그대로 두고 공통 틀 키만 더했다. */
const INITIAL_STATE = {
  bdfFile: null,
  nodes: {},
  elements: [],
  nodeTableData: [],
  elemTableData: [],
  logs: [],
  detailedLogs: [],
  isRunning: false,
  progress: 0,
  statusMessage: '',
  activeTab: '3d',
  currentJobId: null,
  resultJsonData: null,
  activeResultCase: null,
  projectData: null,
  // 공통 틀
  activeIdx: 0,
  runFailed: false,
  failureLog: '',
  delivered: false,
};

export default function TrussAssessment() {
  const { currentMenu, setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const { employeeId: authEmployeeId } = useAuth();
  const dashboardCtx = useDashboard();
  const [isResultFullscreen, setIsResultFullscreen] = useState(false);
  const [resultView, setResultView] = useState('table'); // 평가 결과 단계: 'table' | '3d'

  useEffect(() => {
    if (!isResultFullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsResultFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isResultFullscreen]);

  const startGlobalJob = dashboardCtx?.startGlobalJob || (() => {});
  const clearGlobalJobForMenu = dashboardCtx?.clearGlobalJobForMenu || (() => {});
  // 다른 App 해석이 더 최근이어도 이 App 의 해석을 집어야 한다(globalJob 은 최신 1개일 뿐).
  const globalJob = dashboardCtx?.getJobForMenu?.(MENU_NAME) || null;

  const assessmentPageState = dashboardCtx?.assessmentPageState || {};
  const {
    bdfFile = null, nodes = {}, elements = [], nodeTableData = [], elemTableData = [],
    logs = [], detailedLogs = [], isRunning = false, progress = 0, statusMessage = '',
    activeTab = '3d', currentJobId = null, resultJsonData = null, activeResultCase = null,
    projectData = null,
    activeIdx = 0, runFailed = false, failureLog = '', delivered = false,
  } = assessmentPageState;

  // 폴링 콜백이 옛 렌더의 값을 잡고 있어도 지금 입력을 보도록 ref 로 둔다.
  const bdfFileRef = useRef(bdfFile);
  bdfFileRef.current = bdfFile;
  // 직접 올린 BDF 로 돌린 결과면 서버 BDF 를 다시 읽지 않는다. 다시 읽으면 입력이 '서버 모델(샘플)'로
  // 바뀌어 같은 BDF 로 '다시 해석'이 꺼졌다(예전 '샘플 결과 표시 중' 표시). 샘플 실행은 입력이 없어 읽는다.
  const hasUploadedBdf = () => typeof File !== 'undefined' && bdfFileRef.current instanceof File;

  const updateState = (newState) => {
    if (dashboardCtx?.setAssessmentPageState) {
      dashboardCtx.setAssessmentPageState(prev => ({ ...(prev || {}), ...newState }));
    }
  };
  const setActiveIdx = (idx) => updateState({ activeIdx: idx });

  const resetAssessmentPage = () => {
    setCurrentPollingJobId(null);
    setElapsedSeconds(0);
    setIsResultModalOpen(false);
    setIsResultFullscreen(false);
    setResultView('table');
    lastMsgRef.current = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
    // 이 App 의 기록만 지운다 — 무인자 호출은 Job Center 전체를 비운다.
    clearGlobalJobForMenu(MENU_NAME);
    if (dashboardCtx?.setAssessmentPageState) {
      dashboardCtx.setAssessmentPageState({ ...INITIAL_STATE });
    }
  };

  const loadResultsFromProject = async (project, { skipBdf = false } = {}) => {
    if (!project?.result_info) return;
    const bdfPath = project.result_info.bdf;
    if (!skipBdf && typeof bdfPath === 'string' && bdfPath) {
      try {
        const bdfRes = await downloadFileBlob(bdfPath);
        const bdfText = await bdfRes.data.text();
        parseBDF(bdfText, {
          fileName: bdfPath.split(/[\\/]/).pop() || 'sample.bdf',
          source: 'server',
          activateTab: false,
        });
      } catch (e) {
        dashboardCtx?.setAssessmentPageState?.(prev => ({
          ...(prev || {}),
          logs: [
            ...(prev?.logs || []),
            {
              time: new Date().toLocaleTimeString(),
              message: `[WARN] 결과 모델 BDF를 불러오지 못했습니다: ${e?.message || 'unknown error'}`,
              type: 'warning',
            },
          ],
        }));
      }
    }

    const jsonFiles = Object.entries(project.result_info)
      .filter(([, path]) => typeof path === 'string' && path.toLowerCase().endsWith('.json'))
      .map(([key, path]) => ({ key: key.replace(/^JSON_/i, ''), path }));
    if (jsonFiles.length === 0) return;
    const results = await Promise.allSettled(jsonFiles.map(async (f) => {
      const res = await downloadFileBlob(f.path);
      const text = await res.data.text();
      return { key: f.key, data: JSON.parse(text.replace(/^﻿/, '')) };
    }));
    const parsedResultsMap = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled') parsedResultsMap[r.value.key] = r.value.data;
    });
    const caseNames = Object.keys(parsedResultsMap);
    if (caseNames.length > 0) {
      updateState({ resultJsonData: parsedResultsMap, activeResultCase: caseNames[0] });
    }
  };

  useEffect(() => {
    if (currentMenu !== MENU_NAME) return;

    const now = Date.now();
    const readEntry = (key) => {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (!parsed || parsed.menu !== MENU_NAME || now - Number(parsed.at || 0) > MENU_ENTRY_MAX_AGE_MS) return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const resumeEntry = readEntry(ANALYSIS_MENU_RESUME_ENTRY_KEY);
    if (resumeEntry) {
      sessionStorage.removeItem(ANALYSIS_MENU_RESUME_ENTRY_KEY);
      return;
    }

    const freshEntry = readEntry(ANALYSIS_MENU_FRESH_ENTRY_KEY);
    if (!freshEntry) return;

    sessionStorage.removeItem(ANALYSIS_MENU_FRESH_ENTRY_KEY);
    resetAssessmentPage();
  }, [currentMenu]);

  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentPollingJobId, setCurrentPollingJobId] = useState(null);

  const fileInputRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const lastMsgRef = useRef('');

  // 페이지 이탈 중 globalJob이 완료/실패된 경우 로컬 상태와 동기화
  useEffect(() => {
    if (!isRunning || !currentJobId || !globalJob) return;
    if (globalJob.jobId !== currentJobId) return;

    if (globalJob.status === 'Success') {
      setCurrentPollingJobId(null);
      updateState({
        isRunning: false, progress: 100, statusMessage: '해석 완료', projectData: globalJob.project,
        runFailed: false, failureLog: '', activeIdx: STEP_INDEX.results,
      });
      if (globalJob.project) loadResultsFromProject(globalJob.project, { skipBdf: hasUploadedBdf() });
    } else if (globalJob.status === 'Failed' || globalJob.status === 'Cancelled') {
      setCurrentPollingJobId(null);
      // 페이지를 벗어나 있는 동안 실패했더라도 원인은 콘솔에 남겨야 한다.
      const cancelled = globalJob.status === 'Cancelled';
      updateState({
        isRunning: false,
        statusMessage: cancelled ? '사용자 중단' : '해석 실패',
        runFailed: true,
        failureLog: globalJob.engine_log || (cancelled ? '[원인] 사용자 요청으로 해석을 중단했습니다.' : ''),
        activeIdx: STEP_INDEX.input,
        ...buildFailureConsoleState(
          globalJob.engine_log,
          cancelled ? '사용자 요청으로 해석을 중단했습니다.' : '해석 실패.',
        ),
      });
    }
  }, [globalJob?.status]);

  useEffect(() => {
    if (isRunning) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    }
    return () => { if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current); };
  }, [isRunning]);

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
      const finalLogs = [...logs, { time: new Date().toLocaleTimeString(), message: '구조 평가 해석 완료.', type: 'success' }];
      // 실행이 끝나면 판정 화면(평가 결과)으로 넘어간다(공통 틀 규칙).
      updateState({ isRunning: false, logs: finalLogs, projectData: project, runFailed: false, failureLog: '', activeIdx: STEP_INDEX.results });
      if (engine_log) updateState({ detailedLogs: [...detailedLogs, `*** SOLVER OUTPUT ***\n${engine_log}`] });
      await loadResultsFromProject(project, { skipBdf: hasUploadedBdf() });
    },
    onError: (errData) => {
      setCurrentPollingJobId(null);
      const msg = errData?.timeout ? '해석 시간 초과 (3분). 서버 상태를 확인하세요.' : '해석 실패.';
      updateState({
        isRunning: false,
        statusMessage: '해석 실패',
        runFailed: true,
        failureLog: errData?.engine_log || (errData?.timeout ? '[원인] 해석 시간 초과(3분).\n[조치] 서버 상태를 확인한 뒤 다시 실행하세요.' : ''),
        activeIdx: STEP_INDEX.input,
        ...buildFailureConsoleState(errData?.engine_log, msg),
      });
    },
  });

  /**
   * 실패 시 실행 기록에 남길 상태를 만든다.
   *
   * 백엔드(assessment_service)가 engine_log 에 원인·조치·엔진 출력을 담은
   * 리포트를 넣어준다. 원인·조치는 판정 머리에 사유로 뽑아 올리고(utils/trussVerdict.parseFailureReport),
   * 리포트 원문은 여러 줄 서식이 있으므로 block 로그로 넣어 그대로 보여준다.
   */
  function buildFailureConsoleState(engineLog, headline) {
    const now = new Date().toLocaleTimeString();
    const report = (engineLog || '').trimEnd();
    const nextLogs = [...logs, { time: now, message: headline, type: 'error' }];
    if (report) nextLogs.push({ time: now, message: report, type: 'error', block: true });
    return {
      logs: nextLogs,
      detailedLogs: report ? [...detailedLogs, `*** SOLVER OUTPUT ***\n${report}`] : detailedLogs,
    };
  }

  const parseNastranFloat = (str) => {
    if (!str || !str.trim()) return 0;
    let s = str.trim().toUpperCase();
    if (s.includes('E')) return parseFloat(s);
    s = s.replace(/([0-9\.])([+-][0-9]+)$/, '$1E$2');
    return parseFloat(s) || 0;
  };

  const parseBDF = (text, options = {}) => {
    const { fileName = null, source = 'upload', activateTab = true } = options;
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
    const nextState = {
      nodes: parsedNodes,
      elements: parsedElements,
      nodeTableData: nTable,
      elemTableData: eTable,
    };
    if (activateTab) nextState.activeTab = '3d';
    if (fileName) nextState.bdfFile = { name: fileName, sample: source === 'server' };

    if (dashboardCtx?.setAssessmentPageState) {
      dashboardCtx.setAssessmentPageState(prev => ({
        ...(prev || {}),
        ...nextState,
        logs: [
          ...(prev?.logs || []),
          {
            time: new Date().toLocaleTimeString(),
            message: `[DATA] BDF 파싱 완료. (Nodes: ${Object.keys(parsedNodes).length}, Elements: ${parsedElements.length})`,
            type: 'success',
          },
        ],
      }));
    } else {
      updateState({ ...nextState, logs: [...logs, { time: new Date().toLocaleTimeString(), message: `[DATA] BDF 파싱 완료. (Nodes: ${Object.keys(parsedNodes).length}, Elements: ${parsedElements.length})`, type: 'success' }] });
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.bdf') && !file.name.toLowerCase().endsWith('.dat')) { showToast('BDF 또는 DAT 파일만 업로드 가능합니다!', 'error'); return; }
    updateState({
      bdfFile: file, resultJsonData: null, activeResultCase: null, projectData: null,
      runFailed: false, failureLog: '', delivered: false, activeIdx: STEP_INDEX.input,
      logs: [...logs, { time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 업로드됨. 파싱 중...`, type: 'info' }],
    });
    setIsResultModalOpen(false);
    const reader = new FileReader();
    reader.onload = (e) => parseBDF(e.target.result);
    reader.readAsText(file);
  };

  // 대시보드 '새 해석 시작'에 놓은 파일을 이어받는다(이 화면의 업로드 처리와 같은 경로)
  useDashboardFileHandoff(MENU_NAME, handleFile, ['.bdf', '.dat']);

  const runAnalysis = async () => {
    if (!bdfFile) return;
    if (bdfFile.sample) {
      showToast('샘플 모델은 샘플 실행 버튼으로 다시 실행하세요. 새 해석은 BDF 파일을 직접 업로드해야 합니다.', 'warning');
      return;
    }
    updateState({
      isRunning: true, progress: 0, statusMessage: '서버 요청 중...', logs: [], detailedLogs: [], resultJsonData: null, projectData: null,
      runFailed: false, failureLog: '', delivered: false,
    });
    setIsResultModalOpen(false);
    lastMsgRef.current = '';
    const employeeId = authEmployeeId || 'guest';
    const formData = buildFormData({
      bdf_file: bdfFile,
      employee_id: employeeId,
      source: 'Workbench',
    });
    try {
      const res = await requestAssessment(formData);
      const jobId = res.data.job_id;
      updateState({ currentJobId: jobId, logs: [{ time: new Date().toLocaleTimeString(), message: `[JOB] 해석 작업 큐 등록 완료. (Job ID: ${jobId})`, type: 'success' }] });
      startGlobalJob(jobId, MENU_NAME);
      setCurrentPollingJobId(jobId);
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || '';
      updateState({
        isRunning: false, runFailed: true,
        failureLog: `[원인] 서버 요청이 실패했습니다.${detail ? ` (${detail})` : ''}\n[조치] 서버 연결 상태를 확인한 뒤 다시 실행하세요.`,
        logs: [...logs, { time: new Date().toLocaleTimeString(), message: '서버 요청 실패.', type: 'error' }],
      });
    }
  };

  // 샘플 실행 콜백 — SampleRunButton 이 호출. 기존 runAnalysis 와 동일한 폴링/결과 흐름.
  const sampleAssessmentBefore = () => {
    updateState({
      isRunning: true, progress: 0,
      statusMessage: '샘플 파일로 작업 요청 중...',
      logs: [{ time: new Date().toLocaleTimeString(), message: '[SAMPLE] 사내 표준 BDF로 해석 요청', type: 'info' }],
      detailedLogs: [],
      resultJsonData: null,
      activeResultCase: null,
      projectData: null,
      bdfFile: null,
      nodes: {},
      elements: [],
      nodeTableData: [],
      elemTableData: [],
      activeTab: '3d',
      runFailed: false,
      failureLog: '',
      delivered: false,
    });
    setIsResultModalOpen(false);
    lastMsgRef.current = '';
  };
  const sampleAssessmentSubmitted = (jobId) => {
    updateState({
      currentJobId: jobId,
      logs: [{ time: new Date().toLocaleTimeString(), message: `[JOB] Sample 작업 등록 완료. (Job ID: ${jobId})`, type: 'success' }],
    });
    startGlobalJob(jobId, MENU_NAME);
    setCurrentPollingJobId(jobId);
  };
  const sampleAssessmentError = (st, detail) => {
    if (st === 429) {
      updateState({ isRunning: false });
    } else {
      updateState({
        isRunning: false,
        runFailed: true,
        failureLog: `[원인] 샘플 실행 요청이 실패했습니다: ${detail}`,
        logs: [{ time: new Date().toLocaleTimeString(), message: `샘플 실행 실패: ${detail}`, type: 'error' }],
      });
    }
  };

  const downloadDetailedLog = () => {
    if (detailedLogs.length === 0) { showToast('상세 로그가 없습니다.', 'warning'); return; }
    const blob = new Blob([detailedLogs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Detailed_Log_${Date.now()}.out`; a.click(); URL.revokeObjectURL(url);
  };

  /** 서버에 보관된 BDF 를 File 로 받는다 — 다시 해석할 수 있는 입력이 된다. */
  const fetchBdfAsFile = async (path) => {
    const res = await downloadFileBlob(path);
    return new File([res.data], baseName(path), { type: 'application/octet-stream' });
  };

  // ── 지난 결과 다시 열기(My Projects·대시보드·최근 실행) ─────────────
  const applyResultReentry = async (analysisId) => {
    try {
      const { data: rec } = await getAnalysisById(analysisId);
      if (rec.program_name !== 'Truss Assessment') throw new Error('Truss Structural Assessment 기록이 아닙니다.');
      if (rec.files_available === false) throw new Error('결과 파일이 보관 기간이 지나 삭제되었습니다.');
      if (!rec.result_info?.bdf) throw new Error('이 기록에는 결과 정보가 없습니다.');
      resetAssessmentPage();
      // 입력 BDF 를 실제 파일로 채워 두면 같은 BDF 로 '다시 해석'할 수 있다.
      let loadedBdf = false;
      try {
        handleFile(await fetchBdfAsFile(rec.input_info?.bdf_model || rec.result_info.bdf));
        loadedBdf = true;
      } catch { /* 아래에서 결과 폴더의 BDF 로 3D 만 그린다 */ }
      updateState({ projectData: rec, activeIdx: STEP_INDEX.results });
      await loadResultsFromProject(rec, { skipBdf: loadedBdf });
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
      const path = record?.input_info?.bdf_model;
      if (!path) throw new Error('이 실행에는 불러올 BDF 정보가 없습니다.');
      const file = await fetchBdfAsFile(path);
      resetAssessmentPage();
      handleFile(file);
      showToast(`${file.name} 을 입력으로 불러왔습니다.`, 'success');
    } catch (e) {
      showToast(`입력을 불러오지 못했습니다: ${e?.response?.status === 404 ? '서버에 파일이 없습니다' : e.message}`, 'error');
    }
  };

  const numNodes = Object.keys(nodes).length;
  const numMembers = elements.length;
  const isDataReady = numNodes > 0 && numMembers > 0;

  // 대시보드에서 넘겨받은 파일로 입력이 갖춰지면 실행까지 바로 이어간다
  useDashboardAutoRun(MENU_NAME, (isDataReady && !isRunning && !bdfFile?.sample && bdfFile) || null, runAnalysis);

  /* ── 파생 상태 ─────────────────────────────────────────────────── */
  const verdict = computeTrussAssessmentVerdict({ jobFailed: runFailed, report: failureLog, resultsMap: resultJsonData });
  const summary = verdict.summary;
  const hasResult = !!resultJsonData;
  const isSample = !!bdfFile?.sample;

  const displaySteps = STEP_DEFS.map((def) => {
    if (def.id === 'input') {
      if (isRunning) return { ...def, status: 'running', hint: '해석 중' };
      if (runFailed) return { ...def, status: 'error', hint: '해석 실패' };
      if (hasResult || projectData) return { ...def, status: 'done', hint: '해석 완료' };
      if (isDataReady) return { ...def, status: 'wait', hint: isSample ? '샘플 모델' : '실행 대기' };
      return { ...def, status: 'wait' };
    }
    if (def.id === 'results') {
      if (verdict.level === 'pass') return { ...def, status: 'done', hint: '판정 통과' };
      if (verdict.level === 'fail' && verdict.basis === 'assessment') return { ...def, status: 'error', hint: '불합격' };
      if (projectData && !hasResult && !runFailed) return { ...def, status: 'running', hint: '결과 불러오는 중' };
      return { ...def, status: 'wait' };
    }
    if (!projectData) return { ...def, status: 'wait' };
    return delivered ? { ...def, status: 'done', hint: '보고서 받음' } : { ...def, status: 'wait', hint: '저장 전' };
  });
  const activeStep = displaySteps[activeIdx] ?? displaySteps[0];

  const inputItems = [{
    key: 'bdf', label: 'BDF', fileName: bdfFile?.name || null,
    state: !bdfFile ? 'empty' : runFailed ? 'error' : isDataReady ? 'ok' : 'warn',
    note: isDataReady ? `Node ${numNodes.toLocaleString()} · Element ${numMembers.toLocaleString()}` : undefined,
  }];

  /* ── 실행 버튼 — 주 버튼 1개 + Ctrl+Enter ─────────────────────────── */
  const canRun = isDataReady && !isRunning && !isSample;
  const runAction = {
    label: projectData || runFailed ? '다시 해석' : '구조 해석 실행',
    icon: projectData || runFailed ? RefreshCw : ChevronsRight,
    onClick: runAnalysis,
    enabled: canRun,
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
    : isSample ? '샘플 결과 표시 중입니다. 새 해석은 BDF 를 올리세요.'
      : !bdfFile ? 'BDF 를 올리면 열립니다.'
        : !isDataReady ? 'BDF 에서 GRID·요소를 읽지 못했습니다.' : null;

  /* ── 다음 행동 ───────────────────────────────────────────────────── */
  const openReport = () => setIsResultModalOpen(true);
  const nextAction = (() => {
    if (isRunning) return null;
    if (activeStep.id === 'input') {
      if (!projectData || runFailed) return null;
      return {
        note: '평가가 끝났습니다. 판정과 결과 표를 확인하세요.',
        primary: { label: '평가 결과로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.results) },
      };
    }
    if (!projectData) {
      return {
        note: runFailed ? '해석이 실패했습니다. 입력 단계에서 원인을 확인하세요.' : '먼저 BDF 로 구조 해석을 실행하세요.',
        primary: { label: '입력으로 돌아가기', icon: FileCheck2, onClick: () => setActiveIdx(STEP_INDEX.input) },
      };
    }
    if (activeStep.id === 'results') {
      return {
        note: verdict.level === 'fail'
          ? '불합격 항목을 결과 표에서 확인하고 BDF 를 보정해 다시 평가하세요. 보고서는 그대로 받을 수 있습니다.'
          : '판정을 확인했다면 결과 보고서(Excel)를 저장하세요.',
        primary: { label: '보고서 저장으로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.report) },
        secondary: [resultView === 'table'
          ? { key: '3d', label: '3D 결과 보기', icon: Eye, onClick: () => setResultView('3d') }
          : { key: 'table', label: '결과 표 보기', icon: FileText, onClick: () => setResultView('table') }],
      };
    }
    return {
      note: delivered ? '보고서를 받았습니다. 다른 형식이 필요하면 다시 열어 받으세요.' : 'Load Case별 Summary·부재·하중분산판·Side Support 시트로 된 Excel 보고서를 받습니다.',
      primary: { label: '결과 보고서 저장', icon: Download, onClick: openReport },
    };
  })();

  const verdictSummary = summary
    ? `부재 ${summary.members.toLocaleString()}건 평가 · 최대 Assessment ${summary.maxAssessment.toFixed(2)}${summary.maxAt ? ` (LC${summary.maxAt.loadCase} · 부재 ${summary.maxAt.element})` : ''}`
    : null;
  const verdictMeta = summary ? `Load Case ${summary.loadCaseCount}개 기준` : null;

  const isStartScreen = activeStep.id === 'input' && !bdfFile && !isRunning && !projectData && !runFailed;
  const currentCaseData = resultJsonData && activeResultCase ? resultJsonData[activeResultCase] : null;

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    // pb-28: 화면 오른쪽 아래 전역 작업·메시지 도크가 마지막 버튼을 가리지 않게 여백을 둔다.
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">

      <FileBasedPageBanner
        title="Truss Structural Assessment"
        subtitle="BDF 모델 파일을 업로드하여 구조적 건전성을 즉시 평가합니다."
        icon={Layers}
        guideTitle="[파일] Truss Structural Assessment — 트러스 구조 안정성 평가"
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
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> 해석 중…</>
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
              {(bdfFile || projectData || runFailed || logs.length > 0) && (
                <button
                  type="button"
                  onClick={resetAssessmentPage}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                >
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <SampleRunButton
                appKey="assessment"
                variant="link"
                label="샘플로 실행"
                disabled={isRunning}
                onBeforeRun={sampleAssessmentBefore}
                onJobSubmitted={sampleAssessmentSubmitted}
                onError={sampleAssessmentError}
              />
            </div>
          </div>

          {/*
            참조사항 — Case Control 에 PRINT 가 빠지면 결과가 .pch 로만 출력되어
            .f06 에 실리지 않는다. 엔진(TrussAssessment.exe)은 .f06 만 읽으므로
            SPCForce/ELForce 를 찾지 못하고 평가가 중단된다(실측 확인).
            해석 실패의 가장 흔한 원인이라 업로드 전에 보이도록 상시 노출한다.
          */}
          <div className="h-px bg-slate-100" />
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <AlertCircle size={13} className="shrink-0 text-amber-600" aria-hidden="true" /> BDF Case Control 확인
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              아래 세 줄이 <strong className="font-bold text-slate-800">PRINT</strong> 를 포함해 지정되어야 합니다.
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-800">
              {['DISPLACEMENT', 'ELFORCE', 'SPCFORCES'].map(cmd => (
                <div key={cmd} className="whitespace-nowrap">
                  {cmd}(<strong className="font-bold text-amber-800">PRINT</strong>,PUNCH) = ALL
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              <strong className="font-bold text-slate-700">PUNCH</strong> 만 지정하면 결과가 <span className="font-mono">.pch</span> 로만
              나가 <span className="font-mono">.f06</span> 에 실리지 않고, 엔진이 부재 응력·하중분산판 평가를 중단합니다.
            </p>
          </div>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {isRunning && (
            <JobProgressCard
              title="구조 해석 중"
              message={statusMessage}
              progress={progress}
              elapsed={elapsedSeconds}
              note="Nastran 해석과 평가까지 수 분 걸릴 수 있습니다. 다른 화면으로 이동해도 계속 진행됩니다."
            />
          )}

          {!isRunning && verdict.level && (
            <VerdictHeader
              level={verdict.level}
              title={verdict.title}
              summary={verdictSummary}
              reasons={verdict.reasons}
              meta={verdictMeta}
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
                  <BdfDropZone
                    file={bdfFile}
                    inputRef={fileInputRef}
                    disabled={isRunning}
                    onFile={handleFile}
                  />

                  {isStartScreen ? (
                    <RunStartPanel
                      programName="Truss Assessment"
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => !!r.input_info?.bdf_model}
                      steps={[
                        { title: 'BDF 입력', detail: 'BDF 의 GRID·요소를 읽어 3D 로 미리 봅니다. Case Control 의 PRINT 지정을 먼저 확인하세요.' },
                        { title: '평가 결과', detail: 'Nastran 해석 후 부재 응력·하중분산판·Side Support 를 Load Case 별로 판정합니다.' },
                        { title: '보고서 저장', detail: 'Load Case 별 시트로 된 Excel 보고서와 F06·OP2 원본을 받습니다.' },
                      ]}
                    />
                  ) : (bdfFile || isDataReady) && (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2" role="tablist" aria-label="모델 미리보기">
                        {[
                          { key: '3d', label: '3D', icon: Eye },
                          { key: 'node', label: `Node${numNodes ? ` ${numNodes.toLocaleString()}` : ''}`, icon: Database },
                          { key: 'member', label: `Element${numMembers ? ` ${numMembers.toLocaleString()}` : ''}`, icon: Layers },
                        ].map(t => (
                          <TabButton key={t.key} active={(activeTab === 'result' ? '3d' : activeTab) === t.key} onClick={() => updateState({ activeTab: t.key })} icon={t.icon} label={t.label} />
                        ))}
                        {isSample && <span className="ml-auto pb-1.5 text-[11px] font-semibold text-slate-600">샘플 모델</span>}
                      </div>
                      <div className="relative h-[clamp(320px,52vh,600px)] bg-white">
                        {(activeTab === '3d' || activeTab === 'result') && (isDataReady
                          ? <AssessmentBdfViewer nodes={nodes} elements={elements} resultData={currentCaseData} />
                          : <EmptyState msg="BDF 를 읽는 중이거나 GRID·요소가 없습니다." Icon={Box} />)}
                        {activeTab === 'node' && (isDataReady ? <DataTable data={nodeTableData} title="Node 좌표 미리보기" /> : <EmptyState msg="BDF 업로드 시 Node 데이터를 볼 수 있습니다." Icon={Database} />)}
                        {activeTab === 'member' && (isDataReady ? <DataTable data={elemTableData} title="Element 연결 미리보기" /> : <EmptyState msg="BDF 업로드 시 Element 데이터를 볼 수 있습니다." Icon={Layers} />)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeStep.id === 'results' && (
                hasResult ? (
                  <>
                    {summary && (
                      <KeyFigures items={[
                        { key: 'members', label: '평가 부재', value: summary.members.toLocaleString(), unit: '건', sub: `Load Case ${summary.loadCaseCount}개 합계` },
                        { key: 'memberFail', label: '부재 불합격', value: summary.memberFail.toLocaleString(), tone: summary.memberFail > 0 ? 'bad' : 'default' },
                        { key: 'max', label: '최대 Assessment', value: summary.maxAssessment.toFixed(2), tone: summary.maxAssessment >= 1 ? 'bad' : summary.maxAssessment >= 0.8 ? 'warn' : 'default',
                          sub: summary.maxAt ? `LC${summary.maxAt.loadCase} · 부재 ${summary.maxAt.element}` : undefined },
                        { key: 'panel', label: '하중분산판 불합격', value: `${summary.panelFail} / ${summary.panels}`, tone: summary.panelFail > 0 ? 'bad' : 'default' },
                        { key: 'support', label: 'Side Support 초과', value: `${summary.supportFail} / ${summary.supports}`, tone: summary.supportFail > 0 ? 'bad' : 'default',
                          sub: `최대 ${Math.round(summary.maxReaction).toLocaleString()} N · 허용 ${SIDE_SUPPORT_ALLOWABLE.toLocaleString()}` },
                      ]} />
                    )}
                    <div className={
                      isResultFullscreen
                        ? 'fixed inset-0 z-[100] flex flex-col overflow-hidden bg-white animate-fade-in'
                        : 'overflow-hidden rounded-lg border border-slate-200'
                    }>
                      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-2" role="tablist" aria-label="평가 결과 보기">
                        <TabButton active={resultView === 'table'} onClick={() => setResultView('table')} icon={FileText} label="결과 표" />
                        <TabButton active={resultView === '3d'} onClick={() => setResultView('3d')} icon={Eye} label="3D 결과" />
                        <button
                          type="button"
                          onClick={() => setIsResultFullscreen(v => !v)}
                          title={isResultFullscreen ? '원래 크기로 돌아가기 (Esc)' : '전체 화면'}
                          className="ml-auto mb-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                        >
                          {isResultFullscreen ? <><Minimize2 size={13} aria-hidden="true" /> 창 복귀</> : <><Maximize2 size={13} aria-hidden="true" /> 전체 화면</>}
                        </button>
                        {isResultFullscreen && (
                          <button type="button" onClick={() => setIsResultFullscreen(false)} aria-label="닫기" className="mb-1 rounded p-1 text-slate-500 hover:bg-slate-200 cursor-pointer"><X size={16} /></button>
                        )}
                      </div>
                      <div className={`relative bg-white ${isResultFullscreen ? 'flex-1' : 'h-[clamp(380px,62vh,720px)]'}`}>
                        {resultView === 'table'
                          ? <MultiJsonViewer resultsMap={resultJsonData} activeCase={activeResultCase} setActiveCase={(c) => updateState({ activeResultCase: c })} />
                          : (isDataReady
                            ? <AssessmentBdfViewer nodes={nodes} elements={elements} resultData={currentCaseData} />
                            : <EmptyState msg="모델 BDF 를 불러오지 못해 3D 를 그릴 수 없습니다." Icon={Box} />)}
                      </div>
                    </div>
                  </>
                ) : projectData && !runFailed ? (
                  <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> 결과 파일을 불러오는 중…</p>
                ) : (
                  <p className="text-sm text-slate-600">구조 해석을 실행하면 여기서 판정과 결과 표를 봅니다.</p>
                )
              )}

              {activeStep.id === 'report' && (
                projectData ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <FileOutput size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">결과 보고서 (Excel)</p>
                        <p className="text-xs text-slate-600">결과 JSON 마다 Load Case별 Summary · Element Assessment · Distribution Panel · Side Support 시트. F06·OP2 원본도 같은 창에서 받습니다.</p>
                      </div>
                      {delivered && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} aria-hidden="true" /> 받음</span>}
                      <button
                        type="button"
                        onClick={openReport}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                      >
                        <Download size={13} aria-hidden="true" /> 받을 파일 고르기
                      </button>
                    </li>
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">구조 해석이 끝나면 여기서 보고서를 받습니다.</p>
                )
              )}
            </div>
          </section>

          <RunLogPanel
            logs={logs}
            open={runFailed}
            note={runFailed ? '실패 리포트 원문 포함' : undefined}
            actions={detailedLogs.length > 0 ? [{ key: 'download', label: '엔진 출력 받기', icon: Download, onClick: downloadDetailedLog }] : []}
          />
        </main>
      </div>

      <SolverCredit contributor="권혁민" />

      {isResultModalOpen && (
        <AssessmentProjectModal
          project={projectData}
          onClose={() => setIsResultModalOpen(false)}
          onDownloaded={() => updateState({ delivered: true })}
        />
      )}
    </div>
  );
}

/** BDF 입력 칸 — 클릭·끌어 놓기. 올린 뒤에는 파일명과 '다른 BDF' 를 보여 준다. */
function BdfDropZone({ file, inputRef, disabled, onFile }) {
  const [over, setOver] = useState(false);
  const pick = () => { if (!disabled) inputRef.current?.click(); };
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <FileText size={13} className="text-slate-600" aria-hidden="true" />
        <span className="text-xs font-bold text-slate-800">모델 BDF</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">필수</span>
        <span className="text-[11px] text-slate-600">.bdf / .dat</span>
        {file && !disabled && (
          <button type="button" onClick={pick} className="ml-auto rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer">
            다른 BDF
          </button>
        )}
      </div>
      <input type="file" accept=".bdf,.dat" className="hidden" ref={inputRef} onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
      <button
        type="button"
        onClick={pick}
        disabled={disabled}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFile(e.dataTransfer.files[0]); }}
        className={`flex w-full flex-col items-center justify-center gap-1 px-4 py-6 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 disabled:cursor-not-allowed cursor-pointer ${over ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
      >
        {file ? (
          <>
            <CheckCircle2 size={18} className="text-emerald-600" aria-hidden="true" />
            <span className="max-w-full truncate text-sm font-semibold text-slate-800">{file.name}</span>
            <span className="text-xs text-slate-600">{file.sample ? '서버 모델(샘플·지난 결과)' : '눌러서 다른 파일로 바꾸기'}</span>
          </>
        ) : (
          <>
            <Upload size={16} className="text-slate-500" aria-hidden="true" />
            <span className="text-xs text-slate-600">.bdf 파일을 놓거나 <span className="font-semibold text-blue-700">눌러서 선택</span></span>
          </>
        )}
      </button>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-md border px-3 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer ${active ? 'border-slate-200 border-b-white bg-white text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
    >
      <Icon size={13} aria-hidden="true" /> {label}
    </button>
  );
}

function EmptyState({ msg, Icon }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white text-slate-500">
      <Icon size={36} className="mb-3 opacity-40" aria-hidden="true" />
      <p className="px-10 text-center text-sm leading-relaxed">{msg}</p>
    </div>
  );
}

function DataTable({ data, title }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="absolute inset-0 overflow-auto bg-white">
      <table className="w-full whitespace-nowrap bg-white text-left font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>{data[0].map((h, i) => <th key={i} className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-700">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.slice(1).map((row, i) => <tr key={i} className="hover:bg-slate-50">{row.map((cell, j) => <td key={j} className="px-4 py-1.5 text-slate-800">{cell}</td>)}</tr>)}
        </tbody>
      </table>
      <div className="sticky bottom-0 z-10 border-t border-slate-100 bg-slate-50 p-2 text-center text-[11px] text-slate-600">{title} · 성능을 위해 상위 100개 항목만 표시합니다.</div>
    </div>
  );
}
