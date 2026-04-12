import { useEffect } from 'react';
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
