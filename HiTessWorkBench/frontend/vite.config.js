import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  
  // ▼ [필수] Electron 빌드 시 상대 경로를 사용하기 위해 꼭 필요합니다!
  base: './', 

  server: {
    port: 5173,
    strictPort: true,
  }
})