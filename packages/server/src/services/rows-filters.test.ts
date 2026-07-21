/**
 * Характеризация rows-filters.ts (E11-2 rethink, 2026-07-21).
 * Инвариант каждого фильтра: пустой параметр = всё проходит.
 */
import { describe, expect, it } from 'vitest';
import {
  applyActivityFilter,
  applySearchFilter,
  applyStateFilter,
  applySubordinateFilter,
  applyTypeFilter,
  applyYearFilter,
  paginateRows,
  parseYearFilter,
  sortRows,
  type FilterableRow,
} from './rows-filters.js';

function row(partial: Partial<FilterableRow>): FilterableRow {
  return {
    subject: '', method: '', status: '', regNumber: '', subordinate: '',
    type: '', programName: '', state: 'open', planYear: 0,
    ...partial,
  };
}

describe('parseYearFilter', () => {
  it('пусто и "all" → фильтр выключен', () => {
    expect(parseYearFilter(undefined)).toBeUndefined();
    expect(parseYearFilter('')).toBeUndefined();
    expect(parseYearFilter('all')).toBeUndefined();
  });

  it('валидный год в [2020..2100] → число', () => {
    expect(parseYearFilter('2026')).toBe(2026);
  });

  it('мусор и вне диапазона → фильтр выключен', () => {
    expect(parseYearFilter('abc')).toBeUndefined();
    expect(parseYearFilter('1999')).toBeUndefined();
    expect(parseYearFilter('2101')).toBeUndefined();
  });
});

describe('applySearchFilter', () => {
  const rows = [
    row({ subject: 'Поставка Бумаги' }),
    row({ method: 'ЭА', regNumber: 'РН-777' }),
    row({ status: 'Подписан' }),
    row({ subordinate: 'МКУ Спорт' }),
  ];

  it('пустой запрос → всё', () => {
    expect(applySearchFilter(rows, '')).toEqual(rows);
  });

  it('ищет по предмету/статусу/реестровому/подведу без учёта регистра', () => {
    expect(applySearchFilter(rows, 'бумаги')).toEqual([rows[0]]);
    expect(applySearchFilter(rows, 'рн-777')).toEqual([rows[1]]);
    expect(applySearchFilter(rows, 'подписан')).toEqual([rows[2]]);
    expect(applySearchFilter(rows, 'спорт')).toEqual([rows[3]]);
    expect(applySearchFilter(rows, 'ничего')).toEqual([]);
  });
});

describe('applyTypeFilter', () => {
  const ea = row({ method: 'ЭА' });
  const ezk = row({ method: 'эзк' });
  const ep = row({ method: 'ЕП' });
  const rows = [ea, ezk, ep];

  it('пустой тип → всё', () => {
    expect(applyTypeFilter(rows, '')).toEqual(rows);
  });

  it('competitive/КП → ЭА, ЭК, ЭЗК (без учёта регистра)', () => {
    expect(applyTypeFilter(rows, 'competitive')).toEqual([ea, ezk]);
    expect(applyTypeFilter(rows, 'КП')).toEqual([ea, ezk]);
  });

  it('single/ЕП → только ЕП', () => {
    expect(applyTypeFilter(rows, 'single')).toEqual([ep]);
    expect(applyTypeFilter(rows, 'ЕП')).toEqual([ep]);
  });
});

describe('applySubordinateFilter', () => {
  const mku = row({ subordinate: 'МКУ Спортивная школа' });
  const empty = row({ subordinate: '' });
  const selfRef = row({ subordinate: 'Х' });
  const selfRefLat = row({ subordinate: 'x' });
  const rows = [mku, empty, selfRef, selfRefLat];

  it('пустой фильтр → всё', () => {
    expect(applySubordinateFilter(rows, '')).toEqual(rows);
  });

  it('имя подведа матчится подстрокой (lower-case)', () => {
    expect(applySubordinateFilter(rows, 'спортивная')).toEqual([mku]);
  });

  it('_org_itself → пустая C и самоссылка Х/X (Аппарат управления)', () => {
    expect(applySubordinateFilter(rows, '_org_itself')).toEqual([empty, selfRef, selfRefLat]);
  });

  it('список через запятую: имя + _org_itself объединяются', () => {
    expect(applySubordinateFilter(rows, 'спортивная,_org_itself')).toEqual(rows);
  });
});

describe('applyActivityFilter', () => {
  const pm = row({ type: 'Программное мероприятие', programName: 'МП «Развитие»' });
  const tdInPm = row({ type: 'Текущая деятельность', programName: 'МП «Развитие»' });
  const tdNoPm = row({ type: 'Текущая деятельность', programName: 'Х' });
  const tdEmptyPm = row({ type: 'Текущая деятельность', programName: '' });
  const rows = [pm, tdInPm, tdNoPm, tdEmptyPm];

  it('пустой фильтр → всё', () => {
    expect(applyActivityFilter(rows, '')).toEqual(rows);
  });

  it('program → только программные мероприятия', () => {
    expect(applyActivityFilter(rows, 'program')).toEqual([pm]);
  });

  it('current_program → ТД с реальным текстом программы в D', () => {
    expect(applyActivityFilter(rows, 'current_program')).toEqual([tdInPm]);
  });

  it('current_non_program → ТД с X/х/пустым D', () => {
    expect(applyActivityFilter(rows, 'current_non_program')).toEqual([tdNoPm, tdEmptyPm]);
  });

  it('прочее значение → substring по виду деятельности', () => {
    expect(applyActivityFilter(rows, 'текущая')).toEqual([tdInPm, tdNoPm, tdEmptyPm]);
  });
});

describe('applyStateFilter', () => {
  const signed = row({ state: 'signed' });
  const open = row({ state: 'open' });

  it('пустой фильтр → всё; иначе точное совпадение state', () => {
    expect(applyStateFilter([signed, open], '')).toEqual([signed, open]);
    expect(applyStateFilter([signed, open], 'signed')).toEqual([signed]);
  });
});

describe('applyYearFilter', () => {
  const y2025 = row({ planYear: 2025 });
  const y2026 = row({ planYear: 2026 });
  const noYear = row({ planYear: 0 });

  it('undefined → всё', () => {
    expect(applyYearFilter([y2025, y2026, noYear], undefined)).toEqual([y2025, y2026, noYear]);
  });

  it('строки без года (planYear=0) остаются видимыми при любом годе', () => {
    expect(applyYearFilter([y2025, y2026, noYear], 2026)).toEqual([y2026, noYear]);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'бета', sum: 30 },
    { name: 'Альфа', sum: 10 },
    { name: 'вега', sum: 20 },
  ];

  it('пустая колонка → порядок не меняется', () => {
    expect(sortRows(rows, '', 'asc')).toEqual(rows);
  });

  it('числа — численно, asc и desc', () => {
    expect(sortRows(rows, 'sum', 'asc').map(r => r.sum)).toEqual([10, 20, 30]);
    expect(sortRows(rows, 'sum', 'desc').map(r => r.sum)).toEqual([30, 20, 10]);
  });

  it('строки — русской локалью, без мутации исходного массива', () => {
    const sorted = sortRows(rows, 'name', 'asc');
    expect(sorted.map(r => r.name)).toEqual(['Альфа', 'бета', 'вега']);
    expect(rows[0].name).toBe('бета');
  });
});

describe('paginateRows', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];

  it('срез страницы + total/totalPages', () => {
    expect(paginateRows(rows, 1, 2)).toEqual({ pageRows: ['a', 'b'], total: 5, totalPages: 3 });
    expect(paginateRows(rows, 3, 2)).toEqual({ pageRows: ['e'], total: 5, totalPages: 3 });
  });

  it('страница за пределами → пустой срез, счётчики честные', () => {
    expect(paginateRows(rows, 9, 2)).toEqual({ pageRows: [], total: 5, totalPages: 3 });
    expect(paginateRows([], 1, 10)).toEqual({ pageRows: [], total: 0, totalPages: 0 });
  });
});
