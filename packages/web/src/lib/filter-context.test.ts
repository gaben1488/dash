import { describe, it, expect } from 'vitest';
import {
  buildFilterContext,
  serializeToUrl,
  parseFromUrl,
  EMPTY_FILTER_CONTEXT,
  type FilterContext,
  type FilterStoreSlice,
} from './filter-context';

/** Базовый store-срез без активных фильтров (год фиксирован для детерминизма).
 *  periodMode здесь 'explicit', чтобы нейтральный срез давал weekStart=null;
 *  week-режим включается точечно в тестах недели. */
function makeSlice(patch: Partial<FilterStoreSlice> = {}): FilterStoreSlice {
  return {
    year: 2026,
    period: 'year',
    activeMonths: new Set<number>(),
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedMethods: new Set<string>(),
    selectedBudgets: new Set<string>(),
    searchQuery: '',
    periodMode: 'explicit',
    focusedWeekStart: new Date(2026, 6, 20), // локальная полночь понедельника
    ...patch,
  };
}

describe('buildFilterContext — чистая сборка из store-среза', () => {
  it('пустой срез → пустой контекст с годом', () => {
    const ctx = buildFilterContext(makeSlice());
    expect(ctx).toEqual({ ...EMPTY_FILTER_CONTEXT, year: 2026 });
  });

  it('канонизация ключей ГРБС: латиница и кириллица → кириллический канон в порядке реестра', () => {
    const ctx = buildFilterContext(makeSlice({
      selectedDepartments: new Set(['uer', 'УО', 'uio']),
    }));
    // ALL_DEPT_IDS порядок: УЭР, УИО, ..., УО
    expect(ctx.grbs).toEqual(['УЭР', 'УИО', 'УО']);
  });

  it('неизвестный ключ ГРБС отбрасывается (не мусорит контекст)', () => {
    const ctx = buildFilterContext(makeSlice({
      selectedDepartments: new Set(['uer', 'ЧУЖОЕ']),
    }));
    expect(ctx.grbs).toEqual(['УЭР']);
  });

  it('период: месяцы одного квартала перекрывают period (resolvePeriodSelection)', () => {
    const ctx = buildFilterContext(makeSlice({
      period: 'q1',
      activeMonths: new Set([8, 7]),
    }));
    expect(ctx.period).toBe('q3'); // {7,8} ⊂ q3 → эффективный квартал q3
    expect(ctx.months).toEqual([7, 8]); // отсортированы
  });

  it('период: месяцы двух кварталов не дают одного квартала — period остаётся', () => {
    const ctx = buildFilterContext(makeSlice({
      period: 'q1',
      activeMonths: new Set([1, 7]),
    }));
    expect(ctx.period).toBe('q1');
    expect(ctx.months).toEqual([1, 7]);
  });

  it('способы: store-ключи competitive/single → семейства КП/ЕП', () => {
    const ctx = buildFilterContext(makeSlice({
      selectedMethods: new Set(['single', 'competitive']),
    }));
    expect(ctx.methods).toEqual(['КП', 'ЕП']); // канонический порядок
  });

  it('подведы: сентинел аппарата первым, остальные по алфавиту', () => {
    const ctx = buildFilterContext(makeSlice({
      selectedSubordinates: new Set(['Школа №2', '_org_itself', 'Библиотека']),
    }));
    expect(ctx.subordinates).toEqual(['_org_itself', 'Библиотека', 'Школа №2']);
  });

  it('деятельности/бюджеты фильтруются до канона, поиск триммится', () => {
    const ctx = buildFilterContext(makeSlice({
      selectedActivities: new Set(['current_program', 'junk']),
      selectedBudgets: new Set(['mb', 'fb', 'nope']),
      searchQuery: '  шкаф ',
    }));
    expect(ctx.activities).toEqual(['current_program']);
    expect(ctx.budgets).toEqual(['fb', 'mb']);
    expect(ctx.search).toBe('шкаф');
  });

  it('week-режим: weekStart = ISO понедельника из ЛОКАЛЬНЫХ компонентов даты', () => {
    const ctx = buildFilterContext(makeSlice({
      periodMode: 'week',
      focusedWeekStart: new Date(2026, 6, 20), // локальная полночь: UTC-конверсия сдвинула бы день
    }));
    expect(ctx.weekStart).toBe('2026-07-20');
  });

  it('explicit-режим: недели нет — weekStart = null', () => {
    const ctx = buildFilterContext(makeSlice({
      periodMode: 'explicit',
      focusedWeekStart: new Date(2026, 6, 20),
    }));
    expect(ctx.weekStart).toBeNull();
  });

  it('week-режим: не-понедельник нормализуется к понедельнику его недели (DST-дрейф колеса)', () => {
    // Воскресенье 23:59 — так выглядел focusedWeekStart после мс-шага колеса
    // через перевод часов; контракт поля — всегда ISO понедельника.
    const ctx = buildFilterContext(makeSlice({
      periodMode: 'week',
      focusedWeekStart: new Date(2026, 6, 26, 23, 59), // вс 26.07.2026
    }));
    expect(ctx.weekStart).toBe('2026-07-20');
  });

  it('week-режим: невалидная дата колеса — weekStart = null, не исключение', () => {
    const ctx = buildFilterContext(makeSlice({
      periodMode: 'week',
      focusedWeekStart: new Date(NaN),
    }));
    expect(ctx.weekStart).toBeNull();
  });
});

describe('serializeToUrl / parseFromUrl — компактная URL-схема (спека §3.3)', () => {
  const fullCtx: FilterContext = {
    year: 2026,
    period: 'q1',
    months: [1, 2],
    grbs: ['УЭР', 'УО'],
    subordinates: ['_org_itself', 'Школа, корпус 2'],
    activities: ['program', 'current_program'],
    methods: ['КП'],
    budgets: ['fb', 'kb'],
    search: 'шкаф',
    weekStart: '2026-07-20',
  };

  it('сериализация полного контекста — ожидаемые ключи и компактные коды', () => {
    const qs = serializeToUrl(fullCtx);
    const p = new URLSearchParams(qs);
    expect(p.get('y')).toBe('2026');
    expect(p.get('p')).toBe('q1');
    expect(p.get('m')).toBe('1,2');
    expect(p.get('grbs')).toBe('УЭР,УО');
    // подведы — повторяющийся параметр (имена могут содержать запятые)
    expect(p.getAll('unit')).toEqual(['_org_itself', 'Школа, корпус 2']);
    expect(p.get('act')).toBe('pm,tdpm'); // компакт-коды спеки
    expect(p.get('mtd')).toBe('kp');
    expect(p.get('bud')).toBe('fb,kb');
    expect(p.get('q')).toBe('шкаф');
    expect(p.get('w')).toBe('2026-07-20');
  });

  it('weekStart=null не сериализуется в w=', () => {
    const p = new URLSearchParams(serializeToUrl({ ...EMPTY_FILTER_CONTEXT, year: 2026 }));
    expect(p.has('w')).toBe(false);
  });

  it('пустой контекст сериализуется в один параметр года', () => {
    expect(serializeToUrl({ ...EMPTY_FILTER_CONTEXT, year: 2026 })).toBe('y=2026');
    expect(serializeToUrl(EMPTY_FILTER_CONTEXT)).toBe('y=all');
  });

  it('roundtrip: parse(serialize(ctx)) === ctx (полный контекст)', () => {
    expect(parseFromUrl(serializeToUrl(fullCtx))).toEqual(fullCtx);
  });

  it('roundtrip: пустой и частичные контексты', () => {
    const cases: FilterContext[] = [
      { ...EMPTY_FILTER_CONTEXT, year: 2026 },
      EMPTY_FILTER_CONTEXT,
      { ...EMPTY_FILTER_CONTEXT, year: 2025, months: [7, 8], methods: ['ЕП'] },
      { ...EMPTY_FILTER_CONTEXT, year: 2026, grbs: ['УДТХ'], search: 'ремонт дорог' },
      { ...EMPTY_FILTER_CONTEXT, year: 2026, weekStart: '2026-07-20' },
    ];
    for (const ctx of cases) {
      expect(parseFromUrl(serializeToUrl(ctx))).toEqual(ctx);
    }
  });

  it('w=: не-понедельник нормализуется к понедельнику ЕГО недели', () => {
    // 2026-07-23 — четверг; 2026-07-26 — воскресенье той же ISO-недели
    expect(parseFromUrl('y=2026&w=2026-07-23').weekStart).toBe('2026-07-20');
    expect(parseFromUrl('y=2026&w=2026-07-26').weekStart).toBe('2026-07-20');
    expect(parseFromUrl('y=2026&w=2026-07-20').weekStart).toBe('2026-07-20');
  });

  it('w=: мусор → null', () => {
    expect(parseFromUrl('y=2026&w=банан').weekStart).toBeNull();
    expect(parseFromUrl('y=2026&w=2026-7-3').weekStart).toBeNull();   // не zero-padded
    expect(parseFromUrl('y=2026&w=2026-02-30').weekStart).toBeNull(); // несуществующая дата
    expect(parseFromUrl('y=2026').weekStart).toBeNull();
  });

  it('parse принимает строку с ведущим "?"', () => {
    expect(parseFromUrl('?y=2026&p=q2')).toEqual({
      ...EMPTY_FILTER_CONTEXT, year: 2026, period: 'q2',
    });
  });

  it('parse канонизирует латинский ГРБС из руками написанной ссылки', () => {
    const ctx = parseFromUrl('y=2026&grbs=uer,uo');
    expect(ctx.grbs).toEqual(['УЭР', 'УО']);
  });

  it('parse отбрасывает мусорные значения, не падая', () => {
    const ctx = parseFromUrl('y=банан&p=q9&m=0,13,7&grbs=XXX&mtd=teleport&act=magic&bud=zz');
    expect(ctx.year).toBe('all');   // невалидный год → все годы
    expect(ctx.period).toBe('year');
    expect(ctx.months).toEqual([7]); // вне 1..12 — отброшены
    expect(ctx.grbs).toEqual([]);
    expect(ctx.methods).toEqual([]);
    expect(ctx.activities).toEqual([]);
    expect(ctx.budgets).toEqual([]);
  });

  it('parse пустой строки → пустой контекст', () => {
    expect(parseFromUrl('')).toEqual(EMPTY_FILTER_CONTEXT);
  });
});
