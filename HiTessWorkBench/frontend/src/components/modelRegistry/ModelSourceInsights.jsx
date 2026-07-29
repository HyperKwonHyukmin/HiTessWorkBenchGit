import React from 'react';
import {
  AlertTriangle, ClipboardCheck, Info, Layers, Stethoscope,
} from 'lucide-react';

import { formatNumber } from '../../utils/modelRegistryUtils';

/**
 * 산출물 JSON 의 **내용**을 화면에 편다.
 *
 * 지금까지 「정규화 모델 JSON」·「입력 검사」·「단계 요약」은 다운로드 버튼으로만 존재했다.
 * 그런데 이 파일들은 수 MB 짜리에 `rowAudit` 만 수만 행이라 아무도 열어 보지 않는다.
 * 열어 봐도 뜻을 못 읽으면 보관할 이유가 없으므로, **판단에 쓰이는 집계를 서버가 뽑아
 * 여기서 표로 보여 준다.** 파일은 원본 추적을 위해 계속 보관하되, 이해는 화면에서 끝낸다.
 *
 * 값이 없을 때 세 경우를 구분한다 — 셋을 뭉치면 사용자가 원인을 못 찾는다.
 *   1. 이전 스키마로 등록됨  → 다시 등록하면 채워진다
 *   2. 이 산출물에는 원래 없음 → 프로그램이 만들지 않는 파일이다
 *   3. 등록 시 포함하지 않음   → 선택의 문제다
 */
export default function ModelSourceInsights({ summary, schemaVersion, dense = false }) {
  const audit = summary?.inputAudit;
  const stages = summary?.buildStages;
  const diagnostics = summary?.diagnostics;

  // 1.1 이전 summary 에는 이 절들이 키 자체로 존재하지 않는다.
  const legacy = summary != null && !('inputAudit' in summary);

  if (legacy) {
    return (
      <Panel icon={Info} title="상세 값 없음">
        <p className="text-[11px] leading-relaxed text-slate-500">
          이 모델은 이전 형식(스키마 {schemaVersion || '1.0'})으로 등록되어 입력 검사·생성 단계
          내용이 저장되지 않았습니다. 같은 BDF 를 새 revision 으로 등록하면 채워집니다.
        </p>
      </Panel>
    );
  }

  if (!audit && !stages && !diagnostics) {
    return (
      <Panel icon={Info} title="추출된 상세 값 없음">
        <p className="text-[11px] leading-relaxed text-slate-500">
          이 산출물에는 입력 감사·단계 요약 파일이 없습니다.
          Model Builder 로 만든 모델에서만 제공됩니다.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {audit && <InputAuditPanel audit={audit} />}
      {stages && <BuildStagesPanel stages={stages} dense={dense} />}
      {diagnostics && <DiagnosticsPanel diagnostics={diagnostics} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 입력 검사 — CSV 몇 줄이 실제로 모델이 되었나                          */
/* ------------------------------------------------------------------ */

function InputAuditPanel({ audit }) {
  const t = audit.totals ?? {};
  const rate = audit.conversionRate;
  // 변환되지 않은 행은 대부분 의도된 제외지만, 오류 행은 다르다 — 갈라서 보여 준다.
  const problem = (t.errorRows ?? 0) + (t.parseFailedRows ?? 0);

  return (
    <Panel icon={ClipboardCheck} title="입력 검사" caption="원본 CSV 가 모델로 얼마나 옮겨졌는지">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Stat label="전체 행" value={formatNumber(t.totalDataRows)} />
        <Stat label="변환됨" value={formatNumber(t.convertedRows)} tone="good" />
        <Stat label="제외됨" value={formatNumber(t.ignoredRows)} />
        <Stat label="오류" value={formatNumber(problem || null)} tone={problem ? 'bad' : undefined} />
        <Stat
          label="변환율"
          value={rate == null ? '-' : `${(rate * 100).toFixed(1)}%`}
          tone={rate != null && rate < 0.9 ? 'warn' : undefined}
        />
      </div>

      {rate != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${Math.min(rate * 100, 100)}%` }}
          />
        </div>
      )}

      {audit.files?.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2.5">
          {audit.files.map((f, i) => (
            <li key={`${f.fileName}-${i}`} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                  {f.kind ?? '-'}
                </span>
                <span className="truncate font-mono text-slate-500" title={f.fileName ?? ''}>
                  {f.fileName ?? '파일명 없음'}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {formatNumber(f.dataRowCount)}행
              </span>
            </li>
          ))}
        </ul>
      )}

      {audit.topIgnoredReasons?.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <p className="mb-1.5 text-[10px] font-semibold text-slate-500">제외 사유 (많은 순)</p>
          <div className="flex flex-wrap gap-1.5">
            {audit.topIgnoredReasons.map((r) => (
              <span
                key={r.reason}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600"
              >
                {r.reason}
                <span className="ml-1 font-bold tabular-nums text-slate-800">{r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {t.ambiguousNameRows > 0 && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-800">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          이름이 중복돼 어느 부재인지 특정하지 못한 행이 {formatNumber(t.ambiguousNameRows)}건 있습니다.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* 생성 단계 — 모델이 어떻게 자라났나                                   */
/* ------------------------------------------------------------------ */

function BuildStagesPanel({ stages, dense }) {
  const rows = stages.stages ?? [];
  const totals = stages.totals ?? {};

  return (
    <Panel
      icon={Layers}
      title="생성 단계"
      caption={`${stages.firstStage ?? '?'} → ${stages.lastStage ?? '?'} · ${formatNumber(stages.stageCount)}단계`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Stat label="최종 절점" value={formatNumber(stages.final?.nodeCount)} />
        <Stat label="최종 요소" value={formatNumber(stages.final?.elementCount)} />
        <Stat
          label="오류"
          value={formatNumber(totals.errors)}
          tone={totals.errors > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="경고"
          value={formatNumber(totals.warnings)}
          tone={totals.warnings > 0 ? 'warn' : undefined}
        />
      </div>

      {rows.length > 0 && (
        <div className="mt-2.5 overflow-x-auto border-t border-slate-100 pt-2.5">
          <table className="w-full min-w-[340px] text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] text-slate-400">
                <th className="pb-1 pr-2 text-left font-semibold">단계</th>
                <th className="pb-1 pr-2 text-right font-semibold">절점</th>
                <th className="pb-1 pr-2 text-right font-semibold">요소</th>
                {!dense && <th className="pb-1 pr-2 text-right font-semibold">그룹</th>}
                <th className="pb-1 text-right font-semibold">증감</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={`${s.index}-${s.name}`} className="border-b border-slate-50 last:border-0">
                  <td className="py-1 pr-2 text-slate-700">
                    <span className="mr-1 font-mono text-[9px] text-slate-400">{s.index}</span>
                    {s.name}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-600">
                    {formatNumber(s.nodeCount)}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-slate-600">
                    {formatNumber(s.elementCount)}
                  </td>
                  {!dense && (
                    <td
                      className={[
                        'py-1 pr-2 text-right tabular-nums',
                        // 마지막 단계에서 그룹이 1이 아니면 모델이 갈라져 있다는 뜻이다.
                        s.groupCount > 1 ? 'text-amber-600' : 'text-slate-600',
                      ].join(' ')}
                    >
                      {formatNumber(s.groupCount)}
                    </td>
                  )}
                  <td className="py-1 text-right tabular-nums text-slate-500">
                    <Delta value={s.netElementDelta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stages.truncated && (
        <p className="mt-2 text-[10px] text-slate-400">단계가 많아 앞부분만 표시했습니다.</p>
      )}
    </Panel>
  );
}

function Delta({ value }) {
  if (value === null || value === undefined) return <span className="text-slate-300">-</span>;
  if (value === 0) return <span className="text-slate-400">0</span>;
  return (
    <span className={value > 0 ? 'text-sky-600' : 'text-slate-500'}>
      {value > 0 ? '+' : ''}{formatNumber(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 엔진 진단 — "경고 11,691건" 만으로는 아무 판단도 못 한다              */
/* ------------------------------------------------------------------ */

function DiagnosticsPanel({ diagnostics }) {
  const c = diagnostics.counts ?? {};
  const top = diagnostics.topCodes ?? [];

  return (
    <Panel
      icon={Stethoscope}
      title="엔진 진단"
      caption={`서로 다른 코드 ${formatNumber(diagnostics.distinctCodes)}종`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Stat label="오류" value={formatNumber(c.error)} tone={c.error > 0 ? 'bad' : 'good'} />
        <Stat label="경고" value={formatNumber(c.warning)} tone={c.warning > 0 ? 'warn' : undefined} />
        <Stat label="정보" value={formatNumber(c.info)} />
      </div>

      {top.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
          {top.map((d) => (
            <li key={d.code} className="flex items-start gap-2">
              <span
                className={[
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  d.severity === 'error' ? 'bg-red-500'
                    : d.severity === 'warning' ? 'bg-amber-500' : 'bg-slate-300',
                ].join(' ')}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[10px] font-semibold text-slate-700">
                    {d.code}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-[10px] text-slate-500">
                    {formatNumber(d.count)}건
                  </span>
                </p>
                {d.sampleMessage && (
                  <p className="truncate text-[10px] text-slate-500" title={d.sampleMessage}>
                    {d.sampleMessage}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] text-slate-400">코드별 내역이 저장되지 않았습니다.</p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function Panel({ icon: Icon, title, caption, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5">
      <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
        {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
        {title}
      </h4>
      {caption && <p className="mt-0.5 text-[10px] text-slate-500">{caption}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

const STAT_TONES = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
};

function Stat({ label, value, tone }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${STAT_TONES[tone] ?? 'text-slate-800'}`}>
        {value}
      </span>
    </span>
  );
}
