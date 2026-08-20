/**
 * Тесты механизма «режим подведов» (org-scope, приказ владельца 20.08.2026).
 *
 * Проверяемые правила:
 *   1. Режим: 0 или 2+ управлений → 'district'; ровно одно → 'withSubs';
 *      то же управление в deptOnlyMode («только ГРБС») → 'grbs'.
 *   2. Ключ управления канонизируется в кириллицу (Б5: латиница со страниц).
 *   3. Разбивка строится ТОЛЬКО в 'withSubs'; аппарат — первой строкой
 *      с подписью «Аппарат управления», не сырым сентинелом.
 *   4. Честная пустота: каноничный подвед без строк остаётся в разбивке
 *      с rows: []; живой ключ вне канона добавляется, строки не теряются.
 *   5. hasSubs отвечает «есть ли подведы вообще», независимо от режима, —
 *      для честной фразы «скрыты режимом» против «подведов нет».
 */
import { describe, expect, it } from 'vitest';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { buildOrgScope, groupRowsBySubordinate, resolveOrgScopeMode } from './org-scope';
import { ORG_ITSELF_LABEL } from '../subordinate-label';

const MAP: Record<string, string[]> = {
  'УО': ['МБОУ ЕСШ № 1', 'МБДОУ Детский сад № 5'],
  'УЭР': [],
};

describe('resolveOrgScopeMode — три режима фильтра организаций', () => {
  it('пустой выбор = районный срез', () => {
    expect(resolveOrgScopeMode(new Set(), new Set())).toEqual({ mode: 'district', dept: null });
  });

  it('несколько управлений = районный срез (портрет одного строить не из чего)', () => {
    expect(resolveOrgScopeMode(new Set(['УО', 'УЭР']), new Set()).mode).toBe('district');
  });

  it('одно управление без deptOnly = «с подведомственными»', () => {
    expect(resolveOrgScopeMode(new Set(['УО']), new Set())).toEqual({ mode: 'withSubs', dept: 'УО' });
  });

  it('одно управление в deptOnlyMode = «только ГРБС»', () => {
    expect(resolveOrgScopeMode(new Set(['УО']), new Set(['УО']))).toEqual({ mode: 'grbs', dept: 'УО' });
  });

  it('латинский ключ со страницы канонизируется в кириллицу (Б5)', () => {
    const r = resolveOrgScopeMode(new Set(['uo']), new Set());
    expect(r.dept).toBe('УО');
    expect(r.mode).toBe('withSubs');
  });
});

describe('groupRowsBySubordinate — разбивка строк по колонке C', () => {
  interface Row { c: string; n: number }
  const keyOf = (r: Row) => r.c;

  it('аппарат первой строкой и с русской подписью, не сентинелом', () => {
    const groups = groupRowsBySubordinate<Row>([], keyOf, MAP['УО']);
    expect(groups[0].key).toBe(ORG_ITSELF_SENTINEL);
    expect(groups[0].label).toBe(ORG_ITSELF_LABEL);
    expect(groups[0].rows).toEqual([]);
  });

  it('каноничный подвед без строк остаётся с rows: [] — организация не пропадает', () => {
    const rows: Row[] = [{ c: 'МБОУ ЕСШ № 1', n: 1 }];
    const groups = groupRowsBySubordinate(rows, keyOf, MAP['УО']);
    const empty = groups.find((g) => g.key === 'МБДОУ Детский сад № 5');
    expect(empty).toBeDefined();
    expect(empty!.rows).toEqual([]);
    expect(groups.find((g) => g.key === 'МБОУ ЕСШ № 1')!.rows).toHaveLength(1);
  });

  it('живой ключ вне канона добавляется — строка книги не теряется', () => {
    const rows: Row[] = [{ c: 'МКУ Новая организация', n: 7 }];
    const groups = groupRowsBySubordinate(rows, keyOf, MAP['УО']);
    const live = groups.find((g) => g.key === 'МКУ Новая организация');
    expect(live).toBeDefined();
    expect(live!.rows[0].n).toBe(7);
  });

  it('строки самого управления (сентинел и плейсхолдеры колонки C) идут в аппарат', () => {
    const rows: Row[] = [
      { c: ORG_ITSELF_SENTINEL, n: 1 },
      { c: 'х', n: 2 },
      { c: '', n: 3 },
      { c: 'МБОУ ЕСШ № 1', n: 4 },
    ];
    const groups = groupRowsBySubordinate(rows, keyOf, MAP['УО']);
    expect(groups[0].rows.map((r) => r.n).sort()).toEqual([1, 2, 3]);
  });

  it('подведы отсортированы по алфавиту (ru) после аппарата', () => {
    const groups = groupRowsBySubordinate<Row>([], keyOf, ['Яблоко', 'Азбука']);
    expect(groups.map((g) => g.label)).toEqual([ORG_ITSELF_LABEL, 'Азбука', 'Яблоко']);
  });
});

describe('buildOrgScope — скоуп целиком', () => {
  it("'district': разбивки нет, dept null", () => {
    const s = buildOrgScope({
      selectedDepartments: new Set<string>(),
      deptOnlyMode: new Set<string>(),
      subordinatesMap: MAP,
    });
    expect(s.mode).toBe('district');
    expect(s.dept).toBeNull();
    expect(s.subordinates).toEqual([]);
  });

  it("'grbs': разбивка сознательно пуста, но hasSubs честно говорит, что подведы есть", () => {
    const s = buildOrgScope({
      selectedDepartments: new Set(['УО']),
      deptOnlyMode: new Set(['УО']),
      subordinatesMap: MAP,
    });
    expect(s.mode).toBe('grbs');
    expect(s.subordinates).toEqual([]);
    expect(s.hasSubs).toBe(true);
  });

  it("'withSubs' без подведов: hasSubs=false — фраза «у управления подведов нет»", () => {
    const s = buildOrgScope({
      selectedDepartments: new Set(['УЭР']),
      deptOnlyMode: new Set<string>(),
      subordinatesMap: MAP,
    });
    expect(s.mode).toBe('withSubs');
    expect(s.hasSubs).toBe(false);
    // Аппарат в разбивке присутствует всегда — самому управлению строки класть есть куда.
    expect(s.subordinates.map((g) => g.key)).toEqual([ORG_ITSELF_SENTINEL]);
  });

  it("'withSubs' со строками зоны: полная разбивка", () => {
    const rows = [
      { c: 'МБОУ ЕСШ № 1' },
      { c: 'МБОУ ЕСШ № 1' },
      { c: 'x' },
    ];
    const s = buildOrgScope({
      selectedDepartments: new Set(['УО']),
      deptOnlyMode: new Set<string>(),
      subordinatesMap: MAP,
      rows,
      keyOf: (r) => r.c,
    });
    expect(s.hasSubs).toBe(true);
    expect(s.subordinates[0].rows).toHaveLength(1); // аппарат: строка с 'x'
    expect(s.subordinates.find((g) => g.key === 'МБОУ ЕСШ № 1')!.rows).toHaveLength(2);
  });
});
