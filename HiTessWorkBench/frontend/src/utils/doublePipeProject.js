const PROGRAM_NAMES = new Set([
  'DoublePipeFuelLine',
  '이중관 구조 연료배관 해석',
]);

export function isDoublePipeProject(project) {
  return PROGRAM_NAMES.has(project?.program_name);
}

function normalizeLoadCases(inputInfo) {
  const raw = inputInfo?.load_cases;
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === 'string' && raw && !/^all(?:\(29\))?$/i.test(raw.trim())) {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === '') return '—';
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}시간 ${String(minutes).padStart(2, '0')}분 ${String(seconds).padStart(2, '0')}초`;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

export function normalizeDoublePipeProject(project) {
  const inputInfo = project?.input_info && typeof project.input_info === 'object'
    ? project.input_info
    : {};
  const resultInfo = project?.result_info && typeof project.result_info === 'object'
    ? project.result_info
    : {};
  const workflowStep = inputInfo.workflow_step || resultInfo.workflow_step || 'psa';
  const isInnerSupportOnly = workflowStep === 'inner_support';
  const loadCases = normalizeLoadCases(inputInfo);
  const isAllLoadCases = inputInfo.load_case_mode === 'all'
    || (typeof inputInfo.load_cases === 'string' && /^all(?:\(29\))?$/i.test(inputInfo.load_cases.trim()))
    || (!inputInfo.load_case_mode && loadCases.length === 0);
  const config = inputInfo.inner_support_config && typeof inputInfo.inner_support_config === 'object'
    ? inputInfo.inner_support_config
    : {};

  return {
    workflowStep,
    isInnerSupportOnly,
    workflowStepLabel: isInnerSupportOnly
      ? 'Tab 1 · Inner Support 설계'
      : 'Tab 2 · Abaqus 배관응력 해석',
    resultSectionLabel: isInnerSupportOnly ? 'Inner Support 설계 결과' : 'Abaqus 해석 결과',
    logSectionLabel: isInnerSupportOnly ? '변환 로그' : 'Solver Log',
    inputCsv: typeof inputInfo.input_csv === 'string' ? inputInfo.input_csv : null,
    configPath: typeof inputInfo.config_file === 'string' ? inputInfo.config_file : null,
    inputMode: inputInfo.input_mode || (Object.keys(config).length ? 'inner_support' : 'direct_upload'),
    inputModeLabel: inputInfo.input_mode === 'inner_support' || Object.keys(config).length
      ? 'Inner Support 설계 결과'
      : '배관 CSV 직접 입력',
    loadCases,
    loadCaseLabel: isInnerSupportOnly
      ? '해당 없음 (Tab 1)'
      : isAllLoadCases
        ? '전체 29개'
        : `선택 ${loadCases.length}개 (${loadCases.join(', ')})`,
    config,
    outputCsv: typeof resultInfo.result_csv === 'string' ? resultInfo.result_csv : null,
    rowCount: resultInfo.row_count ?? null,
    reportPath: typeof resultInfo.report === 'string' ? resultInfo.report : null,
    reportReady: resultInfo.report_ready === true || typeof resultInfo.report === 'string',
    startedAt: resultInfo.started_at || project?.started_at || null,
    finishedAt: resultInfo.finished_at || project?.updated_at || null,
    durationSec: resultInfo.duration_sec ?? null,
    durationLabel: formatDuration(resultInfo.duration_sec),
    returncode: resultInfo.returncode ?? null,
    diagnostic: resultInfo.diagnostic || null,
    logs: Array.isArray(resultInfo.logs) ? resultInfo.logs.map(String) : [],
  };
}
