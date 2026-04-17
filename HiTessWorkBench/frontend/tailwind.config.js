/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'SUIT', 'sans-serif'],
      },
      colors: {
        // HD 현대 공식 컬러 (이름을 더 직관적으로 변경)
        brand: {
          blue: '#002554',     // Trust Blue (메인 배경) - 아주 진한 남색
          green: '#008233',    // Heritage Green (버튼) - 진한 초록색
          accent: '#00E600',   // Heritage Green Light (포인트) - 형광 연두
          gray: '#F5F7FA',     // 배경용 아주 연한 회색
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}