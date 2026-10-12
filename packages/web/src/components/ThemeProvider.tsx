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

const PAGE_DAWN: Partial<Record<Page, readonly [string,string]>> = {
  dashboard:['#5b99f8','#e5d3a9'],report:['#f4c46b','#e6cda7'],svod:['#75bfd4','#e6d4ba'],
  data:['#75bfd4','#e6d4ba'],unfunded:['#efd195','#e5c39c'],yearlong:['#b7b6e2','#ded0bc'],
  monitoring:['#8dcce4','#e1d1b8'],economy:['#a0d8bc','#e5c5a2'],competition:['#a4dccc','#ddd6bc'],
  discipline:['#dfb294','#dfc1a6'],quality:['#de9d8c','#e1b78f'],analytics:['#b8a3e3','#dec4b4'],
  settings:['#b8c4d4','#ded2c2'],
};

/** One approved color family for Header and the page's ambient/chart context.
 * Department identity and semantic data colors keep their own roles. */
export function pageDawnStyle(page: Page): CSSProperties & Record<string,string> {
 const family=['recon','trust','issues','recs','journal'].includes(page)?'quality':page;
 const [sky,horizon]=PAGE_DAWN[family as Page]??PAGE_DAWN.dashboard!;
 return {'--hdr-sky':sky,'--hdr-horizon':horizon,'--page-sky':sky,'--page-horizon':horizon};
}
