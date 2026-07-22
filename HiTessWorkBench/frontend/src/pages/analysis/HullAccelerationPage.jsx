/// <summary>
/// 선급 Rule 기반 선체 가속도 Calculation.
/// Trim & Stability Booklet PDF 를 업로드하여 'Summary of Loading Conditions' 표를
/// 추출하고, 페이지별 '파라미터 × 조건' 정형화 테이블로 표시한다.
/// </summary>
import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Play, Terminal, FileText, Download, Table, Ship, RotateCcw, SlidersHorizontal, Activity, ChevronRight, MapPin, Wrench, ChevronDown, Eye, X, Loader2, AlertTriangle } from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAnalysisJob } from '../../hooks/useAnalysisJob';
import { requestHullAcceleration, requestHullAccelerationSample, getHullAccelerationSamplePreview, downloadFileText, downloadFileBlob } from '../../api/analysis';
import { useToast } from '../../contexts/ToastContext';
import SolverCredit from '../../components/ui/SolverCredit';
import PageBanner from '../../components/ui/PageBanner';
import AppUsageStatsButton from '../../components/analysis/AppUsageStatsButton';
import { buildFormData } from '../../utils/fileHelper';
import { buildFilteredEnvelope, getConditionNumbersFromRules, getRuleAxisMaxima } from '../../utils/hullAcceleration';

const LOG_COLORS = { success: 'text-green-400', error: 'text-red-400', warning: 'text-yellow-400', info: 'text-sky-400' };

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// 고정폭 레이아웃에서 생긴 내부 공백을 표시용으로 한 칸으로 축약한다. (예: "CARGO       (t)" → "CARGO (t)")
const cleanItem = (item) => String(item ?? '').replace(/\s+/g, ' ').trim();

const DEFAULT_CONSTANTS = {
  lbp: 281.3,
  length: 281.3,
  breadth: 46.1,
  depth: 26.3,
  scantling_draft: 12.5,
  scantling_cb: 0.7417,
  speed: 10.0,
  bilge_keel: 1,
  gravity: 9.81,
  rho: 1.025,
  roll_gyration_option: 0,
  x_from_ap: 94.38,
  y_from_cl: -7.257,
  z_from_bl: 38.4585,
};

const KNOT_TO_MPS = 1852 / 3600;

const POSITION_FIELDS = [
  ['x_from_ap', 'X from AP', 'm'],
  ['y_from_cl', 'Y from CL', 'm'],
  ['z_from_bl', 'Z from BL', 'm'],
];

const USER_CONSTANT_FIELDS = [
  ['speed', 'Vs', 'm/s'],
  ['gravity', 'grav', 'm/s²'],
  ['rho', 'rho', 'ton/m³'],
];

const RULE_LENGTH_MODES = {
  LBP: 'lbp',
  MANUAL: 'manual',
};

const RULE_DISPLAY_LABELS = {
  dnvgl: 'DNV',
};

const RULE_SOURCES = {
  dnvgl: 'DNV-RU-SHIP, Ship motions and accelerations (Pt 3, Ch4, Sec3), 2023',
  dnv: 'DNV-RU-SHIP, Ship motions and accelerations (Pt 3, Ch4, Sec3), 2023',
  csr: 'CSR-H, Acceleration at any position (Pt 1, Ch 4, Sec 3), 2017',
  igc: 'Guidance formula for acceleration components (4.28.2), 2014',
  bv: 'Rules for the classification of steel ship[NR 467], Ship motions and accelerations (Pt B, Ch5, Sec3), 2026',
  lr: 'Rules and regulations for the classification of ship, Strengthening for machinery on deck (Pt 3, Ch9, Sec9), 2020',
};

const PARTICULAR_FIELDS = [
  ['length_overall', 'LOA', 'm'],
  ['lbp', 'LBP', 'm'],
  ['breadth', 'Breadth', 'm'],
  ['depth', 'Depth', 'm'],
  ['design_draft', 'Design draft', 'm'],
  ['scantling_draft', 'Scantling draft', 'm'],
  ['scantling_cb', 'Summer Cb', '-'],
  ['design_cb', 'Design Cb', '-'],
  ['lightship_weight', 'Lightship', 't'],
];

const RESULT_INPUT_FIELDS = [
  ['speed', 'Vs', 'knot'],
  ['bilge_keel', 'Bilge keel', '-'],
  ['length', 'Rule Length', 'm'],
  ['gravity', 'grav', 'm/s²'],
  ['rho', 'rho', 'ton/m³'],
];

const RESULT_POSITION_FIELDS = [
  ['x_from_ap', 'X from AP', 'm'],
  ['x_from_ap_rule', 'X from AP (Rule)', 'm'],
  ['y_from_cl', 'Y from CL', 'm'],
  ['z_from_bl', 'Z from BL', 'm'],
];

const POSITION_FIELD_MAP = Object.fromEntries(POSITION_FIELDS.map(([key, label, unit]) => [key, { label, unit }]));
const USER_CONSTANT_FIELD_MAP = Object.fromEntries(USER_CONSTANT_FIELDS.map(([key, label, unit]) => [key, { label, unit }]));

// 축별 색상 구분
const AXIS_CONFIG = {
  x: { color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', accent: 'bg-blue-500', label: 'X축', badge: 'bg-blue-100 text-blue-700' },
  y: { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-500', label: 'Y축', badge: 'bg-emerald-100 text-emerald-700' },
  z: { color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-500', label: 'Z축', badge: 'bg-violet-100 text-violet-700' },
};

const toPayloadConstants = (constants) => Object.fromEntries(
  Object.entries(constants).map(([key, value]) => [
    key,
    key === 'bilge_keel' || key === 'roll_gyration_option' ? Number.parseInt(value, 10) : Number(value),
  ]),
);

const convertSpeedValue = (value, fromUnit, toUnit) => {
  if (value === '' || fromUnit === toUnit) return value;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;
  const converted = fromUnit === 'knot'
    ? numericValue * KNOT_TO_MPS
    : numericValue / KNOT_TO_MPS;
  return converted.toFixed(2);
};

const fmt = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';

const formatResultInputValue = (key, value, ruleLengthMode) => {
  if (key === 'length' && ruleLengthMode === RULE_LENGTH_MODES.LBP) return 'LBP와 동일';
  return fmt(value, key === 'rho' ? 3 : 2);
};

const getResultInputValue = (key, resultData, constants, ruleLengthMode) => {
  if (key === 'length' && ruleLengthMode === RULE_LENGTH_MODES.MANUAL) {
    const manualRuleLength = Number(constants.length);
    if (Number.isFinite(manualRuleLength) && manualRuleLength > 0) return manualRuleLength;
  }
  return resultData.ship_constants?.[key];
};

const getRuleKey = (rule) => {
  const rawKey = typeof rule === 'string'
    ? rule
    : rule?.key ?? rule?.rule ?? rule?.label ?? '';
  return String(rawKey).toLowerCase();
};

const getRuleDisplayLabel = (rule) => {
  const key = getRuleKey(rule);
  if (RULE_DISPLAY_LABELS[key]) return RULE_DISPLAY_LABELS[key];
  const label = typeof rule === 'string' ? rule : rule?.label;
  return label === 'DNVGL' ? 'DNV' : label ?? key.toUpperCase();
};

const getRuleSource = (rule) => RULE_SOURCES[getRuleKey(rule)];

const getRuleAdjustedXFromAp = (constants, resultData, ruleLengthMode) => {
  const lbp = Number(resultData?.ship_particulars?.values?.lbp ?? resultData?.ship_constants?.lbp ?? constants.lbp);
  const length = ruleLengthMode === RULE_LENGTH_MODES.LBP
    ? lbp
    : Number(constants.length);
  const xFromAp = Number(constants.x_from_ap);
  if (!Number.isFinite(xFromAp) || !Number.isFinite(lbp) || !Number.isFinite(length)) return undefined;
  return xFromAp - (lbp - length);
};

const getConditionHeaders = (table) => (table?.headers ?? [])
  .slice(1)
  .map(cleanItem)
  .filter(Boolean);

const hasBweText = (value) => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasBweText);
  if (typeof value === 'object') return Object.values(value).some(hasBweText);
  return String(value).toUpperCase().includes('BWE');
};

const getConditionTabLabel = (table, index) => {
  const conditions = getConditionHeaders(table);
  if (conditions.length === 0) return `Table ${index + 1}`;
  const first = conditions[0];
  const last = conditions[conditions.length - 1];
  return first === last ? `Condition ${first}` : `Condition ${first}-${last}`;
};

export default function HullAccelerationPage() {
  const { showToast } = useToast();
  const { setCurrentMenu } = useNavigation();
  const dashboardCtx = useDashboard();
  const { startGlobalJob, clearGlobalJob, clearAnalysisPageState } = dashboardCtx;
  const PAGE_KEY = '선급 Rule 기반 선체 가속도 Calculation';
  const savedPageState = dashboardCtx?.analysisPageStates?.[PAGE_KEY] || {};

  const [pdfFile, setPdfFile] = useState(savedPageState.pdfFile ?? null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resultData, setResultData] = useState(savedPageState.resultData ?? null);
  const [resultInfo, setResultInfo] = useState(savedPageState.resultInfo ?? null);
  const [constants, setConstants] = useState(savedPageState.constants ?? DEFAULT_CONSTANTS);
  const [speedUnit, setSpeedUnit] = useState(savedPageState.speedUnit ?? 'knot');
  const [ruleLengthMode, setRuleLengthMode] = useState(savedPageState.ruleLengthMode ?? RULE_LENGTH_MODES.LBP);
  const [selectedLcNumbers, setSelectedLcNumbers] = useState(savedPageState.selectedLcNumbers ?? null);
  const [particularsImageUrl, setParticularsImageUrl] = useState(null);
  const [isLogOpen, setIsLogOpen] = useState(savedPageState.isLogOpen ?? false);
  const [activeLoadingTableIndex, setActiveLoadingTableIndex] = useState(savedPageState.activeLoadingTableIndex ?? 0);
  // 가속도 최대값 탭: 'envelope'(방향별 최대값) | 선급 key('dnvgl' | 'csr' | 'igc' | 'bv' | 'lr')
  const [activeRuleTab, setActiveRuleTab] = useState('envelope');
  // PDF 에서 Cb 미검출 시 사용자가 직접 입력하는 Scantling Cb (빈 문자열 = 미입력 → 미검출 분기).
  const [manualCb, setManualCb] = useState('');

  // 샘플 TS PDF 미리보기 모달 (서버 렌더 base64 PNG 리스트). 페이지 상태로는 보존하지 않는다.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);

  const {
    isRunning, progress, statusMessage, logs,
    employeeId, addLog, startJob, reset: resetJob,
    setLogs, setStatusMessage, setIsRunning, setProgress,
  } = useAnalysisJob({
    startGlobalJob,
    clearGlobalJob,
    savedState: savedPageState,
    setSavedState: (patch) => dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, patch),
    pollingMaxRetries: 200, // 약 5분
    successLogMessage: '가속도 계산 완료.',
    errorLogMessage: '가속도 계산 실패.',
    timeoutLogMessage: '시간 초과 (5분). 파일 크기 또는 서버 상태를 확인하세요.',
    onComplete: async (data) => {
      setStatusMessage('가속도 계산 완료');
      const { engine_log, project } = data;
      if (engine_log) addLog(`[ENGINE] ${engine_log.trim()}`, 'info');
      if (!project?.result_info) {
        addLog('[경고] 결과 파일을 찾을 수 없습니다.', 'error');
        return;
      }
      const ri = project.result_info;
      setResultInfo(ri);

      if (!ri.json_loading_conditions) {
        addLog('[경고] 구조화 결과(JSON)가 없습니다.', 'error');
        return;
      }
      try {
        addLog('결과 로드 중...', 'info');
        const res = await downloadFileText(ri.json_loading_conditions);
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        setResultData(parsed);
        setActiveLoadingTableIndex(0);
        setActiveRuleTab('envelope');
        setSelectedLcNumbers(getConditionNumbersFromRules(parsed.rules));
        if (parsed.cb_missing) {
          // PDF 에 Cb 가 없어 계산이 보류됨 → 결과창의 수동 입력 프롬프트로 재계산 유도.
          setManualCb((prev) => (prev !== '' ? prev : String(DEFAULT_CONSTANTS.scantling_cb)));
          addLog('[주의] PDF에서 Cb(Scantling)를 찾지 못했습니다. Cb를 입력하고 재계산하세요.', 'warning');
        } else if (!parsed.tables || parsed.tables.length === 0) {
          addLog('[안내] PDF에서 Summary of Loading Conditions 표를 찾지 못했습니다.', 'warning');
        } else {
          addLog(`[OK] ${parsed.table_count}개 표 / 페이지 ${parsed.matched_pages.join(', ')} 추출됨.`, 'success');
          if (parsed.cb_source === 'manual') {
            addLog(`[Cb] PDF 미검출 → 수동 입력값 Cb=${fmt(parsed.ship_constants?.scantling_cb, 4)} 사용.`, 'info');
          }
        }
      } catch {
        addLog('[오류] 결과 JSON 로드 실패.', 'error');
      }
    },
  });

  useEffect(() => {
    dashboardCtx?.setAnalysisPageState?.(PAGE_KEY, {
      pdfFile,
      resultData,
      resultInfo,
      constants,
      speedUnit,
      ruleLengthMode,
      selectedLcNumbers,
      isLogOpen,
      activeLoadingTableIndex,
    });
  }, [pdfFile, resultData, resultInfo, constants, speedUnit, ruleLengthMode, selectedLcNumbers, isLogOpen, activeLoadingTableIndex]);

  // 입력/결과/작업 상태는 대시보드 이탈 후 글로벌 작업 카드로 복귀할 때 필요하므로
  // 언마운트 시 자동 삭제하지 않는다. 사용자가 Reset을 누를 때만 clearAnalysisPageState를 호출한다.

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // 미리보기 모달 열림 중 Esc 로 닫기
  useEffect(() => {
    if (!previewOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  useEffect(() => {
    const imagePath = resultData?.files?.ship_particulars_image || resultInfo?.ship_particulars_image;
    if (!imagePath) {
      setParticularsImageUrl(null);
      return undefined;
    }
    let objectUrl = null;
    let cancelled = false;
    downloadFileBlob(imagePath)
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: 'image/png' }));
        setParticularsImageUrl(objectUrl);
      })
      .catch(() => setParticularsImageUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resultData, resultInfo]);

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('PDF 파일만 업로드 가능합니다.', 'warning');
      return;
    }
    setPdfFile(file);
    setResultData(null);
    setResultInfo(null);
    setActiveLoadingTableIndex(0);
    setSelectedLcNumbers(null);
    setManualCb(''); // 새 PDF 는 Cb 자동 검출부터 다시 시도
    setLogs([{ time: new Date().toLocaleTimeString(), message: `[FILE] ${file.name} 선택됨.`, type: 'info' }]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // 전송용 상수 페이로드. 사용자가 Cb 를 직접 입력한 경우에만 manual_scantling_cb 를 실어
  // 보내 백엔드의 'PDF 우선, 없으면 수동' Cb 결정 로직을 태운다(미입력이면 키 자체를 보내지 않음).
  const buildConstantsPayload = () => {
    const payload = toPayloadConstants(constants);
    // 엔진(BV/IGC/LR 공식)은 속도를 Knot 단위로 받는다. Knot 입력은 그대로 전달하고,
    // m/s 로 입력한 경우에만 Knot 으로 환산해 보낸다.
    if (speedUnit === 'mps') payload.speed = Number(constants.speed) / KNOT_TO_MPS;
    payload.rule_length_mode = ruleLengthMode;
    if (ruleLengthMode === RULE_LENGTH_MODES.MANUAL) {
      const manualRuleLength = Number(constants.length);
      if (Number.isFinite(manualRuleLength) && manualRuleLength > 0) {
        payload.manual_rule_length = manualRuleLength;
      }
    }
    const n = Number(manualCb);
    if (manualCb !== '' && Number.isFinite(n)) payload.manual_scantling_cb = n;
    return payload;
  };

  const validateCalculationInputs = () => {
    if (ruleLengthMode === RULE_LENGTH_MODES.MANUAL) {
      const manualRuleLength = Number(constants.length);
      if (!Number.isFinite(manualRuleLength) || manualRuleLength <= 0) {
        showToast('Rule Length 직접 입력값을 0보다 큰 실수로 입력하세요.', 'warning');
        return false;
      }
    }
    return true;
  };

  const runExtraction = async () => {
    if (!pdfFile || isRunning) return;
    if (!validateCalculationInputs()) return;
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    setResultData(null);
    setResultInfo(null);
    setActiveLoadingTableIndex(0);
    setSelectedLcNumbers(null);
    setLogs([]);

    const formData = buildFormData({
      pdf_file: pdfFile,
      employee_id: employeeId,
      source: 'Workbench',
      constants: JSON.stringify(buildConstantsPayload()),
    });
    try {
      const res = await requestHullAcceleration(formData);
      const jobId = res.data.job_id;
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, '선급 Rule 기반 선체 가속도 Calculation');
    } catch {
      setIsRunning(false);
      addLog('서버 요청 실패.', 'error');
    }
  };

  // 업로드 없이 서버 내장 샘플 PDF 로 바로 실행한다. 현재 입력된 상수/위치(X·Y·Z)를 그대로 사용.
  const runSample = async () => {
    if (isRunning) return;
    if (!validateCalculationInputs()) return;
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('샘플 파일 준비 중...');
    setPdfFile(null);
    setResultData(null);
    setResultInfo(null);
    setActiveLoadingTableIndex(0);
    setSelectedLcNumbers(null);
    setLogs([{ time: new Date().toLocaleTimeString(), message: '[SAMPLE] 내장 샘플 PDF로 실행합니다.', type: 'info' }]);

    const formData = buildFormData({
      employee_id: employeeId,
      source: 'Workbench',
      constants: JSON.stringify(buildConstantsPayload()),
    });
    try {
      const res = await requestHullAccelerationSample(formData);
      const jobId = res.data.job_id;
      if (res.data.sample_name) addLog(`[SAMPLE] ${res.data.sample_name}`, 'success');
      addLog(`[JOB] 작업 큐 등록 완료. (Job ID: ${jobId})`, 'success');
      startJob(jobId, '선급 Rule 기반 선체 가속도 Calculation');
    } catch {
      setIsRunning(false);
      addLog('샘플 실행 요청 실패. (서버에 샘플 PDF가 없을 수 있습니다)', 'error');
    }
  };

  // Cb 미검출 결과창에서 사용자가 입력한 Cb 로 동일 PDF 를 재계산한다.
  const recalcWithManualCb = () => {
    const n = Number(manualCb);
    if (!Number.isFinite(n) || n <= 0) {
      showToast('유효한 Cb 값을 입력하세요. (예: 0.74)', 'warning');
      return;
    }
    addLog(`[재계산] 수동 입력 Cb=${n} 로 다시 계산합니다.`, 'info');
    if (pdfFile) runExtraction();
    else runSample();
  };

  // 업로드/실행 없이 샘플 TS PDF 의 핵심 페이지(표지·제원·Summary)를 모달로 미리 본다.
  // 한 번 받은 결과는 previewData 에 캐시해 재요청하지 않는다.
  const openSamplePreview = async () => {
    setPreviewOpen(true);
    if (previewData || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await getHullAccelerationSamplePreview();
      setPreviewData(res.data);
    } catch {
      setPreviewError('샘플 PDF 미리보기를 불러오지 못했습니다. (서버에 샘플 PDF가 없을 수 있습니다)');
    } finally {
      setPreviewLoading(false);
    }
  };

  // 페이지 상태를 모두 비운다. 로컬 state 뿐 아니라 DashboardContext 에 보존된
  // 페이지 상태(pdf/결과/로그/진행률)까지 정리해야 나갔다 와도 빈 상태가 유지된다.
  const handleReset = () => {
    resetJob(); // jobId/isRunning/progress/statusMessage/logs 초기화 + 전역 작업 배너 정리
    setPdfFile(null);
    setResultData(null);
    setResultInfo(null);
    setParticularsImageUrl(null);
    setIsLogOpen(false);
    setActiveLoadingTableIndex(0);
    setConstants(DEFAULT_CONSTANTS);
    setSpeedUnit('knot');
    setRuleLengthMode(RULE_LENGTH_MODES.LBP);
    setSelectedLcNumbers(null);
    setManualCb('');
    setIsDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = ''; // 같은 파일 재선택 허용
    clearAnalysisPageState?.(PAGE_KEY);
    showToast('초기화되었습니다.', 'info');
  };

  const handleCsvDownload = async () => {
    const csvPath = resultInfo?.csv_loading_conditions;
    if (!csvPath) {
      showToast('CSV 파일이 없습니다.', 'warning');
      return;
    }
    try {
      const res = await downloadFileBlob(csvPath);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = csvPath.split(/[\\/]/).pop();
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('CSV 다운로드 실패.', 'error');
    }
  };

  const tables = (resultData?.tables ?? []).filter((table) => !hasBweText(table));
  const activeTableIndex = tables.length > 0 ? Math.min(activeLoadingTableIndex, tables.length - 1) : 0;
  const activeTable = tables[activeTableIndex];
  const rules = resultData?.rules ?? {};
  // 5개 선급 Rule(DNV/CSR/IGC/BV/LR) 결과를 모두 표시한다.
  const ruleRows = Object.values(rules);
  const allConditionNumbers = getConditionNumbersFromRules(rules);
  const effectiveSelectedLcNumbers = selectedLcNumbers == null ? allConditionNumbers : selectedLcNumbers;
  const selectedLcSet = new Set(effectiveSelectedLcNumbers.map(Number));
  const gravityValue = Number(resultData?.ship_constants?.gravity) || 9.81;
  const liveRuleAdjustedXFromAp = getRuleAdjustedXFromAp(constants, resultData, ruleLengthMode);
  const envelope = ruleRows.length > 0
    ? buildFilteredEnvelope(rules, selectedLcSet, gravityValue)
    : resultData?.envelope;

  const toggleLcSelection = (conditionNo) => {
    const current = new Set(effectiveSelectedLcNumbers.map(Number));
    if (current.has(conditionNo)) {
      current.delete(conditionNo);
    } else {
      current.add(conditionNo);
    }
    setSelectedLcNumbers(Array.from(current).sort((a, b) => a - b));
  };

  const setAllLcSelection = (checked) => {
    setSelectedLcNumbers(checked ? allConditionNumbers : []);
  };

  // 단계 인디케이터 상태 계산
  const step1Done = !!pdfFile;
  const step2Done = step1Done; // 선박 제원은 항상 입력 가능
  const step3Done = isRunning || progress > 0;
  const stepDone = !!resultData;

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6 relative">
      <PageBanner gradient="from-brand-blue via-amber-900 to-amber-700">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMenu('Productivity Apps')}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Wrench size={18} className="text-amber-300" />
              선급 Rule 기반 선체 가속도 Calculation
            </h1>
            <p className="text-sm text-amber-200/80 mt-0.5">Trim &amp; Stability Booklet PDF → Summary of Loading Conditions 추출</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AppUsageStatsButton appName="선급 Rule 기반 선체 가속도 Calculation" />
        </div>
      </PageBanner>

      {/* 본문: 좌우 분할 */}
      <div className="flex gap-5 flex-1 min-h-0">

        {/* 왼쪽 사이드바 — 낮은 해상도/배율에서도 X·Y·Z 등 모든 입력이 잘리지 않도록 세로 스크롤 허용 */}
        <div className="w-[320px] shrink-0 flex flex-col gap-3 overflow-y-auto pr-0.5 pb-1">

          {/* ── 단계 1: PDF 파일 선택 ── */}
          {/* shrink-0 필수: overflow-hidden 박스는 flex 자동 최소높이가 0이 되어, 없으면 사이드바가
              스크롤되는 대신 박스가 찌그러져 내부 콘텐츠가 잘린다(낮은 해상도/배율에서). */}
          <div className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* 단계 헤더 */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-700 to-amber-600">
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-white">1</span>
              </div>
              <p className="text-xs font-bold text-white tracking-wide">PDF 파일 선택</p>
              {step1Done && (
                <span className="ml-auto text-[10px] font-bold text-amber-200 bg-white/15 px-2 py-0.5 rounded-full">완료</span>
              )}
            </div>
            <div className="p-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-amber-400 bg-amber-50 scale-[1.01]'
                    : pdfFile
                    ? 'border-amber-300 bg-amber-50/60'
                    : 'border-slate-300 hover:border-amber-400 hover:bg-slate-50'
                }`}
              >
                <Upload size={24} className={`mx-auto mb-2 ${pdfFile ? 'text-amber-500' : 'text-slate-400'}`} />
                {pdfFile ? (
                  <div>
                    <p className="text-sm font-semibold text-amber-700 truncate">{pdfFile.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatBytes(pdfFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-slate-500">클릭하거나 파일을 드래그</p>
                    <p className="text-xs text-slate-400 mt-0.5">.pdf 파일</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </div>

          {/* ── 단계 2: PDF 자동 추출 + 계산 위치 ── */}
          <div className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-700 to-amber-600">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-white">2</span>
              </div>
              <SlidersHorizontal size={13} className="text-amber-300" />
              <p className="text-xs font-bold text-white tracking-wide">자동 추출 / 계산 위치</p>
            </div>

            <div>
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-[11px] leading-4 text-slate-500">
                  Principal dimensions와 Lightship weight 표에서 LBP, B, D, Tsc, Cb를 자동으로 읽습니다.
                </p>
              </div>

              <div className="border-b border-slate-100">
                <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <SlidersHorizontal size={11} className="text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">사용자 입력</span>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {USER_CONSTANT_FIELDS.map(([key]) => {
                    const { label, unit } = USER_CONSTANT_FIELD_MAP[key];
                    const inputUnit = key === 'speed' && speedUnit === 'knot' ? 'Knot' : unit;
                    return (
                      <div key={key} className="block">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-600">{label}</span>
                          {key === 'speed' ? (
                            <span className="inline-flex rounded-md border border-slate-200 bg-white p-0.5" aria-label="속도 단위">
                              {[
                                ['knot', 'Knot'],
                                ['mps', 'm/s'],
                              ].map(([value, text]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    setConstants((prev) => ({
                                      ...prev,
                                      speed: convertSpeedValue(prev.speed, speedUnit, value),
                                    }));
                                    setSpeedUnit(value);
                                  }}
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                                    speedUnit === value
                                      ? 'bg-amber-500 text-white'
                                      : 'text-slate-400 hover:text-slate-600'
                                  }`}
                                  aria-pressed={speedUnit === value}
                                >
                                  {text}
                                </button>
                              ))}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-mono">{unit}</span>
                          )}
                        </div>
                        <input
                          type="number"
                          step={key === 'speed' ? '0.01' : 'any'}
                          value={constants[key]}
                          onChange={(e) => setConstants((prev) => ({ ...prev, [key]: e.target.value }))}
                          aria-label={`${label} (${inputUnit})`}
                          className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 focus:bg-white transition-colors"
                        />
                        {key === 'speed' && speedUnit === 'mps' && (
                          <span className="mt-1 block text-[9px] text-slate-400">
                            계산 시 Knot으로 자동 변환
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <label className="block">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-600">Bilge keel</span>
                    </div>
                    <select
                      value={constants.bilge_keel}
                      onChange={(e) => setConstants((prev) => ({ ...prev, bilge_keel: e.target.value }))}
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                    >
                      <option value={1}>1: 있음</option>
                      <option value={0}>0: 없음</option>
                    </select>
                  </label>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-600">Rule Length</span>
                      </div>
                      <select
                        value={ruleLengthMode}
                        onChange={(e) => {
                          const nextMode = e.target.value;
                          setRuleLengthMode(nextMode);
                          if (nextMode === RULE_LENGTH_MODES.LBP) {
                            setConstants((prev) => ({ ...prev, length: prev.lbp }));
                          }
                        }}
                        className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                      >
                        <option value={RULE_LENGTH_MODES.LBP}>LBP와 동일</option>
                        <option value={RULE_LENGTH_MODES.MANUAL}>직접 입력</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-600">L</span>
                        <span className="text-[10px] text-slate-400 font-mono">m</span>
                      </div>
                      {ruleLengthMode === RULE_LENGTH_MODES.LBP ? (
                        <div className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-600 flex items-center">
                          LBP와 동일
                        </div>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          value={constants.length}
                          onChange={(e) => setConstants((prev) => ({ ...prev, length: e.target.value }))}
                          className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 focus:bg-white transition-colors"
                        />
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-100">
                <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <MapPin size={11} className="text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">계산 위치</span>
                </div>
                <div className="p-3 grid grid-cols-1 gap-2">
                  {POSITION_FIELDS.map(([key]) => {
                    const { label, unit } = POSITION_FIELD_MAP[key];
                    return (
                      <React.Fragment key={key}>
                        <label className="block">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-slate-600">{label}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{unit}</span>
                          </div>
                          <input
                            type="number"
                            step="any"
                            value={constants[key]}
                            onChange={(e) => setConstants((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 focus:bg-white transition-colors"
                          />
                        </label>
                        {key === 'x_from_ap' && (
                          <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-semibold text-blue-700">X from AP (Rule)</span>
                              <span className="text-[10px] text-blue-400 font-mono">m</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono font-bold text-slate-800">
                                {fmt(liveRuleAdjustedXFromAp, 3)}
                              </span>
                              <span className="text-[9px] text-blue-500 font-mono truncate">
                                X - (LBP - L)
                              </span>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* ── 단계 3: 실행 / 진행률 ── */}
          <div className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-100 border-b border-slate-200">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${step3Done ? 'bg-amber-500' : 'bg-slate-300'}`}>
                <span className="text-[11px] font-bold text-white">3</span>
              </div>
              <p className="text-xs font-bold text-slate-600 tracking-wide">가속도 계산</p>
            </div>
            <div className="p-4 space-y-3">
              {/* 진행률 바 — 실행 중일 때만 표시 */}
              {(isRunning || progress > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-slate-500">진행률</span>
                    <span className="text-xs font-bold text-amber-600">{progress}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {statusMessage && (
                    <p className="text-[11px] text-slate-400 mt-1.5 truncate">{statusMessage}</p>
                  )}
                </div>
              )}

              {/* 실행 버튼 */}
              <button
                onClick={runExtraction}
                disabled={!pdfFile || isRunning}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all ${
                  !pdfFile || isRunning
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white shadow-sm hover:shadow-md cursor-pointer'
                }`}
              >
                <Play size={15} />
                {isRunning ? '계산 중...' : '가속도 계산 시작'}
              </button>

              {/* 초기화 버튼 */}
              <button
                onClick={handleReset}
                disabled={!pdfFile && !resultData && !resultInfo && logs.length === 0}
                className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-medium text-sm border transition-all ${
                  !pdfFile && !resultData && !resultInfo && logs.length === 0
                    ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                    : 'border-slate-300 text-slate-500 hover:bg-red-50 hover:border-red-300 hover:text-red-600 cursor-pointer'
                }`}
              >
                <RotateCcw size={14} />
                초기화
              </button>

              <button
                onClick={() => setIsLogOpen((prev) => !prev)}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-medium text-sm border border-slate-300 text-slate-500 hover:bg-slate-50 hover:border-slate-400 cursor-pointer transition-all"
              >
                <Terminal size={14} />
                로그 {isLogOpen ? '접기' : '보기'}
                {logs.length > 0 && <span className="text-[10px] text-slate-400 font-mono">({logs.length})</span>}
              </button>
            </div>
          </div>

          <SolverCredit contributor="정병훈" />
        </div>

        {/* 오른쪽 결과 영역 */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!resultData ? (
            /* 빈 상태 */
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-center text-slate-400 px-8">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <FileText size={28} className="opacity-40" />
                </div>
                <p className="text-sm font-semibold text-slate-500">결과 대기 중</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  PDF를 업로드하고 가속도 계산을 시작하면<br />
                  Summary of Loading Conditions 표와<br />
                  가속도 계산 결과가 여기에 표시됩니다.
                </p>
                <div className="mt-5 flex items-center justify-center gap-4 text-[11px] text-slate-300">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />PDF 선택</span>
                  <ChevronRight size={12} />
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />제원 자동 추출</span>
                  <ChevronRight size={12} />
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />가속도 계산</span>
                </div>

                {/* 업로드 없이 내장 샘플 PDF 로 바로 체험 — 사이드바의 업로드/실행 버튼과
                    분리해 "실행 버튼"으로 오인하지 않도록 결과 대기 화면에 둔다. */}
                <div className="mt-7 flex items-center gap-3 max-w-[320px] mx-auto">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">또는</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                <button
                  type="button"
                  onClick={runSample}
                  disabled={isRunning}
                  className={`mt-4 inline-flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl font-semibold text-sm border transition-all ${
                    isRunning
                      ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                      : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 cursor-pointer'
                  }`}
                >
                  <Play size={14} />
                  샘플 TS PDF로 바로 체험
                </button>
                <p className="text-[11px] text-slate-400 mt-2">업로드 없이 내장 예시 PDF로 결과를 미리 봅니다.</p>
                <button
                  type="button"
                  onClick={openSamplePreview}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-amber-700 underline-offset-2 hover:underline cursor-pointer transition-colors"
                >
                  <Eye size={13} />
                  샘플 TS PDF 내용 미리보기
                </button>
              </div>
            </div>
          ) : tables.length === 0 ? (
            /* 표 없음 */
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-center text-slate-400">
                <Table size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm font-semibold text-slate-500">표를 찾지 못했습니다</p>
                <p className="text-xs mt-1 text-slate-400">{resultData.source_pdf}</p>
                <p className="text-xs mt-0.5 text-slate-300">PDF에서 Summary of Loading Conditions 표를 감지하지 못했습니다.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 gap-4">

              {/* ── 상단 요약 바 ── */}
              <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-slate-200 shadow-sm gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-amber-600 shrink-0" />
                  <span className="text-sm font-semibold text-slate-700 truncate">{resultData.source_pdf}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap bg-slate-100 px-2 py-0.5 rounded-md">
                    표 {resultData.table_count}개 · p.{resultData.matched_pages.join(', ')}
                  </span>
                </div>
                <button
                  onClick={handleCsvDownload}
                  disabled={!resultInfo?.csv_loading_conditions}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    resultInfo?.csv_loading_conditions
                      ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Download size={13} />
                  CSV 다운로드
                </button>
              </div>

              {/* 스크롤 가능한 결과 본문 */}
              <div className="flex-1 overflow-auto space-y-5 min-h-0 pr-0.5">

                {/* ── Cb 미검출 → 수동 입력 후 재계산 프롬프트 ── */}
                {resultData.cb_missing && (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 bg-amber-100/70 border-b border-amber-200">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                      <span className="text-sm font-bold text-amber-800">이 PDF에서 Cb(Scantling)를 자동 추출하지 못했습니다</span>
                    </div>
                    <div className="p-5 space-y-3">
                      <p className="text-xs text-amber-800/90 leading-5">
                        선급 가속도 계산에는 Scantling Cb 값이 필요합니다. 아래에 Cb를 직접 입력한 뒤
                        <span className="font-semibold"> 이 Cb로 재계산</span>을 누르면 동일 PDF로 다시 계산합니다.
                        (Summary of Loading Conditions 표는 아래에서 확인할 수 있습니다.)
                      </p>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="block">
                          <span className="block text-[11px] font-semibold text-amber-700 mb-1">Summer / Scantling Cb</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={manualCb}
                            onChange={(e) => setManualCb(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') recalcWithManualCb(); }}
                            placeholder="예: 0.74"
                            className="w-40 h-9 px-3 rounded-lg border border-amber-300 bg-white text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={recalcWithManualCb}
                          disabled={isRunning}
                          className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-bold transition-colors ${
                            isRunning
                              ? 'bg-amber-200 text-amber-400 cursor-not-allowed'
                              : 'bg-amber-600 text-white hover:bg-amber-700 cursor-pointer'
                          }`}
                        >
                          <Play size={14} />
                          이 Cb로 재계산
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Cb 수동 입력값 사용 안내 (PDF 미검출 → 수동 계산 성공) ── */}
                {!resultData.cb_missing && resultData.cb_source === 'manual' && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2">
                    <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                    <span className="text-[11px] font-semibold text-amber-800">
                      PDF에서 Cb를 찾지 못해 <span className="font-black">수동 입력값 Cb = {fmt(resultData.ship_constants?.scantling_cb, 4)}</span>로 계산했습니다. 값이 올바른지 확인하세요.
                    </span>
                  </div>
                )}

                {/* ── PDF에서 자동 추출한 선박 제원 ── */}
                {resultData.ship_particulars && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50">
                      <Ship size={13} className="text-slate-500" />
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">PDF 자동 추출 선박 제원</span>
                      <span className="ml-auto text-[10px] text-slate-400 font-mono">p.{resultData.ship_particulars.page ?? '-'}</span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 p-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 content-start">
                        {PARTICULAR_FIELDS.map(([key, label, unit]) => (
                          <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">{label}</span>
                              <span className="text-[10px] text-slate-300 font-mono">{unit}</span>
                            </div>
                            <p className="text-sm font-bold font-mono text-slate-700">
                              {fmt(resultData.ship_particulars.values?.[key], key.includes('cb') ? 4 : 2)}
                            </p>
                          </div>
                        ))}
                        {RESULT_INPUT_FIELDS.map(([key, label, unit]) => (
                          <div key={key} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide truncate">{label}</span>
                              <span className="text-[10px] text-amber-300 font-mono">{unit}</span>
                            </div>
                            <p className="text-sm font-bold font-mono text-slate-700">
                              {formatResultInputValue(key, getResultInputValue(key, resultData, constants, ruleLengthMode), ruleLengthMode)}
                            </p>
                          </div>
                        ))}
                        {RESULT_POSITION_FIELDS.map(([key, label, unit]) => {
                          const value = key === 'x_from_ap_rule'
                            ? liveRuleAdjustedXFromAp
                            : resultData.position?.[key] ?? resultData.ship_constants?.[key];
                          return (
                            <div key={key} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wide truncate">{label}</span>
                                <span className="text-[10px] text-blue-300 font-mono">{unit}</span>
                              </div>
                              <p className="text-sm font-bold font-mono text-slate-700">
                                {fmt(value, 3)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden min-h-[180px] flex items-center justify-center">
                        {particularsImageUrl ? (
                          <img
                            src={particularsImageUrl}
                            alt="Principal dimensions and Lightship weight source"
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain bg-white"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">근거 이미지 로드 중</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 선체 가속도 최대값 — 방향별(Envelope) / 선급별 탭 ── */}
                {envelope && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Activity size={14} className="text-amber-600" />
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">선체 가속도 최대값</span>
                      <span className="ml-auto text-[10px] font-mono text-slate-400">
                        {selectedLcSet.size}/{allConditionNumbers.length} LC selected
                      </span>
                    </div>

                    {allConditionNumbers.length > 0 && (
                      <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center gap-2 overflow-x-auto">
                          <label className="inline-flex items-center gap-1.5 pr-2 border-r border-slate-200 shrink-0">
                            <input
                              type="checkbox"
                              checked={selectedLcSet.size === allConditionNumbers.length}
                              onChange={(e) => setAllLcSelection(e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                            />
                            <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">전체 LC</span>
                          </label>
                          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setAllLcSelection(true)}
                              className="rounded px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-white hover:text-amber-700 transition-colors"
                            >
                              모두 선택
                            </button>
                            <button
                              type="button"
                              onClick={() => setAllLcSelection(false)}
                              className="rounded px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-white hover:text-red-600 transition-colors"
                            >
                              모두 해제
                            </button>
                          </div>
                          {allConditionNumbers.map((conditionNo) => (
                            <label
                              key={conditionNo}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 shrink-0 transition-colors ${
                                selectedLcSet.has(conditionNo)
                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedLcSet.has(conditionNo)}
                                onChange={() => toggleLcSelection(conditionNo)}
                                className="h-3 w-3 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                              />
                              <span className="text-[10px] font-bold font-mono whitespace-nowrap">LC {conditionNo}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 탭 바: 방향별 최대값(Envelope) + 선급별(DNV/CSR/IGC/BV/LR) */}
                    <div className="overflow-x-auto mb-3">
                      <div className="inline-flex min-w-full gap-1 rounded-lg bg-slate-200/70 p-1">
                        {[{ key: 'envelope', label: '방향별 최대값' }, ...ruleRows.map((r) => ({ key: r.key, label: getRuleDisplayLabel(r) }))].map((tab) => {
                          const isActive = tab.key === activeRuleTab;
                          return (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setActiveRuleTab(tab.key)}
                              className={`px-3 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
                                isActive
                                  ? 'bg-white text-amber-700 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                              }`}
                            >
                              {tab.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 방향별 최대값(Envelope) 탭 — 축별 독립 최대값 카드 */}
                    {activeRuleTab === 'envelope' && (
                      <div className="grid grid-cols-3 gap-3">
                        {['x', 'y', 'z'].map((axis) => {
                          const ac = AXIS_CONFIG[axis];
                          const item = envelope[axis] ?? {};
                          return (
                            <div
                              key={axis}
                              className={`rounded-2xl border-2 ${ac.border} ${ac.bg} p-5 relative overflow-hidden`}
                            >
                              {/* 축 레이블 배지 */}
                              <div className={`absolute top-3 right-3 w-7 h-7 rounded-lg ${ac.accent} flex items-center justify-center`}>
                                <span className="text-[11px] font-black text-white uppercase">{axis}</span>
                              </div>
                              {/* 대표 수치 */}
                              <p className={`text-[11px] font-semibold mb-1 ${ac.color} uppercase tracking-wide`}>{ac.label} Envelope</p>
                              <div className="flex items-end gap-1.5 mb-3">
                                <span className={`text-3xl font-black ${ac.color} leading-none`}>{fmt(item.value, 2)}</span>
                                <span className="text-xs text-slate-500 mb-0.5 font-mono">m/s²</span>
                              </div>
                              {/* g 환산 */}
                              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold mb-3 ${ac.badge}`}>
                                {fmt(item.g, 2)} g
                              </div>
                              {/* 메타 정보 */}
                              <div className="pt-3 border-t border-white/60 space-y-0.5">
                                <p className="text-[11px] font-semibold text-slate-700 truncate">{getRuleDisplayLabel(item)}</p>
                                <p className="text-[10px] text-slate-500 font-mono">LC {item.lc}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 선급 탭 — X/Y/Z 축별 독립 최대값 + 조건별 조회 표 */}
                    {activeRuleTab !== 'envelope' && (() => {
                      const rule = rules[activeRuleTab];
                      if (!rule) return null;
                      // 조건(LC)별 x/y/z 값을 한 행으로 병합
                      const byCond = {};
                      ['x', 'y', 'z'].forEach((axis) => {
                        (rule[axis]?.per_condition ?? []).forEach(({ condition_no, value }) => {
                          if (byCond[condition_no] == null) byCond[condition_no] = { condition_no };
                          byCond[condition_no][axis] = value;
                        });
                      });
                      const condRows = Object.values(byCond).sort((a, b) => a.condition_no - b.condition_no);
                      const axisMaxima = getRuleAxisMaxima(rule, selectedLcSet);
                      const maxConditionNos = new Set(
                        Object.values(axisMaxima)
                          .map(({ conditionNo }) => conditionNo)
                          .filter((conditionNo) => conditionNo != null),
                      );
                      const gravity = Number(resultData?.ship_constants?.gravity) || 9.81;
                      return (
                        <div className="space-y-3">
                          {/* 축별 최대 가속도 발생 조건(LC) 안내 */}
                          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2">
                            <MapPin size={13} className="text-amber-600 shrink-0" />
                            <span className="text-[11px] font-semibold text-amber-800">
                              {getRuleDisplayLabel(rule)} 축별 최대 가속도 발생 조건 —
                              {['x', 'y', 'z'].map((axis) => (
                                <span key={axis} className="ml-2 whitespace-nowrap">
                                  <span className="font-black">{axis.toUpperCase()}</span> LC {axisMaxima[axis].conditionNo ?? '-'}
                                </span>
                              ))}
                            </span>
                          </div>

                          {/* CSR 간이 GM(≤0) → 실제 GoM 대체된 조건 안내 (투명성) */}
                          {Array.isArray(rule.extra?.gm_fallback_conditions) && rule.extra.gm_fallback_conditions.length > 0 && (
                            <div className="flex items-start gap-2 rounded-xl bg-orange-50 border border-orange-200 px-4 py-2">
                              <AlertTriangle size={13} className="text-orange-500 shrink-0 mt-0.5" />
                              <span className="text-[11px] font-medium text-orange-800 leading-4">
                                LC {rule.extra.gm_fallback_conditions.join(', ')} 는 CSR 간이 GM 공식이 비물리적(≤0)이 되어
                                booklet의 <span className="font-bold">실제 GoM</span>으로 대체해 계산했습니다(DNV와 동일 방식). 해당 조건 값은 참고용으로 확인하세요.
                              </span>
                            </div>
                          )}

                          {/* X/Y/Z 각각의 최대값과 해당 Loading Condition */}
                          <div className="grid grid-cols-3 gap-3">
                            {['x', 'y', 'z'].map((axis) => {
                              const ac = AXIS_CONFIG[axis];
                              const { value, conditionNo } = axisMaxima[axis];
                              const gVal = Number.isFinite(value) ? value / gravity : undefined;
                              return (
                                <div
                                  key={axis}
                                  className={`rounded-2xl border-2 ${ac.border} ${ac.bg} p-5 relative overflow-hidden`}
                                >
                                  {/* 축 레이블 배지 */}
                                  <div className={`absolute top-3 right-3 w-7 h-7 rounded-lg ${ac.accent} flex items-center justify-center`}>
                                    <span className="text-[11px] font-black text-white uppercase">{axis}</span>
                                  </div>
                                  {/* 대표 수치 */}
                                  <p className={`text-[11px] font-semibold mb-1 ${ac.color} uppercase tracking-wide`}>{ac.label} · 최대</p>
                                  <div className="flex items-end gap-1.5 mb-3">
                                    <span className={`text-3xl font-black ${ac.color} leading-none`}>{fmt(value, 2)}</span>
                                    <span className="text-xs text-slate-500 mb-0.5 font-mono">m/s²</span>
                                  </div>
                                  {/* g 환산 */}
                                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold mb-3 ${ac.badge}`}>
                                    {fmt(gVal, 2)} g
                                  </div>
                                  {/* 메타 정보 */}
                                  <div className="pt-3 border-t border-white/60 space-y-0.5">
                                    <p className="text-[11px] font-semibold text-slate-700 truncate">{getRuleDisplayLabel(rule)}</p>
                                    <p className="text-[10px] text-slate-500 font-mono">LC {conditionNo ?? '-'}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* 조건(LC)별 가속도 조회 표 (최대 발생 행 강조) */}
                          {condRows.length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50">
                                <Table size={13} className="text-slate-500" />
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{getRuleDisplayLabel(rule)} · 조건(LC)별 가속도</p>
                                  {getRuleSource(rule) && (
                                    <p className="mt-0.5 text-[10px] font-medium text-slate-500 leading-4">
                                      {getRuleSource(rule)}
                                    </p>
                                  )}
                                </div>
                                <span className="ml-auto text-[10px] text-slate-400 font-mono">
                                  {selectedLcSet.size}/{condRows.length} conditions · m/s²
                                </span>
                              </div>
                              <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                                <table className="w-full text-xs">
                                  <thead className="sticky top-0 z-10">
                                    <tr className="border-b border-slate-200 bg-slate-50">
                                      <th className="px-5 py-2.5 text-left font-semibold text-slate-500">LC</th>
                                      {['x', 'y', 'z'].map((axis) => {
                                        const ac = AXIS_CONFIG[axis];
                                        return (
                                          <th key={axis} className="px-4 py-2.5 text-right font-semibold text-slate-500">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded ${ac.badge} font-bold`}>{axis.toUpperCase()}</span>
                                          </th>
                                        );
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {condRows.map((row, ri) => {
                                      const isMaxRow = maxConditionNos.has(row.condition_no);
                                      return (
                                        <tr
                                          key={row.condition_no}
                                          className={`border-b border-slate-100 last:border-b-0 transition-colors ${
                                            isMaxRow
                                              ? 'bg-amber-50 hover:bg-amber-100/70'
                                              : `${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-amber-50/40`
                                          }`}
                                        >
                                          <td className="px-5 py-2 font-semibold text-slate-700 whitespace-nowrap">
                                            <label className="inline-flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={selectedLcSet.has(Number(row.condition_no))}
                                                onChange={() => toggleLcSelection(Number(row.condition_no))}
                                                className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                                              />
                                              <span>{row.condition_no}</span>
                                            </label>
                                            {isMaxRow && <span className="ml-1.5 text-[9px] font-bold text-amber-600 align-middle">◀ 축 최대</span>}
                                          </td>
                                          {['x', 'y', 'z'].map((axis) => {
                                            const ac = AXIS_CONFIG[axis];
                                            const isAxisMax = Number(row.condition_no) === Number(axisMaxima[axis]?.conditionNo);
                                            return (
                                              <td
                                                key={axis}
                                                className={`px-4 py-2 text-right font-mono whitespace-nowrap ${isAxisMax ? `font-bold ${ac.color}` : 'text-slate-600'}`}
                                              >
                                                {fmt(row[axis], 3)}
                                                {isAxisMax && <span className="ml-1 text-[9px] align-top">max</span>}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── 선급별 최대 가속도 비교 표 ── */}
                {ruleRows.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50">
                      <Table size={13} className="text-slate-500" />
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">선급별 최대 가속도 비교</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-5 py-2.5 text-left font-semibold text-slate-500">Rule</th>
                            {['x', 'y', 'z'].map((axis) => {
                              const ac = AXIS_CONFIG[axis];
                              return (
                                <th key={axis} className="px-4 py-2.5 text-right font-semibold text-slate-500">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${ac.badge} font-bold`}>
                                    {axis.toUpperCase()} max / LC
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {ruleRows.map((rule, ri) => {
                            const maxima = getRuleAxisMaxima(rule, selectedLcSet);
                            return (
                              <tr key={rule.key} className={`border-b border-slate-100 last:border-b-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-amber-50/40 transition-colors`}>
                                <td className="px-5 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{getRuleDisplayLabel(rule)}</td>
                                {['x', 'y', 'z'].map((axis) => (
                                  <td key={axis} className="px-4 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">
                                    <span className="font-semibold">{fmt(maxima[axis]?.value, 2)}</span>
                                    <span className="text-slate-300 mx-1.5">/</span>
                                    <span className="text-slate-400 text-[11px]">{maxima[axis]?.conditionNo}</span>
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Condition 5개 단위 탭 ── */}
                {activeTable && (() => {
                  const headers = activeTable.headers ?? [];
                  const colCount = headers.length;
                  return (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText size={12} className="text-slate-400" />
                          <span className="text-xs font-bold text-slate-600">Summary of Loading Conditions</span>
                          <span className="ml-auto text-[10px] text-slate-400 font-mono">
                            PDF Page {activeTable.pdf_page} · {activeTable.rows?.length ?? 0} rows
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="inline-flex min-w-full gap-1 rounded-lg bg-slate-200/70 p-1">
                            {tables.map((tbl, ti) => {
                              const isActive = ti === activeTableIndex;
                              return (
                                <button
                                  key={`${tbl.pdf_page}-${ti}`}
                                  type="button"
                                  onClick={() => setActiveLoadingTableIndex(ti)}
                                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
                                    isActive
                                      ? 'bg-white text-amber-700 shadow-sm'
                                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                                  }`}
                                >
                                  {getConditionTabLabel(tbl, ti)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-50 border-b border-slate-200">
                              {headers.map((h, hi) => (
                                <th
                                  key={hi}
                                  className={`px-4 py-2.5 font-semibold text-slate-600 whitespace-nowrap ${
                                    hi === 0 ? 'text-left min-w-[180px]' : 'text-right'
                                  }`}
                                >
                                  {hi === 0 ? cleanItem(h) : h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeTable.rows.map((row, ri) => {
                              const cells = [cleanItem(row.item), ...(row.values ?? [])];
                              while (cells.length < colCount) cells.push('');
                              return (
                                <tr
                                  key={ri}
                                  className={`border-b border-slate-100 last:border-b-0 hover:bg-amber-50/30 transition-colors ${
                                    ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                                  }`}
                                >
                                  {cells.slice(0, Math.max(colCount, cells.length)).map((c, ci) => (
                                    <td
                                      key={ci}
                                      className={`px-4 py-1.5 whitespace-nowrap ${
                                        ci === 0
                                          ? 'text-left font-medium text-slate-700'
                                          : 'text-right font-mono text-slate-600'
                                      }`}
                                    >
                                      {c === '' ? <span className="text-slate-200">—</span> : c}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {isLogOpen && (
            <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-sm overflow-hidden shrink-0">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border-b border-slate-700">
                <Terminal size={12} className="text-slate-500" />
                <span className="text-xs font-mono text-slate-400 font-semibold tracking-widest">CALCULATION LOG</span>
                {logs.length > 0 && (
                  <span className="ml-auto text-[10px] text-slate-600 font-mono">{logs.length} lines</span>
                )}
                <button
                  type="button"
                  onClick={() => setIsLogOpen(false)}
                  className="ml-2 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                  aria-label="로그 접기"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="overflow-y-auto p-3 font-mono text-[11px] leading-5 max-h-[220px]">
                {logs.length === 0 ? (
                  <p className="text-slate-600">PDF를 업로드하고 가속도 계산을 시작하세요.</p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-slate-600 shrink-0">{log.time}</span>
                      <span className={LOG_COLORS[log.type] ?? 'text-slate-300'}>{log.message}</span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 샘플 TS PDF 미리보기 모달 ── */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
              <FileText size={16} className="text-amber-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700 truncate">샘플 TS PDF 미리보기</p>
                {previewData?.sample_name && (
                  <p className="text-[11px] text-slate-400 truncate">
                    {previewData.sample_name}
                    {previewData.total_pages ? ` · 총 ${previewData.total_pages}p 중 핵심 ${previewData.pages?.length ?? 0}p` : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 cursor-pointer transition-colors shrink-0"
                aria-label="닫기"
              >
                <X size={16} />
              </button>
            </div>

            {/* 본문 */}
            <div className="overflow-y-auto p-5 space-y-5 bg-slate-100">
              {previewLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Loader2 size={28} className="animate-spin mb-3" />
                  <p className="text-sm">핵심 페이지 렌더링 중…</p>
                </div>
              )}
              {previewError && !previewLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm font-semibold text-red-500">{previewError}</p>
                </div>
              )}
              {!previewLoading && !previewError && (previewData?.pages ?? []).map((pg) => (
                <figure key={pg.page_number} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <figcaption className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-600">{pg.label}</span>
                    <span className="text-[10px] text-slate-400 font-mono">PDF p.{pg.page_number}</span>
                  </figcaption>
                  <img src={pg.image} alt={pg.label} loading="lazy" decoding="async" className="w-full h-auto block" />
                </figure>
              ))}
              {!previewLoading && !previewError && (previewData?.pages?.length ?? 0) === 0 && (
                <div className="py-16 text-center text-sm text-slate-400">표시할 핵심 페이지를 찾지 못했습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
