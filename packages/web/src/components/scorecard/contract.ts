import { PRODUCT_COPY } from '@aemr/shared';
/**
 * Договор с сервером по оценке управлений: грейд, индекс дисциплины и
 * нарушения норм 44-ФЗ (маяк продукта, Г-06 и Г-09).
 *
 * ДВА МАРШРУТА, ОДИН ЭКРАН. `/api/analytics/scorecard` считает по каждому ГРБС
 * грейд A–D, индекс дисциплины 0–100, нарративный режим и до трёх антикор-флагов;
 * `/api/analytics/compliance` — нарушения норм закона построчно. Оба отвечали
 * с первого дня и оба до 18.08.2026 не имели на клиенте ни обёртки, ни экрана.
 *
 * ЧТО ЭТОТ ФАЙЛ ОБЯЗАН УДЕРЖАТЬ, ЧЕГО НЕ ДЕРЖИТ ОТВЕТ СЕРВЕРА.
 *
 * 1. **Ориентир не подтверждён.** Ожидаемое исполнение, нормальная доля ЕП и
 *    сама роль управления взяты из легаси-генератора предыдущей команды
 *    (procurement_report.gs) — источника в данных у них нет. Ядро говорит это
 *    вслух константой `BASELINE_UNCONFIRMED_NOTE`, но ответ `/scorecard` её не
 *    передаёт: маршрут отдаёт уже готовый грейд. Экран обязан произнести
 *    оговорку сам, иначе внутренний ориентир читается как норма закона.
 *
 * 2. **Периметр оценки — не тот, что в шапке.** Исполнение берётся за ПЕРВЫЙ
 *    квартал (`profile.actualExecQ1`), доля ЕП — по плановым деньгам за ГОД
 *    (`recalc.epSharePct`), а фильтры шапки маршрут не принимает вовсе. Бейдж
 *    выбранного периода здесь был бы ложью — канон п.58(б).
 *
 * 3. **Антидемпинг считается не по закону.** Статья 37 меряет снижение от
 *    НМЦК; НМЦК в книгах ГРБС нет, и проверка берёт снижение от планового
 *    лимита. Это долг Д-16 маяка, и карточка обязана назвать подмену, а не
 *    выдавать её за норму.
 *
 * Латиница ключей наружу не выходит: всё, что видит читатель, переводится
 * словарями ниже.
 */
import { DEPARTMENTS, DEPT_COLUMNS } from '@aemr/shared';
import type {
  AntiCorruptionFlag,
  AntiCorruptionIndicator,
  ComplianceIssue,
  DominantFactor,
  Grade,
  GRBSRole,
  NarrativeMode,
} from '@aemr/core';
import type { DiagnosticIssueLike } from '../../lib/diagnostics/mechanism-groups';

// ────────────────────────────────────────────────────────────
// 1. Форма ответов
// ────────────────────────────────────────────────────────────

/** Управление, которое оценить не из чего: плана нет — грейда нет. */
export interface ScorecardNoData {
  grbsShort: string;
  role: GRBSRole;
  noData: true;
  noDataReason: string;
}

/** Оценённое управление: три слоя движка решений — грейд, дисциплина, флаги. */
export interface ScorecardGraded {
  grbsShort: string;
  role: GRBSRole;
  noData?: false;
  grade: Grade;
  gradeScore: number;
  gradeReasons: string[];
  discipline: number;
  mode: NarrativeMode;
  dominantFactor: DominantFactor;
  narrative: string;
  anticorruptionFlags: number;
  topFlags: AntiCorruptionFlag[];
  /** Доля 0..1 — исполнение ПЕРВОГО квартала, не выбранного периода. */
  execPct: number;
  /** Доля 0..1 — доля ЕП в плановых деньгах ГОДА. */
  epShare: number;
  riskLevel: 'low' | 'medium' | 'high';
}

/** Facts exist, but no approved methodology supports a grade or penalty. */
export interface ScorecardUnassessed {
  grbsShort: string;
  role: GRBSRole;
  noData?: false;
  assessmentStatus: 'unconfirmed_methodology';
  assessmentReason: string;
  dataQuality: number | null;
  execPct: number;
  epShare: number;
  topFlags: AntiCorruptionFlag[];
  anticorruptionFlags: number;
}

export type ScorecardEntry = ScorecardGraded | ScorecardNoData | ScorecardUnassessed;

/** Ответ `/api/analytics/scorecard`: ключ — латинский идентификатор ГРБС. */
export type ScorecardResponse = Record<string, ScorecardEntry>;

/** Ответ `/api/analytics/compliance`. */
export interface ComplianceResponse {
  totalIssues: number;
  critical: number;
  warnings: number;
  issues: ComplianceIssue[];
  unavailableChecks?: Array<{ ruleCode: string; status: 'insufficient_data'; reason: string }>;
}

/** Оба ответа плюс момент, когда их прочитал клиент. */
export interface ScorecardData {
  scorecard: ScorecardResponse;
  compliance: ComplianceResponse | null;
  /** Отказ по нарушениям закона отдельно: грейд без него всё равно показывается. */
  complianceError: string | null;
  /** ISO-момент получения ответа — плашка периода данных, канон п.58. */
  readAt: string;
}

export function isGraded(entry: ScorecardEntry): entry is ScorecardGraded {
  return entry.noData !== true && !('assessmentStatus' in entry);
}

// ────────────────────────────────────────────────────────────
// 2. Словари: ключ движка → человеческая фраза
// ────────────────────────────────────────────────────────────

/** Что означает буква грейда. Формулировка — про исполнение, не про людей. */
export const GRADE_MEANING: Readonly<Record<Grade, string>> = {
  A: 'Исполнение на уровне ожидания или выше, нарушений и аномалий проверки не нашли.',
  B: 'Лёгкое отставание от ожидания либо одно-два замечания.',
  C: 'Отставание от ожидания заметное либо в суммах есть аномалии.',
  D: 'Отставание больше четверти вместе с нарушениями норм закона.',
};

/** Цвет несёт значение буквы, а не украшает. Обе темы проверены. */
export const GRADE_STYLE: Readonly<Record<Grade, string>> = {
  A: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  B: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  C: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  D: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
};

/**
 * Нарративный режим движка. Слова движка — заглавные ярлыки («ТРЕВОГА»),
 * на экран они не выходят: читателю нужна фраза, а не ярлык.
 */
export const MODE_LABEL: Readonly<Record<NarrativeMode, string>> = PRODUCT_COPY["components/scorecard/contract:MODE_LABEL"];

/** Что именно тянет индекс вниз сильнее прочего. */
export const FACTOR_LABEL: Readonly<Record<DominantFactor, string>> = PRODUCT_COPY["components/scorecard/contract:FACTOR_LABEL"];

/** Роль управления — тот самый неподтверждённый ориентир, отсюда осторожная подпись. */
export const ROLE_LABEL: Readonly<Record<GRBSRole, string>> = PRODUCT_COPY["components/scorecard/contract:ROLE_LABEL"];

/** Антикор-индикаторы: имя механизма по-русски. */
export const INDICATOR_LABEL: Readonly<Record<AntiCorruptionIndicator, string>> = PRODUCT_COPY["components/scorecard/contract:INDICATOR_LABEL"];

/**
 * Оговорка о происхождении ориентира. Текст держится здесь, а не берётся из
 * `BASELINE_UNCONFIRMED_NOTE`: та константа написана для потребителя API и
 * называет поля латинскими именами, на экран им нельзя (закон продукта).
 */
export const BASELINE_CAVEAT =
  'Ожидаемое исполнение, нормальная доля ЕП и сама роль управления — внутренний ' +
  'ориентир, унаследованный от прежнего генератора отчётов. Документа за ними нет: ' +
  'это не норма закона и не решение финансового органа. Поэтому текущий грейд и индекс ' +
  'дисциплины не выставляются. Фактические показатели доступны отдельно. ' +
  'Сигналы требуют проверки и сами по себе не штрафуют дисциплину. ' +
  'Конкуренция и завышение начальной цены по официальной экономии не оцениваются: нужны сведения о торгах и НМЦК.';

/** Собственный периметр оценки — своими словами, канон п.58 + п.127. */
export const PERIMETER_CAVEAT =
  'исполнение — за 1 кв, доля ЕП — по плановым деньгам года; фильтры шапки по периоду ' +
  'на эти числа не действуют, выбранное управление сужает таблицу';

// ────────────────────────────────────────────────────────────
// 3. Нарушения норм закона → карточки диагноста (канон п.53)
// ────────────────────────────────────────────────────────────

/** Механизм и действие для каждой проверки закона: три части карточки п.53. */
interface RuleCard {
  /** Заголовок-механизм. Без двоеточия: карточка берёт его целиком. */
  label: string;
  /** Механизм простыми словами. */
  mechanism: string;
  /** Действие с адресатом. */
  action: string;
  /** Колонка книги, в которой лежит число-виновница (адрес до ячейки). */
  column?: keyof typeof DEPT_COLUMNS;
}

const RULE_CARDS: Readonly<Record<string, RuleCard>> = {
  ep_contract_limit: {
    label: 'Недостаточно данных для проверки сумм отдельных договоров',
    mechanism:
      'Плановая сумма строки ЕП выше справочного порога малой закупки. Строка может ' +
      'объединять несколько договоров или иметь другое правовое основание. ' +
      'Цена отдельного договора и применимость ограничения не установлены.',
    action:
      'Исполнителю управления: предоставить состав договоров, их суммы и основания. ' +
      'Достоверные плановые суммы и основания ради снятия этого признака не изменять.',
    column: 'TOTAL_PLAN',
  },
  anti_dumping: {
    label: 'Снижение больше четверти — проверка антидемпинга',
    mechanism:
      'Для проверки нужны подтверждённые НМЦК, предложенная цена и условия применения. ' +
      'Плановая сумма и учтённая экономия не заменяют эти сведения. ' +
      'Историческое срабатывание по их отношению не доказывает нарушение.',
    action:
      'Экономисту: сверить строку с извещением о закупке — начальная цена лежит в книге ' +
      'ежедневного мониторинга, и снижение надо мерить от неё.',
  },
  ep_share_role: {
    label: 'Доля единственного поставщика выше ориентира роли',
    mechanism:
      'Доля закупок у единственного поставщика превышает ориентир, заданный роли ' +
      'управления. Ориентир документом не подтверждён — см. оговорку над таблицей.',
    action:
      'Начальнику управления: посмотреть, какие предметы дали долю. Разбор причин — ' +
      'на вкладке «Конкуренция», блок обоснованности ЕП.',
  },
  ep_annual_absolute: {
    label: 'Недостаточно данных для проверки годовых ограничений ЕП',
    mechanism:
      'Общий объём ЕП управления объединяет заказчиков и разные основания. ' +
      'Из него нельзя установить превышение применимого годового ограничения.',
    action:
      'Разделить сведения по заказчикам, финансовому году и правовым основаниям. ' +
      'Затем проверить применимые ограничения; не уменьшать достоверный план ради счётчика.',
  },
};

/** Индекс колонки (0-based) → буква A1: 10 → «K». */
function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Латинский идентификатор ГРБС → кириллическое имя и лист его книги. */
const DEPT_BY_ID = new Map(DEPARTMENTS.map((d) => [d.id, d]));

/**
 * Нарушения норм закона в вид, который понимает карточка диагноста.
 *
 * Заголовки движка (`title`, `description`) на экран НЕ выходят: они писались
 * для отладки, несут знак ₽ и номер строки внутри заголовка, отчего простыня
 * замечаний не сворачивается в классы. Механизм, действие и адрес берутся из
 * словаря выше, число-виновница — из самого замечания.
 */
export function toDiagnosticIssues(
  issues: readonly ComplianceIssue[],
): DiagnosticIssueLike[] {
  return issues.map((issue, i) => {
    const card = RULE_CARDS[issue.ruleCode];
    const dept = DEPT_BY_ID.get(issue.grbsId);
    const column = card?.column ? DEPT_COLUMNS[card.column] : undefined;
    return {
      id: `compliance-${issue.ruleCode}-${issue.grbsId}-${issue.rowIndex ?? i}`,
      checkId: issue.ruleCode,
      severity: issue.severity,
      // Подпись механизма: своя, если проверка известна; иначе — честная
      // заглушка вместо латинского кода правила.
      title: card?.label ?? 'Проверка нормы закона без подписи в словаре',
      kbHint: card?.mechanism,
      recommendation: card?.action,
      departmentId: dept?.nameShort ?? issue.grbsId,
      sheet: dept?.sheetName,
      row: issue.rowIndex,
      cell:
        issue.rowIndex !== undefined && column !== undefined
          ? `${columnLetter(column)}${issue.rowIndex}`
          : undefined,
    };
  });
}

// ────────────────────────────────────────────────────────────
// 4. Порядок строк и форматы
// ────────────────────────────────────────────────────────────

/** Одна строка таблицы: ключ ГРБС вместе с его оценкой. */
export interface ScorecardRow {
  grbsId: string;
  entry: ScorecardEntry;
}

/**
 * Порядок: сначала оценённые по индексу дисциплины возрастанием (кому нужнее
 * внимание — выше), затем неоценённые. Неоценённые не задвигаются в конец
 * как «худшие»: у них вообще нет числа, и место в хвосте означает лишь то,
 * что сравнивать их не с чем.
 */
export function sortScorecard(response: ScorecardResponse): ScorecardRow[] {
  const rows = Object.entries(response).map(([grbsId, entry]) => ({ grbsId, entry }));
  return rows.sort((a, b) => {
    const ga = isGraded(a.entry);
    const gb = isGraded(b.entry);
    if (ga !== gb) return ga ? -1 : 1;
    if (ga && gb) {
      return (a.entry as ScorecardGraded).discipline - (b.entry as ScorecardGraded).discipline;
    }
    return a.entry.grbsShort.localeCompare(b.entry.grbsShort, 'ru');
  });
}

/** Доля 0..1 → «64,5 %». */
export function fmtShare(value: number): string {
  return `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
}

/** Момент чтения ответа: «18.08.2026 в 21:04». */
export function fmtMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'момент не назван';
  const d = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const t = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${d} в ${t}`;
}

/** Карточка базы знаний секции — подсказка у заголовка. */
export const SCORECARD_KB = {
  whatIs: 'Фактические показатели управлений и сведения, требующие предметного разбора.',
  howCalc: 'Исполнение — отношение факта к плану первого квартала. Доля ЕП — доля плановых денег года. Грейд и индекс дисциплины не выдаются без подтверждённой методики.',
  dataSource: 'Книги управлений и их пересчёт. Правовые проверки отдельно показывают необходимые сведения и применимость.',
  pitfalls: 'Роль и ожидания прежнего генератора не подтверждены документом. Отсутствие замечаний не означает, что все правовые проверки выполнены.',
  actions: 'Выбрать управление, проверить основание конкретного показателя или сигнала. Состав договоров и правовые основания уточняются по документам.',
} as const;
