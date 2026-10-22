import { expect, it } from 'vitest';
import { DEPT_COLUMNS as C } from '@aemr/shared';
import { detectSeasonalAnomalies } from './seasonal.js';

const asOf = new Date('2026-10-21T00:00:00Z');
function row(subject: string, program = subject): unknown[] {
  const value: unknown[] = Array(34).fill('');
  value[C.ID] = 1; value[C.SUBJECT] = subject; value[C.PROGRAM_NAME] = program;
  value[C.TYPE] = 'Текущая деятельность'; value[C.METHOD] = 'ЕП';
  value[C.PLAN_DATE] = '01.05.2026'; return value;
}
it('does not infer road work from the program name when the subject is paper', () => {
  const value = row('Бумага', 'Ремонт дорог'); value[C.FACT_DATE] = '15.01.2026';
  expect(detectSeasonalAnomalies([value], 'uo', asOf).some(a => a.type === 'WINTER_ROAD_WORK')).toBe(false);
});
it('does not call a financed annual position unpurchased because Q is empty', () => {
  const value = row('Поставка топлива'); value[C.MB_FACT] = 10;
  expect(detectSeasonalAnomalies([value], 'uo', asOf).some(a => a.type === 'LATE_FUEL_PROCUREMENT')).toBe(false);
});
it('does not assign a missed deadline without a planned date', () => {
  const value = row('Поставка топлива'); value[C.PLAN_DATE] = '';
  expect(detectSeasonalAnomalies([value], 'uo', asOf).some(a => a.type === 'LATE_FUEL_PROCUREMENT')).toBe(false);
});
it('does not treat a future contract date as already concluded winter work', () => {
  const value = row('Ремонт дороги'); value[C.FACT_DATE] = '15.01.2027';
  expect(detectSeasonalAnomalies([value], 'uo', asOf).some(a => a.type === 'WINTER_ROAD_WORK')).toBe(false);
});
