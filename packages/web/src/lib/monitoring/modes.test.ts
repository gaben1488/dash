/**
 * Страж п.128-1 (владелец 20.08.2026): линейки листов управлений внутри
 * вкладки «Мониторинг» нет — срез по управлению даёт глобальный фильтр шапки
 * (изоляция п.127). Тест не даст восьми кнопкам управлений тихо вернуться в
 * ряд режимов и снова раздуть верх вкладки.
 */
import { describe, expect, it } from 'vitest';
import { ALL_DEPTS_MODE, SHEET_MODES, modeById } from './modes';

describe('режимы листов книги (п.128-1)', () => {
  it('в ряду пять режимов и ни одного режима отдельного управления', () => {
    expect(SHEET_MODES).toHaveLength(5);
    expect(SHEET_MODES.some((m) => m.id.startsWith('dept:'))).toBe(false);
    expect(SHEET_MODES.some((m) => m.dept !== null)).toBe(false);
  });

  it('порядок — порядок книги: реестр, свод, 25-26, справочник, предки', () => {
    expect(SHEET_MODES.map((m) => m.kind)).toEqual([
      'registry', 'svod', 'journal', 'directory', 'ancestors',
    ]);
  });

  it('незнакомый ид (в т.ч. бывший dept:УО из старой сессии) падает в реестр', () => {
    expect(modeById('dept:УО')).toBe(ALL_DEPTS_MODE);
    expect(modeById('нет такого')).toBe(ALL_DEPTS_MODE);
  });
});
