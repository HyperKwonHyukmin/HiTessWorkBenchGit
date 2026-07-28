// 이중관 배관응력 해석(PSA) 전역 진행 위젯.
//
// 해석 실행 중 사용자가 페이지를 벗어나도(대시보드 등) 우측 하단에 경과시간 카드를 띄우고,
// 클릭하면 해석 화면으로 복귀시킨다. 기존 GlobalJobTray(표준 /api/analysis/status, progress%)와는
// 상태 체계가 달라 독립 컴포넌트로 둔다(다른 앱에 영향 없음).
//
// 동작: localStorage 힌트(내가 시작한 실행 작업)가 있을 때만 백엔드 /api/doublepipe/active 를
// 폴링한다. 힌트가 없으면 네트워크를 쓰지 않는다(3초 idle 하트비트로 힌트 등장만 감시).
// /active 가 "내 작업이 여전히 running" 임을 확인하면 경과시간을 갱신하고, 아니면 카드/힌트를 정리한다.
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ArrowUpRight, Clock, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import {
  PSA_PAGE_MENU,
  PSA_HINT_EVENT,
  readPsaHint,
  clearPsaHint,
  formatElapsed,
} from '../../utils/doublePipePsa';

// NavigationContext 의 resume 키 — 트레이 클릭으로 복귀할 때 페이지 상태 초기화(fresh-entry)를
// 건너뛰게 해 진행 상태가 유지되도록 GlobalJobCard 와 동일한 신호를 남긴다.
const RESUME_ENTRY_KEY = 'workbench:analysis-menu-resume-entry';

const ACTIVE_POLL_MS = 2500;  // 힌트 있을 때 /active 폴링 주기
const IDLE_POLL_MS = 3000;    // 힌트 없을 때 힌트 등장 감시(네트워크 없음)

export default function DoublePipePsaTray({
  currentMenu,
  onNavigate,
  embedded = false,
  onActiveChange,
}) {
  const { employeeId } = useAuth();
  // job: { jobId, anchor } — anchor 는 클라 epoch(초). 경과 = now - anchor (서버 시계오차 보정됨).
  const [job, setJob] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer = null;

    const schedule = (ms) => {
      if (!stopped) timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      const hint = readPsaHint();
      if (!hint?.jobId) {
        setJob((prev) => (prev ? null : prev));
        schedule(IDLE_POLL_MS); // 네트워크 없이 힌트 등장만 감시
        return;
      }
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/doublepipe/active`);
        if (stopped) return;
        const mine =
          data.active &&
          data.jobId === hint.jobId &&
          String(data.employeeId || '') === String(employeeId || '');
        if (mine) {
          setJob({ jobId: data.jobId, anchor: Date.now() / 1000 - (data.elapsedSec || 0) });
        } else {
          setJob(null);
          // 내 작업이 더 이상 라이센스를 점유하지 않음(완료/중단/타사용자 교체) → 힌트 정리
          if (!data.active || data.jobId !== hint.jobId) clearPsaHint();
        }
      } catch {
        // 일시 오류 — 카드 유지, 다음 주기 재시도
      }
      schedule(ACTIVE_POLL_MS);
    };

    poll();

    const onHintChange = () => {
      if (stopped) return;
      clearTimeout(timer);
      poll(); // 힌트 변경 즉시 반영
    };
    window.addEventListener(PSA_HINT_EVENT, onHintChange);
    window.addEventListener('storage', onHintChange);

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener(PSA_HINT_EVENT, onHintChange);
      window.removeEventListener('storage', onHintChange);
    };
  }, [employeeId]);

  const showCard = !!job && (embedded || currentMenu !== PSA_PAGE_MENU);

  useEffect(() => {
    onActiveChange?.(!!job);
  }, [job, onActiveChange]);

  // 카드가 보일 때만 1초 틱으로 경과시간 갱신.
  useEffect(() => {
    if (!showCard) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [showCard]);

  if (!showCard) return null;

  const elapsed = Date.now() / 1000 - job.anchor;

  const handleReturn = () => {
    try {
      sessionStorage.setItem(
        RESUME_ENTRY_KEY,
        JSON.stringify({ menu: PSA_PAGE_MENU, jobId: job.jobId, at: Date.now() }),
      );
    } catch {
      // ignore
    }
    onNavigate?.(PSA_PAGE_MENU);
  };

  return (
    <div className={embedded ? 'w-full' : 'fixed bottom-4 right-4 z-[99998] w-[min(320px,calc(100vw-2rem))]'}>
      <div
        onClick={handleReturn}
        title="클릭하여 배관응력 해석 화면으로 돌아가기"
        className="animate-fade-in-up cursor-pointer rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-all hover:border-sky-500"
      >
        <div className="flex items-center gap-2">
          <RefreshCw size={13} className="shrink-0 animate-spin text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-slate-300">
            이중관 배관응력 해석
          </span>
          <ArrowUpRight size={14} className="shrink-0 text-slate-500" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Clock size={16} className="shrink-0 text-sky-400" />
          <span className="font-mono text-lg font-black tabular-nums text-white">
            {formatElapsed(elapsed)}
          </span>
          <span className="ml-auto text-[10px] font-semibold text-slate-400">최대 1시간</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
          해석 진행 중 · 클릭하면 화면으로 돌아갑니다
        </p>
      </div>
    </div>
  );
}
