import React, { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight,
  Shield, FileText, Clock, Hash, Box, Layers, Cpu, Anchor, Zap,
  AlertOctagon, Wrench
} from 'lucide-react';

/* ── 공용 UI ─────────────────────────────────────────────────── */

const StatusBadge = ({ status }) => {
  const map = {
    pass:    { cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700', label: 'PASS' },
    warning: { cls: 'bg-yellow-900/60  text-yellow-300  border-yellow-700',  label: 'WARNING' },
    error:   { cls: 'bg-red-900/60     text-red-300     border-red-700',     label: 'ERROR' },
  };
  const s = map[status] || { cls: 'bg-slate-700 text-slate-300 border-slate-600', label: status?.toUpperCase() ?? '—' };
  return <span className={`text-xs font-bold px-2.5 py-0.5 rounded border ${s.cls}`}>{s.label}</span>;
};

const SectionTitle = ({ icon: Icon, children, iconColor = 'text-slate-400' }) => (
  <div className="flex items-center gap-2 mt-5 mb-2.5">
    {Icon && <Icon size={13} className={iconColor} />}
    <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">{children}</p>
  </div>
);

const BreakdownPills = ({ data, colorCls }) => {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(data).map(([k, v]) => (
        <span key={k} className={`text-xs font-mono px-2.5 py-0.5 rounded border ${colorCls}`}>
          {k}: <strong>{v.toLocaleString()}</strong>
        </span>
      ))}
    </div>
  );
};

/* ── F06 메시지 (Step 2) ─────────────────────────────────────── */

// context 문자열에서 "USER ACTION:" 이후 내용을 추출
function extractUserAction(context) {
  if (!context) return null;
  const idx = context.toUpperCase().indexOf('USER ACTION:');
  if (idx === -1) return null;
  return context.slice(idx + 'USER ACTION:'.length).trim().replace(/^\s+/gm, '').trim();
}

function F06Message({ msg, index }) {
  const [open, setOpen] = useState(false);
  const isFatal   = msg.level === 'fatal';
  const isCopyright = msg.lineNumber <= 10; // 저작권 경고는 라인 초반
  const userAction = extractUserAction(msg.context);

  // 저작권 warning은 접힌 상태로 최소화
  const defaultCollapsed = isCopyright;

  return (
    <div className={`border rounded-xl overflow-hidden mb-2 ${
      isFatal       ? 'border-red-800/70'
      : isCopyright ? 'border-slate-700/50'
                    : 'border-yellow-800/70'
    }`}>
      {/* 헤더 행 */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left cursor-pointer transition-colors ${
          isFatal       ? 'bg-red-950/70 hover:bg-red-950/90'
          : isCopyright ? 'bg-slate-800/40 hover:bg-slate-800/60'
                        : 'bg-yellow-950/70 hover:bg-yellow-950/90'
        }`}
      >
        {(open || !defaultCollapsed)
          ? <ChevronDown  size={14} className="mt-0.5 shrink-0 text-slate-400" />
          : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}

        {isFatal
          ? <AlertOctagon size={14} className="mt-0.5 shrink-0 text-red-400" />
          : <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${isCopyright ? 'text-slate-500' : 'text-yellow-400'}`} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold font-mono ${
              isFatal ? 'text-red-300' : isCopyright ? 'text-slate-500' : 'text-yellow-300'
            }`}>
              {isFatal ? 'FATAL' : 'WARNING'} — Line {msg.lineNumber}
            </span>
            {isCopyright && (
              <span className="text-[10px] text-slate-600 font-mono">(저작권 고지)</span>
            )}
          </div>
          <p className={`text-xs font-mono mt-0.5 break-all ${
            isFatal ? 'text-red-200' : isCopyright ? 'text-slate-600' : 'text-yellow-200'
          }`}>
            {msg.message}
          </p>
        </div>
      </button>

      {/* 펼쳤을 때 */}
      {open && (
        <div className="border-t border-slate-800 bg-slate-950/60">
          {/* 원문 context */}
          {msg.context && (
            <pre className="text-xs font-mono text-slate-400 px-5 py-3 leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
              {msg.context}
            </pre>
          )}
          {/* USER ACTION 별도 강조 */}
          {userAction && (
            <div className="mx-4 mb-3 flex items-start gap-2 px-3 py-2.5 bg-amber-950/50 border border-amber-800/50 rounded-lg">
              <Wrench size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-300 mb-1">USER ACTION (권장 조치)</p>
                <p className="text-xs font-mono text-amber-200 leading-relaxed">{userAction}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 메인 컴포넌트 ───────────────────────────────────────────── */

export default function ValidationStepLog({ step1Data, step2Data, useNastran }) {
  const ps = step1Data?.parsingSummary;

  const overallStatus = (() => {
    if (!step1Data) return null;
    if (step1Data.status === 'error' || step2Data?.status === 'error') return 'error';
    if (step1Data.status === 'warning' || step2Data?.status === 'warning') return 'warning';
    return 'pass';
  })();

  const rulesChecked  = Array.isArray(step1Data?.rulesChecked) ? step1Data.rulesChecked : [];
  const rulesAreObjs  = rulesChecked.length > 0 && typeof rulesChecked[0] === 'object';

  const ruleLabels = {
    GridRule: 'Grid 절점', ElementRule: '요소 참조',  PropertyRule: '물성 참조',
    MaterialRule: '재질',  LoadRule: '하중 참조', BcRule: '경계조건',
  };

  /* Step2 메시지 분류 */
  const f06Messages = step2Data?.f06Summary?.messages || [];
  const fatals   = f06Messages.filter(m => m.level === 'fatal');
  const warnings = f06Messages.filter(m => m.level === 'warning');

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-700 h-full overflow-y-auto">

      {/* ══════ Step 1 ══════ */}
      {step1Data && (
        <div className={`p-5 ${useNastran ? 'border-b border-slate-700/60' : ''}`}>

          {/* 헤더 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-teal-300 font-mono">Step 1</span>
              <span className="text-sm text-slate-400">{step1Data.stepName}</span>
              <StatusBadge status={step1Data.status} />
            </div>
            {step1Data.generatedAt && (
              <div className="flex items-center gap-1 text-xs text-slate-500 font-mono">
                <Clock size={11} />
                <span>{new Date(step1Data.generatedAt).toLocaleString('ko-KR')}</span>
              </div>
            )}
          </div>

          {/* 소스 */}
          {step1Data.sourceFile && (
            <div className="flex items-center gap-2 mb-4 text-xs font-mono text-slate-500">
              <FileText size={12} />
              <span>{step1Data.sourceFile}</span>
              {step1Data.version && <span className="text-slate-600 ml-2">v{step1Data.version}</span>}
            </div>
          )}

          {/* 요약 카운트 */}
          <div className="grid grid-cols-3 gap-3 mb-5 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
            {[
              { label: '검증 오류', val: step1Data.summary?.totalErrors   ?? 0, bad: v => v > 0, errCls: 'text-red-300',    okCls: 'text-emerald-300' },
              { label: '검증 경고', val: step1Data.summary?.totalWarnings  ?? 0, bad: v => v > 0, errCls: 'text-yellow-300', okCls: 'text-emerald-300' },
              { label: '파서 경고', val: step1Data.summary?.parserWarnings ?? 0, bad: v => v > 0, errCls: 'text-sky-300',    okCls: 'text-emerald-300' },
            ].map(({ label, val, bad, errCls, okCls }) => (
              <div key={label} className="flex flex-col items-center justify-center py-1">
                <span className={`text-2xl font-bold font-mono ${bad(val) ? errCls : okCls}`}>{val}</span>
                <span className="text-xs text-slate-500 mt-1">{label}</span>
              </div>
            ))}
          </div>

          {/* 카드 수량 */}
          {ps?.cardCounts && (
            <>
              <SectionTitle icon={Hash} iconColor="text-teal-400">카드 수량 (Card Counts)</SectionTitle>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(ps.cardCounts).map(([k, v]) => {
                  const labels = {
                    grid: 'Grid', element: 'Element', property: 'Property',
                    material: 'Material', load: 'Load', boundaryCondition: 'BC',
                    subcase: 'Subcase', param: 'Param',
                  };
                  return (
                    <div key={k} className="bg-slate-800/70 rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
                      <span className="text-xs text-slate-500">{labels[k] || k}</span>
                      <span className="text-lg font-bold text-teal-300 font-mono">{v.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Orphan + BoundingBox */}
          {ps && (ps.orphanNodes != null || ps.boundingBox) && (
            <>
              <SectionTitle iconColor="text-orange-400">추가 분석 정보</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {/* Orphan */}
                {(ps.orphanNodes != null || ps.orphanProperties != null || ps.orphanMaterials != null) && (
                  <div className="bg-slate-800/60 rounded-xl px-4 py-3 space-y-2">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">미사용 항목</p>
                    {[
                      { label: 'Orphan Nodes',      val: ps.orphanNodes },
                      { label: 'Orphan Properties', val: ps.orphanProperties },
                      { label: 'Orphan Materials',  val: ps.orphanMaterials },
                    ].filter(r => r.val != null).map(({ label, val }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className="text-xs text-slate-400 font-mono">{label}</span>
                        <span className={`text-sm font-bold font-mono ${val > 0 ? 'text-yellow-300' : 'text-emerald-400'}`}>
                          {val > 0 ? `⚠ ${val}` : '✓ 0'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* BoundingBox */}
                {ps.boundingBox && (
                  <div className="bg-slate-800/60 rounded-xl px-4 py-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">좌표 범위</p>
                    {['x', 'y', 'z'].map(a => (
                      <div key={a} className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-sky-400 font-mono uppercase w-4">{a}</span>
                        <span className="text-xs text-slate-300 font-mono">
                          {ps.boundingBox[`${a}Min`].toLocaleString()} ~ {ps.boundingBox[`${a}Max`].toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Element Breakdown */}
          {ps?.elementBreakdown && Object.keys(ps.elementBreakdown).length > 0 && (
            <>
              <SectionTitle icon={Box} iconColor="text-sky-400">요소 분류 (Element)</SectionTitle>
              <BreakdownPills data={ps.elementBreakdown} colorCls="bg-sky-900/40 border-sky-800/50 text-sky-200" />
            </>
          )}

          {/* Property Breakdown */}
          {ps?.propertyBreakdown && Object.keys(ps.propertyBreakdown).length > 0 && (
            <>
              <SectionTitle icon={Layers} iconColor="text-violet-400">물성 분류 (Property)</SectionTitle>
              <BreakdownPills data={ps.propertyBreakdown} colorCls="bg-violet-900/40 border-violet-800/50 text-violet-200" />
            </>
          )}

          {/* Material Breakdown */}
          {ps?.materialBreakdown && Object.keys(ps.materialBreakdown).length > 0 && (
            <>
              <SectionTitle icon={Cpu} iconColor="text-amber-400">재질 분류 (Material)</SectionTitle>
              <BreakdownPills data={ps.materialBreakdown} colorCls="bg-amber-900/40 border-amber-800/50 text-amber-200" />
            </>
          )}

          {/* Load Breakdown */}
          {ps?.loadBreakdown && Object.keys(ps.loadBreakdown).length > 0 && (
            <>
              <SectionTitle icon={Zap} iconColor="text-rose-400">하중 분류 (Load)</SectionTitle>
              <BreakdownPills data={ps.loadBreakdown} colorCls="bg-rose-900/40 border-rose-800/50 text-rose-200" />
            </>
          )}

          {/* BC Breakdown */}
          {ps?.bcBreakdown && Object.keys(ps.bcBreakdown).length > 0 && (
            <>
              <SectionTitle icon={Anchor} iconColor="text-emerald-400">경계조건 분류 (BC)</SectionTitle>
              <BreakdownPills data={ps.bcBreakdown} colorCls="bg-emerald-900/40 border-emerald-800/50 text-emerald-200" />
            </>
          )}

          {/* Parser Warnings */}
          {ps?.parserWarnings?.length > 0 && (
            <>
              <SectionTitle icon={Info} iconColor="text-yellow-400">미인식 카드 (Parser Warnings)</SectionTitle>
              <div className="space-y-1">
                {ps.parserWarnings.map((w, i) => (
                  <p key={i} className="text-xs font-mono text-yellow-300/80 leading-relaxed pl-3 border-l-2 border-yellow-800/50">
                    {w}
                  </p>
                ))}
              </div>
            </>
          )}

          {/* Rules Checked */}
          {rulesChecked.length > 0 && (
            <>
              <SectionTitle icon={Shield} iconColor="text-blue-400">검증 규칙 결과 (Rules Checked)</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {rulesChecked.map(item => {
                  const ruleName   = rulesAreObjs ? item.rule   : item;
                  const ruleStatus = rulesAreObjs ? item.status : 'pass';
                  const checked    = rulesAreObjs ? item.checkedCount : null;
                  const errCnt     = rulesAreObjs ? item.errorCount   : 0;
                  const warnCnt    = rulesAreObjs ? item.warningCount : 0;

                  const bgCls = ruleStatus === 'pass'    ? 'bg-emerald-950/40 border-emerald-800/40'
                               : ruleStatus === 'error'  ? 'bg-red-950/40     border-red-800/40'
                                                         : 'bg-yellow-950/40  border-yellow-800/40';
                  const icon  = ruleStatus === 'pass'
                    ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    : ruleStatus === 'error'
                    ? <AlertTriangle size={15} className="text-red-400 shrink-0" />
                    : <AlertTriangle size={15} className="text-yellow-400 shrink-0" />;

                  return (
                    <div key={ruleName} className={`flex items-start gap-2.5 px-3 py-3 rounded-xl border ${bgCls}`}>
                      <div className="mt-0.5">{icon}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-200">{ruleLabels[ruleName] || ruleName}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          {checked != null && `${checked.toLocaleString()}개`}
                          {errCnt  > 0 && <span className="text-red-400 ml-1">/ {errCnt} err</span>}
                          {warnCnt > 0 && <span className="text-yellow-400 ml-1">/ {warnCnt} warn</span>}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Validation Results */}
          <SectionTitle
            icon={AlertTriangle}
            iconColor={step1Data.validationResults?.length > 0 ? 'text-red-400' : 'text-emerald-400'}
          >
            검증 결과 상세 ({step1Data.validationResults?.length ?? 0}건)
          </SectionTitle>
          {step1Data.validationResults?.length > 0 ? (
            <div className="space-y-1.5">
              {step1Data.validationResults.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 px-4 py-2.5 rounded-xl text-xs font-mono ${
                    r.severity === 'error'
                      ? 'bg-red-950/50 border border-red-800/40'
                      : 'bg-yellow-950/50 border border-yellow-800/40'
                  }`}
                >
                  <AlertTriangle
                    size={13}
                    className={`mt-0.5 shrink-0 ${r.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}
                  />
                  <div className="leading-relaxed">
                    <span className={`font-bold mr-2 ${r.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}`}>
                      [{r.severity?.toUpperCase()}]
                    </span>
                    <span className="text-slate-100">{r.cardType} #{r.cardId}</span>
                    {r.fieldName && <span className="text-slate-400 ml-1.5">({r.fieldName})</span>}
                    <span className="text-slate-300 ml-2">{r.message}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-950/40 border border-emerald-800/30 rounded-xl">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span className="text-sm font-mono text-emerald-300 font-bold">모든 검증 규칙 통과 — 참조 무결성 이상 없음</span>
            </div>
          )}

          {/* 전체 판정 배너 */}
          <div className={`mt-6 px-5 py-4 rounded-2xl border flex items-center gap-3 ${
            overallStatus === 'pass'    ? 'bg-emerald-950/60 border-emerald-700/60'
            : overallStatus === 'error' ? 'bg-red-950/60     border-red-700/60'
                                        : 'bg-yellow-950/60  border-yellow-700/60'
          }`}>
            {overallStatus === 'pass'
              ? <CheckCircle2  size={24} className="text-emerald-400 shrink-0" />
              : <AlertTriangle size={24} className={overallStatus === 'error' ? 'text-red-400' : 'text-yellow-400'} />}
            <div>
              <p className={`text-base font-bold ${
                overallStatus === 'pass'    ? 'text-emerald-300'
                : overallStatus === 'error' ? 'text-red-300'
                                            : 'text-yellow-300'
              }`}>
                {overallStatus === 'pass'
                  ? '모델 유효성 검증 통과'
                  : overallStatus === 'error'
                  ? '모델 유효성 오류 — 수정 필요'
                  : '모델 유효성 경고 — 항목 확인 필요'}
              </p>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                오류 {step1Data.summary?.totalErrors ?? 0}건 / 경고 {step1Data.summary?.totalWarnings ?? 0}건
                {useNastran && step2Data && (
                  <span className="ml-4">
                    F06: Fatal {step2Data.summary?.f06Fatals ?? 0} / Warning {step2Data.summary?.f06Warnings ?? 0}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ══════ Step 2 ══════ */}
      {useNastran && step2Data && (
        <div className="p-5">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-purple-300 font-mono">Step 2</span>
              <span className="text-sm text-slate-400">{step2Data.stepName}</span>
              <StatusBadge status={step2Data.status} />
            </div>
            {step2Data.generatedAt && (
              <div className="flex items-center gap-1 text-xs text-slate-500 font-mono">
                <Clock size={11} />
                <span>{new Date(step2Data.generatedAt).toLocaleString('ko-KR')}</span>
              </div>
            )}
          </div>

          {/* F06 카운트 */}
          <div className="grid grid-cols-2 gap-3 mb-5 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
            {[
              { label: 'F06 Fatal',   val: step2Data.summary?.f06Fatals ?? 0,   errCls: 'text-red-300',    okCls: 'text-emerald-300' },
              { label: 'F06 Warning', val: step2Data.summary?.f06Warnings ?? 0, errCls: 'text-yellow-300', okCls: 'text-emerald-300' },
            ].map(({ label, val, errCls, okCls }) => (
              <div key={label} className="flex flex-col items-center justify-center py-1">
                <span className={`text-3xl font-bold font-mono ${val > 0 ? errCls : okCls}`}>{val}</span>
                <span className="text-xs text-slate-500 mt-1">{label}</span>
              </div>
            ))}
          </div>

          {/* Fatal 먼저 */}
          {fatals.length > 0 && (
            <>
              <SectionTitle icon={AlertOctagon} iconColor="text-red-400">
                Fatal 메시지 ({fatals.length}건)
              </SectionTitle>
              {fatals.map((msg, i) => <F06Message key={i} msg={msg} index={i} />)}
            </>
          )}

          {/* Warning */}
          {warnings.length > 0 && (
            <>
              <SectionTitle icon={AlertTriangle} iconColor="text-yellow-400">
                Warning 메시지 ({warnings.length}건)
              </SectionTitle>
              {warnings.map((msg, i) => <F06Message key={i} msg={msg} index={i} />)}
            </>
          )}

          {f06Messages.length === 0 && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-950/40 border border-emerald-800/30 rounded-xl">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span className="text-sm font-mono text-emerald-300 font-bold">Nastran F06 — Fatal / Warning 없음</span>
            </div>
          )}

          {/* Step2 exe 추가 권고 안내 */}
          <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-slate-800/40 border border-slate-700/40 rounded-xl">
            <Info size={13} className="text-slate-500 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-500 leading-relaxed">
              Step 2를 더 풍부하게 하려면 exe에서 <span className="text-slate-300">해석 경과 시간</span>,{' '}
              <span className="text-slate-300">행렬 조건수(condition number)</span>,{' '}
              <span className="text-slate-300">해석 완료 여부(terminated / completed)</span>를 별도 필드로 출력해 주세요.
            </p>
          </div>
        </div>
      )}

      {/* Step2 미실행 */}
      {useNastran && !step2Data && step1Data && (
        <div className="p-5">
          <div className="flex items-start gap-2.5 px-4 py-3.5 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-slate-300 mb-0.5">Step 2: Nastran 해석 검토</p>
              <p className="text-xs font-mono text-slate-500">결과 파일을 로드 중이거나 아직 생성되지 않았습니다.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
