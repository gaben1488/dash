/**
 * Query-фильтры списка строк /api/rows/:deptId (E11-2, rethink 2026-07-22).
 * Чистые функции от (rows, параметры запроса) — никакого чтения store/глобалей.
 * Инвариант каждого фильтра: пустой параметр = всё проходит (массив как есть).
 * Осевые каноны — из @aemr/shared: способы (METHOD_FAMILY_MAP), «само управление»
 * (isOrgItself), активность ТД/ПМ (matchesActivityScope).
 */
import {
  METHOD_FAMILY_MAP,
  ORG_ITSELF_SENTINEL,
  isOrgItself,
  matchesActivityScope,
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

/** Разбор query.year: 'all'/мусор/вне [2020..2100] → undefined (фильтр выключен). */
export function parseYearFilter(yearRaw: string | undefined): number | undefined {
  if (!yearRaw || yearRaw === 'all') return undefined;
  const n = parseInt(yearRaw, 10);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : undefined;
}

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

/** Тип закупки по колонке L = METHOD: ЭА/ЭК/ЭЗК = КП (competitive); ЕП = single. */
export function applyTypeFilter<T extends FilterableRow>(rows: T[], filterType: string): T[] {
  const codes = METHODS_BY_TYPE_FILTER[filterType];
  if (!codes) return rows; // пусто или нераспознанное значение — всё проходит
  return rows.filter(r => codes.includes(r.method.toUpperCase()));
}

/**
 * Фильтр по подведу (колонка C = SUBORDINATE), список через запятую.
 * `_org_itself` — валидный фильтр «Аппарат управления» (фильтр-спека 16.07 Б4):
 * матчит строки-закупки самого управления по канон-предикату isOrgItself
 * (пусто / самоссылка X/Х/тире / плейсхолдеры «н/д», «нет» — единый канон оси C).
 * filterSubordinate уже trim + lower-case (как в исходном роуте).
 */
export function applySubordinateFilter<T extends FilterableRow>(rows: T[], filterSubordinate: string): T[] {
  if (!filterSubordinate) return rows;
  const subs = filterSubordinate.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const wantsOrgItself = subs.includes(ORG_ITSELF_SENTINEL);
  const nameSubs = subs.filter(s => s !== ORG_ITSELF_SENTINEL);
  return rows.filter(r => {
    if (wantsOrgItself && isOrgItself(r.subordinate)) return true;
    const sub = String(r.subordinate ?? '').trim().toLowerCase();
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
  return rows.filter(r => {
    switch (filterActivity) {
      case 'program':
        return matchesActivityScope('pm', r.type);
      case 'current_program':
      case 'current_non_program':
        return matchesActivityScope('td', r.type);
      default:
        return String(r.type).toLowerCase().includes(filterActivity);
    }
  });
}

/** Фильтр по состоянию строки (RowState). */
export function applyStateFilter<T extends FilterableRow>(rows: T[], filterState: string): T[] {
  if (!filterState) return rows;
  return rows.filter(r => r.state === filterState);
}

/**
 * Фильтр по году плана (колонка P = PLAN_YEAR). Строки без года (planYear=0)
 * остаются видимыми — консистентно с calc-engine.ts:440.
 */
export function applyYearFilter<T extends FilterableRow>(rows: T[], yearFilter: number | undefined): T[] {
  if (!yearFilter) return rows;
  return rows.filter(r => r.planYear === 0 || r.planYear === yearFilter);
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
