/**
 * @fileoverview 결과 파일 보관 연장·핀 다이얼로그.
 *
 *  - 연장: 30일 / 90일 선택. 남은 한도(EXTENSION_MAX_DAYS - extension_used_days)를 초과하는
 *    선택지는 비활성. 한도 0 이면 선택지 전체 비활성 + 안내 문구.
 *  - 핀: 별도 체크박스. 저장 시 pinned=true/false 가 함께 전송된다(변경 없으면 null).
 *  - 만료 임박/여유는 상태 배지로, 실제 만료일은 절대 시각으로 표시한다.
 *
 * 서버 계약(POST /api/analysis/{id}/retention):
 *   { extend_days: 30 | 90 | null, pinned: true | false | null }
 * 성공 응답은 갱신된 project 객체 — 부모가 이 값을 그대로 행에 반영한다.
 *
 * ⚠ 이 컴포넌트는 부모가 **항상 마운트**해 두고 isOpen 으로만 여닫는다(모달 닫힘 애니메이션 유지).
 *    그래서 useState 초기값만으로는 다른 프로젝트를 열었을 때 직전 선택이 남는다 —
 *    대상이 바뀌면 **렌더 중 대입**으로 즉시 초기화한다(useEffect 는 paint 뒤라 한 박자 늦는다).
 */
import React, { useMemo, useState } from 'react';
import { CalendarPlus, Pin, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import { useToast } from '../../contexts/ToastContext';
import { updateAnalysisRetention } from '../../api/analysis';

const EXTEND_CHOICES = [30, 90];
const EXTENSION_MAX_DAYS = 180;

const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

/** 남은 연장 한도 — 서버가 주지 않으면(구 응답) 상한을 그대로 쓴다. */
const remainingOf = (retention) => (
  Number.isFinite(retention?.extension_remaining_days)
    ? retention.extension_remaining_days
    : EXTENSION_MAX_DAYS
);

const defaultChoiceOf = (retention) => {
  const remaining = remainingOf(retention);
  return EXTEND_CHOICES.find(d => d <= remaining) ?? null;
};

export default function RetentionExtendDialog({ isOpen, project, onClose, onUpdated }) {
  const { showToast } = useToast();
  const retention = project?.retention ?? {};
  const remaining = remainingOf(retention);
  const usedDays = Number.isFinite(retention.extension_used_days)
    ? retention.extension_used_days
    : 0;

  const [selectedDays, setSelectedDays] = useState(() => defaultChoiceOf(retention));
  const [pinChecked, setPinChecked] = useState(Boolean(retention.pinned));
  const [submitting, setSubmitting] = useState(false);
  // 현재 폼이 어떤 대상(프로젝트)을 기준으로 초기화됐는지. null = 닫힌 상태.
  const [syncedTargetId, setSyncedTargetId] = useState(null);

  // ── 대상이 바뀌면 렌더 중에 폼을 초기화한다 ──
  const targetId = isOpen && project ? project.id : null;
  if (targetId !== syncedTargetId) {
    setSyncedTargetId(targetId);
    setSelectedDays(defaultChoiceOf(retention));
    setPinChecked(Boolean(retention.pinned));
    setSubmitting(false);
  }

  const hasChange = useMemo(() => {
    const wantsExtend = selectedDays != null;
    const wantsPinToggle = pinChecked !== Boolean(retention.pinned);
    return wantsExtend || wantsPinToggle;
  }, [selectedDays, pinChecked, retention.pinned]);

  if (!isOpen || !project) return null;

  const handleSubmit = async () => {
    if (!hasChange || submitting) return;
    setSubmitting(true);
    try {
      const res = await updateAnalysisRetention(project.id, {
        extendDays: selectedDays,
        // 다이얼로그 첫 진입 시 값과 같으면 서버에는 null 을 보내 '변경 없음' 으로 한다.
        pinned: pinChecked === Boolean(retention.pinned) ? null : pinChecked,
      });
      showToast('보관 정책이 갱신되었습니다.', 'success', 4000);
      onUpdated?.(res.data);
      onClose?.();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || '보관 정책 갱신에 실패했습니다.';
      const tone = status === 400 || status === 409 ? 'warning' : 'error';
      showToast(String(detail), tone, 6000);
    } finally {
      setSubmitting(false);
    }
  };

  const cannotExtend = remaining <= 0;
  const alreadyExpired = retention.status === 'expired';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="결과 파일 보관 연장 / 핀" size="sm">
      <div className="space-y-5 p-5">
        <section className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">현재 상태</span>
            <StatusBadge status={retention.status || 'available'} size="sm" />
          </div>
          <div className="flex items-baseline justify-between">
            <span>만료 예정</span>
            <span className="font-mono text-slate-800">
              {retention.pinned ? '영구 보관(핀)' : formatDate(retention.expires_at)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span>누적 연장</span>
            <span className="font-mono text-slate-800">
              {usedDays}일 / {EXTENSION_MAX_DAYS}일 (남은 한도 {remaining}일)
            </span>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            보관 연장
          </h4>
          {alreadyExpired ? (
            <p className="text-xs text-slate-500">파일이 이미 만료되어 연장할 수 없습니다.</p>
          ) : cannotExtend ? (
            <p className="text-xs text-amber-700">
              누적 연장 한도 {EXTENSION_MAX_DAYS}일을 이미 사용했습니다. 추가 연장이 필요하면 관리자에게 문의하세요.
            </p>
          ) : (
            <div className="flex gap-2">
              {EXTEND_CHOICES.map(days => {
                const disabled = days > remaining;
                const active = selectedDays === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSelectedDays(active ? null : days)}
                    disabled={disabled}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title={disabled ? '남은 한도 초과' : `${days}일 연장`}
                  >
                    <CalendarPlus size={14} className="mr-1.5 inline" />
                    {days}일
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            영구 보관 핀
          </h4>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={pinChecked}
              onChange={(e) => setPinChecked(e.target.checked)}
              disabled={alreadyExpired}
              className="h-4 w-4 rounded border-slate-300"
            />
            <div className="flex-1">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <Pin size={13} />
                자동 삭제에서 제외
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                핀을 걸면 기본 보관 기간·연장과 무관하게 파일이 보존됩니다. 언제든 해제할 수 있습니다.
              </p>
            </div>
          </label>
        </section>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            <X size={14} /> 취소
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!hasChange || submitting || alreadyExpired}
            isLoading={submitting}
          >
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
