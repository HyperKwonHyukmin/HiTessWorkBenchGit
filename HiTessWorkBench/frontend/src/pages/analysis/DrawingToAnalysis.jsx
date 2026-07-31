/// <summary>
/// DrawingToAnalysis — 설계 도면(PDF) → 구조 해석 모델 변환.
/// </summary>
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Play, FileText, Info, Construction, CheckCircle2, RefreshCw, Download, RotateCcw, AlertCircle, Lightbulb, FileSearch, Sliders, MousePointerClick, Cpu, FileCheck2, XCircle, Image, Ruler, ScanLine } from 'lucide-react';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import { requestDrawingToAnalysis, requestDrawingImageToAnalysis, downloadFileBlob, downloadFileText, runDrawingCatalogue, solveDrawingModel } from '../../api/analysis';
import ShellModelViewer from '../../components/analysis/ShellModelViewer';
import DrawingCatalogueModal from '../../components/analysis/DrawingCatalogueModal';
import DrawingParamsPanel from '../../components/analysis/DrawingParamsPanel';
import DrawingLoadBcPanel from '../../components/analysis/DrawingLoadBcPanel';
import SolveResultsPanel from '../../components/analysis/SolveResultsPanel';

/** 파일명 / 카테고리에서 lug/support 모드 결정 — 백엔드 분류 규칙과 동일 */
const resolveDrawingMode = (categoryOrFilename) => {
  const s = String(categoryOrFilename || '').toLowerCase();
  if (s.includes('support') || s.startsWith('bs_') || s.startsWith('bs.') || s === 'bs') return 'support';
  return 'lug';
};

/** mode 별 기본 mesh size — Support 는 30, Lug 는 10 */
const defaultMeshSize = (mode) => (mode === 'support' ? 30.0 : 10.0);

/* ──────────────────────────────────────────────────────────────────────────
   Lug 표시 좌표계: 사용자가 hole 수직방향을 Z 로 보고 싶어함.
   원본(BDF) 프레임은 평면이 XY(z=0), height 가 Y. → 표시/입력 프레임에서 Y↔Z 스왑.
   display ↔ BDF 는 동일한 swap 으로 상호 변환(자기역변환). Lug 모드에서만 적용.
   ──────────────────────────────────────────────────────────────────────── */
const swapYZpoint = (p) => ({ ...p, y: p.z, z: p.y });
const swapYZvec   = (fx, fy, fz) => ({ fx, fy: fz, fz: fy });
// dof 문자열 표시→BDF: TY(2)↔TZ(3), RY(5)↔RZ(6)
const SWAP_DOF_MAP = { 2: '3', 3: '2', 5: '6', 6: '5' };
const swapDof = (dof) => String(dof || '').split('').map((d) => SWAP_DOF_MAP[d] || d).join('');

/** Lug Hole RBE 정보 계산 — hole 중심 + edge ring 노드 (표시 프레임 기준).
 *  표시 프레임에서 lug 평면은 XZ(y≈0), hole 은 (left_to_hole_center, *, 0) 중심의
 *  X-Z 평면 원. ring = 중심에서 반경 hole_diameter/2 (±tol) 에 놓인 y≈0 노드들.
 *  중심 독립노드 id 는 max(node id)+1 로 부여한다(뷰어에서 선택 가능 + BDF GRID 신규).
 *  RBE 는 순수 강체 결합만 — 하중은 일반 하중 영역에서 중심노드를 선택해 적용한다.
 *  반환: { centerId, center:{x,y,z}, ringNodeIds:[id] } | null  (표시 프레임)
 */
const buildHoleRbe = (params, modelData) => {
  if (!params || !modelData) return null;
  const R = Number(params.hole_diameter ?? 0) / 2;
  const cx = Number(params.left_to_hole_center ?? 0);
  if (!(R > 0)) return null;
  const nodes = modelData.nodes || modelData.grids || [];
  const tol = Math.max(1.5, R * 0.06);
  const ringNodeIds = [];
  let maxId = 0;
  for (const n of nodes) {
    const id = Number(n.id);
    if (id > maxId) maxId = id;
    const x = Number(n.x || 0), y = Number(n.y || 0), z = Number(n.z || 0);
    if (Math.abs(y) > 1e-3) continue;            // 표시 프레임 평면 = y≈0
    const d = Math.hypot(x - cx, z - 0);         // X-Z 평면 반경
    if (Math.abs(d - R) < tol) ringNodeIds.push(Number(n.id));
  }
  if (ringNodeIds.length < 3) return null;
  const center = { x: cx, y: 0, z: 0 };
  return { centerId: maxId + 1, center, ringNodeIds };
};

/** 모델 노드 중 최대 id (신규 GRID id 부여용). */
const maxNodeId = (modelData) => {
  const nodes = modelData?.nodes || modelData?.grids || [];
  let m = 0;
  for (const n of nodes) { const id = Number(n.id); if (id > m) m = id; }
  return m;
};

/** 모델 전체 bbox 의 최대 변 길이 (표시 오프셋 스케일용). */
const modelMaxDim = (modelData) => {
  const nodes = modelData?.nodes || modelData?.grids || [];
  if (!nodes.length) return 1;
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const n of nodes) {
    const x = Number(n.x || 0), y = Number(n.y || 0), z = Number(n.z || 0);
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Math.max(mxx - mnx, mxy - mny, mxz - mnz, 1);
};

/** 연결 노드 집합이 가장 얇은 축(=면 법선 근사) + 모델 중심 반대 방향 부호.
 *  축정렬 FE 메쉬(평판)에서 면 밖으로 노드를 띄울 방향을 반환. {x,y,z} 단위벡터. */
const offsetNormal = (modelData, connectedIds) => {
  const nodes = modelData?.nodes || [];
  const byId = new Map(nodes.map((n) => [Number(n.id), n]));
  const pts = (connectedIds || []).map((id) => byId.get(Number(id))).filter(Boolean);
  if (pts.length < 1) return { x: 0, y: 0, z: 1 };
  const rng = (k) => {
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { const v = Number(p[k] || 0); if (v < mn) mn = v; if (v > mx) mx = v; }
    return { mn, mx, span: mx - mn };
  };
  const rx = rng('x'), ry = rng('y'), rz = rng('z');
  const minSpan = Math.min(rx.span, ry.span, rz.span);
  let axis = 'z';
  if (minSpan === rx.span) axis = 'x';
  else if (minSpan === ry.span) axis = 'y';
  // 모델 중심 대비 연결 노드 평면이 어느 쪽인지 → 바깥(중심 반대) 방향으로 부호 결정
  const allMid = (k) => {
    let mn = Infinity, mx = -Infinity;
    for (const n of nodes) { const v = Number(n[k] || 0); if (v < mn) mn = v; if (v > mx) mx = v; }
    return (mn + mx) / 2;
  };
  const r = axis === 'x' ? rx : axis === 'y' ? ry : rz;
  const planeMid = (r.mn + r.mx) / 2;
  const sign = planeMid >= allMid(axis) ? 1 : -1;
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
};

/** 면 위 true 좌표를 면 밖으로 띄운 표시용 좌표 (뷰어 선택 편의). */
const liftedCenter = (modelData, center, connectedIds, frac = 0.1) => {
  const n = offsetNormal(modelData, connectedIds);
  const d = modelMaxDim(modelData) * frac;
  return { x: center.x + n.x * d, y: center.y + n.y * d, z: center.z + n.z * d };
};

/** 노드 id 집합의 무게중심 좌표 (표시 프레임). */
const nodesCentroid = (modelData, nodeIds) => {
  const nodes = modelData?.nodes || [];
  const byId = new Map(nodes.map((n) => [Number(n.id), n]));
  let sx = 0, sy = 0, sz = 0, c = 0;
  for (const id of nodeIds || []) {
    const n = byId.get(Number(id));
    if (!n) continue;
    sx += Number(n.x || 0); sy += Number(n.y || 0); sz += Number(n.z || 0); c += 1;
  }
  if (!c) return null;
  return { x: sx / c, y: sy / c, z: sz / c };
};

const formatBytes = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DrawingToAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const { startGlobalJob, clearGlobalJob, clearGlobalJobForMenu } = dashboardCtx;
  const { showToast } = useToast();
  const PAGE_KEY = 'DrawingToAnalysis';
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};
  const [inputMode, setInputMode] = useState(savedPageState.inputMode ?? 'pdf'); // 'pdf' | 'image'
  const [pdfFile, setPdfFile] = useState(savedPageState.pdfFile ?? null);
  const [imageFile, setImageFile] = useState(savedPageState.imageFile ?? null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [resultImageUrl, setResultImageUrl] = useState('');
  const [imageReferenceLength, setImageReferenceLength] = useState(savedPageState.imageReferenceLength ?? '');
  const [isDragOver, setIsDragOver] = useState(false);
  const [resultInfo, setResultInfo] = useState(savedPageState.resultInfo ?? null);
  const [analysisDbId, setAnalysisDbId] = useState(savedPageState.analysisDbId ?? null);
  const [modelData, setModelData] = useState(savedPageState.modelData ?? null);
  const [modelLoadError, setModelLoadError] = useState(savedPageState.modelLoadError ?? '');
  const [failureReason, setFailureReason] = useState(savedPageState.failureReason ?? '');
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [paramsJson, setParamsJson] = useState(savedPageState.paramsJson ?? null);
  const [modelMode,  setModelMode]  = useState(savedPageState.modelMode ?? 'lug'); // 'lug' | 'support'
  const [highlightedParam, setHighlightedParam] = useState(savedPageState.highlightedParam ?? null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // ── 탭 / 하중·경계조건 / 구조해석 상태 ──────────────────────────
  const [activeTab, setActiveTab]         = useState(savedPageState.activeTab ?? 'params'); // 'params' | 'loadbc'
  const [selectionMode, setSelectionMode] = useState(savedPageState.selectionMode ?? 'none');   // 'none' | 'load' | 'bc'
  const [selection, setSelection]         = useState(savedPageState.selection ?? []);       // 현재 선택 중인 노드 id
  const [loadSets, setLoadSets]           = useState(savedPageState.loadSets ?? []);
  const [bcSets, setBcSets]               = useState(savedPageState.bcSets ?? []);
  const [holeRbe, setHoleRbe]             = useState(savedPageState.holeRbe ?? null);      // { center, ringNodeIds, fx, fy, fz }
  const [rbe3Sets, setRbe3Sets]           = useState(savedPageState.rbe3Sets ?? []);        // [{ refId, center, nodeIds }] — Area 하중분배(Block Support)
  const [loadCases, setLoadCases]         = useState(savedPageState.loadCases ?? []);        // [{ name, bcIndices, loadIndices, includeRbe }]
  const [solveResult, setSolveResult]     = useState(savedPageState.solveResult ?? null);     // 해석 결과 result_info
  const [solveError, setSolveError]       = useState(savedPageState.solveError ?? '');
  const [solveResultsJson, setSolveResultsJson] = useState(savedPageState.solveResultsJson ?? null); // 파싱된 F06 결과(변위/응력)
  const [resultSubcaseIdx, setResultSubcaseIdx] = useState(savedPageState.resultSubcaseIdx ?? 0);
  const [resultField, setResultField]     = useState(savedPageState.resultField ?? 'disp');   // 'disp' | 'vm' 컨투어 필드
  const currentJobKind = useRef('convert'); // 'convert' | 'rebuild' | 'solve'

  const clearLoadBc = () => {
    setSelectionMode('none');
    setSelection([]);
    setLoadSets([]);
    setBcSets([]);
    setHoleRbe(null);
    setRbe3Sets([]);
    setLoadCases([]);
    setSolveResult(null);
    setSolveError('');
    setSolveResultsJson(null);
    setResultSubcaseIdx(0);
    setActiveTab('params');
  };

  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob,
    reset, setLogs, setStatusMessage, setIsRunning, setProgress,
  } = useAnalysisJob({
    startGlobalJob,
    clearGlobalJob,
    savedState: savedPageState,
    setSavedState: (patch) => dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, patch),
    pollingMaxRetries: 400,
    successLogMessage: 'BDF 변환 완료.',
    errorLogMessage: '',          // 단순 한 줄 메시지 비활성 — onError 에서 상세 출력
    timeoutLogMessage: '시간 초과 (10분). PDF 또는 서버 상태를 확인하세요.',
    onComplete: async (data) => {
      const { engine_log, project } = data;
      if (engine_log) addLog(`[SOLVER] ${engine_log.trim()}`, 'info');

      // ── 구조 해석(solve) 결과: 모델 뷰는 유지하고 결과만 별도 표시 ──
      if (currentJobKind.current === 'solve') {
        setStatusMessage('구조 해석 완료');
        setSolveError('');
        if (project?.result_info) setSolveResult(project.result_info);
        showToast('Nastran 구조 해석이 완료되었습니다.', 'success');
        return;
      }

      // ── 변환 / 재구축 결과 ──
      setStatusMessage('변환 완료');
      setFailureReason('');
      if (project?.result_info) {
        setResultInfo(project.result_info);
        setAnalysisDbId(project.id);
      }
    },
    onError: (errData) => {
      const engineLog = errData?.engine_log || '';
      const project   = errData?.project;

      // ── 구조 해석(solve) 실패: 모델 뷰 유지, 토스트 Notice ──
      if (currentJobKind.current === 'solve') {
        const first = engineLog.split('\n').find((l) => l.trim()) || 'Nastran 해석에 실패했습니다.';
        const reason = first.replace(/^🚫\s*구조\s*해석\s*실패\s*—\s*/, '');
        setSolveError(reason);
        if (project?.result_info) setSolveResult(project.result_info); // diagnostic 다운로드용
        if (engineLog) {
          engineLog.split('\n').forEach((line) => {
            const t = line.trim(); if (!t) return;
            addLog(t, /\[error\]|🚫|fatal|failed/i.test(t) ? 'error' : /warning/i.test(t) ? 'warning' : 'info');
          });
        }
        showToast(`구조 해석 실패: ${reason}`, 'error');
        return;
      }

      // 타임아웃은 useAnalysisJob 이 timeoutLogMessage 로 이미 처리
      if (errData?.timeout) {
        const msg = '처리 시간이 초과되었습니다 (10분). PDF 또는 서버 상태를 확인하세요.';
        setFailureReason(msg);
        showToast(msg, 'error');
        return;
      }
      // 백엔드가 합성한 '🚫 변환 실패 — ...' 헤더를 그대로 노출
      const firstLine = engineLog.split('\n').find((l) => l.trim()) || 'BDF 변환에 실패했습니다.';
      const reason = firstLine.replace(/^🚫\s*변환\s*실패\s*—\s*/, '');
      setFailureReason(reason);
      // 미지원 도면/PDF 등 변환 실패를 사용자에게 즉시 알림(Notice)
      showToast(`변환 실패: ${reason}`, 'error');
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

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      inputMode, pdfFile, imageFile, imageReferenceLength,
      resultInfo, analysisDbId, modelData, modelLoadError, failureReason,
      paramsJson, modelMode, highlightedParam, activeTab, selectionMode, selection,
      loadSets, bcSets, holeRbe, rbe3Sets, loadCases, solveResult, solveError,
      solveResultsJson, resultSubcaseIdx, resultField,
    });
  }, [
    inputMode, pdfFile, imageFile, imageReferenceLength,
    resultInfo, analysisDbId, modelData, modelLoadError, failureReason,
    paramsJson, modelMode, highlightedParam, activeTab, selectionMode, selection,
    loadSets, bcSets, holeRbe, rbe3Sets, loadCases, solveResult, solveError,
    solveResultsJson, resultSubcaseIdx, resultField,
  ]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (!resultInfo?.input_image) {
      setResultImageUrl('');
      return undefined;
    }
    let objectUrl = '';
    let cancelled = false;
    (async () => {
      try {
        const res = await downloadFileBlob(resultInfo.input_image);
        objectUrl = URL.createObjectURL(res.data);
        if (!cancelled) setResultImageUrl(objectUrl);
      } catch {
        if (!cancelled) setResultImageUrl('');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resultInfo?.input_image]);

  const resetDrawingPage = () => {
    reset();
    // 이 App 의 기록만 지운다 — 무인자 호출은 Job Center 전체를 비운다.
    clearGlobalJobForMenu?.(PAGE_KEY);
    dashboardCtx?.clearAnalysisPageState?.(PAGE_KEY);
    setInputMode('pdf');
    setPdfFile(null);
    setImageFile(null);
    setImageReferenceLength('');
    setIsDragOver(false);
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    setModelMode('lug');
    setHighlightedParam(null);
    clearLoadBc();
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
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
    clearLoadBc();
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: `[FILE] ${file.name} 선택됨. (mode=${mode})`,
      type: 'info',
    }]);
  };

  const handleImageFile = (file) => {
    if (!file) return;
    const isSupportedImage = /\.(png|jpe?g)$/i.test(file.name) || ['image/png', 'image/jpeg'].includes(file.type);
    if (!isSupportedImage) {
      showToast('PNG 또는 JPG 파일만 업로드 가능합니다.', 'error');
      return;
    }
    setImageFile(file);
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    setParamsJson(null);
    clearLoadBc();
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: `[IMAGE] ${file.name} 선택됨. 기준선 두 점과 실제 길이를 확인한 뒤 인식 단계로 진행합니다.`,
      type: 'info',
    }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (inputMode === 'image') handleImageFile(e.dataTransfer.files?.[0]);
    else handleFile(e.dataTransfer.files?.[0]);
  };

  const handleRun = async () => {
    if (isRunning) return;
    if (inputMode === 'image') {
      if (!imageFile) return;
      const meshSize = defaultMeshSize('lug');
      setModelMode('lug');
      setIsRunning(true);
      setProgress(0);
      setStatusMessage('이미지 변환 요청 중...');
      setResultInfo(null);
      setAnalysisDbId(null);
      setModelData(null);
      setModelLoadError('');
      setFailureReason('');
      setParamsJson(null);
      clearLoadBc();
      setLogs([]);

      const formData = new FormData();
      formData.append('image_file', imageFile);
      formData.append('employee_id', employeeId);
      formData.append('mesh_size', String(meshSize));
      formData.append('source', 'Workbench-Image');
      if (imageReferenceLength) formData.append('reference_length_mm', String(imageReferenceLength));

      try {
        currentJobKind.current = 'convert';
        const res = await requestDrawingImageToAnalysis(formData);
        const jobId = res.data.job_id;
        addLog(`[IMAGE] 이미지 변환 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
        startJob(jobId, 'DrawingToAnalysis');
      } catch (err) {
        const detail = err?.response?.data?.detail;
        const msg = typeof detail === 'string' ? detail : (err?.message || '이미지 변환 요청 실패');
        setIsRunning(false);
        addLog(`이미지 변환 요청 실패: ${msg}`, 'error');
        showToast(`이미지 변환 요청 실패: ${msg}`, 'error');
      }
      return;
    }

    if (!pdfFile) return;
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
    clearLoadBc();
    setLogs([]);

    const formData = new FormData();
    formData.append('pdf_file', pdfFile);
    formData.append('employee_id', employeeId);
    formData.append('mesh_size', String(meshSize));
    formData.append('source', 'Workbench');
    formData.append('mode', mode);

    try {
      currentJobKind.current = 'convert';
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
    clearLoadBc();
    setLogs([{
      time: new Date().toLocaleTimeString(),
      message: `[CATALOGUE] '${filename}' 선택됨. (mode=${mode}, mesh_size=${meshSize})`,
      type: 'info',
    }]);
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');

    try {
      currentJobKind.current = 'convert';
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
        const parsed = JSON.parse(text);
        // Lug: PDF LUG는 기존 엔진 프레임 때문에 Y↔Z만 스왑한다.
        // 이미지 LUG는 BDF 자체가 X=전체 높이(H), Y=폭(W), Z=0 프레임으로 생성되므로
        // 여기서 추가 회전하면 설계 파라미터/하이라이트 좌표와 어긋난다.
        if (modelMode === 'lug' && Array.isArray(parsed.nodes)) {
          const isImageResult = Boolean(resultInfo?.input_image || resultInfo?.detected_geometry_json || resultInfo?.source_kind === 'image');
          if (!isImageResult) parsed.nodes = parsed.nodes.map(swapYZpoint);
        }
        setModelData(parsed);
      } catch (error) {
        setModelData(null);
        setModelLoadError(error?.message || '모델 JSON 로드 실패');
      }
    };
    loadModelJson();
  }, [resultInfo?.model_json, resultInfo?.input_image, resultInfo?.detected_geometry_json, modelMode]);

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
    currentJobKind.current = 'rebuild';
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('재구축 작업 요청됨...');
    setResultInfo(null);
    setAnalysisDbId(null);
    setModelData(null);
    setModelLoadError('');
    setFailureReason('');
    clearLoadBc();  // 형상이 바뀌면 노드 id 가 달라지므로 하중/경계조건 초기화
    addLog(`[REBUILD] 새 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
    startJob(jobId, PAGE_KEY);
  };

  /* ── 노드 선택 / 하중·경계조건 세트 관리 ──────────────────────── */
  const startSelection  = (target) => { setActiveTab('loadbc'); setSelectionMode(target); setSelection([]); };
  const cancelSelection = () => { setSelectionMode('none'); setSelection([]); };
  const commitLoad = (ls) => { setLoadSets((p) => [...p, ls]); setSelectionMode('none'); setSelection([]); };
  const commitBc   = (bc) => { setBcSets((p) => [...p, bc]);   setSelectionMode('none'); setSelection([]); };
  // 인덱스 배열에서 삭제 인덱스를 제거하고 그보다 큰 인덱스는 1 감소 (LC 참조 무결성 유지)
  const remapAfterRemoval = (indices, removed) =>
    indices.filter((x) => x !== removed).map((x) => (x > removed ? x - 1 : x));

  const removeLoad = (i) => {
    setLoadSets((p) => p.filter((_, k) => k !== i));
    setLoadCases((lcs) => lcs.map((lc) => ({ ...lc, loadIndices: remapAfterRemoval(lc.loadIndices, i) })));
  };
  const removeBc = (i) => {
    setBcSets((p) => p.filter((_, k) => k !== i));
    setLoadCases((lcs) => lcs.map((lc) => ({ ...lc, bcIndices: remapAfterRemoval(lc.bcIndices, i) })));
  };

  /* ── Load Case 빌더 ─────────────────────────────────────────── */
  const addLoadCase = () => {
    setLoadCases((p) => [
      ...p,
      {
        name: `LC${p.length + 1}`,
        bcIndices: bcSets.map((_, k) => k),  // 기본: 모든 경계조건 포함(공통 구속)
        loadIndices: [],
      },
    ]);
  };
  const removeLoadCase = (i) => setLoadCases((p) => p.filter((_, k) => k !== i));
  const renameLoadCase = (i, name) =>
    setLoadCases((p) => p.map((lc, k) => (k === i ? { ...lc, name } : lc)));
  const toggleInArray = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleLcBc = (i, bcIdx) =>
    setLoadCases((p) => p.map((lc, k) => (k === i ? { ...lc, bcIndices: toggleInArray(lc.bcIndices, bcIdx) } : lc)));
  const toggleLcLoad = (i, loadIdx) =>
    setLoadCases((p) => p.map((lc, k) => (k === i ? { ...lc, loadIndices: toggleInArray(lc.loadIndices, loadIdx) } : lc)));

  /* ── Lug Hole RBE 생성/시각화 (생성 시엔 뷰어 시각화만, BDF 반영은 solve 시) ── */
  const createHoleRbe = () => {
    const rbe = buildHoleRbe(paramsJson, modelData);
    if (!rbe) {
      showToast('Hole edge 노드를 찾지 못했습니다. (Lug 도면/파라미터 확인)', 'error');
      return;
    }
    setHoleRbe(rbe);
    setActiveTab('loadbc');
    showToast(`Lug Hole RBE 생성 — 중심노드 #${rbe.centerId} (ring ${rbe.ringNodeIds.length}개). 하중 영역에서 중심노드를 선택해 Force 적용`, 'success');
  };
  const removeHoleRbe = () => setHoleRbe(null);

  /* ── Area RBE3 생성/삭제 (Block Support — 넓은 영역 총합 하중 분배) ──
     현재 선택 영역 노드를 독립 grid 로, 무게중심에 기준노드(REFGRID)를 만들어 RBE3 결합.
     기준노드에 하중을 주면 RBE3 가 영역으로 가중분배(강성 추가 없음). */
  const commitRbe3 = (nodeIds) => {
    const ids = [...new Set((nodeIds || []).map(Number).filter(Number.isFinite))];
    if (ids.length < 1) {
      showToast('RBE3 로 묶을 영역 노드를 선택하세요.', 'error');
      return;
    }
    const c = nodesCentroid(modelData, ids);
    if (!c) { showToast('영역 노드를 찾지 못했습니다.', 'error'); return; }
    // 신규 기준노드 id: 모델 최대 + Hole RBE 중심 + 기존 RBE3 기준노드들 이후로 부여(충돌 방지).
    let base = maxNodeId(modelData);
    if (holeRbe?.centerId) base = Math.max(base, holeRbe.centerId);
    rbe3Sets.forEach((r) => { if (r.refId > base) base = r.refId; });
    const refId = base + 1;
    // 표시용: 기준노드를 면 밖으로 띄워 선택 쉽게 (해석은 c 사용 — 면 위, 모멘트 없음)
    const displayCenter = liftedCenter(modelData, c, ids);
    setRbe3Sets((p) => [...p, { refId, center: c, displayCenter, nodeIds: ids }]);
    setSelectionMode('none');
    setSelection([]);
    showToast(`하중 분배(RBE3) 생성 — 기준노드 #${refId} (영역 ${ids.length}개). ② 하중에서 기준노드를 선택해 총 Force 적용`, 'success');
  };
  const removeRbe3 = (i) => setRbe3Sets((p) => p.filter((_, k) => k !== i));

  /** 뷰어에 넘길 모델 — RBE 기준/중심 독립노드를 노드 목록에 추가해 선택 가능하게 한다. */
  const viewerModelData = useMemo(() => {
    if (!modelData) return modelData;
    const nodes = modelData.nodes || [];
    const existing = new Set(nodes.map((n) => Number(n.id)));
    const extra = [];
    if (holeRbe?.centerId && !existing.has(holeRbe.centerId)) {
      const dc = holeRbe.center;
      extra.push({ id: holeRbe.centerId, x: dc.x, y: dc.y, z: dc.z, tags: ['rbe-center'] });
      existing.add(holeRbe.centerId);
    }
    for (const r of rbe3Sets) {
      if (r.refId && !existing.has(r.refId)) {
        const dc = r.displayCenter || r.center;
        extra.push({ id: r.refId, x: dc.x, y: dc.y, z: dc.z, tags: ['rbe3-ref'] });
        existing.add(r.refId);
      }
    }
    if (!extra.length) return modelData;
    return { ...modelData, nodes: [...nodes, ...extra] };
  }, [modelData, holeRbe, rbe3Sets]);

  /* ── 해석 결과(F06 JSON) 로드 — solve 완료 시 results_json 다운로드/파싱 ── */
  useEffect(() => {
    const path = solveResult?.results_json;
    if (!path) { setSolveResultsJson(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await downloadFileText(path);
        const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (!cancelled) { setSolveResultsJson(json); setResultSubcaseIdx(0); }
      } catch (e) {
        if (!cancelled) { setSolveResultsJson(null); addLog(`결과 JSON 로드 실패: ${e?.message || e}`, 'error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [solveResult?.results_json]);

  /** 현재 SUBCASE 결과 + 뷰어 컨투어용 요소값/범위/테이블 rows 계산. */
  const resultView = useMemo(() => {
    const subcases = solveResultsJson?.analysisResults?.subcases || [];
    if (!subcases.length) return null;
    const idx = Math.min(resultSubcaseIdx, subcases.length - 1);
    const sc = subcases[idx];

    // 노드 변위 행 + 노드별 |U|
    const dispRows = (sc.displacements || []).map((d) => {
      const t1 = Number(d.t1 || 0), t2 = Number(d.t2 || 0), t3 = Number(d.t3 || 0);
      return { pointId: d.pointId, t1, t2, t3, mag: Math.hypot(t1, t2, t3) };
    });
    const dispByNode = new Map(dispRows.map((r) => [Number(r.pointId), r.mag]));

    // 요소 응력 행 (CQUAD4 + CTRIA3 병합)
    const stressRows = [...(sc.quadStresses || []), ...(sc.triaStresses || [])]
      .map((s) => ({
        elementId: s.elementId, elementType: s.elementType,
        vonMises: s.vonMises, vmZ1: s.vmZ1, vmZ2: s.vmZ2,
      }))
      .sort((a, b) => a.elementId - b.elementId);
    const vmByElem = new Map(stressRows.map((s) => [Number(s.elementId), s.vonMises]));

    // 요소→노드 매핑 (변위 컨투어: 요소 노드들의 |U| 최대값)
    const elements = modelData?.elements || [];
    const elemValuesDisp = {};
    for (const el of elements) {
      const ids = (el.nodeIds || []).map(Number);
      let mx = null;
      for (const nid of ids) { const v = dispByNode.get(nid); if (v != null && (mx == null || v > mx)) mx = v; }
      if (mx != null) elemValuesDisp[Number(el.id)] = mx;
    }
    const elemValuesVm = {};
    vmByElem.forEach((v, k) => { if (v != null) elemValuesVm[k] = v; });

    const rangeOf = (obj) => {
      const vals = Object.values(obj).filter((v) => v != null && !Number.isNaN(v));
      if (!vals.length) return [0, 1];
      return [Math.min(...vals, 0), Math.max(...vals)];  // min 은 0 기준(변위·응력 모두 0 이상)
    };

    const elementValues = resultField === 'vm' ? elemValuesVm : elemValuesDisp;
    const valueRange = rangeOf(elementValues);
    const valueLabel = resultField === 'vm' ? '응력' : '변위 |U|';
    const valueUnit = resultField === 'vm' ? 'MPa' : 'mm';

    return { subcases, idx, dispRows, stressRows, elementValues, valueRange, valueLabel, valueUnit };
  }, [solveResultsJson, resultSubcaseIdx, resultField, modelData]);

  const hasResults = !!resultView;

  /** 해석 대상 BDF 가 위치한 폴더 (solve 결과는 그 하위 solve_<ts>/ 에 저장) */
  const solveWorkDir = useMemo(() => {
    const bdf = resultInfo?.bdf;
    if (!bdf) return null;
    return bdf.replace(/[\\/][^\\/]+$/, '');
  }, [resultInfo?.bdf]);

  /** 구조 해석 실행 — 하중/경계조건을 BDF 에 반영해 Nastran 실행 */
  const handleSolve = async () => {
    if (isRunning) return;
    if (!resultInfo?.bdf || !solveWorkDir) {
      showToast('먼저 PDF → 모델 변환을 완료하세요.', 'error');
      return;
    }
    if (bcSets.length === 0) {
      showToast('경계조건(구속)을 최소 1개 이상 추가하세요.', 'error');
      return;
    }
    setSelectionMode('none');
    setSelection([]);
    setSolveResult(null);
    setSolveError('');
    setSolveResultsJson(null);
    setResultSubcaseIdx(0);
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('구조 해석 요청 중...');
    addLog(`[SOLVE] 하중 ${loadSets.length}세트 / 경계조건 ${bcSets.length}세트${holeRbe ? ' / Hole RBE' : ''}${rbe3Sets.length ? ` / RBE3 ${rbe3Sets.length}` : ''} / Load Case ${loadCases.length || '자동 1'}개로 Nastran 해석 요청`, 'info');
    // Lug 은 표시 프레임(Y↔Z 스왑)에서 입력받으므로 BDF 원본 프레임으로 역변환.
    const isLug = modelMode === 'lug';
    const loadsPayload = loadSets.map((s) => {
      const f = isLug
        ? swapYZvec(Number(s.fx) || 0, Number(s.fy) || 0, Number(s.fz) || 0)
        : { fx: Number(s.fx) || 0, fy: Number(s.fy) || 0, fz: Number(s.fz) || 0 };
      return { nodes: s.nodes, ...f };
    });
    const bcsPayload = bcSets.map((b) => (isLug ? { ...b, dof: swapDof(b.dof) } : b));
    // Hole RBE 는 순수 강체 결합 — 하중 없음. 중심좌표는 BDF 프레임으로 역변환.
    const holeRbePayload = holeRbe
      ? {
          center_id: holeRbe.centerId,
          center: isLug ? swapYZpoint(holeRbe.center) : holeRbe.center,
          ring_node_ids: holeRbe.ringNodeIds,
        }
      : null;
    // Area RBE3 — 기준노드 좌표는 BDF 프레임으로 역변환(lug). 결합만, 하중은 별도 load set.
    const rbe3SetsPayload = rbe3Sets.map((r) => ({
      ref_id: r.refId,
      center: isLug ? swapYZpoint(r.center) : r.center,
      node_ids: r.nodeIds,
    }));
    // Load Cases → 백엔드 스키마(snake_case, 인덱스 참조). 비어있으면 백엔드가 기본 LC 자동 생성.
    const loadCasesPayload = loadCases.map((lc) => ({
      name: lc.name,
      bc_ids: lc.bcIndices,
      load_ids: lc.loadIndices,
    }));
    try {
      currentJobKind.current = 'solve';
      const res = await solveDrawingModel({
        employeeId,
        workDir: solveWorkDir,
        bdfPath: resultInfo.bdf,
        mode: modelMode,
        loads: loadsPayload,
        bcs: bcsPayload,
        holeRbe: holeRbePayload,
        rbe3Sets: rbe3SetsPayload,
        loadCases: loadCasesPayload,
      });
      const jobId = res.data.job_id;
      addLog(`[SOLVE] 해석 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, PAGE_KEY);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (err?.message || '해석 요청 실패');
      setIsRunning(false);
      addLog(`구조 해석 요청 실패: ${msg}`, 'error');
      showToast(`구조 해석 요청 실패: ${msg}`, 'error');
    }
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

  const isImageResult = Boolean(resultInfo?.input_image || resultInfo?.detected_geometry_json || resultInfo?.source_kind === 'image');
  const referenceImageUrl = imagePreviewUrl || resultImageUrl;

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <FileBasedPageBanner
        title="Drawing to Analysis"
        subtitle="설계 도면(PDF)을 구조 해석 BDF 모델로 변환"
        icon={FileText}
        onBack={() => setCurrentMenu('File-Based Apps')}
        actions={(
          <>
          <button
            type="button"
            onClick={resetDrawingPage}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} /> 초기화
          </button>
          {resultInfo ? (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold uppercase ${
              modelMode === 'support'
                ? 'bg-indigo-500/25 border-indigo-300/50 text-indigo-100'
                : 'bg-blue-500/25 border-blue-300/50 text-blue-100'
            }`}>
              <CheckCircle2 size={12} /> {modelMode === 'support' ? 'Block Support' : 'LUG'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white/90 text-[11px] font-medium">
              LUG · Support 지원
            </span>
          )}
          </>
        )}
      />

      {/* 지원 범위 안내 */}
      <div className="flex items-start gap-2.5 mb-4 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl shrink-0">
        <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          <span className="font-bold">지원 범위</span>
          {' — '}LUG 및 Block Support 벡터 PDF를 rule-based 파이프라인으로 파싱하고, JPG/PNG LUG 이미지는 반자동 seed 파라미터로 shell BDF를 생성합니다.
          DRM 적용 PDF는 지원하지 않습니다.
        </p>
      </div>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* 왼쪽 사이드바 — 자식들이 flex 로 압축돼 overflow-hidden 카드에 잘리지 않도록
            [&>*]:shrink-0 로 자연 높이를 유지하고, 넘치면 사이드바가 스크롤되게 한다. */}
        <div className="w-[340px] shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1 [&>*]:shrink-0">

          {/* 입력 소스 선택 + 업로드 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-1 bg-slate-100 border-b border-slate-200 flex gap-1">
              <button
                type="button"
                onClick={() => setInputMode('pdf')}
                disabled={isRunning}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  inputMode === 'pdf' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <FileText size={12} /> PDF
              </button>
              <button
                type="button"
                onClick={() => setInputMode('image')}
                disabled={isRunning}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  inputMode === 'image' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Image size={12} /> JPG/PNG
              </button>
            </div>

            {inputMode === 'pdf' ? (
              <>
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
              </>
            ) : (
              <div className="px-4 pt-4 pb-4 space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">그림파일 직접 업로드</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5 pl-3.5">
                    JPG/PNG 도면 이미지를 올리고 기준선 두 점의 실제 길이를 지정합니다.
                  </p>
                  <div
                    onClick={() => imageInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl py-5 px-4 text-center cursor-pointer transition-colors ${
                      isDragOver
                        ? 'border-emerald-400 bg-emerald-50'
                        : imageFile
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
                    }`}
                  >
                    <Image size={22} className={`mx-auto mb-1.5 ${imageFile ? 'text-emerald-500' : 'text-slate-300'}`} />
                    {imageFile ? (
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 truncate px-2">{imageFile.name}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatBytes(imageFile.size)}</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-slate-500">클릭하거나 이미지를 드래그하세요</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">.jpg, .jpeg, .png 파일</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => handleImageFile(e.target.files?.[0])}
                  />
                  {imageFile && (
                    <button
                      type="button"
                      onClick={() => { setImageFile(null); setResultInfo(null); setAnalysisDbId(null); }}
                      disabled={isRunning}
                      className="mt-1.5 w-full text-[11px] text-slate-400 hover:text-rose-500 font-semibold transition-colors disabled:opacity-50"
                    >
                      파일 제거
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                    <Ruler size={12} /> 기준 치수
                  </div>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-500">기준선 실제 길이 (mm)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={imageReferenceLength}
                      onChange={(e) => setImageReferenceLength(e.target.value)}
                      placeholder="예: 120"
                      className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <p className="text-[10px] text-emerald-700/80 leading-snug">
                    다음 단계에서 이미지 위 기준선 두 점을 클릭해 픽셀-mm 스케일을 확정합니다.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 mb-2">
                    <ScanLine size={12} /> 반자동 워크플로우
                  </div>
                  <ol className="space-y-1.5 text-[10px] text-slate-500">
                    <li>1. 라인/홀/치수 후보 자동 추출</li>
                    <li>2. 사용자가 기준선과 치수값 확인</li>
                    <li>3. 파라미터 수정 후 BDF 모델 생성</li>
                  </ol>
                </div>
              </div>
            )}
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
              disabled={(inputMode === 'pdf' ? !pdfFile : !imageFile) || isRunning}
              title={
                inputMode === 'image'
                  ? (!imageFile ? 'JPG/PNG 파일을 먼저 선택하세요' : '이미지에서 LUG 모델 파라미터를 생성합니다')
                  : !pdfFile
                  ? 'PDF 파일을 먼저 선택하거나 카탈로그에서 선택하세요'
                  : 'PDF를 해석 모델로 변환'
              }
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                (inputMode === 'pdf' ? !pdfFile : !imageFile) || isRunning
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : inputMode === 'image'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer shadow-md hover:shadow-lg'
                  : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md hover:shadow-lg'
              }`}
            >
              {isRunning ? <RefreshCw size={15} className="animate-spin" /> : inputMode === 'image' ? <ScanLine size={15} /> : <Play size={15} />}
              {isRunning ? '변환 중...' : inputMode === 'image' ? '이미지 모델 변환' : '해석 모델 변환'}
            </button>
          </div>

          {/* 진행률 표시 — 실행 중일 때만 (사이드바 흰 카드와 톤 통일) */}
          {isRunning && (
            <div className="bg-blue-50 rounded-2xl border border-blue-200 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-blue-700 flex items-center gap-1.5">
                  <RefreshCw size={10} className="animate-spin text-blue-500" />
                  진행 중...
                </span>
                <span className="text-[11px] font-mono text-blue-600 font-bold">{progress}%</span>
              </div>
              <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all rounded-full" style={{ width: `${progress}%` }} />
              </div>
              {statusMessage && (
                <p className="mt-2 text-[11px] text-blue-600/80 font-mono truncate">{statusMessage}</p>
              )}
            </div>
          )}

          {/* 설계 파라미터 / 하중·경계조건 탭 — 모델이 있을 때만 노출 */}
          {modelData && (
            <>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveTab('params')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    activeTab === 'params' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Sliders size={12} /> 설계 파라미터
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('loadbc')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    activeTab === 'loadbc' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MousePointerClick size={12} /> 하중/경계조건
                  {(loadSets.length + bcSets.length) > 0 && (
                    <span className="px-1 rounded bg-cyan-100 text-cyan-700 text-[10px] font-mono">
                      {loadSets.length + bcSets.length}
                    </span>
                  )}
                </button>
              </div>

              {activeTab === 'params' && paramsJson && workDir && (
                <DrawingParamsPanel
                  params={paramsJson}
                  mode={modelMode}
                  workDir={workDir}
                  originalPdfPath={originalPdfPath}
                  employeeId={employeeId}
                  onRebuildStarted={handleRebuildStarted}
                  onFieldFocus={setHighlightedParam}
                  highlightedKey={highlightedParam}
                  disabled={isRunning || selectionMode !== 'none'}
                />
              )}

              {activeTab === 'loadbc' && (
                <DrawingLoadBcPanel
                  mode={modelMode}
                  selectionMode={selectionMode}
                  selectedNodeIds={selection}
                  loadSets={loadSets}
                  bcSets={bcSets}
                  holeRbe={holeRbe}
                  rbe3Sets={rbe3Sets}
                  loadCases={loadCases}
                  onStartSelection={startSelection}
                  onCancelSelection={cancelSelection}
                  onCommitLoad={commitLoad}
                  onCommitBc={commitBc}
                  onCommitRbe3={commitRbe3}
                  onRemoveLoad={removeLoad}
                  onRemoveBc={removeBc}
                  onRemoveRbe3={removeRbe3}
                  onCreateHoleRbe={createHoleRbe}
                  onRemoveHoleRbe={removeHoleRbe}
                  onAddLoadCase={addLoadCase}
                  onRemoveLoadCase={removeLoadCase}
                  onRenameLoadCase={renameLoadCase}
                  onToggleLcBc={toggleLcBc}
                  onToggleLcLoad={toggleLcLoad}
                  disabled={isRunning}
                />
              )}

              {/* 해석 결과 / 실패 스트립 (스크롤 흐름) */}
              {(solveResult || solveError) && (
                <SolveResultStrip
                  result={solveResult}
                  error={solveError}
                  onDownload={downloadResult}
                />
              )}

              {/* 구조 해석 실행 — 사이드바 하단 고정(sticky)으로 항상 접근 가능 */}
              <div className="sticky bottom-0 z-10 -mx-1 px-1 pt-2 pb-1 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent">
                <button
                  type="button"
                  onClick={handleSolve}
                  disabled={isRunning || bcSets.length === 0}
                  title={bcSets.length === 0 ? '경계조건을 최소 1개 이상 추가하세요.' : '하중/경계조건을 BDF에 반영해 Nastran 해석'}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                    isRunning || bcSets.length === 0
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer shadow-md hover:shadow-lg'
                  }`}
                >
                  {isRunning && currentJobKind.current === 'solve'
                    ? <><RefreshCw size={15} className="animate-spin" /> 해석 중...</>
                    : <><Cpu size={15} /> 구조 해석 실행 (Nastran)</>}
                </button>
                {bcSets.length === 0 && !isRunning && (
                  <p className="text-[11px] text-amber-600 text-center mt-1">
                    경계조건을 최소 1개 이상 추가해야 해석할 수 있습니다.
                  </p>
                )}
              </div>
            </>
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
              <div className="flex-1 min-h-0 relative">
                {modelLoadError ? (
                  <div className="h-full flex items-center justify-center text-sm text-rose-500 gap-2">
                    <AlertCircle size={16} />
                    {modelLoadError}
                  </div>
                ) : (
                  <ShellModelViewer
                    modelData={viewerModelData}
                    paramsJson={paramsJson}
                    mode={modelMode}
                    highlightParam={highlightedParam}
                    selectionMode={selectionMode}
                    selectedNodeIds={selection}
                    onSelectionChange={setSelection}
                    loadSets={loadSets}
                    bcSets={bcSets}
                    holeRbe={holeRbe}
                    rbe3Sets={rbe3Sets}
                    swapYZ={modelMode === 'lug' && !isImageResult}
                    resultField={hasResults ? resultField : 'none'}
                    elementValues={resultView?.elementValues || null}
                    valueRange={resultView?.valueRange || null}
                    valueLabel={resultView?.valueLabel || ''}
                    valueUnit={resultView?.valueUnit || ''}
                  />
                )}
                {isImageResult && referenceImageUrl && (
                  <div className="absolute right-3 bottom-3 z-20 w-52 rounded-xl border border-slate-700/70 bg-slate-950/90 shadow-2xl overflow-hidden">
                    <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-slate-700/70">
                      <span className="text-[10px] font-bold text-slate-200 flex items-center gap-1.5">
                        <Image size={11} /> 원본 이미지
                      </span>
                      <span className="text-[9px] text-slate-400">참조</span>
                    </div>
                    <div className="bg-white p-1.5">
                      <img
                        src={referenceImageUrl}
                        alt="Original drawing reference"
                        loading="lazy"
                        decoding="async"
                        className="w-full max-h-40 object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 해석 결과 테이블 (변위 + 쉘 von Mises) — 결과가 있을 때만 하단에 표시 */}
              {hasResults && (
                <div className="h-72 shrink-0 border-t border-slate-200">
                  <SolveResultsPanel
                    field={resultField}
                    onField={setResultField}
                    subcases={resultView.subcases}
                    subcaseIdx={resultView.idx}
                    onSubcase={setResultSubcaseIdx}
                    dispRows={resultView.dispRows}
                    stressRows={resultView.stressRows}
                  />
                </div>
              )}
            </div>
          ) : inputMode === 'image' && imageFile ? (
            <ImageInputPreview
              file={imageFile}
              previewUrl={imagePreviewUrl}
              referenceLength={imageReferenceLength}
            />
          ) : (
            /* 빈 상태 */
            <div className="text-center px-8 py-12 max-w-sm">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 mb-5">
                <Construction size={26} className="text-blue-500" />
              </div>
              <h2 className="text-base font-bold text-slate-700 mb-2">
                {inputMode === 'image' ? 'JPG/PNG 도면을 선택하세요' : 'PDF를 선택하고 변환을 실행하세요'}
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed mb-5">
                {inputMode === 'image'
                  ? '좌측 JPG/PNG 탭에서 그림파일을 올리고 기준선 실제 길이를 입력하세요.'
                  : (
                    <>
                      좌측 <span className="font-semibold text-violet-600">카탈로그</span>에서 표준 도면을 둘러보거나,
                      직접 PDF를 업로드한 뒤 변환을 시작하세요.
                    </>
                  )}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                <div className="flex items-start gap-1.5 bg-slate-50 rounded-lg p-2.5 text-left">
                  {inputMode === 'image' ? <Image size={12} className="text-emerald-500 shrink-0 mt-0.5" /> : <FileSearch size={12} className="text-violet-400 shrink-0 mt-0.5" />}
                  <span>{inputMode === 'image' ? <>이미지 파일<br />직접 업로드</> : <>카탈로그에서<br />표준 도면 선택</>}</span>
                </div>
                <div className="flex items-start gap-1.5 bg-slate-50 rounded-lg p-2.5 text-left">
                  {inputMode === 'image' ? <Ruler size={12} className="text-emerald-500 shrink-0 mt-0.5" /> : <Upload size={12} className="text-blue-400 shrink-0 mt-0.5" />}
                  <span>{inputMode === 'image' ? <>기준 길이<br />mm 단위 입력</> : <>로컬 PDF<br />직접 업로드</>}</span>
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

/* ──────────────────────────────────────────────────────────────────────────
   구조 해석 결과 스트립 — Nastran 실행 결과(성공/실패) + 결과 파일 다운로드
   ──────────────────────────────────────────────────────────────────────── */

function ImageInputPreview({ file, previewUrl, referenceLength }) {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100">
            <Image size={16} className="text-emerald-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800">이미지 도면 입력</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                SEMI-AUTO
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              기준선 두 점 지정과 치수 확인 후 구조해석 파라미터로 변환하는 워크플로우입니다.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold text-slate-600 max-w-[240px] truncate">{file?.name}</p>
          <p className="text-[10px] text-slate-400">{formatBytes(file?.size)}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_260px]">
        <div className="min-w-0 bg-slate-950 flex items-center justify-center p-5">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Uploaded drawing preview"
              loading="lazy"
              decoding="async"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          ) : (
            <div className="text-xs text-slate-400">이미지 미리보기를 준비 중입니다.</div>
          )}
        </div>
        <aside className="border-l border-slate-200 bg-slate-50 p-4 space-y-3 overflow-y-auto">
          <div className="rounded-xl border border-emerald-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 mb-2">
              <Ruler size={12} /> 스케일 기준
            </div>
            <div className="text-2xl font-bold text-slate-800 tracking-normal">
              {referenceLength ? `${referenceLength} mm` : '-'}
            </div>
            <p className="text-[10px] text-slate-500 leading-snug mt-1.5">
              이미지 위 기준선 두 점을 선택하면 이 값으로 픽셀-mm 변환계수가 계산됩니다.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 mb-2">
              <ScanLine size={12} /> 처리 예정 단계
            </div>
            <div className="space-y-2 text-[11px] text-slate-500">
              <div className="flex gap-2">
                <span className="font-mono text-emerald-600">01</span>
                <span>라인, 원, 홀 후보 추출</span>
              </div>
              <div className="flex gap-2">
                <span className="font-mono text-emerald-600">02</span>
                <span>치수 OCR 및 사용자 보정</span>
              </div>
              <div className="flex gap-2">
                <span className="font-mono text-emerald-600">03</span>
                <span>params JSON 생성 후 BDF 재구축</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SolveResultStrip({ result, error, onDownload }) {
  const entries = result
    ? Object.entries(result).filter(([, p]) => typeof p === 'string' && p)
    : [];
  const fileBtns = entries.filter(([k]) => ['f06', 'op2', 'log', 'diagnostic_json'].includes(k));
  const ok = !error;
  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden ${ok ? 'border-indigo-200' : 'border-rose-200'}`}>
      <div className={`px-3 py-2 flex items-center gap-2 ${ok ? 'bg-indigo-50' : 'bg-rose-50'}`}>
        {ok ? <FileCheck2 size={14} className="text-indigo-600" /> : <XCircle size={14} className="text-rose-600" />}
        <span className={`text-[11px] font-bold ${ok ? 'text-indigo-700' : 'text-rose-700'}`}>
          {ok ? 'Nastran 해석 완료' : '구조 해석 실패'}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {error && <p className="text-[11px] text-rose-600 leading-snug">{error}</p>}
        {fileBtns.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fileBtns.map(([key, path]) => (
              <button
                key={key}
                type="button"
                onClick={() => onDownload(path)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] font-bold transition-colors"
              >
                <Download size={11} /> {key === 'diagnostic_json' ? 'diagnostic' : key.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {ok && (
          <p className="text-[10px] text-slate-400 leading-snug">
            결과 해석(응력/변위 시각화)은 다음 단계에서 제공될 예정입니다. 지금은 f06/op2 파일로 확인하세요.
          </p>
        )}
      </div>
    </div>
  );
}

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
