// 구조해석 자동화 협의체 과제 현황 — 브라우저 입구(145 /council/). 계획 docs/plans/2026-11-25-automation-council-tasks-plan.md
import '../admin/adminBootstrap'; // 첫 줄 — 로그인 키를 이 탭에만, 서버 주소를 이 페이지 출처로(관리자 콘솔과 같은 규칙)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import CouncilApp from './CouncilApp.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CouncilApp />
  </StrictMode>,
);
