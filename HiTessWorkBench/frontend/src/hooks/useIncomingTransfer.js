import { useDashboard } from '../contexts/DashboardContext';

/**
 * 크로스앱 데이터 전달 수신 훅.
 * targetAppTitle과 일치하는 pendingJobTransfer가 있을 때만 반환한다.
 */
export function useIncomingTransfer(targetAppTitle) {
  const { pendingJobTransfer, clearPendingJobTransfer } = useDashboard();
  const incomingTransfer = pendingJobTransfer?.targetApp === targetAppTitle
    ? pendingJobTransfer
    : null;
  return { incomingTransfer, clearPendingJobTransfer };
}
