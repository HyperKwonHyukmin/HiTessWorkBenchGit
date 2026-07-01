import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// IntroductionPage 폴더를 정적 파일로 서빙하는 플러그인
function serveIntroductionPage() {
  const introDir = path.resolve(__dirname, '..', 'IntroductionPage')
  return {
    name: 'serve-introduction-page',
    configureServer(server) {
      server.middlewares.use('/IntroductionPage', (req, res, next) => {
        const reqPath = (req.url || '/').split('?')[0]
        const filePath = path.join(introDir, reqPath)
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          fs.createReadStream(filePath).pipe(res)
        } else {
          next()
        }
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serveIntroductionPage()],

  // ▼ [필수] Electron 빌드 시 상대 경로를 사용하기 위해 꼭 필요합니다!
  base: './',

  build: {
    rollupOptions: {
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
})
