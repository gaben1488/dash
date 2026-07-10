/**
 * Канон «пустая дата факта» (столбец Q, FACT_DATE=16) — SSOT вместо двух копий,
 * найденных чанком E: calc-engine.ts `PLACEHOLDERS`+`notEmpty`-gate (без '' в Set,
 * '' проверялась отдельным условием) и unified-svod.ts `FACT_EMPTY`+`hasFact()`
 * (с '' прямо в Set). Значения одинаковые, представление разное — здесь сведено.
 *
 * СЕМАНТИЧЕСКИ ОТДЕЛЬНО от ORG_ITSELF_PLACEHOLDERS (org-itself.ts): та же ролёвка
 * восьми строк-плейсхолдеров, но отвечает на другой вопрос другой колонки
 * («это само управление?» столбца C, а не «есть дата факта?» столбца Q). Не
 * объединять даже при совпадении списков — независимый дрейф это разные явления.
 */
import { describe, it, expect } from 'vitest';
import { FACT_DATE_PLACEHOLDERS, hasFactDate } from './fact-date.js';

describe('hasFactDate — канон пустой даты факта', () => {
  it('пустая строка — нет факта', () => {
    expect(hasFactDate('')).toBe(false);
    expect(hasFactDate(null)).toBe(false);
    expect(hasFactDate(undefined)).toBe(false);
  });

  it('текстовые плейсхолдеры — нет факта (регистр и пробелы не важны)', () => {
    for (const v of ['х', 'X', ' Х ', '-', '—', '–', 'Н/Д', 'нет', 'не определена']) {
      expect(hasFactDate(v)).toBe(false);
    }
  });

  it('настоящая дата — есть факт', () => {
    expect(hasFactDate('20.02.2025')).toBe(true);
  });

  it('произвольный непустой текст — есть факт (гейт не валидирует формат даты)', () => {
    expect(hasFactDate('см. примечание')).toBe(true);
  });

  it('набор плейсхолдеров содержит ровно 9 значений, включая пустую строку', () => {
    expect(FACT_DATE_PLACEHOLDERS.size).toBe(9);
    expect(FACT_DATE_PLACEHOLDERS.has('')).toBe(true);
  });
});
