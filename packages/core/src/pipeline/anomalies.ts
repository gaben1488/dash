/**
 * anomalies.ts — построчные и системные аномалии (вынесено из dataset-signals.ts, чанк G-3, шаг 3).
 *
 * Три уровня: данные (факт>200% плана, факт без плана, точное совпадение),
 * поведение (подозрительные паттерны исполнителя), система (перекосы по подведам).
 *
 * Тип AnomalySeverity остаётся в dataset-signals — им пользуются и агрегаты
 * (severityRank, ANOMALY_SCORES, AnomalyResult). Приходит через `import type`,
 * стирается компилятором: рантайм-ребро только одно, dataset-signals -> anomalies.
 */
import { DEPT_COLUMNS, subordinateKey } from '@aemr/shared';
import { numFromRow } from '../utils/row-cells.js';
import type { RowSignals } from './signals.js';
import type { AnomalySeverity, BenfordResult } from './dataset-signals.js';

/** Level 1: Data anomaly types from procurement_report.gs line 3652 */
export interface DataAnomaly {
  type: 'EXEC_OVER_200' | 'FACT_NO_PLAN' | 'NEGATIVE_PLAN' | 'EXACT_MATCH' | 'ZERO_ECONOMY_WITH_FACT';
  rowIndex: number;
  details: string;
  severity: AnomalySeverity;
}

/** Level 2: Behavioral anomaly (requires previous snapshot) */
export interface BehavioralAnomaly {
  type: 'SUDDEN_INCREASE' | 'SUDDEN_DECREASE' | 'STATUS_REGRESSION' | 'PLAN_REWRITE';
  rowIndex: number;
  details: string;
  severity: AnomalySeverity;
  previousValue?: number;
  currentValue?: number;
}

/** Level 3: Systemic anomaly (pattern across rows) */
export interface SystemicAnomaly {
  type:
    | 'HIGH_EXACT_MATCH_RATE'
    | 'CLUSTERED_OVERDUE'
    | 'DEPT_EP_CONCENTRATION'
    | 'BENFORD_VIOLATION'
    | 'SUBORDINATE_CONCENTRATION'
    | 'VAGUE_HIGH_VALUE'
    // CANCELED_WITH_FACT больше не детектируется (канон п.27 от 14.08.2026:
    // «отменена» выводилась из свободного текста U/AF). Тип оставлен для
    // чтения старых снимков, где аномалия уже записана.
    | 'CANCELED_WITH_FACT';
  details: string;
  severity: AnomalySeverity;
  affectedRows: number[];
}

/** Composite score result: 4 weighted components */

const EXACT_MATCH_THRESHOLD = 0.0001;

export function detectDataAnomalies(rows: unknown[][]): Map<number, DataAnomaly[]> {
  const result = new Map<number, DataAnomaly[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 25) continue;

    const planTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
    const factTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_FACT);
    const anomalies: DataAnomaly[] = [];

    // EXEC_OVER_200: факт > план × 2
    if (planTotal > 0 && factTotal > planTotal * 2) {
      anomalies.push({
        type: 'EXEC_OVER_200',
        rowIndex: i,
        details: `Факт (${factTotal.toLocaleString('ru-RU')}) превышает план (${planTotal.toLocaleString('ru-RU')}) более чем в 2 раза`,
        severity: 'ВЫСОКАЯ',
      });
    }

    // FACT_NO_PLAN: план = 0, факт > 0
    if ((planTotal === 0 || Number.isNaN(planTotal)) && factTotal > 0) {
      anomalies.push({
        type: 'FACT_NO_PLAN',
        rowIndex: i,
        details: `Есть факт (${factTotal.toLocaleString('ru-RU')}), но план не задан`,
        severity: 'ВЫСОКАЯ',
      });
    }

    // NEGATIVE_PLAN: план < 0
    if (planTotal < 0) {
      anomalies.push({
        type: 'NEGATIVE_PLAN',
        rowIndex: i,
        details: `Отрицательный план: ${planTotal.toLocaleString('ru-RU')}`,
        severity: 'КРИТИЧЕСКАЯ',
      });
    }

    // EXACT_MATCH: |факт - план| / план < 0.0001 (шаблонное заполнение)
    if (planTotal > 0 && factTotal > 0) {
      const diff = Math.abs(factTotal - planTotal) / planTotal;
      if (diff < EXACT_MATCH_THRESHOLD) {
        anomalies.push({
          type: 'EXACT_MATCH',
          rowIndex: i,
          details: `Факт точно совпадает с планом (разница ${(diff * 100).toFixed(4)}%) — возможное шаблонное заполнение`,
          severity: 'СРЕДНЯЯ',
        });
      }
    }

    // ZERO_ECONOMY_WITH_FACT: есть факт, AD помечено экономией, но экономия = 0
    // Column AD=29, Z=25 (economy FB), AA=26 (economy KB), AB=27 (economy MB)
    if (factTotal > 0 && planTotal > 0 && factTotal < planTotal) {
      const ecoFB = numFromRow(row, DEPT_COLUMNS.ECONOMY_FB);
      const ecoKB = numFromRow(row, DEPT_COLUMNS.ECONOMY_KB);
      const ecoMB = numFromRow(row, DEPT_COLUMNS.ECONOMY_MB);
      const totalEco = ecoFB + ecoKB + ecoMB;
      if (totalEco === 0) {
        const adText = String(row[DEPT_COLUMNS.FLAG] ?? '').toLowerCase();
        if (adText.includes('эконом')) {
          anomalies.push({
            type: 'ZERO_ECONOMY_WITH_FACT',
            rowIndex: i,
            details: `AD помечено как экономия, но суммы экономии (Z+AA+AB) = 0`,
            severity: 'СРЕДНЯЯ',
          });
        }
      }
    }

    if (anomalies.length > 0) {
      result.set(i, anomalies);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// 6. Behavioral Anomaly Detection (Level 2)
// ────────────────────────────────────────────────────────────

/**
 * Detects Level 2 (behavioral) anomalies by comparing current vs previous snapshot.
 * Requires previous snapshot data for comparison.
 *
 * @param currentRows - current snapshot rows
 * @param previousRows - previous snapshot rows (if null, returns empty)
 * @returns BehavioralAnomaly[]
 */
export function detectBehavioralAnomalies(
  currentRows: unknown[][],
  previousRows: unknown[][] | null,
): BehavioralAnomaly[] {
  if (!previousRows || previousRows.length === 0) return [];

  const anomalies: BehavioralAnomaly[] = [];
  const maxLen = Math.min(currentRows.length, previousRows.length);

  for (let i = 0; i < maxLen; i++) {
    const curr = currentRows[i];
    const prev = previousRows[i];
    if (!curr || !prev || curr.length < 25 || prev.length < 25) continue;

    const currPlan = numFromRow(curr, DEPT_COLUMNS.TOTAL_PLAN);
    const prevPlan = numFromRow(prev, DEPT_COLUMNS.TOTAL_PLAN);
    const currFact = numFromRow(curr, DEPT_COLUMNS.TOTAL_FACT);
    const prevFact = numFromRow(prev, DEPT_COLUMNS.TOTAL_FACT);

    // SUDDEN_INCREASE: plan increased by >50% between snapshots
    if (prevPlan > 0 && currPlan > prevPlan * 1.5) {
      anomalies.push({
        type: 'SUDDEN_INCREASE',
        rowIndex: i,
        details: `План вырос на ${((currPlan / prevPlan - 1) * 100).toFixed(0)}% между снимками`,
        severity: 'ВЫСОКАЯ',
        previousValue: prevPlan,
        currentValue: currPlan,
      });
    }

    // SUDDEN_DECREASE: plan decreased by >30%
    if (prevPlan > 0 && currPlan < prevPlan * 0.7 && currPlan > 0) {
      anomalies.push({
        type: 'SUDDEN_DECREASE',
        rowIndex: i,
        details: `План снизился на ${((1 - currPlan / prevPlan) * 100).toFixed(0)}% между снимками`,
        severity: 'СРЕДНЯЯ',
        previousValue: prevPlan,
        currentValue: currPlan,
      });
    }

    // PLAN_REWRITE: plan was 0, now has value (new row inserted)
    if (prevPlan === 0 && currPlan > 100_000) {
      anomalies.push({
        type: 'PLAN_REWRITE',
        rowIndex: i,
        details: `Появился новый план ${currPlan.toLocaleString('ru-RU')} (ранее 0)`,
        severity: 'ИНФОРМАЦИЯ',
        previousValue: 0,
        currentValue: currPlan,
      });
    }

    // STATUS_REGRESSION: had fact, now doesn't (data was removed)
    if (prevFact > 0 && currFact === 0) {
      anomalies.push({
        type: 'STATUS_REGRESSION',
        rowIndex: i,
        details: `Факт исчез: было ${prevFact.toLocaleString('ru-RU')}, стало 0`,
        severity: 'КРИТИЧЕСКАЯ',
        previousValue: prevFact,
        currentValue: 0,
      });
    }
  }

  return anomalies;
}

// ────────────────────────────────────────────────────────────
// 7. Systemic Anomaly Detection (Level 3)
// ────────────────────────────────────────────────────────────

/**
 * Detects Level 3 (systemic) anomalies — patterns across the whole dataset.
 *
 * @param dataAnomalies - Level 1 anomalies
 * @param benford - Benford test result
 * @param rows - all rows
 * @param rowSignals - per-row signals from signals.ts
 */
export function detectSystemicAnomalies(
  dataAnomalies: Map<number, DataAnomaly[]>,
  benford: BenfordResult,
  rows: unknown[][],
  rowSignals?: Map<number, RowSignals>,
): SystemicAnomaly[] {
  const anomalies: SystemicAnomaly[] = [];

  // HIGH_EXACT_MATCH_RATE: >15% of rows have exact match
  const exactMatchRows: number[] = [];
  for (const [idx, das] of dataAnomalies) {
    if (das.some(a => a.type === 'EXACT_MATCH')) {
      exactMatchRows.push(idx);
    }
  }
  const dataRowCount = rows.filter(r => r && r.length >= 25 && numFromRow(r, DEPT_COLUMNS.TOTAL_PLAN) > 0).length;
  if (dataRowCount > 10 && exactMatchRows.length / dataRowCount > 0.15) {
    anomalies.push({
      type: 'HIGH_EXACT_MATCH_RATE',
      details: `${exactMatchRows.length} из ${dataRowCount} строк (${((exactMatchRows.length / dataRowCount) * 100).toFixed(0)}%) имеют точное совпадение факт=план — системное шаблонное заполнение`,
      severity: 'ВЫСОКАЯ',
      affectedRows: exactMatchRows,
    });
  }

  // BENFORD_VIOLATION: non-conforming Benford test
  if (benford.sampleSize >= 50 && benford.conformity === 'nonconforming') {
    anomalies.push({
      type: 'BENFORD_VIOLATION',
      details: `Закон Бенфорда: MAD=${benford.mad.toFixed(4)} (${benford.conformity}), выборка ${benford.sampleSize}. Возможна манипуляция данными.`,
      severity: 'ВЫСОКАЯ',
      affectedRows: [],
    });
  }

  // CLUSTERED_OVERDUE: >30% overdue rows in one department = systemic issue
  if (rowSignals) {
    const overdueRows: number[] = [];
    for (const [idx, signals] of rowSignals) {
      if (signals.overdue) overdueRows.push(idx);
    }
    if (dataRowCount > 5 && overdueRows.length / dataRowCount > 0.30) {
      anomalies.push({
        type: 'CLUSTERED_OVERDUE',
        details: `${overdueRows.length} из ${dataRowCount} строк (${((overdueRows.length / dataRowCount) * 100).toFixed(0)}%) просрочены — системная проблема исполнения`,
        severity: 'КРИТИЧЕСКАЯ',
        affectedRows: overdueRows,
      });
    }
  }

  // DEPT_EP_CONCENTRATION: EP risk signals concentrated in one department
  if (rowSignals) {
    const epRiskRows: number[] = [];
    for (const [idx, signals] of rowSignals) {
      if (signals.epRisk) epRiskRows.push(idx);
    }
    if (epRiskRows.length > 5) {
      anomalies.push({
        type: 'DEPT_EP_CONCENTRATION',
        details: `${epRiskRows.length} строк с ЕП-риском — требует проверки на концентрацию у одного поставщика`,
        severity: 'СРЕДНЯЯ',
        affectedRows: epRiskRows,
      });
    }
  }

  // SUBORDINATE_CONCENTRATION: один подвед забирает >80% бюджета (ОЭСР red flag)
  {
    const subTotals = new Map<string, { plan: number; rows: number[] }>();
    let grandTotal = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 25) continue;
      const plan = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
      if (plan <= 0) continue;
      grandTotal += plan;
      const sub = subordinateKey(String(row[DEPT_COLUMNS.SUBORDINATE] ?? ''));
      const entry = subTotals.get(sub) ?? { plan: 0, rows: [] };
      entry.plan += plan;
      entry.rows.push(i);
      subTotals.set(sub, entry);
    }
    if (grandTotal > 0 && subTotals.size > 1) {
      for (const [sub, data] of subTotals) {
        const share = data.plan / grandTotal;
        if (share > 0.80 && data.rows.length > 3) {
          anomalies.push({
            type: 'SUBORDINATE_CONCENTRATION',
            details: `Подведомственная "${sub}" получает ${(share * 100).toFixed(0)}% бюджета (${data.rows.length} строк из ${dataRowCount}) — риск концентрации`,
            severity: 'СРЕДНЯЯ',
            affectedRows: data.rows,
          });
        }
      }
    }
  }

  // VAGUE_HIGH_VALUE: расплывчатое описание на дорогих закупках (>5M) — red flag по ОЭСР
  {
    const vagueRows: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 25) continue;
      const plan = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
      // Единицы: колонка K — тыс. руб. (канон книг ГРБС), порог «дорогая закупка»
      // = 5_000 тыс. = 5 млн руб. Свип БАГ #1 (bug-hunt 2026-08-08): литерал был
      // в рублях (5_000_000) — при данных в тысячах фильтр требовал закупку на
      // 5 млрд руб., индикатор молчал всегда.
      if (plan < 5_000) continue; // только дорогие закупки (≥ 5 млн руб.)
      const desc = String(row[DEPT_COLUMNS.PROGRAM_NAME] ?? '').trim(); // D=3 «графа программы»
      const subj = String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim();
      const text = (desc + ' ' + subj).trim();
      // Расплывчатое описание: короткое (<50 символов) или только общие слова
      // Threshold raised from 30→50: real data shows 30 chars catches legit entries like
      // "Закупка компьютерного оборудования" (35 chars). 50 is more balanced.
      if (text.length < 50 || /^(закупка|поставка|услуг|работ|прочие|иные|другие|разное)\s*$/i.test(text)) {
        vagueRows.push(i);
      }
    }
    if (vagueRows.length > 0) {
      anomalies.push({
        type: 'VAGUE_HIGH_VALUE',
        details: `${vagueRows.length} дорогих закупок (>5 млн) с расплывчатым описанием (<50 символов) — затрудняет контроль`,
        severity: 'СРЕДНЯЯ',
        affectedRows: vagueRows,
      });
    }
  }

  // CANCELED_WITH_FACT СНЯТ 14.08.2026 (канон п.27 интервью): признак
  // «отменена/снята» выводился из свободного текста колонок U/AF
  // (/отмен|не требуется|снят/), а решение владельца дословно — текст
  // исполнителей машинно не интерпретируется нигде. Тот же класс, что
  // баг #16 охоты 08.08 и пп.40–41 интервью: подстрока «отмен» ловила и
  // «не отменена», и комментарии о прошлых отменах. Комментарий читателю
  // показывается как есть; структурной отметки отмены в книгах нет.

  return anomalies;
}

// ────────────────────────────────────────────────────────────
// 8. Composite Score
// ────────────────────────────────────────────────────────────

/**
 * Calculates composite risk score (0-100, lower = better).
 * Портировано из procurement_report.gs строка 4549.
 *
 * @param executionLevel - execution classification
 * @param epRiskLevel - EP risk classification
 * @param worstAnomalySeverity - worst anomaly severity
 * @param worstComplianceSeverity - worst compliance severity
 * @returns CompositeScore
 */
