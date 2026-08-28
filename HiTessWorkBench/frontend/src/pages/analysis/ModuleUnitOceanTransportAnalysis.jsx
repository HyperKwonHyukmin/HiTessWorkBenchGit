import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud, ArrowRight, ChevronsRight,
  FileCheck2, Boxes, Waves, ShieldCheck,
  X, Loader2, RotateCcw, FileText, ExternalLink,
  Construction, Download, Layers,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { usePolling } from '../../hooks/usePolling';
import {
  requestModuleOceanTransport,
  downloadFileText,
  getJungbanViewerModel,
  getModuleOceanViewerModel,
} from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import FeModelViewer from '../../components/analysis/FeModelViewer';
import JungbanDeckSelector from '../../components/analysis/JungbanDeckSelector';
import { computeModulePlacement } from '../../utils/feGeometry';

// 정반 상면에서 Module Unit 바닥까지의 기본 높이(mm). 사용자가 2단계에서 조정할 수 있다.
const DEFAULT_DECK_GAP_MM = 5000;

const PART_COLOR_JUNGBAN = '#8d9bb0';
const PART_COLOR_MODULE  = '#38bdf8';

// ── 상태 설정 (Group & Module Unit 권상 구조 해석과 동일) ─────
const STATUS_CONFIG = {
  wait:     { dot: 'bg-white border-2 border-slate-300',                 badge: 'bg-slate-100 text-slate-500',  label: '대기' },
  running:  { dot: 'bg-blue-500 border-2 border-blue-500 animate-pulse', badge: 'bg-blue-100 text-blue-700',    label: '실행 중' },
  done:     { dot: 'bg-green-500 border-2 border-green-500',             badge: 'bg-green-100 text-green-800',  label: '완료' },
  error:    { dot: 'bg-red-500 border-2 border-red-500',                 badge: 'bg-red-100 text-red-700',      label: '오류' },
  disabled: { dot: 'bg-slate-200 border-2 border-slate-200',             badge: 'bg-slate-100 text-slate-400',  label: '비활성' },
};

// ── 파이프라인 단계 정의 ──────────────────────────────────────
const INITIAL_STEPS = [
  { id: 'bdf-validation',  title: 'Module Unit BDF 입력 검증',     sub: 'BDF 파일 업로드 및 유효성 검증',            icon: FileCheck2,  status: 'wait' },
  { id: 'arrangement',     title: '정반 상부 Module Unit 배치 설정', sub: '내장 정반 모델 위 Module Unit 배치 지정',   icon: Boxes,       status: 'wait' },
  { id: 'structural-run',  title: 'Module Unit 구조 해석 수행',     sub: '해상 운송 하중 조건 구조 해석',             icon: Waves,       status: 'wait' },
  { id: 'weld-assessment', title: '용접부 강도 평가 수행',           sub: '고박·접합 용접부 강도 판정',                icon: ShieldCheck, status: 'wait' },
];

// ── Toggle ────────────────────────────────────────────────────
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
        <p className="text-xs font-semibold text-slate-600">Module Unit BDF 파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="text-[10px] text-slate-400 mt-0.5">*.bdf 파일만 지원됩니다 — 정반 모델은 프로그램에 내장되어 있습니다</p>
      </div>
      <input ref={inputRef} type="file" accept=".bdf" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; }} className="hidden" />
    </div>
  );
}

/**
 * 아직 세부 구현이 확정되지 않은 단계의 자리표시 패널.
 * 전체 틀 단계에서 각 단계가 "무엇을 하게 될 자리인지"를 화면에 명시해 둔다.
 */
function StepPlaceholder({ icon: Icon, title, description, todos }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Icon size={26} className="text-slate-300" />
      </div>
      <div>
        <p className="text-sm font-bold text-slate-500">{title}</p>
        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed max-w-md">{description}</p>
      </div>
      {todos?.length > 0 && (
        <div className="w-full max-w-md rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-left">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <Construction size={11} /> 구성 예정 항목
          </p>
          <ul className="mt-2 space-y-1">
            {todos.map(t => (
              <li key={t} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                <span className="mt-[6px] w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 정반은 프로그램 내장 고정 모델이라 앱을 쓰는 동안 바뀌지 않는다.
 * 페이지 상태가 아니라 모듈 수준에 캐시해 두면 전체 초기화·재진입 후에도 재다운로드가 없다.
 *
 * A/B 두 타입을 한 map 에 담는다 — 선택 화면에서 미리보기로 이미 받아 둔 지오메트리를
 * 배치 화면이 그대로 재사용하므로, 타입을 골라도 추가 다운로드가 없다.
 */
const jungbanModelCache = {};   // deckType -> 슬림 지오메트리

/** 배치 파라미터 수치 입력 한 칸. 하단 도크에 가로로 나열된다. */
function ArrangementField({ label, unit, value, onChange, step = 100, title }) {
  return (
    <label className="block min-w-0" title={title}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600 truncate">{label}</span>
        <span className="text-[9px] font-mono text-slate-400 shrink-0">{unit}</span>
      </span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

/** 현재 배치 수치 한 칸. span 으로 여러 열을 차지할 수 있다. */
function PlacementStat({ label, value, emphasis, span = false }) {
  return (
    <div className={`min-w-0 ${span ? 'col-span-3' : ''}`}>
      <p className="text-[9px] text-slate-400 truncate">{label}</p>
      <p className={`text-[11px] font-mono truncate ${emphasis ? 'font-bold text-blue-600' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * 2단계 하단 배치 도크.
 * 뷰어 아래에 가로로 눕혀 모델 화면이 좌우 폭을 온전히 쓰도록 한다
 * (우측 세로 컬럼이던 것을 옮긴 것 — 3D 형상 판독에는 가로 폭이 훨씬 중요하다).
 */
function ArrangementPanel({
  gapMm, offsetXMm, offsetYMm, rotationZDeg,
  onChange, onReset, placement, disabled,
}) {
  const mm = (v) => Math.round(v).toLocaleString();

  return (
    <div className={`shrink-0 flex flex-col gap-3 lg:flex-row ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* ─ 배치 설정 ─ */}
      <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">배치 설정</span>
            <span className="text-[9px] text-slate-400 truncate">
              기본값 = 정반 전체 XY 중심 정렬 + 정반 상면 {DEFAULT_DECK_GAP_MM.toLocaleString()}mm 상부 · 단위 mm
            </span>
          </div>
          <button
            onClick={onReset}
            title="기본 배치로 되돌리기"
            className="flex items-center gap-1 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <RotateCcw size={10} /> 기본값
          </button>
        </div>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ArrangementField
            label="정반 상면 기준 높이"
            unit="mm"
            value={gapMm}
            step={500}
            onChange={(v) => onChange({ gapMm: v })}
            title="정반 상면에서 Module Unit 바닥까지의 높이"
          />
          <ArrangementField
            label="X 오프셋 (종방향)"
            unit="mm"
            value={offsetXMm}
            step={500}
            onChange={(v) => onChange({ offsetXMm: v })}
            title="정반 XY 중심 기준 종방향 이동량"
          />
          <ArrangementField
            label="Y 오프셋 (횡방향)"
            unit="mm"
            value={offsetYMm}
            step={500}
            onChange={(v) => onChange({ offsetYMm: v })}
            title="정반 XY 중심 기준 횡방향 이동량"
          />
          <ArrangementField
            label="Z축 회전"
            unit="deg"
            value={rotationZDeg}
            step={15}
            onChange={(v) => onChange({ rotationZDeg: v })}
            title="Module Unit 자체 평면 중심을 축으로 회전합니다."
          />
        </div>
      </div>

      {/* ─ 현재 배치 ─ */}
      <div className="lg:w-[400px] lg:shrink-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-3.5 py-2 border-b border-slate-100">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">현재 배치</span>
        </div>
        <div className="p-3">
          {placement?.position ? (
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <PlacementStat label="정반 상면 Z" value={mm(placement.deckTopZ)} />
              <PlacementStat label="MU 바닥 Z" value={mm(placement.moduleBottomZ)} emphasis />
              <PlacementStat label="MU 상단 Z" value={mm(placement.moduleTopZ)} />
              <PlacementStat label="MU 중심 X" value={mm(placement.position[0])} />
              <PlacementStat label="MU 중심 Y" value={mm(placement.position[1])} />
              {/* 세 축 치수를 한 줄에 담아야 잘리지 않는다 — 전체 폭 사용. */}
              <PlacementStat
                span
                label="MU 크기 X×Y×Z"
                value={placement.moduleSize.map(mm).join(' × ')}
              />
            </div>
          ) : (
            <div className="space-y-1">
              {placement && (
                <p className="text-[10px] font-mono text-slate-500">
                  정반 상면 Z = {mm(placement.deckTopZ)} mm
                </p>
              )}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Module Unit 모델이 로드되면 배치 좌표가 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function ModuleUnitOceanTransportAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const MENU_NAME = 'Module Unit 해상 운송 구조 해석';
  const dashboardCtx = useDashboard();
  const {
    startGlobalJob,
    clearGlobalJob,
    getJobForMenu,
    analysisPageStates,
    setAnalysisPageState,
    clearAnalysisPageState,
  } = dashboardCtx;
  const savedPageState = analysisPageStates?.[MENU_NAME] || {};
  // 다른 App 해석이 더 최근이어도 이 App 의 해석을 집어야 한다(globalJob 은 최신 1개일 뿐).
  const pageJob = getJobForMenu?.(MENU_NAME) || null;
  const { showToast } = useToast();

  // ── 파이프라인 상태 ──────────────────────────────────────
  const [steps, setSteps]         = useState(savedPageState.steps ?? INITIAL_STEPS);
  const [activeIdx, setActiveIdx] = useState(savedPageState.activeIdx ?? 0);
  // 검증이 성공적으로 끝났는지 여부 — 다음 단계 이동 게이트.
  const [hasRunOnce, setHasRunOnce] = useState(savedPageState.hasRunOnce ?? false);

  // ── Step 1: BDF 입력 검증 ────────────────────────────────
  const [bdfFile, setBdfFile]               = useState(savedPageState.bdfFile ?? null);
  const [validating, setValidating]         = useState(savedPageState.validating ?? false);
  const [validJobId, setValidJobId]         = useState(savedPageState.validJobId ?? null);
  const [validProgress, setValidProgress]   = useState(savedPageState.validProgress ?? 0);
  const [validStatusMsg, setValidStatusMsg] = useState(savedPageState.validStatusMsg ?? '');
  const [step1Data, setStep1Data]           = useState(savedPageState.step1Data ?? null);
  const [step2Data, setStep2Data]           = useState(savedPageState.step2Data ?? null);
  // 검증이 만든 모델 JSON 의 **서버 경로**. 원본은 대형 모델에서 30MB 를 넘으므로
  // 브라우저로 직접 받지 않고, 2단계에서 백엔드 슬림 변환 엔드포인트로 가져온다.
  const [modelJsonPath, setModelJsonPath]   = useState(savedPageState.modelJsonPath ?? null);
  const [bdfPath, setBdfPath]               = useState(savedPageState.bdfPath ?? null);
  // 검증 시 생성된 Analysis.id (DB record) — 후속 단계에서 parent 로 참조한다.
  const [bdfAnalysisId, setBdfAnalysisId]   = useState(savedPageState.bdfAnalysisId ?? null);

  // Nastran 을 통한 BDF 입력 검증은 기본 OFF — 필요 시 사용자가 토글로 켠다.
  const [useNastran, setUseNastran] = useState(savedPageState.useNastran ?? false);

  // ── Step 2: 정반 타입 / 뷰어 / 배치 ──────────────────────
  // 정반 타입(A/B). null 이면 2단계에서 선택 화면을 먼저 보여 준다.
  // 기본값을 두지 않는 이유 — 타입에 따라 정반 길이가 6m 차이 나므로 사용자가 반드시 골라야 한다.
  const [deckType, setDeckType] = useState(savedPageState.deckType ?? null);
  const [jungbanModel, setJungbanModel] = useState(
    () => (savedPageState.deckType ? jungbanModelCache[savedPageState.deckType] ?? null : null),
  );
  const [moduleModel, setModuleModel]   = useState(savedPageState.moduleModel ?? null);
  const [viewerStatus, setViewerStatus] = useState('idle');   // idle | loading | ready | error
  const [viewerError, setViewerError]   = useState(null);
  // '다시 시도' 및 새 검증 시 로드를 강제로 다시 태우기 위한 토큰.
  const [viewerReloadToken, setViewerReloadToken] = useState(0);
  const [arrangement, setArrangement]   = useState(savedPageState.arrangement ?? {
    gapMm: DEFAULT_DECK_GAP_MM, offsetXMm: 0, offsetYMm: 0, rotationZDeg: 0,
  });

  // ── Step 4: 결과 ─────────────────────────────────────────
  const [weldResult, setWeldResult] = useState(savedPageState.weldResult ?? null);

  const bdfFolderPath = useMemo(
    () => bdfPath ? bdfPath.replace(/[/\\][^/\\]+$/, '') : null,
    [bdfPath]
  );

  const doneCount = steps.filter(s => s.status === 'done').length;

  const setStepStatus = (id, status) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  // ── 페이지 상태 보존 (다른 메뉴로 이동해도 유지) ──────────
  useEffect(() => {
    setAnalysisPageState?.(MENU_NAME, {
      steps, activeIdx, hasRunOnce,
      bdfFile, validating, validJobId, validProgress, validStatusMsg,
      step1Data, step2Data, modelJsonPath, bdfPath, bdfAnalysisId,
      useNastran, weldResult, moduleModel, arrangement, deckType,
    });
  }, [
    setAnalysisPageState,
    steps, activeIdx, hasRunOnce,
    bdfFile, validating, validJobId, validProgress, validStatusMsg,
    step1Data, step2Data, modelJsonPath, bdfPath, bdfAnalysisId,
    useNastran, weldResult, moduleModel, arrangement, deckType,
  ]);

  // ── 진행 중이던 작업 복원 ────────────────────────────────
  useEffect(() => {
    if (!pageJob) return;
    if (pageJob.status !== 'Running' && pageJob.status !== 'Pending') return;
    setValidJobId(prev => prev || pageJob.jobId);
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setValidProgress(pageJob.progress ?? 0);
    setValidStatusMsg(pageJob.message ?? '서버 처리 중...');
  }, [pageJob?.jobId, pageJob?.status, pageJob?.progress, pageJob?.message]);

  // ── BDF 검증 폴링 ────────────────────────────────────────
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
      if (result_info.bdf) setBdfPath(result_info.bdf);
      if (typeof data.project?.id === 'number') setBdfAnalysisId(data.project.id);

      // ⚠ JSON_ModelInfo 는 요소 품질 지표까지 담겨 대형 모델에서 30MB 를 넘는다.
      //    여기서는 경로만 기억하고, 2단계 뷰어가 백엔드 슬림 엔드포인트로 지오메트리만 받는다.
      if (typeof result_info.JSON_ModelInfo === 'string') {
        setModelJsonPath(result_info.JSON_ModelInfo);
        setModuleModel(null);   // 새 모델이므로 이전 뷰어 데이터 폐기
        setViewerStatus('idle');
      }

      let s1 = null, s2 = null;
      await Promise.allSettled(
        Object.entries(result_info).map(async ([key, path]) => {
          if (key === 'JSON_ModelInfo') return;
          if (!path || typeof path !== 'string' || !path.endsWith('.json')) return;
          try {
            const res = await downloadFileText(path);
            const parsed = JSON.parse(res.data);
            if (key === 'JSON_Validation') s1 = parsed;
            else if (key === 'JSON_F06Summary') s2 = parsed;
          } catch { /* 개별 결과 파일 로드 실패는 무시 — 나머지 결과는 계속 표시한다 */ }
        })
      );
      if (s1) setStep1Data(s1);
      if (s2) setStep2Data(s2);

      const hasError = s1?.status === 'error';
      setStepStatus('bdf-validation', hasError ? 'error' : 'done');
      // 검증이 error 로 끝나면 다음 단계 진입 게이트를 풀지 않는다 —
      // 잘못된 BDF 로 배치·해석 단계에 들어가 원인 불명 오류가 나는 것을 차단.
      if (!hasError) setHasRunOnce(true);
      showToast(hasError ? 'BDF 검증 — 오류 발견' : 'BDF 검증 완료', hasError ? 'warning' : 'success');
    },
    onError: (errData) => {
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      showToast(errData?.timeout ? '검증 시간 초과' : 'BDF 검증 실패', 'error');
    },
  });

  // 어떤 입력으로 뷰어 지오메트리를 받아 뒀는지 추적한다(아래 로드 effect 참고).
  const loadedViewerKeyRef = useRef(null);

  /** 2단계 뷰어 상태를 비운다. 새 BDF 를 넣거나 초기화할 때 항상 이 함수를 쓴다. */
  const resetViewerModel = () => {
    setModelJsonPath(null);
    setModuleModel(null);
    setJungbanModel(null);
    setViewerStatus('idle');
    setViewerError(null);
    // 로드 기록까지 지워야 같은 경로로 재검증했을 때 새 모델을 다시 받는다.
    loadedViewerKeyRef.current = null;
  };

  /**
   * 정반 타입 선택. 타입이 바뀌면 이전 정반 지오메트리를 반드시 버린다 —
   * 남겨 두면 배치 화면이 A 정반을 그린 채로 B 제원을 쓰게 되어 배치 좌표가 어긋난다.
   * (Module Unit 과 modelJsonPath 는 정반과 무관하므로 그대로 둔다.)
   */
  const handleSelectDeckType = (nextType) => {
    if (nextType === deckType) return;
    setDeckType(nextType);
    setJungbanModel(null);
    setViewerStatus('idle');
    setViewerError(null);
    loadedViewerKeyRef.current = null;
  };

  // ── Step 2: 정반(고정) + Module Unit(가변) 지오메트리 로드 ────────────
  // 2단계에 들어온 시점에 필요한 것만 받는다 — 검증 직후에 미리 받아 두면
  // 사용자가 2단계를 안 볼 수도 있는데 수 MB 를 낭비하게 된다.
  //
  // ⚠ 이 effect 의 의존성에 jungbanModel/moduleModel 을 넣으면 안 된다.
  //   자기가 setState 하는 값을 의존성으로 삼으면, 정반을 받아 상태에 넣는 순간 effect 가
  //   재실행되면서 cleanup 이 진행 중이던 Module Unit 요청을 취소해 버린다(응답이 와도 무시).
  //   그러면 화면은 "불러오는 중" 에서 영원히 멈춘다. 대신 '무엇을 로드했는지'를 ref 로 추적한다.
  const activeStepId = steps[activeIdx]?.id;

  useEffect(() => {
    if (activeStepId !== 'arrangement') return undefined;
    // 타입을 아직 안 골랐으면 선택 화면 단계다 — 아무것도 받지 않는다.
    if (!deckType) return undefined;
    // 입력 식별자 — Module Unit 이 아직 없으면 정반만 띄우는 상태도 하나의 유효한 결과다.
    // 정반 타입이 키에 들어가야 A→B 로 바꿨을 때 새 정반을 다시 받는다.
    const key = `${deckType}|${modelJsonPath || '__deck-only__'}`;
    if (loadedViewerKeyRef.current === key) return undefined;

    let cancelled = false;
    setViewerStatus('loading');
    setViewerError(null);

    (async () => {
      try {
        // 정반은 타입별 고정 모델이라 앱 세션당 타입당 1회만 받는다.
        // 선택 화면이 미리보기로 이미 받아 뒀다면 여기서 네트워크 요청이 아예 없다.
        let deck = jungbanModelCache[deckType];
        if (!deck) {
          const res = await getJungbanViewerModel(deckType);
          deck = res.data;
          jungbanModelCache[deckType] = deck;
        }
        if (cancelled) return;
        setJungbanModel(deck);

        if (modelJsonPath) {
          const res = await getModuleOceanViewerModel(modelJsonPath, 'Module Unit');
          if (cancelled) return;
          setModuleModel(res.data);
        }
        if (cancelled) return;
        // 성공했을 때만 기록한다 — 중간에 취소됐다면 다음 진입에서 다시 받아야 한다.
        loadedViewerKeyRef.current = key;
        setViewerStatus('ready');
      } catch (e) {
        if (cancelled) return;
        const status = e?.response?.status;
        let detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
        // 404 는 대개 백엔드가 이 App 의 신규 라우터를 아직 안 띄운 상태다 —
        // 사용자가 원인을 짐작하지 않아도 되도록 조치까지 적어 준다.
        if (status === 404) {
          detail += ' — 백엔드에 모델 뷰어 API 가 없습니다. 서버를 최신 코드로 재시작했는지 확인하세요.';
        } else if (status === 503) {
          detail += ' — 정반 모델 파일이 서버에 배치되지 않았습니다.';
        }
        setViewerError(detail);
        setViewerStatus('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepId, deckType, modelJsonPath, viewerReloadToken]);

  // 배치 규칙은 utils/feGeometry.computeModulePlacement 한 곳에만 있다(단위 테스트 대상).
  const placement = useMemo(
    () => computeModulePlacement(jungbanModel?.bounds, moduleModel?.bounds, arrangement),
    [jungbanModel, moduleModel, arrangement],
  );

  const viewerParts = useMemo(() => {
    const list = [];
    if (jungbanModel) {
      list.push({
        id: 'jungban',
        name: '정반 (고정)',
        color: PART_COLOR_JUNGBAN,
        model: jungbanModel,
        position: [0, 0, 0],
        rotationZ: 0,
        opacity: 1,
      });
    }
    if (moduleModel && placement?.position) {
      list.push({
        id: 'module-unit',
        name: 'Module Unit',
        color: PART_COLOR_MODULE,
        model: moduleModel,
        anchor: placement.anchor,
        position: placement.position,
        rotationZ: arrangement.rotationZDeg,
        opacity: 1,
      });
    }
    return list;
  }, [jungbanModel, moduleModel, placement, arrangement.rotationZDeg]);

  // ── BDF 검증 요청 ────────────────────────────────────────
  const handleValidate = async () => {
    if (!bdfFile) return;
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setStep1Data(null);
    setStep2Data(null);
    resetViewerModel();
    setValidProgress(0);
    setValidStatusMsg('서버 요청 중...');

    try {
      const userStr = localStorage.getItem('user');
      const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

      const formData = new FormData();
      formData.append('employee_id', employeeId);
      formData.append('use_nastran', String(useNastran));
      formData.append('source', 'Workbench');
      formData.append('bdf_file', bdfFile);

      const res = await requestModuleOceanTransport(formData);
      setValidJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, MENU_NAME);
    } catch (e) {
      console.error('[BDF 검증] 요청 실패:', e);
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      showToast(`BDF 검증 요청 실패 — ${detail}`, 'error');
    }
  };

  // ── 샘플 실행 콜백 ───────────────────────────────────────
  // SampleRunButton 이 호출한다. 서버가 만든 job_id 를 handleValidate 와 **같은 폴링 흐름**에
  // 밀어 넣기만 하면, 이후 완료 처리(모델 경로 확보 → 2단계 뷰어)는 전부 재사용된다.
  const sampleBefore = () => {
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setStep1Data(null);
    setStep2Data(null);
    // 샘플은 새 BDF 이므로 이전 뷰어 지오메트리를 반드시 버린다.
    // (안 버리면 2단계에서 직전 Module Unit 이 그대로 서 있다.)
    resetViewerModel();
    setValidProgress(0);
    setValidStatusMsg('샘플 파일로 작업 요청 중...');
  };
  const sampleSubmitted = (jobId) => {
    setValidJobId(jobId);
    startGlobalJob?.(jobId, MENU_NAME);
  };
  const sampleError = (status, detail) => {
    setValidating(false);
    setValidJobId(null);
    if (status === 429) {
      // 한도 초과는 실패가 아니다 — 단계를 error 로 물들이지 않고 대기 상태로 되돌린다.
      setStepStatus('bdf-validation', 'wait');
      setValidStatusMsg('');
    } else {
      setStepStatus('bdf-validation', 'error');
      showToast(`샘플 실행 실패 — ${detail}`, 'error');
    }
  };

  // ── 실행 버튼 ────────────────────────────────────────────
  const handleRun = () => {
    const bdfDone = steps.find(s => s.id === 'bdf-validation')?.status === 'done';
    if (!bdfDone) {
      if (!bdfFile) {
        showToast('Module Unit BDF 파일을 업로드해주세요.', 'warning');
        setActiveIdx(0);
        return;
      }
      handleValidate();
      return;
    }
    setActiveIdx(1);
    showToast('정반 상부 Module Unit 배치 설정 단계로 이동합니다.', 'info');
  };

  // ── 전체 초기화 ──────────────────────────────────────────
  const handleReset = () => {
    if (validJobId) clearGlobalJob?.(validJobId);
    setBdfFile(null);
    setValidating(false);
    setValidJobId(null);
    setValidProgress(0);
    setValidStatusMsg('');
    setStep1Data(null);
    setStep2Data(null);
    resetViewerModel();
    setBdfPath(null);
    setBdfAnalysisId(null);
    setWeldResult(null);
    setSteps(INITIAL_STEPS);
    setActiveIdx(0);
    setUseNastran(false);
    setHasRunOnce(false);
    setDeckType(null);
    clearAnalysisPageState?.(MENU_NAME);
  };

  const activeStep       = steps[activeIdx];
  const isBdfStep        = activeStep?.id === 'bdf-validation';
  const isArrangeStep    = activeStep?.id === 'arrangement';
  const isStructuralStep = activeStep?.id === 'structural-run';
  const isWeldStep       = activeStep?.id === 'weld-assessment';

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="min-h-full xl:h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      <FileBasedPageBanner
        title="Module Unit 해상 운송 구조 해석"
        subtitle="정반에 적재된 Module Unit의 해상 운송 하중에 대한 구조 안전성과 용접부 강도를 검토합니다."
        icon={UploadCloud}
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-5 min-h-0 xl:flex-row">

        {/* ── Left Panel ── */}
        <div className="w-full flex flex-col gap-3 xl:w-96 xl:shrink-0">

          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

            {/* BDF 가 없을 때 진입 — Model Builder 로 이동 */}
            <button
              onClick={() => setCurrentMenu('HiTESS Model Builder')}
              className="w-full relative flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 hover:from-indigo-400 hover:via-indigo-500 hover:to-violet-600 active:scale-[0.995] text-white transition-all duration-200 cursor-pointer overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full pointer-events-none" />
              <div className="absolute -right-2 -bottom-6 w-16 h-16 bg-white/5 rounded-full pointer-events-none" />
              <div className="absolute left-3 top-2 w-1.5 h-1.5 rounded-full bg-white/40 pointer-events-none animate-pulse" />
              <div className="relative flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <UploadCloud size={22} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-semibold text-indigo-100 leading-tight tracking-wide">BDF 가 없다면?</p>
                  <p className="text-base font-black text-white leading-tight mt-0.5">CSV 로부터 시작하세요</p>
                  <p className="text-[10px] text-indigo-200 mt-0.5">HiTESS Model Builder 로 이동</p>
                </div>
              </div>
              <div className="relative w-9 h-9 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center transition-colors shrink-0">
                <ArrowRight size={18} className="text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">파이프라인</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3">
              {steps.map((step, idx) => {
                const StepIcon = step.icon;
                const cfg      = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.wait;
                const isActive = idx === activeIdx;
                const isLast   = idx === steps.length - 1;

                return (
                  <div key={step.id} className="flex items-stretch">
                    <div className="flex flex-col items-center w-7 shrink-0 pt-4">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${cfg.dot}`} />
                      {!isLast && (
                        <div className="flex-1 w-0.5 my-1 transition-colors duration-300 rounded-full bg-violet-400" />
                      )}
                    </div>

                    <div
                      className={`flex-1 mb-2 ml-2 rounded-xl border px-3.5 py-3 transition-all duration-200 cursor-pointer
                        ${step.status === 'disabled'
                          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-default'
                          : isActive
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      onClick={() => step.status !== 'disabled' && setActiveIdx(idx)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <StepIcon size={13} className={`shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                          <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                            {idx + 1}. {step.title}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap ${cfg.badge}`}>
                          {step.status === 'disabled' ? '비활성' : isActive && step.status === 'wait' ? '선택됨' : cfg.label}
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
              <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                useNastran ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
              }`}>
                <p className={`text-xs font-bold ${useNastran ? 'text-blue-700' : 'text-slate-500'}`}>
                  Nastran을 통한 BDF 입력 검증
                </p>
                <Toggle checked={useNastran} onChange={setUseNastran} />
              </div>

              {activeIdx < steps.length - 1 && (
                <button
                  onClick={() => setActiveIdx(prev => Math.min(prev + 1, steps.length - 1))}
                  disabled={!hasRunOnce}
                  title={!hasRunOnce ? 'BDF 입력 검증 완료 후 활성화됩니다' : `다음 단계: ${steps[activeIdx + 1].title}`}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition-colors ${
                    hasRunOnce
                      ? 'bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-600 cursor-pointer'
                      : 'bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <span className="truncate">다음 단계: {steps[activeIdx + 1].title}</span>
                  <ArrowRight size={13} className="shrink-0" />
                </button>
              )}

              {/* 샘플 실행 — 입력 BDF 없이도 학습용으로 즉시 검증 체험 */}
              <SampleRunButton
                appKey="module-ocean-transport"
                disabled={validating}
                onBeforeRun={sampleBefore}
                onJobSubmitted={sampleSubmitted}
                onError={sampleError}
              />

              <button
                onClick={handleRun}
                disabled={validating}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-blue-dark active:bg-brand-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                {validating
                  ? <><Loader2 size={15} className="animate-spin" /> BDF 검증 중...</>
                  : <><ChevronsRight size={16} /> 해상 운송 구조 해석 수행</>
                }
              </button>

              <button
                onClick={handleReset}
                disabled={validating}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>
        </div>{/* end Left Panel */}

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">

          {/* ─ Step 1: Module Unit BDF 입력 검증 ─ */}
          {isBdfStep && (
            <>
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-700">1. Module Unit BDF 입력 검증</h2>
                  <span className="text-[10px] text-slate-400">— BDF 파일 업로드 및 유효성 검증</span>
                </div>
                <div className="p-4">
                  <BdfDropZone
                    file={bdfFile}
                    onFile={f => { setBdfFile(f); setStep1Data(null); setStep2Data(null); resetViewerModel(); setStepStatus('bdf-validation', 'wait'); }}
                    onClear={() => { setBdfFile(null); setStep1Data(null); setStep2Data(null); resetViewerModel(); setStepStatus('bdf-validation', 'wait'); }}
                    disabled={validating}
                  />
                </div>
              </div>

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
                      다음 단계 — 정반 상부 배치 설정 →
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {!validating && !step1Data && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                      <FileCheck2 size={32} className="text-slate-200" />
                      <div>
                        <p className="text-sm font-semibold text-slate-400">Module Unit BDF 파일을 업로드하고 검증을 실행하세요</p>
                        <p className="text-[11px] text-slate-300 mt-1">GRID, ELEMENT, SPC 카드를 파싱하여 오류 유무를 확인합니다.</p>
                      </div>
                    </div>
                  )}

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

          {/* ─ Step 2-0: 정반 타입 선택 (타입을 고르기 전까지 배치 화면을 열지 않는다) ─ */}
          {isArrangeStep && !deckType && (
            <div className="flex-1 min-h-0 flex flex-col">
              <JungbanDeckSelector
                selected={deckType}
                onSelect={handleSelectDeckType}
                deckModelCache={jungbanModelCache}
              />
            </div>
          )}

          {/* ─ Step 2: 정반 상부 Module Unit 배치 설정 ─ */}
          {isArrangeStep && deckType && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* 최소 높이는 '카드'에 준다. 안쪽 캔버스 래퍼에 주면 카드보다 커져서
                  overflow-hidden 에 잘리고, 뷰어 우하단 오버레이가 사라진다.
                  카드에 주면 세로가 부족할 때 <main> 이 스크롤될 뿐 잘리지 않는다. */}
              <div className="flex-1 min-h-[440px] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-xs font-bold text-slate-700 shrink-0">2. 정반 상부 Module Unit 배치 설정</h2>
                    {/* 어떤 정반을 쓰는 중인지 항상 보이게 하고, 여기서 바로 다시 고를 수 있게 한다. */}
                    <button
                      type="button"
                      onClick={() => setDeckType(null)}
                      title="정반 타입 다시 선택"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold transition-colors cursor-pointer shrink-0"
                    >
                      <Layers size={10} /> {deckType} 타입 정반
                      <span className="text-blue-400 font-semibold">변경</span>
                    </button>
                  </div>
                  {bdfFolderPath && (
                    <span className="text-[10px] font-mono text-slate-400 truncate max-w-[280px]" title={bdfFolderPath}>
                      {bdfFolderPath}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-h-0">
                  {/* 정반은 프로그램 내장 고정 모델이라 Module Unit 유무와 무관하게 항상 띄운다. */}
                  <FeModelViewer
                    parts={viewerParts}
                    loading={viewerStatus === 'loading'}
                    loadingLabel={
                      jungbanModel
                        ? 'Module Unit 모델을 불러오는 중...'
                        : `${deckType} 타입 정반 모델을 불러오는 중...`
                    }
                    error={viewerStatus === 'error' ? viewerError : null}
                    errorAction={(
                      <button
                        onClick={() => setViewerReloadToken(t => t + 1)}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        <RotateCcw size={11} /> 다시 시도
                      </button>
                    )}
                    overlay={!moduleModel && viewerStatus !== 'loading' && !viewerError ? (
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
                        <div className="rounded-xl border border-amber-400/40 bg-slate-900/85 backdrop-blur px-4 py-3 text-center max-w-md">
                          <p className="text-xs font-bold text-amber-200">Module Unit 모델이 아직 없습니다</p>
                          <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                            현재 화면은 내장 정반 모델만 표시하고 있습니다.
                            1단계에서 Module Unit BDF 검증을 완료하면 정반 상면 기준 위치에 자동으로 배치됩니다.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  />
                </div>
              </div>

              <ArrangementPanel
                gapMm={arrangement.gapMm}
                offsetXMm={arrangement.offsetXMm}
                offsetYMm={arrangement.offsetYMm}
                rotationZDeg={arrangement.rotationZDeg}
                placement={placement}
                disabled={!moduleModel}
                onChange={(patch) => setArrangement(prev => ({ ...prev, ...patch }))}
                onReset={() => setArrangement({
                  gapMm: DEFAULT_DECK_GAP_MM, offsetXMm: 0, offsetYMm: 0, rotationZDeg: 0,
                })}
              />
            </div>
          )}

          {/* ─ Step 3: Module Unit 구조 해석 수행 ─ */}
          {isStructuralStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                <h2 className="text-xs font-bold text-slate-700">3. Module Unit 구조 해석 수행</h2>
                <span className="text-[10px] text-slate-400">— 해상 운송 하중 조건 구조 해석</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <StepPlaceholder
                  icon={Waves}
                  title="구조 해석 실행 단계 (구성 예정)"
                  description="배치가 확정된 통합 모델에 해상 운송 하중 조건을 적용하고 Nastran 구조 해석을 수행하는 단계입니다."
                  todos={[
                    '해상 운송 가속도 하중 조건 입력 (선체 가속도 연계 가능)',
                    'Load Case 구성 및 해석 요청/진행률 표시',
                    'F06 진단 메시지 수집 및 응력 결과 요약',
                    '해석 산출물(BDF · F06 · OP2) 다운로드',
                  ]}
                />
              </div>
            </div>
          )}

          {/* ─ Step 4: 용접부 강도 평가 수행 ─ */}
          {isWeldStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">4. 용접부 강도 평가</span>
                  {weldResult && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      weldResult.status === 'PASS'
                        ? 'bg-green-50 text-green-600 border-green-200'
                        : 'bg-red-50 text-red-600 border-red-200'
                    }`}>
                      {weldResult.status}
                    </span>
                  )}
                </div>
                <button
                  disabled
                  title="결과 산출 후 활성화됩니다"
                  className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                >
                  <Download size={10} /> Excel 다운로드
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <StepPlaceholder
                  icon={ShieldCheck}
                  title="용접부 강도 평가 단계 (구성 예정)"
                  description="구조 해석 결과로부터 고박·접합 용접부에 작용하는 하중을 산출하고 허용 응력 대비 강도를 판정하는 단계입니다."
                  todos={[
                    '평가 대상 용접부 정의 (각장 · 용접 길이 · 재질)',
                    '해석 결과로부터 용접부 작용 하중 추출',
                    '허용 응력 대비 사용률(Usage) 산출 및 PASS/FAIL 판정',
                    '평가 결과 표 및 Excel 내보내기',
                  ]}
                />
              </div>
            </div>
          )}

        </div>{/* end Right Panel */}
      </div>

      {/* 개발 진행 안내 — 전체 틀만 구성된 상태임을 명시 */}
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
        <ExternalLink size={13} className="mt-0.5 shrink-0 text-amber-500" />
        <p className="text-[11px] leading-relaxed text-amber-800">
          이 App 은 현재 개발 진행 중입니다. <b>1단계 BDF 입력 검증</b>과 <b>2단계 배치 뷰어</b>는 동작하며,
          배치 결과를 해석 모델로 병합하는 부분과 3~4단계는 순차적으로 구현될 예정입니다.
        </p>
      </div>
    </div>
  );
}
