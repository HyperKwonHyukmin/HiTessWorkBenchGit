import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  UploadCloud, ArrowRight, ChevronsRight,
  FileCheck2, MapPin, Box, BarChart3,
  X, CheckCircle2, Loader2,
  RotateCcw, AlertOctagon, FileText, Download, Wand2,
  PackageX, AlertCircle, ExternalLink, ShieldCheck,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { usePolling } from '../../hooks/usePolling';
import { requestSidePassageAssessment, requestGroupModuleUnitFromPath, downloadFileText } from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import { API_BASE_URL } from '../../config';

const SIDE_PASSAGE_STUDIO_VIEWER_ID = 'side-passage-studio';

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
  { id: 'studio', title: 'Side Passage Studio', sub: '권상 조건·Nastran 해석·결과 확인', icon: MapPin, status: 'wait' },
  { id: 'model-confirm', title: '해석 모델 확인', sub: '최종 BDF 저장 및 산출 모델 확인', icon: Box, status: 'wait' },
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

function ModuleStudioLauncher({
  ready,
  onLaunch,
  installed,
  status,
  progress,
  error,
  installedVersion,
  latestVersion,
}) {
  const checking = status === 'checking';
  const installing = status === 'installing';
  const opening = status === 'opening';
  const versionMismatch = !!(installedVersion && latestVersion && installedVersion !== latestVersion);
  const disabled = !ready || checking || installing || opening;

  const versionLine = (() => {
    if (installedVersion && latestVersion && versionMismatch) {
      return (
        <p className="text-[10px] font-mono text-amber-700">
          설치본 v{installedVersion} → 워크벤치 v{latestVersion}
          <span className="ml-1 px-1.5 py-[1px] rounded bg-amber-100 text-amber-800 font-bold">업데이트 필요</span>
        </p>
      );
    }
    if (installedVersion) return <p className="text-[10px] font-mono text-slate-500">설치본 v{installedVersion}</p>;
    if (latestVersion) return <p className="text-[10px] font-mono text-slate-500">워크벤치 v{latestVersion}</p>;
    return <p className="text-[10px] text-slate-400">버전 확인 대기 중</p>;
  })();

  const featureBullets = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
      {[
        ['입력 폴더 연결', 'BDF 검증 결과 폴더를 Studio에 자동 전달'],
        ['권상 조건 편집', '권상 위치 및 자세 안정성 입력 작업 수행'],
        ['해석 및 결과 확인', 'Nastran 해석과 결과 판정을 Studio 내부에서 완료'],
      ].map(([title, desc]) => (
        <div key={title} className="rounded-lg border border-white/70 bg-white/65 px-3 py-2">
          <p className="text-[11px] font-bold text-slate-700">{title}</p>
          <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{desc}</p>
        </div>
      ))}
    </div>
  );

  const palette = installed === false || versionMismatch
    ? {
        card: 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50',
        icon: 'text-amber-700',
        title: 'text-amber-950',
        body: 'text-amber-900',
        badge: installed === false ? 'bg-amber-200 text-amber-800' : 'bg-amber-200 text-amber-800',
        badgeText: installed === false ? '미설치 — 설치 필요' : '버전 업데이트 필요',
        button: 'bg-amber-600 hover:bg-amber-700',
      }
    : {
        card: 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50',
        icon: 'text-emerald-700',
        title: 'text-emerald-950',
        body: 'text-emerald-900',
        badge: checking ? 'bg-slate-200 text-slate-700' : 'bg-emerald-200 text-emerald-800',
        badgeText: checking ? '설치 확인 중' : installed === true ? '설치됨 — 사용 가능' : '상태 확인 전',
        button: 'bg-emerald-600 hover:bg-emerald-700',
      };

  const Icon = installed === false ? PackageX : versionMismatch ? AlertCircle : ShieldCheck;
  const buttonText = (() => {
    if (installing) return <><Loader2 size={14} className="animate-spin" /> 설치 중 {progress?.progress ?? 0}%</>;
    if (checking) return <><Loader2 size={14} className="animate-spin" /> 확인 중</>;
    if (opening) return <><Loader2 size={14} className="animate-spin" /> 실행 중</>;
    if (installed === false) return <><Download size={14} /> Studio 설치 후 열기</>;
    if (versionMismatch) return <><Download size={14} /> 업데이트 후 열기</>;
    return <><ExternalLink size={14} /> Studio 열기</>;
  })();

  return (
    <div className={`rounded-2xl border-2 ${palette.card} px-5 py-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon size={18} className={palette.icon} />
            <h3 className={`text-base font-bold ${palette.title}`}>Side Passage Studio</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${palette.badge}`}>{palette.badgeText}</span>
          </div>
          <p className={`text-[13px] font-bold leading-snug mt-2 ${palette.body}`}>
            {installed === false
              ? <>Studio가 이 사용자 PC에 설치되어 있지 않습니다. <b>“Studio 설치 후 열기”</b>를 눌러 최초 1회 설치를 진행하세요.</>
              : versionMismatch
              ? <>설치된 Studio 버전이 워크벤치 배포본과 다릅니다. <b>“업데이트 후 열기”</b>를 누르면 자동 갱신됩니다.</>
              : <>BDF 검증 결과를 확인한 뒤 Studio를 열어 Side Passage 권상 작업을 진행하세요.</>}
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
            설치 파일은 필요 시 자동으로 내려받고, 최초 설치 이후에는 설치본을 재사용합니다.
          </p>
          <div className="flex flex-col gap-1 mt-3">
            {versionLine}
            {error && <p className="text-[10px] text-red-600 leading-snug">⚠ {error}</p>}
          </div>
          {featureBullets}
        </div>
        <button
          onClick={onLaunch}
          disabled={disabled}
          title={!ready ? '먼저 BDF 입력 검증을 완료하세요' : ''}
          className={`shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors cursor-pointer shadow-sm ${palette.button}`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function SidePassageAssessment() {
  const { setCurrentMenu } = useNavigation();
  const {
    startGlobalJob, globalJob, sidePassageHandoff, clearSidePassageHandoff,
    analysisPageStates, setAnalysisPageState,
  } = useDashboard();
  const SIDE_PASSAGE_MENU_NAME = 'Side Passage Assessment';
  // 다른 화면 이탈 → 우측 하단 글로벌 작업 카드로 복귀 시 입력·진행·결과를 그대로 복원하기 위한
  // 전역 저장소(GMU/Truss 와 동일 패턴). 아래 useState 들이 이 값을 초기값으로 읽는다.
  const savedPageState = analysisPageStates?.[SIDE_PASSAGE_MENU_NAME] || {};
  const { showToast } = useToast();

  // ── 파이프라인 상태 ──────────────────────────────────────
  const [steps, setSteps]     = useState(savedPageState.steps ?? INITIAL_STEPS);
  const [activeIdx, setActiveIdx] = useState(savedPageState.activeIdx ?? 0);
  // 해석 실행이 한 번이라도 트리거됐는지 여부 (다음 단계 이동 버튼 활성화 조건)
  const [hasRunOnce, setHasRunOnce] = useState(savedPageState.hasRunOnce ?? false);


  // ── Step 0: BDF 입력 ─────────────────────────────────────
  const [bdfFile, setBdfFile]           = useState(savedPageState.bdfFile ?? null);
  const [validating, setValidating]     = useState(savedPageState.validating ?? false);
  const [validJobId, setValidJobId]     = useState(savedPageState.validJobId ?? null);
  const [validProgress, setValidProgress] = useState(savedPageState.validProgress ?? 0);
  const [validStatusMsg, setValidStatusMsg] = useState(savedPageState.validStatusMsg ?? '');
  const [step1Data, setStep1Data]       = useState(savedPageState.step1Data ?? null);
  const [step2Data, setStep2Data]       = useState(savedPageState.step2Data ?? null);
  const [handoffSource, setHandoffSource] = useState(savedPageState.handoffSource ?? null);
  const [handoffBdfPath, setHandoffBdfPath] = useState(savedPageState.handoffBdfPath ?? null);

  // ── Step 1: Studio 실행 ─────────────────────────────────
  const [bdfPath, setBdfPath]           = useState(savedPageState.bdfPath ?? null);
  // BDF 검증 시 생성된 Analysis.id (DB record).
  // viewer:open 시 main 으로 전달 → Studio 가 후속 해석을 요청할 때 parent_analysis_id 로 사용.
  const [bdfAnalysisId, setBdfAnalysisId] = useState(savedPageState.bdfAnalysisId ?? null);
  const [studioStatus, setStudioStatus] = useState('idle'); // idle | checking | installing | opening | error
  const [studioInstalled, setStudioInstalled] = useState(null); // null=확인 전, true/false=결과
  const [studioProgress, setStudioProgress] = useState(null);
  const [studioError, setStudioError]   = useState(null);
  const [studioInstalledVersion, setStudioInstalledVersion] = useState(null);
  const [studioLatestVersion, setStudioLatestVersion] = useState(null);
  const [studioInstallDir, setStudioInstallDir] = useState(null);
  const [editedBdfPath, setEditedBdfPath] = useState(savedPageState.editedBdfPath ?? null);

  const bdfFolderPath = useMemo(
    () => bdfPath ? bdfPath.replace(/[/\\][^/\\]+$/, '') : null,
    [bdfPath]
  );
  const finalBdfPath = useMemo(() => {
    if (!bdfPath) return null;
    return bdfPath.replace(/\.bdf$/i, '_lifting.bdf');
  }, [bdfPath]);

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
      // 후속 Unit 구조 해석에서 parent record 참조용
      if (typeof data.project?.id === 'number') setBdfAnalysisId(data.project.id);
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
      // 검증이 error 로 끝났을 때는 다음 단계(Studio) 진입 게이트(hasRunOnce)를 풀지 않는다.
      // 잘못된 BDF 로 Studio 가 열려 후속 Nastran 해석에서 원인 불명 오류가 나는 것을 차단.
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

  // ── Step 0: 해석 설정 ───────────────────────────────────
  // 입력검증 시 Nastran 해석 토글 — 기본값 OFF(사용자 요청). 필요 시 사용자가 켠다.
  const [useNastran, setUseNastran] = useState(savedPageState.useNastran ?? false);

  // ── Step 2: 해석 모델 확인 ───────────────────────────────
  const [savingFinalBdf, setSavingFinalBdf] = useState(false);

  const doneCount = steps.filter(s => s.status === 'done').length;

  const setStepStatus = (id, status) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  // ── 페이지 상태 지속 저장 (전역 analysisPageStates) ──
  // 관련 상태가 바뀔 때마다 전역에 저장 → 페이지 이탈 후 트레이 카드로 복귀(remount)했을 때
  // 입력·진행·결과를 그대로 복원한다. (저장이 없어서 복귀 시 초기 화면으로 리셋되던 문제 수정)
  //  • fresh-entry(메뉴 재클릭) : DashboardContext 가 이 값을 비워 새 진입은 정상 초기화된다.
  //  • resume(트레이 클릭)     : 리셋을 건너뛰므로 저장값이 그대로 복원된다.
  // 검증 폴링은 validJobId 복원 시 usePolling 이 자동 재구독하여 진행률이 이어진다.
  useEffect(() => {
    setAnalysisPageState?.(SIDE_PASSAGE_MENU_NAME, {
      steps,
      activeIdx,
      hasRunOnce,
      bdfFile,
      validating,
      validJobId,
      validProgress,
      validStatusMsg,
      step1Data,
      step2Data,
      handoffSource,
      handoffBdfPath,
      bdfPath,
      bdfAnalysisId,
      editedBdfPath,
      useNastran,
    });
  }, [
    setAnalysisPageState,
    steps, activeIdx, hasRunOnce,
    bdfFile, validating, validJobId, validProgress, validStatusMsg,
    step1Data, step2Data, handoffSource, handoffBdfPath,
    bdfPath, bdfAnalysisId, editedBdfPath, useNastran,
  ]);

  useEffect(() => {
    if (!sidePassageHandoff?.bdfServerPath) return;
    const { bdfServerPath, sourceApp } = sidePassageHandoff;
    setHandoffSource(sourceApp || '외부 프로그램');
    setHandoffBdfPath(bdfServerPath);
    setBdfFile(null);
    setStep1Data(null);
    setStep2Data(null);
    setStepStatus('bdf-validation', 'wait');
    setValidProgress(0);
    setValidStatusMsg('');
    clearSidePassageHandoff?.();
    showToast(`${sourceApp || '외부 프로그램'}에서 BDF를 전달받았습니다. 실행 버튼을 눌러 검증을 시작하세요.`, 'info');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (window.electron?.invoke) {
      setStudioStatus('checking');
      window.electron.invoke('viewer:check-installed', SIDE_PASSAGE_STUDIO_VIEWER_ID)
        .then((r) => {
          if (cancelled) return;
          setStudioInstalled(r === null ? false : !!r?.installed);
          setStudioInstalledVersion(r?.manifest?.version ?? null);
          setStudioInstallDir(r?.dir ?? null);
          setStudioStatus('idle');
        })
        .catch((e) => {
          if (cancelled) return;
          setStudioInstalled(false);
          setStudioInstalledVersion(null);
          setStudioError(e?.message || 'Studio 설치 상태 확인 실패');
          setStudioStatus('idle');
        });
    } else {
      setStudioInstalled(false);
      setStudioError('Electron 환경에서만 Studio 설치/실행을 확인할 수 있습니다.');
    }

    fetch(`${API_BASE_URL}/api/viewers/manifest/${SIDE_PASSAGE_STUDIO_VIEWER_ID}`)
      .then(r => r.ok ? r.json() : null)
      .then(meta => {
        if (cancelled) return;
        setStudioLatestVersion(meta?.manifest?.version ?? null);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    const unsub = window.electron.onMessage('viewer:install-progress', (data) => {
      if (!data || data.viewerId !== SIDE_PASSAGE_STUDIO_VIEWER_ID) return;
      setStudioProgress(data);
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    const unsub = window.electron.onMessage('viewer:model-saved', (data) => {
      if (!data || data.viewerId !== SIDE_PASSAGE_STUDIO_VIEWER_ID || !data.filePath) return;
      setEditedBdfPath(data.filePath);
      setStepStatus('model-confirm', 'done');
      setActiveIdx(2);
      showToast(`Edit 모델 BDF 저장됨 — ${data.fileName || data.filePath}`, 'success');
    });
    return () => { try { unsub?.(); } catch {} };
  }, [showToast]);

  const goStep = (idx) => setActiveIdx(idx);

  const launchSidePassageStudio = useCallback(async () => {
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
      const check = await window.electron.invoke('viewer:check-installed', SIDE_PASSAGE_STUDIO_VIEWER_ID);
      if (check === null) throw new Error('IPC viewer:check-installed 미등록');

      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${SIDE_PASSAGE_STUDIO_VIEWER_ID}`);
      if (!manifestRes.ok) throw new Error(`manifest 조회 실패: HTTP ${manifestRes.status}`);
      const meta = await manifestRes.json();
      const serverVer = meta?.manifest?.version ?? null;
      const localVer = check?.manifest?.version ?? null;
      setStudioInstalled(!!check?.installed);
      setStudioInstalledVersion(localVer);
      setStudioLatestVersion(serverVer);
      setStudioInstallDir(check?.dir ?? null);

      const needInstall = !check?.installed || (serverVer && localVer && serverVer !== localVer);
      if (needInstall) {
        const reason = !check?.installed
          ? 'Side Passage Studio 미설치 — 다운로드 시작'
          : `Side Passage Studio 업데이트 (v${localVer} → v${serverVer})`;
        showToast(reason, 'info');
        setStudioStatus('installing');
        const installRes = await window.electron.invoke('viewer:install', {
          viewerId: SIDE_PASSAGE_STUDIO_VIEWER_ID,
          downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`,
          uncPath: meta.uncPath,
          expectedSha256: meta.sha256,
        });
        if (installRes === null) throw new Error('IPC viewer:install 미등록');
        if (!installRes?.ok) throw new Error(installRes?.error || 'Studio 설치 실패');
        setStudioInstalled(true);
        setStudioInstalledVersion(installRes?.manifest?.version ?? serverVer);
        setStudioLatestVersion(serverVer);
        setStudioInstallDir(installRes?.dir ?? check?.dir ?? null);
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
      // outputDir 는 항상 서버측 원본 폴더(bdfFolderPath) — initialFolder 가 로컬 추출본으로
      // 바뀌어도 백엔드 checkplate-export 는 서버의 원본 BDF 를 읽어 양식을 재생성한다.
      const sidePassageBdfName = bdfPath ? bdfPath.split(/[\\/]/).pop() : null;
      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: SIDE_PASSAGE_STUDIO_VIEWER_ID,
        initialFolder,
        parentAnalysisId: bdfAnalysisId,
        serverUrl: API_BASE_URL,
        outputDir: bdfFolderPath,
        sidePassageBdfName,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      setStepStatus('studio', 'done');
      setActiveIdx(2);
      setStudioStatus('idle');
    } catch (e) {
      setStudioError(e.message);
      setStudioStatus('error');
      showToast(`Side Passage Studio 실행 실패 — ${e.message}`, 'error');
    }
  }, [bdfFolderPath, bdfPath, bdfAnalysisId, showToast]);

  const activeStep = steps[activeIdx];
  const isBdfStep      = activeStep?.id === 'bdf-validation';
  const isLiftingStep  = activeStep?.id === 'studio';
  const isModelStep    = activeStep?.id === 'model-confirm';

  // ── 마운트: 진행 중인 BDF 검증 작업이 globalJob 에 있으면 복원 ──────
  // 사용자가 다른 페이지로 이동 후 우측 하단 상황판 클릭으로 돌아왔을 때
  // 빈 화면이 아니라 "검증 중" UI 를 그대로 보여준다.
  useEffect(() => {
    if (sidePassageHandoff?.bdfServerPath) return; // 핸드오프가 우선
    if (!globalJob || globalJob.menu !== SIDE_PASSAGE_MENU_NAME) return;
    if (globalJob.status !== 'Running' && globalJob.status !== 'Pending') return;
    setValidJobId(globalJob.jobId);
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setValidProgress(globalJob.progress ?? 0);
    setValidStatusMsg(globalJob.message ?? '서버 처리 중...');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── BDF 검증 ─────────────────────────────────────────────
  const handleValidate = async () => {
    if (!bdfFile && !handoffBdfPath) return;
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
      formData.append('employee_id', employeeId);
      formData.append('use_nastran', String(useNastran));
      formData.append('source', 'SidePassage');

      let res;
      if (handoffBdfPath) {
        formData.append('bdf_server_path', handoffBdfPath);
        res = await requestGroupModuleUnitFromPath(formData);
      } else {
        formData.append('bdf_file', bdfFile);
        res = await requestSidePassageAssessment(formData);
      }
      setValidJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, SIDE_PASSAGE_MENU_NAME);
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
  // hasRunOnce 는 validation 성공 후에만 true 가 된다(polling.onComplete 의 !hasError 분기).
  // 여기서는 게이트를 풀지 않는다 — 잘못된 BDF 로 다음 단계 진입을 막기 위함.
  const handleRun = () => {
    const bdfDone = steps.find(s => s.id === 'bdf-validation')?.status === 'done';
    if (!bdfDone) {
      if (!bdfFile && !handoffBdfPath) {
        showToast('BDF 파일을 업로드해주세요.', 'warning');
        setActiveIdx(0);
        return;
      }
      handleValidate();
      return;
    }
    // bdfDone(=done) 상태이므로 검증을 통과했음이 보장된다 → 게이트는 onComplete 에서 이미 true.
    setActiveIdx(1);
    showToast('Side Passage Studio를 열어 후속 작업을 진행하세요.', 'info');
  };

  const handleSaveFinalBdf = async () => {
    if (!editedBdfPath) {
      showToast('Studio에서 Save를 눌러 Edit BDF를 먼저 생성하세요.', 'warning');
      return;
    }
    setSavingFinalBdf(true);
    try {
      let text = null;
      try {
        if (window.electron?.invoke) {
          const local = await window.electron.invoke('viewer:readLocalFile', { filePath: editedBdfPath });
          if (local?.ok && local.data) {
            const bytes = local.data instanceof Uint8Array ? local.data : new Uint8Array(local.data);
            text = new TextDecoder('utf-8').decode(bytes);
          }
        }
      } catch {}
      if (text == null) {
        const res = await downloadFileText(editedBdfPath);
        text = res.data;
      }

      const fileName = editedBdfPath.split(/[\\/]/).pop() || 'side_passage_edit.bdf';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStepStatus('model-confirm', 'done');
      showToast('Edit BDF 저장을 시작했습니다.', 'success');
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      showToast(`BDF 저장 실패 — ${detail}`, 'error');
    } finally {
      setSavingFinalBdf(false);
    }
  };

  // ── 전체 초기화 ──────────────────────────────────────────
  const handleReset = () => {
    setBdfFile(null);
    setHandoffSource(null);
    setHandoffBdfPath(null);
    setValidating(false);
    setValidJobId(null);
    setStep1Data(null);
    setStep2Data(null);
    setValidProgress(0);
    setValidStatusMsg('');
    setBdfPath(null);
    setEditedBdfPath(null);
    setStudioStatus('idle');
    setStudioProgress(null);
    setStudioError(null);
    setSavingFinalBdf(false);
    setSteps(INITIAL_STEPS);
    setActiveIdx(0);
    setUseNastran(true);
    setHasRunOnce(false);
  };

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="min-h-full xl:h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      <FileBasedPageBanner
        title="Side Passage Assessment"
        subtitle="Side Passage BDF 모델을 검증하고 Studio에서 권상 조건, Nastran 해석, 결과 판정을 완료합니다."
        icon={UploadCloud}
        guideTitle="[파일] Side Passage Assessment"
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-5 min-h-0 xl:flex-row">

        {/* ── Left Panel ── */}
        <div className="w-full flex flex-col gap-3 xl:w-96 xl:shrink-0">

          {/* 스텝퍼 */}
          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* BDF 가 없을 때 진입 — 파이프라인 박스 최상단, 해석 실행 버튼과 시각적으로 분리 */}
            <button
              onClick={() => setCurrentMenu('HiTESS Model Builder')}
              className="w-full relative flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 hover:from-indigo-400 hover:via-indigo-500 hover:to-violet-600 active:scale-[0.995] text-white transition-all duration-200 cursor-pointer overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full pointer-events-none" />
              <div className="absolute -right-2 -bottom-6 w-16 h-16 bg-white/5 rounded-full pointer-events-none" />
              <div className="absolute left-3 top-2 w-1.5 h-1.5 rounded-full bg-white/40 pointer-events-none animate-pulse" />
              <div className="relative flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <Wand2 size={22} className="text-white" />
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
                  <span>다음 단계: {steps[activeIdx + 1].title}</span>
                  <ArrowRight size={13} />
                </button>
              )}
              <button
                onClick={handleRun}
                disabled={validating}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-blue-dark active:bg-brand-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                {validating
                  ? <><Loader2 size={15} className="animate-spin" /> BDF 검증 중...</>
                  : steps.find(s => s.id === 'bdf-validation')?.status === 'done'
                  ? <><ChevronsRight size={16} /> Studio 단계로 이동</>
                  : <><ChevronsRight size={16} /> BDF 입력 검증 실행</>
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

          {/* ─ Step 0: BDF 입력 검증 ─ */}
          {isBdfStep && (
            <>
              {/* 입력 패널 */}
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-700">1. BDF 입력 검증</h2>
                  <span className="text-[10px] text-slate-400">— BDF 파일 업로드 및 유효성 검증</span>
                </div>
                <div className="p-4 space-y-3">
                  {handoffSource && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200">
                      <ExternalLink size={13} className="text-violet-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-violet-700 font-medium">
                          <span className="font-bold">{handoffSource}</span>에서 전달된 BDF — 실행 버튼 대기 중
                        </p>
                        <p className="text-[10px] text-violet-500 font-mono truncate" title={handoffBdfPath || ''}>
                          {handoffBdfPath}
                        </p>
                      </div>
                    </div>
                  )}
                  {!handoffSource && (
                    <BdfDropZone
                      file={bdfFile}
                      onFile={f => { setBdfFile(f); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                      onClear={() => { setBdfFile(null); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                      disabled={validating}
                    />
                  )}
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
                      다음 단계 — Side Passage Studio →
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

          {/* ─ Step 1: Side Passage Studio ─ */}
          {isLiftingStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                <h2 className="text-xs font-bold text-slate-700">2. Side Passage Studio</h2>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 bg-slate-50/60">
                <ModuleStudioLauncher
                  ready={!!bdfFolderPath}
                  onLaunch={launchSidePassageStudio}
                  installed={studioInstalled}
                  status={studioStatus}
                  progress={studioProgress}
                  error={studioError}
                  installedVersion={studioInstalledVersion}
                  latestVersion={studioLatestVersion}
                />
              </div>
            </div>
          )}

          {/* ─ Step 2: 해석 모델 확인 ─ */}
          {isModelStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-700">3. 해석 모델 확인</h2>
                  {steps.find(s => s.id === 'studio')?.status === 'done' && (
                    <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">Studio 실행 완료</span></>
                  )}
                </div>
                {editedBdfPath && (
                  <button
                    onClick={handleSaveFinalBdf}
                    disabled={savingFinalBdf}
                    className="inline-flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                  >
                    {savingFinalBdf ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    최종 Edit.bdf 저장
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 bg-slate-50/60" />
            </div>
          )}

        </div>{/* end Right Panel */}
      </div>
    </div>
  );
}
