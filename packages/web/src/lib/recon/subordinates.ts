// ── Агрегация подведов внутри управления для вкладки «По подведам».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import type { ReconSubordinate } from './types';

/** % исполнения подведа: приоритет — готовое поле API, иначе (КП+ЕП)/план-строки */
export function subordinateExecutionPct(sub: ReconSubordinate): number {
  return sub.executionPct
    ?? ((sub.rowCount ?? 0) > 0
      ? (((sub.competitiveCount ?? 0) + (sub.epCount ?? 0)) / (sub.rowCount ?? 1)) * 100
      : 0);
}

export interface DeptSubordinateTotals {
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  economy: number;
  execPct: number;
}

/** Итоги по управлению = сумма его подведов (строка «Итого» под группой) */
export function aggregateDeptSubordinates(subs: ReconSubordinate[]): DeptSubordinateTotals {
  const planCount = subs.reduce((s, sub) => s + (sub.rowCount ?? 0), 0);
  const factCount = subs.reduce((s, sub) => s + (sub.competitiveCount ?? 0) + (sub.epCount ?? 0), 0);
  const planTotal = subs.reduce((s, sub) => s + (sub.planTotal ?? 0), 0);
  const factTotal = subs.reduce((s, sub) => s + (sub.factTotal ?? 0), 0);
  const economy = subs.reduce((s, sub) => s + (sub.economyTotal ?? 0), 0);
  const execPct = planCount > 0 ? (factCount / planCount) * 100 : 0;
  return { planCount, factCount, planTotal, factTotal, economy, execPct };
}
