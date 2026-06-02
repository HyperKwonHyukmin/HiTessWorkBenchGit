import { useState, useRef, useCallback, useEffect } from 'react';
import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';

/**
 * 해석 작업의 공통 상태(폴링/로그/진행률/사번)를 한 곳에서 관리하는 훅.
 *
 * 7개 해석 페이지가 각자 똑같이 반복하던
 *   - isRunning, progress, statusMessage, logs, currentPollingJobId useState
 *   - localStorage.user 에서 employee_id 추출
 *   - usePolling(onProgress: 진행률+메시지 갱신, 메시지 변경 시 로그 추가)
 *   - onComplete: isRunning=false, progress=100, jobId=null + 페이지별 결과 처리
 *   - onError:    isRunning=false, jobId=null + 페이지별 에러 표시
 * 패턴을 표준화한 결과물이다.
 *
 * 페이지별로 다른 결과/에러 처리는 onComplete/onError 콜백으로 위임한다.
 *
 * @param {object}   options
 * @param {function} options.onComplete       - 완료(Success) 시 호출. (data) 인자 수신.
 * @param {function} options.onError          - 실패/타임아웃 시 호출. (errData) 인자 수신.
 * @param {function} options.startGlobalJob   - DashboardContext.startGlobalJob (선택).
 *                                              startJob 호출 시 programLabel 과 함께 전달하면 자동 호출.
 * @param {string}   options.successLogMessage- onComplete 직전 logs 에 추가할 메시지.
 *                                              기본값 '해석 완료.' 빈 문자열 전달 시 추가 안 함.
 * @param {string}   options.errorLogMessage  - onError 시 logs 에 추가할 메시지 (일반 실패).
 *                                              기본값 '해석 실패.' 빈 문자열 전달 시 추가 안 함.
 * @param {string}   options.timeoutLogMessage- onError + errData.timeout 시 logs 에 추가할 메시지.
 *                                              페이지별 폴링 시간이 다르므로 커스터마이즈 가능.
 * @param {number}   options.pollingInterval  - 폴링 간격(ms). usePolling 기본값 1500 사용.
 * @param {number}   options.pollingMaxRetries- 최대 폴링 횟수. usePolling 기본값 120 사용.
 *
 * @returns {object}
 *   - jobId, isRunning, progress, statusMessage, logs - 상태
 *   - employeeId                                       - localStorage 기반 현재 사번
 *   - addLog(message, type='info')                     - 로그 한 줄 추가
 *   - startJob(newJobId, programLabel?)                - 큐 등록 후 폴링 시작
 *                                                        (programLabel 있고 startGlobalJob 옵션 있으면 자동 호출)
 *   - reset()                                          - 상태 전체 초기화
 *   - setLogs, setProgress, setStatusMessage, setIsRunning, setJobId - 페이지별 미세 제어용 setter
 */
export function useAnalysisJob({
  onComplete,
  onError,
  startGlobalJob,
  savedState,
  setSavedState,
  successLogMessage = '해석 완료.',
  errorLogMessage = '해석 실패.',
  timeoutLogMessage = '해석 시간 초과. 서버 상태를 확인하세요.',
  pollingInterval,
  pollingMaxRetries,
} = {}) {
  const savedJob = savedState?.job || {};
  const [jobId, setJobId] = useState(savedJob.jobId ?? null);
  const [isRunning, setIsRunning] = useState(savedJob.isRunning ?? false);
  const [progress, setProgress] = useState(savedJob.progress ?? 0);
  const [statusMessage, setStatusMessage] = useState(savedJob.statusMessage ?? '');
  const [logs, setLogs] = useState(savedJob.logs ?? []);

  // 동일 메시지 중복 로그 방지용 — 메시지가 바뀔 때만 로그를 한 줄 추가한다.
  const lastMessageRef = useRef('');

  // AuthContext 에서 사번을 받는다. 비로그인 / 게스트 상태 fallback 은 'guest'.
  const { employeeId: authEmployeeId } = useAuth();
  const employeeId = authEmployeeId || 'guest';

  const addLog = useCallback((message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  }, []);

  const reset = useCallback(() => {
    setJobId(null);
    setIsRunning(false);
    setProgress(0);
    setStatusMessage('');
    setLogs([]);
    lastMessageRef.current = '';
  }, []);

  // 콜백/옵션을 ref 로 보관해서 startJob 의 의존성을 가볍게 유지.
  const startGlobalJobRef = useRef(startGlobalJob);
  startGlobalJobRef.current = startGlobalJob;

  const startJob = useCallback((newJobId, programLabel) => {
    setJobId(newJobId);
    setIsRunning(true);
    setProgress(0);
    setStatusMessage('서버 요청 중...');
    lastMessageRef.current = '';
    if (programLabel && startGlobalJobRef.current) {
      startGlobalJobRef.current(newJobId, programLabel);
    }
  }, []);

  const setSavedStateRef = useRef(setSavedState);
  setSavedStateRef.current = setSavedState;

  useEffect(() => {
    if (!setSavedStateRef.current) return;
    setSavedStateRef.current({
      job: { jobId, isRunning, progress, statusMessage, logs },
    });
  }, [jobId, isRunning, progress, statusMessage, logs]);

  // usePolling 콜백은 항상 최신 클로저를 봐야 하므로 ref 로 보관.
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  usePolling({
    jobId,
    interval: pollingInterval,
    maxRetries: pollingMaxRetries,
    onProgress: (data) => {
      const { progress: p, message } = data;
      setProgress(p);
      setStatusMessage(message || '');
      if (message && message !== lastMessageRef.current) {
        lastMessageRef.current = message;
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          message: `[${p}%] ${message}`,
          type: 'warning',
        }]);
      }
    },
    onComplete: (data) => {
      setIsRunning(false);
      setProgress(100);
      setJobId(null);
      if (successLogMessage) {
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          message: successLogMessage,
          type: 'success',
        }]);
      }
      if (onCompleteRef.current) onCompleteRef.current(data);
    },
    onError: (errData) => {
      setIsRunning(false);
      setJobId(null);
      const isTimeout = !!errData?.timeout;
      const msg = isTimeout ? timeoutLogMessage : errorLogMessage;
      if (msg) {
        setLogs(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          message: msg,
          type: 'error',
        }]);
      }
      if (onErrorRef.current) onErrorRef.current(errData);
    },
  });

  return {
    // 상태
    jobId, isRunning, progress, statusMessage, logs,
    // 사용자
    employeeId,
    // 액션
    addLog, startJob, reset,
    // 미세 제어용 setter (페이지별 결과 처리 시 필요)
    setLogs, setProgress, setStatusMessage, setIsRunning, setJobId,
  };
}
