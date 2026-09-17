/**
 * Unit 권상 구조 검토 보고서 — 입력 옵션 헬퍼.
 *
 * 백엔드 `app/services/unit_lifting_report/collector.py::ReportOptions.from_payload` 와 키가 1:1 이다.
 * 같은 필드를 Studio(UnitStructuralReportDialog)도 쓰므로 규칙은 여기 한 곳에만 둔다.
 */

/** BDF/JSON 파일명의 `1234-56789` 패턴 → 호선·유닛. 없으면 빈 문자열. */
export function deriveIds(fileName = '') {
  const m = /(?<!\d)(\d{4})[-_](\d{5})(?!\d)/.exec(String(fileName || ''));
  return { hullNo: m ? m[1] : '', unitNo: m ? m[2] : '' };
}

/**
 * 결과 레포트 '주의 사항' 5행에 넣을 수 있는 글자 수.
 * 서식의 F~BA 박스(576px)에 12pt 한글이 정확히 36자 들어간다 — 넘으면 Excel 이 글자를 줄여
 * 다른 줄보다 작아 보인다(사용자 결정 2026-09-17). 백엔드 `collector.EXTRA_NOTICE_MAX_CHARS` 와 같다.
 */
export const EXTRA_NOTICE_MAX = 36;

/** 지그 기준·항복강도 기본값. 백엔드 기본값과 같아야 한다. */
export const REPORT_DEFAULTS = { jigLimitTon: 6.2, yieldStrengthMpa: 275 };

/** 모달 초기값 — 파일명에서 호선·유닛을 선입력한다. */
export function initialReportForm(fileName = '', author = '') {
  return {
    ...deriveIds(fileName),
    drawingNo: '', revision: '0', author: author || '', department: '',
    jigLimitTon: REPORT_DEFAULTS.jigLimitTon, yieldStrengthMpa: REPORT_DEFAULTS.yieldStrengthMpa,
    notes: '', extraNotice: '',
  };
}

/** 양수 숫자인가 (문자열 입력 허용). */
export function isPositiveNumber(v) {
  return v !== '' && v !== null && Number.isFinite(Number(v)) && Number(v) > 0;
}

/** 생성 버튼 활성 조건 — 숫자 두 개만 검사하고 나머지는 선택 입력이다. */
export function isReportFormValid(form) {
  return isPositiveNumber(form?.jigLimitTon) && isPositiveNumber(form?.yieldStrengthMpa);
}

/** 폼 → 백엔드 options. 숫자 필드는 Number 로 바꾸고 문자열은 trim 한다. */
export function toReportOptions(form) {
  const text = (v) => String(v ?? '').trim();
  return {
    hullNo: text(form?.hullNo), unitNo: text(form?.unitNo), drawingNo: text(form?.drawingNo),
    revision: text(form?.revision) || '0', author: text(form?.author), department: text(form?.department),
    jigLimitTon: Number(form?.jigLimitTon), yieldStrengthMpa: Number(form?.yieldStrengthMpa),
    notes: text(form?.notes),
    // 주의 사항 5행 — 서식 박스 폭이 정해져 있어 입력란(maxLength)과 같은 길이로 자른다
    extraNotice: text(form?.extraNotice).slice(0, EXTRA_NOTICE_MAX),
  };
}
