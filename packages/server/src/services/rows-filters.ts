/**
 * Query-фильтры списка строк /api/rows/:deptId (E11-2).
 * Извлечено move-only из routes/rows.ts (GET /api/rows/:deptId, ~стр. 77–315).
 * Чистые функции от (rows, параметры запроса) — никакого чтения store/глобалей.
 * Инвариант каждого фильтра: пустой параметр = всё проходит (массив возвращается как есть).
 */

/** Минимальная форма строки, которую режут фильтры (RowDto ей удовлетворяет). */
export interface FilterableRow {
  subject: unknown;
  method: string;
  status: unknown;
  regNumber: unknown;
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

/** Поиск по предмету/способу/статусу/реестровому номеру/подведу (searchTerm уже lower-case). */
export function applySearchFilter<T extends FilterableRow>(rows: T[], searchTerm: string): T[] {
  if (!searchTerm) return rows;
  return rows.filter(r =>
    String(r.subject).toLowerCase().includes(searchTerm) ||
    String(r.method).toLowerCase().includes(searchTerm) ||
    String(r.status).toLowerCase().includes(searchTerm) ||
    String(r.regNumber).toLowerCase().includes(searchTerm) ||
    String(r.subordinate).toLowerCase().includes(searchTerm),
  );
}

/** Тип закупки по колонке L = METHOD: ЭА/ЭК/ЭЗК = КП (competitive); ЕП = single. */
export function applyTypeFilter<T extends FilterableRow>(rows: T[], filterType: string): T[] {
  if (filterType === 'competitive' || filterType === 'КП') {
    return rows.filter(r => {
      const m = r.method.toUpperCase();
      return m === 'ЭА' || m === 'ЭК' || m === 'ЭЗК';
    });
  }
  if (filterType === 'single' || filterType === 'ЕП') {
    return rows.filter(r => r.method.toUpperCase() === 'ЕП');
  }
  return rows;
}

/**
 * Фильтр по подведу (колонка C = SUBORDINATE), список через запятую.
 * `_org_itself` — валидный фильтр «Аппарат управления» (фильтр-спека 16.07 Б4):
 * матчит строки, где C пуст или самоссылка (Х/X) — закупки самого управления.
 * filterSubordinate уже trim + lower-case (как в исходном роуте).
 */
export function applySubordinateFilter<T extends FilterableRow>(rows: T[], filterSubordinate: string): T[] {
  if (!filterSubordinate) return rows;
  const subs = filterSubordinate.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const wantsOrgItself = subs.includes('_org_itself');
  const nameSubs = subs.filter(s => s !== '_org_itself');
  return rows.filter(r => {
    const raw = String(r.subordinate ?? '').trim();
    const sub = raw.toLowerCase();
    if (wantsOrgItself && (raw === '' || /^[xх]$/i.test(raw))) return true;
    return nameSubs.some(s => sub.includes(s));
  });
}

/**
 * Фильтр по виду деятельности (колонка F = TYPE + колонка D program name).
 * F = "Текущая деятельность" / "Программное мероприятие".
 * ТД sub-classification: наличие реального текста ПМ в D → в рамках ПМ, иначе (X/x/Х/х/пусто) → вне ПМ.
 */
export function applyActivityFilter<T extends FilterableRow>(rows: T[], filterActivity: string): T[] {
  if (!filterActivity) return rows;
  return rows.filter(r => {
    const at = String(r.type).toLowerCase();
    const pmVal = String(r.programName ?? '').trim();
    const hasPM = pmVal.length > 0 && !/^[XxХх]$/u.test(pmVal);
    switch (filterActivity) {
      case 'program':
        return at.includes('программное мероприятие');
      case 'current_program':
        return at.includes('текущая') && hasPM;
      case 'current_non_program':
        return at.includes('текущая') && !hasPM;
      default:
        return at.includes(filterActivity);
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
    const aNum = typeof aVal === 'number' ? aVal : NaN;
    const bNum = typeof bVal === 'number' ? bVal : NaN;

    let cmp: number;
    if (!isNaN(aNum) && !isNaN(bNum)) {
      cmp = aNum - bNum;
    } else {
      cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''), 'ru');
    }
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
