/**
 * journal.test.ts — переходящий реестр «25-26» и родословная процедур
 * (спека §1.3, §2.3).
 *
 * Ценность листа — колонка A: пятьдесят три пометки, из них девятнадцать
 * ссылаются на другой код процедуры. Это единственный источник графа
 * переобъявлений, и тест закрепляет главное: направление связи определяется
 * маркером перед кодом, а не типом строки.
 */
import { describe, expect, it } from 'vitest';
import { buildLineageChains, classifyFate, parseMonitoringJournal } from './journal.js';

/** Строка листа «25-26»: судьба, заказчик, код+предмет, НМЦК, даты, цена, победитель. */
function row(over: {
  fate?: string; customer?: string; subject?: string; nmck?: unknown;
  application?: string; publication?: string; result?: string;
  price?: unknown; savings?: unknown; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(14).fill('');
  r[0] = over.fate ?? '';
  r[1] = over.customer ?? 'УД АЕМР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[4] = over.application ?? '';
  r[5] = over.publication ?? '';
  r[7] = over.result ?? '';
  r[8] = over.price ?? '';
  r[9] = over.savings ?? '';
  r[10] = over.winner ?? '';
  return r;
}

const HEADER: unknown[][] = [new Array(14).fill('ш')];

describe('classifyFate — словарь судьбы, а не свободный текст', () => {
  it.each([
    ['2026', 'year-marker'],
    ['Новая закупка ЭА91-26', 'new-purchase'],
    ['После доработки ЭА52-26', 'after-rework'],
    ['Повторный (ЭА54-26)', 'repeat'],
    ['Отмена по решению Заказчиков. Новый ЭАС267-26', 'cancelled'],
    ['С отклонением участника', 'participant-rejected'],
    ['УФАС-жалоба', 'fas-complaint'],
    ['не прошло в казне', 'treasury'],
  ] as const)('«%s» → %s', (text, expected) => {
    expect(classifyFate(text)).toBe(expected);
  });

  it('незнакомая пометка получает честный класс «прочее», а не выбрасывается', () => {
    expect(classifyFate('какая-то пометка исполнителя')).toBe('other');
  });
});

describe('parseMonitoringJournal', () => {
  const grid: unknown[][] = [
    ...HEADER,
    row({
      fate: 'Новая закупка ЭА91-26', subject: 'ЭА52-26 Ремонт кровли', nmck: 1_000_000,
      application: '10.01.2026', publication: '15.01.2026', price: 0,
      winner: 'Не состоялся (0 заявок)',
    }),
    row({
      fate: 'После доработки ЭА52-26, новая закупка ЭА119-26',
      subject: 'ЭА91-26 Ремонт кровли', nmck: 1_000_000,
      application: '01.02.2026', publication: '05.02.2026',
      result: '20.02.2026', price: 950_000, savings: 50_000,
      winner: 'ООО «БИТ»\r\nИНН 4101100000',
    }),
    row({ subject: 'ЭА119-26 Ремонт кровли', nmck: 1_000_000, application: '01.03.2026' }),
  ];

  it('разбирает строку, включая дату подведения итогов и победителя с \\r\\n', () => {
    const journal = parseMonitoringJournal(grid);
    expect(journal.rows).toHaveLength(3);
    expect(journal.rows[1]).toMatchObject({
      sheet: '25-26', row: 3, code: 'ЭА91-26', nmck: 1_000_000, price: 950_000,
    });
    expect(journal.rows[1].resultDate?.iso).toBe('2026-02-20');
    expect(journal.rows[1].winner).toMatchObject({ inn: '4101100000', outcome: 'supplier' });
  });

  it('направление связи берётся из маркера перед кодом, а не из типа строки', () => {
    const journal = parseMonitoringJournal(grid);
    // «Новая закупка ЭА91-26» на строке ЭА52-26 → ЭА52-26 предшественница.
    expect(journal.edges).toContainEqual(expect.objectContaining({ from: 'ЭА52-26', to: 'ЭА91-26' }));
    // «После доработки ЭА52-26» на строке ЭА91-26 → та же связь, встречно.
    expect(journal.edges.some((e) => e.from === 'ЭА91-26' && e.to === 'ЭА119-26')).toBe(true);
  });

  it('собирает цепочку переобъявлений целиком', () => {
    const journal = parseMonitoringJournal(grid);
    const chain = journal.chains.find((c) => c.codes.length === 3);
    expect(chain?.codes).toEqual(['ЭА52-26', 'ЭА91-26', 'ЭА119-26']);
  });

  it('строки ниже области автофильтра книги помечаются, а не прячутся', () => {
    const long: unknown[][] = [...HEADER];
    for (let i = 0; i < 380; i++) {
      long.push(row({ subject: `ЭА${i + 1}-26 Позиция`, nmck: 1_000 }));
    }
    const journal = parseMonitoringJournal(long);
    expect(journal.outsideFilterCount).toBeGreaterThan(0);
    expect(journal.rows.at(-1)?.outsideBookFilter).toBe(true);
  });

  it('скрытость строки без сведений источника — null («не знаем»), а не false', () => {
    const journal = parseMonitoringJournal(grid);
    expect(journal.rows[0].hiddenInBook).toBeNull();
    const withHidden = parseMonitoringJournal(grid, { hiddenRows: [2] });
    expect(withHidden.rows[0].hiddenInBook).toBe(true);
    expect(withHidden.rows[1].hiddenInBook).toBe(false);
  });

  it('лист не прочитан — пустой разбор, а не выдуманные строки', () => {
    expect(parseMonitoringJournal(undefined).rows).toEqual([]);
  });
});

describe('buildLineageChains', () => {
  it('взаимная ссылка двух процедур не даёт бесконечной цепочки', () => {
    const chains = buildLineageChains([
      { from: 'ЭА54-26', to: 'ЭА214-26', sourceRow: 10, sourceText: 'Повторный аукцион ЭА214-26' },
      { from: 'ЭА214-26', to: 'ЭА54-26', sourceRow: 20, sourceText: 'Повторный (ЭА54-26)' },
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].codes).toEqual(['ЭА54-26', 'ЭА214-26']);
  });

  it('две отменённые процедуры, сошедшиеся в одну новую, дают две цепочки', () => {
    const chains = buildLineageChains([
      { from: 'ЭА21-26', to: 'ЭА102-26', sourceRow: 5, sourceText: 'Новая закупка ЭА102-26' },
      { from: 'ЭА66-26', to: 'ЭА102-26', sourceRow: 6, sourceText: 'Новая закупка ЭА102-26' },
    ]);
    expect(chains.map((c) => c.codes)).toEqual([['ЭА21-26', 'ЭА102-26'], ['ЭА66-26', 'ЭА102-26']]);
  });
});
