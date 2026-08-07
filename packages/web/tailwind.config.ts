import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

// Кремовая шкала — хром интерфейса (итерация палитры 07.08.2026: чёрный
// дэш + кремовые акценты вместо синих/графитовых; кнопки, свечения,
// активные состояния). Тёплая слоновая кость: 300-400 — акцент на чёрном,
// 600-700 — текст/заливки на светлой теме (контраст ≥4.5). Данные-цвета
// (budget.*, статусы, серии графиков, ГРБС-палитра) остаются цветными —
// это семантика данных, не хром.
const cream = {
  50: '#fdfbf4',
  100: '#f9f3e3',
  200: '#f1e6cb',
  300: '#e5d3a9',
  400: '#d6bf85',
  500: '#bfa161',
  600: '#8f7549',
  700: '#6f5a38',
  800: '#4c3e28',
  900: '#322a1c',
  950: '#1b170f',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: cream,
        // Переопределение стандартных «синих» палитр Tailwind: все
        // blue-* / sky-* / indigo-* классы по всему коду рендерятся кремом.
        blue: cream,
        sky: cream,
        indigo: cream,
        // Budget semantic colors
        budget: {
          fb: '#3b82f6',   // ФБ — blue (семантика данных, не хром)
          kb: '#10b981',   // КБ — emerald
          mb: '#f59e0b',   // МБ — amber
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-blue': '0 0 20px rgba(214, 191, 133, 0.16)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.15)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.15)',
        'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 10px 25px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.04)',
        'card-dark': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
        'card-dark-hover': '0 10px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out both',
        'slide-up': 'slideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1) both',
        'slide-down': 'slideDown 0.25s cubic-bezier(0.4, 0, 0.2, 1) both',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.4, 0, 0.2, 1) both',
        'shimmer': 'shimmer 2s infinite linear',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 3s ease infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
      },
    },
  },
  plugins: [tailwindAnimate],
} satisfies Config;
