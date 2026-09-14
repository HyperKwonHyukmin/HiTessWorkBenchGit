import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud, ArrowRight, ChevronsRight,
  FileCheck2, Boxes, Waves, ShieldCheck,
  X, Loader2, RotateCcw, FileText, ExternalLink,
  Layers, ArrowDownToLine, Compass, AlertTriangle, Info, Scale, Eye, EyeOff,
  ChevronDown, SlidersHorizontal, Download,
} from 'lucide-react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';
import FileBasedPageBanner from '../../components/analysis/FileBasedPageBanner';
import { usePolling } from '../../hooks/usePolling';
import {
  requestModuleOceanTransport,
  requestModuleOceanStructural,
  calculateModuleOceanAcceleration,
  downloadFileBlob,
  downloadFileText,
  getJungbanViewerModel,
  getModuleOceanViewerModel,
} from '../../api/analysis';
import ValidationStepLog from '../../components/analysis/ValidationStepLog';
import SampleRunButton from '../../components/analysis/SampleRunButton';
import FeModelViewer from '../../components/analysis/FeModelViewer';
import JungbanDeckSelector from '../../components/analysis/JungbanDeckSelector';
import StressColorMapModal from '../../components/analysis/StressColorMapModal';
import LegReactionModal from '../../components/analysis/LegReactionModal';
import SupportSelectionPanel from '../../components/analysis/SupportSelectionPanel';
import SupportPickerModal from '../../components/analysis/SupportPickerModal';
import NumberField from '../../components/analysis/NumberField';
import OceanWeldModal, {
  OceanWeldResultLauncher,
} from '../../components/analysis/OceanWeldModal';
import BargeAccelerationPanel from '../../components/analysis/BargeAccelerationPanel';
import Button from '../../components/ui/Button';
import { downloadBlob, filenameFromDisposition } from '../../utils/fileHelper';
import {
  evaluateSupportSelection, selectionPoints, selectionNodeIds, rigidDependentIndices,
} from '../../utils/supportSelection';
import { DEFAULT_WELD_SPEC, normalizeWeldSpec } from '../../utils/weldSpecDefaults';
import {
  DEFAULT_BARGE_ACCEL_INPUT,
  bargeAccelerationInputKey,
  getBargeAccelerationInputIssues,
  moduleCargoAccelerationInputs,
} from '../../utils/bargeAcceleration';
import {
  DEFAULT_MODULE_OCEAN_ARRANGEMENT,
  DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM,
  resetModuleOceanPlacementState,
} from '../../utils/moduleOceanReset';
import {
  computeModulePlacement,
  deckPlacementCenter,
  buildDeckSurface,
  prepareModuleFootprint,
  computeSeatGap,
  computeSeating,
  findBestSeatingRotation,
  combineMassProperties,
  transformModulePoint,
  DECK_CLEARANCE_MM,
} from '../../utils/feGeometry';

/**
 * 절점 ID 목록을 사람이 읽을 문장으로. 개수만 알려 주면 화면에서 어느 것인지 찾을 수
 * 없다는 지적을 받아 넣었다 — 목록이 길면 앞쪽만 보여 주고 나머지는 개수로 줄인다.
 */
function nodeIdList(ids, limit = 8) {
  if (!ids?.length) return '';
  const head = ids.slice(0, limit).map(v => Number(v).toLocaleString()).join(', ');
  return ids.length > limit ? `${head} 외 ${ids.length - limit}개` : head;
}

/**
 * 스툴 길이를 적치면 층별로 풀어 쓴다.
 *
 * 정반이 2단이라 층마다 스툴이 다르다(정반 A + 3521: 하단 100mm, 상단 370mm).
 * "300~570mm" 한 줄로 뭉치면 어느 자리 스툴이 6m 인지 알 수 없어, 층을 나눠 적는다.
 */
function describeStools(seating) {
  const levels = seating?.supportLevels || [];
  const mm = (v) => Math.round(v).toLocaleString();
  const range = (lo, hi) => (Math.round(hi) - Math.round(lo) >= 1 ? `${mm(lo)}~${mm(hi)}` : mm(lo));
  if (!levels.length) return `스툴 ${mm(seating?.stoolMinMm ?? 0)}mm`;
  if (levels.length === 1) return `스툴 ${range(levels[0].stoolMinMm, levels[0].stoolMaxMm)}mm`;
  return `스툴 ${levels.map(l => `z=${mm(l.landingZMm)} ${range(l.stoolMinMm, l.stoolMaxMm)}mm(${l.count}개)`).join(' · ')}`;
}

const PART_COLOR_JUNGBAN = '#8d9bb0';
const PART_COLOR_MODULE  = '#38bdf8';
// 스툴 — 지지점에서 발밑 적치면까지. 모듈·정반과 확실히 구분되는 색이어야 한다.
const PART_COLOR_STOOL   = '#f59e0b';

// 무게중심 마커 색. 화면 범례와 이 상수가 같은 값을 써야 한다.
const COG_COLOR_DECK   = '#a78bfa';   // 정반
const COG_COLOR_MODULE = '#22c55e';   // Module Unit
const COG_COLOR_TOTAL  = '#ef4444';   // 합산

// ── 상태 설정 (Group & Module Unit 권상 구조 해석과 동일) ─────
const STATUS_CONFIG = {
  wait:     { dot: 'bg-white border-2 border-slate-300',                 badge: 'bg-slate-100 text-slate-500',  label: '대기' },
  running:  { dot: 'bg-blue-500 border-2 border-blue-500 animate-pulse', badge: 'bg-blue-100 text-blue-700',    label: '실행 중' },
  done:     { dot: 'bg-green-500 border-2 border-green-500',             badge: 'bg-green-100 text-green-800',  label: '완료' },
  error:    { dot: 'bg-red-500 border-2 border-red-500',                 badge: 'bg-red-100 text-red-700',      label: '오류' },
  disabled: { dot: 'bg-slate-200 border-2 border-slate-200',             badge: 'bg-slate-100 text-slate-400',  label: '비활성' },
};

// ── 파이프라인 단계 정의 ──────────────────────────────────────
const INITIAL_STEPS = [
  { id: 'bdf-validation',  title: 'Module Unit BDF 입력 검증',     sub: 'BDF 파일 업로드 및 유효성 검증',            icon: FileCheck2,  status: 'wait' },
  { id: 'arrangement',     title: '정반 상부 Module Unit 배치 설정', sub: '내장 정반 모델 위 Module Unit 배치 지정',   icon: Boxes,       status: 'wait' },
  // 한 번 실행하면 두 과정(MU 응력 / Leg 반력+용접)이 함께 나온다. 성격이 다른 검토라
  // 단계를 쪼개는 대신 이 단계 안에서 탭으로 갈라 본다 — 실행 버튼은 하나여야 한다.
  { id: 'structural-run',  title: 'Module Unit 구조 해석 수행',     sub: '구조 검토 · Leg 용접부 강도 평가',          icon: Waves,       status: 'wait' },
];

// 계산 전 내부 대기값. 구조 해석 버튼은 Excel 계산 결과가 현재 입력과 일치할 때만 열린다.
const GRAVITY_ONLY_ACCEL_G = { ax: 0, ay: 0, az: -1 };

// 판정에서 뺄 소구경 배관의 외경 상한 [mm]. NPS 2"(OD 60.3) 이하가 배관 업계에서
// small-bore 의 통상 정의이고, 도면 표기 60.4 까지 담도록 60.5 로 둔다.
// ⚠ 백엔드 module_ocean_bdf.DEFAULT_SMALL_BORE_MAX_OD_MM 과 **같은 값이어야 한다** —
//    이 값은 화면 기본값일 뿐이고 실제 제외는 백엔드가 한다. 어긋나면 화면이 말하는
//    기준과 결과의 기준이 달라진다(이격 상수 DECK_CLEARANCE_MM 과 같은 규칙).
const DEFAULT_SMALL_BORE_MAX_OD_MM = 60.5;

// 3단계 결과 탭. 과정 1 은 Module Unit 자체, 과정 2 는 그것이 정반 Leg 에 주는 힘이다.
const PROCESS_TABS = [
  { id: 'stress', label: '과정 1 · Module Unit 구조 검토', icon: Waves },
  { id: 'weld',   label: '과정 2 · 정반 Leg 용접부 강도 평가', icon: ShieldCheck },
];

/**
 * 접이식 섹션. 3단계는 "입력 → 실행 → 결과" 가 한 화면에 다 있는데, 결과가 나온 뒤에도
 * 입력 카드가 화면을 차지하면 정작 봐야 할 판정이 스크롤 아래로 밀린다.
 * 결과 유무에 따라 기본 펼침을 바꿔 쓴다(결과 전 = 펼침, 결과 후 = 접힘).
 */
function Section({ icon: Icon, title, summary, defaultOpen = true, tone = 'slate', children }) {
  const [open, setOpen] = useState(defaultOpen);
  // useState 는 초기값만 읽는다 — 이것만으로는 해석이 끝나 결과가 나와도 입력 카드가
  // 펼쳐진 채 남아 판정이 스크롤 아래로 밀린다. defaultOpen 이 **뒤집힐 때만** 따라간다
  // (사용자가 직접 연 뒤에는 같은 값이 유지되므로 다시 닫히지 않는다).
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  const ring = tone === 'blue' ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border ${ring} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50/80 cursor-pointer"
      >
        {Icon && <Icon size={14} className="shrink-0 text-slate-400" aria-hidden="true" />}
        <span className="text-xs font-bold text-slate-700">{title}</span>
        {/* 접힌 상태에서도 무엇이 들었는지 한 줄로 읽혀야 연다/안 연다를 판단할 수 있다. */}
        {summary && !open && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{summary}</span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="border-t border-slate-100 p-3.5">{children}</div>}
    </div>
  );
}

/** 판정 배너의 수치 한 칸. */
function VerdictStat({ label, value, unit, bad }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`truncate text-lg font-bold leading-tight ${bad ? 'text-red-600' : 'text-slate-800'}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] font-semibold text-slate-400">{unit}</span>}
      </p>
    </div>
  );
}

/**
 * 3단계 최상단 판정 배너. 사용자가 이 화면에서 **가장 먼저 확인해야 하는 것**만 담는다 —
 * 합/부, 지배 수치 3개, 그리고 형상에서 되짚는 버튼.
 * 근거·가정·모델 조작 내역은 아래 상세와 접이식 섹션으로 내린다.
 */
function StructuralVerdictBanner({
  stress, weld, resultCurrent, onOpenColorMap, onDownloadBdf, downloadingBdf,
}) {
  const s = stress?.summary;
  if (!s) return null;
  const stressNg = s.exceedCount > 0;
  const weldNg = weld?.summary?.status === 'NG';
  const ng = stressNg || weldNg;
  const qualityReview = stress?.quality?.trustworthy === false;
  const incomplete = !weld?.summary || Boolean(weld?.error);
  const review = !resultCurrent || qualityReview || incomplete;
  const status = ng ? 'NG' : review ? '검토 필요' : 'OK';

  return (
    <div className={`rounded-2xl border p-4 ${
      ng ? 'border-red-300 bg-red-50'
        : review ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`rounded-lg px-2.5 py-1 text-sm font-extrabold tracking-wide ${
          ng ? 'bg-red-600 text-white' : review ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {status}
        </span>
        <p className="text-xs font-semibold text-slate-700">
          {!resultCurrent
            ? '현재 화면의 입력과 다른 조건에서 만든 결과입니다 — 다시 해석해야 판정할 수 있습니다'
            : qualityReview
              ? '해석에 특이 자유도 또는 수치 경고가 있습니다 — 원인 확인 전 승인 판정에 사용할 수 없습니다'
              : incomplete
                ? '용접부 평가가 없거나 실패했습니다 — 부재 응력만으로 전체 OK를 판정할 수 없습니다'
            : ng
              ? [stressNg && '부재 응력이 허용을 넘습니다', weldNg && '용접부가 NG 입니다']
                  .filter(Boolean).join(' · ')
              : '부재 응력·용접부 모두 허용 이내입니다'}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* 실제로 푼 모델을 그대로 받아 갈 수 있어야 한다 — 검토서에 붙이거나
              사내 다른 도구로 재검산할 때 필요하다(정반 실형상 포함 합본). */}
          {onDownloadBdf && (
            <button
              type="button"
              onClick={onDownloadBdf}
              disabled={downloadingBdf}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300
                         bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition-colors
                         hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
            >
              {downloadingBdf
                ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                : <Download size={12} aria-hidden="true" />}
              해석 BDF 받기
            </button>
          )}
          <button
            type="button"
            onClick={onOpenColorMap}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800
                       px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-slate-700"
          >
            <Layers size={12} aria-hidden="true" /> 형상에서 확인
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <VerdictStat label="최대 응력" value={s.maxStressMPa.toFixed(1)} unit="MPa" bad={stressNg} />
        <VerdictStat label={`사용률 (허용 ${Math.round(stress.allowableMPa)} MPa)`}
          value={s.maxUsage.toFixed(2)} bad={stressNg} />
        <VerdictStat label="허용 초과 부재" value={s.exceedCount} unit="개" bad={stressNg} />
        {stress.displacementSummary && (
          <VerdictStat label="최대 변위"
            value={Number.isFinite(stress.displacementSummary.maxMagMm)
              ? stress.displacementSummary.maxMagMm.toFixed(1) : '결과 없음'} unit="mm" />
        )}
      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200
        ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200
        ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

// ── BDF 파일 드롭존 ──────────────────────────────────────────
function BdfDropZone({ file, onFile, onClear, disabled }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith('.bdf')) onFile(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
        <FileText size={22} className="text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-800 truncate">{file.name}</p>
          <p className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        {!disabled && (
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-slate-400 hover:text-red-500 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
        disabled
          ? 'border-slate-200 opacity-40 cursor-not-allowed'
          : dragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
      }`}
    >
      <UploadCloud size={28} className={dragOver ? 'text-blue-500' : 'text-slate-300'} />
      <div className="text-center">
        <p className="text-xs font-semibold text-slate-600">Module Unit BDF 파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="text-[10px] text-slate-400 mt-0.5">*.bdf 파일만 지원됩니다 — 정반 모델은 프로그램에 내장되어 있습니다</p>
      </div>
      <input ref={inputRef} type="file" accept=".bdf" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; }} className="hidden" />
    </div>
  );
}

/**
 * 과정 1 상세. 헤드라인 수치(최대응력·사용률·초과·변위)는 상단 판정 배너가 이미 말했으므로
 * 여기서는 **그 숫자를 믿어도 되는가**에 답하는 것만 둔다 — 결과 품질 경고, 판정에서 뺀 것,
 * 모델에 가한 조작. 셋 다 없으면 이 패널은 한 줄로 끝난다.
 */
function StressResultPanel({ stress, model }) {
  if (!stress) return null;

  const s = stress.summary;
  // mechanism 이 남은 채 PARAM,BAILOUT 으로 풀리면 응력이 허수가 될 수 있다.
  // 다만 **고피벗이 있다는 사실만으로 결과 전체를 버리는 것은 과잉 차단**이다 —
  // 실측(3521 모델)에서 특이 자유도는 하중을 거의 받지 않는 짧은 스터브 부재에 몰려
  // 있었고 판정을 지배하는 최대 응력 부재는 영향권 밖이었다. 백엔드가 요소 연결을
  // 되짚어 governingContaminated 로 둘을 갈라 준다.
  const q = stress.quality && stress.quality.trustworthy === false ? stress.quality : null;
  const invalid = Boolean(q);
  // 특이 절점이 전부 자유단이면 원인을 단정해 말할 수 있다(실측 3521: 13/13).
  const allFreeEnds = Boolean(q && q.highPivotNodeCount > 0
    && q.freeEndNodeCount === q.highPivotNodeCount);
  const tone = invalid
    ? { box: 'border-red-300 bg-red-50', head: 'text-red-700', body: 'text-red-700', sub: 'text-red-600' }
    : { box: 'border-amber-300 bg-amber-50', head: 'text-amber-800', body: 'text-amber-800', sub: 'text-amber-700' };

  const dropped = stress.excludedSummary;
  const promoted = model?.rigidPromotion?.promotedEids || [];
  // 그중 조각의 자유 회전을 막으려고 회전(456)까지 잡은 것.
  const escalated = model?.rigidPromotion?.escalatedEids?.length || 0;
  const pairFar = Number.isFinite(model?.maxPairDistanceMm)
    && model.maxPairDistanceMm > (model.pairWarnMm ?? Infinity);

  return (
    <div className="space-y-3">
      {q && (
        <div className={`rounded-xl border p-3.5 ${tone.box}`}>
          <h4 className={`text-xs font-bold ${tone.head}`}>
            {invalid
              ? '⚠ 이 결과는 그대로 믿을 수 없습니다'
              : '⚠ 해석 품질 경고가 있습니다'}
          </h4>
          <p className={`mt-1 text-[11px] leading-relaxed ${tone.body}`}>
            {q.governingContaminated
              ? '구속되지 않은 자유도가 남은 채 해석이 진행됐고, 판정을 지배하는 최대 응력 부재가 그 영향권 안에 있습니다. 이 응력은 허수일 수 있습니다.'
              : '구속되지 않은 자유도가 남은 채 해석이 진행됐습니다. 상위 응력 부재가 탐지 영향권 밖이라는 사실만으로 전체 모델의 수치적 타당성을 확정할 수 없으므로, 원인 검토 전에는 승인 판정에 사용하지 마세요.'}
            {' '}
            {/* "왜 이런 게 나왔나" 에 일반론 대신 이 모델의 사실로 답한다 —
                자유단(부재 하나만 붙은 끝점)은 그 끝의 회전 자유도에 강성이 없다. */}
            {allFreeEnds
              ? <>특이 절점 {q.highPivotNodeCount}개는 <b>전부 부재 하나만 붙은 끝점(자유단)</b>입니다
                  — 입력 BDF 의 국소 형상이지 지지점 부족이 아닙니다.</>
              : q.freeEndNodeCount > 0
                ? <>특이 절점 {q.highPivotNodeCount}개 중 {q.freeEndNodeCount}개가 자유단(부재 하나만
                    붙은 끝점)입니다.</>
                : null}
          </p>
          <details className={`mt-1.5 text-[11px] ${tone.sub}`}>
            <summary className="cursor-pointer font-semibold">특이 절점 목록</summary>
            <p className="mt-1">
              자유도 {q.highPivotDofCount}개 · 절점 {q.highPivotNodeCount}개
              {q.affectedElementCount > 0 && ` · 영향 부재 ${q.affectedElementCount}개`}
            </p>
            {q.highPivotNodeIds?.length > 0 && (
              <p className="mt-0.5 opacity-80">
                절점 {q.highPivotNodeIds.slice(0, 12).join(', ')}
                {q.highPivotNodeIds.length > 12 && ` 외 ${q.highPivotNodeIds.length - 12}개`}
              </p>
            )}
            {q.highPivotDeckNodeIds?.length > 0 && (
              <p className="mt-0.5 opacity-80">
                정반 쪽 절점 {q.highPivotDeckNodeIds.length}개(프로그램 내장 모델)
              </p>
            )}
            {q.contaminatedTopElementIds?.length > 0 && (
              <p className="mt-0.5 opacity-80">
                영향권에 든 상위 응력 부재 EID {q.contaminatedTopElementIds.join(', ')}
              </p>
            )}
          </details>
        </div>
      )}

      {/* 판정에서 뺀 것. 감추면 배관에 실제 문제가 있어도 드러나지 않으므로 여기서 밝힌다. */}
      {dropped && dropped.elementCount > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-xs font-bold text-slate-700">
            판정 제외 — {dropped.reason || '소구경 배관'} {dropped.elementCount.toLocaleString()}개
          </p>
          {dropped.maxStressMPa != null && (
            <p className={`mt-1 text-[11px] leading-relaxed ${
              dropped.exceedCount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
              제외된 배관 최대 <b>{dropped.maxStressMPa.toFixed(1)} MPa</b> (EID {dropped.maxStressElementId})
              {dropped.exceedCount > 0 && ` · 그중 허용 초과 ${dropped.exceedCount}개`}
              {' — 배관 지지 상세는 배관 설계 쪽에서 별도로 확인하세요.'}
            </p>
          )}
          <details className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            <summary className="cursor-pointer font-semibold text-slate-600">왜 빼는가</summary>
            <p className="mt-1">
              이 해석의 평가 대상은 <b>모듈의 구조 부재</b>입니다. 소구경 배관은 화물이고, 실제 지지
              상세(슈·클램프·U볼트)가 BDF 에 없어 <b>관 하나가 배관 계통 전체를 혼자 받는</b> 모양으로
              모델링돼 응력이 비정상적으로 높게 나옵니다. 요소는 모델에 그대로 남아 질량·강성으로
              기여합니다.
            </p>
          </details>
        </div>
      )}

      {/* 사용자 모델을 건드린 내역 — 되짚을 수 있어야 하지만 늘 펼쳐 둘 필요는 없다. */}
      {(promoted.length > 0 || pairFar || stress.supportCount != null) && (
        <details className="rounded-xl border border-slate-200 bg-white p-3.5">
          <summary className="cursor-pointer text-xs font-bold text-slate-700">
            모델 조작 내역
            <span className="ml-1.5 font-normal text-slate-400">
              지지 {stress.supportCount ?? '-'}점
              {promoted.length > 0 && ` · 고박 승격 ${promoted.length}개`}
              {escalated > 0 && ` (회전까지 ${escalated}개)`}
              {pairFar && ' · 지지 거리 경고'}
            </span>
          </summary>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            지지점 {stress.supportCount}개를 발밑 적치면 절점에 RBE2 로 연결했습니다.
          </p>

          {pairFar && (
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-amber-700">
              지지점 ↔ 정반 절점 최대 수평 거리 {Math.round(model.maxPairDistanceMm).toLocaleString()} mm —
              정반 격자({Math.round(model.pairWarnMm).toLocaleString()}mm 기준)보다 멀어 스툴이 그만큼
              비스듬히 붙었습니다.
            </p>
          )}

          {promoted.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5
                            text-[11px] leading-relaxed text-amber-800">
              <b>고박 처리 — 부분 구속 RBE2 {promoted.length}개에 병진 3방향(123) 구속을 채웠습니다.</b>
              {' '}입력 BDF 는 운전 조건이라 배관 지지가 한두 축만 잡는 <b>미끄러지는 지지</b>인데,
              운송 가속도는 그 자유 방향으로 그대로 들어옵니다. 회전은 일부러 잡지 않습니다 —
              회전까지 강결하면 짧은 부재에 실재하지 않는 모멘트가 생깁니다.
              {escalated > 0 && (
                <span className="mt-0.5 block">
                  그중 <b>{escalated}개</b>는 회전까지 잡았습니다 — 그 자리를 병진만 잡으면
                  조각이 그 점을 축으로 돌아가 버립니다(강체를 고정하려면 한 점 완전구속이거나
                  비공선 3점이 필요합니다).
                </span>
              )}
              {/* 바꾼 EID 전체 목록은 결과 JSON(rigidPromotion.promotedEids / escalatedEids)에
                  남는다 — 화면에 늘어놓아도 읽는 사람이 할 일이 없어 개수만 밝힌다. */}
              {model.rigidPromotion.skippedConflictCount > 0 && (
                <span className="mt-0.5 block">
                  ⚠ {model.rigidPromotion.skippedConflictCount}개는 같은 절점의 같은 자유도가 이미 다른
                  강체의 종속이라 올리지 못했습니다 — 그 자리는 여전히 미끄러지는 지지입니다.
                </span>
              )}
              {model.rigidPromotion.ungroundedComponentCount > 0 && (
                <span className="mt-0.5 block">
                  ⚠ 승격 뒤에도 본체에 접지되지 않은 조각이 {model.rigidPromotion.ungroundedComponentCount}개
                  남아 있습니다 — 그 부분의 변위·응력은 믿을 수 없습니다.
                </span>
              )}
            </div>
          )}
        </details>
      )}

      <p className="text-[11px] text-slate-400">
        평가 부재 {(s.evaluatedCount ?? s.elementCount).toLocaleString()}개
        {s.excludedCount > 0 && ` · 제외 ${s.excludedCount.toLocaleString()}개`}
        {' · '}최대 응력 부재 EID {s.maxStressElementId}
      </p>
    </div>
  );
}


/**
 * 정반은 프로그램 내장 고정 모델이라 앱을 쓰는 동안 바뀌지 않는다.
 * 페이지 상태가 아니라 모듈 수준에 캐시해 두면 전체 초기화·재진입 후에도 재다운로드가 없다.
 *
 * A/B 두 타입을 한 map 에 담는다 — 선택 화면에서 미리보기로 이미 받아 둔 지오메트리를
 * 배치 화면이 그대로 재사용하므로, 타입을 골라도 추가 다운로드가 없다.
 */
const jungbanModelCache = {};   // deckType -> 슬림 지오메트리

/** 현재 배치 수치 한 칸. span 으로 여러 열을 차지할 수 있다. */
function PlacementStat({ label, value, emphasis, span = false }) {
  return (
    <div className={`min-w-0 ${span ? 'col-span-3' : ''}`}>
      <p className="text-[9px] text-slate-400 truncate">{label}</p>
      <p className={`text-[11px] font-mono truncate ${emphasis ? 'font-bold text-blue-600' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * 2단계 하단 배치 도크.
 * 뷰어 아래에 가로로 눕혀 모델 화면이 좌우 폭을 온전히 쓰도록 한다
 * (우측 세로 컬럼이던 것을 옮긴 것 — 3D 형상 판독에는 가로 폭이 훨씬 중요하다).
 */
function ArrangementPanel({
  offsetXMm, offsetYMm, rotationZDeg,
  onChange, onReset, placement, disabled,
  contactTolMm, onContactTolChange, onSeat, seating, seatingBusy,
  onCompareRotations, rotationCandidates, onApplyRotation,
  nodeIdsAt, seatGap, landingLevels, supportCount,
}) {
  const mm = (v) => Math.round(v).toLocaleString();

  return (
    <div className={`shrink-0 flex flex-col gap-3 lg:flex-row ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* ─ 배치 설정 ─ */}
      <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">배치 설정</span>
            <span className="text-[9px] text-slate-400 truncate">
              기본값 = 정반 기준 적치면 XY 중심 정렬 · 높이는 <b>지지점마다 발밑 적치면 +{DECK_CLEARANCE_MM}mm</b> 로 자동 · 단위 mm
            </span>
          </div>
          <button
            onClick={onReset}
            title="기본 배치로 되돌리기"
            className="flex items-center gap-1 shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <RotateCcw size={10} /> 기본값
          </button>
        </div>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* 높이는 사용자가 만지지 않는다 — 지지점마다 **발밑 적치면**을 찾아 그 위
              +{DECK_CLEARANCE_MM}mm 를 확보하고, 가장 빡빡한 지지점에 맞춰 모듈 전체가 내려앉는다.
              정반이 2단이면 층마다 스툴 길이가 다르게 나오므로 층별로 적는다. */}
          <div className="min-w-0">
            <p className="text-[9px] text-slate-400 truncate">스툴 높이 (적치면 → 지지점)</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-sm font-bold font-mono text-slate-700">
                {seatGap?.levels?.length
                  ? seatGap.levels
                      .map(l => Math.round(l.stoolMinMm).toLocaleString()
                        + (Math.round(l.stoolMaxMm) - Math.round(l.stoolMinMm) >= 1
                          ? `~${Math.round(l.stoolMaxMm).toLocaleString()}` : ''))
                      .join(' / ')
                  : DECK_CLEARANCE_MM}
              </span>
              <span className="text-[10px] text-slate-400">mm</span>
            </p>
            <p className="text-[9px] text-slate-400 leading-snug">
              {seatGap?.levels?.length > 1
                ? seatGap.levels.map(l => `z=${Math.round(l.landingZMm).toLocaleString()} ${l.count}개`).join(' · ')
                : `지지점이 적치면 +${DECK_CLEARANCE_MM}mm 에 앉습니다. 모듈은 정반에 닿지 않습니다.`}
            </p>
          </div>
          <NumberField
            label="X 오프셋 (종방향)"
            unit="mm"
            value={offsetXMm}
            step={500}
            onChange={(v) => onChange({ offsetXMm: v })}
            title="정반 XY 중심 기준 종방향 이동량"
          />
          <NumberField
            label="Y 오프셋 (횡방향)"
            unit="mm"
            value={offsetYMm}
            step={500}
            onChange={(v) => onChange({ offsetYMm: v })}
            title="정반 XY 중심 기준 횡방향 이동량"
          />
          <NumberField
            label="Z축 회전"
            unit="deg"
            value={rotationZDeg}
            step={15}
            onChange={(v) => onChange({ rotationZDeg: v })}
            title="Module Unit 자체 평면 중심을 축으로 회전합니다."
          />
        </div>

        {/* ─ 적치 ─ 현재 회전·오프셋 그대로 두고, 지지점이 발밑 적치면 위 이격값에 오도록 내린다 */}
        <div className="px-3 pb-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={onSeat}
            disabled={seatingBusy}
            title="현재 회전·오프셋에서 지지점 발밑에 적치면이 있는지, 지지점보다 낮은 부재가 정반에 닿지 않는지 검사합니다."
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
          >
            <ArrowDownToLine size={13} /> 적치 검사
          </button>
          <button
            onClick={onCompareRotations}
            disabled={seatingBusy}
            title="1° 간격으로 360회 평가해 후보를 만듭니다. 자동으로 적용하지 않고 수치를 보여 드립니다."
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-200 bg-white hover:bg-blue-50 disabled:opacity-50 text-blue-600 text-xs font-bold transition-colors cursor-pointer"
          >
            <Compass size={13} /> 회전각 비교
          </button>
          {/* 지지점을 지정하면 이 값은 아무 데도 쓰이지 않는다 — 적치 높이도 지지 다각형도
              지지점에서 나온다. 남겨 두면 "이걸 만지면 결과가 바뀌나" 하는 오해를 준다. */}
          {!supportCount && (
            <div className="w-32">
              <NumberField
                label="밑면 판정 두께"
                unit="mm"
                value={contactTolMm}
                step={10}
                onChange={onContactTolChange}
                title="지지점을 지정하기 전 미리보기에만 쓰입니다. 모듈 최하단에서 이 값 이내의 절점을 '밑면'으로 봅니다. 지지점을 지정하면 이 값은 쓰이지 않습니다."
              />
            </div>
          )}
          {seating && (
            <div className="flex-1 min-w-[240px] text-[10px] leading-relaxed">
              {seating.ok ? (
                <>
                  {/* 이 화면이 답하는 것은 셋이다 — 지지점 발밑에 적치면이 다 있는가,
                      지지점보다 낮은 부재가 정반 위에 있는가, 모듈이 적치면을 얼마나 덮는가.
                      모듈 일부가 정반 밖으로 나가는 것 자체는 정상이다. */}
                  <span className="font-bold text-slate-700">
                    적치면 위 절점 {seating.onPlateCount.toLocaleString()} / {(seating.onPlateCount + seating.offPlateCount).toLocaleString()}
                    <span className="ml-1 text-slate-400 font-normal">({Math.round(seating.onPlateRatio * 100)}%)</span>
                  </span>
                  {seating.supportCount > 0 && (
                    <span className="text-slate-400">
                      {' · '}지지점 {seating.supportCount}개{' · '}{describeStools(seating)}
                    </span>
                  )}
                  {seating.supportCount === 0 && (
                    <p className="mt-0.5 flex items-start gap-1 text-slate-500">
                      <Info size={11} className="shrink-0 mt-px" />
                      아직 지지점이 없어 모듈 바닥을 기준 적치면 +{DECK_CLEARANCE_MM}mm 에 둔 미리보기입니다.
                      위에서 지지점을 먼저 지정하세요.
                    </p>
                  )}
                  {seating.supportsOffPlateCount > 0 && (
                    <p className="mt-0.5 flex items-start gap-1 text-red-700 font-semibold">
                      <AlertTriangle size={11} className="shrink-0 mt-px" />
                      <span>
                        지지점 절점 {nodeIdList(nodeIdsAt(seating.supportsOffPlate))} 발밑에 정반 적치면이
                        없습니다 — 스툴을 세울 자리가 없습니다(뷰어에 <b className="text-red-600">빨간 점</b>).
                        회전·오프셋으로 정반 안으로 넣거나 그 지지점을 다시 고르세요.
                      </span>
                    </p>
                  )}
                  {seating.clearanceShortfallCount > 0 && (
                    <p className="mt-0.5 flex items-start gap-1 text-red-700 font-semibold">
                      <AlertTriangle size={11} className="shrink-0 mt-px" />
                      <span>
                        지지점보다 낮은 부재가 정반 위에 있습니다 — 절점
                        {' '}{nodeIdList(nodeIdsAt([seating.worstClearanceIndex]))}
                        {' '}이 정반면에서 {Math.round(seating.minDeckClearanceMm).toLocaleString()}mm 밖에 안 떨어져 있습니다
                        (필요 {DECK_CLEARANCE_MM}mm, 이런 절점 {seating.clearanceShortfallCount.toLocaleString()}개).
                        그 자리를 지지점에 추가하거나 배치를 조정하세요.
                      </span>
                    </p>
                  )}
                  {seating.supportsOffPlateCount === 0 && seating.clearanceShortfallCount === 0
                    && seating.contacts.length >= 3 && !seating.supportsCentroid && (
                    <p className="mt-0.5 flex items-start gap-1 text-amber-700 font-semibold">
                      <AlertTriangle size={11} className="shrink-0 mt-px" />
                      지지점이 한 줄로 몰려 평면 중심을 받치지 못합니다 — 지지점을 넓게 고르거나 회전을 조정하세요.
                    </p>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-1 text-amber-700 font-semibold">
                  <AlertTriangle size={11} className="shrink-0 mt-px" /> {seating.reason}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ─ 회전각 후보 ─ 코드가 고르지 않는다. 수치를 나란히 두고 사용자가 고른다. */}
        {rotationCandidates && (
          <div className="px-3 pb-3">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
                <span className="text-[10px] font-bold text-slate-500">
                  회전각 후보 — 눌러서 적용 (지지점이 모두 적치면 위에 있고 점유율·여유가 클수록 좋다)
                </span>
                <span className="text-[9px] text-slate-400">자동 적용하지 않습니다</span>
              </div>
              <div className="max-h-36 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="text-slate-400">
                    <tr className="border-b border-slate-100">
                      <th className="text-left font-semibold px-2.5 py-1">회전</th>
                      <th className="text-right font-semibold px-2 py-1">지지 절점</th>
                      <th className="text-right font-semibold px-2 py-1">지지 범위</th>
                      <th className="text-right font-semibold px-2 py-1">가장자리 여유</th>
                      <th className="text-right font-semibold px-2 py-1">스툴</th>
                      <th className="text-right font-semibold px-2 py-1">적치면 점유</th>
                      <th className="text-right font-semibold px-2.5 py-1">문제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotationCandidates.map((c, idx) => {
                      const r = c.seating;
                      const current = Math.round(rotationZDeg) === c.rotationZDeg;
                      // 축 정렬(0/90/180/270)과 그 외를 눈에 띄게 나눈다 — 적치는 축 정렬이 기본이라
                      // 두 그룹을 한 줄로 섞어 점수순으로 세우면 4° 비튼 각도가 위로 올라온다.
                      const groupHead = c.group === 'other' && rotationCandidates[idx - 1]?.group !== 'other';
                      return (
                        <React.Fragment key={`g${c.rotationZDeg}`}>
                        {groupHead && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="px-2.5 py-1 text-[9px] font-bold text-slate-400">
                              그 외 후보 (축에서 벗어난 각도)
                            </td>
                          </tr>
                        )}
                        <tr
                          onClick={() => onApplyRotation(c)}
                          className={`cursor-pointer border-b border-slate-50 last:border-b-0 transition-colors ${
                            current ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className={`px-2.5 py-1 font-bold ${current ? 'text-blue-700' : 'text-slate-700'}`}>
                            {c.rotationZDeg}°{current && ' (현재)'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">{r.contacts.length}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">
                            {Math.round(r.contactSpan[0]).toLocaleString()} × {Math.round(r.contactSpan[1]).toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">
                            {Math.round(r.contactEdgeMarginMm).toLocaleString()}mm
                          </td>
                          {/* 단차 정반에서는 스툴 길이가 각도를 가른다 — 12m 스툴은 못 세운다. */}
                          <td className={`px-2 py-1 text-right font-mono ${
                            r.stoolMaxMm > 3000 ? 'text-amber-600 font-bold' : 'text-slate-600'
                          }`}>
                            {Math.round(r.stoolMinMm).toLocaleString()}~{Math.round(r.stoolMaxMm).toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">
                            {Math.round(r.onPlateRatio * 100)}%
                          </td>
                          {/* 3단계를 막는 두 조건. 지지점이 적치면을 벗어났거나(스툴 자리 없음),
                              지지점보다 낮은 부재가 정반에 너무 가까운 경우다. */}
                          <td className={`px-2.5 py-1 text-right font-mono font-bold ${
                            (r.supportsOffPlateCount || r.clearanceShortfallCount)
                              ? 'text-red-600' : 'text-emerald-600'
                          }`}>
                            {r.supportsOffPlateCount ? `지지점 ${r.supportsOffPlateCount}개 이탈`
                              : r.clearanceShortfallCount ? `이격 ${Math.round(r.minDeckClearanceMm).toLocaleString()}mm`
                              : '없음'}
                          </td>
                        </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─ 현재 배치 ─ */}
      <div className="lg:w-[400px] lg:shrink-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-3.5 py-2 border-b border-slate-100">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">현재 배치</span>
        </div>
        <div className="p-3">
          {placement?.position ? (
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              {/* ⚠ '정반 상면' 이라고만 적으면 2단 정반에서 오독한다 — MU 바닥 2,320 이
                  상면 8,026 보다 낮게 찍혀 모듈이 정반을 6m 뚫고 들어간 것처럼 보인다.
                  실제로는 하단 적치면(2,020) 위에 앉은 것이다. 그래서 층을 다 적는다. */}
              <PlacementStat label="최상단 적치면 Z" value={mm(placement.deckTopZ)} />
              <PlacementStat label="MU 바닥 Z" value={mm(placement.moduleBottomZ)} emphasis />
              <PlacementStat label="MU 상단 Z" value={mm(placement.moduleTopZ)} />
              {landingLevels?.length > 1 && (
                <PlacementStat
                  span
                  label={`정반 적치면 ${landingLevels.length}층 (Z · 면적)`}
                  value={landingLevels
                    .map(lv => `${mm(lv.z)} (${(lv.area / 1e6).toFixed(0)}㎡)`)
                    .join('  /  ')}
                />
              )}
              <PlacementStat label="MU 중심 X" value={mm(placement.position[0])} />
              <PlacementStat label="MU 중심 Y" value={mm(placement.position[1])} />
              {/* 세 축 치수를 한 줄에 담아야 잘리지 않는다 — 전체 폭 사용. */}
              <PlacementStat
                span
                label="MU 크기 X×Y×Z"
                value={placement.moduleSize.map(mm).join(' × ')}
              />
            </div>
          ) : (
            <div className="space-y-1">
              {placement && (
                <p className="text-[10px] font-mono text-slate-500">
                  정반 상면 Z = {mm(placement.deckTopZ)} mm
                </p>
              )}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Module Unit 모델이 로드되면 배치 좌표가 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
/** 중량 여유(%) 입력. 기본 0 — 계산값을 그대로 쓰는 것이 기본이고, 여유는 사용자가 명시할 때만 붙는다. */
function ContingencyField({ label, value, onChange, disabled }) {
  return (
    <label className={`flex items-center gap-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <span className="text-[9px] text-slate-400 whitespace-nowrap">{label}</span>
      <span className="relative">
        <input
          type="number" step={1} min={0} value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          className="w-14 pl-1.5 pr-4 py-0.5 text-[11px] font-mono text-right border border-slate-200 rounded-md
                     focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
        />
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 pointer-events-none">%</span>
      </span>
    </label>
  );
}

/** 한 물체(정반 / 모듈 / 합산)의 중량·무게중심 칸. */
function MassEntry({ label, color, entry, base, contingencyPct, emphasis }) {
  const ton = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const mm  = (v) => Math.round(v).toLocaleString();
  return (
    <div className={`min-w-0 rounded-xl border p-2.5 ${emphasis ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-bold text-slate-500 truncate">{label}</span>
      </div>
      {entry ? (
        <>
          <p className={`text-sm font-mono font-bold ${emphasis ? 'text-red-600' : 'text-slate-800'}`}>
            {ton(entry.massTon)} <span className="text-[10px] font-sans font-normal text-slate-400">t</span>
          </p>
          {/* 여유를 걸었을 때만 계산 원값을 같이 보여 준다 — 어디서 온 숫자인지 추적 가능해야 한다. */}
          {contingencyPct ? (
            <p className="text-[9px] text-slate-400 font-mono">
              계산값 {ton(base)} t + 여유 {contingencyPct}%
            </p>
          ) : null}
          <p className="mt-1 text-[10px] font-mono text-slate-500 leading-tight">
            X {mm(entry.cogMm.x)}<br />Y {mm(entry.cogMm.y)}<br />Z {mm(entry.cogMm.z)}
          </p>
        </>
      ) : (
        <p className="text-[10px] text-slate-400 py-2">—</p>
      )}
    </div>
  );
}

/**
 * 2단계 중량·무게중심 요약.
 *
 * 왜 계산값과 여유 적용값을 함께 보여 주나: 이 숫자는 그대로 반력 산정으로 넘어간다.
 * 나중에 "이 중량이 어디서 나왔나" 를 되짚을 수 있어야 해서 원값·여유율을 화면에 남긴다.
 */
function MassSummaryPanel({
  summary, deckLabel, showCog, onToggleCog,
  deckContingencyPct, onDeckContingencyChange,
  moduleContingencyPct, onModuleContingencyChange,
  deckSkipped, moduleSkipped,
}) {
  const skipNotes = [
    ...Object.entries(deckSkipped || {}).map(([k, v]) => `정반 — ${k} ${v}개`),
    ...Object.entries(moduleSkipped || {}).map(([k, v]) => `Module Unit — ${k} ${v}개`),
  ];
  const both = summary?.includes?.deck && summary?.includes?.module;

  return (
    <div className="shrink-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-slate-100">
        <div className="flex items-baseline gap-2 min-w-0">
          <Scale size={12} className="text-slate-400 shrink-0 self-center" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">중량 · 무게중심</span>
          <span className="text-[9px] text-slate-400 truncate">
            BDF 단면·두께·밀도와 CONM2 로 산출 · 좌표는 정반 기준 · 단위 t / mm
          </span>
        </div>
        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <input
            type="checkbox" checked={showCog} onChange={(e) => onToggleCog(e.target.checked)}
            className="w-3 h-3 accent-red-500 cursor-pointer"
          />
          <span className="text-[10px] font-bold text-slate-500">3D 표시</span>
        </label>
      </div>

      {summary ? (
        <div className="p-3">
          <div className="grid grid-cols-3 gap-2">
            <MassEntry
              label={deckLabel} color={COG_COLOR_DECK}
              entry={summary.deck} base={summary.deck?.baseMassTon}
              contingencyPct={deckContingencyPct}
            />
            <MassEntry
              label="Module Unit" color={COG_COLOR_MODULE}
              entry={summary.module} base={summary.module?.baseMassTon}
              contingencyPct={moduleContingencyPct}
            />
            <MassEntry
              label={both ? '합산 (정반 + Module Unit)' : '합산'}
              color={COG_COLOR_TOTAL}
              entry={both ? summary.total : null}
              base={summary.baseMassTon} contingencyPct={0} emphasis
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">중량 여유</span>
            <ContingencyField label="정반" value={deckContingencyPct} onChange={onDeckContingencyChange} />
            <ContingencyField
              label="Module Unit" value={moduleContingencyPct}
              onChange={onModuleContingencyChange} disabled={!summary.includes?.module}
            />
            {!summary.includes?.module && (
              <span className="text-[9px] text-slate-400">
                Module Unit 모델이 배치되면 합산됩니다.
              </span>
            )}
          </div>

          {skipNotes.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <AlertTriangle size={11} className="shrink-0 mt-px" />
              <span className="leading-relaxed">
                중량에 반영되지 않은 요소가 있습니다 — {skipNotes.join(' · ')}.
                표시된 중량은 실제보다 작습니다.
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="px-3.5 py-3 text-[11px] text-slate-400">
          모델을 불러오면 중량과 무게중심이 계산됩니다.
        </p>
      )}
    </div>
  );
}

export default function ModuleUnitOceanTransportAnalysis() {
  const { setCurrentMenu } = useNavigation();
  const MENU_NAME = 'Module Unit 해상 운송 구조 해석';
  const dashboardCtx = useDashboard();
  const {
    startGlobalJob,
    clearGlobalJob,
    getJobForMenu,
    analysisPageStates,
    setAnalysisPageState,
    clearAnalysisPageState,
    clearGlobalJobForMenu,
  } = dashboardCtx;
  const savedPageState = analysisPageStates?.[MENU_NAME] || {};
  // 다른 App 해석이 더 최근이어도 이 App 의 해석을 집어야 한다(globalJob 은 최신 1개일 뿐).
  const pageJob = getJobForMenu?.(MENU_NAME) || null;
  const { showToast } = useToast();

  // ── 파이프라인 상태 ──────────────────────────────────────
  // 단계 구성이 바뀌면(4단계 용접 평가를 3단계 과정 2 로 흡수) 저장된 옛 단계 배열은
  // 길이가 달라 activeIdx 가 없는 칸을 가리킨다 — 구성이 다르면 통째로 버린다.
  const [steps, setSteps] = useState(() => {
    const saved = savedPageState.steps;
    const sameShape = Array.isArray(saved) && saved.length === INITIAL_STEPS.length
      && saved.every((s, i) => s?.id === INITIAL_STEPS[i].id);
    // 아이콘은 직렬화되지 않으므로 항상 코드 쪽 정의에서 되살린다.
    return sameShape
      ? saved.map((s, i) => ({ ...INITIAL_STEPS[i], status: s.status }))
      : INITIAL_STEPS;
  });
  const [activeIdx, setActiveIdx] = useState(
    () => Math.min(savedPageState.activeIdx ?? 0, INITIAL_STEPS.length - 1),
  );
  // 검증이 성공적으로 끝났는지 여부 — 다음 단계 이동 게이트.
  const [hasRunOnce, setHasRunOnce] = useState(savedPageState.hasRunOnce ?? false);

  // ── Step 1: BDF 입력 검증 ────────────────────────────────
  const [bdfFile, setBdfFile]               = useState(savedPageState.bdfFile ?? null);
  const [validating, setValidating]         = useState(savedPageState.validating ?? false);
  const [validJobId, setValidJobId]         = useState(savedPageState.validJobId ?? null);
  const [validProgress, setValidProgress]   = useState(savedPageState.validProgress ?? 0);
  const [validStatusMsg, setValidStatusMsg] = useState(savedPageState.validStatusMsg ?? '');
  const [step1Data, setStep1Data]           = useState(savedPageState.step1Data ?? null);
  const [step2Data, setStep2Data]           = useState(savedPageState.step2Data ?? null);
  // 검증이 만든 모델 JSON 의 **서버 경로**. 원본은 대형 모델에서 30MB 를 넘으므로
  // 브라우저로 직접 받지 않고, 2단계에서 백엔드 슬림 변환 엔드포인트로 가져온다.
  const [modelJsonPath, setModelJsonPath]   = useState(savedPageState.modelJsonPath ?? null);
  const [bdfPath, setBdfPath]               = useState(savedPageState.bdfPath ?? null);
  // 검증 시 생성된 Analysis.id (DB record) — 후속 단계에서 parent 로 참조한다.
  const [bdfAnalysisId, setBdfAnalysisId]   = useState(savedPageState.bdfAnalysisId ?? null);

  // Nastran 을 통한 BDF 입력 검증은 기본 OFF — 필요 시 사용자가 토글로 켠다.
  const [useNastran, setUseNastran] = useState(savedPageState.useNastran ?? false);

  // ── Step 2: 정반 타입 / 뷰어 / 배치 ──────────────────────
  // 정반 타입(A/B). null 이면 2단계에서 선택 화면을 먼저 보여 준다.
  // 기본값을 두지 않는 이유 — 타입에 따라 정반 길이가 6m 차이 나므로 사용자가 반드시 골라야 한다.
  const [deckType, setDeckType] = useState(savedPageState.deckType ?? null);
  const [jungbanModel, setJungbanModel] = useState(
    () => (savedPageState.deckType ? jungbanModelCache[savedPageState.deckType] ?? null : null),
  );
  const [moduleModel, setModuleModel]   = useState(savedPageState.moduleModel ?? null);
  const [viewerStatus, setViewerStatus] = useState('idle');   // idle | loading | ready | error
  const [viewerError, setViewerError]   = useState(null);
  // '다시 시도' 및 새 검증 시 로드를 강제로 다시 태우기 위한 토큰.
  const [viewerReloadToken, setViewerReloadToken] = useState(0);
  // 높이는 더 이상 arrangement 에 없다 — 지지점마다 발밑 적치면 +DECK_CLEARANCE_MM 에 오도록 파생된다.
  // 되살린 옛 상태에 gapMm 이 남아 있어도 그대로 무시된다.
  const [arrangement, setArrangement]   = useState(() => ({
    ...DEFAULT_MODULE_OCEAN_ARRANGEMENT,
    ...(savedPageState.arrangement ?? {}),
  }));
  // 적치 — 최저 접점에서 이 값 이내를 지지점으로 센다. 바닥이 완전히 평평한 모델은
  // 거의 없어서 1mm 로 두면 지지점이 1점·1줄로만 잡힌다.
  const [contactTolMm, setContactTolMm] = useState(
    savedPageState.contactTolMm ?? DEFAULT_MODULE_OCEAN_CONTACT_TOL_MM,
  );
  // 중량 여유(%) — 기본 0. 계산값(순수 모델 중량)과 여유 적용값을 화면에 함께 보여 추적 가능하게 한다.
  const [showCog, setShowCog] = useState(true);
  // 정반이 Unit 밑면과 스툴을 가려 "어디를 받치는지" 를 못 읽는다 — 반투명 토글.
  const [deckTransparent, setDeckTransparent] = useState(savedPageState.deckTransparent ?? false);
  const [deckContingencyPct, setDeckContingencyPct]     = useState(savedPageState.deckContingencyPct ?? 0);
  const [moduleContingencyPct, setModuleContingencyPct] = useState(savedPageState.moduleContingencyPct ?? 0);
  // 적치 결과는 2단계의 산출물이자 3단계의 입력(접촉 절점 ID)이다 — 보존하지 않으면
  // 다른 메뉴에 다녀온 뒤 완료 표식과 3단계 실행 가능 여부가 함께 사라진다.
  const [seating, setSeating]           = useState(savedPageState.seating ?? null);
  const [seatingBusy, setSeatingBusy]   = useState(false);
  // 지지점(경계조건) 지정 — 자동 접촉 탐지는 Z 임계값만 보기 때문에 밑면이 평평하지 않은
  // 모듈에서는 한 줄짜리 지지를 고른다(실측: 5점 전부 같은 Y). 실제 지지는 높이가 다른
  // 스툴을 어디에 놓을지의 **설계 결정**이라 형상에서 유도할 수 없어 사용자가 지정한다.
  // 값은 뷰어 positions 인덱스다(모듈 자체 절점이라 회전·오프셋을 바꿔도 유효하다).
  // 지정은 전용 모달에서 한다 — 2단계 뷰어는 정반이 Unit 밑면을 가려 찍을 수가 없다.
  const [supportPickerOpen, setSupportPickerOpen] = useState(false);
  const [supportIdx, setSupportIdx] = useState(() => new Set(savedPageState.supportIdx ?? []));
  const [rotationCandidates, setRotationCandidates] = useState(null);

  // ── Step 3: 구조 해석 ────────────────────────────────────────
  const [accel, setAccel] = useState(savedPageState.accel ?? { ...GRAVITY_ONLY_ACCEL_G });
  const [accelerationInput, setAccelerationInput] = useState(
    savedPageState.accelerationInput ?? { ...DEFAULT_BARGE_ACCEL_INPUT },
  );
  const [accelerationResult, setAccelerationResult] = useState(
    savedPageState.accelerationResult ?? null,
  );
  const [accelerationBusy, setAccelerationBusy] = useState(false);
  const [accelerationError, setAccelerationError] = useState(null);
  const [material, setMaterial] = useState(savedPageState.material ?? { sigmaYMPa: 275, factor: 0.8 });
  // 판정에서 뺄 소구경 배관의 외경 상한. 0 이면 제외하지 않는다.
  const [smallBoreMaxOdMm, setSmallBoreMaxOdMm] = useState(
    savedPageState.smallBoreMaxOdMm ?? DEFAULT_SMALL_BORE_MAX_OD_MM);
  // Nastran 해석은 수 분 걸린다. job id 를 페이지 상태에 남겨 두지 않으면
  // 화면을 벗어난 순간 폴링이 끊기고, 백엔드는 계속 도는데 결과가 영영 안 뜬다.
  const [structuralJobId, setStructuralJobId] = useState(savedPageState.structuralJobId ?? null);
  const [structuralBusy, setStructuralBusy] = useState(false);
  const [structuralProgress, setStructuralProgress] = useState(0);
  const [structuralMsg, setStructuralMsg] = useState('');
  const [structuralError, setStructuralError] = useState(null);
  const [structuralResult, setStructuralResult] = useState(savedPageState.structuralResult ?? null);
  const [structuralResultInputKey, setStructuralResultInputKey] = useState(
    savedPageState.structuralResultInputKey ?? null);
  const pendingStructuralInputKeyRef = useRef(null);
  // 색맵 모달 — 결과가 큰 배열이라 열 때만 받는다(페이지 상태에 저장하지 않는다).
  const [colorMapOpen, setColorMapOpen] = useState(false);
  const [bdfDownloading, setBdfDownloading] = useState(false);
  const [legModalOpen, setLegModalOpen] = useState(false);
  const [weldModalOpen, setWeldModalOpen] = useState(false);

  const allowableMPa = useMemo(
    () => Number(material.sigmaYMPa || 0) * Number(material.factor || 0),
    [material],
  );
  // 입력칸 값 → 실제로 서버에 보낼 값. 빈 칸(사용자가 지운 상태)은 기본값으로 되돌리고,
  // 0 은 '제외 안 함'이라는 사용자 의도이므로 그대로 살린다.
  const smallBoreMaxOdMmForRun = useMemo(() => {
    const raw = String(smallBoreMaxOdMm ?? '').trim();
    if (raw === '') return DEFAULT_SMALL_BORE_MAX_OD_MM;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SMALL_BORE_MAX_OD_MM;
  }, [smallBoreMaxOdMm]);
  const accelerationKey = useMemo(
    () => bargeAccelerationInputKey(accelerationInput),
    [accelerationInput],
  );
  const accelerationIsCurrent = Boolean(
    accelerationResult?.inputKey === accelerationKey,
  );
  const accelerationInputIssues = useMemo(
    () => getBargeAccelerationInputIssues(accelerationInput),
    [accelerationInput],
  );

  // ── 3단계 과정 2: 정반 Leg 용접부 강도 평가 ──────────────
  // 사양은 사용자가 만지는 입력이라 페이지를 떠나도 보존한다. 판정 결과는 해석이
  // 한 번 만들어 주고(result_info.weld), 사양을 바꾸면 /weld-assess 가 갈아 끼운다.
  const [weldSpec, setWeldSpec] = useState(
    () => normalizeWeldSpec(savedPageState.weldSpec ?? DEFAULT_WELD_SPEC),
  );
  const [weldResult, setWeldResult] = useState(savedPageState.weldResult ?? null);
  const [processTab, setProcessTab] = useState(savedPageState.processTab ?? 'stress');

  const bdfFolderPath = useMemo(
    () => bdfPath ? bdfPath.replace(/[/\\][^/\\]+$/, '') : null,
    [bdfPath]
  );

  const doneCount = steps.filter(s => s.status === 'done').length;

  const setStepStatus = (id, status) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));

  // ── 페이지 상태 보존 (다른 메뉴로 이동해도 유지) ──────────
  useEffect(() => {
    setAnalysisPageState?.(MENU_NAME, {
      steps, activeIdx, hasRunOnce,
      bdfFile, validating, validJobId, validProgress, validStatusMsg,
      step1Data, step2Data, modelJsonPath, bdfPath, bdfAnalysisId,
      useNastran, weldResult, weldSpec, processTab, moduleModel, arrangement, deckType, contactTolMm,
      deckContingencyPct, moduleContingencyPct, deckTransparent,
      accel, accelerationInput, accelerationResult,
      material, smallBoreMaxOdMm, structuralResult, structuralResultInputKey, structuralJobId, seating,
      supportIdx: [...supportIdx],
    });
  }, [
    setAnalysisPageState,
    steps, activeIdx, hasRunOnce,
    bdfFile, validating, validJobId, validProgress, validStatusMsg,
    step1Data, step2Data, modelJsonPath, bdfPath, bdfAnalysisId,
    useNastran, weldResult, weldSpec, processTab, moduleModel, arrangement, deckType, contactTolMm,
    deckContingencyPct, moduleContingencyPct, deckTransparent,
    accel, accelerationInput, accelerationResult,
    material, smallBoreMaxOdMm, structuralResult, structuralResultInputKey, structuralJobId, seating, supportIdx,
  ]);

  // ── 진행 중이던 작업 복원 ────────────────────────────────
  useEffect(() => {
    if (!pageJob) return;
    if (pageJob.status !== 'Running' && pageJob.status !== 'Pending') return;
    // 전역 작업 슬롯은 메뉴당 하나뿐이라 1·3단계가 같은 자리를 쓴다.
    // job id 로 갈라 주지 않으면 3단계 해석을 1단계 검증으로 되살려 버린다.
    if (pageJob.jobId === structuralJobId) {
      setStructuralBusy(true);
      setStepStatus('structural-run', 'running');
      setStructuralProgress(pageJob.progress ?? 0);
      setStructuralMsg(pageJob.message ?? '서버 처리 중...');
      return;
    }
    setValidJobId(prev => prev || pageJob.jobId);
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setValidProgress(pageJob.progress ?? 0);
    setValidStatusMsg(pageJob.message ?? '서버 처리 중...');
  }, [pageJob?.jobId, pageJob?.status, pageJob?.progress, pageJob?.message, structuralJobId]);

  // ── BDF 검증 폴링 ────────────────────────────────────────
  usePolling({
    jobId: validJobId,
    maxRetries: 240,
    onProgress: (data) => {
      setValidProgress(data.progress ?? 0);
      setValidStatusMsg(data.message ?? '');
    },
    onComplete: async (data) => {
      setValidating(false);
      setValidJobId(null);
      setValidProgress(100);
      const result_info = data.project?.result_info;
      if (!result_info) {
        setStepStatus('bdf-validation', 'error');
        showToast('결과 파일을 찾을 수 없습니다.', 'error');
        return;
      }
      if (result_info.bdf) setBdfPath(result_info.bdf);
      if (typeof data.project?.id === 'number') setBdfAnalysisId(data.project.id);

      // ⚠ JSON_ModelInfo 는 요소 품질 지표까지 담겨 대형 모델에서 30MB 를 넘는다.
      //    여기서는 경로만 기억하고, 2단계 뷰어가 백엔드 슬림 엔드포인트로 지오메트리만 받는다.
      if (typeof result_info.JSON_ModelInfo === 'string') {
        setModelJsonPath(result_info.JSON_ModelInfo);
        setModuleModel(null);   // 새 모델이므로 이전 뷰어 데이터 폐기
        setViewerStatus('idle');
      }

      let s1 = null, s2 = null;
      await Promise.allSettled(
        Object.entries(result_info).map(async ([key, path]) => {
          if (key === 'JSON_ModelInfo') return;
          if (!path || typeof path !== 'string' || !path.endsWith('.json')) return;
          try {
            const res = await downloadFileText(path);
            const parsed = JSON.parse(res.data);
            if (key === 'JSON_Validation') s1 = parsed;
            else if (key === 'JSON_F06Summary') s2 = parsed;
          } catch { /* 개별 결과 파일 로드 실패는 무시 — 나머지 결과는 계속 표시한다 */ }
        })
      );
      if (s1) setStep1Data(s1);
      if (s2) setStep2Data(s2);

      const hasError = s1?.status === 'error';
      setStepStatus('bdf-validation', hasError ? 'error' : 'done');
      // 검증이 error 로 끝나면 다음 단계 진입 게이트를 풀지 않는다 —
      // 잘못된 BDF 로 배치·해석 단계에 들어가 원인 불명 오류가 나는 것을 차단.
      if (!hasError) setHasRunOnce(true);
      showToast(hasError ? 'BDF 검증 — 오류 발견' : 'BDF 검증 완료', hasError ? 'warning' : 'success');
    },
    onError: (errData) => {
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      showToast(errData?.timeout ? '검증 시간 초과' : 'BDF 검증 실패', 'error');
    },
  });

  // 어떤 입력으로 뷰어 지오메트리를 받아 뒀는지 추적한다(아래 로드 effect 참고).
  const loadedViewerKeyRef = useRef(null);

  /** 2단계 뷰어 상태를 비운다. 새 BDF 를 넣거나 초기화할 때 항상 이 함수를 쓴다. */
  const resetViewerModel = () => {
    setModelJsonPath(null);
    setModuleModel(null);
    setJungbanModel(null);
    setViewerStatus('idle');
    setViewerError(null);
    // 로드 기록까지 지워야 같은 경로로 재검증했을 때 새 모델을 다시 받는다.
    loadedViewerKeyRef.current = null;
  };

  /**
   * 정반 타입 선택. 타입이 바뀌면 이전 정반 지오메트리를 반드시 버린다 —
   * 남겨 두면 배치 화면이 A 정반을 그린 채로 B 제원을 쓰게 되어 배치 좌표가 어긋난다.
   * (Module Unit 과 modelJsonPath 는 정반과 무관하므로 그대로 둔다.)
   */
  const handleSelectDeckType = (nextType) => {
    if (nextType === deckType) return;
    setDeckType(nextType);
    setJungbanModel(null);
    setViewerStatus('idle');
    setViewerError(null);
    loadedViewerKeyRef.current = null;
  };

  // ── Step 2: 정반(고정) + Module Unit(가변) 지오메트리 로드 ────────────
  // 2단계에 들어온 시점에 필요한 것만 받는다 — 검증 직후에 미리 받아 두면
  // 사용자가 2단계를 안 볼 수도 있는데 수 MB 를 낭비하게 된다.
  //
  // ⚠ 이 effect 의 의존성에 jungbanModel/moduleModel 을 넣으면 안 된다.
  //   자기가 setState 하는 값을 의존성으로 삼으면, 정반을 받아 상태에 넣는 순간 effect 가
  //   재실행되면서 cleanup 이 진행 중이던 Module Unit 요청을 취소해 버린다(응답이 와도 무시).
  //   그러면 화면은 "불러오는 중" 에서 영원히 멈춘다. 대신 '무엇을 로드했는지'를 ref 로 추적한다.
  const activeStepId = steps[activeIdx]?.id;

  useEffect(() => {
    if (activeStepId !== 'arrangement') return undefined;
    // 타입을 아직 안 골랐으면 선택 화면 단계다 — 아무것도 받지 않는다.
    if (!deckType) return undefined;
    // 입력 식별자 — Module Unit 이 아직 없으면 정반만 띄우는 상태도 하나의 유효한 결과다.
    // 정반 타입이 키에 들어가야 A→B 로 바꿨을 때 새 정반을 다시 받는다.
    const key = `${deckType}|${modelJsonPath || '__deck-only__'}`;
    if (loadedViewerKeyRef.current === key) return undefined;

    let cancelled = false;
    setViewerStatus('loading');
    setViewerError(null);

    (async () => {
      try {
        // 정반은 타입별 고정 모델이라 앱 세션당 타입당 1회만 받는다.
        // 선택 화면이 미리보기로 이미 받아 뒀다면 여기서 네트워크 요청이 아예 없다.
        let deck = jungbanModelCache[deckType];
        if (!deck) {
          const res = await getJungbanViewerModel(deckType);
          deck = res.data;
          jungbanModelCache[deckType] = deck;
        }
        if (cancelled) return;
        setJungbanModel(deck);

        if (modelJsonPath) {
          const res = await getModuleOceanViewerModel(modelJsonPath, 'Module Unit');
          if (cancelled) return;
          setModuleModel(res.data);
        }
        if (cancelled) return;
        // 성공했을 때만 기록한다 — 중간에 취소됐다면 다음 진입에서 다시 받아야 한다.
        loadedViewerKeyRef.current = key;
        setViewerStatus('ready');
      } catch (e) {
        if (cancelled) return;
        const status = e?.response?.status;
        let detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
        // 404 는 대개 백엔드가 이 App 의 신규 라우터를 아직 안 띄운 상태다 —
        // 사용자가 원인을 짐작하지 않아도 되도록 조치까지 적어 준다.
        if (status === 404) {
          detail += ' — 백엔드에 모델 뷰어 API 가 없습니다. 서버를 최신 코드로 재시작했는지 확인하세요.';
        } else if (status === 503) {
          detail += ' — 정반 모델 파일이 서버에 배치되지 않았습니다.';
        }
        setViewerError(detail);
        setViewerStatus('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepId, deckType, modelJsonPath, viewerReloadToken]);

  // ── 적치(seating) ────────────────────────────────────────
  // 정반 적치면 추출과 높이맵은 정반 타입당 한 번만 만든다(A 기준 약 16ms).
  // 배치보다 먼저 만든다 — 모듈을 앉힐 기준이 정반 bbox 가 아니라 **기준 적치면**이다.
  const deckSurface = useMemo(
    () => (jungbanModel ? buildDeckSurface(jungbanModel) : null),
    [jungbanModel],
  );

  /** footprint 인덱스 목록 → BDF 절점 ID 목록. 매핑이 없으면 인덱스를 그대로 보여 준다. */
  const nodeIdsAt = (indices) => (indices || []).map(i => moduleModel?.nodeIds?.[i] ?? i);

  // 절점을 anchor 기준 로컬좌표로 펴 둔다 — 회전각 360회 스윕에서 매번 다시 만들지 않기 위함.
  // 배치보다 먼저 만든다: 적치 높이가 지지점에서 나오고, 지지점 좌표가 여기서 나온다.
  const moduleFootprint = useMemo(
    () => (moduleModel ? prepareModuleFootprint(moduleModel) : null),
    [moduleModel],
  );

  // 배치 기준점(기준 적치면 XY 중심). computeModulePlacement 와 같은 함수를 쓴다.
  const deckCenter = useMemo(
    () => deckPlacementCenter(jungbanModel?.bounds, deckSurface),
    [jungbanModel, deckSurface],
  );

  // 배치 규칙은 utils/feGeometry 한 곳에만 있다(단위 테스트 대상).
  /**
   * 적치 높이 — **지지점이 각자 발밑 적치면 위 DECK_CLEARANCE_MM 에 오도록** 모듈이 내려앉은 결과.
   *
   * 정반은 2단이다(상단 z=8026 / 하단 z=2020). 지지점마다 발밑 층이 다를 수 있고,
   * 가장 빡빡한 지지점이 그 이격값이 되는 높이로 모듈 전체가 내려간다. 층이 다르면
   * 스툴 길이도 층마다 다르게 나온다 — 그 내역이 seatGap.levels 다.
   * 지지점을 만질 때마다 다시 계산되지만 지지점 수만큼만 훑어서 싸다.
   */
  const seatGap = useMemo(() => computeSeatGap(deckSurface, moduleFootprint, {
    deckCenter,
    offsetXMm: arrangement.offsetXMm,
    offsetYMm: arrangement.offsetYMm,
    rotationZDeg: arrangement.rotationZDeg,
    clearanceMm: DECK_CLEARANCE_MM,
    supportIndices: supportIdx,
  }), [deckSurface, moduleFootprint, deckCenter, arrangement, supportIdx]);
  const seatGapMm = seatGap.gapMm;

  const placement = useMemo(
    () => computeModulePlacement(jungbanModel?.bounds, moduleModel?.bounds,
                                 { ...arrangement, gapMm: seatGapMm }, deckSurface),
    [jungbanModel, moduleModel, arrangement, seatGapMm, deckSurface],
  );


  /* ── 중량 / 무게중심 ────────────────────────────────────────
     각 모델의 질량·COG 는 백엔드가 계산해 페이로드(massProperties)로 보내 준다.
     여기서는 모듈 COG 를 현재 배치로 옮겨 정반 것과 합치기만 한다 — 슬라이더를 만질 때마다
     서버를 다시 부르지 않기 위함이다. */
  const massSummary = useMemo(() => combineMassProperties({
    deckMass: jungbanModel?.massProperties,
    moduleMass: moduleModel?.massProperties,
    placement: (placement?.anchor && placement?.deckCenter) ? {
      anchor: placement.anchor,
      deckCenter: placement.deckCenter,
      deckTopZ: placement.deckTopZ,
      offsetXMm: arrangement.offsetXMm,
      offsetYMm: arrangement.offsetYMm,
      rotationZDeg: arrangement.rotationZDeg,
      gapMm: seatGapMm,
    } : null,
    deckContingencyPct,
    moduleContingencyPct,
  }), [jungbanModel, moduleModel, placement, arrangement, seatGapMm,
       deckContingencyPct, moduleContingencyPct]);

  // 3단계 해석 입력도 massSummary 를 그대로 쓴다. 중량 여유(%)는 이제 **실제 모델 질량**
  // (MAT1 밀도·CONM2)에 곱해져 해석에 들어가므로, 반력 검산에 쓰는 합산 질량도 같은
  // 여유를 포함해야 한다. 둘을 다르게 두면 검산이 늘 여유율만큼 어긋난다.

  // 추선(다림추)은 정반 바닥까지 내린다 — 공중의 점 하나로는 깊이를 못 읽는다.
  const cogMarkers = useMemo(() => {
    if (!showCog || !massSummary) return [];
    const dropToZ = jungbanModel?.bounds?.min?.[2];
    const out = [];
    if (massSummary.deck)   out.push({ ...massSummary.deck.cogMm,   color: COG_COLOR_DECK,   dropToZ });
    if (massSummary.module) out.push({ ...massSummary.module.cogMm, color: COG_COLOR_MODULE, dropToZ });
    // 합산 COG 는 둘 다 있을 때만 의미가 있다 — 하나뿐이면 그 물체의 COG 와 같은 점이다.
    if (massSummary.total && massSummary.includes.deck && massSummary.includes.module) {
      out.push({ ...massSummary.total.cogMm, color: COG_COLOR_TOTAL, dropToZ });
    }
    return out;
  }, [showCog, massSummary, jungbanModel]);

  const seatingBase = useMemo(() => (
    placement?.deckCenter
      ? { deckCenter: placement.deckCenter, contactTolMm }
      : null
  ), [placement?.deckCenter, contactTolMm]);

  const runSeating = (overrides = {}) => {
    if (!deckSurface || !moduleFootprint || !seatingBase) {
      showToast('정반과 Module Unit 모델이 모두 로드된 뒤에 사용할 수 있습니다.', 'warning');
      return null;
    }
    return computeSeating(deckSurface, moduleFootprint, {
      ...seatingBase,
      offsetXMm: arrangement.offsetXMm,
      offsetYMm: arrangement.offsetYMm,
      rotationZDeg: arrangement.rotationZDeg,
      clearanceMm: DECK_CLEARANCE_MM,
      supportIndices: supportIdx,
      ...overrides,
    });
  };

  /**
   * 현재 회전·오프셋에서 모듈이 적치면을 얼마나 덮는지 검사한다.
   *
   * 높이는 지지점마다 발밑 적치면 +DECK_CLEARANCE_MM 로 정해지므로 사용자가 내릴 것이
   * 없다. 이 버튼이 답하는 질문은 셋이다 — 지지점 발밑에 적치면이 있는가, 지지점보다
   * 낮은 부재가 정반에 너무 가깝지 않은가, 모듈이 적치면을 얼마나 덮는가.
   * 모듈 일부가 정반 밖으로 나가는 것은 실패가 아니다(정반 A 상단 7.1m < 모듈 14.6m).
   */
  const handleSeat = () => {
    const r = runSeating();
    if (!r) return;
    setSeating(r);
    if (!r.ok) { showToast(r.reason, 'warning'); return; }
    if (r.supportsOffPlateCount > 0) {
      showToast(
        `지지점 ${nodeIdList(nodeIdsAt(r.supportsOffPlate))} 발밑에 정반 적치면이 없습니다 `
        + '— 뷰어에 빨간 점으로 표시했습니다.',
        'warning',
      );
      return;
    }
    if (r.clearanceShortfallCount > 0) {
      showToast(
        `절점 ${nodeIdList(nodeIdsAt([r.worstClearanceIndex]))} 이 정반면에서 `
        + `${Math.round(r.minDeckClearanceMm).toLocaleString()}mm 밖에 안 떨어져 있습니다 `
        + `(필요 ${DECK_CLEARANCE_MM}mm).`,
        'warning',
      );
      return;
    }
    showToast(
      r.supportCount
        ? `지지점 ${r.supportCount}개가 적치면 위에 앉았습니다 · ${describeStools(r)}`
        : `적치면 위 절점 ${r.onPlateCount.toLocaleString()}개 (${Math.round(r.onPlateRatio * 100)}%) — 지지점을 먼저 지정하세요.`,
      'success',
    );
  };

  /**
   * 회전각 후보를 만든다. **자동으로 적용하지 않는다.**
   *
   * 거울상인 90°/270° 처럼 지지 넓이·벌어짐이 똑같이 나오는 배치가 흔해서, 코드가
   * 하나를 골라 버리면 근거 없이 한쪽을 강요하게 된다(실제로 그래서 틀렸다).
   * 수치를 나란히 보여 주고 사용자가 고르게 한다.
   */
  const handleCompareRotations = () => {
    if (!deckSurface || !moduleFootprint || !seatingBase) {
      showToast('정반과 Module Unit 모델이 모두 로드된 뒤에 사용할 수 있습니다.', 'warning');
      return;
    }
    setSeatingBusy(true);
    setTimeout(() => {
      try {
        const res = findBestSeatingRotation(deckSurface, moduleFootprint, {
          ...seatingBase,
          offsetXMm: arrangement.offsetXMm,
          offsetYMm: arrangement.offsetYMm,
          clearanceMm: DECK_CLEARANCE_MM,
          supportIndices: supportIdx,
        });
        const list = (res?.candidates || []).filter(c => c.seating?.ok);
        if (!list.length) {
          showToast('적치면에 앉힐 수 있는 회전각을 찾지 못했습니다. 오프셋을 조정해보세요.', 'warning');
          return;
        }
        setRotationCandidates(list.slice(0, 8));
        showToast(`회전각 후보 ${Math.min(list.length, 8)}개를 계산했습니다. 수치를 보고 고르세요.`, 'info');
      } finally {
        setSeatingBusy(false);
      }
    }, 0);
  };

  /** 후보 하나를 실제 배치에 적용한다. 높이는 고정이라 회전각만 바뀐다. */
  const handleApplyRotation = (candidate) => {
    setArrangement(prev => ({ ...prev, rotationZDeg: candidate.rotationZDeg }));
    setSeating(candidate.seating);
  };

  // 배치가 바뀌면 이전 적치 결과는 더 이상 그 배치의 것이 아니다.
  // (후보 목록은 오프셋·정반이 바뀔 때만 무효화한다 — 회전각은 후보를 고르면 바뀌므로
  //  회전 변경까지 무효화하면 방금 띄운 목록이 클릭하는 순간 사라진다.)
  const seatingKeyRef = useRef(null);
  useEffect(() => {
    // 지지점이 바뀌면 적치 높이 자체가 달라진다 — 이전 검사 결과는 그 배치의 것이 아니다.
    const supportKey = [...supportIdx].sort((a, b) => a - b).join(',');
    const key = [arrangement.rotationZDeg, arrangement.offsetXMm, arrangement.offsetYMm,
      deckType, moduleModel ? 1 : 0, supportKey].join('|');
    // 첫 실행은 '배치 변경' 이 아니라 '페이지 복원' 이다 — 여기서 지우면 다른 메뉴에
    // 다녀올 때마다 멀쩡한 적치 결과가 사라진다.
    if (seatingKeyRef.current === null || seatingKeyRef.current === key) {
      seatingKeyRef.current = key;
      return;
    }
    seatingKeyRef.current = key;
    setSeating(null);
  }, [arrangement.rotationZDeg, arrangement.offsetXMm, arrangement.offsetYMm, deckType,
      moduleModel, supportIdx]);
  useEffect(() => { setRotationCandidates(null); }, [
    arrangement.offsetXMm, arrangement.offsetYMm, contactTolMm, deckType, moduleModel,
  ]);

  // 선택한 지지점의 품질 판정 — 공선·전도·스툴 높이차를 **찍는 그 자리에서** 알린다.
  // (이번 사고에서는 Nastran 을 다 돌린 뒤에야 드러났다.)
  const supportPoints = useMemo(
    () => selectionPoints(moduleModel, supportIdx),
    [moduleModel, supportIdx],
  );
  const rigidDependent = useMemo(() => rigidDependentIndices(moduleModel), [moduleModel]);
  const supportEval = useMemo(() => evaluateSupportSelection(supportPoints, {
    // 모듈 자체 무게중심(모델 좌표) — 배치 변환 전 값이라 회전·오프셋과 무관하게 비교된다.
    cogMm: moduleModel?.massProperties?.centerOfGravityMm,
    rigidDependent,
  }), [supportPoints, moduleModel, rigidDependent]);
  // 확정한 지지점을 2단계 뷰어에 표시한다 — 정반 위 어디를 받치는지 보여야
  // 배치를 조정할 근거가 생긴다. 자동 접촉점은 더 이상 해석에 쓰이지 않으므로,
  // 선택이 있으면 선택을 보여 준다.
  // 발밑에 적치면이 없는 지지점은 **빨갛게 크게** 찍는다 — "5개가 밖입니다" 라는 숫자만
  // 보고는 어느 것인지 알 길이 없다는 지적을 받은 자리다. 절점 ID 는 아래 배치 패널이 쓴다.
  const supportMarkers = useMemo(() => {
    if (!supportPoints.length || !seatingBase) return [];
    const off = new Set(seatGap.supportsOffPlate);
    return supportPoints
      .map((p) => {
        const world = transformModulePoint(p, {
          ...seatingBase,
          offsetXMm: arrangement.offsetXMm,
          offsetYMm: arrangement.offsetYMm,
          rotationZDeg: arrangement.rotationZDeg,
          gapMm: seatGapMm,
        });
        if (!world) return null;
        return off.has(p.i) ? { ...world, color: '#ef4444', size: 16 } : world;
      })
      .filter(Boolean);
  }, [supportPoints, seatingBase, arrangement, seatGapMm, seatGap.supportsOffPlate]);

  /**
   * 스툴 기둥 — 지지점에서 **자기 발밑 적치면**까지 내린 선.
   *
   * 숫자(300 / 570mm)만으로는 어느 자리 스툴이 긴지 형상 위에서 짚을 수 없다.
   * 2단 정반에서는 이 그림이 "이 발은 하단, 저 발은 상단" 을 한눈에 보여 준다.
   * 해석 모델의 지지 RBE2 가 실제로 건너뛰는 높이가 바로 이 선이다.
   */
  const stoolPart = useMemo(() => {
    const rows = seatGap.supports || [];
    if (!rows.length || !supportPoints.length || !seatingBase) return null;
    const landingOf = new Map(rows.map(r => [r.i, r.landingZMm]));
    const positions = [];
    const beams = [];
    for (const p of supportPoints) {
      const landingZ = landingOf.get(p.i);
      if (landingZ === undefined) continue;          // 발밑에 적치면이 없는 지지점
      const world = transformModulePoint(p, {
        ...seatingBase,
        offsetXMm: arrangement.offsetXMm,
        offsetYMm: arrangement.offsetYMm,
        rotationZDeg: arrangement.rotationZDeg,
        gapMm: seatGapMm,
      });
      if (!world) continue;
      const k = positions.length / 3;
      positions.push(world.x, world.y, world.z, world.x, world.y, landingZ);
      beams.push(k, k + 1);
    }
    if (!beams.length) return null;
    return {
      name: '스툴',
      key: `${arrangement.rotationZDeg}|${arrangement.offsetXMm}|${arrangement.offsetYMm}`
        + `|${Math.round(seatGapMm)}|${beams.length}`,
      positions,
      beams,
      rigids: [], quads: [], trias: [],
      nodeCount: positions.length / 3,
      beamCount: beams.length / 2,
      quadCount: 0, triaCount: 0, rigidCount: 0,
    };
  }, [seatGap.supports, supportPoints, seatingBase, arrangement, seatGapMm]);

  // ⚠ 이 훅은 stoolPart **뒤에** 있어야 한다. 의존성 배열은 렌더 중 그 자리에서
  //   평가되므로, 위에 두면 아직 초기화되지 않은 stoolPart 를 읽어 TDZ 로 죽는다
  //   (번들러는 못 잡고 화면을 열어야 드러난다).
  const viewerParts = useMemo(() => {
    const list = [];
    if (jungbanModel) {
      list.push({
        id: 'jungban',
        name: deckTransparent ? '정반 (반투명)' : '정반 (고정)',
        color: PART_COLOR_JUNGBAN,
        model: jungbanModel,
        position: [0, 0, 0],
        rotationZ: 0,
        // 정반이 Unit 밑면과 스툴을 가려 지지 위치를 못 읽는다 — 투명도를 사용자가 켠다.
        opacity: deckTransparent ? 0.25 : 1,
      });
    }
    if (moduleModel && placement?.position) {
      list.push({
        id: 'module-unit',
        name: 'Module Unit',
        color: PART_COLOR_MODULE,
        model: moduleModel,
        anchor: placement.anchor,
        position: placement.position,
        rotationZ: arrangement.rotationZDeg,
        opacity: 1,
      });
    }
    // 스툴은 이미 정반 좌표로 만들어져 있다(배치 변환을 거친 값) — 그대로 얹는다.
    if (stoolPart) {
      list.push({
        id: 'stools',
        name: `스툴 ${stoolPart.beamCount}개 (지지점 → 적치면)`,
        color: PART_COLOR_STOOL,
        model: stoolPart,
        opacity: 1,
        // ⚠ 뷰어는 절점 수·anchor·색이 같으면 지오메트리를 다시 만들지 않는다. 스툴은
        //    좌표를 이미 정반 기준으로 구워 넣었으므로, 배치를 바꾸면 절점 수가 같아도
        //    다시 만들어야 한다 — 안 그러면 모듈만 움직이고 스툴이 제자리에 남는다.
        colorKey: stoolPart.key,
      });
    }
    return list;
  }, [jungbanModel, moduleModel, placement, arrangement.rotationZDeg, stoolPart, deckTransparent]);

  /** 적치면을 못 찾은 지지점의 BDF 절점 ID 목록 — 화면·토스트가 그대로 보여 준다. */
  const offPlateSupportNodeIds = useMemo(
    () => nodeIdsAt(seatGap.supportsOffPlate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seatGap.supportsOffPlate, moduleModel],
  );

  const supportNodeIds = useMemo(
    () => selectionNodeIds(moduleModel, supportIdx),
    [moduleModel, supportIdx],
  );

  // 접힌 '해석 조건' 머리에 한 줄로 얹을 요약. 무엇으로 돌렸는지 열지 않고도 읽혀야 한다.
  // ⚠ 위치 고정 — allowableMPa·smallBoreMaxOdMmForRun·supportNodeIds 를 모두 읽으므로
  //   셋 중 가장 늦게 선언되는 supportNodeIds **뒤**에 있어야 한다. 앞으로 옮기면
  //   useMemo 가 선언 시점에 즉시 평가되면서 TDZ ReferenceError 로 페이지가 죽는다
  //   (번들러는 잡지 못한다 — 과거 viewerParts 에서 같은 사고가 있었다).
  const conditionSummary = useMemo(() => [
    accelerationInput.loadCase,
    `허용 ${allowableMPa.toFixed(0)} MPa`,
    smallBoreMaxOdMmForRun > 0 ? `소구경 OD≤${smallBoreMaxOdMmForRun} 제외` : '소구경 제외 안 함',
    `지지 ${supportNodeIds.length}점`,
  ].join(' · '), [accelerationInput.loadCase, allowableMPa, smallBoreMaxOdMmForRun, supportNodeIds.length]);

  const structuralInputKey = useMemo(() => JSON.stringify({
    bdfPath, deckType,
    supportNodeIds: [...supportNodeIds].sort((a, b) => a - b),
    placement: placement ? {
      anchorMm: placement.anchor,
      rotationZDeg: Number(arrangement.rotationZDeg || 0),
      offsetXMm: Number(arrangement.offsetXMm || 0),
      offsetYMm: Number(arrangement.offsetYMm || 0),
      gapMm: Number(seatGapMm),
    } : null,
    smallBoreMaxOdMm: smallBoreMaxOdMmForRun,
    deckContingencyPct: Number(deckContingencyPct || 0),
    moduleContingencyPct: Number(moduleContingencyPct || 0),
    accelG: { ax: Number(accel.ax), ay: Number(accel.ay), az: Number(accel.az) },
    material: { sigmaYMPa: Number(material.sigmaYMPa), factor: Number(material.factor) },
  }), [bdfPath, deckType, supportNodeIds, placement, arrangement, seatGapMm,
    smallBoreMaxOdMmForRun, deckContingencyPct, moduleContingencyPct, accel, material]);
  const structuralResultCurrent = Boolean(
    structuralResult && structuralResultInputKey === structuralInputKey,
  );
  useEffect(() => {
    if (structuralJobId && pendingStructuralInputKeyRef.current == null) {
      pendingStructuralInputKeyRef.current = structuralInputKey;
    }
  }, [structuralJobId, structuralInputKey]);

  // 모델이 바뀌면 이전 선택의 인덱스는 다른 절점을 가리킨다 — 반드시 버린다.
  // 반대로 배치(회전·오프셋)가 바뀌어도 선택은 유효하다(모듈 자체 절점이므로).
  const supportModelRef = useRef(null);
  useEffect(() => {
    const key = modelJsonPath || null;
    if (supportModelRef.current === null) { supportModelRef.current = key; return; }
    if (supportModelRef.current === key) return;
    supportModelRef.current = key;
    setSupportIdx(new Set());
  }, [modelJsonPath]);

  // 2단계 완료 표식은 적치 성공 여부에서 파생한다.
  // handleSeat / handleApplyRotation / 배치 변경 무효화 세 경로가 모두 seating 을 거치므로
  // 여기 한 곳에서 따라가면 각 경로에 setStepStatus 를 흩뿌리지 않아도 된다.
  // (관통은 판단하지 않는다 — 합산 중량·무게중심은 겹침과 무관하다.)
  /**
   * 단계 이동 게이트.
   *
   * 3단계 경계조건은 **사용자가 지정한 지지점** 이다. 지정 없이 넘어가면 실행 버튼만
   * 비활성인 화면을 마주하고 왜 막혔는지 모른다 — 넘어가기 전에 이유를 말해 준다.
   */
  const stepBlockReason = (idx) => {
    if (idx < 2) return null;
    if (!hasRunOnce) return '1단계 BDF 입력 검증을 먼저 완료하세요.';
    if (!seating?.ok) return '2단계에서 Module Unit 을 정반에 적치한 뒤 넘어갈 수 있습니다.';
    if (supportIdx.size === 0) {
      return '2단계에서 지지점을 먼저 지정하세요. '
        + '자동 접촉 탐지는 밑면이 평평하지 않은 모듈에서 한쪽 레일만 잡아 해석이 무의미해집니다.';
    }
    const blocker = supportEval.issues.find(i => i.level === 'block');
    if (blocker) return blocker.message;
    return null;
  };

  const goToStep = (idx) => {
    const reason = stepBlockReason(idx);
    if (reason) { showToast(reason, 'warning'); return; }
    setActiveIdx(idx);
  };

  // 지지점 지정까지 끝나야 3단계로 넘어갈 수 있으므로 둘 다 봐야 한다.
  useEffect(() => {
    setStepStatus('arrangement', seating?.ok && supportEval.ok ? 'done' : 'wait');
  }, [seating?.ok, supportEval.ok]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── BDF 검증 요청 ────────────────────────────────────────
  const handleValidate = async () => {
    if (!bdfFile) return;
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setStep1Data(null);
    setStep2Data(null);
    resetViewerModel();
    setValidProgress(0);
    setValidStatusMsg('서버 요청 중...');

    try {
      const userStr = localStorage.getItem('user');
      const employeeId = userStr ? JSON.parse(userStr).employee_id : 'guest';

      const formData = new FormData();
      formData.append('employee_id', employeeId);
      formData.append('use_nastran', String(useNastran));
      formData.append('source', 'Workbench');
      formData.append('bdf_file', bdfFile);

      const res = await requestModuleOceanTransport(formData);
      setValidJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, MENU_NAME);
    } catch (e) {
      console.error('[BDF 검증] 요청 실패:', e);
      setValidating(false);
      setValidJobId(null);
      setStepStatus('bdf-validation', 'error');
      const detail = e?.response?.data?.detail || e?.message || '알 수 없는 오류';
      showToast(`BDF 검증 요청 실패 — ${detail}`, 'error');
    }
  };

  // ── 샘플 실행 콜백 ───────────────────────────────────────
  // SampleRunButton 이 호출한다. 서버가 만든 job_id 를 handleValidate 와 **같은 폴링 흐름**에
  // 밀어 넣기만 하면, 이후 완료 처리(모델 경로 확보 → 2단계 뷰어)는 전부 재사용된다.
  const sampleBefore = () => {
    setValidating(true);
    setStepStatus('bdf-validation', 'running');
    setStep1Data(null);
    setStep2Data(null);
    // 샘플은 새 BDF 이므로 이전 뷰어 지오메트리를 반드시 버린다.
    // (안 버리면 2단계에서 직전 Module Unit 이 그대로 서 있다.)
    resetViewerModel();
    setValidProgress(0);
    setValidStatusMsg('샘플 파일로 작업 요청 중...');
  };
  const sampleSubmitted = (jobId) => {
    setValidJobId(jobId);
    startGlobalJob?.(jobId, MENU_NAME);
  };
  const sampleError = (status, detail) => {
    setValidating(false);
    setValidJobId(null);
    if (status === 429) {
      // 한도 초과는 실패가 아니다 — 단계를 error 로 물들이지 않고 대기 상태로 되돌린다.
      setStepStatus('bdf-validation', 'wait');
      setValidStatusMsg('');
    } else {
      setStepStatus('bdf-validation', 'error');
      showToast(`샘플 실행 실패 — ${detail}`, 'error');
    }
  };

  // ── 실행 버튼 ────────────────────────────────────────────
  const handleRun = () => {
    const bdfDone = steps.find(s => s.id === 'bdf-validation')?.status === 'done';
    if (!bdfDone) {
      if (!bdfFile) {
        showToast('Module Unit BDF 파일을 업로드해주세요.', 'warning');
        setActiveIdx(0);
        return;
      }
      handleValidate();
      return;
    }
    setActiveIdx(1);
    showToast('정반 상부 Module Unit 배치 설정 단계로 이동합니다.', 'info');
  };

  const handleAccelerationInputChange = (patch) => {
    setAccelerationInput(previous => ({ ...previous, ...patch }));
    setAccelerationError(null);
  };

  const handleImportModuleAccelerationInputs = () => {
    // Support Height 는 배치에서 읽는다 — 2단 정반은 어느 적치면에 앉느냐로 이 높이가
    // 6m 넘게 달라지고, 그 차이가 baseline VCG 에 그대로 실린다.
    const imported = moduleCargoAccelerationInputs(
      moduleModel,
      massSummary,
      {
        unitBottomZMm: seatGap.baseZMm,
        deckBottomZMm: jungbanModel?.bounds?.min?.[2],
      },
    );
    if (!imported) {
      showToast('2단계 정반+Unit 합산 중량 또는 Unit 무게중심을 가져올 수 없습니다.', 'warning');
      return;
    }
    const nextInput = { ...accelerationInput, ...imported };
    const importIssues = getBargeAccelerationInputIssues(nextInput);
    setAccelerationInput(nextInput);
    setAccelerationError(null);
    if (importIssues.length) {
      showToast(`정반+Unit 값을 가져왔지만 계산 범위를 벗어났습니다 — ${importIssues[0].message}`, 'warning');
    } else if (Number.isFinite(imported.supportHeightM)) {
      showToast(
        `합산 중량 ${imported.cargoWeightT.toLocaleString()} ton · Unit 바닥 기준 VCG `
        + `${imported.cargoVcgFromBottomM.toFixed(3)} m · Support Height `
        + `${imported.supportHeightM.toFixed(3)} m(정반 바닥→Unit 바닥)를 반영했습니다.`,
        'success',
      );
    } else {
      showToast('정반+Unit 합산 중량과 Unit 바닥 기준 VCG를 가속도 입력에 반영했습니다.', 'success');
    }
  };

  const handleCalculateAcceleration = async () => {
    if (accelerationBusy || structuralBusy) return;
    const requestInput = { ...accelerationInput };
    const requestKey = bargeAccelerationInputKey(requestInput);
    setAccelerationBusy(true);
    setAccelerationError(null);
    try {
      const response = await calculateModuleOceanAcceleration(requestInput);
      const calculated = response.data;
      setAccelerationResult({ ...calculated, inputKey: requestKey });
      setAccel({ ...calculated.totalAccelerationG });
      showToast(`${calculated.loadCase.id} 가속도를 구조 해석 조건에 적용했습니다.`, 'success');
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || '가속도 계산에 실패했습니다.';
      setAccelerationError(detail);
    } finally {
      setAccelerationBusy(false);
    }
  };

  // ── 전체 초기화 ──────────────────────────────────────────
  const handleReset = () => {
    clearGlobalJobForMenu?.(MENU_NAME);
    setBdfFile(null);
    setValidating(false);
    setValidJobId(null);
    setValidProgress(0);
    setValidStatusMsg('');
    setStep1Data(null);
    setStep2Data(null);
    resetViewerModel();
    setBdfPath(null);
    setBdfAnalysisId(null);
    setWeldResult(null);
    setWeldSpec({ ...DEFAULT_WELD_SPEC });
    setProcessTab('stress');
    setSteps(INITIAL_STEPS);
    setActiveIdx(0);
    setUseNastran(false);
    setHasRunOnce(false);
    setDeckType(null);
    setDeckTransparent(false);
    setViewerReloadToken(0);
    resetModuleOceanPlacementState({
      setArrangement,
      setContactTolMm,
      setShowCog,
      setDeckContingencyPct,
      setModuleContingencyPct,
      setSeating,
      setSeatingBusy,
      setSupportPickerOpen,
      setSupportIdx,
      setRotationCandidates,
    });
    seatingKeyRef.current = null;
    supportModelRef.current = null;
    setAccel({ ...GRAVITY_ONLY_ACCEL_G });
    setAccelerationInput({ ...DEFAULT_BARGE_ACCEL_INPUT });
    setAccelerationResult(null);
    setAccelerationBusy(false);
    setAccelerationError(null);
    setMaterial({ sigmaYMPa: 275, factor: 0.8 });
    setStructuralJobId(null);
    setStructuralBusy(false);
    setStructuralProgress(0);
    setStructuralMsg('');
    setStructuralError(null);
    setStructuralResult(null);
    setColorMapOpen(false);
    setLegModalOpen(false);
    setWeldModalOpen(false);
    clearAnalysisPageState?.(MENU_NAME);
  };

  // 2단계 적치가 성공하면 3단계를 열어 준다.
  // 관통은 막지 않는다 — 2단계는 합산 중량·무게중심을 얻기 위한 과정이고,
  // 그 두 값은 겹침 여부와 무관하게 정해진다(사용자 결정).
  // 경계조건은 이제 자동 접촉점이 아니라 **사용자가 지정한 지지점** 이다.
  const structuralRunBlockers = [];
  if (!seating?.ok) structuralRunBlockers.push('2단계에서 Module Unit 적치를 완료하세요.');
  if (supportIdx.size === 0) {
    structuralRunBlockers.push('2단계에서 구조 해석 지지점을 지정하세요.');
  } else if (!supportEval.ok) {
    structuralRunBlockers.push(
      supportEval.issues.find(issue => issue.level === 'block')?.message
        || '선택한 지지점의 배치 조건을 확인하세요.',
    );
  } else if (!supportNodeIds.length) {
    structuralRunBlockers.push('선택한 지지점에서 BDF 절점 ID를 찾을 수 없습니다. 지지점을 다시 지정하세요.');
  }
  if (seating?.ok && seating.supportsOffPlateCount > 0) {
    structuralRunBlockers.push(
      `지지점 절점 ${nodeIdList(nodeIdsAt(seating.supportsOffPlate))} 발밑에 정반 적치면이 없습니다`
      + ' — 스툴을 세울 자리가 없습니다. 회전·오프셋으로 정반 안으로 넣거나 그 지지점을 다시 고르세요.',
    );
  }
  if (seating?.ok && seating.clearanceShortfallCount > 0) {
    structuralRunBlockers.push(
      `지지점보다 낮은 부재가 정반 위에 있습니다 — 절점 ${nodeIdList(nodeIdsAt([seating.worstClearanceIndex]))} 이 정반면에서 `
      + `${Math.round(seating.minDeckClearanceMm).toLocaleString()}mm 밖에 안 떨어져 있습니다`
      + `(필요 ${DECK_CLEARANCE_MM}mm). 그 자리를 지지점에 추가하거나 배치를 조정하세요.`,
    );
  }
  if (!bdfPath) structuralRunBlockers.push('1단계 BDF 검증 결과 경로가 없습니다. BDF 검증을 다시 수행하세요.');
  if (!deckType) structuralRunBlockers.push('2단계에서 정반 타입을 선택하세요.');
  if (!massSummary?.total) structuralRunBlockers.push('Module Unit과 정반의 중량·무게중심을 계산할 수 없습니다.');
  if (!placement?.anchor || !placement?.deckCenter) {
    structuralRunBlockers.push('정반과 Module Unit 모델이 모두 로드된 뒤에 해석할 수 있습니다.');
  }
  if (accelerationInputIssues.length) {
    structuralRunBlockers.push(...accelerationInputIssues.map(issue => issue.message));
  } else if (!accelerationIsCurrent) {
    structuralRunBlockers.push('Barge 가속도를 계산하여 선택한 LC를 해석조건에 적용하세요.');
  }
  if (!(Number(material.sigmaYMPa) > 0)) structuralRunBlockers.push('항복응력은 0보다 커야 합니다.');
  if (!(Number(material.factor) > 0 && Number(material.factor) <= 1)) {
    structuralRunBlockers.push('허용 계수는 0보다 크고 1 이하여야 합니다.');
  }
  const canRunStructural = structuralRunBlockers.length === 0;

  // ── 3단계 구조 해석 요청 ─────────────────────────────────
  /**
   * 실제로 푼 합본 BDF(정반 실형상 + Module Unit)를 그대로 내려받는다.
   * 결과 JSON 이 아니라 **해석에 들어간 입력 그 자체**라, 검토서 첨부나 사내 다른
   * 도구로 재검산할 때 이것이 있어야 한다.
   */
  const handleDownloadBdf = async () => {
    const path = structuralResult?.model?.bdf;
    if (!path) {
      showToast('해석 BDF 경로를 찾을 수 없습니다. 구조 해석을 먼저 수행하세요.', 'error');
      return;
    }
    setBdfDownloading(true);
    try {
      const res = await downloadFileBlob(path);
      // 파일명은 서버가 준 Content-Disposition 을 쓴다 — 경로를 직접 잘라 내면
      // Windows 백슬래시 때문에 전체 경로가 파일명이 되어 버린다.
      downloadBlob(
        res.data,
        filenameFromDisposition(res.headers['content-disposition'], 'module_ocean.bdf'),
        'text/plain',
      );
    } catch (e) {
      showToast(e?.response?.status === 404
        ? '파일을 찾을 수 없습니다 — 결과가 서버에서 지워졌을 수 있습니다.'
        : (e?.message || 'BDF 다운로드에 실패했습니다.'), 'error');
    } finally {
      setBdfDownloading(false);
    }
  };

  const handleRunStructural = async () => {
    if (!canRunStructural || structuralBusy) return;
    // 현재 화면은 새 결과로 바뀌지만 서버의 이전 Analysis 레코드와 산출물은 보존된다.
    if (structuralResult && !window.confirm(
      '현재 화면의 결과를 새 해석 결과로 교체합니다.\n'
      + '이전 실행의 판정과 산출 파일은 My Project 이력에 보존됩니다.\n\n'
      + '계속할까요?',
    )) return;
    setStructuralBusy(true);
    setStructuralError(null);
    setStructuralResult(null);
    setWeldResult(null);
    setStepStatus('structural-run', 'running');
    setStructuralProgress(0);
    setStructuralMsg('서버 요청 중...');
    pendingStructuralInputKeyRef.current = structuralInputKey;
    try {
      // 사용자가 2단계에서 지정한 지지점. 인덱스는 뷰어 positions 기준이며
      // selectionNodeIds 가 nodeIds 로 실제 BDF 절점 ID 를 만든다.
      if (!supportNodeIds.length) {
        throw new Error('지지점의 BDF 절점 ID 를 찾지 못했습니다. 2단계에서 지지점을 다시 지정하세요.');
      }

      // combineMassProperties 의 cogMm 은 {x,y,z} 객체다 — 백엔드는 [x,y,z] 를 받는다.
      const { massTon, cogMm } = massSummary.total;

      const res = await requestModuleOceanStructural({
        bdf_path: bdfPath,
        deck_type: deckType,
        support_node_ids: supportNodeIds,
        // 서버가 Module Unit 절점을 정반 좌표로 옮길 때 쓰는 변환. deckCenter/deckTopZ 는
        // 서버가 정반에서 다시 찾아 **대조**한다 — 어긋나면 해석을 시작하지 않는다.
        placement: {
          anchorMm: placement.anchor,
          rotationZDeg: arrangement.rotationZDeg || 0,
          offsetXMm: arrangement.offsetXMm || 0,
          offsetYMm: arrangement.offsetYMm || 0,
          deckCenterMm: placement.deckCenter,
          deckTopZMm: placement.deckTopZ,
          // 화면이 정한 적치 높이. 서버가 자기 계산과 대조한다 — 2단 정반의 층 판정이
          // 프론트·백엔드에서 갈리면 여기서 잡힌다(결과만 보고는 못 알아챈다).
          gapMm: seatGapMm,
        },
        clearance_mm: DECK_CLEARANCE_MM,
        // 0 은 '제외 안 함'이라 **유효한 값**이다 — `||` 로 접으면 기본값으로 되살아난다.
        // 반대로 빈 칸은 Number('') === 0 이라 그냥 Number 로 바꾸면 사용자가 지우기만
        // 해도 제외가 조용히 꺼진다. 두 경우를 갈라서 본다.
        small_bore_max_od_mm: smallBoreMaxOdMmForRun,
        deck_contingency_pct: deckContingencyPct,
        module_contingency_pct: moduleContingencyPct,
        total_mass_t: massTon,
        total_cog_mm: [cogMm.x, cogMm.y, cogMm.z],
        accel: { ax: Number(accel.ax), ay: Number(accel.ay), az: Number(accel.az) },
        accelerationCalculation: { ...accelerationInput },
        material: { sigmaYMPa: Number(material.sigmaYMPa), factor: Number(material.factor) },
        // 과정 2 용접 사양. 해석이 반력을 낸 직후 같은 job 에서 판정까지 마쳐 둔다.
        weld: { ...weldSpec },
        parent_analysis_id: bdfAnalysisId ?? null,
      });
      setStructuralJobId(res.data.job_id);
      startGlobalJob?.(res.data.job_id, MENU_NAME);
    } catch (err) {
      setStructuralBusy(false);
      setStructuralError(err?.response?.data?.detail || err.message);
      setStepStatus('structural-run', 'error');
    }
  };

  usePolling({
    jobId: structuralJobId,
    // 백엔드 Nastran 제한 30분보다 먼저 포기하지 않는다(1.5초 × 1320 = 33분).
    maxRetries: 1320,
    onProgress: (data) => {
      setStructuralProgress(data.progress ?? 0);
      setStructuralMsg(data.message ?? '');
    },
    onComplete: (data) => {
      setStructuralBusy(false);
      clearGlobalJob?.(structuralJobId);
      setStructuralJobId(null);
      setStructuralProgress(100);
      const result_info = data.project?.result_info;
      if (!result_info) {
        setStepStatus('structural-run', 'error');
        setStructuralError('결과 파일을 찾을 수 없습니다.');
        showToast('구조 해석 결과를 찾을 수 없습니다.', 'error');
        return;
      }
      setStructuralResult(result_info);
      setStructuralResultInputKey(pendingStructuralInputKeyRef.current);
      // 해석이 반력 직후 용접까지 판정해 둔다 — 열자마자 결과가 있어야 한다.
      setWeldResult(result_info.weld ?? null);
      // 판정이 NG 면 과정 2 부터 보여 준다. 통과했는데 탭이 튀면 그게 더 산만하다.
      if (result_info.weld?.summary?.status === 'NG') {
        setProcessTab('weld');
        setWeldModalOpen(true);
      }
      setStepStatus('structural-run', 'done');
      showToast('구조 해석이 완료되었습니다.', 'success');
    },
    onError: (errData) => {
      setStructuralBusy(false);
      clearGlobalJob?.(structuralJobId);
      setStructuralJobId(null);
      setStepStatus('structural-run', 'error');
      const detail = errData?.timeout
        ? '해석 시간 초과'
        : (errData?.engine_log || errData?.message || '해석에 실패했습니다.');
      setStructuralError(detail);
      showToast('구조 해석 실패', 'error');
    },
  });

  // 용접 판정은 해석 결과(result_info.weld)가 기본이고, 사양을 바꿔 재평가하면 그것으로
  // 갈아 끼운다. 둘 다 없으면 용접 평가 이전에 돌린 옛 결과라는 뜻이다.
  const weldShown = weldResult ?? structuralResult?.weld ?? null;

  const activeStep       = steps[activeIdx];
  const isBdfStep        = activeStep?.id === 'bdf-validation';
  const isArrangeStep    = activeStep?.id === 'arrangement';
  const isStructuralStep = activeStep?.id === 'structural-run';

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="min-h-full xl:h-full flex flex-col max-w-[1400px] mx-auto animate-fade-in-up pb-6">

      <FileBasedPageBanner
        title="Module Unit 해상 운송 구조 해석"
        subtitle="정반에 적재된 Module Unit의 해상 운송 하중에 대한 구조 안전성과 용접부 강도를 검토합니다."
        icon={UploadCloud}
        onBack={() => setCurrentMenu('File-Based Apps')}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-5 min-h-0 xl:flex-row">

        {/* ── Left Panel ── */}
        <div className="w-full flex flex-col gap-3 xl:w-96 xl:shrink-0">

          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

            {/* BDF 가 없을 때 진입 — Model Builder 로 이동 */}
            <button
              onClick={() => setCurrentMenu('HiTESS Model Builder')}
              className="w-full relative flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 hover:from-indigo-400 hover:via-indigo-500 hover:to-violet-600 active:scale-[0.995] text-white transition-all duration-200 cursor-pointer overflow-hidden group"
            >
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full pointer-events-none" />
              <div className="absolute -right-2 -bottom-6 w-16 h-16 bg-white/5 rounded-full pointer-events-none" />
              <div className="absolute left-3 top-2 w-1.5 h-1.5 rounded-full bg-white/40 pointer-events-none animate-pulse" />
              <div className="relative flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <UploadCloud size={22} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-semibold text-indigo-100 leading-tight tracking-wide">BDF 가 없다면?</p>
                  <p className="text-base font-black text-white leading-tight mt-0.5">CSV 로부터 시작하세요</p>
                  <p className="text-[10px] text-indigo-200 mt-0.5">HiTESS Model Builder 로 이동</p>
                </div>
              </div>
              <div className="relative w-9 h-9 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center transition-colors shrink-0">
                <ArrowRight size={18} className="text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">파이프라인</span>
              <span className="text-xs font-bold text-blue-600">{doneCount} / {steps.length} 완료</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3">
              {steps.map((step, idx) => {
                const StepIcon = step.icon;
                const cfg      = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.wait;
                const isActive = idx === activeIdx;
                const isLast   = idx === steps.length - 1;

                return (
                  <div key={step.id} className="flex items-stretch">
                    <div className="flex flex-col items-center w-7 shrink-0 pt-4">
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-300 ${cfg.dot}`} />
                      {!isLast && (
                        <div className="flex-1 w-0.5 my-1 transition-colors duration-300 rounded-full bg-violet-400" />
                      )}
                    </div>

                    <div
                      className={`flex-1 mb-2 ml-2 rounded-xl border px-3.5 py-3 transition-all duration-200 cursor-pointer
                        ${step.status === 'disabled'
                          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-default'
                          : isActive
                          ? 'border-blue-500 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      onClick={() => step.status !== 'disabled' && goToStep(idx)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <StepIcon size={13} className={`shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                          <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>
                            {idx + 1}. {step.title}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 whitespace-nowrap ${cfg.badge}`}>
                          {step.status === 'disabled' ? '비활성' : isActive && step.status === 'wait' ? '선택됨' : cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 pl-5">{step.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 실행 버튼 푸터 */}
            <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
              <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                useNastran ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
              }`}>
                <p className={`text-xs font-bold ${useNastran ? 'text-blue-700' : 'text-slate-500'}`}>
                  Nastran을 통한 BDF 입력 검증
                </p>
                <Toggle checked={useNastran} onChange={setUseNastran} />
              </div>

              {activeIdx < steps.length - 1 && (() => {
                const nextIdx = activeIdx + 1;
                const blocked = stepBlockReason(nextIdx);
                return (
                <button
                  onClick={() => goToStep(nextIdx)}
                  disabled={Boolean(blocked)}
                  title={blocked || `다음 단계: ${steps[nextIdx].title}`}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition-colors ${
                    !blocked
                      ? 'bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-600 cursor-pointer'
                      : 'bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <span className="truncate">다음 단계: {steps[nextIdx].title}</span>
                  <ArrowRight size={13} className="shrink-0" />
                </button>
                );
              })()}

              {/* 샘플 실행 — 입력 BDF 없이도 학습용으로 즉시 검증 체험 */}
              <SampleRunButton
                appKey="module-ocean-transport"
                disabled={validating}
                onBeforeRun={sampleBefore}
                onJobSubmitted={sampleSubmitted}
                onError={sampleError}
              />

              <button
                onClick={handleRun}
                disabled={validating}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-blue-dark active:bg-brand-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-sm"
              >
                {validating
                  ? <><Loader2 size={15} className="animate-spin" /> BDF 검증 중...</>
                  : <><ChevronsRight size={16} /> 해상 운송 구조 해석 수행</>
                }
              </button>

              <button
                onClick={handleReset}
                disabled={validating}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw size={13} /> 전체 초기화
              </button>
            </div>
          </div>
        </div>{/* end Left Panel */}

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">

          {/* ─ Step 1: Module Unit BDF 입력 검증 ─ */}
          {isBdfStep && (
            <>
              <div className="shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-700">1. Module Unit BDF 입력 검증</h2>
                  <span className="text-[10px] text-slate-400">— BDF 파일 업로드 및 유효성 검증</span>
                </div>
                <div className="p-4">
                  <BdfDropZone
                    file={bdfFile}
                    onFile={f => { setBdfFile(f); setStep1Data(null); setStep2Data(null); resetViewerModel(); setStepStatus('bdf-validation', 'wait'); }}
                    onClear={() => { setBdfFile(null); setStep1Data(null); setStep2Data(null); resetViewerModel(); setStepStatus('bdf-validation', 'wait'); }}
                    disabled={validating}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">BDF 검증 결과</span>
                    {step1Data && step1Data.status !== 'error' && <><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[10px] text-slate-400">완료</span></>}
                    {step1Data?.status === 'error'             && <><div className="w-1.5 h-1.5 rounded-full bg-red-400"   /><span className="text-[10px] text-red-400">오류</span></>}
                    {validating                                && <><Loader2 size={11} className="animate-spin text-blue-500" /><span className="text-[10px] text-blue-600">{validStatusMsg || '검증 중'}</span></>}
                  </div>
                  {step1Data && step1Data.status !== 'error' && (
                    <button
                      onClick={() => setActiveIdx(1)}
                      className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors cursor-pointer"
                    >
                      다음 단계 — 정반 상부 배치 설정 →
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {!validating && !step1Data && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                      <FileCheck2 size={32} className="text-slate-200" />
                      <div>
                        <p className="text-sm font-semibold text-slate-400">Module Unit BDF 파일을 업로드하고 검증을 실행하세요</p>
                        <p className="text-[11px] text-slate-300 mt-1">GRID, ELEMENT, SPC 카드를 파싱하여 오류 유무를 확인합니다.</p>
                      </div>
                    </div>
                  )}

                  {validating && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                      <Loader2 size={28} className="animate-spin text-blue-500" />
                      <p className="text-sm font-semibold text-slate-500">{validStatusMsg || 'BDF 파일 파싱 중...'}</p>
                      {validProgress > 0 && (
                        <div className="w-48 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${validProgress}%` }} />
                        </div>
                      )}
                    </div>
                  )}

                  {!validating && step1Data && (
                    <ValidationStepLog
                      step1Data={step1Data}
                      step2Data={step2Data}
                      useNastran={useNastran}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─ Step 2-0: 정반 타입 선택 (타입을 고르기 전까지 배치 화면을 열지 않는다) ─ */}
          {isArrangeStep && !deckType && (
            <div className="flex-1 min-h-0 flex flex-col">
              <JungbanDeckSelector
                selected={deckType}
                onSelect={handleSelectDeckType}
                deckModelCache={jungbanModelCache}
              />
            </div>
          )}

          {/* ─ Step 2: 정반 상부 Module Unit 배치 설정 ─ */}
          {isArrangeStep && deckType && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* 최소 높이는 '카드'에 준다. 안쪽 캔버스 래퍼에 주면 카드보다 커져서
                  overflow-hidden 에 잘리고, 뷰어 우하단 오버레이가 사라진다.
                  카드에 주면 세로가 부족할 때 <main> 이 스크롤될 뿐 잘리지 않는다. */}
              <div className="flex-1 min-h-[440px] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-xs font-bold text-slate-700 shrink-0">2. 정반 상부 Module Unit 배치 설정</h2>
                    {/* 어떤 정반을 쓰는 중인지 항상 보이게 하고, 여기서 바로 다시 고를 수 있게 한다. */}
                    <button
                      type="button"
                      onClick={() => setDeckType(null)}
                      title="정반 타입 다시 선택"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold transition-colors cursor-pointer shrink-0"
                    >
                      <Layers size={10} /> {deckType} 타입 정반
                      <span className="text-blue-400 font-semibold">변경</span>
                    </button>
                    {/* 정반이 Unit 밑면과 스툴을 가린다 — 받치는 자리를 보려면 비쳐야 한다. */}
                    <button
                      type="button"
                      onClick={() => setDeckTransparent(v => !v)}
                      title="정반을 반투명하게 만들어 Unit 밑면과 스툴을 봅니다."
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                        deckTransparent
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {deckTransparent ? <Eye size={10} /> : <EyeOff size={10} />} 정반 반투명
                    </button>
                  </div>
                  {bdfFolderPath && (
                    <span className="text-[10px] font-mono text-slate-400 truncate max-w-[280px]" title={bdfFolderPath}>
                      {bdfFolderPath}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-h-0">
                  {/* 정반은 프로그램 내장 고정 모델이라 Module Unit 유무와 무관하게 항상 띄운다. */}
                  <FeModelViewer
                    parts={viewerParts}
                    initialShowRigids
                    markers={supportMarkers.length ? supportMarkers : (seating?.contacts || [])}
                    markerColor={supportMarkers.length ? '#22c55e' : '#f59e0b'}
                    cogMarkers={cogMarkers}
                    loading={viewerStatus === 'loading'}
                    loadingLabel={
                      jungbanModel
                        ? 'Module Unit 모델을 불러오는 중...'
                        : `${deckType} 타입 정반 모델을 불러오는 중...`
                    }
                    error={viewerStatus === 'error' ? viewerError : null}
                    errorAction={(
                      <button
                        onClick={() => setViewerReloadToken(t => t + 1)}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        <RotateCcw size={11} /> 다시 시도
                      </button>
                    )}
                    overlay={!moduleModel && viewerStatus !== 'loading' && !viewerError ? (
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
                        <div className="rounded-xl border border-amber-400/40 bg-slate-900/85 backdrop-blur px-4 py-3 text-center max-w-md">
                          <p className="text-xs font-bold text-amber-200">Module Unit 모델이 아직 없습니다</p>
                          <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                            현재 화면은 내장 정반 모델만 표시하고 있습니다.
                            1단계에서 Module Unit BDF 검증을 완료하면 정반 상면 기준 위치에 자동으로 배치됩니다.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  />
                </div>
              </div>

              <SupportSelectionPanel
                onOpenPicker={() => setSupportPickerOpen(true)}
                count={supportIdx.size}
                evaluation={supportEval}
                onClear={() => setSupportIdx(new Set())}
                disabled={!moduleModel}
              />

              <ArrangementPanel
                offsetXMm={arrangement.offsetXMm}
                offsetYMm={arrangement.offsetYMm}
                rotationZDeg={arrangement.rotationZDeg}
                contactTolMm={contactTolMm}
                onContactTolChange={setContactTolMm}
                onSeat={handleSeat}
                onCompareRotations={handleCompareRotations}
                rotationCandidates={rotationCandidates}
                onApplyRotation={handleApplyRotation}
                seating={seating}
                seatingBusy={seatingBusy}
                seatGap={seatGap}
                nodeIdsAt={nodeIdsAt}
                landingLevels={deckSurface?.levels}
                supportCount={supportIdx.size}
                placement={placement}
                disabled={!moduleModel}
                onChange={(patch) => setArrangement(prev => ({ ...prev, ...patch }))}
                onReset={() => setArrangement({ ...DEFAULT_MODULE_OCEAN_ARRANGEMENT })}
              />

              <MassSummaryPanel
                summary={massSummary}
                deckLabel={deckType ? `${deckType} 타입 정반` : '정반'}
                showCog={showCog}
                onToggleCog={setShowCog}
                deckContingencyPct={deckContingencyPct}
                onDeckContingencyChange={setDeckContingencyPct}
                moduleContingencyPct={moduleContingencyPct}
                onModuleContingencyChange={setModuleContingencyPct}
                deckSkipped={jungbanModel?.massProperties?.skipped}
                moduleSkipped={moduleModel?.massProperties?.skipped}
              />
            </div>
          )}

          {/* ─ Step 3: Module Unit 구조 해석 수행 ─
              결과가 나오면 판정을 **맨 위**로 올리고 입력 카드는 접는다. 예전에는 입력
              → 실행 → 가정 → 결과 순으로 한 줄에 쌓여 있어, 정작 봐야 할 합/부가 늘
              스크롤 맨 아래에 있었다. */}
          {isStructuralStep && (
            <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 shrink-0">
                <h2 className="text-xs font-bold text-slate-700">3. Module Unit 구조 해석 수행</h2>
                <span className="text-[10px] text-slate-400">— 해상 운송 하중 조건 구조 해석</span>
                {structuralResult && (
                  <span className="ml-auto min-w-0 truncate text-[10px] text-slate-400">{conditionSummary}</span>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                <div className="space-y-4">

                  {/* ── 결과 ── 있으면 무조건 맨 위 ── */}
                  {structuralResult && (
                    <>
                      <StructuralVerdictBanner
                        stress={structuralResult.stress}
                        weld={weldShown}
                        resultCurrent={structuralResultCurrent}
                        onOpenColorMap={() => setColorMapOpen(true)}
                        onDownloadBdf={structuralResult.model?.bdf ? handleDownloadBdf : null}
                        downloadingBdf={bdfDownloading}
                      />

                      {/* 두 과정은 성격이 다른 검토라 탭으로 갈라 본다. */}
                      <div>
                        <div className="flex gap-1 border-b border-slate-200">
                          {PROCESS_TABS.map(tab => {
                            const TabIcon = tab.icon;
                            const active = processTab === tab.id;
                            // 각 과정의 통과 여부를 탭에 얹어 둔다 — 열어 보지 않아도 어디가
                            // 문제인지 보여야 한다. 판정이 없으면(옛 결과) 회색으로 둔다 —
                            // 초록으로 칠하면 통과한 것으로 잘못 읽힌다.
                            const verdict = tab.id === 'stress'
                              ? (structuralResult.stress?.summary
                                  ? (structuralResult.stress.summary.exceedCount > 0 ? 'ng'
                                    : (!structuralResultCurrent
                                      || structuralResult.stress?.quality?.trustworthy === false
                                      ? 'review' : 'ok'))
                                  : 'none')
                              : (weldShown?.summary
                                  ? (weldShown.summary.status === 'NG' ? 'ng' : 'ok')
                                  : 'none');
                            return (
                              <button
                                key={tab.id}
                                onClick={() => {
                                  setProcessTab(tab.id);
                                  if (tab.id === 'weld') setWeldModalOpen(true);
                                }}
                                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-t-lg
                                            border-b-2 -mb-px transition-colors cursor-pointer ${
                                  active
                                    ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                                    : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                              >
                                <TabIcon size={13} className="shrink-0" />
                                <span className="truncate">{tab.label}</span>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  verdict === 'ng' ? 'bg-red-500'
                                    : verdict === 'review' ? 'bg-amber-500'
                                    : verdict === 'ok' ? 'bg-green-500' : 'bg-slate-300'}`} />
                              </button>
                            );
                          })}
                        </div>

                        <div className="pt-3">
                          {processTab === 'stress' ? (
                            <StressResultPanel
                              stress={structuralResult.stress}
                              model={structuralResult.model}
                            />
                          ) : (
                            <OceanWeldResultLauncher
                              weld={weldShown}
                              weldSpec={weldSpec}
                              onOpen={() => setWeldModalOpen(true)}
                            />
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {structuralBusy && (
                    <p className="text-xs text-slate-500">{structuralMsg}</p>
                  )}
                  {structuralError && (
                    <pre className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3
                                    text-[11px] text-red-700">{structuralError}</pre>
                  )}

                  {/* ── 해석 조건 ── 결과가 나오면 접어 둔다(다시 돌릴 때만 편다) ── */}
                  <Section
                    icon={SlidersHorizontal}
                    title={structuralResult ? '해석 조건 · 다시 실행' : '해석 조건'}
                    summary={conditionSummary}
                    defaultOpen={!structuralResult}
                    tone={structuralResult ? 'slate' : 'blue'}
                  >
                    <div className="space-y-4">
                      <BargeAccelerationPanel
                        input={accelerationInput}
                        onChange={handleAccelerationInputChange}
                        onImportModule={handleImportModuleAccelerationInputs}
                        canImportModule={Boolean(
                          moduleModel
                          && massSummary?.includes?.deck
                          && massSummary?.includes?.module
                          && massSummary?.total?.massTon
                        )}
                        onCalculate={handleCalculateAcceleration}
                        calculating={accelerationBusy}
                        result={accelerationResult}
                        isCurrent={accelerationIsCurrent}
                        error={accelerationError}
                        disabled={structuralBusy || accelerationBusy}
                      />

                      {/* 판정 기준 — 허용응력과 '무엇을 평가 대상으로 볼 것인가' 를 한 카드에 둔다. */}
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-700">판정 기준</h4>
                        <div className="grid grid-cols-3 gap-3 items-end">
                          <label className="text-xs text-slate-500">
                            항복응력 σy [MPa]
                            <input
                              type="number" step="1" value={material.sigmaYMPa}
                              disabled={structuralBusy}
                              onChange={e => setMaterial(m => ({ ...m, sigmaYMPa: e.target.value }))}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
                            />
                          </label>
                          <label className="text-xs text-slate-500">
                            허용 계수
                            <input
                              type="number" step="0.05" value={material.factor}
                              disabled={structuralBusy}
                              onChange={e => setMaterial(m => ({ ...m, factor: e.target.value }))}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
                            />
                          </label>
                          <div className="text-xs text-slate-500">
                            허용응력
                            <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-800">
                              {allowableMPa.toFixed(1)} MPa
                            </div>
                          </div>
                        </div>

                        {/* 평가 대상은 '구조 부재'다. 소구경 배관은 화물이고, 그 지지 상세가
                            BDF 에 없어 관 하나가 배관 계통을 혼자 받는 모양으로 모델링된다. */}
                        <div className="mt-3 grid grid-cols-3 gap-3 items-end border-t border-slate-100 pt-3">
                          <label className="col-span-2 text-xs text-slate-500">
                            판정 제외 — 소구경 배관 외경 [mm]
                            <input
                              type="number" step="0.1" min="0" max="200"
                              value={smallBoreMaxOdMm}
                              disabled={structuralBusy}
                              onChange={e => setSmallBoreMaxOdMm(e.target.value)}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
                            />
                          </label>
                          <div className="text-xs text-slate-500">
                            적용 기준
                            <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-800">
                              {smallBoreMaxOdMmForRun > 0
                                ? `OD ≤ ${smallBoreMaxOdMmForRun}` : '제외 안 함'}
                            </div>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                          재질 SS275 · 기본 허용 0.8σy · 제외 기본 {DEFAULT_SMALL_BORE_MAX_OD_MM}mm
                          (소구경 통상 정의 NPS 2″). <b>0 = 제외 안 함.</b>
                        </p>
                      </div>

                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        fullWidth
                        onClick={handleRunStructural}
                        disabled={!canRunStructural || structuralBusy}
                        isLoading={structuralBusy}
                      >
                        {structuralBusy ? `해석 중… ${structuralProgress}%`
                          : structuralResult ? '이 조건으로 다시 해석' : '구조 해석 수행'}
                      </Button>
                      {!structuralBusy && structuralRunBlockers.length > 0 && (
                        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-amber-900">
                          <p className="flex items-center gap-1.5 text-xs font-bold">
                            <AlertTriangle size={14} aria-hidden="true" /> 구조 해석을 아직 실행할 수 없습니다
                          </p>
                          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed">
                            {structuralRunBlockers.map(reason => <li key={reason}>{reason}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </Section>

                  {/* ── 모델링 가정 ── 결과를 읽는 데 꼭 필요한 4가지만 앞에 두고,
                      근거와 한계는 펼쳐 보게 한다. 예전에는 8줄이 늘 펼쳐져 있었다. ── */}
                  <Section
                    icon={Info}
                    title="모델링 가정"
                    summary={`평가 = Module Unit 부재 · σ ≤ ${allowableMPa.toFixed(0)} MPa · ${accelerationInput.loadCase} 1개`}
                    defaultOpen={false}
                  >
                    <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-600">
                      <li>· <b>하중</b> — 선택한 {accelerationInput.loadCase} 한 개(GRAV 하나). 정반 실형상과
                        합쳐 한 모델로 풀고, 경계조건은 정반 자신의 Leg 구속뿐입니다.</li>
                      <li>· <b>판정</b> — σ ≤ {allowableMPa.toFixed(0)} MPa 하나.
                        빔 응력은 축력 + 굽힘의 합성 수직응력입니다(전단·비틀림 제외).</li>
                      <li>· <b>평가 대상</b> — Module Unit 부재만 봅니다(정반 자체의 강도는 평가하지 않습니다).
                        {smallBoreMaxOdMmForRun > 0
                          ? ` 외경 ${smallBoreMaxOdMmForRun}mm 이하 소구경 배관은 판정에서 뺍니다.`
                          : ' 소구경 배관 제외는 꺼져 있어 배관이 판정을 지배할 수 있습니다.'}</li>
                      <li>· <b>연결</b> — 지지점 {supportNodeIds.length}개는 적치면에 RBE2 강결,
                        모듈 안 미끄러지는 지지는 병진 3방향을 채워 고박 상태로 풉니다
                        (그대로 두면 조각이 회전으로 떠나가는 자리만 회전까지 잡습니다).</li>
                    </ul>
                    <details className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
                      <summary className="cursor-pointer font-semibold text-slate-600">근거와 한계</summary>
                      <ul className="mt-1.5 space-y-1.5">
                        <li>· 지지점 RBE2 는 회전을 잡고 <b>인발도 견디는</b> 연결입니다. 실제 스툴이
                          지압·전단만 전달한다면 지지점 주변 부재 응력은 보수적으로 나옵니다.</li>
                        <li>· 고박에서 <b>회전은 일부러 잡지 않습니다</b>. 회전까지 강결하면 두 강체
                          사이에 끼인 짧은 부재가 그 회전차를 흡수해 실재하지 않는 모멘트를 받습니다.</li>
                        <li>· 소구경 배관은 화물이고, 실제 지지 상세(슈·클램프)가 BDF 에 없어 관 하나가
                          배관 계통을 혼자 받는 모양이 됩니다. 요소는 모델에 남아 질량·강성으로 기여하고
                          결과에는 별도 목록으로 나옵니다.</li>
                        {supportEval.zRangeMm > 1 && (
                          <li>· 지지점 높이 편차 {Math.round(supportEval.zRangeMm).toLocaleString()}mm —
                            스툴 높이가 그만큼 달라집니다.</li>
                        )}
                      </ul>
                    </details>
                  </Section>

                </div>
              </div>
            </div>
          )}

        </div>{/* end Right Panel */}
      </div>

      <SupportPickerModal
        open={supportPickerOpen}
        onClose={() => setSupportPickerOpen(false)}
        model={moduleModel}
        selected={supportIdx}
        onApply={setSupportIdx}
      />

      <LegReactionModal
        open={legModalOpen}
        onClose={() => setLegModalOpen(false)}
        legReaction={structuralResult?.legReaction}
      />

      <OceanWeldModal
        open={weldModalOpen}
        onClose={() => setWeldModalOpen(false)}
        legReaction={structuralResult?.legReaction}
        weld={weldShown}
        weldSpec={weldSpec}
        onSpecChange={setWeldSpec}
        onWeldResult={setWeldResult}
        onOpenLegModel={() => {
          setWeldModalOpen(false);
          setLegModalOpen(true);
        }}
      />

      <StressColorMapModal
        key={`${structuralResult?.runId || structuralResult?.stress?.resultJson || 'none'}:${structuralInputKey}`}
        open={colorMapOpen}
        onClose={() => setColorMapOpen(false)}
        stress={structuralResult?.stress}
        modelJsonPath={modelJsonPath}
        moduleModel={moduleModel}
        supportIdx={structuralResultCurrent ? supportIdx : new Set()}
        placement={structuralResult?.inputSnapshot?.placement ? {
          anchor: structuralResult.inputSnapshot.placement.anchorMm,
          deckCenter: structuralResult.inputSnapshot.placement.deckCenterMm,
          deckTopZ: structuralResult.inputSnapshot.placement.deckTopZMm,
          offsetXMm: structuralResult.inputSnapshot.placement.offsetXMm,
          offsetYMm: structuralResult.inputSnapshot.placement.offsetYMm,
          rotationZDeg: structuralResult.inputSnapshot.placement.rotationZDeg,
          gapMm: structuralResult.inputSnapshot.placement.gapMm,
        } : null}
      />

      {/* 개발 진행 안내. 과정 구성은 3단계 탭이 이미 보여 주므로 여기서는 되풀이하지 않는다 —
          늘 화면에 붙어 있는 문구라 길어질수록 정작 읽어야 할 결과를 밀어낸다. */}
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
        <ExternalLink size={13} className="shrink-0 text-amber-500" aria-hidden="true" />
        <p className="text-[11px] text-amber-800">이 App 은 현재 개발 진행 중입니다.</p>
      </div>
    </div>
  );
}
