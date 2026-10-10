import { SourceHeader, SourceOrganizations } from './SourceHeader.jsx';
import React, { useEffect, useRef, useState, useReducer } from 'react';
import {
  ShieldCheck,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Search,
  SlidersHorizontal,
  RotateCcw,
  X,
  Check,
  CheckCheck,
  Plus,
  Sun,
  Moon,
  Download,
  FileText,
  Table2,
  Layers,
  Radio,
  MessageSquare,
  StickyNote,
  History,
  Link2,
  ExternalLink,
  Info,
  AlertCircle,
  Clock,
  BookOpen,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  CornerDownRight,
  Settings2,
  Eye,
  ChevronsUpDown,
  MoreHorizontal,
  CalendarDays,
  Filter,
} from 'lucide-react';
import { ROWS, DEPTS, MONTHS, DEFAULT_FILTERS, selectRows, summarize } from './model.mjs';
import { filterSession, initialFilterSession } from './filter-session.mjs';
import { serializeSelectionCsv } from './export-csv.mjs';
import PALETTES from './source-shell/palettes.json';
import PAGE_FILTERS from './source-shell/page-filters.json';
import { AppearancePanel, AxisPanel, LivePanel, UpdateNotice } from './ConsolidationControls.jsx';
import { initialUpdate, updateState } from './shell-model.mjs';
const NAV = [
  ['dashboard', 'Пульс', '#2f7a50', '#1f5236'],
  ['report', 'Отчёт', '#8a6a1f', '#5f470f'],
  ['svod', 'Свод', '#35479b', '#242f6e'],
  ['data', 'Реестр', '#4a6da6', '#324b78'],
  ['unfunded', 'Не обеспеченные', '#71604a', '#4b3f2f'],
  ['yearlong', 'В течение года', '#2e6f7d', '#1e4c57'],
  ['monitoring', 'Мониторинг', '#677585', '#4c5866'],
  ['economy', 'Экономия', '#438177', '#2d5a53'],
  ['competition', 'Конкуренция', '#91582f', '#613819'],
  ['discipline', 'Дисциплина', '#857049', '#5b4c2f'],
  ['analytics', 'Аналитика', '#665ca9', '#46407e'],
  ['quality', 'Контроль', '#883527', '#5a2015'],
  ['settings', 'Система', '#524c47', '#34302c'],
];
const GROUPS = [
  { name: 'Обзор', ids: ['dashboard', 'report', 'svod'] },
  { name: 'Реестры', ids: ['data', 'unfunded', 'yearlong', 'monitoring'] },
  { name: 'Разборы', ids: ['economy', 'competition', 'discipline'] },
  { name: 'Надзор', ids: ['analytics', 'quality', 'settings'] },
];
const num = (n, d = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(n);
const money = (n, unit = 'тыс') =>
  n == null ? 'Нет данных' : num(unit === 'млн' ? n / 1000 : n, unit === 'млн' ? 3 : 1);
const date = (s) => new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const navInfo = (id) => NAV.find((n) => n[0] === id);
function Status({ row }) {
  return (
    <span className={'status ' + (row.issue ? 'warning' : row.status === 'Завершён' ? 'done' : '')}>
      <i />
      {row.status}
    </span>
  );
}
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      old?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton label="Закрыть" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function App() {
  const [page, setPage] = useState('data'),
    [group, setGroup] = useState(1),
    [dark, setDark] = useState(true),
    [selected, setSelected] = useState(null),
    [detailTab, setDetailTab] = useState('overview'),
    [popup, setPopup] = useState(null),
    [toast, setToast] = useState(''),
    [family, setFamily] = useState('Космос'),
    [finish, setFinish] = useState('candy'),
    [motion, setMotion] = useState(true),
    [mode, setMode] = useState('webhook'),
    [density, setDensity] = useState('normal'),
    [replies, setReplies] = useState([]),
    [reply, setReply] = useState(''),
    [closedThreads, setClosedThreads] = useState({}),
    [reportType, setReportType] = useState('Оперативный');
  const [{ filters, unit, week, undo }, dispatchFilterSession] = useReducer(filterSession, undefined, initialFilterSession);
  // Every change from periods, organizations, search, or page controls
  // invalidates stale Undo. Only reset/restore bypass this path.
  const setFilters = (next) => dispatchFilterSession({ type: 'change', next });
  const setUnit = (next) => dispatchFilterSession({ type: 'unit', next });
  const setWeek = (next) => dispatchFilterSession({ type: 'week', next });
  const returnTo = useRef(null),
    closeDetail = useRef(null),
    toastTimer = useRef(null);
  const [update, dispatch] = useReducer(updateState, initialUpdate);
  const source = update.phase;
  const palette = PALETTES.find(p => p.name === family);
  const resolved = Boolean(closedThreads[selected?.id]);
  const current = navInfo(page);
  const pair = palette.tabs.find(t=>t.name===current[1]);
  const accent = { '--planet-top': pair.top, '--planet-bottom': pair.bottom, '--planet-ink': pair.ink };
  const restore = () => dispatchFilterSession({ type: 'restore' });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('tma', dark);
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    if (selected) closeDetail.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape') {
        setPopup(null);
        if (selected) {
          setSelected(null);
          returnTo.current?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [selected]);
  const say = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  };
  const change = (key, value) => {
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === 'dept' ? { org: '', orgs: null, depts: null } : {}),
      ...(key === 'org' ? {orgs:null} : {}),
      ...(key === 'budget' ? {budgets:null} : {}),
      ...(key === 'year' || key === 'month' ? { periods: null } : {}),
    }));
  };
  const go = (id) => {
    setPage(id);
    setSelected(null);
    setPopup(null);
    setGroup(GROUPS.findIndex((g) => g.ids.includes(id)));
  };
  const open = (row, tab = 'overview', element) => {
    returnTo.current = element || document.activeElement;
    setSelected(row);
    setDetailTab(tab);
    setReply('');
  };
  const close = () => {
    setSelected(null);
    setTimeout(() => returnTo.current?.focus({ preventScroll: true }), 0);
  };
  const filterItems = Object.entries(filters)
    .filter(([k, v]) => v !== DEFAULT_FILTERS[k])
    .filter(([, v]) => (v !== false && v !== '' && v !== null) || false);
  if (filters.year === null && !filters.periods) filterItems.push(['year', null]);
  const filterLabel = ([k, v]) =>
    ({
      year: v === null ? 'Все годы' : v,
      dept: v,
      depts: 'Управления: ' + (v?.join?.(', ') || 'нет'),
      org: v,
      orgs: 'Учреждения: ' + (v?.join?.(', ') || 'нет'),
      budgets: 'Бюджеты: ' + (v?.join?.(', ') || 'нет'),
      month: MONTHS[Number(v) - 1],
      periods: 'Выбрано месяцев: ' + (v?.length || 0),
      method: v === 'ЭА' ? 'Конкурентные' : v,
      budget: v,
      search: 'Поиск: ' + v,
      attention: 'Требуют внимания',
      linked: 'С процедурами',
    })[k];
  const capabilities = PAGE_FILTERS[page] || [];
  const effective = {
    ...(capabilities.includes('period') ? {year:filters.year,month:filters.month,periods:filters.periods} : {}),
    ...(capabilities.includes('department') ? {dept:filters.dept,depts:filters.depts} : {}),
    ...(capabilities.includes('subordinate') ? {org:filters.org,orgs:filters.orgs} : {}),
    ...(capabilities.includes('procurement') ? {method:filters.method} : {}),
    ...(capabilities.includes('budget') ? {budget:filters.budget,budgets:filters.budgets} : {}),
    ...(capabilities.includes('search') ? {search:filters.search} : {}),
    attention:filters.attention, linked:filters.linked,
  };
  const base =
    page === 'unfunded'
      ? ROWS.filter((r) => !r.year)
      : page === 'yearlong'
        ? ROWS.filter((r) => r.status === 'В течение года')
        : page === 'monitoring'
          ? ROWS.filter((r) => r.procedure)
          : ROWS;
  const visible = selectRows(base, page === 'unfunded' ? { ...effective, year: null, month:null, periods:null } : effective);
  const sums = summarize(visible),
    orgRows = selectRows(ROWS, { year: filters.year });
  const reset = () => {
    dispatchFilterSession({ type: 'reset' });
    setPopup(null);
  };
  const exportCsv = () => {
    const csv = serializeSelectionCsv(visible);
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Dash-демонстрационный-отбор.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Сохранён демонстрационный отбор');
  };
  const groupStep = (delta) => setGroup((g) => (g + delta + GROUPS.length) % GROUPS.length);
  const refresh = () => {
    dispatch({type:'read'});
    setTimeout(() => dispatch({type:'complete', blocked: Boolean(reply.trim() || selected || popup)}), 1200);
  };
  const showSource = (row) => open(row, 'source');
  function register() {
    return (
      <>
        <div className="table-tools">
          <div className="segment">
            <button
              className={!filters.attention && !filters.linked ? 'active' : ''}
              onClick={() => setFilters((f) => ({ ...f, attention: false, linked: false }))}
            >
              Все записи <span>{selectRows(base, { ...effective, attention: false, linked: false }).length}</span>
            </button>
            <button
              className={filters.attention ? 'active' : ''}
              onClick={() => setFilters((f) => ({ ...f, attention: !f.attention, linked: false }))}
            >
              Требуют внимания{' '}
              <span className="clay">
                {selectRows(base, { ...effective, attention: false, linked: false }).filter((r) => r.issue).length}
              </span>
            </button>
            <button
              className={filters.linked ? 'active' : ''}
              onClick={() => setFilters((f) => ({ ...f, linked: !f.linked, attention: false }))}
            >
              С процедурами
            </button>
          </div>
          <div className="table-actions">
            <label className="search">
              <Search />
              <input
                value={filters.search}
                onChange={(e) => change('search', e.target.value)}
                placeholder="Предмет, номер, процедура"
                aria-label="Поиск закупки"
              />
              {filters.search && (
                <button aria-label="Очистить поиск" onClick={() => change('search', '')}>
                  <X />
                </button>
              )}
            </label>
            <IconButton label="Настроить отбор" onClick={() => setPopup('filters')}>
              <SlidersHorizontal />
            </IconButton>
          </div>
        </div>
        {visible.length ? (
          <div className={'table-scroll ' + (selected ? 'has-selection' : '')}>
            <table className={'registry ' + density}>
              <caption className="sr-only">
                Демонстрационные закупки выбранных организаций и периода, суммы в {unit} рублях
              </caption>
              <thead>
                <tr>
                  <th>№ п/п</th>
                  <th>Предмет закупки</th>
                  <th>Организация</th>
                  <th>Способ</th>
                  <th className="num">План, {unit}. ₽</th>
                  <th className="num optional">Факт, {unit}. ₽</th>
                  <th>Состояние</th>
                  <th className="last-col">
                    <MessageSquare size={15} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className={selected?.id === r.id ? 'selected' : ''}>
                    <td className="row-number">{r.number}</td>
                    <td className="subject">
                      <button
                        onClick={(e) => open(r, 'overview', e.currentTarget)}
                        aria-label={'Открыть закупку № ' + r.number}
                      >
                        <strong>{r.subject}</strong>
                        <span>
                          {r.procedure ? (
                            <>
                              <Link2 size={12} />
                              {r.procedure}
                            </>
                          ) : (
                            <>
                              <CalendarDays size={12} />
                              {r.year ? date(r.date) : 'Период не указан'}
                            </>
                          )}
                          {r.issue && <b className="attention-dot" title={r.issue} />}
                        </span>
                      </button>
                    </td>
                    <td>
                      <strong>{r.dept}</strong>
                      <small>{r.org === r.dept ? '' : r.org}</small>
                    </td>
                    <td>
                      <span className="method">{r.method}</span>
                      <small className={'budget ' + r.budget}>{r.budget}</small>
                    </td>
                    <td className="num">{money(r.plan, unit)}</td>
                    <td className="num optional">
                      {r.fact === null ? <span className="muted">Нет значения</span> : money(r.fact, unit)}
                    </td>
                    <td>
                      <Status row={r} />
                    </td>
                    <td className="last-col">
                      {r.note ? (
                        <button
                          className="comment-count"
                          aria-label={'Обсуждение закупки № ' + r.number}
                          onClick={() => open(r, 'discussion')}
                        >
                          <MessageSquare size={14} />2
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Search />
            <h2>Записей с таким отбором нет</h2>
            <p>Измените условия или вернитесь ко всему демонстрационному набору за 2026 год.</p>
            <button className="primary" onClick={reset}>
              Сбросить отбор
            </button>
          </div>
        )}
        <div className="table-foot">
          <span>Записей в отборе: {visible.length}</span>
          <span>
            План <b>{money(sums.plan, unit)}</b>
          </span>
          <span>
            Известный факт <b>{money(sums.fact, unit)}</b>{' '}
            <small>
              ({visible.filter((r) => r.fact !== null).length}/{visible.length})
            </small>
          </span>
          <span className="unit-note">{unit}. ₽</span>
          <button onClick={() => setPopup('provenance')}>
            <BookOpen size={14} />
            Откуда числа
          </button>
        </div>
      </>
    );
  }
  function quality() {
    const issues = visible.filter((r) => r.issue);
    return (
      <div className="queue">
        <div className="section-intro">
          <h2>Что требует проверки</h2>
          <p>Сначала причина и исходная строка. Решение остаётся за специалистом.</p>
        </div>
        {issues.length ? (
          issues.map((r, i) => (
            <button className="issue-row" key={r.id} onClick={() => open(r, 'source')}>
              <span className="issue-symbol">
                <AlertCircle />
              </span>
              <div>
                <h3>{r.issue}</h3>
                <p>
                  {r.dept} · № {r.number} · {r.subject}
                </p>
                <span>
                  {r.id === 'demo-0'
                    ? 'Две строки плана связаны с одной процедурой. Проверьте состав участников.'
                    : r.ad
                      ? 'Открыть исходные поля и пояснения'
                      : 'Показать исходную строку и основание проверки'}
                </span>
              </div>
              <ArrowUpRight />
            </button>
          ))
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <h2>В этом отборе нет открытых вопросов</h2>
            <p>Показан результат только демонстрационного набора.</p>
          </div>
        )}
        <div className="explanation">
          <Info />
          <div>
            <strong>173, 173/1 и 173/2 — разные номера</strong>
            <p>
              Составные номера сохраняются полностью. Совпадение номера проверяется внутри одной книги; само по себе оно
              не доказывает повтор закупки.
            </p>
          </div>
        </div>
      </div>
    );
  }
  function monitoring() {
    const procedures = [...new Set(visible.map((r) => r.procedure))];
    return (
      <>
        <div className="context-notice">
          <Info size={16} />
          Здесь отбор по управлению. Период плановых строк не ограничивает список процедур.
        </div>
        <div className="procedure-list">
          {procedures.map((code) => {
            const rows = visible.filter((r) => r.procedure === code),
              r = rows[0];
            return (
              <button key={code} className="procedure-row" onClick={() => open(r, 'procedure')}>
                <div className="procedure-code">
                  <Radio size={18} />
                  <strong>{code}</strong>
                </div>
                <div>
                  <h3>{r.subject}</h3>
                  <p>
                    {[...new Set(rows.map((r) => r.dept))].join(', ')} · Связанные строки:{' '}
                    {rows.map((r) => r.number).join(', ')}
                  </p>
                </div>
                <Status row={r} />
                <span className="num">
                  <small className="procedure-total-label">План связанных строк</small>
                  {money(summarize(rows).plan, unit)} <small>{unit}. ₽</small>
                </span>
                <ChevronRight />
              </button>
            );
          })}
        </div>
      </>
    );
  }
  function analysis() {
    const aggregate = DEPTS.map((dept) => ({
      dept,
      rows: visible.filter((r) => r.dept === dept),
      ...summarize(visible.filter((r) => r.dept === dept)),
    })).filter((r) => r.count);
    const mode =
      page === 'economy' ? 'saving' : page === 'competition' ? 'competitive' : page === 'discipline' ? 'dates' : 'plan';
    return (
      <>
        <div className="analysis-heading">
          <div>
            <h2>
              {page === 'economy'
                ? 'Экономия, учтённая в реестре'
                : page === 'competition'
                  ? 'Способы закупок по управлениям'
                  : page === 'discipline'
                    ? 'Рабочая очередь сроков'
                    : page === 'svod'
                      ? 'Свод по управлениям'
                      : 'Состав выбранных закупок'}
            </h2>
            <p>
              {page === 'economy'
                ? 'Сумма Z + AA + AB по строкам с отметкой AD «да».'
                : page === 'competition'
                  ? 'Количество закупок. Конкурентные способы и единственный поставщик показаны отдельно; фильтр способа здесь не применяется.'
                  : page === 'discipline'
                    ? 'Плановые даты и фактическое состояние. Будущая дата не считается просрочкой.'
                    : 'Каждая сумма раскрывается до строк выбранного набора.'}
            </p>
          </div>
          <button className="secondary" onClick={() => setPopup('provenance')}>
            <BookOpen />
            Основание расчёта
          </button>
        </div>
        <div className="analysis-table">
          <div className="analysis-labels">
            <span>Управление</span>
            <span>
              {mode === 'competitive'
                ? 'Способы'
                : mode === 'dates'
                  ? 'Первая дата в отборе'
                  : 'Сумма, ' + unit + '. ₽'}
            </span>
            <span>Записей</span>
            <span />
          </div>
          {aggregate.map((a) => (
            <button
              key={a.dept}
              className="analysis-row"
              onClick={() => {
                change('dept', a.dept);
                go('data');
              }}
            >
              <strong>{a.dept}</strong>
              <div className="measure">
                {mode === 'competitive' ? (
                  <>
                    <span>
                      Конкурентные <b>{a.rows.filter((r) => r.method === 'ЭА').length}</b>
                    </span>
                    <span>
                      ЕП <b>{a.rows.filter((r) => r.method === 'ЕП').length}</b>
                    </span>
                  </>
                ) : mode === 'dates' ? (
                  <span>{date([...a.rows].sort((a, b) => a.date.localeCompare(b.date))[0].date)}</span>
                ) : (
                  <>
                    <div className="bar-track">
                      <i style={{ width: (a[mode] / Math.max(...aggregate.map((x) => x[mode]), 1)) * 100 + '%' }} />
                    </div>
                    <b>{money(a[mode], unit)}</b>
                  </>
                )}
              </div>
              <span>{a.count}</span>
              <ArrowUpRight />
            </button>
          ))}
        </div>
        <div className="analysis-total">
          <span>Итого по выбранным строкам</span>
          <strong>{mode === 'saving' ? money(sums.saving, unit) + ' ' + unit + '. ₽' : sums.count + ' записей'}</strong>
        </div>
        {page === 'economy' && (
          <div className="explanation">
            <Info />
            <div>
              <strong>Экономия имеет своё основание</strong>
              <p>План минус факт не подменяет экономию. Строки с экономией без отметки можно проверить в Контроле.</p>
              <button className="text-button" onClick={() => go('quality')}>
                Открыть Контроль <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }
  function report() {
    return (
      <div className="report-layout">
        <div className="report-options">
          <h2>Виды отчёта</h2>
          {['Основной', 'Дополнительный', 'Оперативный'].map((t) => (
            <button className={reportType === t ? 'active' : ''} key={t} onClick={() => setReportType(t)}>
              <FileText />
              {t}
              <ChevronRight />
            </button>
          ))}
          <p>Предварительный вид на демонстрационных данных.</p>
          <button
            className="secondary"
            onClick={() =>
              say('В продукте здесь будет выгрузка принятого выпуска Word. Этот макет не подключён к генератору.')
            }
          >
            <Download />
            Выгрузка Word
          </button>
        </div>
        <article className="report-paper">
          <span className="report-date">Елизовский муниципальный округ · 9 октября 2026</span>
          <h2>
            {reportType === 'Оперативный'
              ? 'Оперативная информация о закупках'
              : reportType === 'Основной'
                ? 'Сведения о закупках'
                : 'Вопросы, требующие внимания'}
          </h2>
          <p className="document-subtitle">
            {filters.dept || 'Все управления'} · {filters.year || 'Все годы'} · Демонстрационный набор
          </p>
          <h3>Состояние выбранных закупок</h3>
          <p>
            В отбор вошло {sums.count} записей. Плановая сумма — {money(sums.plan)} тыс. рублей, известная сумма
            договоров — {money(sums.fact)} тыс. рублей ({visible.filter((r) => r.fact !== null).length} из{' '}
            {visible.length} строк).
          </p>
          <h3>Что проверить</h3>
          {visible
            .filter((r) => r.issue)
            .map((r) => (
              <button className="report-finding" onClick={() => open(r, 'source')} key={r.id}>
                <span>
                  {r.dept} · № {r.number}
                </span>
                <strong>{r.issue}</strong>
                <ArrowUpRight />
              </button>
            ))}
          <footer>Формирование официальных Word-документов остаётся в существующем генераторе.</footer>
        </article>
      </div>
    );
  }
  function settings() {
    return (
      <div className="settings">
        <section>
          <h2>Рабочий вид</h2>
          <label>
            <span>
              <strong>Светлая тема</strong>
              <small>Тёплая бумага и те же цвета разделов</small>
            </span>
            <input type="checkbox" checked={!dark} onChange={(e) => setDark(!e.target.checked)} />
          </label>
          <label>
            <span>
              <strong>Компактные строки</strong>
              <small>Больше записей на экране</small>
            </span>
            <input
              type="checkbox"
              checked={density === 'compact'}
              onChange={(e) => setDensity(e.target.checked ? 'compact' : 'normal')}
            />
          </label>
        </section>
        <section>
          <h2>Состояния для просмотра</h2>
          <p>Здесь можно посмотреть, как интерфейс сообщает об обновлении и потере связи.</p>
          <div className="state-options">
            {[
              ['ready', 'Срез доступен'],
              ['reading', 'Чтение источников'],
              ['failed', 'Ошибка чтения'],
            ].map(([v, l]) => (
              <button className={source === v ? 'active' : ''} key={v} onClick={() => dispatch({type:v==='ready'?'reset':v==='reading'?'read':'fail'})}>
                {l}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>Об этом макете</h2>
          <p>
            18 вымышленных записей показывают отбор, связи, происхождение чисел и два вида комментариев. Изменения
            остаются в памяти страницы. Подключения к книгам и записи в рабочие данные нет.
          </p>
        </section>
      </div>
    );
  }
  return (
    <div className="app" style={accent} data-finish={finish} data-motion={motion ? "live" : "still"}>
      <a className="skip-link" href="#workspace">
        К содержимому
      </a>
      <SourceHeader
        {...{
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
          palette, reset, undo, restore, mode,
        }}
      />
      <div className={"source-workspace " + (!capabilities.includes('department') || page === 'report' ? 'without-organizations' : '')}>
        <SourceOrganizations {...{ filters, change, setFilters, setPopup, page }} />
        <main id="workspace">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">
                Закупки <ChevronRight size={12} /> {GROUPS.find((g) => g.ids.includes(page))?.name}
              </div>
              <h1>{page === 'data' ? 'Реестр закупок' : current[1]}</h1>
              <p>
                {page === 'data'
                  ? 'От плана до процедуры. Каждая сумма ведёт к источнику.'
                  : page === 'quality'
                    ? 'Основания, исходные строки и решения по замечаниям.'
                    : page === 'monitoring'
                      ? 'Процедуры и их связи с закупками управлений.'
                      : page === 'unfunded'
                        ? 'Закупки, для которых финансирование ещё не определено.'
                        : page === 'yearlong'
                          ? 'Повторяющиеся закупки и исполнение в течение года.'
                          : page === 'dashboard'
                            ? 'Страница Пульса остаётся в текущем продукте.'
                            : 'Выбранный период и организации сохраняются при переходах.'}
              </p>
            </div>
            <div className="heading-actions">
              {!['settings', 'dashboard'].includes(page) && (
                <button className="secondary" onClick={exportCsv}>
                  <Download size={16} />
                  Сохранить отбор
                </button>
              )}
              <button className="primary" onClick={() => setPopup('provenance')}>
                <BookOpen size={16} />
                Источники
              </button>
            </div>
          </div>
          {week !== 41 ? (
            <div className="empty standalone">
              <CalendarDays />
              <h2>{week > 41 ? 'Неделя ещё не наступила' : 'Для этой недели нет демонстрационного среза'}</h2>
              <p>Числа другой недели не подставляются вместо отсутствующего снимка.</p>
              <button className="primary" onClick={() => setWeek(41)}>
                Вернуться к 9–16 октября
              </button>
            </div>
          ) : (
            <div className={'work-layout ' + (selected ? 'detail-open' : '')}>
              <section className="work-surface" aria-label={current[1]}>
                {['data', 'unfunded', 'yearlong'].includes(page) ? (
                  register()
                ) : page === 'quality' ? (
                  quality()
                ) : page === 'monitoring' ? (
                  monitoring()
                ) : page === 'report' ? (
                  report()
                ) : page === 'settings' ? (
                  settings()
                ) : page === 'dashboard' ? (
                  <div className="empty">
                    <ShieldCheck />
                    <h2>Пульс не входит в эту переделку</h2>
                    <p>В макете показана общая оболочка. Содержание Пульса сохраняется в действующем приложении.</p>
                    <button className="primary" onClick={() => go('data')}>
                      Открыть Реестр
                    </button>
                  </div>
                ) : (
                  analysis()
                )}
              </section>
              {selected && (
                <aside className="detail-pane" aria-label="Карточка закупки">
                  <div className="detail-heading">
                    <button className="text-button" onClick={close} ref={closeDetail}>
                      <ArrowLeft size={15} />К отбору
                    </button>
                    <IconButton label="Закрыть карточку" onClick={close}>
                      <X />
                    </IconButton>
                  </div>
                  <div className="detail-title">
                    <span className="detail-id">
                      {selected.dept} <span>·</span> № {selected.number}
                    </span>
                    <h2>{selected.subject}</h2>
                    <p>{selected.org}</p>
                    <Status row={selected} />
                  </div>
                  <div className="detail-tabs">
                    {[
                      ['overview', 'Закупка'],
                      ['source', 'Источник'],
                      ['discussion', 'Обсуждение'],
                      ['history', 'История'],
                    ].map(([id, label]) => (
                      <button className={detailTab === id ? 'active' : ''} key={id} onClick={() => setDetailTab(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="detail-content">
                    {['overview', 'procedure'].includes(detailTab) && (
                      <>
                        <div className="amount-pair">
                          <div>
                            <span>План</span>
                            <strong>
                              {money(selected.plan, unit)}
                              <small>{unit}. ₽</small>
                            </strong>
                          </div>
                          <div>
                            <span>Факт</span>
                            <strong>
                              {selected.fact === null ? 'Нет значения' : money(selected.fact, unit)}
                              {selected.fact !== null && <small>{unit}. ₽</small>}
                            </strong>
                          </div>
                        </div>
                        {selected.issue && (
                          <div className="detail-alert">
                            <AlertCircle size={17} />
                            <div>
                              <strong>{selected.issue}</strong>
                              <button onClick={() => setDetailTab('source')}>
                                Посмотреть основание <ArrowRight size={13} />
                              </button>
                            </div>
                          </div>
                        )}
                        <dl className="facts">
                          <div>
                            <dt>Способ</dt>
                            <dd>{selected.method === 'ЭА' ? 'Электронный аукцион' : 'Единственный поставщик'}</dd>
                          </div>
                          <div>
                            <dt>Бюджет</dt>
                            <dd>
                              {selected.budget === 'КБ'
                                ? 'Краевой бюджет'
                                : selected.budget === 'ФБ'
                                  ? 'Федеральный бюджет'
                                  : 'Местный бюджет'}
                            </dd>
                          </div>
                          <div>
                            <dt>Плановая дата</dt>
                            <dd>{selected.year ? date(selected.date) + ' ' + selected.year : 'Не определена'}</dd>
                          </div>
                          <div>
                            <dt>Экономия в своде</dt>
                            <dd>
                              {selected.ad
                                ? money(selected.saving, unit) + ' ' + unit + '. ₽'
                                : selected.saving
                                  ? 'Не учтена: нет отметки AD'
                                  : 'Не учитывается'}
                            </dd>
                          </div>
                        </dl>
                        <section className="detail-section">
                          <h3>Связанные процедуры</h3>
                          {selected.procedure ? (
                            <button className="linked-procedure" onClick={() => setDetailTab('procedure')}>
                              <Radio />
                              <span>
                                <strong>{selected.procedure}</strong>
                                <small>
                                  Строк плана: {ROWS.filter((r) => r.procedure === selected.procedure).length} ·{' '}
                                  {selected.status.toLowerCase()}
                                </small>
                              </span>
                              <ChevronRight />
                            </button>
                          ) : (
                            <p className="muted">Связь с процедурой пока не установлена.</p>
                          )}
                          {detailTab === 'procedure' && (
                            <div className="linked-rows">
                              {ROWS.filter((r) => r.procedure === selected.procedure && r.procedure).map((r) => (
                                <button key={r.id} onClick={() => open(r, 'overview')}>
                                  <CornerDownRight size={14} />№ {r.number}
                                  <span>{r.subject}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                        <section className="detail-section">
                          <h3>
                            Примечание ячейки <StickyNote size={14} />
                          </h3>
                          <p>{selected.note || 'В демонстрационном примере примечания нет.'}</p>
                          {selected.note && (
                            <small className="muted">
                              Ячейка G{selected.sheetRow} · книга {selected.dept}
                            </small>
                          )}
                        </section>
                        <button className="source-link" onClick={() => setDetailTab('source')}>
                          <BookOpen />
                          Формула, значение и исходная строка
                          <ArrowUpRight />
                        </button>
                      </>
                    )}
                    {detailTab === 'source' && (
                      <>
                        <div className="source-address">
                          <BookOpen />
                          <div>
                            <strong>Книга {selected.dept} · рабочий лист</strong>
                            <small>Строка {selected.sheetRow} в демонстрационном срезе</small>
                          </div>
                        </div>
                        <h3>Плановая сумма</h3>
                        <div className="cell-value">
                          <span>Рассчитанное значение</span>
                          <strong>
                            {money(selected.plan)} <small>тыс. ₽</small>
                          </strong>
                          <code>K{selected.sheetRow}</code>
                        </div>
                        <div className="formula">
                          <span>Формула в ячейке</span>
                          <code>
                            =SUM(H{selected.sheetRow}:J{selected.sheetRow})
                          </code>
                        </div>
                        <div className="source-grid">
                          <span>Федеральный · H{selected.sheetRow}</span>
                          <b>{selected.budget === 'ФБ' ? money(selected.plan) : '0'}</b>
                          <span>Краевой · I{selected.sheetRow}</span>
                          <b>{selected.budget === 'КБ' ? money(selected.plan) : '0'}</b>
                          <span>Местный · J{selected.sheetRow}</span>
                          <b>{selected.budget === 'МБ' ? money(selected.plan) : '0'}</b>
                        </div>
                        <p className="small-note">
                          Это пример ячейки с суммой бюджетов. Значение графы K в других книгах может отличаться.
                        </p>
                        <section className="detail-section">
                          <h3>Как учтена экономия</h3>
                          <p>
                            Z + AA + AB: <strong>{money(selected.saving)} тыс. ₽</strong>
                            <br />
                            Отметка AD: <strong>{selected.ad ? 'да' : 'не заполнена'}</strong>
                          </p>
                          <p>
                            {selected.ad
                              ? 'Сумма входит в показатель экономии.'
                              : 'В итог экономии эта строка не включена.'}
                          </p>
                        </section>
                        <section className="detail-section">
                          <h3>Примечание к G{selected.sheetRow}</h3>
                          <p>{selected.note || 'Примечание не задано.'}</p>
                        </section>
                        <section className="detail-section">
                          <h3>Замечания в столбцах AF / AG / AH</h3>
                          <p className="muted">
                            В этом примере поля не заполнены. Они сохраняются отдельно от примечания ячейки и
                            обсуждения.
                          </p>
                        </section>
                      </>
                    )}
                    {detailTab === 'discussion' && (
                      <>
                        <div className="discussion-status">
                          <span className={resolved ? 'status done' : 'status'}>
                            {resolved ? <CheckCheck size={14} /> : <MessageSquare size={14} />}{' '}
                            {resolved ? 'Обсуждение закрыто' : 'Открытое обсуждение'}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => setClosedThreads((v) => ({ ...v, [selected.id]: !resolved }))}
                          >
                            {resolved ? 'Открыть снова' : 'Закрыть'}
                          </button>
                        </div>
                        <div className="thread">
                          <div className="message-head">
                            <strong>Специалист управления</strong>
                            <time>9 октября, 09:20</time>
                          </div>
                          <p>
                            Проверим состав закупки перед следующим совещанием. Подтвердите, пожалуйста, связь с
                            процедурой.
                          </p>
                          <blockquote>{selected.subject}</blockquote>
                          <div className="reply-item">
                            <div className="message-head">
                              <strong>УЭР</strong>
                              <time>9 октября, 10:05</time>
                            </div>
                            <p>Открыл исходную строку. Нужны состав участников и распределение суммы.</p>
                          </div>
                          {replies
                            .filter((r) => r.id === selected.id)
                            .map((r, i) => (
                              <div className="reply-item" key={i}>
                                <div className="message-head">
                                  <strong>Вы</strong>
                                  <time>В этом макете</time>
                                </div>
                                <p>{r.text}</p>
                              </div>
                            ))}
                        </div>
                        {!resolved && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!reply.trim()) return;
                              setReplies((r) => [...r, { id: selected.id, text: reply.trim() }]);
                              setReply('');
                              say('Ответ добавлен только в макет');
                            }}
                          >
                            <label className="reply-label" htmlFor="reply">
                              Ваш ответ
                            </label>
                            <textarea
                              id="reply"
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                              placeholder="Напишите уточнение…"
                            />
                            <small className="muted">Ответ сохранится только в этом макете.</small>
                            <button className="primary reply-submit" disabled={!reply.trim()}>
                              Добавить ответ <ArrowUpRight size={15} />
                            </button>
                          </form>
                        )}
                        <div className="small-note">
                          <Info size={14} />
                          Связь обсуждения с этой закупкой показана как пример. В продукте она должна подтверждаться
                          источником.
                        </div>
                      </>
                    )}
                    {detailTab === 'history' && (
                      <div className="timeline">
                        <div>
                          <span className="timeline-dot" />
                          <time>9 октября · 10:05</time>
                          <h3>Добавлено уточнение УЭР</h3>
                          <p>Обсуждение связано с закупкой.</p>
                        </div>
                        <div>
                          <span className="timeline-dot" />
                          <time>9 октября · 09:18</time>
                          <h3>Прочитана исходная книга</h3>
                          <p>Формула и вычисленное значение сохранены для просмотра.</p>
                        </div>
                        <div>
                          <span className="timeline-dot" />
                          <time>Предыдущая версия</time>
                          <h3>В макете не загружена</h3>
                          <p>Изменение суммы не вычисляется без второго подтверждённого значения.</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="detail-footer">
                    <BookOpen size={13} />
                    Демонстрационная запись · изменения локальные
                  </div>
                </aside>
              )}
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={13} />
              Елизовский муниципальный округ
            </span>
            <span>Суммы: {unit}. ₽ · 9 октября 2026</span>
            <button onClick={() => go('settings')}>
              О макете <Info size={13} />
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      <UpdateNotice {...{update,dispatch,refresh}} hasDraft={Boolean(reply.trim())}/>
      {popup && (
        <Modal
          title={
            {
              sections: 'Разделы ДЭШ',
              filters: 'Текущий отбор',
              provenance: 'Откуда числа',
              updates: 'История и источники',
              organizations: 'Организации',
              appearance: 'Заря, палитры и материалы',
            }[popup]
          }
          onClose={() => setPopup(null)}
        >
          {popup === 'appearance' && <AppearancePanel {...{family, setFamily, finish, setFinish, motion, setMotion}}/>}
          {popup === 'sections' && (
            <div className="section-picker">
              {GROUPS.map((g) => (
                <section key={g.name}>
                  <h3>{g.name}</h3>
                  {g.ids.map((id) => {
                    const n = navInfo(id);
                    return (
                      <button key={id} onClick={() => go(id)}>
                        <i style={{ background: n[2] }} />
                        <span>{n[1]}</span>
                        {page === id ? <Check size={16} /> : <ChevronRight size={15} />}
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
          {popup === 'filters' && (
            <div className="filter-dialog">
              <AxisPanel {...{filters,unit,week}}/>
              <p>Условия ограничивают закупки. Единицы меняют только отображение сумм.</p>
              <div className="current-filters">
                {filterItems.length ? (
                  filterItems.map((item) => (
                    <button key={item[0]} onClick={() => change(item[0], DEFAULT_FILTERS[item[0]])}>
                      {filterLabel(item)}
                      <X size={13} />
                    </button>
                  ))
                ) : (
                  <span>Все управления · весь 2026 год</span>
                )}
              </div>
              <div className="filter-fields">
                <label>
                  Год
                  <select
                    value={filters.year || ''}
                    onChange={(e) => change('year', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Все годы</option>
                    {[2025, 2026, 2027].map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Управление
                  <select value={filters.dept} onChange={(e) => change('dept', e.target.value)}>
                    <option value="">Все управления</option>
                    {DEPTS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Способ
                  <select value={filters.method} onChange={(e) => change('method', e.target.value)}>
                    <option value="">Все способы</option>
                    <option value="ЭА">Конкурентные (ЭА в примере)</option>
                    <option value="ЕП">Единственный поставщик</option>
                  </select>
                </label>
                <label>
                  Бюджет
                  <select value={filters.budget} onChange={(e) => change('budget', e.target.value)}>
                    <option value="">Все бюджеты</option>
                    {['ФБ', 'КБ', 'МБ'].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="unit-setting">
                <span>Показывать суммы</span>
                <div className="segment">
                  {['тыс', 'млн'].map((u) => (
                    <button className={unit === u ? 'active' : ''} key={u} onClick={() => setUnit(u)}>
                      {u}. ₽
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button className="secondary" onClick={reset}>
                  <RotateCcw size={15} />
                  Сбросить отбор
                </button>
                <button className="primary" onClick={() => setPopup(null)}>
                  Показать записи <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
          {popup === 'provenance' && (
            <div className="provenance-dialog">
              <div className="context-notice">
                <Info size={17} />В этом макете используются 18 вымышленных записей. Это не показатели рабочего ДЭШ.
              </div>
              <h3>Что попало в выбранный срез</h3>
              <dl className="facts">
                <div>
                  <dt>Период</dt>
                  <dd>{filters.year || 'Все годы'}</dd>
                </div>
                <div>
                  <dt>Организации</dt>
                  <dd>{filters.dept || 'Все управления'}</dd>
                </div>
                <div>
                  <dt>Записей в отборе</dt>
                  <dd>{visible.length}</dd>
                </div>
                <div>
                  <dt>План</dt>
                  <dd>{money(sums.plan)} тыс. ₽</dd>
                </div>
              </dl>
              <h3>Как можно проверить число</h3>
              <p>
                Откройте закупку и вкладку «Источник»: там отдельно показаны значение, формула, исходные ячейки и
                примечание.
              </p>
              <button
                className="primary"
                disabled={!visible.length}
                onClick={() => {
                  setPopup(null);
                  showSource(visible[0]);
                }}
              >
                Открыть пример источника <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {popup === 'updates' && <LivePanel {...{update,dispatch,refresh,mode,setMode}} row={ROWS[0]} onOpen={(row,tab)=>{setPopup(null);setPage('data');open(row,tab);}}/>}
          {popup === 'organizations' && (
            <div className="organization-picker">
              {DEPTS.map((d) => (
                <section key={d}>
                  <button
                    onClick={() => {
                      change('dept', d);
                      setPopup(null);
                    }}
                  >
                    <Layers size={16} />
                    <strong>{d}</strong>
                    <span>{ROWS.filter((r) => r.dept === d).length} записей в примере</span>
                    <ChevronRight size={16} />
                  </button>
                  {[...new Set(ROWS.filter((r) => r.dept === d).map((r) => r.org))].map((o) => (
                    <button
                      className="organization-child"
                      key={o}
                      onClick={() => {
                        setFilters((f) => ({ ...f, dept: d, org: o }));
                                            setPopup(null);
                      }}
                    >
                      <CornerDownRight size={13} />
                      {o}
                      {filters.org === o && <Check size={13} />}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
