/**
 * Тесты правил плановой целостности (канон п.102, реестр интервью 18.08).
 *
 * Фикстуры взяты из ЖИВЫХ чисел замера 18.08 по дампам E:/aemr-dumps/book-dumps
 * (все восемь книг со всеми слоями), а не выдуманы:
 *   • УО, H28 = 34 975 002,17 → 34 975,00 (исправление единиц, 05.08.2026);
 *   • ретро-снижения плана в журналах: УО 192, УКСиМП 112 (на 6 693,57 тыс.),
 *     УД 33 (3 900,31 тыс.), УФБП 1 (7 940,33 — кредитная линия);
 *   • записи журналов: УО 33 724, УКСиМП 4 904, УД 568, УФБП 124, УАГЗО 70,
 *     УДТХ 34, УЭР 31, УИО 13.
 */
import { describe, expect, it } from 'vitest';
import type { ClassifiedRow, RowClassification, RuleCheckContext } from './types.js';
import {
  detectBlindJournal,
  detectDissolvedEconomy,
  detectRublesLikeAmounts,
  parseCellRef,
  withPlanProvenance,
  JOURNAL_BLIND_MAX_ENTRIES,
  PLAN_INTEGRITY_CHECKS,
  PLAN_INTEGRITY_RULES,
  type BookProvenance,
  type PlanJournalEdit,
} from './plan-integrity-rules.js';

// ────────────────────────────────────────────────────────────
// Строители фикстур
// ────────────────────────────────────────────────────────────

const SHEET = 'ВСЕ';

function row(
  rowIndex: number,
  cells: Record<string, unknown>,
  classification: RowClassification = 'procurement',
): ClassifiedRow {
  return {
    rowIndex,
    sheet: SHEET,
    classification,
    classificationConfidence: 1,
    cells,
    classificationReasons: [],
  };
}

/** Обычная строка закупки: план K, способ L, при желании факт Y и дата Q. */
function buy(
  rowIndex: number,
  plan: number,
  extra: Record<string, unknown> = {},
): ClassifiedRow {
  return row(rowIndex, { A: String(rowIndex), L: 'ЭА', K: plan, ...extra });
}

/** Лист-фон: 12 обычных строк, медиана плана около 3 000 тыс. руб. */
function backgroundSheet(): ClassifiedRow[] {
  const plans = [1200, 1500, 2000, 2400, 2800, 3000, 3200, 3600, 4000, 4400, 5000, 6000];
  return plans.map((p, i) => buy(10 + i, p));
}

function ctxOf(rows: ClassifiedRow[], atRow?: number): RuleCheckContext {
  const anchor = atRow ?? rows[0].rowIndex;
  const target = rows.find((r) => r.rowIndex === anchor) ?? rows[0];
  return {
    cells: target.cells,
    rowIndex: target.rowIndex,
    sheet: SHEET,
    classification: target.classification,
    allRows: rows,
  };
}

function edit(
  cell: string,
  oldValue: unknown,
  newValue: unknown,
  atMs: number,
  sheet = SHEET,
): PlanJournalEdit {
  return { sheet, cell, oldValue, newValue, atMs, author: 'operator@example.org' };
}

/** Момент в часовом поясе книги (UTC+12) — как его видит человек в журнале. */
function bookMoment(y: number, m: number, d: number, h = 10): number {
  return Date.UTC(y, m - 1, d, h) - 12 * 60 * 60 * 1000;
}

const rule = (id: string) => {
  const found = PLAN_INTEGRITY_RULES.find((r) => r.id === id);
  if (!found) throw new Error(`правило ${id} не найдено`);
  return found;
};

// ────────────────────────────────────────────────────────────
// 1. Сумма похожа на рубли, а книга ведётся в тысячах
// ────────────────────────────────────────────────────────────

describe('plan_units_rubles — рубли вместо тысяч (канон п.102)', () => {
  it('ловит живой случай УО H28 = 34 975 002,17 и предлагает 34 975,00', () => {
    const rows = [...backgroundSheet(), buy(28, 34_975.0, { H: 34_975_002.17 })];
    const report = detectRublesLikeAmounts(rows);

    const hit = report.hits.find((h) => h.cell === 'H28');
    expect(hit).toBeDefined();
    expect(hit!.value).toBeCloseTo(34_975_002.17, 2);
    // Ровно та поправка, которую управление внесло само 05.08.2026.
    expect(hit!.asThousands).toBeCloseTo(34_975.0, 2);
    expect(hit!.reasons).toContain('above_district_budget');
    expect(hit!.reasons).toContain('far_above_median');
    expect(hit!.reasons).toContain('kopecks_tail');
  });

  it('обычный лист в тысячах не даёт ни одной находки', () => {
    // Копейки в тысячах — норма (живой пример канона: 6 693,57 тыс.).
    const rows = [...backgroundSheet(), buy(30, 6_693.57), buy(31, 3_900.31)];
    expect(detectRublesLikeAmounts(rows).hits).toEqual([]);
  });

  it('копеечный хвост сам по себе поводом не бывает — он только смягчает порог', () => {
    // Лист мелких закупок, медиана 500 тыс. Оба испытуемых значения ниже
    // абсолютного порога 100 000, поэтому виден чистый вклад хвоста:
    // 60× медианы проходит смягчённый порог 50×, но не строгий 100×.
    const base = [400, 450, 480, 500, 500, 520, 560, 600].map((p, i) => buy(10 + i, p));
    const withTail = detectRublesLikeAmounts([...base, buy(40, 30_000.55)]);
    const withoutTail = detectRublesLikeAmounts([...base, buy(41, 30_000)]);

    expect(withTail.median).toBe(500);
    expect(withTail.hits.map((h) => h.cell)).toEqual(['K40']);
    expect(withTail.hits[0].reasons).toEqual(['far_above_median', 'kopecks_tail']);
    expect(withoutTail.hits).toEqual([]);

    // А на строгом пороге хвост уже ничего не решает — ловятся оба.
    expect(detectRublesLikeAmounts([...base, buy(42, 60_000)]).hits).toHaveLength(1);
  });

  it('без медианы (сумм меньше пяти) работает только абсолютный порог', () => {
    const rows = [buy(4, 150_000), buy(5, 900)];
    const report = detectRublesLikeAmounts(rows);
    expect(report.median).toBeNull();
    expect(report.hits.map((h) => h.cell)).toEqual(['K4']);
  });

  it('служебные строки листа не проверяются', () => {
    const rows = [
      ...backgroundSheet(),
      row(99, { A: '', K: 500_000_000 }, 'summary'),
      row(100, { A: '', K: 500_000_000 }, 'separator'),
    ];
    expect(detectRublesLikeAmounts(rows).hits).toEqual([]);
  });

  it('карточка одна на лист: на неякорной строке правило молчит', () => {
    const rows = [...backgroundSheet(), buy(28, 34_975.0, { H: 34_975_002.17 })];
    const r = rule('plan_units_rubles');
    expect(r.check(ctxOf(rows)).passed).toBe(false);
    expect(r.check(ctxOf(rows, 28)).passed).toBe(true);
  });

  it('текст карточки несёт механизм, адрес и предписанное действие (п.53)', () => {
    const rows = [...backgroundSheet(), buy(28, 34_975.0, { H: 34_975_002.17 })];
    const res = rule('plan_units_rubles').check(ctxOf(rows));
    expect(res.passed).toBe(false);
    expect(res.cell).toBe('H28');
    expect(res.message).toContain('в тысячу раз');
    expect(res.message).toContain('H28 — 34 975 002,17');
    expect(res.message).toContain('в тысячах это 34 975,00');
    expect(res.message).toContain(
      'проверить единицу измерения — значение похоже на рубли, в книге суммы в тысячах',
    );
  });
});

// ────────────────────────────────────────────────────────────
// 2. Экономия растворена в плане
// ────────────────────────────────────────────────────────────

describe('plan_economy_dissolved — ретро-снижение плана (канон п.102)', () => {
  const factSet = bookMoment(2026, 7, 10);
  const cutAfter = bookMoment(2026, 8, 12);

  it('снижение плана после заключения = растворённая экономия, доказано журналом', () => {
    // Строка УКСиМП-типа: НМЦК 6 693,57 правится вниз на изъятое (канон п.102).
    const rows = [...backgroundSheet(), buy(155, 4_200, { Q: '10.07.2026', Y: 4_200 })];
    const edits = [
      edit('Q155', '', '10.07.2026', factSet),
      edit('K155', '6 693,57', '4 200,00', cutAfter),
    ];

    const report = detectDissolvedEconomy(rows, edits, SHEET);
    expect(report.cuts).toHaveLength(1);
    expect(report.cuts[0].evidence).toBe('journal');
    expect(report.cuts[0].removed).toBeCloseTo(2_493.57, 2);
    expect(report.removedTotal).toBeCloseTo(2_493.57, 2);
    expect(report.unitFixes).toEqual([]);
  });

  it('исправление единиц (~1000×) в растворённую экономию не попадает', () => {
    const rows = [...backgroundSheet(), buy(28, 34_975.0, { Q: '10.07.2026', Y: 30_000 })];
    const edits = [
      edit('Q28', '', '10.07.2026', factSet),
      // Живая правка УО от 05.08.2026: рубли исправлены на тысячи.
      edit('H28', '34 975 002,17', '34 975,00', bookMoment(2026, 8, 5)),
    ];

    const report = detectDissolvedEconomy(rows, edits, SHEET);
    expect(report.cuts).toEqual([]);
    expect(report.unitFixes).toHaveLength(1);
    expect(report.removedTotal).toBe(0);
  });

  it('правка плана ДО появления факта — обычное планирование, не сигнал', () => {
    const rows = [...backgroundSheet(), buy(200, 3_000, { Q: '12.08.2026', Y: 3_000 })];
    const edits = [
      edit('K200', '5 000,00', '3 000,00', bookMoment(2026, 6, 1)),
      edit('Q200', '', '12.08.2026', bookMoment(2026, 8, 12)),
    ];
    expect(detectDissolvedEconomy(rows, edits, SHEET).cuts).toEqual([]);
  });

  it('без следа факта в журнале доказательство помечается как наблюдаемое', () => {
    // УДТХ-случай: журнал начат позже, момент появления факта в нём не сохранён.
    const rows = [...backgroundSheet(), buy(77, 1_800, { Q: '05.06.2026', Y: 1_800 })];
    const edits = [edit('K77', '2 500,00', '1 800,00', cutAfter)];

    const report = detectDissolvedEconomy(rows, edits, SHEET);
    expect(report.cuts).toHaveLength(1);
    expect(report.cuts[0].evidence).toBe('state');
    expect(report.removedTotal).toBeCloseTo(700, 2);
  });

  it('у строки без факта вовсе снижение плана не засчитывается', () => {
    const rows = [...backgroundSheet(), buy(78, 1_800)];
    const edits = [edit('K78', '2 500,00', '1 800,00', cutAfter)];
    expect(detectDissolvedEconomy(rows, edits, SHEET).cuts).toEqual([]);
  });

  it('правка итога и слагаемого одной строки не удваивает снятую сумму', () => {
    const rows = [...backgroundSheet(), buy(300, 1_000, { Q: '10.07.2026', Y: 1_000 })];
    const edits = [
      edit('Q300', '', '10.07.2026', factSet),
      edit('J300', '1 500,00', '1 000,00', cutAfter),
      edit('K300', '1 500,00', '1 000,00', cutAfter),
    ];

    const report = detectDissolvedEconomy(rows, edits, SHEET);
    expect(report.cuts).toHaveLength(2);
    // K = H + I + J: сложить обе правки значило бы посчитать одни деньги дважды.
    expect(report.removedTotal).toBeCloseTo(500, 2);
  });

  it('обнуление плана исправлением единиц не считается', () => {
    const rows = [...backgroundSheet(), buy(88, 0, { Q: '10.07.2026', Y: 900 })];
    const edits = [
      edit('Q88', '', '10.07.2026', factSet),
      edit('K88', '1 000,00', '0', cutAfter),
    ];

    const report = detectDissolvedEconomy(rows, edits, SHEET);
    expect(report.unitFixes).toEqual([]);
    expect(report.cuts).toHaveLength(1);
    expect(report.cuts[0].removed).toBeCloseTo(1_000, 2);
  });

  it('правки чужого листа книги в разбор не идут', () => {
    const rows = [...backgroundSheet(), buy(155, 4_200, { Q: '10.07.2026', Y: 4_200 })];
    const edits = [
      edit('Q155', '', '10.07.2026', factSet),
      edit('K155', '6 000,00', '4 200,00', cutAfter, 'МБОУ «ЕСШ №3»'),
    ];
    expect(detectDissolvedEconomy(rows, edits, SHEET).cuts).toEqual([]);
  });

  it('без подключённого журнала правило молчит, а не выдумывает вывод', () => {
    const rows = [...backgroundSheet(), buy(155, 4_200, { Q: '10.07.2026', Y: 4_200 })];
    expect(rule('plan_economy_dissolved').check(ctxOf(rows)).passed).toBe(true);
  });

  it('текст карточки несёт сумму, адреса и предписанное действие (п.53)', () => {
    const rows = [...backgroundSheet(), buy(155, 4_200, { Q: '10.07.2026', Y: 4_200 })];
    const provenance: BookProvenance = {
      bookTitle: 'УКСиМП',
      journalEntryCount: 4904,
      edits: [
        edit('Q155', '', '10.07.2026', factSet),
        edit('K155', '6 693,57', '4 200,00', cutAfter),
      ],
    };
    const res = rule('plan_economy_dissolved').check(
      withPlanProvenance(ctxOf(rows), provenance),
    );

    expect(res.passed).toBe(false);
    expect(res.cell).toBe('K155');
    expect(res.message).toContain('2 493,57');
    expect(res.message).toContain('K155 — 6 693,57 → 4 200,00');
    expect(res.message).toContain('12.08.2026');
    expect(res.message).toContain(
      'показать перераспределение отдельно — снятую сумму и строку-приёмник; в самой строке план оставить исходным',
    );
  });

  it('карточка одна на лист: на неякорной строке правило молчит', () => {
    const rows = [...backgroundSheet(), buy(155, 4_200, { Q: '10.07.2026', Y: 4_200 })];
    const provenance: BookProvenance = {
      journalEntryCount: 4904,
      edits: [
        edit('Q155', '', '10.07.2026', factSet),
        edit('K155', '6 693,57', '4 200,00', cutAfter),
      ],
    };
    const r = rule('plan_economy_dissolved');
    expect(r.check(withPlanProvenance(ctxOf(rows), provenance)).passed).toBe(false);
    expect(r.check(withPlanProvenance(ctxOf(rows, 155), provenance)).passed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 3. Журнал правок книги почти не ведётся
// ────────────────────────────────────────────────────────────

describe('journal_provenance_blind — дыра наблюдаемости (канон п.102)', () => {
  it('УДТХ: 34 записи на ~600 строк — провенанс слепой', () => {
    const report = detectBlindJournal(600, 34);
    expect(report).not.toBeNull();
    expect(report!.entriesPerHundredRows).toBeCloseTo(5.67, 2);
  });

  it('УЭР 31 и УИО 13 записей — тоже слепые книги', () => {
    expect(detectBlindJournal(600, 31)).not.toBeNull();
    expect(detectBlindJournal(600, 13)).not.toBeNull();
  });

  it('УО с 33 724 записями и УКСиМП с 4 904 карточки не получают', () => {
    expect(detectBlindJournal(2800, 33_724)).toBeNull();
    expect(detectBlindJournal(1500, 4_904)).toBeNull();
  });

  it('на коротком листе молчание журнала ни о чём не говорит', () => {
    expect(detectBlindJournal(150, 10)).toBeNull();
  });

  it('порог записей — граница включительно', () => {
    expect(detectBlindJournal(600, JOURNAL_BLIND_MAX_ENTRIES)).toBeNull();
    expect(detectBlindJournal(600, JOURNAL_BLIND_MAX_ENTRIES - 1)).not.toBeNull();
  });

  it('без подключённого счётчика правило молчит: «нет данных» ≠ «нет записей»', () => {
    const rows = Array.from({ length: 250 }, (_, i) => buy(10 + i, 1_000 + i));
    expect(rule('journal_provenance_blind').check(ctxOf(rows)).passed).toBe(true);
  });

  it('текст карточки объясняет, что молчание другой проверки не значит «чисто»', () => {
    const rows = Array.from({ length: 250 }, (_, i) => buy(10 + i, 1_000 + i));
    const provenance: BookProvenance = { bookTitle: 'УДТХ', journalEntryCount: 34, edits: [] };
    const res = rule('journal_provenance_blind').check(
      withPlanProvenance(ctxOf(rows), provenance),
    );

    expect(res.passed).toBe(false);
    expect(res.message).toContain('УДТХ');
    expect(res.message).toContain('34 записей на 250 счётных строк');
    expect(res.message).toContain('«следов нет», а не как «практики нет»');
    expect(res.message).toContain('33 724');
  });
});

// ────────────────────────────────────────────────────────────
// Сборка: правила и реестр проверок
// ────────────────────────────────────────────────────────────

describe('сборка правил плановой целостности', () => {
  it('разбор адреса ячейки журнала', () => {
    expect(parseCellRef('H28')).toEqual({ column: 'H', rowIndex: 28 });
    expect(parseCellRef('aa155')).toEqual({ column: 'AA', rowIndex: 155 });
    expect(parseCellRef('K')).toBeNull();
    expect(parseCellRef('')).toBeNull();
  });

  it('каждое правило имеет запись в реестре проверок', () => {
    const ruleIds = PLAN_INTEGRITY_RULES.map((r) => r.id).sort();
    const checkIds = PLAN_INTEGRITY_CHECKS.map((c) => c.id).sort();
    expect(checkIds).toEqual(ruleIds);
  });

  it('все три правила — уровня листов ГРБС, id уникальны', () => {
    expect(PLAN_INTEGRITY_RULES.every((r) => r.scope === 'department')).toBe(true);
    expect(new Set(PLAN_INTEGRITY_RULES.map((r) => r.id)).size).toBe(PLAN_INTEGRITY_RULES.length);
  });

  it('тексты реестра ведут к действию, а не к упрёку', () => {
    for (const check of PLAN_INTEGRITY_CHECKS) {
      expect(check.recommendation.length).toBeGreaterThan(40);
      expect(check.kbHint.length).toBeGreaterThan(40);
      // Тон п.53: карточка объясняет механизм, а не оценивает исполнителя.
      expect(check.description).not.toMatch(/наруш(ил|ение)|виноват|небрежн|халатн/iu);
      expect(check.recommendation).not.toMatch(/наруш(ил|ение)|виноват|небрежн|халатн/iu);
    }
  });

  it('правила не падают на пустом листе и на строках без allRows', () => {
    for (const r of PLAN_INTEGRITY_RULES) {
      expect(
        r.check({ cells: {}, rowIndex: 4, sheet: SHEET, classification: 'procurement' }).passed,
      ).toBe(true);
      expect(
        r.check({
          cells: {},
          rowIndex: 4,
          sheet: SHEET,
          classification: 'procurement',
          allRows: [],
        }).passed,
      ).toBe(true);
    }
  });
});
