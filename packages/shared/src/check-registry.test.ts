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
import { ECONOMY_FLAG_CANON } from './economy-flag.js';
import { SIGNAL_CLASS_NAMES, signalCardTitle } from './product-dictionary.js';

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

  it('СТРАЖ п.23: имя класса «не обеспечено финансированием» приходит из дома имён', () => {
    // Две формы одного имени живут одной записью словаря: короткая на чипе,
    // именная в заголовке карточки. Разъехаться им негде — это и есть
    // консолидация 21.08.2026.
    expect(SIGNAL_CLASS_NAMES.planYearMissing.chip).toBe('Не обеспечено финансированием');
    expect(signalCardTitle('planYearMissing')).toBe('Закупка, не обеспеченная финансированием');
  });

  it('СТРАЖ 21.08: у явления «Экономия без отметки» одно имя на все поверхности', () => {
    const check = CHECK_REGISTRY.find((c) => c.id === 'status_on_data_rows');
    expect(check).toBeDefined();
    expect(check!.name).toBe(ECONOMY_FLAG_CANON.name);
    expect(check!.description).toBe(ECONOMY_FLAG_CANON.definition);
    // Третье имя того же явления («Скрытая экономия») удалено вместе с записью:
    // производителя у неё не было ни одного.
    expect(CHECK_REGISTRY.find((c) => c.id === 'economy_hidden')).toBeUndefined();
    for (const entry of CHECK_REGISTRY) {
      expect(entry.name).not.toContain('Скрытая экономия');
    }
  });

  it('СТРАЖ 21.08: заголовки проверок, рождённых из признаков строк, — из дома имён', () => {
    // Ключ признака известен по legacyId (реестр хранит его для миграции).
    // Если заголовок разойдётся с домом имён, продукт снова начнёт звать одну
    // строку двумя словами на двух вкладках — ровно то, что чинилось.
    const drift = CHECK_REGISTRY
      .filter((c) => c.sourceType === 'signal' && c.legacyId !== undefined
        && c.legacyId in SIGNAL_CLASS_NAMES)
      .filter((c) => c.name !== signalCardTitle(c.legacyId as string))
      .map((c) => `${c.id}: «${c.name}»`);
    expect(drift).toEqual([]);
  });

  it('СТРАЖ 21.08: «Раннее закрытие» описано так, как считает детектор', () => {
    const check = CHECK_REGISTRY.find((c) => c.id === 'early_closure');
    expect(check).toBeDefined();
    // Обе приметы описки названы; прежнее обещание «раньше плановой на >30 дней»
    // (которого детектор не выполняет с 18.08) изгнано.
    expect(check!.description).toContain('180');
    expect(check!.description).toContain('30');
    expect(check!.description).not.toContain('раньше плановой на > 30 дней');
    // Соседняя по смыслу проверка названа в обеих карточках.
    expect(check!.description).toContain('Факт раньше плановой даты');
    const before = CHECK_REGISTRY.find((c) => c.id === 'fact_date_before_plan');
    expect(before!.description).toContain('Раннее закрытие');
    expect(before!.kbHint).toContain('180');
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
