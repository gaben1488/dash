/**
 * approvedEconomy — SSOT для построчной «утверждённой» экономии.
 *
 * Инвариант AEMR: экономия строки = Z+AA+AB ТОЛЬКО когда AD='да' И есть дата факта.
 * Сырые (негейтованные) суммы Z+AA+AB нельзя показывать пользователю и нельзя
 * скармливать комплаенс-проверкам: они порождают ложные вердикты «нарушение ст.37».
 *
 * Регрессия P0 (bug-hunt 2026-07-09): server/routes/analytics.ts суммировал
 * Z+AA+AB без AD-гейта в ТРЁХ местах, и результат уходил в checkAntiDumping.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { approvedEconomy } from './calc-engine.js';

const COL = DEPT_COLUMNS;

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.FACT_DATE] = overrides.factDate ?? '20.02.2025';
  row[COL.ECONOMY_FB] = overrides.ecoFB ?? 0;
  row[COL.ECONOMY_KB] = overrides.ecoKB ?? 0;
  row[COL.ECONOMY_MB] = overrides.ecoMB ?? 0;
  row[COL.FLAG] = overrides.flag ?? '';
  return row;
}

describe('approvedEconomy — AD-gate SSOT', () => {
  it('суммирует Z+AA+AB когда AD="да" и есть дата факта', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 10, ecoKB: 20, ecoMB: 5, flag: 'да' }))).toBe(35);
  });

  it('возвращает 0 когда AD пустой, даже если колонки экономии заполнены', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 100, ecoKB: 100, ecoMB: 100, flag: '' }))).toBe(0);
  });

  it('возвращает 0 когда AD не "да" (например "нет")', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 500, flag: 'нет' }))).toBe(0);
  });

  it('возвращает 0 когда даты факта нет (экономия ещё не состоялась)', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 50, flag: 'да', factDate: '' }))).toBe(0);
  });

  it('возвращает 0 когда дата факта — плейсхолдер («х», «н/д»)', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 50, flag: 'да', factDate: 'х' }))).toBe(0);
    expect(approvedEconomy(makeRow({ ecoFB: 50, flag: 'да', factDate: 'н/д' }))).toBe(0);
  });

  it('AD-флаг регистронезависим и терпит пробелы («ДА », " Да")', () => {
    expect(approvedEconomy(makeRow({ ecoFB: 7, flag: 'ДА ' }))).toBe(7);
    expect(approvedEconomy(makeRow({ ecoFB: 7, flag: ' Да' }))).toBe(7);
  });

  it('отрицательную сумму отдаёт со знаком — это перерасход над лимитом', () => {
    // До 08.08 здесь стояла обрезка Math.max(0, …) с пометкой «экономия не
    // бывает отрицательной». Бывает: контракт заключается дороже лимита, и
    // лист СВОД это показывает — обрезки нет ни у него, ни у метрики
    // economy_total. Кламп ломал две вещи сразу: построчное раскрытие числа
    // не сходилось с итогом плитки (замер: строка −150,00327 тыс. руб. по
    // местному бюджету), и перерасход порождал ложный антикоррупционный
    // флаг. Прятать перерасход в ноль — то же, что скрывать его от
    // руководителя (реестр расхождений 08.08 §2).
    expect(approvedEconomy(makeRow({ ecoFB: -100, ecoKB: 10, flag: 'да' }))).toBe(-90);
  });

  it('нечисловые ячейки экономии трактует как 0, не как NaN', () => {
    expect(approvedEconomy(makeRow({ ecoFB: '', ecoKB: 'абв', ecoMB: 5, flag: 'да' }))).toBe(5);
  });
});
