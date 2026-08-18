/**
 * Страж происхождения метрик (канон п.104, 18.08.2026).
 *
 * Правило владельца: показатель продукта обязан иметь родословную из одного из
 * пяти источников — свод, отчёт, допотчёт, мониторинг, 44-ФЗ, — либо назваться
 * нашей инициативой ВСЛУХ, с обоснованием. Метрика, которая просто появилась в
 * словаре и ничего о себе не сообщает, — кандидат на снятие.
 *
 * Страж не даёт добавить показатель в METRIC_LABELS, не заведя ему запись
 * здесь. Тест падает в репозитории, а не на экране у начальницы вопросом
 * «откуда это число».
 */
import { describe, it, expect } from 'vitest';
import { METRIC_LABELS } from './product-dictionary.js';
import {
  METRIC_PROVENANCE,
  METRIC_SOURCE_LABELS,
  PROVENANCE_KEYS,
  divergentMetrics,
  metricProvenance,
  metricsBySource,
  orphanMetrics,
  type MetricSourceId,
} from './metric-provenance.js';

const ALL_SOURCES: readonly MetricSourceId[] = [
  'svod',
  'report',
  'extra-report',
  'monitoring',
  'law44',
  'own',
];

describe('карта происхождения: полнота', () => {
  it('каждая метрика METRIC_LABELS имеет родословную', () => {
    const missing = Object.keys(METRIC_LABELS).filter((key) => !(key in METRIC_PROVENANCE));
    expect(
      missing,
      'Показатели без родословной. Заведите запись в METRIC_PROVENANCE: назовите источник ' +
      '(svod/report/extra-report/monitoring/law44) и как ИСТОЧНИК его считает. Своей выдумке ' +
      'место тоже есть — source: "own" с обоснованием в note.',
    ).toEqual([]);
  });

  it('карта не описывает показателей, которых нет нигде в продукте', () => {
    // Ключи сверх METRIC_LABELS законны: METRIC_KB core и вкладки держат метрики,
    // которых в словаре лейблов нет (доверие, сигналы, диагностика). Проверяем
    // лишь форму ключа — техническая змея, а не случайная фраза.
    const malformed = PROVENANCE_KEYS.filter((k) => !/^[a-z][a-z0-9_]*$/.test(k));
    expect(malformed).toEqual([]);
  });
});

describe('карта происхождения: качество записей', () => {
  it('источник каждой записи — один из шести известных', () => {
    const unknown = PROVENANCE_KEYS.filter(
      (k) => !ALL_SOURCES.includes(METRIC_PROVENANCE[k].source),
    );
    expect(unknown).toEqual([]);
  });

  it('«как считает источник» заполнено содержательно, а не заглушкой', () => {
    const thin = PROVENANCE_KEYS.filter(
      (k) => METRIC_PROVENANCE[k].howSourceCounts.trim().length < 40,
    );
    expect(thin, 'Пустая или односложная родословная равна её отсутствию.').toEqual([]);
  });

  it('наша инициатива обязана себя обосновать', () => {
    const unjustified = orphanMetrics().filter((k) => {
      const note = METRIC_PROVENANCE[k].note;
      return note === undefined || note.trim().length < 20;
    });
    expect(
      unjustified,
      'source: "own" без обоснования в note — это и есть метрика-сирота: показываем, ' +
      'а почему — не говорим. Либо обосновать, либо снять.',
    ).toEqual([]);
  });

  it('расхождение с источником обязано быть названо', () => {
    const silent = divergentMetrics().filter((k) => {
      const note = METRIC_PROVENANCE[k].note;
      return note === undefined || note.trim().length < 20;
    });
    expect(
      silent,
      'match: "divergent" без объяснения в note скрывает от читателя, что наше число и число ' +
      'источника — разные величины.',
    ).toEqual([]);
  });

  it('совпадение с источником не заявляется для нашей инициативы', () => {
    const contradictory = PROVENANCE_KEYS.filter(
      (k) => METRIC_PROVENANCE[k].source === 'own' && METRIC_PROVENANCE[k].match === 'exact',
    );
    expect(
      contradictory,
      'Нельзя одновременно утверждать «источника нет» и «считаем как источник».',
    ).toEqual([]);
  });

  it('запись со ссылкой на лист СВОД не выходит за его 21 колонку (A..U)', () => {
    // Лист «СВОД ТД-ПМ» шириной A..U (сверено с дампом 18.08.2026). Колонки
    // V..AD принадлежат листам ГРБС; путать их адреса — та самая ошибка, из-за
    // которой METRIC_KB годами подписывал факт-деньги свода ячейкой V.
    const offenders = PROVENANCE_KEYS.filter((k) => {
      const ref = METRIC_PROVENANCE[k].sheetRef;
      if (ref === undefined || !ref.startsWith('СВОД ТД-ПМ!')) return false;
      const cols = ref.slice('СВОД ТД-ПМ!'.length).match(/\b[A-Z]{1,2}\b/g) ?? [];
      return cols.some((c) => c.length > 1 || c > 'U');
    });
    expect(
      offenders,
      'Адрес за пределами A..U — это колонка листа ГРБС, а не свода.',
    ).toEqual([]);
  });
});

describe('карта происхождения: доступ', () => {
  it('metricProvenance возвращает запись и не бросает на неизвестном ключе', () => {
    expect(metricProvenance('plan_count')?.source).toBe('svod');
    expect(metricProvenance('нет такой метрики')).toBeUndefined();
  });

  it('у каждого из шести источников есть человеческое имя', () => {
    for (const s of ALL_SOURCES) {
      expect(METRIC_SOURCE_LABELS[s].length).toBeGreaterThan(3);
    }
  });

  it('все пять документальных источников реально задействованы', () => {
    for (const s of ALL_SOURCES) {
      expect(metricsBySource(s).length, `источник ${s} не дал ни одной метрики`).toBeGreaterThan(0);
    }
  });

  it('разбиение по источникам покрывает карту без потерь и пересечений', () => {
    const sum = ALL_SOURCES.reduce((acc, s) => acc + metricsBySource(s).length, 0);
    expect(sum).toBe(PROVENANCE_KEYS.length);
  });
});

describe('карта происхождения: зафиксированные расхождения', () => {
  // Эти записи — не украшение, а найденные при сверке с живыми источниками
  // расхождения. Если кто-то «починит» их, не поговорив с владельцем, тест
  // напомнит, что число меняется у начальства на экране.

  it('знак «Отклонения» разъезжается с листом и назван вслух', () => {
    const dev = METRIC_PROVENANCE.deviation;
    expect(dev.match).toBe('divergent');
    expect(dev.howSourceCounts).toContain('=E43-D43');
  });

  it('доля ЕП: у нас штуки, у листа деньги', () => {
    expect(METRIC_PROVENANCE.ep_share_pct.match).toBe('divergent');
    expect(METRIC_PROVENANCE.share_ep_money.source).toBe('svod');
  });

  it('«% исполнения» и «Законтрактовано, %» — одна колонка листа', () => {
    expect(METRIC_PROVENANCE.execution_pct.sheetRef).toContain('Q');
    expect(METRIC_PROVENANCE.savings_pct.sheetRef).toContain('Q');
    expect(METRIC_PROVENANCE.execution_pct.match).toBe('divergent');
  });

  it('две экономии района разведены по разным книгам', () => {
    expect(METRIC_PROVENANCE.economy_total.source).toBe('svod');
    expect(METRIC_PROVENANCE.monitoring_auction_savings.source).toBe('monitoring');
  });

  it('остаток к заключению на листе — только ЭА и только 2026', () => {
    expect(METRIC_PROVENANCE.remainder_to_conclude.match).toBe('divergent');
    expect(METRIC_PROVENANCE.remainder_to_conclude.note).toContain('Итого ЭА 2026');
  });
});
