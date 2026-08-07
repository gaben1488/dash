import { describe, expect, it } from 'vitest';
import { ISSUE_STATUS_LABELS } from '@aemr/shared';
import {
  JOURNAL_FILTERABLE_TYPES,
  formatEventTime,
  humanizeJournalDetails,
  journalActorLabel,
} from './journal-display';

describe('formatEventTime (ISO-момент → человеческое время)', () => {
  it('печатает дату и время, а не ISO-строку', () => {
    const text = formatEventTime('2026-08-07T09:15:00.000Z');
    expect(text).not.toContain('T');
    expect(text).not.toContain('Z');
    expect(text).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it('пустое время называется словами, а не прочерком', () => {
    expect(formatEventTime('')).toBe('время не записано');
    expect(formatEventTime(null)).toBe('время не записано');
    expect(formatEventTime(undefined)).toBe('время не записано');
  });

  it('непарсимое значение отдаётся как есть — поломку видно, а не заметено', () => {
    expect(formatEventTime('позавчера')).toBe('позавчера');
  });
});

describe('journalActorLabel (в колонке «Кто» не бывает латиницы)', () => {
  it('латинский писатель сервера переводится', () => {
    expect(journalActorLabel('Pipeline')).toBe('Обновление данных');
  });

  it('пустой автор — это Система, а не пустая клетка', () => {
    expect(journalActorLabel(null)).toBe('Система');
    expect(journalActorLabel('')).toBe('Система');
  });

  it('человеческое имя проходит без изменений', () => {
    expect(journalActorLabel('Иванов И.И.')).toBe('Иванов И.И.');
  });
});

describe('humanizeJournalDetails (статусы в деталях — словарной фразой)', () => {
  it('переход статусов раскрывается подписями продукта', () => {
    expect(humanizeJournalDetails('open → wont_fix')).toBe(
      `${ISSUE_STATUS_LABELS.open} → ${ISSUE_STATUS_LABELS.wont_fix}`,
    );
  });

  it('комментарий после перехода сохраняется', () => {
    const text = humanizeJournalDetails('in_progress → resolved: пересчитали лимит');
    expect(text).toContain(ISSUE_STATUS_LABELS.resolved);
    expect(text).toContain('пересчитали лимит');
  });

  it('ключ внутри слова не трогается — это не статус', () => {
    expect(humanizeJournalDetails('reopened_open_case')).toBe('reopened_open_case');
  });

  it('пустые детали — пустая строка, без «undefined» на экране', () => {
    expect(humanizeJournalDetails(undefined)).toBe('');
  });
});

describe('JOURNAL_FILTERABLE_TYPES (чипы только по работающим фильтрам)', () => {
  it('содержит ровно типы, которые производит сервер', () => {
    expect([...JOURNAL_FILTERABLE_TYPES]).toEqual([
      'import',
      'edit',
      'issue_create',
      'issue_status',
      'normalize',
      'input_error',
      'mapping_change',
    ]);
  });

  it('не содержит типов-призраков, дававших пустой список', () => {
    for (const ghost of ['issue', 'error', 'system']) {
      expect(JOURNAL_FILTERABLE_TYPES).not.toContain(ghost);
    }
  });
});
