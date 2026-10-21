import type { DepartmentId } from './types.js';

export const DEPARTMENT_SPREADSHEET_IDS: Readonly<Record<DepartmentId, string>> = {
  'УЭР': '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4',
  'УИО': '1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8',
  'УАГЗО': '1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk',
  'УФБП': '14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ',
  'УД': '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg',
  'УДТХ': '1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4',
  'УКСиМП': '1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI',
  'УО': '1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds',
} as const;

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
