import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY } from './check-registry.js';
import { ROOT_CAUSE_ACTIONS } from './recon-root-cause.js';

/**
 * Страж формульных колонок (канон п.93/45, урок 18.08 — п.98а).
 *
 * Рукописны только N (план дата) и Q (факт дата); O, P, R, S считаются
 * формулами листа. Рекомендация «проставить/заполнить/вписать O|P|R|S»
 * учит оператора затирать формулу значением — ровно так рождается класс
 * derivedFormulaBroken (живой пример: УКСиМП строки 280/283, где ложное
 * «не обеспечено финансированием» стояло на стёртых формулах O/P).
 * Тексты рекомендаций обязаны вести к N/Q или к восстановлению формулы.
 */
const MANUAL_ENTRY_INTO_DERIVED = /(простав|запол|впи[сш])[^.—–]*\(\s*(?:столбц\w*\s+)?(?:N\s*,\s*)?[OPRS]\b/iu;

describe('страж формульных колонок (п.93/45)', () => {
  it('реестр проверок не советует вписывать O/P/R/S руками', () => {
    // Проверяются только советы (recommendation): описание механизма имеет
    // право констатировать «дата проставлена, а (O) пуст» — это не призыв.
    for (const check of CHECK_REGISTRY) {
      const t = check.recommendation;
      if (typeof t !== 'string') continue;
      expect(t, `${check.id}: «${t}»`).not.toMatch(MANUAL_ENTRY_INTO_DERIVED);
    }
  });

  it('действия сверки не советуют вписывать O/P/R/S руками', () => {
    for (const [cls, t] of Object.entries(ROOT_CAUSE_ACTIONS)) {
      expect(t, `${cls}: «${t}»`).not.toMatch(MANUAL_ENTRY_INTO_DERIVED);
    }
  });
});
