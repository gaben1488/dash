import type { ReconDeptRow } from './types';
import { fmtNum } from './format';

export interface DeltaDiagnosis {
  source: string;
  detail: string;
  severity: 'info' | 'warn' | 'error';
}

/** Numbers establish a difference, not its cause. Proven causes render separately. */
export function diagnoseDelta(row: ReconDeptRow): DeltaDiagnosis {
  if (row.planDelta === null || row.factDelta === null || row.ecoDelta === null) {
    return { source: 'Нет данных для сравнения', detail: row.assessment.reason, severity: 'warn' };
  }
  if (row.assessment.kind === 'neutral') {
    return { source: 'Нет данных для сравнения', detail: row.assessment.reason, severity: 'info' };
  }
  if (row.assessment.kind === 'ok') {
    return { source: 'В пределах допуска', detail: row.assessment.reason, severity: 'info' };
  }
  return {
    source: 'Причина не установлена',
    detail: `Разница расчёта и СВОД: план ${fmtNum(row.planDelta)}, факт ${fmtNum(row.factDelta)}, экономия ${fmtNum(row.ecoDelta)} тыс. ₽. Проверить состав строк, период, единицы и правила расчёта. Сам размер разницы не устанавливает причину.`,
    severity: row.assessment.kind === 'high' ? 'error' : 'warn',
  };
}
