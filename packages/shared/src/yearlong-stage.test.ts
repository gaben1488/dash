/**
 * Стража стадии «Закупки, проводимые в течение года» (канон пп.71, 76, 81–83).
 * Числа сверяются со спекой docs/superpowers/specs/2026-08-14-comments-and-yearlong-canon.md §1.
 */
import { describe, it, expect } from 'vitest';
import {
  isSvodFactCutMarker,
  isYearlongStageRow,
  YEARLONG_KINDS,
  YEARLONG_KIND_IDS,
  isYearlongKindId,
  yearlongSubclassForKind,
  isExcludedFromLegallyClean,
  YEARLONG_START_ROWS,
  YEARLONG_START_BY_KEY,
  yearlongKey,
  resolveYearlongKind,
  INITIATIVE_MARKERS,
  isInitiativeMarker,
  sumInitiativeRows,
  initiativeReviewDue,
  q4StartOf,
  YEARLONG_SUBCLASS_LABELS,
  YEARLONG_STAGE_LABELS,
  type YearlongKindId,
} from './yearlong-stage.js';

describe('заглушка свода (тройной фильтр формул)', () => {
  it('ровно «Х», «X» (любой регистр, обе раскладки) и пустота', () => {
    expect(isSvodFactCutMarker('Х')).toBe(true); // кириллица
    expect(isSvodFactCutMarker('х')).toBe(true); // строчная (три строки УДТХ)
    expect(isSvodFactCutMarker('X')).toBe(true); // латиница
    expect(isSvodFactCutMarker('x')).toBe(true);
    expect(isSvodFactCutMarker('')).toBe(true);
    expect(isSvodFactCutMarker('  ')).toBe(true);
    expect(isSvodFactCutMarker(null)).toBe(true);
    expect(isSvodFactCutMarker(undefined)).toBe(true);
  });

  it('УЖЕ, чем плейсхолдеры даты факта: «-» и «н/д» свод НЕ отсекает', () => {
    // Формулы свода фильтруют только Х/X/пусто — строка с «-» в Q капает в
    // свод, значит стадией её называть нельзя.
    expect(isSvodFactCutMarker('-')).toBe(false);
    expect(isSvodFactCutMarker('—')).toBe(false);
    expect(isSvodFactCutMarker('н/д')).toBe(false);
    expect(isSvodFactCutMarker('15.03.2026')).toBe(false);
  });
});

describe('структурный предикат стадии (п.71а, спека §1.4)', () => {
  it('ЕП + заглушка + факт>0 → стадия', () => {
    expect(isYearlongStageRow({ method: 'ЕП', factDateCell: 'Х', factSum: 800 })).toBe(true);
    expect(isYearlongStageRow({ method: 'ЕП', factDateCell: 'х', factSum: 19.32 })).toBe(true);
    expect(isYearlongStageRow({ method: ' еп ', factDateCell: '', factSum: 0.5 })).toBe(true);
  });

  it('не-ЕП, дата на месте или нулевой факт → не стадия', () => {
    expect(isYearlongStageRow({ method: 'ЭА', factDateCell: 'Х', factSum: 100 })).toBe(false);
    expect(isYearlongStageRow({ method: 'ЕП', factDateCell: '15.03.2026', factSum: 100 })).toBe(false);
    expect(isYearlongStageRow({ method: 'ЕП', factDateCell: 'Х', factSum: 0 })).toBe(false);
    // «-» в Q свод не отсекает → строка капает в свод, стадия не выставляется
    expect(isYearlongStageRow({ method: 'ЕП', factDateCell: '-', factSum: 100 })).toBe(false);
  });
});

describe('девять видов и подклассы (спека §1.2, п.81)', () => {
  it('видов ровно девять, id уникальны, валидатор их знает', () => {
    expect(YEARLONG_KINDS).toHaveLength(9);
    expect(new Set(YEARLONG_KIND_IDS).size).toBe(9);
    for (const id of YEARLONG_KIND_IDS) expect(isYearlongKindId(id)).toBe(true);
    expect(isYearlongKindId('что-то-чужое')).toBe(false);
    expect(isYearlongKindId(null)).toBe(false);
  });

  it('подклассы: выплаты — вид 6, платежи — вид 7, остальное — серия договоров', () => {
    expect(yearlongSubclassForKind('payments-to-individuals')).toBe('individual-payments');
    expect(yearlongSubclassForKind('fees-without-contract')).toBe('no-contract-payment');
    expect(yearlongSubclassForKind('regular-mandatory-services')).toBe('contract-series');
    expect(yearlongSubclassForKind(null)).toBeNull();
  });

  it('из «юридически чистого» режима исключаются выплаты и платежи (п.82)', () => {
    expect(isExcludedFromLegallyClean('individual-payments')).toBe(true);
    expect(isExcludedFromLegallyClean('no-contract-payment')).toBe(true);
    expect(isExcludedFromLegallyClean('contract-series')).toBe(false);
  });

  it('подписи подкласса и стадии — русские, без внутренних ключей', () => {
    for (const label of [...Object.values(YEARLONG_SUBCLASS_LABELS), ...Object.values(YEARLONG_STAGE_LABELS)]) {
      expect(label).toMatch(/[а-яА-ЯёЁ]/);
      expect(label).not.toMatch(/[a-z]-/);
    }
  });
});

describe('стартовая разметка 46 строк (п.83, анализ 14.08.2026)', () => {
  it('строк ровно 46, ключи книга+№п/п уникальны', () => {
    expect(YEARLONG_START_ROWS).toHaveLength(46);
    const keys = YEARLONG_START_ROWS.map((r) => yearlongKey(r.dept, r.ppNum));
    expect(new Set(keys).size).toBe(46);
    expect(YEARLONG_START_BY_KEY.size).toBe(46);
  });

  it('распределение по книгам — как в спеке §1.1: УКСиМП 40, УДТХ 3, УФБП 3', () => {
    const byDept = new Map<string, number>();
    for (const r of YEARLONG_START_ROWS) byDept.set(r.dept, (byDept.get(r.dept) ?? 0) + 1);
    expect(byDept.get('УКСиМП')).toBe(40);
    expect(byDept.get('УДТХ')).toBe(3);
    expect(byDept.get('УФБП')).toBe(3);
    expect(byDept.size).toBe(3); // пять книг дали ноль
  });

  it('счёт по видам — 13/3/9/2/3/7/3/5/1 (спека §1.2)', () => {
    const byKind = new Map<YearlongKindId, number>();
    for (const r of YEARLONG_START_ROWS) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    expect(byKind.get('regular-mandatory-services')).toBe(13);
    expect(byKind.get('post-and-telecom')).toBe(3);
    expect(byKind.get('on-demand-supply')).toBe(9);
    expect(byKind.get('periodicals-subscription')).toBe(2);
    expect(byKind.get('qualification-courses')).toBe(3);
    expect(byKind.get('payments-to-individuals')).toBe(7);
    expect(byKind.get('fees-without-contract')).toBe(3);
    expect(byKind.get('events-by-estimates')).toBe(5);
    expect(byKind.get('one-off-equipping')).toBe(1);
  });

  it('подклассы разметки — 36 серий, 7 выплат, 3 платежа (п.81)', () => {
    const bySub = new Map<string, number>();
    for (const r of YEARLONG_START_ROWS) {
      const sub = yearlongSubclassForKind(r.kind)!;
      bySub.set(sub, (bySub.get(sub) ?? 0) + 1);
    }
    expect(bySub.get('contract-series')).toBe(36);
    expect(bySub.get('individual-payments')).toBe(7);
    expect(bySub.get('no-contract-payment')).toBe(3);
  });

  it('план разметки сходится со спекой §1.1: 8 733,3 тыс. (до десятых)', () => {
    const plan = YEARLONG_START_ROWS.reduce((s, r) => s + r.planSum, 0);
    expect(plan).toBeCloseTo(8733.3, 1);
  });

  it('план выплат и платежей — 1 824,6 и 319,4 тыс. (спека §1.2, виды 6–7)', () => {
    const sum = (kind: YearlongKindId) =>
      YEARLONG_START_ROWS.filter((r) => r.kind === kind).reduce((s, r) => s + r.planSum, 0);
    expect(sum('payments-to-individuals')).toBeCloseTo(1824.6, 1);
    expect(sum('fees-without-contract')).toBeCloseTo(319.4, 1);
  });

  it('кварталы плана: 3-й — 18 строк, 4-й — 28 (спека §1.1)', () => {
    const q3 = YEARLONG_START_ROWS.filter((r) => r.planQuarter === 3).length;
    const q4 = YEARLONG_START_ROWS.filter((r) => r.planQuarter === 4).length;
    expect(q3).toBe(18);
    expect(q4).toBe(28);
  });

  it('resolveYearlongKind: оверрайд владельца побеждает стартовую разметку', () => {
    expect(resolveYearlongKind('УКСиМП', '3')).toBe('on-demand-supply');
    const overrides = new Map<string, YearlongKindId>([
      [yearlongKey('УКСиМП', '3'), 'events-by-estimates'],
    ]);
    expect(resolveYearlongKind('УКСиМП', '3', overrides)).toBe('events-by-estimates');
    expect(resolveYearlongKind('УО', '999', overrides)).toBeNull(); // «вид не определён»
  });
});

describe('маркер «инициативная заявка» (п.76а: код, не свободный текст)', () => {
  it('ровно три написания словаря, с тримом и регистром', () => {
    expect(INITIATIVE_MARKERS).toHaveLength(3);
    expect(isInitiativeMarker('хотелки')).toBe(true);
    expect(isInitiativeMarker('Хотелки')).toBe(true);
    expect(isInitiativeMarker('просто хотелки')).toBe(true);
    expect(isInitiativeMarker('  хотелки  ')).toBe(true);
  });

  it('вхождение слова внутри текста маркером НЕ является (п.27)', () => {
    expect(isInitiativeMarker('это хотелки управления')).toBe(false);
    expect(isInitiativeMarker('хотелки на 2027 год')).toBe(false);
    expect(isInitiativeMarker('')).toBe(false);
    expect(isInitiativeMarker(null)).toBe(false);
    expect(isInitiativeMarker(42)).toBe(false);
  });

  it('sumInitiativeRows: считает строки и план только по маркеру', () => {
    const totals = sumInitiativeRows([
      { commentGRBS: 'хотелки', planSum: 100 },
      { commentGRBS: 'Хотелки', planSum: 50.5 },
      { commentGRBS: 'договор заключен', planSum: 999 },
      { commentGRBS: 'просто хотелки' }, // плана нет — счёт есть, деньги 0
    ]);
    expect(totals.rows).toBe(3);
    expect(totals.planSum).toBeCloseTo(150.5, 5);
  });
});

describe('правило дожития (п.76в): «подтвердить или снять» к началу 4 квартала', () => {
  const base = { commentGRBS: 'хотелки', factSum: 0, factDateCell: 'Х', planYear: 2026 };

  it('маркер + нет движения + наступило 01.10 → карточка пора', () => {
    expect(initiativeReviewDue(base, new Date(Date.UTC(2026, 9, 1)))).toBe(true);
    expect(initiativeReviewDue(base, new Date(Date.UTC(2026, 11, 31)))).toBe(true);
  });

  it('до 4 квартала — рано', () => {
    expect(initiativeReviewDue(base, new Date(Date.UTC(2026, 8, 30)))).toBe(false);
  });

  it('движение есть (факт или дата) — карточки нет', () => {
    expect(initiativeReviewDue({ ...base, factSum: 10 }, new Date(Date.UTC(2026, 10, 1)))).toBe(false);
    expect(
      initiativeReviewDue({ ...base, factDateCell: '05.10.2026' }, new Date(Date.UTC(2026, 10, 1))),
    ).toBe(false);
  });

  it('не маркер или нет года плана — правило молчит', () => {
    expect(
      initiativeReviewDue({ ...base, commentGRBS: 'договор заключен' }, new Date(Date.UTC(2026, 10, 1))),
    ).toBe(false);
    expect(initiativeReviewDue({ ...base, planYear: 0 }, new Date(Date.UTC(2026, 10, 1)))).toBe(false);
  });

  it('рубеж — ровно 1 октября года плана', () => {
    expect(q4StartOf(2026).toISOString().slice(0, 10)).toBe('2026-10-01');
  });
});
