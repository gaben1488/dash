import type { MonitoringSource, RegistryProcedure } from './contract';
import { fmtReadAt, sourceCellUrl } from './format';
import { stageShort } from './stage-labels';

const HEADERS = ['Код процедуры', 'Управление', 'Заказчик', 'Предмет закупки', 'Стадия', 'Результат',
  'Требуемое действие', 'Замечания', 'НМЦК, руб.', 'Цена по итогам, руб.', 'Снижение, руб.', 'Снижение, %',
  'Экономия, руб.', 'Экономия ФБ, руб.', 'Экономия КБ, руб.', 'Экономия МБ, руб.',
  'Поступление заявки', 'Публикация', 'Окончание подачи', 'Подведение итогов', 'Победитель', 'ИНН победителя',
  'Флаг протокола', 'Предок', 'Наследник', 'Участники', 'Лист источника', 'Строка источника', 'Ссылка на источник',
  'Данные на', 'Область просмотра'];

const money = (n: number | null) => n === null ? '' : n.toFixed(2).replace('.', ',');
const text = (s: string | null | undefined) => {
  const raw = s ?? '';
  // Quoting alone does not prevent a spreadsheet from executing imported text.
  const safe = /^\s*[=+@-]/u.test(raw) ? `'${raw.trimStart()}` : raw;
  return /[";\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** Caller supplies the complete sorted selection, before the table's 200-row window. */
export function buildMonitoringCsv(rows: readonly RegistryProcedure[], source: Pick<MonitoringSource, 'readAt' | 'bookUrl'>, scope: string): string {
  const lines = rows.map((p) => [
    ...[p.code, p.dept, p.customer, p.subject, stageShort(p.stage), p.result, p.requiredAction, p.qualityNote].map(text),
    ...[p.nmck, p.auctionPrice, p.reductionRub, p.reductionPct, p.savingsTotal, p.savingsFb, p.savingsKb, p.savingsMb].map(money),
    ...[p.applicationDate, p.publicationDate, p.deadlineDate, p.auctionDate, p.winnerName, p.winnerInn, p.protocolFlag,
      p.ancestorCodes?.join('; '), p.successorCodes?.join('; '), p.participants?.map((r) => `${r.dept}: ${r.customer}`).join('; '),
      p.sheet, String(p.row), sourceCellUrl(source.bookUrl, p.sheet, `A${p.row}`), fmtReadAt(source.readAt), scope].map(text),
  ].join(';'));
  return '\uFEFF' + HEADERS.join(';') + '\r\n' + lines.join('\r\n');
}
