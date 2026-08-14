/**
 * Группировка замечаний по МЕХАНИЗМУ — ядро карточки диагноста (канон п.53
 * интервью 14.08.2026).
 *
 * Слова владельца: каждое расхождение предъявляется карточкой из трёх частей —
 * (1) механизм простыми словами, (2) строка/ячейка-виновница адресом листа,
 * (3) действие с адресатом. Сотни строк «строка N: предмет» без причины
 * хоронят настоящие ошибки — поэтому одна карточка = один КЛАСС проверки,
 * а не одна строка книги; адреса строк живут внутри карточки раскрываемым
 * списком.
 *
 * Правила, которые держит модуль:
 *   • Заголовок карточки — механизм, никогда не предмет закупки и не голое
 *     «Критично» (запрет канона п.53).
 *   • Ни одного внутреннего латинского ключа наружу: подпись берётся из
 *     словаря продукта, затем из русского заголовка проверки; латиница
 *     заменяется честной заглушкой.
 *   • Сигналы, снятые каноном (td_with_program, п.30), в карточки не
 *     попадают, даже если лежат в старых снимках: ядро их больше не рождает,
 *     а интерфейс — не показывает.
 *   • Подавление следствий (п.34) выполняет ядро (detectSignals): строка
 *     «не обеспечена финансированием» не получает вдобавок «план без
 *     исполнения». Модуль ничего не додумывает — группирует то, что пришло.
 */

/** Минимальный вид замечания, достаточный для карточки диагноста. */
export interface DiagnosticIssueLike {
  id?: string;
  severity?: string;
  title?: string;
  description?: string;
  signal?: string;
  checkId?: string;
  category?: string;
  kbHint?: string;
  recommendation?: string;
  sheet?: string;
  cell?: string;
  row?: number;
  department?: string;
  departmentId?: string;
}

/** Адрес строки-виновницы: лист + строка (+ ячейка, если проверка её знает). */
export interface DiagnosticAddress {
  /** Ключ управления (для подписи словарём продукта на стороне UI). */
  dept: string;
  sheet?: string;
  row?: number;
  cell?: string;
  /** Предмет закупки строки — контекст адреса, не заголовок. */
  subject?: string;
  /** Ссылка на исходное замечание (переходы, статусы). */
  issueId?: string;
}

/** Одна карточка диагноста: механизм + адреса + действие. */
export interface MechanismGroup {
  /** Стабильный ключ группы (checkId/сигнал/префикс заголовка). */
  key: string;
  /** Заголовок-механизм по-русски. */
  label: string;
  /** Худшая серьёзность внутри группы. */
  severity: string;
  /** Число строк-виновниц. */
  count: number;
  /** Механизм простыми словами (kbHint реестра проверок), если проверка его несёт. */
  kbHint?: string;
  /** Действие с адресатом (recommendation реестра проверок). */
  recommendation?: string;
  /** Адреса строк-виновниц, в порядке поступления. */
  addresses: DiagnosticAddress[];
  /** Исходные замечания группы (для развёртки в рабочий список). */
  issues: DiagnosticIssueLike[];
}

/** Проверки, снятые каноном: старые снимки могут их хранить — экран не показывает. */
const RETIRED_CHECK_IDS: ReadonlySet<string> = new Set(['td_with_program']);
const RETIRED_SIGNALS: ReadonlySet<string> = new Set(['tdWithProgram']);

/** Замечание снятой каноном проверки (п.30): в интерфейс не допускается. */
export function isRetiredIssue(issue: DiagnosticIssueLike): boolean {
  return (issue.checkId !== undefined && RETIRED_CHECK_IDS.has(issue.checkId))
    || (issue.signal !== undefined && RETIRED_SIGNALS.has(issue.signal));
}

/** Порядок серьёзности: чем больше, тем раньше карточка в выдаче. */
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 5,
  error: 4,
  significant: 3,
  warning: 2,
  info: 1,
};

function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[severity ?? ''] ?? 0;
}

/** Латиница без единой кириллической буквы — внутренний ключ, не подпись. */
function isUntranslated(value: string): boolean {
  return /[A-Za-z_]/.test(value) && !/[А-Яа-яЁё]/.test(value);
}

/** Честная заглушка вместо латинского ключа на экране. */
export const MECHANISM_FALLBACK_LABEL = 'Проверка без подписи в словаре';

/**
 * Заголовок-механизм замечания.
 *
 * Конвейер собирает title как «Имя проверки: предмет закупки» (сигналы) либо
 * «Имя правила: лист „X", строка N» (правила листа) — берём часть до первого
 * ": ": это и есть механизм. Словарь продукта (переданный переводчиком
 * `labelOf`) главнее: его подписи согласованы со всей системой.
 */
export function mechanismLabel(
  issue: DiagnosticIssueLike,
  labelOf?: (key: string) => string,
): string {
  if (issue.signal && labelOf) {
    const dict = labelOf(issue.signal);
    if (dict && dict !== issue.signal && !isUntranslated(dict)) return dict;
  }
  const title = (issue.title ?? '').trim();
  if (title) {
    const idx = title.indexOf(': ');
    const head = idx > 0 ? title.slice(0, idx).trim() : title;
    if (head && !isUntranslated(head)) return head;
  }
  return MECHANISM_FALLBACK_LABEL;
}

/** Стабильный ключ группы: сначала id проверки, потом сигнал, потом заголовок. */
function mechanismKey(issue: DiagnosticIssueLike, label: string): string {
  return issue.checkId ?? issue.signal ?? `title:${label}`;
}

/**
 * Предмет закупки из заголовка «Механизм: предмет». Для правил листа
 * («…: лист „X", строка N») предмет отсутствует — возвращается undefined,
 * адрес и так называет лист и строку.
 */
function subjectOf(issue: DiagnosticIssueLike): string | undefined {
  const title = (issue.title ?? '').trim();
  const idx = title.indexOf(': ');
  if (idx <= 0) return undefined;
  const tail = title.slice(idx + 2).trim();
  if (!tail || /^лист\s/.test(tail) || /^строка\s+\d+$/.test(tail)) return undefined;
  return tail;
}

/**
 * Свёртка простыни замечаний в карточки диагноста: одна карточка — один
 * механизм. Порядок карточек: серьёзность (худшая раньше), затем размер
 * группы (крупнее раньше) — настоящие ошибки не тонут в шуме.
 */
export function groupIssuesByMechanism(
  issues: readonly DiagnosticIssueLike[],
  labelOf?: (key: string) => string,
): MechanismGroup[] {
  const groups = new Map<string, MechanismGroup>();

  for (const issue of issues) {
    if (isRetiredIssue(issue)) continue;
    const label = mechanismLabel(issue, labelOf);
    const key = mechanismKey(issue, label);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label,
        severity: issue.severity ?? 'info',
        count: 0,
        kbHint: issue.kbHint,
        recommendation: issue.recommendation,
        addresses: [],
        issues: [],
      };
      groups.set(key, group);
    }

    group.count += 1;
    group.issues.push(issue);
    if (severityRank(issue.severity) > severityRank(group.severity)) {
      group.severity = issue.severity ?? group.severity;
    }
    // Подсказка и действие — первые непустые в группе: у одного механизма
    // они одинаковые по построению (CHECK_REGISTRY), пустые не затирают.
    if (!group.kbHint && issue.kbHint) group.kbHint = issue.kbHint;
    if (!group.recommendation && issue.recommendation) group.recommendation = issue.recommendation;

    group.addresses.push({
      dept: issue.departmentId ?? issue.department ?? '',
      sheet: issue.sheet,
      row: issue.row,
      cell: issue.cell,
      subject: subjectOf(issue),
      issueId: issue.id,
    });
  }

  return [...groups.values()].sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    return b.count - a.count;
  });
}
