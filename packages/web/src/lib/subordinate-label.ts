/**
 * subordinateLabel — человекочитаемая подпись подведомственного для UI.
 *
 * Единственная задача: спрятать сырой ключ `_org_itself` (ORG_ITSELF_SENTINEL
 * из @aemr/shared) за русской подписью «Аппарат управления». Данные, ключи
 * сортировок и навигации НЕ трогаются — хелпер применяется только в точке
 * отображения (textContent / title / CSV-строка).
 *
 * D15: ноль латиницы и сырых ключей в видимом UI.
 */
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';

/** Подпись аппарата ГРБС (само управление, не подвед). */
export const ORG_ITSELF_LABEL = 'Аппарат управления';

/** Сырое имя подведа → подпись для отображения. */
export function subordinateLabel(raw: string): string {
  return raw === ORG_ITSELF_SENTINEL ? ORG_ITSELF_LABEL : raw;
}
