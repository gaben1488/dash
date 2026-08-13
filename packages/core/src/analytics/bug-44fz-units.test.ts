import { describe, it, expect } from 'vitest';
import { checkEPContractLimits, checkEPShareLimits } from './compliance-44fz.js';
import { detectSplitting, type AntiCorruptionRow } from './anticorruption.js';

/**
 * Страж-тест на БАГ #1 (bug-hunt 2026-08-08, docs/superpowers/audits/2026-08-08-bug-hunt-register.md):
 * LAW_44FZ_THRESHOLDS были заданы в рублях (epSmallPurchaseSingleContractLimit=600_000,
 * epSmallPurchaseAnnualAbsoluteLimit=50_000_000), а денежные колонки книг ГРБС
 * (H/I/J/K, V/W/X/Y) хранят суммы в ТЫСЯЧАХ рублей (канон report-map.ts:12).
 * Сравнение planTotal (тыс.) > 600_000 требовало контракта на 600 МЛН руб. —
 * недостижимо на реальных данных, checkEPContractLimits/checkEPShareLimits/
 * detectSplitting молчали всегда. До фикса эти проверки на реальных числах
 * ниже падают; после фикса (LAW_44FZ_THRESHOLDS в тыс. руб., суффикс ThousandRub) — зелёные.
 */
describe('БАГ #1 — единицы 44-ФЗ (тыс. руб., не руб.)', () => {
  it('checkEPContractLimits: ЕП на planTotal=601 (тыс. руб. = 601 тыс. руб. реальных) даёт ровно одно нарушение', () => {
    const rows = [{ rowIndex: 1, method: 'ЕП', planTotal: 601, factTotal: 0, economy: 0, subject: 'Поставка ГСМ' }];
    const issues = checkEPContractLimits(rows, 'УО');
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe('ep_contract_limit');
    expect(issues[0].severity).toBe('critical');
  });

  it('checkEPContractLimits: planTotal=600 (ровно на границе, тыс. руб.) — нарушения нет', () => {
    const rows = [{ rowIndex: 1, method: 'ЕП', planTotal: 600, factTotal: 0, economy: 0, subject: 'Поставка ГСМ' }];
    expect(checkEPContractLimits(rows, 'УО')).toHaveLength(0);
  });

  it('checkEPShareLimits: годовой объём ЕП управления 50_001 (тыс. руб. = 50,001 млн) превышает годовой абсолютный лимит (50 млн)', () => {
    const issues = checkEPShareLimits(1, 10, 50_001, 200_000, 'ОПЕРАЦИОННЫЙ', 'УО');
    expect(issues.some(i => i.ruleCode === 'ep_annual_absolute')).toBe(true);
  });

  it('checkEPShareLimits: годовой объём ЕП управления 50_000 (ровно на границе) — не превышает', () => {
    const issues = checkEPShareLimits(1, 10, 50_000, 200_000, 'ОПЕРАЦИОННЫЙ', 'УО');
    expect(issues.some(i => i.ruleCode === 'ep_annual_absolute')).toBe(false);
  });

  it('detectSplitting: сконструированный кейс дробления (несколько ЕП одного предмета, каждая < 600 тыс., в сумме > 600 тыс.) — срабатывает', () => {
    // 10 ЕП-закупок канцтоваров по 550 тыс. руб. каждая (в «предлимитной» полосе
    // 480-600 тыс.) — классический сценарий дробления одной закупки на несколько
    // ЕП, чтобы уйти от конкурентных процедур. Сумма группы 5,5 млн руб. — выше лимита.
    //
    // Регресс на механизм бага: до фикса bandLow = limit*0.8 вычислялся из лимита
    // в РУБЛЯХ (480_000), а planTotal уже в тыс. руб. (550) — «предлимитная» полоса
    // была недостижима (550 << 480_000), inBand всегда 0, +20 к индексу никогда не
    // начислялось. После фикса bandLow = 480 (тыс.) — 550 попадает в полосу.
    // Ожидаемый индекс: 20 (база) + 10 (≥10 контрактов) + 20 (inBand>60%) + 20
    // (однородный предмет) = 70 (порог суммы группы >10 млн/20 млн тыс. руб. не
    // достигнут — сумма группы 5,5 млн руб., это отдельная, не проверяемая здесь ветка).
    const rows: AntiCorruptionRow[] = Array.from({ length: 10 }, (_, i) => ({
      rowIndex: i + 1,
      method: 'ЕП',
      planTotal: 550, // тыс. руб. — в предлимитной полосе 480-600 тыс.
      factTotal: 0,
      economy: 0,
      subject: 'Поставка канцелярских товаров',
    }));
    const flags = detectSplitting(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].indicator).toBe('splitting');
    expect(flags[0].severity).toBe('high');
    expect(flags[0].score).toBe(70);
  });
});
