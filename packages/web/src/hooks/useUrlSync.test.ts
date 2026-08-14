/**
 * Страж бага #15 (реестр охоты 08.08): ссылка с `?months=` восстанавливала
 * данные (activeMonths), но не барабан (monthsByYear) — TimeDrum показывал
 * пустой выбор при отфильтрованном экране. Канон: параметр `months` несёт
 * ГОД каждого выбора (`2025:1,2;2026:7`), разбор заполняет и activeMonths,
 * и monthsByYear; легаси-формат без года читается и приписывается году URL.
 */
import { describe, expect, it } from 'vitest';
import { serializeMonthsParam, parseMonthsParam } from './useUrlSync';

describe('serializeMonthsParam', () => {
  it('однолетний выбор — с годом (чтобы восстановился барабан)', () => {
    expect(serializeMonthsParam({ 2026: new Set([7, 5]) }, new Set([5, 7]), 2026))
      .toBe('2026:5,7');
  });

  it('многолетний выбор — все годы через «;», годы по возрастанию', () => {
    expect(serializeMonthsParam(
      { 2026: new Set([7]), 2025: new Set([1, 2]) },
      new Set([7]),
      2026,
    )).toBe('2025:1,2;2026:7');
  });

  it('легаси-состояние: месяцы без барабана — приписываются году фильтра', () => {
    expect(serializeMonthsParam({}, new Set([4]), 2025)).toBe('2025:4');
  });

  it('выбора нет — null (параметр не пишется)', () => {
    expect(serializeMonthsParam({}, new Set(), 2026)).toBeNull();
    expect(serializeMonthsParam({ 2026: new Set() }, new Set(), 2026)).toBeNull();
  });
});

describe('parseMonthsParam', () => {
  it('формат с годом: восстанавливает и месяцы, и барабан, и год', () => {
    const p = parseMonthsParam('2025:1,2;2026:7', 2026);
    expect(p).not.toBeNull();
    expect([...p!.monthsByYear[2025]]).toEqual([1, 2]);
    expect([...p!.monthsByYear[2026]]).toEqual([7]);
    expect(p!.year).toBe(2026); // год URL присутствует в выборе — он и активен
    expect([...p!.activeMonths]).toEqual([7]);
  });

  it('год URL отсутствует в выборе — активным становится первый год выбора', () => {
    const p = parseMonthsParam('2025:3', 2026);
    expect(p!.year).toBe(2025);
    expect([...p!.activeMonths]).toEqual([3]);
    expect([...p!.monthsByYear[2025]]).toEqual([3]);
  });

  it('легаси-формат без года: месяцы приписываются году URL (и попадают в барабан)', () => {
    const p = parseMonthsParam('5,6', 2026);
    expect([...p!.activeMonths]).toEqual([5, 6]);
    expect([...p!.monthsByYear[2026]]).toEqual([5, 6]); // раньше барабан оставался пустым
    expect(p!.year).toBe(2026);
  });

  it('мусор отбрасывается; полностью невалидное значение — null', () => {
    expect(parseMonthsParam('abc', 2026)).toBeNull();
    expect(parseMonthsParam('2026:99,0', 2026)).toBeNull();
    const p = parseMonthsParam('2026:5,99', 2026);
    expect([...p!.activeMonths]).toEqual([5]);
  });

  it('round-trip: serialize → parse даёт тот же выбор', () => {
    const mby = { 2025: new Set([1, 2]), 2026: new Set([7, 8]) };
    const s = serializeMonthsParam(mby, new Set([7, 8]), 2026)!;
    const p = parseMonthsParam(s, 2026)!;
    expect([...p.monthsByYear[2025]]).toEqual([1, 2]);
    expect([...p.monthsByYear[2026]]).toEqual([7, 8]);
    expect(p.year).toBe(2026);
  });
});
