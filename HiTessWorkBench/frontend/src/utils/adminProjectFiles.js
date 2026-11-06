/**
 * 관리자 All Projects — 작업 폴더 파일 목록 규칙(순수 함수).
 *
 * 서버(`GET /api/admin/projects/{id}/files`)가 주는 파일 = { path, folder, rel, size, modified, role, drm }.
 * role: 'input'(입력) | 'result'(결과) | 'other'(작업 폴더의 그 밖 파일 — 중간 산출물·로그 등).
 */

export const ROLE_ORDER = ['input', 'result', 'other'];

export const ROLE_LABELS = {
  input: '입력',
  result: '결과',
  other: '기타 산출물',
};

/** 역할별로 묶고 그 안은 폴더 → 상대 경로 순. 빈 묶음은 뺀다. */
export function groupFilesByRole(files = []) {
  return ROLE_ORDER
    .map(role => ({
      role,
      label: ROLE_LABELS[role],
      files: files
        .filter(f => f.role === role)
        .slice()
        .sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || (a.rel || '').localeCompare(b.rel || '')),
    }))
    .filter(group => group.files.length > 0);
}

export function summarizeSelection(files = [], selected = new Set()) {
  let count = 0;
  let bytes = 0;
  let drm = 0;
  for (const f of files) {
    if (!selected.has(f.path)) continue;
    count += 1;
    bytes += Number(f.size) || 0;
    if (f.drm) drm += 1;
  }
  return { count, bytes, drm };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

/** 표 칸용 짧은 시각 — 'YYYY-MM-DD HH:mm'(지역 시각). 읽을 수 없으면 ''. */
export function formatShortDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** LogBook 묶음 이름 기본값 — 서버 기본값과 같은 모양(제목을 비우면 서버가 이 이름을 쓴다). */
export function defaultExportTitle(project) {
  if (!project) return '';
  const owner = (project.employee_id || '').toUpperCase();
  return `WB #${project.id} · ${project.program_name || 'Unknown'} · ${owner}`;
}

/** 보낸 결과 한 줄 요약. */
export function describeExportResult(result) {
  if (!result) return '';
  const parts = [`${result.file_count ?? 0}개 파일`];
  // LogBook 49 — 권상 해석은 Wire 모델·권상 위치 JSON 을 서버가 자동으로 더한다
  if (result.auto_added?.length) parts.push(`권상 Wire 파일 ${result.auto_added.length}개 자동 포함`);
  if (result.blocked?.length) parts.push(`이미 LogBook 에 있는 BDF ${result.blocked.length}개 제외`);
  if (result.rejected?.length) parts.push(`DRM 파일 ${result.rejected.length}개 제외`);
  if (result.state === 'blocked') return `모든 파일이 이미 LogBook 에 있어 새 묶음을 만들지 않았습니다 (${parts.slice(1).join(', ')}).`;
  return `LogBook 정리 대기로 보냈습니다 — ${parts.join(', ')}.`;
}

/**
 * 권상 해석의 권장 세트(서버 `liftingSet` = { wire, result, missing }) → 미리 체크할 경로 목록.
 * Wire 모델(BDF·meta·posture) + 구조 해석 결과(결과 JSON·F06·모델 JSON). 세트가 없으면 [].
 */
export function liftingSetPaths(liftingSet) {
  if (!liftingSet) return [];
  return [...new Set([...(liftingSet.wire || []), ...(liftingSet.result || [])])];
}

/** 권장 세트 안내 한 줄. Wire 모델이 없으면 '' (안내하지 않음). */
export function describeLiftingSet(liftingSet) {
  if (!liftingSet?.wire?.length) return '';
  if (!liftingSet.result?.length) {
    return 'Wire 모델만 있고 구조 해석 결과가 없습니다. 이대로 보내면 나중에 Studio 에서 실적의 결과 화면을 열 수 없습니다.';
  }
  return 'Wire 모델과 구조 해석 결과(결과 JSON · 모델 JSON · F06)를 함께 보내기를 권합니다. Studio 에서 실적을 부를 때 결과 화면을 띄우는 데 씁니다. 미리 체크해 두었습니다.';
}

/** 3D 미리보기가 되는 BDF 인가 — 백엔드 admin_projects.PREVIEW_SUFFIXES 와 같아야 한다. DRM 파일은 서버가 못 읽는다. */
export const PREVIEW_SUFFIXES = ['.bdf', '.dat', '.nas', '.blk', '.bulk'];

export function isPreviewableBdf(file) {
  if (!file || file.drm) return false;
  const name = String(file.rel || file.path || '').toLowerCase();
  return PREVIEW_SUFFIXES.some(s => name.endsWith(s));
}
