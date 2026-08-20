/**
 * Стражи разбора родословной (канон п.104).
 *
 * Проверяется не оформление, а четыре обещания разбора:
 *   1) каждый из четырёх классов узнаётся по записи карты, и расхождение
 *      старше происхождения — показатель может быть нашей инициативой И
 *      расходиться с листом, тогда важнее предупреждение;
 *   2) неизвестный показатель даёт честный null, а не выдуманную карточку;
 *   3) у значка-предупреждения есть текст ровно у тех показателей, чей счёт
 *      расходится с источником, и ни у одного больше;
 *   4) вся карта разбирается без исключений — ни одна из 86 записей не
 *      оставляет читателя без вердикта и без объяснения счёта источника.
 */
import { describe, expect, it } from 'vitest';
import {
  METRIC_PROVENANCE,
  PROVENANCE_KEYS,
  divergentMetrics,
  metricProvenance,
  orphanMetrics,
} from '@aemr/shared';
import {
  PROVENANCE_VERDICTS,
  classifyProvenance,
  divergenceWarning,
  isDivergent,
  provenanceCard,
} from './metric-provenance-view';

// Представители четырёх классов. Выбраны не наугад: у каждого своя причина
// попасть именно в этот класс, и она названа в комментарии.
const EXACT = 'plan_count'; // лист СВОД считает так же — число обязано сходиться
// Знак «Отклонения» сведён к листовому 18.08.2026, и deviation перестал быть
// расхождением. Представитель класса — доля ЕП: лист знает её только в
// ДЕНЬГАХ (`=O26/O29`), а мы считаем в ШТУКАХ; числа расходятся кратно.
const DIVERGENT = 'ep_share_pct';
const ORPHAN = 'trust_overall'; // индекс доверия не ведёт ни один из пяти источников
const GAP = 'fb_execution_pct'; // обе половины дроби на листе есть, дроби — нет
const BOTH = 'lifecycle_type_unknown'; // наша инициатива И шире листового «*»

describe('классы происхождения', () => {
  it('узнаёт совпадение, расхождение, сироту и пробел источника', () => {
    expect(provenanceCard(EXACT)?.kind).toBe('exact');
    expect(provenanceCard(DIVERGENT)?.kind).toBe('divergent');
    expect(provenanceCard(ORPHAN)?.kind).toBe('orphan');
    expect(provenanceCard(GAP)?.kind).toBe('gap');
  });

  it('ставит расхождение выше происхождения: наша инициатива, считающая иначе, — предупреждение', () => {
    const provenance = metricProvenance(BOTH);
    expect(provenance?.source).toBe('own');
    expect(classifyProvenance(provenance!)).toBe('divergent');
    expect(provenanceCard(BOTH)?.kind).toBe('divergent');
  });

  it('несёт имя источника и вердикт словами, а не кодом', () => {
    const card = provenanceCard(EXACT);
    expect(card?.sourceLabel).toBe('Лист «СВОД ТД-ПМ»');
    expect(card?.verdict).toBe(PROVENANCE_VERDICTS.exact);
    expect(provenanceCard(ORPHAN)?.sourceLabel).toBe('Наша инициатива');
    expect(provenanceCard(ORPHAN)?.verdict).toBe(PROVENANCE_VERDICTS.orphan);
  });

  it('доносит адрес первоисточника там, где он известен, и молчит там, где нет', () => {
    expect(provenanceCard(EXACT)?.sheetRef).toContain('СВОД ТД-ПМ!D');
    // Показатель родом из еженедельного отчёта: адреса ячейки у него нет и
    // выдумывать её нельзя — поле просто отсутствует.
    expect(provenanceCard('pending_count')?.sheetRef).toBeUndefined();
  });
});

describe('честная пустота', () => {
  it('неизвестный показатель не даёт карточки', () => {
    expect(provenanceCard('нет_такого_показателя')).toBeNull();
    expect(provenanceCard('')).toBeNull();
  });

  it('у неизвестного показателя нет и предупреждения — незнание не повод пугать', () => {
    expect(divergenceWarning('нет_такого_показателя')).toBeNull();
    expect(isDivergent('нет_такого_показателя')).toBe(false);
  });
});

describe('значок расхождения', () => {
  it('объясняет механизм: называет источник, его счёт и разницу', () => {
    const warning = divergenceWarning(DIVERGENT);
    expect(warning).toContain('Лист «СВОД ТД-ПМ»');
    expect(warning).toContain('=O26/O29');
    expect(warning).toContain('В чём разница:');
  });

  it('молчит на показателе, который считается так же, как источник', () => {
    expect(divergenceWarning(EXACT)).toBeNull();
    expect(isDivergent(EXACT)).toBe(false);
  });

  it('горит ровно на расхождениях карты и ни на чём другом', () => {
    const lit = PROVENANCE_KEYS.filter((k) => divergenceWarning(k) !== null);
    expect([...lit].sort()).toEqual([...divergentMetrics()].sort());
    expect(lit.length).toBeGreaterThan(0);
  });
});

describe('вся карта разбирается', () => {
  it('каждая запись даёт карточку с вердиктом и счётом источника', () => {
    const bare = PROVENANCE_KEYS.filter((key) => {
      const card = provenanceCard(key);
      return !card || !card.verdict.trim() || !card.howSourceCounts.trim();
    });
    expect(bare).toEqual([]);
    expect(PROVENANCE_KEYS.length).toBe(Object.keys(METRIC_PROVENANCE).length);
  });

  it('сироты объявлены нашей инициативой, а не спрятаны в совпадения', () => {
    for (const key of orphanMetrics()) {
      // Сирота, которая вдобавок считает иначе, показывается предупреждением —
      // это сильнее, но её происхождение всё равно названо нашей инициативой.
      expect(provenanceCard(key)?.sourceLabel).toBe('Наша инициатива');
      expect(['orphan', 'divergent']).toContain(provenanceCard(key)?.kind);
    }
  });
});
