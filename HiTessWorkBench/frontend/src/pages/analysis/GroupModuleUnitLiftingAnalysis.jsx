import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud, ArrowLeft, ArrowRight, ChevronDown, ChevronsRight,
  FileCheck2, MapPin, Cpu, BarChart3,
  X, CheckCircle2, Loader2,
  RotateCcw, AlertOctagon, FileText, Download, Wand2, Weight,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import GuideButton from '../../components/ui/GuideButton';
import { usePolling } from '../../hooks/usePolling';
import { requestBdfScanner, downloadFileText, requestGroupModuleCog } from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import BdfModelViewer from '../../components/analysis/BdfModelViewer';

// ── 상태 설정 (HiTessModelBuilder와 동일) ─────────────────────
const STATUS_CONFIG = {
  wait:     { dot: 'bg-white border-2 border-slate-300',                   badge: 'bg-slate-100 text-slate-500',  label: '대기' },
  running:  { dot: 'bg-blue-500 border-2 border-blue-500 animate-pulse',     badge: 'bg-blue-100 text-blue-700',    label: '실행 중' },
  done:     { dot: 'bg-green-500 border-2 border-green-500',               badge: 'bg-green-100 text-green-800',  label: '완료' },
  error:    { dot: 'bg-red-500 border-2 border-red-500',                   badge: 'bg-red-100 text-red-700',      label: '오류' },
  disabled: { dot: 'bg-slate-200 border-2 border-slate-200',               badge: 'bg-slate-100 text-slate-400',  label: '비활성' },
};

// ── 파이프라인 단계 초기 정의 ──────────────────────────────────
const INITIAL_STEPS = [
  { id: 'bdf-validation', title: 'BDF 입력 검증',  sub: 'BDF 파일 업로드 및 유효성 검증', icon: FileCheck2, status: 'wait' },
  { id: 'lifting-points', title: '권상 위치 선택', sub: '슬링 포인트 및 하중 조건 입력',  icon: MapPin,     status: 'wait' },
  { id: 'nastran',        title: 'Nastran 해석',   sub: 'SOL 101 정적 해석 실행',         icon: Cpu,        status: 'wait' },
  { id: 'results',        title: '해석 결과 확인', sub: '응력·변위 결과 및 판정',          icon: BarChart3,  status: 'wait' },
];

// ── Toggle (HiTessModelBuilder와 동일) ────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200
        ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200
        ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

// ── BDF 파일 드롭존 ──────────────────────────────────────────
function BdfDropZone({ file, onFile, onClear, disabled }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith('.bdf')) onFile(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
        <FileText size={22} className="text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-800 truncate">{file.name}</p>
          <p className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        {!disabled && (
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-slate-400 hover:text-red-500 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
        disabled
          ? 'border-slate-200 opacity-40 cursor-not-allowed'
          : dragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
      }`}
    >
      <UploadCloud size={28} className={dragOver ? 'text-blue-500' : 'text-slate-300'} />
      <div className="text-center">
        <p className="text-xs font-semibold text-slate-600">BDF 파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="text-[10px] text-slate-400 mt-0.5">*.bdf 파일만 지원됩니다</p>
      </div>
      <input ref={inputRef} type="file" accept=".bdf" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; }} className="hidden" />
    </div>
  );
}


// ── 권상 위치 선택 패널 ──────────────────────────────────────
function LiftingPointsPanel({ points, onUpdateNode, onTogglePoint, liftingParams, onUpdateParam }) {
  return (
    <div className="space-y-4">
      {/* 슬링 포인트 입력 */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">슬링 포인트 (Node ID)</p>
        <div className="space-y-2">
          {points.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <button
                onClick={() => onTogglePoint(p.id)}
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                  p.enabled ? 'bg-blue-600 border-blue-500' : 'bg-white border-slate-300 hover:border-blue-300'
                }`}
              >
                {p.enabled && <CheckCircle2 size={10} className="text-white" />}
              </button>
              <span className="text-[11px] font-medium text-slate-600 w-16 shrink-0">{p.label}</span>
              <input
                type="text"
                value={p.nodeId}
                onChange={e => onUpdateNode(p.id, e.target.value)}
                disabled={!p.enabled}
                placeholder="Node ID"
                className="flex-1 text-[11px] px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-40 disabled:bg-slate-50 text-slate-700"
              />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">최소 2점 이상 선택 필요합니다.</p>
      </div>

      <div className="h-px bg-slate-100" />

      {/* 하중 조건 */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">하중 조건</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'weight',  label: '총 중량',       unit: 'ton',  default: '' },
            { key: 'daf',     label: '동하중 계수',   unit: 'DAF',  default: '1.25' },
            { key: 'angle',   label: '슬링 각도',     unit: '°',    default: '60' },
            { key: 'sf',      label: '안전 계수',     unit: 'SF',   default: '2.0' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-slate-500 mb-1 block">
                {f.label} <span className="text-slate-400">({f.unit})</span>
              </label>
              <input
                type="number"
                value={liftingParams[f.key] ?? f.default}
                onChange={e => onUpdateParam(f.key, e.target.value)}
                placeholder={f.default}
                className="w-full text-[11px] px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-700"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 진행 로그 패널 ────────────────────────────────────────────
function ProgressLogPanel({ log }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);
  return (
    <div className="h-full flex flex-col bg-slate-950 font-mono text-[10px] leading-relaxed overflow-y-auto custom-scrollbar p-3">
      {log.length === 0
        ? <p className="text-slate-600 italic">실행 로그가 여기에 표시됩니다.</p>
        : log.map((line, i) => (
            <p key={i} className={
              line.includes('[ERROR]') ? 'text-red-400' :
              line.includes('[WARN]')  ? 'text-amber-400' :
              line.includes('[OK]')    ? 'text-green-400' :
              'text-slate-400'
            }>{line}</p>
          ))
      }
      <div ref={bottomRef} />
    </div>
  );
}

// ── 결과 테이블 패널 ──────────────────────────────────────────
function ResultsPanel({ result }) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
        <BarChart3 size={36} className="opacity-20" />
        <p className="text-sm text-slate-500">해석 완료 후 결과가 표시됩니다.</p>
      </div>
    );
  }

  const isPass = result.status === 'PASS';
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full custom-scrollbar">
      {/* 종합 판정 배너 */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        isPass ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}>
        {isPass
          ? <CheckCircle2 size={20} className="text-green-600 shrink-0" />
          : <AlertOctagon size={20} className="text-red-500 shrink-0" />}
        <div>
          <p className={`text-sm font-bold ${isPass ? 'text-green-700' : 'text-red-700'}`}>
            종합 판정: {isPass ? 'PASS' : 'FAIL'}
          </p>
          <p className="text-[10px] text-slate-500">최대 합성 응력 / 허용 응력 기준</p>
        </div>
      </div>

      {/* 결과 요약 테이블 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">결과 요약</span>
          <button className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors cursor-pointer">
            <Download size={10} /> Excel 다운로드
          </button>
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 text-left text-slate-500 font-medium">항목</th>
              <th className="px-4 py-2 text-right text-slate-500 font-medium">계산값</th>
              <th className="px-4 py-2 text-right text-slate-500 font-medium">허용치</th>
              <th className="px-4 py-2 text-right text-slate-500 font-medium">판정</th>
            </tr>
          </thead>
          <tbody>
            {(result.items || []).map((item, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-2 text-slate-700">{item.label}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{item.value}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-400">{item.allowable}</td>
                <td className="px-4 py-2 text-right">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    item.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {item.ok ? 'OK' : 'NG'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function GroupModuleUnitLiftingAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { currentUser } = useDashboard();
  const { showToast } = useToast();

  // ── 파이프라인 상태 ──────────────────────────────────────
  const [steps, setSteps]     = useState(INITIAL_STEPS);
  const [activeIdx, setActiveIdx] = useState(0);


  // ── Step 0: BDF 입력 ─────────────────────────────────────
  const [bdfFile, setBdfFile]           = useState(null);
  const [validating, setValidating]     = useState(false);
  const [validJobId, setValidJobId]     = useState(null);
  const [validProgress, setValidProgress] = useState(0);
  const [validStatusMsg, setValidStatusMsg] = useState('');
  const [step1Data, setStep1Data]       = useState(null);
  const [step2Data, setStep2Data]       = useState(null);
  const [validOpen, setValidOpen]       = useState(true);

  // ── Step 1: 3D 모델 + COG ──────────────────────────────
  const [bdfPath, setBdfPath]           = useState(null);
  const [modelInfoPath, setModelInfoPath] = useState(null);
  const [modelData, setModelData]       = useState(null);
  const [cogData, setCogData]           = useState(null);
  const [cogLoading, setCogLoading]     = useState(false);
  const cogFetchedRef = useRef(false);

  // 매 렌더마다 새 객체 생성을 방지 — cogPosition이 안정적이어야 BdfModelViewer 씬이 불필요하게 재빌드되지 않음
  const cogPos = useMemo(
    () => cogData ? { x: cogData.CogX, y: cogData.CogY, z: cogData.CogZ } : null,
    [cogData]
  );

  // BDF 검증 폴링
  usePolling({
    jobId: validJobId,
    maxRetries: 240,
    onProgress: (data) => {
      setValidProgress(data.progress ?? 0);
      setValidStatusMsg(data.message ?? '');
    },
    onComplete: async (data) => {
      setValidating(false);
      setValidJobId(null);
      setValidProgress(100);
      const result_info = data.project?.result_info;
      if (!result_info) {
        setStepStatus('bdf-validation', 'error');
        showToast('결과 파일을 찾을 수 없습니다.', 'error');
        return;
      }
      let s1 = null, s2 = null;
      // BDF 경로 및 모델 JSON 경로 캡처
      if (result_info.bdf) setBdfPath(result_info.bdf);
      if (result_info.JSON_ModelInfo) setModelInfoPath(result_info.JSON_ModelInfo);
      await Promise.allSettled(
        Object.entries(result_info).map(async ([key, path]) => {
          if (!path || typeof path !== 'string' || !path.endsWith('.json')) return;
          try {
            const res = await downloadFileText(path);
            const parsed = JSON.parse(res.data);
            if (key === 'JSON_Validation') s1 = parsed;
            else if (key === 'JSON_F06Summary') s2 = parsed;
          } catch {}
        })
      );
      if (s1) setStep1Data(s1);
      if (s2) setStep2Data(s2);
      const hasError = s1?.status === 'error';
      setStepStatus('bdf-validation', hasError ? 'error' : 'done');
      showToast(hasError ? 'BDF 검증 — 오류 발견' : 'BDF 검증 완료', hasError ? 'warning' : 'success');
      if (!hasError) setActiveIdx(1);
    },
    onError: (errData) => {
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      showToast(errData?.timeout ? '검증 시간 초과' : 'BDF 검증 실패', 'error');
    },
  });

  // ── Step 1: 권상 위치 ────────────────────────────────────
  const [liftingPoints, setLiftingPoints] = useState([
    { id: 1, label: '권상점 A', nodeId: '', enabled: true  },
    { id: 2, label: '권상점 B', nodeId: '', enabled: true  },
    { id: 3, label: '권상점 C', nodeId: '', enabled: false },
    { id: 4, label: '권상점 D', nodeId: '', enabled: false },
  ]);
  const [liftingParams, setLiftingParams] = useState({ weight: '', daf: '1.25', angle: '60', sf: '2.0' });
  const [liftingOpen, setLiftingOpen]     = useState(true);

  // ── Step 0: 해석 설정 ───────────────────────────────────
  const [useNastran, setUseNastran] = useState(true);

  // ── Step 2: Nastran 해석 ─────────────────────────────────
  const [jobStatus, setJobStatus]   = useState(null); // null | { status, progress, message }
  const [engineLog, setEngineLog]   = useState([]);
  const pollRef = useRef(null);

  // ── Step 3: 결과 ─────────────────────────────────────────
  const [analysisResult, setAnalysisResult] = useState(null);

  const doneCount = steps.filter(s => s.status === 'done').length;

  const setStepStatus = (id, status) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  // Step 2 진입 시 COG 계산 + 3D 모델 자동 로드
  useEffect(() => {
    if (activeIdx !== 1) return;
    if (!modelInfoPath || !bdfPath) return;
    if (cogFetchedRef.current) return;
    cogFetchedRef.current = true;

    downloadFileText(modelInfoPath)
      .then(res => { try { setModelData(JSON.parse(res.data)); } catch {} })
      .catch(() => {});

    setCogLoading(true);
    requestGroupModuleCog(bdfPath)
      .then(res => setCogData(res.data))
      .catch(() => showToast('COG 계산 실패 — ModuleGroupUnitAnalysis.exe 확인 필요', 'warning'))
      .finally(() => setCogLoading(false));
  }, [activeIdx, modelInfoPath, bdfPath]);

  const goStep = (idx) => setActiveIdx(idx);

  const activeStep = steps[activeIdx];
  const isBdfStep      = activeStep?.id === 'bdf-validation';
  const isLiftingStep  = activeStep?.id === 'lifting-points';
  const isNastranStep  = activeStep?.id === 'nastran';
  const isResultsStep  = activeStep?.id === 'results';

  // ── BDF 검증 ─────────────────────────────────────────────
  const handleValidate = async () => {
    if (!bdfFile) return;
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setStep1Data(null);
    setStep2Data(null);
    setValidProgress(0);
    setValidStatusMsg('서버 요청 중...');

    try {
      const userStr = localStorage.getItem('user');
      const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

      const formData = new FormData();
      formData.append('bdf_file', bdfFile);
      formData.append('employee_id', employeeId);
      formData.append('use_nastran', String(useNastran));
      formData.append('source', 'Workbench');
      formData.append('program_name', 'GroupModuleUnit');

      const res = await requestBdfScanner(formData);
      setValidJobId(res.data.job_id);
    } catch (e) {
      console.error('[BDF 검증] 요청 실패:', e);
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      showToast(`BDF 검증 요청 실패 — ${detail}`, 'error');
    }
  };

  // ── 해석 실행 ─────────────────────────────────────────────
  const handleRun = () => {
    const bdfDone = steps.find(s => s.id === 'bdf-validation')?.status === 'done';
    if (!bdfDone) {
      if (!bdfFile) {
        showToast('BDF 파일을 업로드해주세요.', 'warning');
        setActiveIdx(0);
        return;
      }
      handleValidate();
      return;
    }
    const activePoints = liftingPoints.filter(p => p.enabled && p.nodeId.trim());
    if (activePoints.length < 2) {
      showToast('권상 위치를 2점 이상 입력해주세요.', 'warning');
      setActiveIdx(1);
      return;
    }


    setActiveIdx(2);
    setStepStatus('lifting-points', 'done');
    setStepStatus('nastran', 'running');
    setJobStatus({ status: 'Running', progress: 0, message: 'Nastran SOL 101 해석 중...' });
    setEngineLog(['[INFO] 해석 시작...', '[INFO] BDF 권상 하중 조건 적용 중...']);

    // TODO: 실제 API 연결
    let p = 0;
    const timer = setInterval(() => {
      p += Math.random() * 12;
      if (p >= 100) {
        p = 100;
        clearInterval(timer);
        setJobStatus({ status: 'Success', progress: 100, message: '해석 완료' });
        setEngineLog(prev => [...prev, '[INFO] Nastran 해석 완료', '[OK] F06 파싱 완료', '[OK] 결과 추출 완료']);
        setStepStatus('nastran', 'done');
        setStepStatus('results', 'wait');
        setAnalysisResult({
          status: 'PASS',
          items: [
            { label: '최대 축력 응력',   value: '142.3 MPa', allowable: '250.0 MPa', ok: true  },
            { label: '최대 굽힘 응력',   value: '87.6 MPa',  allowable: '250.0 MPa', ok: true  },
            { label: '최대 합성 응력',   value: '183.1 MPa', allowable: '250.0 MPa', ok: true  },
            { label: '최대 처짐 (수직)', value: '12.4 mm',   allowable: '30.0 mm',   ok: true  },
            { label: '슬링력 (A점)',     value: '18.3 ton',  allowable: '25.0 ton',  ok: true  },
            { label: '슬링력 (B점)',     value: '17.9 ton',  allowable: '25.0 ton',  ok: true  },
          ],
        });
        setActiveIdx(3);
      } else {
        const pInt = Math.min(Math.round(p), 99);
        setJobStatus({ status: 'Running', progress: pInt, message: `Nastran 해석 중... (${pInt}%)` });
        if (p > 30 && p < 35) setEngineLog(prev => [...prev, '[INFO] MATRIX KLL 조립 중...']);
        if (p > 60 && p < 65) setEngineLog(prev => [...prev, '[INFO] LU 분해 완료...']);
        if (p > 85 && p < 90) setEngineLog(prev => [...prev, '[INFO] 변위 해 계산 완료...']);
      }
    }, 300);
  };

  // ── 전체 초기화 ──────────────────────────────────────────
  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setBdfFile(null);
    setValidating(false);
    setValidJobId(null);
    setStep1Data(null);
    setStep2Data(null);
    setValidProgress(0);
    setValidStatusMsg('');
    setBdfPath(null);
    setModelInfoPath(null);
    setModelData(null);
    setCogData(null);
    setCogLoading(false);
    cogFetchedRef.current = false;
    setLiftingPoints(prev => prev.map(p => ({ ...p, nodeId: '' })));
    setLiftingParams({ weight: '', daf: '1.25', angle: '60', sf: '2.0' });
    setJobStatus(null);
    setEngineLog([]);
    setAnalysisResult(null);
    setSteps(INITIAL_STEPS);
    setActiveIdx(0);
    setUseNastran(true);
  };

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      {/* ── 그라디언트 배너 헤더 ── */}
      <div className="relative -mx-6 -mt-6 mb-6 px-8 py-5 bg-gradient-to-r from-brand-blue via-brand-blue-dark to-blue-700 overflow-hidden shrink-0">
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
                <UploadCloud size={20} className="opacity-80" />
                Group &amp; Module Unit 권상 구조 해석
              </h1>
              <p className="text-sm text-blue-200/80 mt-0.5">
                Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GuideButton guideTitle="[파일] Group & Module Unit 권상 구조 해석" variant="dark" />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 gap-5 min-h-0">

        {/* ── Left Panel ── */}
        <div className="w-96 shrink-0 flex flex-col gap-3">

          {/* 스텝퍼 */}
          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">파이프라인</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3">
              {steps.map((step, idx) => {
                const StepIcon = step.icon;
                const effectiveStatus = step.status;
                const cfg      = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.wait;
                const isActive = idx === activeIdx;
                const isLast   = idx === steps.length - 1;

                return (
                  <div key={step.id} className="flex items-stretch">
                    {/* 타임라인 dot + 수직선 */}
                    <div className="flex flex-col items-center w-7 shrink-0 pt-4">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${cfg.dot}`} />
                      {!isLast && (
                        <div className="flex-1 w-0.5 my-1 transition-colors duration-300 rounded-full bg-violet-400" />
                      )}
                    </div>

                    {/* 스텝 카드 */}
                    <div
                      className={`flex-1 mb-2 ml-2 rounded-xl border px-3.5 py-3 transition-all duration-200 cursor-pointer
                        ${effectiveStatus === 'disabled'
                          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-default'
                          : isActive
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      onClick={() => effectiveStatus !== 'disabled' && goStep(idx)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <StepIcon size={13} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                          <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                            {idx + 1}. {step.title}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap ${cfg.badge}`}>
                          {effectiveStatus === 'disabled' ? '비활성' : isActive && step.status === 'wait' ? '선택됨' : cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 pl-5">{step.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 실행 버튼 푸터 */}
            <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
              {/* 해석 설정 토글 */}
              <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                useNastran ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
              }`}>
                <p className={`text-xs font-bold ${useNastran ? 'text-blue-700' : 'text-slate-500'}`}>
                  Nastran을 통한 BDF 입력 검증
                </p>
                <Toggle checked={useNastran} onChange={setUseNastran} />
              </div>
              <button
                onClick={handleRun}
                disabled={validating || jobStatus?.status === 'Running'}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-blue-dark active:bg-brand-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                {validating
                  ? <><Loader2 size={15} className="animate-spin" /> BDF 검증 중...</>
                  : jobStatus?.status === 'Running'
                  ? <><Loader2 size={15} className="animate-spin" /> 해석 실행 중...</>
                  : <><ChevronsRight size={16} /> 해석 실행</>
                }
              </button>
              <button
                onClick={handleReset}
                disabled={validating || jobStatus?.status === 'Running'}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>


        </div>{/* end Left Panel */}

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">

          {/* ─ Step 0: BDF 입력 검증 ─ */}
          {isBdfStep && (
            <>
              {/* 입력 패널 */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-700">1. BDF 입력 검증</h2>
                  <span className="text-[10px] text-slate-400">— BDF 파일 업로드 및 유효성 검증</span>
                </div>
                <div className="p-4 flex flex-row gap-3">
                  {/* 왼쪽: BdfDropZone + 검증 버튼 */}
                  <div className="flex-1 flex flex-col gap-3">
                    <BdfDropZone
                      file={bdfFile}
                      onFile={f => { setBdfFile(f); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                      onClear={() => { setBdfFile(null); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                      disabled={validating}
                    />
                  </div>

                  {/* 오른쪽: HiTess Model Builder 유도 카드 */}
                  <button
                    onClick={() => setCurrentMenu('HiTess Model Builder')}
                    className="w-52 shrink-0 relative flex flex-col justify-between p-4 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-800 hover:from-indigo-500 hover:to-indigo-700 active:scale-[0.98] transition-all duration-200 cursor-pointer overflow-hidden group shadow-md hover:shadow-indigo-400/30 text-left"
                  >
                    <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/5 rounded-full pointer-events-none" />
                    <div className="absolute -right-2 bottom-4 w-12 h-12 bg-white/5 rounded-full pointer-events-none" />
                    <span className="relative text-[10px] font-medium text-indigo-300 tracking-wide">BDF가 없다면?</span>
                    <div className="relative mt-2 flex-1">
                      <p className="text-sm font-bold text-white leading-snug">CSV로부터<br />시작하세요</p>
                    </div>
                    <div className="relative mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Wand2 size={12} className="text-indigo-300 shrink-0" />
                        <span className="text-[10px] font-semibold text-indigo-200 leading-tight">HiTess Model Builder</span>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-white/15 group-hover:bg-white/25 flex items-center justify-center transition-colors">
                        <ArrowRight size={12} className="text-white" />
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* BDF 검증 결과 패널 */}
              <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">BDF 검증 결과</span>
                    {step1Data && step1Data.status !== 'error' && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">완료</span></>}
                    {step1Data?.status === 'error'             && <><div className="w-1.5 h-1.5 rounded-full bg-red-400"   /><span className="text-[10px] text-red-400">오류</span></>}
                    {validating                                && <><Loader2 size={11} className="animate-spin text-blue-500" /><span className="text-[10px] text-blue-600">{validStatusMsg || '검증 중'}</span></>}
                  </div>
                  {step1Data && step1Data.status !== 'error' && (
                    <button
                      onClick={() => setActiveIdx(1)}
                      className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors cursor-pointer"
                    >
                      다음 단계 — 권상 위치 선택 →
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {/* 대기: 안내 */}
                  {!validating && !step1Data && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                      <FileCheck2 size={32} className="text-slate-200" />
                      <div>
                        <p className="text-sm font-semibold text-slate-400">BDF 파일을 업로드하고 검증을 실행하세요</p>
                        <p className="text-[11px] text-slate-300 mt-1">GRID, ELEMENT, SPC 카드를 파싱하여 오류 유무를 확인합니다.</p>
                      </div>
                    </div>
                  )}

                  {/* 검증 중 */}
                  {validating && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                      <Loader2 size={28} className="animate-spin text-blue-500" />
                      <p className="text-sm font-semibold text-slate-500">{validStatusMsg || 'BDF 파일 파싱 중...'}</p>
                      {validProgress > 0 && (
                        <div className="w-48 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${validProgress}%` }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 결과 표시 */}
                  {!validating && step1Data && (
                    <ValidationStepLog
                      step1Data={step1Data}
                      step2Data={step2Data}
                      useNastran={useNastran}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─ Step 1: 권상 위치 선택 ─ */}
          {isLiftingStep && (
            <>
              {/* 입력 패널 (collapsible) */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setLiftingOpen(v => !v)}
                  className="flex items-center justify-between px-4 py-2.5 w-full text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold text-slate-700">2. 권상 위치 선택</h2>
                    <span className="text-[10px] text-slate-400">— 슬링 포인트 및 하중 조건 입력</span>
                  </div>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${liftingOpen ? 'rotate-180' : ''}`} />
                </button>
                {liftingOpen && (
                  <div className="border-t border-slate-100 p-4">
                    <LiftingPointsPanel
                      points={liftingPoints}
                      onUpdateNode={(id, val) => setLiftingPoints(prev => prev.map(p => p.id === id ? { ...p, nodeId: val } : p))}
                      onTogglePoint={(id) => setLiftingPoints(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled, nodeId: '' } : p))}
                      liftingParams={liftingParams}
                      onUpdateParam={(key, val) => setLiftingParams(prev => ({ ...prev, [key]: val }))}
                    />
                  </div>
                )}
              </div>

              {/* 3D 모델 뷰어 + COG 정보 */}
              <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {/* 헤더 */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">3D 모델 및 COG 분석</span>
                    {cogLoading && (
                      <><Loader2 size={11} className="animate-spin text-blue-500" />
                      <span className="text-[10px] text-blue-600">COG 계산 중...</span></>
                    )}
                    {cogData && !cogLoading && (
                      <><div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-[10px] text-slate-400">COG 산출 완료</span></>
                    )}
                  </div>
                  {cogData && (
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span><span className="text-slate-400 mr-1">질량</span>
                        <span className="font-bold text-slate-700">{cogData.TotalMass?.toFixed(3)} kg</span></span>
                      <span><span className="text-slate-400 mr-0.5">X</span>
                        <span className="font-bold text-blue-600">{cogData.CogX?.toFixed(0)}</span></span>
                      <span><span className="text-slate-400 mr-0.5">Y</span>
                        <span className="font-bold text-green-600">{cogData.CogY?.toFixed(0)}</span></span>
                      <span><span className="text-slate-400 mr-0.5">Z</span>
                        <span className="font-bold text-purple-600">{cogData.CogZ?.toFixed(0)}</span></span>
                    </div>
                  )}
                </div>

                {/* 뷰어 본체 */}
                <div className="flex-1 min-h-0 relative">
                  {modelData ? (
                    <BdfModelViewer
                      modelData={modelData}
                      cogPosition={cogPos}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <Loader2 size={28} className="animate-spin text-blue-400" />
                      <p className="text-sm text-slate-500">3D 모델 로딩 중...</p>
                    </div>
                  )}

                  {/* COG 정보 오버레이 카드 */}
                  {cogData && (
                    <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-md px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Weight size={11} className="text-slate-400" />
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">무게중심 (COG)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                        <div>
                          <p className="text-[9px] text-slate-400">총 질량</p>
                          <p className="text-xs font-bold text-slate-700 font-mono">{cogData.TotalMass?.toFixed(3)} kg</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-blue-400">COG-X</p>
                          <p className="text-xs font-bold text-blue-600 font-mono">{cogData.CogX?.toFixed(1)} mm</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-green-500">COG-Y</p>
                          <p className="text-xs font-bold text-green-600 font-mono">{cogData.CogY?.toFixed(1)} mm</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-purple-400">COG-Z</p>
                          <p className="text-xs font-bold text-purple-600 font-mono">{cogData.CogZ?.toFixed(1)} mm</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 하단 안내 바 */}
                <div className="shrink-0 px-4 py-2.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
                  <p className="text-[10px] text-slate-500">
                    무게중심을 확인 후 좌측 패널에서 권상 포인트(Node ID)를 입력하세요
                  </p>
                  <button
                    onClick={handleRun}
                    disabled={liftingPoints.filter(p => p.enabled && p.nodeId.trim()).length < 2}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    <ChevronsRight size={13} /> 해석 시작
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ─ Step 2: Nastran 해석 ─ */}
          {isNastranStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nastran 해석</span>
                  {jobStatus?.status === 'Success' && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">완료</span></>}
                  {jobStatus?.status === 'Running' && <><Loader2 size={11} className="animate-spin text-blue-500" /><span className="text-[10px] text-blue-600">실행 중</span></>}
                </div>
                {jobStatus?.status === 'Running' && (
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${jobStatus.progress ?? 0}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{jobStatus.progress ?? 0}%</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <ProgressLogPanel log={engineLog} />
              </div>
            </div>
          )}

          {/* ─ Step 3: 해석 결과 ─ */}
          {isResultsStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">해석 결과 확인</span>
                  {analysisResult && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      analysisResult.status === 'PASS'
                        ? 'bg-green-50 text-green-600 border-green-200'
                        : 'bg-red-50 text-red-600 border-red-200'
                    }`}>
                      {analysisResult.status}
                    </span>
                  )}
                </div>
                {analysisResult && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="text-[10px] text-slate-400">검증 완료</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <ResultsPanel result={analysisResult} />
              </div>
            </div>
          )}

        </div>{/* end Right Panel */}
      </div>
    </div>
  );
}
