/**
 * Изоляция вкладки «Мониторинг» по выбранному в шапке управлению
 * (канон п.127, владелец 20.08.2026).
 *
 * Книга «Ежедневный мониторинг» — районная, но её строки и сигналы адресны:
 * у процедуры есть канонический ид управления (`dept`), у адреса сигнала —
 * либо лист управления книги («8. УО!D34»), либо префикс книги ГРБС
 * («УО:412»). Этого достаточно, чтобы срез управления показывал только своё:
 *   - процедуры чужих листов не показываются;
 *   - у сигнала остаются только адреса выбранных управлений; сигнал без
 *     единого своего адреса (уровень книги: СВОДНЫЙ, «25-26», справочник) —
 *     районный и в срезе управления не показывается.
 */
import { MONITORING_DEPT_SHEETS } from '@aemr/core';
import type { MonitoringSignal, RegistryProcedure } from './contract';
import { inDeptScope, type DeptScope } from '../selectors/dept-isolation';

/** Процедуры реестра, принадлежащие выбранным управлениям. */
export function scopeProcedures(
  procedures: readonly RegistryProcedure[],
  scope: DeptScope,
): RegistryProcedure[] {
  if (scope === null) return [...procedures];
  return procedures.flatMap((p) => {
    if (!(p.participants?.length)) return inDeptScope(scope, p.dept) ? [p] : [];
    const parts = p.participants.filter((part) => inDeptScope(scope, part.dept));
    const includesOwner = inDeptScope(scope, p.dept);
    if (!parts.length&& !includesOwner) return [];
    const sourceMoney = {
      nmck: p.nmck,
      price: p.auctionPrice,
      savings: p.savingsTotal,
      savingsMb: p.savingsMb,
      savingsKb: p.savingsKb,
      savingsFb: p.savingsFb,
    };
    const sum = (key: keyof typeof sourceMoney): number | null =>
      {
      if (includesOwner) {
        const original = sourceMoney[key];
        return original === null
          ? null
          : original -
              p
                .participants!.filter((part) => !inDeptScope(scope, part.dept))
                .reduce((total, part) => total + (part[key] ?? 0), 0);
      }
      return parts.some((part) => part[key] === null) ? null : parts.reduce((total, part) => total + (part[key] ?? 0), 0);
    };
    const nmck = sum('nmck'); const auctionPrice = sum('price');
    const reductionRub = p.stage === 'awarded' && p.factsEligible !== false && nmck !== null && auctionPrice !== null && auctionPrice > 0
      ? nmck - auctionPrice : null;
    const savingsMb = sum('savingsMb'); const savingsKb = sum('savingsKb'); const savingsFb = sum('savingsFb');
    const savingsTotal = sum('savings');
    const savingsSplitSum = savingsMb === null || savingsKb === null || savingsFb === null ? null : savingsMb + savingsKb + savingsFb;
    const controlGapRub = savingsTotal === null || savingsSplitSum === null ? null : savingsTotal - savingsSplitSum;
    return [{ ...p, participants: parts,
        dept: !includesOwner && parts.length === 1 ? parts[0].dept : p.dept, nmck, auctionPrice, savingsTotal, savingsMb, savingsKb, savingsFb,
      savingsSplitSum, controlGapRub, controlAgrees: controlGapRub === null ? null : Math.abs(controlGapRub) <= .01,
      reductionRub, reductionPct: reductionRub !== null && nmck !== null && nmck > 0 ? reductionRub / nmck * 100 : null }];
  });
}

/** Префиксы адресов, принадлежащих выбранным управлениям. */
function addressPrefixes(scope: ReadonlySet<string>): string[] {
  const prefixes: string[] = [];
  for (const { sheet, dept } of MONITORING_DEPT_SHEETS) {
    if (scope.has(dept)) {
      prefixes.push(`${sheet}!`, `${sheet} `, `${dept}:`);
    }
  }
  return prefixes;
}

/**
 * Сигналы книги в периметре управлений: адреса чужих листов срезаются,
 * сигнал без единого своего адреса скрывается целиком. `count` пересчитывается
 * по оставшимся адресам — прежнее число считало всю книгу и в срезе лгало бы.
 */
export function scopeSignals(
  signals: readonly MonitoringSignal[],
  scope: DeptScope,
  procedures: readonly RegistryProcedure[] = [],
): MonitoringSignal[] {
  if (scope === null) return [...signals];
  const prefixes = addressPrefixes(scope);
  const out: MonitoringSignal[] = [];
  for (const signal of signals) {
    const addresses = signal.addresses.filter(
      (address) => {
        if (prefixes.some((prefix) => address.startsWith(prefix))) return true;
        const row = /^Рабочий реестр процедур![A-Z]+(\d+)/u.exec(address);
        return row !== null && procedures.some((p) => (p.row === Number(row[1]) &&
          (inDeptScope(scope, p.dept) || p.participants?.some((part) => inDeptScope(scope, part.dept)))) ||
          p.participants?.some((part) => part.row === Number(row[1]) && inDeptScope(scope, part.dept)));
      },
    );
    if (addresses.length === 0) continue;
    out.push({ ...signal, addresses, count: addresses.length });
  }
  return out;
}
