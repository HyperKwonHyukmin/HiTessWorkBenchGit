// 이중관 배관응력 해석(PSA)의 진행 추적 공용 유틸.
// 페이지(DoublePipeFuelLineAssessment)와 전역 위젯(DoublePipePsaTray)이 공유한다.
//
// 백엔드 GET /api/doublepipe/active 가 라이센스 점유·재연결의 단일 진실원이지만,
// "지금 내가 지켜볼 실행 작업이 있는가"를 클라이언트가 싸게 판단하도록 localStorage 힌트를 둔다.
// 힌트가 없으면 트레이는 네트워크 폴링을 하지 않는다(불필요한 전역 폴링 방지).

// 이 페이지의 메뉴 이름(NavigationContext 라우팅 키). 트레이가 "현재 이 페이지인가"를 판별한다.
export const PSA_PAGE_MENU = '이중관 구조 연료배관 해석';

const HINT_KEY = 'doublepipe:psa-active';
// 힌트 변경(시작/해제)을 같은 탭 내 다른 컴포넌트에 즉시 알리는 커스텀 이벤트.
export const PSA_HINT_EVENT = 'doublepipe:psa-changed';

export function readPsaHint() {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.jobId ? parsed : null;
  } catch {
    return null;
  }
}

export function writePsaHint(hint) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify(hint));
  } catch {
    // localStorage 접근 불가 환경 — 무시(백엔드 /active 가 최종 진실원)
  }
  try {
    window.dispatchEvent(new Event(PSA_HINT_EVENT));
  } catch {
    // ignore
  }
}

export function clearPsaHint() {
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new Event(PSA_HINT_EVENT));
  } catch {
    // ignore
  }
}

// 경과 초 → HH:MM:SS(1시간 이상) 또는 MM:SS. 타이머 표시 공용 포맷.
export function formatElapsed(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
