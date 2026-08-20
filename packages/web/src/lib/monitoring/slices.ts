/**
 * Разрезы реестра — «смотреть по-разному» (канон п.101а, спека §2.6).
 *
 * Канон требует не переключателя листов, а возможности смотреть на один и тот
 * же реестр разными глазами. Восемь разрезов ниже комбинируются между собой и
 * применяются к любому режиму листа; поиск идёт по коду, предмету, заказчику и
 * ИНН победителя.
 *
 * Всё здесь — чистые функции без React: их проверяет юнит-тест, а не глаз.
 *
 * ОТБОР ЭКРАНА ≠ ПУСТОТА КНИГИ. Функции возвращают отфильтрованный список, а
 * различать «книга не прочитана», «в книге нет строк» и «разрезы всё срезали»
 * обязан экран — тремя разными словами и тремя разными кнопками (п.36).
 */
import type { ProcedureDefect, RegistryProcedure } from './contract';
import { dateQuarter, dateSortKey, dateYear, daysBetween } from './format';

// ── Корзины НМЦК ─────────────────────────────────────────────────────

/**
 * Пять корзин размера закупки. Разрез нужен потому, что снижение на мелких и
 * крупных закупках ведёт себя по-разному, а общий средний процент их
 * смешивает: 90 закупок до ста тысяч и 10 закупок свыше двадцати миллионов
 * живут в одном столбце и отвечают на разные вопросы.
 */
export const NMCK_BUCKETS: ReadonlyArray<{
  id: string;
  label: string;
  /** Нижняя граница включительно, руб. */
  from: number;
  /** Верхняя граница исключительно, руб.; null — без потолка. */
  to: number | null;
}> = [
  { id: 'lt100k', label: 'до 100 тыс.', from: 0, to: 100_000 },
  { id: '100k-600k', label: '100–600 тыс.', from: 100_000, to: 600_000 },
  { id: '600k-3m', label: '0,6–3 млн', from: 600_000, to: 3_000_000 },
  { id: '3m-20m', label: '3–20 млн', from: 3_000_000, to: 20_000_000 },
  { id: 'gt20m', label: 'свыше 20 млн', from: 20_000_000, to: null },
];

/** Корзина строки; null — НМЦК не число (записана текстом либо пуста). */
export function nmckBucketId(nmck: number | null): string | null {
  if (nmck === null) return null;
  const b = NMCK_BUCKETS.find((x) => nmck >= x.from && (x.to === null || nmck < x.to));
  return b ? b.id : null;
}

// ── Состояние разрезов ───────────────────────────────────────────────

/** По какой дате режется период: обе даты содержательны, подмена меняет картину. */
export type PeriodBasis = 'publication' | 'auction';

export interface SliceState {
  /** Канонический ид управления либо null — все восемь листов. */
  dept: string | null;
  stage: string | null;
  method: string | null;
  /** Год, квартал и месяц — по выбранной дате-основанию. */
  periodBasis: PeriodBasis;
  periodYear: number | null;
  periodQuarter: number | null;
  periodMonth: number | null;
  customer: string | null;
  /** Победитель — по ИНН, а не по написанию имени. */
  winnerInn: string | null;
  nmckBucket: string | null;
  /** Год процедуры из суффикса кода — книга переходящая. */
  procedureYear: number | null;
  /** Оставить только строки, у которых есть хоть один машинный дефект. */
  defectsOnly: boolean;
  query: string;
}

export function emptySlices(): SliceState {
  return {
    dept: null,
    stage: null,
    method: null,
    periodBasis: 'publication',
    periodYear: null,
    periodQuarter: null,
    periodMonth: null,
    customer: null,
    winnerInn: null,
    nmckBucket: null,
    procedureYear: null,
    defectsOnly: false,
    query: '',
  };
}

/** Есть ли хоть один действующий разрез — от этого зависят слова пустого экрана. */
export function hasAnySlice(s: SliceState): boolean {
  return (
    s.dept !== null || s.stage !== null || s.method !== null
    || s.periodYear !== null || s.periodQuarter !== null || s.periodMonth !== null
    || s.customer !== null || s.winnerInn !== null || s.nmckBucket !== null
    || s.procedureYear !== null || s.defectsOnly || s.query.trim() !== ''
  );
}

// ── Дефекты строки ───────────────────────────────────────────────────

/**
 * Машинные дефекты строки — то, ради чего работает переключатель «только с
 * дефектами». Тон: механизм, а не упрёк (п.104). Каждая фраза объясняет, что
 * именно рассинхронизировано, и не называет виновного.
 *
 * ПЕРВЫМИ ИДУТ ДЕФЕКТЫ ЯДРА, и они не пересказываются: у них есть адрес
 * ячейки («5. УДТХиРКИ!D34»), а карточка диагноста без адреса бесполезна
 * (п.53). Экран добавляет только то, чего ядро не считает, и не дублирует
 * уже названное — иначе один и тот же разрыв прозвучал бы дважды и создал
 * впечатление двух разных бед.
 *
 * Ноль в цене аукциона дефектом НЕ считается: это содержательный исход
 * («торги без результата»), а не ошибка заполнения.
 */
export function procedureDefects(p: RegistryProcedure): ProcedureDefect[] {
  const out: ProcedureDefect[] = [...p.defects];
  const known = new Set(out.map((d) => d.kind));
  // Адрес строки — на случай, когда дефект нашёл экран, а не ядро: колонку он
  // назвать не может, строку обязан.
  const here = `${p.sheet} · строка ${p.row}`;
  const add = (kind: string, note: string): void => {
    if (!known.has(kind)) out.push({ kind, address: here, note });
  };

  if (p.selfCheck !== null && p.selfCheck.toLowerCase().startsWith('ошиб')) {
    add('control-error', 'Контроль книги показывает «ошибка»: экономия не расписана по бюджетам.');
  }
  if (p.code === null) {
    add('broken-code', 'Код процедуры не разобран — связь с книгой ГРБС по этой строке не строится.');
  }
  if (p.savingsManual) {
    add(
      'manual-savings',
      'Экономия внесена вручную: формула на этой строке разорвана, при изменении НМЦК число не пересчитается.',
    );
  }
  if (p.nmck === null) {
    add(
      'text-number',
      'Начальная цена не читается числом — вероятно, записана текстом; суммы свода её не видят.',
    );
  }
  for (const [label, value] of [
    ['поступления заявки', p.applicationDate],
    ['публикации', p.publicationDate],
    ['окончания подачи заявок', p.deadlineDate],
    ['проведения торгов', p.auctionDate],
  ] as const) {
    if (value !== null && dateSortKey(value) === null) {
      add(
        'broken-date',
        `Дата ${label} записана не датой («${value}») — строка выпадает из сортировки и отбора по периоду.`,
      );
    }
  }
  for (const [label, from, to] of [
    ['заявка → публикация', p.applicationDate, p.publicationDate],
    ['публикация → окончание подачи', p.publicationDate, p.deadlineDate],
    ['окончание подачи → торги', p.deadlineDate, p.auctionDate],
  ] as const) {
    const d = daysBetween(from, to);
    if (d !== null && d < 0) {
      add('negative-duration', `Этап «${label}» длится ${d} дней: вторая дата раньше первой.`);
    }
  }
  if (p.stage === 'awarded' && p.winnerInn === null) {
    add(
      'winner-without-inn',
      'Победитель назван, а ИНН в ячейке нет — разрез по поставщику эту победу не увидит.',
    );
  }
  return out;
}

// ── Применение разрезов ──────────────────────────────────────────────

function matchesQuery(p: RegistryProcedure, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return [p.code, p.subject, p.customer, p.winnerInn, p.winnerName, p.outcome]
    .some((v) => v !== null && v.toLowerCase().includes(needle));
}

function periodDate(p: RegistryProcedure, basis: PeriodBasis): string | null {
  return basis === 'publication' ? p.publicationDate : p.auctionDate;
}

export function applySlices(rows: readonly RegistryProcedure[], s: SliceState): RegistryProcedure[] {
  return rows.filter((p) => {
    if (s.dept !== null && p.dept !== s.dept) return false;
    if (s.stage !== null && p.stage !== s.stage) return false;
    if (s.method !== null && p.method !== s.method) return false;
    if (s.customer !== null && p.customer !== s.customer) return false;
    if (s.winnerInn !== null && p.winnerInn !== s.winnerInn) return false;
    if (s.nmckBucket !== null && nmckBucketId(p.nmck) !== s.nmckBucket) return false;
    if (s.procedureYear !== null && p.year !== s.procedureYear) return false;

    if (s.periodYear !== null || s.periodQuarter !== null || s.periodMonth !== null) {
      const d = periodDate(p, s.periodBasis);
      if (s.periodYear !== null && dateYear(d) !== s.periodYear) return false;
      if (s.periodQuarter !== null && dateQuarter(d) !== s.periodQuarter) return false;
      if (s.periodMonth !== null) {
        const key = dateSortKey(d);
        if (key === null || Math.floor(key / 100) % 100 !== s.periodMonth) return false;
      }
    }

    if (s.defectsOnly && procedureDefects(p).length === 0) return false;
    return matchesQuery(p, s.query);
  });
}

// ── Хлебные крошки ───────────────────────────────────────────────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export interface SliceCrumb {
  /** Ключ разреза — по нему крестик его и снимает. */
  key: keyof SliceState;
  label: string;
}

/**
 * Действующие разрезы словами — крошки с крестиками, как на других вкладках.
 * Читатель должен видеть, почему в таблице 12 строк вместо 374, не открывая
 * панель отбора.
 */
export function describeSlices(s: SliceState, deptName?: (dept: string) => string): SliceCrumb[] {
  const out: SliceCrumb[] = [];
  if (s.dept !== null) out.push({ key: 'dept', label: `управление: ${deptName ? deptName(s.dept) : s.dept}` });
  if (s.stage !== null) out.push({ key: 'stage', label: `стадия: ${s.stage}` });
  if (s.method !== null) out.push({ key: 'method', label: `способ: ${s.method}` });
  if (s.periodYear !== null) out.push({ key: 'periodYear', label: `год: ${s.periodYear}` });
  if (s.periodQuarter !== null) out.push({ key: 'periodQuarter', label: `квартал: ${s.periodQuarter}` });
  if (s.periodMonth !== null) {
    out.push({ key: 'periodMonth', label: `месяц: ${MONTH_NAMES[s.periodMonth - 1] ?? s.periodMonth}` });
  }
  if (s.customer !== null) out.push({ key: 'customer', label: `заказчик: ${s.customer}` });
  if (s.winnerInn !== null) out.push({ key: 'winnerInn', label: `победитель по ИНН: ${s.winnerInn}` });
  if (s.nmckBucket !== null) {
    const b = NMCK_BUCKETS.find((x) => x.id === s.nmckBucket);
    out.push({ key: 'nmckBucket', label: `размер НМЦК: ${b ? b.label : s.nmckBucket}` });
  }
  if (s.procedureYear !== null) out.push({ key: 'procedureYear', label: `год процедуры: ${s.procedureYear}` });
  if (s.defectsOnly) out.push({ key: 'defectsOnly', label: 'только строки с дефектами' });
  if (s.query.trim() !== '') out.push({ key: 'query', label: `поиск: «${s.query.trim()}»` });
  return out;
}

/** Снять один разрез, не трогая остальные. */
export function clearSlice(s: SliceState, key: keyof SliceState): SliceState {
  if (key === 'defectsOnly') return { ...s, defectsOnly: false };
  if (key === 'query') return { ...s, query: '' };
  if (key === 'periodBasis') return { ...s, periodBasis: 'publication' };
  return { ...s, [key]: null };
}

// ── Сортировка ───────────────────────────────────────────────────────

export type SortKey =
  | 'row' | 'code' | 'customer' | 'nmck' | 'publicationDate'
  | 'auctionDate' | 'auctionPrice' | 'savingsTotal' | 'reductionPct';

export type SortDir = 'asc' | 'desc';

/**
 * Сортировка реестра. Пустое значение всегда уезжает в конец независимо от
 * направления: «нет цены» — не «самая маленькая цена», и всплывать наверх при
 * сортировке по возрастанию оно не должно.
 */
export function sortProcedures(
  rows: readonly RegistryProcedure[],
  key: SortKey,
  dir: SortDir,
): RegistryProcedure[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (p: RegistryProcedure): number | string | null => {
    switch (key) {
      case 'row': return p.row;
      case 'code': return p.code;
      case 'customer': return p.customer === '' ? null : p.customer;
      case 'nmck': return p.nmck;
      case 'publicationDate': return dateSortKey(p.publicationDate);
      case 'auctionDate': return dateSortKey(p.auctionDate);
      case 'auctionPrice': return p.auctionPrice;
      case 'savingsTotal': return p.savingsTotal;
      case 'reductionPct': return p.reductionPct;
      default: return null;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return sign * String(va).localeCompare(String(vb), 'ru');
    }
    return sign * (va - vb);
  });
}
