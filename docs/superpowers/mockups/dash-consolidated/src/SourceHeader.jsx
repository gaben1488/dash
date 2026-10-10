import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Sun, Moon, X, History } from 'lucide-react';
import navigationHtml from './source-shell/navigation.html?raw';
import shieldHtml from './source-shell/shield.html?raw';
import { MONTHS, ROWS, DEPTS } from './model.mjs';
import './source-shell/original.css';
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
}) {
  const nav = useRef(null),
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
    nav.current.querySelector('.navig-lenta').style.transform = `translateY(${-(center - 1) * rows[0].offsetHeight}px)`;
  }, [center]);
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
          style={{ '--shield-tone': 'var(--tone-reestr)' }}
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
      <div className="верх-период">
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
                  onClick={() => togglePeriods(monthKeys(y))}
                >
                  {y}
                </button>
                {[0, 1, 2, 3].map((q) => (
                  <div className="kvartal" key={q} title={`${q + 1} квартал ${y}`}>
                    <button
                      className="kvartal-yarlyk"
                      aria-label={`${q + 1} квартал ${y}`}
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
              aria-label={`Неделя ${w}${w === 41 ? ' · демонстрационный срез' : ' · примера среза нет'}`}
            >
              <span className="nedelya-nomer">{w}</span>
              <span className="nedelya-podpis">
                <span className="nedelya-dni">
                  {w === 40 ? '28–4' : w === 41 ? '5–11' : w === 42 ? '12–18' : 'Неделя'}
                </span>
                <span className="nedelya-mesyats">{w >= 40 && w <= 44 ? 'октября' : 'срез'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="верх-эфир">
        <button className="lv source-live" onClick={() => setPopup('updates')} aria-label="История и источники">
          <span className="lv-state">
            <span className="lv-state-row">
              <i className="lv-dot" />
              <b className="lv-state-t">
                {source === 'reading' ? 'чтение' : source === 'offline' ? 'нет связи' : 'срез'}
              </b>
            </span>
            <span className="lv-state-n">9 октября</span>
          </span>
          <span className="lv-tape">
            <i className="lv-lens" />
            {[
              ['09:18', 'УО', 'Связь с процедурой'],
              ['09:16', 'УДТХ', 'Без изменений'],
              ['09:14', 'УО', 'Открыт вопрос'],
            ].map((r, i) => (
              <span className={'lv-row ' + ['lv-row--top', 'lv-row--mid', 'lv-row--bot'][i]} key={r[0]}>
                <span className="t">{r[0]}</span>
                <span className="b">{r[1]}</span>
                <span className="w">{r[2]}</span>
              </span>
            ))}
          </span>
        </button>
      </div>
      <div className="верх-угол">
        <button
          className="кнопка-темы"
          aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun /> : <Moon />}
        </button>
        <button
          className={'прибор ' + (!filterItems.length ? 'тихий' : '')}
          aria-label={'Отбор, условий: ' + filterItems.length}
          onClick={() => setPopup('filters')}
        >
          <span className="сетка-б" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} className={i < filterItems.length ? 'горит' : ''} />
            ))}
          </span>
          <span className="счёт">{filterItems.length}</span>
        </button>
      </div>
      <div className="верх-разрезы">
        <div className="разрез-группа">
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
        </div>
        <div className="разрез-группа">
          <span className="разрез-имя">бюджет</span>
          {['ФБ', 'КБ', 'МБ'].map((v) => (
            <button
              className="разрез-кн"
              key={v}
              aria-pressed={filters.budget === v}
              onClick={() => change('budget', filters.budget === v ? '' : v)}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="разрез-группа">
          <span className="разрез-имя">единицы</span>
          {['тыс', 'млн'].map((v) => (
            <button className="разрез-кн" key={v} aria-pressed={unit === v} onClick={() => setUnit(v)}>
              {v}
            </button>
          ))}
        </div>
        <button
          className="разрез-кн"
          aria-pressed={!filters.year && !filters.periods}
          onClick={() => setFilters((f) => ({ ...f, year: null, month: null, periods: null }))}
        >
          Все годы
        </button>
        <span className="source-demo-label">Макет · вымышленные данные</span>
      </div>
    </header>
  );
}
const orgColors = ['uer', 'uio', 'uagzo', 'ufbp', 'ud', 'udtx', 'uksimp', 'uo'];
export function SourceOrganizations({ filters, change, setFilters, setPopup }) {
  const [expanded, setExpanded] = useState(null);
  const chosen = filters.depts ?? (filters.dept ? [filters.dept] : DEPTS);
  const toggle = (d) => {
    const next = chosen.includes(d) ? chosen.filter((x) => x !== d) : [...chosen, d];
    setFilters((f) => ({ ...f, dept: '', depts: next.length === DEPTS.length ? null : next, org: '' }));
  };
  return (
    <aside className="source-organizations source-shell" aria-label="Управления и учреждения">
      <div className="organizations-top">
        <strong>Организации</strong>
        <button onClick={() => change('dept', '')}>Все</button>
      </div>
      {DEPTS.map((d, i) => (
        <section className="upravlenie" key={d} style={{ '--org-ton': `var(--org-${orgColors[i]})` }}>
          <div className="source-org-heading">
            <label className="upravlenie-plashka">
              <input aria-label={d} type="checkbox" checked={chosen.includes(d)} onChange={() => toggle(d)} />
              <span className="upravlenie-polosa" />
              <span className="upravlenie-imya">{d}</span>
              <span className="upravlenie-schet">{ROWS.filter((r) => r.dept === d).length}</span>
            </label>
            <button
              className="org-unfold"
              aria-label={'Учреждения ' + d}
              aria-expanded={expanded === d}
              onClick={() => setExpanded(expanded === d ? null : d)}
            >
              <ChevronDown />
            </button>
          </div>
          {expanded === d && (
            <div className="podvedy">
              {[...new Set(ROWS.filter((r) => r.dept === d).map((r) => r.org))].map((o) => (
                <label className="podved" key={o}>
                  <input
                    type="checkbox"
                    checked={filters.org === o}
                    onChange={() =>
                      setFilters((f) => ({ ...f, dept: d, depts: null, org: filters.org === o ? '' : o }))
                    }
                  />
                  {o}
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      <button className="organizations-all" onClick={() => setPopup('organizations')}>
        Все учреждения <ChevronDown size={13} />
      </button>
      <p>Количество записей в демонстрационном наборе</p>
    </aside>
  );
}
