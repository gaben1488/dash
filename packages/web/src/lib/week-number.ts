/**
 * Номер недели по ИСО 8601: неделя начинается с понедельника, первой неделей
 * года считается та, на которую пришёлся первый четверг.
 *
 * Жил внутри Header.tsx (барабан недель); вынесен 29.08.2026 без изменений,
 * когда номер недели понадобился жетону «срез недели» в правом углу шапки —
 * импорт из Header дал бы кольцо (Header сам монтирует угол).
 */
export function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
