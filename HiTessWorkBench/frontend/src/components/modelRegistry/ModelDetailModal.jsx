import React, { useState } from 'react';
import {
  Boxes, Download, FileStack, Fingerprint, Gauge, Loader2, Rotate3d,
  RotateCcw, ShieldCheck, Split, Trash2,
} from 'lucide-react';

import { Badge, Button, Modal } from '../ui';
import RegistryModelPreview3D from './RegistryModelPreview3D';
import ModelSourceInsights from './ModelSourceInsights';
import SimilarModelsPanel from './SimilarModelsPanel';
import { QualityBadge, QualityHelp } from './QualityLevelGuide';
import {
  archiveRegisteredModel,
  downloadRegistryArtifact,
  restoreRegisteredModel,
  updateRegisteredModel,
} from '../../api/modelRegistry';
import { downloadBlob } from '../../utils/fileHelper';
import { useToast } from '../../contexts/ToastContext';
import {
  ARTIFACT_KIND_LABELS,
  SOFT_DELETE_NOTE,
  STORED_KIND_LABELS,
  extractApiError,
  formatBytes,
  formatNumber,
  formatUtilization,
  outcomeInfo,
  qualityInfo,
  reviewInfo,
  statusInfo,
  utilizationVariant,
} from '../../utils/modelRegistryUtils';

/**
 * 등록 모델 상세.
 *
 * 품질(modelQuality)과 설계 결과(analysisOutcome)는 **한 열 안에서 위아래로 떼어** 표시한다.
 * 나란히 붙이면 "품질이 좋아 통과했다"는 인과로 읽히는데, 둘은 독립된 축이다.
 *
 * 레이아웃 의도:
 *   1행 — 형상(3D)과 판정. "이게 내가 찾던 모델인가"에 먼저 답한다.
 *   2행 — 수치·출처, 만들어진 내역, 보관 파일.
 *
 * 파일 다운로드는 **원본 추적용**이지 이해 수단이 아니다. 그래서 JSON 의 내용은
 * `ModelSourceInsights` 가 표로 펴서 보여 주고, 다운로드는 맨 끝으로 내렸다.
 */
export default function ModelDetailModal({
  isOpen, onClose, model, canManage, onChanged, onOpenModel,
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(null);

  if (!model) return null;

  const revision = model.revisions?.[0];
  const summary = revision?.summary_json ?? {};
  const quality = summary.modelQuality ?? {};
  const outcome = summary.analysisOutcome ?? {};
  const geometry = summary.geometry ?? {};
  const units = summary.units ?? {};
  const physical = summary.physicalProperties ?? {};

  const q = qualityInfo(revision?.quality_level);
  const o = outcomeInfo(revision?.design_outcome);
  const r = reviewInfo(revision?.review_status);
  const s = statusInfo(model.status);
  const artifacts = revision?.artifacts ?? [];
  const approved = revision?.review_status === 'approved';

  const handleDownload = async (artifact) => {
    setBusy(`dl-${artifact.id}`);
    try {
      const res = await downloadRegistryArtifact(artifact.id);
      downloadBlob(res.data, artifact.file_name);
    } catch (e) {
      showToast(extractApiError(e, '다운로드에 실패했습니다.').message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 엔지니어 승인 토글.
   *
   * '승인 해제'는 반려인지 미검토인지 알 수 없어 쓰지 않는다 —
   * 실제 동작은 미검토로 되돌리는 것이므로 그대로 이름 붙인다.
   */
  const handleApprove = async () => {
    const approving = !approved;
    setBusy('review');
    try {
      await updateRegisteredModel(model.model_uid, {
        review_status: approving ? 'approved' : 'unreviewed',
      });
      showToast(
        approving
          ? '엔지니어 승인했습니다. 품질 등급이 「엔지니어 승인」으로 올라갑니다.'
          : '미검토 상태로 되돌렸습니다. 품질 등급은 자동 판정값으로 돌아갑니다.',
        'success',
      );
      onChanged?.();
    } catch (e) {
      showToast(extractApiError(e, '검토 상태를 바꾸지 못했습니다.').message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 삭제(내부적으로는 소프트 삭제).
   *
   * 화면에서 '보관'이라 부르면 "그럼 삭제는 어디서 하나"가 남는다. 사용자가 기대하는
   * 행위는 삭제이고 실제로 목록에서 사라지므로 그대로 삭제라고 부르되,
   * 파일이 남는다는 사실은 문구로 반드시 알린다.
   */
  const handleDelete = async () => {
    setBusy('delete');
    try {
      await archiveRegisteredModel(model.model_uid);
      showToast(`삭제했습니다. ${SOFT_DELETE_NOTE}`, 'success');
      onChanged?.();
      onClose();
    } catch (e) {
      showToast(extractApiError(e, '삭제하지 못했습니다.').message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 복원. 같은 BDF 는 sha256 이 전역 unique 라 재등록이 불가능하므로,
   * 삭제된 모델을 다시 쓰려면 이 경로밖에 없다.
   */
  const handleRestore = async () => {
    setBusy('restore');
    try {
      await restoreRegisteredModel(model.model_uid);
      showToast('복원했습니다. 목록에 다시 표시됩니다.', 'success');
      onChanged?.();
    } catch (e) {
      showToast(extractApiError(e, '복원하지 못했습니다.').message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={model.title}
      size="screen"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
            <Fingerprint size={12} className="shrink-0 text-slate-400" />
            {model.model_uid}
          </span>
          <div className="flex gap-2">
            {canManage && model.status === 'active' && (
              <>
                <Button
                  variant="secondary"
                  onClick={handleApprove}
                  isLoading={busy === 'review'}
                  title={
                    approved
                      ? '미검토 상태로 되돌립니다. 품질 등급이 자동 판정값으로 내려갑니다.'
                      : '사람이 검토했음을 표시합니다. 품질 등급이 최고 단계로 올라갑니다.'
                  }
                >
                  <ShieldCheck size={14} className="mr-1.5" />
                  {approved ? '미검토로 되돌리기' : '엔지니어 승인'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleDelete}
                  isLoading={busy === 'delete'}
                  title={SOFT_DELETE_NOTE}
                >
                  <Trash2 size={14} className="mr-1.5" /> 삭제
                </Button>
              </>
            )}
            {canManage && model.status === 'archived' && (
              <Button onClick={handleRestore} isLoading={busy === 'restore'}>
                <RotateCcw size={14} className="mr-1.5" /> 복원
              </Button>
            )}
            <Button onClick={onClose}>닫기</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5 lg:p-6">
        {/* ── 식별 밴드: 판정 배지 + 설명 + 태그 ── */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* 식별 밴드의 배지는 모두 md — 크기가 섞이면 중요도가 다른 것처럼 읽힌다 */}
            <QualityBadge level={revision?.quality_level} size="md" />
            <Badge variant={o.variant}>설계 {o.label}</Badge>
            <Badge variant={r.variant}>{r.label}</Badge>
            {model.status === 'archived' && <Badge variant="neutral">{s.label}</Badge>}
            {model.visibility === 'owner' && <Badge variant="warning">소유자만</Badge>}
          </div>

          {/* 삭제된 모델은 왜 안 보이는지·어떻게 되돌리는지를 화면에서 바로 알려 준다 */}
          {model.status === 'archived' && (
            <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              이 모델은 삭제되어 목록에 나오지 않습니다. {SOFT_DELETE_NOTE}
            </p>
          )}

          {model.description && (
            <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {model.description}
            </p>
          )}

          {model.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {model.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 재사용 주의 — 폭 전체를 써서 놓치지 않게 한다 */}
        {model.reuse_notes && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-bold text-amber-800">재사용 주의</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-800/90">
              {model.reuse_notes}
            </p>
          </div>
        )}

        {/* ── 1행: 형상 + 판정 ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* 형상 — 숫자가 답하지 못하는 "이게 그 모델인가"에 먼저 답한다 */}
          <div className="space-y-3 xl:col-span-7">
            <ColumnHeading
              icon={Rotate3d}
              title="형상 미리보기"
              caption="드래그로 회전, 휠로 확대. 판별용 간이 뷰이며 상세 검토는 해석 Studio 에서 하세요."
            />
            <div className="h-[380px] lg:h-[440px]">
              <RegistryModelPreview3D
                modelUid={model.model_uid}
                revision={revision?.revision_no}
                active={isOpen}
              />
            </div>

            {/*
              형상 바로 아래에 둔다 — "이게 그 모델인가"를 판단한 직후에 자연스럽게 따라오는
              질문이 "비슷한 게 또 있나"이기 때문이다.
            */}
            <SimilarModelsPanel
              modelUid={model.model_uid}
              active={isOpen}
              onSelect={onOpenModel}
            />
          </div>

          {/* 판정 — 두 축 */}
          <div className="space-y-3 xl:col-span-5">
            <ColumnHeading
              icon={Gauge}
              title="판정"
              caption="아래 두 축은 서로 독립입니다. 한쪽이 다른 쪽의 원인이 아닙니다."
            />

            <Card>
              <CardHeader
                icon={ShieldCheck}
                title="모델 품질"
                right={<QualityBadge level={revision?.quality_level} />}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {q.description || '모델이 얼마나 검증되었는지를 나타냅니다.'}
              </p>
              <dl className="mt-2.5">
                <MetricRow label="파싱" value={quality.parseStatus} format={(v) => String(v)} />
                <MetricRow label="미참조 GRID" value={quality.orphanNodeCount} defect />
                <MetricRow label="고립 GRID" value={quality.isolatedNodeCount} defect />
                <MetricRow label="영길이 요소" value={quality.zeroLengthElementCount} defect />
                <MetricRow label="짧은 요소" value={quality.shortElementCount} defect />
                <MetricRow label="분리 그룹" value={quality.disconnectedGroupCount} defect />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="text-xs text-slate-500">Nastran FATAL</dt>
                  <dd className={`text-xs font-semibold ${quality.nastranFatal ? 'text-red-600' : 'text-slate-800'}`}>
                    {quality.nastranFatal ? '있음' : '없음'}
                  </dd>
                </div>
              </dl>
              <div className="mt-2.5">
                <QualityHelp current={revision?.quality_level} />
              </div>
            </Card>

            {/* 두 축 사이의 명시적 분리선 */}
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Split size={12} /> 서로 독립된 축
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Card>
              <CardHeader
                icon={Gauge}
                title="설계 결과"
                right={<Badge variant={o.variant} size="sm">{o.label}</Badge>}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                모델 품질과 별개입니다. 미통과 모델도 회귀 예제로 가치가 있습니다.
              </p>
              <dl className="mt-2.5">
                <MetricRow label="해석 종류" value={outcome.analysisType} format={(v) => String(v)} />
                <MetricRow
                  label="최대 응력"
                  value={outcome.maxStressMPa}
                  format={(v) => formatNumber(v, { digits: 1, suffix: ' MPa' })}
                />
                <MetricRow
                  label="허용 응력"
                  value={outcome.allowableStressMPa}
                  format={(v) => formatNumber(v, { digits: 1, suffix: ' MPa' })}
                />
                <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5">
                  <dt className="text-xs text-slate-500">사용률</dt>
                  <dd>
                    {outcome.maxUtilization == null ? (
                      <span className="text-xs text-slate-400">-</span>
                    ) : (
                      <Badge variant={utilizationVariant(outcome.maxUtilization)} size="sm">
                        {formatUtilization(outcome.maxUtilization)}
                      </Badge>
                    )}
                  </dd>
                </div>
                <MetricRow label="초과 부재" value={outcome.memberExceedCount} defect />
                <MetricRow label="Wire 압축" value={outcome.wireCompressionCount} defect />
              </dl>
            </Card>
          </div>
        </div>

        {/* ── 2행: 수치·출처 / 만들어진 내역 / 파일 ── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
          {/* 모델 자체 — 형상·물성·출처 */}
          <div className="space-y-3 xl:col-span-4">
            <ColumnHeading
              icon={Boxes}
              title="모델"
              caption={`형상과 출처. 길이 단위: ${units.length ?? '미선언'}`}
            />

            <Card>
              <CardHeader icon={Boxes} title="형상 · 물성" />
              <dl className="mt-2.5">
                <MetricRow label="노드" value={geometry.nodeCount} />
                <MetricRow label="요소" value={geometry.elementCount} />
                <MetricRow label="강체 요소" value={geometry.rigidElementCount} />
                <MetricRow label="집중 질량" value={geometry.pointMassCount} />
                <MetricRow
                  label="총 질량"
                  value={physical.totalMassKg}
                  format={(v) => formatNumber(v, { digits: 1, suffix: ' kg' })}
                />
                {/* 총 질량의 내역 — 합의 구성이라는 것이 보이게 들여쓴다 */}
                <MetricRow
                  label="└ 부재"
                  value={physical.beamMassKg}
                  format={(v) => formatNumber(v, { digits: 1, suffix: ' kg' })}
                />
                <MetricRow
                  label="└ 집중질량"
                  value={physical.pointMassKg}
                  format={(v) => formatNumber(v, { digits: 1, suffix: ' kg' })}
                />
              </dl>

              {physical.centerOfGravityMm && (
                <div className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2">
                  <p className="text-[11px] font-semibold text-slate-500">무게중심 (mm)</p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-700">
                    X {formatNumber(physical.centerOfGravityMm.x, { digits: 0 })} ·
                    {' '}Y {formatNumber(physical.centerOfGravityMm.y, { digits: 0 })} ·
                    {' '}Z {formatNumber(physical.centerOfGravityMm.z, { digits: 0 })}
                  </p>
                </div>
              )}

              {/* 질량이 어디서 왔는지 밝힌다 — 추정값과 선언값을 구분해야 신뢰가 생긴다 */}
              {physical.totalMassKg != null && physical.massSource && (
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  질량은 엔진의 단계 요약이 선언한 값입니다(추정 아님).
                </p>
              )}
              {physical.totalMassKg == null && units.confidence !== 'declared' && (
                <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
                  질량을 선언한 소스가 없어 추정하지 않습니다(빈 값 = 미제공).
                </p>
              )}

              {geometry.elementBreakdown && Object.keys(geometry.elementBreakdown).length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">요소 구성</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(geometry.elementBreakdown).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {k} <span className="font-semibold tabular-nums text-slate-800">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader icon={Fingerprint} title="출처" />
              <dl className="mt-2.5">
                <MetricRow label="원 해석자" value={model.owner_id} format={(v) => String(v)} />
                <MetricRow label="등록자" value={model.registered_by} format={(v) => String(v)} />
                <MetricRow
                  label="원 프로그램"
                  value={revision?.source_program_name}
                  format={(v) => String(v)}
                />
                <MetricRow
                  label="산출물 종류"
                  value={
                    ARTIFACT_KIND_LABELS[revision?.source_artifact_kind]
                    ?? revision?.source_artifact_kind
                  }
                  format={(v) => String(v)}
                />
                <MetricRow label="스키마" value={revision?.schema_version} format={(v) => String(v)} />
                <MetricRow label="revision" value={revision?.revision_no} />
              </dl>
              <div className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2">
                <p className="text-[11px] font-semibold text-slate-500">SHA-256</p>
                <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-slate-600">
                  {revision?.bdf_sha256 ?? '-'}
                </p>
              </div>
            </Card>
          </div>

          {/* 만들어진 내역 — 예전에는 JSON 을 받아야만 알 수 있던 것 */}
          <div className="space-y-3 xl:col-span-5">
            <ColumnHeading
              icon={FileStack}
              title="만들어진 내역"
              caption="입력 CSV 가 어떻게 모델이 되었는지. 예전에는 JSON 을 내려받아야 알 수 있던 값입니다."
            />
            <ModelSourceInsights summary={summary} schemaVersion={revision?.schema_version} />
          </div>

          {/* 보관 파일 — 이해 수단이 아니라 원본 추적용이므로 맨 끝 */}
          <div className="space-y-3 lg:col-span-2 xl:col-span-3">
            <ColumnHeading
              icon={Download}
              title="원본 파일"
              caption="위 내용의 근거 파일입니다. 재해석·감사용이며 읽을 필요는 없습니다."
            />

            <Card>
              {artifacts.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">보관된 파일이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {artifacts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {STORED_KIND_LABELS[a.kind] ?? a.kind}
                        </p>
                        <p className="truncate font-mono text-[10px] text-slate-500" title={a.file_name}>
                          {formatBytes(a.size_bytes)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDownload(a)}
                        disabled={busy === `dl-${a.id}`}
                        className="shrink-0 cursor-pointer rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 transition-colors hover:border-brand-blue hover:bg-brand-blue/5 hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
                        title={`${a.file_name} 다운로드`}
                        aria-label={`${a.file_name} 다운로드`}
                      >
                        {busy === `dl-${a.id}`
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Download size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {model.revisions?.length > 1 && (
                <p className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
                  이 모델에는 revision {model.revisions.length}개가 있습니다.
                  위 정보는 최신 revision 기준입니다.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 표시용 소형 컴포넌트 (등록 모달과 같은 시각 언어)                     */
/* ------------------------------------------------------------------ */

function Card({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      {children}
    </section>
  );
}

function CardHeader({ icon: Icon, title, right }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
        {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
        {title}
      </h4>
      {right}
    </div>
  );
}

function ColumnHeading({ icon: Icon, title, caption }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 rounded-lg bg-slate-100 p-1.5 text-slate-500" aria-hidden="true">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

/**
 * 지표 한 줄.
 *
 * 값이 없으면 반드시 '-' 다 — 0 으로 보이면 "결함이 하나도 없다"로 잘못 읽힌다.
 * `defect` 는 0 이 정상인 결함 카운트로, 0 보다 크면 색으로 눈에 띄게 한다.
 */
function MetricRow({ label, value, format = formatNumber, defect = false }) {
  const missing = value === null || value === undefined
    || (typeof value === 'number' && Number.isNaN(value));
  const flagged = defect && !missing && Number(value) > 0;

  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd
        className={[
          'min-w-0 truncate text-xs tabular-nums',
          missing ? 'text-slate-400' : flagged ? 'font-bold text-amber-600' : 'font-semibold text-slate-800',
        ].join(' ')}
      >
        {missing ? '-' : format(value)}
      </dd>
    </div>
  );
}
