import './adminBootstrap'; // 첫 줄 — API 모듈보다 먼저 서버 주소를 이 페이지 출처로
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import '../index.css';
import AdminApp from './AdminApp.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AdminApp />
    </MotionConfig>
  </StrictMode>,
);
