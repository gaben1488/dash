import { useEffect, type CSSProperties } from 'react';
import type { Page } from '../store';
import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: (localStorage.getItem('aemr-theme') as Theme) || 'dark',
  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('aemr-theme', next);
      return { theme: next };
    }),
}));

/**
 * Call this hook once at the app root to sync the theme class
 * onto <html> whenever the Zustand theme value changes.
 */
export function useThemeInit() {
  const theme = useTheme((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [theme]);
}

export interface PageTheme {
  motif: string;
  sky: string;
  horizon: string;
  ink: string;
  accentLight: string;
  accentDark: string;
}

type MainPage = Exclude<Page, 'recon' | 'trust' | 'issues' | 'recs' | 'journal'>;

/** Planetary identities continue the original Zarya gallery. Semantic data
 * colors and department identity are independent of these interface colors. */
export const PAGE_THEMES: Record<MainPage, PageTheme> = {
  dashboard: { motif: 'Классическая заря', sky: '#5b99f8', horizon: '#9d8150', ink: '#080d15', accentLight: '#2d5c9b', accentDark: '#b5d1fc' },
  report: { motif: 'Сатурн', sky: '#555378', horizon: '#805d29', ink: '#ffffff', accentLight: '#555378', accentDark: '#b3b2c2' },
  svod: { motif: 'Небесный свод', sky: '#35479b', horizon: '#62507a', ink: '#ffffff', accentLight: '#35479b', accentDark: '#a4acd2' },
  data: { motif: 'Плеяды', sky: '#365a8c', horizon: '#46657b', ink: '#ffffff', accentLight: '#365a8c', accentDark: '#a5b5cb' },
  unfunded: { motif: 'Пояс астероидов', sky: '#655065', horizon: '#765d40', ink: '#ffffff', accentLight: '#655065', accentDark: '#bab0ba' },
  yearlong: { motif: 'Орбита Земли', sky: '#275c7a', horizon: '#3e6b5d', ink: '#ffffff', accentLight: '#275c7a', accentDark: '#9eb6c3' },
  monitoring: { motif: 'Полярная звезда', sky: '#3e5f78', horizon: '#496373', ink: '#ffffff', accentLight: '#3e5f78', accentDark: '#a8b7c2' },
  economy: { motif: 'Уран', sky: '#286c69', horizon: '#496b56', ink: '#ffffff', accentLight: '#286c69', accentDark: '#a0bfbe' },
  competition: { motif: 'Метеорный поток', sky: '#62507c', horizon: '#905331', ink: '#ffffff', accentLight: '#62507c', accentDark: '#b8b0c4' },
  discipline: { motif: 'Меркурий', sky: '#59515f', horizon: '#715c40', ink: '#ffffff', accentLight: '#59515f', accentDark: '#b4b1b7' },
  quality: { motif: 'Марс', sky: '#613f59', horizon: '#8c4c3f', ink: '#ffffff', accentLight: '#613f59', accentDark: '#b8a9b4' },
  analytics: { motif: 'Туманность', sky: '#514482', horizon: '#665b7e', ink: '#ffffff', accentLight: '#514482', accentDark: '#b1abc7' },
  settings: { motif: 'Луна', sky: '#4d515b', horizon: '#655e54', ink: '#ffffff', accentLight: '#4d515b', accentDark: '#afb1b5' },
};

export function pageTheme(page: Page): PageTheme {
  const family = ['recon', 'trust', 'issues', 'recs', 'journal'].includes(page) ? 'quality' : page;
  return PAGE_THEMES[family as MainPage] ?? PAGE_THEMES.dashboard;
}

/** The same roles drive navigation, shield, calendar and the page context. */
export function pageDawnStyle(page: Page): CSSProperties & Record<string, string> {
  const { sky, horizon, ink, accentLight, accentDark } = pageTheme(page);
  return { '--hdr-sky': sky, '--hdr-horizon': horizon, '--page-sky': sky, '--page-horizon': horizon,
    '--hdr-ink': ink, '--page-accent-light': accentLight, '--page-accent-dark': accentDark };
}
