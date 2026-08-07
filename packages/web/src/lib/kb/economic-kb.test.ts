/**
 * База знаний экономических метрик — проверка полноты, а не орфографии.
 *
 * Карточка обязана жить у каждого видимого числа, и её ценность держится на
 * трёх свойствах: ни один раздел не пуст, порог назван вместе с внешней
 * методикой, из которой он взят, и наружу не выходят ни внутренние ключи, ни
 * буквы колонок листа. Тест сторожит именно это — записи легко пополняются
 * впопыхах, и пустой раздел иначе доедет до экрана незамеченным.
 */
import { describe, it, expect } from 'vitest';
import {
  ECONOMIC_METRIC_KB,
  ECONOMIC_METRIC_ORDER,
  economicKbFor,
  type EconomicKbEntry,
  type EconomicMetricKey,
} from './economic-kb';

/**
 * Разделы-абзацы, без которых карточка не карточка. Заголовок стоит отдельно:
 * он короткий по назначению, и мерить его той же меркой значило бы требовать
 * от подписи плитки объяснения на две строки.
 */
const REQUIRED_PROSE_SECTIONS: readonly (keyof EconomicKbEntry)[] = [
  'whatIs', 'howCalc', 'thresholds', 'dataSource', 'decision', 'pitfalls',
];

const ENTRIES = Object.entries(ECONOMIC_METRIC_KB) as [EconomicMetricKey, EconomicKbEntry][];

describe('ECONOMIC_METRIC_KB — состав', () => {
  it('в базе ровно четыре метрики первого эшелона, и порядок их перечисляет полностью', () => {
    expect(ENTRIES).toHaveLength(4);
    expect([...ECONOMIC_METRIC_ORDER].sort()).toEqual(ENTRIES.map(([key]) => key).sort());
  });

  it('ключи совпадают с контрактом ответа роута экономических метрик', () => {
    // Разойдись ключи — число на экране осталось бы без объяснения.
    expect(ENTRIES.map(([key]) => key).sort()).toEqual([
      'december_overhang', 'planning_accuracy', 'quarter_compliance', 'source_execution_gap',
    ]);
  });
});

describe('ECONOMIC_METRIC_KB — полнота записей', () => {
  it.each(ENTRIES)('%s: все обязательные разделы есть и ни один не пуст', (key, entry) => {
    expect(entry.title.trim().length, `${key}/title`).toBeGreaterThan(5);
    for (const section of REQUIRED_PROSE_SECTIONS) {
      const text = entry[section];
      expect(typeof text, `${key}/${String(section)}`).toBe('string');
      // Не «непустая строка», а осмысленный абзац: заглушка вроде «—» прошла бы
      // проверку на непустоту и осталась бы в продукте.
      expect((text as string).trim().length, `${key}/${String(section)}`).toBeGreaterThan(40);
    }
  });

  it.each(ENTRIES)('%s: порог назван вместе с внешней методикой', (key, entry) => {
    // Порог без источника — это мнение, выданное за норму.
    expect(entry.method.title.trim().length, key).toBeGreaterThan(20);
    expect(entry.method.url, key).toMatch(/^https:\/\/\S+$/);
    // В разделе о порогах есть числа: «читайте методику» — не объяснение зон.
    expect(entry.thresholds, key).toMatch(/\d/);
  });

  it.each(ENTRIES)('%s: тексты русские и не выдают внутренних имён', (key, entry) => {
    const visible = [entry.title, ...REQUIRED_PROSE_SECTIONS.map((s) => entry[s] as string)].join(' ');
    expect(visible, key).toMatch(/[А-Яа-яЁё]/);
    // Внутренний ключ метрики до глаз читателя не доходит.
    expect(visible, key).not.toContain(key);
    // Буква колонки допустима только как часть адреса ячейки, а «столбец Q» —
    // это внутреннее имя, вынесенное наружу.
    expect(visible, key).not.toMatch(/\b(столбец|столбце|столбца|колонка|колонке|колонки)\s+[A-Z]{1,2}\b/);
  });
});

describe('economicKbFor — контракт доступа', () => {
  it('известный ключ отдаёт ту же запись, что лежит в базе', () => {
    expect(economicKbFor('december_overhang')).toBe(ECONOMIC_METRIC_KB.december_overhang);
  });

  it('неизвестный ключ → null, а не карточка с пустыми разделами', () => {
    expect(economicKbFor('__nonexistent__')).toBeNull();
    expect(economicKbFor('')).toBeNull();
  });

  it('каждая метрика порядка находится по своему ключу', () => {
    for (const key of ECONOMIC_METRIC_ORDER) {
      expect(economicKbFor(key), key).not.toBeNull();
    }
  });
});

describe('ECONOMIC_METRIC_KB — правила чисел проговорены', () => {
  it('разрыв освоения объясняет, почему у него нет своего числителя', () => {
    const gap = ECONOMIC_METRIC_KB.source_execution_gap;
    expect(gap.howCalc).toContain('процентных пунктах');
    expect(gap.howCalc).toContain('числителя');
    // Нулевой знаменатель не превращается в ноль — карточка обязана это сказать
    // теми же словами, какими роут отдаёт null.
    expect(gap.pitfalls).toContain('без вердикта');
  });

  it('декабрьский навес объясняет, почему район не равен среднему по управлениям', () => {
    expect(ECONOMIC_METRIC_KB.december_overhang.howCalc).toContain('усреднением');
  });

  it('точность планирования различает агрегат и медиану', () => {
    const accuracy = ECONOMIC_METRIC_KB.planning_accuracy;
    expect(accuracy.howCalc).toContain('медиана');
    expect(accuracy.pitfalls).toContain('медиан');
  });
});
