/**
 * 대시보드 '내 작업' 목록 계산 — 연속 실행 묶기 · 결과 판정 한 줄 · 확인할 실패.
 * 화면(Dashboard.jsx)과 떼어 둔 이유는 규칙을 테스트로 고정하기 위해서다.
 */

export const FAILED_STATUSES = new Set(['Failed', 'Interrupted']);

const parseInfo = (value) => {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * 같은 앱 · 같은 입력으로 **연달아** 돌린 실행을 한 묶음으로 만든다.
 * - 실패는 묶지 않는다 — 건마다 사유와 '새로 시작' 동작이 따로 필요하다.
 * - 연속일 때만 묶는다. 사이에 다른 작업이 끼면 시간 순서가 거짓말이 되므로 따로 둔다.
 * - inputKey 가 없는(입력 파일을 못 찾은) 실행은 프로젝트명이 매번 달라 묶지 않는다.
 * 반환: [{ id, head(가장 최근), runs(최신순) }]
 */
export function groupConsecutiveRuns(records, inputKeyOf) {
  const groups = [];
  for (const record of records || []) {
    const inputKey = inputKeyOf(record);
    const last = groups[groups.length - 1];
    const groupable = inputKey && !FAILED_STATUSES.has(record.status);
    if (
      groupable && last
      && last.inputKey === inputKey
      && last.head.program_name === record.program_name
      && !FAILED_STATUSES.has(last.head.status)
    ) {
      last.runs.push(record);
      continue;
    }
    groups.push({ id: record.id, head: record, runs: [record], inputKey: groupable ? inputKey : null });
  }
  return groups;
}

const STEP_STATUS = {
  pass: { tone: 'ok', label: '검증 통과' },
  warning: { tone: 'warn', label: '검증 경고' },
  error: { tone: 'ng', label: '검증 오류' },
};

const INPUT_FILE_RE = /\.(bdf|dat|nas|blk|csv|pdf|f06|json|png|jpe?g)$/i;
const baseName = (p) => String(p).split(/[\\/]/).pop();

/**
 * 결과 행에 보여 줄 입력 파일명. 프로젝트명은 '앱이름_날짜시각' 이라 앱·시간과 겹치고,
 * 같은 앱을 여러 번 돌리면 어느 모델이었는지 구분이 안 된다. input_info 의 키는 앱마다 달라
 * (stru_csv·bdf_path·file_path …) 파일 확장자로 끝나는 첫 문자열 값을 쓴다. 여러 개면 '외 N'.
 */
export const inputFileLabel = (record) => {
  let info = record?.input_info;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { return null; }
  }
  if (!info || typeof info !== 'object') return null;
  const names = [];
  // MySQL JSON 은 키를 길이·사전순으로 재정렬한다(pipe_csv 가 stru_csv 보다 앞). 주 입력으로 보이는 키를 먼저 본다.
  const PRIMARY_KEY_RE = /stru|bdf|model|main|input/i;
  const entries = Object.entries(info).sort(([a], [b]) => Number(PRIMARY_KEY_RE.test(b)) - Number(PRIMARY_KEY_RE.test(a)));
  const visit = (value, depth) => {
    if (typeof value === 'string') {
      if (INPUT_FILE_RE.test(value.trim())) names.push(baseName(value.trim()));
    } else if (Array.isArray(value)) {
      value.forEach(v => visit(v, depth));
    } else if (value && typeof value === 'object' && depth < 1) {
      Object.values(value).forEach(v => visit(v, depth + 1));
    }
  };
  entries.forEach(([, v]) => visit(v, 0));
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  return unique.length > 1 ? `${unique[0]} 외 ${unique.length - 1}` : unique[0];
};


const fmt = (n, digits) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits });

/**
 * 결과에서 엔지니어가 먼저 볼 판정 한 줄. 결과 구조가 앱마다 달라 **판정 값이 실제로 있는 앱만** 읽는다.
 * 없으면 null — 억지로 만들지 않는다(성공 아이콘이 그대로 상태를 말한다).
 * tone: ok(합격·통과) · warn(경고) · ng(불합격·오류) · info(산출 값)
 */
export function resultHighlight(record) {
  if (!record || record.status !== 'Success') return null;
  const info = parseInfo(record.result_info);
  if (!info) return null;

  // Mooring Fitting 해석 — 전 하중 케이스 최대 활용도와 판정
  const summary = info.summary;
  if (summary && typeof summary.ok === 'boolean' && Number.isFinite(summary.globalMaxUsage)) {
    return {
      tone: summary.ok ? 'ok' : 'ng',
      label: `${summary.ok ? 'OK' : 'NG'} · 최대 활용도 ${fmt(summary.globalMaxUsage, 2)}`,
    };
  }
  // 권상 해석(GMU · Side Passage) — 모델 검증 단계 결과. 2단계가 있으면 그것이 최종이다.
  const step = STEP_STATUS[info.step2_status] || STEP_STATUS[info.step1_status];
  if (step) return step;
  // Column Buckling — 허용 사용 하중
  if (Number.isFinite(info.maxWorkingLoadTon)) {
    return { tone: 'info', label: `허용 하중 ${fmt(info.maxWorkingLoadTon, 1)} t` };
  }
  // Carling 최적화 — 최적안 중량
  if (Number.isFinite(info.optimal?.weight_kg)) {
    return { tone: 'info', label: `최적안 ${fmt(info.optimal.weight_kg, 1)} kg` };
  }
  return null;
}

/**
 * 확인할 실패 = 최근 실패 중 **그 뒤로 같은 앱이 아직 성공하지 않은 것**.
 * 다시 돌려 성공했다면 이미 처리한 실패다. 상단 칩과 목록 고정이 같은 기준을 쓴다
 * (예전엔 칩은 7일 실패 전부, 목록은 이 기준이라 '실패 1' 이 떠 있는데 목록엔 없었다).
 */
export function unresolvedFailures(failures, history, acknowledgedIds) {
  const acknowledged = new Set(acknowledgedIds || []);
  return (failures || []).filter(f => !acknowledged.has(f.id) && !(history || []).some(h =>
    h.program_name === f.program_name && h.status === 'Success'
    && Date.parse(h.created_at) > Date.parse(f.created_at)));
}

/**
 * 사용자가 이미 본 실패 id 목록에 더한다(상세·로그를 열었거나, 새로 시작했거나, '확인' 을 눌렀을 때).
 * 본 실패는 큰 빨간 카드·상단 칩에서 빠지고 목록의 한 줄 '실패' 표기로만 남는다.
 * 최근 것만 max 개 보관 — 실패 조회 범위가 7일이라 오래된 id 는 더 쓸 일이 없다.
 */
export function addAcknowledgedFailures(current, ids, max = 200) {
  const next = (current || []).filter(id => !(ids || []).includes(id));
  next.push(...(ids || []));
  return next.slice(-max);
}

// 진행 중에 남는 문구(“Nastran 실행 중...”, “편집 적용 중 (1/3)...”, “진행 45%”) — 실패한 뒤에도 남아 있으면 원인이 아니다.
// %는 진행률만 있는 짧은 문구만 — “디스크 사용률 98% 로 저장 실패” 같은 진짜 원인은 거르지 않는다.
const PROGRESS_MESSAGE = /(중\s*(\(\d+\/\d+\))?\s*(\.{2,}|…)?\s*$|^\D{0,10}\d+\s*%$|^(시작|대기|준비)|업로드 완료|시작합니다)/;
// 원인을 말하지 않는 일반 실패 문구(“해석 실패”, “Analysis Failed”) — 결과에 구체적 오류가 있으면 그쪽을 쓴다
const GENERIC_FAILURE = /^(.{0,20}\s)?(실패|failed)\.?$|^analysis failed\.?$/i;

const firstLine = (v) => v.trim().split('\n')[0].trim().slice(0, 140);

function resultInfoError(record) {
  let info = record?.result_info;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { return null; }
  }
  if (!info || typeof info !== 'object') return null;
  const diag = info.diagnostic;
  const candidates = [
    info.error, info.error_message, info.message, info.detail, info.reason,
    typeof diag === 'string' ? diag : diag?.message || diag?.summary || diag?.error,
  ];
  const hit = candidates.find(v => typeof v === 'string' && v.trim());
  return hit ? firstLine(hit) : null;
}

/**
 * 실패 레코드에서 사유 한 줄을 찾는다. { text, kind } — kind: 'reason'(원인) | 'last'(마지막 메시지일 뿐).
 * job_message 는 job_manager 가 남긴 '마지막 진행 메시지'라 실패 문구가 아닐 수 있다.
 * 진행 문구면 원인으로 쓰지 않고, 일반 실패 문구면 결과의 구체적 오류를 먼저 쓴다.
 */
export function failureReason(record) {
  const raw = typeof record?.job_message === 'string' ? firstLine(record.job_message) : '';
  const infoError = resultInfoError(record);
  if (raw && PROGRESS_MESSAGE.test(raw)) {
    return infoError ? { text: infoError, kind: 'reason' } : { text: raw, kind: 'last' };
  }
  if (raw && GENERIC_FAILURE.test(raw) && infoError) return { text: infoError, kind: 'reason' };
  if (raw) return { text: raw, kind: 'reason' };
  return infoError ? { text: infoError, kind: 'reason' } : null;
}
