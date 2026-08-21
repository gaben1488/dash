import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY, SIGNAL_LABELS } from '@aemr/shared';
import {
  ALL_SIGNAL_KEYS,
  SIGNAL_SEVERITY,
  UNREACHABLE_SIGNAL_KEYS,
  activityRowLabel,
  countBySeverity,
  countUncheckedByPeriod,
  describeRegistryCounts,
  describeUncheckedByPeriod,
  epRiskSeverity,
  featureSignals,
  isStateSignal,
  requestFilterNames,
  screenFilterNames,
  signalChipText,
  signalHint,
  signalOccurrences,
  signalPassport,
  signalSeverity,
  stateSignals,
} from './registry-view';

describe('словарь признаков', () => {
  it('покрывает тяжестью каждый признак словаря продукта', () => {
    const missing = Object.keys(SIGNAL_LABELS).filter((key) => !(key in SIGNAL_SEVERITY));
    expect(missing).toEqual([]);
  });

  it('не выдумывает признаков, которых нет в словаре', () => {
    const extra = Object.keys(SIGNAL_SEVERITY).filter((key) => !(key in SIGNAL_LABELS));
    expect(extra).toEqual([]);
  });

  it('незнакомый признак получает серый чип, а не тишину', () => {
    expect(signalSeverity('какой-то-новый')).toBe('gap');
  });

  it('подпись признака берётся из словаря', () => {
    expect(signalChipText('overdue').text).toBe(SIGNAL_LABELS.overdue);
  });

  it('чип известного признака несёт механизм и действие (п.53)', () => {
    const chip = signalChipText('planYearMissing');
    const passport = signalPassport('planYearMissing');
    expect(passport).not.toBeNull();
    expect(chip.hint).toContain(passport!.description);
    expect(chip.hint).toContain('Что сделать:');
    expect(chip.hint).toContain(passport!.recommendation);
  });

  it('состояние строки не требует действия, а называет себя состоянием', () => {
    const hint = signalHint('signed');
    expect(hint).toContain('состояние строки');
    expect(hint).not.toContain('Что сделать:');
  });

  it('признак без паспорта говорит об этом прямо, а не молчит', () => {
    expect(signalPassport('planSoon')).toBeNull();
    expect(signalHint('planSoon')).toContain('паспорт проверки в реестре ещё не заведён');
  });

  it('ЕП-риск не подхватывает чужой паспорт по полю legacyId', () => {
    const passport = signalPassport('epRisk');
    expect(passport).not.toBeNull();
    expect(passport!.description).not.toContain('инициатив');
  });

  it('признаки-стадии берут паспорт по переводу имени, а не остаются немыми', () => {
    for (const key of ['factWithoutDate', 'initiativeRequest', 'foreignYearExecution']) {
      expect(signalPassport(key), key).not.toBeNull();
    }
  });

  it('неописанный признак не показывает пользователю служебное имя', () => {
    const chip = signalChipText('brandNewSignal');
    expect(chip.text).toBe('Признак без описания');
    expect(chip.text).not.toContain('brandNewSignal');
    expect(chip.hint).toContain('brandNewSignal');
  });
});

describe('счёт строк по тяжести', () => {
  it('считает строку один раз — по худшему признаку', () => {
    const rows = [
      { signals: ['overdue', 'planSoon'] },
      { signals: ['planSoon'] },
      { signals: ['signed'] },
      { signals: [] },
    ];
    expect(countBySeverity(rows)).toEqual({ critical: 1, warning: 1 });
  });

  it('пустой список даёт нули, а не пропуски', () => {
    expect(countBySeverity([])).toEqual({ critical: 0, warning: 0 });
  });
});

describe('двухступенчатый счёт строк', () => {
  it('не выдаёт загруженную часть за весь реестр: ступени названы по отдельности', () => {
    const text = describeRegistryCounts({
      shown: 25,
      inSelection: 128,
      loaded: 168,
      screenFilters: ['квартал', 'поиск по тексту'],
      requestFilters: ['год 2026', 'управления (2)'],
    });
    expect(text.shown).toBe('Показано 25 строк из 128');
    expect(text.hiddenOnScreen).toBe('На экране скрыто 40 строк фильтрами: квартал, поиск по тексту');
    expect(text.loaded).toBe('Загружено 168 строк по запросу с фильтрами: год 2026, управления (2)');
  });

  it('без фильтров экрана молчит про скрытое', () => {
    const text = describeRegistryCounts({
      shown: 25,
      inSelection: 168,
      loaded: 168,
      screenFilters: [],
      requestFilters: [],
    });
    expect(text.hiddenOnScreen).toBeNull();
    expect(text.loaded).toBe('Загружено 168 строк — весь реестр выбранных управлений');
  });

  it('склоняет «строка» по числу', () => {
    const one = describeRegistryCounts({
      shown: 1,
      inSelection: 1,
      loaded: 21,
      screenFilters: ['поиск по тексту'],
      requestFilters: [],
    });
    expect(one.shown).toBe('Показано 1 строка из 1');
    expect(one.hiddenOnScreen).toBe('На экране скрыто 20 строк фильтрами: поиск по тексту');
  });
});

describe('строки без даты и года', () => {
  const rows = [
    { planDate: '2026-03-14', planYear: 2026 },
    { planDate: null, factDate: null, planYear: 2026 },
    { planDate: '', factDate: '', planYear: 0 },
    { planDate: 'X', planYear: 0 },
  ];

  it('считает строки, которых фильтр периода не касался', () => {
    expect(countUncheckedByPeriod(rows)).toEqual({ noDate: 3, noYear: 2 });
  });

  it('говорит о них вслух, когда период выбран', () => {
    const text = describeUncheckedByPeriod({ noDate: 3, noYear: 2 }, { period: true, year: true });
    expect(text).toContain('3 без даты плана и факта');
    expect(text).toContain('2 без года плана');
  });

  it('молчит, когда период не выбран — оговорка была бы шумом', () => {
    expect(describeUncheckedByPeriod({ noDate: 3, noYear: 2 }, { period: false, year: false })).toBeNull();
  });

  it('называет только ту дыру, чей фильтр включён', () => {
    const text = describeUncheckedByPeriod({ noDate: 3, noYear: 2 }, { period: false, year: true });
    expect(text).not.toContain('без даты');
    expect(text).toContain('2 без года плана');
  });
});

describe('названия действующих фильтров', () => {
  it('перечисляет фильтры запроса по-русски, без служебных ключей', () => {
    const names = requestFilterNames({
      departments: 2,
      subordinates: 0,
      activity: 'current_non_program',
      procurement: 'single',
      year: 2026,
    });
    expect(names).toEqual([
      'год 2026',
      'управления (2)',
      // Канон п.30: подкатегорий ТД нет — подпись фильтра просто «ТД».
      'текущая деятельность',
      'единственный поставщик',
    ]);
    expect(names.join(' ')).not.toMatch(/[a-z]/i);
  });

  it('снятые фильтры не называет', () => {
    expect(
      requestFilterNames({ departments: 0, subordinates: 0, activity: 'all', procurement: 'all', year: 'all' }),
    ).toEqual([]);
  });

  it('перечисляет фильтры экрана', () => {
    expect(
      screenFilterNames({ period: 'q2', months: 2, search: '  ремонт ', signals: 3, budgets: 1 }),
    ).toEqual(['квартал', 'месяцы', 'поиск по тексту', 'признаки строк (3)', 'источники финансирования']);
  });

  it('пробелы в поиске за фильтр не считает', () => {
    expect(screenFilterNames({ period: 'year', months: 0, search: '   ', signals: 0, budgets: 0 })).toEqual([]);
  });
});

describe('подпись вида деятельности строки', () => {
  it('называет программное мероприятие', () => {
    expect(activityRowLabel('Программное мероприятие')).toBe('программные мероприятия');
  });

  it('канон п.30: ТД подписывается одинаково при любой графе программы', () => {
    // Срез «ТД-ПМ» упразднён: подпись «в рамках/вне программ» делила бы ТД
    // на подкатегории, которых в системе больше нет.
    expect(activityRowLabel('Текущая деятельность', 'Развитие образования')).toBe('текущая деятельность');
    expect(activityRowLabel('Текущая деятельность', 'X')).toBe('текущая деятельность');
  });

  it('не зачисляет строку без вида деятельности в программные', () => {
    expect(activityRowLabel('')).toBe('вид деятельности не указан');
    expect(activityRowLabel(null)).toBe('вид деятельности не указан');
  });
});

describe('сколько строк найдётся по признаку', () => {
  it('считает вхождения признаков', () => {
    const counts = signalOccurrences([
      { signals: ['overdue', 'planSoon'] },
      { signals: ['overdue'] },
      { signals: [] },
      {},
    ]);
    expect(counts).toEqual({ overdue: 2, planSoon: 1 });
  });
});

// ────────────────────────────────────────────────────────────
// Консолидация сигналов — решения владельца п.137 от 21.08.2026.
// Здесь стережётся ОДНА вещь: чип на экране и паспорт проверки говорят о
// строгости одно и то же. Разошедшись, они и породили спор родов — читатель
// двух вкладок получал противоположные оценки одной строки.
// ────────────────────────────────────────────────────────────

describe('строгость чипа против паспорта проверки (п.137)', () => {
  const passport = (id: string) => CHECK_REGISTRY.find((c) => c.id === id)!;

  it('п.137(6): «факт раньше плановой даты» — справка и в чипе, и в паспорте', () => {
    // Канон п.28 сказал «это не ошибка», паспорт понизили, а чип остался
    // жёлтым: предупреждение стояло там, где карточка обещала справку.
    expect(signalSeverity('factDateBeforePlan')).toBe('info');
    expect(passport('fact_date_before_plan').severity).toBe('info');
  });

  it('п.137(10): «обоснование ЕП вне справочника» — справка, а не претензия', () => {
    expect(signalSeverity('unmappedReasonEP')).toBe('info');
    expect(passport('unmapped_reason_ep').severity).toBe('info');
  });

  it('п.137(4) и (3): новые признаки информационные', () => {
    expect(signalSeverity('foreignYearExecution')).toBe('info');
    expect(signalSeverity('initiativeRequest')).toBe('info');
  });

  it('п.137(2): ЕП-риск красится по обоснованию строки, а не по ключу', () => {
    // Монополист красным не горит: из 76 строк класса у 60 соседняя вкладка
    // держала наготове оправдание, и красный чип обесценивал остальные.
    expect(epRiskSeverity('Единственный поставщик тепловой энергии, естественная монополия'))
      .toBe('info');
    expect(epRiskSeverity('Проведение аукциона нецелесообразно')).toBe('critical');
    expect(epRiskSeverity('')).toBe('critical');
  });

  it('п.137(2): счёт критических строк судит той же развилкой, что и чип', () => {
    // Если счётчик и чип разойдутся, полоса «столько-то критических» перестанет
    // сходиться с тем, что видно глазами в таблице.
    const rows = [
      { signals: ['epRisk'], epReason: 'Единственный поставщик тепловой энергии, естественная монополия' },
      { signals: ['epRisk'], epReason: 'Нецелесообразно проводить аукцион' },
    ];
    expect(countBySeverity(rows)).toEqual({ critical: 1, warning: 0 });
  });
});

describe('колонка признаков против колонки состояния (§3.4 спеки)', () => {
  it('благополучные состояния не стоят в колонке замечаний', () => {
    // Строк, у которых в колонке стояли ТОЛЬКО благополучные чипы, — 2 461:
    // читатель видел заполненную колонку замечаний там, где замечаний ноль.
    expect(featureSignals(['signed', 'hasFact', 'economyFlag'])).toEqual([]);
    expect(stateSignals(['signed', 'hasFact', 'overdue'])).toEqual(['signed', 'hasFact']);
  });

  it('находки из колонки признаков никуда не деваются', () => {
    expect(featureSignals(['overdue', 'signed', 'epRisk'])).toEqual(['overdue', 'epRisk']);
  });

  it('«есть факт» больше не спорит с бейджем стадии', () => {
    // Канон п.71б завёл бейдж стадии ИМЕНО вместо «лживого есть факт»;
    // заменить не вышло, их стало двое. После разделения колонок остаётся один.
    expect(isStateSignal('hasFact')).toBe(true);
    expect(isStateSignal('factWithoutDate')).toBe(false);
  });
});

describe('недостижимые признаки в списке отбора', () => {
  it('«задержка финансирования» не предлагается: расчёт её не выставляет', () => {
    // В ядре она присвоена false навсегда (signals.ts), и строка «— 0» в
    // списке обещала отбор, которого не будет.
    expect(ALL_SIGNAL_KEYS).not.toContain('financeDelay');
  });

  it('но имя её остаётся в словаре — старые снимки её несут', () => {
    expect(SIGNAL_LABELS).toHaveProperty('financeDelay');
    expect(signalChipText('financeDelay').text).not.toBe('financeDelay');
  });

  it('всё остальное словаря отбирать по-прежнему можно', () => {
    const lost = Object.keys(SIGNAL_LABELS)
      .filter((key) => !UNREACHABLE_SIGNAL_KEYS.includes(key))
      .filter((key) => !ALL_SIGNAL_KEYS.includes(key));
    expect(lost).toEqual([]);
  });
});
