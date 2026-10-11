import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRows, summarize, numberCollisions } from '../src/model.mjs';
const rows = [
  {
    id: 'a',
    number: '173',
    dept: 'УО',
    year: 2026,
    month: 9,
    method: 'ЭА',
    budget: 'КБ',
    plan: 100,
    fact: 90,
    saving: 10,
    ad: true,
    subject: 'Учебники',
  },
  {
    id: 'b',
    number: '173/1',
    dept: 'УО',
    year: 2026,
    month: 10,
    method: 'ЕП',
    budget: 'МБ',
    plan: 200,
    fact: 150,
    saving: 50,
    ad: false,
    subject: 'Книги',
  },
  {
    id: 'c',
    number: '173/2',
    dept: 'УД',
    year: 2025,
    month: 9,
    method: 'ЭА',
    budget: 'КБ',
    plan: 300,
    fact: 290,
    saving: 10,
    ad: true,
    subject: 'Оборудование',
  },
];
test('отбор сохраняет составной номер и ограничивает год и управление', () =>
  assert.deepEqual(
    selectRows(rows, { year: 2026, dept: 'УО', search: '173/1' }).map((r) => r.id),
    ['b'],
  ));
test('экономия учитывает отметку AD и не подменяется разностью плана и факта', () =>
  assert.deepEqual(summarize(rows), { count: 3, plan: 600, fact: 530, saving: 20 }));
test('совпадение меток проверяется внутри книги и по полному номеру', () =>
  assert.deepEqual(
    numberCollisions([...rows, { ...rows[0], id: 'd' }, { ...rows[0], id: 'e', dept: 'УЭР' }]).map((g) =>
      g.map((r) => r.id),
    ),
    [['a', 'd']],
  ));
test('отбор учреждения не смешивает организации одного управления', () =>
  assert.deepEqual(
    selectRows(
      [
        { ...rows[0], org: 'Школа' },
        { ...rows[1], org: 'Сад' },
      ],
      { org: 'Школа' },
    ).map((r) => r.id),
    ['a'],
  ));
test('месяцы разных лет сохраняют составной отбор; пустой набор остаётся пустым', () => {
  assert.deepEqual(
    selectRows(rows, { year: 2026, periods: ['2026-10', '2025-9'] }).map((r) => r.id),
    ['b', 'c'],
  );
  assert.deepEqual(selectRows(rows, { periods: [] }), []);
});
test('несколько управлений объединяются, пустой выбор не означает все', () => {
  assert.deepEqual(
    selectRows(rows, { depts: ['УО', 'УД'] }).map((r) => r.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(selectRows(rows, { depts: [] }), []);
});
