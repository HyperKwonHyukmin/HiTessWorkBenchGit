// 활동 로그 액션 타입 라벨/색상 — SystemSettings·UserManagement 공용 상수.
// (이전에는 두 파일에 동일 정의가 중복되어 새 액션 타입 추가 시 한쪽이 누락될 위험이 있었다.)

export const ACTION_TYPE_LABELS = {
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  PAGE_VIEW: '페이지 조회',
  ANALYSIS_REQUEST: '해석 요청',
  ANALYSIS_COMPLETE: '해석 완료',
  ANALYSIS_FAILED: '해석 실패',
  FILE_DOWNLOAD: '파일 다운로드',
  PROGRAM_DOWNLOAD: '프로그램 다운로드',
  EXPORT_XLSX: 'Excel 내보내기',
  VERSION_UPDATE: '버전 업데이트',
  USER_APPROVE: '사용자 승인',
  USER_DEACTIVATE: '사용자 비활성화',
  USER_UPDATE: '사용자 정보수정',
  USER_DELETE: '사용자 삭제',
  NOTICE_EDIT: '공지 편집',
  REQUEST_STATUS_CHANGE: '요청 상태변경',
  GUIDE_EDIT: '가이드 편집',
  APPSPACE_EDIT: 'App 커뮤니티 관리',
};

export const ACTION_TYPE_COLORS = {
  LOGIN: 'bg-emerald-100 text-emerald-700',
  LOGOUT: 'bg-slate-100 text-slate-600',
  PAGE_VIEW: 'bg-sky-100 text-sky-700',
  ANALYSIS_REQUEST: 'bg-violet-100 text-violet-700',
  ANALYSIS_COMPLETE: 'bg-emerald-100 text-emerald-700',
  ANALYSIS_FAILED: 'bg-red-100 text-red-700',
  FILE_DOWNLOAD: 'bg-blue-100 text-blue-700',
  PROGRAM_DOWNLOAD: 'bg-indigo-100 text-indigo-700',
  EXPORT_XLSX: 'bg-cyan-100 text-cyan-700',
  VERSION_UPDATE: 'bg-amber-100 text-amber-700',
  USER_APPROVE: 'bg-emerald-100 text-emerald-700',
  USER_DEACTIVATE: 'bg-orange-100 text-orange-700',
  USER_UPDATE: 'bg-blue-100 text-blue-700',
  USER_DELETE: 'bg-red-100 text-red-700',
  NOTICE_EDIT: 'bg-indigo-100 text-indigo-700',
  REQUEST_STATUS_CHANGE: 'bg-violet-100 text-violet-700',
  GUIDE_EDIT: 'bg-teal-100 text-teal-700',
  APPSPACE_EDIT: 'bg-teal-100 text-teal-700',
};
