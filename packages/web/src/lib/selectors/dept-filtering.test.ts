import { describe, expect, it } from 'vitest';
import { filterDeptsByDepartments, filterDeptsBySearch, markDeptOnlyMode } from './dept-filtering';

const uer = { department: { id: 'uer', nameShort: 'УЭР', name: 'Управление экономического развития' } };
const uio = { department: { id: 'uio', nameShort: 'УИО', name: 'Управление имущественных отношений' } };
const depts = [uer, uio];

describe('filterDeptsByDepartments (извлечено из useFilteredData §1)', () => {
  it('фильтр пуст — все проходят', () => {
    expect(filterDeptsByDepartments(depts, new Set())).toBe(depts);
  });

  it('матчит по кириллическому nameShort', () => {
    expect(filterDeptsByDepartments(depts, new Set(['УЭР']))).toEqual([uer]);
  });

  it('матчит по латинскому id (двухформенность до канонизации)', () => {
    expect(filterDeptsByDepartments(depts, new Set(['uio']))).toEqual([uio]);
  });

  it('чужой ключ — пусто', () => {
    expect(filterDeptsByDepartments(depts, new Set(['нет-такого']))).toEqual([]);
  });
});

describe('markDeptOnlyMode (извлечено из useFilteredData §2b)', () => {
  it('режим пуст — депты не тронуты', () => {
    expect(markDeptOnlyMode(depts, new Set())).toBe(depts);
  });

  it('помечает _deptOnly только выбранные, остальные — те же объекты', () => {
    const out = markDeptOnlyMode(depts, new Set(['УЭР']));
    expect(out[0]).toMatchObject({ _deptOnly: true });
    expect(out[0]).not.toBe(uer); // копия, оригинал не мутирован
    expect((uer as any)._deptOnly).toBeUndefined();
    expect(out[1]).toBe(uio);
  });
});

describe('filterDeptsBySearch (извлечено из useFilteredData §3)', () => {
  it('пустой запрос — все проходят', () => {
    expect(filterDeptsBySearch(depts, '')).toBe(depts);
  });

  it('ищет по name / nameShort / id (запрос уже нормализован)', () => {
    expect(filterDeptsBySearch(depts, 'уэр')).toEqual([uer]);
    expect(filterDeptsBySearch(depts, 'uio')).toEqual([uio]);
    expect(filterDeptsBySearch(depts, 'имуществен')).toEqual([uio]);
    expect(filterDeptsBySearch(depts, 'ничего')).toEqual([]);
  });
});
