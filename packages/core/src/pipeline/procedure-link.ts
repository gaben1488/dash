/**
 * procedure-link.ts — связка строк книг ГРБС с процедурами «Ежедневного
 * мониторинга» по номеру процедуры из колонки AG.
 *
 * КАНОН п.74 (интервью 14.08.2026): AG — структурный ключ «номер процедуры»,
 * единственный работающий мост план → процедура (спека
 * docs/superpowers/specs/2026-08-14-comments-and-yearlong-canon.md §3:
 * запасные ключи НМЦК/предмет годятся лишь на статус «кандидат»).
 *
 * Связка ЧЕСТНАЯ: обе стороны нормализуются одним парсером
 * (@aemr/shared parseProcedureRef / extractProcedureRefs), искажённые коды
 * НЕ чинятся молча — строка книги с кодом, которого мониторинг не знает
 * (например книга «ЭА427-25» против искажённого «А427-25» в мониторинге),
 * выходит как { matched: false } и подлежит сигналу, не тихому ремонту.
 *
 * Числа волны (полные дампы 14.08.2026): в AG книг 312 ячеек ровно с одним
 * кодом (300 уникальных кодов); мониторинг (листы управлений + журнал
 * «25-26») даёт 400 уникальных кодов; связка находит процедуру для 289 из
 * 300 уникальных (96,3 %) и 301 из 312 строк (96,5 %) — «~95 %» спеки §3.1.
 */

import { parseProcedureRef, extractProcedureRefs } from '@aemr/shared';

/** Строка книги на входе связки: ключ строки + сырая ячейка AG. */
export interface ProcedureLinkRow {
  /** Ключ строки у вызывающего (например «УЭР:30» — книга + номер строки листа). */
  readonly rowKey: string;
  /** Сырое содержимое ячейки AG (как в снимке, без обработки). */
  readonly ag: unknown;
}

/** Результат связки одной строки, несущей распознанный номер процедуры. */
export interface ProcedureLink {
  readonly rowKey: string;
  /** Канонический код процедуры («ЭА152-26»). */
  readonly code: string;
  /** Нашлась ли процедура с этим кодом в карте мониторинга. */
  readonly matched: boolean;
}

/** Карта процедур мониторинга: достаточно .has(код) — подходят Set и Map. */
export interface ProcedureIndex {
  has(code: string): boolean;
}

/**
 * Строит индекс канонических кодов из ячеек мониторинга (колонка C листов
 * управлений и журнала «25-26», где код и предмет живут одной строкой).
 * Искажённые коды в индекс не попадают — их ловит отдельный сигнал
 * «нераспознанный код в мониторинге» с адресом, не эта функция.
 */
export function buildProcedureIndex(cells: Iterable<unknown>): Set<string> {
  const index = new Set<string>();
  for (const cell of cells) {
    for (const ref of extractProcedureRefs(cell)) index.add(ref.code);
  }
  return index;
}

/**
 * Связывает строки книги с процедурами мониторинга по коду из AG.
 *
 * В выход попадают ТОЛЬКО строки, чья ячейка AG — ровно один валидный код
 * (строгий parseProcedureRef): пустые, плейсхолдерные, списки кодов и
 * посторонний текст связке не подлежат — их разбирает detectForeignText
 * и сигнальный слой (п.74б).
 */
export function linkRowsToProcedures(
  rows: readonly ProcedureLinkRow[],
  procedures: ProcedureIndex,
): ProcedureLink[] {
  const links: ProcedureLink[] = [];
  for (const row of rows) {
    const ref = parseProcedureRef(row.ag);
    if (ref === null) continue;
    links.push({ rowKey: row.rowKey, code: ref.code, matched: procedures.has(ref.code) });
  }
  return links;
}
