/**
 * Адреса находок датасет-аналитики (канон п.119: по каждому сработавшему
 * сигналу читателю виден ответ «какая строка, что в ней, почему»).
 *
 * Счётчик без адреса — это упрёк, а не инструмент: «сезонных аномалий 7»
 * не даёт сделать ни одного шага. Здесь тот же снимок `datasetAnalyses`,
 * который уже приезжает в браузер, разбирается до перечня строк-виновниц.
 *
 * ── Адресация строки ────────────────────────────────────────────────────
 * Детекторы ядра (`pipeline/seasonal.ts`, `pipeline/splitting.ts`) ходят по
 * СЫРЫМ значениям листа — вместе с шапкой в DEPT_HEADER_ROWS строк. Поэтому
 * их `rowIndex` — это индекс в массиве листа, а номер строки книги, который
 * читатель видит в Google Таблицах, равен `rowIndex + 1`. Другой арифметики
 * здесь быть не должно: ошибка в единице — это чужая строка на экране.
 *
 * ── Чего здесь НЕТ ──────────────────────────────────────────────────────
 * Выбросы (z-оценка) адреса не получают: ядро считает их по массиву сумм,
 * уже отфильтрованному от нечитаемых строк, и обратного пути от индекса
 * суммы к строке книги в снимке не сохранено. Вместо выдуманного адреса —
 * ПРАВИЛО с порогом в рублях (`outlierRule`): по нему строку находит сам
 * читатель, и это честнее правдоподобного, но неверного номера.
 */
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { ORG_ITSELF_LABEL } from '../subordinate-label';

/**
 * Форма находок по проводу. Типы ядра (`pipeline/seasonal.ts`,
 * `pipeline/splitting.ts`) наружу из `@aemr/core` не выведены, а снимок и без
 * того приходит как «словарь чего-то неизвестного» — поэтому форма объявлена
 * здесь, в единственном месте, которое эти поля читает, и каждое поле
 * проверяется при разборе. Расширять ядро ради витрины не требуется.
 */
export type SeasonalAnomalyType =
  | 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS'
  | 'LATE_SCHOOL_FOOD_CONTRACT'
  | 'WINTER_ROAD_WORK'
  | 'LATE_FUEL_PROCUREMENT'
  | 'BOILER_REPAIR_HEATING_SEASON'
  | 'Q4_SPENDING_SPIKE'
  | 'DECEMBER_RUSH_CONTRACT';

type SeasonalSeverity = 'critical' | 'high' | 'medium';

interface SeasonalAnomalyDTO {
  type: SeasonalAnomalyType;
  severity: SeasonalSeverity;
  /** Индекс строки в массиве листа (с шапкой); −1 — признак по всей книге. */
  rowIndex: number;
  description: string;
  details: Record<string, unknown>;
}

interface SplittingGroupDTO {
  groupKey: string;
  rowIndices: number[];
  commonSubject: string;
  totalAmount: number;
  count: number;
}

/** Шапка книги ГРБС: три строки, данные начинаются с четвёртой. */
const SHEET_ROW_FROM_INDEX = 1;

/** Обывательские подписи сезонных признаков — без внутренних ключей на экране. */
export const SEASONAL_LABELS: Record<SeasonalAnomalyType, string> = {
  SCHOOL_REPAIR_OUTSIDE_HOLIDAYS: 'Ремонт школы в учебное время',
  LATE_SCHOOL_FOOD_CONTRACT: 'Школьное питание без контракта к 15 августа',
  WINTER_ROAD_WORK: 'Дорожные работы в зимние месяцы',
  LATE_FUEL_PROCUREMENT: 'Топливо не закуплено к отопительному сезону',
  BOILER_REPAIR_HEATING_SEASON: 'Ремонт теплоснабжения в отопительный сезон',
  Q4_SPENDING_SPIKE: 'Заключения смещены в IV квартал',
  DECEMBER_RUSH_CONTRACT: 'Декабрьское заключение в короткий срок',
};

/** Острота — словом, без «нарушений» (PRODUCT.md, строгие правила языка). */
export const SEASONAL_URGENCY: Record<SeasonalSeverity, string> = {
  critical: 'смотреть первым',
  high: 'требует внимания',
  medium: 'к сведению',
};

/** Одна сезонная находка с адресом строки книги. */
export interface SeasonalFinding {
  key: string;
  /** Номер строки книги (как в Google Таблицах); null — признак по всей книге. */
  sheetRow: number | null;
  type: SeasonalAnomalyType;
  typeLabel: string;
  severity: SeasonalSeverity;
  urgency: string;
  /** Почему сработало — фраза детектора. */
  why: string;
  /** Что в строке — предмет закупки из книги; пустая строка, если не заполнен. */
  subject: string;
  /** Чья строка внутри управления; ключ аппарата спрятан за подписью. */
  subordinate: string;
}

/** Группа строк с признаками дробления — адрес у каждой строки группы. */
export interface SplittingFinding {
  key: string;
  /** Подпись организации-заказчика внутри управления. */
  subordinate: string;
  /** Номера строк книги, попавших в группу. */
  sheetRows: number[];
  /** Общий кусок предмета, по которому строки признаны однородными. */
  commonSubject: string;
  /** Сумма группы, тыс. руб. */
  totalAmount: number;
  count: number;
}

/** Правило выброса: порог в тысячах рублей и фраза, объясняющая его. */
export interface OutlierRule {
  /** Сумма, выше которой строка считается выбросом, тыс. руб.; null — правила нет. */
  thresholdAmount: number | null;
  /** Человеческая формулировка правила. */
  text: string;
}

function readAnalysis(analyses: Record<string, unknown> | null | undefined, deptId: string): Record<string, unknown> | null {
  if (!analyses) return null;
  const raw = analyses[deptId];
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/** Подпись организации: пустая колонка C и сентинел — это аппарат управления. */
function orgLabel(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value === ORG_ITSELF_SENTINEL || value === '_org') return ORG_ITSELF_LABEL;
  return value;
}

/**
 * Сезонные находки управления с адресами строк.
 * Агрегатные признаки (по всей книге, `rowIndex === -1`) не выбрасываются:
 * у них нет строки, и это сказано словом, а не спрятано.
 */
export function selectSeasonalFindings(
  analyses: Record<string, unknown> | null | undefined,
  deptId: string,
): SeasonalFinding[] {
  const analysis = readAnalysis(analyses, deptId);
  const list = analysis?.seasonalAnomalies;
  if (!Array.isArray(list)) return [];
  const findings: SeasonalFinding[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const a = raw as Partial<SeasonalAnomalyDTO>;
    const type = a.type;
    if (!type || !(type in SEASONAL_LABELS)) return;
    const severity: SeasonalSeverity = a.severity ?? 'medium';
    const details = (a.details ?? {}) as Record<string, unknown>;
    const rowIndex = typeof a.rowIndex === 'number' ? a.rowIndex : -1;
    findings.push({
      key: `${deptId}-${type}-${rowIndex}-${i}`,
      sheetRow: rowIndex >= 0 ? rowIndex + SHEET_ROW_FROM_INDEX : null,
      type,
      typeLabel: SEASONAL_LABELS[type],
      severity,
      urgency: SEASONAL_URGENCY[severity] ?? SEASONAL_URGENCY.medium,
      why: typeof a.description === 'string' ? a.description : SEASONAL_LABELS[type],
      subject: typeof details.description === 'string' ? details.description : '',
      subordinate: orgLabel(details.subordinate),
    });
  });
  // Первым — то, что смотреть первым; внутри остроты — по строке книги.
  const rank: Record<SeasonalSeverity, number> = { critical: 0, high: 1, medium: 2 };
  return findings.sort((x, y) =>
    rank[x.severity] - rank[y.severity]
    || (x.sheetRow ?? Number.MAX_SAFE_INTEGER) - (y.sheetRow ?? Number.MAX_SAFE_INTEGER));
}

/** Группы дробления управления с номерами строк книги. */
export function selectSplittingFindings(
  analyses: Record<string, unknown> | null | undefined,
  deptId: string,
): SplittingFinding[] {
  const analysis = readAnalysis(analyses, deptId);
  const list = analysis?.suspiciousSplitting;
  if (!Array.isArray(list)) return [];
  const findings: SplittingFinding[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const g = raw as Partial<SplittingGroupDTO>;
    const indices = Array.isArray(g.rowIndices) ? g.rowIndices.filter((n: unknown) => typeof n === 'number') : [];
    if (indices.length === 0) return;
    findings.push({
      key: `${deptId}-split-${i}`,
      subordinate: orgLabel(g.groupKey),
      sheetRows: indices.map((n: number) => n + SHEET_ROW_FROM_INDEX).sort((a: number, b: number) => a - b),
      commonSubject: typeof g.commonSubject === 'string' ? g.commonSubject : '',
      totalAmount: typeof g.totalAmount === 'number' ? g.totalAmount : 0,
      count: typeof g.count === 'number' ? g.count : indices.length,
    });
  });
  return findings.sort((x, y) => y.totalAmount - x.totalAmount);
}

/**
 * Правило выброса словами. Порог = типичная сумма + N разбросов, ровно так
 * же, как считает ядро; ниже порога строка выбросом не считается.
 */
export function outlierRule(input: {
  outlierCount: number;
  outlierMean: number | null;
  outlierStdDev: number | null;
  outlierThreshold: number | null;
}): OutlierRule {
  const { outlierCount, outlierMean, outlierStdDev, outlierThreshold } = input;
  if (outlierCount === 0) {
    return {
      thresholdAmount: null,
      text: 'Выбросов нет: все суммы книги лежат в типичном коридоре — искать нечего.',
    };
  }
  if (outlierMean === null || outlierStdDev === null || outlierThreshold === null) {
    return {
      thresholdAmount: null,
      text: 'Снимок не сохранил параметры расчёта выбросов — порог назвать не по чему. '
        + 'Обновите данные: параметры считаются при разборе книг.',
    };
  }
  const thresholdAmount = outlierMean + outlierThreshold * outlierStdDev;
  return {
    thresholdAmount,
    text: `Выбросом считается строка с планом дороже ${Math.round(thresholdAmount).toLocaleString('ru-RU')} тыс. руб. `
      + `(типичная сумма ${Math.round(outlierMean).toLocaleString('ru-RU')} плюс ${outlierThreshold} разброса по ${Math.round(outlierStdDev).toLocaleString('ru-RU')}). `
      + 'Номеров строк снимок не сохранил — открыть книгу и отсортировать по плану по убыванию: выбросы стоят сверху.',
  };
}

/** Разложить находки по организациям управления (режим «с подведомственными»). */
export function groupFindingsBySubordinate<T extends { subordinate: string }>(
  findings: readonly T[],
): Array<{ label: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const f of findings) {
    const bucket = buckets.get(f.subordinate);
    if (bucket) bucket.push(f);
    else buckets.set(f.subordinate, [f]);
  }
  return [...buckets.entries()]
    .map(([label, items]) => ({ label, items }))
    // Аппарат — первым (порядок канона разбивки), дальше учреждения по алфавиту.
    .sort((a, b) => {
      if (a.label === ORG_ITSELF_LABEL) return -1;
      if (b.label === ORG_ITSELF_LABEL) return 1;
      return a.label.localeCompare(b.label, 'ru');
    });
}
