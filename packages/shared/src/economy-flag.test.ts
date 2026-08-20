/**
 * Стражи канона «Экономия без отметки» (консолидация 21.08.2026, решение
 * владельца 20.08). Держат ровно то, что владелец назвал определением:
 * план > 0, факт > 0, факт < плана, графа «Статус» не несёт ни «да», ни «нет»;
 * единственный поставщик входит в класс, но род называется вслух.
 */
import { describe, expect, it } from 'vitest';
import {
  ECONOMY_FLAG_CANON,
  economyFlagState,
  economyFlagVerdict,
  isEconomyFlagUndetermined,
} from './economy-flag.js';
import { SIGNAL_LABELS } from './product-dictionary.js';

const base = { planTotal: 1000, factTotal: 800, adCell: '', isEp: false };

describe('графа «Статус» (AD) — решение органа', () => {
  it('«да» и «нет» — это решения, всё остальное решением не является', () => {
    expect(economyFlagState('да')).toBe('approved');
    expect(economyFlagState(' ДА ')).toBe('approved');
    expect(economyFlagState('yes')).toBe('approved');
    expect(economyFlagState('нет')).toBe('declined');
    expect(economyFlagState('no')).toBe('declined');
    expect(economyFlagState('')).toBe('undetermined');
    expect(economyFlagState(null)).toBe('undetermined');
    expect(economyFlagState(undefined)).toBe('undetermined');
    // Заглушки операторов — та же непроставленная отметка (канон маркера отсутствия).
    expect(economyFlagState('X')).toBe('undetermined');
    expect(economyFlagState('·')).toBe('undetermined');
    expect(economyFlagState('—')).toBe('undetermined');
  });
});

describe('определение явления «Экономия без отметки»', () => {
  it('план и факт заполнены, факт меньше плана, отметки нет — строка в классе', () => {
    const v = economyFlagVerdict(base);
    expect(v.matches).toBe(true);
    expect(v.economy).toBeCloseTo(200, 6);
    expect(v.sharePct).toBeCloseTo(20, 6);
    expect(v.kind).toBe('competitive');
  });

  it('«нет» в графе — решение органа, а не пробел: строка из класса выпадает', () => {
    expect(isEconomyFlagUndetermined({ ...base, adCell: 'нет' })).toBe(false);
  });

  it('«да» в графе — решение принято: строка из класса выпадает', () => {
    expect(isEconomyFlagUndetermined({ ...base, adCell: 'да' })).toBe(false);
  });

  it('факт не ниже плана — экономии по числам нет, класса нет', () => {
    expect(isEconomyFlagUndetermined({ ...base, factTotal: 1000 })).toBe(false);
    expect(isEconomyFlagUndetermined({ ...base, factTotal: 1200 })).toBe(false);
  });

  it('закупка не исполнена (факта нет) — вопроса об отметке ещё не возникло', () => {
    expect(isEconomyFlagUndetermined({ ...base, factTotal: 0 })).toBe(false);
    expect(isEconomyFlagUndetermined({ ...base, factTotal: null })).toBe(false);
  });

  it('плана нет — считать долю не от чего', () => {
    expect(isEconomyFlagUndetermined({ ...base, planTotal: null })).toBe(false);
    expect(isEconomyFlagUndetermined({ ...base, planTotal: 0 })).toBe(false);
  });

  it('разница в копейку — остаток двоичной арифметики, а не экономия', () => {
    // План хранится в двух знаках, факт в пяти: 0,003 тыс = 3 рубля.
    expect(isEconomyFlagUndetermined({ ...base, planTotal: 100, factTotal: 99.997 })).toBe(false);
    // А сотня рублей — уже настоящая экономия, её прежний порог в тысячу прятал.
    expect(isEconomyFlagUndetermined({ ...base, planTotal: 100, factTotal: 99.9 })).toBe(true);
  });

  it('нечисло не притворяется числом', () => {
    expect(isEconomyFlagUndetermined({ ...base, planTotal: NaN })).toBe(false);
    expect(isEconomyFlagUndetermined({ ...base, factTotal: NaN })).toBe(false);
  });

  it('единственный поставщик входит в класс, но род назван (решение владельца 20.08)', () => {
    const v = economyFlagVerdict({ ...base, isEp: true });
    expect(v.matches).toBe(true);
    expect(v.kind).toBe('ep');
  });
});

describe('слова канона — один дом', () => {
  it('имя класса берётся из дома имён, а не пишется здесь второй раз', () => {
    expect(ECONOMY_FLAG_CANON.name).toBe(SIGNAL_LABELS[ECONOMY_FLAG_CANON.signal]);
  });

  it('определение и действие — предложения для читателя, без служебных имён', () => {
    const texts = [
      ECONOMY_FLAG_CANON.definition,
      ECONOMY_FLAG_CANON.kindNote,
      ECONOMY_FLAG_CANON.action,
    ];
    expect(ECONOMY_FLAG_CANON.definition.length).toBeGreaterThan(60);
    expect(ECONOMY_FLAG_CANON.action.length).toBeGreaterThan(40);
    for (const text of texts) {
      // Буква столбца книги — законный адрес (механизм/адрес/действие),
      // а вот служебное имя ключа до читателя доходить не должно.
      expect(text).not.toMatch(/[a-z]+[A-Z][a-zA-Z]*/);
    }
  });
});
