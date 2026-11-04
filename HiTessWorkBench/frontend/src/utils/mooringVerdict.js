/**
 * Mooring Fitting Assessment — 판정(통과 / 검토 필요 / 실패)과 그 근거를 만드는 순수 함수.
 *
 * 공통 틀(runFrame) 규칙: 판정은 한 가지만 보여 준다. 근거는 이 페이지가 이미 받아 보던 값뿐이다.
 *   - 작업 상태(build-full 성공/실패)         — job_status
 *   - result_info._artifacts_missing          — out/ 폴더가 안 생김
 *   - STAGE_00.raw.json                       — CSV 행별 변환 감사(아래 summarizeMooringRawAudit)
 *   - STAGE_07_FinalValidation.validation.json — 최종 모델 검사(summary.error / warning / overall)
 *   - DIAGNOSIS.json                          — 백엔드 mooring_diagnosis 의 케이스 진단(findings)
 *   - (선택) 구조해석 요약 summary            — Studio 구조해석(MooringFittingSolve) 기록의 result_info.summary
 *
 * 규칙 (위에서부터 먼저 걸리는 것이 판정)
 *   실패
 *     · 작업 실패(엔진 비정상 종료·시간 초과·요청 실패)
 *     · out/ 폴더 없음(_artifacts_missing)
 *     · 최종 검증 overall = FAILED 또는 error > 0  (엔진 FinalValidationPhase: errors==0 이면 PASSED)
 *     · 진단 '확정' 중 하중·평형·해 신뢰성 코드(LOAD_NOT_APPLIED · LOAD_NONE · EQUILIBRIUM_FAIL · SOLVER_UNSTABLE)
 *       — 하중이 모델에 없거나 해를 믿을 수 없으면 그 모델로 해석할 이유가 없다
 *     · 구조해석 요약: verdictCounts.NOT_OK > 0, 또는 counts 없이 ok === false
 *       (대시보드 resultHighlight 의 Mooring 칩 'NG' 와 같은 기준 — 기록의 summary 에는 counts 가 없다)
 *   검토 필요
 *     · CSV 파싱 실패 행 > 0  — 그 행의 부재·하중이 모델에 없다(Model Builder '질량 있는 입력 행 제외'와 같은 취급)
 *     · CSV 행 수 대조 불일치(integrity)
 *     · 최종 검증 warning > 0
 *     · 진단 '확정'·'유력' 중 위 실패 코드가 아닌 것(INPUT_ROW_DROPPED 는 CSV 파싱 실패와 같은 사실이라 그쪽이 있으면 뺀다)
 *     · 검증 JSON 을 읽지 못함(판정 근거 없음)
 *     · 구조해석 요약: verdictCounts.MATERIAL_CHANGE > 0 (재질만 바꾸면 만족), unknownGradeCount > 0 (등급 미확인 → 235 가정)
 *   구조해석 요약이 있으면 위 모델 항목과 해석 항목 중 더 나쁜 쪽이 판정이다(모델 실패면 해석 결과는 쓰지 않는다).
 *   판정 미반영(숨기지 않고 화면 KeyFigures 에 '판정 미반영'으로 보인다)
 *     · 빈 LOADCASE 경고 행(헤더/dummy — 엔진도 변환 실패로 보지 않는다), 제외(SKIP) 행
 *     · 진단 '참고'
 *     · 엔진 출력의 경고 줄(extractEngineAlerts) — 절점 병합·부재 제거 같은 정상 정리도 섞여 있다
 *
 * 반환: { level: 'pass'|'review'|'fail'|null, title, reasons:[{code,text}], basis: 'build'|'solve'|null }
 *   level=null = 아직 판정할 근거가 없음(실행 전·결과 JSON 읽는 중).
 */

/* ─────────────────────────────────────────────────────────────────────────
   CSV 행 감사 (STAGE_00.raw.json) — 페이지 CsvValidationPanel 과 판정이 같은 숫자를 쓴다
   ───────────────────────────────────────────────────────────────────────── */

const RAW_KIND_LABELS = {
  mf: 'MF',
  plate: 'PLATE / BRACKET',
  angle: 'ANGLE',
  flatbar: 'FLATBAR',
  tbar: 'TBAR',
};

const isTrivialSkip = (skip) => skip?.rowType === 'Empty' || skip?.rowType === 'Comment';
const isWarningSkip = (skip) => skip?.rowType === 'EMPTY_LOADCASE';
const getRawRowType = (skip) => String(skip?.rawLine || '').split(',')[0].trim().toUpperCase();
const isMetadataSkip = (skip) => {
  const tokens = [skip?.rowType, skip?.identifier, skip?.reason, skip?.rawLine, getRawRowType(skip)]
    .map(v => String(v || '').toUpperCase());
  return tokens.some(v => v.includes('CORROSION') || v.includes('MAIN GIRDER SIZE'));
};
const isIntentionalSkip = (skip) =>
  !isWarningSkip(skip) && (
    String(skip?.disposition || '').toLowerCase() === 'skip'
    || skip?.rowType === 'Skipped'
    || isMetadataSkip(skip)
  );
// 통째로 복사된 부재 행 — 엔진이 앞 행만 모델에 넣었다(Disposition "Duplicate"). 그 부재는 모델에 있으므로
// 파싱 실패로 세지 않는다. 사용자 확인은 진단 INPUT_ROW_DUPLICATE(확정)가 '검토 필요'로 맡는다.
const isDuplicateSkip = (skip) => skip?.rowType === 'DuplicateRow' || String(skip?.disposition || '').toLowerCase() === 'duplicate';
const isIgnoredSkip = (skip) => isTrivialSkip(skip) || isIntentionalSkip(skip) || isDuplicateSkip(skip);
const isFailureSkip = (skip) => !isIgnoredSkip(skip) && !isWarningSkip(skip);

function summarizeSkipReason(skip) {
  if (isWarningSkip(skip)) return '빈 LOADCASE (헤더/dummy, 변환 제외)';
  if (isMetadataSkip(skip)) return 'CORROSION / MAIN GIRDER SIZE 메타데이터 행';
  if (isIntentionalSkip(skip)) return 'SKIP 처리된 CSV 행';
  if (isDuplicateSkip(skip)) return '중복 행 — 앞 행과 모든 칸이 같아 앞 행만 모델에 넣음';
  return skip.reason || skip.rowType || 'Unknown';
}

function buildConvertedRows(rawJson) {
  const structure = rawJson?.structure || {};
  const rows = [];
  Object.entries(RAW_KIND_LABELS).forEach(([key, label]) => {
    (structure[key] || []).forEach((item) => {
      rows.push({
        kind: 'Structure', rowType: item.sourceRowType || label, physicalLineNumber: item.lineNumber,
        status: 'converted', name: item.id || '-', reason: 'CSV row converted',
      });
    });
  });
  (rawJson?.winch?.loadCases || []).forEach((item) => {
    rows.push({
      kind: 'Load', rowType: 'LOADCASE', physicalLineNumber: item.lineNumber,
      status: 'converted', name: item.loadId || '-', reason: 'Load case converted',
    });
  });
  return rows;
}

function buildSkipRows(rawJson) {
  return (rawJson?.skips || []).map((skip) => {
    const status = skip.rowType === 'Empty' ? 'blank'
      : isWarningSkip(skip) ? 'warning'
        : isIgnoredSkip(skip) ? 'ignored' : 'parseFailed';
    return {
      kind: skip.kind === 'Winch' ? 'Load' : (skip.kind || '-'),
      rowType: skip.rowType || '-',
      physicalLineNumber: skip.lineNumber,
      status,
      name: skip.identifier || '-',
      reason: summarizeSkipReason(skip),
    };
  });
}

/** STAGE_00.raw.json → 화면·판정용 요약. rawJson 이 없으면 null. */
export function summarizeMooringRawAudit(rawJson) {
  if (!rawJson) return null;
  const meta = rawJson.meta || {};
  const counts = meta.counts || {};
  const integrity = meta.integrity || {};
  const skips = rawJson.skips || [];
  const convertedStructure = (counts.mf || 0) + (counts.plate || 0) + (counts.bracket || 0)
    + (counts.angle || 0) + (counts.flatbar || 0) + (counts.tbar || 0);
  const convertedLoad = counts.loadCase || 0;
  const structureSkips = skips.filter(s => s.kind === 'Structure');
  const loadSkips = skips.filter(s => s.kind === 'Winch' || s.kind === 'Load');
  const hasStructureAccounting = integrity.structureTotalLines != null && integrity.structureAccountedFor != null;
  const hasLoadAccounting = integrity.loadTotalLines != null && integrity.loadAccountedFor != null;
  const hasAccountingMismatch =
    (hasStructureAccounting && integrity.structureTotalLines !== integrity.structureAccountedFor)
    || (hasLoadAccounting && integrity.loadTotalLines !== integrity.loadAccountedFor);

  const ignoredByReason = skips.reduce((acc, skip) => {
    const key = summarizeSkipReason(skip);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const rowAudit = [...buildConvertedRows(rawJson), ...buildSkipRows(rawJson)]
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || (a.physicalLineNumber || 0) - (b.physicalLineNumber || 0));

  return {
    summary: {
      totalDataRows: (integrity.structureTotalLines || 0) + (integrity.loadTotalLines || 0),
      convertedRows: convertedStructure + convertedLoad,
      ignoredRows: skips.filter(isIgnoredSkip).length,
      warningRows: skips.filter(isWarningSkip).length,
      parseFailedRows: skips.filter(isFailureSkip).length,
      ignoredByReason,
      hasAccountingMismatch,
    },
    byKind: {
      Structure: {
        fileName: meta.structureCsv,
        total: integrity.structureTotalLines || (convertedStructure + structureSkips.length),
        counts: {
          converted: convertedStructure,
          ignored: structureSkips.filter(isIgnoredSkip).length,
          warning: structureSkips.filter(isWarningSkip).length,
          parseFailed: structureSkips.filter(isFailureSkip).length,
        },
      },
      Load: {
        fileName: meta.loadCsv,
        total: integrity.loadTotalLines || (convertedLoad + loadSkips.length),
        counts: {
          converted: convertedLoad,
          ignored: loadSkips.filter(isIgnoredSkip).length,
          warning: loadSkips.filter(isWarningSkip).length,
          parseFailed: loadSkips.filter(isFailureSkip).length,
        },
      },
    },
    rowAudit,
    counts,
    integrity,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   엔진 출력 경고 줄 — 성공해도 보여 준다(입력 누락·부재 자동 제거·컴포넌트 분리·평형 검증 등).
   엔진이 쓰는 실제 표기에 맞춘 패턴이다.
   ───────────────────────────────────────────────────────────────────────── */

const ENGINE_ALERT_RE = /\[Warning\]|\[ERROR\]|Warning:|Error:|실질 누락|판정 불가|평형 검증|STRUCTURAL WARNING|SCAN FAILED|INCOMPLETE|하중경로에 영향|\[부재 제거\]|\[신규 연결 생성\]|\[절점 병합\]/;

export function extractEngineAlerts(log) {
  if (!log) return [];
  return String(log).split(/\r?\n/).filter(l => ENGINE_ALERT_RE.test(l)).map(l => l.trim());
}

/* ─────────────────────────────────────────────────────────────────────────
   판정
   ───────────────────────────────────────────────────────────────────────── */

/** 진단 '확정'이면 실패로 보는 코드 — 하중이 모델에 없거나 해를 믿을 수 없다. */
export const DIAGNOSIS_FAIL_CODES = new Set(['LOAD_NOT_APPLIED', 'LOAD_NONE', 'EQUILIBRIUM_FAIL', 'SOLVER_UNSTABLE']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MAX_REASONS = 3;

function capReasons(reasons) {
  if (reasons.length <= MAX_REASONS) return reasons;
  const head = reasons.slice(0, MAX_REASONS - 1);
  return [...head, { code: 'more', text: `그 밖에 ${reasons.length - head.length}건 — 아래 단계 본문에서 확인하세요` }];
}

const LEVEL_RANK = { pass: 0, review: 1, fail: 2 };

/** 구조해석 요약만 본 판정(reasons 는 자르지 않는다). */
function computeSolveVerdict(solveSummary) {
  const vc = solveSummary.verdictCounts || null;
  const usage = Number.isFinite(Number(solveSummary.globalMaxUsage)) ? Number(solveSummary.globalMaxUsage) : null;
  const usageText = usage != null ? ` (최대 활용도 ${usage.toFixed(2)})` : '';
  if ((vc && num(vc.NOT_OK) > 0) || (!vc && solveSummary.ok === false)) {
    return {
      level: 'fail', title: '구조 판정 불합격',
      reasons: [{ code: 'solve-not-ok', text: vc ? `허용 응력을 넘는 부재 ${num(vc.NOT_OK)}개${usageText}` : `허용 응력을 넘는 부재가 있습니다${usageText}` }],
    };
  }
  const reviews = [];
  if (vc && num(vc.MATERIAL_CHANGE) > 0) {
    reviews.push({ code: 'solve-material-change', text: `재질을 바꾸면 만족하는 부재 ${num(vc.MATERIAL_CHANGE)}개${usageText}` });
  }
  if (num(solveSummary.unknownGradeCount) > 0) {
    reviews.push({ code: 'solve-unknown-grade', text: `강재 등급을 알 수 없어 235 MPa 로 가정한 부재 ${num(solveSummary.unknownGradeCount)}개` });
  }
  if (reviews.length > 0) return { level: 'review', title: '검토 필요', reasons: reviews };
  return { level: 'pass', title: '구조 판정 통과', reasons: [] };
}

/**
 * @param {object} p
 * @param {'idle'|'running'|'success'|'failed'} [p.jobState]
 * @param {string}  [p.jobMessage]      실패 시 작업 메시지
 * @param {object}  [p.result]          build-full result_info
 * @param {object}  [p.rawJson]         STAGE_00.raw.json
 * @param {object}  [p.validationJson]  STAGE_07_FinalValidation.validation.json
 * @param {object}  [p.diagnosis]       DIAGNOSIS.json
 * @param {boolean} [p.artifactsLoading]
 * @param {string}  [p.artifactsError]  검증 JSON 읽기 실패 문구
 * @param {object}  [p.solveSummary]    구조해석 요약
 *
 * 구조해석 요약이 있으면 basis='solve' 이고, 판정은 모델 판정과 해석 판정 중 **더 나쁜 쪽**이다(2026-11-04).
 * 예전엔 요약이 있으면 해석 판정만 봐서, 하중이 없는 모델(LOAD_NONE — 응력 0 이라 전부 OK)도 '구조 판정 통과' 가 됐다.
 * 모델 판정이 실패면 해석 결과는 그 모델 기준이라 믿을 수 없으므로 모델 실패를 그대로 보인다.
 */
export function computeMooringVerdict(p = {}) {
  const build = computeBuildVerdict(p);
  const { solveSummary = null } = p;
  if (!(solveSummary && (typeof solveSummary.ok === 'boolean' || solveSummary.verdictCounts))) {
    return { ...build, reasons: capReasons(build.reasons) };
  }
  const solve = computeSolveVerdict(solveSummary);
  if (!build.level) return { ...solve, basis: 'solve', reasons: capReasons(solve.reasons) };
  if (build.level === 'fail') {
    return {
      level: 'fail', title: build.title, basis: 'solve',
      reasons: capReasons([
        ...build.reasons,
        { code: 'solve-untrusted', text: '구조해석 결과는 이 모델 기준이라 판정에 쓰지 않았습니다 — 모델 오류를 먼저 고치세요' },
      ]),
    };
  }
  const level = LEVEL_RANK[solve.level] >= LEVEL_RANK[build.level] ? solve.level : build.level;
  const title = level === 'fail' ? solve.title : level === 'review' ? '검토 필요' : '구조 판정 통과';
  return { level, title, basis: 'solve', reasons: capReasons([...solve.reasons, ...build.reasons]) };
}

/** 모델 생성(build-full) 판정. reasons 는 자르지 않는다(합친 뒤 computeMooringVerdict 가 자른다). */
function computeBuildVerdict({
  jobState = 'idle', jobMessage = '', result = null, rawJson = null, validationJson = null,
  diagnosis = null, artifactsLoading = false, artifactsError = null,
} = {}) {
  const none = { level: null, title: '', reasons: [], basis: null };

  if (jobState === 'idle' || jobState === 'running') return none;

  if (jobState === 'failed') {
    return {
      level: 'fail', title: '모델 생성 실패', basis: 'build',
      reasons: [{ code: 'job-failed', text: jobMessage || '엔진 실행이 실패했습니다. 아래 엔진 출력 원문을 확인하세요.' }],
    };
  }

  // jobState === 'success'
  if (result?._artifacts_missing) {
    return {
      level: 'fail', title: '모델 생성 실패', basis: 'build',
      reasons: [{ code: 'artifacts-missing', text: 'out 폴더가 생성되지 않아 변환 결과가 없습니다. 엔진 출력 원문을 확인하세요.' }],
    };
  }
  if (artifactsLoading) return none;

  const fails = [];
  const reviews = [];

  if (artifactsError || (!rawJson && !validationJson)) {
    reviews.push({ code: 'artifacts-unreadable', text: `검증 정보를 읽지 못해 판정할 근거가 없습니다${artifactsError ? ` — ${artifactsError}` : ''}` });
  }

  // 최종 모델 검증(STAGE_07)
  const vs = validationJson?.summary || null;
  if (vs) {
    const errors = num(vs.error);
    if (errors > 0 || vs.overall === 'FAILED') {
      fails.push({ code: 'final-error', text: `최종 모델 검증 오류 ${errors || '?'}건 (3단계 Checklist)` });
    }
    if (num(vs.warning) > 0) {
      reviews.push({ code: 'final-warning', text: `최종 모델 검증 경고 ${num(vs.warning)}건 (3단계 Checklist)` });
    }
  }

  // CSV 행 감사
  const audit = summarizeMooringRawAudit(rawJson);
  const parseFailed = audit ? audit.summary.parseFailedRows : 0;
  if (parseFailed > 0) {
    reviews.push({ code: 'csv-parse-failed', text: `입력 CSV ${parseFailed}행이 변환되지 않았습니다 — 그 행의 부재·하중은 모델에 없습니다` });
  }
  if (audit?.summary.hasAccountingMismatch) {
    reviews.push({ code: 'csv-accounting', text: 'CSV 전체 행 수와 처리된 행 수가 맞지 않습니다 — 원본 CSV 를 확인하세요' });
  }

  // 원인 진단(케이스 단위)
  (diagnosis?.findings || []).forEach((f, i) => {
    const code = `diag-${f.code || i}-${i}`;
    if (f.confidence === '확정' && DIAGNOSIS_FAIL_CODES.has(f.code)) {
      fails.push({ code, text: f.message });
    } else if (f.confidence === '확정' || f.confidence === '유력') {
      if (f.code === 'INPUT_ROW_DROPPED' && parseFailed > 0) return; // CSV 파싱 실패와 같은 사실
      reviews.push({ code, text: f.message });
    }
  });

  if (fails.length > 0) {
    return { level: 'fail', title: '모델 검증 실패', basis: 'build', reasons: [...fails, ...reviews] };
  }
  if (reviews.length > 0) {
    return { level: 'review', title: '검토 필요', basis: 'build', reasons: reviews };
  }
  return { level: 'pass', title: '모델 생성 통과', basis: 'build', reasons: [] };
}
