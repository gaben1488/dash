import { describe, expect, it } from 'vitest';
import { summarizeChanges, type ChangeEntry, type ChangeGap } from '@aemr/core';
import {
  DELETION_NOTE,
  digestAuthorsLine,
  digestHeadline,
  digestKindLine,
  digestLines,
  digestWhenLine,
  emptinessLine,
  entryAddress,
  entryChangeLine,
  entryWhoWhen,
  shortDate,
  shownLine,
  valueLabel,
} from './change-story-text';

const entry = (over: Partial<ChangeEntry>): ChangeEntry => ({
  id: 'x', book: 'УО', sheet: 'ВСЕ', rowSeq: '38', sheetRow: 177,
  column: 'K', columnLabel: 'ИТОГО 1', kind: 'money',
  before: '100', after: '120', author: 'ivanova@aemr.ru',
  at: '2026-08-20T09:00:00', atMs: Date.parse('2026-08-20T09:00:00Z'),
  subject: 'Услуги почтовой связи', subordinate: null, origin: 'book-journal',
  ...over,
});

describe('краткая глубина — четыре фразы одним взглядом', () => {
  const digest = summarizeChanges([
    entry({ id: '1' }),
    entry({ id: '2', kind: 'dates', column: 'Q', columnLabel: 'Фактический', author: 'petrov@aemr.ru', at: '2026-08-21T11:00:00' }),
    entry({ id: '3', kind: 'row-vanished', rowSeq: '212', at: null, atMs: null, author: null, origin: 'snapshot-diff' }),
  ], []);

  it('первая фраза называет книгу, число правок и число закупок', () => {
    expect(digestHeadline(digest)).toBe('3 правки в книге УО, затронуто 2 закупки');
  });

  it('вторая фраза называет роды правок и не проговаривает нули', () => {
    const line = digestKindLine(digest);
    expect(line).toContain('исчезнувших закупок — 1');
    expect(line).toContain('деньги — 1');
    expect(line).toContain('сроки — 1');
    expect(line).not.toContain('комментарии');
  });

  it('третья фраза называет тех, кто правил', () => {
    expect(digestAuthorsLine(digest)).toBe('правили ivanova@aemr.ru, petrov@aemr.ru');
  });

  it('четвёртая фраза называет окно по датам книги', () => {
    expect(digestWhenLine(digest)).toBe('с 20.08 по 21.08');
  });

  it('фраз ровно столько, сколько есть содержания', () => {
    expect(digestLines(digest)).toHaveLength(4);
  });

  it('много авторов сводятся к счёту, чтобы строка читалась', () => {
    const many = summarizeChanges(
      ['a', 'b', 'c', 'd', 'e'].map((a, i) => entry({ id: String(i), author: `${a}@aemr.ru` })),
      [],
    );
    expect(digestAuthorsLine(many)).toBe('правили 5 человек');
  });
});

describe('честная пустота', () => {
  it('прочитанный пустой журнал — «правок не было»', () => {
    const digest = summarizeChanges([], []);
    expect(digestHeadline(digest)).toBe('Правок не было');
    expect(emptinessLine(digest, [])).toContain('прочитаны, правок в выбранном окне нет');
  });

  it('непрочитанный журнал — другая фраза, и книги названы по именам', () => {
    const gaps: ChangeGap[] = [
      { book: 'УО', reason: 'journal-unread', detail: '' },
      { book: 'УД', reason: 'journal-unread', detail: '' },
    ];
    const digest = summarizeChanges([], gaps);
    expect(digestHeadline(digest)).toBe('О правках ничего не известно');
    const line = emptinessLine(digest, gaps) ?? '';
    expect(line).toContain('УО, УД');
    expect(line).toContain('не «правок не было»');
  });

  it('при наличии записей объяснять пустоту нечего', () => {
    expect(emptinessLine(summarizeChanges([entry({})], []), [])).toBeNull();
  });

  it('граница источника произносится вслух отдельной фразой', () => {
    expect(DELETION_NOTE).toContain('Удаление строки книга не записывает');
    expect(DELETION_NOTE).toContain('№ п/п');
  });
});

describe('подробная глубина — адрес и суть правки', () => {
  it('адрес ведёт № п/п, а не номер строки листа', () => {
    expect(entryAddress(entry({}))).toBe('УО · № п/п 38 · ИТОГО 1');
  });

  it('запись без № п/п честно говорит, что ключа нет, а не подставляет строку листа', () => {
    const a = entryAddress(entry({ rowSeq: null }));
    expect(a).toContain('строка листа 177');
    expect(a).toContain('журнал не назвал');
  });

  it('лист называется, если он не общий', () => {
    expect(entryAddress(entry({ sheet: 'УФБП' }))).toContain('лист УФБП');
  });

  it('правка ячейки читается как «было → стало», пустота названа словом', () => {
    expect(entryChangeLine(entry({}))).toBe('100 → 120');
    expect(entryChangeLine(entry({ before: '', after: '01.09.2026' }))).toBe('пусто → 01.09.2026');
    expect(valueLabel('  ')).toBe('пусто');
  });

  it('события целой строки говорятся своими словами, а не шаблоном «было → стало»', () => {
    expect(entryChangeLine(entry({ kind: 'row-added', subject: 'Поставка мебели' })))
      .toBe('Появилась новая закупка: Поставка мебели');
    expect(entryChangeLine(entry({ kind: 'row-vanished', subject: 'Ремонт кровли' })))
      .toBe('Закупка исчезла: Ремонт кровли');
    // Очистка — НЕ удаление: строка осталась в книге.
    expect(entryChangeLine(entry({ kind: 'row-cleared' }))).toContain('осталась');
  });

  it('автор и момент: незнание называется, а не заполняется', () => {
    expect(entryWhoWhen(entry({}))).toBe('ivanova@aemr.ru · 20.08 09:00');
    expect(entryWhoWhen(entry({ author: null }))).toContain('автор источником не назван');
    expect(entryWhoWhen(entry({ at: null, origin: 'snapshot-diff' })))
      .toContain('пропажа найдена сравнением снимков');
  });

  it('обрезанный список говорит, сколько всего', () => {
    expect(shownLine(400, 1200)).toBe('показаны 400 из 1200 правок');
    expect(shownLine(3, 3)).toBe('3 правки');
    expect(shownLine(0, 0)).toBe('Показывать нечего');
  });

  it('дата подписи книги режется до дня без выдумки про пояс', () => {
    expect(shortDate('2026-08-20T09:00:00')).toBe('20.08');
    expect(shortDate(null)).toBeNull();
  });
});
