/**
 * contract.ts — форма ответа GET /api/provenance/:deptId/:rowSeq на стороне
 * экрана (провенанс плановой суммы одной закупки).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Типы нужны и хуку загрузки, и чистой витрине, и её
 * тестам. Держать их в хуке значило бы тянуть React в модуль, который считает
 * подписи, а тянуть в витрину — заставлять хук зависеть от оформления. Здесь у
 * контракта свой дом, и оба соседа зависят только от него.
 *
 * Событие, сводка и наблюдаемость приходят из ядра (@aemr/core) без изменений:
 * классификация правок — дело ядра (канон п.102), экрана — слова и порядок.
 */
import type { PlanEvent, PlanObservability, PlanProvenanceSummary } from '@aemr/core';

export type { PlanEvent, PlanEventKind, PlanObservability, PlanProvenanceSummary } from '@aemr/core';

/**
 * Ответ провенанса по строке. Поля сервера, которых нет у ядра, отвечают на
 * вопрос «можно ли вообще судить»: journalAvailable отличает «журнал прочитан и
 * молчит» от «журнал не прочитан», journalRowKeyless считает записи, которые
 * физически не привязываются ни к одной закупке (укороченная шапка журнала,
 * живой случай УАГЗО).
 */
export interface RowProvenanceResponse {
  /** Канонический идентификатор управления («УКСиМП»). */
  dept: string;
  deptLatin: string;
  deptName: string;
  sheetName: string;
  /** «№ п/п» закупки — ключ, которым журнал правок помечает строку. */
  rowSeq: number;
  /** Номер строки листа (1-based) — адрес для глаз, он подвижен. */
  sheetRow: number;
  subject: string;
  /** Текущее «ИТОГО план» (ячейка K), тыс. руб.; null — плана нет. */
  planNow: number | null;
  /** Дата заключения (ISO) или null — контракт не заключён. */
  factDate: string | null;
  method: string;
  /** false — книгу прочитать не удалось: это НЕ «правок не было». */
  journalAvailable: boolean;
  /** Русская причина, почему книга не прочитана. */
  journalError?: string;
  /** Записей журнала без поля «Строка» — их не привязать ни к одной закупке. */
  journalRowKeyless: number;
  events: PlanEvent[];
  summary: PlanProvenanceSummary;
  observability: PlanObservability;
  /** Дубли «№ п/п»: история такой строки неотделима от истории близнеца. */
  ambiguity: { sheetRows: number[]; note: string } | null;
}
