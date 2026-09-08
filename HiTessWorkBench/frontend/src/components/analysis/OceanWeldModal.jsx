import { Maximize2, ShieldCheck } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import OceanWeldPanel from './OceanWeldPanel';
import { weldSpecEquals } from '../../utils/weldSpecDefaults';

const RESULT_SCHEMA = 'module-ocean-weld/2';

const formatNumber = (value, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

function ResultBadge({ status }) {
  return (
    <Badge variant={status === 'OK' ? 'success' : 'error'} size="sm" dot>
      {status === 'OK' ? 'OK' : 'NG'}
    </Badge>
  );
}

/**
 * 과정 2의 고정 Box 안에는 핵심 판정과 모달 진입점만 둔다.
 * Excel형 상세 표는 폭이 넓으므로 이 카드 안에 직접 렌더링하지 않는다.
 */
export function OceanWeldResultLauncher({ weld, weldSpec, onOpen }) {
  const summary = weld?.summary;
  const stale = Boolean(weld) && (
    weld.schema !== RESULT_SCHEMA || !weldSpecEquals(weldSpec, weld.spec)
  );

  return (
    <section className={`rounded-xl border px-4 py-3 ${
      summary?.status === 'NG' && !stale
        ? 'border-red-300 bg-red-50'
        : 'border-slate-200 bg-slate-50'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            summary?.status === 'NG' && !stale ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
          }`}>
            <ShieldCheck size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold text-slate-800">정반 Leg 용접부 강도 평가</h4>
              {stale
                ? <Badge variant="warning" size="sm" dot>재평가 필요</Badge>
                : summary && <ResultBadge status={summary.status} />}
            </div>
            <p className="mt-0.5 text-[10px] text-slate-600">
              상세 입력, 용접 배치도 및 Case / Boundary 결과는 별도 창에서 확인합니다.
            </p>
          </div>
        </div>

        <Button type="button" variant="primary" size="sm" onClick={onOpen}>
          <Maximize2 size={13} /> 상세 평가 보기
        </Button>
      </div>

      {summary && !stale && (
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-slate-200 pt-3 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] text-slate-500">Maximum Equivalent</dt>
            <dd className="font-mono text-xs font-bold text-slate-800">
              {formatNumber(summary.maxSigmaEqMPa)} MPa
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-slate-500">Allowable</dt>
            <dd className="font-mono text-xs font-bold text-slate-800">
              {formatNumber(summary.allowableMPa)} MPa
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-slate-500">Usage</dt>
            <dd className={`font-mono text-xs font-bold ${
              summary.maxUsage > 1 ? 'text-red-700' : 'text-slate-800'
            }`}>
              {formatNumber(summary.maxUsage, 3)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-slate-500">Governing Boundary</dt>
            <dd className="text-xs font-bold text-slate-800">Leg {summary.governingLegIndex}</dd>
          </div>
        </dl>
      )}

      {!summary && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-slate-600">
          상세 평가 창을 열면 현재 Leg 반력과 용접 사양으로 판정을 준비합니다.
        </p>
      )}
    </section>
  );
}

export default function OceanWeldModal({
  open, onClose, legReaction, weld, weldSpec, onSpecChange, onWeldResult, onOpenLegModel,
}) {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="과정 2 · 정반 Leg 용접부 강도 평가"
      size="screen"
    >
      <div className="min-h-full bg-slate-50 p-4 sm:p-5">
        <OceanWeldPanel
          legReaction={legReaction}
          weld={weld}
          weldSpec={weldSpec}
          onSpecChange={onSpecChange}
          onWeldResult={onWeldResult}
          onOpenLegModel={onOpenLegModel}
        />
      </div>
    </Modal>
  );
}
