/**
 * upcoming.test.ts — «закупки, близкие к реализации» (канон п.75б).
 *
 * Отбор структурный (п.27), риск-контекст: дни до/после плановой даты,
 * причина словаря 2.0 с типом retro/live (п.75а), номер процедуры из AG
 * (п.74) и стадия мониторинга через переданную карту.
 */

import { describe, expect, it } from 'vitest';
import { dayNumberOf } from '@aemr/shared';
import { buildUpcoming, type UpcomingInputRow } from './upcoming.js';

const TODAY = dayNumberOf('14.08.2026')!;

function row(sheetRow: number, cells: Record<string, unknown>): UpcomingInputRow {
  return { dept: 'УЭР', sheetRow, cells };
}

describe('buildUpcoming — структурный отбор', () => {
  it('окно N дней: близкие и просроченные входят, дальние и заключённые — нет', () => {
    const rows = [
      // Просрочена: план в прошлом, заключения нет.
      row(4, { G: 'Просроченная', L: 'ЭА', K: '100', N: '01.07.2026', Q: 'Х' }),
      // Близкая: план через 10 дней.
      row(5, { G: 'Близкая', L: 'ЕП', K: '50', N: '24.08.2026', Q: 'X' }),
      // Дальняя: план через 60 дней — вне окна 14.
      row(6, { G: 'Дальняя', L: 'ЭА', K: '70', N: '13.10.2026', Q: '' }),
      // Заключена: дата факта есть — не «близкая к реализации».
      row(7, { G: 'Заключена', L: 'ЭА', K: '80', N: '01.07.2026', Q: '05.07.2026' }),
      // Плановая дата не распознана — окно применить не к чему.
      row(8, { G: 'Без даты', L: 'ЭА', K: '90', N: 'см. примечание', Q: 'Х' }),
    ];
    const got = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(got.map((r) => r.subject)).toEqual(['Просроченная', 'Близкая']);
    expect(got[0]).toMatchObject({ overdue: true, plannedDate: '2026-07-01' });
    expect(got[0].daysToPlan).toBeLessThan(0);
    expect(got[1]).toMatchObject({ overdue: false, daysToPlan: 10, plannedDate: '2026-08-24' });
  });

  it('сортировка: самая глубокая просрочка сверху', () => {
    const rows = [
      row(4, { G: 'Скоро', L: 'ЭА', K: 1, N: '20.08.2026', Q: 'Х' }),
      row(5, { G: 'Давно горит', L: 'ЭА', K: 1, N: '01.03.2026', Q: 'Х' }),
      row(6, { G: 'Недавно горит', L: 'ЭА', K: 1, N: '01.08.2026', Q: 'Х' }),
    ];
    const got = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(got.map((r) => r.subject)).toEqual(['Давно горит', 'Недавно горит', 'Скоро']);
  });
});

describe('buildUpcoming — риск-контекст', () => {
  it('живая причина словаря 2.0 (нет финансирования → kind=live) с адресом ячейки', () => {
    const rows = [
      row(4, {
        G: 'С причиной', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х',
        U: 'в связи отсутствием финансирования закупка переносится на 30.09.2026',
      }),
    ];
    const [r] = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(r.reason).not.toBeNull();
    expect(r.reason).toMatchObject({ id: 'no-funding', kind: 'live', cell: 'U4' });
    expect(r.hasLiveReason).toBe(true);
  });

  it('ретро-причина (техошибка даты) — причина есть, но живой проблемой не считается', () => {
    const rows = [
      row(4, {
        G: 'Ретро', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х',
        U: 'дата внесена ошибочно',
      }),
    ];
    const [r] = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(r.reason?.id).toBe('wrong-date-calculation');
    expect(r.hasLiveReason).toBe(false);
  });

  it('причина ищется и в AE/AF, если U — заглушка «Х»', () => {
    const rows = [
      row(4, {
        G: 'Причина в AF', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х',
        U: 'Х', AF: 'отсутствует финансирование',
      }),
    ];
    const [r] = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(r.reason).toMatchObject({ id: 'no-funding', cell: 'AF4' });
  });

  it('номер процедуры из AG — структурный парсер; стадия из переданной карты', () => {
    const rows = [
      row(4, { G: 'С кодом', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х', AG: 'ЭА152-26' }),
      row(5, { G: 'Искажённый код', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х', AG: 'А427-25' }),
      row(6, { G: 'Без кода', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х' }),
    ];
    const stages = new Map([['ЭА152-26', 'Подача заявок']]);
    const got = buildUpcoming(rows, { asOfDay: TODAY, days: 14, monitoringStages: stages });
    expect(got.find((r) => r.sheetRow === 4)).toMatchObject({
      procedureCode: 'ЭА152-26',
      monitoringStage: 'Подача заявок',
    });
    // Искажённый код не чинится молча — кода нет, стадии нет.
    expect(got.find((r) => r.sheetRow === 5)).toMatchObject({ procedureCode: null, monitoringStage: null });
    expect(got.find((r) => r.sheetRow === 6)).toMatchObject({ procedureCode: null, monitoringStage: null });
  });

  it('карта стадий не передана (мониторинг не подключён) — честный null, не выдумка', () => {
    const rows = [row(4, { G: 'С кодом', L: 'ЭА', K: 1, N: '01.07.2026', Q: 'Х', AG: 'ЭА152-26' })];
    const [r] = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(r.procedureCode).toBe('ЭА152-26');
    expect(r.monitoringStage).toBeNull();
  });

  it('сумма плана читается в операторском формате «1 234,56»', () => {
    const rows = [row(4, { G: 'Деньги', L: 'ЭА', K: '1 234,56', N: '01.07.2026', Q: 'Х' })];
    const [r] = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(r.planSum).toBeCloseTo(1234.56, 2);
  });

  it('мусор и пустота в сумме плана дают 0 — слагаемое, не «неизвестно» (страж консолидации 20.08)', () => {
    // planSum считается через таймлайновую null-коэрцию + `?? 0`; страж
    // фиксирует, что для слагаемого суммы окна мусор остаётся нулём.
    const rows = [
      row(4, { G: 'Мусор', L: 'ЭА', K: 'н/д', N: '01.07.2026', Q: 'Х' }),
      row(5, { G: 'Пусто', L: 'ЭА', K: '', N: '01.07.2026', Q: 'Х' }),
    ];
    const got = buildUpcoming(rows, { asOfDay: TODAY, days: 14 });
    expect(got.find((r) => r.sheetRow === 4)?.planSum).toBe(0);
    expect(got.find((r) => r.sheetRow === 5)?.planSum).toBe(0);
  });
});
