/**
 * Страж-тесты п.51 (интервью 14.08.2026): счётчик подведов Пульта.
 *
 * Класс дефекта: единицы счёта колонки C расходились с реестром — выдуманные
 * демо-подведы и разъехавшиеся написания («КДМШ» против «МБУ ДО "КДМШ"»)
 * завышали плашку ГРБС (у УКСиМП 23 вместо 22). Канон: плашка = реальные
 * позиции колонки C (подведы + категории) + само управление; заглушки
 * «X/x/Х/х», тире, «н/д», пусто — закупка самого управления (isOrgItself).
 */
import { describe, expect, it } from 'vitest';
import { deptPositionsCount, isSelfReference } from './OrgStrip';
import { SUBORDINATES_FALLBACK } from '../store';

describe('п.51: счётчик подведов УКСиМП', () => {
  const realSubs = (deptId: string): string[] =>
    (SUBORDINATES_FALLBACK[deptId] ?? []).filter((s) => !isSelfReference(s, deptId));

  it('УКСиМП: 21 позиция колонки C (20 подведов + СЗ) → плашка 22 (+ само управление)', () => {
    const subs = realSubs('УКСиМП');
    expect(subs).toHaveLength(21);
    expect(deptPositionsCount(subs.length)).toBe(22);
  });

  it('выдуманные демо-подведы (КЦЕ, «Спортивная школа») не возвращаются', () => {
    const joined = (SUBORDINATES_FALLBACK['УКСиМП'] ?? []).join(' | ');
    expect(joined).not.toContain('КЦЕ');
    expect(joined).not.toContain('Культурный центр Елизово');
  });

  it('дедуп: список позиций не содержит одной организации под двумя написаниями', () => {
    for (const [dept, subs] of Object.entries(SUBORDINATES_FALLBACK)) {
      expect(new Set(subs).size, `дубли у ${dept}`).toBe(subs.length);
    }
  });
});

describe('isSelfReference — канон «сама организация» (isOrgItself + категории аппарата)', () => {
  it('заглушки колонки C = само управление: X/x/Х/х, тире, н/д, пусто', () => {
    for (const v of ['X', 'x', 'Х', 'х', '-', '—', 'н/д', 'нет', '']) {
      expect(isSelfReference(v, 'УКСиМП'), `«${v}» должен быть самоссылкой`).toBe(true);
    }
  });

  it('сентинел _org_itself и имя самого управления — самоссылки', () => {
    expect(isSelfReference('_org_itself', 'УО')).toBe(true);
    expect(isSelfReference('УО', 'УО')).toBe(true);
    expect(isSelfReference('МКУ "УО"', 'УО')).toBe(true);
  });

  it('реальный подвед и категория «Совместная закупка» самоссылками НЕ являются', () => {
    expect(isSelfReference('МБУ ДО "КДМШ"', 'УКСиМП')).toBe(false);
    expect(isSelfReference('Совместная закупка', 'УКСиМП')).toBe(false);
  });
});
