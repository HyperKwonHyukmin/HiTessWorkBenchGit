import React, { useState, useEffect, useCallback } from 'react';
import { PenTool, ExternalLink, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import AnalysisPageBanner from '../../components/analysis/AnalysisPageBanner';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useToast } from '../../contexts/ToastContext';

// ───────────────────────────────────────────────────────────────
// Block Weld Assessment 외부 앱 접속 주소.
//   - 외부 앱(별도 개발/배포)이 설치된 서버 주소이며, 서버 배치에 따라 변경될 수 있다.
//   - 변경이 필요하면 아래 상수 한 줄만 수정하면 된다.
//   - 실행 시 로그인 사번을 경로 뒤에 붙여 호출한다 →  `${BLOCK_WELD_BASE_URL}/{사번}`
// ───────────────────────────────────────────────────────────────
const BLOCK_WELD_BASE_URL = 'http://10.14.42.145:31880';

function buildBlockWeldLaunchUrl(employeeId) {
  const url = new URL(`${BLOCK_WELD_BASE_URL}/${encodeURIComponent(employeeId)}`);
  url.searchParams.set('__wb_cache_bust', String(Date.now()));
  return url.toString();
}

// 외부 앱 서버 접속 가능 여부 확인.
// no-cors: 어떤 응답이든 오면 서버가 살아있는 것으로 간주(resolve), 연결 실패/타임아웃이면 꺼짐(reject).
async function pingUrl(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 접속 가능 여부 — 색 + 아이콘 + 텍스트로 중복 표기(색에만 의존하지 않음). 클릭 시 즉시 재확인.
const STATUS_META = {
  checking: {
    label: '확인 중',
    icon: <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />,
    cls: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 focus-visible:ring-slate-300',
  },
  online: {
    label: '사용 가능',
    icon: <CheckCircle2 size={13} />,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 focus-visible:ring-emerald-300',
  },
  offline: {
    label: '사용 불가',
    icon: <XCircle size={13} />,
    cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 focus-visible:ring-red-300',
  },
};

function StatusPill({ status, onRecheck }) {
  const meta = STATUS_META[status] || STATUS_META.checking;
  return (
    <button
      type="button"
      onClick={onRecheck}
      title="클릭하여 접속 상태 다시 확인"
      aria-label={`외부 앱 접속 상태: ${meta.label}. 클릭하여 다시 확인`}
      className={`group inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full border text-xs font-bold transition-colors cursor-pointer outline-none focus-visible:ring-2 ${meta.cls}`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      <RefreshCw size={11} className="opacity-0 group-hover:opacity-60 transition-opacity motion-reduce:transition-none" />
    </button>
  );
}

export default function BlockWeldAssessment() {
  const { employeeId } = useAuth();
  const { setCurrentMenu } = useNavigation();
  const { showToast } = useToast();
  const [status, setStatus] = useState('checking'); // 'checking' | 'online' | 'offline'

  const checkStatus = useCallback(async (showSpinner = true) => {
    if (showSpinner) setStatus('checking');
    const ok = await pingUrl(BLOCK_WELD_BASE_URL);
    setStatus(ok ? 'online' : 'offline');
  }, []);

  useEffect(() => {
    checkStatus(true);
    const id = setInterval(() => checkStatus(false), 20000); // 20초마다 silent 재확인
    return () => clearInterval(id);
  }, [checkStatus]);

  const handleLaunch = () => {
    if (!employeeId) {
      showToast('로그인 사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.', 'error');
      return;
    }
    const url = buildBlockWeldLaunchUrl(employeeId);

    if (window.electron?.invoke) {
      // WorkBench 내부의 별도 창(Electron BrowserWindow)으로 오픈 — 실행할 때마다 외부 앱 캐시를 비운다.
      window.electron.invoke('open-app-window', {
        url,
        title: 'Block Weld Assessment',
        windowKey: 'Block Weld Assessment',
        clearCache: true,
      });
    } else {
      // 개발(브라우저) 환경 fallback — 새 창/탭으로 오픈
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    showToast('Block Weld Assessment 를 WorkBench 내부 창에서 실행합니다.', 'success');
  };

  const isOffline = status === 'offline';

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <AnalysisPageBanner
        title="Block Weld Assessment"
        icon={PenTool}
        subtitle="블록 용접부 구조 평가 도구"
        onBack={() => setCurrentMenu('Interactive Apps')}
        backLabel="Interactive Apps로 돌아가기"
        gradient="from-brand-blue via-violet-900 to-violet-700"
        iconClassName="text-violet-300"
        subtitleClassName="text-violet-200/80"
      />

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* 식별 영역 — 앱 엠블럼 + 이름 + 개발 상태 */}
        <div className="flex items-start gap-5 p-7 md:p-8">
          <div
            className="shrink-0 grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-sm"
            aria-hidden="true"
          >
            <PenTool size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">Block Weld Assessment</h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                <CheckCircle2 size={12} /> 서비스 중
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              블록 전도 방지 구속 용접양 산출 수행
            </p>
          </div>
        </div>

        {/* 실행 데크 — 접속 상태 + 실행 (틴트 콜아웃, 카드 중첩 아님) */}
        <div className="border-t border-slate-100 bg-violet-50/40 px-7 md:px-8 py-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>접속 상태</span>
              <StatusPill status={status} onRecheck={() => checkStatus(true)} />
            </div>

            <button
              type="button"
              onClick={handleLaunch}
              disabled={isOffline}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl bg-violet-600 text-white text-sm font-bold shadow-sm transition-all duration-200 cursor-pointer hover:bg-violet-700 hover:shadow active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-violet-600 disabled:hover:shadow-sm disabled:active:scale-100"
            >
              <ExternalLink size={17} />
              Block Weld Assessment 실행
            </button>
          </div>

          {isOffline && (
            <p className="text-xs text-red-700 font-medium mt-3">
              외부 앱 서버에 연결할 수 없습니다. 서버 상태를 확인한 뒤 다시 시도하세요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
