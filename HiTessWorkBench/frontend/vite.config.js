import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// `vite build --mode admin` = 관리자 웹 콘솔(admin.html)만 dist-admin 에 만든다.
// exe 빌드(기본 모드)는 index.html 만 — 바뀌지 않는다. 배포는 scripts/build-admin-web.ps1.
// 관리자 콘솔은 서버 주소를 늘 페이지 출처에서 얻는다(src/admin/adminBootstrap.js). 그래서 config.js 의 기본 주소는
// 쓰지 않는데, 로컬 config.js 가 개발 PC(70) 줄이면 그 주소가 공개 번들에 실린다 → 콘솔 빌드에서만 그 글자를 지운다.
// scripts/build-admin-web.ps1 이 번들에 70 주소가 없는지 다시 확인한다.
const DEV_PC_HOST = '10.133.122.70';
const stripDevPcAddress = {
  name: 'admin-strip-dev-pc-address',
  transform(code, id) {
    if (!/[\\/]src[\\/]config\.js$/.test(id) || !code.includes(DEV_PC_HOST)) return null;
    return { code: code.replace(/(["'])https?:\/\/10\.133\.122\.70(:\d+)?\1/g, "''"), map: null };
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'admin' ? [stripDevPcAddress] : [])],

  // ▼ [필수] Electron 빌드 시 상대 경로를 사용하기 위해 꼭 필요합니다!
  // (관리자 콘솔도 /admin/ 아래에서 상대 경로로 자원을 찾는다)
  base: './',

  build: {
    ...(mode === 'admin' ? { outDir: 'dist-admin', emptyOutDir: true } : {}),
    rollupOptions: {
      ...(mode === 'admin' ? { input: { admin: 'admin.html' } } : {}),
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('three')) return 'vendor-three';
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast') || id.includes('hast') || id.includes('unified')) {
            return 'vendor-markdown';
          }
          if (id.includes('@headlessui')) return 'vendor-headlessui';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('html-to-image') || id.includes('html2canvas')) return 'vendor-export';
          if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
          return 'vendor';
        }
      }
    }
  },

  server: {
    port: 5173,
    strictPort: true,
  }
}))
