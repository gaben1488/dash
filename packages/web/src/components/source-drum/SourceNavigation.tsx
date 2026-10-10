import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { Page } from '../../store';
import navigationHtml from './navigation.html?raw';
import palettes from './palettes.json';
import './source-navigation.css';

/**
 * Original three-row cylinder from pulse.html and the accepted source layout
 * work in PR #70. The markup is deliberately unchanged: only a thin binding
 * to the real page state lives here; production pages remain untouched.
 */
export const SOURCE_NAV_ROUTES: readonly Page[] = [
  'dashboard', 'report', 'svod',
  'data', 'unfunded', 'yearlong', 'monitoring',
  'economy', 'competition', 'discipline',
  'analytics', 'quality', 'settings',
] as const;
const MAX_CENTER = 2;
const MIN_CENTER = 1;
const clamp = (n: number) => Math.max(MIN_CENTER, Math.min(MAX_CENTER, n));
const groups = [
  { name: 'Обзор', pages: [0, 1, 2] },
  { name: 'Реестры', pages: [3, 4, 5, 6] },
  { name: 'Разборы', pages: [7, 8, 9] },
  { name: 'Надзор', pages: [10, 11, 12] },
] as const;

const safeLabels = [
  'Пульс', 'Отчёт', 'Свод', 'Реестр', 'Не обеспеченные', 'В течение года',
  'Мониторинг', 'Экономия', 'Конкуренция', 'Дисциплина',
  'Аналитика', 'Контроль', 'Система',
] as const;

// The original SourceHeader.jsx (PR #70) memoizes the raw navigation DOM.
 // Without this, the live Header's countdown rerender resets innerHTML each
 // second and silently loses checked inputs, classes and data-route.
 const SourceDrumMarkup = memo(forwardRef<HTMLDivElement>(function SourceDrumMarkup(_props, ref) {
   return <div ref={ref} className="баран-навигации" tabIndex={0}
     role="group" aria-label="Барабан разделов"
     dangerouslySetInnerHTML={{__html:navigationHtml}}/>;
 }));

type Props = { activePage: Page; setPage: (page: Page) => void };

export function SourceNavigation({ activePage, setPage }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(setPage);
  const [center, setCenter] = useState(MIN_CENTER);
  const [menuOpen, setMenuOpen] = useState(false);
  latest.current = setPage;
  const move = useCallback((delta: number) => setCenter(i => clamp(i + delta)), []);
  const choose = useCallback((page: Page) => {
    latest.current(page);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const node = host.current?.querySelector<HTMLElement>('.баран-навигации');
    if (!node) return;
    const wheel = (ev: WheelEvent) => {
      if (Math.abs(ev.deltaY) < 1) return;
      ev.preventDefault();
      move(ev.deltaY > 0 ? 1 : -1);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { setMenuOpen(false); return; }
      if (!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(ev.key)) return;
      ev.preventDefault();
      if (ev.key === 'Home') setCenter(MIN_CENTER);
      else if (ev.key === 'End') setCenter(MAX_CENTER);
      else move(['ArrowDown','PageDown'].includes(ev.key) ? 1 : -1);
    };
    const change = (ev: Event) => {
      const input = ev.target;
      if (!(input instanceof HTMLInputElement) || input.name !== 'razdel') return;
      const all = [...node.querySelectorAll<HTMLInputElement>('input[name="razdel"]')];
      const index = all.indexOf(input);
      if (index >= 0 && input.checked) choose(SOURCE_NAV_ROUTES[index]);
    };
    const focus = (ev: FocusEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const row = target.closest('.vkladki-stroka');
      const index = [...node.querySelectorAll('.vkladki-stroka')].indexOf(row!);
      if (index >= 0) setCenter(clamp(index));
    };
    node.addEventListener('wheel',wheel,{passive:false});
    node.addEventListener('keydown',key);
    node.addEventListener('change',change);
    node.addEventListener('focusin',focus);
    return () => {
      node.removeEventListener('wheel',wheel);
      node.removeEventListener('keydown',key);
      node.removeEventListener('change',change);
      node.removeEventListener('focusin',focus);
    };
  }, [choose,move]);

  // One-to-one identity of the source 13 radio inputs and real routes.
  // Never infer route from a truncated display label or demo fixture.
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const inputs = [...node.querySelectorAll<HTMLInputElement>('input[name="razdel"]')];
    if (inputs.length !== SOURCE_NAV_ROUTES.length) {
      throw new Error('Source navigation: source HTML and 13 production routes diverged');
    }
    inputs.forEach((input,i) => {
      input.setAttribute('aria-label',safeLabels[i]);
      input.dataset.route = SOURCE_NAV_ROUTES[i];
      input.checked = SOURCE_NAV_ROUTES[i] === activePage;
      input.setAttribute('aria-current',input.checked?'page':'false');
    });
    const index = SOURCE_NAV_ROUTES.indexOf(activePage);
    const row = groups.findIndex(group => group.pages.includes(index as never));
    if (row >= 0) setCenter(clamp(row));
  }, [activePage]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const rows = [...node.querySelectorAll<HTMLElement>('.vkladki-stroka')];
    if (rows.length !== groups.length) throw new Error('Source navigation requires four original groups');
    rows.forEach((row,i) => {
      row.classList.remove('vkladki-stroka--verh','vkladki-stroka--centr','vkladki-stroka--niz');
      const kind = i === center-1 ? 'verh' : i === center ? 'centr' : i === center+1 ? 'niz' : null;
      if (kind) row.classList.add('vkladki-stroka--'+kind);
      row.setAttribute('aria-hidden',kind?'false':'true');
      row.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.tabIndex=kind?0:-1; });
    });
    const fit = () => {
      const root = host.current;
      const ribbon = root?.querySelector<HTMLElement>('.navig-lenta');
      if (!root || !ribbon) return;
      const items = [...root.querySelectorAll<HTMLElement>('.vkladka-telo')];
      const height = Math.max(27, ...items.map(x => x.offsetHeight+3));
      root.style.setProperty('--navig-rh',height+'px');
      ribbon.style.transform = 'translateY('+(-(center-1)*height)+'px)';
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    node.querySelectorAll('.vkladka-telo').forEach(element=>observer.observe(element));
    return ()=>observer.disconnect();
  },[center]);

  // Preview may switch planetary families. In production the same 39 exact
  // source colors are available; the stored default is the first family.
  useEffect(() => {
    const applyPalette = () => {
      const nav = host.current;
      if (!nav) return;
      const desired = document.documentElement.dataset.previewFamily;
      const family = palettes.find(x=>x.name===desired) ?? palettes[0];
      nav.querySelectorAll<HTMLElement>('.vkladka').forEach((label,i)=>{
        const pair = family.tabs.find(t=>t.name===safeLabels[i]);
        if (!pair) return;
        label.style.setProperty('--z-top',pair.top);
        label.style.setProperty('--z-bottom',pair.bottom);
        label.style.setProperty('--z-ink',pair.ink);
        label.style.setProperty('--ton',pair.top);
      });
    };
    applyPalette();
    const observer = new MutationObserver(applyPalette);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-preview-family']});
    return ()=>observer.disconnect();
  },[]);

  return (
    <div ref={host} className="dash-source-navigation" aria-label="Разделы Dash — оригинальный барабан">
      <SourceDrumMarkup />
      <div className="source-nav-keys" role="group" aria-label="Навигация по группам">
        <button type="button" onClick={()=>move(-1)} title="Предыдущие группы" aria-label="Предыдущие группы"><ChevronUp/></button>
        <button type="button" onClick={()=>setMenuOpen(x=>!x)} aria-expanded={menuOpen}
          aria-label="Все 13 разделов" title="Показать все разделы"><ChevronsUpDown/></button>
        <button type="button" onClick={()=>move(1)} title="Следующие группы" aria-label="Следующие группы"><ChevronDown/></button>
      </div>
      {menuOpen && <div className="source-nav-list" role="group" aria-label="Все разделы Dash">
        {SOURCE_NAV_ROUTES.map((page,i)=><button key={page} type="button"
          aria-current={activePage===page?'page':undefined}
          onClick={()=>choose(page)}>{safeLabels[i]}</button>)}
      </div>}
    </div>
  );
}
