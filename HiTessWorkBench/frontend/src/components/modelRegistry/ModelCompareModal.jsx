import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { Badge, Button, Modal } from '../ui';
import RegistryModelPreview3D from './RegistryModelPreview3D';
import { QualityBadge } from './QualityLevelGuide';
import {
  formatNumber,
  formatUtilization,
  outcomeInfo,
} from '../../utils/modelRegistryUtils';

/**
 * 두 모델 비교.
 *
 * 정직성 규칙:
 * - 한쪽이라도 값이 없으면 차이를 계산하지 않고 '비교 불가' 로 표시한다(0 으로 두지 않는다).
 * - 길이 단위가 다르면 형상 비교를 막고 경고한다 — 환산해서 같은 것처럼 보이게 하지 않는다.
 * - 차이는 절대값과 비율을 함께 낸다.
 */
export default function ModelCompareModal({ isOpen, onClose, left, right }) {
  if (!left || !right) return null;

  const a = extract(left);
  const b = extract(right);
  const unitMismatch = a.lengthUnit && b.lengthUnit && a.lengthUnit !== b.lengthUnit;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="모델 비교" size="full"
      footer={<div className="flex justify-end"><Button onClick={onClose}>닫기</Button></div>}
    >
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <ModelHead model={left} data={a} />
          <ModelHead model={right} data={b} />
        </div>

        {/*
          형상을 나란히 둔다.
          "노드 9,893 vs 8,102" 로는 두 모델이 같은 계열인지조차 알 수 없다.
          비교의 첫 질문은 대개 "생김새가 비슷한가"이고, 그건 숫자가 답하지 못한다.
        */}
        <div className="grid grid-cols-2 gap-3">
          <div className="h-[260px]">
            <RegistryModelPreview3D
              modelUid={left.model_uid}
              revision={left.revisions?.[0]?.revision_no}
              active={isOpen}
            />
          </div>
          <div className="h-[260px]">
            <RegistryModelPreview3D
              modelUid={right.model_uid}
              revision={right.revisions?.[0]?.revision_no}
              active={isOpen}
            />
          </div>
        </div>
        {unitMismatch && (
          <p className="text-[11px] text-amber-700">
            ⚠ 두 뷰는 각자의 크기에 맞춰 화면을 채웁니다 —
            단위가 다르므로 <b>보이는 크기로 실제 치수를 비교하지 마세요.</b>
          </p>
        )}

        {unitMismatch && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">길이 단위가 다릅니다 ({a.lengthUnit} vs {b.lengthUnit}).</p>
              <p className="mt-0.5 text-xs">
                형상 수치를 직접 비교하지 않습니다. 임의 환산은 잘못된 결론으로 이어집니다.
              </p>
            </div>
          </div>
        )}

        <Section title="형상">
          <CompareRow label="노드 수" a={a.nodeCount} b={b.nodeCount} />
          <CompareRow label="요소 수" a={a.elementCount} b={b.elementCount} />
          <CompareRow label="강체 요소" a={a.rigidCount} b={b.rigidCount} />
          <CompareRow label="집중 질량" a={a.pointMassCount} b={b.pointMassCount} />
          <CompareRow
            label={`최대 치수${a.lengthUnit ? ` (${a.lengthUnit})` : ''}`}
            a={a.span} b={b.span} digits={0} blocked={unitMismatch}
          />
        </Section>

        <Section title="물성">
          <CompareRow label="총 질량 (kg)" a={a.totalMassKg} b={b.totalMassKg} digits={1} />
          <CompareRow label="CONM2 합" a={a.pointMassSum} b={b.pointMassSum} digits={1} />
        </Section>

        <Section title="모델 품질" caption="설계 결과와 별개 축입니다.">
          <CompareRow label="미참조 GRID" a={a.orphan} b={b.orphan} lowerIsBetter />
          <CompareRow label="고립 GRID" a={a.isolated} b={b.isolated} lowerIsBetter />
          <CompareRow label="영길이 요소" a={a.zeroLength} b={b.zeroLength} lowerIsBetter />
          <CompareRow label="분리 그룹" a={a.disconnected} b={b.disconnected} lowerIsBetter />
          <CompareRow label="짧은 요소" a={a.shortElement} b={b.shortElement} lowerIsBetter />
        </Section>

        <Section title="설계 결과" caption="미통과 모델도 회귀 예제로 가치가 있습니다.">
          <CompareRow label="최대 응력 (MPa)" a={a.maxStress} b={b.maxStress} digits={1} lowerIsBetter />
          <CompareRow label="허용 응력 (MPa)" a={a.allowable} b={b.allowable} digits={1} />
          <CompareRow label="사용률" a={a.utilization} b={b.utilization} percent lowerIsBetter />
          <CompareRow label="초과 부재" a={a.exceed} b={b.exceed} lowerIsBetter />
        </Section>

        <Section title="요소 구성">
          <BreakdownCompare a={a.elementBreakdown} b={b.elementBreakdown} />
        </Section>
      </div>
    </Modal>
  );
}

function extract(model) {
  const rev = model.revisions?.[0] ?? {};
  const s = rev.summary_json ?? {};
  const g = s.geometry ?? {};
  const q = s.modelQuality ?? {};
  const o = s.analysisOutcome ?? {};
  const p = s.physicalProperties ?? {};
  const bbox = g.boundingBox;

  let span = null;
  if (bbox) {
    const dims = [
      bbox.xMax - bbox.xMin,
      bbox.yMax - bbox.yMin,
      bbox.zMax - bbox.zMin,
    ].map(Math.abs);
    span = dims.every((d) => Number.isFinite(d)) ? Math.max(...dims) : null;
  }

  return {
    qualityLevel: rev.quality_level,
    designOutcome: rev.design_outcome,
    lengthUnit: (s.units ?? {}).length ?? null,
    nodeCount: g.nodeCount ?? null,
    elementCount: g.elementCount ?? null,
    rigidCount: g.rigidElementCount ?? null,
    pointMassCount: g.pointMassCount ?? null,
    span,
    totalMassKg: p.totalMassKg ?? null,
    pointMassSum: p.pointMassSumRaw ?? null,
    orphan: q.orphanNodeCount ?? null,
    isolated: q.isolatedNodeCount ?? null,
    zeroLength: q.zeroLengthElementCount ?? null,
    disconnected: q.disconnectedGroupCount ?? null,
    shortElement: q.shortElementCount ?? null,
    maxStress: o.maxStressMPa ?? null,
    allowable: o.allowableStressMPa ?? null,
    utilization: o.maxUtilization ?? null,
    exceed: o.memberExceedCount ?? null,
    elementBreakdown: g.elementBreakdown ?? {},
  };
}

function ModelHead({ model, data }) {
  const o = outcomeInfo(data.designOutcome);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="truncate text-sm font-bold text-slate-800" title={model.title}>{model.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <QualityBadge level={data.qualityLevel} />
        <Badge variant={o.variant} size="sm">{o.label}</Badge>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        {model.revisions?.[0]?.source_program_name ?? '-'} · rev {model.revisions?.[0]?.revision_no ?? '-'}
      </p>
    </div>
  );
}

function Section({ title, caption, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-bold text-slate-500">{title}</h3>
      {caption && <p className="mb-2 mt-0.5 text-[11px] text-slate-400">{caption}</p>}
      <div className={caption ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

function CompareRow({ label, a, b, digits = 0, percent = false, lowerIsBetter = false, blocked = false }) {
  const fmt = (v) => {
    if (v === null || v === undefined) return '-';
    return percent ? formatUtilization(v) : formatNumber(v, { digits });
  };

  const comparable = !blocked && a !== null && a !== undefined && b !== null && b !== undefined;
  const diff = comparable ? b - a : null;
  // 기준값이 0이면 비율이 무한대가 되므로 계산하지 않는다.
  const ratio = comparable && a !== 0 ? diff / Math.abs(a) : null;

  let tone = 'text-slate-400';
  if (comparable && diff !== 0) {
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    tone = improved ? 'text-emerald-600' : 'text-rose-600';
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-slate-50 py-1.5 text-xs last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="w-20 text-right tabular-nums text-slate-700">{fmt(a)}</span>
      <ArrowRight size={11} className="text-slate-300" />
      <span className="w-32 text-right">
        <span className="tabular-nums text-slate-700">{fmt(b)}</span>
        {blocked ? (
          <span className="ml-1.5 text-[10px] text-amber-600">단위 상이</span>
        ) : comparable ? (
          diff === 0 ? (
            <span className="ml-1.5 text-[10px] text-slate-400">동일</span>
          ) : (
            <span className={`ml-1.5 text-[10px] tabular-nums ${tone}`}>
              {diff > 0 ? '+' : ''}{percent ? `${(diff * 100).toFixed(1)}%p` : formatNumber(diff, { digits })}
              {ratio !== null && ` (${diff > 0 ? '+' : ''}${(ratio * 100).toFixed(0)}%)`}
            </span>
          )
        ) : (
          <span className="ml-1.5 text-[10px] text-slate-400">비교 불가</span>
        )}
      </span>
    </div>
  );
}

function BreakdownCompare({ a, b }) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  if (keys.length === 0) {
    return <p className="py-2 text-center text-[11px] text-slate-400">요소 구성 정보가 없습니다.</p>;
  }
  return (
    <div>
      {keys.map((k) => (
        <CompareRow key={k} label={k} a={a?.[k] ?? null} b={b?.[k] ?? null} />
      ))}
    </div>
  );
}
