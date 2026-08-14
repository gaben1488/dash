import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERIMETER,
  buildPerimeter,
  defaultPerimeterYear,
  perimeterLabel,
  type Perimeter,
} from './perimeter';
import { AVAILABLE_YEARS } from '../store';

/** Готовый периметр для проверок подписи — без похода в состояние фильтров. */
function fixture(over: Partial<Perimeter> = {}): Perimeter {
  return {
    year: 2026,
    span: { kind: 'year', label: 'весь год' },
    orgs: { kind: 'all', label: 'все управления' },
    moment: { kind: 'live', label: 'на сейчас' },
    ...over,
  };
}

describe('perimeterLabel — единственный шаблон подписи (канон п.58 «д»)', () => {
  it('собирает четыре оси в канонической фразе владельца', () => {
    expect(perimeterLabel(fixture())).toBe('2026 · весь год · все управления · на сейчас');
  });

  it('порядок осей не зависит от их содержания', () => {
    const label = perimeterLabel(fixture({
      span: { kind: 'quarter', label: '3 кв' },
      orgs: { kind: 'departments', label: 'УКСиМП' },
      moment: { kind: 'snapshot', label: 'срез на 14.08.2026' },
    }));
    expect(label).toBe('2026 · 3 кв · УКСиМП · срез на 14.08.2026');
  });

  it('снятый фильтр года называется словами, а не пропускается', () => {
    expect(perimeterLabel(fixture({ year: 'all' }))).toContain('все годы');
  });

  it('пометка о неподчинении идёт хвостом и не ломает порядок осей', () => {
    const label = perimeterLabel(fixture({ note: 'неделя выбрана, но числа за весь год' }));
    expect(label).toBe(
      '2026 · весь год · все управления · на сейчас (неделя выбрана, но числа за весь год)',
    );
  });
});

describe('DEFAULT_PERIMETER — правило (в): один дефолт на все вкладки', () => {
  it('это «весь год · все управления · на сейчас» без единого фильтра', () => {
    expect(DEFAULT_PERIMETER.span).toEqual({ kind: 'year', label: 'весь год' });
    expect(DEFAULT_PERIMETER.orgs).toEqual({ kind: 'all', label: 'все управления' });
    expect(DEFAULT_PERIMETER.moment).toEqual({ kind: 'live', label: 'на сейчас' });
    expect(DEFAULT_PERIMETER.note).toBeUndefined();
  });

  it('подпись читается ровно так, как её продиктовал владелец', () => {
    expect(perimeterLabel(DEFAULT_PERIMETER))
      .toBe(`${DEFAULT_PERIMETER.year} · весь год · все управления · на сейчас`);
  });

  it('год живой, а не вписанный строкой: 1 января подпись не соврёт', () => {
    expect(AVAILABLE_YEARS).toContain(DEFAULT_PERIMETER.year as number);
    // Год, которого в системе нет, откатывается к последнему заведённому,
    // а не печатается сам собой.
    expect(defaultPerimeterYear(new Date('1999-06-01T00:00:00')))
      .toBe(AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]);
  });

  it('совпадает с тем, что соберёт buildPerimeter на пустом состоянии', () => {
    const built = buildPerimeter({ year: DEFAULT_PERIMETER.year, period: 'year' });
    expect(perimeterLabel(built)).toBe(perimeterLabel(DEFAULT_PERIMETER));
  });
});

describe('buildPerimeter — периметр берётся из состояния, а не из бейджа', () => {
  it('квартал называется каноном «3 кв», а не «3 квартал»', () => {
    const p = buildPerimeter({ year: 2026, period: 'q3' });
    expect(p.span).toEqual({ kind: 'quarter', label: '3 кв' });
  });

  it('единственный месяц называется месяцем, а не кварталом', () => {
    const p = buildPerimeter({ year: 2026, period: 'q2', activeMonths: [5] });
    expect(p.span).toEqual({ kind: 'month', label: 'май' });
  });

  it('мусорные номера месяцев отбрасываются, а не печатаются', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', activeMonths: [0, 13, 7.5, 7] });
    expect(p.span).toEqual({ kind: 'month', label: 'июль' });
  });

  it('одно выбранное управление называется по имени', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', departments: ['УКСиМП'] });
    expect(p.orgs).toEqual({ kind: 'departments', label: 'УКСиМП' });
  });

  it('латинский ключ управления приводится к кириллическому канону (дефект Д12)', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', departments: ['uksimp'] });
    expect(p.orgs.label).not.toMatch(/[a-z]/i);
    expect(p.orgs.kind).toBe('departments');
  });

  it('много управлений считаются числом со склонением', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      departments: ['УКСиМП', 'УО', 'УЭР', 'УД'],
    });
    expect(p.orgs).toEqual({ kind: 'departments', label: '4 управления' });
  });

  it('выбранные учреждения дописываются к управлению отдельной осью', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      departments: ['УО'],
      subordinates: ['МБОУ «Радуга»', 'МБОУ «Ромашка»'],
    });
    expect(p.orgs.kind).toBe('subordinates');
    expect(p.orgs.label).toBe('УО · 2 учреждения');
  });

  it('без даты среза момент — эфир «на сейчас»', () => {
    expect(buildPerimeter({ year: 2026, period: 'year' }).moment)
      .toEqual({ kind: 'live', label: 'на сейчас' });
  });

  it('дата среза называет день, а не прячется за словом «архив»', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', asOf: '2026-08-14' });
    expect(p.moment.kind).toBe('snapshot');
    expect(p.moment.label).toBe('срез на 14.08.2026');
  });

  it('нечитаемая дата среза не превращается в фальшивый момент', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', asOf: 'позавчера' });
    expect(p.moment).toEqual({ kind: 'live', label: 'на сейчас' });
  });

  it('правило (б): блок вне фильтра периода объявляет «весь год» и называет расхождение', () => {
    const p = buildPerimeter({ year: 2026, period: 'q3', ignoresPeriodFilter: true });
    expect(p.span.label).toBe('весь год');
    expect(p.note).toBe('выбран 3 кв, но числа за весь год');
    expect(perimeterLabel(p)).toContain('весь год · все управления · на сейчас (выбран 3 кв');
  });

  it('пометки нет, когда неподчиняться нечему', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', ignoresPeriodFilter: true });
    expect(p.note).toBeUndefined();
  });
});
