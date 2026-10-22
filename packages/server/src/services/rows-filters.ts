/**
 * Query-фильтры списка строк /api/rows/:deptId (E11-2, rethink 2026-07-22).
 * Чистые функции от (rows, параметры запроса) — никакого чтения store/глобалей.
 * Отсутствующий параметр не сужает выборку. Явный ошибочный год отклоняется,
 * а не расширяет выборку до всех лет.
 * Осевые каноны — из @aemr/shared: способы (METHOD_FAMILY_MAP), «само управление»
 * (isOrgItself), активность ТД/ПМ (matchesActivityScope).
 */
import {
  METHOD_FAMILY_MAP,
  ORG_ITSELF_SENTINEL,
  isOrgItself,
  subordinateNameMatchKey,
  matchesActivityScope,
  parseActivityScope,
} from '@aemr/shared';

/** Минимальная форма строки, которую режут фильтры (RowDto ей удовлетворяет). */
export interface FilterableRow {
  subject: unknown;
  method: string;
  status: unknown;
  managementName: unknown;
  subordinate: unknown;
  type: unknown;
  programName: unknown;
  state: string;
  planYear: number;
}

export { parseYearFilterParam as parseYearFilter } from './period-params.js';

/** Поля, по которым ищет applySearchFilter (единый список вместо цепочки ||). */
const SEARCH_FIELDS: readonly (keyof FilterableRow)[] =
  ['subject', 'method', 'status', 'managementName', 'subordinate'];

/** Поиск по предмету/способу/статусу/реестровому номеру/подведу (searchTerm уже lower-case). */
export function applySearchFilter<T extends FilterableRow>(rows: T[], searchTerm: string): T[] {
  if (!searchTerm) return rows;
  return rows.filter(r =>
    SEARCH_FIELDS.some(f => String(r[f]).toLowerCase().includes(searchTerm)),
  );
}

/** Значение query.type → семейство кодов колонки L (словарь method-families). */
const METHODS_BY_TYPE_FILTER: Record<string, readonly string[]> = {
  competitive: METHOD_FAMILY_MAP.COMPETITIVE,
  'КП': METHOD_FAMILY_MAP.COMPETITIVE,
  single: METHOD_FAMILY_MAP.EP,
  'ЕП': METHOD_FAMILY_MAP.EP,
};

/**
 * Route boundary validation. Explicit invalid scope must NEVER widen a query
 * to all rows. Keep legacy aliases that existed in the previous GET contract.
 */
function invalidAxis(axis: string): never {
  throw Object.assign(new Error(`Недопустимый фильтр ${axis}.`),
    { statusCode: 400, code: 'INVALID_SCOPE' });
}
export function parseTypeFilterParam(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return 'all';
  if (typeof raw !== 'string' || !Object.hasOwn(METHODS_BY_TYPE_FILTER, raw)) return invalidAxis('type');
  return raw;
}
export function parseActivityFilterParam(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const activity = parseActivityScope(raw);
  if (activity === null) return invalidAxis('activity');
  if (activity === 'all') return '';
  return activity === 'pm' ? 'program' : 'current_non_program';
}

/** Тип закупки по колонке L = METHOD: ЭА/ЭК/ЭЗК = КП (competitive); ЕП = single. */
export function applyTypeFilter<T extends FilterableRow>(rows: T[], filterType: string): T[] {
  const codes = METHODS_BY_TYPE_FILTER[filterType];
  if (filterType === '' || filterType === 'all') return rows;
  if (!codes) return invalidAxis('type');
  return rows.filter(r => codes.includes(r.method.toUpperCase()));
}

/**
 * Фильтр по подведу (колонка C = SUBORDINATE), список через запятую.
 * `_org_itself` — валидный фильтр «Аппарат управления» (фильтр-спека 16.07 Б4):
 * матчит строки-закупки самого управления по канон-предикату isOrgItself
 * (пусто / самоссылка X/Х/тире / плейсхолдеры «н/д», «нет» — единый канон оси C).
 * filterSubordinate уже trim + lower-case (как в исходном роуте).
 */
export function applySubordinateFilter<T extends Pick<FilterableRow, 'subordinate'>>(rows: T[], filterSubordinate: string): T[] {
  if (!filterSubordinate) return rows;
  const subs = filterSubordinate.split(',').map(s => subordinateNameMatchKey(s)).filter(Boolean);
  const wantsOrgItself = subs.includes(ORG_ITSELF_SENTINEL);
  const nameSubs = subs.filter(s => s !== ORG_ITSELF_SENTINEL);
  return rows.filter(r => {
    if (wantsOrgItself && isOrgItself(r.subordinate)) return true;
    const sub = subordinateNameMatchKey(r.subordinate);
    return nameSubs.some(s => sub.includes(s));
  });
}

/**
 * Фильтр по виду деятельности — осевой канон matchesActivityScope (F = TYPE).
 *   program             → ПМ
 *   current_program     → ТД (легаси-ключ бывшего среза «ТД-ПМ»)
 *   current_non_program → ТД
 *   иначе               → substring по F (легаси-значения фильтра)
 *
 * Канон п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён — строки ТД с
 * заполненной графой программы (D) входят в ТД по ВСЕМ фильтрам. Оба
 * ТД-ключа отдают текущую деятельность целиком; графа D в фильтрации
 * не участвует.
 */
export function applyActivityFilter<T extends FilterableRow>(rows: T[], filterActivity: string): T[] {
  if (!filterActivity) return rows;
  const scope = parseActivityScope(filterActivity);
  if (scope === null) return invalidAxis('activity');
  if (scope === 'all') return rows;
  return rows.filter(r => {
    switch (filterActivity) {
      case 'program':
        return matchesActivityScope('pm', r.type);
      case 'current_program':
      case 'current_non_program':
        return matchesActivityScope('td', r.type);
      default:
        return matchesActivityScope(parseActivityScope(filterActivity) === 'pm' ? 'pm' : 'td', r.type);
    }
  });
}

/** Фильтр по состоянию строки (RowState). */
export function applyStateFilter<T extends FilterableRow>(rows: T[], filterState: string): T[] {
  if (!filterState) return rows;
  return rows.filter(r => r.state === filterState);
}

/**
 * Same strict year cohort as CalcEngine(emptyYearPolicy='bucket'):
 * an absent/invalid P never appears as a funded purchase in every year.
 * Callers retain the excluded no-year count as explicit source coverage.
 * With no year selection the original rows, including no-year, stay visible.
 */
export function applyYearFilter<T extends FilterableRow>(rows: T[], yearFilter: number | undefined): T[] {
  if (yearFilter === undefined) return rows;
  return rows.filter(r => r.planYear === yearFilter);
}

/** Сортировка: числа — численно, иначе локалью 'ru'. Пустой sortCol = порядок не меняется. */
export function sortRows<T>(rows: T[], sortCol: string, sortOrder: 'asc' | 'desc'): T[] {
  if (!sortCol) return rows;
  return [...rows].sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[sortCol];
    const bVal = (b as Record<string, unknown>)[sortCol];
    // NaN-значения уводим в строковое сравнение — компаратор не должен вернуть NaN
    const bothNumbers = typeof aVal === 'number' && typeof bVal === 'number'
      && !Number.isNaN(aVal) && !Number.isNaN(bVal);
    const cmp = bothNumbers
      ? aVal - bVal
      : String(aVal ?? '').localeCompare(String(bVal ?? ''), 'ru');
    return sortOrder === 'desc' ? -cmp : cmp;
  });
}

/** Пагинация: page 1-based, срез limit строк. */
export function paginateRows<T>(rows: T[], page: number, limit: number): {
  pageRows: T[];
  total: number;
  totalPages: number;
} {
  const total = rows.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { pageRows: rows.slice(start, start + limit), total, totalPages };
}
