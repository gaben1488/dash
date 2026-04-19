/**
 * kosgu.ts — Справочник КОСГУ (Классификации операций сектора государственного управления).
 *
 * TODO: заполнить из официального источника при получении данных от АЕМР.
 *       Источник: приказ Минфина России № 209н от 29.11.2017
 *       URL: https://minfin.gov.ru/ru/perfomance/budget/classiflcation/
 *
 * Текущая версия — скелет с примерами КОСГУ, используемыми в муниципальных закупках.
 *
 * Использование в pipeline:
 *   - Кросс-чек суммы по КОСГУ с колонками H/I/J (ФБ/КБ/МБ)
 *   - KB-tooltip: расшифровка кода операции
 *   - Сигнал kosguMismatch (будущий)
 */

// ────────────────────────────────────────────────────────────
// 1. Интерфейс
// ────────────────────────────────────────────────────────────

export interface KosguEntry {
  /** Код КОСГУ (3 символа) */
  code: string;
  /** Полное наименование статьи КОСГУ */
  name: string;
  /** Группа (первая цифра) */
  group: string;
  /** Тип операции */
  operationType: 'income' | 'expense' | 'financing';
  /** Применяется в закупочной деятельности */
  usedInProcurement: boolean;
}

// ────────────────────────────────────────────────────────────
// 2. Примеры КОСГУ — FILL FROM SOURCE (приказ 209н)
// ────────────────────────────────────────────────────────────

export const KOSGU_REGISTRY: KosguEntry[] = [
  // TODO: populate from Минфин № 209н
  // Примеры для демонстрации структуры:
  {
    code: '225',
    name: 'Работы, услуги по содержанию имущества',
    group: '2',
    operationType: 'expense',
    usedInProcurement: true,
  },
  {
    code: '226',
    name: 'Прочие работы, услуги',
    group: '2',
    operationType: 'expense',
    usedInProcurement: true,
  },
  {
    code: '310',
    name: 'Увеличение стоимости основных средств',
    group: '3',
    operationType: 'expense',
    usedInProcurement: true,
  },
  // TODO: добавить все КОСГУ из актуальной редакции приказа 209н
];

export const KOSGU_MAP = new Map<string, KosguEntry>(
  KOSGU_REGISTRY.map(e => [e.code, e]),
);

/** Получить КОСГУ по коду */
export function getKosgu(code: string): KosguEntry | undefined {
  return KOSGU_MAP.get(code);
}
