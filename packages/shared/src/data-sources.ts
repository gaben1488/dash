import { DEPARTMENT_REGISTRY } from './department-registry.js';
import type { DepartmentId } from './types.js';

export const DEPARTMENT_SPREADSHEET_IDS = Object.fromEntries(
  DEPARTMENT_REGISTRY.map(dept => [dept.id, dept.source.providerId]),
) as Readonly<Record<DepartmentId, string>>;

export const MONITORING_DIRECTORY_HEADER: readonly string[] = [
  '№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения',
];
export const MONITORING_DIRECTORY_HEADER_V2: readonly string[] = [
  '№ п/п',
  'Управление',
  'Новый каноничный справочник полных наименований',
  'Новый каноничный справочник кратких наименований',
  'Алиасы и варианты написания',
];

/** Исторические листы мониторинга: общий точный контракт источника. */
export const MONITORING_ANCESTOR_SHEETS: ReadonlyArray<{
  readonly sheet: string;
  readonly kind: 'form' | 'copy';
  readonly note: string;
  readonly header: readonly string[];
}> = [
  {
    sheet: 'Отчет по процедурам Свод',
    kind: 'form',
    note: 'Лист-предок: шапка из семнадцати колонок, строк данных ноль.',
    header: [
      '№ п/п', 'Наименование муниципальной программы',
      'Общий объём ассигнований, с учётом тек. деятельности (М.б., К.б., Ф.б.)',
      'Остаток не принятых (свободных) бюджетных обязательств', 'Заказчик',
      'Наименование объекта закупки', 'Начальная (максимальная) цена',
      'Дата поступления заявки в УО', 'Дата публикации', 'Статус',
      'Дата окончания подачи заявок', 'Дата окончания срока рассмотрения заявок',
      'Дата проведения торгов/переторжки', 'Кол-во заявок от поставщиков',
      'Цена аукциона', 'Экономия', 'Победитель',
    ],
  },
  {
    sheet: 'СВОД',
    kind: 'form',
    note: 'Второй лист-предок с той же шапкой, строк данных ноль.',
    header: [],
  },
  {
    sheet: 'ГРБС',
    kind: 'copy',
    note: 'Побайтовая копия «Перечня ГРБС», включая обе опечатки в шапке; два источника одного справочника разойдутся при первой правке одного из них.',
    header: MONITORING_DIRECTORY_HEADER,
  },
];
