// @vitest-environment jsdom
/**
 * Стражи мёртвых пятен сигналов на Пульсе (канон §18 спеки
 * docs/superpowers/specs/2026-08-22-pulse-feedback-2.md, перепись 29.08.2026).
 *
 * Класс дефекта: ключ, вычеркнутый из генерации замечаний решением владельца
 * (LEGACY_SIGNAL_TO_CHECK, @aemr/shared), оставался пятном на Пульсе — его
 * счётчик из замечаний был вечным нулём, и пятно падало в «Молчат N проверок»,
 * что читалось как «проверили — чисто», хотя класс вообще не считается.
 * Так лгало пятно «факт без даты» (factWithoutDate, вычеркнут п.137(1)).
 *
 * Два обещания под стражей:
 *   1. поимённое пятно обязано УМЕТЬ рождать замечание — каждый ключ
 *      NAMED_SPOT_SIGNALS стоит в LEGACY_SIGNAL_TO_CHECK;
 *   2. стадия «в течение года» видна на Пульсе СЧЁТОМ СТРОК СОСТОЯНИЯ из
 *      данных (мок корзины /api/registry/buckets), а не из замечаний, и
 *      отсутствие счёта не выдаётся за ноль строк.
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_SIGNAL_TO_CHECK } from '@aemr/shared';
import { NAMED_SPOT_SIGNALS, yearlongStageLine } from './Dashboard';

describe('поимённые пятна Пульса против вычеркнутых ключей (канон §18 п.3)', () => {
  it('каждое поимённое пятно умеет рождать замечание: ключ стоит в LEGACY_SIGNAL_TO_CHECK', () => {
    for (const key of NAMED_SPOT_SIGNALS) {
      expect(
        LEGACY_SIGNAL_TO_CHECK[key],
        `Ключ «${key}» стоит пятном на Пульсе, но вычеркнут из генерации замечаний — `
        + 'его счётчик вечный ноль, пятно лжёт из «Молчат N проверок». '
        + 'Либо вернуть ключ в LEGACY_SIGNAL_TO_CHECK, либо убрать пятно '
        + '(стадии показываются счётом строк состояния, не замечаниями).',
      ).toBeDefined();
    }
  });

  it('вычеркнутые ключи не стоят пятнами: перепись §18 закрыта', () => {
    // Полная перепись вычеркнутых из генерации ключей на 29.08.2026:
    // factWithoutDate (п.137(1)), budgetMismatch (дубль правила budget_sum_plan),
    // singleParticipant и lowCompetition (ненадёжная детекция — только чипы),
    // tdWithProgram (канон п.30), stalledContract (детектор всегда false, п.27).
    const struck = [
      'factWithoutDate',
      'budgetMismatch',
      'singleParticipant',
      'lowCompetition',
      'tdWithProgram',
      'stalledContract',
    ];
    for (const key of struck) {
      expect(
        NAMED_SPOT_SIGNALS.has(key),
        `Вычеркнутый ключ «${key}» не имеет права висеть пятном, ждущим счётчика из замечаний`,
      ).toBe(false);
    }
  });
});

describe('пятно стадии «в течение года» — счёт строк состояния (канон §18 пп.1–2)', () => {
  it('считается из данных корзины: числа мока доезжают до текста, дверь открыта', () => {
    const line = yearlongStageLine({ rows: 46, planSum: 8733.26 });
    expect(line).not.toBeNull();
    expect(line!.hasRows).toBe(true);
    // Числа берутся из мока корзины, не из замечаний: и счёт строк, и план.
    expect(line!.text).toContain('46 строк');
    const plan = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(8733.26);
    expect(line!.text).toContain(`план ${plan} тыс. ₽`);
    expect(line!.text).toContain('в течение года');
  });

  it('склонение строк живёт по числу из данных', () => {
    expect(yearlongStageLine({ rows: 3, planSum: 120 })!.text).toContain('3 строки');
    expect(yearlongStageLine({ rows: 1, planSum: 50 })!.text).toContain('1 строка');
  });

  it('строк в стадии ноль — честная фраза без чисел и без двери', () => {
    const line = yearlongStageLine({ rows: 0, planSum: 0 });
    expect(line).not.toBeNull();
    expect(line!.hasRows).toBe(false);
    expect(line!.text).toContain('нет');
  });

  it('счёта нет (сервер не ответил) — пятно не рисуется: отсутствие счёта не ноль', () => {
    expect(yearlongStageLine(null)).toBeNull();
  });
});
