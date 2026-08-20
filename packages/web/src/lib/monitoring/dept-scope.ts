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
  return procedures.filter((p) => inDeptScope(scope, p.dept));
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
): MonitoringSignal[] {
  if (scope === null) return [...signals];
  const prefixes = addressPrefixes(scope);
  const out: MonitoringSignal[] = [];
  for (const signal of signals) {
    const addresses = signal.addresses.filter(
      (address) => prefixes.some((prefix) => address.startsWith(prefix)),
    );
    if (addresses.length === 0) continue;
    out.push({ ...signal, addresses, count: addresses.length });
  }
  return out;
}
