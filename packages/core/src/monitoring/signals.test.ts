/**
 * signals.test.ts — карточки диагноста вкладки мониторинга (спека §5, п.53).
 *
 * Требование к каждой карточке одно и жёсткое: механизм, адрес и действие.
 * Карточка без адреса бесполезна, поэтому тест проверяет именно адреса, а не
 * только счётчики. Второе требование — тон: объяснение, не упрёк (п.104).
 */
import { describe, expect, it } from 'vitest';
import { matchMonitoring } from '../pipeline/monitoring-match.js';
import { buildMonitoringSignals, mappingSignals } from './signals.js';
import { parseMonitoringDirectory } from './directory.js';
import { parseMonitoringJournal } from './journal.js';
import { parseMonitoringProcedures } from './procedures.js';
import { parseMonitoringSvod } from './svod.js';

function row(over: {
  customer?: string; subject?: string; nmck?: unknown;
  publication?: string; deadline?: string; auction?: string;
  price?: unknown; savings?: unknown; mb?: unknown; check?: string; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[1] = over.customer ?? 'МКУ ЦЭР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[5] = over.publication ?? '';
  r[6] = over.deadline ?? '';
  r[7] = over.auction ?? '';
  r[8] = over.price ?? '';
  r[9] = over.savings ?? '';
  r[10] = over.check ?? '';
  r[11] = over.mb ?? '';
  r[14] = over.winner ?? '';
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

const { procedures } = parseMonitoringProcedures({
  '5. УДТХиРКИ': [
    ...HEADERS,
    // Сумма текстом: свод занижен на эту ячейку.
    row({ subject: 'ЭА291-26 Капремонт', nmck: '73 970 897,35', publication: '05.03.2026' }),
    // Искажённый код: связь с книгами ГРБС по этой строке не строится.
    row({ subject: 'ЭЗК-120-26 Стройматериалы', nmck: 10_000 }),
  ],
  '8. УО': [
    ...HEADERS,
    // Контроль книги показывает «ошибка»: разбивка не сходится.
    row({
      subject: 'ЭА40-26 Поставка', nmck: 100_000, publication: '01.03.2026',
      price: 90_000, savings: 10_000, mb: 4_000, check: 'ошибка',
    }),
    // Торги без результата, преемницы в переходящем реестре нет.
    row({ subject: 'ЭА41-26 Услуги', nmck: 50_000, publication: '02.03.2026', price: 0, winner: 'Не состоялся (0 заявок)' }),
  ],
});

const journal = parseMonitoringJournal([new Array(14).fill('ш')]);

const svod = parseMonitoringSvod([
  ['Общая информация', '', '', '', '', '', '', '', ''],
  ['№', 'Управление', 'Кол-во', 'НМЦК', 'Цена', 'Экономия', '', '', ''],
  ['', '', '', '', '', 'ВСЕГО', 'МБ', 'КБ', 'ФБ'],
  ['Итого:', '', 4, 74_130_897.35, 90_000, 10_000, 4_000, '', ''],
]);

const directory = parseMonitoringDirectory(
  [['№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения']],
  procedures.map((p) => ({ customer: p.customer, customerNormalized: p.customerNormalized, dept: p.dept })),
);

describe('buildMonitoringSignals', () => {
  const signals = buildMonitoringSignals({ procedures, journal, directory, svod });
  const byKind = new Map(signals.map((s) => [s.kind, s]));

  it('каждая карточка несёт механизм, действие и хотя бы один адрес', () => {
    expect(signals.length).toBeGreaterThan(3);
    for (const signal of signals) {
      expect(signal.mechanism.length).toBeGreaterThan(20);
      expect(signal.action.length).toBeGreaterThan(10);
      expect(signal.addresses.length).toBeGreaterThan(0);
      expect(signal.count).toBeGreaterThanOrEqual(signal.addresses.length);
    }
  });

  it('сумма текстом приходит с адресом ячейки, а не с одним числом', () => {
    const signal = byKind.get('monitoring_text_number');
    expect(signal?.severity).toBe('high');
    expect(signal?.addresses[0].address).toBe('5. УДТХиРКИ!D3');
    expect(signal?.mechanism).toContain('СУММ');
  });

  it('искажённый код процедуры — сигнал, а не молчаливая правка', () => {
    const signal = byKind.get('monitoring_broken_code');
    expect(signal?.addresses[0].address).toBe('5. УДТХиРКИ!C4');
    expect(signal?.action).toContain('не чинит молча');
  });

  it('контроль книги «ошибка» переносится с разрывом в рублях', () => {
    const signal = byKind.get('monitoring_control_error');
    expect(signal?.count).toBe(1);
    expect(signal?.addresses[0].note).toContain('6');
  });

  it('разрыв свода поднимается отдельно: контроля на своде книги нет вовсе', () => {
    const signal = byKind.get('monitoring_svod_gap');
    expect(signal?.addresses[0].address).toContain('СВОДНЫЙ!F12');
    expect(signal?.action).toContain('контрольную колонку');
  });

  it('сорвавшаяся процедура без преемницы называется по коду', () => {
    const signal = byKind.get('monitoring_no_successor');
    expect(signal?.count).toBe(1);
    expect(signal?.addresses[0].note).toContain('ЭА41-26');
  });

  it('написание заказчика вне справочника — низкая критичность, но с частотой', () => {
    const signal = byKind.get('monitoring_customer_unknown');
    expect(signal?.severity).toBe('low');
    expect(signal?.addresses[0].note).toContain('строк');
  });

  it('карточки идут по критичности: сначала высокая', () => {
    const severities = signals.map((s) => s.severity);
    expect(severities.indexOf('high')).toBeLessThan(severities.lastIndexOf('low'));
  });

  it('тон карточек — объяснение механизма, а не упрёк', () => {
    const text = signals.map((s) => `${s.title} ${s.mechanism} ${s.action}`).join(' ');
    expect(text).not.toContain('ошибка заполнения');
    expect(text).not.toContain('виноват');
  });

  it('нет дефектов — нет карточек: пустой список честнее выдуманной тревоги', () => {
    const { procedures: clean } = parseMonitoringProcedures({
      '1. УЭР': [...HEADERS, row({ subject: 'ЭА1-26 Ремонт', nmck: 100_000, publication: '01.03.2026', price: 90_000, savings: 10_000, mb: 10_000, check: 'верно' })],
    });
    expect(buildMonitoringSignals({ procedures: clean })).toEqual([]);
  });
});

describe('mappingSignals — пять сигналов из построчной сверки', () => {
  function bookRow(code: string, plan: number, fact: number): unknown[] {
    const r: unknown[] = new Array(34).fill('');
    r[10] = plan;
    r[24] = fact;
    r[32] = code;
    return r;
  }

  it('код в книге без процедуры и процедура без строки плана — разные карточки', () => {
    const result = matchMonitoring(
      [{ rowKey: 'УЭР:5', book: 'УЭР', ag: 'ЭА999-26', planTotalThousands: 100, factTotalThousands: 90 }],
      [{ procKey: '1. УЭР:3', sheet: '1. УЭР', nameCell: 'ЭА1-26 Ремонт', nmckRub: 100_000, winnerPriceRub: 90_000 }],
    );
    const signals = mappingSignals(result);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain('monitoring_map_book_only');
    expect(kinds).toContain('monitoring_map_no_book_row');
    const bookOnly = signals.find((s) => s.kind === 'monitoring_map_book_only');
    expect(bookOnly?.addresses[0].address).toBe('УЭР:5');
  });

  it('расхождение сумм приходит с обеими сторонами в рублях', () => {
    const result = matchMonitoring(
      [{ rowKey: 'УЭР:5', book: 'УЭР', ag: 'ЭА1-26', planTotalThousands: 700, factTotalThousands: 90 }],
      [{ procKey: '1. УЭР:3', sheet: '1. УЭР', nameCell: 'ЭА1-26 Ремонт', nmckRub: 1_000_000, winnerPriceRub: 90_000 }],
    );
    const signal = mappingSignals(result).find((s) => s.kind === 'monitoring_map_nmck_mismatch');
    expect(signal?.addresses[0].note).toContain('700000.00');
    expect(signal?.addresses[0].note).toContain('1000000.00');
    // Тон: расхождение здесь про семантику плановой колонки, не про вину.
    expect(signal?.mechanism).toContain('не одно и то же число');
    // Строка-заглушка, чтобы фикстура книги использовалась хотя бы раз.
    expect(bookRow('ЭА1-26', 700, 90)[32]).toBe('ЭА1-26');
  });
});
