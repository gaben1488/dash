import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Sun, Moon, X, History, Palette, Radio, RotateCcw } from 'lucide-react';
import navigationHtml from './source-shell/navigation.html?raw';
import shieldHtml from './source-shell/shield.html?raw';
import { MONTHS, ROWS, DEPTS } from './model.mjs';
import './source-shell/original.css';
import './source-shell/organizations.css';
import { selectionAxes, weekWindow } from './shell-model.mjs';
import PAGE_FILTERS from './source-shell/page-filters.json';
const ids = [
  'dashboard',
  'report',
  'svod',
  'data',
  'unfunded',
  'yearlong',
  'monitoring',
  'economy',
  'competition',
  'discipline',
  'analytics',
  'quality',
  'settings',
];
// The source fragment owns its DOM. Filter renders must not reset drum positions.
const OriginalNavigation = React.memo(
  React.forwardRef(function OriginalNavigation(_, ref) {
    return (
      <div
        ref={ref}
        className="баран-навигации"
        tabIndex={0}
        role="group"
        aria-label="Барабан навигации"
        dangerouslySetInnerHTML={{ __html: navigationHtml }}
      />
    );
  }),
);
const years = [2025, 2026, 2027];
const monthKeys = (y) => MONTHS.map((_, i) => `${y}-${i + 1}`);
const currentPeriods = (f) =>
  f.periods ??
  years
    .filter((y) => !f.year || f.year === y)
    .flatMap((y) => monthKeys(y).filter((_, i) => !f.month || f.month === i + 1));

export function SourceHeader({
  page,
  go,
  filters,
  setFilters,
  change,
  unit,
  setUnit,
  dark,
  setDark,
  week,
  setWeek,
  source,
  refresh,
  filterItems,
  setPopup,
  palette,
  mode,
  reset,
  undo,
  restore,
}) {
  const nav = useRef(null),
    weeksRef = useRef(null),
    latest = useRef(null),
    [center, setCenter] = useState(1);
  latest.current = { page, go };
  useEffect(() => {
    const el = nav.current;
    const move = (d) => setCenter((c) => Math.max(1, Math.min(2, c + d)));
    const wheel = (e) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      move(e.deltaY > 0 ? 1 : -1);
    };
    const key = (e) => {
      if (['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Home') setCenter(1);
        else if (e.key === 'End') setCenter(2);
        else move(['ArrowDown', 'PageDown'].includes(e.key) ? 1 : -1);
      }
    };
    const select = (e) => {
      if (e.target.matches('input[name=razdel]')) {
        const index = [...el.querySelectorAll('input[name=razdel]')].indexOf(e.target);
        latest.current.go(ids[index]);
      }
    };
    const focus = (e) => {
      const rows = [...el.querySelectorAll('.vkladki-stroka')],
        i = rows.indexOf(e.target.closest('.vkladki-stroka'));
      if (i >= 0) setCenter(Math.max(1, Math.min(2, i)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('keydown', key);
    el.addEventListener('change', select);
    el.addEventListener('focusin', focus);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('keydown', key);
      el.removeEventListener('change', select);
      el.removeEventListener('focusin', focus);
    };
  }, []);
  useEffect(() => {
    const inputs = [...nav.current.querySelectorAll('input[name=razdel]')];
    inputs.forEach((input, i) => {
      input.checked = ids[i] === page;
      input.setAttribute('aria-label', input.closest('label').querySelector('.vkladka-telo>span').textContent);
    });
    const selected = inputs[ids.indexOf(page)];
    const rows = [...nav.current.querySelectorAll('.vkladki-stroka')];
    setCenter(Math.max(1, Math.min(2, rows.indexOf(selected.closest('.vkladki-stroka')))));
  }, [page]);
  useEffect(() => {
    const rows = [...nav.current.querySelectorAll('.vkladki-stroka')];
    rows.forEach((row, i) => {
      row.classList.remove('vkladki-stroka--verh', 'vkladki-stroka--centr', 'vkladki-stroka--niz');
      const position = i === center - 1 ? 'verh' : i === center ? 'centr' : i === center + 1 ? 'niz' : null;
      if (position) row.classList.add('vkladki-stroka--' + position);
      row.setAttribute('aria-hidden', String(!position));
      row.querySelectorAll('input').forEach((input) => (input.tabIndex = position ? 0 : -1));
    });
    const fit = () => {
      const height = Math.max(26, ...[...nav.current.querySelectorAll('.vkladka-telo')].map(e => e.offsetHeight + 3));
      nav.current.style.setProperty('--navig-rh', `${height}px`);
      nav.current.querySelector('.navig-lenta').style.transform = `translateY(${-(center - 1) * height}px)`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    nav.current.querySelectorAll('.vkladka-telo').forEach(e => observer.observe(e));
    return () => observer.disconnect();
  }, [center]);
  useEffect(() => {
    const labels = [...nav.current.querySelectorAll('.vkladka')];
    labels.forEach((label, i) => {
      const title = label.querySelector('.vkladka-telo>span').textContent;
      const pair = palette.tabs.find(t => t.name === title);
      if (!pair) return;
      label.style.setProperty('--z-top', pair.top);
      label.style.setProperty('--z-bottom', pair.bottom);
      label.style.setProperty('--z-ink', pair.ink);
      label.style.setProperty('--ton', pair.top);
      label.setAttribute('data-world', pair.image);
    });
  }, [palette]);
  useEffect(() => {
    const el = weeksRef.current;
    const wheel = e => { e.preventDefault(); setWeek(w => Math.max(1, Math.min(53, w + (e.deltaY > 0 ? 1 : -1)))); };
    el.addEventListener('wheel', wheel, {passive:false});
    return () => el.removeEventListener('wheel', wheel);
  }, [setWeek]);
  const axes = selectionAxes(filters, unit, week);
  const selectedAxes = axes.filter(a => a.active);
  const capabilities = PAGE_FILTERS[page] || [];
  const periods = currentPeriods(filters);
  const togglePeriods = (keys) => {
    const next = new Set(periods);
    const remove = keys.every((k) => next.has(k));
    keys.forEach((k) => (remove ? next.delete(k) : next.add(k)));
    setFilters((f) => ({ ...f, year: null, month: null, periods: [...next] }));
  };
  const weekStep = (d) => setWeek((w) => Math.max(1, Math.min(53, w + d)));
  return (
    <header className="верх source-shell">
      <div className="верх-щит">
        <button
          className={'shield ' + (source === 'reading' ? 'shield-goryachiy' : '')}
          style={{ '--shield-tone': 'var(--planet-top)' }}
          aria-label="Проиграть обновление источников"
          onClick={refresh}
          dangerouslySetInnerHTML={{ __html: shieldHtml }}
        />
      </div>
      <div className="верх-навигация">
        <OriginalNavigation ref={nav} />
        <div className="navigation-keys">
          <button aria-label="Предыдущие группы" onClick={() => setCenter(1)}>
            <ChevronUp />
          </button>
          <button aria-label="Все разделы" onClick={() => setPopup('sections')}>
            <ChevronsUpDown />
          </button>
          <button aria-label="Следующие группы" onClick={() => setCenter(2)}>
            <ChevronDown />
          </button>
        </div>
      </div>
      <div className="верх-период" hidden={!capabilities.includes('period')}>
        <div className="baraban">
          <div className="baraban-gody" role="group" aria-label="Годы, кварталы и месяцы">
            <button
              className="baraban-sbros"
              title="Весь 2026 год"
              aria-label="Вернуть весь 2026 год"
              onClick={() => setFilters((f) => ({ ...f, year: 2026, month: null, periods: null }))}
            >
              <X />
            </button>
            {years.map((y, yi) => (
              <div key={y} className={'god-ryad ' + ['god-ryad-verh', 'god-ryad-fokus', 'god-ryad-niz'][yi]}>
                <button
                  className="god"
                  aria-label={'Выбрать весь ' + y + ' год'}
                  aria-pressed={monthKeys(y).every(k=>periods.includes(k)) ? true : monthKeys(y).some(k=>periods.includes(k)) ? 'mixed' : false}
                  onClick={() => togglePeriods(monthKeys(y))}
                >
                  {y}
                </button>
                {[0, 1, 2, 3].map((q) => (
                  <div className="kvartal" key={q} title={`${q + 1} квартал ${y}`}>
                    <button
                      className="kvartal-yarlyk"
                      aria-label={`${q + 1} квартал ${y}`}
                      aria-pressed={monthKeys(y).slice(q*3,q*3+3).every(k=>periods.includes(k)) ? true : monthKeys(y).slice(q*3,q*3+3).some(k=>periods.includes(k)) ? 'mixed' : false}
                      onClick={() => togglePeriods(monthKeys(y).slice(q * 3, q * 3 + 3))}
                    >
                      {q + 1}кв
                    </button>
                    {MONTHS.slice(q * 3, q * 3 + 3).map((m, i) => {
                      const month = q * 3 + i + 1,
                        key = `${y}-${month}`,
                        available = ROWS.some((r) => r.year === y && r.month === month);
                      return (
                        <label
                          key={key}
                          className={'mesyats ' + (!available ? 'no-demo-period' : '')}
                          title={`${m} ${y}${available ? ' · есть пример' : ' · примера данных нет'}`}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${m} ${y}`}
                            checked={periods.includes(key)}
                            onChange={() => togglePeriods([key])}
                          />
                          <span>{m}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="верх-недели">
        <div
          className="baraban-nedeli"
          ref={weeksRef}
          tabIndex={0}
          role="group"
          aria-label="Недельный срез"
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              weekStep(e.key === 'ArrowUp' ? -1 : 1);
            }
          }}
        >
          {[week - 1, week, week + 1].map((w, i) => (
            <button
              key={w}
              disabled={w < 1 || w > 53}
              className={'nedelya ' + (i === 1 ? 'nedelya-tekushchaya' : 'nedelya-kray')}
              onClick={() => setWeek(w)}
              aria-label={`Неделя ${w}, ${weekWindow(w).label}${w === 41 ? ' · текущая, демонстрация' : w > 41 ? ' · ещё не наступила' : ' · примера среза нет'}`}
            >
              <span className="nedelya-nomer">{w}</span>
              <span className="nedelya-podpis">
                <span className="nedelya-dni">
                  {weekWindow(w).days}
                </span>
                <span className="nedelya-mesyats">{weekWindow(w).month}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="верх-эфир">
        <button className="lv source-live" onClick={() => setPopup('updates')} aria-label="Эфир: изменения, комментарии и источники">
          <span className="live-passport"><Radio size={12}/><b>{source === 'reading' ? 'Чтение' : source === 'failed' ? 'Ошибка чтения' : source === 'waiting' ? 'Готовы новые данные' : source === 'seen' ? 'Правка получена' : mode === 'webhook' ? 'По вебхуку' : mode === 'schedule' ? 'По расписанию' : 'Режим неизвестен'}</b><span>Демо</span></span>
          <span className="lv-tape">
            <i className="lv-lens" />
            {[
              ['09:18', 'УО', source === 'seen' ? 'Правка замечена' : source === 'reading' ? 'Читаем книгу' : 'Связь с процедурой'],
              ['09:16', 'УДТХ', 'Без изменений'],
              ['09:14', 'УО', 'Открыт вопрос'],
            ].map((r, i) => (
              <span className={'lv-row ' + ['lv-row--top', 'lv-row--mid', 'lv-row--bot'][i]} key={r[0]}>
                <span className="t">{r[0]}</span><span className="b">{r[1]}</span><span className="w">{r[2]}</span>
              </span>
            ))}
          </span>
        </button>
      </div>
      <div className="верх-угол">
        <button className={'прибор ' + (!selectedAxes.length ? 'тихий' : '')}
          aria-label={'Отбор, осей: ' + selectedAxes.length} onClick={() => setPopup('filters')}>
          <span className="сетка-б" aria-hidden="true">
            {axes.map(a => <i key={a.key} data-axis={a.key} data-kind={a.kind} className={a.active ? 'горит' : ''} title={a.name} />)}
          </span>
          {selectedAxes.length > 0 && <span className="счёт">{selectedAxes.length}</span>}
        </button>
        <button className="corner-reset" aria-label={undo ? 'Вернуть отбор' : 'Сбросить отбор'} disabled={!selectedAxes.length && !undo && !filterItems.length} onClick={undo ? restore : reset}><RotateCcw /></button>
        <button className="кнопка-темы" aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />}</button>
        <button className="corner-appearance" aria-label="Палитры и отделки" onClick={() => setPopup('appearance')}><Palette /></button>
      </div>
      <div className="верх-разрезы">
        {capabilities.includes('procurement') && <div className="разрез-группа">
          <span className="разрез-имя">способ</span>
          {[
            ['ЭА', 'КП'],
            ['ЕП', 'ЕП'],
            ['', 'ВСЕ'],
          ].map(([v, t]) => (
            <button
              className="разрез-кн"
              key={t}
              aria-pressed={filters.method === v}
              onClick={() => change('method', v)}
            >
              {t}
            </button>
          ))}
        </div>}
        {capabilities.includes('budget') && <div className="разрез-группа">
          <span className="разрез-имя">бюджет</span>
          {['ФБ', 'КБ', 'МБ'].map((v) => (
            <button
              className="разрез-кн"
              key={v}
              aria-pressed={(filters.budgets ?? (filters.budget ? [filters.budget] : [])).includes(v)}
              onClick={() => { const old = filters.budgets ?? (filters.budget ? [filters.budget] : []); const next = old.includes(v) ? old.filter(x=>x!==v) : [...old,v]; setFilters(f=>({...f,budget:'',budgets:next.length ? next : null})); }}
            >
              {v}
            </button>
          ))}
        </div>}
        {capabilities.includes('currency') && <div className="разрез-группа">
          <span className="разрез-имя">единицы</span>
          {['тыс', 'млн'].map((v) => (
            <button className="разрез-кн" key={v} aria-pressed={unit === v} onClick={() => setUnit(v)}>
              {v}
            </button>
          ))}
        </div>}
        {capabilities.includes('period') && <button
          className="разрез-кн"
          aria-pressed={!filters.year && !filters.periods}
          onClick={() => setFilters((f) => ({ ...f, year: null, month: null, periods: null }))}
        >
          Все годы
        </button>}
        <span className="source-demo-label">Макет · вымышленные данные</span>
      </div>
    </header>
  );
}
const orgColors = ['#d6bf85','#a78bfa','#06b6d4','#f59e0b','#10b981','#ef4444','#ec4899','#84cc16'];
const isOwn = name => !name.includes('· пример');
export function SourceOrganizations({ filters, setFilters, page }) {
  const capabilities = PAGE_FILTERS[page] || [];
  if (!capabilities.includes('department') || page === 'report') return null;
  const all = !filters.dept && filters.depts == null && !filters.org && filters.orgs == null;
  const chosen = filters.depts ?? (filters.dept ? [filters.dept] : []);
  const selectedOrgs = filters.orgs ?? (filters.org ? [filters.org] : []);
  const orgsFor = d => [...new Set(ROWS.filter(r=>r.dept===d).map(r=>r.org))];
  const chooseDept = d => {
    const next = chosen.includes(d) ? chosen.filter(x=>x!==d) : [...chosen,d];
    setFilters(f=>({...f,dept:'',depts:next.length ? next : null,org:'',orgs:null}));
  };
  const chooseOrg = o => {
    const next = selectedOrgs.includes(o) ? selectedOrgs.filter(x=>x!==o) : [...selectedOrgs,o];
    setFilters(f=>({...f,dept:'',depts:null,org:'',orgs:next.length ? next : null}));
  };
  return (
    <aside className="ob-strip source-organizations" aria-label="Управления и учреждения">
      <button className={'ob-vse '+(all?'ob-vse-active':'')} aria-pressed={all} onClick={()=>setFilters(f=>({...f,dept:'',depts:null,org:'',orgs:null}))}>
        <span className="ob-vse-dot"/><span className="ob-vse-label">Все организации</span>
      </button>
      <div className="ob-scroll">
      {DEPTS.map((d,i) => {
        const organizations = orgsFor(d), subs = organizations.filter(o=>!isOwn(o)), own = organizations.filter(isOwn);
        const active = all || chosen.includes(d) || organizations.some(o=>selectedOrgs.includes(o));
        return <section className="ob-dept" data-active={active || undefined} key={d}>
          <button className={'ob-dept-btn '+(active?'ob-dept-active':'')} aria-label={d+' с подведомственными'} aria-pressed={chosen.includes(d)} onClick={()=>chooseDept(d)}>
            <span className="ob-dept-bar" style={{background:orgColors[i]}}/><span className="ob-dept-name">{d}</span>
            <span className="ob-dept-num" title="Организаций в демонстрационном наборе">{organizations.length}</span>
          </button>
          {subs.length>0 && capabilities.includes('subordinate') && <>
            {own.length>0 && <button className={'ob-dept-only '+(own.every(o=>selectedOrgs.includes(o))?'ob-dept-only-active':'')} aria-pressed={own.every(o=>selectedOrgs.includes(o))} onClick={()=>setFilters(f=>({...f,dept:'',depts:null,org:'',orgs:own}))}>только управление</button>}
            <div className="ob-chips">{subs.map(o=><button key={o} className={'ob-chip '+((all || chosen.includes(d) || selectedOrgs.includes(o))?'ob-chip-active':'')} aria-pressed={selectedOrgs.includes(o)} onClick={()=>chooseOrg(o)} title={o}>{o.replace(' · пример','')}</button>)}</div>
          </>}
        </section>;
      })}
      </div>
      <p className="org-count-note">Числа — организации в демонаборе</p>
    </aside>
  );
}
