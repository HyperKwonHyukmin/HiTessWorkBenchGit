import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Grid3X3,
  Layers,
  Loader2,
  MousePointerClick,
  PackageCheck,
  Ruler,
  Sparkles,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { API_BASE_URL } from '../../config';

// 2026-05-14: PlateAnalysisStudio 의 dist/manifest.json id 와 일치해야 한다.
// 사내 스토리지 zip: plate-studio-<version>.zip — 백엔드 _find_zip 이 prefix 매칭.
const VIEWER_ID = 'plate-studio';

const PROGRESS_LABELS = {
  starting: 'Studio 다운로드 준비 중',
  downloading: 'Studio 다운로드 중',
  extracting: 'Studio 설치 파일 압축 해제 중',
  completed: 'Studio 설치 완료',
  failed: 'Studio 설치 실패',
};

const FEATURE_CARDS = [
  {
    icon: Grid3X3,
    title: 'Plate 모델링',
    desc: '판 구조 형상을 직접 모델링하고 메시 분할 설정을 조정합니다.',
  },
  {
    icon: MousePointerClick,
    title: '대화형 편집',
    desc: 'Studio UI 에서 노드·요소를 인터랙티브하게 선택·수정합니다.',
  },
  {
    icon: Cpu,
    title: '구조 해석 연계',
    desc: '모델링 결과를 Nastran 해석 파이프라인과 연동합니다.',
  },
];

export default function PlateStructureAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [status, setStatus] = useState('idle');
  const [installed, setInstalled] = useState(null);
  const [installedVersion, setInstalledVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!window.electron?.invoke) {
      setInstalled(false);
      return;
    }

    let cancelled = false;
    setStatus('checking');
    window.electron.invoke('viewer:check-installed', VIEWER_ID)
      .then((result) => {
        if (cancelled) return;
        setInstalled(!!result?.installed);
        setInstalledVersion(result?.manifest?.version ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setInstalled(false);
        setError(err?.message || 'Studio 설치 상태 확인 실패');
      })
      .finally(() => {
        if (!cancelled) setStatus('idle');
      });

    fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => {
        if (!cancelled) setLatestVersion(meta?.manifest?.version ?? null);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!window.electron?.onMessage) return undefined;
    return window.electron.onMessage('viewer:install-progress', (data) => {
      if (!data || data.viewerId !== VIEWER_ID) return;
      setProgress(data);
      if (data.phase === 'failed') setError(data.error || 'Studio 설치 실패');
    });
  }, []);

  const openStudio = useCallback(async () => {
    if (!window.electron?.invoke) {
      showToast('Electron 환경에서만 Studio를 사용할 수 있습니다.', 'error');
      return;
    }

    setError(null);
    setProgress(null);

    try {
      setStatus('checking');
      const check = await window.electron.invoke('viewer:check-installed', VIEWER_ID);
      if (check === null) throw new Error('IPC viewer:check-installed 미등록');

      const manifestRes = await fetch(`${API_BASE_URL}/api/viewers/manifest/${VIEWER_ID}`);
      if (!manifestRes.ok) throw new Error(`Studio manifest 조회 실패: HTTP ${manifestRes.status}`);
      const meta = await manifestRes.json();
      const serverVer = meta?.manifest?.version ?? null;
      const localVer = check?.manifest?.version ?? null;
      const needInstall = !check?.installed || (serverVer && localVer && serverVer !== localVer);

      setInstalled(!!check?.installed);
      setInstalledVersion(localVer);
      setLatestVersion(serverVer);

      if (needInstall) {
        showToast(!check?.installed ? 'Plate Structure Studio 설치를 시작합니다.' : 'Plate Structure Studio 업데이트를 시작합니다.', 'info');
        setStatus('installing');
        const installRes = await window.electron.invoke('viewer:install', {
          viewerId: VIEWER_ID,
          downloadUrl: `${API_BASE_URL}${meta.downloadUrl}`,
          uncPath: meta.uncPath,
          expectedSha256: meta.sha256,
        });
        if (installRes === null) throw new Error('IPC viewer:install 미등록');
        if (!installRes?.ok) throw new Error(installRes?.error || 'Studio 설치 실패');
        setInstalled(true);
        setInstalledVersion(installRes?.manifest?.version ?? serverVer);
      }

      setStatus('opening');
      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: VIEWER_ID,
        serverUrl: API_BASE_URL,
      });
      if (openRes === null) throw new Error('IPC viewer:open 미등록');
      if (!openRes?.ok) throw new Error(openRes?.error || 'Studio 오픈 실패');
      setStatus('idle');
    } catch (err) {
      const message = err?.message || 'Studio 실행 실패';
      setError(message);
      setStatus('error');
      showToast(`Plate Structure Studio 실행 실패: ${message}`, 'error');
    }
  }, [showToast]);

  const busy = status === 'checking' || status === 'installing' || status === 'opening';
  const needsInstall = installed === false || (latestVersion && installedVersion && latestVersion !== installedVersion);
  const isUpToDate = installed === true && latestVersion && installedVersion && latestVersion === installedVersion;
  const progressText = progress?.phase ? PROGRESS_LABELS[progress.phase] || progress.phase : null;

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <PageHeader
        title="Plate Structure Analysis"
        icon={Layers}
        subtitle="Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행하세요."
        accentColor="violet"
        actions={<GuideButton guideTitle="[대화형] Plate Structure Analysis — Studio" variant="dark" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        {/* 메인 카드 — Studio 실행 */}
        <section className="relative bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* 배경 장식 */}
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-violet-50 rounded-full opacity-60 pointer-events-none" aria-hidden="true" />
          <div className="absolute right-20 top-32 w-24 h-24 bg-violet-100 rounded-full opacity-40 pointer-events-none" aria-hidden="true" />

          <div className="relative p-8 border-b border-slate-100">
            <div className="flex items-start gap-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-white flex items-center justify-center shadow-md shadow-violet-200 shrink-0">
                <Layers size={32} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[10px] font-extrabold uppercase tracking-wider">
                    <Sparkles size={10} /> Interactive Studio
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                    판 구조
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Plate Structure Studio</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-2xl">
                  Studio 창을 열어 Plate 구조 모델링과 해석 작업을 진행합니다.
                  설치되어 있지 않거나 서버 배포본이 더 최신이면 버튼 클릭 시 자동으로 설치 또는 업데이트한 뒤 실행합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="relative p-8 space-y-6">
            {/* 실행 버튼 */}
            <button
              type="button"
              onClick={openStudio}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-violet-600 to-violet-700 text-white text-sm font-bold rounded-xl hover:from-violet-700 hover:to-violet-800 disabled:from-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 hover:shadow-lg hover:shadow-violet-300 disabled:shadow-none cursor-pointer"
            >
              {busy
                ? <Loader2 size={16} className="animate-spin" />
                : needsInstall
                  ? <Download size={16} />
                  : <ExternalLink size={16} />}
              {status === 'checking'
                ? 'Studio 확인 중'
                : status === 'installing'
                  ? 'Studio 설치 중'
                  : status === 'opening'
                    ? 'Studio 여는 중'
                    : needsInstall
                      ? 'Studio 설치 후 열기'
                      : 'Studio 열기'}
            </button>

            {/* 설치 진행 바 */}
            {progress && status === 'installing' && (
              <div className="max-w-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span className="font-bold">{progressText}</span>
                  <span className="font-mono font-bold">{Math.max(0, progress.progress || 0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-violet-600 transition-all"
                    style={{ width: `${Math.max(0, progress.progress || 0)}%` }}
                  />
                </div>
              </div>
            )}

            {/* 에러 표시 */}
            {error && (
              <div className="flex items-start gap-3 max-w-2xl p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 기능 하이라이트 */}
            <div className="pt-2">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-3">주요 기능</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {FEATURE_CARDS.map(({ icon: Icon, title, desc }) => (
                  <div
                    key={title}
                    className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-violet-50/40 hover:border-violet-100 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-100 text-violet-600 flex items-center justify-center mb-2.5 shadow-sm">
                      <Icon size={17} strokeWidth={2} />
                    </div>
                    <p className="text-sm font-bold text-slate-800">{title}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 사이드 패널 — Studio 상태 */}
        <aside className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 h-fit">
          <div className="flex items-center gap-2 mb-4">
            <PackageCheck size={16} className="text-violet-600" />
            <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Studio 상태</h3>
          </div>

          {/* 상태 배너 */}
          <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-4 ${
            installed === null
              ? 'bg-slate-50 border border-slate-100'
              : installed
                ? (isUpToDate
                    ? 'bg-emerald-50 border border-emerald-100'
                    : 'bg-amber-50 border border-amber-100')
                : 'bg-violet-50 border border-violet-100'
          }`}>
            {installed === null ? (
              <>
                <Loader2 size={15} className="text-slate-400 animate-spin shrink-0" />
                <span className="text-xs font-bold text-slate-500">상태 확인 중</span>
              </>
            ) : installed ? (
              isUpToDate ? (
                <>
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  <span className="text-xs font-bold text-emerald-700">최신 버전 설치됨</span>
                </>
              ) : (
                <>
                  <AlertCircle size={15} className="text-amber-600 shrink-0" />
                  <span className="text-xs font-bold text-amber-700">업데이트 필요</span>
                </>
              )
            ) : (
              <>
                <Download size={15} className="text-violet-600 shrink-0" />
                <span className="text-xs font-bold text-violet-700">설치 필요</span>
              </>
            )}
          </div>

          {/* 버전 정보 */}
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wide">설치 버전</span>
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                {installedVersion || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wide">최신 버전</span>
              <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
                {latestVersion || '—'}
              </span>
            </div>
          </div>

          {/* 도움말 */}
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
              <Ruler size={13} className="text-slate-400 mt-0.5 shrink-0" />
              <span>
                Studio 는 사내 스토리지에서 자동으로 내려받아 사용자 PC 의 로컬 캐시에 설치됩니다. 새 버전 배포 시 다음 실행에서 자동 업데이트됩니다.
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* 뒤로가기 */}
      <button
        type="button"
        onClick={() => setCurrentMenu('Interactive Apps')}
        className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-violet-700 transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
        Interactive Apps로 돌아가기
      </button>
    </div>
  );
}
