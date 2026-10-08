/**
 * Таблица реестра — форма листа книги колонка в колонку (спека §2.1).
 *
 * ДВУХЭТАЖНАЯ ШАПКА — НЕ УКРАШЕНИЕ. В книге над колонками J…N стоит
 * объединённая подпись «Экономия, руб.», и МБ/КБ/ФБ под ней — доли ЭКОНОМИИ,
 * а не НМЦК. Первая версия вкладки прочла эту шапку плоско и показала
 * разбивку как разбивку начальной цены. Надшапка здесь возвращена ровно
 * затем, чтобы ту же ошибку нельзя было сделать глазами.
 *
 * ЧТО ПОКАЗАНО ИНАЧЕ, ЧЕМ В КНИГЕ, И ПОЧЕМУ:
 *  · колонка C разложена на код (моноширинный бейдж со способом) и предмет —
 *    код нужен для связи с книгой управления, предмет для чтения;
 *  · колонка A показана вместе с номером строки листа: в УО нумерация 1…27
 *    идёт дважды, и ссылка «№ 12» без номера строки неоднозначна;
 *  · колонка K из слова «верно/ошибка» превращена в точку с объяснением —
 *    красным красится только то, что краснеет в самой книге;
 *  · добавлена колонка снижения: книга его не хранит, а вопрос «на сколько
 *    упала цена» задают о каждой строке.
 *
 * ДЛИННЫЙ РЕЕСТР ПОКАЗЫВАЕТСЯ ЧАСТЯМИ. Триста семьдесят строк с раскрытиями
 * — это тысячи узлов разметки, и на слабой машине такая таблица заметно
 * подтормаживает при отборе. Показывается первая порция, а под таблицей
 * стоит честная строка «показано 200 из 374» с кнопкой. Это не сокрытие
 * данных: число сказано, кнопка рядом.
 *
 * ДВЕ ГАРМОШКИ ДЕРЖАТ ТАБЛИЦУ В ЭКРАНЕ (п.128-3, п.128-4). Четыре колонки дат
 * по умолчанию сложены в одну колонку «Сроки» с длительностью пути «заявка →
 * торги»; разбивка экономии МБ/КБ/ФБ сложена под «ВСЕГО + проверка». Обе
 * раскрываются кнопкой в шапке колонки, выбор запоминается в localStorage.
 * Сложенное не потеряно: полный набор дат и разбивка видны в карточке строки,
 * а длительность в свёрнутой ячейке носит все четыре даты в подсказке.
 * Контейнер сохраняет свой внутренний скролл на случай узкого окна — страница
 * горизонтально не едет никогда.
 *
 * НА УЗКОМ ЭКРАНЕ (§6.3) таблица заменяется списком карточек — той же
 * строкой, разложенной в столбик. Горизонтально едет только таблица внутри
 * своего контейнера; корпус страницы стоит.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  JournalRow, LineageChain, RegistryProcedure,
} from '../../lib/monitoring/contract';
import type { MatchIndex } from '../../lib/monitoring/match-rows';
import type { SortDir, SortKey } from '../../lib/monitoring/slices';
import { procedureDefects } from '../../lib/monitoring/slices';
import { KBTooltip } from '../ui/kb-tooltip';
import { MONITORING_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import { fmtCount, fmtDate, fmtDays, fmtPct, fmtRub, pluralCount, procedureCodeLabel } from '../../lib/monitoring/format';
import { methodLabel, stageBadgeClass, stageMeaning, stageShort } from '../../lib/monitoring/stage-labels';
import { ProcedureCard } from './ProcedureCard';
import { MonitoringPerimeterCaption } from './PerimeterProvider';
import { CARD, CONTROL, RULE_COL, RULE_COL_HEAD, RULE_HEAD, RULE_ROW } from './surfaces';

/** Сколько строк показывается сразу; остальное — по кнопке. */
const CHUNK = 200;
interface TableColumn { key: string; label: string; sortKey?: SortKey; group?: 'dates' | 'result' | 'savings'; right?: boolean; cell: (p: RegistryProcedure) => ReactNode }
const COLUMNS_PREF_KEY = 'aemr.monitoring.hidden-columns.v1';
const OPTIONAL_COLUMNS = ['dept', 'protocol', 'comment', 'result', 'ancestors', 'successors', 'fullAction', 'quality'];

/**
 * Ключи памяти гармошек (п.128-4). Версия в ключе — чтобы смена смысла
 * значения не читала старую запись как новую.
 */
const DATES_PREF_KEY = 'aemr.monitoring.dates-open.v1';
const BUDGETS_PREF_KEY = 'aemr.monitoring.budgets-open.v1';

/** Чтение флага из localStorage; хранилища нет (тест, приватный режим) — свёрнуто. */
function loadPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function savePref(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Хранилище недоступно — гармошка живёт до перезагрузки, это не ошибка.
  }
}

/** Кнопка гармошки в шапке колонки: свёрнуто ▸, раскрыто ▾. */
function FoldButton({ open, onToggle, labelOpen, labelClosed }: {
  open: boolean;
  onToggle: () => void;
  labelOpen: string;
  labelClosed: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-0.5 font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
    >
      {open
        ? <ChevronDown size={10} aria-hidden="true" />
        : <ChevronRight size={10} aria-hidden="true" />}
      {open ? labelOpen : labelClosed}
    </button>
  );
}

/**
 * Свёрнутая колонка «Сроки»: длительность пути «заявка → торги», а все четыре
 * даты — в подсказке. Пути нет (крайней даты не хватает) — честный прочерк с
 * объяснением, не ноль.
 */
function DatesFoldedCell({ p }: { p: RegistryProcedure }) {
  const detail = [
    `заявка: ${fmtDate(p.applicationDate)}`,
    `публикация: ${fmtDate(p.publicationDate)}`,
    `окончание подачи: ${fmtDate(p.deadlineDate)}`,
    `торги: ${fmtDate(p.auctionDate)}`,
  ].join(' · ');
  if (p.durations.total === null) {
    return (
      <span
        className="text-zinc-500 dark:text-zinc-400"
        title={`Путь не измерить: одной из крайних дат в книге нет. ${detail}`}
      >
        —
      </span>
    );
  }
  const negative = p.durations.total < 0;
  return (
    <span
      className={`tabular-nums ${negative ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}
      title={`Путь «заявка → торги». ${detail}${negative ? '. Отрицательная длительность: вторая дата раньше первой — так записано в книге' : ''}`}
    >
      {fmtDays(p.durations.total)}
    </span>
  );
}

function SortButton({
  label, sortKey, active, dir, onSort, align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Сортировать по колонке «${label}»`}
      className={`inline-flex items-center gap-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      {label}
      <span aria-hidden="true" className={active ? 'opacity-100' : 'opacity-0'}>
        {dir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  );
}

/** Точка контроля книги: красным — только то, что краснеет в книге. */
function ControlDot({ p }: { p: RegistryProcedure }) {
  const said = p.selfCheck?.toLowerCase() ?? null;
  if (said === null) {
    return <span className="text-zinc-300 dark:text-zinc-600" title="Колонка проверки в книге пуста">·</span>;
  }
  const bad = said.startsWith('ошиб');
  return (
    <span
      className={bad ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
      title={bad
        ? `Книга пишет «${p.selfCheck}»: экономия не расписана по бюджетам${p.controlGapRub !== null ? `, разрыв ${fmtRub(p.controlGapRub)} руб.` : ''}`
        : `Книга пишет «${p.selfCheck}»: ВСЕГО сходится с суммой МБ, КБ и ФБ`}
    >
      ●
      <span className="sr-only">{p.selfCheck}</span>
    </span>
  );
}

function CodeCell({ p }: { p: RegistryProcedure }) {
  if (p.code === null) {
    // Два честных случая вместо одного «без кода» (скриншот владельца
    // 20.08.2026: метка говорила «без кода», хотя код в ячейке виден —
    // он набран с опечаткой). Диагноз приезжает готовой фразой из ядра.
    const distorted = p.codeNote !== null && p.codeNote.includes('похоже на');
    return (
      <span
        className="text-amber-600 dark:text-amber-400"
        title={(p.codeNote ?? 'В начале предмета номера процедуры не видно.')
          + ' Пока код не исправлен в книге, связь с книгами управлений по этой строке не строится; сверка по догадке не идёт.'}
      >
        {distorted ? 'код с опечаткой' : 'без кода'}
      </span>
    );
  }
  return (
    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-100" title={methodLabel(p.method)}>
      {procedureCodeLabel(p)}
    </span>
  );
}

export interface RegistryTableProps {
  rows: readonly RegistryProcedure[];
  compact?: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  /** Родословная по коду процедуры — приходит с листа «25-26». */
  lineageByCode?: ReadonlyMap<string, LineageChain>;
  journalByCode?: ReadonlyMap<string, JournalRow>;
  /**
   * Сверка со строкой книги управления. Указатель и его СОСТОЯНИЕ идут
   * вместе: без состояния отсутствие пары в карточке читается одинаково и при
   * неподнятой сверке, и при непрочитанных книгах управлений, и при честно не
   * найденной строке — три разные новости под одной фразой (п.36).
   */
  matchIndex?: MatchIndex | null;
  /** Момент чтения книги словами — вторая половина требования п.58. */
  readAtLabel?: string;
  /** Откуда строки: листы управлений либо назван срез шапки. */
  sourceLabel?: string;
  onOpenCode?: (code: string) => void;
  onOpenProcedure?: (p: RegistryProcedure) => void;
  bookUrl?: string | null;
  /** Код, чья карточка должна быть раскрыта извне (переход по родословной). */
  openCode?: string | null;
  /**
   * Снять внешнее раскрытие. Без этого карточка, открытая переходом по
   * родословной, не закрывалась кликом вовсе: `isOpen` держался на `openCode`,
   * а клик менял только местное состояние строки.
   */
  onCloseOpenCode?: () => void;
}

export function RegistryTable({
  rows, sortKey, sortDir, onSort, compact = false,
  lineageByCode, journalByCode, matchIndex, readAtLabel, sourceLabel,
  onOpenCode, openCode = null, onCloseOpenCode, onOpenProcedure, bookUrl,
}: RegistryTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const chunk = compact ? 50 : CHUNK;
  const [limit, setLimit] = useState(chunk);
  const [compactView, setCompactView] = useState(() => {
    try {
      const saved = localStorage.getItem('monitoring:compact');
      return saved === null ? compact: saved === 'true';
    } catch {
      return compact;
    }
  });
  const [datesOpen, setDatesOpen] = useState(() => loadPref(DATES_PREF_KEY));
  const [budgetsOpen, setBudgetsOpen] = useState(() => loadPref(BUDGETS_PREF_KEY));

  const toggleDates = (): void => {
    setDatesOpen((v) => { savePref(DATES_PREF_KEY, !v); return !v; });
  };
  const toggleBudgets = (): void => {
    setBudgetsOpen((v) => { savePref(BUDGETS_PREF_KEY, !v); return !v; });
  };

  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try { const stored: unknown = JSON.parse(localStorage.getItem(COLUMNS_PREF_KEY) ?? JSON.stringify(OPTIONAL_COLUMNS));
      return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string' && v !== 'code') : [];
    } catch { return [...OPTIONAL_COLUMNS]; }
  });
  const visible = (key: string) => !hiddenColumns.includes(key);
  const saveColumns = (keys: string[]) => {
    setHiddenColumns(keys);
    try { localStorage.setItem(COLUMNS_PREF_KEY, JSON.stringify(keys)); } catch { /* Session preference remains usable. */ }
  };

  const idOf = (p: RegistryProcedure): string => `${p.sheet}:${p.row}`;
  const shown = rows.slice(0, limit);
  const isOpen = (p: RegistryProcedure): boolean =>
    expanded === idOf(p) || (openCode !== null && p.code === openCode);

  /**
   * Закрыть карточку, открытую ИЗВНЕ (переход по родословной). Раньше клик
   * по такой строке менял только `expanded`, а `isOpen` держался на `openCode`
   * — карточка не закрывалась ничем, кроме смены разрезов. Управление, которое
   * не отвечает на нажатие, читатель считает сломанным экраном.
   */
  const toggleRow = (p: RegistryProcedure, open: boolean): void => {
    if (open && openCode !== null && p.code === openCode) onCloseOpenCode?.();
    setExpanded(open ? null : idOf(p));
  };

  const cardFor = (p: RegistryProcedure) => (
    <ProcedureCard
                        bookUrl={bookUrl}
      p={p}
      lineage={p.code !== null ? lineageByCode?.get(p.code) ?? null : null}
      journalRow={p.code !== null ? journalByCode?.get(p.code) ?? null : null}
      match={p.code !== null ? matchIndex?.byCode.get(p.code) ?? null : null}
      matchIndex={matchIndex ?? null}
      onOpenCode={onOpenCode}
    />
  );

  const codeCell = (p: RegistryProcedure) => <button type="button"
    aria-label={`Открыть процедуру ${procedureCodeLabel(p)}`}
    aria-haspopup={onOpenProcedure ? 'dialog' : undefined}
    onClick={event => { event.stopPropagation(); if (onOpenProcedure) onOpenProcedure(p); else toggleRow(p, isOpen(p)); }}
    className="rounded text-left underline decoration-zinc-300 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"><CodeCell p={p} /></button>;
  const stageCell = (p: RegistryProcedure) => <span className={`rounded px-1.5 py-0.5 text-xs ${stageBadgeClass(p.stage)}`} title={stageMeaning(p.stage)}>{stageShort(p.stage)}</span>;
  const working: TableColumn[] = [
    { key: 'code', label: 'Код', sortKey: 'code', cell: codeCell },
    { key: 'action', label: 'Требуемое действие', cell: p => <><p>{p.requiredAction || 'Действие не указано'}</p>{p.qualityNote && <details className="mt-2 text-xs"><summary className="cursor-pointer">Замечания</summary><p>{p.qualityNote}</p></details>}</> },
    { key: 'subjectCustomer', label: 'Предмет и заказчик', cell: p => <><p>{p.subject}</p><p className="mt-1 text-xs">{p.customer}</p></> },
    { key: 'stageResult', label: 'Стадия и результат', cell: p => <>{stageCell(p)}<p className="mt-2 text-xs">{p.result || 'Результат не внесён'}</p></> },
    { key: 'auctionDate', label: 'Дата итогов', sortKey: 'auctionDate', cell: p => p.auctionDate ? fmtDate(p.auctionDate) : 'Не внесена' },
    { key: 'nmck', label: 'НМЦК, руб.', sortKey: 'nmck', right: true, cell: p => fmtRub(p.nmck) },
    { key: 'auctionPrice', label: 'Цена по итогам, руб.', sortKey: 'auctionPrice', right: true, cell: p => <>{fmtRub(p.auctionPrice)}{p.factsEligible === false && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Цена пока не учтена в денежных итогах</p>}</> },
  ];
  const full: TableColumn[] = [
    { key: 'address', label: 'Адрес', cell: p => <><ChevronDown size={11} aria-hidden="true" className={`inline mr-1 ${isOpen(p) ? 'rotate-180' : ''}`} />{p.row}{p.ppNum !== null && ` · № ${p.ppNum}`}{procedureDefects(p).length > 0 && <span className="ml-1 text-amber-600" title={pluralCount(procedureDefects(p).length, 'сигнал', 'сигнала', 'сигналов')}>!</span>}</> },
    { key: 'code', label: 'Код', sortKey: 'code', cell: codeCell },
    { key: 'customer', label: 'Заказчик', sortKey: 'customer', cell: p => p.customer || '—' },
    { key: 'subject', label: 'Предмет закупки', cell: p => p.subject },
    { key: 'nmck', label: 'НМЦК, руб.', sortKey: 'nmck', right: true, cell: p => fmtRub(p.nmck) },
    { key: 'applicationDate', label: 'заявка', group: 'dates', cell: p => fmtDate(p.applicationDate) },
    { key: 'publicationDate', label: 'публикация', sortKey: 'publicationDate', group: 'dates', cell: p => fmtDate(p.publicationDate) },
    { key: 'deadlineDate', label: 'окончание подачи', group: 'dates', cell: p => fmtDate(p.deadlineDate) },
    { key: 'auctionDate', label: 'торги', sortKey: 'auctionDate', group: 'dates', cell: p => fmtDate(p.auctionDate) },
    { key: 'auctionPrice', label: 'цена, руб.', sortKey: 'auctionPrice', group: 'result', right: true, cell: p => fmtRub(p.auctionPrice) },
    { key: 'reductionPct', label: 'снижение', sortKey: 'reductionPct', group: 'result', right: true, cell: p => fmtPct(p.reductionPct) },
    { key: 'savingsTotal', label: 'ВСЕГО', sortKey: 'savingsTotal', group: 'savings', right: true, cell: p => <>{fmtRub(p.savingsTotal)}{p.savingsManual && <span className="ml-1 text-amber-600" title="Внесено числом, а не формулой: связь с ценой разорвана">✎</span>}</> },
    { key: 'control', label: 'проверка', group: 'savings', cell: p => <ControlDot p={p} /> },
    { key: 'savingsMb', label: 'МБ', group: 'savings', right: true, cell: p => fmtRub(p.savingsMb) },
    { key: 'savingsKb', label: 'КБ', group: 'savings', right: true, cell: p => fmtRub(p.savingsKb) },
    { key: 'savingsFb', label: 'ФБ', group: 'savings', right: true, cell: p => fmtRub(p.savingsFb) },
    { key: 'winner', label: 'Победитель', cell: p => <>{p.winnerName ?? p.outcome ?? '—'}{p.winnerInn && <p className="mt-1 font-mono text-xs">{p.winnerInn}</p>}</> },
    { key: 'stage', label: 'Стадия', cell: stageCell },
    { key: 'dept', label: 'Управление', cell: p => p.dept },
    { key: 'protocol', label: 'Протокол', cell: p => p.protocolFlag || '—' },
    { key: 'comment', label: 'Комментарий', cell: p => p.comment || '—' },
    { key: 'result', label: 'Результат', cell: p => p.result || 'Не внесён' },
    { key: 'ancestors', label: 'Предки', cell: p => p.ancestorCodes?.join('; ') || '—' },
    { key: 'successors', label: 'Наследники', cell: p => p.successorCodes?.join('; ') || '—' },
    { key: 'fullAction', label: 'Требуемое действие', cell: p => p.requiredAction || 'Не указано' },
    { key: 'quality', label: 'Замечания', cell: p => p.qualityNote || '—' },
  ];
  let columns = (compactView ? working : full).filter(c => visible(c.key));
  if (!compactView) {
    if (!datesOpen) {
      const firstDate = columns.findIndex(c => c.group === 'dates');
      columns = columns.filter(c => c.group !== 'dates');
      if (firstDate >= 0) columns.splice(firstDate, 0, { key: 'dates', label: 'Сроки', cell: p => <DatesFoldedCell p={p} /> });
    }
    if (!budgetsOpen) columns = columns.filter(c => !['savingsMb', 'savingsKb', 'savingsFb'].includes(c.key));
  }
  const heading = (c: TableColumn) => c.key === 'dates'
    ? <FoldButton open={false} onToggle={toggleDates} labelOpen="Даты" labelClosed="Сроки" />
    : c.sortKey ? <SortButton label={c.label} sortKey={c.sortKey} active={sortKey === c.sortKey} dir={sortDir} onSort={onSort} align={c.right ? 'right' : 'left'} />
    : c.key === 'control' ? <KBTooltip {...kbCardProps(MONITORING_KB_ADDITIONS.monitoring_self_check)}><span>{c.label}</span></KBTooltip> : c.label;
  const groups = new Set<string>();
  return (
    <section aria-label="Реестр процедур" className="space-y-2">
      {/* ── Провенанс таблицы: откуда каждое число этих строк и на какой
          момент книга прочитана. У портрета над таблицей паспорт был, а у
          самой таблицы — ни источника, ни момента, хотя чисел в ней больше,
          чем во всей остальной вкладке. Единица денег названа здесь же:
          книги управлений ведутся в тысячах, и перепутать их с рублями книги
          мониторинга значит ошибиться ровно в тысячу раз. ── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs leading-tight text-zinc-500 dark:text-zinc-400">
          Источник: {sourceLabel ?? 'книга «Ежедневный мониторинг» · листы управлений'}; деньги —
          рубли книги{readAtLabel !== undefined && `; ${readAtLabel}`}
        </p>
        <MonitoringPerimeterCaption scope="registry" className="text-right" />
      </div>

      {compact && <button type="button" onClick={() => setCompactView(v => {
              try {
                localStorage.setItem('monitoring:compact', String(!v));
              } catch {
                /* Optional preference. */
              }
              return !v;
            })}
        className={`${CONTROL} px-3 py-2 text-sm`}>
        {compactView ? 'Все колонки' : 'Рабочий вид'}
      </button>}
      <details className="text-sm">
        <summary className={`${CONTROL} inline-flex cursor-pointer px-3 py-2`}>Настроить колонки</summary>
        <fieldset className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3">
          <legend className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Выбор сохраняется в этом браузере. Код остаётся видимым для открытия процедуры.</legend>
          {(compactView ? working : full).map(column => <label key={column.key} className="flex items-center gap-2 py-1">
            <input type="checkbox" checked={visible(column.key)} disabled={column.key === 'code'}
              onChange={event => {
                saveColumns(event.target.checked ? hiddenColumns.filter(key => key !== column.key) : [...hiddenColumns, column.key]);
                if (event.target.checked && column.group === 'dates') { setDatesOpen(true); savePref(DATES_PREF_KEY, true); }
                if (event.target.checked && ['savingsMb', 'savingsKb', 'savingsFb'].includes(column.key)) { setBudgetsOpen(true); savePref(BUDGETS_PREF_KEY, true); }
              }} />{column.group === 'savings' ? `Экономия: ${column.label}` : column.label} (колонка)
          </label>)}
        </fieldset>
        <button type="button" className={`${CONTROL} mt-2 px-3 py-2`} onClick={() => { saveColumns([]); setDatesOpen(true); savePref(DATES_PREF_KEY, true); setBudgetsOpen(true); savePref(BUDGETS_PREF_KEY, true); }}>Вернуть все колонки</button>
      </details>
      <div className={`hidden sm:block ${CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr className={RULE_HEAD}>{columns.map(column => {
              if (!compactView && column.group) {
                if (groups.has(column.group)) return null;
                groups.add(column.group);
                return <th key={column.group} colSpan={columns.filter(c => c.group === column.group).length} className={`px-2 py-2 text-center font-medium ${RULE_COL_HEAD}`}>
                  {column.group === 'dates' ? <FoldButton open onToggle={toggleDates} labelOpen="Даты — свернуть в «Сроки»" labelClosed="Сроки" />
                    : column.group === 'result' ? 'Итог торгов' : <span className="inline-flex items-center gap-2">Экономия, руб.<FoldButton open={budgetsOpen} onToggle={toggleBudgets} labelOpen="свернуть МБ/КБ/ФБ" labelClosed="по бюджетам" /></span>}
                </th>;
              }
              return <th key={column.key} rowSpan={compactView ? 1 : 2} className={`px-3 py-2 align-bottom font-medium ${column.right ? 'text-right' : 'text-left'}`}>{heading(column)}</th>;
            })}</tr>
            {!compactView && <tr className={RULE_HEAD}>{columns.filter(c => c.group).map(column => <th key={column.key} className={`px-3 py-2 font-normal ${column.right ? 'text-right' : 'text-left'}`}>{heading(column)}</th>)}</tr>}
          </thead>
          <tbody>{shown.map((p, i) => [<tr key={idOf(p)}
            onClick={() => onOpenProcedure ? onOpenProcedure(p) : toggleRow(p, isOpen(p))}
            tabIndex={0} aria-expanded={onOpenProcedure ? undefined : isOpen(p)}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (onOpenProcedure) onOpenProcedure(p); else toggleRow(p, isOpen(p)); } }}
            className={`${RULE_ROW} align-top cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-zinc-700/20 ${i % 2 ? 'bg-zinc-50/60 dark:bg-white/[0.03]' : ''}`}>
            {columns.map(column => <td key={column.key} className={`px-3 py-3 ${column.right ? 'text-right whitespace-nowrap tabular-nums' : 'text-left'} ${column.group ? RULE_COL : ''} ${['subject','customer','subjectCustomer','action','winner'].includes(column.key) ? 'min-w-[12rem] max-w-[24rem] break-words' : 'whitespace-nowrap'}`}>{column.cell(p)}</td>)}
          </tr>, isOpen(p) && !onOpenProcedure && <tr key={`${idOf(p)}:card`}><td colSpan={columns.length} className="p-3">{cardFor(p)}</td></tr>])}</tbody>
        </table>
      </div>

      {/* ── Узкий экран: та же строка списком карточек (§6.3) ── */}
      <ul className="sm:hidden space-y-2">
        {shown.map((p) => {
          const open = isOpen(p);
          return (
            <li key={idOf(p)} className={`${CARD} p-3`}>
              <button
                type="button"
                onClick={() => onOpenProcedure ? onOpenProcedure(p) : toggleRow(p, open)}
                aria-expanded={open}
                className="w-full text-left"
              >
                <CodeCell p={p} />
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">Открыть процедуру</span>
              </button>
              <dl className="mt-2 space-y-2 text-sm">
                {columns.filter(column => column.key !== 'code').map(column => <div key={column.key}>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">{column.group === 'savings' ? `Экономия: ${column.label}, руб.` : column.label}</dt>
                  <dd className="mt-0.5 break-words tabular-nums">{column.cell(p)}</dd>
                </div>)}
              </dl>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{p.sheet} · строка {p.row}</p>
              {open && <div className="mt-2">{cardFor(p)}</div>}
            </li>
          );
        })}
      </ul>

      {rows.length > limit && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setLimit((v) => v + chunk)}
            className={`${CONTROL} px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40`}
          >
            Показано {fmtCount(limit)} из {fmtCount(rows.length)} — показать ещё {fmtCount(Math.min(chunk, rows.length - limit))}
          </button>
        </div>
      )}
    </section>
  );
}
