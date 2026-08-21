/**
 * Страж ответа по сигналу — требование владельца 21.08.2026 дословно:
 * «я хотел бы увидеть ответ по каждому из сработавших сигналов в чём проблема».
 *
 * Ответ обязан назвать три вещи: какая строка (двойной адрес), что в ней
 * (значения спорных ячеек человеческими именами) и почему (условие правила).
 * Молчания не бывает: класс без правила отвечает паспортом проверки, строка
 * без чтения книги честно говорит «строка не прочитана», а пустая ячейка —
 * «пусто», и это разные сообщения.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSignalAnswer,
  buildSignalAnswers,
  columnHumanLabel,
  SIGNAL_ANSWER_RULES,
} from './signal-answer.js';

type TestIssue = {
  checkId: string;
  sheet?: string;
  row?: number;
  rowSeq?: string;
  cell?: string | undefined;
};

/** Книга-заглушка: лист «УО», две строки с известными значениями. */
const BOOK: Record<string, Record<string, string>> = {
  'УО!128': { L: 'ЕП', K: '450,00', N: '', P: '', Q: '15.03.2026', Y: '450,00' },
  'УО!204': { L: 'ЭА', K: '1 200,00', N: '', P: '', Q: '', Y: '0' },
};

function readCell(sheet: string, row: number, column: string): string | null {
  const rowCells = BOOK[`${sheet}!${row}`];
  if (!rowCells) return null;
  return rowCells[column] ?? '';
}

function issue(o: Partial<TestIssue> = {}): TestIssue {
  return {
    checkId: o.checkId ?? 'plan_year_missing',
    sheet: o.sheet ?? 'УО',
    row: o.row ?? 128,
    rowSeq: o.rowSeq ?? '57',
    cell: o.cell,
  };
}

describe('buildSignalAnswer — какая строка, что в ней, почему', () => {
  it('называет двойной адрес: строку листа и «№ п/п»', () => {
    const answer = buildSignalAnswer('plan_year_missing', {
      issues: [issue()],
      readCell,
    });
    expect(answer.rows).toHaveLength(1);
    expect(answer.rows[0]!.address).toBe('УО!строка 128 (№ п/п 57)');
  });

  it('показывает значения спорных ячеек человеческими именами колонок', () => {
    const answer = buildSignalAnswer('plan_year_missing', {
      issues: [issue()],
      readCell,
    });
    const byColumn = Object.fromEntries(answer.rows[0]!.cells.map((c) => [c.column, c]));
    expect(byColumn.L!.value).toBe('ЕП');
    expect(byColumn.K!.value).toBe('450,00');
    // Имя колонки — из шапки книги, а не буква: буква остаётся вторым адресом.
    expect(byColumn.L!.label).not.toBe('L');
    expect(byColumn.L!.label.length).toBeGreaterThan(1);
  });

  it('пустая ячейка называется словом, а не пробелом', () => {
    const answer = buildSignalAnswer('plan_year_missing', {
      issues: [issue()],
      readCell,
    });
    const n = answer.rows[0]!.cells.find((c) => c.column === 'N');
    expect(n!.value).toBe('пусто');
  });

  it('непрочитанная строка отличается от пустой ячейки', () => {
    const answer = buildSignalAnswer('plan_year_missing', {
      issues: [issue({ row: 999 })],
      readCell,
    });
    expect(answer.rows[0]!.cells.every((c) => c.value === 'строка не прочитана')).toBe(true);
  });

  it('условие берётся из правила и написано без букв колонок', () => {
    const answer = buildSignalAnswer('plan_year_missing', { issues: [issue()], readCell });
    expect(answer.condition).toContain('плановой даты');
    // В условии не должно быть адресов вида «колонка N» — они живут в ячейках.
    expect(answer.condition).not.toMatch(/\bколонк[аи]\s+[A-Z]\b/u);
  });

  it('класс без правила отвечает паспортом проверки, а не молчит', () => {
    const answer = buildSignalAnswer('mirror_desync', {
      issues: [issue({ checkId: 'mirror_desync', cell: 'K128' })],
      readCell,
    });
    expect(answer.condition.length).toBeGreaterThan(0);
    expect(answer.whatToDo.length).toBeGreaterThan(0);
  });

  it('пустой класс объясняет молчание словами', () => {
    const answer = buildSignalAnswer('overdue', { issues: [], readCell });
    expect(answer.totalRows).toBe(0);
    expect(answer.emptyReason).toContain('ничего не нашла');
  });

  it('счёт строк полный, показ ограничен', () => {
    const many = Array.from({ length: 25 }, (_, i) => issue({ row: 128 + i }));
    const answer = buildSignalAnswer('plan_year_missing', { issues: many, readCell }, 10);
    expect(answer.totalRows).toBe(25);
    expect(answer.rows).toHaveLength(10);
  });
});

describe('buildSignalAnswers — все сработавшие классы', () => {
  it('идут от самого частого к редкому', () => {
    const issues = [
      ...Array.from({ length: 3 }, () => issue({ checkId: 'overdue' })),
      ...Array.from({ length: 7 }, () => issue({ checkId: 'plan_year_missing' })),
      issue({ checkId: 'ep_risk' }),
    ];
    const answers = buildSignalAnswers({ issues, readCell });
    expect(answers.map((a) => a.checkId)).toEqual(['plan_year_missing', 'overdue', 'ep_risk']);
  });
});

describe('Таблица правил', () => {
  it('у каждого правила есть условие и хотя бы одна спорная колонка', () => {
    const broken = Object.entries(SIGNAL_ANSWER_RULES)
      .filter(([, r]) => r.condition.trim() === '' || r.evidence.length === 0)
      .map(([id]) => id);
    expect(broken).toEqual([]);
  });

  it('все колонки правил имеют человеческие имена', () => {
    const nameless: string[] = [];
    for (const [id, rule] of Object.entries(SIGNAL_ANSWER_RULES)) {
      for (const column of rule.evidence) {
        if (columnHumanLabel(column, rule.geometry) === column) nameless.push(`${id}:${column}`);
      }
    }
    expect(nameless).toEqual([]);
  });
});
