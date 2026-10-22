import { classifySheet } from '@aemr/shared';

/**
 * Стабильный (детерминированный) id замечания.
 *
 * Фикс fidelity-аудита 2026-07-16 §5.1/§2.5: раньше id = nanoid() на каждый
 * прогон пайплайна, из-за чего статусы, сохранённые в SQLite по id,
 * орфанились при каждом пересоздании снапшота (TTL 300 с / refresh).
 *
 * Композиция id (что входит в хеш — по видам замечаний):
 *  - signal-замечания (detectSignalsToIssues):
 *      'signal' | checkId | лист | подвед (C) | рег.№ (A) | № (B) |
 *      предмет (G) | план K | порядковый № среди полных дублей
 *  - rule-замечания (validateData):
 *      'rule' | checkId | лист | столбец (для СВОД — полный cell-адрес) |
 *      A | B | предмет (G) | подвед C (для ведомственных) | occurrence
 *  - ingest-ошибки: 'ingest' | cell-адрес
 *  - unclassified_sheet: 'sheet' | имя листа
 *
 * Номер строки листа НАМЕРЕННО не входит в состав: при вставке строки выше
 * все номера сдвигаются и статусы бы орфанились. Якорь строки — её
 * содержимое (рег.№ A/B + предмет G + план K). Полные дубли строк
 * различаются порядковым номером вхождения (occurrence) — он стабилен,
 * пока стабилен порядок строк листа.
 *
 * Хеш — FNV-1a 64-bit (BigInt), первые/все 16 hex-символов. Без node:crypto,
 * чтобы core оставался изоморфным (web импортирует @aemr/core).
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
/** Непечатаемый разделитель частей — исключает коллизии на границах ('ab','c' ≠ 'a','bc'). */
export const SEP = '\u001f';

/** FNV-1a 64-bit от UTF-16 code units строки → 16 hex-символов. */
function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export type IssueIdentityPart = string | number | null | undefined;

/**
 * Чистая функция: стабильный id из упорядоченного состава частей.
 * null/undefined нормализуются в '' (отсутствие поля — тоже часть состава).
 */
export function issueIdentity(parts: ReadonlyArray<IssueIdentityPart>): string {
  const key = parts.map(p => (p === null || p === undefined ? '' : String(p))).join(SEP);
  return fnv1a64(key);
}

/**
 * Счётчик полных дублей: возвращает порядковый номер вхождения базового
 * ключа (0 для первого). Используется вызывающим кодом, чтобы два
 * идентичных по составу замечания в одном снапшоте получили разные id.
 */
export function nextOccurrence(counts: Map<string, number>, baseKey: string): number {
  const n = counts.get(baseKey) ?? 0;
  counts.set(baseKey, n + 1);
  return n;
}

/** Department addresses move; summary cells remain positional. Legacy parts are
 * retained only for proving an existing saved case, never for fuzzy matching. */
export function ruleIssueIdentityParts(checkId: string, sheet: string, cell: string, cells: Record<string, unknown>, legacy = false): IssueIdentityPart[] {
  const kind = classifySheet(sheet).kind;
  const column = /^([A-Z]+)\d+$/.exec(cell)?.[1];
  const stable = !legacy && (kind === 'department' || kind === 'subordinates_agg') && column;
  const parts: IssueIdentityPart[] = ['rule', checkId, sheet, stable ? column : cell, String(cells.A ?? ''), String(cells.B ?? ''), String(cells.G ?? '')];
  if (stable) parts.push(String(cells.C ?? ''));
  return parts;
}
