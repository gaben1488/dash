import { describe, it, expect } from 'vitest';
import { ECONOMY_FLAG_CANON } from '@aemr/shared';
import {
  REGISTRY_SLICE_PRESETS,
  findSlicePreset,
  numericEconomyOf,
  slicePresetCounts,
  splitRegistrySeed,
  rowSignals,
  type SliceRow,
} from './slice-presets';

const row = (...signals: string[]): SliceRow => ({ signals });

describe('пресеты срезов реестра', () => {
  it('каждая запись несёт подпись, механизм и причину пустоты', () => {
    for (const preset of REGISTRY_SLICE_PRESETS) {
      expect(preset.id).not.toBe('');
      expect(preset.label.length).toBeGreaterThan(2);
      // Механизм и пустота — предложения для читателя, а не пометки для кода.
      expect(preset.mechanism.length).toBeGreaterThan(40);
      expect(preset.emptyReason.length).toBeGreaterThan(40);
      // Ни в одной подписи нет латиницы: внутренние имена наружу не выходят.
      expect(preset.label).not.toMatch(/[A-Za-z]/);
    }
  });

  it('ключи срезов не повторяются', () => {
    const ids = REGISTRY_SLICE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('«Требуют разбора» берёт строки с критическим признаком', () => {
    const preset = findSlicePreset('critical');
    expect(preset).not.toBeNull();
    expect(preset!.predicate(row('overdue'))).toBe(true);
    expect(preset!.predicate(row('planSoon'))).toBe(false);
    expect(preset!.predicate(row())).toBe(false);
  });

  it('«Под наблюдением» не повторяет строки критического среза', () => {
    const preset = findSlicePreset('warning');
    expect(preset!.predicate(row('planSoon'))).toBe(true);
    expect(preset!.predicate(row('overdue', 'planSoon'))).toBe(false);
  });

  it('«Экономия без отметки» берёт строки по ключу единого канона, а не по своему условию', () => {
    const preset = findSlicePreset(ECONOMY_FLAG_CANON.signal);
    expect(preset).not.toBeNull();
    expect(preset!.label).toBe(ECONOMY_FLAG_CANON.name);
    expect(preset!.predicate(row(ECONOMY_FLAG_CANON.signal))).toBe(true);
    expect(preset!.predicate(row('economyConflict'))).toBe(false);
    expect(preset!.predicate(row())).toBe(false);
    // Механизм пересказан словами канона — те же слова, что в карточке
    // проверки и в правиле листа (консолидация 21.08.2026).
    expect(preset!.mechanism).toContain(ECONOMY_FLAG_CANON.definition);
  });

  it('неизвестный ключ среза даёт null, а не молчаливый пропуск отбора', () => {
    expect(findSlicePreset('нет такого')).toBeNull();
    expect(findSlicePreset(null)).toBeNull();
  });

  it('счёт по загруженным строкам заполняет все ключи, включая нулевые', () => {
    const counts = slicePresetCounts([row('overdue'), row('planSoon'), row()]);
    expect(counts.critical).toBe(1);
    expect(counts.warning).toBe(1);
    for (const preset of REGISTRY_SLICE_PRESETS) {
      expect(counts[preset.id]).toBeTypeOf('number');
    }
  });

  it('строка без графы признаков не роняет счёт', () => {
    expect(rowSignals({})).toEqual([]);
    expect(() => slicePresetCounts([{}])).not.toThrow();
  });
});

describe('экономия по числам в срезе «Экономия без отметки»', () => {
  it('срез объявлен как читающий экономию по числам — графы книги у него пусты', () => {
    const preset = findSlicePreset(ECONOMY_FLAG_CANON.signal);
    expect(preset!.economyByNumbers).toBe(true);
    // Остальным срезам столбец экономии не переопределяется: там графы книги
    // заполнены, и пересчёт спорил бы с числом, которое видит читатель.
    expect(findSlicePreset('critical')!.economyByNumbers).toBeUndefined();
  });

  it('разность плана и факта и её доля от плана', () => {
    expect(numericEconomyOf({ planSum: 400, factSum: 380 })).toEqual({ economy: 20, sharePct: 5 });
  });

  it('строка без факта, без плана или с копеечной разностью числа не даёт', () => {
    expect(numericEconomyOf({ planSum: 400, factSum: 0 })).toBeNull();
    expect(numericEconomyOf({ planSum: 0, factSum: 380 })).toBeNull();
    // Порог шума канона: 0,01 тыс = 10 рублей — остаток двоичной арифметики.
    expect(numericEconomyOf({ planSum: 400, factSum: 399.995 })).toBeNull();
    // Факт выше плана — это перерасход, а не экономия: столбец о нём молчит.
    expect(numericEconomyOf({ planSum: 400, factSum: 420 })).toBeNull();
    expect(numericEconomyOf({})).toBeNull();
  });
});

describe('затравка перехода в Реестр', () => {
  it('один ключ с именованным срезом ведёт в срез, а не в безымянный фильтр', () => {
    expect(splitRegistrySeed([ECONOMY_FLAG_CANON.signal])).toEqual({
      slicePresetId: ECONOMY_FLAG_CANON.signal,
      signals: [],
    });
  });

  it('ключ без среза остаётся обычным фильтром признаков', () => {
    expect(splitRegistrySeed(['planYearMissing'])).toEqual({
      slicePresetId: null,
      signals: ['planYearMissing'],
    });
  });

  it('несколько ключей срезом не считаются: срез отвечает на один вопрос', () => {
    const seed = [ECONOMY_FLAG_CANON.signal, 'overdue'];
    expect(splitRegistrySeed(seed)).toEqual({ slicePresetId: null, signals: seed });
  });

  it('пустая затравка не открывает ничего', () => {
    expect(splitRegistrySeed([])).toEqual({ slicePresetId: null, signals: [] });
  });
});
