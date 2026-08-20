/**
 * Чистый маппер snapshot.datasetAnalyses (/api/dashboard) → строки таблицы
 * «Аномалии данных по управлениям» (E4 волна-1, W1-A: данные уже в браузере,
 * серверного кода ноль — спека core-output-wiring-2026-07-16 §2.1).
 *
 * Поле dataAnomalyFlags — Map на сервере, в JSON сериализуется в {} —
 * здесь сознательно НЕ читается (фикс сериализации — отдельная волна).
 */
import type { DatasetAnalysis, EpRiskLevel } from '@aemr/core'; // type-only — разрешено правилом §5-9

/** DTO по проводу: у частично посчитанного ГРБС любое поле может отсутствовать. */
export type DatasetAnalysisDTO = Partial<DatasetAnalysis>;

export interface DatasetAuditRow {
  /** Латинский ключ ГРБС из snapshot.datasetAnalyses ('uo', 'uer', …) */
  deptId: string;
  /** Композит 0-100, МЕНЬШЕ = лучше (шкала GS-порта); null — не посчитан */
  compositeScore: number | null;
  compositeGrade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  benfordConformity: 'close' | 'acceptable' | 'marginal' | 'nonconforming' | null;
  benfordMad: number | null;
  benfordSampleSize: number;
  /**
   * Частоты первых цифр 1–9 (доли 0–1): фактические против ожидаемых по
   * закону Бенфорда. Нужны образовательной развёртке (канон п.88/24:
   * «показать ожидаемое против фактического, чтобы читатель нашёл косяк»).
   * null — снимок распределение не сохранил.
   */
  benfordObserved: number[] | null;
  benfordExpected: number[] | null;
  outlierCount: number;
  /** Параметры z-оценки — чтобы объяснить, ЧТО именно считается выбросом. */
  outlierMean: number | null;
  outlierStdDev: number | null;
  outlierThreshold: number | null;
  epRiskLevel: EpRiskLevel | null;
  /** Доля ЕП в процентах 0-100; null — не посчитана */
  epSharePct: number | null;
  seasonalCount: number;
  splittingCount: number;
}

/** Подписи вердикта Бенфорда: label — в ячейку, hint — краткое «почему» (пороги Нигрини 2012). */
export const BENFORD_LABELS: Record<
  NonNullable<DatasetAuditRow['benfordConformity']>,
  { label: string; hint: string; tone: 'ok' | 'warn' | 'bad' }
> = {
  close: { label: 'соответствует', hint: 'MAD ≤ 0.006 — распределение первых цифр естественное', tone: 'ok' },
  acceptable: { label: 'приемлемо', hint: 'MAD ≤ 0.012 — отклонение в допустимых пределах', tone: 'ok' },
  marginal: { label: 'на грани', hint: 'MAD ≤ 0.015 — отклонение заметное, стоит присмотреться', tone: 'warn' },
  nonconforming: { label: 'не соответствует', hint: 'MAD > 0.015 — возможна манипуляция суммами', tone: 'bad' },
};

/**
 * snapshot.datasetAnalyses → строки таблицы, худшие первыми
 * (composite по убыванию; ГРБС без композита — в конец).
 */
export function selectDatasetAudit(
  // Снимок отдаёт это поле как «словарь чего-то неизвестного»
  // (`Record<string, unknown>` в shared/types.ts, правка ядра 20.08.2026):
  // пакет shared лежит ниже ядра и о расчётных типах знать не может, поэтому
  // шаг наружу требует разбора. Разбор живёт ЗДЕСЬ — в единственном месте,
  // которое эти данные читает: проверка формы уже была в теле цикла, теперь
  // она же объявлена и в подписи, а вызывающая страница не приводит типы.
  analyses: Record<string, unknown> | null | undefined,
): DatasetAuditRow[] {
  if (!analyses) return [];
  const rows: DatasetAuditRow[] = [];
  for (const [deptId, raw] of Object.entries(analyses)) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as DatasetAnalysisDTO;
    rows.push({
      deptId,
      compositeScore: a.compositeScore?.score ?? null,
      compositeGrade: a.compositeScore?.grade ?? null,
      benfordConformity: a.benford?.conformity ?? null,
      benfordMad: a.benford?.mad ?? null,
      benfordSampleSize: a.benford?.sampleSize ?? 0,
      benfordObserved: Array.isArray(a.benford?.observed) && a.benford.observed.length === 9
        ? a.benford.observed
        : null,
      benfordExpected: Array.isArray(a.benford?.expected) && a.benford.expected.length === 9
        ? a.benford.expected
        : null,
      outlierCount: a.outliers?.count ?? 0,
      outlierMean: typeof a.outliers?.mean === 'number' ? a.outliers.mean : null,
      outlierStdDev: typeof a.outliers?.stdDev === 'number' ? a.outliers.stdDev : null,
      outlierThreshold: typeof a.outliers?.threshold === 'number' ? a.outliers.threshold : null,
      epRiskLevel: a.epRisk?.level ?? null,
      epSharePct: typeof a.epRisk?.epShare === 'number' ? a.epRisk.epShare * 100 : null,
      seasonalCount: a.seasonalAnomalies?.length ?? 0,
      splittingCount: a.suspiciousSplitting?.length ?? 0,
    });
  }
  rows.sort((x, y) => (y.compositeScore ?? -Infinity) - (x.compositeScore ?? -Infinity));
  return rows;
}
