import { describe, expect, it } from 'vitest';
import {
  isCountMetric,
  reconAvailability,
  reconBadges,
  reconKeyLabel,
  reconMismatches,
  type ReconRow,
} from './recon';

const OPEN = {
  activityIsAll: true,
  deptFiltered: false,
  budgetFiltered: false,
  period: 'year' as const,
  hasRows: true,
};

const rows: ReconRow[] = [
  { key: 'competitive.year.count', calc: 100, official: 100, deltaPct: 0, status: 'ok' },
  { key: 'competitive.year.total_plan', calc: 110, official: 100, deltaPct: 10, status: 'high' },
  { key: 'sole.year.count', calc: 50, official: 50, deltaPct: 0, status: 'ok' },
  { key: 'sole.q1.total_fact', calc: 9, official: 10, deltaPct: -10, status: 'high' },
];

describe('доступность сверки объясняется, а не молчит', () => {
  it('полный срез за год — сверка доступна', () => {
    expect(reconAvailability(OPEN).available).toBe(true);
  });

  it('срез по виду деятельности гасит сверку с причиной', () => {
    const a = reconAvailability({ ...OPEN, activityIsAll: false });
    expect(a.code).toBe('activity');
    expect(a.reason).toContain('вид');
  });

  it('фильтр по управлениям гасит сверку с причиной', () => {
    expect(reconAvailability({ ...OPEN, deptFiltered: true }).code).toBe('department');
  });

  it('фильтр по бюджету гасит сверку: лист ведёт суммы всех бюджетов сразу', () => {
    // Иначе бейдж «сверено» стоял бы рядом с суммами одного бюджета, которые
    // сервер не сверял вовсе.
    expect(reconAvailability({ ...OPEN, budgetFiltered: true }).code).toBe('budget');
  });

  it('период без эталона гасит сверку с причиной', () => {
    expect(reconAvailability({ ...OPEN, period: 'q3' }).code).toBe('period');
    expect(reconAvailability({ ...OPEN, period: null }).code).toBe('period');
  });

  it('пустой ответ сверки — отдельная причина, а не «всё сошлось»', () => {
    expect(reconAvailability({ ...OPEN, hasRows: false }).code).toBe('absent');
  });

  it('у каждой причины непустой текст для читателя', () => {
    for (const patch of [
      { activityIsAll: false },
      { deptFiltered: true },
      { budgetFiltered: true },
      { period: 'm5' as const },
      { hasRows: false },
    ]) {
      const a = reconAvailability({ ...OPEN, ...patch });
      expect(a.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('бейджи сверки', () => {
  it('негорящий бейдж несёт причину, а не пустоту', () => {
    const a = reconAvailability({ ...OPEN, deptFiltered: true });
    const b = reconBadges(rows, a, 'year');
    expect(b.kp.status).toBe('none');
    expect(b.kp.reason).toBe(a.reason);
    expect(b.ep.reason).toBe(a.reason);
  });

  it('статус группы — худший из её показателей', () => {
    const b = reconBadges(rows, reconAvailability(OPEN), 'year');
    expect(b.kp.status).toBe('high');
    expect(b.kp.checked).toBe(2);
    expect(b.kp.worstDeltaPct).toBe(10);
    expect(b.ep.status).toBe('ok');
  });

  it('раздел без строк сверки не выдаёт себя за сверенный', () => {
    const b = reconBadges(
      rows.filter((r) => r.key.startsWith('competitive')),
      reconAvailability(OPEN),
      'year',
    );
    expect(b.ep.status).toBe('none');
    expect(b.ep.reason).toContain('не прочитан');
  });
});

describe('расхождения и подписи', () => {
  it('в список идут расхождения ТОЛЬКО выбранного периода', () => {
    // Раньше заголовок говорил «за год», а под ним показывались строки первого
    // квартала — читатель искал в годовых числах расхождение, которого там нет.
    const m = reconMismatches(rows, reconAvailability(OPEN), 'year');
    expect(m.map((r) => r.key)).toEqual(['competitive.year.total_plan']);
  });

  it('подпись ключа — по-русски, без латиницы', () => {
    expect(reconKeyLabel('competitive.q1.total_plan')).toBe('КП · план');
    expect(reconKeyLabel('sole.year.economy_total')).toBe('ЕП · экономия');
  });

  it('нераспознанный ключ не протекает латиницей в интерфейс', () => {
    const label = reconKeyLabel('unknown.year.mystery_field');
    expect(label).toBe('раздел не распознан · показатель не распознан');
    expect(/[a-z]/i.test(label)).toBe(false);
  });

  it('количество отличается от денег — формат числа зависит от этого', () => {
    expect(isCountMetric('competitive.q1.count')).toBe(true);
    expect(isCountMetric('competitive.q1.total_plan')).toBe(false);
  });
});
