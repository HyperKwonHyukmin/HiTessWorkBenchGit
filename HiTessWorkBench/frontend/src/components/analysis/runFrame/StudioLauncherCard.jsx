import React from 'react';
import { AlertCircle, Download, ExternalLink, Loader2 } from 'lucide-react';

/**
 * 공통 틀 — Studio 열기 카드. 설치 상태는 배지 한 개, 버튼은 보조 버튼 한 개로만 보여 준다.
 * (예전엔 앱마다 그라데이션 카드·상태별 색 테두리·기능 소개 칸을 따로 만들었다.)
 * 주 행동으로 'Studio 열기'를 밀어야 할 때는 이 카드 대신 NextActionBar 의 주 버튼이 같은 핸들러를 부른다.
 *
 * installed:  true | false | null(확인 전)
 * status:     'idle' | 'checking' | 'installing' | 'opening' | 'error'
 * ready:      열 수 있는 입력(산출 폴더 등)이 준비됐는가
 * locked:     다른 작업이 끝나기를 기다리는 중(편집 적용 등)
 */
export default function StudioLauncherCard({
  title, description, children,
  installed, status, progress, error, installedVersion, latestVersion,
  ready = true, locked = false, notReadyTitle, lockedTitle, onLaunch,
}) {
  const installing = status === 'installing';
  const checking = status === 'checking';
  const opening = status === 'opening';
  // 버전 일치 판단 — 둘 다 알 때만 비교. 한쪽이라도 null 이면 판단 보류.
  const versionMismatch = !!(installedVersion && latestVersion && installedVersion !== latestVersion);
  const notInstalled = installed === false;

  const badge = notInstalled
    ? { text: '미설치 · 처음 열 때 자동 설치', cls: 'bg-slate-100 text-slate-700' }
    : versionMismatch
      ? { text: `업데이트 필요 · v${installedVersion} → v${latestVersion}`, cls: 'bg-amber-100 text-amber-900' }
      : installed === true
        ? { text: `설치됨 · v${installedVersion ?? latestVersion ?? '?'}`, cls: 'bg-emerald-50 text-emerald-800' }
        : { text: '설치 확인 중…', cls: 'bg-slate-100 text-slate-700' };

  const busy = installing || checking || opening;
  const buttonLabel = installing
    ? `설치 중 ${progress?.progress ?? 0}%`
    : checking ? '확인 중…'
      : opening ? '여는 중…'
        : notInstalled ? 'Studio 설치 후 열기'
          : versionMismatch ? '업데이트 후 열기' : 'Studio 열기';

  return (
    <section aria-label={title} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ExternalLink size={15} className="shrink-0 text-slate-600" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.text}</span>
        <button
          type="button"
          onClick={onLaunch}
          disabled={!ready || busy || locked}
          title={locked ? lockedTitle : !ready ? notReadyTitle : undefined}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {busy
            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            : notInstalled || versionMismatch ? <Download size={13} aria-hidden="true" /> : <ExternalLink size={13} aria-hidden="true" />}
          {buttonLabel}
        </button>
      </div>
      {description && <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{description}</p>}
      {children}
      {error && (
        <p role="alert" className="mt-1.5 flex items-start gap-1 text-xs text-red-700">
          <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
    </section>
  );
}
