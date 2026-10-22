import { EP_REASON_CLUSTERS, EP_REASON_DICT } from './dictionaries/ep-reason-clusters.js';
import { DEVIATION_CLUSTERS, DEVIATION_DICT } from './dictionaries/deviation-reason-clusters.js';

/** Editable domain guidance; free text never substitutes for the structured N/Q dates. */
export const FIELD_GUIDANCE = {
  method: 'Укажите фактический способ закупки. Обоснование ЕП хранится отдельно в M; выбор ЕП сам по себе не доказывает нарушение.',
  planDate: 'N — плановая дата. Уточняйте её по документам планирования; текст комментария не заменяет дату.',
  factDate: 'Q — дата завершения позиции. Для годовой потребности это дата последнего договора, закрывающего весь объём. До этого суммы могут накапливаться при пустой Q. Не ставьте вымышленную дату ради снятия сигнала.',
  flag: 'AD — решение об учёте экономии: «да» или «нет». Учитывается подписанная сумма Z+AA+AB, включая отрицательное значение. Разница плана и факта не заменяет это решение.',
  money: 'Денежные графы книги ведутся в тысячах рублей. Сохраняйте подтверждённые суммы; пустое значение и ноль различаются. Итоговые формулы вручную не заменяйте.',
  commentGRBS: 'Сохраните предметное объяснение и ссылку на подтверждение: годовая потребность, отдельный договор, отмена или замена. Комментарий не устанавливает дату заключения и не меняет решение AD.',
} as const;

export const SEASONAL_PATTERNS = {
  repair: /ремонт|модерниз|реконструк/i,
  school: /школ|образов|детс|гимназ|лицей/i,
  food: /питан|пищ|обед|завтрак|столов/i,
  road: /дорог|асфальт|покрыт|тротуар|благоуст/i,
  fuel: /топлив|угл[яеьюи]|мазут|дизельн|ГСМ|котельн.*снабж/i,
  boiler: /котельн|отоплен|теплоснабж/i,
} as const;

/** Internal screening calendar, not a statutory deadline or an employee grade. */
export const SEASONAL_PARAMETERS = {
  schoolYearMonths: [1, 2, 3, 4, 5, 9, 10, 11, 12],
  winterRoadMonths: [12, 1, 2, 3], heatingMonths: [10, 11, 12, 1, 2, 3, 4],
  foodDeadline: { month: 8, day: 15 }, fuelDeadline: { month: 9, day: 1 },
  shortDecemberDays: 15, fourthQuarterShare: 0.40,
} as const;

const SCREENING_NOTE = 'Это внутренний ориентир просмотра, не установленное нарушение. Даты договора не доказывают время фактического выполнения работ.';
export const SEASONAL_RULES = {
  SCHOOL_REPAIR_OUTSIDE_HOLIDAYS: { label: 'Ремонт школы: сверить сроки работ', action: 'Сверить график работ и режим учреждения.' },
  LATE_SCHOOL_FOOD_CONTRACT: { label: 'Школьное питание: проверить обеспечение', action: 'Сверить период обеспечения, действующие договоры и годовую потребность.' },
  WINTER_ROAD_WORK: { label: 'Дорожные работы: сверить сезон выполнения', action: 'Сверить предмет и график работ; заключение зимой не означает выполнение зимой.' },
  LATE_FUEL_PROCUREMENT: { label: 'Топливо: проверить обеспечение сезона', action: 'Сверить запасы, действующие договоры и период обеспечения.' },
  BOILER_REPAIR_HEATING_SEASON: { label: 'Ремонт теплоснабжения: сверить график', action: 'Сверить график и характер ремонта, включая аварийные работы.' },
  Q4_SPENDING_SPIKE: { label: 'Заключения смещены в IV квартал', action: 'Сверить распределение финансирования и плановые сроки.' },
  DECEMBER_RUSH_CONTRACT: { label: 'Декабрьское заключение в короткий срок', action: 'Сверить плановую дату, процедуру и применимые сроки; короткий интервал сам по себе допустим.' },
} as const;
export type SeasonalRuleId = keyof typeof SEASONAL_RULES;
export const SEASONAL_RULE_LABELS = Object.fromEntries(Object.entries(SEASONAL_RULES).map(([key, rule]) => [key, rule.label])) as Record<SeasonalRuleId, string>;
export const SEASONAL_SCREENING_NOTE = SCREENING_NOTE;

/**
 * Editable editorial explanations only. Stable identifiers are independent of
 * Russian wording; changing a description does NOT edit a legal threshold,
 * source row, regex, classification, snapshot or stored report.
 */
export interface ProcurementGuidanceEntry {
  key: string;
  section: 'field' | 'ep' | 'stage' | 'seasonal';
  defaultText: string;
}

export function procurementEditableGuidance(): ProcurementGuidanceEntry[] {
  return [
    ...Object.entries(FIELD_GUIDANCE).map(([key, defaultText]) => ({
      key: `field:${key}`, section: 'field' as const, defaultText,
    })),
    ...EP_REASON_CLUSTERS.map(key => ({
      key: `ep:${key}`, section: 'ep' as const, defaultText: EP_REASON_DICT[key].label_ru,
    })),
    ...DEVIATION_CLUSTERS.map(key => ({
      key: `stage:${key}`, section: 'stage' as const, defaultText: DEVIATION_DICT[key].label_ru,
    })),
    ...Object.entries(SEASONAL_RULES).map(([key, rule]) => ({
      key: `seasonal:${key}`, section: 'seasonal' as const,
      defaultText: `${rule.label}. ${rule.action}`,
    })),
  ];
}

/**
 * All visible/exported editorial descriptions come from the same projection.
 * Keys outside the known catalog never alter a rule, and numerical or
 * structural N/Q/AD evidence is intentionally not editable here.
 */
export function procurementRuleSections(
  editorialOverrides: Readonly<Record<string, string>> = {},
): Array<{ title: string; paragraphs: string[] }> {
  const known = new Set(procurementEditableGuidance().map(entry => entry.key));
  const edited = (key: string, original: string): string =>
    known.has(key) && typeof editorialOverrides[key] === 'string' &&
      editorialOverrides[key].trim() !== '' ? editorialOverrides[key] : original;
  return [
    { title: 'Заполнение исходных таблиц', paragraphs: Object.entries(FIELD_GUIDANCE).map(([key, text]) => edited(`field:${key}`, text)) },
    { title: 'Основания ЕП', paragraphs: [
      'Распознанное объяснение не доказывает применимость правовой нормы. Нераспознанная формулировка означает ограничение словаря, а не ошибку исполнителя.',
      ...EP_REASON_CLUSTERS.map(key => edited(`ep:${key}`, EP_REASON_DICT[key].label_ru)),
    ] },
    { title: 'Объяснения сроков и этапов', paragraphs: [
      'Текст сохраняется дословно. Состояние и своевременность определяются структурными датами и подтверждениями, а не словами «заключён» или «не заключён».',
      ...DEVIATION_CLUSTERS.map(key => edited(`stage:${key}`, DEVIATION_DICT[key].label_ru)),
    ] },
    { title: 'Сезонные ориентиры', paragraphs: [SCREENING_NOTE,
      ...Object.entries(SEASONAL_RULES).map(([key, rule]) => edited(`seasonal:${key}`, `${rule.label}. ${rule.action}`)),
      `Внутренние даты просмотра: питание — ${SEASONAL_PARAMETERS.foodDeadline.day}.${SEASONAL_PARAMETERS.foodDeadline.month}, топливо — ${SEASONAL_PARAMETERS.fuelDeadline.day}.${SEASONAL_PARAMETERS.fuelDeadline.month}. Отсутствие N или суммы при пустой Q не доказывает отсутствие обеспечения.`,
    ] },
  ];
}
export function procurementRulesMarkdown(editorialOverrides: Readonly<Record<string, string>> = {}): string {
  return procurementRuleSections(editorialOverrides).map(section => `## ${section.title}\n\n${section.paragraphs.join('\n\n')}`).join('\n\n') + '\n';
}


export const RULE_REFERENCE_COPY = {
  title: 'Правила и подсказки заполнения',
  markdown: 'Скачать Markdown', docx: 'Скачать Word',
  pending: 'Подготовка документа…', failure: 'Не удалось подготовить документ. Повторите скачивание.',
};


export function seasonalDeadlineLabel(kind: 'food' | 'fuel', year: number): string {
  const deadline = kind === 'food' ? SEASONAL_PARAMETERS.foodDeadline : SEASONAL_PARAMETERS.fuelDeadline;
  return `${String(deadline.day).padStart(2, '0')}.${String(deadline.month).padStart(2, '0')}.${year}`;
}
