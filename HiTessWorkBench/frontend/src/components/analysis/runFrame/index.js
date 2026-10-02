// 파일 기반 해석 앱 공통 틀(2026-10-01, 기준 앱 = HiTESS Model Builder).
//
// 골격: 왼쪽 레일(StepRail · InputSummary · 옵션 · 실행 버튼) + 오른쪽 작업면
//       (JobProgressCard → VerdictHeader → KeyFigures → 단계 본문 → NextActionBar) + EngineLogPanel(실패 시).
// 새 해석 앱이나 기존 앱 개편 시 이 부품을 먼저 쓰고, 앱 고유 내용만 단계 본문에 둔다.
// 표준 문서: docs/standards/file-based-app-page-standard.md (기준 구현 = HiTessModelBuilder.jsx · GroupModuleUnitLiftingAnalysis.jsx)
export { default as StepRail, STEP_STATUS } from './StepRail';
export { default as InputSummary } from './InputSummary';
export { default as VerdictHeader } from './VerdictHeader';
export { default as KeyFigures } from './KeyFigures';
export { default as NextActionBar } from './NextActionBar';
export { default as JobProgressCard } from './JobProgressCard';
export { default as EngineLogPanel } from './EngineLogPanel';
export { default as StudioLauncherCard } from './StudioLauncherCard';
export { default as RunStartPanel } from './RunStartPanel';
export { default as RunLogPanel } from './RunLogPanel';
