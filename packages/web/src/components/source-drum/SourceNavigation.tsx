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

const wrapGroup = (index: number) => (index + groups.length) % groups.length;
const groupForPage = (page: Page) => {
  const index = SOURCE_NAV_ROUTES.indexOf(page);
  return groups.findIndex(group => (group.pages as readonly number[]).includes(index));
};

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
  // The four original source rows are the only interactive DOM. Rotating the
  // existing nodes, rather than cloning radios, preserves all 13 route identities.
  const rowsRef = useRef<HTMLElement[]>([]);
  const centerRef = useRef(1);
  const animationRef = useRef<Animation | null>(null);
  const queuedRef = useRef(0);
  const ignoreFocusRef = useRef(false);
  const [center, setCenter] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  latest.current = setPage;

  const preserveFocus = useCallback((ribbon: HTMLElement, reorder: () => void) => {
    const focused = document.activeElement;
    const inside = focused instanceof HTMLElement && ribbon.contains(focused);
    reorder();
    if (inside && focused instanceof HTMLElement) {
      ignoreFocusRef.current = true;
      focused.focus({ preventScroll: true });
      ignoreFocusRef.current = false;
    }
  }, []);

  const syncRows = useCallback(() => {
    const ribbon = host.current?.querySelector<HTMLElement>('.navig-lenta');
    if (!ribbon) return;
    const kinds = ['verh', 'centr', 'niz'] as const;
    [...ribbon.children].forEach((element, position) => {
      const row = element as HTMLElement;
      row.classList.remove('vkladki-stroka--verh', 'vkladki-stroka--centr', 'vkladki-stroka--niz');
      const kind = kinds[position];
      if (kind) row.classList.add('vkladki-stroka--' + kind);
      row.setAttribute('aria-hidden', kind ? 'false' : 'true');
      row.querySelectorAll<HTMLInputElement>('input[name="razdel"]').forEach(input => {
        input.tabIndex = kind ? 0 : -1;
      });
    });
    // A keyboard-focused radio must not end up inside a hidden row after a turn.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && ribbon.contains(focused)
      && focused.closest('.vkladki-stroka')?.getAttribute('aria-hidden') === 'true') {
      ignoreFocusRef.current = true;
      host.current?.querySelector<HTMLElement>('.баран-навигации')?.focus({ preventScroll: true });
      ignoreFocusRef.current = false;
    }
  }, []);

  const align = useCallback((target: number) => {
    const ribbon = host.current?.querySelector<HTMLElement>('.navig-lenta');
    if (!ribbon || rowsRef.current.length !== groups.length || target < 0) return;
    // A route activated in the entering row already has an animation underway.
    if (centerRef.current === target && animationRef.current) return;
    if (centerRef.current === target && ribbon.children[1] === rowsRef.current[target]) {
      syncRows();
      return;
    }
    animationRef.current?.cancel();
    animationRef.current = null;
    queuedRef.current = 0;
    preserveFocus(ribbon, () => {
      ribbon.append(...Array.from({ length: groups.length }, (_, i) =>
        rowsRef.current[wrapGroup(target - 1 + i)]!));
    });
    centerRef.current = target;
    syncRows();
    setCenter(target);
  }, [preserveFocus, syncRows]);

  const move = useCallback((delta: number) => {
    const direction = Math.sign(delta);
    if (!direction) return;
    // Coalesce a burst of trackpad events while a turn is in flight.
    if (animationRef.current) {
      queuedRef.current = direction;
      return;
    }
    const ribbon = host.current?.querySelector<HTMLElement>('.navig-lenta');
    if (!ribbon || rowsRef.current.length !== groups.length) return;
    const target = wrapGroup(centerRef.current + direction);
    centerRef.current = target;

    // Resting order always has prev / centre / next / one spare. The spare
    // travels in from above or below; a completed turn rotates the real nodes.
    if (direction < 0) preserveFocus(ribbon, () => ribbon.prepend(ribbon.lastElementChild!));
    const entering = (direction > 0 ? ribbon.lastElementChild : ribbon.firstElementChild) as HTMLElement | null;
    entering?.classList.add(direction > 0 ? 'vkladki-stroka--niz' : 'vkladki-stroka--verh');
    entering?.setAttribute('aria-hidden', 'false');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || typeof ribbon.animate !== 'function') {
      if (direction > 0) preserveFocus(ribbon, () => ribbon.append(ribbon.firstElementChild!));
      syncRows();
      setCenter(target);
      return;
    }

    const height = Number.parseFloat(getComputedStyle(host.current!).getPropertyValue('--navig-rh')) || 27;
    const offset = 'translateY(-' + height + 'px)';
    const animation = ribbon.animate(
      direction > 0
        ? [{ transform: 'translateY(0)' }, { transform: offset }]
        : [{ transform: offset }, { transform: 'translateY(0)' }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    animationRef.current = animation;
    void animation.finished.then(() => {
      if (animationRef.current !== animation) return;
      if (direction > 0) preserveFocus(ribbon, () => ribbon.append(ribbon.firstElementChild!));
      animation.cancel();
      animationRef.current = null;
      syncRows();
      setCenter(target);
      const queued = queuedRef.current;
      queuedRef.current = 0;
      if (queued) move(queued);
    }).catch(() => {
      if (animationRef.current === animation) {
        animationRef.current = null;
        align(target);
      }
    });
  }, [align, preserveFocus, syncRows]);

  const choose = useCallback((page: Page) => {
    const target = groupForPage(page);
    if (target >= 0 && target !== centerRef.current) {
      const distance = wrapGroup(target - centerRef.current);
      if (distance === 1) move(1);
      else if (distance === groups.length - 1) move(-1);
      else align(target);
    }
    latest.current(page);
    setMenuOpen(false);
  }, [align, move]);

  useLayoutEffect(() => {
    const node = host.current;
    const ribbon = node?.querySelector<HTMLElement>('.navig-lenta');
    if (!node || !ribbon) return;
    const rows = [...ribbon.children] as HTMLElement[];
    if (rows.length !== groups.length) throw new Error('Source navigation requires four original groups');
    // Keep the original order in a stable mapping despite physical DOM rotation.
    if (rows.every(row => row.dataset.groupIndex !== undefined)) {
      rows.sort((a, b) => Number(a.dataset.groupIndex) - Number(b.dataset.groupIndex));
    }
    const inputs = rows.flatMap(row => [...row.querySelectorAll<HTMLInputElement>('input[name="razdel"]')]);
    if (inputs.length !== SOURCE_NAV_ROUTES.length) {
      throw new Error('Source navigation: source HTML and 13 production routes diverged');
    }
    rows.forEach((row, i) => { row.dataset.groupIndex = String(i); });
    inputs.forEach((input, i) => {
      input.setAttribute('aria-label', safeLabels[i]);
      input.dataset.route = SOURCE_NAV_ROUTES[i];
    });
    rowsRef.current = rows;
    const fit = () => {
      const items = [...node.querySelectorAll<HTMLElement>('.vkladka-telo')];
      const height = Math.max(27, ...items.map(item => item.offsetHeight + 3));
      node.style.setProperty('--navig-rh', height + 'px');
    };
    fit();
    syncRows();
    if (typeof ResizeObserver === 'undefined') return () => {
      animationRef.current?.cancel();
      animationRef.current = null;
      rowsRef.current = [];
    };
    const observer = new ResizeObserver(fit);
    node.querySelectorAll('.vkladka-telo').forEach(item => observer.observe(item));
    return () => {
      observer.disconnect();
      animationRef.current?.cancel();
      animationRef.current = null;
      rowsRef.current = [];
    };
  }, [syncRows]);

  useLayoutEffect(() => {
    const inputs = host.current?.querySelectorAll<HTMLInputElement>('input[name="razdel"]');
    if (!inputs) return;
    inputs.forEach(input => {
      const isActive = input.dataset.route === activePage;
      input.checked = isActive;
      input.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    align(groupForPage(activePage));
  }, [activePage, align]);

  useEffect(() => {
    const node = host.current?.querySelector<HTMLElement>('.баран-навигации');
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 1) return;
      event.preventDefault();
      move(event.deltaY > 0 ? 1 : -1);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); return; }
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') align(0);
      else if (event.key === 'End') align(groups.length - 1);
      else move(['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1);
    };
    const change = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.name !== 'razdel') return;
      const route = input.dataset.route as Page | undefined;
      if (route && SOURCE_NAV_ROUTES.includes(route)) choose(route);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('keydown', key);
    node.addEventListener('change', change);
    return () => {
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('keydown', key);
      node.removeEventListener('change', change);
    };
  }, [align, choose, move]);

  // Bind original radio identities to their actual route, never to DOM order:
  // row rotation must not swap pages or planetary palette colors.
  useEffect(() => {
    const applyPalette = () => {
      const nav = host.current;
      if (!nav) return;
      const desired = document.documentElement.dataset.previewFamily;
      const family = palettes.find(item => item.name === desired) ?? palettes[0];
      nav.querySelectorAll<HTMLElement>('.vkladka').forEach(label => {
        const route = label.querySelector<HTMLInputElement>('input[name="razdel"]')?.dataset.route as Page | undefined;
        const index = route ? SOURCE_NAV_ROUTES.indexOf(route) : -1;
        const pair = family.tabs.find(tab => tab.name === safeLabels[index]);
        if (!pair) return;
        label.style.setProperty('--z-top', pair.top);
        label.style.setProperty('--z-bottom', pair.bottom);
        label.style.setProperty('--z-ink', pair.ink);
        label.style.setProperty('--ton', pair.top);
      });
    };
    applyPalette();
    const observer = new MutationObserver(applyPalette);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-preview-family'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host} className="dash-source-navigation" aria-label="Разделы Dash — оригинальный барабан">
      <SourceDrumMarkup />
      <span className="sr-only" aria-live="polite" aria-atomic="true">Группа: {groups[center]?.name}</span>
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
