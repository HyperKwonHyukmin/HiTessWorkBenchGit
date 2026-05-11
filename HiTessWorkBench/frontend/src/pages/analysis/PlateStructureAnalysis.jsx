import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Download,
  ExternalLink,
  Layers,
  Loader2,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import GuideButton from '../../components/ui/GuideButton';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';
import { API_BASE_URL } from '../../config';

const VIEWER_ID = 'plate-structure-studio';

const PROGRESS_LABELS = {
  starting: 'Studio 다운로드 준비 중',
  downloading: 'Studio 다운로드 중',
  extracting: 'Studio 설치 파일 압축 해제 중',
  completed: 'Studio 설치 완료',
  failed: 'Studio 설치 실패',
};

export default function PlateStructureAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [status, setStatus] = useState('idle');
  const [installed, setInstalled] = useState(null);
  const [installedVersion, setInstalledVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [installDir, setInstallDir] = useState(null);
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
        setInstallDir(result?.dir ?? null);
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
      setInstallDir(check?.dir ?? null);

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
        setInstallDir(installRes?.dir ?? null);
      }

      setStatus('opening');
      const openRes = await window.electron.invoke('viewer:open', {
        viewerId: VIEWER_ID,
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
  const progressText = progress?.phase ? PROGRESS_LABELS[progress.phase] || progress.phase : null;

  return (
    <div className="max-w-7xl mx-auto pb-16">
      <PageHeader
        title="Plate Structure Analysis"
        icon={Layers}
        subtitle="Plate 구조 해석용 Studio를 실행하여 판 구조 모델링 및 해석 작업을 진행하세요."
        accentColor="emerald"
        actions={<GuideButton guideTitle="[대화형] Plate Structure Analysis — Studio" variant="dark" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-100">
            <div className="w-14 h-14 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-5">
              <Layers size={30} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Plate Structure Studio</h2>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-2xl">
              Studio 창을 열어 Plate 구조 모델링과 해석 작업을 진행합니다. 설치되어 있지 않거나 서버 배포본이 더 최신이면 버튼 클릭 시 자동으로 설치 또는 업데이트한 뒤 실행합니다.
            </p>
          </div>

          <div className="p-8 space-y-5">
            <button
              type="button"
              onClick={openStudio}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : needsInstall ? <Download size={16} /> : <ExternalLink size={16} />}
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

            {progress && status === 'installing' && (
              <div className="max-w-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span>{progressText}</span>
                  <span>{Math.max(0, progress.progress || 0)}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.max(0, progress.progress || 0)}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 max-w-2xl p-4 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </section>

        <aside className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 h-fit">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Studio 상태</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">설치 상태</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                {installed ? <CheckCircle size={14} className="text-emerald-500" /> : <AlertCircle size={14} className="text-amber-500" />}
                {installed ? '설치됨' : '미설치'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">설치 버전</span>
              <span className="font-mono text-xs text-slate-700">{installedVersion || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">최신 버전</span>
              <span className="font-mono text-xs text-slate-700">{latestVersion || '-'}</span>
            </div>
            {installDir && (
              <div className="pt-3 border-t border-slate-100">
                <span className="block text-slate-500 mb-1">설치 경로</span>
                <span className="block text-xs text-slate-600 break-all">{installDir}</span>
              </div>
            )}
          </div>
        </aside>
      </div>

      <button
        type="button"
        onClick={() => setCurrentMenu('Interactive Apps')}
        className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
        Interactive Apps로 돌아가기
      </button>
    </div>
  );
}
