/**
 * upcoming.ts — «закупки, близкие к реализации» (канон п.75б, 14.08.2026).
 *
 * Владелец: «отдельно важны закупки, БЛИЗКИЕ к реализации: произойдут ли
 * сейчас или есть нюансы — риск-статус по мере приближения к плановой дате».
 *
 * Отбор СТРУКТУРНЫЙ (канон п.27 — свободный текст статусом не читается):
 * в дате заключения (Q) — заглушка отсутствия, плановая дата (N) распознана
 * и попадает в окно «ближайшие N дней» ЛИБО уже прошла (просрочка).
 *
 * Риск-контекст каждой строки:
 *   • дней до/после плановой даты (знак: минус — просрочено);
 *   • причина по словарю причин 2.0 (@aemr/shared comment-standards):
 *     сопоставление — группировка для статистики, НЕ вывод статуса; тип
 *     причины различает «провенанс прошлого» (retro) и «живую проблему
 *     текущего этапа» (live) — канон п.75а;
 *   • номер процедуры из AG (структурный парсер, канон п.74) и стадия из
 *     «Ежедневного мониторинга», если карта стадий передана вызывающим
 *     (пока вкладка мониторинга не подключена — честный null, не выдумка).
 */

import {
  DEVIATION_REASON_BY_ID,
  dayNumberOf,
  hasFactDate,
  isoOfDayNumber,
  matchDeviationReason,
  parseProcedureRef,
  type DeviationReasonId,
  type DeviationReasonKind,
} from '@aemr/shared';

/** Строка книги на входе: ключ + ячейки по буквам колонок. */
export interface UpcomingInputRow {
  /** Кириллический id книги ГРБС («УО»). */
  dept: string;
  /** 1-based номер строки листа. */
  sheetRow: number;
  cells: Record<string, unknown>;
}

export interface UpcomingOptions {
  /** «Сегодня» календаря продукта (номер суток). */
  asOfDay: number;
  /** Окно вперёд, дней. */
  days: number;
  /**
   * Карта «канонический код процедуры → стадия в мониторинге». Появится у
   * вкладки «Ежедневный мониторинг»; пока её нет — стадия честно null.
   */
  monitoringStages?: ReadonlyMap<string, string>;
}

/** Причина отклонения, распознанная словарём 2.0, с адресом ячейки-источника. */
export interface UpcomingReason {
  id: DeviationReasonId;
  /** Канон-формулировка словаря (что должно быть написано). */
  canon: string;
  /** 'retro' — провенанс прошлого; 'live' — живая проблема текущего этапа. */
  kind: DeviationReasonKind;
  /** exact — дословно канон; paraphrase — консервативный стем/похожесть. */
  match: 'exact' | 'paraphrase';
  /** Ячейка, где причина написана («U178»). */
  cell: string;
}

export interface UpcomingRiskRow {
  rowKey: string;
  dept: string;
  sheetRow: number;
  subject: string;
  method: string;
  planSum: number;
  /** Плановая дата ISO — строки без распознанной плановой даты в выборку не входят. */
  plannedDate: string;
  /** Дней до плановой даты; отрицательное — дней ПОСЛЕ (просрочка). */
  daysToPlan: number;
  overdue: boolean;
  /** Причина по словарю 2.0; null — причины в U/AE/AF словарь не распознал. */
  reason: UpcomingReason | null;
  /** Есть ли ЖИВАЯ причина текущего этапа (reason.kind === 'live'). */
  hasLiveReason: boolean;
  /** Канонический номер процедуры из AG («ЭА152-26»); null — кода нет/искажён. */
  procedureCode: string | null;
  /** Стадия процедуры в «Ежедневном мониторинге»; null — связки нет. */
  monitoringStage: string | null;
}

/** Число из ячейки листа (формат оператора «1 234,56»); мусор → 0. */
function sheetNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val ?? '').trim();
  if (s === '') return 0;
  const parsed = parseFloat(s.replace(/\s/g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Ячейки-кандидаты причины в порядке приоритета: U — колонка «Причина
 * отклонения» по шапке; AE/AF — где причины реально размазаны у операторов
 * (спека §2.6: AF 300 ячеек, U 298, AE 67).
 */
const REASON_LETTERS = ['U', 'AE', 'AF'] as const;

/** Первая распознанная словарём 2.0 причина из U/AE/AF, с адресом ячейки. */
function findReason(cells: Record<string, unknown>, sheetRow: number): UpcomingReason | null {
  for (const letter of REASON_LETTERS) {
    const matched = matchDeviationReason(cells[letter]);
    if (matched === null) continue;
    const entry = DEVIATION_REASON_BY_ID.get(matched.id);
    if (!entry) continue;
    return {
      id: matched.id,
      canon: entry.text,
      kind: entry.kind,
      match: matched.match,
      cell: `${letter}${sheetRow}`,
    };
  }
  return null;
}

/**
 * Отбирает строки, близкие к реализации (или просроченные), и собирает
 * риск-контекст. Чистая функция; служебные строки листа (итоги, шапки)
 * обязан отсеять вызывающий (isDataRow на стороне сервера).
 */
export function buildUpcoming(
  rows: readonly UpcomingInputRow[],
  options: UpcomingOptions,
): UpcomingRiskRow[] {
  const horizon = options.asOfDay + options.days;
  const out: UpcomingRiskRow[] = [];

  for (const row of rows) {
    // Структурный гейт: заключения нет (Q — заглушка отсутствия).
    if (hasFactDate(row.cells['Q'])) continue;
    // Плановая дата распознана и уже близко (или прошла).
    const planDay = dayNumberOf(row.cells['N']);
    if (planDay === null || planDay > horizon) continue;

    const reason = findReason(row.cells, row.sheetRow);
    const procedureCode = parseProcedureRef(row.cells['AG'])?.code ?? null;

    out.push({
      rowKey: `${row.dept}:${row.sheetRow}`,
      dept: row.dept,
      sheetRow: row.sheetRow,
      subject: String(row.cells['G'] ?? '').trim(),
      method: String(row.cells['L'] ?? '').trim(),
      planSum: sheetNumber(row.cells['K']),
      plannedDate: isoOfDayNumber(planDay),
      daysToPlan: planDay - options.asOfDay,
      overdue: planDay < options.asOfDay,
      reason,
      hasLiveReason: reason?.kind === 'live',
      procedureCode,
      monitoringStage:
        procedureCode !== null ? options.monitoringStages?.get(procedureCode) ?? null : null,
    });
  }

  // Самые горящие сверху: сначала глубокая просрочка, затем по приближению даты.
  out.sort((a, b) =>
    a.daysToPlan - b.daysToPlan
    || a.dept.localeCompare(b.dept)
    || a.sheetRow - b.sheetRow,
  );
  return out;
}
