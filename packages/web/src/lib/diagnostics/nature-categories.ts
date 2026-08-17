/**
 * Категории оценок ПО ПРИРОДЕ — канон п.88/26б интервью 14.08.2026.
 *
 * Слова владельца: оценки собираются в одном месте, но делятся КОНКРЕТНЫМИ
 * категориями по природе, без абстракций: «ошибка заполнения книги» отдельно
 * (дисциплина ввода исполнителя: пустые обязательные колонки, кривые даты,
 * несведённые итоги), дефекты формул листа отдельно, содержательное
 * исполнение закупок отдельно. Термин «доверие» с экранов снят.
 *
 * Модуль отвечает на один вопрос: к какой природе относится замечание.
 * Основной путь — идентификатор проверки (checkId/category реестра проверок);
 * запасной — группа реестра (IssueGroup). Ничего не выдумывается: замечание,
 * чью проверку модуль не знает, честно уходит в «прочие проверки», а не
 * притягивается к ближайшей категории.
 */
import type { DiagnosticIssueLike } from './mechanism-groups';

export type NatureCategoryId = 'fill' | 'sheet' | 'execution' | 'other';

export interface NatureCategory {
  id: NatureCategoryId;
  /** Подпись категории — канон владельца, дословно. */
  label: string;
  /** Чем эта природа отличается от соседних — одна фраза для подзаголовка. */
  description: string;
  /** Кому адресована категория — часть карточки диагноста (п.53). */
  addressee: string;
}

export const NATURE_CATEGORIES: Record<NatureCategoryId, NatureCategory> = {
  fill: {
    id: 'fill',
    label: 'Ошибка заполнения книги',
    description:
      'Дисциплина ввода исполнителя: пустые обязательные колонки, кривые даты, несведённые итоги.',
    addressee: 'Исполнителю книги: поправить ячейки, названные в замечаниях.',
  },
  sheet: {
    id: 'sheet',
    label: 'Дефект формул листа',
    description:
      'Сломанная арифметика самого листа: формула затёрта значением, возвращает ошибку или считает не то.',
    addressee: 'Владельцу книги: вернуть или протянуть формулу в названной ячейке.',
  },
  execution: {
    id: 'execution',
    label: 'Исполнение закупок',
    description:
      'Содержательный ход закупок: просрочки, подвисшие контракты, спорная экономия, риски способа.',
    addressee: 'Управлению: решение по самой закупке, а не по ячейке.',
  },
  other: {
    id: 'other',
    label: 'Прочие проверки',
    description: 'Замечания проверок, не отнесённых к трём основным природам.',
    addressee: 'Разобрать вручную: у проверки не указана природа.',
  },
};

/** Порядок предъявления секций: сначала ввод, потом лист, потом содержание. */
export const NATURE_ORDER: NatureCategoryId[] = ['fill', 'sheet', 'execution', 'other'];

/**
 * Природа по идентификатору проверки. Разнесение — по канону владельца:
 * «несведённые итоги» — заполнение книги (данные не сходятся из-за ввода),
 * а «формула возвращает ошибку» и проверки расчётов СВОДа — дефект листа.
 */
const NATURE_BY_CHECK: Readonly<Record<string, NatureCategoryId>> = {
  // ── Ошибка заполнения книги ──
  data_quality: 'fill',
  method_validation: 'fill',
  type_validation: 'fill',
  fact_quarter_missing: 'fill',
  budget_source_missing: 'fill',
  budget_underallocation: 'fill',
  budget_sum_plan: 'fill',
  budget_sum_fact: 'fill',
  dept_fact_sum: 'fill',
  dept_economy_sum: 'fill',
  date_without_fact: 'fill',
  fact_without_date: 'fill',
  ep_justification_missing: 'fill',
  future_fact_date: 'fill',
  fact_date_before_plan: 'fill',
  status_on_data_rows: 'fill',
  economy_conflict: 'fill',
  economy_hidden: 'fill',
  // ── Дефект формул листа ──
  formula_broken: 'sheet',
  execution_percentage: 'sheet',
  deviation_calc: 'sheet',
  q1_leq_year: 'sheet',
  formula_continuity: 'sheet',
  // ── Исполнение закупок ──
  plan_year_missing: 'execution',
  overdue: 'execution',
  stalled_contract: 'execution',
  early_closure: 'execution',
  finance_delay: 'execution',
  plan_without_execution: 'execution',
  fact_vs_plan: 'execution',
  anti_dumping: 'execution',
  ep_risk: 'execution',
  low_competition: 'execution',
  single_participant: 'execution',
  economy_sign_check: 'execution',
};

/** Запасной путь: группа реестра проверок → природа. */
const NATURE_BY_GROUP: Readonly<Record<string, NatureCategoryId>> = {
  data_integrity: 'fill',
  field_validation: 'fill',
  completeness: 'fill',
  economy_control: 'fill',
  formula_consistency: 'sheet',
  temporal: 'execution',
  financial: 'execution',
};

/** Сигналы конвейера носят ключи в camelCase — приводим к snake_case реестра. */
function signalToCheckId(signal: string): string {
  return signal.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * Природа замечания. Смотрим все известные идентификаторы по очереди:
 * checkId → category (там же живут старые ключи вида `signal:overdue`) →
 * signal. Ничего не нашли — «прочие проверки».
 */
export function natureOf(issue: Pick<DiagnosticIssueLike, 'checkId' | 'category' | 'signal'> & { group?: string }): NatureCategory {
  const candidates: string[] = [];
  if (issue.checkId) candidates.push(issue.checkId);
  if (issue.category) {
    candidates.push(issue.category);
    if (issue.category.startsWith('signal:')) {
      candidates.push(signalToCheckId(issue.category.slice('signal:'.length)));
    }
  }
  if (issue.signal) {
    candidates.push(issue.signal, signalToCheckId(issue.signal));
  }
  for (const key of candidates) {
    const hit = NATURE_BY_CHECK[key];
    if (hit) return NATURE_CATEGORIES[hit];
  }
  if (issue.group && NATURE_BY_GROUP[issue.group]) {
    return NATURE_CATEGORIES[NATURE_BY_GROUP[issue.group]];
  }
  return NATURE_CATEGORIES.other;
}
