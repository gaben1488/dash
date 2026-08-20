/**
 * semantic-color.ts — ОДИН ДОМ ЦВЕТА (механизм М13, 21.08.2026).
 *
 * Болезнь. Карты атласа 20.08.2026 нашли по продукту смысл, покрашенный сырым
 * hex мимо словаря ролей, — и одну и ту же величину в двух цветах на соседних
 * графиках. «Аналитика» красила столбец «Конкурсные (КП)» цветом `#3b82f6`, а
 * столбец «Единственный (ЕП)» — `#f59e0b` (`analytics-timeline-system.md` A3);
 * это байт-в-байт цвета федерального и муниципального бюджетов. Читатель,
 * запомнивший «синий — федеральный», на соседней карточке видел синим способ
 * закупки. Там же (A5) стек плана красился оттенками синего, стек факта —
 * оттенками зелёного, то есть цвет говорил «план/факт», хотя внутри стека он
 * же обязан был говорить «ФБ/КБ/МБ». Тёмного варианта у этих литералов не было
 * вовсе: `#93c5fd` на почти чёрном фоне светится, `#0f8f63` тонет.
 *
 * Правило, ради которого файл заведён: ОДНА ВЕЛИЧИНА — ОДИН ЦВЕТ ВО ВСЁМ
 * ПРОДУКТЕ. Величина называется словом, слово отдаёт роль, роль знает обе
 * темы. Краска не появляется в разметке никогда.
 *
 * Почему отдельный файл, а не `chart-colors.ts` (канон п.112 «брать готовое»).
 * Оба дома нужны, и они отвечают на разные вопросы:
 *
 *   • `chart-colors.ts` — слой ГРАФИКА. Recharts местами требует настоящую
 *     краску: подсказку он собирает в объект стиля, тепловую карту красит
 *     вычисленным значением, а тесты меряют по этим значениям контраст и
 *     расстояние между тонами. Hex там живёт по делу и никуда не денется.
 *   • ЭТОТ файл — слой СМЫСЛА, общий для всего продукта: бейдж, число в
 *     таблице, полоса, заливка фигуры. Он не знает ни одной краски и знать не
 *     должен: он отдаёт `var(--…)`, а какая это краска на какой теме — знает
 *     `index.css`, единственный дом значений.
 *
 * Связь домов прошита стражем `semantic-color.test.ts`: он читает `index.css` и
 * не даёт закреплённой семантике `chart-colors.ts` разъехаться со словарём
 * ролей. Разъехавшись однажды, они разъедутся молча.
 *
 * Порог и цвет — половины одного механизма. Состояние величины выводится не
 * литералом на месте, а реестром порогов `@aemr/shared/threshold-registry`:
 * число, решающее «норма это или нарушение», обязано иметь имя, смысл и
 * источник. Поэтому функции ниже сначала спрашивают порог у реестра и лишь
 * потом отдают роль.
 */

import { thresholdValue } from '@aemr/shared';
import { categoricalVar, dataVar, type DataTone } from '../components/ui/tokens';

// ────────────────────────────────────────────────────────────────
// 1. Три непересекающихся словаря
// ────────────────────────────────────────────────────────────────

/**
 * Источник финансирования. Закреплён навсегда: ФБ синий, КБ изумруд, МБ
 * янтарь — так его читают и в отчёте начальству, и на листе свода.
 */
export type BudgetKey = 'ФБ' | 'КБ' | 'МБ';

const BUDGET_ROLE: Readonly<Record<BudgetKey, string>> = {
  'ФБ': '--data-fb',
  'КБ': '--data-kb',
  'МБ': '--data-mb',
};

/** Способ определения поставщика: конкурентная закупка либо единственный поставщик. */
export type MethodKey = 'КП' | 'ЕП';

const METHOD_ROLE: Readonly<Record<MethodKey, string>> = {
  'КП': '--method-kp',
  'ЕП': '--method-ep',
};

/**
 * Состояние величины — четыре слова и ни одним больше.
 *
 * «Не оценено» держится отдельно от «нормы» намеренно и является главной
 * защитой продукта от лжи: управление без плана за период не провалило
 * исполнение, а не имеет базы для счёта, и красить его красным — значит
 * выводить вывод из отсутствия данных. Прежде отсутствие базы приезжало в
 * полосу «нарушение» само собой (сравнение `null >= 50` ложно), и восемь
 * управлений с прочерками объявлялись отстающими.
 */
export type SemanticState = 'норма' | 'внимание' | 'нарушение' | 'не оценено';

const STATE_TONE: Readonly<Record<SemanticState, DataTone>> = {
  'норма': 'good',
  'внимание': 'warn',
  'нарушение': 'bad',
  'не оценено': 'neutral',
};

/**
 * Словесный дубль состояния. Канон требует, чтобы всякая визуальная кодировка
 * дублировалась текстом: печать бывает чёрно-белой, а около восьми процентов
 * мужчин не различают часть тонов.
 */
export const STATE_LABELS: Readonly<Record<SemanticState, string>> = {
  'норма': 'в норме',
  'внимание': 'требует внимания',
  'нарушение': 'нарушение',
  'не оценено': 'не оценено — базы для счёта нет',
};

// ────────────────────────────────────────────────────────────────
// 2. Единственный способ получить цвет
// ────────────────────────────────────────────────────────────────

/** Цвет источника финансирования. */
export function budgetColor(budget: BudgetKey): string {
  return `var(${BUDGET_ROLE[budget]})`;
}

/** Цвет способа определения поставщика. */
export function methodColor(method: MethodKey): string {
  return `var(${METHOD_ROLE[method]})`;
}

/** Цвет состояния величины. */
export function stateColor(state: SemanticState): string {
  return dataVar(STATE_TONE[state]);
}

/**
 * Цвет ряда без собственного смысла: управления, организации, произвольные
 * группы. Категориальный ряд уведён по тону от закреплённых словарей — иначе
 * круг по управлениям читается как круг по бюджетам.
 */
export function seriesColor(index: number): string {
  return categoricalVar(index);
}

/**
 * Величина, у которой цвет закреплён. Одна точка входа для мест, где на одном
 * графике встречаются разные словари: она не даёт по недосмотру спросить
 * бюджетный цвет для способа закупки.
 */
export type SemanticValue =
  | { readonly kind: 'бюджет'; readonly key: BudgetKey }
  | { readonly kind: 'способ'; readonly key: MethodKey }
  | { readonly kind: 'состояние'; readonly key: SemanticState }
  | { readonly kind: 'ряд'; readonly index: number };

export function semanticColor(value: SemanticValue): string {
  switch (value.kind) {
    case 'бюджет': return budgetColor(value.key);
    case 'способ': return methodColor(value.key);
    case 'состояние': return stateColor(value.key);
    case 'ряд': return seriesColor(value.index);
  }
}

/** Все роли словаря — перечень для стража и для страницы объяснений. */
export const SEMANTIC_ROLES: readonly string[] = [
  ...Object.values(BUDGET_ROLE),
  ...Object.values(METHOD_ROLE),
  '--data-good',
  '--data-warn',
  '--data-bad',
  '--data-neutral',
];

// ────────────────────────────────────────────────────────────────
// 3. Величина → состояние. Пороги берутся у реестра, не сочиняются здесь
// ────────────────────────────────────────────────────────────────

/**
 * Состояние исполнения плана. `null` — плана за период не было: это «не
 * оценено», а не «нарушение».
 *
 * Полоса «сверх плана» состоянием не является: перевыполнение — не отличие и
 * не провал, а повод посмотреть, откуда взялись незапланированные закупки.
 * Отдельный цвет для неё живёт в слое графика (`chart-colors.ts`), где полоса
 * и рисуется; здесь она читается как «внимание».
 */
export function executionState(pct: number | null): SemanticState {
  if (pct === null || !Number.isFinite(pct)) return 'не оценено';
  if (pct > thresholdValue('execution.over')) return 'внимание';
  if (pct >= thresholdValue('execution.good')) return 'норма';
  if (pct >= thresholdValue('execution.watch')) return 'внимание';
  return 'нарушение';
}

/** Состояние исполнения ОТДЕЛЬНОГО управления — черта строже районной. */
export function deptExecutionState(pct: number | null): SemanticState {
  if (pct === null || !Number.isFinite(pct)) return 'не оценено';
  if (pct >= thresholdValue('execution.deptGood')) return 'норма';
  if (pct >= thresholdValue('execution.deptMid')) return 'внимание';
  if (pct >= thresholdValue('execution.watch')) return 'внимание';
  return 'нарушение';
}

/** Состояние доверия к данным: двоичный вердикт «норма / проверь». */
export function trustState(score: number | null): SemanticState {
  if (score === null || !Number.isFinite(score)) return 'не оценено';
  if (score >= thresholdValue('trust.gradeA')) return 'норма';
  if (score >= thresholdValue('trust.gradeB')) return 'норма';
  if (score >= thresholdValue('trust.gradeC')) return 'внимание';
  return 'нарушение';
}

/**
 * Состояние по числу критических замечаний. Ноль — норма; порог тревоги живёт
 * в реестре и честно назван там нашим решением без родословной.
 */
export function criticalIssuesState(count: number): SemanticState {
  if (count === 0) return 'норма';
  if (count > thresholdValue('issues.criticalAlarmCount')) return 'нарушение';
  return 'внимание';
}

/**
 * Состояние доли снижения цены. Свыше антидемпингового порога — «внимание», а
 * не «нарушение»: закон требует дополнительных мер, но само по себе крупное
 * снижение нарушением не является. Отрицательная экономия — нарушение: так
 * быть не должно.
 */
export function economyShareState(pct: number | null): SemanticState {
  if (pct === null || !Number.isFinite(pct)) return 'не оценено';
  if (pct < 0) return 'нарушение';
  if (pct > thresholdValue('economy.highSharePct')) return 'внимание';
  if (pct >= thresholdValue('economy.normalMinPct')) return 'норма';
  return 'внимание';
}

/**
 * Состояние доли закупок у единственного поставщика. Выше обычного — «повод
 * посмотреть», и никогда «нарушение»: закон доли ЕП не нормирует вовсе, а сам
 * порог назван в реестре нашим решением без родословной.
 */
export function epShareState(pct: number | null): SemanticState {
  if (pct === null || !Number.isFinite(pct)) return 'не оценено';
  if (pct > thresholdValue('competition.epShareNormMaxPct')) return 'внимание';
  return 'норма';
}

/** Состояние индекса дисциплины ведения книги. */
export function disciplineIndexState(index: number | null): SemanticState {
  if (index === null || !Number.isFinite(index)) return 'не оценено';
  if (index >= thresholdValue('discipline.indexGoodPct')) return 'норма';
  if (index >= thresholdValue('discipline.indexWatchPct')) return 'внимание';
  return 'нарушение';
}

/** Цвет величины по её состоянию — то, чем пользуется разметка чаще всего. */
export function executionColor(pct: number | null): string {
  return stateColor(executionState(pct));
}
