import { ORG_ITSELF_SENTINEL } from './dictionaries/subordinate-registry.js';

/**
 * Канон «само управление» (org-itself) — ЕДИНЫЙ предикат столбца C
 * (`DEPT_COLUMNS.SUBORDINATE = 2`, «Наименование подведомственного учреждения»).
 * Строка = закупка самого управления (аппарата ГРБС), а не подведа, если значение C
 * после trim/lowercase: пусто, ИЛИ одиночная самоссылка (X/Х/тире), ИЛИ текст-плейсхолдер.
 *
 * Единый источник вместо 4+ разъехавшихся деривáций: `calc-engine`/`recalculate` считали
 * regex + Set, а `orchestrator`/`dataset-signals`/`validate` — ТОЛЬКО regex, из-за чего
 * «н/д»/«нет»/«не определена» становились отдельным фейковым подведом в сигналах и витрине,
 * но сворачивались в `_org_itself` в расчёте (сигналы и дашборд видели разные множества
 * организаций — латентный баг). НЕ путать с осью D (`PROGRAM_NAME=3`, «без программы») —
 * у неё свой узкий канон `PROGRAM_EMPTY={x,х,''}` в `activity-scope.ts`.
 */

/** Текст-плейсхолдеры столбца C (нижний регистр) = само управление. */
export const ORG_ITSELF_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'х', 'x', '-', '—', '–', 'н/д', 'нет', 'не определена',
]);

/** Одиночная самоссылка: латиница/кириллица X или тире (даёт латинскую X сверх Set). */
export const ORG_ITSELF_SINGLE_RE = /^[XxХх\-—–]$/u;

/** true, если столбец C означает «само управление» (аппарат ГРБС, не подвед). */
export function isOrgItself(c: unknown): boolean {
  const s = String(c ?? '').trim();
  if (s === '') return true;
  return ORG_ITSELF_SINGLE_RE.test(s) || ORG_ITSELF_PLACEHOLDERS.has(s.toLowerCase());
}

/** Ключ-ведро по столбцу C: сентинел «само управление» или имя подведа (trim). */
export function subordinateKey(c: unknown): string {
  return isOrgItself(c) ? ORG_ITSELF_SENTINEL : String(c).trim();
}
