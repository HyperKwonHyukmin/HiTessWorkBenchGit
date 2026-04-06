import { useEffect, useRef } from 'react';
import { getJobStatus } from '../api/analysis';

/**
 * 작업 상태 폴링 전용 커스텀 훅.
 * jobId가 null/undefined이면 폴링하지 않음.
 * jobId가 설정되면 interval 간격으로 상태를 조회하고 콜백을 호출함.
 * 컴포넌트 언마운트 또는 jobId 변경 시 폴링 자동 중단.
 * 콜백은 항상 최신 버전을 참조하도록 ref로 관리 (stale closure 방지).
 *
 * @param {object} options
 * @param {string|null} options.jobId         - 조회할 작업 ID. null이면 폴링 비활성.
 * @param {number}      options.interval      - 폴링 간격(ms). 기본값 1500.
 * @param {number}      options.maxRetries    - 최대 재시도 횟수. 기본값 120 (약 3분).
 * @param {function}    options.onProgress    - 진행 중 콜백. (data) 수신.
 * @param {function}    options.onComplete    - 완료(Success) 콜백. (data) 수신.
 * @param {function}    options.onError       - 실패/타임아웃 콜백. (data | { timeout: true }) 수신.
 */
export function usePolling({ jobId, interval = 1500, maxRetries = 120, onProgress, onComplete, onError }) {
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  // 매 렌더마다 최신 콜백으로 ref 갱신
  onProgressRef.current = onProgress;
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const retryCountRef = useRef(0);
  const timerRef = useRef(null);
  const activeJobRef = useRef(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    activeJobRef.current = jobId;
    retryCountRef.current = 0;

    const poll = async () => {
      if (activeJobRef.current !== jobId) return;

      retryCountRef.current += 1;

      if (retryCountRef.current > maxRetries) {
        if (onErrorRef.current) onErrorRef.current({ timeout: true });
        return;
      }

      try {
        const res = await getJobStatus(jobId);
        const data = res.data;

        if (activeJobRef.current !== jobId) return;

        if (data.status === 'Success') {
          if (onCompleteRef.current) onCompleteRef.current(data);
          return;
        }

        if (data.status === 'Failed') {
          if (onErrorRef.current) onErrorRef.current(data);
          return;
        }

        if (onProgressRef.current) onProgressRef.current(data);
        timerRef.current = setTimeout(poll, interval);
      } catch (err) {
        if (activeJobRef.current !== jobId) return;
        if (onErrorRef.current) onErrorRef.current({ error: err });
      }
    };

    timerRef.current = setTimeout(poll, interval);

    return () => {
      activeJobRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [jobId]);
}
