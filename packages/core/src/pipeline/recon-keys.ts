/**
 * Общие ключи сверок: нормализация идентификатора ГРБС.
 *
 * Выделено из reconcile.ts разрезом 20.08.2026 (зона В): помесячная сверка
 * ШДЮ (reconcile-monthly.ts) и квартальная перекрёстная (reconcile-cross.ts)
 * живут в своих файлах, а правило «латиница и кириллица — один ГРБС» у них
 * одно на двоих и обязано оставаться в одном месте.
 */

import { findDept } from '@aemr/shared';

/**
 * Канонический ключ ГРБС: латиница ('uer') и кириллица ('УЭР') → единый
 * кириллический dept.id через реестр. SHDYU_BLOCKS ключуют латиницей,
 * recalcResults — кириллицей; без нормализации crossVerifyQuarterly /
 * reconcileMonthly объединяли непересекающиеся ключи → каждая сторона
 * сравнивалась с 0 → ложные расхождения. 'all' и прочее без записи в
 * реестре остаются как есть.
 */
export function canonGrbsKey(key: string): string {
  return findDept(key)?.id ?? key;
}

/** Пере-ключевание Record на канонический ГРБС-id (при коллизии выигрывает последний). */
export function rekeyByGrbs<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) out[canonGrbsKey(k)] = v;
  return out;
}
