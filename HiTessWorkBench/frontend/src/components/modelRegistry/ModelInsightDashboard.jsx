import React, { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, Archive, Boxes, Brain, CalendarDays, CheckCircle2, ChevronDown, Gauge,
  Grid3x3, HelpCircle, Layers, ShieldCheck, Sigma, Split, Tag,
} from 'lucide-react';

import { Badge, FeedbackState } from '../ui';
import KpiCard from '../ui/KpiCard';
import {
  QUALITY_LADDER,
  formatNumber,
  formatUtilization,
  outcomeInfo,
  qualityInfo,
} from '../../utils/modelRegistryUtils';

const COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4f46e5'];

const OUTCOME_COLOR = {
  pass: '#059669',
  mixed: '#d97706',
  fail: '#dc2626',
  unknown: '#94a3b8',
};

const QUALITY_COLOR = {
  Q0: '#94a3b8', Q1: '#d97706', Q2: '#0891b2', Q3: '#059669', Q4: '#7c3aed',
};

/** 데이터셋 준비도 과제의 종류를 짧은 한국어로. */
const TASK_KIND_LABELS = {
  retrieval: '검색',
  anomaly: '이상탐지',
  classification: '분류',
  regression: '회귀',
};

/**
 * Insight 대시보드.
 *
 * 표시 원칙(디자인으로 강제한다):
 * - 표본 수(n)를 절대 숨기지 않는다. 수치 요약 표에서 '표본' 을 별도 열 그룹으로 떼어 놓는다.
 * - 값이 없으면 0 이 아니라 '-' 로 쓴다. 표본이 0 인 행/카드는 통째로 흐리게 해 오독을 막는다.
 * - 품질(Q0~Q4)과 설계 결과(pass/fail)는 별도 축이다. 같은 카드·같은 줄에 두지 않는다.
 * - 교차표는 관측 빈도이며 인과가 아님을 그대로 적는다.
 *
 * 정보 위계(읽는 흐름): 읽는 법 → 라이브러리 규모 → 두 축(핵심) → 수치 요약 →
 * 품질 이슈·교차표 → 데이터셋 준비도 → 부가 정보. `SectionEyebrow` 로 각 전환을 표시해
 * 8개 카드가 평평하게 나열되던 이전 구조 대신 '무엇부터 볼지'가 스캔되게 한다.
 */
export default function ModelInsightDashboard({ data, loading, error }) {
  if (loading) return <FeedbackState variant="loading" title="통계를 계산하는 중…" />;
  if (error) return <FeedbackState variant="error" title="통계를 불러오지 못했습니다" message={error} />;
  if (!data) return null;

  const {
    totals, distributions, metrics, qualityIssues, qualityByOutcome, topTags, recentTrend,
    datasetReadiness,
  } = data;

  if (!totals?.revisions) {
    return (
      <FeedbackState
        variant="empty"
        title="집계할 모델이 없습니다"
        message="모델이 등록되면 분포와 통계가 여기에 표시됩니다."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* ── 1. 읽는 법 — 이 대시보드의 두 가지 규칙을 먼저 못박는다 ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5 font-semibold text-slate-700">
          <Split size={13} className="text-slate-400" /> 읽는 법
        </span>
        <span>「모델 품질」과 「설계 결과」는 서로 독립된 축입니다 — 하나가 다른 하나의 원인이 아닙니다.</span>
        <span>표본이 없는 통계는 0 이 아니라 <code className="rounded bg-white px-1 font-mono">-</code> 입니다.</span>
      </div>

      {/* ── 2. 라이브러리 규모 — 축 비교보다 가벼운 무게로, 얇은 스탯 바 하나로 처리한다 ── */}
      <div>
        <SectionEyebrow icon={Boxes} title="라이브러리 규모" hint="등록된 자산의 크기" />
        <div className="mt-2 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm">
          <ScaleStat icon={Boxes} label="등록 모델" value={totals.models} />
          <ScaleStat icon={Layers} label="Revision" value={totals.revisions} />
          <ScaleStat icon={CheckCircle2} label="사용 중" value={totals.active} muted />
          <ScaleStat icon={Archive} label="삭제됨" value={totals.archived} muted />
        </div>
      </div>

      {/* ── 3. 핵심 — 두 개의 독립된 축. KPI 와 분포를 축마다 한 블록에 묶는다 ── */}
      <div>
        <SectionEyebrow icon={Split} title="핵심 지표 — 두 개의 독립된 축" hint="모델 품질 ↔ 설계 결과" />
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
          <Split size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
          아래 두 블록은 서로 독립된 축입니다 — 나란히 있어도 한쪽이 다른 쪽의 원인이라는 뜻이 아닙니다.
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <AxisPanel
            icon={ShieldCheck}
            iconTone="bg-violet-50 text-violet-600"
            title="모델 품질"
            subtitle="모델이 얼마나 검증되었나 — 원본 확보부터 엔지니어 승인까지 누적 조건입니다."
          >
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label="승인 (Q4)"
                value={formatNumber(totals.goldenApproved)}
                sub="엔지니어가 검토·승인함"
                icon={ShieldCheck}
                color="violet"
              />
              <KpiCard
                label="검토 필요"
                value={formatNumber(totals.reviewNeeded)}
                sub="아직 검토되지 않음"
                icon={Layers}
                color="amber"
              />
            </div>
            <DistributionChart
              rows={distributions.qualityLevel}
              colorFor={(k) => QUALITY_COLOR[k] ?? '#94a3b8'}
              labelFor={(k) => qualityInfo(k).label}
              codeFor={(k) => qualityInfo(k).code}
            />
            <QualityLegendInline />
          </AxisPanel>

          <AxisPanel
            icon={Gauge}
            iconTone="bg-emerald-50 text-emerald-600"
            title="설계 결과"
            subtitle="해석에서 허용치를 만족했나 — 통과 / 부분 통과 / 미통과 / 미해석."
          >
            <KpiCard
              label="설계 통과"
              value={formatNumber(totals.designPass)}
              sub="품질 등급과 무관한 별개 값"
              icon={CheckCircle2}
              color="emerald"
            />
            <DistributionChart
              rows={distributions.designOutcome}
              colorFor={(k) => OUTCOME_COLOR[k] ?? '#94a3b8'}
              labelFor={(k) => outcomeInfo(k).label}
            />
          </AxisPanel>
        </div>
      </div>

      {/* ── 4. 기술통계 — 표본을 별도 열 그룹으로 떼어 항상 먼저 읽히게 한다 ── */}
      <div>
        <SectionEyebrow icon={Sigma} title="수치 요약" hint="표본 수를 항상 함께 봅니다" />
        <Card
          className="mt-2"
          icon={Sigma}
          title="수치 요약"
          caption="'표본 n' 은 실제로 값이 있었던 개수입니다. 표본이 없는 행은 흐리게 표시하며, 통계값은 0 이 아니라 '-' 입니다."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500">
                  <th scope="col" rowSpan={2} className="py-2 pr-3 text-left align-bottom">지표</th>
                  <th scope="colgroup" colSpan={2} className="border-l border-slate-200 px-3 py-1.5 text-center">표본</th>
                  <th scope="colgroup" colSpan={4} className="border-l border-slate-200 px-3 py-1.5 text-center">분포</th>
                </tr>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th scope="col" className="border-l border-slate-200 py-2 pl-3 pr-3 text-right font-semibold">n</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">결측</th>
                  <th scope="col" className="border-l border-slate-200 py-2 pl-3 pr-3 text-right font-semibold">최소</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">중앙값</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">평균</th>
                  <th scope="col" className="py-2 text-right font-semibold">최대</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow label="노드 수" stat={metrics.nodeCount} />
                <MetricRow label="요소 수" stat={metrics.elementCount} />
                <MetricRow label="최대 사용률" stat={metrics.maxUtilization} percent />
                <MetricRow label="총 질량" stat={metrics.totalMassKg} digits={1} unit="kg" />
                <MetricRow label="모델 최대 치수" stat={metrics.modelSpan} digits={0} unit={metrics.modelSpan?.unit} />
              </tbody>
            </table>
          </div>
          {metrics.modelSpan?.excludedForUnitMismatch > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              단위가 다른 모델 {metrics.modelSpan.excludedForUnitMismatch}건은 치수 집계에서 제외했습니다
              (기준 단위: {metrics.modelSpan.unit ?? '미선언'}).
            </p>
          )}
        </Card>
      </div>

      {/* ── 5. 품질 이슈 빈도 · 교차표 ── */}
      <div>
        <SectionEyebrow icon={Grid3x3} title="품질 이슈 · 교차 검증" hint="결함 빈도와 두 축의 관측 빈도" />
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <Card
            icon={ShieldCheck}
            title="품질 이슈 빈도"
            caption="해당 결함이 하나 이상 있는 모델의 비율입니다. 분모는 그 지표가 실제로 측정된 모델 수입니다."
          >
            {qualityIssues?.every((i) => i.measured === 0) ? (
              <p className="py-6 text-center text-xs text-slate-500">
                아직 측정된 품질 지표가 없습니다.
              </p>
            ) : (
              <div className="space-y-2.5">
                {qualityIssues.map((issue) => (
                  <ShareRow
                    key={issue.key}
                    label={issue.label}
                    ratio={issue.measured > 0 ? issue.share : null}
                    valueText={`${issue.modelsAffected}/${issue.measured} (${((issue.share ?? 0) * 100).toFixed(0)}%)`}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card icon={Grid3x3} title="품질 × 설계 결과" caption={qualityByOutcome?.note}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                    <th scope="col" className="py-2 pr-3 text-left font-semibold">품질 \ 설계</th>
                    {qualityByOutcome.columns.map((c) => (
                      <th key={c} scope="col" className="px-2 py-2 text-right font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: OUTCOME_COLOR[c] ?? '#94a3b8' }}
                            aria-hidden="true"
                          />
                          {outcomeInfo(c).label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {qualityByOutcome.rows.map((q) => (
                    <tr key={q} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {/* 평문 label 을 주 표기로, Q 코드는 작게 병기 — 'Q0' 만 덩그러니 찍던 이전 표기를 대체한다 */}
                        <Badge variant={qualityInfo(q).variant} size="sm">
                          <span className="inline-flex items-baseline gap-1">
                            {qualityInfo(q).label}
                            <span className="font-mono text-[9px] opacity-60">{qualityInfo(q).code}</span>
                          </span>
                        </Badge>
                      </th>
                      {qualityByOutcome.columns.map((c) => {
                        const cell = qualityByOutcome.cells.find(
                          (x) => x.quality === q && x.outcome === c,
                        );
                        const count = cell?.count ?? 0;
                        return (
                          <td
                            key={c}
                            className={`px-2 py-2 text-right tabular-nums ${count ? 'font-bold text-slate-800' : 'text-slate-300'}`}
                          >
                            {count}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {/* ── 6. 데이터셋 준비도 — '지금 학습이 되나' 에 정직하게 답한다. 구버전 백엔드는 절 자체가 없다 ── */}
      {datasetReadiness && (
        <DatasetReadinessSection readiness={datasetReadiness} />
      )}

      {/* ── 7. 부가 정보 — 원 프로그램 · 태그 · 등록 추이. 핵심 판단에는 영향 없어 마지막에, 가볍게 ── */}
      <div>
        <SectionEyebrow icon={Tag} title="부가 정보" hint="원 프로그램 · 태그 · 등록 추이" />
        <div className="mt-2 grid gap-4 lg:grid-cols-3">
          <Card icon={Boxes} title="원 프로그램" caption="어떤 해석 앱에서 나온 모델인지">
            <DistributionChart
              rows={distributions.sourceProgram}
              colorFor={(_, i) => COLORS[i % COLORS.length]}
            />
          </Card>
          <Card icon={Tag} title="자주 쓰인 태그" caption="검색·재사용에서 실제로 쓰이는 어휘입니다.">
            {topTags?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {topTags.map((t) => (
                  <span
                    key={t.tag}
                    className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                  >
                    #{t.tag}
                    <span className="font-bold tabular-nums text-slate-800">{t.count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-slate-500">태그가 아직 없습니다.</p>
            )}
          </Card>
          {recentTrend?.length > 0 && (
            <Card
              icon={CalendarDays}
              title="최근 등록 추이"
              caption={`최근 ${recentTrend.length}일 · 총 ${recentTrend.reduce((s, d) => s + d.count, 0)}건`}
            >
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={recentTrend} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#002554" radius={[4, 4, 0, 0]} name="등록" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 데이터셋 준비도 — 신규 섹션                                          */
/* ------------------------------------------------------------------ */

/**
 * "지금 이 라이브러리로 머신러닝/빅데이터 활용이 되는가" 에 답하는 절.
 *
 * 목적은 기대를 부풀리지 않는 것이다. 표본이 쌓여 있어도 (1) 학습 입력이 실제로
 * 채워져 있는지, (2) 라벨이 있고 클래스가 치우치지 않았는지, (3) 과제별 최소
 * 표본을 채웠는지를 모두 따로 보여준다. `caveats`/`note` 는 문안 그대로 노출한다.
 */
function DatasetReadinessSection({ readiness }) {
  const {
    sampleSize, distinctModels, features = [], labels, tasks = [], caveats = [], note,
  } = readiness;

  return (
    <div>
      <SectionEyebrow icon={Brain} title="데이터셋 준비도" hint="머신러닝/빅데이터 활용, 지금 가능한가" />
      <p className="mt-2 px-0.5 text-xs text-slate-500">
        현재 표본 <b className="tabular-nums text-slate-700">{formatNumber(sampleSize)}</b>건 revision
        · 서로 다른 모델 <b className="tabular-nums text-slate-700">{formatNumber(distinctModels)}</b>개 기준입니다.
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Card
          icon={Sigma}
          title="학습 입력 후보 커버리지"
          caption="분모는 그 항목을 뽑을 수 있는 모델 수입니다 — 옛 스키마라 애초에 없는 값은 결측으로 세지 않습니다."
        >
          {features.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">집계할 입력 항목이 없습니다.</p>
          ) : (
            <div className="space-y-2.5">
              {features.map((f) => {
                // '해당 없음'(옛 스키마) 과 '결측'(값이 안 뽑힘)은 조치가 정반대다.
                // 전자는 재등록, 후자는 데이터 축적 — 그래서 따로 적는다.
                const applicable = f.applicable ?? (f.present + f.missing);
                const na = f.notApplicable ?? 0;
                return (
                  <ShareRow
                    key={f.key}
                    label={f.label}
                    ratio={f.coverage}
                    barColor="bg-sky-500"
                    valueText={
                      f.coverage == null
                        ? '해당 모델 없음'
                        : `${formatNumber(f.present)}/${formatNumber(applicable)}`
                          + ` (${(f.coverage * 100).toFixed(0)}%)`
                          + (na > 0 ? ` · 구스키마 ${formatNumber(na)}건 제외` : '')
                    }
                    emptyText="표본 없음"
                  />
                );
              })}
            </div>
          )}
        </Card>

        <Card icon={Grid3x3} title="라벨 가용성" caption="분류·회귀 과제는 정답 라벨이 있어야 학습할 수 있습니다.">
          {labels ? <LabelAvailability labels={labels} /> : (
            <p className="py-6 text-center text-xs text-slate-500">라벨 집계가 없습니다.</p>
          )}
        </Card>
      </div>

      <Card
        className="mt-4"
        icon={Brain}
        title="과제별 착수 가능성"
        caption={note}
      >
        {caveats.length > 0 && (
          <ul className="mb-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            {caveats.map((c, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-amber-800">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">집계할 과제가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((t) => <ReadinessTaskRow key={t.key} task={t} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 설계 결과 / 최대 사용률 라벨이 얼마나 있는지. 소수 클래스는 숫자를 그대로 드러낸다. */
function LabelAvailability({ labels }) {
  const designOutcome = labels.designOutcome ?? { labeled: 0, unlabeled: 0, classes: [], minorityClass: null };
  const maxUtilization = labels.maxUtilization ?? { labeled: 0, unlabeled: 0 };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold text-slate-700">설계 결과 라벨</p>
        <p className="mt-1 text-xs text-slate-500">
          라벨 있음 <b className="tabular-nums text-slate-800">{formatNumber(designOutcome.labeled)}</b>
          {' '}· 없음 <span className="tabular-nums text-slate-400">{formatNumber(designOutcome.unlabeled)}</span>
        </p>
        {designOutcome.classes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {designOutcome.classes.map((c) => (
              <span
                key={c.key}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
              >
                {outcomeInfo(c.key).label} <b className="tabular-nums text-slate-800">{c.count}</b>
              </span>
            ))}
          </div>
        )}
        {designOutcome.minorityClass !== null && designOutcome.minorityClass < 30 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            가장 적은 클래스가 {designOutcome.minorityClass}건뿐입니다 — 분류 학습에는 아직 이릅니다.
          </p>
        )}
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-bold text-slate-700">최대 사용률 라벨</p>
        <p className="mt-1 text-xs text-slate-500">
          라벨 있음 <b className="tabular-nums text-slate-800">{formatNumber(maxUtilization.labeled)}</b>
          {' '}· 없음 <span className="tabular-nums text-slate-400">{formatNumber(maxUtilization.unlabeled)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * 데이터셋 준비도 과제 한 줄.
 *
 * `ready === false` 인데 진행률 바만 크게 보이면 '거의 다 됐다'로 오독한다. 그래서
 * 부족분(shortfall)은 항상 숫자로 병기하고, blockers 는 진행률(심지어 100%여도)과
 * 무관하게 별도의 amber 경고 박스로 그려 '표본은 찼지만 아직 못 쓴다'를 분명히 한다.
 */
function ReadinessTaskRow({ task }) {
  const pct = task.minSamples > 0 ? Math.min(100, (task.available / task.minSamples) * 100) : 0;
  const blocked = (task.blockers?.length ?? 0) > 0;

  return (
    <div className={`rounded-xl border p-3.5 ${task.ready ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">{task.label}</span>
            <Badge variant="neutral" size="sm">{TASK_KIND_LABELS[task.kind] ?? task.kind}</Badge>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{task.why}</p>
        </div>
        <Badge variant={task.ready ? 'success' : blocked ? 'warning' : 'neutral'} size="sm">
          {task.ready ? '착수 가능' : blocked ? '표본 충족 · 차단 있음' : '표본 부족'}
        </Badge>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={[
              'h-full rounded-full transition-[width] duration-500',
              task.ready ? 'bg-emerald-500' : blocked ? 'bg-amber-400' : 'bg-slate-400',
            ].join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-600">
          {formatNumber(task.available)} / {formatNumber(task.minSamples)}건
        </span>
      </div>

      {task.shortfall > 0 && (
        <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
          부족 {formatNumber(task.shortfall)}건 더 필요
        </p>
      )}

      {blocked && (
        <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
          {task.blockers.map((b, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 공용 소형 컴포넌트                                                   */
/* ------------------------------------------------------------------ */

function DistributionChart({ rows, colorFor, labelFor, codeFor }) {
  const data = (rows ?? []).filter((r) => r.count > 0);
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-500">표시할 데이터가 없습니다.</p>;
  }
  const chartData = data.map((r) => ({
    ...r,
    label: labelFor ? labelFor(r.key) : r.key,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 34)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={128} tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v}건`, '모델']} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} name="모델">
            {chartData.map((row, i) => (
              <Cell key={row.key} fill={colorFor ? colorFor(row.key, i) : COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* 차트와 같은 집계값을 표로도 제공한다(색만으로 읽지 않게). Q 코드처럼 부가 표기가 있으면 작게 병기한다. */}
      <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2.5">
        {chartData.map((row, i) => (
          <li key={row.key} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: colorFor ? colorFor(row.key, i) : COLORS[i % COLORS.length] }}
                aria-hidden="true"
              />
              <span className="truncate">
                {row.label}
                {codeFor && (
                  <span className="ml-1 font-mono text-[9px] text-slate-400">{codeFor(row.key)}</span>
                )}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-500">
              <span className="font-semibold text-slate-800">{row.count}</span>건
              {row.share != null && ` (${(row.share * 100).toFixed(0)}%)`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * 비율 막대 한 줄 — '측정 안 됨(ratio=null)' 과 '측정했는데 0(ratio=0)' 을 다른 모양으로 그린다.
 * 품질 이슈 빈도, 데이터셋 피처 커버리지 등 '표본 대비 비율'을 보여주는 모든 곳에서 재사용한다.
 */
function ShareRow({ label, ratio, valueText, barColor = 'bg-amber-500', emptyText = '측정 없음' }) {
  const measured = ratio !== null && ratio !== undefined;
  const pct = measured ? ratio * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-xs text-slate-600" title={label}>{label}</span>
      <div
        className={[
          'h-2 flex-1 overflow-hidden rounded-full',
          measured ? 'bg-slate-100' : 'border border-dashed border-slate-300 bg-slate-50',
        ].join(' ')}
      >
        {measured && (
          <div
            className={`h-full rounded-full ${barColor} transition-[width] duration-500`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span
        className={[
          'w-32 shrink-0 text-right text-xs tabular-nums',
          measured ? 'text-slate-600' : 'text-slate-400',
        ].join(' ')}
      >
        {measured ? valueText : emptyText}
      </span>
    </div>
  );
}

/**
 * 수치 요약 한 행.
 *
 * 표본이 0 인 행은 통째로 흐리게 하고 '측정 없음' 을 병기한다.
 * 흐리게만 두면 최소/평균의 '-' 를 '값이 0' 으로 잘못 읽을 수 있다.
 */
function MetricRow({ label, stat, digits = 0, unit, percent = false }) {
  const fmt = (v) => {
    if (v === null || v === undefined) return '-';
    if (percent) return formatUtilization(v);
    return formatNumber(v, { digits, suffix: unit ? ` ${unit}` : '' });
  };
  const empty = !stat || stat.sampleSize === 0;

  return (
    <tr className={`border-b border-slate-100 last:border-0 ${empty ? 'bg-slate-50/50' : ''}`}>
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        <span className={empty ? 'text-slate-400' : 'font-medium text-slate-700'}>{label}</span>
        {empty && <span className="ml-2 text-[10px] text-slate-400">측정 없음</span>}
      </th>
      <td
        className={`border-l border-slate-100 py-2.5 pl-3 pr-3 text-right tabular-nums ${
          empty ? 'text-slate-400' : 'font-bold text-slate-800'
        }`}
      >
        {stat?.sampleSize ?? 0}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">
        {stat?.missing ?? '-'}
      </td>
      <td className={`border-l border-slate-100 py-2.5 pl-3 pr-3 text-right tabular-nums ${empty ? 'text-slate-300' : 'text-slate-600'}`}>
        {fmt(stat?.min)}
      </td>
      <td className={`py-2.5 pr-3 text-right tabular-nums ${empty ? 'text-slate-300' : 'text-slate-600'}`}>
        {fmt(stat?.median)}
      </td>
      <td className={`py-2.5 pr-3 text-right tabular-nums ${empty ? 'text-slate-300' : 'font-semibold text-slate-800'}`}>
        {fmt(stat?.mean)}
      </td>
      <td className={`py-2.5 text-right tabular-nums ${empty ? 'text-slate-300' : 'text-slate-600'}`}>
        {fmt(stat?.max)}
      </td>
    </tr>
  );
}

/**
 * 품질 등급 인라인 설명 — 기본 닫힘.
 *
 * `QualityLevelGuide.jsx` 는 이 작업과 동시에 다른 사람이 편집 중이라 import 하지
 * 않는다. 이 대시보드에 필요한 최소 버전(사다리 + 누적 조건)만 이 파일 안에서
 * 새로 만든다. 평소엔 접어 두어 아는 사람에게 소음이 되지 않게 한다.
 */
function QualityLegendInline() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-semibold text-slate-600 transition-colors hover:text-brand-blue"
      >
        <HelpCircle size={12} className="shrink-0 text-slate-400" aria-hidden="true" />
        등급은 어떻게 정해지나요? (누적 조건)
        <ChevronDown
          size={12}
          className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol className="space-y-1.5 border-t border-slate-100 px-2.5 py-2.5">
          {QUALITY_LADDER.map((key) => {
            const q = qualityInfo(key);
            return (
              <li key={key} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500"
                  aria-hidden="true"
                >
                  {q.rank}
                </span>
                <span>
                  <b className="text-slate-700">{q.label}</b>{' '}
                  <span className="font-mono text-[9px] text-slate-400">{q.code}</span>
                  <span className="text-slate-500"> — {q.requirement}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** 라이브러리 규모 스탯 바 안의 항목 하나. muted 는 부수적인 값(사용 중/삭제됨)에 쓴다. */
function ScaleStat({ icon: Icon, label, value, muted = false }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={14} className={muted ? 'text-slate-300' : 'text-slate-400'} aria-hidden="true" />
      <span className={`text-xs ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-base font-bold tabular-nums ${muted ? 'text-slate-500' : 'text-slate-900'}`}>
        {formatNumber(value)}
      </span>
    </div>
  );
}

/** 축 하나(모델 품질 / 설계 결과)를 KPI + 분포로 묶는 카드. 두 축을 시각적으로 확실히 가른다. */
function AxisPanel({ icon: Icon, iconTone, title, subtitle, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** 큰 섹션 전환을 표시하는 얇은 표식 — 읽는 흐름(라이브러리 규모 → 두 축 → …)을 눈으로 따라가게 한다. */
function SectionEyebrow({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {Icon && <Icon size={12} aria-hidden="true" />}
        {title}
      </span>
      <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      {hint && <span className="shrink-0 text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

function Card({ icon: Icon, title, caption, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
        {Icon && <Icon size={15} className="shrink-0 text-slate-400" />}
        {title}
      </h3>
      {caption && <p className="mb-3 mt-1 text-xs leading-relaxed text-slate-500">{caption}</p>}
      <div className={caption ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}
