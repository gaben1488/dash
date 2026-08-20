/**
 * Страж канона п.127 (владелец, 20.08.2026): «никакие сигналы, замечания
 * и т.д. не лезут в фильтр не к своим управлениям».
 *
 * Проверяются главные списки среза по управлению:
 *   - Контроль → Замечания (filterIssues, общий фильтр useFilteredData);
 *   - секции со своим источником: комментарии против структуры, гигиена
 *     текста, оценка управлений (общий helper filterByDeptScope);
 *   - Мониторинг: реестр процедур и сигнальные карточки книги (dept-scope).
 *
 * Два правила канона:
 *   1) в срезе управления нет ни одной записи с чужим ключом управления;
 *   2) запись без ключа управления — районная: в срезе управления скрыта,
 *      её место — срез «все управления».
 */
import { describe, expect, it } from 'vitest';
import { deptScopeOf, filterByDeptScope, inDeptScope } from './dept-isolation';
import { filterIssues } from './issues-filtering';
import { scopeProcedures, scopeSignals } from '../monitoring/dept-scope';
import { bothDeptKeyForms } from '../dept-key';
import type { MonitoringSignal, RegistryProcedure } from '../monitoring/contract';

describe('deptScopeOf / inDeptScope (ядро изоляции п.127)', () => {
  it('пустой выбор = фильтра нет: проходит всё, включая районное', () => {
    const scope = deptScopeOf([]);
    expect(scope).toBeNull();
    expect(inDeptScope(scope, 'УО')).toBe(true);
    expect(inDeptScope(scope, undefined)).toBe(true);
  });

  it('срез матчит обе формы ключа (кириллица и латиница, Б5)', () => {
    const scope = deptScopeOf(['УКСиМП']);
    expect(inDeptScope(scope, 'УКСиМП')).toBe(true);
    expect(inDeptScope(scope, 'uksimp')).toBe(true);
    expect(inDeptScope(scope, 'УО')).toBe(false);
    expect(inDeptScope(scope, 'uo')).toBe(false);
  });

  it('запись без ключа управления в срезе управления скрыта (правило 2)', () => {
    const scope = deptScopeOf(['УКСиМП']);
    expect(inDeptScope(scope, undefined)).toBe(false);
    expect(inDeptScope(scope, null)).toBe(false);
    expect(inDeptScope(scope, '')).toBe(false);
  });
});

describe('Контроль → Замечания: срез управления не содержит чужих ключей', () => {
  const mixed = [
    { title: 'своё по departmentId', departmentId: 'uksimp' },
    { title: 'чужое по departmentId', departmentId: 'uo' },
    { title: 'своё по листу', sheet: 'УКСиМП' },
    { title: 'чужое по листу', sheet: 'УО' },
    { title: 'районное на СВОД', sheet: 'СВОД ТД-ПМ' },
    { title: 'районное без привязки' },
  ];

  it('в срезе УКСиМП — только записи УКСиМП', () => {
    const out = filterIssues(mixed, {
      hasDeptFilter: true,
      selectedDeptBothForms: bothDeptKeyForms(['УКСиМП']),
      selectedSubordinates: new Set<string>(),
      normalizedSearch: '',
      selectedActivities: new Set<string>(),
    });
    expect(out.map((i: { title: string }) => i.title))
      .toEqual(['своё по departmentId', 'своё по листу']);
  });

  it('без фильтра районные записи видны — их место срез «все управления»', () => {
    const out = filterIssues(mixed, {
      hasDeptFilter: false,
      selectedDeptBothForms: new Set<string>(),
      selectedSubordinates: new Set<string>(),
      normalizedSearch: '',
      selectedActivities: new Set<string>(),
    });
    expect(out).toHaveLength(mixed.length);
  });
});

describe('Секции со своим источником: filterByDeptScope', () => {
  // Форма записей трёх секций: аннотации комментариев (dept — кириллица),
  // гигиена текста (dept — кириллица), оценка управлений (grbsId — латиница).
  const annotations = [
    { kind: 'past_promise_no_fact', dept: 'УКСиМП' },
    { kind: 'past_promise_no_fact', dept: 'УО' },
  ];
  const scorecardRows = [
    { grbsId: 'uksimp' },
    { grbsId: 'uo' },
    { grbsId: 'uer' },
  ];

  it('комментарии против структуры: в срезе УКСиМП нет карточек УО', () => {
    const scope = deptScopeOf(['УКСиМП']);
    const out = filterByDeptScope(annotations, scope, (a) => a.dept);
    expect(out).toHaveLength(1);
    expect(out[0]?.dept).toBe('УКСиМП');
  });

  it('оценка управлений: латинский ключ строки матчится кириллическим выбором шапки', () => {
    const scope = deptScopeOf(['УКСиМП']);
    const out = filterByDeptScope(scorecardRows, scope, (r) => r.grbsId);
    expect(out.map((r) => r.grbsId)).toEqual(['uksimp']);
  });

  it('без выбора управлений список не трогается', () => {
    expect(filterByDeptScope(scorecardRows, deptScopeOf([]), (r) => r.grbsId))
      .toHaveLength(3);
  });
});

describe('Мониторинг: реестр и сигналы книги в срезе управления', () => {
  const procs = [
    { dept: 'УКСиМП', sheet: '2. УКСиМП', row: 3 },
    { dept: 'УО', sheet: '8. УО', row: 7 },
  ] as unknown as RegistryProcedure[];

  const signal = (over: Partial<MonitoringSignal>): MonitoringSignal => ({
    id: 'monitoring_x',
    title: 'Сигнал',
    severity: 'medium',
    mechanism: '',
    action: '',
    count: 0,
    addresses: [],
    ...over,
  });

  it('процедуры чужих листов в срез не попадают', () => {
    const out = scopeProcedures(procs, deptScopeOf(['УКСиМП']));
    expect(out.map((p) => p.dept)).toEqual(['УКСиМП']);
  });

  it('у сигнала остаются только адреса своих листов, count пересчитан', () => {
    const s = signal({
      count: 3,
      addresses: ['2. УКСиМП!D5 — дефект', '8. УО!D34 — дефект', 'УО:412 — строка книги'],
    });
    const out = scopeSignals([s], deptScopeOf(['УКСиМП']));
    expect(out).toHaveLength(1);
    expect(out[0]?.addresses).toEqual(['2. УКСиМП!D5 — дефект']);
    expect(out[0]?.count).toBe(1);
  });

  it('сигнал уровня книги (СВОДНЫЙ, «25-26») — районный: в срезе управления скрыт', () => {
    const bookLevel = signal({ count: 1, addresses: ['СВОДНЫЙ!L10 — контроль не сходится'] });
    expect(scopeSignals([bookLevel], deptScopeOf(['УКСиМП']))).toHaveLength(0);
    // …а в срезе «все управления» — виден.
    expect(scopeSignals([bookLevel], deptScopeOf([]))).toHaveLength(1);
  });

  it('без выбора управлений сигналы не трогаются', () => {
    const s = signal({ count: 2, addresses: ['8. УО!D34', 'СВОДНЫЙ!L10'] });
    const out = scopeSignals([s], deptScopeOf([]));
    expect(out[0]?.addresses).toHaveLength(2);
  });
});
