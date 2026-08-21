import { describe, expect, it } from 'vitest';
import { doorAbsence, reportDoor } from './door';

describe('дверь к строкам-основаниям карточек «Отчёта»', () => {
  it('несёт периметр карточки в цель: управление и год доезжают', () => {
    const d = reportDoor('lifecycle_stage_in_work', { dept: 'УО', year: 2026 });
    expect(d).not.toBeNull();
    expect(d!.page).toBe('data');
    expect(d!.filters.department).toBe('УО');
    expect(d!.filters.year).toBe(2026);
  });

  it('признаки строк берутся из реестра дверей, а не сочиняются местом клика', () => {
    const d = reportDoor('lifecycle_stage_overdue', { dept: 'УО', year: 2026 });
    expect(d!.filters.signals).toEqual(['overdue']);
  });

  it('корзина Реестра — тоже Реестр: оси доезжают до неё так же', () => {
    const d = reportDoor('lifecycle_stage_no_funding', { dept: 'УКСиМП', year: 2026 });
    expect(d!.page).toBe('unfunded');
    expect(d!.filters.department).toBe('УКСиМП');
  });

  it('подсказка называет и то, что откроется, и то, чего в цели не будет', () => {
    // Бюджет до Реестра не доезжает — переход обязан сказать об этом словами.
    const d = reportDoor('lifecycle_stage_concluded', { dept: 'УО', year: 2026, budget: 'fb' });
    expect(d!.hint).toContain('Откроется');
    expect(d!.hint.toLowerCase()).toContain('бюджет');
    // Оговорка самой двери (отсечения «не позже среза» у Реестра нет) тоже на месте.
    expect(d!.hint).toContain('среза');
  });

  it('ключа нет в реестре дверей — двери нет вовсе, ложную не выдумываем', () => {
    expect(reportDoor('нет_такого_ключа', { dept: 'УО' })).toBeNull();
  });

  it('причина отсутствия двери берётся из того же реестра', () => {
    expect(doorAbsence('scorecard_grade')).toContain('штраф');
    expect(doorAbsence('lifecycle_stage_in_work')).toBeNull();
  });
});
