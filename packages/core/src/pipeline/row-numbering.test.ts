/**
 * Сквозная нумерация «№ п/п» (колонка A) — канон п.98з
 * (docs/superpowers/audits/2026-08-14-interview-register.md: отсутствующие и
 * повторяющиеся порядковые номера).
 *
 * Правило row_numbering — проверка УРОВНЯ ЛИСТА: по счётным строкам книги
 * собираются дубли №, пропуски последовательности и пустые A, и всё это
 * выходит ОДНОЙ карточкой со списком адресов (каскад п.53), а не полусотней
 * замечаний. Здоровая нумерация молчит. Тесты идут через validateData — ту же
 * дверь, которой правило живёт в проде (rowSeq, departmentId — свежие правки
 * validate.ts, п.98б/в).
 */
import { describe, it, expect } from 'vitest';
import { RULE_BOOK, CHECK_REGISTRY } from '@aemr/shared';
import type { ClassifiedRow, NormalizedMetric, ReportMapEntry } from '@aemr/shared';
import { validateData } from './validate.js';

const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

/** Только испытуемое правило — соседние правила RULE_BOOK не шумят в тестах. */
const NUMBERING_RULES = RULE_BOOK.filter((r) => r.id === 'row_numbering');

/** Счётная строка листа управления: предмет, способ, план. */
function procRow(rowIndex: number, a: unknown, overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    rowIndex,
    sheet: 'УД',
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: { A: a, G: 'Опрессовка системы', K: 100, L: 'ЭА' },
    ...overrides,
  };
}

function run(rows: ClassifiedRow[]) {
  return validateData(EMPTY_METRICS, rows, NUMBERING_RULES, EMPTY_REPORT_MAP);
}

describe('row_numbering — правило есть и заведено в реестр', () => {
  it('RULE_BOOK содержит правило, CHECK_REGISTRY — карточку класса с рекомендацией про стабильный адрес', () => {
    expect(NUMBERING_RULES).toHaveLength(1);
    const check = CHECK_REGISTRY.find((c) => c.id === 'row_numbering');
    expect(check).toBeDefined();
    expect(check!.scope).toBe('department');
    // Канон п.118: пропуски — информация, не дефект; чинить их не предлагаем.
    expect(check!.recommendation).toContain('НЕ закрывать');
    expect(check!.recommendation).not.toContain('закрыть пропуски');
  });
});

describe('row_numbering — дубли', () => {
  it('один № у двух строк ловится с адресами ОБЕИХ строк', () => {
    const issues = run([procRow(4, 1), procRow(5, 2), procRow(6, 2)]);
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain('№ 2');
    expect(issues[0].description).toContain('5, 6');
  });

  it('«531» строкой и 531 числом — один и тот же №: дубль ловится', () => {
    const [issue] = run([procRow(4, '531'), procRow(5, 531)]);
    expect(issue).toBeDefined();
    expect(issue.description).toContain('№ 531');
    expect(issue.description).toContain('4, 5');
  });
});

describe('row_numbering — пропуски (п.118: информация, не нарушение)', () => {
  it('ТОЛЬКО пропуски — карточки нет: дыра это след удалённой строки', () => {
    expect(run([procRow(4, 1), procRow(5, 2), procRow(6, 5)])).toHaveLength(0);
  });
});

describe('row_numbering — пустые A', () => {
  it('счётная строка без номера попадает в карточку со своим адресом', () => {
    const issues = run([procRow(4, 1), procRow(5, ''), procRow(6, 2)]);
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain('без номера');
    expect(issues[0].description).toContain('5');
  });

  it('служебная строка «итого» без номера — не дефект', () => {
    const summary = procRow(7, '', {
      classification: 'summary',
      cells: { A: '', C: 'ИТОГО', K: 300 },
    });
    expect(run([procRow(4, 1), procRow(5, 2), summary])).toHaveLength(0);
  });
});

describe('row_numbering — каскад п.53 и тишина здоровой нумерации', () => {
  it('здоровая сквозная нумерация молчит', () => {
    expect(run([procRow(4, 1), procRow(5, 2), procRow(6, 3)])).toHaveLength(0);
  });

  it('дубль + пропуск + пустая A на одном листе = ровно ОДНА карточка', () => {
    const issues = run([
      procRow(4, 1),
      procRow(5, 1), // дубль № 1
      procRow(6, ''), // пустая A
      procRow(7, 5), // пропуск 2-4
    ]);
    expect(issues).toHaveLength(1);
    const text = issues[0].description;
    expect(text).toContain('повторяются');
    expect(text).toContain('без номера');
    // Дыры — справкой, с явной оговоркой «не дефект» (п.118).
    expect(text).toContain('не дефект');
  });

  it('карточка несёт управление и второй адрес якоря (п.98б/в: departmentId + rowSeq)', () => {
    const [issue] = run([procRow(4, 1), procRow(5, 1)]);
    expect(issue.departmentId).toBe('ud');
    expect(issue.checkId).toBe('row_numbering');
    expect(issue.rowSeq).toBe('1');
    expect(issue.row).toBe(4);
  });

  it('на своде правило не работает — нумерация A проверяется по листам управлений', () => {
    const svodRows = [
      procRow(4, 1, { sheet: 'СВОД ТД-ПМ' }),
      procRow(5, 1, { sheet: 'СВОД ТД-ПМ' }),
    ];
    expect(run(svodRows)).toHaveLength(0);
  });
});
