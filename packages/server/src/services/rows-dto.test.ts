/**
 * Характеризация + юниты rows-dto.ts (E11-2 rethink, 2026-07-21).
 * Фиксирует внешний контракт DTO GET /api/rows/:deptId: форма полей,
 * дата-канон (serial/«дд.мм.гггг»/ISO → «YYYY-MM-DD»|null), статус-лейблы,
 * отсев не-данных isDataRow.
 */
import { describe, expect, it, vi } from 'vitest';
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
  it('не превращает невозможный день или неполную дату в календарный факт', () => {
    for (const value of ['31.02.2026', '29.02.2026', '2026', '2026-01-01TNOT_A_TIME']) {
      expect(sheetDateToIso(value), value).toBeNull();
    }
  });
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
    M: 'МОНОПОЛИСТ', T: '4',
    AD: 'Да', AE: 'обоснование', AF: 'коммент ГРБС', AG: 'коммент УЭР', AH: 'коммент УФБП',
  });

  it('идентификация и rowIndex (idx=0 → строка листа 4)', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.rowIndex).toBe(4);
    expect(dto.id).toBe('5');
    expect(dto.managementName).toBe('РН-001');
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
    expect(dto.commentUFBP).toBe('коммент УФБП');
  });

  it('колонки M и T доходят до ответа: основание ЕП и официальная просрочка', () => {
    const dto = buildRowDto(signedRow, 0, { deptId: 'uo' });
    expect(dto.epReason).toBe('МОНОПОЛИСТ');
    expect(dto.deviationDays).toBe(4);
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

 it('retains AE/AF read-only source context and treats K/Y as position totals', () => {
  const row: unknown[] = Array(34).fill('');
  row[0] = '999'; row[6] = 'Годовая потребность'; row[10] = 1200;
  row[11] = 'ЕП'; row[12] = ''; row[16] = '10.10.2026'; row[24] = 1200;
  row[30] = 'Обоснование необходимости'; row[31] = 'Два договора по 600';
  const dto = buildRowDto(row, 0, { deptId: 'UKSiMP' });
  expect(dto).toMatchObject({ amountBasis: 'position-total',
    necessityJustification: row[30], commentGRBS: row[31] });
  expect(dto.badges.find(b => b.icon === 'shield-alert')).toMatchObject({ color: 'yellow' });
});

describe('future Q badge uses actual N calendar context', () => {
  it.each([['15.06.2027',2026,'yellow'], ['15.06.2026',2027,'blue'], ['',2026,'yellow']])('N=%s/P=%s produces %s', (n,p,color) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026,0,10));
    try {
      const dto=buildRowDto(makeRow({A:'3',G:'Окорока (куриные)',L:'ЕП',K:100,Y:80,N:n,P:p,Q:'15.06.2026'}),0,{deptId:'uksimp'});
      expect(dto.badges.find(b=>b.icon==='calendar-x')?.color).toBe(color);
      expect(dto.planDateRaw).toBe(n);
    } finally { vi.useRealTimers(); }
  });
});
