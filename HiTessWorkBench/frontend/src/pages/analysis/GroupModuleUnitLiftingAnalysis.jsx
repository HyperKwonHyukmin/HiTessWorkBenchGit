import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  UploadCloud, ArrowLeft, ArrowRight, ChevronsRight,
  FileCheck2, MapPin, Cpu, BarChart3,
  X, CheckCircle2, Loader2,
  RotateCcw, AlertOctagon, FileText, Download, Wand2,
  PackageX, AlertCircle, ExternalLink, HardDrive, ShieldCheck,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import GuideButton from '../../components/ui/GuideButton';
import { usePolling } from '../../hooks/usePolling';
import { requestGroupModuleUnit, downloadFileText } from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import { API_BASE_URL } from '../../config';

const MODULE_STUDIO_VIEWER_ID = 'module-unit-studio';

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
  { id: 'lifting-points', title: 'Group Module Unit Studio', sub: 'Studio 실행', icon: MapPin, status: 'wait' },
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
  installDir,
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
        ['후속 JSON 생성', '다음 단계에서 사용할 Studio 결과 파일 작성'],
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
            <h3 className={`text-base font-bold ${palette.title}`}>Group Module Unit Studio</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${palette.badge}`}>{palette.badgeText}</span>
          </div>
          <p className={`text-[13px] font-bold leading-snug mt-2 ${palette.body}`}>
            {installed === false
              ? <>Studio가 이 사용자 PC에 설치되어 있지 않습니다. <b>“Studio 설치 후 열기”</b>를 눌러 최초 1회 설치를 진행하세요.</>
              : versionMismatch
              ? <>설치된 Studio 버전이 워크벤치 배포본과 다릅니다. <b>“업데이트 후 열기”</b>를 누르면 자동 갱신됩니다.</>
              : <>BDF 검증 결과를 확인한 뒤 Studio를 열어 Group Module Unit 권상 작업을 진행하세요.</>}
          </p>
          <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
            설치 파일은 사내 배포 위치에서 자동으로 내려받고, 사용자 PC의 WorkBench 앱 데이터 폴더에 보관됩니다.
            최초 설치 이후에는 같은 위치의 설치본을 재사용합니다.
          </p>
          <div className="flex flex-col gap-1 mt-3">
            {versionLine}
            {installDir && (
              <p className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono break-all">
                <HardDrive size={11} className="shrink-0 text-slate-400" />
                {installDir}
              </p>
            )}
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

  // ── Step 1: Studio 실행 ─────────────────────────────────
  const [bdfPath, setBdfPath]           = useState(null);
  // BDF 검증 시 생성된 GroupModuleUnit Analysis.id (DB record).
  // viewer:open 시 main 으로 전달 → main 이 viewer:runUnitStructural 호출 시 백엔드 parent_analysis_id 로 사용.
  const [bdfAnalysisId, setBdfAnalysisId] = useState(null);
  const [studioStatus, setStudioStatus] = useState('idle'); // idle | checking | installing | opening | error
  const [studioInstalled, setStudioInstalled] = useState(null); // null=확인 전, true/false=결과
  const [studioProgress, setStudioProgress] = useState(null);
  const [studioError, setStudioError]   = useState(null);
  const [studioInstalledVersion, setStudioInstalledVersion] = useState(null);
  const [studioLatestVersion, setStudioLatestVersion] = useState(null);
  const [studioInstallDir, setStudioInstallDir] = useState(null);

  const bdfFolderPath = useMemo(
    () => bdfPath ? bdfPath.replace(/[/\\][^/\\]+$/, '') : null,
    [bdfPath]
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

  useEffect(() => {
    let cancelled = false;
    if (window.electron?.invoke) {
      setStudioStatus('checking');
      window.electron.invoke('viewer:check-installed', MODULE_STUDIO_VIEWER_ID)
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

    fetch(`${API_BASE_URL}/api/viewers/manifest/${MODULE_STUDIO_VIEWER_ID}`)
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
      if (!data || data.viewerId !== MODULE_STUDIO_VIEWER_ID) return;
      setStudioProgress(data);
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const goStep = (idx) => setActiveIdx(idx);

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

      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${MODULE_STUDIO_VIEWER_ID}`);
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
      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: MODULE_STUDIO_VIEWER_ID,
        initialFolder,
        parentAnalysisId: bdfAnalysisId,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      setStepStatus('lifting-points', 'done');
      setStudioStatus('idle');
    } catch (e) {
      setStudioError(e.message);
      setStudioStatus('error');
      showToast(`ModuleUnitStudio 실행 실패 — ${e.message}`, 'error');
    }
  }, [bdfFolderPath, bdfAnalysisId, showToast]);

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

      const res = await requestGroupModuleUnit(formData);
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
    setActiveIdx(1);
    showToast('Group Module Unit Studio를 열어 후속 작업을 진행하세요.', 'info');
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
    setStudioStatus('idle');
    setStudioProgress(null);
    setStudioError(null);
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
            {/* BDF 가 없을 때 진입 — 파이프라인 박스 최상단, 해석 실행 버튼과 시각적으로 분리 */}
            <button
              onClick={() => setCurrentMenu('HiTess Model Builder')}
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
                  <p className="text-[10px] text-indigo-200 mt-0.5">HiTess Model Builder 로 이동</p>
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
                <div className="p-4">
                  <BdfDropZone
                    file={bdfFile}
                    onFile={f => { setBdfFile(f); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                    onClear={() => { setBdfFile(null); setStep1Data(null); setStep2Data(null); setStepStatus('bdf-validation', 'wait'); }}
                    disabled={validating}
                  />
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
                      다음 단계 — Group Module Unit Studio →
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

          {/* ─ Step 1: Group Module Unit Studio ─ */}
          {isLiftingStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                <h2 className="text-xs font-bold text-slate-700">2. Group Module Unit Studio</h2>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 bg-slate-50/60">
                <ModuleStudioLauncher
                  ready={!!bdfFolderPath}
                  onLaunch={launchModuleUnitStudio}
                  installed={studioInstalled}
                  status={studioStatus}
                  progress={studioProgress}
                  error={studioError}
                  installedVersion={studioInstalledVersion}
                  latestVersion={studioLatestVersion}
                  installDir={studioInstallDir}
                />
              </div>
            </div>
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
