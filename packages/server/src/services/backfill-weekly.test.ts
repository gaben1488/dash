/**
 * Юниты чистой логики бэкфилла недельных снимков из ручных xlsx-выгрузок
 * (scripts/backfill-weekly-snapshots.ts — тонкая CLI-обёртка над этим модулем).
 *
 * Канон недели: срез — ЧЕТВЕРГ (день 0 эпохи — четверг). Дата папки выгрузки —
 * дата ОТПРАВКИ (обычно пятница); снимок приписывается четвергу той же недели.
 */
import { describe, expect, it } from 'vitest';
import { dayNumberOf, getDept } from '@aemr/shared';
import { productCalendarDay } from './product-calendar.js';
import {
  backfillSnapshotId,
  buildBackfillSnapshot,
  parseFolderDate,
  pickDeptSheet,
  thursdayMidnightIso,
  thursdayOfWeek,
  trimTrailingEmptyRows,
} from './backfill-weekly.js';

const day = (iso: string): number => dayNumberOf(iso)!;

describe('thursdayOfWeek — дата отправки → четверг той же недели', () => {
  it('пятница 08.05.2026 → четверг 07.05.2026 (обычный случай: отчёт уходит в пятницу)', () => {
    expect(thursdayOfWeek(day('2026-05-08'))).toBe(day('2026-05-07'));
  });

  it('четверг 11.06.2026 → сам 11.06.2026 (отправка в четверг перед праздником)', () => {
    expect(thursdayOfWeek(day('2026-06-11'))).toBe(day('2026-06-11'));
  });

  it('воскресенье 10.05.2026 → четверг 07.05.2026 (неделя понедельник–воскресенье)', () => {
    expect(thursdayOfWeek(day('2026-05-10'))).toBe(day('2026-05-07'));
  });
});

describe('parseFolderDate — «Отчет по закупкам дд.мм.гггг» → номер суток', () => {
  it('вытаскивает дату из имени папки', () => {
    expect(parseFolderDate('Отчет по закупкам 08.05.2026')).toBe(day('2026-05-08'));
  });

  it('папка без даты → null (не выгрузка, пропускается)', () => {
    expect(parseFolderDate('Черновики')).toBeNull();
  });
});

describe('thursdayMidnightIso / backfillSnapshotId — атрибуция снимка четвергу', () => {
  it('createdAt — полночь UTC: день 20580 совпадает на ОБЕИХ осях (UTC-запись и продукт +12)', () => {
    // 2026-05-07 — четверг: 20580 % 7 === 0 (день 0 эпохи — четверг).
    const thursday = 20580;
    expect(thursday % 7).toBe(0);
    expect(day('2026-05-07')).toBe(thursday);

    const iso = thursdayMidnightIso(thursday);
    expect(iso).toBe('2026-05-07T00:00:00.000Z');
    // Ось календарных записей: разбор строки даёт ровно этот четверг.
    expect(dayNumberOf(iso)).toBe(thursday);
    // Ось календаря продукта (Камчатка +12): floor(20580 + 12/24) = 20580 —
    // тот же четверг. Полдень UTC здесь дал бы 20581 (пятницу продукта),
    // и retention сгруппировал бы снимок в СЛЕДУЮЩУЮ неделю (блокер №1).
    expect(productCalendarDay(new Date(iso), 12)).toBe(thursday);
  });

  it('id несёт происхождение и день: backfill-2026-05-07', () => {
    expect(backfillSnapshotId(day('2026-05-07'))).toBe('backfill-2026-05-07');
  });
});

describe('pickDeptSheet — вкладка книги ГРБС по канону кандидатов', () => {
  it('у УЭР приоритет «ВСЕ» (периметр официального СВОДа), не одноимённая вкладка', () => {
    const sheets = ['ВСЕ', '_ChangeLog', 'Settings', 'Контроль', 'УЭР', 'МКУ "ЦЭР"'];
    expect(pickDeptSheet(sheets, getDept('УЭР'))).toBe('ВСЕ');
  });

  it('старая книга без «ВСЕ» → фолбэк на одноимённую вкладку', () => {
    expect(pickDeptSheet(['УЭР', 'Контроль'], getDept('УЭР'))).toBe('УЭР');
  });

  it('ГРБС без подведов ищется по своему имени', () => {
    expect(pickDeptSheet(['УИО', '_ChangeLog'], getDept('УИО'))).toBe('УИО');
  });

  it('ни одного кандидата → null (честный отказ, не угадывание)', () => {
    expect(pickDeptSheet(['Лист1', 'Sheet2'], getDept('УФБП'))).toBeNull();
  });
});

describe('trimTrailingEmptyRows — хвост пустых строк листа', () => {
  it('режет хвост из null/пустых строк, но НЕ строки формульных нулей', () => {
    const values = [
      ['шапка', 'x'],
      [0, 0], // формульный остаток — непустая строка, живой Google её тоже отдаёт
      [null, ''],
      [null, null],
    ];
    expect(trimTrailingEmptyRows(values)).toEqual([['шапка', 'x'], [0, 0]]);
  });

  it('внутренние пустые строки сохраняются — нумерация строк книги не сдвигается', () => {
    const values = [['a'], [null], ['b'], [null, '']];
    expect(trimTrailingEmptyRows(values)).toEqual([['a'], [null], ['b']]);
  });

  it('целиком пустой лист → пусто', () => {
    expect(trimTrailingEmptyRows([[null], ['']])).toEqual([]);
  });
});

describe('buildBackfillSnapshot — выгрузка → исторический DataSnapshot', () => {
  const header = [
    ['1', '2', '3'],
    ['группа', null, null],
    ['№ п/п', 'Управление', 'Подвед'],
  ];
  const d1 = ['1', 'УЭР АЕМР', 'МКУ "ЦЭР"'];
  const d2 = ['2', 'УЭР АЕМР', 'Х'];

  it('срезает шапку канон-хелпером, отсеивает не-ГРБС и пустые книги, датируется четвергом', () => {
    const thursday = day('2026-05-07');
    const snapshot = buildBackfillSnapshot(thursday, {
      sheetValuesByDept: {
        УЭР: [...header, d1, d2],
        Мусор: [...header, d1], // не-ГРБС ключ — не попадает в снимок
        УИО: [...header], // только шапка — данных нет, книга отсеивается
      },
    });

    expect(snapshot.id).toBe('backfill-2026-05-07');
    expect(snapshot.createdAt).toBe('2026-05-07T00:00:00.000Z');
    expect(snapshot.rowsByDept).toEqual({ УЭР: [d1, d2] });
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.metadata.perSheetRowCount).toEqual({ УЭР: 2 });
    // Ничего не выдумано: официальных метрик, сигналов и СВОДа в выгрузке нет.
    expect(snapshot.officialMetrics).toEqual({});
    expect(snapshot.calculatedMetrics).toEqual({});
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.svodGrid).toBeUndefined();
    expect(snapshot.trust.overall).toBe(0);
  });

  it('найденный в выгрузке СВОД попадает в снимок; пустой список блоков — нет', () => {
    const thursday = day('2026-06-11');
    const grid = [{ scope: 'ВСЕ', method: 'КП' as const, startRow: 9, periods: [] }];
    const withSvod = buildBackfillSnapshot(thursday, {
      sheetValuesByDept: { УЭР: [...header, d1] },
      svodGrid: grid,
    });
    expect(withSvod.svodGrid).toEqual(grid);

    const emptySvod = buildBackfillSnapshot(thursday, {
      sheetValuesByDept: { УЭР: [...header, d1] },
      svodGrid: [],
    });
    expect(emptySvod.svodGrid).toBeUndefined();
  });
});
