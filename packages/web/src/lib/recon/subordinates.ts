// ── Агрегация подведов внутри управления для вкладки «По подведам».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import type { ReconSubordinate } from './types';

/** % исполнения подведа: приоритет — готовое поле API, иначе (КП+ЕП)/план-строки */
export function subordinateExecutionPct(sub: ReconSubordinate): number {
  if (sub.executionPct != null) return sub.executionPct;
  const planCount = sub.rowCount ?? 0;
  if (planCount <= 0) return 0;
  return (((sub.competitiveCount ?? 0) + (sub.epCount ?? 0)) / planCount) * 100;
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
  const t: DeptSubordinateTotals = { planCount: 0, factCount: 0, planTotal: 0, factTotal: 0, economy: 0, execPct: 0 };
  for (const sub of subs) {
    t.planCount += sub.rowCount ?? 0;
    t.factCount += (sub.competitiveCount ?? 0) + (sub.epCount ?? 0);
    t.planTotal += sub.planTotal ?? 0;
    t.factTotal += sub.factTotal ?? 0;
    t.economy += sub.economyTotal ?? 0;
  }
  t.execPct = t.planCount > 0 ? (t.factCount / t.planCount) * 100 : 0;
  return t;
}
