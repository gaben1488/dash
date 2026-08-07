// ── Типы страницы «Экономия» (E11-5): доменная модель строк экономии
//    по ГРБС/подведам, извлечённая из pages/Economy.tsx. Исходные данные —
//    DepartmentSummary из @aemr/shared, где quarters/subordinates
//    нетипизированы (Record<string, unknown> / unknown[]); билдеры в
//    dept-economy.ts/quarterly.ts читают их через числовые ридеры и выдают
//    наружу только честные number-поля.

import { ORG_ITSELF_SENTINEL } from '@aemr/shared';

/** Колонки сортировки таблицы «Экономия по управлениям». */
export type SortField = 'dept' | 'limit' | 'price' | 'economy' | 'pct' | 'conflicts' | 'subCount';
export type SortDir = 'asc' | 'desc';

/**
 * Порог «подозрительно высокой» экономии, % снижения от лимита.
 * >25% — повод запросить обоснование НМЦК (ст.22) и проверить
 * антидемпинговые меры (ст.37 44-ФЗ).
 */
export const HIGH_ECONOMY_PCT = 25;

/**
 * Служебное имя строки «само управление» в списке подведов
 * (источник: колонка C = «X»/пусто). Это НЕ подведомственная организация —
 * везде исключается из счётчиков подведов и плоского списка.
 * Канон — ORG_ITSELF_SENTINEL из @aemr/shared (здесь короткий алиас).
 */
export const ORG_ITSELF: string = ORG_ITSELF_SENTINEL;

/** Разбивка план/факт/экономия по трём бюджетам (ФБ/КБ/МБ). */
export interface BudgetData {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

/** Строка подведа (или «само управление») внутри drill-down ГРБС. */
export interface SubEconomy {
  name: string;
  planTotal: number;
  factTotal: number;
  economy: number;
  /**
   * Доля экономии от лимита, %. `null` — лимита нет, доля не определена.
   * Ноль здесь был бы враньём: «0 %» читается как «не сэкономили», тогда как
   * на деле не от чего считать (канон: нулевой знаменатель — не ноль).
   */
  pct: number | null;
  budget: BudgetData;
}

/** Строка ГРБС в таблице/чарте экономии (после бюджет-фильтра). */
export interface DeptEconomy {
  dept: string;
  deptId: string;
  /** План (лимит) с учётом бюджет-фильтра. */
  limit: number;
  /** Факт (цена контрактов) с учётом бюджет-фильтра. */
  price: number;
  /** Экономия = утверждённые (AD="да") Z/AA/AB, НИКОГДА не план−факт. */
  economy: number;
  /** Официальный годовой итог СВОД (без фильтров) — для колонки «СВОД» в CSV. */
  economyOfficial: number | null;
  /** Доля экономии от лимита, %. `null` — лимита нет (см. SubEconomy.pct). */
  pct: number | null;
  /** pct > HIGH_ECONOMY_PCT — маркер антидемпинговой проверки. */
  highEconomy: boolean;
  /** Расхождения флага экономии УФБП/ГРБС. */
  conflicts: number;
  budget: BudgetData;
  /** Отсортированы по экономии убыв.; включают ORG_ITSELF. Пусто в deptOnly-режиме. */
  subordinates: SubEconomy[];
  /** Реальное число подведов (без ORG_ITSELF). */
  realSubCount: number;
  /**
   * Включён режим «только само управление»: подведы намеренно НЕ строились.
   * Без этого флага пустой список читался бы как «подведов нет» — а они есть,
   * просто исключены фильтром. Интерфейс обязан назвать причину пустоты.
   */
  deptOnly: boolean;
}

/** Подвед в плоском списке «все подведы» с привязкой к своему ГРБС. */
export interface SubordinateFlat extends SubEconomy {
  deptName: string;
  deptId: string;
}
