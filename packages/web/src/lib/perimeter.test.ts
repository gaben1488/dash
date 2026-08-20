import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERIMETER,
  buildPerimeter,
  defaultPerimeterYear,
  perimeterApplies,
  perimeterBadge,
  perimeterConflicts,
  perimeterFromFilters,
  perimeterHint,
  perimeterLabel,
  samePerimeter,
  type Perimeter,
} from './perimeter';
import { AVAILABLE_YEARS } from '../store';

/**
 * Готовый периметр для проверок подписи — без похода в состояние фильтров.
 * Строится от дефолта: собирать пять осей руками в тесте значило бы завести
 * второй способ собрать периметр, и он бы разошёлся с настоящим.
 */
function fixture(over: Partial<Perimeter> = {}): Perimeter {
  return { ...DEFAULT_PERIMETER, year: 2026, ...over };
}

describe('perimeterLabel — единственный шаблон подписи (канон п.58 «д»)', () => {
  it('собирает четыре оси в канонической фразе владельца', () => {
    expect(perimeterLabel(fixture())).toBe('2026 · весь год · все управления · на сейчас');
  });

  it('порядок осей не зависит от их содержания', () => {
    const label = perimeterLabel(buildPerimeter({
      year: 2026,
      period: 'q3',
      departments: ['УКСиМП'],
      asOf: '2026-08-14',
    }));
    expect(label).toBe('2026 · 3 кв · УКСиМП · срез на 14.08.2026');
  });

  it('снятый фильтр года называется словами, а не пропускается', () => {
    expect(perimeterLabel(fixture({ year: 'all' }))).toContain('все годы');
  });

  it('пометка о неподчинении идёт хвостом и не ломает порядок осей', () => {
    const label = perimeterLabel(fixture({
      note: 'неделя выбрана, но числа за весь год',
      notes: ['неделя выбрана, но числа за весь год'],
    }));
    expect(label).toBe(
      '2026 · весь год · все управления · на сейчас (неделя выбрана, но числа за весь год)',
    );
  });

  it('срез вклинивается перед моментом только когда он сужает число', () => {
    const wide = buildPerimeter({ year: 2026, period: 'year' });
    expect(perimeterLabel(wide)).not.toContain('все закупки');

    const narrow = buildPerimeter({ year: 2026, period: 'year', methods: ['single'], budgets: ['mb'] });
    expect(perimeterLabel(narrow)).toBe('2026 · весь год · все управления · ЕП · МБ · на сейчас');
  });
});

describe('DEFAULT_PERIMETER — правило (в): один дефолт на все вкладки', () => {
  it('это «весь год · все управления · на сейчас» без единого фильтра', () => {
    expect(DEFAULT_PERIMETER.span).toEqual({ kind: 'year', label: 'весь год' });
    expect(DEFAULT_PERIMETER.orgs).toEqual({ kind: 'all', label: 'все управления' });
    expect(DEFAULT_PERIMETER.slice.kind).toBe('all');
    expect(DEFAULT_PERIMETER.moment.kind).toBe('live');
    expect(DEFAULT_PERIMETER.moment.label).toBe('на сейчас');
    expect(DEFAULT_PERIMETER.notes).toEqual([]);
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
    const moment = buildPerimeter({ year: 2026, period: 'year' }).moment;
    expect(moment.kind).toBe('live');
    expect(moment.label).toBe('на сейчас');
  });

  it('дата среза называет день, а не прячется за словом «архив»', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', asOf: '2026-08-14' });
    expect(p.moment.kind).toBe('snapshot');
    expect(p.moment.label).toBe('срез на 14.08.2026');
  });

  it('нечитаемая дата среза не превращается в фальшивый момент', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', asOf: 'позавчера' });
    expect(p.moment.kind).toBe('live');
    expect(p.moment.label).toBe('на сейчас');
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
    expect(p.notes).toEqual([]);
    // Ось всё равно объявлена неприменимой — вкладке есть что показать словами.
    expect(perimeterApplies(p, 'period')).toBe(false);
  });
});

describe('ось среза — способ · бюджет · вид (болезнь Н8 «Пульта»)', () => {
  it('способ закупки называется каноном шапки, в какой бы форме ни пришёл', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', methods: ['single'] });
    expect(p.slice.kind).toBe('sliced');
    expect(p.slice.label).toBe('ЕП');
    expect(p.slice.methods).toEqual(['ЕП']);
  });

  it('три оси среза складываются в одну подпись в порядке шапки', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      methods: ['ep', 'competitive'],
      budgets: ['mb', 'fb'],
      activities: ['program'],
    });
    expect(p.slice.label).toBe('КП · ЕП · ФБ · МБ · ПМ');
  });

  it('легаси-ключ текущей деятельности не печатается «ТД · ТД» (канон п.30)', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      activities: ['current_program', 'current_non_program'],
    });
    expect(p.slice.activities).toEqual(['ТД']);
    expect(p.slice.label).toBe('ТД');
  });

  it('чужой ключ среза отбрасывается, а не печатается сырым', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', methods: ['аукцион'], budgets: ['xb'] });
    expect(p.slice.kind).toBe('all');
    expect(p.slice.label).toBe('все закупки');
  });
});

describe('применимость осей — правило (ж): неприменимое НАЗЫВАЕТСЯ', () => {
  it('фильтр способа, к числу не применяющийся, назван вслух (Н2 «Экономии»)', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      methods: ['single'],
      notApplicable: ['methods'],
    });
    expect(p.slice.kind).toBe('all');
    expect(p.notes).toEqual(['фильтр способа закупки к этому числу не применяется']);
    expect(perimeterConflicts(p)).toEqual(['methods']);
    expect(perimeterApplies(p, 'methods')).toBe(false);
  });

  it('фильтр бюджета, который вкладка не применяет, не молчит (Н4 «Конкуренции»)', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      budgets: ['mb'],
      notApplicable: ['budgets'],
    });
    expect(perimeterHint(p)).toContain('Фильтр бюджета к этому числу не применяется.');
  });

  it('неприменимая ось молчит, пока читатель по ней ничего не выбрал', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', notApplicable: ['methods', 'budgets'] });
    expect(p.notes).toEqual([]);
    expect(perimeterConflicts(p)).toEqual([]);
    // Но признак «этой осью число не сужается» доступен вкладке всегда.
    expect(p.applies.methods).toBe(false);
    expect(p.applies.budgets).toBe(false);
  });

  it('фильтр управлений, который число игнорирует, объявляет весь район (Н3 «Пульта»)', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      departments: ['УО'],
      notApplicable: ['departments'],
    });
    expect(p.orgs).toEqual({ kind: 'all', label: 'все управления' });
    expect(p.notes).toEqual([
      'фильтр управлений к этому числу не применяется — оно посчитано по всему району',
    ]);
  });

  it('несколько расхождений перечисляются все, а не первое попавшееся', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'q3',
      methods: ['single'],
      budgets: ['fb'],
      notApplicable: ['period', 'methods', 'budgets'],
    });
    expect(p.notes).toHaveLength(3);
    expect(p.notes[0]).toBe('выбран 3 кв, но числа за весь год');
    expect(perimeterLabel(p)).toContain('; ');
  });

  it('готовая пометка вызывающего перекрывает автоматические', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'q3',
      ignoresPeriodFilter: true,
      note: 'проверки идут по всем строкам книг',
    });
    expect(p.notes).toEqual(['проверки идут по всем строкам книг']);
  });
});

describe('правило (з): при выборе подведов периметр говорит об организации', () => {
  it('число, не знающее подведов, читается «УО целиком» (болезнь A1 «Аналитики»)', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      departments: ['УО'],
      subordinates: ['МБОУ «Радуга»', 'МБОУ «Ромашка»'],
      notApplicable: ['subordinates'],
    });
    expect(p.orgs).toEqual({ kind: 'whole', label: 'УО целиком' });
    expect(p.notes).toEqual([
      'фильтр подведомственных к этому числу не применяется — оно посчитано по управлению целиком',
    ]);
  });

  it('одно учреждение называется по имени, а не счётом', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      departments: ['УО'],
      subordinates: ['МБОУ «Радуга»'],
    });
    expect(p.orgs.label).toBe('УО · МБОУ «Радуга»');
  });

  it('подведы без выбранного управления не притворяются организацией', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'year',
      subordinates: ['МБОУ «Радуга»'],
      notApplicable: ['subordinates'],
    });
    expect(p.orgs).toEqual({ kind: 'all', label: 'все управления' });
  });
});

describe('perimeterBadge — короткая подпись, которая не врёт', () => {
  it('без фильтров это год и период — и ничего лишнего', () => {
    expect(perimeterBadge(DEFAULT_PERIMETER)).toBe(`${DEFAULT_PERIMETER.year} · весь год`);
  });

  it('сузившие оси попадают в бейдж, несузившие — нет', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'q3',
      departments: ['УО'],
      methods: ['single'],
    });
    expect(perimeterBadge(p)).toBe('2026 · 3 кв · УО · ЕП');
  });

  it('бейдж блока вне периода показывает «весь год», а не унаследованный квартал', () => {
    const p = buildPerimeter({ year: 2026, period: 'q3', ignoresPeriodFilter: true });
    expect(perimeterBadge(p)).toBe('2026 · весь год');
    expect(perimeterBadge(p)).not.toContain('3 кв');
  });

  it('незнание момента чтения видно уже в бейдже, а не только в подсказке', () => {
    const p = buildPerimeter({ year: 2026, period: 'year', readAt: null });
    expect(perimeterBadge(p)).toBe('2026 · весь год · момент чтения неизвестен');
  });
});

describe('samePerimeter — одна подпись накрывает группу чисел только по праву', () => {
  it('одинаковое состояние даёт один периметр', () => {
    const a = buildPerimeter({ year: 2026, period: 'q3', departments: ['УО'] });
    const b = buildPerimeter({ year: 2026, period: 'q3', departments: ['УО'] });
    expect(samePerimeter(a, b)).toBe(true);
  });

  it('одинаковая подпись при разной природе периода общим периметром не считается', () => {
    const real = buildPerimeter({ year: 2026, period: 'year' });
    const ignoring = buildPerimeter({ year: 2026, period: 'year', ignoresPeriodFilter: true });
    expect(perimeterLabel(real)).toBe(perimeterLabel(ignoring));
    expect(samePerimeter(real, ignoring)).toBe(false);
  });

  it('разный срез разводит периметры, даже когда остальные оси совпали', () => {
    const wide = buildPerimeter({ year: 2026, period: 'year' });
    const narrow = buildPerimeter({ year: 2026, period: 'year', methods: ['single'] });
    expect(samePerimeter(wide, narrow)).toBe(false);
  });

  it('разный момент чтения — разные числа, а не одни и те же', () => {
    const live = buildPerimeter({ year: 2026, period: 'year' });
    const archive = buildPerimeter({ year: 2026, period: 'year', asOf: '2026-08-14' });
    expect(samePerimeter(live, archive)).toBe(false);
  });
});

describe('perimeterFromFilters — вкладка отдаёт состояние, а не пересобирает оси', () => {
  it('состояние шапки без выбора даёт канонический дефолт', () => {
    const p = perimeterFromFilters({ year: 2026, period: 'year' });
    expect(perimeterLabel(p)).toBe('2026 · весь год · все управления · на сейчас');
  });

  it('при расхождении года подпись называет год ДАННЫХ, а не выбор шапки', () => {
    const p = perimeterFromFilters({
      year: 2026,
      dataYear: 2025,
      yearMismatch: true,
      period: 'year',
    });
    expect(p.year).toBe(2025);
    expect(perimeterBadge(p)).toBe('2025 · весь год');
  });

  it('без расхождения год берётся из шапки, даже когда dataYear передан', () => {
    const p = perimeterFromFilters({ year: 2026, dataYear: 2025, period: 'year' });
    expect(p.year).toBe(2026);
  });

  it('в недельном режиме месяцы период не сужают', () => {
    const p = perimeterFromFilters({
      year: 2026,
      period: 'year',
      periodMode: 'week',
      activeMonths: new Set([8]),
    });
    expect(p.span).toEqual({ kind: 'year', label: 'весь год' });
  });

  it('месяцы одного квартала читаются кварталом — как их считает расчёт', () => {
    const p = perimeterFromFilters({
      year: 2026,
      period: 'year',
      periodMode: 'explicit',
      activeMonths: new Set([7, 8, 9]),
    });
    expect(p.span.label).toBe('3 кв');
  });

  it('оси шапки доезжают до подписи все сразу', () => {
    const p = perimeterFromFilters({
      year: 2026,
      period: 'q3',
      periodMode: 'explicit',
      selectedDepartments: new Set(['УО']),
      selectedMethods: new Set(['single']),
      selectedBudgets: new Set(['mb']),
      selectedActivities: new Set(['program']),
    });
    expect(perimeterBadge(p)).toBe('2026 · 3 кв · УО · ЕП · МБ · ПМ');
  });

  it('момент чтения приезжает из lastRefreshed, а не сочиняется вкладкой', () => {
    const readAt = new Date('2026-08-20T09:12:00');
    const p = perimeterFromFilters(
      { year: 2026, period: 'year', lastRefreshed: readAt.toISOString() },
      { now: readAt.getTime() + 5 * 60_000 },
    );
    expect(p.moment.kind).toBe('live');
    expect(p.moment.iso).toBe(readAt.toISOString());
    expect(p.moment.phrase).toContain('книги прочитаны');
  });

  it('молчание сервера о моменте читается незнанием, а не свежестью (М2)', () => {
    const p = perimeterFromFilters({ year: 2026, period: 'year', lastRefreshed: null });
    expect(p.moment.kind).toBe('unknown');
    expect(perimeterBadge(p)).toContain('момент чтения неизвестен');
  });

  it('заявление карточки о неприменимой оси доезжает до пометки', () => {
    const p = perimeterFromFilters(
      { year: 2026, period: 'year', selectedMethods: new Set(['single']) },
      { notApplicable: ['methods'] },
    );
    expect(p.slice.kind).toBe('all');
    expect(perimeterConflicts(p)).toEqual(['methods']);
    expect(p.notes).toEqual(['фильтр способа закупки к этому числу не применяется']);
  });

  it('архивный срез карточки перебивает эфир состояния', () => {
    const p = perimeterFromFilters(
      { year: 2026, period: 'year', lastRefreshed: null },
      { asOf: '2026-08-14' },
    );
    expect(p.moment.kind).toBe('snapshot');
    expect(p.moment.label).toBe('срез на 14.08.2026');
  });
});

describe('perimeterHint — полная фраза подсказки', () => {
  it('называет периметр, расхождения и момент чтения — тремя строками', () => {
    const p = buildPerimeter({
      year: 2026,
      period: 'q3',
      departments: ['УО'],
      methods: ['single'],
      notApplicable: ['methods'],
      readAt: null,
    });
    const lines = perimeterHint(p).split('\n');
    expect(lines[0]).toBe('Считается за: 2026 · 3 кв · УО.');
    expect(lines[1]).toBe('Фильтр способа закупки к этому числу не применяется.');
    expect(lines[2]).toBe('Момент чтения: момент чтения книг неизвестен — сервер его не назвал.');
  });

  it('без расхождений подсказка короткая: периметр и момент', () => {
    const lines = perimeterHint(DEFAULT_PERIMETER).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Момент чтения: числа на текущее состояние книг.');
  });
});
