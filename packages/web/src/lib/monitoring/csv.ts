import type { MonitoringSource, RegistryProcedure } from './contract';
import type { SliceState, SortDir, SortKey } from './slices';
import { fmtReadAt, sourceCellUrl, procedureCodeLabel } from './format';
import { stageShort } from './stage-labels';

const HEADERS = ['Код процедуры', 'Управление', 'Заказчик', 'Предмет закупки', 'Стадия', 'Результат',
  'Требуемое действие', 'Замечания', 'НМЦК, руб.', 'Цена по итогам, руб.', 'Снижение, руб.', 'Снижение, %',
  'Экономия, руб.', 'Экономия ФБ, руб.', 'Экономия КБ, руб.', 'Экономия МБ, руб.',
  'Поступление заявки', 'Публикация', 'Окончание подачи', 'Подведение итогов', 'Победитель', 'ИНН победителя',
  'Флаг протокола', 'Предок', 'Наследник', 'Участники', 'Лист источника', 'Строка источника', 'Ссылка на источник',
  'Данные на', 'Область просмотра', 'Комментарий источника',
  'В текущем плане, руб.', 'Денежный результат допущен', 'Цена, учтённая по дате, руб.',
  'Экономия, учтённая по дате, руб.', 'Почему факт не учтён', 'Доли участников · деньги',
  'Параметры отбора (JSON)'];

const money = (n: number | null) => n === null ? '' : n.toFixed(2).replace('.', ',');
const text = (s: string | null | undefined) => {
  const raw = s ?? '';
  // Quoting alone does not prevent a spreadsheet from executing imported text.
  const safe = /^\s*[=+@-]/u.test(raw) ? `'${raw.trimStart()}` : raw;
  return /[";\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** A filter passport is machine-readable and records the exact user selection.
 * The displayed label alone is insufficient to recreate the selection.
 */
export interface MonitoringCsvSelection {
  slices: SliceState;
  sortKey: SortKey;
  sortDir: SortDir;
  asOf?: string | null;
}
const participantMoney = (p: RegistryProcedure): string =>
  p.participants?.map((r) =>
    `${r.dept} [${r.customer}]: НМЦК=${money(r.nmck)} ₽, цена=${money(r.price)} ₽, экономия=${money(r.savings)} ₽`).join(' | ') ?? '';

/** Caller supplies the complete sorted selection, before the table's 200-row window. */
export function buildMonitoringCsv(rows: readonly RegistryProcedure[], source: Pick<MonitoringSource, 'readAt' | 'bookUrl' | 'asOf'>, scope: string, selection?: MonitoringCsvSelection): string {
  const passport = selection ? JSON.stringify({ scope, asOf: selection.asOf ?? source.asOf ?? null, slices: selection.slices, sort: { key: selection.sortKey, direction: selection.sortDir }, moneyUnit: 'RUB', rawVsAdmitted: true }) : '';
  const lines = rows.map((p) => {
    const eligible = p.stage === 'awarded' && p.factsEligible !== false;
    const currentPlan = p.stage === 'reissued' ? null : p.nmck;
    const excluded = p.stage === 'reissued' ? 'Переоформленная попытка — только история' :
      p.stage !== 'awarded' ? 'Нет состоявшегося результата' :
      p.factsEligible === false ? 'Дата итогов не допускает денежный факт' : '';
    return [
    ...[procedureCodeLabel(p), p.dept, p.customer, p.subject, stageShort(p.stage), p.result, p.requiredAction, p.qualityNote].map(text),
    ...[p.nmck, p.auctionPrice, p.reductionRub, p.reductionPct, p.savingsTotal, p.savingsFb, p.savingsKb, p.savingsMb].map(money),
    ...[p.applicationDate, p.publicationDate, p.deadlineDate, p.auctionDate, p.winnerName, p.winnerInn, p.protocolFlag,
      p.ancestorCodes?.join('; '), p.successorCodes?.join('; '), p.participants?.map((r) => `${r.dept}: ${r.customer}`).join('; '),
      p.sheet, String(p.row), sourceCellUrl(source.bookUrl, p.sheet, `A${p.row}`), fmtReadAt(source.readAt), scope, p.comment].map(text),
    money(currentPlan), text(eligible ? 'да' : 'нет'), money(eligible ? p.auctionPrice : null),
    money(eligible ? p.savingsTotal : null), text(excluded), text(participantMoney(p)), text(passport),
  ].join(';');
  });
  return '\uFEFF' + HEADERS.join(';') + '\r\n' + lines.join('\r\n');
}
