/**
 * SINGLE source of truth for fictitious procurement examples in Design Lab.
 * Stable labels are for display only; not database IDs, source row keys or real data.
 * No access to Google Sheets, Fastify or operational records.
 */
export const LAB_DEMO_ROWS = [
  {
    id: '173/1', sourceRow: 14, org: 'УО', work: 'ДЕМО · Оснащение школы',
    planThousands: 4200, planDisplay: '4 200', state: 'Нужен источник', issue: true,
    source: 'Учебный лист · D14', formula: 'D14: 4 200 тыс. ₽; источник не подтверждён',
    note: 'Примечание ячейки: уточнить основание суммы',
    discussion: 'Обсуждение: вопрос направлен исполнителю, ответа нет',
    action: 'Сверить исходную ячейку и основание суммы.',
  },
  {
    id: '173/2', sourceRow: 15, org: 'УКСиМП', work: 'ДЕМО · Ремонт учреждения',
    planThousands: 7800, planDisplay: '7 800', state: 'Проверено', issue: false,
    source: 'Учебный лист · D15', formula: 'D15: 7 800 тыс. ₽ (учебный пример)',
    note: 'Примечаний нет', discussion: 'Обсуждений нет',
    action: 'В этом учебном примере дополнительных действий нет.',
  },
  {
    id: '174', sourceRow: 16, org: 'УО', work: 'ДЕМО · Приобретение оборудования',
    planThousands: 1620, planDisplay: '1 620', state: 'Нужен комментарий', issue: true,
    source: 'Учебный лист · D16', formula: 'D16: 1 620 тыс. ₽ (учебный пример)',
    note: 'Примечание ячейки: ожидаем пояснение',
    discussion: 'Обсуждение: уточнить срок и ответственное лицо',
    action: 'Запросить пояснение к строке 174.',
  },
] as const;

export const LAB_DEMO_TOTAL_THOUSANDS = LAB_DEMO_ROWS.reduce((sum, row) => sum + row.planThousands, 0);

export function demoFilterRows(query: string, org: string): typeof LAB_DEMO_ROWS[number][] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return LAB_DEMO_ROWS.filter(row =>
    (org === 'all' || row.org === org) &&
    (row.id.toLocaleLowerCase('ru') + ' ' + row.work.toLocaleLowerCase('ru')).includes(needle),
  );
}
