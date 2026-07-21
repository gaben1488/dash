/**
 * Характеризация + юниты rows-dto.ts (E11-2 rethink, 2026-07-21).
 * Фиксирует внешний контракт DTO GET /api/rows/:deptId: форма полей,
 * дата-канон (serial/«дд.мм.гггг»/ISO → «YYYY-MM-DD»|null), статус-лейблы,
 * отсев не-данных isDataRow.
 */
import { describe, expect, it } from 'vitest';
import { buildRowDto, isDataRow, sheetDateToIso } from './rows-dto.js';
import { COL_LETTER_INDEX } from '@aemr/shared';

// ── Хелпер: строка листа из словаря «буква → значение» ──
function makeRow(cells: Record<string, unknown>): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  for (const [col, val] of Object.entries(cells)) {
    row[COL_LETTER_INDEX[col]] = val;
  }
  return row;
}

describe('sheetDateToIso — дата-канон DTO', () => {
  it('«дд.мм.гггг» → ISO без сдвига дня (строковые операции, не Date)', () => {
    expect(sheetDateToIso('15.03.2026')).toBe('2026-03-15');
    expect(sheetDateToIso('1.3.2026')).toBe('2026-03-01');
  });

  it('Google-serial (число и строка-число) → ISO', () => {
    // 46023 = 01.01.2026 (канон parseSheetDate)
    expect(sheetDateToIso(46023)).toBe('2026-01-01');
    expect(sheetDateToIso('46034')).toBe('2026-01-12');
  });

  it('ISO-строка проходит насквозь', () => {
    expect(sheetDateToIso('2026-05-09')).toBe('2026-05-09');
  });

  it('пусто/null/мусор → null', () => {
    expect(sheetDateToIso('')).toBeNull();
    expect(sheetDateToIso(null)).toBeNull();
    expect(sheetDateToIso(undefined)).toBeNull();
    expect(sheetDateToIso('не дата')).toBeNull();
  });
});

describe('buildRowDto — маппинг строки листа в DTO', () => {
  // Подписанная закупка: состояние 'signed' не зависит от текущей даты.
  const signedRow = makeRow({
    A: '5', B: 'РН-001', C: 'МКУ Тест', D: 'Программа X', F: 'Текущая деятельность',
    G: 'Поставка бумаги', H: '100', I: '200', J: '0', K: '300', L: 'ЭА',
    N: '15.03.2026', O: 'I', P: '2026', Q: 46023, R: 'I', U: 'Подписан',
    V: '90', W: '180', X: '0', Y: '270', Z: '10', AA: '20', AB: '0',
    AD: 'Да', AE: 'коммент ГРБС', AF: 'коммент УЭР',
  });

  it('идентификация и rowIndex (idx=0 → строка листа 4)', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.rowIndex).toBe(4);
    expect(dto.id).toBe('5');
    expect(dto.regNumber).toBe('РН-001');
    expect(dto.subordinate).toBe('МКУ Тест');
    expect(dto.programName).toBe('Программа X');
    expect(dto.type).toBe('Текущая деятельность');
    expect(dto.subject).toBe('Поставка бумаги');
    expect(dto.dept).toBe('uo');
  });

  it('деньги: план/факт/экономия парсятся в числа, экономия суммируется', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.planFB).toBe(100);
    expect(dto.planKB).toBe(200);
    expect(dto.planMB).toBe(0);
    expect(dto.planSum).toBe(300);
    expect(dto.factSum).toBe(270);
    expect(dto.economyFB).toBe(10);
    expect(dto.economyKB).toBe(20);
    expect(dto.economyMB).toBe(0);
    expect(dto.economy).toBe(30);
    expect(dto.planYear).toBe(2026);
  });

  it('деньги: пустые ячейки → 0, числовые значения проходят как есть', () => {
    const dto = buildRowDto(makeRow({ G: 'x', K: 2000.5 }), 0, { deptId: 'uo' });
    expect(dto.planSum).toBe(2000.5);
    expect(dto.factSum).toBe(0);
    expect(dto.economy).toBe(0);
    expect(dto.planYear).toBe(0);
  });

  it('деньги: строка с пробелами-разделителями и запятой нормализуется (канон toNumber)', () => {
    const dto = buildRowDto(makeRow({ G: 'x', K: '1 234,56', Y: '2,5' }), 0, { deptId: 'uo' });
    expect(dto.planSum).toBe(1234.56);
    expect(dto.factSum).toBe(2.5);
  });

  it('даты: ISO-канон + сырое значение листа рядом (*Raw)', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.planDate).toBe('2026-03-15');
    expect(dto.planDateRaw).toBe('15.03.2026');
    expect(dto.factDate).toBe('2026-01-01');
    expect(dto.factDateRaw).toBe(46023);
  });

  it('состояние/статус/сигналы: signed → русский лейбл «Подписан», signals — массив активных ключей', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.state).toBe('signed');
    expect(dto.status).toBe('Подписан');
    expect(dto.signals).toContain('signed');
    expect(Array.isArray(dto.badges)).toBe(true);
  });

  it('flag и комментарии проходят насквозь', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.flag).toBe('Да');
    expect(dto.commentGRBS).toBe('коммент ГРБС');
    expect(dto.commentExtra).toBe('коммент УЭР');
  });
});

describe('isDataRow — отсев не-данных', () => {
  const base = { subject: 'Поставка бумаги', id: '12', planSum: 100, method: 'ЭА' };

  it('обычная строка данных проходит', () => {
    expect(isDataRow(base)).toBe(true);
  });

  it('пустой предмет и нулевой план → отсев', () => {
    expect(isDataRow({ ...base, subject: '', planSum: 0 })).toBe(false);
  });

  it('пустой предмет, но есть план → проходит', () => {
    expect(isDataRow({ ...base, subject: '' })).toBe(true);
  });

  it('итоговые/шапочные строки (isMetaRow) → отсев', () => {
    expect(isDataRow({ ...base, subject: 'Итого по разделу' })).toBe(false);
    expect(isDataRow({ ...base, subject: 'ВСЕГО' })).toBe(false);
  });

  it('id — текст шапки («№ п/п») → отсев; числовой id → проходит', () => {
    expect(isDataRow({ ...base, id: '№ п/п' })).toBe(false);
    expect(isDataRow({ ...base, id: 12 })).toBe(true);
    expect(isDataRow({ ...base, id: '' })).toBe(true);
  });

  it('method — заголовочный текст (длиннее 5, не ЭА/ЭК/ЭЗК/ЕП) → отсев', () => {
    expect(isDataRow({ ...base, method: 'Способ определения поставщика' })).toBe(false);
    expect(isDataRow({ ...base, method: 'ЕП' })).toBe(true);
    expect(isDataRow({ ...base, method: '' })).toBe(true);
  });
});
