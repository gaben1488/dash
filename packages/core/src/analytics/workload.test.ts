import { describe, expect, it } from 'vitest';
import { deptWorkload, workloadReport } from './workload.js';

/**
 * Фикстуры — живой замер 18.08.2026 (дампы книг + прод /api/rows).
 * У УО строки прочитаны страницей в 1000 при 2675 на листе: этим и проверяем
 * признак усечения.
 */
const LIVE = [
  { deptId: 'uo', rows: 2675, subordinates: 44, journalEntries: 33724 },
  { deptId: 'uksimp', rows: 676, subordinates: 22, journalEntries: 4904 },
  { deptId: 'ud', rows: 198, subordinates: 2, journalEntries: 568 },
  { deptId: 'ufbp', rows: 46, subordinates: 1, journalEntries: 124 },
  { deptId: 'uagzo', rows: 69, subordinates: 1, journalEntries: 70 },
  { deptId: 'udtx', rows: 67, subordinates: 1, journalEntries: 34 },
  { deptId: 'uer', rows: 86, subordinates: 2, journalEntries: 31 },
  { deptId: 'uio', rows: 70, subordinates: 1, journalEntries: 13 },
];

describe('нагрузка управлений (канон п.103)', () => {
  it('меры считаются отношениями, а не абсолютом', () => {
    const uo = deptWorkload(LIVE[0]);
    expect(uo.editsPerRow).toBeCloseTo(12.61, 1);
    expect(uo.rowsPerSubordinate).toBeCloseTo(60.8, 1);
    expect(uo.editsPerSubordinate).toBeCloseTo(766.5, 0);
  });

  it('журнал УО богат, журнал УИО слеп — при близких абсолютных числах строк', () => {
    expect(deptWorkload(LIVE[0]).observability).toBe('rich');
    const uio = deptWorkload(LIVE[7]);
    expect(uio.observability).toBe('blind');
    // Главное требование канона: слепой журнал НЕ выдаётся за отсутствие работы.
    expect(uio.note).toContain('не означает');
  });

  it('УФБП: 124 записи на 46 строк — живой журнал', () => {
    expect(deptWorkload(LIVE[3]).observability).toBe('rich');
  });

  it('УДТХ (34 на 67) и УАГЗО (70 на 69) — журнал редкий: правки есть, но история неполна', () => {
    // Порог «богатого» журнала — 2 правки на строку: одна правка на строку
    // означает, что половина строк не менялась ни разу с момента ввода.
    expect(deptWorkload(LIVE[5]).observability).toBe('thin');
    expect(deptWorkload(LIVE[4]).observability).toBe('thin');
  });

  it('деление на ноль даёт null, а не бесконечность и не выдуманный ноль', () => {
    const empty = deptWorkload({ deptId: 'x', rows: 0, subordinates: 0, journalEntries: 0 });
    expect(empty.editsPerRow).toBeNull();
    expect(empty.rowsPerSubordinate).toBeNull();
    expect(empty.editsPerSubordinate).toBeNull();
    expect(empty.observability).toBe('blind');
  });

  it('усечённое чтение помечается и объясняется', () => {
    const cut = deptWorkload({ ...LIVE[0], rows: 1000, rowsTruncated: true });
    expect(cut.truncated).toBe(true);
    expect(cut.note).toContain('не полностью');
  });

  it('сводка: порядок по строкам на учреждение, итоги, слепые книги, разброс', () => {
    const r = workloadReport(LIVE);
    expect(r.depts[0].deptId).toBe('ud'); // 99 строк на учреждение — тяжелее всех
    expect(r.totals.rows).toBe(3887);
    expect(r.totals.subordinates).toBe(74);
    expect(r.totals.journalEntries).toBe(39468);
    // Слепые — те, где журнал не покрывает и половины строк: УИО 0,19 и УЭР 0,36.
    expect(r.blindDepts).toEqual(expect.arrayContaining(['uio', 'uer']));
    expect(r.rowsPerSubordinateSpread).toBeGreaterThan(2);
  });

  it('пустой список не ломает сводку', () => {
    const r = workloadReport([]);
    expect(r.depts).toEqual([]);
    expect(r.totals.rows).toBe(0);
    expect(r.rowsPerSubordinateSpread).toBeNull();
  });
});
