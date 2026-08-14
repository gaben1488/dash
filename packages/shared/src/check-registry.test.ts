/**
 * Стражи CHECK_REGISTRY — канон интервью 14.08.2026
 * (docs/superpowers/audits/2026-08-14-interview-register.md).
 *
 * Пункты: 23 (имя класса «не обеспечено финансированием»), 28 («факт дата
 * раньше плана» — не ошибка, информационный). Тесты держат решения владельца
 * от возврата при следующем редактировании реестра.
 */
import { describe, it, expect } from 'vitest';
import { CHECK_REGISTRY } from './check-registry.js';

describe('CHECK_REGISTRY — канон интервью 14.08.2026', () => {
  it('СТРАЖ п.28: «факт дата раньше плана» — информационный, не предупреждение', () => {
    const check = CHECK_REGISTRY.find((c) => c.id === 'fact_date_before_plan');
    expect(check).toBeDefined();
    // Решение аудитории дословно: «это не ошибка» — сигнал остаётся
    // справкой, но не может быть warning и выше.
    expect(check!.severity).toBe('info');
  });

  it('СТРАЖ п.23: класс называется «Закупка, не обеспеченная финансированием»', () => {
    const check = CHECK_REGISTRY.find((c) => c.id === 'plan_year_missing');
    expect(check).toBeDefined();
    expect(check!.name).toBe('Закупка, не обеспеченная финансированием');
  });

  it('СТРАЖ п.23 (свип): старый лейбл «без подтверждённого финансирования» изгнан из всех текстов реестра', () => {
    for (const check of CHECK_REGISTRY) {
      const texts = [check.name, check.description, check.kbHint, check.recommendation].join(' ');
      expect(texts.toLowerCase()).not.toContain('без подтверждённого финансирования');
    }
  });

  it('СТРАЖ п.3 (свип): тексты реестра не содержат голых float-хвостов двоичной арифметики', () => {
    // Числа в описаниях — до 2 знаков (копейки/проценты): «7138.1467200000025»
    // не имеет права появиться в справочном тексте. Даты дд.мм.гггг не
    // считаются: у совпадения не должно быть точки/цифры по краям (тот же
    // лукэраунд, что у roundMoneyInText в core/pipeline/validate.ts).
    for (const check of CHECK_REGISTRY) {
      const texts = [check.name, check.description, check.kbHint, check.recommendation].join(' ');
      expect(texts).not.toMatch(/(?<![\d.,])\d+\.\d{3,}(?!\.?\d)/);
    }
  });
});
