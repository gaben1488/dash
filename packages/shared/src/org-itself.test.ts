import { describe, it, expect } from 'vitest';
import { isOrgItself, subordinateKey, subordinateNameMatchKey, ORG_ITSELF_PLACEHOLDERS } from './org-itself';
import { ORG_ITSELF_SENTINEL } from './dictionaries/subordinate-registry';

describe('org-itself канон (столбец C — аппарат ГРБС vs подвед)', () => {
  it('пусто / X / Х / тире / текст-плейсхолдеры → само управление', () => {
    for (const v of ['', '  ', 'X', 'x', 'Х', 'х', '-', '—', '–', 'н/д', 'нет', 'не определена']) {
      expect(isOrgItself(v)).toBe(true);
    }
    expect(isOrgItself(null)).toBe(true);
    expect(isOrgItself(undefined)).toBe(true);
  });

  it('регистро- и пробело-устойчиво для текст-плейсхолдеров', () => {
    expect(isOrgItself(' Н/Д ')).toBe(true);
    expect(isOrgItself('НЕ ОПРЕДЕЛЕНА')).toBe(true);
    expect(isOrgItself(' Нет ')).toBe(true);
  });

  it('реальный подвед → НЕ само управление', () => {
    expect(isOrgItself('МКУ ЦЭР')).toBe(false);
    expect(isOrgItself('Школа №1')).toBe(false);
    expect(isOrgItself('Х-такой-то подвед')).toBe(false); // не одиночный символ
  });

  it('subordinateKey: само управление → сентинел, подвед → trim(имя)', () => {
    expect(subordinateKey('')).toBe(ORG_ITSELF_SENTINEL);
    expect(subordinateKey('н/д')).toBe(ORG_ITSELF_SENTINEL);
    expect(subordinateKey('  МКУ ЦЭР  ')).toBe('МКУ ЦЭР');
  });

  it('варианты кавычек, е/ё, регистра и № не создают разных организаций', () => {
    expect(subordinateNameMatchKey('МБУ ДО "КДМШ"')).toBe(subordinateNameMatchKey('МБУ ДО «КДМШ»'));
    expect(subordinateNameMatchKey('МБДОУ ДС № 9 «Звездочка»')).toBe(subordinateNameMatchKey('МБДОУ ДС № 9 «Звёздочка»'));
    expect(subordinateNameMatchKey('МБОУ «Школа №3»')).toBe(subordinateNameMatchKey('МБОУ «Школа № 3»'));
    expect(subordinateNameMatchKey('МБУ ДО «ДШИ п.Термальный»')).toBe(subordinateNameMatchKey('МБУ ДО «ДШИ п. Термальный»'));
    expect(subordinateNameMatchKey('МБУ ДО «КДМШ»')).not.toBe(subordinateNameMatchKey('МБУ ДО «РДМШ»'));
    expect(subordinateNameMatchKey('Х')).toBe(ORG_ITSELF_SENTINEL);
    expect(subordinateKey('МБУ ДО "КДМШ"')).toBe('МБУ ДО "КДМШ"');
  });
  it('регресс бага regex-only: н/д/нет/не определена входят в канон', () => {
    // orchestrator/dataset-signals/validate раньше считали их отдельным подведом
    for (const v of ['н/д', 'нет', 'не определена']) {
      expect(ORG_ITSELF_PLACEHOLDERS.has(v)).toBe(true);
      expect(subordinateKey(v)).toBe(ORG_ITSELF_SENTINEL);
    }
  });
});
