import { ISSUE_STATUS_LABELS, ISSUE_STATUS_TRANSITIONS } from '@aemr/shared';
import type { IssueStatus } from '@aemr/shared';

// The UI and status API share the same validated lifecycle. Re-export the names
// already consumed by screens/tests so existing callers need no migration.
export { ISSUE_STATUS_TRANSITIONS, allowedIssueTransitions, issueTransitionNeedsReason } from '@aemr/shared';

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


/** Сохранённое решение не подменяет повторную проверку первичного источника. */
export function issueDecisionExplanation(status: string): string {
  if (status === 'resolved') return 'Исправление заявлено. Замечание осталось в выбранном снимке и учитывается в оценке доверия. Перечитайте источники для проверки результата.';
  if (status === 'false_positive') return 'Решение «ложное срабатывание» сохранено. Это замечание не снижает оценку доверия; причина и ответственный доступны в истории.';
  if (status === 'wont_fix') return 'Решение не исправлять сохранено; риск сохраняется и учитывается в оценке доверия. Причина и ответственный доступны в истории.';
  return 'Пояснение сохраняется в истории, но само по себе не закрывает замечание. После исправления перечитайте источники для повторной проверки.';
}
