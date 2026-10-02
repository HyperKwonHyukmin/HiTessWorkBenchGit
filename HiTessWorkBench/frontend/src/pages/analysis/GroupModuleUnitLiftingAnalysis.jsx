import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  UploadCloud, ChevronsRight, FileCheck2, MapPin, BarChart3, X, CheckCircle2, Loader2,
  FileText, ExternalLink, FilePlus2, RefreshCw, Wand2, Info,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { usePolling } from '../../hooks/usePolling';
import {
  requestGroupModuleUnit, requestGroupModuleUnitFromPath, downloadFileText,
  getAnalysisById, getGroupModuleUnitArtifacts,
} from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import { API_BASE_URL } from '../../config';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import ResultArtifactsCard from '../../components/analysis/ResultArtifactsCard';
import {
  StepRail, InputSummary, VerdictHeader, KeyFigures, NextActionBar, JobProgressCard, EngineLogPanel, StudioLauncherCard,
  RunStartPanel,
} from '../../components/analysis/runFrame';
import { notifyStudioSourceUpdated } from '../../utils/studioSourceNotice';
import { useDashboardFileHandoff, useDashboardAutoRun } from '../../utils/dashboardFileHandoff';
import { useResultReentry } from '../../utils/resultReentry';
import { buildStructuralResult, computeGmuVerdict } from '../../utils/gmuLiftingVerdict';

const MODULE_STUDIO_VIEWER_ID = 'module-unit-studio';
const MODULE_STUDIO_VERSION = '0.0.166';
// 다른 App 이 넘긴 BDF 는 fresh-entry 재마운트가 끝난 뒤 살아남은 인스턴스에만 적용한다.
const HANDOFF_APPLY_DELAY_MS = 60;
const GMU_MENU_NAME = 'Group & Module Unit 권상 구조 해석';

/* ── 작업 단계 — 상태는 저장하지 않고 실제 사건(검증 결과·Studio 열기·구조 해석 완료·산출물 받기)에서 매번 계산한다 ── */
const STEP_DEFS = [
  { id: 'input',   title: 'BDF 입력 검증', icon: FileCheck2 },
  { id: 'studio',  title: 'Studio 권상 검토', icon: MapPin },
  { id: 'results', title: '결과·보고서', icon: BarChart3 },
];
const STEP_INDEX = Object.fromEntries(STEP_DEFS.map((s, i) => [s.id, i]));

const fmtKB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '');

/* ── BDF 드롭 칸 — Model Builder CsvDropZone 과 같은 모양(머리 줄 + 본문 버튼) ── */
function BdfDropZone({ file, onFile, onClear, disabled, onWarnNotBdf }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const take = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.bdf')) { onWarnNotBdf?.(); return; }
    onFile(f);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span className="text-xs font-bold text-slate-800">모델 BDF</span>
          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">필수</span>
        </div>
        {file && !disabled && (
          <button
            type="button"
            onClick={onClear}
            aria-label="BDF 파일 제거"
            className="shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {file ? (
        <div className="flex items-center gap-2 px-3 py-3">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="min-w-0 truncate text-sm font-semibold text-slate-800" title={file.name}>{file.name}</p>
          <span className="shrink-0 text-xs text-slate-600">{fmtKB(file.size)}</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) take(e.dataTransfer.files[0]); }}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`flex w-full flex-col items-center justify-center gap-1 py-6 text-center transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50
            disabled:cursor-not-allowed disabled:opacity-60
            ${dragOver ? 'bg-blue-50' : 'hover:bg-slate-50 cursor-pointer'}`}
        >
          <UploadCloud size={18} className="text-slate-500" aria-hidden="true" />
          <span className="text-xs text-slate-600">
            .bdf 파일을 놓거나 <span className="font-semibold text-blue-700">눌러서 선택</span>
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".bdf"
        className="hidden"
        tabIndex={-1}
        onChange={e => { take(e.target.files[0]); e.target.value = ''; }}
      />
    </div>
  );
}

/* ── 구조 해석 결과 — 판정 문구는 VerdictHeader 가 말하고, 여기는 수치·경고만 ── */
function StructuralResultPanel({ result }) {
  const [showWarnings, setShowWarnings] = useState(false);
  if (!result || result.status === 'ERROR') return null;
  const s = result.summary ?? {};
  const n = (v) => Number(v || 0);
  const warnings = result.warnings ?? [];
  const allowable = result.items?.[0]?.allowable;
  return (
    <section className="space-y-2" aria-label="구조 해석 결과">
      <KeyFigures
        items={[
          { key: 'stress', label: '최대 부재 응력', value: n(s.memberMaxStressMPa).toFixed(1), unit: 'MPa',
            sub: allowable && allowable !== '—' ? `허용 ${allowable}` : null, tone: n(s.memberExceedCount) > 0 ? 'bad' : 'default' },
          { key: 'exceed', label: '응력 초과 부재', value: n(s.memberExceedCount).toLocaleString(),
            sub: `전체 ${n(s.memberElementCount).toLocaleString()}개`, tone: n(s.memberExceedCount) > 0 ? 'bad' : 'default' },
          { key: 'wire', label: 'Wire 압축', value: n(s.wireCompressionCount).toLocaleString(),
            sub: `Wire ${n(s.wireCount)}개`, tone: n(s.wireCompressionCount) > 0 ? 'bad' : 'default' },
          { key: 'missing', label: 'Wire 결과 누락', value: n(s.wireMissingResultCount).toLocaleString(),
            tone: n(s.wireMissingResultCount) > 0 ? 'bad' : 'default' },
        ]}
        caption="Studio 에서 실행한 Nastran SOL 101 결과입니다. 부재별 응력·변위는 Studio 결과 도크에서 봅니다."
      />
      {warnings.length > 0 && (
        <div className="rounded-lg border border-slate-200">
          <button
            type="button"
            aria-expanded={showWarnings}
            onClick={() => setShowWarnings(v => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <Info size={14} className="text-amber-600" aria-hidden="true" />
            해석 경고 {warnings.length}건
            <span className="ml-auto text-xs font-normal text-slate-600">{showWarnings ? '접기' : '펼치기'}</span>
          </button>
          {showWarnings && (
            <ul className="space-y-1 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-700">
              {warnings.map((w, i) => (
                <li key={i} className="list-inside list-disc">{typeof w === 'string' ? w : w?.message ?? JSON.stringify(w)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function GroupModuleUnitLiftingAnalysis() {
  const { setCurrentMenu, currentMenu } = useNavigation();
  const {
    gmuHandoff, clearGmuHandoff, startGlobalJob, clearGlobalJob, getJobForMenu,
    analysisPageStates, setAnalysisPageState, clearAnalysisPageState,
  } = useDashboard();
  const savedPageState = analysisPageStates?.[GMU_MENU_NAME] || {};
  // 다른 App 해석이 더 최근이어도 이 App 의 해석을 집어야 한다(globalJob 은 최신 1개일 뿐).
  const gmuJob = getJobForMenu?.(GMU_MENU_NAME) || null;
  const { showToast } = useToast();

  // 옛 페이지 상태(단계 id: bdf-validation/lifting-points/results)도 활성 단계 번호는 같은 자리라 그대로 쓴다.
  const [activeIdx, setActiveIdx] = useState(Math.min(savedPageState.activeIdx ?? 0, STEP_DEFS.length - 1));

  // ── 1단계: BDF 입력 검증 ─────────────────────────────────
  const [bdfFile, setBdfFile]             = useState(savedPageState.bdfFile ?? null);
  const [validating, setValidating]       = useState(savedPageState.validating ?? false);
  const [validJobId, setValidJobId]       = useState(savedPageState.validJobId ?? null);
  const [validProgress, setValidProgress] = useState(savedPageState.validProgress ?? 0);
  const [validStatusMsg, setValidStatusMsg] = useState(savedPageState.validStatusMsg ?? '');
  const [validStartedAt, setValidStartedAt] = useState(savedPageState.validStartedAt ?? null);
  const [validFailed, setValidFailed]     = useState(savedPageState.validFailed ?? false);
  const [engineLog, setEngineLog]         = useState(savedPageState.engineLog ?? null);
  const [step1Data, setStep1Data]         = useState(savedPageState.step1Data ?? null);
  const [step2Data, setStep2Data]         = useState(savedPageState.step2Data ?? null);
  // Nastran 을 통한 BDF 입력 검증은 기본 OFF — 필요 시 사용자가 켠다.
  const [useNastran, setUseNastran]       = useState(savedPageState.useNastran ?? false);
  // 검증할 때 실제로 쓴 Nastran 설정 — 결과 화면은 지금 토글이 아니라 이 값으로 그린다.
  const [validatedWithNastran, setValidatedWithNastran] = useState(savedPageState.validatedWithNastran ?? false);

  // ── 2단계: Studio ───────────────────────────────────────
  const [bdfPath, setBdfPath]             = useState(savedPageState.bdfPath ?? null);
  // BDF 검증 시 생성된 GroupModuleUnit Analysis.id (DB record).
  // viewer:open 시 main 으로 전달 → main 이 viewer:runUnitStructural 호출 시 백엔드 parent_analysis_id 로 사용.
  const [bdfAnalysisId, setBdfAnalysisId] = useState(savedPageState.bdfAnalysisId ?? null);
  // Studio 창을 이 BDF 로 열었는가 — 단계 레일 '진행 중' 표시용(완료는 구조 해석 이벤트만 정한다).
  const [studioOpened, setStudioOpened]   = useState(savedPageState.studioOpened ?? false);
  const [studioStatus, setStudioStatus]   = useState('idle'); // idle | checking | installing | opening | error
  const [studioInstalled, setStudioInstalled] = useState(null); // null=확인 전, true/false=결과
  const [studioProgress, setStudioProgress] = useState(null);
  const [studioError, setStudioError]     = useState(null);
  const [studioInstalledVersion, setStudioInstalledVersion] = useState(null);
  const [studioLatestVersion, setStudioLatestVersion] = useState(MODULE_STUDIO_VERSION);
  // 최신 studioStatus 를 async 콜백에서 stale 없이 읽기 위한 ref (설치/열기 중 재확인 차단용)
  const studioStatusRef = useRef('idle');
  useEffect(() => { studioStatusRef.current = studioStatus; }, [studioStatus]);
  // 버전 재확인 run 토큰 — 페이지를 빠르게 여러 번 열어 중첩 실행돼도 '가장 최신' 결과만 반영한다.
  const studioCheckRunRef = useRef(0);
  const studioMountedRef = useRef(true);
  // ⚠️ StrictMode(dev) 는 mount 시 effect 를 setup→cleanup→setup 으로 이중 실행한다.
  //    setup 에서 반드시 true 로 복구해야, cleanup 이 false 로 만든 뒤에도 최종 상태가 true 로 남는다.
  useEffect(() => {
    studioMountedRef.current = true;
    return () => { studioMountedRef.current = false; };
  }, []);

  // ── 3단계: 결과 ─────────────────────────────────────────
  const [analysisResult, setAnalysisResult] = useState(savedPageState.analysisResult ?? null);
  // 산출물·보고서를 실제로 받았는가 — 3단계 완료 조건.
  const [delivered, setDelivered]         = useState(savedPageState.delivered ?? false);

  // ── 연계 진입 ───────────────────────────────────────────
  const [handoffSource, setHandoffSource] = useState(savedPageState.handoffSource ?? null); // 프로그램 간 연계로 진입한 경우 출처 앱 이름
  const [handoffBdfPath, setHandoffBdfPath] = useState(savedPageState.handoffBdfPath ?? null);
  // 핸드오프로 파이프라인을 초기화한 시점에 돌고 있던 이전 검증 작업의 jobId.
  // globalJob 복원 effect 가 그 작업으로 화면을 '검증 중' 으로 되돌리지 못하게 막는다.
  const ignoredJobIdRef = useRef(null);

  const bdfFolderPath = useMemo(
    () => bdfPath ? bdfPath.replace(/[/\\][^/\\]+$/, '') : null,
    [bdfPath]
  );

  // 경과 시간(진행 카드용)
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!validating) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [validating]);
  const elapsedSecs = validating && validStartedAt ? Math.max(0, Math.round((nowTick - validStartedAt) / 1000)) : null;

  /** 새 입력을 받을 때 이전 검증·Studio·결과를 모두 비운다. */
  const clearResults = () => {
    setStep1Data(null);
    setStep2Data(null);
    setValidFailed(false);
    setEngineLog(null);
    setBdfPath(null);
    setBdfAnalysisId(null);
    setStudioOpened(false);
    setAnalysisResult(null);
    setDelivered(false);
  };

  /** 검증 결과(result_info)로 화면을 채운다 — 방금 끝난 검증과 지난 결과 다시 열기가 함께 쓴다. */
  const applyValidationResult = async (resultInfo, analysisId) => {
    if (resultInfo.bdf) setBdfPath(resultInfo.bdf);
    if (typeof analysisId === 'number') setBdfAnalysisId(analysisId);
    let s1 = null, s2 = null;
    await Promise.allSettled(
      [['JSON_Validation', (v) => { s1 = v; }], ['JSON_F06Summary', (v) => { s2 = v; }]].map(async ([key, set]) => {
        const p = resultInfo[key];
        if (!p || typeof p !== 'string') return;
        const res = await downloadFileText(p);
        set(JSON.parse(res.data));
      })
    );
    setStep1Data(s1);
    setStep2Data(s2);
    setValidatedWithNastran(!!resultInfo.use_nastran || !!s2);
    return s1;
  };

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
      const resultInfo = data.project?.result_info;
      if (!resultInfo) {
        setValidFailed(true);
        showToast('결과 파일을 찾을 수 없습니다.', 'error');
        return;
      }
      // 새 BDF 로 검증이 끝났다 — 이전 모델로 열려 있는 Module Unit Studio 창에 경고를 띄운다.
      // (Studio 가 안 떠 있거나 같은 모델이면 main 이 무시한다.)
      notifyStudioSourceUpdated(
        MODULE_STUDIO_VIEWER_ID,
        resultInfo.bdf ?? null,
        '워크벤치에서 새 BDF 가 검증됐습니다. 이 창은 이전 모델을 보고 있습니다 — WorkBench 에서 Studio 를 다시 여세요.',
      );
      const s1 = await applyValidationResult(resultInfo, data.project?.id);
      const v = computeGmuVerdict({ step1Data: s1, step2Data: null });
      // 공통 틀 규칙: 실행이 끝나면 다음 단계로 이동한다. 검증이 실패면 원인을 볼 수 있게 1단계에 남는다.
      if (v.level && v.level !== 'fail') setActiveIdx(STEP_INDEX.studio);
      showToast(v.level === 'fail' ? 'BDF 검증 — 오류 발견' : 'BDF 검증 완료', v.level === 'fail' ? 'warning' : 'success');
    },
    onError: (errData) => {
      setValidating(false);
      setValidJobId(null);
      setValidFailed(true);
      setEngineLog(errData?.engine_log || errData?.message || null);
      showToast(errData?.timeout ? '검증 시간 초과' : 'BDF 검증 실패', 'error');
    },
  });

  // 대시보드 '새 해석 시작'에 놓은 BDF 를 이어받는다(업로드 칸의 onFile 과 같은 처리)
  useDashboardFileHandoff(GMU_MENU_NAME, (f) => {
    setBdfFile(f); clearResults(); setActiveIdx(0);
  }, ['.bdf']);

  // Studio 창을 열었다는 사실이 아니라 실제 SOL 101 완료 이벤트로 2단계를 끝낸다.
  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    return window.electron.onMessage('viewer:unit-structural-completed', (payload) => {
      if (payload?.viewerId !== MODULE_STUDIO_VIEWER_ID) return;
      if (bdfAnalysisId && payload?.parentAnalysisId && Number(payload.parentAnalysisId) !== Number(bdfAnalysisId)) return;
      if (payload.ok) {
        setAnalysisResult(payload);
        setDelivered(false);
        setActiveIdx(STEP_INDEX.results);
        showToast(`Studio 구조 해석 완료 — ${payload.status}`, payload.status === 'PASS' ? 'success' : 'warning');
      } else {
        setAnalysisResult({ status: 'ERROR', items: [], error: payload.error });
        showToast(`Studio 구조 해석 실패 — ${payload.error || '알 수 없는 오류'}`, 'error');
      }
    });
  }, [bdfAnalysisId, showToast]);

  useEffect(() => {
    setAnalysisPageState?.(GMU_MENU_NAME, {
      activeIdx, bdfFile, validating, validJobId, validProgress, validStatusMsg, validStartedAt,
      validFailed, engineLog, step1Data, step2Data, useNastran, validatedWithNastran,
      bdfPath, bdfAnalysisId, studioOpened, analysisResult, delivered, handoffSource, handoffBdfPath,
    });
  }, [
    setAnalysisPageState, activeIdx, bdfFile, validating, validJobId, validProgress, validStatusMsg, validStartedAt,
    validFailed, engineLog, step1Data, step2Data, useNastran, validatedWithNastran,
    bdfPath, bdfAnalysisId, studioOpened, analysisResult, delivered, handoffSource, handoffBdfPath,
  ]);

  useEffect(() => {
    if (!gmuJob) return;
    if (gmuJob.status !== 'Running' && gmuJob.status !== 'Pending') return;
    // 핸드오프로 새 BDF 를 받아 파이프라인을 리셋했다면, 그 직전에 돌던 작업으로
    // 화면을 되돌리지 않는다(새 입력인데 이전 작업의 '검증 중' 이 뜨는 것 방지).
    if (ignoredJobIdRef.current && gmuJob.jobId === ignoredJobIdRef.current) return;
    setValidJobId(prev => prev || gmuJob.jobId);
    setValidating(true);
    setValidStartedAt(prev => prev || Date.now());
    setValidProgress(gmuJob.progress ?? 0);
    setValidStatusMsg(gmuJob.message ?? '서버 처리 중...');
  }, [gmuJob?.jobId, gmuJob?.status, gmuJob?.progress, gmuJob?.message]);

  // ── Studio 설치본/서버 최신 버전 재확인 ──────────────────────────
  // 로컬 설치본 버전(viewer:check-installed) + 서버 최신 배포 버전(manifest)을 동시에 조회한다.
  // 서버 manifest 는 HTTP 캐시를 우회(cache:'no-store')해 매번 최신을 읽는다 — 새 Studio 배포가
  // 즉시 반영되도록. 설치/열기 진행 중에는 상태를 덮어쓰지 않도록 재확인을 건너뛴다.
  const refreshStudioVersion = useCallback(async () => {
    if (studioStatusRef.current === 'installing' || studioStatusRef.current === 'opening') return;

    const runId = ++studioCheckRunRef.current;
    // 중첩 실행/언마운트 시 오래된 결과가 최신 상태를 덮어쓰지 않도록 가드.
    const stale = () => runId !== studioCheckRunRef.current || !studioMountedRef.current;

    const checkInstalled = (async () => {
      if (!window.electron?.invoke) {
        if (!stale()) {
          setStudioInstalled(false);
          setStudioError('Electron 환경에서만 Studio 설치/실행을 확인할 수 있습니다.');
        }
        return;
      }
      setStudioStatus('checking');
      try {
        const r = await window.electron.invoke('viewer:check-installed', MODULE_STUDIO_VIEWER_ID);
        if (stale()) return;
        setStudioInstalled(r === null ? false : !!r?.installed);
        setStudioInstalledVersion(r?.manifest?.version ?? null);
      } catch (e) {
        if (stale()) return;
        setStudioInstalled(false);
        setStudioInstalledVersion(null);
        setStudioError(e?.message || 'Studio 설치 상태 확인 실패');
      } finally {
        if (!stale() && studioStatusRef.current !== 'installing' && studioStatusRef.current !== 'opening') {
          setStudioStatus('idle');
        }
      }
    })();

    const checkLatest = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/viewers/manifest/${MODULE_STUDIO_VIEWER_ID}`, { cache: 'no-store' });
        const meta = res.ok ? await res.json() : null;
        if (stale()) return;
        setStudioLatestVersion(meta?.manifest?.version ?? MODULE_STUDIO_VERSION);
      } catch { /* 서버 미접속 — 기존 값 유지 */ }
    })();

    await Promise.allSettled([checkInstalled, checkLatest]);
  }, []);

  // 이 페이지는 keep-alive(네비게이션 시 unmount 되지 않음)라 mount effect 는 앱 세션당 1회만 돈다.
  // → currentMenu 가 이 페이지로 올 때마다(=페이지를 열 때마다) 버전을 재확인해, 새 Studio 배포가
  //    Electron 재시작 없이 곧바로 '업데이트' 배지에 반영되게 한다.
  useEffect(() => {
    if (currentMenu === GMU_MENU_NAME) refreshStudioVersion();
  }, [currentMenu, refreshStudioVersion]);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    const unsub = window.electron.onMessage('viewer:install-progress', (data) => {
      if (!data || data.viewerId !== MODULE_STUDIO_VIEWER_ID) return;
      setStudioProgress(data);
    });
    return () => { try { unsub?.(); } catch { /* 이미 해제됨 */ } };
  }, []);

  const launchModuleUnitStudio = useCallback(async () => {
    if (!window.electron?.invoke) {
      showToast('Electron 환경에서만 Studio를 사용할 수 있습니다.', 'error');
      return;
    }
    if (!bdfFolderPath) {
      showToast('먼저 BDF 입력 검증을 완료하세요.', 'warning');
      setActiveIdx(0);
      return;
    }

    setStudioError(null);
    try {
      setStudioStatus('checking');
      const check = await window.electron.invoke('viewer:check-installed', MODULE_STUDIO_VIEWER_ID);
      if (check === null) throw new Error('IPC viewer:check-installed 미등록');

      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${MODULE_STUDIO_VIEWER_ID}`, { cache: 'no-store' });
      if (!manifestRes.ok) throw new Error(`manifest 조회 실패: HTTP ${manifestRes.status}`);
      const meta = await manifestRes.json();
      const serverVer = meta?.manifest?.version ?? MODULE_STUDIO_VERSION;
      const localVer = check?.manifest?.version ?? null;
      setStudioInstalled(!!check?.installed);
      setStudioInstalledVersion(localVer);
      setStudioLatestVersion(serverVer);

      const needInstall = !check?.installed || (serverVer && localVer && serverVer !== localVer);
      if (needInstall) {
        const reason = !check?.installed
          ? 'ModuleUnitStudio 미설치 — 다운로드 시작'
          : `ModuleUnitStudio 업데이트 (v${localVer} → v${serverVer})`;
        showToast(reason, 'info');
        setStudioStatus('installing');
        const installRes = await window.electron.invoke('viewer:install', {
          viewerId: MODULE_STUDIO_VIEWER_ID,
          downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`,
          uncPath: meta.uncPath,
          expectedSha256: meta.sha256,
        });
        if (installRes === null) throw new Error('IPC viewer:install 미등록');
        if (!installRes?.ok) throw new Error(installRes?.error || 'Studio 설치 실패');
        setStudioInstalled(true);
        setStudioInstalledVersion(installRes?.manifest?.version ?? serverVer);
        setStudioLatestVersion(serverVer);
      }

      let initialFolder = bdfFolderPath;
      const access = await window.electron.invoke('viewer:checkPathAccess', { path: bdfFolderPath });
      if (!access?.accessible) {
        showToast('Studio 입력 폴더 다운로드 중...', 'info');
        const params = new URLSearchParams({ output_dir: bdfFolderPath });
        const token = localStorage.getItem('session_token');
        const fetchRes = await window.electron.invoke('viewer:fetchResultDir', {
          downloadUrl: `${API_BASE_URL}/api/analysis/modelflow/result-zip?${params}`,
          jobId: bdfFolderPath.split(/[\\/]/).pop(),
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (fetchRes === null) throw new Error('IPC viewer:fetchResultDir 미등록');
        if (!fetchRes?.ok) throw new Error(fetchRes?.error || 'Studio 입력 폴더 다운로드 실패');
        initialFolder = fetchRes.dir;
      }

      setStudioStatus('opening');
      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: MODULE_STUDIO_VIEWER_ID,
        initialFolder,
        parentAnalysisId: bdfAnalysisId,
        serverUrl: API_BASE_URL,
        // 이 창이 보고 있는 원본 모델 식별자. 이후 새 BDF 가 검증되면 main 이 이 값과 비교해
        // 열려 있는 Studio 에 "원본이 갱신됨" 배너를 띄운다.
        sourceKey: bdfPath ?? null,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      // 창을 연 것만으로 완료 처리하지 않는다. 실제 SOL 101 완료 이벤트가 2단계를 끝낸다.
      setStudioOpened(true);
      setStudioStatus('idle');
    } catch (e) {
      setStudioError(e.message);
      setStudioStatus('error');
      showToast(`ModuleUnitStudio 실행 실패 — ${e.message}`, 'error');
    }
  }, [bdfFolderPath, bdfPath, bdfAnalysisId, showToast]);

  // ── 프로그램 간 연계 핸드오프 처리 ───────────────────────────
  // ⚠️ 이 페이지는 keep-alive 라 한 번 열면 unmount 되지 않는다(App.jsx KEEP_ALIVE_MENUS).
  //    그래서 마운트 1회 전용([])이 아니라 핸드오프 값 자체를 의존성으로 삼아 도착할 때마다 수신한다.
  //    ⚠️ 적용은 HANDOFF_APPLY_DELAY_MS 만큼 미루고 언마운트 시 취소한다. 다른 App 에서
  //    setCurrentMenu 로 들어오면 fresh-entry 처리(App.jsx 인스턴스 키 증가)로 이 페이지가
  //    같은 틱에 재마운트되는데, 바로 적용하면 첫 인스턴스가 BDF 를 받고 clearGmuHandoff() 한 뒤
  //    폐기돼 최종 화면은 입력이 빈 채로 남는다. 미루면 살아남은 인스턴스 하나에만 적용된다.
  useEffect(() => {
    if (!gmuHandoff?.bdfServerPath) return undefined;
    const timer = setTimeout(() => {
      const { bdfServerPath, sourceApp } = gmuHandoff;
      const from = sourceApp || '외부 프로그램';
      // 이미 이전 해석을 끝낸 상태일 수 있으므로 처음 상태로 되돌린 뒤 수신한다.
      ignoredJobIdRef.current = validJobId || gmuJob?.jobId || null;
      setActiveIdx(0);
      setValidating(false);
      setValidJobId(null);
      setValidProgress(0);
      setValidStatusMsg('');
      setBdfFile(null);
      clearResults();
      setHandoffSource(from);
      setHandoffBdfPath(bdfServerPath);
      clearGmuHandoff();
      showToast(`${from}에서 BDF를 전달받았습니다. 'BDF 검증 실행'을 누르세요.`, 'info');
    }, HANDOFF_APPLY_DELAY_MS);
    return () => clearTimeout(timer);
    // validJobId/gmuJob 은 '핸드오프 시점의 값'만 필요하므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmuHandoff, clearGmuHandoff, showToast]);

  /** 검증을 시작하는 공통 준비 — 직접 실행·샘플 실행이 같이 쓴다. */
  const beginValidation = (message) => {
    clearResults();
    setValidating(true);
    setValidProgress(0);
    setValidStatusMsg(message);
    setValidStartedAt(Date.now());
    setValidatedWithNastran(useNastran);
    setActiveIdx(0);
  };

  // ── BDF 검증 ─────────────────────────────────────────────
  const handleValidate = async () => {
    if (!bdfFile && !handoffBdfPath) return;
    beginValidation('서버 요청 중...');
    try {
      const userStr = localStorage.getItem('user');
      const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

      const formData = new FormData();
      formData.append('employee_id', employeeId);
      formData.append('use_nastran', String(useNastran));
      formData.append('source', 'Workbench');

      let res;
      if (handoffBdfPath) {
        formData.append('bdf_server_path', handoffBdfPath);
        res = await requestGroupModuleUnitFromPath(formData);
      } else {
        formData.append('bdf_file', bdfFile);
        res = await requestGroupModuleUnit(formData);
      }
      setValidJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, GMU_MENU_NAME);
    } catch (e) {
      console.error('[BDF 검증] 요청 실패:', e);
      setValidating(false);
      setValidJobId(null);
      setValidFailed(true);
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      showToast(`BDF 검증 요청 실패 — ${detail}`, 'error');
    }
  };

  // 대시보드에서 넘겨받은 파일로 입력이 갖춰지면 실행까지 바로 이어간다
  useDashboardAutoRun(GMU_MENU_NAME, (!validating && bdfFile) || null, handleValidate);

  // 샘플 실행 콜백 — SampleRunButton 이 호출. handleValidate 와 동일한 폴링 흐름에 진입.
  const sampleGmuBefore = () => beginValidation('샘플 파일로 작업 요청 중...');
  const sampleGmuSubmitted = (jobId) => {
    setValidJobId(jobId);
    startGlobalJob?.(jobId, GMU_MENU_NAME);
  };
  const sampleGmuError = (st, detail) => {
    setValidating(false);
    setValidJobId(null);
    if (st === 429) {
      setValidStatusMsg('');
    } else {
      setValidFailed(true);
      showToast(`샘플 실행 실패 — ${detail}`, 'error');
    }
  };

  // ── 새 입력으로 시작 ─────────────────────────────────────
  const handleReset = () => {
    if (validJobId) clearGlobalJob?.(validJobId);
    setBdfFile(null);
    setHandoffSource(null);
    setHandoffBdfPath(null);
    setValidating(false);
    setValidJobId(null);
    setValidProgress(0);
    setValidStatusMsg('');
    setValidStartedAt(null);
    clearResults();
    setStudioStatus('idle');
    setStudioProgress(null);
    setStudioError(null);
    setActiveIdx(0);
    setUseNastran(false);
    clearAnalysisPageState?.(GMU_MENU_NAME);
  };

  // ── 지난 결과 다시 열기(My Projects·대시보드 '내 작업') ─────────────
  // BDF 검증 기록(GroupModuleUnit)으로 1단계를 복원하고, 그 BDF 로 Studio 구조 해석까지 했다면
  // 최신 구조 해석 기록으로 결과까지 다시 계산한다(판정 규칙 = utils/gmuLiftingVerdict).
  const applyResultReentry = async (analysisId) => {
    try {
      const { data: rec } = await getAnalysisById(analysisId);
      if (rec.program_name !== 'GroupModuleUnit') throw new Error('권상 구조 해석 기록이 아닙니다.');
      if (rec.files_available === false) throw new Error('결과 파일이 보관 기간이 지나 삭제되었습니다.');
      const info = rec.result_info || {};
      if (!info.bdf) throw new Error('이 기록에는 검증한 BDF 정보가 없습니다.');

      handleReset();
      setUseNastran(!!(rec.input_info?.use_nastran ?? info.use_nastran));
      setHandoffSource('지난 결과');
      setHandoffBdfPath(info.bdf);
      const s1 = await applyValidationResult(info, rec.id);
      let structural = null;
      try {
        const { data: arts } = await getGroupModuleUnitArtifacts(rec.id);
        if (arts?.unitStructuralAnalysisId) {
          const { data: unit } = await getAnalysisById(arts.unitStructuralAnalysisId);
          const ui = unit.result_info || {};
          if (unit.status === 'Success' && ui.summary) {
            structural = buildStructuralResult({
              summary: ui.summary, warnings: ui.warnings, allowableMPa: ui.allowableMPa, analysisId: unit.id,
            });
          }
        }
      } catch { /* 구조 해석 기록이 없으면 검증 결과까지만 연다 */ }
      if (structural) {
        setAnalysisResult(structural);
        setStudioOpened(true);
        setActiveIdx(STEP_INDEX.results);
      } else {
        const v = computeGmuVerdict({ step1Data: s1 });
        setActiveIdx(v.level && v.level !== 'fail' ? STEP_INDEX.studio : 0);
      }
      const when = rec.created_at ? new Date(rec.created_at).toLocaleString('ko-KR') : '';
      showToast(`지난 결과를 열었습니다${when ? ` (${when})` : ''}.`, 'success');
    } catch (e) {
      showToast(`결과를 열지 못했습니다: ${e?.response?.data?.detail || e.message}`, 'error');
    }
  };
  useResultReentry(GMU_MENU_NAME, applyResultReentry);

  // ── 최근 실행의 입력 불러오기 ─────────────────────────────────────
  // 서버에 보관된 그 실행의 BDF 를 다시 올리지 않고 경로로 넘긴다(Model Builder 연계와 같은 request-from-path 경로).
  // 결과는 열지 않는다 — 옵션을 바꿔 '다시 검증'하려는 용도다.
  const applyRecentInput = (record) => {
    const bdfModel = record?.input_info?.bdf_model;
    if (!bdfModel) { showToast('이 실행에는 불러올 BDF 정보가 없습니다.', 'warning'); return; }
    handleReset();
    setUseNastran(!!record.input_info?.use_nastran);
    setHandoffSource('최근 실행');
    setHandoffBdfPath(bdfModel);
    showToast(`${baseName(bdfModel)} 을 입력으로 불러왔습니다. 'BDF 검증 실행'을 누르세요.`, 'info');
  };

  /* ── 파생 상태 ─────────────────────────────────────────────────── */
  const hasValidation = !!step1Data;
  const verdict = computeGmuVerdict({
    jobFailed: validFailed && !step1Data,
    step1Data,
    step2Data: validatedWithNastran ? step2Data : null,
    structural: analysisResult,
  });
  const validationVerdict = computeGmuVerdict({ step1Data, step2Data: validatedWithNastran ? step2Data : null, jobFailed: validFailed && !step1Data });
  const validationOk = !!validationVerdict.level && validationVerdict.level !== 'fail';
  const structuralLevel = analysisResult ? verdict.level : null;

  const displaySteps = STEP_DEFS.map((def) => {
    if (def.id === 'input') {
      if (validating) return { ...def, status: 'running', hint: '검증 중' };
      if (validationVerdict.level === 'fail') return { ...def, status: 'error', hint: '검증 실패' };
      if (validationVerdict.level === 'review') return { ...def, status: 'review', hint: '통과 · 분리 그룹 있음' };
      if (validationVerdict.level === 'pass') return { ...def, status: 'done', hint: '검증 통과' };
      return { ...def, status: 'wait' };
    }
    if (def.id === 'studio') {
      if (!validationOk) return { ...def, status: 'wait' };
      if (analysisResult?.status === 'ERROR') return { ...def, status: 'error', hint: '구조 해석 실패' };
      if (analysisResult) return { ...def, status: 'done', hint: '구조 해석 완료' };
      if (studioOpened) return { ...def, status: 'running', hint: 'Studio 에서 작업 중' };
      return { ...def, status: 'wait', hint: 'Studio 열기 전' };
    }
    if (!analysisResult || analysisResult.status === 'ERROR') return { ...def, status: 'wait' };
    if (delivered) return { ...def, status: 'done', hint: '산출물 받음' };
    const level = structuralLevel;
    return { ...def, status: level === 'pass' ? 'wait' : level === 'review' ? 'review' : 'error',
      hint: level === 'pass' ? '판정 통과 · 보고서 대기' : level === 'review' ? '검토 필요' : '불합격' };
  });
  const activeStep = displaySteps[activeIdx] ?? displaySteps[0];

  const inputName = bdfFile?.name || baseName(handoffBdfPath) || baseName(bdfPath);
  const inputItems = [{
    key: 'bdf', label: 'BDF', fileName: inputName || null,
    state: validationVerdict.level === 'fail' ? 'error' : validationVerdict.level === 'review' ? 'warn' : 'ok',
  }];

  /* ── 실행 버튼 — 검증 전 'BDF 검증 실행', 검증 후 '다시 검증' ───────── */
  const hasInput = !!(bdfFile || handoffBdfPath);
  const runAction = {
    label: hasValidation || validFailed ? 'BDF 다시 검증' : 'BDF 검증 실행',
    icon: hasValidation || validFailed ? RefreshCw : ChevronsRight,
    onClick: handleValidate,
    enabled: hasInput && !validating,
    title: hasValidation ? '같은 BDF 를 지금 설정으로 다시 검증합니다. Studio 결과는 지워집니다.' : undefined,
  };
  // Ctrl+Enter = 실행 버튼
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if (currentMenu !== GMU_MENU_NAME) return; // keep-alive 라 다른 화면에서도 살아 있다
      const a = runActionRef.current;
      if (!a.enabled) return;
      e.preventDefault();
      a.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentMenu]);

  /* ── 다음 행동 바 — 단계마다 주 행동 1개 ─────────────────────────── */
  const studioBusy = ['checking', 'installing', 'opening'].includes(studioStatus);
  const openStudioAction = {
    label: studioOpened ? 'Studio 다시 열기' : 'Studio 열기', icon: ExternalLink,
    onClick: launchModuleUnitStudio, busy: studioBusy,
  };
  const nextAction = (() => {
    if (validating) return null;
    if (activeStep.id === 'input') {
      if (validationOk) {
        return {
          note: '입력 검증이 끝났습니다. Studio 에서 권상 위치·자세 안정성·구조 해석을 진행합니다.',
          primary: { label: 'Studio 권상 검토로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.studio) },
        };
      }
      return null;
    }
    if (activeStep.id === 'studio') {
      if (!validationOk) {
        return {
          note: validationVerdict.level === 'fail' ? 'BDF 에 오류가 있어 Studio 로 넘길 수 없습니다.' : 'BDF 입력 검증을 먼저 마치세요.',
          primary: { label: '입력으로 돌아가기', icon: FileCheck2, onClick: () => setActiveIdx(0) },
        };
      }
      if (analysisResult && analysisResult.status !== 'ERROR') {
        return {
          note: '구조 해석 결과가 도착했습니다. 결과를 확인하고 보고서를 받으세요.',
          primary: { label: '결과·보고서로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.results) },
          secondary: [{ key: 'studio', ...openStudioAction, label: 'Studio 다시 열기' }],
        };
      }
      return {
        note: studioOpened
          ? 'Studio 에서 Hoist 탭 → 자세 안정성 → Analysis 탭 구조 해석까지 마치면 결과가 이 화면으로 옵니다.'
          : 'Studio 를 열어 권상 위치를 정하고 구조 해석을 실행하세요.',
        primary: openStudioAction,
      };
    }
    // 결과 단계
    if (!analysisResult) {
      return {
        note: '아직 구조 해석 결과가 없습니다. Studio 에서 구조 해석을 실행하세요.',
        primary: { label: 'Studio 권상 검토로', icon: ChevronsRight, onClick: () => setActiveIdx(STEP_INDEX.studio) },
      };
    }
    if (structuralLevel === 'pass') return null; // 보고서·산출물 버튼은 아래 카드에 있다
    return {
      note: structuralLevel === 'review'
        ? '경고를 확인하세요. 문제없다고 판단하면 그대로 보고서를 받을 수 있습니다.'
        : '권상 위치나 가서포트를 Studio 에서 보정한 뒤 구조 해석을 다시 실행하세요.',
      primary: { ...openStudioAction, label: 'Studio 에서 보정' },
    };
  })();

  const verdictSummary = verdict.basis === 'structural'
    ? (verdict.level === 'pass' ? '응력 초과 부재 0 · Wire 압축 0 · 해석 경고 0' : null)
    : verdict.level === 'pass'
      ? `BDF 오류 0 · 분리 그룹 0${validatedWithNastran ? ' · Nastran FATAL 0' : ''}`
      : verdict.level === 'review' ? 'BDF 는 쓸 수 있지만 아래 항목을 Studio 에서 확인하세요.' : null;
  // 첫 화면(입력 검증 단계 · 아직 아무것도 돌리지 않음) — 두 칸 높이를 맞추고 아래를 진행 순서·최근 실행으로 채운다.
  const isStartScreen = activeStep.id === 'input' && !hasValidation && !validating && !validFailed;
  const verdictMeta = verdict.basis === 'structural' ? '구조 해석 결과 기준' : verdict.basis === 'validation' ? '입력 검증 기준 · 구조 해석 전' : null;

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  return (
    // pb-28: 화면 오른쪽 아래 전역 작업·메시지 도크가 마지막 버튼을 가리지 않게 여백을 둔다.
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">

      <FileBasedPageBanner
        title={GMU_MENU_NAME}
        subtitle="Group 및 Module Unit 권상 작업 시 발생하는 구조적 안전성을 사전에 검토합니다."
        icon={UploadCloud}
        htmlGuide="posture-stability"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      <div className="flex flex-col items-stretch gap-5 px-1 xl:flex-row">

        {/* ── 왼쪽 레일: 단계 · 입력 요약 · 옵션 · 실행 ── */}
        <aside className={`flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0 ${isStartScreen ? '' : 'xl:self-start'}`}>
          <StepRail steps={displaySteps} activeIdx={activeIdx} onSelect={setActiveIdx} />

          {activeStep.id !== 'input' && (
            <>
              <div className="h-px bg-slate-100" />
              <InputSummary
                items={inputItems}
                footer={handoffSource && (
                  <p className="text-[11px] text-slate-600">{handoffSource}에서 받은 서버 BDF 입니다.</p>
                )}
              />
            </>
          )}

          <div className="h-px bg-slate-100" />
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={useNastran}
              onChange={e => setUseNastran(e.target.checked)}
              disabled={validating}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Nastran 으로도 검증</span>
              <span className="block text-xs text-slate-600">BDF 를 한 번 풀어 FATAL 여부까지 봅니다. 시간이 더 걸립니다.</span>
            </span>
          </label>

          <div className="space-y-2">
            <button
              type="button"
              onClick={runAction.onClick}
              disabled={!runAction.enabled}
              title={runAction.title}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {validating
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> 검증 중…</>
                : <><runAction.icon size={15} aria-hidden="true" /> {runAction.label}</>}
            </button>
            {!hasInput ? (
              <p className="text-center text-xs text-slate-600">BDF 를 올리면 열립니다.</p>
            ) : (
              <p className="text-center text-[11px] text-slate-600">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl</kbd>
                {' + '}
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Enter</kbd>
                {' 로도 실행합니다'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1">
              {(hasInput || hasValidation || validFailed) && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={validating}
                  className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                >
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <SampleRunButton
                appKey="groupmoduleunit"
                variant="link"
                label="샘플로 실행"
                disabled={validating}
                onBeforeRun={sampleGmuBefore}
                onJobSubmitted={sampleGmuSubmitted}
                onError={sampleGmuError}
              />
            </div>
          </div>

          <div className="h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => setCurrentMenu('HiTESS Model Builder')}
            className="flex items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-slate-700 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
          >
            <Wand2 size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
            <span>BDF 가 없으면 <span className="font-semibold text-blue-700 underline-offset-2 hover:underline">Model Builder 로 만들기</span></span>
          </button>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {validating && (
            <JobProgressCard
              title="BDF 검증 중"
              message={validStatusMsg}
              progress={validProgress}
              elapsed={elapsedSecs}
              note="다른 화면으로 이동해도 계속 진행됩니다. 오른쪽 아래 작업 카드로 돌아올 수 있습니다."
            />
          )}

          {!validating && verdict.level && (
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
                  {handoffSource ? (
                    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <ExternalLink size={14} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">
                          <span className="font-bold">{handoffSource}</span>에서 받은 서버 BDF
                        </p>
                        <p className="truncate font-mono text-xs text-slate-600" title={handoffBdfPath || ''}>{handoffBdfPath}</p>
                      </div>
                      {!validating && (
                        <button
                          type="button"
                          onClick={handleReset}
                          className="shrink-0 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
                        >
                          다른 BDF 올리기
                        </button>
                      )}
                    </div>
                  ) : (
                    <BdfDropZone
                      file={bdfFile}
                      onFile={f => { setBdfFile(f); clearResults(); }}
                      onClear={() => { setBdfFile(null); clearResults(); }}
                      onWarnNotBdf={() => showToast('BDF 파일(.bdf)만 올릴 수 있습니다.', 'warning')}
                      disabled={validating}
                    />
                  )}

                  {hasValidation ? (
                    <ValidationStepLog
                      step1Data={step1Data}
                      step2Data={step2Data}
                      useNastran={validatedWithNastran}
                      bare
                    />
                  ) : isStartScreen && (
                    <RunStartPanel
                      programName="GroupModuleUnit"
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => !!r.input_info?.bdf_model}
                      steps={[
                        { title: 'BDF 입력 검증', detail: 'GRID·요소·물성·SPC 카드를 읽어 오류와 주 구조에서 떨어진 그룹을 찾습니다. Nastran 을 켜면 FATAL 여부까지 봅니다.' },
                        { title: 'Studio 권상 검토', detail: 'Studio 에서 권상 위치를 정하고 자세 안정성과 Wire 포함 구조 해석을 실행합니다.' },
                        { title: '결과·보고서', detail: '부재 응력·Wire 판정을 확인하고 해석 파일과 검토 보고서(PDF)를 받습니다.' },
                      ]}
                    />
                  )}
                </>
              )}

              {activeStep.id === 'studio' && (
                <>
                  <StudioLauncherCard
                    title="Group Module Unit Studio"
                    description="검증한 BDF 를 3D 로 열어 권상 위치를 정하고, 자세 안정성과 Wire 포함 구조 해석(SOL 101)을 실행합니다."
                    installed={studioInstalled}
                    status={studioStatus}
                    progress={studioProgress}
                    error={studioError}
                    installedVersion={studioInstalledVersion}
                    latestVersion={studioLatestVersion}
                    ready={validationOk && !!bdfFolderPath}
                    notReadyTitle="먼저 BDF 입력 검증을 통과하세요"
                    onLaunch={launchModuleUnitStudio}
                  />
                  <ol className="space-y-1.5 text-sm text-slate-700">
                    {[
                      ['Hoist 탭', '권상 위치를 자동 선정하거나 직접 고릅니다.'],
                      ['자세 안정성', '전도·형상 판정이 PASS 또는 WARN 이어야 다음으로 갑니다.'],
                      ['Analysis 탭', '구조 해석을 실행하면 결과가 이 화면 3단계로 자동으로 넘어옵니다.'],
                    ].map(([t, d], i) => (
                      <li key={t} className="flex gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-bold text-slate-700">{i + 1}</span>
                        <span><span className="font-semibold text-slate-800">{t}</span> — {d}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {activeStep.id === 'results' && (
                <>
                  {analysisResult && analysisResult.status !== 'ERROR'
                    ? <StructuralResultPanel result={analysisResult} />
                    : <p className="text-sm text-slate-600">Studio 에서 구조 해석을 마치면 응력·Wire 결과가 여기에 표시됩니다.</p>}
                  <ResultArtifactsCard
                    parentAnalysisId={bdfAnalysisId}
                    onDownloaded={() => setDelivered(true)}
                  />
                </>
              )}
            </div>
          </section>

          {validFailed && !step1Data && <EngineLogPanel log={engineLog} />}
        </main>
      </div>
    </div>
  );
}
