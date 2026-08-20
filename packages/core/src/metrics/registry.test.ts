import { describe, expect, it } from 'vitest';
import { METRIC_KB } from './registry.js';

describe('METRIC_KB metric contract', () => {
  it('documents legacy savings_pct as fact-to-plan spending percent, not approved economy', () => {
    const entry = METRIC_KB.savings_pct;

    expect(entry).toBeDefined();
    expect(entry.label.toLowerCase()).not.toContain('эконом');
    expect(entry.label.toLowerCase()).not.toContain('отклонен');
    expect(entry.formula).toContain('fact_total / plan_total');
    expect(entry.note ?? '').toContain('legacy key');
    // Владелец переименовал столбец Q листа СВОД 18.08.2026: «Потрачено, %» →
    // «Законтрактовано, %». Расчёт не менялся, поэтому в допустимые слова
    // добавлено новое имя, а запрет называть показатель экономией остался.
    expect(`${entry.whatIs ?? ''} ${entry.howCalc ?? ''}`.toLowerCase())
      .toMatch(/потрачен|законтрактован|факт к плану|освоен/);
  });

  it('does not label limit−fact deviation as AD-gated economy (high_economy_count / signal_high_economy)', () => {
    // Ground truth signals.ts: economyPct = (plan_total − fact_total)/plan_total on competitive
    // methods only — NOT (limit − price), NOT AD-gated economy_total. The dictionary must match.
    const hec = METRIC_KB.high_economy_count;
    const sig = METRIC_KB.signal_high_economy;
    expect(hec).toBeDefined();
    expect(sig).toBeDefined();

    expect(hec.formula?.toLowerCase()).not.toMatch(/price|цена/);
    expect(hec.formula?.toLowerCase()).toMatch(/plan_total|факт/);
    expect(sig.formula?.toLowerCase()).not.toMatch(/price|цена/);
    expect(sig.formula?.toLowerCase()).toMatch(/plan_total|факт/);

    // Must carry the honest base caveat: this is limit−fact deviation, not ст.37 НМЦК economy.
    const hecText = `${hec.whatIs ?? ''} ${hec.howCalc ?? ''} ${hec.pitfalls ?? ''}`.toLowerCase();
    expect(hecText).toMatch(/нмцк|лимит.?[−-].?факт|не.*economy_total|прокси|разные баз/);
  });

  it('avg_reduction_pct is framed as deviation from limit, not AD-gated economy', () => {
    const ar = METRIC_KB.avg_reduction_pct;
    expect(ar).toBeDefined();
    const text = `${ar.whatIs ?? ''} ${ar.howCalc ?? ''}`.toLowerCase();
    expect(text).toMatch(/снижени|отклонени/);
    expect(text).toMatch(/не\s+ad|не.*economy_total|лимит.?[−-].?факт|не\s+ad-gated/);
  });
});

/**
 * Страж адресов ячеек (карта метрик 18.08.2026, расхождение «пятнадцать
 * неверных адресов»).
 *
 * Лист «СВОД ТД-ПМ» шириной ровно двадцать одна колонка — A..U (дамп
 * 18.08.2026: gridProperties.columnCount = 21). Колонки V/W/X/Y (факт-деньги)
 * и Z/AA/AB/AC (экономия) принадлежат ЛИСТАМ ГРБС, откуда SUMIFS свода их и
 * тянет. Пятнадцать записей базы знаний годами подписывали числа свода
 * адресами листов ГРБС: читатель, пошедший по адресу «СВОД ТД-ПМ!V», не
 * находил ячейки вовсе.
 *
 * Страж проверяет два условия: адрес свода не выходит за U и указывает на
 * колонку, за которой на листе действительно стоит эта величина.
 */
describe('METRIC_KB: адреса ячеек листа СВОД', () => {
  /** Лист СВОД ТД-ПМ: A..U, двадцать одна колонка. */
  const SVOD_LAST_COLUMN = 'U';

  /**
   * Буквенные колонки, названные в адресе. Считаются только настоящие адреса —
   * буква перед номером строки («L2»), перед подстановкой («H{dept_row}») и
   * границы диапазона («R–U», «H..K»). Пояснения в скобках («(EP only)»)
   * колонками не являются.
   */
  function columnsIn(cell: string): string[] {
    const body = cell.slice(cell.indexOf('!') + 1);
    const addressed = body.match(/\b[A-Z]{1,2}(?=\d|\{)/g) ?? [];
    const ranges = body.match(/\b[A-Z]{1,2}\s*(?:\.\.|[–—-])\s*[A-Z]{1,2}\b/g) ?? [];
    const ends = ranges.flatMap((r) => r.match(/[A-Z]{1,2}/g) ?? []);
    return [...addressed, ...ends];
  }

  /** Адреса, которые обязаны указывать на лист СВОД. */
  const svodCells = Object.entries(METRIC_KB)
    .filter(([, e]) => (e.cell ?? '').startsWith('СВОД'))
    .map(([key, e]) => ({ key, cell: e.cell as string }));

  it('в реестре есть адреса свода — иначе страж проверяет пустоту', () => {
    expect(svodCells.length).toBeGreaterThan(15);
  });

  it('ни один адрес не выходит за колонку U листа', () => {
    const offenders = svodCells
      .filter(({ cell }) =>
        columnsIn(cell).some((c) => c.length > 1 || c > SVOD_LAST_COLUMN))
      .map(({ key, cell }) => `${key}: ${cell}`);
    expect(
      offenders,
      'Колонки V..AG — это листы ГРБС, а не свод. На листе «СВОД ТД-ПМ» ячейки с таким ' +
      'адресом не существует: факт-деньги там L/M/N/O, экономия R/S/T/U.',
    ).toEqual([]);
  });

  it('каждый адрес указывает на колонку, где эта величина на листе и лежит', () => {
    // Соответствие «ключ метрики → колонка листа» выписано из дампа
    // 18.08.2026 по формулам самого листа, а не по памяти.
    const expected: Record<string, string> = {
      plan_count: 'D',        // «ПЛАН, единиц»
      fact_count: 'E',        // «ФАКТ, единиц»
      comp_fact_count: 'E',   // счёт заключённых, НЕ процент из G
      ep_fact_count: 'E',
      deviation: 'F',         // «Отклонение, единиц» = E−D
      exec_count_pct: 'G',    // «Заключено, %» = IF(D=0;"-";E/D)
      comp_exec_count_pct: 'G',
      plan_fb: 'H', plan_kb: 'I', plan_mb: 'J', plan_total: 'K',
      fact_fb: 'L', fact_kb: 'M', fact_mb: 'N', fact_total: 'O',
      execution_pct: 'Q',     // «Законтрактовано, %» = IF(K=0;"-";O/K)
      savings_pct: 'Q',       // та же колонка Q под вторым ключом
      economy_fb: 'R', economy_kb: 'S', economy_mb: 'T', economy_total: 'U',
    };
    const wrong: string[] = [];
    for (const [key, col] of Object.entries(expected)) {
      const cell = METRIC_KB[key]?.cell ?? '';
      if (!columnsIn(cell).includes(col)) wrong.push(`${key}: ожидалась колонка ${col}, стоит «${cell}»`);
    }
    expect(wrong).toEqual([]);
  });

  it('«% исполнения» и «Законтрактовано, %» названы одной колонкой Q и знают друг о друге', () => {
    // Расхождение №2 карты метрик: одна формула под двумя ключами и двумя
    // карточками. Ключи оставлены (записаны в снимках), но карточки обязаны
    // сказать читателю, что число одно.
    const exec = METRIC_KB.execution_pct;
    const savings = METRIC_KB.savings_pct;
    expect(exec.cell).toContain('Q');
    expect(savings.cell).toContain('Q');
    expect(`${exec.note ?? ''} ${exec.related?.join(' ') ?? ''}`).toContain('savings_pct');
    expect(savings.note ?? '').toContain('execution_pct');
  });
});

/**
 * Страж знака «Отклонения» (расхождение №1 карты метрик).
 *
 * Лист считает `F =E43-D43` — факт минус план, недобор отрицателен. До
 * 18.08.2026 движок считал наоборот, и в продукте жили две противоположные
 * конвенции под одним словом. Тест держит одну — листовую.
 */
describe('METRIC_KB: знак отклонения — один на весь продукт', () => {
  it('счётное отклонение описано как факт минус план', () => {
    const dev = METRIC_KB.deviation;
    expect(dev.formula).toBe('fact_count − plan_count');
    expect(`${dev.whatIs ?? ''} ${dev.howCalc ?? ''}`).toMatch(/недобор отрицателен|минус плановое/);
  });

  it('денежное отклонение считается в ту же сторону', () => {
    expect(METRIC_KB.amount_deviation.formula).toBe('fact_total − plan_total');
  });

  it('карточка отклонения предупреждает о словах отчёта с обратным знаком', () => {
    expect(METRIC_KB.deviation.pitfalls ?? '').toContain('Отклонение от плана');
  });
});

/**
 * Страж двух экономий района (расхождение №5 карты метрик).
 *
 * Утверждённая финорганом экономия свода (тысячи рублей, флаг AD) и экономия
 * торгов книги мониторинга («НМЦК минус цена аукциона», рубли) — разные
 * величины. Пока они назывались одним словом, руководитель видел на экране и
 * в записке два числа под одной подписью.
 */
describe('METRIC_KB: две экономии разведены словами', () => {
  it('экономия свода названа утверждённой в самой подписи', () => {
    for (const key of ['economy_fb', 'economy_kb', 'economy_mb', 'economy_total'] as const) {
      expect(METRIC_KB[key].label.toLowerCase(), key).toContain('утверждённая');
    }
  });

  it('карточка итоговой экономии называет вторую экономию и её книгу', () => {
    const text = `${METRIC_KB.economy_total.note ?? ''} ${METRIC_KB.economy_total.pitfalls ?? ''}`;
    expect(text).toContain('НМЦК');
    expect(text).toContain('мониторинг');
  });

  it('районный дубль экономии тоже подписан утверждённой и назван дублем', () => {
    expect(METRIC_KB.total_economy.label.toLowerCase()).toContain('утверждённая');
    expect(METRIC_KB.total_economy.pitfalls ?? '').toContain('дубль');
  });
});

/**
 * Страж периметра «Остатка к заключению» (расхождение №4 карты метрик).
 *
 * Формулы яруса L2:O2 привязаны к строке 14 листа — «Итого ЭА 2026». Значит
 * остаток считается только по конкурентным процедурам и только за год этой
 * строки. Показ того же числа как остатка всего плана — подмена периметра.
 */
describe('METRIC_KB: периметр остатка к заключению назван', () => {
  it('карточка есть и адресована ярусу L2:O2, а не блоку таблицы', () => {
    const r = METRIC_KB.remainder_to_conclude;
    expect(r).toBeDefined();
    expect(r.cell ?? '').toContain('O2');
  });

  it('карточка называет строку «Итого ЭА 2026» и исключение единственного поставщика', () => {
    const r = METRIC_KB.remainder_to_conclude;
    const text = `${r.note ?? ''} ${r.howCalc ?? ''} ${r.pitfalls ?? ''}`;
    expect(text).toContain('Итого ЭА 2026');
    expect(text.toLowerCase()).toContain('единственный поставщик');
  });

  it('карточка отличает лист от нашего пересчёта остатка', () => {
    expect(METRIC_KB.remainder_to_conclude.pitfalls ?? '').toContain('pending_total');
  });
});
