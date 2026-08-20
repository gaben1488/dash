import { describe, expect, it } from 'vitest';
import {
  DATE_SERIAL_MAX,
  DATE_SERIAL_MIN,
  detectDateFormatIssues,
  detectDateShownAsNumber,
} from './cell-format-integrity.js';

describe('сбитый формат ячейки даты', () => {
  it('живой случай: в графе плановой даты показано 46172', () => {
    // Книга культуры, июнь 2026: формат ячейки сбился, оператор увидел код.
    const f = detectDateShownAsNumber('46172', 'N', 437);
    expect(f).not.toBeNull();
    expect(f!.meansDate).toBe('30.05.2026');
    expect(f!.mechanism).toContain('N437');
    expect(f!.mechanism).toContain('значение верное');
    expect(f!.action).toContain('формат даты');
  });

  it('дата, показанная как дата, дефектом не считается', () => {
    expect(detectDateShownAsNumber('15.06.2026', 'N', 10)).toBeNull();
    expect(detectDateShownAsNumber('2026-06-15', 'Q', 10)).toBeNull();
  });

  it('заглушка «Х» и пустота молчат', () => {
    expect(detectDateShownAsNumber('Х', 'Q', 10)).toBeNull();
    expect(detectDateShownAsNumber('', 'N', 10)).toBeNull();
    expect(detectDateShownAsNumber(null, 'N', 10)).toBeNull();
  });

  it('сумма с разрядами не принимается за код даты', () => {
    // «46 172» — деньги, попавшие в графу даты: другой дефект, другая карточка.
    expect(detectDateShownAsNumber('46 172', 'N', 10)).toBeNull();
  });

  it('числа вне горизонта книги закупок не трогаем', () => {
    expect(detectDateShownAsNumber(String(DATE_SERIAL_MIN - 1), 'N', 10)).toBeNull();
    expect(detectDateShownAsNumber(String(DATE_SERIAL_MAX + 1), 'N', 10)).toBeNull();
    expect(detectDateShownAsNumber('12345', 'N', 10)).toBeNull();
    expect(detectDateShownAsNumber('300', 'N', 10)).toBeNull();
  });

  it('границы диапазона включительны и означают ожидаемые годы', () => {
    expect(detectDateShownAsNumber(String(DATE_SERIAL_MIN), 'N', 1)!.meansDate).toBe('01.01.2023');
    expect(detectDateShownAsNumber(String(DATE_SERIAL_MAX), 'N', 1)!.meansDate).toBe('30.12.2032');
  });

  it('дробный код (дата со временем) читается по целой части', () => {
    expect(detectDateShownAsNumber('46172,5', 'Q', 3)!.meansDate).toBe('30.05.2026');
  });

  it('строка проверяется по обеим рукописным графам, производные не трогаются', () => {
    const found = detectDateFormatIssues({ N: '46172', O: '2', P: '2026', Q: '46200' }, 500);
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.mechanism.includes('N500'))).toContain(true);
    expect(found.map((f) => f.mechanism.includes('Q500'))).toContain(true);
  });
});
