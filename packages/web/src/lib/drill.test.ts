// ── Стражи механизма М14 «провал несёт периметр» ────────────────────────────
//
//    Главный страж здесь один и он же самый строгий: НИ ОДНА ОСЬ ТОЧКИ НЕ
//    ИСЧЕЗАЕТ МОЛЧА. Для каждой вкладки берётся точка, у которой заполнены
//    все оси разом, и проверяется, что каждая из них либо доехала, либо
//    названа непринятой. Ровно этого не хватало живым переходам: они роняли
//    квартал и способ без единого слова.
//
//    Второе семейство стражей — на честность отдельных случаев: бюджет не
//    передаётся никуда, признаки понимает только Реестр, Мониторинг принимает
//    период местным отбором, а не шапкой.

import { describe, it, expect } from 'vitest';
import {
  axisCarrier,
  buildDrill,
  canonicalPoint,
  drillHref,
  unknownPickKeys,
  type DrillAxis,
  type DrillFilters,
  type DrillPage,
  type DrillPoint,
} from './drill';
import { PICK_PREFIX, allViewTabs, parseAddress, viewInt, viewToken } from './view-state';
import type { AppState } from '../store';

/** Все вкладки, куда можно провалиться. */
const PAGES = allViewTabs() as readonly DrillPage[];

/** Точка со ВСЕМИ осями разом — чтобы проверять, что ни одна не пропала. */
const FULL_POINT: DrillPoint = {
  dept: 'УО',
  subordinate: 'МБОУ СОШ № 1',
  year: 2026,
  quarter: 3,
  month: 8,
  method: 'ЕП',
  budget: 'fb',
  activity: 'program',
  signals: ['no_contract', 'late'],
  search: 'шкаф',
  procedure: '0158300012625000123',
};

/** Оси, которые точка действительно называет (месяц поглощает квартал). */
const FULL_AXES: readonly DrillAxis[] = [
  'dept', 'subordinate', 'year', 'month',
  'method', 'budget', 'activity', 'signals', 'search', 'procedure',
];

describe('ни одна ось не исчезает молча', () => {
  it.each(PAGES)('вкладка «%s»: каждая ось точки либо доехала, либо названа', (page) => {
    const target = buildDrill(FULL_POINT, page);
    const accounted = [
      ...target.carried.map((n) => n.axis),
      ...target.dropped.map((n) => n.axis),
    ];

    expect([...accounted].sort()).toEqual([...FULL_AXES].sort());
    // Ось не может одновременно доехать и не доехать.
    expect(new Set(accounted).size).toBe(accounted.length);
  });

  it.each(PAGES)('вкладка «%s»: у каждой непринятой оси названа причина', (page) => {
    for (const note of buildDrill(FULL_POINT, page).dropped) {
      expect(note.reason?.trim().length ?? 0).toBeGreaterThan(0);
      expect(note.label.trim().length).toBeGreaterThan(0);
      expect(note.title.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(PAGES)('вкладка «%s»: потери названы во фразе предупреждения', (page) => {
    const target = buildDrill(FULL_POINT, page);
    if (target.dropped.length === 0) {
      expect(target.warning).toBe('');
      return;
    }
    for (const note of target.dropped) {
      expect(target.warning).toContain(note.title);
      expect(target.warning).toContain(note.label);
    }
  });

  it('пустая точка не сужает цель и ничего не теряет', () => {
    const target = buildDrill({}, 'economy');
    expect(target.filters).toEqual({});
    expect(target.carried).toEqual([]);
    expect(target.dropped).toEqual([]);
    expect(target.address).toBe('');
    expect(target.summary).toBe('Откроется всё без сужения');
    expect(target.warning).toBe('');
  });
});

describe('болезни атласа, ради которых механизм построен', () => {
  it('П3 «Пульта»: клик по сектору круга уносит НЕ ТОЛЬКО управление', () => {
    // Было: уходило одно управление, квартал и способ сгорали молча.
    const target = buildDrill({ dept: 'УО', year: 2026, quarter: 3, method: 'ЕП' }, 'data');

    expect(target.filters.department).toBe('УО');
    expect(target.filters.year).toBe(2026);
    expect(target.filters.period).toBe('q3');
    expect(target.filters.procurement).toBe('single');
    expect(target.dropped).toEqual([]);
  });

  it('А4 «Аналитики»: период доезжает — «3 кв» больше не разворачивается в год', () => {
    const target = buildDrill({ quarter: 3 }, 'analytics');
    expect(target.filters.period).toBe('q3');
    expect(target.summary).toBe('Откроется: 3 кв');
  });

  it('Э6 «Экономии»: способ доезжает, а бюджет честно объявлен непереданным', () => {
    const target = buildDrill({ method: 'КП', budget: 'mb' }, 'data');

    expect(target.filters.procurement).toBe('competitive');
    expect(target.filters).not.toHaveProperty('budget');
    expect(target.dropped.map((n) => n.axis)).toEqual(['budget']);
    expect(target.warning).toContain('Бюджет МБ');
    expect(target.warning).toContain('не умеет передавать уровень бюджета');
  });

  it.each(PAGES)('вкладка «%s»: бюджет не передаётся никуда и всегда назван', (page) => {
    const target = buildDrill({ budget: 'fb' }, page);
    expect(axisCarrier(page, 'budget')).toBe('none');
    expect(target.dropped.map((n) => n.axis)).toEqual(['budget']);
  });
});

describe('квартал и месяц не сжигают друг друга', () => {
  it('известный месяц едет вместо квартала — цель уже, а не шире', () => {
    const target = buildDrill({ quarter: 3, month: 8 }, 'economy');

    expect(target.filters.months).toEqual([8]);
    // Квартал не «потерян»: месяц лежит внутри него, и цель окажется точнее.
    expect(target.filters).not.toHaveProperty('period');
    expect(target.dropped).toEqual([]);
    expect(target.carried.map((n) => n.axis)).not.toContain('quarter');
  });

  it('без месяца едет квартал', () => {
    expect(buildDrill({ quarter: 2 }, 'economy').filters.period).toBe('q2');
  });

  it('месяц вне названного квартала: побеждает месяц, противоречие снято', () => {
    const point = canonicalPoint({ quarter: 1, month: 8 });
    expect(point.month).toBe(8);
    expect(point.quarter).toBeUndefined();
  });

  it('месяц внутри квартала противоречием не считается', () => {
    const point = canonicalPoint({ quarter: 3, month: 8 });
    expect(point).toEqual({ quarter: 3, month: 8 });
  });
});

describe('Мониторинг принимает период местным отбором, а не шапкой', () => {
  it('год, квартал и способ едут f-параметрами адреса', () => {
    const target = buildDrill({ dept: 'УО', year: 2026, quarter: 3, method: 'ЕП' }, 'monitoring');

    // Управление — единственное, что Мониторинг читает из отбора шапки.
    expect(target.filters).toEqual({ department: 'УО' });

    const parsed = parseAddress(target.address);
    expect(parsed.tab).toBe('monitoring');
    expect(viewInt(parsed.pick, 'pyear', 0)).toBe(2026);
    expect(viewInt(parsed.pick, 'pq', 0)).toBe(3);
    expect(viewToken(parsed.pick, 'smethod')).toBe('ЕП');
  });

  it('приехавший местным отбором период сразу назван чипами', () => {
    const target = buildDrill({ year: 2026, quarter: 3 }, 'monitoring');
    const chips = parseAddress(target.address).picks.map((p) => p.chip);
    expect(chips).toContain('Год по дате: 2026');
    expect(chips).toContain('3 кв по дате');
  });

  it('учреждение и вид деятельности Мониторингу не передаются и названы', () => {
    const target = buildDrill({ subordinate: 'МБОУ СОШ № 1', activity: 'program' }, 'monitoring');
    expect(target.dropped.map((n) => n.axis).sort()).toEqual(['activity', 'subordinate']);
    expect(target.address).toBe('');
  });

  it('номер процедуры — раскрытие, то есть ВИД: едет v-параметром', () => {
    const target = buildDrill({ procedure: '0158300012625000123' }, 'monitoring');
    const parsed = parseAddress(target.address);
    expect(viewToken(parsed.view, 'open')).toBe('0158300012625000123');
    expect(target.address).not.toContain(PICK_PREFIX);
  });

  it('ключи местного отбора объявлены в view-state — иначе они терялись бы при разборе', () => {
    expect(unknownPickKeys()).toEqual([]);
  });

  it('местный отбор Мониторинга переживает круг «цель → адрес → цель»', () => {
    const target = buildDrill({ year: 2026, month: 8, method: 'КП', search: 'шкаф' }, 'monitoring');
    const parsed = parseAddress(target.address);

    expect(viewInt(parsed.pick, 'pyear', 0)).toBe(2026);
    expect(viewInt(parsed.pick, 'pm', 0)).toBe(8);
    expect(viewToken(parsed.pick, 'smethod')).toBe('КП');
    expect(viewToken(parsed.pick, 'text')).toBe('шкаф');
  });
});

describe('признаки строк понимает только Реестр', () => {
  it('в Реестр признаки едут затравкой', () => {
    const target = buildDrill({ signals: ['no_contract'] }, 'data');
    expect(target.filters.signals).toEqual(['no_contract']);
    expect(target.dropped).toEqual([]);
  });

  it.each(PAGES.filter((p) => p !== 'data'))('во вкладку «%s» признаки не едут и названы', (page) => {
    const target = buildDrill({ signals: ['no_contract'] }, page);
    expect(target.filters).not.toHaveProperty('signals');
    expect(target.dropped.map((n) => n.axis)).toContain('signals');
  });

  it('признаки дедуплицируются, пустые отбрасываются', () => {
    expect(canonicalPoint({ signals: ['a', ' a ', '', '  ', 'b'] }).signals).toEqual(['a', 'b']);
  });
});

describe('мусор в точке не сужает цель наугад', () => {
  it.each([
    ['год', { year: 1900 }],
    ['год', { year: 2.5 }],
    ['квартал', { quarter: 0 }],
    ['квартал', { quarter: 5 }],
    ['месяц', { month: 0 }],
    ['месяц', { month: 13 }],
  ])('негодный %s отбрасывается', (_axis, point) => {
    expect(canonicalPoint(point as DrillPoint)).toEqual({});
  });

  it('выдуманный способ, бюджет и признак не проходят', () => {
    const point = canonicalPoint({
      method: 'ЧТО-ТО' as never,
      budget: 'xx' as never,
      activity: 'выдумка' as never,
    });
    expect(point).toEqual({});
  });

  it('пробелы вокруг значений снимаются, пустые оси исчезают', () => {
    expect(canonicalPoint({ dept: '  УО  ', search: '   ', subordinate: '' }))
      .toEqual({ dept: 'УО' });
  });

  it('негодная точка даёт цель без сужения, а не цель наугад', () => {
    const target = buildDrill({ year: 1900, quarter: 9, method: 'ЧТО-ТО' as never }, 'economy');
    expect(target.filters).toEqual({});
    expect(target.dropped).toEqual([]);
  });
});

describe('форма цели', () => {
  it('фраза подсказки называет оси в порядке «кто · когда · что»', () => {
    const target = buildDrill({ dept: 'УО', quarter: 3, method: 'ЕП' }, 'economy');
    expect(target.summary).toBe('Откроется: УО · 3 кв · ЕП');
  });

  it('ссылка без местного отбора не оставляет пустого «?»', () => {
    expect(drillHref('/', buildDrill({ dept: 'УО' }, 'economy'))).toBe('/');
  });

  it('ссылка с местным отбором несёт параметры', () => {
    const href = drillHref('/', buildDrill({ quarter: 3 }, 'monitoring'));
    expect(href.startsWith('/?')).toBe(true);
    expect(href).toContain('tab=monitoring');
  });

  it('способ переводится в ключ, который понимает переход', () => {
    expect(buildDrill({ method: 'КП' }, 'economy').filters.procurement).toBe('competitive');
    expect(buildDrill({ method: 'ЕП' }, 'economy').filters.procurement).toBe('single');
  });
});

/**
 * Страж уровня типов: у цели не должно быть ни одного поля, которого
 * `navigateTo` не знает. Такое поле не вызвало бы ошибки при передаче — оно
 * просто ничего бы не сделало, и ось снова исчезала бы молча. Здесь оно
 * роняет сборку.
 */
type AssertNever<T extends never> = T;
type _NoUnknownFilterKeys = AssertNever<
  Exclude<keyof DrillFilters, keyof NonNullable<Parameters<AppState['navigateTo']>[1]>>
>;

describe('шов с navigateTo', () => {
  it('отбор цели по типу подходит второму доводу navigateTo', () => {
    // Страж уровня типов: если у `navigateTo` поменяется форма довода, сборка
    // упадёт здесь, а не в проде молчаливо потерянной осью.
    type NavigateFilters = NonNullable<Parameters<AppState['navigateTo']>[1]>;
    const target = buildDrill(FULL_POINT, 'data');
    const asNavigate: NavigateFilters = target.filters;
    expect(asNavigate.department).toBe('УО');
    expect(asNavigate.activity).toBe('program');
  });
});
