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
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  JournalRow, LineageChain, MatchRow, RegistryProcedure,
} from '../../lib/monitoring/contract';
import type { SortDir, SortKey } from '../../lib/monitoring/slices';
import { procedureDefects } from '../../lib/monitoring/slices';
import { KBTooltip } from '../ui/kb-tooltip';
import { MONITORING_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import { fmtCount, fmtDate, fmtDays, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { methodLabel, stageBadgeClass, stageMeaning, stageShort } from '../../lib/monitoring/stage-labels';
import { ProcedureCard } from './ProcedureCard';

/** Сколько строк показывается сразу; остальное — по кнопке. */
const CHUNK = 200;

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
        className="text-zinc-400 dark:text-zinc-500"
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
      {p.code}
    </span>
  );
}

export interface RegistryTableProps {
  rows: readonly RegistryProcedure[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  /** Родословная по коду процедуры — приходит с листа «25-26». */
  lineageByCode?: ReadonlyMap<string, LineageChain>;
  journalByCode?: ReadonlyMap<string, JournalRow>;
  matchByCode?: ReadonlyMap<string, MatchRow>;
  onOpenCode?: (code: string) => void;
  /** Код, чья карточка должна быть раскрыта извне (переход по родословной). */
  openCode?: string | null;
}

export function RegistryTable({
  rows, sortKey, sortDir, onSort,
  lineageByCode, journalByCode, matchByCode, onOpenCode, openCode = null,
}: RegistryTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(CHUNK);
  const [datesOpen, setDatesOpen] = useState(() => loadPref(DATES_PREF_KEY));
  const [budgetsOpen, setBudgetsOpen] = useState(() => loadPref(BUDGETS_PREF_KEY));

  const toggleDates = (): void => {
    setDatesOpen((v) => { savePref(DATES_PREF_KEY, !v); return !v; });
  };
  const toggleBudgets = (): void => {
    setBudgetsOpen((v) => { savePref(BUDGETS_PREF_KEY, !v); return !v; });
  };

  // Колонок в нижнем этаже: 5 слева + даты (4 или 1) + 2 итога торгов
  // + экономия (5 или 2) + победитель + стадия. Ячейка раскрытия обязана
  // накрывать все — иначе хвост строки торчит из-под карточки.
  const columnCount = 5 + (datesOpen ? 4 : 1) + 2 + (budgetsOpen ? 5 : 2) + 2;

  const idOf = (p: RegistryProcedure): string => `${p.sheet}:${p.row}`;
  const shown = rows.slice(0, limit);
  const isOpen = (p: RegistryProcedure): boolean =>
    expanded === idOf(p) || (openCode !== null && p.code === openCode);

  const cardFor = (p: RegistryProcedure) => (
    <ProcedureCard
      p={p}
      lineage={p.code !== null ? lineageByCode?.get(p.code) ?? null : null}
      journalRow={p.code !== null ? journalByCode?.get(p.code) ?? null : null}
      match={p.code !== null ? matchByCode?.get(p.code) ?? null : null}
      onOpenCode={onOpenCode}
    />
  );

  return (
    <section aria-label="Реестр процедур" className="space-y-2">
      {/* ── Широкий экран: форма книги ── */}
      <div className="hidden sm:block bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-zinc-500 dark:text-zinc-400">
            <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">Адрес</th>
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">
                <SortButton label="Код" sortKey="code" active={sortKey === 'code'} dir={sortDir} onSort={onSort} />
              </th>
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">
                <SortButton label="Заказчик" sortKey="customer" active={sortKey === 'customer'} dir={sortDir} onSort={onSort} />
              </th>
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">Предмет закупки</th>
              <th rowSpan={2} className="px-2 py-1.5 text-right font-medium align-bottom">
                <SortButton label="НМЦК, руб." sortKey="nmck" active={sortKey === 'nmck'} dir={sortDir} onSort={onSort} align="right" />
              </th>
              {datesOpen ? (
                <th colSpan={4} className="px-2 py-1 text-center font-medium border-l border-zinc-100 dark:border-zinc-700/50">
                  <FoldButton
                    open
                    onToggle={toggleDates}
                    labelOpen="Даты — свернуть в «Сроки»"
                    labelClosed="Сроки"
                  />
                </th>
              ) : (
                <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom border-l border-zinc-100 dark:border-zinc-700/50">
                  <FoldButton
                    open={false}
                    onToggle={toggleDates}
                    labelOpen="Даты"
                    labelClosed="Сроки"
                  />
                </th>
              )}
              <th colSpan={2} className="px-2 py-1 text-center font-medium border-l border-zinc-100 dark:border-zinc-700/50">
                Итог торгов
              </th>
              <th colSpan={budgetsOpen ? 5 : 2} className="px-2 py-1 text-center font-medium border-l border-zinc-100 dark:border-zinc-700/50">
                <span className="inline-flex items-center gap-1.5">
                  Экономия, руб.
                  <FoldButton
                    open={budgetsOpen}
                    onToggle={toggleBudgets}
                    labelOpen="свернуть МБ/КБ/ФБ"
                    labelClosed="по бюджетам"
                  />
                </span>
              </th>
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom border-l border-zinc-100 dark:border-zinc-700/50">
                Победитель
              </th>
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">Стадия</th>
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
              {datesOpen && (
                <>
                  <th className="px-2 py-1 text-left font-normal border-l border-zinc-100 dark:border-zinc-700/50">заявка</th>
                  <th className="px-2 py-1 text-left font-normal">
                    <SortButton label="публикация" sortKey="publicationDate" active={sortKey === 'publicationDate'} dir={sortDir} onSort={onSort} />
                  </th>
                  <th className="px-2 py-1 text-left font-normal">окончание подачи</th>
                  <th className="px-2 py-1 text-left font-normal">
                    <SortButton label="торги" sortKey="auctionDate" active={sortKey === 'auctionDate'} dir={sortDir} onSort={onSort} />
                  </th>
                </>
              )}
              <th className="px-2 py-1 text-right font-normal border-l border-zinc-100 dark:border-zinc-700/50">
                <SortButton label="цена, руб." sortKey="auctionPrice" active={sortKey === 'auctionPrice'} dir={sortDir} onSort={onSort} align="right" />
              </th>
              <th className="px-2 py-1 text-right font-normal">
                <SortButton label="снижение" sortKey="reductionPct" active={sortKey === 'reductionPct'} dir={sortDir} onSort={onSort} align="right" />
              </th>
              <th className="px-2 py-1 text-right font-normal border-l border-zinc-100 dark:border-zinc-700/50">
                <SortButton label="ВСЕГО" sortKey="savingsTotal" active={sortKey === 'savingsTotal'} dir={sortDir} onSort={onSort} align="right" />
              </th>
              <th className="px-2 py-1 text-center font-normal">
                {/* Подсказка БЗ у колонки, которую чаще всего понимают неверно:
                    по бюджетам расписана ЭКОНОМИЯ, а не начальная цена. */}
                <KBTooltip {...kbCardProps(MONITORING_KB_ADDITIONS.monitoring_self_check)}>
                  <span>проверка</span>
                </KBTooltip>
              </th>
              {budgetsOpen && (
                <>
                  <th className="px-2 py-1 text-right font-normal">МБ</th>
                  <th className="px-2 py-1 text-right font-normal">КБ</th>
                  <th className="px-2 py-1 text-right font-normal">ФБ</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const open = isOpen(p);
              const defects = procedureDefects(p);
              // Тихая полосатость чётных строк (п.129): строки разводит
              // светлота, а не рамки — рамка между строками и так самая тонкая.
              const stripe = i % 2 === 1 ? 'bg-zinc-50/60 dark:bg-zinc-900/25' : '';
              return [
                <tr
                  key={idOf(p)}
                  onClick={() => setExpanded(open ? null : idOf(p))}
                  aria-expanded={open}
                  className={`border-b border-zinc-50 dark:border-zinc-700/30 align-top cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-zinc-700/20 ${stripe}`}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400 dark:text-zinc-500">
                    <ChevronDown
                      size={11}
                      aria-hidden="true"
                      className={`inline mr-0.5 ${open ? 'rotate-180' : ''}`}
                    />
                    {p.row}
                    {p.ppNum !== null && <span className="ml-1">· № {p.ppNum}</span>}
                    {defects.length > 0 && (
                      <span
                        className="ml-1 text-amber-600 dark:text-amber-400"
                        title={`${pluralCount(defects.length, 'сигнал', 'сигнала', 'сигналов')} по этой строке`}
                      >
                        !
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap"><CodeCell p={p} /></td>
                  <td className="px-2 py-1.5 max-w-[12rem] truncate text-zinc-600 dark:text-zinc-300" title={p.customer}>
                    {p.customer || '—'}
                  </td>
                  <td className="px-2 py-1.5 max-w-[20rem] truncate text-zinc-600 dark:text-zinc-300" title={p.subject}>
                    {p.subject}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">
                    {fmtRub(p.nmck)}
                  </td>
                  {datesOpen ? (
                    <>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400 border-l border-zinc-50 dark:border-zinc-700/30">
                        {fmtDate(p.applicationDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
                        {fmtDate(p.publicationDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
                        {fmtDate(p.deadlineDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
                        {fmtDate(p.auctionDate)}
                      </td>
                    </>
                  ) : (
                    <td className="px-2 py-1.5 whitespace-nowrap border-l border-zinc-50 dark:border-zinc-700/30">
                      <DatesFoldedCell p={p} />
                    </td>
                  )}
                  <td
                    className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100 border-l border-zinc-50 dark:border-zinc-700/30"
                    title={p.auctionPrice === 0 ? 'Ноль — содержательный исход: торги прошли без результата' : undefined}
                  >
                    {fmtRub(p.auctionPrice)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                    <span className={p.reductionPct !== null && p.reductionPct > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-zinc-500 dark:text-zinc-400'}
                    >
                      {fmtPct(p.reductionPct)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-700 dark:text-zinc-200 border-l border-zinc-50 dark:border-zinc-700/30">
                    {fmtRub(p.savingsTotal)}
                    {p.savingsManual && (
                      <span className="ml-0.5 text-amber-600 dark:text-amber-400" title="Внесено числом, а не формулой: связь с ценой разорвана">
                        ✎
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center"><ControlDot p={p} /></td>
                  {budgetsOpen && (
                    <>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(p.savingsMb)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(p.savingsKb)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(p.savingsFb)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 max-w-[14rem] border-l border-zinc-50 dark:border-zinc-700/30" title={p.winner ?? undefined}>
                    <span className="block truncate text-zinc-600 dark:text-zinc-300">
                      {p.winnerName ?? p.outcome ?? '—'}
                    </span>
                    {p.winnerInn !== null && (
                      <span className="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{p.winnerInn}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${stageBadgeClass(p.stage)}`} title={stageMeaning(p.stage)}>
                      {stageShort(p.stage)}
                    </span>
                  </td>
                </tr>,
                open && (
                  <tr key={`${idOf(p)}:card`} className="border-b border-zinc-100 dark:border-zinc-700/40">
                    <td colSpan={columnCount} className="p-2 bg-zinc-50/60 dark:bg-zinc-900/30">
                      {cardFor(p)}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Узкий экран: та же строка списком карточек (§6.3) ── */}
      <ul className="sm:hidden space-y-2">
        {shown.map((p) => {
          const open = isOpen(p);
          return (
            <li key={idOf(p)} className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : idOf(p))}
                aria-expanded={open}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <CodeCell p={p} />
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${stageBadgeClass(p.stage)}`}>
                    {stageShort(p.stage)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300 line-clamp-2">{p.subject}</p>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  <dt className="text-zinc-500 dark:text-zinc-400">НМЦК, руб.</dt>
                  <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-100">{fmtRub(p.nmck)}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">цена, руб.</dt>
                  <dd className="text-right tabular-nums text-zinc-800 dark:text-zinc-100">{fmtRub(p.auctionPrice)}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">снижение</dt>
                  <dd className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{fmtPct(p.reductionPct)}</dd>
                </dl>
                <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                  {p.sheet} · строка {p.row}
                  {p.ppNum !== null && ` · № ${p.ppNum}`}
                </p>
              </button>
              {open && <div className="mt-2">{cardFor(p)}</div>}
            </li>
          );
        })}
      </ul>

      {rows.length > limit && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setLimit((v) => v + CHUNK)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40"
          >
            Показано {fmtCount(limit)} из {fmtCount(rows.length)} — показать ещё {fmtCount(Math.min(CHUNK, rows.length - limit))}
          </button>
        </div>
      )}
    </section>
  );
}
