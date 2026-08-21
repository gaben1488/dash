import { describe, expect, it } from 'vitest';
import {
  authorTally,
  bookTally,
  buildChangeStory,
  changeKindOfColumn,
  columnLabelOf,
  entriesFromBookJournal,
  entriesFromRowDiff,
  filterChangeEntries,
  foldRowEvents,
  summarizeChanges,
  type ChangeEntry,
  type ChangeStoryInput,
} from './change-story.js';
import type { JournalRecord } from '../provenance/plan-provenance.js';
import type { RowDiff } from '../analytics/vanished-rows.js';

/** Запись журнала восьмиколоночной схемы — так пишет скрипт книги. */
const rec = (
  cell: string,
  row: unknown,
  was: unknown,
  became: unknown,
  at: string,
  author = 'ivanova@aemr.ru',
): JournalRecord => ({ sheet: 'ВСЕ', cell, column: '', row, was, became, at, author });

describe('род правки по колонке — деньги, сроки, комментарии', () => {
  it('денежные колонки плана, факта и экономии — один род «деньги»', () => {
    for (const letter of ['H', 'I', 'J', 'K', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC']) {
      expect(changeKindOfColumn(letter)).toBe('money');
    }
  });

  it('даты, кварталы, годы и отклонение — «сроки»', () => {
    for (const letter of ['N', 'O', 'P', 'Q', 'R', 'S', 'T']) {
      expect(changeKindOfColumn(letter)).toBe('dates');
    }
  });

  it('три комментария, обоснование и обе причины — «комментарии»', () => {
    for (const letter of ['M', 'U', 'AE', 'AF', 'AG', 'AH']) {
      expect(changeKindOfColumn(letter)).toBe('comment');
    }
  });

  it('колонка вне канона шапки не получает выдуманного рода', () => {
    expect(changeKindOfColumn('AZ')).toBe('other');
    expect(changeKindOfColumn(null)).toBe('other');
    expect(columnLabelOf('AZ')).toBeNull();
  });

  it('имя колонки читаемо человеком, а не шифром шапки «МБ 2»', () => {
    // Дословная шапка книги здесь — канон стража column-map, но не текст для
    // читателя: «МБ 1» не говорит, что это муниципальный бюджет по плану.
    expect(columnLabelOf('J')).toBe('Муниципальный бюджет, план');
    expect(columnLabelOf('X')).toBe('Муниципальный бюджет, факт');
    expect(columnLabelOf('AC')).toBe('Экономия, итого');
    expect(columnLabelOf('N')).toBe('Плановая дата');
    // Там, где шапка и так читается, перевода нет — берётся подпись книги.
    expect(columnLabelOf('AF')).toBe('Комментарий ГРБСа');
  });
});

describe('адрес записи — по № п/п, а не по строке листа', () => {
  it('ключ журнала «№ 38 · Услуги почтовой связи» даёт № п/п и предмет', () => {
    const { entries } = entriesFromBookJournal('УО', [
      rec('J177', '№ 38 · Услуги почтовой связи', '100', '120', '14.08.2026 15:53:44'),
    ]);
    expect(entries[0].rowSeq).toBe('38');
    expect(entries[0].sheetRow).toBe(177);
    expect(entries[0].subject).toBe('Услуги почтовой связи');
  });

  it('«Х» книги остаётся значением, а не подменяется словом «пусто»', () => {
    // Живой случай (дамп УКСиМП 18.08): «Х → 15.08.2026». В деньгах «Х» —
    // отсутствие, но журнал отвечает на «что именно поменялось», и подменять
    // набранное оператором нельзя.
    const { entries } = entriesFromBookJournal('УО', [
      rec('Q10', '№ 5', 'Х', '15.08.2026', '14.08.2026 15:53:44'),
    ]);
    expect(entries[0].before).toBe('Х');
    expect(entries[0].after).toBe('15.08.2026');
  });

  it('собственный маркер пустоты скрипта журнала сводится к пустоте', () => {
    const { entries } = entriesFromBookJournal('УО', [
      rec('Q10', '№ 5', '(пусто)', '15.08.2026', '14.08.2026 15:53:44'),
    ]);
    expect(entries[0].before).toBe('');
  });

  it('шестиколоночная схема без ключа строки НЕ выводит № п/п из номера строки', () => {
    const { entries, rowKeyless } = entriesFromBookJournal('УАГЗО', [
      rec('J177', '', '100', '120', '14.08.2026 15:53:44'),
    ]);
    expect(entries[0].rowSeq).toBeNull();
    expect(entries[0].sheetRow).toBe(177);
    expect(rowKeyless).toBe(1);
  });
});

describe('свёртка: добавление закупки — одно событие, а не десять правок', () => {
  const added = Array.from({ length: 8 }, (_, i) =>
    rec(`${'CDEFGHIJ'[i]}200`, '№ 500', '', `значение ${i}`, '18.08.2026 10:15:00'));

  it('восемь заполненных ячеек одной минуты сворачиваются в «новая закупка»', () => {
    const { entries } = entriesFromBookJournal('УКСиМП', added);
    const folded = foldRowEvents(entries);
    expect(folded).toHaveLength(1);
    expect(folded[0].kind).toBe('row-added');
    expect(folded[0].rowSeq).toBe('500');
    expect(folded[0].cells).toHaveLength(8);
  });

  it('обнуление строки называется очисткой, а не удалением', () => {
    const wiped = added.map((r) => ({ ...r, was: 'было', became: '' }));
    const { entries } = entriesFromBookJournal('УКСиМП', wiped);
    expect(foldRowEvents(entries)[0].kind).toBe('row-cleared');
  });

  it('четыре ячейки — это правки, а не целая строка', () => {
    const { entries } = entriesFromBookJournal('УКСиМП', added.slice(0, 4));
    expect(foldRowEvents(entries)).toHaveLength(4);
    expect(foldRowEvents(entries).every((e) => e.kind !== 'row-added')).toBe(true);
  });

  it('правки одной строки в РАЗНЫЕ минуты не слипаются в добавление', () => {
    const spread = added.map((r, i) => ({ ...r, at: `18.08.2026 10:${10 + i}:00` }));
    const { entries } = entriesFromBookJournal('УКСиМП', spread);
    expect(foldRowEvents(entries)).toHaveLength(8);
  });
});

describe('исчезнувшие закупки приходят из сравнения снимков, а не из журнала', () => {
  const diff: RowDiff = {
    vanished: [{ rowSeq: '212', wasAtSheetRow: 240, subject: 'Ремонт кровли', subordinate: 'МБОУ школа № 3', planSum: 1200, factSum: 0 }],
    appeared: [{ rowSeq: '900', sheetRow: 500, subject: 'Поставка мебели' }],
    moved: [],
    vanishedPlanSum: 1200,
    vanishedFactSum: 0,
    unkeyed: { before: 0, after: 0 },
    note: '',
  };

  it('у исчезнувшей закупки есть адрес и предмет, но нет ни автора, ни момента', () => {
    const entries = entriesFromRowDiff('УО', diff);
    const gone = entries.find((e) => e.kind === 'row-vanished');
    expect(gone?.rowSeq).toBe('212');
    expect(gone?.subject).toBe('Ремонт кровли');
    expect(gone?.author).toBeNull();
    expect(gone?.at).toBeNull();
    expect(gone?.origin).toBe('snapshot-diff');
  });

  it('появившаяся закупка тоже попадает в рассказ', () => {
    expect(entriesFromRowDiff('УО', diff).some((e) => e.kind === 'row-added')).toBe(true);
  });
});

describe('честная пустота: «правок не было» ≠ «журнал не прочитан»', () => {
  it('прочитанный пустой журнал даёт «тихо»', () => {
    const story = buildChangeStory([{ book: 'УО', journalAvailable: true, records: [] }]);
    expect(story.digest.emptiness).toBe('quiet');
    expect(story.gaps).toHaveLength(0);
  });

  it('непрочитанный журнал даёт «неизвестно» и называет книгу по имени', () => {
    const story = buildChangeStory([{ book: 'УО', journalAvailable: false }]);
    expect(story.digest.emptiness).toBe('unknown');
    expect(story.gaps[0].reason).toBe('journal-unread');
    expect(story.gaps[0].detail).toContain('УО');
  });

  it('отсутствие прежнего снимка названо вслух — исчезнувшие не с чем сравнить', () => {
    const story = buildChangeStory([
      { book: 'УД', journalAvailable: true, records: [], snapshotComparable: false },
    ]);
    expect(story.gaps.map((g) => g.reason)).toContain('no-previous-snapshot');
  });

  it('неудаляемость строк журналом объявлена свойством, а не итогом подсчёта', () => {
    expect(buildChangeStory([]).deletionsUnobservable).toBe(true);
  });
});

describe('рассказ собирается из трёх источников в один список', () => {
  const inputs: ChangeStoryInput[] = [
    {
      book: 'УО',
      journalAvailable: true,
      records: [
        rec('J177', '№ 38 · Услуги почтовой связи', '100', '120', '20.08.2026 09:00:00', 'ivanova@aemr.ru'),
        rec('Q177', '№ 38 · Услуги почтовой связи', '', '01.09.2026', '21.08.2026 11:00:00', 'petrov@aemr.ru'),
      ],
      diff: {
        vanished: [{ rowSeq: '212', wasAtSheetRow: 240, subject: 'Ремонт кровли', planSum: 1200, factSum: 0 }],
        appeared: [], moved: [], vanishedPlanSum: 1200, vanishedFactSum: 0,
        unkeyed: { before: 0, after: 0 }, note: '',
      },
    },
    { book: 'УАГЗО', journalAvailable: false },
  ];

  const story = buildChangeStory(inputs);

  it('в своде видно число книг, закупок и родов правок', () => {
    expect(story.digest.entries).toBe(3);
    expect(story.digest.byKind.money).toBe(1);
    expect(story.digest.byKind.dates).toBe(1);
    expect(story.digest.byKind['row-vanished']).toBe(1);
    expect(story.digest.rows).toBe(2);
    expect(story.digest.books).toBe(1);
  });

  it('авторы перечислены, а книга без журнала осталась в пробелах', () => {
    expect(story.digest.authors).toEqual(['ivanova@aemr.ru', 'petrov@aemr.ru']);
    expect(story.gaps.some((g) => g.book === 'УАГЗО')).toBe(true);
  });

  it('запись без момента идёт первой, дальше свежие сверху', () => {
    expect(story.entries[0].kind).toBe('row-vanished');
    expect(story.entries[1].at).toBe('2026-08-21T11:00:00');
    expect(story.entries[2].at).toBe('2026-08-20T09:00:00');
  });
});

describe('отбор подробной глубины', () => {
  const entries: ChangeEntry[] = buildChangeStory([
    {
      book: 'УО',
      journalAvailable: true,
      records: [
        rec('J10', '№ 1 · Поставка бумаги', '10', '20', '20.08.2026 09:00:00', 'ivanova@aemr.ru'),
        rec('Q10', '№ 1 · Поставка бумаги', '', '01.09.2026', '20.08.2026 09:30:00', 'petrov@aemr.ru'),
        rec('AF11', '№ 2 · Ремонт кровли', '', 'согласовано', '19.08.2026 08:00:00', 'petrov@aemr.ru'),
      ],
    },
  ]).entries as ChangeEntry[];

  it('по роду', () => {
    expect(filterChangeEntries(entries, { kinds: ['money'] })).toHaveLength(1);
  });

  it('по автору', () => {
    expect(filterChangeEntries(entries, { authors: ['petrov@aemr.ru'] })).toHaveLength(2);
  });

  it('по книге', () => {
    expect(filterChangeEntries(entries, { books: ['УД'] })).toHaveLength(0);
  });

  it('поиск по предмету закупки', () => {
    const found = filterChangeEntries(entries, { search: 'кровл' });
    expect(found).toHaveLength(1);
    expect(found[0].rowSeq).toBe('2');
  });

  it('поиск по № п/п находит все правки закупки', () => {
    expect(filterChangeEntries(entries, { search: '1' }).length).toBeGreaterThan(0);
  });

  it('окно по времени не выбрасывает записи без момента', () => {
    const withVanished = [...entries, ...entriesFromRowDiff('УО', {
      vanished: [{ rowSeq: '99', wasAtSheetRow: 5, subject: 'Пропавшая закупка', planSum: 0, factSum: 0 }],
      appeared: [], moved: [], vanishedPlanSum: 0, vanishedFactSum: 0,
      unkeyed: { before: 0, after: 0 }, note: '',
    })];
    const far = Date.parse('2027-01-01T00:00:00Z');
    const left = filterChangeEntries(withVanished, { sinceMs: far });
    expect(left).toHaveLength(1);
    expect(left[0].kind).toBe('row-vanished');
  });

  it('счётчики по книгам и авторам — материал для чипов отбора', () => {
    expect(bookTally(entries)).toEqual([{ book: 'УО', count: 3 }]);
    expect(authorTally(entries)[0]).toEqual({ author: 'petrov@aemr.ru', count: 2 });
  });
});

describe('свод сам по себе', () => {
  it('пустой список без пробелов — это «тихо», а не «неизвестно»', () => {
    expect(summarizeChanges([], []).emptiness).toBe('quiet');
  });

  it('пустой список, где все пробелы — непрочитанные журналы, это «неизвестно»', () => {
    const digest = summarizeChanges([], [
      { book: 'УО', reason: 'journal-unread', detail: '' },
      { book: 'УД', reason: 'journal-unread', detail: '' },
    ]);
    expect(digest.emptiness).toBe('unknown');
  });
});
