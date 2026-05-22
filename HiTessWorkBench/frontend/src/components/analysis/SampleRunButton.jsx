/// <summary>
/// SampleRunButton — 신규 사용자가 입력 파일 없이 1-click 으로 사내 표준 샘플로
/// 해석을 돌려볼 수 있게 해주는 공용 버튼.
///
/// 동작:
///   - 마운트 시 GET /api/analysis/{appKey}/sample-status 로 잔여 횟수 prefetch.
///   - 클릭 시 POST /api/analysis/{appKey}/run-sample.
///   - 사번별 일일 1회 제한(관리자 무제한). 429 응답은 토스트로 정중히 안내.
///   - 작업 ID 를 받으면 onJobSubmitted(jobId) 콜백 호출 → 각 페이지의 startJob 흐름에 진입.
///   - 샘플 실행은 사용 기록(activity log) / 사용자 history / 통계 에서 모두 제외됨.
///
/// Props:
///   appKey          : 'truss' | 'assessment' | 'groupmoduleunit' | 'modelflow' | 'hpscr' ...
///   params          : (옵션) run-sample POST 시 query string 으로 붙일 객체 (예: { mode: 'PSA' })
///   disabled        : 외부 isRunning 등으로 비활성화 여부
///   onBeforeRun     : () => void — 클릭 직후 호출 (UI 상태 리셋 hook)
///   onJobSubmitted  : (jobId) => void — 작업 ID 수신 시 startJob 등 호출
///   onError         : (status, detail) => void — 429 외 에러 시 로그 등에 기록
///   label           : 기본 라벨 오버라이드 (옵션)
/// </summary>
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Sparkles } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { getAuthHeaders } from '../../utils/auth';
import { useToast } from '../../contexts/ToastContext';

export default function SampleRunButton({
  appKey,
  params,
  disabled = false,
  onBeforeRun,
  onJobSubmitted,
  onError,
  label = '샘플로 한 번 돌려보기',
}) {
  const [status, setStatus] = useState({ remaining: 1, limit: 1, is_admin: false, loaded: false });
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_BASE_URL}/api/analysis/${appKey}/sample-status`, { headers: getAuthHeaders() })
      .then(res => { if (!cancelled) setStatus({ ...res.data, loaded: true }); })
      .catch(() => { if (!cancelled) setStatus(s => ({ ...s, loaded: true })); });
    return () => { cancelled = true; };
  }, [appKey]);

  const quotaExceeded = status.loaded && !status.is_admin && status.remaining <= 0;
  const sampleDisabled = disabled || busy || quotaExceeded;
  const remainingLabel = status.is_admin
    ? '관리자 · 무제한'
    : status.loaded
      ? `오늘 ${status.remaining}/${status.limit}회 남음`
      : '잔여 확인 중...';

  const handleClick = async () => {
    if (sampleDisabled) {
      if (quotaExceeded) {
        showToast('샘플 실행은 일일 1회로 제한됩니다. 자정 이후 다시 시도해주세요.', 'info');
      }
      return;
    }
    setBusy(true);
    onBeforeRun?.();
    try {
      const qs = params && Object.keys(params).length > 0
        ? `?${new URLSearchParams(params).toString()}`
        : '';
      const res = await axios.post(
        `${API_BASE_URL}/api/analysis/${appKey}/run-sample${qs}`,
        null,
        { headers: getAuthHeaders() },
      );
      const jobId = res.data?.job_id;
      if (!jobId) throw new Error('서버로부터 Job ID를 받지 못했습니다.');
      setStatus(s => ({
        ...s,
        remaining: res.data?.remaining ?? (s.is_admin ? s.limit : 0),
      }));
      onJobSubmitted?.(jobId);
    } catch (err) {
      const st = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || '알 수 없는 오류';
      if (st === 429) {
        setStatus(s => ({ ...s, remaining: 0 }));
        showToast(detail, 'info');
      } else {
        showToast(`샘플 실행 실패: ${detail}`, 'error');
      }
      onError?.(st, detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={sampleDisabled}
        title={
          quotaExceeded
            ? '오늘 샘플 실행은 모두 사용했습니다. 자정 이후 다시 시도해주세요.'
            : '사내 표준 샘플 파일로 즉시 해석 실행 (학습용)'
        }
        className={`group w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all border-2 ${
          sampleDisabled
            ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
            : 'bg-white text-brand-blue border-brand-blue/40 hover:bg-brand-blue/5 hover:border-brand-blue cursor-pointer shadow-sm hover:shadow'
        }`}
      >
        <Sparkles size={15} className={sampleDisabled ? '' : 'group-hover:scale-110 transition-transform'} />
        <span>
          {quotaExceeded ? '오늘 샘플 실행을 모두 사용했어요' : label}
        </span>
        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${
          sampleDisabled
            ? 'bg-slate-200 text-slate-500'
            : status.is_admin
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-brand-blue/10 text-brand-blue'
        }`}>
          {remainingLabel}
        </span>
      </button>
      <p className="text-[10px] text-slate-400 text-center leading-tight">
        샘플 실행은 사용 기록으로 남지 않습니다.
      </p>
    </div>
  );
}
