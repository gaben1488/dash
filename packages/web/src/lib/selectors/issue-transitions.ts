import { ISSUE_STATUS_LABELS } from '@aemr/shared';
import type { IssueStatus } from '@aemr/shared';

/**
 * Какие переходы статуса замечания сервер действительно принимает.
 *
 * Зеркало таблицы `STATUS_TRANSITIONS` из `packages/server/src/routes/issues.ts`
 * (жизненный цикл: открыто → принято → в работе → исправлено / не будет
 * исправляться / ложное срабатывание; из трёх конечных статусов есть
 * переоткрытие). Зеркало, а не импорт: пакет web не зависит от server.
 *
 * Зачем это вообще нужно интерфейсу. Страница «Замечания» рисовала кнопку
 * «Исправлено» рядом с открытым замечанием, хотя сервер такой переход
 * отбивает 400-м ответом: минуя «в работе» исправить нельзя. Нажатие уходило
 * в никуда — ответ падал в консоль, экран не менялся, и пользователь видел
 * кнопку, которая «не работает». Кнопка, обещающая недоступное действие, —
 * та же ложь, что число без происхождения, поэтому набор кнопок теперь
 * выводится отсюда, а не пишется руками у разметки.
 *
 * Если серверная таблица изменится, разойдётся ровно одно место — здесь.
 */
export const ISSUE_STATUS_TRANSITIONS: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  open: ['acknowledged', 'in_progress', 'wont_fix', 'false_positive'],
  acknowledged: ['in_progress', 'wont_fix', 'false_positive'],
  in_progress: ['resolved', 'wont_fix', 'false_positive'],
  resolved: ['open'],
  wont_fix: ['open'],
  false_positive: ['open'],
};

/** Статусы, в которые можно перевести замечание из текущего. Неизвестный статус → пусто. */
export function allowedIssueTransitions(status: string): readonly IssueStatus[] {
  return ISSUE_STATUS_TRANSITIONS[status as IssueStatus] ?? [];
}

/**
 * Переходы, для которых сервер требует причину (issues.ts:184-188): отказ
 * исправлять и признание срабатывания ложным — решения человека, и они обязаны
 * остаться в истории со словами, а не с отпиской «изменено через интерфейс».
 */
const REASON_REQUIRED: ReadonlySet<string> = new Set<IssueStatus>(['wont_fix', 'false_positive']);

export function issueTransitionNeedsReason(target: string): boolean {
  return REASON_REQUIRED.has(target);
}

/**
 * Подпись кнопки перехода — это ровно фраза статуса из словаря продукта.
 *
 * До этого у «не будет исправляться» жили три разные подписи: словарная в
 * бейдже статуса, «Не исправлять» на кнопке и сырой ключ `wont_fix` в строке
 * журнала. Читатель видел три названия одного решения. Фраза может быть
 * только одна, и её дом — ISSUE_STATUS_LABELS.
 */
export function issueStatusLabel(status: string): string {
  return ISSUE_STATUS_LABELS[status] ?? status;
}

/** Статусы, из которых переход в указанный разрешён. */
export function statusesLeadingTo(target: string): readonly IssueStatus[] {
  return (Object.keys(ISSUE_STATUS_TRANSITIONS) as IssueStatus[]).filter((from) =>
    ISSUE_STATUS_TRANSITIONS[from].includes(target as IssueStatus),
  );
}

/**
 * Почему нужной кнопки сейчас нет — словами и без внутренних ключей.
 *
 * Сервер на недопустимый переход отвечает `Переход "open" → "resolved"
 * недопустим`: сырые ключи, которым не место на экране. Но объяснять надо
 * раньше отказа — рядом с кнопками, чтобы пользователь не искал пропавшее
 * «Исправлено». Путь берём из той же таблицы переходов, поэтому подсказка не
 * может разойтись с набором кнопок.
 */
export function issueTransitionRefusal(from: string, to: string): string {
  const target = issueStatusLabel(to);
  const sources = statusesLeadingTo(to);
  if (sources.length === 0) {
    return `Перевести замечание в «${target}» нельзя ни из одного статуса.`;
  }
  const path = sources.map((s) => `«${issueStatusLabel(s)}»`).join(' или ');
  return `Отметить «${target}» можно только из статуса ${path}, а сейчас замечание в статусе «${issueStatusLabel(from)}».`;
}
