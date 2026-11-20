import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Boxes, ClipboardCheck, FilePlus2, FileUp, Loader2, Play, RotateCcw, Scissors } from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { usePolling } from '../../hooks/usePolling';
import { requestTrussLifting, downloadFileBlob, getAnalysisById } from '../../api/analysis';
import { API_BASE_URL } from '../../config';
import SolverCredit from '../../components/ui/SolverCredit';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import {
  StepRail, InputSummary, JobProgressCard, VerdictHeader, KeyFigures, StudioLauncherCard, RunStartPanel, BdfDropZone,
} from '../../components/analysis/runFrame';
import { computeTrussLiftingVerdict, summarizeTrussCases, trussCaseKey } from '../../utils/trussLiftingVerdict';
import { useResultReentry } from '../../utils/resultReentry';

/**
 * Truss Module Lifting (2026-11-17, docs/plans/2026-11-17-truss-module-lifting-plan.md 1단계 7번).
 *
 * 1. 글로벌 Truss BDF 입력 검증 — /api/analysis/trusslifting/request (GMU 검증 작업 재사용, 기록 = TrussModuleLifting)
 * 2. Truss Lifting Studio — 분할(소모듈), 질량 재구성, 권상(Wire), 자세안정성, 구조 해석
 *    Studio 의 업로드, 자세안정성, 구조 해석은 GMU 와 같은 IPC 와 백엔드 경로를 쓰고 이 검증 기록을 부모로 삼는다.
 * 3. 결과 — 구조 해석 완료 알림(viewer:unit-structural-completed)의 결과 JSON 에 백엔드가 넣은 trussAssessment
 *    (기존 TrussAssessment 와 같은 판정)를 보인다.
 * 첫 단계는 작업 탭 없이 한 번에 하나(계획 D20).
 */
const MENU = 'Truss Module Lifting';
const VIEWER_ID = 'truss-lifting-studio';
const STEP = { input: 0, studio: 1, results: 2 };
const ACCEPT = ['.bdf', '.dat', '.nas'];
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

export default function TrussModuleLifting() {
  const { goBack, currentMenu } = useNavigation();
  const { startGlobalJob } = useDashboard();
  const { showToast } = useToast();
  const [activeIdx, setActiveIdx] = useState(STEP.input);
  const [bdfFile, setBdfFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(null);
  const [parentId, setParentId] = useState(null);       // 검증 기록 id = Studio 권상 흐름의 부모
  const [bdfPath, setBdfPath] = useState(null);         // 서버의 글로벌 BDF 경로
  const [studio, setStudio] = useState({ status: 'idle', installed: null, installedVersion: null, latestVersion: null, progress: null, error: null });
  const [studioOpened, setStudioOpened] = useState(false);
  // 구조 해석 완료 알림 — 소모듈(Case)마다 하나씩 온다(Studio 의 [전체 해석]). { [caseKey]: payload }
  const [results, setResults] = useState({});
  const [caseKey, setCaseKey] = useState(null);         // 지금 보는 소모듈
  const [runError, setRunError] = useState(null);       // 마지막 구조 해석 실패(어느 소모듈인지는 알림에 없다)
  const result = (caseKey && results[caseKey]) || null;
  const clearResults = () => { setResults({}); setCaseKey(null); setRunError(null); };
  const fileRef = useRef(null);

  const bdfFolder = bdfPath ? bdfPath.replace(/[\\/][^\\/]+$/, '') : null;

  const resetAll = () => {
    setBdfFile(null); setJobId(null); setProgress(0); setMessage(''); setFailed(null);
    setParentId(null); setBdfPath(null); setStudioOpened(false); clearResults(); setActiveIdx(STEP.input);
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!ACCEPT.some(ext => file.name.toLowerCase().endsWith(ext))) {
      showToast(`BDF 파일만 올릴 수 있습니다 (${ACCEPT.join(', ')}).`, 'error');
      return;
    }
    // 다른 모델이 들어오면 앞 검증과 Studio 결과는 그 모델 것이 아니다 — 비우고 1단계로.
    resetAll();
    setBdfFile(file);
  };

  // ── 1. 입력 검증 ──────────────────────────────────────────────
  const runValidation = async () => {
    if (!bdfFile) { showToast('글로벌 Truss BDF 파일을 고르세요.', 'warning'); return; }
    if (jobId) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const fd = new FormData();
    fd.append('bdf_file', bdfFile);
    fd.append('employee_id', user.employee_id ?? '');
    setFailed(null); clearResults(); setStudioOpened(false); setParentId(null); setBdfPath(null);
    setProgress(0); setMessage('업로드 중...'); setActiveIdx(STEP.input);
    try {
      const res = await requestTrussLifting(fd);
      setJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, MENU);
    } catch (e) {
      setFailed(e?.response?.data?.detail || e.message || '요청 실패');
    }
  };

  // 샘플 실행 — 서버에 고정된 174k 글로벌 BDF(SampleFile/TrussLifting)로 같은 검증 흐름에 들어간다.
  const sampleBefore = () => {
    resetAll();
    setBdfFile({ name: '174k_2tk_rev5_DesignNo.6.bdf', sample: true, serverSample: true });
    setMessage('샘플 파일로 작업 요청 중...');
  };
  const sampleSubmitted = (id) => { setJobId(id); startGlobalJob?.(id, MENU); };
  const sampleError = (_st, detail) => { setJobId(null); setFailed(detail || '샘플 실행 실패'); };

  usePolling({
    jobId,
    maxRetries: 240,
    onProgress: (d) => { setProgress(d.progress ?? 0); setMessage(d.message ?? ''); },
    onComplete: (d) => {
      setJobId(null); setProgress(100);
      const info = d.project?.result_info;
      if (!info?.bdf) { setFailed('검증 결과를 찾을 수 없습니다.'); return; }
      setBdfPath(info.bdf);
      setParentId(typeof d.project?.id === 'number' ? d.project.id : null);
      setActiveIdx(STEP.studio);
      showToast('글로벌 모델 검증 완료 — Studio 에서 소모듈을 자르세요.', 'success');
    },
    onError: (d) => { setJobId(null); setFailed(d?.timeout ? '시간 초과' : (d?.message || '검증 실패')); },
  });

  // ── 2. Studio ──────────────────────────────────────────────────
  const refreshStudio = useCallback(async () => {
    if (!window.electron?.invoke) return;
    try {
      const r = await window.electron.invoke('viewer:check-installed', VIEWER_ID);
      const res = await fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`, { cache: 'no-store' });
      const meta = res.ok ? await res.json() : null;
      setStudio(s => ({ ...s, installed: !!r?.installed, installedVersion: r?.manifest?.version ?? null, latestVersion: meta?.manifest?.version ?? null }));
    } catch { /* 서버 미접속 — 그대로 */ }
  }, []);
  useEffect(() => { if (currentMenu === MENU) refreshStudio(); }, [currentMenu, refreshStudio]);
  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    return window.electron.onMessage('viewer:install-progress', (data) => {
      if (data?.viewerId === VIEWER_ID) setStudio(s => ({ ...s, progress: data }));
    });
  }, []);

  const launchStudio = useCallback(async () => {
    if (!window.electron?.invoke) { showToast('WorkBench 앱에서만 Studio 를 열 수 있습니다.', 'error'); return; }
    if (!bdfFolder || !parentId) { showToast('먼저 글로벌 BDF 검증을 마치세요.', 'warning'); return; }
    try {
      setStudio(s => ({ ...s, status: 'checking', error: null }));
      const check = await window.electron.invoke('viewer:check-installed', VIEWER_ID);
      const metaRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`, { cache: 'no-store' });
      if (!metaRes.ok) throw new Error(`Studio 정보 조회 실패: HTTP ${metaRes.status}`);
      const meta = await metaRes.json();
      const serverVer = meta?.manifest?.version ?? null;
      const localVer = check?.manifest?.version ?? null;
      if (!check?.installed || (serverVer && localVer && serverVer !== localVer)) {
        setStudio(s => ({ ...s, status: 'installing' }));
        const ins = await window.electron.invoke('viewer:install', {
          viewerId: VIEWER_ID, downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`, uncPath: meta.uncPath, expectedSha256: meta.sha256,
        });
        if (!ins?.ok) throw new Error(ins?.error || 'Studio 설치 실패');
      }
      let initialFolder = bdfFolder;
      const access = await window.electron.invoke('viewer:checkPathAccess', { path: bdfFolder });
      if (!access?.accessible) {
        const token = localStorage.getItem('session_token');
        const fetched = await window.electron.invoke('viewer:fetchResultDir', {
          downloadUrl: `${API_BASE_URL}/api/analysis/modelflow/result-zip?${new URLSearchParams({ output_dir: bdfFolder })}`,
          jobId: bdfFolder.split(/[\\/]/).pop(),
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!fetched?.ok) throw new Error(fetched?.error || 'Studio 입력 폴더 받기 실패');
        initialFolder = fetched.dir;
      }
      setStudio(s => ({ ...s, status: 'opening' }));
      const open = await window.electron.invoke('viewer:open', {
        viewerId: VIEWER_ID,
        windowTitle: `${bdfFile?.name ?? 'Truss'} — Truss Lifting Studio`,
        initialFolder, parentAnalysisId: parentId, serverUrl: API_BASE_URL, sourceKey: bdfPath,
      });
      if (!open?.ok) throw new Error(open?.error || 'Studio 열기 실패');
      setStudioOpened(true);
      setStudio(s => ({ ...s, status: 'idle', installed: true }));
      refreshStudio();
    } catch (e) {
      setStudio(s => ({ ...s, status: 'error', error: e.message }));
      showToast(`Studio 실행 실패 — ${e.message}`, 'error');
    }
  }, [bdfFolder, bdfPath, bdfFile, parentId, refreshStudio, showToast]);

  // ── 3. 결과 — 이 검증 기록으로 연 Studio 의 구조 해석만 받는다 ──
  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    return window.electron.onMessage('viewer:unit-structural-completed', (payload) => {
      if (payload?.viewerId !== VIEWER_ID) return;
      if (!parentId || payload.parentAnalysisId !== parentId) return;
      if (payload.ok) {
        const key = trussCaseKey(payload);
        setResults(prev => ({ ...prev, [key]: payload }));
        setCaseKey(key);
        setRunError(null);
      } else {
        setRunError(payload);
      }
      setActiveIdx(STEP.results);
      showToast(payload.ok ? 'Truss 소모듈 구조 해석 완료' : `구조 해석 실패 — ${payload.error || '알 수 없는 오류'}`, payload.ok ? 'success' : 'error');
    });
  }, [parentId, showToast]);

  // ── 지난 검증 다시 열기 / 지난 입력 불러오기 (첫 화면 '내 최근 실행', My Projects) ──
  const applyResultReentry = async (analysisId) => {
    try {
      const { data: rec } = await getAnalysisById(analysisId);
      if (rec.program_name !== 'TrussModuleLifting') throw new Error('Truss Module Lifting 기록이 아닙니다.');
      if (rec.files_available === false) throw new Error('보관 기간이 지나 파일이 삭제되었습니다.');
      if (rec.status !== 'Success' || !rec.result_info?.bdf) throw new Error('이 기록에는 검증을 마친 BDF 가 없습니다.');
      resetAll();
      setBdfFile({ name: baseName(rec.input_info?.bdf_model || rec.result_info.bdf), sample: true });
      setBdfPath(rec.result_info.bdf);
      setParentId(rec.id);
      setActiveIdx(STEP.studio);
      showToast('지난 검증을 열었습니다. 같은 모델로 Studio 를 다시 열 수 있습니다.', 'success');
    } catch (e) {
      showToast(`다시 열지 못했습니다: ${e.message}`, 'error');
    }
  };
  useResultReentry(MENU, applyResultReentry);

  const applyRecentInput = async (record) => {
    try {
      const path = record?.input_info?.bdf_model;
      if (!path) throw new Error('이 실행에는 불러올 BDF 정보가 없습니다.');
      const res = await downloadFileBlob(path);
      handleFile(new File([res.data], baseName(path), { type: 'application/octet-stream' }));
      showToast(`${baseName(path)} 을 입력으로 불러왔습니다.`, 'success');
    } catch (e) {
      showToast(`입력을 불러오지 못했습니다: ${e?.response?.status === 404 ? '서버에 파일이 없습니다' : e.message}`, 'error');
    }
  };

  // Ctrl+Enter = 검증 실행. keep-alive 페이지라 이 메뉴가 보일 때만 받는다.
  const canRun = !!bdfFile && !bdfFile.sample && !jobId && !parentId;
  useEffect(() => {
    if (currentMenu !== MENU || !canRun) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runValidation(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const verdict = result?.ok ? computeTrussLiftingVerdict(result.result) : null;
  const cases = summarizeTrussCases(results);
  const anyResult = cases.rows.length > 0 || !!runError;
  const studioBusy = ['checking', 'installing', 'opening'].includes(studio.status);
  const steps = [
    { id: 'input', title: '글로벌 BDF 검증', icon: FileUp,
      status: jobId ? 'running' : failed ? 'error' : parentId ? 'done' : 'wait',
      hint: jobId ? `검증 중 ${Math.round(progress)}%` : bdfFile && !parentId && !failed ? '실행 대기' : undefined },
    { id: 'studio', title: 'Studio 분할과 권상', icon: Scissors,
      status: anyResult ? 'done' : studioOpened ? 'running' : 'wait',
      hint: !parentId ? '검증 뒤 열림' : studioOpened && !anyResult ? 'Studio 에서 작업 중' : undefined },
    { id: 'results', title: '결과', icon: ClipboardCheck,
      // 소모듈이 여러 개면 가장 나쁜 판정을 단계에 보인다
      status: cases.worst === 'fail' ? 'error' : cases.worst === 'review' ? 'review' : cases.worst === 'pass' ? 'done' : runError ? 'error' : 'wait',
      hint: !anyResult ? '구조 해석 뒤 옴' : cases.rows.length > 1 ? `소모듈 ${cases.rows.length}개` : undefined },
  ];
  const activeStep = steps[activeIdx];
  const ActiveIcon = activeStep.icon;
  const isStartScreen = activeIdx === STEP.input && !bdfFile && !jobId && !failed;

  // 왼쪽 레일 주 버튼은 하나 — 단계에 따라 하는 일이 바뀐다.
  const runAction = !parentId
    ? { label: failed ? '다시 검증' : '검증 실행', icon: failed ? RotateCcw : Play,
        enabled: canRun, onClick: runValidation,
        hint: jobId ? null : !bdfFile ? '글로벌 BDF 를 올리면 열립니다.' : null }
    : { label: studioOpened ? 'Studio 다시 열기' : 'Studio 열기', icon: Scissors, enabled: !studioBusy,
        onClick: () => { setActiveIdx(STEP.studio); launchStudio(); },
        hint: '분할, 질량, 권상, 구조 해석은 Studio 에서 합니다.' };
  const RunIcon = runAction.icon;
  const busy = !!jobId || studioBusy;
  const fig = verdict?.figures;

  return (
    // pb-28: 화면 오른쪽 아래 전역 작업, 메시지 도크가 마지막 버튼을 가리지 않게 여백을 둔다.
    <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col pb-28 animate-fade-in-up">
      <FileBasedPageBanner title={MENU} subtitle="Truss 글로벌 모델을 소모듈로 잘라 권상 구조 해석을 진행합니다." icon={Boxes} onBack={goBack} />

      <div className="flex flex-col items-stretch gap-5 px-1 xl:flex-row">
        {/* ── 왼쪽 레일: 단계, 입력 요약, 실행 ── */}
        <aside className={`flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 xl:w-80 xl:shrink-0 ${isStartScreen ? '' : 'xl:self-start'}`}>
          <StepRail steps={steps} activeIdx={activeIdx} onSelect={setActiveIdx} />

          {activeIdx !== STEP.input && (
            <>
              <div className="h-px bg-slate-100" />
              <InputSummary items={[{
                key: 'bdf', label: '글로벌 BDF', fileName: bdfFile?.name,
                state: failed ? 'error' : parentId ? 'ok' : 'warn', note: '올리지 않음',
              }]} />
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
              {busy
                ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> {jobId ? '검증 중…' : 'Studio 여는 중…'}</>
                : <><RunIcon size={15} aria-hidden="true" /> {runAction.label}</>}
            </button>
            {runAction.hint ? (
              <p className="text-center text-xs text-slate-600">{runAction.hint}</p>
            ) : !busy && !parentId && (
              <p className="text-center text-[11px] text-slate-600">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl</kbd>
                {' + '}
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Enter</kbd>
                {' 로도 실행합니다'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1">
              {(bdfFile || failed || parentId) && (
                <button
                  type="button"
                  onClick={resetAll}
                  disabled={!!jobId}
                  className="inline-flex items-center gap-1 rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline cursor-pointer"
                >
                  <FilePlus2 size={12} aria-hidden="true" /> 새 입력으로 시작
                </button>
              )}
              <SampleRunButton
                appKey="trusslifting"
                variant="link"
                label="샘플로 실행"
                disabled={!!jobId}
                onBeforeRun={sampleBefore}
                onJobSubmitted={sampleSubmitted}
                onError={sampleError}
              />
            </div>
          </div>

          {/* 글로벌 모델의 질량은 소모듈 해석에 쓰지 않는다 — 처음 쓰는 사람이 가장 헷갈리는 점이라 늘 보인다(계획 D3). */}
          <div className="h-px bg-slate-100" />
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <AlertCircle size={13} className="shrink-0 text-amber-600" aria-hidden="true" /> 글로벌 모델의 집중질량은 쓰지 않습니다
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              BDF 의 <span className="font-mono text-slate-800">CONM2</span> 는 소모듈에서 모두 지우고,
              LV 평면의 닫힌 칸에 <strong className="font-bold text-slate-800">Plywood(t/m²)와 Square Tube(총중량 t)</strong> 로 다시 넣습니다.
              부재 자중은 재질 밀도로 그대로 들어갑니다.
            </p>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Studio 분할 탭에서 넣습니다. Plywood 는 0.63 t/m² 가 기본이고 Square Tube 는 소모듈 전체 중량을 넣습니다.
              두 값은 사용자가 고른 설치 층에만 들어가고, 기존 상태와 설치 후 중량을 나란히 보여 줍니다.
            </p>
          </div>
        </aside>

        {/* ── 오른쪽 작업면 ── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {jobId && (
            <JobProgressCard title="글로벌 BDF 검증 중" message={message} progress={progress}
              note="다른 화면으로 이동해도 계속 진행됩니다. 끝나면 Studio 단계로 넘어갑니다." />
          )}
          {failed && (
            <ErrorCard title="검증하지 못했습니다" detail={failed} next="BDF 를 확인한 뒤 왼쪽 [다시 검증] 을 누르세요." />
          )}
          {cases.rows.length > 1 && (
            <CaseTabs rows={cases.rows} active={caseKey} onSelect={(key) => { setCaseKey(key); setActiveIdx(STEP.results); }} />
          )}
          {verdict?.level && (
            <VerdictHeader level={verdict.level} title={verdict.title} summary={verdict.summary} reasons={verdict.reasons}
              meta={`${result?.result?.case?.name ? `${result.result.case.name}, ` : ''}권상 케이스, TrussAssessment 와 같은 판정`} />
          )}
          {runError && (
            <ErrorCard title="구조 해석이 실패했습니다" detail={runError.error || '알 수 없는 오류'}
              next="Studio 의 실패 안내에서 원인 위치를 확인하고 고친 뒤 다시 해석하세요." />
          )}

          <section className={`flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-5 py-4 ${isStartScreen ? 'flex-1' : ''}`}>
            <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-100 pb-3">
              <ActiveIcon size={15} className="text-slate-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-800">{activeIdx + 1}. {activeStep.title}</h2>
            </div>

            <div className="min-w-0 space-y-4">
              {activeIdx === STEP.input && (
                <>
                  <BdfDropZone file={bdfFile} inputRef={fileRef} disabled={!!jobId} onFile={handleFile}
                    label="글로벌 Truss BDF" accept={ACCEPT}
                    pickedNote={bdfFile?.serverSample ? '서버의 샘플 모델' : bdfFile?.sample ? '서버에 보관된 지난 입력' : parentId ? '검증 완료, 눌러서 다른 모델로 바꾸기' : '눌러서 다른 파일로 바꾸기'} />
                  {isStartScreen ? (
                    <RunStartPanel
                      programName="TrussModuleLifting"
                      onOpen={applyResultReentry}
                      onUseInput={applyRecentInput}
                      hasInput={r => !!r.input_info?.bdf_model}
                      steps={[
                        { title: '글로벌 BDF 검증', detail: 'HyperMesh 에서 내보낸 Truss 전체 BDF 를 읽어 카드와 연결을 확인하고, Studio 가 열 모델을 만듭니다.' },
                        { title: 'Studio 분할과 권상', detail: 'LV 구간과 평면, 입면 영역으로 소모듈을 자르고 질량을 다시 넣은 뒤, 권상점과 크레인 체결 높이를 정해 구조 해석합니다.' },
                        { title: '결과', detail: 'TrussAssessment 와 같은 식으로 부재 UC 를 판정하고, 발생 변위는 값만 보여 줍니다.' },
                      ]}
                    />
                  ) : !jobId && !parentId && !failed ? (
                    <p className="text-sm text-slate-600">
                      왼쪽 <strong className="font-bold text-slate-800">검증 실행</strong> 을 누르면 서버가 모델을 읽어 Studio 용 자료를 만듭니다. 큰 모델은 1~2분 걸립니다.
                    </p>
                  ) : parentId ? (
                    <p className="text-sm text-slate-600">
                      검증을 마쳤습니다. 다음은{' '}
                      <button type="button" onClick={() => setActiveIdx(STEP.studio)}
                        className="rounded font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer">
                        2. Studio 분할과 권상
                      </button>
                      {' '}입니다.
                    </p>
                  ) : null}
                </>
              )}

              {activeIdx === STEP.studio && (parentId ? (
                <>
                  <StudioLauncherCard
                    title="Truss Lifting Studio"
                    description="소모듈 분할, 질량 재구성, 권상 Wire, 자세안정성, 구조 해석을 Studio 에서 진행합니다."
                    installed={studio.installed} status={studio.status} progress={studio.progress} error={studio.error}
                    installedVersion={studio.installedVersion} latestVersion={studio.latestVersion}
                    ready={!!parentId} onLaunch={launchStudio} />
                  <section aria-labelledby="tml-studio-todo">
                    <h3 id="tml-studio-todo" className="mb-2 text-sm font-bold text-slate-800">Studio 에서 할 일</h3>
                    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {STUDIO_TODO.map(([title, detail], i) => (
                        <li key={title} className="flex gap-3 px-3 py-2.5">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">{i + 1}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{title}</p>
                            <p className="text-xs leading-relaxed text-slate-600">{detail}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </>
              ) : (
                <StepEmpty text="먼저 1단계에서 글로벌 BDF 를 검증하세요. 검증이 끝나면 여기서 Studio 를 엽니다."
                  action="1단계로" onAction={() => setActiveIdx(STEP.input)} />
              ))}

              {activeIdx === STEP.results && (fig ? (
                <>
                  <KeyFigures
                    items={[
                      { key: 'n', label: '평가 부재', value: Number(fig.evaluated ?? 0).toLocaleString(), unit: '개' },
                      { key: 'f', label: 'UC 1.0 초과', value: fig.failCount, unit: '개', tone: fig.failCount > 0 ? 'bad' : 'default' },
                      { key: 'uc', label: '최대 UC', value: fig.maxUc != null ? Number(fig.maxUc).toFixed(3) : '-',
                        sub: fig.maxUcElement != null ? `E${fig.maxUcElement}` : undefined, tone: (fig.maxUc ?? 0) > 1 ? 'bad' : 'default' },
                      { key: 'd', label: '최대 발생 변위', value: fig.maxDisplacementMm != null ? Number(fig.maxDisplacementMm).toFixed(1) : '-', unit: 'mm',
                        sub: `${fig.maxDisplacementNode != null ? `N${fig.maxDisplacementNode}, ` : ''}판정 없음` },
                      ...(fig.skipped > 0 ? [{ key: 's', label: '허용값 없어 빠진 부재', value: fig.skipped, unit: '개', tone: 'warn' }] : []),
                    ]}
                    caption="판정 = |축력/허용| + |모멘트/허용| ≤ 1.0, Property 허용값은 TrussAssessment 와 같습니다. 권상 케이스는 하중분산판, Side Support 를 판정하지 않습니다."
                  />
                  <section aria-labelledby="tml-top-uc">
                    <h3 id="tml-top-uc" className="mb-2 text-sm font-bold text-slate-800">
                      UC 큰 부재 <span className="font-semibold text-slate-500">상위 {Math.min(15, verdict.rows.length)}개</span>
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full whitespace-nowrap text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-semibold">부재</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold">Property</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">축력 (N)</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">모멘트 (N·mm)</th>
                            <th scope="col" className="px-3 py-2 text-right font-semibold">UC</th>
                            <th scope="col" className="px-3 py-2 text-left font-semibold">판정</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono tabular-nums text-slate-800">
                          {verdict.rows.slice(0, 15).map(r => {
                            const fail = r.result === 'Fail';
                            return (
                              <tr key={r.element}>
                                <td className="px-3 py-1.5">E{r.element}</td>
                                <td className="px-3 py-1.5">P{r.property}</td>
                                <td className="px-3 py-1.5 text-right">{Number(r.axial ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                <td className="px-3 py-1.5 text-right">{Number(r.bending ?? 0).toExponential(3)}</td>
                                <td className={`px-3 py-1.5 text-right font-bold ${fail ? 'text-red-700' : ''}`}>{Number(r.assessment ?? 0).toFixed(3)}</td>
                                <td className="px-3 py-1.5 font-sans">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${fail ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{fail ? '실패' : '통과'}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">부재 위치는 Studio Analysis 탭의 Truss 소모듈 평가 표에서 행을 누르면 3D 로 찾아갑니다.</p>
                  </section>
                </>
              ) : (
                <StepEmpty
                  text={parentId ? 'Studio 의 Analysis 탭에서 구조 해석을 실행하면 판정과 UC 큰 부재가 여기에 옵니다.' : '먼저 글로벌 BDF 를 검증하고 Studio 에서 구조 해석을 실행하세요.'}
                  action={parentId ? '2단계로' : '1단계로'}
                  onAction={() => setActiveIdx(parentId ? STEP.studio : STEP.input)}
                />
              ))}
            </div>
          </section>
        </main>
      </div>

      <SolverCredit contributor="권혁민" />
    </div>
  );
}

const STUDIO_TODO = [
  ['분할 탭', '평면도와 입면도에서 끌어서 소모듈 범위를 그립니다. 집중질량(Plywood t/m², Square Tube 총중량 t)도 여기서 넣습니다.'],
  ['이 소모듈로 작업 시작', '잘린 모델이 Studio 의 작업 모델이 됩니다.'],
  ['Hoist 탭', '권상점과 크레인 체결 높이(Wire 길이)를 정하고 자세안정성을 평가합니다.'],
  ['Analysis 탭', '구조 해석을 실행하면 판정이 이 화면 3. 결과 로 옵니다.'],
  ['소모듈이 여러 개면', '분할 탭에서 소모듈을 추가해 소모듈마다 권상점을 정한 뒤 [전체 해석] 을 누릅니다. 결과는 소모듈마다 따로 옵니다.'],
];

const CASE_TONE = {
  pass: 'bg-emerald-50 text-emerald-800',
  review: 'bg-amber-50 text-amber-800',
  fail: 'bg-red-50 text-red-800',
};

/** 소모듈이 여러 개일 때 — 어느 소모듈의 결과를 볼지 고른다. 판정을 색, 글자로 함께 보인다. */
function CaseTabs({ rows, active, onSelect }) {
  return (
    <div role="tablist" aria-label="소모듈" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      {rows.map(r => {
        const on = r.key === active;
        return (
          <button key={r.key} type="button" role="tab" aria-selected={on} onClick={() => onSelect(r.key)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer ${on ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
            <span className="max-w-[14rem] truncate">{r.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CASE_TONE[r.level] ?? 'bg-slate-100 text-slate-700'}`}>{r.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function ErrorCard({ title, detail, next }) {
  return (
    <section role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="break-words text-red-700">{detail}</p>
        {next && <p className="mt-1 text-xs text-red-700">{next}</p>}
      </div>
    </section>
  );
}

function StepEmpty({ text, action, onAction }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="max-w-md text-sm leading-relaxed text-slate-600">{text}</p>
      {action && (
        <button type="button" onClick={onAction}
          className="rounded text-xs font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer">
          {action}
        </button>
      )}
    </div>
  );
}
