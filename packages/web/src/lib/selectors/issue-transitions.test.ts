import { describe, expect, it } from 'vitest';
import { ISSUE_STATUS_LABELS } from '@aemr/shared';
import {
  ISSUE_STATUS_TRANSITIONS,
  allowedIssueTransitions,
  issueStatusLabel,
  issueTransitionNeedsReason,
  issueTransitionRefusal,
  statusesLeadingTo,
} from './issue-transitions';

describe('allowedIssueTransitions (кнопки обещают только то, что примет сервер)', () => {
  it('из открытого нельзя сразу в исправлено — сервер требует пройти «в работе»', () => {
    expect(allowedIssueTransitions('open')).not.toContain('resolved');
    expect(allowedIssueTransitions('open')).toContain('in_progress');
  });

  it('исправлено доступно только из «в работе»', () => {
    expect(allowedIssueTransitions('in_progress')).toContain('resolved');
    expect(allowedIssueTransitions('acknowledged')).not.toContain('resolved');
  });

  it('конечные статусы переоткрываются — тупика в интерфейсе быть не должно', () => {
    for (const terminal of ['resolved', 'wont_fix', 'false_positive']) {
      expect(allowedIssueTransitions(terminal)).toEqual(['open']);
    }
  });

  it('неизвестный статус не даёт кнопок вместо выдуманных', () => {
    expect(allowedIssueTransitions('какой-то-новый')).toEqual([]);
  });

  it('таблица покрывает все статусы словаря — новый статус не останется без переходов', () => {
    expect(Object.keys(ISSUE_STATUS_TRANSITIONS).sort()).toEqual(Object.keys(ISSUE_STATUS_LABELS).sort());
  });
});

describe('issueTransitionNeedsReason (причина обязательна там, где её требует сервер)', () => {
  it('отказ исправлять и ложное срабатывание требуют слов человека', () => {
    expect(issueTransitionNeedsReason('wont_fix')).toBe(true);
    expect(issueTransitionNeedsReason('false_positive')).toBe(true);
  });

  it('рабочие переходы причины не требуют', () => {
    expect(issueTransitionNeedsReason('in_progress')).toBe(false);
    expect(issueTransitionNeedsReason('resolved')).toBe(false);
  });
});

describe('issueStatusLabel (единственный дом подписи статуса)', () => {
  it('подпись берётся из словаря продукта, а не пишется рядом', () => {
    expect(issueStatusLabel('wont_fix')).toBe(ISSUE_STATUS_LABELS.wont_fix);
    expect(issueStatusLabel('false_positive')).toBe(ISSUE_STATUS_LABELS.false_positive);
  });

  it('неизвестный ключ возвращается как есть — сигнал дополнить словарь, а не падение', () => {
    expect(issueStatusLabel('archived')).toBe('archived');
  });
});

describe('statusesLeadingTo (откуда переход возможен)', () => {
  it('исправленным можно отметить только из «в работе»', () => {
    expect(statusesLeadingTo('resolved')).toEqual(['in_progress']);
  });

  it('переоткрыть можно из всех трёх конечных статусов', () => {
    expect([...statusesLeadingTo('open')].sort()).toEqual(['false_positive', 'resolved', 'wont_fix']);
  });

  it('несуществующий статус ниоткуда не достижим', () => {
    expect(statusesLeadingTo('archived')).toEqual([]);
  });
});

describe('issueTransitionRefusal (подсказка объясняет пропавшую кнопку словами)', () => {
  it('называет нужный статус, путь к нему и текущее положение', () => {
    const text = issueTransitionRefusal('open', 'resolved');
    expect(text).toContain(ISSUE_STATUS_LABELS.resolved);
    expect(text).toContain(ISSUE_STATUS_LABELS.in_progress);
    expect(text).toContain(ISSUE_STATUS_LABELS.open);
  });

  it('в подсказке нет сырых ключей', () => {
    const text = issueTransitionRefusal('open', 'resolved');
    expect(text).not.toMatch(/open|resolved|in_progress/);
  });
});
