/**
 * Тесты связки книга ГРБС ↔ «Ежедневный мониторинг» по номеру процедуры
 * (канон п.74). Все значения — живые: ячейки AG из дампа comments-full.jsonl
 * и строки колонки C мониторинга из дампа monitoring-full.jsonl (14.08.2026).
 */
import { describe, it, expect } from 'vitest';
import { buildProcedureIndex, linkRowsToProcedures } from './procedure-link.js';

/**
 * Живые значения колонки C мониторинга (код + предмет одной строкой),
 * включая искажённый «А427-25» (УД!20) — код с потерянной «Э».
 */
const MONITORING_CELLS = [
  'ЭА152-26 Выполнение работ по ремонту помещений',
  'ЭЗК426-25 Поставка брендированных шатров и тентовых конструкций',
  'ЭЕП180-26 Поставка оборудования',
  'ЭАС258-26 Поставка продуктов питания (совместный аукцион)',
  'ЭА220-26 Поставка серверного оборудования',
  'А427-25 Выполнение работ', // искажение: потеряна «Э» — кода в индексе НЕ будет
  'ЭЗК-120-26 Поставка материалов', // искажение: дефис после префикса
];

describe('buildProcedureIndex — индекс кодов мониторинга', () => {
  it('канонизирует валидные коды и НЕ чинит искажённые', () => {
    const index = buildProcedureIndex(MONITORING_CELLS);
    expect(index).toEqual(new Set([
      'ЭА152-26', 'ЭЗК426-25', 'ЭЕП180-26', 'ЭАС258-26', 'ЭА220-26',
    ]));
    // искажённые «А427-25» и «ЭЗК-120-26» в индекс не попали
    expect(index.has('ЭА427-25')).toBe(false);
    expect(index.has('ЭЗК120-26')).toBe(false);
  });
});

describe('linkRowsToProcedures — связка по коду AG', () => {
  const index = buildProcedureIndex(MONITORING_CELLS);

  it('связывает живые строки книги, нормализуя пробелы и регистр', () => {
    const links = linkRowsToProcedures(
      [
        { rowKey: 'УЭР:30', ag: 'ЭА152-26' },
        { rowKey: 'УЭР:5', ag: 'ЭЗК426-25' },
        { rowKey: 'УЭР:33', ag: 'ЭЕП 180-26' }, // живой пробел внутри кода
        { rowKey: 'УЭР:42', ag: 'ЭАС258-26' },
      ],
      index,
    );
    expect(links).toEqual([
      { rowKey: 'УЭР:30', code: 'ЭА152-26', matched: true },
      { rowKey: 'УЭР:5', code: 'ЭЗК426-25', matched: true },
      { rowKey: 'УЭР:33', code: 'ЭЕП180-26', matched: true },
      { rowKey: 'УЭР:42', code: 'ЭАС258-26', matched: true },
    ]);
  });

  it('код книги без пары в мониторинге → matched: false (связка честно рвётся)', () => {
    // Книга ГРБС пишет «ЭА427-25», мониторинг исказил в «А427-25»:
    // молчаливой починки нет, разрыв виден и подлежит сигналу.
    const links = linkRowsToProcedures([{ rowKey: 'УД:14', ag: 'ЭА427-25' }], index);
    expect(links).toEqual([{ rowKey: 'УД:14', code: 'ЭА427-25', matched: false }]);
  });

  it('строки без строгого одиночного кода в связку не попадают', () => {
    const links = linkRowsToProcedures(
      [
        { rowKey: 'УЭР:4', ag: undefined }, // AG пуста
        { rowKey: 'УЭР:7', ag: 'Х' }, // плейсхолдер
        { rowKey: 'УЭР:8', ag: 'Не согласны, считаем экономией' }, // посторонний текст
        { rowKey: 'УЭР:28', ag: 'ЭЕП123-26,ЭЕП124-26,ЭЕП125-26,ЭЕП128-26' }, // список
        { rowKey: 'УО:2101', ag: 'ЭАС205/1-26' }, // искажение с косой чертой
        { rowKey: 'УИО:37', ag: 'ЭЗК 283' }, // обрубок без года
      ],
      index,
    );
    expect(links).toEqual([]);
  });

  it('Map с данными процедур тоже годится как карта', () => {
    const map = new Map([['ЭА152-26', { sheet: '1. УЭР', row: 30 }]]);
    const links = linkRowsToProcedures([{ rowKey: 'УЭР:30', ag: 'эа152-26' }], map);
    expect(links).toEqual([{ rowKey: 'УЭР:30', code: 'ЭА152-26', matched: true }]);
  });
});
